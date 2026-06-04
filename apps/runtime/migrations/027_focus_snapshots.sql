-- ─── VISION-PATTERN „AUFMERKSAMKEIT/FOKUS" STUFE 1 — SCHRITT 1 (Schema) ──────
-- Autonom gepflegter „aktueller Fokus" pro Twin: woran der Owner GERADE
-- arbeitet, per LLM aus jüngsten Summaries + Turns abgeleitet (FocusEngine).
--
-- Append-only mit Soft-Supersede (KEIN Hard-Delete):
--   - „Aktueller Fokus" = jüngste Row mit superseded_at IS NULL (MAX(derived_at)).
--   - Reset/Korrektur (Schritt 3, Sichtbarkeits-UI) setzt superseded_at statt zu
--     löschen → der Drift des Fokus über die Zeit bleibt nachvollziehbar
--     (vision-nah: „Fokus driftet"). History statt Überschreiben.
--
-- KEIN Approval-Gate (anders als self-reflection-write / semantic-fact-write):
-- peripheres Wissen, das der Twin autonom pflegt (TWIN-VISION.md Schichtung).
-- Sichtbarkeit + Eingriff (Reset) sind die Leitplanke — Schritt 3.
--
-- FK auf twin_profiles(twin_id) ON DELETE CASCADE wie die übrigen 11 Kind-
-- Tabellen (vgl. 026-Header): ein gelöschter Twin (#744) räumt seine
-- Fokus-Snapshots automatisch mit weg, kein Orphan.
--
-- Plain CREATE TABLE — kein Table-Rebuild, daher KEIN `-- nolmi:foreign_keys_off`
-- Marker nötig (anders als 026). Re-run-sicher via schema_migrations-Tracker +
-- IF NOT EXISTS.

CREATE TABLE IF NOT EXISTS focus_snapshots (
  id             TEXT PRIMARY KEY NOT NULL,
  twin_id        TEXT NOT NULL REFERENCES twin_profiles(twin_id) ON DELETE CASCADE,
  focus_text     TEXT NOT NULL,        -- Fokus als Fließtext (für Prompt + Anzeige)
  themes_json    TEXT,                 -- optionale Themen-Liste (JSON-Array)
  basis_summary  TEXT,                 -- woraus abgeleitet (Audit-Trail: „aus N Summaries + M Turns")
  derived_at     TEXT NOT NULL,        -- ISO-Timestamp der Ableitung
  superseded_at  TEXT                  -- NULL = aktuell; gesetzt = abgelöst/zurückgesetzt (non-destruktiv)
);

CREATE INDEX IF NOT EXISTS idx_focus_twin_derived
  ON focus_snapshots(twin_id, derived_at);
