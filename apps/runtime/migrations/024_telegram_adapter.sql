-- ─── #130 PHASE 1: TELEGRAM-ADAPTER STUFE 1 ─────────────────────────────────
-- Owner-Only-Bridge: Owner verbindet eigenen Telegram-Account via
-- /start <pairing-code> zum eigenen Twin. Bot-Token AES-256-GCM-encrypted
-- (Pattern aus crypto-utils.ts, analog mcp_servers.env_json_encrypted).
--
-- Zwei Tabellen:
--   - telegram_configs:  Bot-Konfig pro Twin, max. 1 Bot pro Twin (Stufe-1)
--   - telegram_messages: Persistenz Inbound/Outbound, FK auf conversations
--                       für Cross-Channel-Threading (Web + Telegram in einer
--                       Conversation-View).
--
-- Spec: docs/130-TELEGRAM-STRATEGY.md (Tag 25 Nachmittag)

CREATE TABLE IF NOT EXISTS telegram_configs (
  id                             TEXT PRIMARY KEY NOT NULL,
  twin_id                        TEXT NOT NULL REFERENCES twin_profiles(twin_id) ON DELETE CASCADE,
  bot_token_encrypted            TEXT NOT NULL,
  bot_username                   TEXT NOT NULL,
  webhook_secret                 TEXT NOT NULL,
  paired_owner_telegram_user_id  INTEGER,
  pairing_code                   TEXT,
  pairing_code_expires_at        TEXT,
  created_at                     TEXT NOT NULL,
  updated_at                     TEXT NOT NULL,
  -- UNIQUE(twin_id) — Stufe-1 Constraint: ein Bot pro Twin.
  -- Stufe-2 (External-Sender) wird wahrscheinlich separate
  -- telegram_paired_users-Tabelle einführen, dieses Constraint bleibt.
  UNIQUE(twin_id)
);

CREATE INDEX IF NOT EXISTS idx_telegram_configs_twin_id
  ON telegram_configs(twin_id);

CREATE INDEX IF NOT EXISTS idx_telegram_configs_paired_user
  ON telegram_configs(paired_owner_telegram_user_id);

CREATE TABLE IF NOT EXISTS telegram_messages (
  id                   TEXT PRIMARY KEY NOT NULL,
  twin_id              TEXT NOT NULL REFERENCES twin_profiles(twin_id) ON DELETE CASCADE,
  telegram_chat_id     INTEGER NOT NULL,
  telegram_message_id  INTEGER NOT NULL,
  conversation_id      TEXT REFERENCES conversations(id) ON DELETE SET NULL,
  direction            TEXT NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  text                 TEXT NOT NULL,
  sent_at              TEXT NOT NULL,
  UNIQUE(twin_id, telegram_chat_id, telegram_message_id)
);

CREATE INDEX IF NOT EXISTS idx_telegram_messages_twin_id
  ON telegram_messages(twin_id);

CREATE INDEX IF NOT EXISTS idx_telegram_messages_chat_id
  ON telegram_messages(telegram_chat_id);

CREATE INDEX IF NOT EXISTS idx_telegram_messages_conversation
  ON telegram_messages(conversation_id);
