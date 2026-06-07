# Direct-Chat-Konversations-Historie — Bau-Strategie

**Status:** Strategie, NICHT gebaut. Erstellt Tag 40. Bau danach, sub-step.

## Problem (Diagnose Tag 40)
Der Direct-Chat („Mit meinem Twin") zeigt nur die jüngsten ~50 Audits hinter einem einzigen Reset-Toggle, ohne Status-Label. Beendete + verdichtete Konversationen — insbesondere die 53-Turn-Agent-Readiness-Konv (embedding_status=done, im Memory nutzbar via Reverse-Query) — sind im UI faktisch unauffindbar: jenseits des 50-Audit-Fensters UND hinter dem Soft-Hide. Der Sidebar-Eintrag ist statisch (ein Kanal-Button, keine Konv-Ableitung). Bausteine vorhanden aber unverdrahtet: conversationsRepo.list(owner,handle,twinId) liefert {id,status,endedAt,embeddingStatus} (repo.ts:166); audit.listByConversation(convId) existiert (sqlite.ts:106) — beide an keine Route gehängt.

## Ziel
@markus kann seine vergangenen Direct-Chat-Konversationen finden, ihren Status sehen (beendet/verdichtet) und ihren Inhalt read-only nachlesen — ohne das 50-Audit-Fenster-Problem.

## Design-Entscheidungen (Tag 40)
1. **Navigation = „Verlauf"-Button im Direct-Chat-Header** (neben „Neu starten"/„Fakten extrahieren"), öffnet die Konv-Liste. NICHT in die Sidebar (die ist für Kanäle, nicht Konv-Listen) und NICHT als Inline-Paginierung (vermischt aktuelle + alte Konv). Sauberer Sprung in die Historie, laufender Chat bleibt unberührt.
2. **Konv-Liste zeigt pro Konv:** Datum (started/ended) + Themen-Snippet (aus dem ersten summary_segment; Fallback erste User-Nachricht bei segment-loser Konv) + Status-Label („beendet TT.MM. · ✓ verdichtet" bei embedding_status=done). Navigierbar, nicht nur Datumsreihe.
3. **Read-View = read-only Vollansicht** der Konv-Audits (via audit.listByConversation). Kopf „beendet TT.MM. · ✓ verdichtet" + Zurück-Link zum aktuellen Chat. KEIN Eingabefeld, KEIN Reaktivieren in v1 (Re-Activation ist eine eigene spätere Stufe, vgl. #118-Full-Scope).
4. **Zweistufiges On-Demand-Laden:** Liste = leichte Metadaten (conversationsRepo.list, billig). Konv-Inhalt = erst bei Klick (audit.listByConversation, genau eine Konv). Löst das 50-Fenster-Problem — nie mehr als eine Konv auf einmal geladen, egal wie alt.

## Was es NICHT abdeckt (v1)
Reaktivieren/Fortsetzen alter Konv; A2A-Konv-Historie (das ist der #118-Full-Scope, separat); Löschen/Archivieren (#53); Volltextsuche über Konv.

## Bausteine (vorhanden, zu verdrahten)
- Runtime: conversationsRepo.list (Metadaten-Liste), audit.listByConversation (Konv-Audits), erstes summary_segment je Konv (für Snippet). Zwei neue Routen: GET Konv-Liste + GET Konv-Audits-by-id (owner-gegatet).
- Frontend (page.tsx): „Verlauf"-Button im Header, Konv-Listen-Panel, read-only Konv-View, Map convId→meta für Status/Snippet.

## Sub-Step-Sequenz (jeder mit Behavior-Verify)
1. Runtime-Routen: GET Konv-Liste (Metadaten + Snippet) + GET Konv-Audits-by-id, owner-gegatet, read-only. Lokal: liefern korrekte Daten, Owner-Filter greift.
2. Frontend Liste: „Verlauf"-Button → Panel mit Konv-Liste (Datum+Snippet+Status). Lokal: Liste erscheint, Status-Label korrekt.
3. Frontend Read-View: Klick → read-only Konv-Audits + Kopf + Zurück. Lokal: alte Konv (inkl. 53-Turn) wird vollständig geladen + angezeigt, kein Eingabefeld.
4. Verify Prod: die 53-Turn-Agent-Readiness-Konv ist über den Verlauf auffindbar + lesbar.
