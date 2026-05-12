import type Database from "better-sqlite3";
import { nanoid } from "nanoid";

// ─── CONVERSATION SUMMARIES REPOSITORY (3.3.A) ──────────────────────────────
//
// Persistiert vom LLM erzeugte Markdown-Summaries für lange Konversationen.
// Jede Row deckt einen Audit-Range ab (segment_start_audit_id bis
// segment_end_audit_id, beide inklusive). Mehrere Summaries pro Konversation
// sind erlaubt — bei sehr langen Konversationen entstehen mehrere Segmente.
//
// Sub-Schritt-A liefert nur Schema + CRUD. Die Summary-Engine, die diese
// Rows erzeugt, kommt in 3.3.B; History-Loader-Integration in 3.3.C.
//
// 3.4.A/D: Spalte `embedding_status` (Migration 018) wird vom Memory-
// Embedding-Service nach Embed-Versuch gesetzt ('done' | 'failed'). Default
// neuer Rows ist 'pending' (DB-Default); Bestands-Daten aus 3.3 sind ebenfalls
// 'pending' und werden via twin:memory-embed-all (3.4.G) nachträglich embedded.

export type SummaryEmbeddingStatus = "pending" | "done" | "failed";

export interface ConversationSummary {
  id: string;
  conversationId: string;
  segmentStartAuditId: string;
  segmentEndAuditId: string;
  segmentMessageCount: number;
  summaryMd: string;
  createdAt: string;
}

interface ConversationSummaryRow {
  id: string;
  conversation_id: string;
  segment_start_audit_id: string;
  segment_end_audit_id: string;
  segment_message_count: number;
  summary_md: string;
  created_at: string;
}

export interface CreateSummaryInput {
  conversationId: string;
  segmentStartAuditId: string;
  segmentEndAuditId: string;
  segmentMessageCount: number;
  summaryMd: string;
}

export class ConversationSummariesRepo {
  constructor(private db: Database.Database) {}

  /**
   * Hängt eine neue Summary ans Ende der Konversations-Sequence. Caller
   * bestimmt den Audit-Range (welche Audits in der Summary verdichtet sind);
   * Repo prüft das nicht — Foreign-Keys garantieren nur dass die IDs
   * existieren, nicht die Range-Konsistenz.
   */
  insert(input: CreateSummaryInput): ConversationSummary {
    const summary: ConversationSummary = {
      id: `summary_${nanoid(16)}`,
      conversationId: input.conversationId,
      segmentStartAuditId: input.segmentStartAuditId,
      segmentEndAuditId: input.segmentEndAuditId,
      segmentMessageCount: input.segmentMessageCount,
      summaryMd: input.summaryMd,
      createdAt: new Date().toISOString(),
    };

    this.db
      .prepare(
        `INSERT INTO conversation_summaries
           (id, conversation_id, segment_start_audit_id, segment_end_audit_id,
            segment_message_count, summary_md, created_at)
         VALUES
           (@id, @conversation_id, @segment_start_audit_id, @segment_end_audit_id,
            @segment_message_count, @summary_md, @created_at)`,
      )
      .run({
        id: summary.id,
        conversation_id: summary.conversationId,
        segment_start_audit_id: summary.segmentStartAuditId,
        segment_end_audit_id: summary.segmentEndAuditId,
        segment_message_count: summary.segmentMessageCount,
        summary_md: summary.summaryMd,
        created_at: summary.createdAt,
      });

    return summary;
  }

  /**
   * Listet alle Summaries einer Konversation in chronologischer Reihenfolge
   * (ältestes Segment zuerst). Sortierung nach `created_at` — Audit-IDs sind
   * nanoid und damit NICHT lex-sortierbar, also nicht als Sort-Key tauglich
   * (3.3.B-Lesson, im 3.3.C-Test zum ersten Mal mit Stichprobe reproduziert).
   * created_at ist deterministisch chronologisch, weil der Repo bei Insert
   * `new Date().toISOString()` setzt.
   */
  listByConversation(conversationId: string): ConversationSummary[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM conversation_summaries
           WHERE conversation_id = ?
           ORDER BY created_at ASC`,
      )
      .all(conversationId) as ConversationSummaryRow[];
    return rows.map(rowToSummary);
  }

  count(conversationId: string): number {
    const row = this.db
      .prepare(
        "SELECT COUNT(*) AS c FROM conversation_summaries WHERE conversation_id = ?",
      )
      .get(conversationId) as { c: number };
    return row.c;
  }

  /**
   * 3.4.D: Setzt das Embedding-Status-Flag nach Embed-Versuch.
   * 'done' nach erfolgreichem Insert in `embeddings`, 'failed' bei Provider-
   * oder DB-Failure. Wirft nicht — Caller (Memory-Embedding-Service) macht
   * Best-Effort und loggt selbst.
   */
  updateEmbeddingStatus(id: string, status: SummaryEmbeddingStatus): boolean {
    const result = this.db
      .prepare(
        `UPDATE conversation_summaries SET embedding_status = ? WHERE id = ?`,
      )
      .run(status, id);
    return result.changes > 0;
  }

  /**
   * Cleanup-Helper. Standardmäßig nicht nötig, weil CASCADE-Delete via
   * conversation_id den Räumdienst übernimmt. Bleibt als Test-Hilfe und für
   * Edge-Cases (Re-Summary-Reset einer Konversation).
   */
  deleteByConversation(conversationId: string): number {
    const result = this.db
      .prepare("DELETE FROM conversation_summaries WHERE conversation_id = ?")
      .run(conversationId);
    return result.changes;
  }
}

function rowToSummary(row: ConversationSummaryRow): ConversationSummary {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    segmentStartAuditId: row.segment_start_audit_id,
    segmentEndAuditId: row.segment_end_audit_id,
    segmentMessageCount: row.segment_message_count,
    summaryMd: row.summary_md,
    createdAt: row.created_at,
  };
}
