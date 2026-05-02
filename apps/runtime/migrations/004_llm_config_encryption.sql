-- ─── PHASE 2.5e: LLM-CONFIG ENCRYPTION ────────────────────────────────────
-- Schema-Drift im JSON-Feld `twin_profiles.llm_config`:
--
--   alt:  { provider, model, apiKey?, baseUrl? }
--   neu:  { provider, model, apiKeyEncrypted?, apiKeySource: 'user'|'system', baseUrl? }
--
-- Heute existiert KEIN apiKey im DB-Bestand (Bootstrap hat ihn bisher als
-- null/undefined gelassen — User hatte den Key in ENV). Die Migration ist
-- daher trivial: `apiKey` raus, `apiKeySource: 'user'` rein.
--
-- Beim Re-Bootstrap nach dieser Migration wird `apiKeyEncrypted` mit dem
-- ENV-Key (verschlüsselt) befüllt.
--
-- Über schema_migrations getrackt → läuft genau einmal.

UPDATE twin_profiles
SET llm_config = json_set(
  json_remove(llm_config, '$.apiKey'),
  '$.apiKeySource', 'user'
)
WHERE llm_config IS NOT NULL;
