import type Database from "better-sqlite3";
import type { AuditEntry } from "@nolmi/shared";
import {
  CONVERSATION_SUMMARY_BATCH_SIZE,
  CONVERSATION_SUMMARY_THRESHOLD,
} from "../config.js";
import type { ConversationSummariesRepo } from "./summaries-repo.js";

// ─── SUMMARY-ENGINE (Phase 3.3 Sub-Schritt B) ───────────────────────────────
//
// Sliding-Window-Memory: wenn eine Konversation mehr "zählende" Messages
// (User-Sends + Twin-Replies) als CONVERSATION_SUMMARY_THRESHOLD ansammelt,
// werden die ältesten CONVERSATION_SUMMARY_BATCH_SIZE zu einer Markdown-
// Summary verdichtet und in `conversation_summaries` persistiert. Mehrere
// Summary-Segmente pro Konversation sind erlaubt; jeder Sub-Schritt wird
// chronologisch hinten angehängt.
//
// Zählung: nur respond_to_chat (User-Sends, Phase-1-Pfad) und owner-direct
// (Twin-Replies, Direct-Chat) gehen gegen die Schwelle. Tool-Use-Audits,
// System-Messages etc. werden nicht gezählt — sie dürfen aber im Audit-Range
// einer Summary mit drin sein, damit der Kontext lückenlos bleibt.
//
// Range-Cursor: pro Konversation merken wir uns über die jüngste existierende
// Summary, wo das letzte verdichtete Segment endete (`segment_end_audit_id`
// → Timestamp dieses Audits). Alle neueren Audits sind "noch nicht
// summarized" und werden für Threshold + nächstes Segment ausgewertet.
//
// LLM-Provider: über eine injizierbare `summarize`-Funktion abstrahiert.
// Production-Pfad wrappt `generateText` aus dem AI SDK; Tests übergeben einen
// Mock, sodass keine echten Provider-Calls passieren.
//
// Failure-Verhalten: bei Throw in `summarize` oder anderem Fehler im Pfad
// loggen wir den Reason und returnen `null`. Caller (TwinService) fährt
// unverändert mit dem heutigen Hard-Cap-Verhalten weiter — User merkt nichts.

/**
 * Audit-Capabilities, die als "zählende Messages" für den Summary-Threshold
 * gelten. respond_to_chat ist der Phase-1-Pfad (User-Sends pre-Owner-Direct),
 * owner-direct ist der heutige Direct-Chat-Pfad. Andere Capabilities (Tool-
 * Use, System-Messages, Bridge-Send/Receive) zählen NICHT, sind aber Teil
 * des Audit-Range, den der Summary abdeckt.
 */
const COUNTING_CAPABILITIES = ["respond_to_chat", "owner-direct"] as const;

/**
 * Signatur des injizierten LLM-Aufrufs. Production wickelt das mit
 * `generateText({ model, system, messages: [{role:'user', content:user}] })`
 * ein; Tests reichen eine Mock-Funktion durch.
 */
export type SummaryGenerator = (
  system: string,
  user: string,
) => Promise<{ text: string }>;

export interface SummaryEngineDeps {
  /** DB-Connection für SQL-Counts, die das AuditRepository-Interface
   *  bewusst nicht abbildet (countByConversation mit Capability-Filter). */
  db: Database.Database;
  summariesRepo: ConversationSummariesRepo;
  summarize: SummaryGenerator;
}

export interface GenerateSummaryContext {
  /** Display-Name des Twins für die Prompt-Personalisierung (3. Person). */
  twinName: string;
  /** Partner-Handle (z.B. "@markus" für Direct-Chat oder Twin-Bridge-Counterpart). */
  partnerHandle: string;
}

export interface GenerateSummaryResult {
  summaryId: string;
  segmentStartAuditId: string;
  segmentEndAuditId: string;
  segmentMessageCount: number;
  summaryWordCount: number;
}

export class SummaryEngine {
  constructor(private deps: SummaryEngineDeps) {}

  /**
   * Prüft, ob für die Konversation ein neuer Summary fällig ist. Zählt nur
   * "zählende" Audits seit dem letzten Summary-Ende. Returns false, wenn
   * conversationId leer ist oder noch keine Konversation existiert.
   */
  async shouldSummarize(conversationId: string | null): Promise<boolean> {
    if (!conversationId) return false;
    const pending = this.countPendingMessages(conversationId);
    return pending > CONVERSATION_SUMMARY_THRESHOLD;
  }

  /**
   * Holt die nächste Batch noch-nicht-summarized Audits, bittet das LLM um
   * eine Verdichtung und persistiert das Ergebnis. Returns Result-Objekt bei
   * Erfolg, `null` bei Failure (Caller darf weitermachen).
   *
   * Range-Markierung: segment_start/end_audit_id sind die IDs des ersten/
   * letzten "zählenden" Audits des Batches. Damit liegt die Cursor-Linie für
   * den nächsten Lauf eindeutig fest. Audits dazwischen (Tool-Use etc.)
   * werden im Prompt eingebaut, aber der Range-Cursor folgt den zählenden.
   */
  async generateSummary(
    conversationId: string,
    context: GenerateSummaryContext,
  ): Promise<GenerateSummaryResult | null> {
    const cursor = this.cursorTimestampFor(conversationId);

    // 1. Nächste BATCH_SIZE zählenden Audits — chronologisch aufsteigend.
    const counting = this.fetchCountingAudits(
      conversationId,
      cursor,
      CONVERSATION_SUMMARY_BATCH_SIZE,
    );
    if (counting.length === 0) {
      console.warn(
        `[summary] generateSummary: keine zählenden Audits für conversation=${conversationId} — nichts zu tun`,
      );
      return null;
    }
    const firstAudit = counting[0]!;
    const lastAudit = counting[counting.length - 1]!;

    // 2. Vollen Audit-Range laden (inklusive Tool-Use o.ä. dazwischen) —
    // semantischer Kontext für die LLM-Verdichtung.
    const fullRange = this.fetchAuditsInTimestampRange(
      conversationId,
      firstAudit.timestamp,
      lastAudit.timestamp,
    );

    // 3. Prompt bauen + LLM-Call. Failure-Pfad: Reason loggen, null zurück.
    const system = buildSummarySystemPrompt(context);
    const userPrompt = buildSummaryUserPrompt(fullRange);
    let text: string;
    try {
      const out = await this.deps.summarize(system, userPrompt);
      text = (out.text ?? "").trim();
      if (text.length === 0) {
        throw new Error("LLM returned empty summary text");
      }
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      console.error(
        `[summary] generation failed for conversation=${conversationId}: ${reason}`,
      );
      console.warn(
        `[summary] falling back to hard-cap (no summary) for conversation=${conversationId}`,
      );
      return null;
    }

    // 4. Persistieren. segment_message_count bezieht sich auf die ZÄHLENDEN
    // Messages — Tool-Use-Audits werden nicht mitgezählt, damit der Threshold-
    // Math und die Counter-Semantik konsistent bleiben.
    const inserted = this.deps.summariesRepo.insert({
      conversationId,
      segmentStartAuditId: firstAudit.id,
      segmentEndAuditId: lastAudit.id,
      segmentMessageCount: counting.length,
      summaryMd: text,
    });

    const wordCount = countWords(text);
    console.log(
      `[summary] generated summary=${inserted.id} (conversation=${conversationId}, ` +
        `range: ${firstAudit.id} → ${lastAudit.id}, ${counting.length} messages → ${wordCount} words)`,
    );

    return {
      summaryId: inserted.id,
      segmentStartAuditId: firstAudit.id,
      segmentEndAuditId: lastAudit.id,
      segmentMessageCount: counting.length,
      summaryWordCount: wordCount,
    };
  }

  // ─── intern ──────────────────────────────────────────────────────────────

  /**
   * Zählt zählende Audits in der Konversation, die nach dem letzten Summary-
   * Cursor liegen. Cursor null → ab dem Anfang zählen.
   */
  private countPendingMessages(conversationId: string): number {
    const cursor = this.cursorTimestampFor(conversationId);
    const placeholders = COUNTING_CAPABILITIES.map(() => "?").join(",");
    const sql = cursor
      ? `SELECT COUNT(*) AS c FROM audit
           WHERE conversation_id = ?
             AND capability IN (${placeholders})
             AND status = 'executed'
             AND timestamp > ?`
      : `SELECT COUNT(*) AS c FROM audit
           WHERE conversation_id = ?
             AND capability IN (${placeholders})
             AND status = 'executed'`;
    const params: unknown[] = cursor
      ? [conversationId, ...COUNTING_CAPABILITIES, cursor]
      : [conversationId, ...COUNTING_CAPABILITIES];
    const row = this.deps.db.prepare(sql).get(...params) as { c: number };
    return row.c;
  }

  /**
   * Cursor = Timestamp des `segment_end_audit_id`s der jüngsten Summary für
   * die Konversation. null, wenn noch keine Summary existiert.
   *
   * Wir nutzen Timestamp statt Audit-ID-Ordering, weil Audit-IDs nanoid-basiert
   * sind und keine garantierte Sortier-Reihenfolge haben — Timestamp ist die
   * verlässliche Chronologie.
   */
  private cursorTimestampFor(conversationId: string): string | null {
    const summaries = this.deps.summariesRepo.listByConversation(conversationId);
    if (summaries.length === 0) return null;
    // listByConversation sortiert ASC nach segment_start_audit_id + created_at.
    // Die letzte Row hat den jüngsten Cursor.
    const last = summaries[summaries.length - 1]!;
    const row = this.deps.db
      .prepare("SELECT timestamp FROM audit WHERE id = ?")
      .get(last.segmentEndAuditId) as { timestamp: string } | undefined;
    return row?.timestamp ?? null;
  }

  /**
   * Lädt die nächsten `limit` zählenden Audits nach dem Cursor. ASC nach
   * Timestamp — damit ist `[0]` der älteste, `[length-1]` der jüngste.
   */
  private fetchCountingAudits(
    conversationId: string,
    cursor: string | null,
    limit: number,
  ): AuditEntry[] {
    const placeholders = COUNTING_CAPABILITIES.map(() => "?").join(",");
    const sql = cursor
      ? `SELECT data, read_at, conversation_id FROM audit
           WHERE conversation_id = ?
             AND capability IN (${placeholders})
             AND status = 'executed'
             AND timestamp > ?
           ORDER BY timestamp ASC
           LIMIT ?`
      : `SELECT data, read_at, conversation_id FROM audit
           WHERE conversation_id = ?
             AND capability IN (${placeholders})
             AND status = 'executed'
           ORDER BY timestamp ASC
           LIMIT ?`;
    const params: unknown[] = cursor
      ? [conversationId, ...COUNTING_CAPABILITIES, cursor, limit]
      : [conversationId, ...COUNTING_CAPABILITIES, limit];
    const rows = this.deps.db.prepare(sql).all(...params) as AuditRowSubset[];
    return rows.map(rowToAuditEntry);
  }

  /**
   * Lädt alle Audits einer Konversation im Timestamp-Bereich [start, end] —
   * sortiert ASC. Capability-egal, damit Tool-Use-Audits und andere
   * Zwischenstände im Prompt-Kontext mit landen.
   */
  private fetchAuditsInTimestampRange(
    conversationId: string,
    startTs: string,
    endTs: string,
  ): AuditEntry[] {
    const rows = this.deps.db
      .prepare(
        `SELECT data, read_at, conversation_id FROM audit
           WHERE conversation_id = ?
             AND timestamp >= ?
             AND timestamp <= ?
           ORDER BY timestamp ASC`,
      )
      .all(conversationId, startTs, endTs) as AuditRowSubset[];
    return rows.map(rowToAuditEntry);
  }
}

// ─── Prompt-Templates ───────────────────────────────────────────────────────

function buildSummarySystemPrompt(ctx: GenerateSummaryContext): string {
  return `Du fasst einen Konversations-Block aus der Perspektive von ${ctx.twinName} zusammen.

Behalte:
- Konkrete Fakten, Namen, Daten, Zahlen, Orte
- Entscheidungen, Zusagen, Vereinbarungen
- Emotionale Wendepunkte oder wichtige Stimmungen
- Offene Fragen oder ungelöste Themen
- Tool-Aufrufe und deren Ergebnisse (falls relevant)

Lass weg:
- Smalltalk ohne Substanz
- Wiederholungen
- Höflichkeitsfloskeln

Stil: Erzählton in dritter Person ("${ctx.twinName} erwähnte...", "${ctx.partnerHandle} fragte..."). Maximal 300 Wörter. Markdown für Struktur erlaubt.

Antworte NUR mit der Zusammenfassung, ohne Vorrede oder Meta-Kommentar.`;
}

function buildSummaryUserPrompt(auditRange: AuditEntry[]): string {
  const lines: string[] = ["Konversations-Block (chronologisch):", ""];
  for (const audit of auditRange) {
    const formatted = formatAuditForPrompt(audit);
    if (formatted) lines.push(formatted, "");
  }
  return lines.join("\n").trimEnd();
}

/**
 * Bringt einen Audit-Eintrag in eine prompt-freundliche Form:
 *   - respond_to_chat / owner-direct: [user] ... \n [assistant] ...
 *   - mcp-tool-use:                   [tool-use] mcp_xxx mit Args {...} → Result: ...
 *   - andere Capabilities:            werden geskippt (Audit-Trail-Rauschen)
 *
 * Defensive: fehlende Felder werden mit Platzhaltern gefüllt, statt dass
 * der Prompt-Builder crasht.
 */
function formatAuditForPrompt(audit: AuditEntry): string | null {
  if (
    audit.capability === "respond_to_chat" ||
    audit.capability === "owner-direct"
  ) {
    const input = audit.input as { lastMessage?: string };
    const output = (audit.output ?? null) as { reply?: string } | null;
    const userText = input.lastMessage ?? "";
    const replyText = output?.reply ?? "";
    if (!userText && !replyText) return null;
    const parts: string[] = [];
    if (userText) parts.push(`[user] ${userText}`);
    if (replyText) parts.push(`[assistant] ${replyText}`);
    return parts.join("\n");
  }
  if (audit.capability === "mcp-tool-use") {
    const input = audit.input as {
      toolCall?: { mcpToolName?: string; args?: Record<string, unknown> };
    };
    const output = (audit.output ?? null) as { toolResult?: unknown } | null;
    const toolName = input.toolCall?.mcpToolName ?? "<unknown>";
    let argsStr = "{}";
    try {
      argsStr = JSON.stringify(input.toolCall?.args ?? {});
    } catch {
      /* ignore */
    }
    let resultStr = "(no result)";
    if (output?.toolResult !== undefined && output.toolResult !== null) {
      try {
        resultStr = JSON.stringify(output.toolResult).slice(0, 500);
      } catch {
        resultStr = String(output.toolResult).slice(0, 500);
      }
    }
    return `[tool-use] ${toolName} mit Args ${argsStr} → Result: ${resultStr}`;
  }
  return null;
}

function countWords(text: string): number {
  return text.split(/\s+/).filter((s) => s.length > 0).length;
}

// ─── DB-Helpers (lokal — wir vermeiden Duplikation mit AuditRepository) ──────

interface AuditRowSubset {
  data: string;
  read_at: string | null;
  conversation_id: string | null;
}

function rowToAuditEntry(row: AuditRowSubset): AuditEntry {
  const parsed = JSON.parse(row.data) as AuditEntry;
  // read_at + conversation_id liegen als eigene Spalten, das `data`-JSON ist
  // die alte Source-of-Truth — wir mergen wie die SQLite-Repo-Implementierung.
  return {
    ...parsed,
    readAt: row.read_at,
    conversationId: row.conversation_id,
  };
}
