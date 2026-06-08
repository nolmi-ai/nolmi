-- Migration 030: conversations.archived_at — Archiv-Sichtbarkeit (#53 SS3).
--
-- Archivieren = reine UI-Sichtbarkeit, orthogonal zum Lifecycle (status
-- active/ended): eine Konversation kann ended UND archiviert sein. Darum eine
-- EIGENE Spalte statt eines dritten status-Werts (kein CHECK-Rebuild).
--
--   - archived_at IS NULL      → nicht archiviert (Standard-Listen zeigen sie)
--   - archived_at = ISO-String → archiviert (raus aus Standard-Listen, sichtbar
--                                nur in der Archiv-Sicht; reversibel via NULL)
--
-- Archiv ≠ Memory-Entzug: die embeddings der Konv bleiben UNANGETASTET — eine
-- archivierte Konv bleibt im Reverse-Memory-Query abrufbar. Nur Löschen (SS1)
-- entfernt Memory.
--
-- Additiv: nullable ADD COLUMN, kein Table-Rebuild (kein eingehender FK
-- betroffen), bestehende Rows bekommen NULL (= nicht archiviert). Plain
-- ALTER → kein `-- nolmi:foreign_keys_off`-Marker nötig.

ALTER TABLE conversations ADD COLUMN archived_at TEXT;

CREATE INDEX IF NOT EXISTS idx_conversations_archived
  ON conversations(twin_id, archived_at);
