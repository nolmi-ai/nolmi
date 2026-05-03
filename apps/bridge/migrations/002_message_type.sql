-- ─── BRIDGE PHASE 2.5.4.1.1: MESSAGE TYPE ─────────────────────────────────
-- Anlass: System-Antworten (Wartemeldung, Reject-Hinweis) wurden bisher als
-- normale Twin-Messages gesendet. Folge: Empfänger-Twin sah die Wartemeldung
-- als Anfrage, antwortete mit eigener Wartemeldung → Infinite-Loop.
--
-- Fix: explizites message_type-Feld. Empfänger filtert "system"-Nachrichten
-- vor jedem Mandate-Check / LLM-Call raus und legt sie nur ins Audit ab.
--
-- DEFAULT 'twin' macht die Migration backward-compatible: alle bestehenden
-- Messages bleiben funktional als Twin-Nachrichten.
--
-- CHECK-Constraint hier bewusst nicht — SQLite ALTER TABLE ADD COLUMN
-- akzeptiert den nur über umständliche Tabellenneubauten. Validierung läuft
-- stattdessen auf Application-Layer im POST /messages-Handler.

ALTER TABLE messages ADD COLUMN message_type TEXT NOT NULL DEFAULT 'twin';
CREATE INDEX IF NOT EXISTS idx_messages_type ON messages(message_type);
