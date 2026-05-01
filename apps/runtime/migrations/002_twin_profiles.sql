-- ─── PHASE 2.5 SCHEMA: TWIN PROFILES ───────────────────────────────────────
-- Vorbereitung für Multi-Tenant. Pro Twin-Instanz ein Eintrag mit allem, was
-- der Runtime sonst aus Files (persona.md, mandates.yaml) und ENV (LLM,
-- Bridge) bezieht. In 2b nur Schema + Bootstrap; der Runtime liest noch aus
-- den Files (Cutover in 2c).
--
-- JSON-Felder (mandates_json, llm_config) bewusst als TEXT — das Repository
-- (de)serialisiert transparent. Indizierte Spalten daneben für Lookups.

CREATE TABLE IF NOT EXISTS twin_profiles (
  twin_id          TEXT PRIMARY KEY NOT NULL,
  handle           TEXT NOT NULL UNIQUE,
  display_name     TEXT NOT NULL,

  -- Inhalte
  persona_md       TEXT NOT NULL,
  mandates_json    TEXT NOT NULL,

  -- LLM-Konfig (JSON: {provider, model, apiKey, baseUrl})
  llm_config       TEXT NOT NULL,

  -- Bridge-Anbindung
  bridge_url       TEXT NOT NULL,
  bridge_token     TEXT NOT NULL,

  -- Multi-Tenancy (Schritt 4)
  owner_user_id    TEXT,

  -- Lifecycle (epoch ms)
  created_at       INTEGER NOT NULL,
  updated_at       INTEGER NOT NULL,
  is_active        INTEGER NOT NULL DEFAULT 1
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_twin_profiles_handle ON twin_profiles(handle);
CREATE INDEX IF NOT EXISTS idx_twin_profiles_owner ON twin_profiles(owner_user_id);
CREATE INDEX IF NOT EXISTS idx_twin_profiles_active ON twin_profiles(is_active);
