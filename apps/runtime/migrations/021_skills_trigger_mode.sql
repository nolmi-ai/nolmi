-- Migration 021: triggerMode + triggerCondition im skills.manifest_json (#107).
--
-- Skill-Manifest bekommt zwei optionale Felder:
--   - triggerMode: 'forced' | 'passive' (Default 'passive', backward-compat)
--   - triggerCondition: Klartext-Beschreibung, wann der Skill aktiviert wird
--
-- Beide leben im `manifest_json`-Blob — keine echte Schema-Änderung an der
-- skills-Tabelle nötig. Bestehende Skills ohne triggerMode werden bei der
-- Deserialisierung in `packages/shared/src/index.ts` zu 'passive' geparst
-- (Zod .default('passive')), kein Verhaltens-Change.
--
-- Migration ist rein dokumentarisch / Bookkeeping — der init-db.ts-Runner
-- läuft idempotent in lexikographischer Reihenfolge und braucht eine Datei
-- in der Sequenz, damit die nächste echte Migration (022+) konsistent
-- nummeriert werden kann.

CREATE TABLE IF NOT EXISTS _migration_021_skills_trigger_mode (id INTEGER);
DROP TABLE _migration_021_skills_trigger_mode;
