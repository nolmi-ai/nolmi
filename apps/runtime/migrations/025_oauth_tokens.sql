-- ─── #131 PHASE 1: OAUTH-TOKEN-STORAGE ─────────────────────────────────────
-- OpenAI Subscription-OAuth Backend-Foundation.
-- Tokens AES-256-GCM-encrypted via crypto-utils.ts (Pattern analog
-- telegram_configs.bot_token_encrypted, mcp_servers.env_json_encrypted).
--
-- Eine Row pro (twin_id, provider). Provider in Phase 1 nur 'openai';
-- CHECK-Constraint hält die Discriminator-Disziplin für Phase B
-- (z.B. zusätzlich 'anthropic' wenn #132 kommt).
--
-- twin_profiles.auth_mode ist Exklusiv-Switch pro Twin (Strategy §b):
-- entweder API-Key (llm_config.apiKeyEncrypted) ODER OAuth-Token.
-- Default 'api_key' für Backward-Compat: existing Twins bleiben unverändert.
--
-- Spec: docs/131-OAUTH-STRATEGY.md §c (oauth_tokens Storage) + §b (Auth-Mode)

CREATE TABLE IF NOT EXISTS oauth_tokens (
  id                      TEXT PRIMARY KEY NOT NULL,
  twin_id                 TEXT NOT NULL REFERENCES twin_profiles(twin_id) ON DELETE CASCADE,
  provider                TEXT NOT NULL CHECK(provider IN ('openai')),
  access_token_encrypted  TEXT NOT NULL,
  refresh_token_encrypted TEXT NOT NULL,
  expires_at              TEXT NOT NULL,
  account_id              TEXT,
  created_at              TEXT NOT NULL,
  updated_at              TEXT NOT NULL,
  UNIQUE(twin_id, provider)
);

CREATE INDEX IF NOT EXISTS idx_oauth_tokens_twin_id
  ON oauth_tokens(twin_id);

-- Auth-Mode-Spalte auf twin_profiles (Default api_key für Backward-Compat,
-- existing Rows bleiben unverändert). CHECK-Constraint hält Phase-1-Scope:
-- nur 'api_key' oder 'oauth', keine simultane Multi-Auth.
ALTER TABLE twin_profiles
  ADD COLUMN auth_mode TEXT NOT NULL DEFAULT 'api_key'
  CHECK(auth_mode IN ('api_key', 'oauth'));
