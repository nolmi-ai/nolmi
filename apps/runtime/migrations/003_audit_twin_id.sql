-- ─── PHASE 2.5d: AUDIT MULTI-TWIN ──────────────────────────────────────────
-- Schreibt jeder Audit-Zeile einen `twin_id` an. Backfill setzt existierende
-- Zeilen auf den @markus-Twin (der einzige, der vor 2.5d existiert hat).
--
-- Diese Migration ist NICHT idempotent (ALTER TABLE ADD COLUMN crasht beim
-- zweiten Run). Sie wird über den `schema_migrations`-Tracker im init-db
-- Runner geschützt — pro Migration-Filename höchstens eine Anwendung.

ALTER TABLE audit ADD COLUMN twin_id TEXT;

UPDATE audit
SET twin_id = (SELECT twin_id FROM twin_profiles WHERE handle = '@markus')
WHERE twin_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_audit_twin_id ON audit(twin_id);
