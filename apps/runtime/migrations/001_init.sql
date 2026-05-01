-- ─── PHASE 1 SCHEMA ────────────────────────────────────────────────────────
-- Persona, Mandates, Audit-Log.
-- Alle Tabellen halten den vollen JSON-State im `data`-Feld plus indizierte
-- Spalten für Queries. Das macht Migrationen später einfacher und das Schema
-- schlank.

CREATE TABLE IF NOT EXISTS persona (
  id INTEGER PRIMARY KEY CHECK (id = 1),  -- nur eine Zeile in Phase 1
  data TEXT NOT NULL                      -- JSON: ganze Persona
);

CREATE TABLE IF NOT EXISTS mandates (
  id TEXT PRIMARY KEY,
  capability TEXT NOT NULL,
  data TEXT NOT NULL                      -- JSON: das ganze Mandate
);

CREATE INDEX IF NOT EXISTS idx_mandates_capability ON mandates (capability);

CREATE TABLE IF NOT EXISTS audit (
  id TEXT PRIMARY KEY,
  timestamp TEXT NOT NULL,
  capability TEXT NOT NULL,
  mandate_id TEXT,                        -- nullable: blockierte Aktionen haben kein Mandate
  status TEXT NOT NULL,
  data TEXT NOT NULL                      -- JSON: voller AuditEntry
);

CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON audit (timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_audit_capability ON audit (capability);
CREATE INDEX IF NOT EXISTS idx_audit_status ON audit (status);
