-- Migration 031: conversation continuation — „Fortsetzen" (Direct-Chat v2 SS1).
--
-- Eine Fortsetzungs-Konv ist eine NEUE Konv (sauber über start() angelegt, die
-- Ein-aktive-Invariante bleibt gewahrt), die den Kontext einer beendeten Konv
-- als Seed mitbekommt. Zwei additive Spalten auf conversations:
--
--   - continued_from_conversation_id → woraus fortgesetzt (für den sichtbaren
--     „fortgesetzt aus …"-Marker). Bewusst KEIN FK: die Ur-Konv darf später
--     gelöscht werden (#53, „Löschen = Vergessen") — die Fortsetzung lebt
--     eigenständig weiter (seed_context ist eine Kopie, keine Referenz).
--   - seed_context → Text-Snapshot der Summary der Ur-Konv zum Fortsetz-
--     Zeitpunkt. Server-intern (geht NICHT ins Frontend); der LLM-Loader gibt
--     ihn der frischen Konv als Anfangs-Kontext mit, bis/zusätzlich zu eigenen
--     Summaries.
--
-- Additiv: nullable ADD COLUMN, kein Table-Rebuild, bestehende Rows bekommen
-- NULL (= keine Fortsetzung). Plain ALTER → kein foreign_keys_off-Marker nötig.

ALTER TABLE conversations ADD COLUMN continued_from_conversation_id TEXT;
ALTER TABLE conversations ADD COLUMN seed_context TEXT;
