-- ─── PHASE 2.5.4.2: REPLY READ-TRACKING ───────────────────────────────────
-- Eingehende Bridge-Antworten (capability 'reply-received') müssen vom Owner
-- gelesen werden. Sidebar in der Chat-UI zeigt einen Indicator für noch
-- ungelesene Antworten — der read_at-Timestamp markiert "alles davor gelesen".
--
-- Partial-Index: spart Platz, weil wir nur "ungelesene" Einträge schnell
-- finden müssen. SQLite unterstützt das ab 3.8.0; better-sqlite3 ist neuer.
--
-- read_at bleibt fürs Audit-Schema optional (alte Einträge bleiben NULL,
-- werden nie als ungelesen angezeigt — sind ja auch keine reply-received-
-- Einträge).

ALTER TABLE audit ADD COLUMN read_at TEXT;
CREATE INDEX IF NOT EXISTS idx_audit_read_at ON audit(read_at) WHERE read_at IS NULL;
