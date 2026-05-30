-- nolmi:foreign_keys_off
-- ─── DISTRIBUTION ETAPPE 1: bridge_url + bridge_token NULLABLE ──────────────
-- Solo-Twin-Support (D3, docs/DISTRIBUTION-STRATEGY.md): ein Twin ohne A2A-
-- Bridge speichert bridge_url/bridge_token als NULL. Bisher waren beide
-- NOT NULL.
--
-- WARUM Table-Rebuild + Marker `-- nolmi:foreign_keys_off` (Zeile 1):
-- SQLite kann NOT NULL nicht per `ALTER COLUMN` droppen → 12-Schritt-Rebuild
-- (CREATE new → INSERT SELECT → DROP alt → RENAME). twin_profiles wird von
-- 11 Tabellen per `FOREIGN KEY ... ON DELETE CASCADE` referenziert (skills,
-- facts, conversations, twin_diary, embeddings, telegram_configs,
-- oauth_tokens, mcp_servers, trust_relationships, ...). Ein `DROP TABLE`
-- unter foreign_keys=ON würde via impliziten Parent-DELETE alle Kind-Zeilen
-- kaskadiert löschen. Der Marker weist den Migration-Runner an, diese eine
-- Migration mit foreign_keys=OFF zu fahren (außerhalb der Tx gesetzt) +
-- `foreign_key_check` vor COMMIT — siehe apps/runtime/src/scripts/init-db.ts.
--
-- Daten bleiben unberührt: alle Spalten 1:1 übernommen, NOT NULL→nullable ist
-- die ungefährliche Richtung (kein Wert-Rewrite). Bestehende Twins behalten
-- ihre bridge_url/bridge_token.
--
-- Re-run-sicher: läuft genau einmal (schema_migrations-Tracker); bei Abbruch
-- ROLLBACK → kein twin_profiles_new, kein Tracker-Eintrag → sauberer Re-Try.
-- `DROP ... IF EXISTS` als zusätzlicher Schutz gegen Reste eines Fehl-Laufs.

DROP TABLE IF EXISTS twin_profiles_new;

CREATE TABLE twin_profiles_new (
  twin_id          TEXT PRIMARY KEY NOT NULL,
  handle           TEXT NOT NULL UNIQUE,
  display_name     TEXT NOT NULL,

  -- Inhalte
  persona_md       TEXT NOT NULL,
  mandates_json    TEXT NOT NULL,

  -- LLM-Konfig (JSON: {provider, model, apiKey, baseUrl})
  llm_config       TEXT NOT NULL,

  -- Bridge-Anbindung — jetzt NULLABLE (Solo-Twin = NULL/NULL)
  bridge_url       TEXT,
  bridge_token     TEXT,

  -- Multi-Tenancy
  owner_user_id    TEXT,

  -- Lifecycle (epoch ms)
  created_at       INTEGER NOT NULL,
  updated_at       INTEGER NOT NULL,
  is_active        INTEGER NOT NULL DEFAULT 1,

  -- spätere Spalten (022/023/025), unverändert
  research_first_use_seen INTEGER NOT NULL DEFAULT 0,
  persona_input_json TEXT,
  auth_mode        TEXT NOT NULL DEFAULT 'api_key' CHECK(auth_mode IN ('api_key', 'oauth'))
);

INSERT INTO twin_profiles_new (
  twin_id, handle, display_name, persona_md, mandates_json, llm_config,
  bridge_url, bridge_token, owner_user_id, created_at, updated_at, is_active,
  research_first_use_seen, persona_input_json, auth_mode
)
SELECT
  twin_id, handle, display_name, persona_md, mandates_json, llm_config,
  bridge_url, bridge_token, owner_user_id, created_at, updated_at, is_active,
  research_first_use_seen, persona_input_json, auth_mode
FROM twin_profiles;

DROP TABLE twin_profiles;
ALTER TABLE twin_profiles_new RENAME TO twin_profiles;

-- Indizes 1:1 wiederherstellen (das inline UNIQUE auf handle erzeugt zusätzlich
-- den Auto-Index; die expliziten Indizes wie im Original).
CREATE UNIQUE INDEX IF NOT EXISTS idx_twin_profiles_handle ON twin_profiles(handle);
CREATE INDEX IF NOT EXISTS idx_twin_profiles_owner ON twin_profiles(owner_user_id);
CREATE INDEX IF NOT EXISTS idx_twin_profiles_active ON twin_profiles(is_active);
