-- Migration 014: facts — Semantic-Memory KV-Store (3.3.A).
--
-- Foundation für Semantic-Memory (Schicht 2 in Phase 3.3). KV-Store pro Twin
-- mit fact_key → fact_value-Mapping. Truth-Source statt facts.md-Datei:
-- User-editierbar via UI (3.3.G), Twin-schreibbar mit Approval-Gate (3.3.F).
-- Always-on-Block im System-Prompt für Pilot-Phase (3.3.E); Retrieval kommt
-- erst in 3.4 mit Embeddings.
--
-- fact_key-Konventionen (Repo-seitig nicht enforced, aber als Standard
-- dokumentiert):
--   - Lowercase, Underscore-separiert
--   - <entity>_<attribute> bei Personen-Fakten: markus_wife, florian_birthday
--   - <topic> bei allgemeinen Fakten: company_address, workshop_pricing
--
-- UNIQUE (twin_id, fact_key): zweite Schreib-Operation auf denselben Key wird
-- im Repo via ON CONFLICT zum UPDATE umgeleitet (upsert-Semantik).
--
-- source ∈ {user, twin, import}:
--   - user:   UI-Edit durch den Owner (3.3.G)
--   - twin:   LLM-Extraction aus dem Chat (3.3.F, Approval-pflichtig)
--   - import: zukünftige Bulk-Imports (CSV, externe Quellen) — Reserve
--
-- confidence ∈ {approved, pending, auto}:
--   - approved: User-bestätigt oder User-eingegeben → fließt in Twin-Prompt
--   - pending:  Twin will schreiben, User noch nicht entschieden → in Inbox,
--               nicht im Twin-Prompt sichtbar
--   - auto:     Reserve für automatische Imports ohne explizite Bestätigung
--
-- CASCADE-Delete via twin_id, damit ein Twin-Cleanup alle Facts entfernt
-- (kein orphaned Memory bei gelöschten Twins).

CREATE TABLE IF NOT EXISTS facts (
  id           TEXT PRIMARY KEY NOT NULL,
  twin_id      TEXT NOT NULL,
  fact_key     TEXT NOT NULL,
  fact_value   TEXT NOT NULL,
  source       TEXT NOT NULL CHECK (source IN ('user', 'twin', 'import')),
  confidence   TEXT NOT NULL CHECK (confidence IN ('approved', 'pending', 'auto')),
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL,
  UNIQUE (twin_id, fact_key),
  FOREIGN KEY (twin_id) REFERENCES twin_profiles(twin_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_facts_twin_id ON facts(twin_id);
