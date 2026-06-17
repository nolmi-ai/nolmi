import type { FastifyBaseLogger } from "fastify";
import type { TwinServiceRegistry } from "../twin-service-registry.js";

// ─── A2A CLOSE SWEEP SERVICE (Glied 2 Etappe 3) ──────────────────────────────
//
// Periodischer Sweep, der abgeschlossene A2A-Threads erkennt und die
// Zusammenfassung an den Owner zustellt. Lifecycle 1:1 nach FocusLoopService:
// konstruieren (nach Registry + BotRegistry) → start(logger) nach app.listen →
// stop() im Shutdown.
//
// ── Warum ein Sweep (statt synchroner Trigger)? ──
// Limit/Abbruch erzeugen die a2a-summary schon synchron in receiveBridgeMessage.
// Ein Thread kann aber auch einfach VERSTUMMEN (Einigung, eine Seite hört auf) —
// dafür gibt es kein synchrones Signal. Der Sweep schließt die Lücke
// trigger-agnostisch: „seit X min keine neue Nachricht im a2aThreadId →
// abgeschlossen". Damit ist er zugleich die EINZIGE Zustellstelle (SS-B/SS-C):
// er liefert jede noch-nicht-zugestellte Summary, egal aus welchem Grund sie
// entstand.
//
// ── OPT-IN, DEFAULT AUS ──
// Ohne A2A_CLOSE_SWEEP_ENABLED=true tut start() nichts (loggt einmal „disabled").

const DEFAULT_INTERVAL_SEC = 60;
const DEFAULT_QUIESCENCE_MIN = 5;

/** Minimaler Bool-ENV-Parse (analog focus-loop-service). */
function envEnabled(raw: string | undefined): boolean {
  const v = raw?.trim().toLowerCase();
  return v === "true" || v === "1" || v === "yes";
}

export interface A2ACloseSweepDeps {
  registry: TwinServiceRegistry;
  /**
   * Telegram-Owner-Push (BotRegistry.sendToOwner). In SS-A noch ungenutzt —
   * die Zustellung hängt SS-B daran. Durchgereicht wie bei Focus/Reflection-Loop,
   * weil die BotRegistry erst NACH der Twin-Registry konstruiert ist.
   */
  botRegistry?: {
    sendToOwner(
      twinId: string,
      text: string,
    ): Promise<{ sent: boolean; reason?: string }>;
  };
  /** Poll-Intervall in Sekunden. Default `A2A_CLOSE_SWEEP_INTERVAL_SEC` / 60. */
  intervalSec?: number;
  /** Quiescence-Schwelle in Minuten. Default `A2A_THREAD_QUIESCENCE_MIN` / 5. */
  quiescenceMin?: number;
}

export class A2ACloseSweepService {
  private intervalId: NodeJS.Timeout | null = null;
  private logger: FastifyBaseLogger | null = null;
  private readonly intervalMs: number;
  private readonly quiescenceMs: number;

  constructor(private deps: A2ACloseSweepDeps) {
    const envSec = Number(process.env.A2A_CLOSE_SWEEP_INTERVAL_SEC);
    const sec =
      deps.intervalSec ??
      (Number.isFinite(envSec) && envSec > 0 ? envSec : DEFAULT_INTERVAL_SEC);
    this.intervalMs = sec * 1000;

    const envMin = Number(process.env.A2A_THREAD_QUIESCENCE_MIN);
    const min =
      deps.quiescenceMin ??
      (Number.isFinite(envMin) && envMin > 0 ? envMin : DEFAULT_QUIESCENCE_MIN);
    this.quiescenceMs = min * 60 * 1000;
  }

  /**
   * Boot-Step (nach app.listen). OPT-IN: ohne A2A_CLOSE_SWEEP_ENABLED=true wird
   * KEIN Interval gesetzt (loggt einmal „disabled"). Idempotent.
   */
  start(logger: FastifyBaseLogger): void {
    this.logger = logger;
    if (this.intervalId) {
      logger.warn("[a2a-sweep] start() während laufendem Loop — ignored");
      return;
    }
    if (!envEnabled(process.env.A2A_CLOSE_SWEEP_ENABLED)) {
      logger.info(
        "[a2a-sweep] disabled (A2A_CLOSE_SWEEP_ENABLED nicht true) — kein Quiescence-Sweep",
      );
      return;
    }
    this.intervalId = setInterval(() => {
      this.runTick().catch((err) => {
        logger.error(
          { err: err instanceof Error ? err.message : String(err) },
          "[a2a-sweep] tick failed",
        );
      });
    }, this.intervalMs);
    logger.info(
      `[a2a-sweep] started, interval ${this.intervalMs}ms, ` +
        `quiescence ${this.quiescenceMs}ms (opt-in)`,
    );
  }

  /** Shutdown-Step: cleart Interval. Idempotent. */
  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
      this.logger?.info("[a2a-sweep] stopped");
    }
  }

  /**
   * Ein Durchlauf über alle aktiven Twins. Per-Twin try/catch: ein Fehler killt
   * nicht die anderen Twins oder den Loop. SS-A: nur Erkennung + Summary-Erzeugung
   * bei Quiescence. (SS-B/SS-C hängen die Zustellung an.)
   */
  async runTick(loggerOverride?: FastifyBaseLogger): Promise<void> {
    const prevLogger = this.logger;
    if (loggerOverride) this.logger = loggerOverride;

    try {
      for (const summary of this.deps.registry.list()) {
        const twin = this.deps.registry.getByHandle(summary.handle);
        if (!twin) continue; // Race: Twin zwischen list() und getByHandle entfernt
        try {
          const created = await twin.sweepA2aThreadClosures(this.quiescenceMs);
          if (created > 0) {
            this.logger?.info(
              { twinId: summary.twinId, handle: summary.handle, created },
              "[a2a-sweep] quiescence summaries erzeugt",
            );
          }
        } catch (err) {
          this.logger?.error(
            {
              twinId: summary.twinId,
              handle: summary.handle,
              err: err instanceof Error ? err.message : String(err),
            },
            "[a2a-sweep] sweep failed for twin",
          );
        }
      }
    } finally {
      this.logger = prevLogger;
    }
  }
}
