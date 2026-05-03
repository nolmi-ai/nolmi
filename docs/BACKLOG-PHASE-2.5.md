# Backlog Phase 2.5 und später

Stand: 2. Mai 2026, Abend — nach Sub-Schritt 2.5.4 (User-Auth) abgeschlossen. Drei bestehende Twins (Markus, Florian, Heiko) zu echten User-Accounts migriert, 1:1 Twin-Mapping. Browser-Tests grün.

Format: Punkte mit Größe (S/M/L/XL) und Priorität (must/should/nice).

---

## Architektur-Entscheidungen (Stand 2. Mai 2026)

Wichtige Weichen, die geklärt sind — Referenz für alle weiteren Items:

**Hybrid-Strategie statt Hermes-Adoption.** Eigenes TypeScript-Backend, lernend von Hermes Agent (Nous Research), MCP-fähig in Phase 3. Begründung: Easy-Setup für externe User (Multi-Tenant SaaS, kein Self-Hosting), Verleihbarer-Twin-Vision (statt Hermes' "mein Assistent"-Ansatz), Stack-Konsistenz (TypeScript statt Python).

**Memory-Phase als Phase 3.** Nach Phase 2.5 (Multi-Tenant), vor Phase 4 (Multi-Channel/Föderation). Begründung: Memory macht Twins inhaltlich tiefer, Multi-Channel macht sie erreichbar — Reihenfolge zählt.

**Memory in 4 Schichten:** Conversation, Episodic, Semantic, Procedural. Implementierung über sqlite-vec (Episodic), `facts.md` (Semantic), strukturierte Skill-Files (Procedural).

**Skills in 4 Layer:** Capability → Tool → Skill → Mandate. Skill-System ist Vorbedingung für externe Tool-Integrationen (Hyperbrowser, MCP-Server-Tools).

**Per-Twin Konfiguration als Pattern.** LLM-Config heute (mit AES-256-GCM-Verschlüsselung der API-Keys), Skill-Config in Phase 3, Channel-Config in Phase 4 — alle pro Twin, nicht pro Plattform. Konsistent mit Multi-Tenant-Vision.

**Drei Deployment-Modelle:** Lokal (Self-Hosted), Hosted mit BYO-API-Key (verschlüsselt mit Server-Master-Key), Hosted mit System-API-Key (Premium-Abo). Onboarding-Wizard (2.5.3) bietet aktuell A+B, C kommt später mit Stripe-Anbindung.

**A2A-Protokoll-Strategie:** Google A2A wird in Phase 4 oder 5 als Adapter-Schicht obendrauf gebaut, nicht als Ersatz für die interne Bridge. Ökosystem-Anbindung ohne Lock-In auf eigenes Protokoll.

**Onboarding-Strategie:** Strukturierte Felder statt Markdown-Editor für non-tech-User. Persona-Markdown wird im Backend aus Form-Inputs generiert. Drei vorgefertigte Mandate-Templates (cautious/trusting/business) statt YAML-Editor. API-Key-Test-Call vor Submit, atomarer DB-Insert mit Verschlüsselung.

**User-Auth ist Vorbedingung für mehrere UX-Fixes (NEU 2. Mai).** Live-Test mit Heiko-Twin hat gezeigt, dass Owner-Recognition (#14), Approval-Routing und Owner-aware Twin-Verhalten sich nur mit echten User-Identitäten sauber lösen lassen. 2.5.4 (User-Auth) ist deshalb Pflicht-Vorbedingung für 2.5.5 und 2.5.6, plus für die UX-Refinements aus 2.5.3.

**Trust-Layer als Vorbedingung für Multi-User-Realität (NEU 3. Mai).** Mit User-Auth aus 2.5.4 hat jeder Twin einen Owner. Aber daraus ergibt sich konzeptionell ein Cluster aus drei Vertrauensstufen: Owner-Direct (kein Mandate-Check), Trusted-Twin (kein Mandate-Check, audit `trusted-bypass`), External (Mandate-Check, System-Wartemeldung). Das System ist in 2.5.4.1 gebaut, mit `trust_relationships`-Tabelle, Trust-Repo, Settings-UI-Block. Plus eine subtile Designentscheidung: Owner-Bypass gilt **nicht** für `send_to_twin` — sonst würde Tippfehler im Owner-Chat eine Bridge-Nachricht ohne Approval rausschicken. Sicherheits-Trade-off zugunsten von Approval-Gate auch für Owner.

**Reply-Detection als Backbone für A2A-Symmetrie (NEU 3. Mai).** A2A-Konversationen brauchen ein Konzept von „diese Antwort ist Reply auf eine vorherige Anfrage von uns, kein neuer Mandate-Check". Implementierung in 2.5.4.2: Bridge speichert `in_reply_to`, neuer Bridge-Endpoint `GET /messages/:id/sender` für Sender-Lookup, Twin-Service prüft `inReplyTo` + Lookup → wenn Original-Sender = wir, dann Audit `reply-received` ohne Mandate. Plus Conversation-View aus Bridge-Messages-DB statt aus lokalen Audits — symmetrische Sicht auf beiden Seiten der Konversation.

**Inbox vs. Settings als konzeptionelle Trennung (NEU 3. Mai).** Settings-Page mischte Konfiguration (Persona, Mandates, Trust) mit Aktivität (Pending, Approvals, Audit). Reorganisation in 2.5.4.3: neue `/inbox`-Page mit Pending-Approvals + Letzte Approvals + Audit-Log. Settings nur noch Twin-Profil + Vertraute Twins + Persona-Hilfe. Plus Top-Nav-Tab mit Live-Badge (Pending-Count via SSE-Events `pending-added` / `pending-resolved`).

**Status-Konsistenz als Audit-Reporting-Hygiene (NEU 3. Mai).** Drei Bypass-Pfade (`owner-direct`, `owner-direct-send`, `trusted-bypass`) verwendeten initial `status: "approved"`, was semantisch falsch ist (kein Approval-Workflow gefunden). Heute auf `"executed"` korrigiert. Mandate-Check-Pfad behält `"approved"` — dort ist das semantisch korrekt (Mandate-Check ist passiert und positiv ausgegangen).

---

## Phase 2.5 — Konkrete nächste Sub-Schritte

Geordnete Liste für die kommenden Sessions. Jeder Sub-Schritt ist abgeschlossen testbar.

### 2.5.2e — Per-Twin LLM-Config aus DB ✅
**Abgeschlossen 2. Mai 2026 vormittags.** Encryption-Infrastruktur etabliert (AES-256-GCM, Master-Key in ENV), Per-Twin ENV-Override-Pattern (`<NAME>_LLM_*` mit Fallback auf `TWIN_LLM_*`), Bootstrap mit Verschlüsselung, Settings-UI mit API-Key-Maske + "verschlüsselt in DB"-Hinweis. 11 Files, +366/-40. Vorbereitung für Multi-Tenant-Hosting in 2.5.6.

### 2.5.3 — Onboarding-Flow Web-UI Wizard ✅
**Abgeschlossen 2. Mai 2026 mittags.** Web-UI-Wizard mit 8 Schritten (Pfad-Wahl + 7 Konfigurations-Blöcke), strukturierte Persona-Felder, 3 Mandate-Templates, API-Key-Test-Call mit Live-Validation, atomarer DB-Insert. 6 neue Files (5 Backend-Onboarding-Module + 1 UI-Wizard-Page), 4 modifizierte Files. Heiko Gregor (@heiko) als erster externer User-Test erfolgreich angelegt und Live-Chat-validiert. +1789/-7. Bekannte UX-Limitationen siehe Items #37, #38, #39 unten.

### 2.5.4 — User-Auth (Email/Passwort) ✅
**Abgeschlossen 2. Mai 2026 abends.** Migration 005 (users-Tabelle, bcrypt-gehashtes Passwort), iron-session via sealData/unsealData mit 7-Tage-Cookie, 4 Auth-Endpoints (register, login, logout, me), Owner-Check für alle `/twins/:handle/*`-Routes, Frontend-Middleware für Cookie-Presence, Login-Page mit `?next=`-Honor, Onboarding-Wizard erweitert um AccountBlock (3 Modi: Login/Register/Eingeloggt), Logout-Button im TwinSwitcher, CLI-Tools (`session-secret:generate`, `user:create`). Drei bestehende User migriert mit 1:1 Twin-Mapping:

- markus.baier@harway.de → @markus
- florian.ristig@harway.de → @florian
- heiko.gregor@harway.de → @heiko

Verifiziert: 11/11 Browser-Tests grün. 22 Files, +1261/-155.

Bug-Fixes während Verifikation: `@fastify/cookie` auf v11 (Fastify-5-Kompatibilität), `127.0.0.1 → localhost` durchgehend (Cookie-Origin-Trennung), Settings-Page `credentials: include` in `/twins`-Fetch, SSE/EventSource CORS-Wildcard durch Origin-Reflektion ersetzt, Auth-State-Übergänge nutzen `window.location.href` statt `router` (Hard-Nav), `/onboarding` aus `PROTECTED_PREFIXES` entfernt (AccountBlock ist public).

NICHT in 2.5.4 enthalten: Owner-Modus im System-Prompt + Approval-Bypass für Owner-Chats — beides verschoben auf 2.5.4.1.

### 2.5.4.1 — Owner-Modus + Trusted-Twins + Wartemeldung ✅
**Abgeschlossen 3. Mai 2026 vormittags.** Drei Vertrauensstufen für eingehende Anfragen implementiert: Owner-Direct (User eingeloggt + Owner → kein Mandate-Check, audit `owner-direct`/`owner-direct-send`), Trusted-Twin (in Trust-Liste → kein Mandate-Check, audit `trusted-bypass`), External (Mandate-Check wie bisher, plus System-Wartemeldung an Anfrager).

Migration 006 (`trust_relationships` mit `twin_id`, `trusted_handle`, `note`, `created_at`, `created_by_user_id`, UNIQUE-Constraint). Trust-Repo mit add/remove/list/findById/isTrusted. Trust-Routes (GET/POST/DELETE `/twins/:handle/trust`). Owner-Bypass in `chat()`-Methode, Trusted-Bypass in `receiveBridgeMessage()`. Settings-UI-Block „Vertraute Twins" mit Add/Remove. Test-Skript `test-trust-flow.ts` mit 5 Steps. Löst Backlog #14 (Owner-Recognition) und #38 (System-Wartemeldung).

Wichtige Designentscheidung: Owner-Bypass gilt nicht für `send_to_twin` — bleibt mandate-gated, sonst würde Tippfehler im Owner-Chat eine Bridge-Nachricht ohne Approval rausschicken.

### 2.5.4.1.1 — Bridge-Schema-Hotfix für Loop-Bug ✅
**Abgeschlossen 3. Mai 2026 vormittags.** Live-Test 2.5.4.1 zeigte Infinite-Loop: Wartemeldungen wurden über Bridge gesendet, aber Bridge-Schema hatte kein Feld zur Markierung als System-Message. Empfänger-Twin behandelte Wartemeldung wie neue Anfrage → eigene Wartemeldung zurück → Endlos-Loop. 25+ Audits in 280ms.

Migration 002 (Bridge): `message_type TEXT NOT NULL DEFAULT 'twin'` plus Index. Bridge-Init-Script auf `schema_migrations`-Tracker umgebaut mit Backward-Compat-Stempel für 001_init.sql. MessageType-Validation in POST `/messages`. Twin-Service-Filter: empfangene `messageType==="system"` → audit `system-message-received`, kein LLM-Call, kein Mandate-Check. Verifiziert: 11 Audits statt 25, alle Loop-Detection-Schwellen unterschritten.

### 2.5.4.2 — Reply-Detection + A2A-Konversations-UI ✅
**Abgeschlossen 3. Mai 2026 mittags.** Konzeptionelles Loch: wenn @markus auf @florian-Anfrage antwortet, kommt Antwort bei @florian an und triggerte vorher einen NEUEN Mandate-Check. Florian's Settings füllten sich mit „Pendings", die eigentlich Antworten auf seine eigenen Anfragen waren.

Migration 007 (`read_at`-Spalte in audit + Partial-Index für unread). Bridge-Endpoint GET `/messages/:id/sender` für Sender-Lookup (zur Reply-Detection). BridgeClient.lookupSender (404→null, sonst throw). Reply-Detection-Block in `receiveBridgeMessage`: wenn `inReplyTo` gesetzt UND `lookupSender(inReplyTo).fromHandle === unser eigener Handle` → audit `reply-received`, kein Mandate-Check, SSE-Event `reply-received`.

Plus Conversation-Endpoint umgebaut: liest jetzt aus Bridge-Messages-DB statt aus lokalen Audits, reichert mit Audit-Metadaten an (capability, status, readAt). Symmetrische Konversations-Sicht auf beiden Seiten. Helper `mergeAuditIntoBridgeMessages` in `audit/conversation-merge.ts` (neu).

Chat-Page komplett-Rewrite: Sidebar mit Conversations-Liste (Direct-Chat als erster Eintrag, dann A2A-Partner), Conversation-View rechts, Modal „Neue Konversation". `ownerDirectSend` für User-initiierte A2A ohne Mandate-Check. Read-Tracking via `markRead` + 700ms-Delay-Fix für Sidebar-Indicator. SSE-Subscription auf `reply-received`-Events plus 5s-Polling als Backup.

Live-verifiziert um 10:52 mit Reply-Detection-Audit nach Florian-Approval (35 Sek nach Markus-Send).

### 2.5.4.3 — Inbox + Settings-Reorganisation + Conversation-Symmetrie ✅
**Abgeschlossen 3. Mai 2026 nachmittags.** Settings-Page-Konzeptproblem: mischte Konfiguration (Persona, Mandates, Trust) mit Aktivität (Pending, Approvals, Audit). Plus drei UI-Bugs aus 2.5.4.2 Live-Test: Sidebar-Indicator unzuverlässig, Direction-Render zeigt alle Messages als „DU", Conversation-Asymmetrie (Florian sieht weniger Messages als Markus).

Neue `/inbox`-Page (`apps/web/app/inbox/page.tsx`) mit drei Sektionen: Pending-Approvals (chronologisch), Letzte Approvals (mit „In Zwischenablage kopieren"), Audit-Log. Auth-protected via Middleware. Top-Nav-Komponente extrahiert (`apps/web/components/TopNav.tsx`) mit `chat | inbox | stream | settings`-Tabs plus Live-Badge mit Pending-Count via SSE-Events `pending-added` / `pending-resolved` (neu in `audit/service.ts`).

Settings-Page gekürzt: nur Twin-Profil, Vertraute Twins, Persona-und-Mandates-Hilfe. Conversation-View neu: Bridge-Messages mit klarer Direction-Differenzierung (DU rechts, Partner-Display-Name links, System zentriert kursiv). Mark-Read-Delay 700ms hartcodiert vor mark-read-Fire. Plus Status-Konsistenz-Fix: `owner-direct`, `owner-direct-send`, `trusted-bypass` von initial `"approved"` auf `"executed"` (Mandate-Check-Pfad behält `"approved"`).

Live-Tests: Top-Nav mit Badge funktioniert, Inbox sauber strukturiert, Settings sauber gekürzt, Conversation-Symmetrie verifiziert (Florian sieht jetzt vollen Verlauf inklusive System-Messages), Sidebar-Indicator zeigt roten Punkt.

28 Files, +3401/-368. Single-Tag-Commit `f67a7a0`.

### 2.5.5 — Notification-System für Pending
**Größe:** M · **Zeitfenster:** 1-2 Sessions (~4-6h)

Heute: Pending nur sichtbar wenn Settings-Page offen.
- Browser-Notifications (Web Push API)
- Email-Notifications via resend.com (Konto vorhanden)
- Konfigurierbar pro Twin: welche Events triggern Notifications
- Vorbedingung: 2.5.4 (User-Auth, weil Notification-Routing pro User)

### 2.5.6 — Production-Deployment Web auf VPS
**Größe:** L · **Zeitfenster:** 1-2 Sessions (~4-6h)

Web-UI deploy unter `app.twin.harwayexperience.com`:
- Next.js Production-Build
- Docker-Container, analog zur Bridge
- Traefik routet `app.*` auf den Container
- HTTPS via existierendem Let's Encrypt-Setup
- DB-Persistenz via Volume-Mount
- ENV-Variablen für API-URLs (Bridge, etc.)
- Master-Key in produktions-tauglichem Vault (nicht mehr in ENV-Datei)
- Vorbedingung: 2.5.4 (User-Auth) für Public-Access-Kontrolle

---

## Phase 2.5 Total

**Zeitfenster für Rest:** ~10-16h Arbeit auf 5-7 Sessions verteilt.
**Realistisch bei 4h/Tag:** ~1,5-2 Wochen Kalenderzeit.
**Definition of Done für Phase 2.5:** Externer User kann sich registrieren, eigenen Twin onboarden, mit dem Twin chatten, Pending approven, Twin verleihen. Multi-Tenant-SaaS funktional unter `app.twin.harwayexperience.com`.

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
In Phase 1 und 2 explizit ausgeschlossen — Files in `docs/` sind die Source of Truth. Phase 2.5.3 (Onboarding-Wizard) hat den Initial-Setup gelöst, aber **nicht** die spätere Bearbeitung. Twin-User können heute ihre Persona/Mandates nur durch Re-Bootstrap oder direkte DB-Edits ändern.
**Größe:** L · **Priorität:** should · **Aus:** Phase-1-Scope-Disziplin

### 11. Persona-Klarstellung: 1. Person vs. Stellvertreter-Sprech
Twin spricht aktuell teilweise in dritter Person über Markus ("checke es bei Markus"). Klären, ob das gewünscht ist (zeigt klar: Twin ist nicht Markus selbst) oder ob er als "ich" konsistent für Markus sprechen soll. Verknüpft mit #14 (Owner-Recognition) — Stellvertreter-Sprech ist im A2A-Modus richtig, im Web-UI-Owner-Modus eher nicht.
**Größe:** S · **Priorität:** should · **Aus:** Phase-2-Live-Test

---

## Aus Phase 2.5 entstanden

### 12. Anthropic-Persona Umlaut-Bug
Claude (anthropic/claude-opus-4-7) generiert in Markus' Persona Antworten ohne Umlaute ("weiss" statt "weiß", "Gespraechen" statt "Gesprächen", "beschaeftigt" statt "beschäftigt"). Florian-Persona zeigt das Problem nicht durchgängig — Hypothese: Persona-Markdown-Sprache beeinflusst LLM-Output. Fix: Umlaut-Direktive explizit in `docs/persona.md` ergänzen ("Schreibe immer mit korrekten deutschen Umlauten ä/ö/ü/ß").
**Größe:** S · **Priorität:** must · **Aus:** Sub-Schritt 2c/2d/2e/2.5.3 Live-Tests

### 13. metadata_json in twin_profiles ergänzen
Aktuell hardcoded `{}` im Boot — Persona-Metadata (Verbindungen, Tags, etc.) hat keine DB-Spalte. Migration 005 für `metadata_json TEXT`-Spalte. Genutzt u.a. für Beziehungs-Mapping ("Florian ist Co-Founder von Markus").
**Größe:** S · **Priorität:** should · **Aus:** Sub-Schritt 2c Caveat

### 14. Owner-Recognition im System-Prompt — präzisiert nach 2.5.3 Live-Test
Twin behandelt aktuell jeden Web-UI-Chat als Fremder, auch wenn der Owner selbst chattet.

Live-Test 2.5.3: Heiko-Twin antwortet "Diese Anfrage habe ich an **Markus** zur Freigabe weitergeleitet". Markus ist aber nicht Heikos Owner — der Twin hat aus seiner Persona-Beziehungs-Liste geraten und den ersten Eintrag als "Owner" interpretiert. Das ist konzeptionell falsch und verrät private Beziehungs-Informationen.

Plus: Web-UI-Chat überspringt Approval-Flow für Markus (`requires_approval=false` in seinen Mandates), aber **nicht** für Heiko (`cautious`-Template hat `requires_approval=true`). Das ist die Logik wie spezifiziert, aber UX-mässig falsch — der Owner sollte mit seinem eigenen Twin chatten können ohne sich selbst approven zu müssen.

Verknüpft mit #33 (Mandate-basierte Approval-Logik) und #38 (Approval-Wartemeldung als System-Antwort).

Fix kommt mit User-Auth in 2.5.4: System-Prompt erweitert um "Du sprichst gerade mit deinem Owner @heiko" wenn `req.user_id == twin.owner_user_id`. Plus: Approval-Logic wird `req.user_id == twin.owner_user_id` als Bypass werten.
**Größe:** M · **Priorität:** must · **Aus:** Sub-Schritt 2c+2e+2.5.3 Live-Tests, blockt auf 2.5.4

### 15. Footer-Text aktualisieren
Footer zeigt noch "phase 1 · closed twin · läuft lokal". Ist heute durch Phase 2 + Phase 2.5e + 2.5.3 überholt. Update auf "phase 2.5 · multi-twin · läuft lokal" oder dynamisch aus DB ("3 Twins aktiv · Bridge live · API-Keys verschlüsselt").
**Größe:** S · **Priorität:** nice · **Aus:** Sub-Schritt 2γ Live-Test, durchgängig sichtbar

### 16. Backward-Compat-Aliases entfernen
Sub-Schritt 2d hat alte Pfade (`/chat`, `/twin-profile`, `/audit`, `/audit/pending`, etc.) als Aliases zu `/twins/@markus/...` umgeleitet. Sollte nach komplettem UI-Refresh-Cycle entfernt werden — sonst dauerhafter Tech-Debt.
**Größe:** S · **Priorität:** should · **Aus:** Sub-Schritt 2d Caveat #5

### 17. Stream-Page auf Multi-Twin migrieren
`/stream` zeigt aktuell @markus via Legacy-Alias. Neue Route `/stream/[handle]/page.tsx` analog zur Chat-Route. Backend-Routes `/twins/:handle/stream` existieren bereits.
**Größe:** S · **Priorität:** should · **Aus:** Sub-Schritt 2d Caveat #2

### 18. @-Char in URLs decodieren bei Display-Output
Chat-Header zeigt `%40florian` statt `@florian` (URL-encodierter `@`). Backend-Routes akzeptieren beides, aber UI-Display sollte decoded sein. Einmal `decodeURIComponent()` an den richtigen Stellen.
**Größe:** S · **Priorität:** nice · **Aus:** Sub-Schritt 2d Live-Test, in 2.5.3 erneut sichtbar (Chat-Header zeigt "%40heiko")

### 19. Hermes Agent als Backend evaluieren — ENTSCHIEDEN
Strategische Option, die geklärt wurde: **Nein.** Hybrid-Strategie — eigenes TypeScript-Backend mit Hermes-Inspirationen (Profile-Mechanismus, FTS5 Session Search, agentskills.io-Format). Begründung in Architektur-Entscheidungen oben.

### 33. Mandate-basierte Approval-Logik auch im Web-UI
Heute: Web-UI-Chat überspringt Approval-Flow für Markus, aber blockt für Heiko (cautious). A2A-Eingang nutzt Approval. Konzeptionell unklar: was, wenn Markus im Web-UI eine sensitive Antwort generieren lässt, die er sich nochmal anschauen will? Vorschlag: Mandates differenzieren `requires_approval` per Channel. RESPOND_TO_CHAT könnte für Owner-Chats `false`, für externe `true` sein. Verknüpft mit #14 (Owner-Recognition).
**Größe:** M · **Priorität:** should · **Aus:** Live-Test 2.5.2e, in 2.5.3 verstärkt sichtbar

### 34. Master-Key-Rotation CLI
Heute: bei Verdacht auf Kompromittierung des Master-Keys oder regulärer Rotation muss manuell entschlüsselt und neu verschlüsselt werden. Sauber: CLI-Tool `pnpm key:rotate` das den alten Master-Key liest, alle `apiKeyEncrypted` entschlüsselt, mit neuem Key verschlüsselt, in DB schreibt. Out of scope für 2.5.2e.
**Größe:** S · **Priorität:** nice · **Aus:** 2.5.2e Caveat

### 35. Provider-aware API-Key-Maskierung
Heute: `maskApiKey` zeigt `sk-a…IgAA` für Anthropic-Keys (sk-ant-…) — Provider-Präfix wird abgeschnitten. Provider-Erkennung im Mask: `sk-ant-…IgAA` für Anthropic, `sk-…XYZ` für OpenAI, etc. Schöner für Debugging, leakt minimal mehr Bits. Konsistenz mit Bridge-Token-Mask überprüfen.
**Größe:** S · **Priorität:** nice · **Aus:** 2.5.2e Caveat

### 37. Hot-Reload für TwinServiceRegistry — NEU aus 2.5.3
Heute: nach Onboarding-Submit muss `pnpm dev` neu gestartet werden, damit der neue Twin in der laufenden Runtime aktiv wird. Submit-Response trägt `requiresRestart: true`, Wizard redirected zu `/chat/<handle>`, dort scheitert Chat bis zum Restart.

Implementation: `addTwin(twinId)`-Methode auf `TwinServiceRegistry`, die das Profil aus DB lädt, `buildEntry` macht, `bridgeStream.connect()` ruft, in die Map einträgt. Race-Conditions zu durchdenken (was wenn der gleiche Twin gleichzeitig per Wizard und ENV-Bootstrap angelegt wird — UNIQUE-Constraint fängt das DB-seitig ab, aber die in-Memory-Map muss das auch sauber handhaben).

Konzeptionell straightforward — nicht in 2.5.3-Scope gewesen. Kann unabhängig vom Auth-Layer gebaut werden.
**Größe:** M · **Priorität:** should · **Aus:** 2.5.3 Caveat #1

### 38. Approval-Wartemeldung als System-Antwort statt LLM-Improvisation — NEU aus 2.5.3
Heute: wenn ein Twin im Approval-Modus ist, generiert er trotzdem eine LLM-improvisierte Wartemeldung. Heiko hat geantwortet "Diese Anfrage habe ich an Markus zur Freigabe weitergeleitet" — falsch, weil Markus nicht sein Owner ist und der Twin den Namen aus der Beziehungs-Liste improvisiert hat.

Fix: Approval-Wartemeldung wird NICHT vom LLM generiert, sondern ist ein System-Festtext wie "Diese Anfrage liegt zur Freigabe — du erhältst die Antwort, sobald sie freigegeben ist." Kein Owner-Name, kein UI-Verweis (Settings-Tab ist unsichtbar für Nicht-Owner).

UI-mässig sollte die System-Antwort visuell anders dargestellt werden als eine echte Twin-Antwort — z.B. als graue Info-Box statt Twin-Sprechblase. Polish, nicht Architektur.

Vorteile: eliminiert Improvisations-Risiko, schneller (kein LLM-Call), spart Kosten, klares Mental-Model für den Chat-Partner.
**Größe:** S · **Priorität:** must · **Aus:** 2.5.3 Heiko-Live-Test

### 39. Cautious-Mode mit Klassifikator-Vorlauf — Phase 3 — NEU aus 2.5.3
Heute: cautious-Template hat `requires_approval=true` für RESPOND_TO_CHAT. Heißt: ALLE Chat-Anfragen gehen durch Approval, auch simple Smalltalk- oder Identitäts-Fragen wie "Wer bist du?". Das ist UX-mässig falsch — Selbstbeschreibung sollte ohne Approval beantwortbar sein.

Lösung: bevor der Twin antwortet, ein billiger 50-Token-Klassifikator-Call:
- A) Selbstbeschreibung/Begrüßung/Smalltalk → ohne Approval
- B) Inhaltliche Anfrage, Vereinbarung, Empfehlung → Approval-Pfad
- C) Sonstiges/unklar → Approval-Pfad (sicherer Default)

Vorteile: robust gegen Formulierungs-Varianten, lernfähig, billig (~$0.0005 pro Klassifikator).

Nachteile: zusätzlicher LLM-Call vor jeder Antwort, mehr Latenz (~300-500ms), zusätzliche Komplexität.

Konzeptionell ist das ein Skill-System-Feature (Capability-Layer entscheidet, ob Skill ohne Approval ausführbar ist). Deshalb auf Phase 3 verschoben, nicht in 2.5.x.
**Größe:** L · **Priorität:** should · **Aus:** 2.5.3 Heiko-Live-Test

### 40. CSRF-Token für /auth/*-Endpoints — NEU aus 2.5.4
Heute schützt nur `SameSite=Lax` auf dem Session-Cookie. Bei breiterem Deployment (echte Domain, eingebettete Iframes, Browser-Extensions, etc.) braucht es `@fastify/csrf` für tokenbasierten Schutz, um POST-CSRF-Angriffe zu blocken.
**Größe:** M · **Priorität:** should · **Aus:** 2.5.4 Caveat #5

### 41. Magic-Link Auth (passwordless) — NEU aus 2.5.4
Alternative zu Email/Passwort: User gibt Email ein, kriegt Login-Link via Email zugeschickt. Vorteil: kein Passwort-Management, sicherer (kein Rainbow-Table-Risiko, kein Password-Reuse). Vorbedingung: Email-Versand aus 2.5.5. Markus' Frage vom 02.05: "Magic Link könnten wir für die Zukunft nochmal überlegen."
**Größe:** L · **Priorität:** nice · **Aus:** 2.5.4 Architektur-Diskussion, blockt auf 2.5.5

### 42. Rate-Limiting auf /auth/login — NEU aus 2.5.4
Heute kein Rate-Limit. Bei breiterem Deployment Brute-Force-anfällig. `@fastify/rate-limit` mit konservativem Default (z.B. 5 Login-Versuche pro IP pro 15 Minuten), bei Treffer 429 mit Retry-After-Header. Plus per-Email-Tracking gegen distributed Brute-Force.
**Größe:** S · **Priorität:** should · **Aus:** 2.5.4 Caveat #6

### 43. Top-Nav auf /login + /onboarding versteckt — NEU aus 2.5.4
Heute rendert die Top-Nav (TwinSwitcher + Logout + Tabs) auf jeder Page, auch `/login`. Auf der Login-Page erscheint dann "twins: HTTP 401" und "chat/stream/settings"-Tabs, die für nicht-eingeloggte User sinnlos sind. Frontend sollte Top-Nav für Public-Routes (`/login`, `/onboarding`) anders rendern oder ganz weglassen — am saubersten via Layout-Variante oder Conditional in `layout.tsx`.
**Größe:** S · **Priorität:** should · **Aus:** 2.5.4 Live-Test, durchgängig sichtbar

### 44. Self-Service-Password-Reset — NEU aus 2.5.4
Florian und Heiko haben heute Platzhalter-Passworte von Markus per CLI bekommen. Es gibt aber keinen Weg für sie, das Passwort selbst zu ändern. CLI-Tool (`pnpm user:create` mit Update-Flag oder ein neues `user:reset-password`) reicht für heute, aber UI-Flow ("Passwort vergessen?" → Email-Link → Set-New-Password) wäre richtig. Vorbedingung: Email-Versand aus 2.5.5.
**Größe:** M · **Priorität:** should · **Aus:** 2.5.4 Migration der drei bestehenden User, blockt auf 2.5.5

---

## Aus Phase 2.5.4.1-3 entstanden

### 45. Bridge-Production-Sync nach 2.5.4.x
Production-Bridge auf VPS (`bridge.twin.harwayexperience.com`) ist seit 1. Mai unverändert (Pre-2.5.4.1, ohne `message_type`-Spalte, ohne Sender-Lookup-Endpoint, ohne neue Conversation-Endpoints). Vor dem ersten echten Multi-Maschinen-Setup oder spätestens vor Phase 2.5.6 (Web-Production-Deployment) müssen alle Migrations + Endpoint-Erweiterungen auf VPS-Bridge deployed werden. Plus: Twin-Profile in DB von `localhost:5100` auf Production-URL umstellen, per ENV-Variable schaltbar zwischen lokal und Production.
**Größe:** M · **Priorität:** must · **Aus:** 2.5.4.1-3 Implementation, Multi-Maschinen-Architektur-Klärung 3. Mai

### 46. Test-Skript Step 6+7 reparieren
`test-trust-flow.ts` Step 6 (Sender-Side Reply-Detection) und Step 7 (Read-Marker) sind heute false-negative — Skript prüft `reply-received` auf der falschen Seite oder mit zu engem Setup. Live-Test 2.5.4.2 hat Reply-Detection verifiziert (10:52 Audit nach Florian-Approval), aber Skript-Setup simuliert nur Trusted-Bypass-Pfad ohne echte Reply-Sequenz mit Mandate-Approval-Loop. Skript braucht Erweiterung: Florian sendet → Markus' Twin antwortet (über Trusted-Bypass) → Florian empfängt Antwort mit `inReplyTo` → prüfen, ob Florian-seitig `reply-received`-Audit entsteht.
**Größe:** M · **Priorität:** should · **Aus:** 2.5.4.2 + 2.5.4.3 Test-Skript-Output

### 47. Reply-Marker bei Approval-Antworten manchmal fehlend
Conversation-View zeigt Reply-Marker (`↩ reply`) nicht zuverlässig bei allen Approval-Antworten — z.B. die „Wieder ein Test"-Antwort um 13:45 in Florian's View ohne Marker, obwohl konzeptionell Reply auf vorherige Test-Message. Hypothese: Backend setzt `inReplyTo` korrekt, aber Frontend-Render verschluckt es bei bestimmten Pfaden. Vermutlich Edge-Case in `mergeAuditIntoBridgeMessages` oder in der Render-Conditional, die zwischen `reply-received` und `respond_to_twin_message` unterscheidet.
**Größe:** S · **Priorität:** nice · **Aus:** 2.5.4.3 Live-Test

### 48. Conversations-List Bridge-Roundtrip pro Partner
`fetchAllBridgeConversations` ruft `getConversationMessages` für jeden bekannten Bridge-Twin in Schleife. Bei vielen Twins teuer. Lösung: dedizierter Bridge-Endpoint `/conversations` mit Server-Aggregation, der eine Liste aller Partner mit `lastMessageAt` zurückgibt, statt N Roundtrips.
**Größe:** M · **Priorität:** nice · **Aus:** 2.5.4.3 Caveat #1

### 49. Mark-Read-Delay konfigurierbar
Aktuell 700ms hartcodiert in `chat/[handle]/page.tsx` als `MARK_READ_DELAY_MS`-Konstante. Falls UX-Feedback zu langsam/schnell kommt, oder unterschiedliche Geschwindigkeiten je nach Conversation-Typ (Direct-Chat vs. A2A) gewollt, sollte das in eine Twin-Config oder als Settings-Option ausziehbar sein.
**Größe:** S · **Priorität:** nice · **Aus:** 2.5.4.3 Caveat #3

### 50. Sidebar-Polling für Reconnect-Robustheit
SSE-Reconnect der Chat-Page funktioniert automatisch, aber wenn Connection lange weg ist und Reply-Events durchrauschen, wird die Sidebar erst beim nächsten manuellen Reload oder neuem Reply-Event aktualisiert. A2A-View hat 5s-Polling als Backstop, Direct-Chat und Sidebar nicht. Lösung: globaler Reconnect-Trigger der `loadConversations` neu aufruft, oder Sidebar-Polling alle 30s als Fallback.
**Größe:** S · **Priorität:** nice · **Aus:** 2.5.4.2 Caveat

### 51. DisplayName-Cache mit kurzer TTL
Bei jedem GET `/conversations` macht der Server einen Bridge-Roundtrip pro Partner für DisplayName-Lookup. Bei Bridge-Down: `partnerDisplayName=null`, Fallback auf Handle. Cache wäre einfach machbar — z.B. In-Memory-Map mit 60s-TTL pro Handle.
**Größe:** S · **Priorität:** nice · **Aus:** 2.5.4.2 Caveat

### 52. read_at im Audit-Log-UI sichtbar machen
Mark-Read setzt `read_at`-Spalte, aber Audit-Log-UI im Inbox zeigt das heute nicht an. Optional: kleiner Indikator in der Audit-Log-Tabelle, z.B. „gelesen 5 Min nach Empfang" als Spalte oder Tooltip. Polish, nicht Architektur.
**Größe:** S · **Priorität:** nice · **Aus:** 2.5.4.2 Caveat

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
Skill-Engine mit klarer Hierarchie: Capability (was kann der Twin), Tool (welche API/Lib), Skill (Markdown-File mit definierter Aktion), Mandate (was darf der Twin autonom). Vorbedingung für externe Tools, plus Vorbedingung für #39 (Klassifikator-Vorlauf).
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

### 36. Google A2A-Protokoll-Kompatibilität
Twins als A2A-Server zusätzlich zur internen Bridge erreichbar machen. Implementierung:
- `/.well-known/agent.json` mit Persona-Description und Skills
- A2A-Adapter, der eingehende JSON-RPC-Messages auf interne Pending-Queue mapt
- Mandate-Layer wendet Approval-Gates auf eingehende A2A-Requests an
- Ausgehende A2A-Calls: unsere Twins können andere A2A-Agenten anrufen

Vorteile: Ökosystem-Anbindung (Google ADK, CrewAI, Langgraph alle A2A-fähig), standardisierte Discovery, keine Lock-In auf eigenes Protokoll. Nachteile: Mehr Code-Pfade, Security-Komplexität (jeder im Internet kann anpingen).

Vorbedingungen: Phase 4 (Multi-Channel-Architektur), Mandate-Engine reif für externe Quellen. Aufwand: 2-3 Wochen für saubere Adapter-Schicht. Bestandteil der Föderations-Strategie.
**Größe:** L · **Priorität:** should · **Aus:** Markus' Recherche zu Google A2A Codelab, 2. Mai 2026

---

## Cross-Cutting / Architektur-Erwägungen

### Verknüpfung mit Items #1 und #2
Items #1 (Twin-Konversationen als Threads) und #2 (Lokale Spiegelung des Bridge-Streams) sind eng verknüpft. Beide adressieren das Problem, dass aktuell Audit-Log und Konversations-Historie identisch sind. Empfehlung: zusammen in einer Phase angehen, frühestens Phase 3 nach Memory-Schichten.

### Cluster Owner-Recognition (#14, #38, #33)
Drei Items hängen zusammen und sollten in 2.5.4 koordiniert angegangen werden:
- #14 Owner-Recognition: Twin weiß, wer sein Owner ist
- #33 Mandate per Channel: Owner-Chat überspringt Approval, externe nicht
- #38 Approval-Wartemeldung: kein improvisiertes Owner-Naming mehr

Plus #39 (Klassifikator-Vorlauf) ist eine orthogonale Verbesserung in Phase 3.

---

## Strategische Optionen (Stand 2. Mai 2026)

Offene Entscheidungen, die als Sparring-Punkte stehen.

### Zentralisierungsgrad der Bridge — geplant entlang Phasen
Phase 2: zentrale Bridge ✅ (live unter `bridge.twin.harwayexperience.com`).
Phase 3: bleibt zentral (Memory + Skills sind orthogonal).
Phase 4: Föderation (Matrix-Modell), mehrere Bridges können sprechen, plus A2A-Adapter (#36).
Phase 5: Voll-P2P mit DIDs für Identität.
Optional Phase 6: Wenn Wertübertragung nötig — Blockchain als Bezahlebene OBEN AUF Messaging.

### Skill-Sourcing Strategie
Eigene Skills schreiben vs. agentskills.io-Community-Skills nutzen vs. Hybrid. Empfehlung: Hybrid, aber erst nach Skill-System #25.

### Memory-Persistenz — lokal vs. Cloud
Memory in Phase 3 lokal in Twin-DB. Bei Multi-Tenant-Cloud-Deployment (2.5.6) muss entschieden werden: pro User isoliert in geteilter DB, oder pro User eigene SQLite-Instanz. Performance vs. Isolation-Trade-off.

### Owner-Mode vs. Public-Mode Priorisierung
In Phase 4: Owner-Mode (Markus chattet via Telegram mit eigenem Twin) deutlich einfacher als Public-Mode (externe schreiben Twin an, Mandate entscheidet). Owner-Mode zuerst, Public-Mode später wenn Mandate-Layer reif.

### A2A vs. eigene Bridge-Strategie
A2A wird zusätzlich gebaut, nicht statt. Eigene Bridge bleibt für Twin-Lab-spezifische Features (Mandate-Layer, Approval-Gates, eigene Persona-Modellierung). A2A ist Adapter-Schicht obendrauf für Ökosystem-Anbindung. Entscheidung in Phase 4.

---

## Lessons gelernt

Sammlung an Erkenntnissen aus Live-Tests und Implementierungs-Bugs. Kurz, abstrakt, sofort anwendbar.

### Lesson (2.5.4): Auth-State-Übergänge brauchen Hard-Navigation

`router.push` / `router.replace` / `router.refresh` lassen Komponenten gemountet — Auth-State im React-`useState` überlebt die Navigation und ist stale. `window.location.href` triggert Full-Mount, neuer Auth-State garantiert konsistent. Phase-2.5-Lösung pragmatisch. Echte Lösungen für später: Context-Provider mit Invalidation, React Query mit Tag-Invalidation, Server-Components mit `cookies()`.

### Lesson (2.5.4): CORS-Wildcard ist mit credentials inkompatibel

Bei credentialed Requests (`fetch credentials:include`, `EventSource withCredentials:true`) muss der Server eine konkrete Origin-Adresse zurückgeben — nicht Wildcard `*`. Plus `Access-Control-Allow-Credentials: true`. Browser lehnen sonst Response ab. Trap besonders bei SSE: `reply.raw.writeHead` umgeht den `@fastify/cors`-Plugin, daher manuell setzen.

### Lesson (2.5.4): Plugin-Major-Matching prüfen

`@fastify/cookie@latest` war zur Zeit der Installation noch Fastify-4-kompatibel (v9). Bei Fastify-5-Setup explizit `^11` angeben. Generell: bei `pnpm add` für `@fastify/*`-Plugins die Compat-Range prüfen, nicht blindlings latest. Die Plugin-Major-Versionierung folgt der Fastify-Major-Versionierung, aber nicht 1:1 in der Versionsnummer.

### Lesson (2.5.4): localhost vs. 127.0.0.1 sind verschiedene Origins

Auch wenn beide auf 127.0.0.1 auflösen, behandelt der Browser sie für Cookies und CORS als verschiedene Origins. Cookies gesetzt unter `localhost:3000` werden bei einem Fetch gegen `127.0.0.1:4000` nicht mitgesendet. Konsistent eine Form durchziehen — bevorzugt `localhost`.

### Wisdom (Markus, 2.5.4): Frontend-Public/Backend-Protected ist eine saubere Trennung

Beispiel: `/onboarding` ist als Frontend-Route public (User soll Account anlegen können), aber `/onboarding/submit` + `/onboarding/validate-api-key` sind Backend-protected (brauchen Login). Die Trennung erlaubt UI-Flow ohne Pre-Login, sichert aber Datenmutation. Pattern lässt sich auf weitere Onboarding/Funnel-Pages übertragen.

### Lesson (2.5.4.1.1): Bridge-Schema braucht Message-Type-Markierung von Anfang an

Wenn Bridge mehrere Message-Typen transportiert (Twin-Antworten, System-Wartemeldungen, ggf. später Acknowledgments), muss der Typ im Schema explizit sein. Sonst behandeln Empfänger jede Message gleich, was zu Loops führt: Wartemeldung → Empfänger sieht neue Anfrage → Wartemeldung zurück → Loop. Migration 002 hat das nachträglich gefixt, aber bei Schema-Design sollte Message-Typ-Feld immer drin sein, auch wenn aktuell nur ein Typ existiert. Konzeptionell: Bridge ist Transport-Schicht, Transport-Schicht muss Payload-Typ kennen.

### Lesson (2.5.4.2): Reply-Detection braucht persistente Sender-Information

Reply-Detection im Twin-Service kann nicht aus dem aktuellen Message-Payload allein entscheiden, ob eine Message eine Reply ist. `inReplyTo` zeigt nur auf eine Message-ID — wer die ursprüngliche Message gesendet hat, weiß nur die Bridge. Heißt: Reply-Detection braucht einen Lookup-Endpoint auf der Bridge (`GET /messages/:id/sender`). Generelle Lehre: Twin-zu-Twin-Logic ist nicht autark — Bridge ist mehr als Transport, sie ist auch Identitäts-Authority für vergangene Messages.

### Lesson (2.5.4.2): User-initiierte erste Send-Message ohne inReplyTo bricht Reply-Detection nicht, aber den Symmetrie-Sinn

Beim ersten Modal-Send von Markus an Florian gibt es kein `inReplyTo`. Florian's Twin sieht das als neue Anfrage, triggert Mandate-Check oder Trusted-Bypass. Das ist konzeptionell richtig (User startet bewusst Konversation), aber bedeutet: erste Send eines neuen Konversations-Threads geht durch Approval-Flow, alle Folgen-Messages sind Replies. Kein Bug, aber Designentscheidung mit Konsequenz. Plus: bei Trust kein Issue, weil Trusted-Twin direkt durchgeht.

### Lesson (2.5.4.3): UI-Reorganisation lohnt sich, wenn konzeptionelle Trennung schief ist

Settings-Page mischte Konfiguration und Aktivität. Reorganisation in zwei Pages (`/settings` für Konfig, `/inbox` für Aktivität) hat den Code nicht nur sauberer gemacht, sondern auch die Mental-Models klarer: Settings ist „was ich konfiguriere", Inbox ist „was ich erledige". Verschieben kostet 1-2 Stunden, aber rettet Wochen an „warum liegt das hier"-Frust später.

### Lesson (Status-Konsistenz): 5-Minuten-Quick-Fixes lohnen sich vor Backlog-Items

Status-Konsistenz-Fix (`approved` → `executed` für drei Bypass-Pfade) hätte ein Backlog-Item werden können. Statt dessen direkt gefixt, plus typecheck plus Frontend-Filter-Audit — 15 Minuten total. Backlog-Items mit „kosmetische Verbesserung" sind Tech-Debt, der nie angegangen wird, weil immer wichtigere Sachen anstehen. Wenn ein Fix in einer Datei mit klarer Reichweite ist und keine Testing-Reichweite hat, ist „direkt fixen" robuster als „Backlog-Item, machen wir später".

### Lesson (Workflow): Pro Sub-Schritt ein eigenes Chat-Fenster

Heute drei Sub-Schritte plus mehrere Bug-Hunts in einem Chat-Fenster. Output: Chat wurde so lang, dass Logs nicht mehr sauber teilbar waren, plus Memory-Drift bei längeren Sessions. Saubere Lehre: ein Sub-Schritt → ein Chat-Fenster, am Ende Commit + Backlog-Update. Beim nächsten Sub-Schritt frischer Chat. Plus pro Bug-Hunt-Session, die länger als 30 Min wird, separates Fenster.

### Lesson (Workflow): Komplexe Multi-Phase-Projekte brauchen ein eigenes Claude-Projekt

Bisherige Chats lebten ohne Projekt-Kontext, mit Memory aus allgemeinem HARWAY-Account. Ergebnis: bei jedem neuen Chat musste ich rekonstruieren, wo wir stehen. Plus Memory-Drift (Production-Bridge-Architektur war nicht aktiv abrufbar heute Vormittag). Lösung: eigenes Claude-Projekt „twin-lab" mit Roadmap, Backlog, Persona-Files, STAND.md hochgeladen. Memory-Trennung, Project Knowledge, sauberer Chat-Cut pro Sub-Schritt. Fünfzehn Minuten Setup, danach jede Session 30+ Minuten gespart.

### Lesson (Test-Skripte): Test-Setups müssen den primären User-Flow simulieren

`test-trust-flow.ts` testet drei Vertrauensstufen, aber simuliert keinen kompletten Reply-Cycle (Send → Approval → Reply mit `inReplyTo`). Reply-Detection wurde dadurch im Skript nicht testbar, obwohl im Live-Test (manuell via Browser) verifiziert. Generelle Lehre: Test-Skripte sollten zuerst den Hauptpfad abdecken, nicht synthetische Edge-Cases. Plus: false-negative im Test-Skript ist schlimmer als kein Test, weil es Vertrauen in Funktionalität untergräbt.

---

## Notiz für später

Sammle weiter Punkte, die im Sparring auftauchen. Nicht jeder Punkt muss eine Phase werden — manches ist Polishing, manches ist Architektur. Die Aufteilung S/M/L/XL und must/should/nice hilft beim Priorisieren wenn die Liste lang wird.

**Item-Dichte 3. Mai 2026 nachmittags:** 8 neue Items aus Sub-Schritten 2.5.4.1, 2.5.4.1.1, 2.5.4.2, 2.5.4.3 (#45 Bridge-Production-Sync, #46 Test-Skript-Reparatur, #47 Reply-Marker-Bug, #48 Conversations-Roundtrip, #49 Mark-Read-Delay-Config, #50 Sidebar-Polling, #51 DisplayName-Cache, #52 read_at im UI). Plus 2.5.4.1, 2.5.4.1.1, 2.5.4.2, 2.5.4.3 als ✅ markiert. Plus 8 Lessons aus heutigen Implementations- und Bug-Hunt-Sessions. Items insgesamt: 52 (von 44 gestern Abend, von 39 vorgestern mittag). 

**Was als Nächstes ansteht:** 2.5.5 (Notification-System) und 2.5.6 (Production-Web-Deployment). Plus Bridge-Production-Sync als #45 vor 2.5.6.
