# Konversationen löschen + archivieren (#53) — Bau-Strategie

**Status:** Strategie, NICHT gebaut. Erstellt Tag 41. Bau danach, sub-step. Baut auf der Direct-Chat-Historie (Tag 40) auf.

## Problem
Konversationen bleiben dauerhaft sichtbar; der gestern gebaute Verlauf füllt sich u.a. mit Tool-Test-Wegwerf-Konv. Zwei Bedürfnisse: endgültig löschen (Müll weg) + reversibel archivieren (aus dem Weg, aber aufgehoben).

## Zwei Achsen (Kernunterscheidung)
- **Löschen = endgültiges Vergessen.** Row + Audit-Turns + Summaries + Embeddings (inkl. vec0 + fts) weg. Unwiederbringlich. Entfernt auch den Memory-Beitrag der Konv.
- **Archiv = reine UI-Sichtbarkeit.** Konv raus aus der Standard-Liste, in einer Archiv-Sicht weiter einsehbar, reversibel. 🔴 Archiv lässt Embeddings UNANGETASTET — eine archivierte Konv bleibt im Reverse-Memory-Query abrufbar. Nur Löschen entfernt Memory.

## Design-Entscheidungen (Tag 41, verbindlich)
1. **Hard-Delete inkl. Audit-Turns:** Konv-Delete entfernt auch die Gesprächs-Turns (audit-FK ist SET NULL, nicht CASCADE → ohne expliziten Schritt blieben sie als Waisen). Echtes Löschen, keine Reste.
2. **Embeddings selektiv mitlöschen:** embeddings/vec0/fts sind NICHT FK-gekoppelt → via EmbeddingsRepo.deleteByTarget(twinId, targetType, targetId) (embeddings-repo.ts:538, löscht atomar embeddings+vec+fts). 🔴 Summary-IDs VOR dem conv-Delete enumerieren (summariesRepo.listByConversation), sonst entfernt die CASCADE die conversation_summaries-Rows und die IDs sind verloren.
3. **archived_at-Spalte (TEXT NULL), NICHT status-Wert:** ended (Lifecycle) und archived (Sichtbarkeit) sind orthogonale Achsen — eine Konv kann ended UND archiviert sein. Additive ALTER-Migration (kein Table-Rebuild). archived_at NULL ⇄ gesetzt = archivieren/wiederherstellen. Kein deleted_at (Soft-Delete) — „löschen ist endgültig".
4. **A2A-Delete/Archiv = rein lokal:** Bridge-Verlauf der Gegenseite bleibt unberührt, jeder Twin entscheidet lokal über Sichtbarkeit (Item bestätigt das selbst).

## Cascade-Reihenfolge beim Löschen (1 Transaktion, FK bleibt ON)
1. Summary-IDs holen (summariesRepo.listByConversation) → pro Summary deleteByTarget('summary_segment', id)
2. deleteByTarget('conversation', convId)
3. DELETE conversation_summaries WHERE conversation_id=? (manuell, VOR audit — entsperrt die NO-ACTION-FK von segment_*_audit_id)
4. DELETE audit WHERE conversation_id=? (Hard-Delete der Turns, VOR conv-Row)
5. DELETE conversations WHERE id=?
Vorbild: onboarding/delete-twin.ts (manuelle Reihenfolge in einer tx).

## Sub-Step-Sequenz
**SS1 — Löschen Backend (S–M, keine Migration):** ConversationsRepo.deleteConversation(twinId, convId) (Cascade oben, 1 tx) + owner-gegatete DELETE-Route + IDOR-Check (wie history-Route-2 Tag 40). Lokal-Test: Cascade vollständig (keine verwaisten embeddings/vec/fts/audits), IDOR weist fremde Konv ab.
**SS2 — Löschen Frontend (S):** Lösch-Aktion in ConversationHistoryPanel/ReadView + Confirm-Dialog (Vorbild ConfirmDeleteTwinModal.tsx). Confirm muss benennen: endgültig + Memory-Beitrag weg.
**SS3 — Archiv Backend (M, additive Migration):** Migration archived_at + archive()/unarchive() + Filter (archived raus aus list/sidebar-Merge/history-Route) + ?archived=true-Param für Archiv-Sicht + shared-Flag (ConversationHistoryItem additiv).
**SS4 — Archiv Frontend (S–M):** Archiv-Sicht (Toggle/zweite Sektion, analog selectedId-Umschalter) + Archivieren/Wiederherstellen-Aktion.

## Reihenfolge-Begründung
Löschen zuerst: keine Migration, höchster Sofort-Nutzen (Test-Konv-Müll weg), schärft das Cascade-Verständnis. Archiv danach: breiter (Migration + Filter an 3 Listen + zweite View).

## NICHT in #53 (Abgrenzung)
Bridge-seitige A2A-Löschung (Gegenseite); Bulk-Löschen; Auto-Archiv nach Zeit; Volltextsuche.
