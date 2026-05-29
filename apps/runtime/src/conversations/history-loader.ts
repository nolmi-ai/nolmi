import type { AuditEntry, ChatMessage } from "@nolmi/shared";
import type { AuditRepository } from "../repository/types.js";
import type {
  ConversationSummariesRepo,
  ConversationSummary,
} from "./summaries-repo.js";

// ─── CONVERSATION HISTORY LOADER (Phase 3.3 Sub-Schritt C) ──────────────────
//
// Eine Datei, drei reine Helper:
//
//   - loadConversationHistory: ermittelt für eine Konversation die zugehörigen
//     Summaries + das Live-Window. Mit Summaries kommt das Live-Window via
//     Cursor (alle Audits NACH dem letzten summarized Audit, ASC). Ohne
//     Summaries: Fallback auf Hard-Cap mit `fallbackLimit`, normalisiert auf
//     ASC. Defensive Try-Catch: bei DB-Exception leerer Return + Log.
//
//   - auditsToOwnerDirectMessagesChronological: konvertiert ASC-sortierte
//     Audits in das LLM-ChatMessage-Format. Parallel-Variante zum DESC-
//     basierten Helper im TwinService (der bleibt für historische Caller).
//
//   - buildSummaryBlock: rendert die Summary-Sequenz als 6. System-Prompt-
//     Schicht. Mehrere Segmente mit Header + horizontal-rule-Trenner. Bei
//     leerem Input `null`, sodass der Caller den Block via `.filter(Boolean)`
//     rausnehmen kann.
//
// Reine Funktionen ohne TwinService-State, damit Tests direkt aufrufen können
// (test-history-with-summary.ts).

export interface ConversationHistory {
  summaries: ConversationSummary[];
  /** Live-Window-Audits in chronologischer Reihenfolge (älteste zuerst). */
  liveAuditsAsc: AuditEntry[];
}

export interface LoadHistoryDeps {
  summariesRepo: ConversationSummariesRepo;
  auditRepo: AuditRepository;
  /** Hard-Cap-Limit für den Fallback ohne Summaries (heutiger History-Loader). */
  fallbackLimit: number;
}

export async function loadConversationHistory(
  deps: LoadHistoryDeps,
  conversationId: string,
): Promise<ConversationHistory> {
  try {
    const summaries = deps.summariesRepo.listByConversation(conversationId);
    if (summaries.length > 0) {
      const cursor = summaries[summaries.length - 1]!.segmentEndAuditId;
      const live = await deps.auditRepo.listByConversationAfter(
        conversationId,
        cursor,
      );
      return { summaries, liveAuditsAsc: live };
    }
    const past = await deps.auditRepo.listByConversation(
      conversationId,
      deps.fallbackLimit,
    );
    return { summaries: [], liveAuditsAsc: past.slice().reverse() };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(
      `[history] failed to load summaries for conversation=${conversationId}: ${msg}`,
    );
    console.warn("[history] falling back to hard-cap without summaries");
    try {
      const past = await deps.auditRepo.listByConversation(
        conversationId,
        deps.fallbackLimit,
      );
      return { summaries: [], liveAuditsAsc: past.slice().reverse() };
    } catch {
      // Zweiter Failure: Hard-Cap nicht ladbar. Send läuft mit leerer
      // History weiter — besser als komplett zu kippen.
      return { summaries: [], liveAuditsAsc: [] };
    }
  }
}

/**
 * Inputs liegen schon ASC (chronologisch) vor — direkt vorwärts iterieren
 * statt zu reversen. Filtert auf executed-Audits mit String-`lastMessage` +
 * String-`reply` (Owner-Direct-Pfad). Capability-Filter macht der Caller —
 * Tool-Use-Audits z.B. kommen über den Range mit, aber haben keine
 * `lastMessage`/`reply`-Felder und werden hier still übersprungen.
 */
export function auditsToOwnerDirectMessagesChronological(
  audits: AuditEntry[],
): ChatMessage[] {
  const result: ChatMessage[] = [];
  for (const a of audits) {
    if (a.status !== "executed") continue;
    const userText =
      typeof a.input.lastMessage === "string" ? a.input.lastMessage : null;
    const reply =
      a.output && typeof a.output.reply === "string" ? a.output.reply : null;
    if (!userText || !reply) continue;
    result.push({ role: "user", content: userText });
    result.push({ role: "assistant", content: reply });
  }
  return result;
}

/**
 * Formatiert die Summary-Sequenz für den System-Prompt-Block. Mehrere
 * Segmente werden chronologisch mit Header + horizontal-rule-Trenner
 * aneinandergehängt. Bei 0 (oder ausschließlich leeren) Summaries gibt's
 * `null` zurück — Caller filtert das im `.filter(Boolean)`-Step der
 * Schichten-Konkat raus.
 *
 * Defensive: Summaries mit leerem `summaryMd` werden übersprungen, damit
 * ein Garbage-Eintrag (sollte 3.3.B-Failure-Pfad nicht passieren, aber
 * Defense-in-Depth) keinen leeren Header produziert.
 */
export function buildSummaryBlock(
  summaries: ConversationSummary[],
): string | null {
  const usable = summaries.filter((s) => s.summaryMd.trim().length > 0);
  if (usable.length === 0) return null;
  const parts = usable.map((s, i) => {
    return `**Erinnerung an frühere Konversation (Segment ${i + 1}):**\n\n${s.summaryMd.trim()}`;
  });
  return parts.join("\n\n---\n\n");
}
