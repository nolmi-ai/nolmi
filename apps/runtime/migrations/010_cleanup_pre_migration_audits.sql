-- ─── #71b/#80 Sub-Schritt E: Cleanup von Pre-Konversations-Bestand ─────────
-- Audits ohne conversation_id stammen aus Phase 2 vor Migration 009 und
-- werden vom neuen History-Loader (Sub-Schritt C, listByConversation)
-- ohnehin ignoriert. Hier explizit löschen, damit die audit-Tabelle sauber
-- bleibt und alte Test-Pärchen aus Skill-Toggle-Reviews nicht mehr durch
-- /twins/:handle/audit zurückkommen.
--
-- Scope strict auf capability='owner-direct'. Andere Capabilities ohne
-- conversation_id (system-message, trusted-bypass, mandate-check,
-- reply-received, send_to_twin, …) haben keinen Konversations-Bezug und
-- bleiben als Audit-Trail erhalten.
--
-- Idempotent — beim nächsten db:init-Lauf in Production ein No-Op (alle
-- Pre-Migration-Audits sind dann schon weg, neue Audits haben dank Sub-
-- Schritt B eine conversation_id). Migration-Tracker (schema_migrations)
-- verhindert eh ein erneutes Ausführen, aber der Filter ist sicherer.

DELETE FROM audit
WHERE conversation_id IS NULL
  AND capability = 'owner-direct';
