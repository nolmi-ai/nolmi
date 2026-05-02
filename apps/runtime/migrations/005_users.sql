-- ─── PHASE 2.5.4: USERS ────────────────────────────────────────────────────
-- Echte User-Auth (Email + bcrypt-Hash). twin_profiles.owner_user_id wurde
-- in 002 schon angelegt, blieb aber bisher null. Heute migriert das CLI
-- bestehende Twins per `pnpm user:create … --assign-twin @<handle>`.
--
-- email_verified_at bleibt heute NULL. Email-Verifikation kommt in 2.5.5.

CREATE TABLE IF NOT EXISTS users (
  user_id           TEXT PRIMARY KEY NOT NULL,
  email             TEXT NOT NULL UNIQUE,
  password_hash     TEXT NOT NULL,
  display_name      TEXT,
  email_verified_at TEXT,
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
