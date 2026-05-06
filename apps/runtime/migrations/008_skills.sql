-- ─── PHASE 3.1.A: SKILLS ────────────────────────────────────────────────────
-- Eigene Tabelle pro Twin. Skill-Inhalte (Manifest, SKILL.md, optional Script)
-- liegen in der DB — konsistent mit Multi-Tenant. Skill-Sharing zwischen Twins
-- kommt später als eigene Erweiterung.
--
-- Hybrid-Ansatz (Hermes/Cline-Style): Manifest als JSON + Markdown-Instructions
-- + optional ein TypeScript-Script (für Action-Skills). Wissens-Skills haben
-- script_ts = NULL.
--
-- name separat von manifest_json, weil UNIQUE (twin_id, name) nötig ist und
-- Listen-UIs den Namen ohne JSON-Parse brauchen. description ebenso.
-- instructions_md separat, weil typischerweise lang.
--
-- source bereitet 3.2 vor: 'manual' für UI-erstellte Skills, 'mcp' für aus
-- MCP-Servern importierte. In 3.1 werden nur 'manual'-Skills geschrieben.

CREATE TABLE IF NOT EXISTS skills (
  skill_id          TEXT PRIMARY KEY NOT NULL,
  twin_id           TEXT NOT NULL,

  -- Identifikation
  name              TEXT NOT NULL,
  description       TEXT NOT NULL,

  -- Skill-Inhalte (Hybrid-Ansatz)
  manifest_json     TEXT NOT NULL,
  instructions_md   TEXT NOT NULL,
  script_ts         TEXT,

  -- Provenienz
  source            TEXT NOT NULL DEFAULT 'manual',
  source_metadata   TEXT,

  -- Lifecycle (epoch ms, konsistent mit twin_profiles)
  is_active         INTEGER NOT NULL DEFAULT 1,
  created_at        INTEGER NOT NULL,
  updated_at        INTEGER NOT NULL,

  UNIQUE (twin_id, name),
  FOREIGN KEY (twin_id) REFERENCES twin_profiles(twin_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_skills_twin_id ON skills(twin_id);
CREATE INDEX IF NOT EXISTS idx_skills_active ON skills(is_active) WHERE is_active = 1;
CREATE INDEX IF NOT EXISTS idx_skills_source ON skills(source);
