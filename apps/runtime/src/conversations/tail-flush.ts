import type { ConversationsRepo } from "./repo.js";
import type { ConversationSummariesRepo } from "./summaries-repo.js";
import type { SummaryEngine, GenerateSummaryContext } from "./summary-engine.js";
import type { MemoryEmbeddingService } from "../episodic/memory-embedding-service.js";
import { isTailFlushAutonomousEnabled } from "../config.js";

// ─── TAIL-FLUSH-PRIMITIVE (Verdichtung, Sub-Step 2/6) ────────────────────────
//
// Schließt die L3-Lücke (docs/TAIL-FLUSH-VERDICHTUNG-STRATEGY.md): eine bereits
// summarisierte Konversation hat oft einen unsummarisierten Tail (Turns nach
// dem letzten Segment-Cursor, unter der Summary-Schwelle), der beim Konv-Ende
// durch alle Embed-Pfade fällt (resetConversation überspringt bei summaries>0;
// Whole-Conv-Embed würde bei ~512 Tokens trunkieren). Diese Primitive verdichtet
// genau diesen Tail in finale Segmente + Embeddings.
//
// REIN die Primitive — KEIN Aufrufer (resetConversation-Hook = Sub-Step 3,
// Loop-Verarbeiter = Sub-Step 4). Hier nur die gekapselte, idempotente Funktion.
//
// GARANTIEN (Smoke-Gate 0, cursor-belegt):
//   - Disjunkt: generateSummary leitet den Range aus dem Cursor ab (Turns nach
//     dem segment_end der jüngsten Summary) → kein Überlapp mit bestehenden
//     Segmenten.
//   - Idempotent: nach vollem Flush ist countPendingTurns===0 → zweiter Lauf
//     ist No-op (kein Segment, kein Embed, kein LLM-Call).
//   - SCHLEIFE: THRESHOLD(50) > BATCH(40) → ein Tail kann > BATCH sein →
//     generateSummary wird wiederholt gerufen, bis der Tail leer ist. Terminiert
//     (Cursor wächst monoton, Tail −≤BATCH pro Runde); MAX_FLUSH_ITERATIONS als
//     defensiver Backstop.

/** Defensiver Backstop gegen Endlosschleife — greift bei monotonem Cursor nie. */
const MAX_FLUSH_ITERATIONS = 50;

/**
 * Auslöser-Kontext. 'manual' = owner-/CLI-getriggert (immer erlaubt). 'autonomous'
 * = G2-Reset-Hook / Loop-Verarbeiter (nur bei TAIL_FLUSH_AUTONOMOUS_ENABLED).
 */
export type TailFlushTrigger = "manual" | "autonomous";

/** Callback-Form für den pending-Verarbeiter (MemoryMaintenanceService). */
export type TailFlushCallback = (
  conversationId: string,
  trigger: TailFlushTrigger,
) => Promise<TailFlushResult>;

export interface TailFlushDeps {
  summaryEngine: SummaryEngine;
  memoryEmbeddingService: MemoryEmbeddingService;
  conversationsRepo: ConversationsRepo;
  conversationSummariesRepo: ConversationSummariesRepo;
  twinId: string;
}

export interface TailFlushResult {
  /** Anzahl erzeugter + embeddeter Tail-Segmente. */
  flushed: number;
  /** Tail-Größe (zählende Turns) vor dem Flush. */
  pendingBefore: number;
  /**
   * 'gated'  = autonomous + Flag AUS → nichts getan, Konv bleibt pending (wartet
   *            auf Scharfschalten). KEIN DB-Write, kein LLM-Call.
   * 'noop'   = kein Segment (Whole-Embed-Pfad) ODER kein Tail (Konv ist voll
   *            abgedeckt → embedding_status='done' gesetzt zwecks Konvergenz).
   * 'done'   = Tail vollständig verdichtet, Konv embedding_status='done'.
   * 'failed' = generateSummary/Embed scheiterte; Tail bleibt für nächsten Lauf.
   */
  status: "gated" | "noop" | "done" | "failed";
}

/**
 * Verdichtet den unsummarisierten Tail einer Konversation in finale Segmente +
 * Embeddings. Schleifenbasiert bis Tail=0, idempotent, kosten-gegated.
 *
 * Scope: NUR Konv MIT ≥1 bestehendem Segment (summarisierte Konv mit Rest).
 * Konv OHNE Segment → No-op (die gehören in den Whole-Embed-Pfad von
 * resetConversation, `summaries===0`) — so ist die Primitive gefahrlos auf jede
 * Konv aufrufbar. Wirft NIE nach außen (der spätere Verarbeiter darf nicht
 * crashen); Fehler werden geloggt + die Konv 'failed' markiert.
 */
export async function flushConversationTail(
  deps: TailFlushDeps,
  conversationId: string,
  context: GenerateSummaryContext,
  trigger: TailFlushTrigger = "manual",
): Promise<TailFlushResult> {
  // Autonomous-Gate: G2-Reset / Loop nur bei TAIL_FLUSH_AUTONOMOUS_ENABLED.
  // Default AUS → sofort raus, KEIN DB-Write, kein LLM-Call, Konv bleibt pending
  // (wird geflusht, sobald scharfgeschaltet). 'manual' ignoriert das Gate.
  if (trigger === "autonomous" && !isTailFlushAutonomousEnabled()) {
    return { flushed: 0, pendingBefore: 0, status: "gated" };
  }

  // Scope-Gate: keine Segmente → nicht unser Job (Whole-Embed-Pfad). No-op,
  // kein Status-Touch (eine segment-lose Konv gehört in resetConversation
  // `summaries===0`).
  const existingSegments =
    deps.conversationSummariesRepo.count(conversationId);
  if (existingSegments === 0) {
    return { flushed: 0, pendingBefore: 0, status: "noop" };
  }

  // Kosten-Gate: kein Tail → kein LLM-Call. Aber: die Konv ist voll durch
  // Segmente abgedeckt → embedding_status='done' zwecks Pending-Konvergenz
  // (sonst greift der Verarbeiter sie endlos wieder auf).
  const pendingBefore = deps.summaryEngine.countPendingTurns(conversationId);
  if (pendingBefore === 0) {
    deps.conversationsRepo.updateEmbeddingStatus(conversationId, "done");
    return { flushed: 0, pendingBefore: 0, status: "noop" };
  }

  let flushed = 0;
  let iterations = 0;
  while (deps.summaryEngine.countPendingTurns(conversationId) > 0) {
    if (iterations >= MAX_FLUSH_ITERATIONS) {
      console.error(
        `[tail-flush] iteration-cap (${MAX_FLUSH_ITERATIONS}) erreicht conv=${conversationId} — Tail nicht geleert, Abbruch`,
      );
      deps.conversationsRepo.updateEmbeddingStatus(conversationId, "failed");
      return { flushed, pendingBefore, status: "failed" };
    }
    iterations += 1;

    let segment;
    try {
      // generateSummary verdichtet das nächste Batch nach dem Cursor (schwellen-
      // agnostisch) + schiebt den Cursor implizit vor (neues segment_end).
      segment = await deps.summaryEngine.generateSummary(conversationId, context);
    } catch (err) {
      // generateSummary schluckt LLM-Fehler selbst (→null); ein Throw hier ist
      // unerwartet (DB/Repo). Nicht crashen — failed markieren, Tail bleibt.
      const reason = err instanceof Error ? err.message : String(err);
      console.error(
        `[tail-flush] generateSummary warf conv=${conversationId}: ${reason}`,
      );
      deps.conversationsRepo.updateEmbeddingStatus(conversationId, "failed");
      return { flushed, pendingBefore, status: "failed" };
    }

    if (!segment) {
      // null = LLM-Verdichtung scheiterte (oder unerwartet leer). Abbruch — der
      // Tail (Cursor unverändert) wird beim nächsten Verarbeiter-Lauf retried.
      console.warn(
        `[tail-flush] generateSummary lieferte null conv=${conversationId} — Abbruch, Tail bleibt für nächsten Lauf`,
      );
      deps.conversationsRepo.updateEmbeddingStatus(conversationId, "failed");
      return { flushed, pendingBefore, status: "failed" };
    }

    // Frisches Segment embedden. embedSummarySegment schluckt eigene Provider-
    // Fehler (→ Segment-Status 'failed', kein Throw). Das Segment EXISTIERT in
    // jedem Fall (generateSummary hat es persistiert) → Cursor ist vorgerückt →
    // die Schleife terminiert auch bei Embed-Fehler.
    await deps.memoryEmbeddingService.embedSummarySegment({
      twinId: deps.twinId,
      segmentId: segment.summaryId,
      content: segment.summaryMd,
    });
    flushed += 1;
  }

  // Tail vollständig segmentiert → Konv-Level auf 'done' (kein erneutes
  // Aufgreifen durch den pending-Verarbeiter). Etwaige Segment-Level-Embed-
  // Fehler sind separat über die segment-eigene embedding_status retrybar.
  deps.conversationsRepo.updateEmbeddingStatus(conversationId, "done");
  console.log(
    `[tail-flush] conv=${conversationId} Tail verdichtet: ${flushed} Segment(e) (Tail vorher ${pendingBefore} Turns)`,
  );
  return { flushed, pendingBefore, status: "done" };
}
