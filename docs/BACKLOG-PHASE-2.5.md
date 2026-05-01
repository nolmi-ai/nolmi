# Backlog Phase 2.5 und später

Stand: 1. Mai 2026, 21:00 Uhr — nach Sub-Schritt 2.5.2d (Multi-Twin Runtime + Florian-Twin) abgeschlossen.

Format: Punkte mit Größe (S/M/L/XL) und Priorität (must/should/nice).

---

## Architektur-Entscheidungen (Stand 1. Mai 2026)

Wichtige Weichen, die heute final gestellt wurden — Referenz für alle weiteren Items:

**Hybrid-Strategie statt Hermes-Adoption.** Eigenes TypeScript-Backend, lernend von Hermes Agent (Nous Research), MCP-fähig in Phase 3. Begründung: Easy-Setup für externe User (Multi-Tenant SaaS, kein Self-Hosting), Verleihbarer-Twin-Vision (statt Hermes' "mein Assistent"-Ansatz), Stack-Konsistenz (TypeScript statt Python).

**Memory-Phase als Phase 3.** Nach Phase 2.5 (Multi-Tenant), vor Phase 4 (Multi-Channel/Föderation). Begründung: Memory macht Twins inhaltlich tiefer, Multi-Channel macht sie erreichbar — Reihenfolge zählt.

**Memory in 4 Schichten:** Conversation, Episodic, Semantic, Procedural. Implementierung über sqlite-vec (Episodic), `facts.md` (Semantic), strukturierte Skill-Files (Procedural).

**Skills in 4 Layer:** Capability → Tool → Skill → Mandate. Skill-System ist Vorbedingung für externe Tool-Integrationen (Hyperbrowser, MCP-Server-Tools).

**Per-Twin Konfiguration als Pattern.** LLM-Config heute, Skill-Config in Phase 3, Channel-Config in Phase 4 — alle pro Twin, nicht pro Plattform. Konsistent mit Multi-Tenant-Vision.

---

## Phase 2.5 — Konkrete nächste Sub-Schritte

Geordnete Liste für die kommenden Sessions. Jeder Sub-Schritt ist abgeschlossen testbar.

### 2.5.2e — Per-Twin LLM-Config aus DB
Beide Twins erben aktuell `TWIN_LLM_*`-ENV. Sollten pro Twin separat konfigurierbar sein (Markus: claude-opus-4-7, Florian: gpt-5.5, Ronja: lokales Llama). LLM-Config kommt schon aus `twin_profiles.llm_config`-JSON, aber Bootstrap überschreibt mit ENV. Ablauf: Bootstrap-Script liest pro Twin individuelle LLM-ENV-Variablen (`MARKUS_LLM_PROVIDER`, `FLORIAN_LLM_MODEL`, etc.), Default-Fallback auf gemeinsame `TWIN_LLM_*`.
**Größe:** S · **Priorität:** must · **Aus:** Sub-Schritt 2d Caveat #9

### 2.5.3 — Onboarding-Flow Web-UI Wizard
Neuer User soll Twin selbst bootstrappen können — ohne Terminal, ohne `pnpm twin:bootstrap`. Web-UI-Wizard: Persona-Markdown-Editor, Mandate-Picker (Templates), LLM-Provider/Modell auswählen, API-Key eingeben (verschlüsselt), Bridge wird automatisch zugewiesen. Voraussetzung für Multi-Tenant-Vision.
**Größe:** L · **Priorität:** must · **Aus:** Multi-Tenant-Strategie

### 2.5.4 — User-Auth (Email/Passwort + SSO)
Heute: kein Auth-Layer, jeder mit Browser-Zugriff sieht alle Twins. Phase 2.5.4: Login per Email/Passwort, später SSO. `users`-Tabelle, `owner_user_id` in `twin_profiles` wird belegt, Twin-UI nur für Owner sichtbar (oder geteilt mit explicit-shared-Users). Vorbedingung für Public-Deployment.
**Größe:** L · **Priorität:** must · **Aus:** Multi-Tenant-Strategie

### 2.5.5 — Notification-System für Pending
Heute: Pending nur sichtbar wenn Settings-Page offen. Sub-Schritt 2.5.5: Browser-Notifications, Email-Notifications (resend.com), später Push. Konfigurierbar pro Twin (welche Events triggern Notifications).
**Größe:** M · **Priorität:** should · **Aus:** UX-Lücke

### 2.5.6 — Production-Deployment Web auf VPS
Web-UI lokal-only heute. Sub-Schritt 2.5.6: Deploy auf VPS unter `app.twin.harwayexperience.com`, mit User-Auth aus 2.5.4, Bridge bleibt unter `bridge.twin.harwayexperience.com`. Multi-Tenant production-ready.
**Größe:** L · **Priorität:** must · **Aus:** Multi-Tenant-Strategie

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
In Phase 1 und 2 explizit ausgeschlossen — Files in `docs/` sind die Source of Truth. Phase 2.5.3 (Onboarding-Wizard) öffnet diese Tür wieder.
**Größe:** L · **Priorität:** nice · **Aus:** Phase-1-Scope-Disziplin

### 11. Persona-Klarstellung: 1. Person vs. Stellvertreter-Sprech
Twin spricht aktuell teilweise in dritter Person über Markus ("checke es bei Markus"). Klären, ob das gewünscht ist (zeigt klar: Twin ist nicht Markus selbst) oder ob er als "ich" konsistent für Markus sprechen soll.
**Größe:** S · **Priorität:** should · **Aus:** Phase-2-Live-Test

---

## Aus Phase 2.5 (heute Abend) entstanden

### 12. Anthropic-Persona Umlaut-Bug
Claude (anthropic/claude-opus-4-7) generiert in Markus' Persona Antworten ohne Umlaute ("weiss" statt "weiß", "Gespraechen" statt "Gesprächen"). Florian-Persona zeigt das Problem nicht. Fix: Umlaut-Direktive explizit in `docs/persona.md` ergänzen ("Schreibe immer mit korrekten deutschen Umlauten ä/ö/ü/ß").
**Größe:** S · **Priorität:** must · **Aus:** Sub-Schritt 2c/2d Live-Test

### 13. metadata_json in twin_profiles ergänzen
Aktuell hardcoded `{}` im Boot — Persona-Metadata (Verbindungen, Tags, etc.) hat keine DB-Spalte. Migration 004 für `metadata_json TEXT`-Spalte. Genutzt u.a. für Beziehungs-Mapping ("Florian ist Co-Founder von Markus").
**Größe:** S · **Priorität:** should · **Aus:** Sub-Schritt 2c Caveat

### 14. Owner-Recognition im System-Prompt
Twin behandelt aktuell jeden Web-UI-Chat als Fremder, auch wenn der Owner selbst chattet. Live-Test heute: Markus fragt "Wer bin ich für dich?" → Twin antwortet "Du bist jemand, der mit meinem Twin schreibt". Konzeptionell falsch wenn Owner authentifiziert ist. Fix kommt mit User-Auth in 2.5.4: System-Prompt erweitert um "Du sprichst gerade mit deinem Owner @markus" wenn `req.user_id == twin.owner_user_id`.
**Größe:** S · **Priorität:** should · **Aus:** Sub-Schritt 2c Live-Test, blockt auf 2.5.4

### 15. Footer-Text aktualisieren
Footer zeigt noch "phase 1 · closed twin · läuft lokal". Ist heute durch Phase 2 + Phase 2.5d überholt. Update auf "phase 2.5 · multi-twin · läuft lokal" oder dynamisch aus DB ("2 Twins aktiv · Bridge live").
**Größe:** S · **Priorität:** nice · **Aus:** Sub-Schritt 2γ Live-Test

### 16. Backward-Compat-Aliases entfernen
Sub-Schritt 2d hat alte Pfade (`/chat`, `/twin-profile`, `/audit`, `/audit/pending`, etc.) als Aliases zu `/twins/@markus/...` umgeleitet. Sollte nach komplettem UI-Refresh-Cycle entfernt werden — sonst dauerhafter Tech-Debt.
**Größe:** S · **Priorität:** should · **Aus:** Sub-Schritt 2d Caveat #5

### 17. Stream-Page auf Multi-Twin migrieren
`/stream` zeigt aktuell @markus via Legacy-Alias. Neue Route `/stream/[handle]/page.tsx` analog zur Chat-Route. Backend-Routes `/twins/:handle/stream` existieren bereits.
**Größe:** S · **Priorität:** should · **Aus:** Sub-Schritt 2d Caveat #2

### 18. @-Char in URLs decodieren bei Display-Output
Chat-Header zeigt `%40florian` statt `@florian` (URL-encodierter `@`). Backend-Routes akzeptieren beides, aber UI-Display sollte decoded sein. Einmal `decodeURIComponent()` an den richtigen Stellen.
**Größe:** S · **Priorität:** nice · **Aus:** Sub-Schritt 2d Live-Test

### 19. Hermes Agent als Backend evaluieren — ENTSCHIEDEN
Strategische Option, die heute final geklärt wurde: **Nein.** Hybrid-Strategie — eigenes TypeScript-Backend mit Hermes-Inspirationen (Profile-Mechanismus, FTS5 Session Search, agentskills.io-Format). Begründung in Architektur-Entscheidungen oben.

---

## Phase 3 — Memory + Skills + Tools

Memory-Schichten und Skill-System. Vor Phase 4. Aufwand-Cluster.

### 20. Konversations-Memory (Schicht 1 — Conversation)
Frühere Chats und Twin-Konversationen als komprimierter Kontext bei jeder neuen Anfrage. Stale-aware (Memories älter als X Wochen werden weggekippt, wenn nicht aktiv referenziert). Implementierung via Sliding-Window mit Auto-Summary.
**Größe:** M · **Priorität:** should · **Aus:** Memory-Diskussion 1.5.

### 21. Episodic Memory (Schicht 2 — Episodic)
Konkrete Ereignisse mit Vector-Embeddings, retrievable via Similarity. sqlite-vec als lokaler Vector-Store. Twin "erinnert" sich an spezifische Events ("Florian hat letzte Woche XY gesagt").
**Größe:** L · **Priorität:** should · **Aus:** Memory-Diskussion 1.5.

### 22. Semantic Memory (Schicht 3 — Semantic)
Persistente Fakten-DB als `facts.md` plus structured KV-Store. "Memory" als eigenes Konzept in der UI, du kannst Memories explizit hinzufügen oder löschen. "Vergiss, dass Florian XY gesagt hat" als Mechanismus.
**Größe:** L · **Priorität:** should · **Aus:** Memory-Diskussion 1.5.

### 23. Procedural Memory (Schicht 4 — Procedural)
Lerngedächtnis. Twin lernt aus Approves/Rejects/Edits. Persona-Iterationen über Zeit, oder feinere Korrekturen. Hermes-style: nach komplexen Tasks (5+ Tool-Calls) schreibt der Twin eine Skill-Markdown selbst.
**Größe:** XL · **Priorität:** nice · **Aus:** Memory-Diskussion 1.5.

### 24. MCP-Client-Implementierung
Twin als MCP-Client, kann Tools von externen MCP-Servern nutzen. Standard-Compliance, damit Skills aus dem MCP-Ökosystem ohne Custom-Adapter angeschlossen werden können.
**Größe:** L · **Priorität:** must · **Aus:** Skills-Strategie

### 25. Skill-System (4-Layer Capability/Tool/Skill/Mandate)
Skill-Engine mit klarer Hierarchie: Capability (was kann der Twin), Tool (welche API/Lib), Skill (Markdown-File mit definierter Aktion), Mandate (was darf der Twin autonom). Vorbedingung für externe Tools.
**Größe:** XL · **Priorität:** must · **Aus:** Skills-Diskussion 1.5.

### 26. agentskills.io-Kompatibilität
Skills im Hermes/agentskills.io-Format implementieren, damit wir community-Skills nutzen können und eigene Skills portabel sind.
**Größe:** M · **Priorität:** should · **Aus:** Skills-Diskussion 1.5.

### 27. Hyperbrowser als Web-Browser-Skill
Cloud-Browser-Infrastruktur (hyperbrowser.ai, Y Combinator backed) als Skill-Tool. Twins können Web navigieren, scrapen, Forms ausfüllen — autonomes Web-Handling. Use-Cases: Web-Research für Konversationen, Form-Filling mit Approval-Gate, A2A-Erweiterung (Twins navigieren zu URLs, die andere Twins teilen). Vorbedingung: Skill-System (#25). Per-Twin Setup analog zu LLM-Config. Pricing ab $99/mo Basic, skaliert nach Proxy- und CAPTCHA-Volumen. Alternativen evaluieren: Browserbase/Stagehand, Browser Use (Open-Source), Skyvern (Computer-Vision-basiert), Lightpanda. Tool-Abstraktion über Provider — analog zur Vercel AI SDK für LLM.
**Größe:** L · **Priorität:** should · **Aus:** Backlog-Anregung Markus, 1. Mai 2026 Abend

### 28. Autonome Skill-Generierung (Lernschleife)
Twin schreibt nach komplexen Tasks (5+ Tool-Calls oder definierte Trigger) eine Skill-Markdown-Datei selbst. Lernschleife wie bei Hermes. Überschneidet mit Procedural Memory (#23).
**Größe:** XL · **Priorität:** nice · **Aus:** Skills-Diskussion 1.5.

---

## Phase 4 — Multi-Channel + Föderation

Twins werden überall erreichbar, Bridge-Architektur dezentralisiert.

### 29. Multi-Channel-Adapter — Owner-Mode
Twin via Telegram/WhatsApp/Signal/iMessage erreichbar — zuerst nur für Owner selbst (nicht für externe Schreiber). Telegram zuerst (Bot-API einfach, ~2-3 Tage Code), dann WhatsApp (Meta-Business-API, KYC-Bürokratie, ~5-7 Tage), dann Signal/iMessage. Channel-Adapter pro Plattform mit einheitlicher interner API. Auth pro Channel: Sender-ID mappt auf User in Twin-DB.
**Größe:** L · **Priorität:** should · **Aus:** Backlog-Anregung Markus, 1. Mai 2026 Abend

### 30. Multi-Channel-Adapter — Public-Mode
Externe schreiben Twin via Channel an, Twin entscheidet ob er antwortet (Mandate-Layer wird kritisch). Zusätzlicher Sicherheits-Layer ggü. Owner-Mode. DSGVO-Erwägungen (WhatsApp-Geschäftskonto, Datenfluss US-Anbieter).
**Größe:** L · **Priorität:** nice · **Aus:** Backlog-Anregung Markus, 1. Mai 2026 Abend

### 31. Föderation — Mehrere Bridges sprechen miteinander
Phase 2 hat zentrale Bridge. Phase 4 = mehrere Bridges können sprechen (Matrix-Modell). Twin auf Bridge-A kann mit Twin auf Bridge-B reden, ohne dass beide auf derselben Bridge registriert sind.
**Größe:** XL · **Priorität:** nice · **Aus:** Architektur-Diskussion

### 32. P2P mit DIDs (Phase 5+)
Voll-P2P, keine Bridge mehr. DIDs (Decentralized Identifiers) für Identität. Optional: Blockchain als Bezahlebene OBEN AUF Messaging — nicht als Messaging-Layer selbst.
**Größe:** XL · **Priorität:** nice · **Aus:** Strategische Vision

---

## Cross-Cutting / Architektur-Erwägungen

### 33. Twin-Konversationen als Threads (Variante 2 aus #1) — präzisiert
Verknüpft mit #1, aber präziser: `twin_conversations`-Tabelle mit `conversationId` als Thread-Anker. Pro Thread: alle Nachrichten zwischen zwei Twins, mit Read-Status, Last-Activity. UI: Conversation-Liste in Settings, Klick öffnet vollen Thread.
**Größe:** L · **Priorität:** should · **Aus:** Phase-2-Live-Test (verknüpft mit #1)

### 34. Lokale Spiegelung des Bridge-Streams (#2) — präzisiert
Alle Twin-Nachrichten persistent in der Twin-DB, nicht nur Audits. Bridge wird zum reinen Transport, Authoritative Konversations-Historie liegt lokal pro Twin. Vorbedingung für Föderation (Phase 4).
**Größe:** XL · **Priorität:** nice · **Aus:** Phase-2-Architektur-Diskussion (verknüpft mit #2)

---

## Strategische Optionen (Stand 1. Mai 2026)

Offene Entscheidungen, die als Sparring-Punkte stehen.

### Zentralisierungsgrad der Bridge — geplant entlang Phasen
Phase 2: zentrale Bridge ✅ (live unter `bridge.twin.harwayexperience.com`).
Phase 3: bleibt zentral (Memory + Skills sind orthogonal).
Phase 4: Föderation (Matrix-Modell), mehrere Bridges können sprechen.
Phase 5: Voll-P2P mit DIDs für Identität.
Optional Phase 6: Wenn Wertübertragung nötig — Blockchain als Bezahlebene OBEN AUF Messaging.

### Skill-Sourcing Strategie
Eigene Skills schreiben vs. agentskills.io-Community-Skills nutzen vs. Hybrid. Empfehlung: Hybrid, aber erst nach Skill-System #25.

### Memory-Persistenz — lokal vs. Cloud
Memory in Phase 3 lokal in Twin-DB. Bei Multi-Tenant-Cloud-Deployment (2.5.6) muss entschieden werden: pro User isoliert in geteilter DB, oder pro User eigene SQLite-Instanz. Performance vs. Isolation-Trade-off.

### Owner-Mode vs. Public-Mode Priorisierung
In Phase 4: Owner-Mode (Markus chattet via Telegram mit eigenem Twin) deutlich einfacher als Public-Mode (externe schreiben Twin an, Mandate entscheidet). Owner-Mode zuerst, Public-Mode später wenn Mandate-Layer reif.

---

## Notiz für später

Sammle weiter Punkte, die im Sparring auftauchen. Nicht jeder Punkt muss eine Phase werden — manches ist Polishing, manches ist Architektur. Die Aufteilung S/M/L/XL und must/should/nice hilft beim Priorisieren wenn die Liste lang wird.

**Item-Dichte heute Abend:** 14 neue Items aus einem einzigen Implementierungs-Tag (Sub-Schritt 2.5.2d). Faustregel: pro Implementierungs-Sub-Schritt entstehen 5-10 Backlog-Items. Wenn die Rate höher ist, wird zu breit gebaut.
