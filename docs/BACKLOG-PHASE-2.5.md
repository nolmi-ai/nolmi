# Backlog Phase 2.5 und später

Stand: 1. Mai 2026, nach Phase-2-Abschluss.
Format: Punkte mit Größe (S/M/L/XL) und Priorität (must/should/nice).

---

## Aus Phase 2 entstanden

### 1. Twin-Konversationen als Threads (Variante 2)
Eigene `twin_conversations`-Tabelle. Jede Nachricht referenziert eine `conversationId`. Ganze Threads werden bei Approve gerendert. UI-Möglichkeit für Conversation-View in Settings.
**Größe:** L · **Priorität:** should · **Aus:** Phase-2-Live-Test

### 2. Lokale Spiegelung des Bridge-Streams (Variante 3)
Alle Twin-Nachrichten persistent in der Twin-DB, nicht nur Audits. Bridge wird zum reinen Transport. Authoritative Konversations-Historie liegt lokal.
**Größe:** XL · **Priorität:** nice · **Aus:** Phase-2-Architektur-Diskussion

### 3. Mandate-Conditions-Auswertung
`requiresApproval`, `maxLength`, etc. werden aktuell in `mandates.yaml` ignoriert. Sollten in `checkMandate()` ausgewertet werden für feinere Kontrolle.
**Größe:** M · **Priorität:** should · **Aus:** Phase-1-Limit, dokumentiert in CLAUDE.md

### 4. Auto-Reply-Mandate für vertraute Twins
Mandate-Condition wie "Auto-Reply, wenn Absender = vertrauter Handle UND Inhalt enthält keine Sensitiv-Wörter". Aktuell gehen alle eingehenden Nachrichten in Pending.
**Größe:** M · **Priorität:** should · **Aus:** Phase-2-Spec-Diskussion

### 5. Reject-Notification an Absender
Aktuell: Reject = Stille. Optional könnte der andere Twin eine kurze Notification bekommen ("Markus hat deine Nachricht nicht beantwortet"). Phase-2-Spec hatte das bewusst weggelassen.
**Größe:** S · **Priorität:** nice · **Aus:** Phase-2-Spec

### 6. Bridge-Catch-up beim Reconnect
Aktuell: Reconnect verlässt sich darauf, dass die Bridge alle nicht-gelieferten Nachrichten beim SSE-Connect nachschickt. Falls die Bridge das nicht macht (z.B. nach Bridge-Crash), bleiben Nachrichten ungesehen bis zum nächsten Twin-Boot. Idempotenz fängt das ab, aber sauberer wäre ein eigener `getInbox()`-Call beim Reconnect.
**Größe:** S · **Priorität:** should · **Aus:** Briefing #2 Limitation

### 7. Bridge im pnpm-dev-Verbund
`pnpm dev` startet aktuell auch die Bridge mit, die dann mit der externen Bridge auf 5100 kollidiert (EADDRINUSE). Saubere Lösung: Bridge aus dem Root-Verbund entfernen, weil sie konzeptionell ein anderer Prozess ist.
**Größe:** S · **Priorität:** should · **Aus:** Phase-2-Live-Test

### 8. Replaced-Conflict-Recovery
Wenn ein zweiter Markus-Twin sich registriert, schließt der erste seine Connection ohne Reconnect (sonst Ping-Pong). Aber: Es gibt kein Auto-Recovery, wenn der Konflikt-Twin verschwindet. Manueller Reconnect-Knopf in Settings als Lösung.
**Größe:** S · **Priorität:** nice · **Aus:** Briefing #2 Limitation

### 9. Persona-Versionierung
Aktuell wird die Persona bei jedem Boot überschrieben. Wenn du sie iterierst, verlierst du die Historie. Versioniert speichern, mit Diff-View.
**Größe:** M · **Priorität:** nice · **Aus:** allgemeine Beobachtung

### 10. UI-Bearbeitung von Persona/Mandates
In Phase 1 und 2 explizit ausgeschlossen — Files in `docs/` sind die Source of Truth. Phase-3 oder später könnte das ändern.
**Größe:** L · **Priorität:** nice · **Aus:** Phase-1-Scope-Disziplin

### 11. Repo-Hygiene (HARWAY Experience)
Codex-Agenten committen interne Dokumente (CMO-Reports, Blog-Briefs) als Markdown in den Code-Repo, sollten Paperclip-Documents sein. Gilt für HARWAY-Experience-Repo, nicht twin-lab. Hier nur als Referenz dokumentiert.
**Größe:** S · **Priorität:** nice · **Aus:** anderer Kontext

### 12. Konversations-Memory (Schicht 1)
Frühere Chats und Twin-Konversationen als komprimierter Kontext bei jeder neuen Anfrage. Stale-aware (Memories älter als X Wochen werden weggekippt, wenn nicht aktiv referenziert).
**Größe:** M · **Priorität:** should · **Aus:** Memory-Diskussion 1.5.

### 13. Faktisches Memory (Schicht 2)
Persistente Fakten-DB mit Embedding-Retrieval. "Memory" als eigenes Konzept in der UI, du kannst Memories explizit hinzufügen oder löschen. "Vergiss, dass Florian XY gesagt hat" als Mechanismus.
**Größe:** L · **Priorität:** should · **Aus:** Memory-Diskussion 1.5.

### 14. Lerngedächtnis (Schicht 3)
Twin lernt aus Approves/Rejects/Edits. Persona-Iterationen über Zeit, oder feinere Korrekturen.
**Größe:** XL · **Priorität:** nice · **Aus:** Memory-Diskussion 1.5.

### 15. Skills als ausführbare Capabilities (Schicht 1)
Twin bekommt eine Skill-Engine. Skills sind Markdown-Dateien mit definierten Aktionen (Code-Snippets, Tool-Calls, Workflows). Twin lädt relevante Skills bei Anfragen.
**Größe:** L · **Priorität:** should · **Aus:** Skills-Diskussion 1.5. (Hermes Agent von Nous Research als Referenz)

### 16. agentskills.io-Kompatibilität
Skills im Hermes/agentskills.io-Format implementieren, damit wir community-Skills nutzen können und eigene Skills portabel sind.
**Größe:** M · **Priorität:** should · **Aus:** Skills-Diskussion 1.5.

### 17. Autonome Skill-Generierung (Lernschleife)
Twin schreibt nach komplexen Tasks (5+ Tool-Calls oder definierte Trigger) eine Skill-Markdown-Datei selbst. Lernschleife wie bei Hermes.
**Größe:** XL · **Priorität:** nice · **Aus:** Skills-Diskussion 1.5.

### 18. Persona-Klarstellung: 1. Person vs. Stellvertreter-Sprech
Twin spricht aktuell teilweise in dritter Person über Markus ("checke es bei Markus"). Klären, ob das gewünscht ist (zeigt klar: Twin ist nicht Markus selbst) oder ob er als "ich" konsistent für Markus sprechen soll.
**Größe:** S · **Priorität:** should · **Aus:** Phase-2-Live-Test

---

## Strategische Optionen, die später entschieden werden müssen

### Hermes Agent als Backend?
Option A: Eigene Skill-Engine bauen (twin-lab als geschlossenes System).
Option B: Hermes Agent als Backend nutzen, twin-lab als A2A + Mandate + Persona-Layer obendrauf.
Mehr Recherche und Strategie-Sparring nötig, bevor die Wette steht.

### Zentralisierungsgrad der Bridge
Phase 2: zentrale Bridge.
Phase 3: Föderation (Matrix-Modell), mehrere Bridges können sprechen.
Phase 4: Voll-P2P mit DIDs für Identität.
Optional Phase 5: Wenn Wertübertragung nötig — Blockchain als Bezahlebene OBEN AUF Messaging.

### Memory-Phase einschieben?
Vorschlag aus Diskussion: Phase 2.5 = Konversations-Memory + Faktisches Memory, BEVOR Föderation (Phase 3). Begründung: Memory verbessert Twin-Qualität sofort, Föderation macht erst Sinn wenn Twins wertvoll sind.

---

## Notiz für später

Sammle weiter Punkte, die im Sparring auftauchen. Nicht jeder Punkt muss eine Phase werden — manches ist Polishing, manches ist Architektur. Die Aufteilung S/M/L/XL und must/should/nice hilft beim Priorisieren wenn die Liste lang wird.
