-- Migration 019: twin_diary (3.4.A).
--
-- Foundation für das Selbst-Reflexions-Pattern (TWIN-VISION.md). In 3.4
-- nur Schema + Basis-Repo plus Slot in der Embeddings-Pipeline. Auto-
-- Generierung von Diary-Einträgen (Twin schreibt aktiv über sich) kommt
-- mit der späteren Pattern-Phase Selbst-Reflexion.
--
-- triggered_by-Werte (Repo-seitig nicht enforced, Doku-Konvention):
--   - 'scheduled'    → automatisch via Background-Job (Pattern-Phase)
--   - 'manual'       → User via CLI twin:diary-add (3.4.F)
--   - 'post_extract' → nach Fact-Extraction-Reflexion (Pattern-Phase)
--
-- embedding_status analog zu conversations/conversation_summaries —
-- gleiche Pipeline-Semantik, gleiche Werte ('pending' | 'done' | 'failed').
--
-- CASCADE-Delete via twin_id räumt Diary-Einträge mit dem Twin weg.
--
-- Index nach (twin_id, created_at DESC) für die Default-Liste-Abfrage
-- ("neueste zuerst"). Embedding-Lookup geht nicht über diesen Index, sondern
-- über die UNIQUE-Constraint auf embeddings.

CREATE TABLE IF NOT EXISTS twin_diary (
  id                TEXT PRIMARY KEY NOT NULL,
  twin_id           TEXT NOT NULL,
  content           TEXT NOT NULL,
  triggered_by      TEXT NOT NULL,
  created_at        TEXT NOT NULL,
  embedding_status  TEXT NOT NULL DEFAULT 'pending',
  FOREIGN KEY (twin_id) REFERENCES twin_profiles(twin_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_diary_twin_created
  ON twin_diary(twin_id, created_at DESC);
