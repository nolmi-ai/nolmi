-- Migration 017: embeddings + vec0-Virtual-Tabelle + FTS5 (3.4.A).
--
-- Foundation für Episodic-Memory (Phase 3.4). Drei Virtual-Tables-Familien:
--   1. embeddings           — Stammtabelle mit Metadaten + BLOB (Quelle für rowid-Mapping)
--   2. embeddings_vec       — sqlite-vec Virtual-Table für KNN-Search via vec0
--   3. memory_fts           — FTS5 Virtual-Table für Keyword-Search (Hybrid-Foundation)
--
-- Die drei Tabellen werden vom EmbeddingsRepo atomar in einer Transaction
-- befüllt. embeddings.rowid ist die Verbindung zu embeddings_vec.rowid —
-- vec0 erlaubt keine TEXT-PKs, deshalb das SQLite-Auto-Integer-rowid-Mapping.
--
-- WICHTIG: sqlite-vec muss als Extension geladen sein, BEVOR diese Migration
-- läuft. createSqliteRepository() (apps/runtime/src/repository/sqlite.ts) ruft
-- `sqliteVec.load(db)` direkt nach `new Database(...)` auf. init-db.ts macht
-- dasselbe vor dem Migration-Loop. Ohne den Load wirft `CREATE VIRTUAL TABLE
-- ... USING vec0(...)` ein "no such module: vec0".
--
-- target_type-Werte (Repo-seitig nicht enforced, Doku-Konvention):
--   - 'summary_segment'   → Eintrag pro Summary-Segment aus 3.3.B
--   - 'conversation'      → Eintrag pro finalisierte Konversation ohne Segments
--   - 'diary_entry'       → Eintrag pro twin_diary-Row
--
-- Pattern-Vorbereitung (Extended Foundation, siehe 3.4-STRATEGY.md Sektion
-- "Pattern-Vorbereitung"):
--   - last_accessed_at + access_count → Zeit-Erleben-Pattern
--   - topic_tags                       → Aufmerksamkeits-Pattern
--   - narrative_thread_id              → Lebens-Narrativ-Pattern
--   - embedding_model                  → Multi-Provider-Coexistenz
--
-- UNIQUE (twin_id, target_type, target_id, embedding_model): pro Quell-
-- Objekt darf genau ein Vektor pro Modell existieren. Re-Embedding mit
-- demselben Modell ist eine Konflikt-Verletzung (Repo nutzt explizites
-- DELETE-vor-INSERT für Force-Re-Embed in 3.4.G). Verschiedene Modelle
-- können koexistieren — sinnvoll bei Provider-Wechsel.
--
-- FTS5-Tabelle (memory_fts):
--   - tokenize = 'unicode61 remove_diacritics 2' ist deutsch-aware (Umlaute,
--     Akzente, Kleinschreibung). Default-Tokenizer würde "Bäume" und "Baeume"
--     als unterschiedliche Tokens behandeln.
--   - UNINDEXED-Spalten werden gespeichert aber nicht im FTS-Index — sie sind
--     nur Filter-Spalten (twin_id für Multi-Tenancy, target_type/target_id
--     für JOIN-Mapping auf embeddings).
--   - 3.4.A populated die Tabelle, aber 3.4.E sucht NICHT in ihr — pure
--     Vector-Search bleibt der Retrieval-Pfad. Hybrid-Search-Logic ist
--     spätere Erweiterung; FTS5-Datenschicht ist vorbereitet.

CREATE TABLE IF NOT EXISTS embeddings (
  id                    TEXT PRIMARY KEY NOT NULL,
  twin_id               TEXT NOT NULL,
  target_type           TEXT NOT NULL,
  target_id             TEXT NOT NULL,
  embedding_model       TEXT NOT NULL,
  embedding             BLOB NOT NULL,
  topic_tags            TEXT,
  narrative_thread_id   TEXT,
  last_accessed_at      TEXT,
  access_count          INTEGER NOT NULL DEFAULT 0,
  created_at            TEXT NOT NULL,
  UNIQUE (twin_id, target_type, target_id, embedding_model),
  FOREIGN KEY (twin_id) REFERENCES twin_profiles(twin_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_embeddings_twin_target
  ON embeddings(twin_id, target_type, target_id);

CREATE INDEX IF NOT EXISTS idx_embeddings_thread
  ON embeddings(narrative_thread_id)
  WHERE narrative_thread_id IS NOT NULL;

-- sqlite-vec Virtual-Table — Dimension 1024 entspricht multilingual-e5-large.
-- Bei Provider-Wechsel mit anderer Dimension muss die Tabelle neu erstellt
-- werden (siehe 3.4-STRATEGY.md "Open Questions / Embedding-Dimension-Wechsel").
CREATE VIRTUAL TABLE IF NOT EXISTS embeddings_vec USING vec0(
  embedding float[1024]
);

-- FTS5-Tabelle — Hybrid-Search-Foundation.
CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts USING fts5(
  content,
  target_type UNINDEXED,
  target_id UNINDEXED,
  twin_id UNINDEXED,
  tokenize = 'unicode61 remove_diacritics 2'
);
