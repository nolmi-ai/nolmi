-- Migration 016: facts.confidence-CHECK erweitert um 'rejected' (3.3.F).
--
-- Twin-getriebene Fact-Extraction (3.3.F) erzeugt pending-Vorschläge, die
-- der User approven oder rejecten kann. Ein rejected Fact bleibt in der
-- Tabelle (mit confidence='rejected'), damit die ExtractionEngine ihn dem
-- LLM beim nächsten Lauf als "schon abgelehnt" zeigen kann — sonst würde
-- der Twin denselben Vorschlag im Loop erneut machen.
--
-- SQLite kann CHECK-Constraints nicht via ALTER ändern. Standardpattern:
-- neue Tabelle anlegen, Daten kopieren, alte droppen, neue umbenennen.
-- Index muss nach DROP der alten Tabelle neu erstellt werden (er hing am
-- alten Namen).
--
-- Idempotent via schema_migrations-Tracking (siehe init-db.ts): Migration
-- läuft genau einmal, das Table-Rebuild ist unter dieser Garantie sicher.

CREATE TABLE facts_new (
  id           TEXT PRIMARY KEY NOT NULL,
  twin_id      TEXT NOT NULL,
  fact_key     TEXT NOT NULL,
  fact_value   TEXT NOT NULL,
  source       TEXT NOT NULL CHECK (source IN ('user', 'twin', 'import')),
  confidence   TEXT NOT NULL CHECK (confidence IN ('approved', 'pending', 'auto', 'rejected')),
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL,
  UNIQUE (twin_id, fact_key),
  FOREIGN KEY (twin_id) REFERENCES twin_profiles(twin_id) ON DELETE CASCADE
);

INSERT INTO facts_new (
  id, twin_id, fact_key, fact_value, source, confidence, created_at, updated_at
)
SELECT id, twin_id, fact_key, fact_value, source, confidence, created_at, updated_at
  FROM facts;

DROP TABLE facts;
ALTER TABLE facts_new RENAME TO facts;

CREATE INDEX IF NOT EXISTS idx_facts_twin_id ON facts(twin_id);
