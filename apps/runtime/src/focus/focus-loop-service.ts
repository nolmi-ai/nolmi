import type { FastifyBaseLogger } from "fastify";
import type Database from "better-sqlite3";
import type { TwinServiceRegistry, TwinSummary } from "../twin-service-registry.js";
import type { FocusResult } from "./focus-engine.js";
import type { ProactiveNudgeResult } from "./proactive-nudge-service.js";

// ─── FOCUS LOOP SERVICE (Aufmerksamkeit/Fokus Stufe 1 — Schritt 4/4) ─────────
//
// Autonomer, periodischer Trigger für den FocusEngine (Schritt 1). Der Twin
// leitet seinen „aktuellen Fokus" von sich aus periodisch neu ab — die autonome
// Dimension der Vision „peripheres Wissen: Twin pflegt autonom". Lifecycle 1:1
// nach ReflectionLoopService: konstruieren → start(logger) nach app.listen →
// stop() im Shutdown.
//
// ── BEWUSSTE ABWEICHUNGEN vom Reflexions-Loop ──
//   - KEIN Pending: deriveFocus schreibt DIREKT einen Snapshot (Fokus hat kein
//     Approval-Gate — peripheres Wissen). Folglich auch KEINE „max 1 offenes
//     Pending"-Guard-Ebene; der Substanz-Guard allein ist die Token-Bremse.
//   - Die Leitplanke ist nicht ein Approval, sondern Sichtbarkeit + Reset
//     (Schritt 3) — deshalb darf der Loop direkt schreiben.
//
// ── OPT-IN, DEFAULT AUS ──
// Ohne FOCUS_LOOP_ENABLED=true tut start() nichts (loggt einmal „disabled").
//
// ── Token-Bremse (VOR jedem LLM-Call, 0 Token bei Skip) ──
// hasNewSubstanceSince: nur neu ableiten, wenn seit dem letzten aktiven
// Snapshot neue Substanz da ist (neue Turns/Audits ODER neue Summary). Kein
// aktiver Snapshot (noch nie abgeleitet) → Guard passiert (immer ableiten).
//
// ── ANGEHÄNGT (additiv): Proaktiver Fokus-Nudge Stufe 1 ──
// Nach der Fokus-Ableitung prüft jeder Tick zusätzlich, ob der Owner lang am
// selben Thema festhängt (ProactiveNudgeService.nudge()) und legt ggf. einen
// Pending-Anstoß ab. KEIN eigener Loop, KEIN separates Gate — das Feature hängt
// an diesem (FOCUS_LOOP_ENABLED-gateten) Loop. Eigener try/catch pro Twin, damit
// ein Nudge-Fehler weder die Fokus-Ableitung noch die anderen Twins killt.
// „Still, bis Historie da ist": <3 Snapshots → detectStuck=false, 0 Token.

const DEFAULT_INTERVAL_HOURS = 24;

/** Minimaler Bool-ENV-Parse (config.parseBoolEnv ist nicht exportiert). */
function envEnabled(raw: string | undefined): boolean {
  const v = raw?.trim().toLowerCase();
  return v === "true" || v === "1" || v === "yes";
}

export interface FocusLoopDeps {
  db: Database.Database;
  registry: TwinServiceRegistry;
  /** Intervall in Stunden. Default `FOCUS_LOOP_INTERVAL_HOURS` / 24. */
  intervalHours?: number;
  /**
   * Test-Hook: pro-Twin-Fokus-Trigger. Default ruft die in-process Registry-
   * Engine `deriveFocus()`. Tests injizieren einen Spy/Mock, um „Generator
   * NICHT aufgerufen" (Skip) bzw. „aufgerufen" zu prüfen.
   */
  triggerFocus?: (handle: string) => Promise<FocusResult | null>;
  /**
   * Test-Hook: pro-Twin-Nudge-Trigger. Default ruft die in-process Registry-
   * Engine `proactiveNudgeService.nudge()`. Tests injizieren einen Spy/Mock.
   */
  triggerNudge?: (handle: string) => Promise<ProactiveNudgeResult | null>;
  /**
   * 2b: aktiver Owner-Push für autonome Nudges (BotRegistry). Optional — ohne
   * ihn (oder mit Flag AUS) bleibt der Nudge ein Pending. Wird hier durchgereicht
   * statt in den TwinService, weil die BotRegistry erst NACH der Twin-Registry
   * existiert (Boot-Reihenfolge); der Loop kennt beide.
   */
  botRegistry?: {
    sendToOwner(twinId: string, text: string): Promise<{ sent: boolean; reason?: string }>;
  };
}

export interface FocusForTwinOutcome {
  skipped: boolean;
  /** 'no-new-substance' | 'twin-not-loaded' | <engine-skip-reason> */
  reason?: string;
  created?: boolean;
  snapshotId?: string;
}

export class FocusLoopService {
  private intervalId: NodeJS.Timeout | null = null;
  private logger: FastifyBaseLogger | null = null;
  private readonly intervalMs: number;
  private readonly trigger: (handle: string) => Promise<FocusResult | null>;
  private readonly nudgeTrigger: (
    handle: string,
  ) => Promise<ProactiveNudgeResult | null>;

  constructor(private deps: FocusLoopDeps) {
    const envHours = Number(process.env.FOCUS_LOOP_INTERVAL_HOURS);
    const hours =
      deps.intervalHours ??
      (Number.isFinite(envHours) && envHours > 0 ? envHours : DEFAULT_INTERVAL_HOURS);
    this.intervalMs = hours * 60 * 60 * 1000;
    this.trigger =
      deps.triggerFocus ??
      (async (handle) => {
        const twin = this.deps.registry.getByHandle(handle);
        if (!twin) return null; // Race: Twin zwischen list() und Trigger entfernt
        return twin.focusEngine.deriveFocus();
      });
    this.nudgeTrigger =
      deps.triggerNudge ??
      (async (handle) => {
        const twin = this.deps.registry.getByHandle(handle);
        if (!twin) return null;
        // 2b: Sender nur durchreichen, wenn die BotRegistry da ist. Das ENV-Gate
        // selbst liest nudge() — ohne Flag bleibt der Sender ungenutzt.
        const sender = this.deps.botRegistry
          ? (twinId: string, text: string) =>
              this.deps.botRegistry!.sendToOwner(twinId, text)
          : undefined;
        return twin.proactiveNudgeService.nudge(sender);
      });
  }

  /**
   * Boot-Step (nach app.listen). OPT-IN: ohne FOCUS_LOOP_ENABLED=true wird KEIN
   * Interval gesetzt (loggt einmal „disabled"). Idempotent.
   */
  start(logger: FastifyBaseLogger): void {
    this.logger = logger;
    if (this.intervalId) {
      logger.warn("[focus-loop] start() während laufendem Loop — ignored");
      return;
    }
    if (!envEnabled(process.env.FOCUS_LOOP_ENABLED)) {
      logger.info(
        "[focus-loop] disabled (FOCUS_LOOP_ENABLED nicht true) — kein autonomer Fokus-Loop",
      );
      return;
    }
    this.intervalId = setInterval(() => {
      this.runTick().catch((err) => {
        logger.error(
          { err: err instanceof Error ? err.message : String(err) },
          "[focus-loop] tick failed",
        );
      });
    }, this.intervalMs);
    logger.info(`[focus-loop] started, interval ${this.intervalMs}ms (opt-in)`);
  }

  /** Shutdown-Step: cleart Interval. Idempotent. */
  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
      this.logger?.info("[focus-loop] stopped");
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
        await this.focusForTwin(twin);
      } catch (err) {
        this.logger?.error(
          {
            twinId: twin.twinId,
            handle: twin.handle,
            err: err instanceof Error ? err.message : String(err),
          },
          "[focus-loop] deriveFocus failed for twin",
        );
      }
      // Additiv: proaktiver Fokus-Nudge. Eigener try/catch — ein Nudge-Fehler
      // soll die Fokus-Ableitung (oben) und die anderen Twins nicht killen.
      try {
        await this.nudgeForTwin(twin);
      } catch (err) {
        this.logger?.error(
          {
            twinId: twin.twinId,
            handle: twin.handle,
            err: err instanceof Error ? err.message : String(err),
          },
          "[focus-loop] proactive-nudge failed for twin",
        );
      }
    }
  }

  /**
   * Substanz-Guard (VOR dem LLM-Call), dann Generator. Rückgabe für Tests.
   */
  async focusForTwin(twin: TwinSummary): Promise<FocusForTwinOutcome> {
    // Token-Bremse: kein lastFocusTs (noch nie abgeleitet) → Guard passiert.
    const lastTs = this.lastFocusDerivedAt(twin.twinId);
    if (lastTs && !this.hasNewSubstanceSince(twin.twinId, lastTs)) {
      this.logger?.info(
        { handle: twin.handle, lastTs },
        "[focus-loop] skip — keine neue Substanz seit letztem Fokus",
      );
      return { skipped: true, reason: "no-new-substance" };
    }

    const result = await this.trigger(twin.handle);
    if (!result) return { skipped: true, reason: "twin-not-loaded" };
    if (!result.created) {
      this.logger?.info(
        { handle: twin.handle, reason: result.reason },
        "[focus-loop] kein Snapshot erzeugt (zu wenig Substanz)",
      );
      return { skipped: true, reason: result.reason, created: false };
    }
    this.logger?.info(
      { handle: twin.handle, snapshotId: result.snapshot?.id },
      "[focus-loop] neuer Fokus-Snapshot erzeugt",
    );
    return { skipped: false, created: true, snapshotId: result.snapshot?.id };
  }

  /**
   * Proaktiver Fokus-Nudge (additiv, nach focusForTwin). Detektion + Guards +
   * LLM + Pending stecken im ProactiveNudgeService; hier nur Trigger + Logging.
   * Rückgabe für Tests.
   */
  async nudgeForTwin(twin: TwinSummary): Promise<ProactiveNudgeResult | null> {
    const result = await this.nudgeTrigger(twin.handle);
    if (!result) return null; // Race: Twin zwischen list() und Trigger entfernt
    if (!result.created) {
      this.logger?.info(
        { handle: twin.handle, reason: result.reason },
        "[focus-loop] kein proaktiver Anstoß erzeugt",
      );
      return result;
    }
    this.logger?.info(
      { handle: twin.handle, auditId: result.auditId, thema: result.thema },
      "[focus-loop] proaktiver Fokus-Anstoß als Pending erzeugt",
    );
    return result;
  }

  // ─── Guard-Queries ──────────────────────────────────────────────────────

  /** derived_at des aktuell aktiven Snapshots (superseded_at IS NULL) oder null. */
  private lastFocusDerivedAt(twinId: string): string | null {
    const row = this.deps.db
      .prepare(
        `SELECT MAX(derived_at) AS m FROM focus_snapshots
           WHERE twin_id = ? AND superseded_at IS NULL`,
      )
      .get(twinId) as { m: string | null };
    return row.m ?? null;
  }

  /**
   * Neue Substanz seit `sinceTs`: neuer Turn/Audit ODER neue Summary — exakt die
   * Quellen, aus denen der FocusEngine ableitet (jüngste Turns + Summaries).
   * ISO-Text-Timestamps sind lexikographisch vergleichbar.
   */
  private hasNewSubstanceSince(twinId: string, sinceTs: string): boolean {
    const row = this.deps.db
      .prepare(
        `SELECT (
           EXISTS(SELECT 1 FROM audit WHERE twin_id = ? AND timestamp > ?)
           OR EXISTS(SELECT 1 FROM conversation_summaries cs
                       WHERE cs.created_at > ?
                         AND cs.conversation_id IN
                             (SELECT id FROM conversations WHERE twin_id = ?))
         ) AS hasNew`,
      )
      .get(twinId, sinceTs, sinceTs, twinId) as { hasNew: number };
    return row.hasNew === 1;
  }
}
