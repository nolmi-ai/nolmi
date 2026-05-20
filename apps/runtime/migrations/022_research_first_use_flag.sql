-- Migration 022: research_first_use_seen-Flag pro Twin (#107 Frontend).
--
-- Pre-Pass-Classifier kann den Recherche-Skill triggern; beim ersten Mal
-- wollen wir im Frontend einen Beta-Hint-Modal zeigen (Latenz, Single-Step,
-- Quellen-Schwäche). Flag verhindert, dass der Hint bei jeder Recherche
-- wieder aufploppt — Bestandteil der UX, nicht Persona-Persistenz.
--
-- INTEGER NOT NULL DEFAULT 0 — SQLite befüllt bestehende Rows automatisch
-- mit 0 (Default greift beim ADD COLUMN). Repo-Layer mappt 0/1 ↔ boolean.

ALTER TABLE twin_profiles
  ADD COLUMN research_first_use_seen INTEGER NOT NULL DEFAULT 0;
