-- Migration 020: conversations.last_reset_at (#106).
--
-- Soft-Hide-Reset für DirectChat: wenn der Owner "neu starten" klickt,
-- wird die alte Konv beendet UND eine neue Konv eager gestartet mit
-- last_reset_at = NOW(). Der Frontend-Filter blendet damit alle Audits
-- mit timestamp < last_reset_at standardmäßig aus, ein Toggle in der UI
-- macht die alte Konversation wieder sichtbar.
--
-- NULL bedeutet "nie zurückgesetzt" (brand-new Konv direkt nach
-- twin:bootstrap oder erste Konv nach Owner-Onboarding). Damit bleibt
-- das Default-Verhalten für brand-new Twins unverändert.
--
-- A2A-Reset bleibt späteres Item (#118) — wir setzen last_reset_at heute
-- nur im Direct-Chat-Pfad. Das Feld kann aber auch für A2A genutzt
-- werden, sobald die Lifecycle-UI das vorsieht.

ALTER TABLE conversations ADD COLUMN last_reset_at TEXT;
