-- Migration 018: embedding_status auf conversation_summaries + conversations (3.4.A).
--
-- Flag für die Pending-Queue (siehe 3.4-STRATEGY.md "Update-Strategie"):
-- statt eigener Queue-Tabelle leben die Status-Bits auf den Quell-Tabellen.
--
-- Status-Werte (Repo-seitig nicht enforced, Doku-Konvention):
--   - 'pending'  → noch nicht embedded (Default für neue Rows + bestehende Daten)
--   - 'done'     → erfolgreich embedded, Eintrag in `embeddings`
--   - 'failed'   → Embedding-Versuch ist gescheitert; Retry via twin:memory-embed-all
--
-- Bestehende Rows aus Phase 3.3 (Markus' bisherige Summaries/Konversationen)
-- landen automatisch auf 'pending' durch den DEFAULT — werden mit dem
-- Maintenance-CLI in 3.4.G nachträglich embedded.
--
-- Kein CHECK-Constraint, weil das Schema bewusst tolerant für künftige
-- Status-Werte (z.B. 'skipped' für zu kurze Inhalte) bleibt. Repo-Helper
-- kapselt die erlaubten Werte als Type.

ALTER TABLE conversation_summaries
  ADD COLUMN embedding_status TEXT NOT NULL DEFAULT 'pending';

ALTER TABLE conversations
  ADD COLUMN embedding_status TEXT NOT NULL DEFAULT 'pending';
