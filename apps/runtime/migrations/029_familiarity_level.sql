-- ─── PHASE 4.3 SCHRITT 1/5: BEZIEHUNGS-MODELL — familiarity_level ───────────
-- Graded Vertrautheits-Level pro A2A-Partner (fremd/bekannt/vertraut/eng),
-- additiv an die bestehende binäre Trust-Schicht (006_trust_relationships).
-- Spec: docs/PHASE-4.3-BEZIEHUNGS-MODELL-STRATEGY.md.
--
-- Schritt 1 ist NUR Datenschicht — KEINE Wirkung: kein Prompt (Schritt 2),
-- keine UI (Schritt 3), KEIN Dispatch-Touch. `isTrusted` bleibt row-basiert
-- (die level-vs-Row-Reconciliation ist bewusst Schritt 5).
--
-- BEWUSSTE SETZUNGEN:
--   - ADD COLUMN ist ADDITIV — KEIN Table-Rebuild. UNIQUE(twin_id,
--     trusted_handle) bleibt intakt, nichts referenziert trust_relationships
--     per FK (ON-DELETE wird in #744/delete-twin.ts manuell gemacht).
--   - DEFAULT 'vertraut' = S4-Backfill: ALLE existierenden Rows sind heute
--     „trusted" (Trust = Row-Existenz) → werden vertraut. Neue UI-Trusts über
--     den bestehenden add()-Insert erben denselben Default (ein UI-Trust heute
--     = „vertrauen", also korrekt).
--   - CHECK = Schema-Guard über die vier Stufen (Muster wie change_type in 028).
--   - 🔴 'fremd' wird hier NICHT als Wert vergeben: fremd = LESE-DEFAULT bei
--     FEHLENDER Row (Partner ohne Trust-Beziehung), lebt im Repo-Getter
--     (getFamiliarity), NICHT in der Spalte. SQLite erlaubt NOT NULL bei
--     ADD COLUMN nur mit konstantem DEFAULT (hier 'vertraut', erfüllt).
--
-- Plain ADD COLUMN, kein Rebuild → kein `-- nolmi:foreign_keys_off`-Marker.
-- Re-run-sicher via schema_migrations-Tracker.

ALTER TABLE trust_relationships
  ADD COLUMN familiarity_level TEXT NOT NULL DEFAULT 'vertraut'
  CHECK (familiarity_level IN ('fremd', 'bekannt', 'vertraut', 'eng'));
