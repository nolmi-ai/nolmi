-- Migration 013: conversation_summaries — Sliding-Window-Auto-Summary (3.3.A).
--
-- Foundation für Conversation-Memory (Schicht 1 in Phase 3.3). Wenn eine
-- Konversation >CONVERSATION_SUMMARY_THRESHOLD Messages überschreitet,
-- verdichtet der Twin-LLM die ältesten CONVERSATION_SUMMARY_BATCH_SIZE
-- Messages zu einer Markdown-Summary und persistiert sie hier. Live-Window
-- (CONVERSATION_LIVE_WINDOW jüngste Messages) bleibt verbatim im History-
-- Loader. Bei sehr langen Konversationen entstehen mehrere Summary-Segmente
-- (z.B. 100 Messages = 2 Summary-Blöcke + Live-Window).
--
-- Audit-Range pro Summary: segment_start_audit_id / segment_end_audit_id
-- markieren welche Audits in der Summary enthalten sind. Damit weiß der
-- History-Loader, welche Messages er bei nachfolgenden Loads aus dem Live-
-- Window ausschließen muss (oder ob er bei sehr alten Konversationen schon
-- die Summary statt der Original-Messages laden sollte).
--
-- segment_message_count ist Sanity-Check + Debug-Info; bei Schwellwert-
-- Tuning sieht man auf einen Blick, ob die Batching-Logik korrekt arbeitet.
--
-- Immutable nach Insert: keine UPDATE-Pfade. Re-Summary einer Range
-- (Edge-Case bei Schwellwert-Änderungen) wird als zusätzliche Row angelegt;
-- Caller entscheidet, welche Variante er benutzt.
--
-- CASCADE-Delete via conversation_id, damit das Cleanup einer Konversation
-- die Summaries automatisch wegräumt. Audit-FKs sind NICHT cascading —
-- gelöschte Audits sind Edge-Case (heutige Datenmodelle löschen Audits
-- nicht), und ein orphaned segment_*_audit_id ist immer noch nützliche
-- Debug-Info.

CREATE TABLE IF NOT EXISTS conversation_summaries (
  id                      TEXT PRIMARY KEY NOT NULL,
  conversation_id         TEXT NOT NULL,
  segment_start_audit_id  TEXT NOT NULL,
  segment_end_audit_id    TEXT NOT NULL,
  segment_message_count   INTEGER NOT NULL,
  summary_md              TEXT NOT NULL,
  created_at              TEXT NOT NULL,
  FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
  FOREIGN KEY (segment_start_audit_id) REFERENCES audit(id),
  FOREIGN KEY (segment_end_audit_id) REFERENCES audit(id)
);

CREATE INDEX IF NOT EXISTS idx_conversation_summaries_conversation_id
  ON conversation_summaries(conversation_id);
