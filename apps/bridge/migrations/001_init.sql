-- ─── BRIDGE PHASE 2 SCHEMA ─────────────────────────────────────────────────
-- Twin-Registry und Message-Inbox.
-- Die Bridge ist zustandsloser Router: hält registrierte Twins (per Handle +
-- Pre-Shared API-Token) und alle ausgetauschten Nachrichten bis zum Ack.
--
-- Anders als beim Runtime arbeiten wir hier mit echten Spalten statt JSON-Blob,
-- weil wir auf Inbox-Queries (to_handle + delivered_at) zwingend einen Index
-- brauchen.

CREATE TABLE IF NOT EXISTS twins (
  handle TEXT PRIMARY KEY,           -- z.B. "@markus" oder "@florian"
  display_name TEXT NOT NULL,
  api_token TEXT NOT NULL UNIQUE,    -- pre-shared key, wird beim Register vergeben
  registered_at TEXT NOT NULL,       -- ISO timestamp
  last_seen_at TEXT                  -- ISO timestamp, NULL bis erste Connection
);

CREATE INDEX IF NOT EXISTS idx_twins_api_token ON twins(api_token);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,               -- msg_<nanoid>
  from_handle TEXT NOT NULL,
  to_handle TEXT NOT NULL,
  content TEXT NOT NULL,
  in_reply_to TEXT,                  -- NULL oder messageId einer früheren Nachricht
  created_at TEXT NOT NULL,
  delivered_at TEXT,                 -- NULL bis Empfänger /ack callt
  FOREIGN KEY (from_handle) REFERENCES twins(handle),
  FOREIGN KEY (to_handle) REFERENCES twins(handle)
);

CREATE INDEX IF NOT EXISTS idx_messages_to_handle ON messages(to_handle, delivered_at);
CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages(created_at DESC);
