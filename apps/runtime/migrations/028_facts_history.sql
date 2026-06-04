-- ─── #97 FACTS-HISTORY / VALIDITY — SCHRITT 1/4 (Schema) ────────────────────
-- Temporale Dimension für Facts: heute überschreibt FactsRepo.upsert via
-- ON CONFLICT DO UPDATE den fact_value in-place (alter Wert verloren). Diese
-- Tabelle hält den SNAPSHOT DES ALTEN ZUSTANDS, BEVOR er abgelöst wird —
-- Substrat für Werte-Drift / Lebens-Narrativ(B) / Zeit-Erleben.
--
-- ADDITIV + RÜCKWÄRTSKOMPATIBEL: `facts` bleibt UNVERÄNDERT (kein Rebuild,
-- UNIQUE(twin_id, fact_key) intakt → genau ein Current-Row pro Key, alle
-- bestehenden Schreib-/Lese-Pfade laufen 1:1 weiter). Hier nur eine NEUE
-- Tabelle. Schritt 2 verdrahtet die Capture-Logik in upsert/delete; dieser
-- Schritt legt nur das Schema + ein noch ungenutztes Repo an.
--
-- BEWUSSTE SETZUNGEN:
--   - KEIN UNIQUE(twin_id, fact_key): die Pointe ist, MEHRERE historische Rows
--     pro Key zu halten (jede Ablösung = eine Row).
--   - change_type-CHECK lässt heute NUR 'value_change'/'delete' zu (KISS).
--     'confidence_change' ist bewusst weggelassen und später additiv per
--     Migration ergänzbar (CHECK erweitern, wie 016 es für facts.confidence tat).
--   - old_value nullable (defensiv); old_source/old_confidence NOT NULL (es gibt
--     immer einen abgelösten Zustand mit Provenance).
--   - FK + ON DELETE CASCADE wie facts/focus_snapshots — Twin-Löschung (#744)
--     räumt die History mit ab, kein Orphan.
--   - Index (twin_id, fact_key, recorded_at) für getTimeline (chronologisch pro
--     Key) + getAsOf (jüngste Ablösung <= Datum).
--
-- Plain CREATE TABLE, kein Rebuild → kein `-- nolmi:foreign_keys_off`-Marker.
-- Re-run-sicher via schema_migrations-Tracker + IF NOT EXISTS.

CREATE TABLE IF NOT EXISTS facts_history (
  id             TEXT PRIMARY KEY NOT NULL,
  twin_id        TEXT NOT NULL REFERENCES twin_profiles(twin_id) ON DELETE CASCADE,
  fact_key       TEXT NOT NULL,
  old_value      TEXT,                      -- alter fact_value vor Ablösung (nullable, defensiv)
  old_source     TEXT NOT NULL,             -- source des abgelösten Zustands
  old_confidence TEXT NOT NULL,             -- confidence des abgelösten Zustands
  change_type    TEXT NOT NULL CHECK (change_type IN ('value_change', 'delete')),
  recorded_at    TEXT NOT NULL              -- wann die Ablösung passierte (ISO-8601)
);

CREATE INDEX IF NOT EXISTS idx_facts_history_twin_key
  ON facts_history (twin_id, fact_key, recorded_at);
