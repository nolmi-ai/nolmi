import type { FastifyBaseLogger } from "fastify";
import type Database from "better-sqlite3";
import type { TwinServiceRegistry, TwinSummary } from "../twin-service-registry.js";
import { REFLECTION_CAPABILITY, type ReflectionResult } from "./reflection-engine.js";

// ─── REFLECTION LOOP SERVICE (Selbst-Reflexion Stufe 2) ──────────────────────
//
// Autonomer, periodischer Trigger für den fertigen Reflexions-Generator
// (b6702c6/c344d52) im 'self'-Modus. Lifecycle 1:1 nach oauth/refresh-service:
// konstruieren → start(logger) nach app.listen → stop() im Shutdown.
//
// ── LEITPLANKE (unverändert) ──
// Auch autonom ausgelöst erzeugt die Reflexion NUR einen Pending-Audit, NIE
// etwas Wirksames. Es gibt KEINEN Pfad vom Loop direkt ins Diary — der Loop
// ruft `reflectionEngine.reflect('self')`, das exakt wie der manuelle Pfad ein
// Pending anlegt; Approve (Mensch) bleibt der einzige Wirksam-Werden-Schritt.
//
// ── Bewusste Setzungen ──
//   - NUR 'self'-Modus. Autonome Inferenzen ÜBER MARKUS ('owner') bleiben
//     manuell (sensibelste Klasse) — eigene spätere Entscheidung.
//   - OPT-IN: Default AUS. Ohne REFLECTION_LOOP_ENABLED=true tut start() nichts.
//   - Dedup VOR jedem LLM-Call (0 Token-Kosten bei Skip):
//       Guard A: max 1 offenes Pending pro Twin.
//       Guard B: nur bei neuer Substanz seit der letzten Reflexion.
//   - Multi-Tenant: iteriert über registry.list() (in-process entschlüsselte
//     LLM-Clients; gelöschte Twins sind via removeTwin/#744 raus); per-Twin
//     try/catch isoliert Fehler (kaputter Key killt nicht die anderen).

const DEFAULT_INTERVAL_HOURS = 24;

/** Minimaler Bool-ENV-Parse (config.parseBoolEnv ist nicht exportiert). */
function envEnabled(raw: string | undefined): boolean {
  const v = raw?.trim().toLowerCase();
  return v === "true" || v === "1" || v === "yes";
}

export interface ReflectionLoopDeps {
  db: Database.Database;
  registry: TwinServiceRegistry;
  /** Intervall in Stunden. Default `REFLECTION_LOOP_INTERVAL_HOURS` / 24. */
  intervalHours?: number;
  /**
   * Test-Hook: pro-Twin-Reflexions-Trigger. Default ruft die in-process
   * Registry-Engine `reflect('self')`. Tests injizieren einen Spy/Mock, um
   * „Generator NICHT aufgerufen" (Skip) bzw. „aufgerufen" zu prüfen.
   */
  triggerReflection?: (handle: string) => Promise<ReflectionResult | null>;
}

export interface ReflectForTwinOutcome {
  skipped: boolean;
  /** 'open-pending' | 'no-new-substance' | 'twin-not-loaded' | <generator-skip> */
  reason?: string;
  created?: boolean;
  auditId?: string;
}

export class ReflectionLoopService {
  private intervalId: NodeJS.Timeout | null = null;
  private logger: FastifyBaseLogger | null = null;
  private readonly intervalMs: number;
  private readonly trigger: (handle: string) => Promise<ReflectionResult | null>;

  constructor(private deps: ReflectionLoopDeps) {
    const envHours = Number(process.env.REFLECTION_LOOP_INTERVAL_HOURS);
    const hours =
      deps.intervalHours ??
      (Number.isFinite(envHours) && envHours > 0 ? envHours : DEFAULT_INTERVAL_HOURS);
    this.intervalMs = hours * 60 * 60 * 1000;
    this.trigger =
      deps.triggerReflection ??
      (async (handle) => {
        const twin = deps.registry.getByHandle(handle);
        if (!twin) return null; // Race: Twin zwischen list() und Trigger entfernt
        return twin.reflectionEngine.reflect("self");
      });
  }

  /**
   * Boot-Step (nach app.listen). OPT-IN: ohne REFLECTION_LOOP_ENABLED=true wird
   * KEIN Interval gesetzt (loggt einmal „disabled"). Idempotent.
   */
  start(logger: FastifyBaseLogger): void {
    this.logger = logger;
    if (this.intervalId) {
      logger.warn("[reflection-loop] start() während laufendem Loop — ignored");
      return;
    }
    if (!envEnabled(process.env.REFLECTION_LOOP_ENABLED)) {
      logger.info(
        "[reflection-loop] disabled (REFLECTION_LOOP_ENABLED nicht true) — kein autonomer Reflexions-Loop",
      );
      return;
    }
    this.intervalId = setInterval(() => {
      this.runTick().catch((err) => {
        logger.error(
          { err: err instanceof Error ? err.message : String(err) },
          "[reflection-loop] tick failed",
        );
      });
    }, this.intervalMs);
    logger.info(
      `[reflection-loop] started, interval ${this.intervalMs}ms (self-mode, opt-in)`,
    );
  }

  /** Shutdown-Step: cleart Interval. Idempotent. */
  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
      this.logger?.info("[reflection-loop] stopped");
    }
  }

  /**
   * Ein Durchlauf über alle aktiven Twins. Per-Twin try/catch: ein Fehler (z.B.
   * kaputter Key) killt nicht die anderen Twins oder den Loop.
   */
  async runTick(): Promise<void> {
    const twins = this.deps.registry.list();
    for (const twin of twins) {
      try {
        await this.reflectForTwin(twin);
      } catch (err) {
        this.logger?.error(
          {
            twinId: twin.twinId,
            handle: twin.handle,
            err: err instanceof Error ? err.message : String(err),
          },
          "[reflection-loop] reflect failed for twin",
        );
      }
    }
  }

  /**
   * Dedup-Guards (beide VOR jedem LLM-Call), dann Generator. Rückgabe für Tests.
   */
  async reflectForTwin(twin: TwinSummary): Promise<ReflectForTwinOutcome> {
    // Guard A — max 1 offenes Pending pro Twin (indizierte Audit-Query).
    if (this.hasOpenPending(twin.twinId)) {
      this.logger?.info(
        { handle: twin.handle },
        "[reflection-loop] skip — offenes self-reflection-write-Pending vorhanden",
      );
      return { skipped: true, reason: "open-pending" };
    }

    // Guard B — nur bei neuer Substanz seit der letzten Reflexion. Kein
    // lastReflectionTs (noch nie reflektiert) → Guard passiert (nicht skippen).
    const lastTs = this.lastReflectionTs(twin.twinId);
    if (lastTs && !this.hasNewSubstanceSince(twin.twinId, lastTs)) {
      this.logger?.info(
        { handle: twin.handle, lastTs },
        "[reflection-loop] skip — keine neue Substanz seit letzter Reflexion",
      );
      return { skipped: true, reason: "no-new-substance" };
    }

    // Beide Guards passiert → Generator (erzeugt das Pending wie der CLI-Pfad).
    const result = await this.trigger(twin.handle);
    if (!result) return { skipped: true, reason: "twin-not-loaded" };
    if (!result.created) {
      this.logger?.info(
        { handle: twin.handle, reason: result.skippedReason },
        "[reflection-loop] kein Pending erzeugt (zu wenig/keine neue Substanz)",
      );
      return { skipped: true, reason: result.skippedReason, created: false };
    }
    this.logger?.info(
      { handle: twin.handle, auditId: result.auditId },
      "[reflection-loop] Pending-Selbstreflexion erzeugt",
    );
    return { skipped: false, created: true, auditId: result.auditId };
  }

  // ─── Dedup-Queries (indiziert: idx_audit_twin_id/capability/status) ─────────

  private hasOpenPending(twinId: string): boolean {
    const row = this.deps.db
      .prepare(
        `SELECT COUNT(*) AS c FROM audit
           WHERE twin_id = ? AND capability = ? AND status = 'pending'`,
      )
      .get(twinId, REFLECTION_CAPABILITY) as { c: number };
    return row.c > 0;
  }

  private lastReflectionTs(twinId: string): string | null {
    const row = this.deps.db
      .prepare(
        `SELECT MAX(timestamp) AS m FROM audit
           WHERE twin_id = ? AND capability = ?`,
      )
      .get(twinId, REFLECTION_CAPABILITY) as { m: string | null };
    return row.m ?? null;
  }

  /**
   * Neue Substanz seit `sinceTs`: neue Konversation, neuer Fact oder neue
   * Summary. ISO-Text-Timestamps sind lexikographisch vergleichbar.
   */
  private hasNewSubstanceSince(twinId: string, sinceTs: string): boolean {
    const row = this.deps.db
      .prepare(
        `SELECT (
           EXISTS(SELECT 1 FROM conversations WHERE twin_id = ? AND started_at > ?)
           OR EXISTS(SELECT 1 FROM facts WHERE twin_id = ? AND created_at > ?)
           OR EXISTS(SELECT 1 FROM conversation_summaries cs
                       WHERE cs.created_at > ?
                         AND cs.conversation_id IN
                             (SELECT id FROM conversations WHERE twin_id = ?))
         ) AS hasNew`,
      )
      .get(twinId, sinceTs, twinId, sinceTs, sinceTs, twinId) as {
      hasNew: number;
    };
    return row.hasNew === 1;
  }
}
