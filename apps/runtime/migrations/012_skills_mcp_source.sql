-- Migration 012: skills-Tabelle erweitern um MCP-Server-FK + Tool-Name (3.2.C).
--
-- Bestand: `source TEXT NOT NULL DEFAULT 'manual'` und `source_metadata`
-- existieren bereits aus Migration 008 (Phase 3.1) — dort wurde MCP als
-- Future-Source angekündigt. 3.2.C macht es konkret:
--
--   - mcp_server_id: FK auf mcp_servers(id) mit ON DELETE CASCADE. Wird der
--     Server entfernt, fliegen die zugehörigen Skill-Einträge automatisch raus.
--     Nullable, weil source='manual'-Skills den FK nicht haben.
--   - mcp_tool_name: der originale Tool-Name vom MCP-Server. Nullable analog.
--
-- Sanity-Constraint (source='mcp' → beide Felder gesetzt; source='manual' →
-- beide null) lässt sich in SQLite ohne CHECK-Subquery nicht sauber stellen
-- — der Repo-Layer enforced das via validateInput().
--
-- Index nur für source='mcp'-Rows: refresh()/listByMcpServer()-Lookups gehen
-- über mcp_server_id; manual-Skills brauchen den Index nicht und sollen die
-- B-Tree-Größe nicht aufblasen.

ALTER TABLE skills ADD COLUMN mcp_server_id TEXT
  REFERENCES mcp_servers(id) ON DELETE CASCADE;

ALTER TABLE skills ADD COLUMN mcp_tool_name TEXT;

CREATE INDEX IF NOT EXISTS idx_skills_mcp_server
  ON skills(mcp_server_id) WHERE mcp_server_id IS NOT NULL;
