-- Migration 011: mcp_servers Tabelle für MCP-Client-Konfiguration pro Twin (3.2.A).
--
-- Pattern angelehnt an `skills`-Tabelle: Multi-Tenant-Isolation pro Twin via FK
-- mit ON DELETE CASCADE. Encryption für env_json analog zu twin_profiles
-- llm_config.api_key_encrypted (AES-256-GCM, Master-Key aus Env).
--
-- transport-CHECK erlaubt aktuell stdio + http; spätere Transports erweiterbar
-- (z.B. websocket) durch neue Migration, die den CHECK ersetzt.
--
-- Spalten command/args_json/url sind nullable, weil sie transportabhängig
-- gesetzt werden: stdio braucht command (+ optional args_json), http braucht
-- url. Konsistenz wird Repo-seitig in validateInput() erzwungen — SQLite
-- CHECK-Constraints sind hier zu starr, weil sie keine "ENTWEDER A ODER B"-
-- Logik über mehrere Spalten elegant ausdrücken.
--
-- env_json_encrypted ist nullable für No-Auth-Server (z.B. der offizielle
-- everything-Demo-Server braucht keine API-Keys). Wenn gesetzt: das verschlüs-
-- selte JSON-Object enthält die ENV-Vars, die beim Spawn an den Child-Prozess
-- weitergegeben werden.
--
-- default_requires_approval ist der Server-weite Default für Tool-Mandates.
-- Pro-Tool-Override kommt in späteren Sub-Schritten (Mandate-Tabelle erweitert).

CREATE TABLE IF NOT EXISTS mcp_servers (
  id                          TEXT PRIMARY KEY NOT NULL,
  twin_id                     TEXT NOT NULL,
  name                        TEXT NOT NULL,
  transport                   TEXT NOT NULL CHECK (transport IN ('stdio', 'http')),
  command                     TEXT,
  args_json                   TEXT,
  env_json_encrypted          TEXT,
  url                         TEXT,
  default_requires_approval   INTEGER NOT NULL DEFAULT 1,
  is_active                   INTEGER NOT NULL DEFAULT 1,
  created_at                  TEXT NOT NULL,
  updated_at                  TEXT NOT NULL,
  UNIQUE (twin_id, name),
  FOREIGN KEY (twin_id) REFERENCES twin_profiles(twin_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_mcp_servers_twin_active
  ON mcp_servers(twin_id, is_active);
