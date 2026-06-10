import type { FastifyBaseLogger } from "fastify";
import type Database from "better-sqlite3";
import type { TwinServiceRegistry, TwinSummary } from "../twin-service-registry.js";
import { REFLECTION_CAPABILITY, type ReflectionResult } from "./reflection-engine.js";
import { REFLECTION_NUDGE_CAPABILITY } from "../focus/proactive-nudge-service.js";
import { FACT_COHERENCE_FIX_CAPABILITY } from "../facts/repo.js";
import type { CoherenceReviewResult } from "../facts/coherence-engine.js";

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
//   - 'self'-Modus: Pending (Leitplanke, unverändert).
//   - Wow-Strang 2 SS3: ZUSÄTZLICH der owner-Reflexions-EINWURF — der Twin
//     äußert eine Beobachtung über Markus an dessen Telegram. ÄUSSERN≠SPEICHERN:
//     der Pfad ruft NIE approveSelfReflectionWrite (generate-only, kein Pending/
//     Diary über die Reflexion selbst), nur emitReflectionNudge (Push status=sent
//     bzw. Pending, je REFLECTION_NUDGE_AUTOSEND_ENABLED). Eigene Capability
//     (reflection-nudge) + eigener Substanz-Cursor (lastOwnerNudgeTs) → self und
//     owner stören sich NICHT.
//   - OPT-IN: Default AUS. Ohne REFLECTION_LOOP_ENABLED=true tut start() nichts.
//   - Dedup VOR jedem LLM-Call (0 Token-Kosten bei Skip):
//       self:  Guard A (max 1 offenes self-reflection-write-Pending) + Guard B
//              (neue Substanz seit lastReflectionTs).
//       owner: Guard A (max 1 offenes reflection-nudge-Pending) + Episode-
//              Cooldown (nicht öfter als 1× pro N Stunden) + Guard B (neue
//              Substanz seit lastOwnerNudgeTs) — alles vor dem teuren Opus-Call.
//   - Multi-Tenant: iteriert über registry.list() (in-process entschlüsselte
//     LLM-Clients; gelöschte Twins sind via removeTwin/#744 raus); per-Twin
//     try/catch isoliert Fehler (kaputter Key killt nicht die anderen).

const DEFAULT_INTERVAL_HOURS = 24;
/**
 * Wow-Strang 2 SS3: Episode-Cooldown für den owner-Reflexions-Einwurf — nicht
 * öfter als 1× pro so vielen Stunden, gegen Wiederholung derselben Beobachtung
 * (der Twin erzeugt konsistent ähnliche Inferenzen). 168 = 7 Tage. Env-Override
 * REFLECTION_NUDGE_COOLDOWN_HOURS, Test-Override über deps.ownerNudgeCooldownHours.
 */
const DEFAULT_OWNER_NUDGE_COOLDOWN_HOURS = 168;
/**
 * #94 neu (Loop-Wiring): Cooldown des Kohärenz-Reviews — seltener als self (24h),
 * gleich wie owner (168 = 7 Tage), env REFLECTION_COHERENCE_COOLDOWN_HOURS. Der
 * Review hängt an Fact-Änderungen (selten), darum eine seltene Kadenz.
 */
const DEFAULT_COHERENCE_REVIEW_COOLDOWN_HOURS = 168;

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
  /**
   * Wow-Strang 2 SS3: Owner-Push-Sender (BotRegistry.sendToOwner), wie beim
   * Fokus-Loop per-Call durchgereicht. Optional: ohne ihn läuft emitReflection-
   * Nudge ohne Push → bleibt Pending (auch bei Gate-an). Boot-Reihenfolge wie
   * der Fokus-Loop (botRegistry existiert bei der Loop-Konstruktion).
   */
  botRegistry?: {
    sendToOwner(twinId: string, text: string): Promise<{ sent: boolean; reason?: string }>;
  };
  /** Test-Override für den owner-Episode-Cooldown (Stunden). */
  ownerNudgeCooldownHours?: number;
  /**
   * Test-Hook: pro-Twin-owner-Einwurf-Trigger. Default ruft
   * `reflectGenerateOnly('owner')` → bei worthNudging `emitReflectionNudge`.
   * Tests injizieren einen Spy/Mock (Guards bleiben im Loop, vor dem Trigger).
   */
  triggerOwnerNudge?: (handle: string) => Promise<OwnerNudgeOutcome | null>;
  /** #94 neu: Test-Override für den Kohärenz-Review-Cooldown (Stunden). */
  coherenceReviewCooldownHours?: number;
  /**
   * #94 neu: Test-Hook: pro-Twin-Kohärenz-Review-Trigger. Default ruft
   * `factsCoherenceEngine.reviewAndCreatePending()`. Tests injizieren einen
   * Spy/Mock (die Kadenz-Guards bleiben im Loop, vor dem Trigger).
   */
  triggerCoherenceReview?: (handle: string) => Promise<CoherenceReviewResult | null>;
}

/** #94 neu: Ergebnis des Kohärenz-Review-Pfads (pro Twin, im Loop). */
export interface CoherenceReviewOutcome {
  skipped: boolean;
  /** 'open-pending' | 'no-fact-change' | 'cooldown' | 'twin-not-loaded' */
  reason?: string;
  /** Anzahl angelegter fact-coherence-fix-Pendings (wenn gelaufen). */
  pendingCount?: number;
}

/** Wow-Strang 2 SS3: Ergebnis des owner-Reflexions-Einwurf-Pfads (pro Twin). */
export interface OwnerNudgeOutcome {
  skipped: boolean;
  /** 'open-pending' | 'cooldown' | 'no-new-substance' | 'twin-not-loaded' | 'no-substance' | 'not-worth' */
  reason?: string;
  /** true → emitReflectionNudge wurde gerufen (Push oder Pending). */
  emitted?: boolean;
  /** true → autonom an Telegram gepusht (status=sent); false → Pending. */
  pushed?: boolean;
  auditId?: string;
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
  /** SS3: owner-Einwurf-Trigger (reflectGenerateOnly → ggf. emitReflectionNudge). */
  private readonly ownerNudgeTrigger: (
    handle: string,
  ) => Promise<OwnerNudgeOutcome | null>;
  /** SS3: owner-Episode-Cooldown in Millisekunden. */
  private readonly ownerNudgeCooldownMs: number;
  /** #94 neu: Kohärenz-Review-Trigger (reviewAndCreatePending). */
  private readonly coherenceReviewTrigger: (
    handle: string,
  ) => Promise<CoherenceReviewResult | null>;
  /** #94 neu: Kohärenz-Review-Cooldown in Millisekunden. */
  private readonly coherenceReviewCooldownMs: number;

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

    // SS3: owner-Cooldown (Test-Override > env > Default 168h).
    const envCooldown = Number(process.env.REFLECTION_NUDGE_COOLDOWN_HOURS);
    const cooldownHours =
      deps.ownerNudgeCooldownHours ??
      (Number.isFinite(envCooldown) && envCooldown > 0
        ? envCooldown
        : DEFAULT_OWNER_NUDGE_COOLDOWN_HOURS);
    this.ownerNudgeCooldownMs = cooldownHours * 60 * 60 * 1000;

    // SS3: owner-Einwurf — generate-only über Markus, dann (bei worthNudging)
    // emitReflectionNudge (das Gate REFLECTION_NUDGE_AUTOSEND_ENABLED entscheidet
    // Push vs Pending selbst — KEINE Gate-Logik hier). Die Guards (open-pending /
    // Cooldown / neue Substanz) sitzen VOR diesem Trigger in ownerNudgeForTwin.
    this.ownerNudgeTrigger =
      deps.triggerOwnerNudge ??
      (async (handle): Promise<OwnerNudgeOutcome | null> => {
        const twin = deps.registry.getByHandle(handle);
        if (!twin) return null;
        const draft = await twin.reflectionEngine.reflectGenerateOnly("owner");
        if (!draft.created) return { skipped: true, reason: "no-substance" };
        if (!draft.worthNudging) return { skipped: true, reason: "not-worth" };
        const sender = this.deps.botRegistry
          ? (twinId: string, text: string) =>
              this.deps.botRegistry!.sendToOwner(twinId, text)
          : undefined;
        const res = await twin.proactiveNudgeService.emitReflectionNudge({
          reflectionText: draft.reflectionText!,
          worthNudgingReasoning: draft.worthNudgingReasoning,
          sendToOwner: sender,
        });
        return {
          skipped: false,
          emitted: true,
          pushed: res.pushed,
          auditId: res.auditId,
        };
      });

    // #94 neu: Kohärenz-Review-Cooldown (Test-Override > env > Default 168h).
    const envCohCooldown = Number(process.env.REFLECTION_COHERENCE_COOLDOWN_HOURS);
    const cohCooldownHours =
      deps.coherenceReviewCooldownHours ??
      (Number.isFinite(envCohCooldown) && envCohCooldown > 0
        ? envCohCooldown
        : DEFAULT_COHERENCE_REVIEW_COOLDOWN_HOURS);
    this.coherenceReviewCooldownMs = cohCooldownHours * 60 * 60 * 1000;

    // #94 neu: Kohärenz-Review — die SS3-Engine (mit Dedup/Rejected-Guards INNEN)
    // frisch reviewen + Pendings anlegen. Die Kadenz-Guards (open-pending /
    // Fact-Substanz / Cooldown) sitzen VOR diesem Trigger in coherenceReviewForTwin.
    this.coherenceReviewTrigger =
      deps.triggerCoherenceReview ??
      (async (handle): Promise<CoherenceReviewResult | null> => {
        const twin = deps.registry.getByHandle(handle);
        if (!twin) return null;
        return twin.factsCoherenceEngine.reviewAndCreatePending();
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
      `[reflection-loop] started, interval ${this.intervalMs}ms (self + owner + coherence, opt-in)`,
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
      // SS3 (additiv): owner-Reflexions-Einwurf. Eigener try/catch — ein Fehler
      // (z.B. Push-Problem) darf weder den self-Pfad noch die anderen Twins
      // killen. Der self-Pfad oben bleibt unverändert.
      try {
        await this.ownerNudgeForTwin(twin);
      } catch (err) {
        this.logger?.error(
          {
            twinId: twin.twinId,
            handle: twin.handle,
            err: err instanceof Error ? err.message : String(err),
          },
          "[reflection-loop] owner-reflection-nudge failed for twin",
        );
      }
      // #94 neu (additiv): Kohärenz-Review. Eigener try/catch — ein Fehler darf
      // weder self/owner noch die anderen Twins killen. Self/owner oben unberührt.
      try {
        await this.coherenceReviewForTwin(twin);
      } catch (err) {
        this.logger?.error(
          {
            twinId: twin.twinId,
            handle: twin.handle,
            err: err instanceof Error ? err.message : String(err),
          },
          "[reflection-loop] coherence-review failed for twin",
        );
      }
    }
  }

  /**
   * #94 neu (Loop-Wiring): Facts-Kohärenz-Review pro Twin. Kadenz-Guards (alle
   * VOR dem teuren Opus-Call) → Trigger (reviewAndCreatePending; dessen
   * Inhalts-Guards Dedup/Rejected liegen IN der Engine). Eigener Cursor
   * (lastCoherenceReviewTs, Capability fact-coherence-fix) → unabhängig von
   * self/owner. KEIN Push, nur Inbox-Pendings → kein Scharf-Gate nötig.
   *
   * Guard-Reihenfolge: (c) Effizienz-Guard (offenes Pending → Inbox erst leeren,
   * spart den Call) — immer; dann, NUR wenn schon mal reviewt (lastTs gesetzt):
   * (a) Fact-Substanz (kein Review ohne Fact-Änderung seit dem letzten — der
   * genuin neue Check, NICHT hasNewSubstanceSince), (b) Cooldown. cursor=null
   * (Erstlauf) → (a)/(b) übersprungen, der erste Review darf feuern.
   */
  async coherenceReviewForTwin(twin: TwinSummary): Promise<CoherenceReviewOutcome> {
    // (c) Effizienz-Guard: schon ein offenes fact-coherence-fix-Pending → ganzen
    // Review skippen (Inbox erst abarbeiten). Grob auf Loop-Ebene; die Engine
    // hat zusätzlich einen feinen per-factKey-Dedup.
    if (this.hasOpenCoherenceFix(twin.twinId)) {
      this.logger?.info(
        { handle: twin.handle },
        "[reflection-loop] coherence skip — offenes fact-coherence-fix-Pending",
      );
      return { skipped: true, reason: "open-pending" };
    }

    const lastTs = this.lastCoherenceReviewTs(twin.twinId);
    if (lastTs) {
      // (a) Fact-Substanz: nur reviewen, wenn sich Facts seit dem letzten Review
      // GEÄNDERT haben (Insert/upsert-Wert/Approve bumpen facts.updated_at). Kein
      // Fact-Drift → nichts Neues zu prüfen, kein teurer Call.
      const factChangeTs = this.lastFactChangeTs(twin.twinId);
      if (!factChangeTs || Date.parse(factChangeTs) <= Date.parse(lastTs)) {
        this.logger?.info(
          { handle: twin.handle, lastTs },
          "[reflection-loop] coherence skip — keine Fact-Änderung seit letztem Review",
        );
        return { skipped: true, reason: "no-fact-change" };
      }
      // (b) Cooldown: nicht öfter als 1× pro N Stunden.
      if (Date.now() - Date.parse(lastTs) < this.coherenceReviewCooldownMs) {
        this.logger?.info(
          { handle: twin.handle, lastTs },
          "[reflection-loop] coherence skip — Cooldown",
        );
        return { skipped: true, reason: "cooldown" };
      }
    }

    // Guards passiert (oder Erstlauf) → der teure Pfad.
    const result = await this.coherenceReviewTrigger(twin.handle);
    if (!result) return { skipped: true, reason: "twin-not-loaded" };
    this.logger?.info(
      {
        handle: twin.handle,
        pendings: result.pendingAuditIds.length,
        skipped: result.skipped.length,
      },
      "[reflection-loop] Kohärenz-Review gelaufen",
    );
    return { skipped: false, pendingCount: result.pendingAuditIds.length };
  }

  /**
   * Wow-Strang 2 SS3: owner-Reflexions-Einwurf pro Twin. Guards (alle VOR dem
   * teuren Opus-Call) → Trigger (reflectGenerateOnly owner → ggf.
   * emitReflectionNudge). Eigener Substanz-Cursor (lastOwnerNudgeTs, Capability
   * reflection-nudge) → unabhängig vom self-Pfad. Rückgabe für Tests.
   */
  async ownerNudgeForTwin(twin: TwinSummary): Promise<OwnerNudgeOutcome> {
    // Guard A — kein offenes reflection-nudge-Pending (kein Inbox-Stapeln in der
    // Gate-AUS-Erprobungsphase: ein offener Einwurf reicht).
    if (this.hasOpenReflectionNudge(twin.twinId)) {
      this.logger?.info(
        { handle: twin.handle },
        "[reflection-loop] owner skip — offenes reflection-nudge-Pending",
      );
      return { skipped: true, reason: "open-pending" };
    }

    const lastTs = this.lastOwnerNudgeTs(twin.twinId);
    if (lastTs) {
      // Episode-Cooldown: nicht öfter als 1× pro N Stunden — schützt gegen das
      // wiederholte Pushen derselben (konsistent erzeugten) Beobachtung.
      if (Date.now() - Date.parse(lastTs) < this.ownerNudgeCooldownMs) {
        this.logger?.info(
          { handle: twin.handle, lastTs },
          "[reflection-loop] owner skip — Episode-Cooldown",
        );
        return { skipped: true, reason: "cooldown" };
      }
      // Substanz-Guard: kein teurer Opus-Call ohne neues Korpus seit dem letzten
      // owner-Einwurf. (hasNewSubstanceSince ist korpus-basiert, subject-neutral.)
      if (!this.hasNewSubstanceSince(twin.twinId, lastTs)) {
        this.logger?.info(
          { handle: twin.handle, lastTs },
          "[reflection-loop] owner skip — keine neue Substanz seit letztem Einwurf",
        );
        return { skipped: true, reason: "no-new-substance" };
      }
    }

    // Guards passiert → teurer Pfad (reflectGenerateOnly owner + ggf. emit).
    const outcome = await this.ownerNudgeTrigger(twin.handle);
    if (!outcome) return { skipped: true, reason: "twin-not-loaded" };
    if (outcome.emitted) {
      this.logger?.info(
        { handle: twin.handle, pushed: outcome.pushed, auditId: outcome.auditId },
        "[reflection-loop] owner-Reflexions-Einwurf erzeugt",
      );
    }
    return outcome;
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
   * SS3: offenes reflection-nudge-Pending? EIGENE Capability (reflection-nudge),
   * getrennt vom self-Pfad (self-reflection-write) → self + owner stören sich nicht.
   */
  private hasOpenReflectionNudge(twinId: string): boolean {
    const row = this.deps.db
      .prepare(
        `SELECT COUNT(*) AS c FROM audit
           WHERE twin_id = ? AND capability = ? AND status = 'pending'`,
      )
      .get(twinId, REFLECTION_NUDGE_CAPABILITY) as { c: number };
    return row.c > 0;
  }

  /**
   * SS3: Zeitstempel des letzten owner-Einwurfs (reflection-nudge, sent ODER
   * pending) — der EIGENE Substanz-/Cooldown-Cursor des owner-Pfads. Der
   * generate-only-Pfad erzeugt KEIN self-reflection-write-Audit, daher kann der
   * self-Cursor (lastReflectionTs) hier nicht greifen — dieser ist getrennt.
   */
  private lastOwnerNudgeTs(twinId: string): string | null {
    const row = this.deps.db
      .prepare(
        `SELECT MAX(timestamp) AS m FROM audit
           WHERE twin_id = ? AND capability = ?`,
      )
      .get(twinId, REFLECTION_NUDGE_CAPABILITY) as { m: string | null };
    return row.m ?? null;
  }

  /** #94 neu: offenes fact-coherence-fix-Pending? (grober Loop-Effizienz-Guard). */
  private hasOpenCoherenceFix(twinId: string): boolean {
    const row = this.deps.db
      .prepare(
        `SELECT COUNT(*) AS c FROM audit
           WHERE twin_id = ? AND capability = ? AND status = 'pending'`,
      )
      .get(twinId, FACT_COHERENCE_FIX_CAPABILITY) as { c: number };
    return row.c > 0;
  }

  /**
   * #94 neu: Zeitstempel des letzten Kohärenz-Review-Vorschlags (fact-coherence-
   * fix, jeder Status) — der EIGENE Cursor des Review-Pfads (getrennt von self/
   * owner). null = noch nie ein Vorschlag → Erstlauf erlaubt.
   */
  private lastCoherenceReviewTs(twinId: string): string | null {
    const row = this.deps.db
      .prepare(
        `SELECT MAX(timestamp) AS m FROM audit
           WHERE twin_id = ? AND capability = ?`,
      )
      .get(twinId, FACT_COHERENCE_FIX_CAPABILITY) as { m: string | null };
    return row.m ?? null;
  }

  /**
   * #94 neu: der genuin neue Substanz-Check — wann wurde zuletzt ein Fact
   * geändert (Insert/upsert-Wert/Approve bumpen updated_at; Delete entfernt die
   * Row, aber ein Delete erzeugt keinen Widerspruch → korrekt verfehlt). Direkt
   * auf der facts-Tabelle (twin_id indiziert), wie hasNewSubstanceSince. NICHT
   * hasNewSubstanceSince wiederverwenden (das misst Gesprächs-Korpus + nur
   * created_at, verfehlt Wert-Änderungen). null = (theoretisch) keine Facts.
   */
  private lastFactChangeTs(twinId: string): string | null {
    const row = this.deps.db
      .prepare(`SELECT MAX(updated_at) AS m FROM facts WHERE twin_id = ?`)
      .get(twinId) as { m: string | null };
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
