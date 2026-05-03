-- ─── PHASE 2.5.4.1: TRUST RELATIONSHIPS ───────────────────────────────────
-- Eigene Tabelle (kein JSON-Feld in twin_profiles), damit isTrusted() ein
-- billiger SELECT EXISTS bleibt — wird bei jedem eingehenden A2A-Aufruf
-- aufgerufen, bevor der Mandate-Check anspringt.
--
-- Trust ist einseitig: kein Auto-Reciprocity. (twin_id, trusted_handle) ist
-- UNIQUE — derselbe Owner kann denselben Handle nicht zweimal trusten.
--
-- created_by_user_id: Audit-Pflicht. Welcher User-Account hat das Trust
-- aktiv angelegt? Wird beim DELETE NICHT geprüft (Owner-Wechsel später ohne
-- Loss of Trust), aber für Forensik festgehalten.

CREATE TABLE IF NOT EXISTS trust_relationships (
  trust_id           TEXT PRIMARY KEY NOT NULL,
  twin_id            TEXT NOT NULL,
  trusted_handle     TEXT NOT NULL,
  note               TEXT,
  created_at         TEXT NOT NULL,
  created_by_user_id TEXT NOT NULL,
  FOREIGN KEY (twin_id) REFERENCES twin_profiles(twin_id),
  FOREIGN KEY (created_by_user_id) REFERENCES users(user_id),
  UNIQUE (twin_id, trusted_handle)
);

CREATE INDEX IF NOT EXISTS idx_trust_twin ON trust_relationships(twin_id);
CREATE INDEX IF NOT EXISTS idx_trust_handle ON trust_relationships(trusted_handle);
