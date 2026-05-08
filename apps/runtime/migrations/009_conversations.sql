-- ─── PHASE 3 / #71b + #80: KONVERSATIONS-SCHEMA ───────────────────────────
-- Ablöst die implizite Konversations-Verkettung über die Audit-History. Jede
-- Konversation hat einen Owner (User), einen Partner (Handle), einen Twin
-- (der die Konversation führt) und einen Status (active/ended).
--
-- Direct-Chat: Owner = eingeloggter User, Partner = Handle des eigenen Twins
-- (Markus chattet mit @markus → Partner = "@markus", Twin = markus_twin).
-- Bridge-Chat (#83, später): Partner ist ein anderer Twin (z.B. "@florian"),
-- Twin bleibt der eigene — er „führt" die Konversation runtime-seitig. Damit
-- ist das Schema schon Bridge-fähig, ohne dass Bridge-Chat heute aktiv ist.
--
-- Höchstens eine aktive Konversation pro (owner, partner, twin) — wird im
-- Repo via Transaktion erzwungen (keine partial-unique-Constraints in SQLite).
--
-- audit.conversation_id ist nullable: alte Audits aus Pre-3-Bestand bleiben
-- ohne Verknüpfung, Sub-Schritt E räumt den Bestand später auf. ON DELETE
-- SET NULL, damit Konversations-Löschung Audits nicht reißt.

CREATE TABLE IF NOT EXISTS conversations (
  id              TEXT PRIMARY KEY NOT NULL,
  owner_user_id   TEXT NOT NULL,
  partner_handle  TEXT NOT NULL,
  twin_id         TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'ended')),
  started_at      TEXT NOT NULL,
  ended_at        TEXT,
  FOREIGN KEY (owner_user_id) REFERENCES users(user_id),
  FOREIGN KEY (twin_id) REFERENCES twin_profiles(twin_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_conversations_active
  ON conversations(owner_user_id, partner_handle, twin_id, status);
CREATE INDEX IF NOT EXISTS idx_conversations_twin
  ON conversations(twin_id);

ALTER TABLE audit ADD COLUMN conversation_id TEXT
  REFERENCES conversations(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_audit_conversation
  ON audit(conversation_id) WHERE conversation_id IS NOT NULL;
