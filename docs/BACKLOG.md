# Backlog Phase 2.5 und später

Stand: 9. Mai 2026, mittag (Tag 10) — Phase 3.2 (MCP-Client als Skill-Provider) komplett, sieben Sub-Schritte A bis G durchgezogen plus Marker-Pattern-Patch in F. Acht Commits insgesamt: `2bf1ee0` Schema+Repo, `daa03b7` Client+Lifecycle, `cd5b295` Tool-Discovery+Skill-Sync, `366ca93` Tool-Execution via AI-SDK-Tool-Bridge, `5f0f80c` BACKLOG-Update für #86-#89, `43258cf` CLI, `b58df94` Approval-Workflow (Inbox-Foundation), `bce54fb` Inline-Approval-UI im Chat. MCP-Foundation ist end-to-end produktiv: Server-Provisioning via CLI, Tool-Discovery, Tool-Execution mit Multi-Provider-Support, Approval-Workflow mit Pending-State, UI in Inbox UND Chat-Inline. Items insgesamt: 87 (84 + #90 + #91 + #92), davon drei heute neu eröffnet, keines abgeschlossen.

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

**Container-zu-Container-Hop statt Public-URL (NEU 4. Mai).** Production-Setup hat Bridge auf eigener Subdomain plus Web-Runtime auf eigener Subdomain — beide auf demselben VPS, beide hinter Traefik. Naive Annahme: Web-Runtime ruft Bridge via Public-URL `https://bridge.twin.harwayexperience.com`. Realität: viele VPS-Provider blocken Hairpin-NAT (Container darf nicht an seine eigene Public-IP), Connect-Timeout. Lösung: beide Container im `traefik-proxy`-Network, interne Calls via Container-Name als Hostname (`http://twin-lab-bridge:5100`). Schneller (kein TLS-Overhead), zuverlässig (kein Hairpin), spart Bandbreite. Generelles Pattern für Multi-Container-Setups auf einem Host.

**NEXT_PUBLIC-Vars zur Build-Zeit, nicht zur Runtime (NEU 4. Mai).** Next inlined `NEXT_PUBLIC_*`-Variablen ins Client-Bundle beim Build. Compose-`environment:`-Block setzt sie zur Runtime, kommt zu spät — Bundle hat dann hartcodierte Default-URLs aus dem Code. Pattern: ARG/ENV im Dockerfile-Builder-Stage, plus `--build-arg` beim `docker build`. README dokumentiert den Aufruf für Production-Builds. Kein Compose-Trick, keine Runtime-Override.

**Cookie-Domain als ENV-getriebener Quick-Fix (NEU 4. Mai).** Cross-Subdomain-Setup (Web auf `app.*`, Backend auf `runtime.*`) braucht Session-Cookie auf Parent-Domain `.twin.harwayexperience.com`. Implementiert via zwei ENVs (`SESSION_COOKIE_DOMAIN`, `SESSION_COOKIE_SECURE`) mit konservativen Defaults — lokal HTTP ohne Domain bleibt unverändert. Sauberere Variante: Reverse-Proxy-Architektur (Same-Origin) eliminiert das Problem strukturell. Backlog #65 für später, kein Blocker.

**Bridge-DB-Cleanup als Production-Bootstrap-Schritt (NEU 4. Mai).** Wenn Bridge schon vor dem Web-Stack existiert (Tag 4 Bridge-Sync-Test mit alten Handles) und die neue Web-Runtime mit eigener leerer DB startet, kollidiert das Onboarding (Bridge meldet „Handle existiert bereits"). Cleanup-Pfad: alte Handles via Volume-Mount löschen, dann neu registrieren. Pattern für künftige Re-Bootstraps oder Migrations.

**packages/shared braucht eigenes dist/ für Production-Container (NEU 4. Mai).** Lokal funktionierte `main: "src/index.ts"` durch tsx und Next-dev-Auflösung. Production-Container-Node ohne tsx-Loader brach mit ERR_UNKNOWN_FILE_EXTENSION. Pattern: shared baut explizit nach `dist/`, `package.json` zeigt mit main/types/exports darauf, `files: ["dist"]` für pnpm-deploy. Plus predev-Hook in jeder App, damit lokale Entwicklung weiter ohne manuellen Build-Schritt funktioniert. Dockerfiles bauen shared explizit vor App-Build.

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

### 2.5.6 — Production-Deployment Web auf VPS ✅
**Abgeschlossen 4. Mai 2026 abends.** Web-UI deployed unter `app.twin.harwayexperience.com`, Runtime unter `runtime.twin.harwayexperience.com`, Bridge weiterhin unter `bridge.twin.harwayexperience.com`. Drei User registriert, drei Twins hot-geladen ohne Container-Restart. Multi-Tenant-SaaS funktional — externer User kann sich registrieren, Twin onboarden, chatten.

Sechs Sub-Phasen, alle in einem Tag:

**Phase A — Code-Artefakte (`bdde263`).** apps/runtime/Dockerfile (Multi-Stage analog Bridge), apps/web/Dockerfile (Next-Standalone), `next.config.mjs` mit `output: "standalone"`, docker/twin-lab-web/{docker-compose.yml,.env.example,README.md}. Web-Image baute initial nicht durch.

**Phase A.1 — Suspense-Boundary für Nav-Komponenten (`85f664e`).** AppHeader und AppFooter in `<Suspense fallback={null}>` gewrapped (Pattern a, Wrap am Verbraucher in layout.tsx). Static-Generation für 10 Pages grün, Web-Image baut. Plus Dockerfile-Fix: COPY-Zeile für nicht-existentes `apps/web/public/` entfernt.

**Phase A.2 — Production-Build für packages/shared (`79e3ae0`).** `packages/shared` zeigte mit `main` auf Source-TS, brach im Production-Container mit ERR_UNKNOWN_FILE_EXTENSION. Build-Script ergänzt, `main`/`types`/`exports` auf `dist/`, predev-Hook in apps/runtime und apps/web baut shared automatisch beim ersten `pnpm dev`. Dockerfiles bauen shared explizit vor App-Build.

**Phase A.3 — Hot-Reload für TwinServiceRegistry (`a4f1465`).** Boot-Code akzeptiert leere DB als gültigen Onboarding-only-Modus (statt `process.exit(1)`). Plus `addTwin(twinId)`-Methode auf der Registry, idempotent und atomisch via pendingAdds-Mutex. Onboarding-Submit ruft addTwin nach DB-Insert, `requiresRestart: false` zurück. **Backlog #37 abgeschlossen.**

**Phase A.4 — NEXT_PUBLIC_RUNTIME_URL als Build-ARG (`758058e`).** Next inlined NEXT_PUBLIC_*-Vars zur Build-Zeit. Compose-environment kommt zu spät — Bundle hatte hartcodiert `localhost:4000`. Dockerfile mit ARG/ENV vor dem Web-Build, README dokumentiert `--build-arg`-Aufruf.

**Phase A.5 — Cookie-Domain + Secure-Flag aus ENV (`f94ae0d`).** Cross-Subdomain-Setup scheiterte am Cookie ohne Domain-Attribut. Zwei neue ENVs (`SESSION_COOKIE_DOMAIN`, `SESSION_COOKIE_SECURE`) mit konservativem Default — lokal HTTP ohne Domain bleibt unverändert. Production: `Domain=.twin.harwayexperience.com; Secure`.

Plus drei Production-Aktionen ohne Code-Commit:
- Wizard-Vorbereitungen vor Phase A: ENV-Bridge-URL (`a5b14a9`) und Register-Token-Header im Onboarding-Caller (`13cc70a`)
- Bridge-DB-Cleanup von alten Handles vom 3. Mai
- Bridge-URL für interne Calls auf `http://twin-lab-bridge:5100` (Container-zu-Container statt Hairpin)

**Caveats:**
- Cookie-Domain als Quick-Fix (Backlog #65 für saubere Reverse-Proxy-Architektur)
- Drei User-Passwörter vom Production-Onboarding sollten in Passwort-Manager
- Florian und Heiko: Self-Service-Password-Reset nicht möglich (Backlog #44)
- Login-Curls mit Production-Passwort in Shell-History — bei Bedarf bereinigen

---

## Phase 2.5 Total — Status

**Abgeschlossen:** 2.5.1, 2.5.2 (a-e), 2.5.3, 2.5.4 (inkl. .1/.1.1/.2/.3), 2.5.6.
**Verschoben:** 2.5.5 (Notifications) — bewusst, bis Schmerz sichtbar wird. Inbox-Badge plus drei Power-User vorm Browser reicht heute.
**Definition of Done für Phase 2.5 erreicht:** Externer User kann sich registrieren, eigenen Twin onboarden, mit dem Twin chatten, Pending approven, Twin verleihen. Multi-Tenant-SaaS funktional unter `app.twin.harwayexperience.com`.

Phase 2.5 als Ganzes ist damit faktisch abgeschlossen. 2.5.5 wird bei Bedarf nachgezogen, ist aber kein Blocker für Phase 3.

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

### 14. Owner-Recognition im System-Prompt — präzisiert nach 2.5.3 Live-Test ✅
**Abgeschlossen 2. Mai (2.5.4) + 4. Mai (Production-Verifizierung).** Twin behandelte aktuell jeden Web-UI-Chat als Fremder, auch wenn der Owner selbst chattet.

Live-Test 2.5.3: Heiko-Twin antwortet "Diese Anfrage habe ich an **Markus** zur Freigabe weitergeleitet". Markus ist aber nicht Heikos Owner — der Twin hat aus seiner Persona-Beziehungs-Liste geraten und den ersten Eintrag als "Owner" interpretiert.

Plus: Web-UI-Chat überspringt Approval-Flow für Markus (`requires_approval=false` in seinen Mandates), aber **nicht** für Heiko (`cautious`-Template hat `requires_approval=true`). Owner sollte mit eigenem Twin chatten können ohne sich selbst approven zu müssen.

Fix in 2.5.4: System-Prompt erweitert um Owner-Erkennung via `req.user_id == twin.owner_user_id`. Approval-Logic mit Bypass für Owner. Production-Verifizierung in 2.5.6: drei Owner haben mit eigenen Twins gechattet, keine Pending-Approvals, korrekte Persona-Adressierung.

### 15. Footer-Text aktualisieren ✅
**Abgeschlossen 5. Mai 2026 (Tag 6, Commit `5ed4365`).** Hartcodiertes „phase 2.5 · ... · läuft lokal" durch ENV-getriebene Konstante ersetzt. Neue Variable `NEXT_PUBLIC_DEPLOYMENT_LABEL` mit Default „läuft lokal", Production-Wert „production". Pattern analog zu `NEXT_PUBLIC_RUNTIME_URL` aus 2.5.6.A.4 — ARG/ENV im Dockerfile-Builder, `--build-arg` beim `docker build`. Footer zeigt jetzt „X Twins aktiv · läuft lokal" lokal und „X Twins aktiv · production" in Production. Lokal verifiziert, Production-Deploy steht aus (kein Druck, beim nächsten regulären Pull).

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

### 37. Hot-Reload für TwinServiceRegistry ✅
**Abgeschlossen 4. Mai 2026 (2.5.6 Phase A.3, Commit `a4f1465`).** Vorher: nach Onboarding-Submit musste `pnpm dev` neu gestartet werden, damit der neue Twin in der laufenden Runtime aktiv wird. Submit-Response trug `requiresRestart: true`, Wizard redirected zu `/chat/<handle>`, dort scheiterte Chat bis zum Restart.

Implementation: Boot-Code akzeptiert leere DB als gültigen Onboarding-only-Modus (statt `process.exit(1)`). `addTwin(twinId)`-Methode auf TwinServiceRegistry, idempotent und atomisch via `pendingAdds`-Mutex (Map<twinId, Promise<void>>). Onboarding-Submit ruft addTwin nach DB-Insert, `requiresRestart: false`. Race-Conditions abgefangen via Mutex.

Production-Verifizierung in 2.5.6: drei User registriert, drei Twins hot-geladen ohne Container-Restart.

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

### 43. Top-Nav auf /login + /onboarding versteckt ✅
**Implementation vor 5. Mai 2026, Reality-Check 5. Mai (Tag 6 Polish-Sprint).** `apps/web/components/AppHeader.tsx` returned `null` für Routes mit Prefix `/login` oder `/onboarding` via `PUBLIC_PREFIXES`-Array und `usePathname`-Check. Implementiert vermutlich in 2.5.4 UX-Iteration Briefing #19 (Tag 4 — exakter Commit nicht zugeordnet, aber Datei `AppHeader.tsx` letzter Commit `445d1a3` enthielt die `PUBLIC_PREFIXES`-Logik bereits).

Tag-6-Reality-Check vor Briefing-Schreibung: Login-Page zeigt nur Brand + Login-Form + Footer, keine Tabs, kein TwinSwitcher, kein ProfileMenu. Item als ✅ markiert ohne Code-Change.

Footer rendert weiterhin auf Public-Routes — Twin-Count fällt auf "multi-twin"-Fallback zurück, da `/twins` ohne Auth 401 returnt (graceful degradation, kein Bug).

### 44. Self-Service-Password-Reset — NEU aus 2.5.4
Florian und Heiko haben heute Platzhalter-Passworte von Markus per CLI bekommen. Es gibt aber keinen Weg für sie, das Passwort selbst zu ändern. CLI-Tool (`pnpm user:create` mit Update-Flag oder ein neues `user:reset-password`) reicht für heute, aber UI-Flow ("Passwort vergessen?" → Email-Link → Set-New-Password) wäre richtig. Vorbedingung: Email-Versand aus 2.5.5.
**Größe:** M · **Priorität:** should · **Aus:** 2.5.4 Migration der drei bestehenden User, blockt auf 2.5.5

---

## Aus Phase 2.5.4.1-3 entstanden

### 45. Bridge-Production-Sync nach 2.5.4.x ✅
**Abgeschlossen 3. Mai 2026 nachmittags.** Production-Bridge unter `bridge.twin.harwayexperience.com` neu deployed — altes Setup vom 1. Mai war abgeräumt (Container gelöscht, Volume jungfräulich mit 0 Messages und Stub-Twins). Sauberer Neustart statt Migration: altes Volume + Image entfernt, frisches Setup unter `/docker/twin-lab-bridge/` mit eigenem `docker-compose.yml` (Project-Name `twin-lab-bridge`, Volume `twin-lab-bridge-data`, hängt am `traefik-proxy`-Network). Image gebaut aus `apps/bridge/Dockerfile`, DB initialisiert mit Migrations 001 + 002 (`message_type`-Spalte aus 2.5.4.1.1 inklusive), drei Twins frisch registriert (Markus Johannes Baier, Florian Ristig, Heiko Gregor). Traefik-Routing via Docker-Labels, Let's Encrypt-Cert beim ersten Hit ausgestellt, Health-Check via HTTPS in 2ms. Token-Werte in Passwort-Manager.

NICHT erledigt in diesem Sub-Schritt: lokale Twin-Profile auf Production-Bridge umstellen — bleibt bei `localhost:5100`. Production-Web-App in 2.5.6 wird beim Bootstrap eigene Profile mit Production-Bridge-URL und neuen Tokens anlegen.

Während Deployment aufgefallen, neu im Backlog: #59-#62 unten.

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

### 53. Conversations löschen/archivieren — NEU 3. Mai 2026 nachmittags
Aktuell: Konversationen in der Sidebar bleiben dauerhaft sichtbar. Bei vielen A2A-Partnern oder nach abgeschlossenen Projekten unübersichtlich. Plus: nach Test-Sessions sammeln sich Test-Konversationen, die man weghaben will. Implementation: `archived_at` und `deleted_at`-Spalten in einem `conversations`-Tabelle ODER pro Audit-Eintrag flaggen. UI: Hover-Action oder Rechtsklick-Menü mit „archivieren" und „löschen". Plus: archivierte Konversationen in separater „Archiv"-Sicht wieder einsehbar (löschen ist endgültig). Konzeptionelle Frage: was passiert mit Bridge-Messages, wenn beide Seiten archivieren? Bridge bleibt unverändert, jeder Twin entscheidet lokal über Sichtbarkeit.
**Größe:** M · **Priorität:** should · **Aus:** UX-Diskussion 3. Mai

### 54. Header-Höhe als CSS-Variable statt hartcodiert — NEU 3. Mai 2026 nachmittags
Heute: `h-[calc(100vh-65px)]` in ChatLayout setzt voraus, dass AppHeader exakt 65px hoch ist. Wenn AppHeader-Style sich ändert (Padding, Button-Höhen), muss die Konstante mitziehen. Sauberer: CSS-Variable `--app-header-height: 65px` im `:root` setzen, sowohl AppHeader als auch ChatLayout nutzen. Plus: bei Mobile-Layout-Anpassungen (Backlog #56) könnte die Höhe variieren — CSS-Variable macht das responsive einfach.
**Größe:** S · **Priorität:** nice · **Aus:** UX-Iteration 3. Mai (Layout-Fix)

### 55. Mobile-Layout für Chat-Page (Sidebar-Toggle/Collapse) — NEU 3. Mai 2026 nachmittags
Heute: Chat-Layout fest auf Desktop-Breite optimiert. Sidebar w-72 (288px) belegt auf Mobile fast die halbe Bildschirmbreite, Conversation wird sehr eng. Plus: Top-Nav mit Brand + 3 Tabs + Switcher + Avatar nebeneinander bricht bei <768px. Lösung: Sidebar als Off-Canvas-Drawer mit Toggle-Button, Top-Nav mit Hamburger-Menü oder Tabs als Bottom-Nav. Pattern wie WhatsApp-Web oder Slack-Mobile. Vorbedingung: Visual-Design-Iteration (#59).
**Größe:** L · **Priorität:** should · **Aus:** UX-Iteration 3. Mai (Layout-Fix Caveat)

### 56. Textarea Auto-Grow mit Cap im Conversation-Input — NEU 3. Mai 2026 nachmittags
Heute: Textarea im Conversation-Input ist fix h-20 (80px), bei längeren Eingaben scrollt sie intern. Bei mehrzeiligen Antworten umständlich, weil User nicht den ganzen Text sieht. Lösung: Auto-Grow mit Cap — Textarea wächst mit Inhalt bis 3-4 Zeilen, dann scrollt sie intern weiter. Container-Höhe muss flexibel sein, oder Textarea overlay'd den Verlauf-Bereich. Pattern wie Slack/Discord — Input wächst nach oben, Verlauf rutscht entsprechend hoch.
**Größe:** S · **Priorität:** nice · **Aus:** UX-Iteration 3. Mai (Layout-Fix Caveat)

### 57. 100dvh statt 100vh für Mobile-Browser-Kompatibilität — NEU 3. Mai 2026 nachmittags
Heute: ChatLayout nutzt `h-[calc(100vh-65px)]`. Auf Safari iOS (und älteren Mobile-Browsern) berücksichtigt 100vh die dynamische Toolbar nicht — Conversation-Input könnte unter den Address-Bar gequetscht werden. Lösung: `100dvh` (dynamic viewport height) — wird von modernen Browsern korrekt berechnet. Backwards-Compatibility: `min-h-[100vh] min-h-[100dvh]` als Fallback. Vermutlich gehört zur Mobile-Layout-Iteration (#56).
**Größe:** S · **Priorität:** nice · **Aus:** UX-Iteration 3. Mai (Layout-Fix Caveat)

### 58. Visual Design + Brand-Iteration für twin-lab — NEU 3. Mai 2026 nachmittags
Aktuell: monospace, schwarz-weiß-grün, sehr functional. Konzeptionell stimmig zum „Lab"-Charakter, aber spätestens bei Multi-Tenant-Public-Launch (nach 2.5.6) wird die Frage akut: wie soll twin-lab aussehen für externe User? Eigene Brand-Identity entwickeln (Logo, Farben, Typografie-Hierarchie), Header-Komponente neu konzipieren, Page-Templates strukturieren, Conversation-Bubble-Designs polishen. Vorbereitung: Mood-Boards, Inspiration sammeln. Empfohlen mit Florian zusammen (Designer). Trigger: vor Phase 2.5.6 oder nach.
**Größe:** XL · **Priorität:** should · **Aus:** UX-Diskussion 3. Mai (Option-3-Reizfrage)

### 59. Bridge `/messages/:id/sender` mit Auth + Owner-Scope ✅
**Abgeschlossen 3. Mai 2026 abends.** Drei Schichten Schutz: 
`requireTwinAuth`-preHandler (existierender Hook, identisch zu 
`/messages` und `/messages/conversation`), Format-Check vor DB-Query 
(`MESSAGE_ID_REGEX = /^msg_[A-Za-z0-9_-]{16}$/` → 400 bei kaputter ID), 
Owner-Scope (`from === callerHandle || to === callerHandle` → sonst 
404, identische Body wie „existiert nicht" gegen Existence-Leak). 
Code-Kommentar an Route auf neuen Stand gebracht.

`BridgeClient.lookupSender` (apps/runtime/src/bridge/client.ts:100+152) 
sendete den Bearer-Token bereits mit über `this.headers()` — 
keine Client-Änderung nötig, Reply-Detection läuft post-Deploy weiter.

Verifikation: sechs Curl-Cases gegen lokale Bridge (Sender-Side, 
Recipient-Side, Owner-Scope-Block, nicht-existent, kaputte ID, kein 
Token) plus manueller A2A-Reply-Loop für End-to-End Reply-Detection. 
1 File, +24/-7. 

Vorbedingung 2.5.6 erfüllt (zusammen mit #60).

### 60. Bridge-Register-Endpoint ohne Auth ✅
**Abgeschlossen 3. Mai 2026 abends.** Single-Token-Allowlist via 
`BRIDGE_REGISTER_TOKEN`-ENV. Fail-closed: ohne ENV ist Register-
Endpoint deaktiviert (503). Mit ENV: Header `X-Register-Token` 
muss matchen, Constant-time-Compare via `crypto.timingSafeEqual`. 
Lokale `.env` mit `local-dev-token` (Symlink-Pattern wie 
`apps/runtime/.env`), Production-VPS mit Token aus 
`openssl rand -hex 32`, in `/docker/twin-lab-bridge/.env` plus 
Compose-environment-Block. Boot-Log differenziert klar zwischen 
"DEAKTIVIERT (kein Token)" und "geschützt (Token aktiv)". 
Vorbedingung 2.5.6 erfüllt. Migration zu `/docker/shared.env` 
kommt mit 2.5.6 (Web-App).

### 61. Bridge-Image hat kein wget/curl für Healthcheck — NEU 3. Mai 2026 nachmittags
`docker compose exec bridge wget ...` schlägt fehl, weil `wget` im node:20-alpine-Image nicht da ist (heute mit Node-Fetch umgangen). Für Healthcheck-Direktiven in `docker-compose.yml` (HEALTHCHECK-Stanza) wäre `wget` oder `curl` praktisch. Lösung: entweder `apk add --no-cache wget` im Runner-Stage (~1 MB Image-Größe), oder Healthcheck via `node -e "fetch(...)"` als CMD im Dockerfile. Letzteres ist sauberer (kein zusätzliches Tool im Production-Image).
**Größe:** S · **Priorität:** nice · **Aus:** #45 Verifikation

### 62. Bridge-Container OOM-Risiko — NEU 3. Mai 2026 nachmittags
Alter Bridge-Container vom 1. Mai war mit Exit-Code 137 abgeschossen (SIGKILL durch OOM-Killer oder externes Stop, vor 6h). Konkrete Ursache nicht ermittelbar (Container heute weg). Falls neue Bridge unter Last das gleiche Problem zeigt: Memory-Limits in Compose setzen (`deploy.resources.limits.memory: 256M`), better-sqlite3 ist eigentlich speicherarm, aber Node-Heap kann unter Last wachsen. Zur Sicherheit Monitoring etablieren — `docker stats` periodisch oder einen einfachen Memory-Logger im Bridge-Code für lange Laufzeiten.
**Größe:** S · **Priorität:** nice · **Aus:** #45 Forensik des alten Containers

### 63. CLI-Tool `twin:set-api-key` für API-Key-Rotation ✅
**Abgeschlossen 3. Mai 2026 abends.** Auslöser: Anthropic-API-Key 
rotiert, Settings-UI hat kein Edit-Feld für API-Keys. Neues CLI-Tool 
`pnpm --filter @twin-lab/runtime twin:set-api-key <handle>`: Master-
Key-Check zuerst (Fail-Fast vor User-Prompt), masked Stdin-Input mit 
`setRawMode` für Backspace und Ctrl-C, `validateApiKey()` aus 
`onboarding/api-key-validator.ts` (1-Token-Test gegen Provider), 
AES-256-GCM-Verschlüsselung mit Master-Key, `TwinProfilesRepo.update` 
für DB-Write. Provider und Model bleiben fix — nur der Key wird 
ersetzt.

Pattern angelehnt an existierende CLI-Tools (`session-secret:generate`, 
`user:create`). Caveat: Runtime-Restart nötig, weil Boot den 
entschlüsselten Key in der Registry cached. Hot-Reload wäre eigene 
Komplexität — Backlog-würdig falls je gebraucht.

Verifikation: drei lokale Twins (Markus, Florian, Heiko) auf neuen 
Key umgestellt, Browser-Chat-Test pro Twin grün. 2 Files, +191. 
Commit `8783d97`.

Verwandt mit #10 (UI-Bearbeitung von Persona/Mandates) und #34 
(Master-Key-Rotation CLI).

### 64. VPS-Git-Auth via Deploy-Key statt Password ✅
**Abgeschlossen 4. Mai 2026 vormittags.** Heute: `git pull` auf 
`/docker/twin-lab-bridge/repo/` fragte User+Password für GitHub. 
Lösung: read-only Deploy-Key (ED25519) auf VPS srv1046432, bei 
GitHub als Repo-spezifischer Deploy-Key hinterlegt (kein User-Key, 
also Scope nur auf `twin-lab`-Repo). SSH-Config-Section mit 
`Host github.com-twin-lab` als Alias plus `IdentitiesOnly yes` 
zwingt SSH, nur diesen Key zu probieren. Remote-URL umgestellt 
auf `git@github.com-twin-lab:markusbaier/twin-lab.git`. 

`Allow write access` bewusst nicht angekreuzt — VPS soll nur 
pullen, nicht pushen können. Wenn der VPS kompromittiert wird, 
kann der Angreifer keinen Schadcode in's Repo pushen.

Verifikation: `git fetch` und `git pull` ohne Password-Prompt 
durchgelaufen, Doku-Commit `8db175b` vom 3. Mai sauber gepullt. 
Vorbedingung 2.5.6 erfüllt — Web-App-Repo-Klon kann denselben 
Deploy-Key nutzen (Monorepo, ein Key reicht für Bridge und Web-App).

Pattern-Wert: zukünftige VPS-Setups gleich so machen, statt 
Password-Workflow als „erste Lösung" zu etablieren.

### 65. Reverse-Proxy-Architektur statt Cookie-Domain — NEU 4. Mai
Heute: Cookie-Domain via ENV (`SESSION_COOKIE_DOMAIN=.twin.harwayexperience.com`) als Quick-Fix für Cross-Subdomain-Setup. Funktioniert, ist aber konzeptionell ein Workaround — Same-Origin wäre sauberer.

Saubere Variante: Web-App und Runtime hinter demselben Origin (z.B. `app.twin.harwayexperience.com` mit Path-Prefix `/api/*` zur Runtime). Next-Middleware oder Traefik-Path-Routing übernimmt das. Vorteile: kein Cookie-Domain-Trick, keine CORS-Konfig (Same-Origin), Browser-DevTools zeigen nur eine Origin.

Trade-off: Runtime ist dann nicht mehr direkt von außen aufrufbar (ohne Path-Prefix). Für Power-User-Tooling (Curl, Postman) müsste man den Path-Prefix kennen. Plus: Migration heißt Cookie-Domain entfernen, Runtime-CORS entfernen, Frontend-Calls auf relative Pfade umstellen.

Kein Notfall — heutige Lösung läuft stabil. Sub-Schritt für ruhigeren Tag, wenn Architektur-Konsolidierung dran ist.
**Größe:** L · **Priorität:** should · **Aus:** 2.5.6 Phase A.5 Reflexion

### 66. DB-Backup-Strategie für Production-DBs — NEU 4. Mai
Drei DBs auf VPS, alle bisher ohne Backup: `twin-lab-bridge-data`, `twin-lab-web-data` (Runtime), und implizit auch `traefik`-Konfig. Bei Volume-Verlust sind drei User-Accounts plus Twin-Profile (Persona, Mandates, Encryption-Keys, API-Keys verschlüsselt) weg.

Pattern-Optionen:
- Cron-Job auf VPS, sqlite-`.backup`-Befehl täglich nach `/var/backups/twin-lab/`, Rotation 7 Tage
- Plus optional rsync/rclone zu externem Storage (Hetzner Storage Box, Backblaze B2)
- Alternativ: Volume-Snapshots via Hetzner-API, wenn VPS dort liegt

Master-Key sollte separat gesichert sein (Passwort-Manager, schon erledigt) — ohne Master-Key sind die API-Keys aus Backup nicht entschlüsselbar.

Kein Notfall solange nichts kaputt ist. Wird wichtig sobald mehr als drei Power-User dranhängen.
**Größe:** M · **Priorität:** should · **Aus:** 2.5.6 Production-Reflexion

### 67. Production-Monitoring + Alerting — NEU 4. Mai
Drei Container live, kein Monitoring. Wenn Bridge oder Runtime abstürzt, merken wir es erst beim nächsten Login.

Optionen, von einfach nach reich:
- Uptime-Kuma als selbst-gehosteter Healthcheck (ein vierter Container) mit Email/Slack-Notification
- BetterStack / Healthchecks.io als externer Service
- Grafana + Prometheus für Metriken (overkill für drei User)

Vorbedingung: Healthcheck-Endpoints in Bridge und Runtime — Bridge hat noch kein wget/curl im Image (#61).
**Größe:** M · **Priorität:** should · **Aus:** 2.5.6 Production-Reflexion

### 68. Master-Key in Vault statt ENV-Datei — NEU 4. Mai (vorgesehen aber nicht umgesetzt)
2.5.6 Spec erwähnte „Master-Key in produktions-tauglichem Vault (nicht mehr in ENV-Datei)". Heute pragmatisch in `/docker/twin-lab-web/.env` belassen, weil Vault-Setup für drei Power-User Overengineering wäre.

Künftige Optionen wenn relevant:
- HashiCorp Vault als selbst-gehosteter Container
- 1Password Connect (Service-Account-API)
- Bitwarden CLI mit Service-Token
- AWS Secrets Manager / Hetzner-eigene Lösung

Trade-off: Vault macht Container-Recovery komplexer (Container braucht Vault-Token zum Start, Vault-Token muss von woher kommen → Boot-Strapping-Problem).

Heute: ENV-Datei mit `chmod 600`, `/docker/`-Verzeichnis nur für Root les- und schreibbar. Reicht für aktuellen Risikostand.
**Größe:** M · **Priorität:** nice · **Aus:** 2.5.6 Spec, bewusst verschoben

### 69. Onboarding-Polish: User-Email-Verifikation + Self-Service-Reset
Heute (Tag 5): drei User onboarded mit Passwörtern, die Markus selbst getippt hat. Florian und Heiko kennen ihre Passwörter nicht — funktioniert solange Markus es ihnen mitteilt, aber kein Self-Service-Onboarding möglich.

Pflicht-Items, wenn neue User von außen kommen:
- Email-Verifikation beim Onboarding (Token-Link zu `/auth/verify`)
- Password-Reset-Flow via Email-Token (#44 verknüpft, dort als nice eingestuft — heute zu must aufrücken sobald externe User kommen)
- Optional: SSO via Google/GitHub (heute nicht nötig)

Vorbedingung: Email-Versand-Infrastruktur (resend.com Konto vorhanden, in 2.5.5 für Notifications eh geplant).
**Größe:** L · **Priorität:** should · **Aus:** 2.5.6 Production-Live

### 70. Production-Stack-Doku: README für `/docker/twin-lab-web/`
Heute: README im Repo unter `docker/twin-lab-web/README.md` beschreibt Build-Sequenz und ENV-Variablen. Ergänzen um:
- Operations-Runbook: wie Restart, wie Logs lesen, wie .env editieren ohne Container zu stoppen
- Troubleshooting-Sektion: Hairpin-NAT-Symptom (Connect-Timeout zu Bridge-Public-URL), Cookie-Domain-Symptom (Login-Loop), NEXT_PUBLIC-Symptom (hartcodierte URLs im Bundle)
- Disaster-Recovery: was wenn Volume verloren, was wenn Master-Key verloren, was wenn TLS-Zertifikat abgelaufen
- Backup/Restore-Anleitung (verknüpft mit #66)

**Größe:** S · **Priorität:** should · **Aus:** 2.5.6 Reflexion

### 71. Direct-Chat-History persistent über Tab-Switches ✅
**Abgeschlossen 5. Mai 2026 (Tag 6 Polish-Sprint, Commits `9a6cff9` + `f80558f`).** Vorher: `DirectChat`-Komponente in `apps/web/app/chat/[handle]/page.tsx` initialisierte ihre Messages mit leerem `useState`, History ging beim Wechsel zu A2A-Konversation und zurück verloren. A2A-Konversationen verloren ihre History nicht, weil sie aus der Bridge-DB nachgeladen wurden — Direct-Chat hatte keine vergleichbare Persistenz-Quelle.

Lösung: `useEffect([handle])` lädt `/twins/:handle/audit?limit=50` beim Mount, filtert auf relevante Capabilities, mappt `input.lastMessage` + `output.reply` auf User+Assistant-Pärchen, sortiert chronologisch (DESC → ASC), setzt Messages-State. Cancelled-Flag-Pattern für Race-Conditions, silent fail bei 401.

Filter-Erweiterung in `f80558f`: erste Implementation filterte nur auf `respond_to_chat`, übersah aber `owner-direct`-Audits. Owner-Bypass-Pfad aus 2.5.4.1 schreibt nicht `respond_to_chat`, sondern `owner-direct` als Capability — gleiches Schema, andere Capability. Filter erweitert auf `Set` mit beiden: `DIRECT_CHAT_CAPABILITIES = new Set(["respond_to_chat", "owner-direct"])`. Lokal-Test zeigte alle Pärchen sichtbar inklusive Tag-6-Test-Sends.

Spec-Deviation gegenüber Briefing: Claude Code nutzte `input.lastMessage` statt `input.messages[0].content`. Begründung: `input.messages` ist der kumulative Verlauf je Audit, `[0]` wäre N-mal die Erst-Message. `lastMessage` liefert pro Turn die richtige User-Message. Korrektur ohne Rückfrage akzeptiert, im Briefing-Doku im Nachgang übernommen.

### 71b. Audit-Schema speichert kumulative Konversations-History — NEU 5. Mai ✅
**Abgeschlossen 8. Mai 2026 (Tag 9), gemeinsam mit #80, #84, #85 als Test-Hygiene-Block.** Sechs Commits über fünf Sub-Schritte. Konversations-Modellierung als Ersatz für die flache Audit-History: eigene `conversations`-Tabelle (Migration 009), `audit.conversation_id`-FK, `ConversationsRepo.getOrStart()` vor jedem `owner-direct`-Audit-Insert, History-Loader per `listByConversation()` mit 40-Messages-Sliding-Window, UI-Reset-Button mit Inline-Confirm und daten-getriebenem Konversations-Trenner im Verlauf, Migration 010 (Cleanup von Pre-Konversations-`owner-direct`-Audits). Hauptpunkt: nach Konversations-Reset kein Memory-Leak aus voriger Session — Skill-Toggle-Tests sind jetzt sauber.

**Originale Beobachtung (5. Mai):**
Beobachtung beim #71-Debug: Owner-Direct-Audit-Schema enthält in `input.messages` den gesamten kumulativen Konversations-Verlauf, nicht nur die aktuelle User-Message. Bei Audit #50 ist die History von Audit #1 bis #49 plus eine User-Message drin — exponentielles Wachstum.

Heute kein akutes Problem (DB-Größe für 30 Audits noch klein), aber langfristig:
- Audit-Tabelle wächst quadratisch mit Konversations-Länge
- LLM-Token-Kosten pro Audit-Schreibung enthalten die ganze History
- `/audit?limit=50` returnt potentiell mehrere MB

Lösung: Backend `apps/runtime/src/twin-service.ts` ändern, dass nur die letzte User-Message in `input.messages` persistiert wird. `lastMessage` und `output.reply` reichen für Render und Audit-Trail.

Vorbedingung-Check: existing Audits müssen rückwärtskompatibel gerendert werden. Frontend-Filter aus #71 nutzt schon `lastMessage`-Field, würde mit reduzierter `input.messages`-Liste weiter funktionieren.

**Tag-8-Update:** Bei der #74-Verifikation zeigt sich, dass das Problem direkt mit Test-Hygiene zusammenhängt — Skill-Toggle-Test war durch History-Persistenz verfälscht. Verwandt mit neuem Item #80 (History-Reset-Pfad fehlt). Beide könnten gemeinsam angegangen werden mit einem sauberen Sliding-Window-Schema, das gleich Vorarbeit für 3.3 Conversation-Memory leistet.

**Priorität-Hochstufung 7. Mai:** von should auf **must** vor 3.2 — weil MCP-Tool-Use-Tests durch dieselbe History-Verfälschung blockiert würden.

**Größe:** S · **Priorität:** must · **Aus:** #71 Implementation-Diskussion + Tag-8-#74-Verifikation

### 71c. Hydration-Error nach ENV-Variable-Änderungen — Stale-Bundle-Phantom
Während #71-Test sichtbarer Hydration-Error auf `<footer>`-Element. Nach Diagnose-Sequenz (Vor-#15-Stand auschecken, Test, Stand zurück, Hard-Reload) verschwand der Fehler komplett.

Ursache: `next dev` Hot-Reload beim ENV-Variable-Update (NEXT_PUBLIC_DEPLOYMENT_LABEL aus #15) hat das Bundle nicht sauber neu generiert. Server-Render hatte alten Wert, Client-Bundle den neuen — Hydration-Mismatch. Hard-Reload (Cmd+Shift+R) räumt Bundle-Cache, alles okay.

Kein echter Code-Bug — pragmatisch dokumentiert als Lesson („bei ENV-Änderungen lokal Hard-Reload"), kein Sub-Schritt nötig. Falls in Production reproducible, dann eigenes Item.

**Größe:** XS · **Priorität:** nice · **Aus:** #71 Live-Test, kein Action Required

---

## Aus Phase 3.1 entstanden

### 73. Inline-Twin-Befehle aus Owner-Chat heraus
Aus „Mit meinem Twin"-Konversation soll User natural-language-Befehle geben können wie „Frage @florian wann er morgen Zeit hat" oder „Schick @heiko die Workshop-Details". Markus-Twin erkennt Intent, formuliert Nachricht im Markus-Stil, sendet via Bridge. Antwort kommt in der entsprechenden A2A-Konversation an. Optional: Round-trip-Update zurück in Owner-Konversation („Florian sagt: 14 Uhr passt").

Drei Schichten nötig:
- **Intent-Detection** — LLM-basierter Klassifikator („ist das ein send_to_twin-Intent?"), Regex auf @-Patterns zu fragil
- **Tool-Use-Pattern** — Twin nutzt Skill `send_to_twin` als Tool-Call, formuliert Recipient + Content, System schickt
- **Round-trip-Threading** — Antwort taucht in A2A-Konversation auf (haben wir), optional in Owner-Konversation als Update (neu)

Approval-Strategie: **Variante C — Trust-basiert.** Vertraute Twins direkt (existierende Trust-Layer aus 2.5.4.1 wiederverwenden, nicht duplizieren), Fremde mit Approval. Skill-Manifest-Feld `requires_approval` muss Trust-aware werden — entweder Logik im Skill, oder Skill ruft existierende `checkTrust()`-Funktion auf.

Vorbedingung: 3.1 Skill-System ✅ + 3.2 Tool-Use über MCP-Pattern. Implementation als Action-Skill `send_to_twin` mit Manifest, Mandate-gated. Kalenderzeit: 6-10 Wochen ab heute.

**Größe:** L · **Priorität:** should · **Aus:** Markus-Idee 6. Mai während 3.1.B-Implementation

### 74. Persona-Skill-Layering klären ✅
**Abgeschlossen 7. Mai 2026 (Tag 8 Vormittag) — Commit `f045dd8` (File) plus DB-Update via Wegwerf-Skript.**

Beim 3.1.E-Toggle-Test entdeckt: Twin antwortet mit Workshop-Daten obwohl `harway-workshops`-Skill deaktiviert. Ursache: `docs/persona.md` enthält Workshop-Block 1:1 (aus dem der Skill-Inhalt extrahiert wurde). Toggle-Test funktioniert deshalb nicht als verlässlicher Engine-Test — Engine selbst ist clean (`test-skill-engine.ts` grün, Skill-Block bei `is_active=0` korrekt nicht im System-Prompt).

Architektur-Frage: wenn Wissen gleichzeitig in Persona und Skill steckt, ist es nicht eindeutig zu welchem es gehört. Drei Lösungs-Optionen:
1. **Persona-Cleanup** — Workshop-Inhalt aus `docs/persona.md` raus, lebt nur noch im Skill. Saubere Trennung. Risiko: bei Skill-Deaktivierung weiß der Twin nichts mehr von Workshops
2. **Persona als Fallback markieren** — Workshop-Inhalt mit „Falls keine konkreten Daten verfügbar: nicht raten, auf workshop@harwayexperience.com verweisen". Skill liefert dann konkrete Daten, Persona dient als Fallback
3. **Layering klar dokumentieren** — Persona = identitäts-stabiles Wissen (wer Markus ist, wie er klingt), Skill = austauschbares Wissen (Termine, Preise, Daten die sich ändern). Workshop-Inhalt ist austauschbar, gehört in Skill — Persona-Eintrag wäre dann ein Bug

Vote: **3.** Konsequent durchziehen. Persona-Refactor in eigenem Sub-Schritt — Workshop-Block raus, andere identitäts-stabile Inhalte (wer Markus ist, wie er klingt, was er nicht tut) bleiben drin.

Vorbedingung-Check: Skill-System steht (Phase 3.1 ✅), Persona-Reload pro Boot ist stable. Ein Sub-Schritt von ~30 Min Edit + Boot-Test reicht.

**Umsetzung:** Workshop-Block aus `docs/persona.md` entfernt, Fallback-Hinweis ergänzt (Verweis auf Discovery Call und info@ wenn keine konkreten Daten verfügbar). Browser-Test mit Skill aus → Twin verweist statt halluziniert. Skill an → konkrete Daten aus Skill. Tonalität in beiden Fällen sauber im Markus-Stil.

**Caveat / Folge-Erkenntnis:** Persona-File-Edit alleine ist wirkungslos — Persona wird aus `twin_profiles.persona_md`-DB-Spalte gelesen, nicht aus File. Wegwerf-Skript zum DB-Update musste genutzt werden. Backlog-Item #78 dokumentiert den fehlenden Persona-File-Sync-Pfad.

**Größe:** S · **Priorität:** should · **Aus:** 3.1.E Toggle-Test 6. Mai

### 75. Skills lokal vs. Production-Sync
Skills leben heute nur in der lokalen DB (`data/twin.db`). Markus-Twin auf Production hat keine Skills, weil Skill-Files via CLI lokal in lokale DB importiert wurden — Production-DB ist unberührt.

Drei Sync-Strategien denkbar:
- **Manuell pro Production-Deploy** — Skill-Files committen (gitignored entfernen), CLI auf Production laufen lassen. Einfach, aber: Skills im Repo = öffentlich
- **Skill-Sync-Endpoint** — Backend-Route `POST /twins/:handle/skills/sync` mit Manifest+Markdown-Body, importiert in DB. Wäre auch UI-fähig (3.1-Phase-Ende oder später, war geplant) — Edit/Create via UI baut auf demselben Endpoint
- **Eigener Skill-Repo pro User** — User hat einen privaten Repo nur für Skills, Production-Twin liest beim Boot (oder via Webhook-Refresh). Komplexer, aber: Multi-Device-fähig, Skills versioniert

Vote heute: **2.** Macht Skills UI-fähig und löst gleichzeitig das Sync-Problem. Gehört eigentlich zur „UI-Editierbarkeit"-Phase, die bisher als Phase 3-Ende oder später angesetzt war. Konkret: Endpoint, dann optional UI-Editor in Phase 4.

**Größe:** M · **Priorität:** should · **Aus:** 3.1.F Pilot-Skill war lokal, Frage „und Production?" ungeklärt

### 76. Skill-Edit / Delete via UI
Heute (3.1.E): UI ist read-only mit Aktiv-Toggle. Skills werden via CLI angelegt und überschrieben (`--force`). Es gibt keinen UI-Pfad zum Editieren oder Löschen.

Was fehlt:
- **Edit:** Skill-Detail-View mit Markdown-Editor für SKILL.md, Form-Fields für Manifest. Auf Save: PATCH gegen `/twins/:handle/skills/:skillId`. Vorbedingung: Sync-Endpoint aus #75
- **Delete:** Confirm-Dialog, dann DELETE gegen `/twins/:handle/skills/:skillId`. Optional: „Soft-Delete" via `is_active=false` (haben wir schon im Toggle), Hard-Delete als zweite Stufe

Verknüpft mit #10 (UI-Bearbeitung von Persona/Mandates). Konsistente UX: alles, was heute in Files lebt, soll später in der UI editierbar sein.

**Größe:** L · **Priorität:** should · **Aus:** 3.1.E expliziter Scope-Ausschluss

### 77. Production-Container-Bootstrap ruft init-db nicht auf ✅
**Abgeschlossen 7. Mai 2026 (Tag 8 Vormittag) — Commit `2e96ddb` mit Variante 1 (Dockerfile-CMD-Wrap).**

Beim Tag-7-Production-Deploy entdeckt: Migration 008 (Skills-Tabelle) lag im Repo, wurde aber beim Container-Boot nicht angewendet. Symptom: `SqliteError: no such table: skills` bei jedem Settings-Page-Load. Ursache: `apps/runtime/Dockerfile` startete direkt `node ./apps/runtime/dist/index.js`, ohne vorgeschaltetes `init-db`. Lokal versteckt der `predev`-Hook in `pnpm dev` das Problem (`pnpm db:init` läuft vor jedem Dev-Start).

Ad-hoc-Fix war: `docker compose exec runtime node /app/apps/runtime/dist/scripts/init-db.js`. Idempotent, hat 008 angewendet, alle anderen als „bereits angewendet" geskipped. Dauerhafter Fix gehört in den Boot-Pfad.

Drei Lösungs-Optionen:

1. **Init-DB als Entrypoint-Vorlauf im Dockerfile.** CMD wird zu Shell-Script `node dist/scripts/init-db.js && node dist/index.js`. Idempotent, kein zusätzlicher Container. Einfachster Quick-Fix, ein Zeilen-Diff im Dockerfile.

2. **Init-DB im Server-Boot.** `apps/runtime/src/index.ts` ruft `runMigrations(db)` als ersten Schritt vor TwinService-Start auf. Migrations-Logic muss aus dem CLI-Skript in eine reusable Library extrahiert werden. Sauberste Lösung — Server kann nicht starten mit veraltetem Schema.

3. **Init-DB als separater Compose-Service** mit `depends_on: condition: service_completed_successfully`. Sauber separiert, aber mehr Compose-Komplexität, bringt im Single-Host-Setup wenig Mehrwert.

Vote: **2** als saubere Variante, **1** als pragmatischer Quick-Fix. Beide verhindern das Problem strukturell.

Risiko-Analyse: heute hatten wir Glück, weil 008 additiv (CREATE TABLE) ist — System lief weiter, nur Skill-Endpoints failed mit 500. Bei einer Migration mit `ALTER TABLE` und Code der die neuen Spalten erwartet, würde der Service beim ersten Request crashen. Bei Migration für 3.2 (MCP-Servers) oder 3.3 (Memory-Schichten) Pflicht-Vorbedingung.

**Umsetzung:** Variante 1 (Quick-Fix) gewählt — Dockerfile-CMD ist jetzt `sh -c "node dist/scripts/init-db.js && exec node dist/index.js"`. `exec` ersetzt Shell-Prozess durch Node, sauberes Signal-Handling bei `docker stop`. Migration läuft idempotent bei jedem Container-Start (skipped wenn alle Migrations schon angewendet). Lokal verifiziert mit Docker-Image-Build und Migration-Pfad-Test. Saubere Variante 2 (Migrations-Library, Server-Boot-Refactor) bleibt als Backlog-Item für später.

**Größe:** S · **Priorität:** must · **Aus:** Tag-7-Production-Deploy

### 78. Persona-File-Sync zur DB fehlt ✅
**Abgeschlossen 7. Mai 2026 (Tag 8 Mittag) — Commit `61154c0` mit Variante 1 (CLI-Tool `pnpm twin:reload <handle>`).**

Bei der #74-Verifikation entdeckt: `docs/persona.md` ist Source-of-Truth fürs Repo, aber Persona wird zur Laufzeit aus `twin_profiles.persona_md`-DB-Spalte gelesen. Sync von File zu DB findet nur einmal statt — beim initialen `pnpm twin:bootstrap`. Danach gibt's keinen Pfad mehr. File-Edit wird nicht in DB übertragen, Server bleibt auf altem Persona-Stand.

Heute (Tag 8) gelöst via Wegwerf-Skript in `/tmp/update-persona.ts`, das `readFile(docs/persona.md)` plus `TwinProfilesRepo.update(twinId, { personaMd })` macht. Funktioniert, ist aber undokumentiert und nicht reusable.

Drei Lösungs-Optionen:
1. **CLI-Tool `pnpm twin:reload-persona <handle>`** — minimal-invasiv, Production-fähig, Pattern wie `twin:set-api-key`. Vote.
2. **File-Watcher in dev-Mode** — `chokidar` auf `docs/persona.md`, automatischer DB-Update + Twin-Reload bei File-Änderung. Bequem, aber Production-fremd
3. **UI-Editor in Settings** — gehört zu #10 (UI-Bearbeitung von Persona/Mandates) und #76 (Skill-Edit via UI). Größerer Scope

Plus (Production-relevante Implication): bei Production-Deploy mit Persona-Änderung muss aktuell jemand manuell pro Twin das Update-Skript laufen lassen. Das wird bei drei Twins schon nervig, bei mehr User-Twins später unhaltbar.

**Umsetzung:** Variante 1 gewählt — neues CLI-Tool `pnpm --filter @twin-lab/runtime twin:reload <handle> [--force]`. Liest alle drei Source-Files (Persona-Markdown, Persona-Meta-YAML, Mandates-YAML) und schreibt sie in `twin_profiles`-DB. Pfad-Resolution via neuem Helper `_twin-source-paths.ts` (auch von `bootstrap-twin.ts` genutzt, doppelte Pfad-Logik entfernt). Confirm-Prompt mit y/yes/j/ja-Akzeptanz, `--force` für Skripte. Diff-Summary zeigt persona_md-chars-delta, display_name-Wechsel, mandates-count-delta. Restart-Hinweis am Ende, weil Persona/Mandates nur beim Twin-Service-Boot in den Speicher geladen werden.

**Größe:** S (Variante 1), M (Variante 2), L (Variante 3) · **Priorität:** must · **Aus:** Tag-8 #74-Verifikation

### 79. Phase-1-`persona`-Tabelle ist Altlast in DB
Bei der #78-Diagnose gesichtet: Tabelle `persona` mit `id INTEGER PRIMARY KEY CHECK (id = 1)` und `data TEXT` enthält noch den ursprünglichen Phase-1-Snapshot (single-twin, Pre-2.5.2). Wird vom Code seit Phase 2.5.2b nicht mehr genutzt — Persona kommt jetzt aus `twin_profiles.persona_md`. Tote Tabelle, harmlos, aber Confound bei DB-Inspect (man fragt sich „warum ist Workshop-Inhalt da drin?").

Migration 009 könnte die Tabelle droppen. Triviale `DROP TABLE persona;`. Nice-to-have, kein Blocker.

**Größe:** XS · **Priorität:** nice · **Aus:** Tag-8 #78-Diagnose

### 80. Direct-Chat-History-Reset fehlt (Test-Hygiene und Production-Issue) ✅
**Abgeschlossen 8. Mai 2026 (Tag 9), gemeinsam mit #71b, #84, #85 als Test-Hygiene-Block.** Lösungs-Option 1 (Konversations-Modellierung mit Reset-Button) gewählt und umgesetzt. UI-Reset im Direct-Chat-Header beendet die aktive Konversation, lazy-Start beim nächsten Send via `getOrStart()`. Vier Repo-Schichten gleichzeitig angepasst: Schema (Migration 009), Repo (`ConversationsRepo`), Audit-Verknüpfung (`audit.conversation_id`), History-Loader (server-seitig per Konversation gefiltert mit 40-Messages-Cap). Plus daten-getriebener Konversations-Trenner im Verlauf, der sowohl live als auch nach Page-Reload an der richtigen Stelle erscheint.

**Originale Beobachtung (Tag 8):**
Beim #74-Verifikations-Test entdeckt: Direct-Chat-History persistiert in der `audit`-Tabelle, wächst monoton, beeinflusst jeden Send als History-Kontext. Heute Vormittag verfälscht das den Skill-Toggle-Test: Twin nennt Workshop-Daten aus seiner eigenen früheren Antwort, nicht aus aktivem Skill.

Ist konzeptionell verwandt mit #71b (kumulative Audit-Messages als Speicher-Problem), aber spezifischer: hier geht es nicht nur um Speicher-Wachstum, sondern um **fehlenden Reset-Pfad**. Aus der UI gibt's keinen „neue Konversation starten"-Knopf, keinen „History löschen", kein Twin-Self-Reset.

Drei Lösungs-Optionen:
1. **„Neue Konversation"-Button** in Direct-Chat-UI — markiert die folgenden Audits mit neuer `conversation_id`, History-Loader filtert entsprechend. Saubere UX, schreibt nichts kaputt
2. **„History löschen"-Button** — DELETE-Statement auf alle Direct-Chat-Audits für ein Twin-Owner-Pärchen. Drastisch, aber einfach
3. **Auto-Window** — History-Loader nimmt nur die letzten N Audits oder die der letzten X Tage. Versteckt das Problem, fixt es nicht

Plus #71b-Connection: wenn beide gemeinsam angegangen werden, könnte das Audit-Schema gleich neu strukturiert werden mit echtem Sliding-Window-Pattern (vorbereitet für 3.3 Conversation-Memory).

**Test-Hygiene-Aspekt:** für Engine-Verifikation müsste man entweder die Audit-Tabelle pro Test resetten oder die History gezielt umgehen. Heute Vormittag haben wir's via DB-DELETE gelöst, was aber unsauber war (kein offizieller Pfad). 

**Priorität-Hochstufung:** vor 3.2-Strategie-Session sollte das angegangen werden, weil 3.2 (MCP-Tool-Use) nochmal viel mehr Test-Szenarien produziert. Test-Hygiene ist Pflicht-Vorbedingung.

**Größe:** M · **Priorität:** must · **Aus:** Tag-8 #74-Verifikation

### 81. `docs/`-Volume-Mount für `twin:reload` in Production ✅
**Abgeschlossen 7. Mai 2026 (Tag 8 Nachmittag) — VPS-Override-File-Pattern, kein Repo-Commit (siehe unten).**

Beim Tag-8-Production-Deploy entdeckt: das neue `twin:reload`-CLI aus #78 funktioniert lokal, aber nicht im Production-Container. Symptom: `[twin:reload] Fehler: persona.md fehlt unter /app/docs/persona.md`. Ursache: das Production-Image kopiert nur `apps/runtime/` (standalone-Pattern), `docs/` ist nicht im Image.

**Erste fehlgeschlagene Lösung (committet, dann reverted):** Volume-Mount `../../docs:/app/docs:ro` direkt in `repo/docker/twin-lab-web/docker-compose.yml`. Funktionierte lokal, aber nicht auf VPS, weil `docker-compose.yml` dort ein Symlink ist — Compose löste den relativen Pfad nicht relativ zum Symlink-Ziel auf, sondern relativ zum Symlink-Standort (`/docker/twin-lab-web/`), was zu `/docs` (Root + zwei mal hoch) wurde. Compose mountete leeres Verzeichnis. Commits `fc3389d` (broken) und `5ee5352` (revert).

**Endgültige Lösung — Override-File-Pattern auf VPS:** `/docker/twin-lab-web/docker-compose.override.yml` mit absolutem Pfad-Mount. Datei NICHT im Repo (VPS-spezifisch), nur lokal auf VPS angelegt:

```yaml
# VPS-spezifischer Override: docs/-Volume-Mount für twin:reload-CLI (#81)
services:
  runtime:
    volumes:
      - /docker/twin-lab-web/repo/docs:/app/docs:ro
```

Compose lädt `docker-compose.override.yml` automatisch und merged es mit dem Haupt-Compose-File. Vorteil: Repo-Compose-File bleibt clean (keine Lokal-vs-Production-Pfad-Verwirrung), Override ist explizit VPS-only. Pattern für künftige VPS-spezifische Konfiguration etabliert.

**Production-Workflow für Persona-Updates ist jetzt:**
1. `docs/persona.md` lokal editieren, committen, pushen
2. Auf VPS: `git pull` (File via Volume-Mount sofort im Container sichtbar)
3. `docker compose exec runtime node /app/apps/runtime/dist/scripts/twin-reload.js @<handle> --force`
4. `docker compose restart runtime` (Persona neu in Speicher laden)

Production-Update-Schritte 3+4 sollten irgendwann zu einem Skript/Make-Target zusammengefasst werden, aber out-of-scope hier.

**Größe:** XS · **Priorität:** must · **Aus:** Tag-8-Production-Deploy

### 82. Heikos Persona-Source-File `docs/persona-heiko.md` fehlt
Beim Tag-8-Production-Persona-Sync entdeckt: für @heiko gibt's keine `docs/persona-heiko.md` und keine `docs/persona-heiko-meta.yaml`. `twin:reload @heiko --force` failed mit `persona.md fehlt unter /app/docs/persona-heiko.md`.

Ursache: Heikos Twin wurde via Onboarding-Wizard angelegt, nicht via `twin:bootstrap`-Skript. Wizard schreibt direkt in DB, kein File-Backup im `docs/`-Ordner. Heikos Production-Persona ist 344 chars (Stub aus Wizard).

Lösungs-Optionen:
1. **Persona-File aus DB rückwärts erzeugen** — Reverse-Sync DB → File. Wäre eine Funktion im `twin:reload`-Tool oder ein eigenes `twin:export-persona <handle>`. Out-of-scope #78
2. **Onboarding-Wizard erweitern** — schreibt automatisch File-Backup in `docs/persona-<handle>.md` parallel zum DB-Insert. Strukturell sauberer, aber Wizard-Refactor
3. **Manuell ein File anlegen** — pragmatisch, einmalig. Wenn Heiko seine Persona ohnehin überarbeiten will, ist das jetzt der Anlass

Vote: **3 für jetzt, 2 für später.** Heute kein Druck — Heikos Twin auf Production hat einen funktionierenden Stub, der reicht für die Test-Phase. Wenn er Persona-Updates braucht: einmalig manuell `docs/persona-heiko.md` und `docs/persona-heiko-meta.yaml` anlegen, dann läuft `twin:reload`.

Verwandt mit #78 — beide entstehen aus dem File-zu-DB-Sync-Modell. Onboarding-Wizard-Erweiterung als sauberster Pfad gehört strukturell zur 2.5.3-Phase (Onboarding-Wizard) als Backwash-Item.

**Größe:** S (Variante 1, 3) / M (Variante 2) · **Priorität:** nice · **Aus:** Tag-8-Production-Deploy

### 84. Reset-Button: Inline-Confirm statt window.confirm() ✅
**Abgeschlossen 8. Mai 2026 (Tag 9), gemeinsam mit #85 als UX-Polish-Item zum #71b/#80-Block.** Sub-Schritt D hatte den Reset-Button funktional gelöst, aber `window.confirm()` als OS-natives Overlay war ein visueller Bruch zum Tailwind-Stil. Lösung: lokaler `confirming`-State im Button selbst, Klick toggled in einen Zwei-Knopf-Mini-Dialog „Wirklich? [✓ Bestätigen] [Abbrechen]". 5-Sekunden-`useEffect`-Timeout setzt zurück, wenn der User wegklickt. Pattern-Konsistenz mit den anderen kompakten Header-Buttons im Direct-Chat. Commit `76e2728`.

**Größe:** XS · **Priorität:** must · **Aus:** Tag-8 #71b/#80 Sub-Schritt D-Verifikation

### 85. Konversations-Trenner im Chat-Verlauf ✅
**Abgeschlossen 8. Mai 2026 (Tag 9), gemeinsam mit #84.** Nach Reset blieb der visuelle Verlauf unverändert (gewollt — Twin-Memory ≠ visueller Scroll), aber ohne Marker konnte der User nicht sehen wo die alte Konversation aufhörte und die neue begann. Lösung: daten-getriebene `ConversationDivider`-Komponente, die zwischen Messages mit unterschiedlicher `conversationId` gerendert wird. Backend-getrieben aus den geladenen Audits (Audit-Schema enthält `conversationId` seit Sub-Schritt B), also robust gegen Page-Reload und vorbereitet für Phase 3.3 (Multi-Konversations-Sicht). Live-Sends bekommen via `directChatResetSeq`-Counter im Parent eine synthetische Local-ID, damit der Trenner sofort nach dem nächsten Send erscheint, ohne auf einen Reload zu warten. Commit `76e2728`.

**Größe:** S · **Priorität:** must · **Aus:** Tag-8 #71b/#80 Sub-Schritt D-Verifikation

### 83. UI-Reply-Verkettung verhindert Twin-Trigger bei Folge-Fragen
Beim Tag-8-Production-Smoke-Test fiel auf: Florians Twin antwortet nicht autonom auf Markus' Bridge-Messages — obwohl Trust beidseitig gesetzt ist und der Mandate-Layer Trusted-Bypass für `respond_to_twin_message` korrekt definiert hat. Initial-Hypothese „Auto-Respond gebrochen seit 4. Mai" hat sich als falsch erwiesen.

**Tatsächliche Diagnose (Tag 9 Vormittag):**

Architektur funktioniert wie spezifiziert. Der Test `pnpm --filter @twin-lab/runtime trust:test` läuft erfolgreich durch alle drei Pfade (External-Pending, Trusted-Bypass, External-Pending nach Trust-Removal). Plus Browser-Test mit komplett leerer Konversation: Markus sendet „Hey Florian, wann hast du morgen Zeit?" → Florians Twin antwortet in 3 Sekunden via `trusted-bypass`. Audits korrekt: `owner-direct-send` → `trusted-bypass` → `reply-received`.

**Was den Twin-Trigger blockiert:** Frontend setzt bei jedem Send in einer existierenden Konversation `in_reply_to` auf die letzte Bridge-Message. Reply-Detection im Backend (`twin-service.ts:327-378`) prüft ob die referenzierte Original-Message von uns gesendet wurde — wenn ja: `reply-received` Audit, kein neuer Twin-Trigger. Heißt: nach der ersten Florian-Twin-Antwort hängen sich alle weiteren Markus-Sends an diese Antwort, Reply-Detection greift, Twin antwortet nicht mehr.

**Reproduzierbar in beide Richtungen:**
- Frische Konversation (keine vorherige Message zwischen den Twins) → Twin antwortet ✓
- Folge-Frage in laufender Konversation → Twin schweigt ✗

**Architektonische Frage:** sollen Folge-Fragen in einer Konversation Twin-Trigger erzeugen oder nicht?

Argument dafür: aus User-Sicht ist „Hey Florian, wann hast du morgen Zeit?" als zweite Frage in der Konversation **eine neue Anfrage**, nicht ein Reply auf die vorherige Antwort. Twin sollte triggern.

Argument dagegen: Reply-Detection wurde explizit eingebaut um Loop-Risiko zu vermeiden — wenn Twin auf jede Folge-Message antwortet, kann sich eine Konversation beider Twins selbst befeuern. `test-trust-flow.ts` enthält explizit Loop-Detection (`STEP_MAX_DELTA_TRUSTED = 3`) als Schutz vor genau diesem Bug aus 2.5.4.1.

**Drei Lösungs-Optionen:**

1. **`in_reply_to` nur bei explizitem Reply-Button setzen** — UI bekommt einen Reply-Button pro Bridge-Message. Send ohne Reply-Button hat `in_reply_to: NULL`, neue Frage triggert Twin. Sauber, aber UI-Refactor mit Reply-Button-Logik nötig
2. **`in_reply_to` immer leer lassen vom Frontend** — schnellster Fix. Bricht aber Reply-Threading falls für künftige UI-Features (Conversation-Threads in #20 Conversation-Memory) gebraucht
3. **Reply-Detection im Backend nur bei kurzem Zeitfenster greifen** — z.B. nur wenn letzte Bridge-Message <60s her ist. Heuristik, fragil

**Mein Vote (Markus): 1.** Sauberste Trennung zwischen User-Intent „Reply auf diese Message" und „neue Frage in der Konversation". Plus konsistent mit anderen Chat-UIs (Slack, iMessage).

**Verwandt mit #80:** History-Reset-Pfad. Beide adressieren UX-Lücken in der Konversations-UI. Könnten architektur-seitig gemeinsam gedacht werden — Konversations-Konzept (Threads, Resets, Reply-Verlinkung) als kohärentes UX-Subsystem.

**Größe:** M (Variante 1, mit UI-Refactor) / XS (Variante 2, Frontend-Quickfix) · **Priorität:** should · **Aus:** Tag-8-Production-Smoke-Test, korrigierte Diagnose Tag-9-Vormittag

**Status-Erkenntnis aus der Diagnose:** Der gestern als „echte Production-Regression" eingeordnete Bug ist keine Regression — die `trusted-bypass`-Architektur war seit 2.5.4.1 stabil und hat heute morgen im Test sauber funktioniert. Was geändert wurde: die UI-Verkettungs-Logik im Frontend produziert seit irgendwann (vermutlich Phase 2.5.5 mit Konversations-UI-Refactor) immer ein `in_reply_to`. Das versteckt den Twin-Trigger-Pfad bei allen Folge-Fragen. Ist also ein UX-Bug, nicht Architektur-Bug. Plus eine wichtige Lesson: Reply-Detection greift sowohl bei semantischen Replies („okay, danke!") als auch bei neuen Fragen, weil das Frontend nicht zwischen beiden unterscheidet. Differenzierung braucht UI-Konzept-Arbeit, nicht nur Backend-Fix.

---

## Aus Phase 3.2 entstanden

### 86. UI-Editor für Skills (Manifest + Markdown)
Heute werden Skills via CLI angelegt und über die UI nur als Read-Only-Liste mit Aktiv-Toggle dargestellt. Sub-Schritt 3.2.E erweitert das nicht — die CLI bleibt der primäre Einstiegspunkt für MCP-Server-Setup.

Was fehlt: Skill-Detail-View mit Markdown-Editor für SKILL.md, Form-Fields für Manifest, PATCH-Endpoint analog zu Persona-Reload-CLI (#78). Vorbedingung: Skill-Sync-Endpoint aus #75. Verknüpft mit #76 (Skill-Edit/Delete via UI), könnte gemeinsam adressiert werden.

**Größe:** L · **Priorität:** should · **Aus:** 3.2-Strategie-Session, langfristige UI-Editierbarkeit

### 87. UI-Konfigurator für MCP-Server pro Twin
Heute werden MCP-Server via CLI/SQL hinzugefügt (Sub-Schritt 3.2.E baut die CLI). Langfristig brauchen non-tech-User eine UI: Server-Add-Form mit Transport-Wahl (stdio/http), Command + Args, optionalen ENV-Vars (verschlüsselt analog zu API-Key), Default-Approval-Setting. Plus Server-Liste mit Aktiv-Toggle, Refresh-Tool-Discovery-Button, Server-Remove mit Cascade-Confirm.

Konzeptionell parallel zu #86 — beide sind Backend-getriebene Configs, die heute via CLI laufen, langfristig UI brauchen. Schema und Repo (3.2.A) sind so designed, dass UI später ohne Refactor möglich ist (`hasEnv`-Marker statt Plain-ENV im Output, Encrypted-Storage, Validation im Repo).

**Größe:** L · **Priorität:** should · **Aus:** 3.2-Strategie-Session

### 88. Multi-Provider Tool-Use-Adapter
Aktuelle Tool-Bridge (3.2.D) nutzt das AI-SDK direkt — `generateText({tools})` abstrahiert die Provider-API-Schemata für Anthropic/OpenAI/Google/Groq/Ollama. Funktioniert für die bestehenden Provider Out-of-the-Box ohne eigenen Adapter.

Sollte ein Provider in Zukunft Tool-Use-Spezifika haben, die das AI SDK noch nicht abdeckt (z.B. neue Function-Calling-Formate, Streaming-Tool-Calls mit Provider-spezifischen Erweiterungen, oder direkter Anthropic-Tool-Use ohne SDK), bauen wir hier einen Adapter-Layer ein. Für jetzt: das SDK macht es, kein Adapter nötig.

**Größe:** M · **Priorität:** nice · **Aus:** 3.2-Strategie-Session, Tag-10-Vormittag

### 89. LLM-Tool-Use-Verhalten tunen — Tools werden ignoriert
Beim Sub-Schritt-3.2.D-Verifikations-Test mit Claude Opus 4.7 ist aufgefallen: der LLM ruft Tools selbst dann nicht auf, wenn sie explizit angefordert werden. Bei „Bitte rufe das simulate-research-query Tool auf" antwortet er stattdessen mit einer halluzinierten Erklärung warum das Tool angeblich nicht funktioniert (technisch klingender Bullshit über `client.experimental.tasks.callToolStream()`).

Selbst mit aggressiver TOOL_USE_DIRECTIVE im System-Prompt („Behaupte nicht, dass ein Tool nicht funktioniert ohne es tatsächlich aufgerufen zu haben") ignoriert er die Anweisung. Mit `toolChoice: 'required'` ruft er Tools (Beweistest hat funktioniert), aber dann gibt er nach Tool-Result keinen finalen User-Text mehr aus — `finishReason: tool-calls`, leere Reply-Bubble.

**Diagnose:** Architektur ist korrekt (Tools werden gerendered, MCP-Call passiert bei `required`, Result fließt zurück). Das ist ein **LLM-Prompting-Problem**, nicht ein Code-Problem. Mögliche Ansätze:

1. **Aggressivere System-Prompt-Direktive** mit konkreten Negativ-Beispielen („Antworte nicht: 'Tool-Result: ...' wenn kein Tool gerufen wurde")
2. **Per-Tool-Hints im User-Prompt** statt System-Prompt — der LLM gewichtet User-Anweisungen oft stärker
3. **`toolChoice: { type: 'tool', toolName: '...' }`** für UI-getriggerte Tool-Calls (User klickt Button → Tool wird zwingend gerufen, kein LLM-Ermessen)
4. **Multi-Step-Strategy:** erster Step mit `toolChoice: 'required'` für Tool-Use, zweiter Step mit `auto` für die finale Antwort

Punkt 3 ist die robusteste Lösung, weil sie das LLM-Ermessen aus der Tool-Use-Frage rausnimmt. Verknüpft mit dem Approval-Flow aus 3.2.F — User klickt „Approve" auf einen Tool-Call, dann wird er forciert ausgeführt.

**Größe:** M · **Priorität:** should · **Aus:** Tag-10-Vormittag 3.2.D-Verifikations-Test

**Update Tag-10-Mittag (nach 3.2.F-G):** Verhalten reproduziert sich beim Approval-Smoke-Test — ohne `toolChoice: 'required'` ruft Claude Opus 4.7 das `everything-approval`-Tool nicht, halluziniert stattdessen Approval-Antworten ("Der Tool-Call liegt jetzt in der Approval-Queue. Sobald freigegeben, kommt das Ergebnis (30) zurück."). Architektur ist nachweislich korrekt — bei `required` greift der Marker-Pfad sauber, Pending-Audit entsteht, Inbox + Chat-UI rendern alle States. Aber: in Production wird das LLM bei autonomer Tool-Wahl unter-performen. Brücken-Lösung: User-getriggerte Approval-Forcierung über UI (3.2.G-Inline-UI) erzwingt Tool-Use indirekt — User-Click ist deterministisch, kein LLM-Ermessen.

### 90. Resume-Prompt-Tuning für Reject-Pfad
Beim Sub-Schritt-3.2.G-Reject-Smoke-Test aufgefallen: bei trivialen Math-Problemen ignoriert der LLM das Reject-Resume-Signal. Test-Setup: User-Message "Rufe mcp_everything-approval_get-sum mit a=99 und b=1 auf", Tool-Call wird vorgeschlagen, User klickt Reject mit Reason "Nicht freigegeben". Resume-Prompt: "[System] Tool-Call wurde abgelehnt. Begründung: Nicht freigegeben." Antwort vom LLM: "99 + 1 = 100." statt "Verstanden, ohne Tool kann ich nicht antworten."

Das ist Verhalten von Claude Opus 4.7 bei trivialen Aufgaben — er weiß `99 + 1 = 100` und gibt's einfach aus, ignoriert das Reject-Signal weil das Problem trivial lösbar ist ohne Tool. Bei nicht-trivialen Tools (z.B. echte Web-Searches oder File-Operations) tritt das Problem nicht auf, weil der LLM ohne Tool-Result gar nichts hat.

Lösungsansätze:
1. **Härteres Reject-Resume-Phrasing** — explizit instruieren "Berechne nicht selbst, beziehe dich nicht auf das Ergebnis. Sag dass ohne Tool keine Antwort möglich ist."
2. **Pro-Tool-Resume-Templates** — manche Tools (Math) brauchen anderes Reject-Phrasing als andere (Web-Operations)
3. **Kontext-Awareness** — Reject-Reason vom User in den Resume-Prompt einbauen ("Der User hat den Tool-Call abgelehnt, Begründung: ...") gibt dem LLM stärkeres Anti-Beispiel

Aktuell tritt das Problem nur bei trivialen MCP-Tool-Calls auf. Pilot-Tools (everything-Server) sind alle trivial, also ist das im Pilot-Setup ein realer Befund. Bei echten Tools (Hyperbrowser in 3.5) wird sich's vermutlich nicht zeigen, aber das Pattern sollte vor 3.5 sauber sein.

**Größe:** M · **Priorität:** should · **Aus:** Tag-10-Mittag 3.2.G-Reject-Smoke-Test

### 91. Reject-Reason-UI (window.prompt durch Komponente ersetzen)
Aktuelle 3.2.G-Implementation nutzt `window.prompt()` für die Reject-Begründung — pragmatisch und funktional, aber UX-mäßig nicht der Stand der Kunst. Browser-Prompt blockiert die UI, kein Multi-Line-Support, kein Cancel-Default-Handling, kein Theming-Bezug zur App-UI.

Saubere Lösung: Modal-Komponente oder Inline-Eingabefeld mit Textarea (analog zur Approve-/Reject-Inbox-UI in 2.5.4.3). Pattern-Vorlage: existierende Modal-Komponenten in der App-UI (z.B. Onboarding-Wizard-Modals oder Reset-Confirm-UI aus #84).

Vorbedingung: keine. Diff-Scope: Frontend only, ein Edit in `apps/web/app/chat/[handle]/page.tsx` plus eventuell Helper-Komponente.

**Größe:** S · **Priorität:** nice · **Aus:** Tag-10-Mittag 3.2.G-Implementation (window.prompt analog Inbox)

### 92. Production-Deploy von Phase 3.2 (Migrations + MCP-Setup)
Tag-10-Stand muss in Production. Diff zum Production-VPS (`5ee5352`, Tag 8) ist groß: vier neue Migrations (009-012), neue MCP-CLI, neue Inbox-UI-Render-Cases, neue Chat-Inline-Approval-UI.

Pre-Deploy-Checkliste:
- Migrations 009 (`conversations`-Tabelle), 010 (Pre-Konversations-Cleanup), 011 (`mcp_servers`-Tabelle), 012 (`skills`-Erweiterung um mcp_server_id/mcp_tool_name) müssen in Production-DB. Auto-Bootstrap aus #77 sollte das automatisch machen, aber verifizieren via Container-Logs nach Restart (`[db:init] X Migration(en) angewendet` oder `(skipped)`).
- Pilot-Server-Setup auf Production-DB für @markus — nicht aus lokaler DB übertragen, sondern via `pnpm twin:mcp-add @markus mcp-servers/everything.json` direkt auf Production-Container ausführen. ENV-Variablen `MCP_*_TIMEOUT_MS` setzen falls Defaults nicht passen.
- Smoke-Test in Production: Chat-UI, ein normaler Tool-Call (no-approval) plus ein Approval-Tool-Call. Inbox-UI plus Chat-Inline-UI verifizieren.
- Repo-Sync auf VPS (`git pull` von `bce54fb`), Container-Rebuild, restart.

Plus mögliche Stolperer: das `mcp-servers/`-Directory mit den JSON-Spec-Files muss zugänglich sein im Container — analog zu #81 (`docs/`-Volume-Mount). Override-File-Pattern verifizieren oder Dockerfile-Stage erweitern.

**Größe:** M · **Priorität:** must · **Aus:** Tag-10-Mittag, Production-Drift 7 Commits

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

### Lesson (#45): STAND.md-Drift gegen Realität ist real

STAND.md sagte "Production-Bridge live", die Realität war "Container weg, Volume jungfräulich, Setup nicht aufgeräumt". Drei Tage Drift haben gereicht. Vermutlich am 1. Mai testweise gebaut, dann abgeräumt, im STAND-File aber als "live" stehen gelassen — oder umgekehrt: STAND-File geschrieben, dann Container gestoppt und vergessen zu aktualisieren. Lehre: vor jeder Phase einen Sanity-Check gegen die echte Welt machen, nicht nur gegen das, was STAND-Files behaupten. Konkret bei #45: 5 Minuten Pre-Flight-Check (`docker ps`, `curl /health`) hätte uns 30 Minuten Falsch-Annahmen erspart. Pattern für die Zukunft: am Anfang jedes neuen Sub-Schritts ein einseitiger "Reality-Check"-Block, der prüft was die Annahmen aus STAND/Backlog tatsächlich sagen.

### Lesson (#45): Reine Lese-Befehle vor jeder Aktion zahlen sich aus

Der Plan hatte bewusst eine "Pre-Flight Checks (auf VPS, ohne was zu ändern)"-Phase, bevor irgendwas gelöscht oder gebaut wurde. Hat sich gelohnt: ohne diesen Schritt hätten wir versucht, eine "existierende" Bridge zu migrieren, die gar nicht existiert. Generelles Pattern: Ein Sub-Schritt teilt sich immer in (1) Sicht holen, (2) Plan schreiben, (3) Aktion. Nicht (1) und (3) zusammenwerfen, auch wenn der Plan kurz ist.

### Lesson (#45): Volume-Labels verraten Vergangenes

Volume-Label `com.docker.compose.project: docker` plus `bridge_data` zeigte: ehemaliges Setup lag in einem `docker/`-Verzeichnis, nicht in einem app-spezifischen Folder. Das ist bei Docker-Compose der Default, wenn Project-Name nicht explizit gesetzt wird. Lehre: bei neuem Setup immer `name:` top-level im Compose-File setzen, sonst werden Container und Volumes mit dem Verzeichnis-Namen geprefixt — was bei Umzug oder Re-Deploy für Verwirrung sorgt.

### Lesson (#59): Briefings sollten Backlog-Annahmen explizit machen

Briefing für Claude Code formulierte „End-to-End Reply-Detection 
funktioniert" als Akzeptanzkriterium und verwies auf das Trust-Flow-
Skript. Das Skript hat aber laut Backlog-Item #46 false-negative bei 
Step 6 — was Claude Code nicht wissen konnte. Bei Briefings für 
isolierte Code-Sessions: bekannte Test-Skript-Limits explizit 
erwähnen, sonst wird ein false-negative-Skript als Verifikation 
genommen.

### Lesson (#59): Existence-Leak vs. Debug-Freundlichkeit ist eine 
bewusste Entscheidung

`/messages/:id/ack` (Zeile 244-261) gibt 403 bei nicht-für-dich, 
404 bei nicht-existent — klassisches REST, debug-freundlich, leakt 
Existence. `/messages/:id/sender` gibt jetzt 404 für beide Fälle — 
identische Body, kein Existence-Leak. Trade-off bewusst getroffen 
beim sensitiveren Endpoint. Generelle Lehre: Konsistenz innerhalb 
einer App ist nicht immer das richtige Ziel — die Schutz-
Anforderungen entscheiden, nicht das Pattern.

### Lesson (#59 Production): Vorher/Nachher-Curl macht Auth-Deploys 
verifizierbar

Vor dem Deploy: `curl -i $BRIDGE/messages/$ID/sender` ohne Token → 
404 (alter Stand, keine Auth). Nach dem Deploy: identisches Curl → 
401 (neuer Stand, Auth aktiv). Das eine Curl-Paar ist der härteste 
End-to-End-Beweis, dass der neue Code wirklich live ist — härter als 
„Container restart hat geklappt" oder „Logs sehen okay aus". Bei 
jedem Auth-Hardening-Deploy künftig diesen Vorher/Nachher-Snapshot 
machen, dann hat man's schwarz auf weiß.

### Lesson (#63): Settings-UI-Lücken werden plötzlich Pflicht

API-Key-Edit war im Backlog als „später" verbucht (#10 UI-Bearbeitung 
von Persona/Mandates) — bis ein revokter Key das „später" zu „jetzt 
sofort" gemacht hat. Lehre: bei Sub-Schritten, die externe Credentials 
in Klartext oder verschlüsselt persistieren, muss es entweder UI-Edit 
geben oder ein klar dokumentierter CLI-Pfad. Sonst ist man im Notfall 
gezwungen, ein Tool unter Druck zu bauen. Nächstes Mal beim Persistieren 
sensibler Werte: gleich überlegen, wie Rotation aussieht.

### Lesson (Workflow): Ein Sub-Schritt mit zwei Commits ist okay, 
aber getrennt halten

Tag 4 Abend hatte zwei verwandte aber konzeptionell getrennte 
Änderungen — #59 Bridge-Auth und #63 CLI-Tool für Key-Rotation. 
Beide an einem Abend gemacht, zwei separate Commits (`7662dad` für 
#59, `8783d97` für #63). Sauberer als ein gemeinsamer „Tag 4 Abend"-
Commit, weil `git log --grep "#59"` nur den Auth-Code zeigt, nicht 
das CLI-Tool. Pattern für künftige Mehrfach-Sub-Schritte: trotz 
zeitlicher Nähe getrennt committen, wenn sie unterschiedliche 
Backlog-Items betreffen.

### Lesson (#64): Deploy-Key statt User-Key oder PAT als Default 
für VPS-Setups

Bei VPS-zu-GitHub-Auth gibt es drei Wege: Personal Access Token 
(user-wide, läuft ab), User-SSH-Key (voller Repo-Zugang von dieser 
Maschine) oder Repo-spezifischer Deploy-Key (read-only, ein Repo). 
Letzterer ist der sauberste — minimaler Scope, kein Ablaufdatum, 
read-only-Default. Bei VPS-Kompromittierung ist der Schaden 
begrenzt: nur ein Repo lesbar, kein Push möglich, andere Repos 
unberührt. Pattern für alle künftigen VPS-Setups: Deploy-Key, 
nicht Password und nicht User-Key. PAT nur als Notlösung wenn 
SSH-Pfad blockiert ist.

### Lesson (#64): Sub-Schritt-Pattern für nicht-Repo-zugängliche 
Sessions

Heute Vormittag war Repo-Zugang im Chat nicht möglich (privates 
GitHub-Repo, kein MCP-Connector), aber der Sub-Schritt brauchte 
ihn auch nicht: #64 ändert reine VPS-Konfiguration (SSH-Config, 
Remote-URL, Deploy-Key bei GitHub), kein Code im Repo. Heißt: 
Sub-Schritte lassen sich in drei Klassen einteilen, jede mit 
eigener Werkzeug-Anforderung:

- **Code-Sub-Schritte** (Server, Frontend, neue Files): brauchen 
  Repo-Sicht. Heute paste-n betroffener Files reicht für isolierte 
  Sub-Schritte (siehe #59-Pattern).
- **VPS / DevOps / Konfig-Sub-Schritte** (#45, #59-Production-
  Deploy, #60-Production-Deploy, #64): brauchen kein Repo, nur 
  SSH-Zugang. Werden vom User selbst auf VPS ausgeführt, 
  Outputs werden im Chat interpretiert.
- **Strategie / Doku / Konzept** (v2.1 heute morgen): brauchen 
  weder Repo-Zugang noch VPS, sondern Diskussion und 
  Synthese-Arbeit.

Implikation für Sub-Schritt-Planung: erst Klasse bestimmen, dann 
Werkzeug-Setup wählen. Spart das wiederkehrende „kann ich aufs 
Repo zugreifen?"-Hin-und-Her.

### Lesson (2.5.6 A.1): Suspense-Boundary am Verbraucher, nicht in der Komponente

`useSearchParams()` und andere Client-only-Hooks brechen Static-Generation, wenn die Komponente nicht in einem Suspense-Boundary steckt. Zwei Patterns möglich: Suspense in der Komponente selbst (Wrap-internal) oder Suspense beim Verbraucher (z.B. `<Suspense><AppHeader/></Suspense>` im Layout). Pattern b) gewann, weil:
- AppHeader/AppFooter bleiben einfach lesbar (keine eigene Suspense-Logik intern)
- Layout entscheidet einmal über Loading-Verhalten der Nav
- `fallback={null}` reicht — Nav darf für 50ms „weg" sein, kein UX-Problem

Anti-Pattern: `useSearchParams` einfach durch `usePathname` ersetzen, um den Hook zu vermeiden — verliert Funktionalität. Lieber Suspense.

### Lesson (2.5.6 A.2): packages/shared braucht eigenes dist/ für Produktion

Lokale Entwicklung mit `tsx` und Next-dev-Auflösung verzeiht `main: "src/index.ts"`. Production-Container-Node ohne tsx-Loader bricht mit ERR_UNKNOWN_FILE_EXTENSION. Diagnose ist nicht offensichtlich — der Build läuft durch, der Container startet, das Failure passiert erst beim ersten Import.

Pattern: shared baut explizit nach `dist/`, `package.json` zeigt mit `main`/`types`/`exports` darauf, `files: ["dist"]` für pnpm-deploy. predev-Hook in jeder App, damit lokale Entwicklung weiter ohne manuellen Build-Schritt funktioniert. Dockerfiles bauen shared explizit vor App-Build.

Allgemeineres Prinzip: shared-Packages in einem Monorepo brauchen ein klares Production-Artefakt, sonst rächt sich die lokale Bequemlichkeit beim ersten Container-Build.

### Lesson (2.5.6 A.3): Hot-Reload-Pattern für Multi-Tenant-Onboarding

Vorher-Annahme war: Boot-Code läuft einmal, lädt alle Twins aus DB, Server läuft. Wenn neuer Twin angelegt wird → Restart. Das brach, sobald Onboarding möglich war.

Pattern für Multi-Tenant: Server akzeptiert leere DB als gültigen Onboarding-only-Modus, Registry hat `addTwin(id)`-Methode mit Mutex gegen Race-Conditions. Hot-Reload heißt nicht „Code-Reload", sondern „in-Memory-State-Update bei DB-Änderung". 

Wichtige Detail: Mutex über Promise<void>-Map, nicht boolean-Lock. Erst-Caller löst Promise aus, parallele Caller awaiten denselben Promise — niemand startet zweiten Init. Idempotent ist die `addTwin`-Methode auch: zweiter Aufruf für denselben Twin gibt cached Result zurück.

### Lesson (2.5.6 A.4): NEXT_PUBLIC ist nicht Runtime-ENV

Wer das erste Mal Next deployed, läuft in diese Falle: `NEXT_PUBLIC_*` heißt nicht „dynamische Runtime-Variable für den Browser", sondern „Compile-Zeit-Konstante, die ins Client-Bundle inlined wird". Compose-`environment:` setzt sie zur Runtime — zu spät.

Pattern: ARG/ENV im Dockerfile-Builder-Stage, `--build-arg` beim `docker build`. README-Eintrag mit Beispiel-Aufruf. Wer das nicht weiß, debuggt stundenlang gegen ein hartcodiertes `localhost:4000` im Bundle.

Allgemeineres Prinzip: bei statischem Site-Build ist „Browser-zugängliche Variable" = „Build-Zeit-Konstante". Runtime-Konfigurierbarkeit gibt's nur über Server-Komponenten oder API-Calls.

### Lesson (2.5.6 A.5): Cross-Subdomain-Cookies brauchen explizite Domain

Cookie ohne `Domain`-Attribut bleibt auf der setzenden Subdomain. Wenn Frontend (`app.*`) und Backend (`runtime.*`) verschiedene Subdomains sind, schickt der Browser den Cookie nur zur Backend-Subdomain — Frontend hat ihn nicht, Login funktioniert nicht obwohl POST-Login 200 zurückgibt.

Fix-Patterns, von schmutzig zu sauber:
1. **Cookie mit Domain=.parent.tld** (heute gewählt) — Browser schickt Cookie an alle Subdomains. Erfordert ENV-getriebene Konfiguration, weil lokale HTTP-Setups keinen Domain-Cookie wollen.
2. **Same-Origin via Reverse-Proxy** (Backlog #65) — alle Calls gehen über `app.*`, Path-Prefix `/api/*` routet zur Runtime. Cookie bleibt automatisch am Origin.
3. **Token im Body statt Cookie** — JWT in localStorage, kein Cookie-Problem mehr. Aber: XSS-Risiko, Logout schwerer, Auth-Header bei jedem Call.

Heute: Variante 1, weil schnellste Lösung mit kleinstem Patch (zwei ENVs, ein Helper). Variante 2 als Backlog für später.

### Lesson (2.5.6 Hairpin): Container-zu-Container-Hop schlägt Public-URL

Naive Annahme im Multi-Container-Setup auf einem Host: Container A ruft Container B via dessen Public-URL. Realität: viele VPS-Provider blocken Hairpin-NAT, Connect-Timeout. Plus: TLS-Overhead, DNS-Lookup, Bandbreite.

Pattern: Container im selben Docker-Network, Hostname = Container-Name (`http://twin-lab-bridge:5100`). Schneller, zuverlässiger, kein Hairpin nötig. ENV-getriebener Pfad, damit lokal weiter Public-URL gehen kann.

Diagnose-Hilfe: bei Connect-Timeouts in Multi-Container-Setups als allererstes prüfen, ob es Hairpin-NAT ist. Symptom: Container kann Public-URL des Hosts nicht erreichen, Container kann andere Public-URLs erreichen.

### Lesson (2.5.6 Bridge-Cleanup): Pre-existing State ist Production-Reality

Bridge stand seit 3. Mai mit drei Test-Handles (markus/florian/heiko). Web-Stack vom 4. Mai mit eigener leerer DB versucht dieselben Handles neu zu registrieren → Bridge meldet „existiert bereits". Cleanup-Pfad: alte Handles via Volume-Mount in alpine-Container mit sqlite3 löschen.

Pattern für künftige Re-Bootstraps: vor Onboarding immer pre-existing State des Backend-Stores verifizieren, ggf. cleanen. In CI-/Test-Setups sowieso, in Production bei expliziten Migration-Schritten.

Allgemeineres Prinzip: in Multi-Service-Architekturen ist „leerer Anfangszustand" oft Wunschdenken. Service A weiß nichts von Service B's State, Aufstartreihenfolge kann zu phantom-konflikten führen.

### Lesson (2.5.6 Workflow): Sub-Schritt-Disziplin bei langen Sessions

Heute: 11 Stunden Pair-Programming, 8 Code-Commits, 6 Phase-Markierungen (A, A.1-A.5). Disziplin „ein Sub-Schritt, ein Commit, ein Caveat-Check, dann nächster Sub-Schritt" hat verhindert, dass Bugs sich verschachteln. Gegenbeispiel: ohne Disziplin hätten Suspense-Bug, shared-Build-Bug, NEXT_PUBLIC-Bug, Cookie-Bug ein einziges 4-Stunden-Bug-Hunt-Knäuel werden können — keiner identifizierbar isoliert.

Pattern: jeder Sub-Schritt hat (a) klares AK, (b) klaren Diff-Scope, (c) klares „durch wenn"-Kriterium. Briefing dokumentiert die drei Punkte, dann Implementation, dann Verifikation, dann nächster Sub-Schritt — neues Briefing.

Schwellenwert für Sub-Schritt-Aufteilung: wenn ein Bug-Hunt > 30 Minuten dauern würde, dann ist der Bug ein eigener Sub-Schritt mit eigenem Commit, nicht „noch im aktuellen Schritt mitgemacht".

### Lesson (Tag 6 / #43): Reality-Check vor Briefing-Schreibung

#43 stand seit drei Tagen im BACKLOG als „should". Vor dem Briefing-Schreiben kurzer Check des aktuellen Codes (`AppHeader.tsx`) — und siehe da, der Fix war längst drin. Implementiert in 2.5.4 UX-Iteration Briefing #19, ohne als Backlog-Item-Erledigung notiert worden zu sein.

Lesson: Bevor man ein Briefing schreibt, einmal den aktuellen Code lesen. Drei Minuten Reality-Check sparen 30 Minuten Briefing-Schreibung plus Live-Test. Ist konsistent mit dem `git status` / `docker ps` / `curl /health` Pre-Flight-Check aus #45.

Pattern: jeder Sub-Schritt beginnt mit einem 2-3-Zeilen-Reality-Check. Was ist heute der Code-Stand? Existiert der Bug noch? Welche Files sind beteiligt? Erst dann Briefing.

### Lesson (Tag 6 / #71): Capability-Naming-Disziplin

#71 brauchte zwei Commits, weil die erste Implementation nur auf `respond_to_chat` filterte — aber Owner-Bypass-Pfad schreibt `owner-direct`. Beide sind konzeptionell „Direct-Chat-Audits", werden aber mit unterschiedlicher Capability persistiert (Trade-off aus 2.5.4.1 Architektur-Entscheidung).

Subtler Punkt: das Audit-Schema hat ein `originalCapability`-Feld in `input`, das bei `owner-direct` auf `respond_to_chat` zeigt. Hätte das Frontend dieses Feld als Filter-Source genutzt, wäre die Capability-Verzweigung im Frontend transparent gewesen.

Generelle Lehre: bei Bypass-Architekturen entstehen mehrere Capabilities für dasselbe konzeptionelle Ereignis. Frontend-Filter sollte alle Varianten berücksichtigen, oder Backend sollte Bypass-Markierung anders auflösen (z.B. Capability gleich, separates `bypassed: true`-Feld).

Pattern für künftige Multi-Capability-Filter: `Set<string>`-Konstante am File-Anfang, kommentiert warum mehrere Capabilities gleich behandelt werden. Macht es zukunftssicher gegen weitere Bypass-Pfade.

### Lesson (Tag 6 / #71): Spec-Deviations dokumentieren, nicht zurückdrängen

Briefing schrieb `input.messages[0].content` als Render-Source. Claude Code hat im Code geprüft (`twin-service.ts:106,130`) und gesehen, dass `input.messages` kumulativ ist — `[0]` wäre N-mal die Erst-Message. Stattdessen `input.lastMessage` benutzt, mit Code-Referenz als Begründung.

Das ist genau der richtige Move. Briefing-Spec ist Vorgabe, aber nicht heilig. Wenn Claude Code im Code sieht, dass die Spec falsch ist, soll es korrigieren, nicht stumm umsetzen oder rückfragen. Wichtig: die Korrektur klar kennzeichnen („Spec-Deviation: ..."), Begründung mit Code-Referenz, und das Briefing im Nachgang aktualisieren.

Pattern: Briefing ist Hypothese, Code-Realität ist Truth. Bei Konflikt gewinnt Code, mit dokumentierter Begründung.

### Lesson (Tag 6 / Hydration-Phantom): ENV-Var-Änderungen brauchen Hard-Reload

`next dev` Hot-Reload räumt das Bundle bei ENV-Variable-Updates nicht zuverlässig. Symptom: Hydration-Error nach `--build-arg`- oder `process.env`-Änderungen, der nach Hard-Reload (Cmd+Shift+R) komplett verschwindet.

15 Minuten Diagnose verloren, weil ich versucht habe den Bug logisch zu erklären, statt einfach Hard-Reload als ersten Reflex zu nutzen.

Pattern für künftige Frontend-Sessions: bei jedem File-Save in `.env*`, `next.config.mjs`, oder Dockerfiles → einmal Hard-Reload, bevor Bug-Diagnose anfängt. Spart Phantom-Bugs.

### Lesson (Tag 7 / 3.1.B): Pattern aus 2.5.4.1 als Vorlage für neues Subsystem

3.1.B hat 7 Minuten Code-Zeit gebraucht, weil Trust-Layer aus 2.5.4.1 das Pattern vorgegeben hat: DB-Repo + Routes-Funktion + Registry-Dependency-Injection + Test-Skript mit Mock-LLM. Skill-System ist konzeptionell ein anderes Domain, aber strukturell exakt dieselbe Architektur.

Generelles Prinzip: bei neuen Multi-Tenant-Features in twin-lab — Mandate-System, Trust-Layer, Skill-System, später Memory-Schichten — ist das Pattern „Pro-Twin-Tabelle + Repo + DI über Registry + Routes-Funktion + Mock-Test" robust genug, dass Briefings 1:1 auf existierende Code-Stellen referenzieren können statt freihändig zu spezifizieren.

Briefings für künftige Phase-3-Sub-Schritte sollten bewusst auf diese Vorlage zeigen — spart Code-Zeit und macht Architektur konsistent.

### Lesson (Tag 7 / 3.1.D): Briefing-Pfad-Bug bei pnpm-filter-Aufrufen

Im 3.1.D-Briefing standen Verifikations-Befehle wie `pnpm --filter @twin-lab/runtime twin:skill-create @markus apps/runtime/skills-templates/_test-skill`. Lief auf `apps/runtime/apps/runtime/skills-templates/_test-skill` — `apps/runtime/`-Prefix wurde doppelt, weil `pnpm --filter` bereits ins Workspace-Verzeichnis wechselt.

Korrektur: relativ zum Workspace aufrufen (`skills-templates/_test-skill` ohne Prefix), oder absoluten Pfad nutzen. Claude Code hat den Bug nicht erkannt, weil das Briefing eindeutig formuliert war — der Bug war konzeptionell auf User-Ebene (Pfad-Auflösung), nicht im Code.

Pattern für künftige Briefings mit pnpm-filter-Aufrufen: explizit notieren, dass Pfade relativ zum Filter-Target sind. Oder besser: Beispiele mit absoluten Pfaden geben, die garantiert funktionieren.

### Lesson (Tag 7 / Cleanup): tsx-Inline-Eval kann keine relativen Imports auflösen

Cleanup-Skript für 3.1.D-Test sollte als `pnpm exec tsx -e "..."` mit `import { ... } from './src/...js'` laufen. Brach mit `Cannot find module './src/config.js'`, weil `tsx -e` die Source aus `[eval]` ausführt — `[eval]` hat keinen Filesystem-Anker, relative Imports lösen nicht auf.

Zwei pragmatische Workarounds: (a) Wegwerf-Skript als Tempfile schreiben, dann `tsx /tmp/cleanup.ts`, oder (b) SQL direkt nutzen (`sqlite3 data/twin.db "DELETE FROM ..."`). SQL ist schneller, sicherer (kein TS-Build-Pfad), und bei einfachen Cleanup-Operationen die richtige Wahl.

Pattern: für DB-Inspektion oder -Cleanup während Verifikation → erste Wahl ist sqlite3-CLI, nicht tsx-eval. Inline-tsx eignet sich nur für Multi-Step-Logik, die nicht mit SQL ausdrückbar ist.

### Lesson (Tag 7 / 3.1.E): Engine-Test ist verlässlicher als Browser-Test bei Persona-Confound

Browser-Test für 3.1.E (Skill-Toggle aus → Twin verliert Wissen) war kompromittiert, weil `docs/persona.md` denselben Workshop-Inhalt hatte wie der Skill. Twin antwortete trotz `is_active=0` korrekt — aus Persona, nicht aus Skill.

Engine-Test (`test-skill-engine.ts`) hat parallel grün durchlaufen mit isoliertem Mock-LLM und sauberer Schichten-Reihenfolge-Assertion. Damit war klar: Engine ist correctness-mäßig in Ordnung, der Browser-Confound ist ein Daten-Problem (Persona-Skill-Doppelung), kein Code-Bug.

Generelles Prinzip: bei verdächtigen Browser-Symptomen erst Engine-Test laufen lassen, dann debuggen. Engine-Tests sind Mock-LLM-basiert, schnell, deterministisch — Browser-Tests sind LLM-basiert, langsam, nicht-deterministisch. Bei Konflikt zwischen den beiden gewinnt der Engine-Test als Truth-Source.

### Lesson (Tag 7 / 3.1.E): UI-Payload-Filter als Konvention für Listen-Endpoints

Skill-DB-Records enthalten Manifest, SKILL.md, optional Script — alles potentiell groß. Listen-Endpoints sollen nicht alles ausliefern. 3.1.E-Pattern: Backend-Helper `toSkillUiPayload()` schneidet schwere Felder raus, ersetzt durch Char-Counts (`instructionsLength`) und Bool-Flags (`hasScript`).

Pattern für künftige Listen-Endpoints in twin-lab: separates UI-Payload-Schema in `packages/shared`, das die Wire-Form von der DB-Form trennt. Backend liefert UI-Form, Frontend importiert UI-Type. Macht Wire-Format vorhersehbar und erlaubt DB-Schema-Änderungen ohne Frontend-Auswirkung.

Verwandt: `instructionsLength` und `hasScript` als Pattern für „große Felder kompakt repräsentieren". Bei Memory-Schichten in 3.3 vermutlich wieder relevant (Conversation-Summary statt full History).

### Lesson (Tag 7 / Workflow): Vier Sub-Schritte am Vormittag ist Tempo-Ausreißer, nicht Norm

3.1.A bis 3.1.F (Modulo F als Daten-Op) an einem Vormittag — ungewöhnlich schnell. Faktoren, die das ermöglicht haben:

- Architektur war vor 3.1.A klar (Strategie-Session vorab)
- Pattern aus 2.5.4.1 als Vorlage (siehe vorige Lesson)
- Briefings waren detailliert und referenzierten existierende Code-Stellen (Trust-Routes, set-api-key-Tool)
- Verifikations-Schritte klar dokumentiert (Test-Skripte, Curl-Befehle, SQL-Inspect)

Schätzungen für 3.2 (MCP-Client) sollten NICHT auf diesem Tempo basieren. MCP ist ein Protokoll-Standard mit eigenen Edge-Cases (Stdio vs. HTTP-Transport, Tool-Schema-Validation, Server-Capabilities-Discovery), keine Trust-Repo-Variante. Zeitfenster-Annahme aus ROADMAP (1-2 Wochen) ist realistischer als „4 Stunden".

Generelles Prinzip: Tempo-Ausreißer als Datenpunkt nehmen, nicht als Baseline. Schätzungen kalibrieren sich erst nach 3-4 Sub-Schritten in einer neuen Domain.

### Lesson (Tag 7 / Strategie): Pre-Implementation-Strategie-Sessions sind Hebel

Vor 3.1.A gab's eine ~30-Min-Session, in der fünf Architektur-Entscheidungen festgelegt wurden (Hybrid-C, DB-Storage, Capability-Mapping, MCP-als-Source, Strategie-B). Die Entscheidungen waren so klar, dass die folgenden Sub-Schritte ohne weitere Architektur-Diskussion durchliefen.

Vergleich zu 2.5.6 (Production-Web-Deployment, Tag 5): viele kleine Architektur-Entscheidungen wurden ad-hoc während der Implementation getroffen (Container-zu-Container-Hop, Cookie-Domain via ENV, NEXT_PUBLIC als Build-ARG). Funktionierte auch, aber kostete mehr Bug-Hunt-Zeit.

Pattern: bei neuen Phase-Blöcken (3.2 MCP-Client, 3.3 Memory) zuerst eine Strategie-Session mit konkreten Architektur-Festlegungen. Erst dann Sub-Schritt-Briefings schreiben. Spart Implementation-Zeit, weil Claude Code Entscheidungen nicht selbst treffen muss.

### Lesson (Tag 7 / Production-Deploy): Lokaler predev-Hook versteckt Production-Bugs

`pnpm dev` ruft via `predev`-Hook automatisch `pnpm db:init` auf, bevor der Server startet. Lokal heißt das: jede neue Migration läuft beim ersten Dev-Start automatisch durch. In Production startet der Container direkt `node dist/index.js` — ohne Migration-Lauf.

Heute (Tag 7): Migration 008 (Skills-Tabelle) wurde gepullt, Image neu gebaut, Container neu gestartet — und failed bei jedem Skills-Endpoint-Aufruf mit `no such table: skills`. Ad-hoc-Fix war `docker compose exec runtime node /app/apps/runtime/dist/scripts/init-db.js`. Idempotent, hat sauber 008 angewendet.

Generelles Prinzip: **was lokal automatisch passiert (predev, postinstall, etc.) muss in Production explizit sein.** Andernfalls findet man die Diskrepanz erst beim Production-Deploy einer kritischen Migration. Hat heute keinen Schaden angerichtet (Migration ist additiv, System lief weiter), wäre bei `ALTER TABLE` und Code der die neuen Spalten erwartet ein Service-Crash.

Konkreter Pattern für künftige Container-Setups: alle predev/predeploy-Hooks aus `package.json` durchgehen, prüfen ob das Production-Equivalent (Dockerfile-CMD oder Compose-depends_on) sie abdeckt. Ist nicht der Fall — Backlog-Item, idealerweise vor dem nächsten Production-Deploy fixen.

Backlog-Item #77 dokumentiert die Lösungs-Optionen.

### Lesson (Tag 8 / #74): Engine-Test ist Truth-Source bei Persona-File-DB-Diskrepanz

Heute Vormittag verbrachten wir ~30 Min mit der Suche nach „warum nennt der Twin Workshops obwohl Skill aus und Persona-Block raus". Browser-Test zeigte: Twin antwortet wie vor der Persona-Edit. Annahme war: Toggle hat nicht durchgegriffen oder Server-Cache. Reality: Persona wird aus DB-Spalte `twin_profiles.persona_md` gelesen, nicht aus File. File-Edit allein wirkungslos.

Engine-Test (`test-skill-engine.ts`) hätte den Confound nicht aufgedeckt — er testet die Skill-Pipeline mit isolierter Mock-Persona, nicht den Server-Boot mit DB-Persona. **Aber:** der Engine-Test war ein wichtiger Datenpunkt zur Eingrenzung — er zeigte „Skill-System funktioniert in Isolation", was die Diagnose von „Toggle-Bug" auf „Persona-Source-Confound" verschob.

Generelles Prinzip: bei verdächtigen Browser-Symptomen Engine-Test als ersten Schritt laufen lassen. Wenn Engine grün UND Browser red: das Problem ist in der Daten-Pipeline (DB-State, Loading-Pfad, Cache), nicht in der Engine.

Verwandt mit Tag-7-Lesson „Engine-Test verlässlicher als Browser-Test bei Persona-Confound" — heute zweite Bestätigung des Prinzips, plus präzisierte Aussage: **Engine ≠ Pipeline**, beide brauchen separate Tests.

### Lesson (Tag 8 / #74): Architektur-Befunde finden sich beim Verifizieren, nicht beim Implementieren

#74 war als „kleiner Sub-Schritt ~30 Min" eingeschätzt. Tatsächlich: ~90 Min, davon ~30 Min Implementation und ~60 Min Diagnose plus drei neue Backlog-Items (#78, #79, #80) plus #71b-Hochstufung.

Der eigentliche Code-Diff ist trivial (8 Zeilen Persona-File-Edit). Der Wert kommt aus dem Verifikations-Prozess:
- File-Edit landet nicht in DB → #78 (Persona-Sync-Pfad fehlt)
- `persona`-Tabelle ist Phase-1-Altlast → #79 (Tidy-up via Migration)
- History verfälscht Tests → #80 (Reset-Pfad fehlt) + #71b-Hochstufung

Generelles Prinzip: bei Refactor-artigen Sub-Schritten die Verifikation nicht als „letzter Smoke-Test" sehen, sondern als **eigentlichen Erkenntnis-Phase**. Implementation ist mechanisch, Verifikation deckt Architektur-Lücken auf. Plan dafür eingeplant: 50% Implementation, 50% Verifikation plus Backlog-Updates.

### Lesson (Tag 8 / Wegwerf-Skripts): tsx mit absoluten Imports und async-main

Bei #74-Verifikation drei Mal in Wegwerf-Skripts gestolpert:
1. Relative Imports wie `./src/config.js` funktionieren nicht in tsx-Inline-Eval (`tsx -e "..."`) und auch nicht in Tempfiles, weil `[eval]` keinen Filesystem-Anker hat. Lösung: absolute Pfade in den Imports.
2. Top-Level-await funktioniert in tsx mit CJS-Output nicht (esbuild-Constraint). Lösung: alles in `async function main() { ... }; main().catch(...)` wrappen.
3. SQL-Direct-Insert mit Markdown-Inhalt ist Stress (Quoting, Newlines, Sonderzeichen). Wenn TS möglich: TS-Skript ist sicherer.

Pattern für künftige DB-Operations bei Verifikations-Phase:
- Strukturierter Repo-Code (TwinProfilesRepo, SkillRepo) statt Roh-SQL
- Tempfile statt `tsx -e`-Inline
- Async-Wrapper als Standard
- Absolute Pfade in Imports zum Workspace-Root

Drei Patterns sind heute drei Mal aufgetaucht — gehört in eine wiederverwendbare Skript-Vorlage. Vielleicht als `apps/runtime/src/scripts/_template.ts`-File mit Boilerplate, dass man kopieren kann.

### Lesson (Tag 8 / Process): `ps -o lstart=` ist macOS-inkompatibel

Versucht: `ps -p 35734 -o lstart=` um Server-Start-Zeit zu bekommen — zeigt auf macOS `Invalid process id: -o`. Auf Linux funktioniert das, auf BSD-`ps` (macOS-Default) andere Syntax.

Macht-OS-Workaround:
```
ps -p <PID> -o lstart
```
(ohne `=` am Ende) — funktioniert. Oder direkter:
```
ps -p <PID> -o etime
```
zeigt verstrichene Zeit seit Start.

Lesson für Cross-Platform-Briefings: ps-Optionen sind nicht portabel zwischen Linux und macOS. Wenn Briefing auf macOS-Dev und Linux-Server gleichzeitig laufen muss: entweder beide Varianten nennen oder eine Lösung wählen die auf beiden funktioniert (z.B. `stat -c %y /proc/<PID>` auf Linux, oder Process-Start aus Logs).

### Lesson (Tag 8 / #78): Helper-Extraktion bei zweitem Aufruf, nicht beim ersten

#78 hat einen kleinen Architektur-Effekt produziert: die Pfad-Resolution-Logik aus `bootstrap-twin.ts` (Markus = Default-Pfade ohne Suffix, andere = `-<handle>`-Suffix) wurde in `_twin-source-paths.ts` extrahiert, weil das neue `twin-reload`-Skript dieselbe Logik braucht. Plus: `bootstrap-twin.ts` wurde direkt mit umgestellt — keine doppelte Wahrheit, kein Code-Drift-Tech-Debt.

Generelles Prinzip: **DRY beim zweiten Aufruf, nicht beim ersten.** Premature Abstraction kostet mehr als sie spart. Erst wenn klar ist, dass eine Logik mehrfach gebraucht wird (zweiter Aufruf), lohnt sich die Extraktion. Für #78: Pfad-Logic war erstmal in `bootstrap-twin.ts` inline okay (eine Stelle, ein Twin-Setup-Skript). Erst als `twin-reload` dieselbe Logic braucht, wird's ein shared Helper.

Plus eine kleine Konvention: Underscore-Prefix für shared Helpers in `scripts/`-Ordner — `_twin-source-paths.ts` signalisiert „kein ausführbares Script, sondern Hilfsmodul". Pattern für künftige shared Skript-Helpers übernehmen.

### Lesson (Tag 8 / #81): Compose-Symlinks und relative Pfad-Auflösung

`/docker/twin-lab-web/docker-compose.yml` ist auf VPS ein Symlink zu `repo/docker/twin-lab-web/docker-compose.yml`. Erste Lösung war Volume-Mount mit relativem Pfad `../../docs:/app/docs:ro` direkt im Repo-Compose-File — funktionierte lokal (echte Datei), aber nicht auf VPS (Symlink). Docker Compose löst relative Pfade **vom Symlink-Standort, nicht vom Symlink-Ziel auf**. Heißt: `../../docs` von `/docker/twin-lab-web/` aus = `/docs` (Root + zwei mal hoch).

`docker compose config` zeigt die fully-resolved Konfiguration und ist das richtige Diagnose-Tool: `source: /docs` war eindeutig falsch. Plus `docker inspect <container> --format='{{range .Mounts}}{{.Source}} -> {{.Destination}}{{end}}'` zeigt was tatsächlich gemounted wurde.

Lösung: Override-File-Pattern. `/docker/twin-lab-web/docker-compose.override.yml` mit absolutem Pfad. Compose lädt `docker-compose.override.yml` automatisch aus dem gleichen Verzeichnis und merged es. VPS-spezifische Konfiguration bleibt VPS-spezifisch, Repo-Compose-File bleibt portable.

**Generelles Prinzip:** Repo-Code soll lokal und Production identisch sein. VPS-spezifische Anpassungen gehören nicht ins Repo, sondern in Override-Files oder ENV-Variablen. Pattern für künftige VPS-Spezifika übernehmen.

Plus Lesson zum Diagnose-Workflow: bei verdächtigen Mount-Problemen erst `docker compose config` (was Compose ausgehandelt hat) plus `docker inspect` (was Docker tatsächlich macht), dann debuggen. Zeile-für-Zeile-Compose-Lesen ohne diese Tools ist verschwendete Zeit.

### Lesson (Tag 8 / Production-Drift): Lokal vs. Production divergieren leise

Beim Production-`twin:reload @markus --force` kam ein überraschender Diff: `persona_md: 244 → 6991 chars (+6747)`. Production-Markus hatte einen 244-Zeichen-Stub aus dem Onboarding-Wizard, nicht die volle Persona aus `docs/persona.md`. Niemand hat's gemerkt, weil Production-Markus selten direkt getestet wurde.

Verstehen warum: Lokal-Bootstrap nutzt `pnpm twin:bootstrap` mit `docs/persona.md` als Source. Production-Bootstrap (für die ersten User-Twins inklusive Markus' Production-Account) lief via Onboarding-Wizard, der eine Stub-Persona erzeugt. Beide Setups produzieren technisch valide Twins, aber mit semantisch unterschiedlichem Inhalt.

Generelles Prinzip: **Multi-Tenant-State ist nicht automatisch zwischen Environments synchron.** Bei Architektur-Änderungen (wie #74-Persona-Refactor) muss explizit geprüft werden, was lokal vs. Production drin ist. Ein einfacher Smoke-Test wie „stell @markus auf Production eine Frage und schau ob sich's wie der lokale Twin anfühlt" hätte den Drift früher aufgedeckt.

Plus konkret: `twin:reload @<handle> --force` plus DB-Diff-Output ist ein gutes Production-Audit-Tool. Bei jedem Production-Deploy mit Persona-relevanten Änderungen lohnt sich der Lauf — entweder zeigt's `unverändert` (alles gut) oder es deckt einen Drift auf.

### Lesson (Tag 9 / #71b): 5-Sub-Schritt-Aufteilung beim Schema-Refactor zahlt sich aus

Der Test-Hygiene-Block (#71b + #80) hätte als ein 3-4h-Mega-Commit angelegt werden können (Schema + Repo + Service + Loader + UI alles in einem). Stattdessen fünf Sub-Schritte (A/B/C/D/E) plus zwei UX-Polish-Items (#84/#85), jeder einzeln testbar.

Effekt: jede Schicht hatte ein eigenes Test-Skript (`test-conversations-repo.ts`, `test-conversation-flow.ts`, `test-conversation-history.ts`), das genau ihren Layer verifiziert hat. Bugs sind sofort an der Stelle aufgefallen, wo sie reingekommen sind, nicht erst beim End-to-End-Test. Plus: jeder Commit war sauber rückverfolgbar.

Generelles Prinzip: **bei Multi-Layer-Refactors immer pro Layer einen Sub-Schritt + Test, statt alles in einem Commit zu mischen.** Pattern für künftige Schema-Refactors (z.B. 3.3 Conversation-Memory, das ähnlich tief geht) übernehmen.

Plus eine kleine Variante: die UX-Polish-Items (#84 Inline-Confirm, #85 Trenner) sind gemeinsam mit dem funktionalen Block gemerged worden — nicht als „nächste Session". Begründung: Inline-Confirm und Trenner sind direkt aus den Sub-Schritt-D-Smoke-Tests entstanden („`window.confirm()` ist hässlich", „kein Marker im Verlauf"). Wer die Schwachstelle sieht und nicht löst, wird sie nicht mehr sehen, wenn sie länger steht. Zwei zusätzliche Items innerhalb der gleichen Session ist okay.

### Lesson (Tag 9 / #85): Backend-getriebene UI-Marker statt State-Marker

Der Konversations-Trenner hätte als Frontend-State implementiert werden können („User klickt Reset → setze Marker an Position N im messages-Array"). Stattdessen: daten-getrieben aus den geladenen Audits — der Render-Loop vergleicht zwei aufeinanderfolgende Messages und rendert einen Trenner, wenn die `conversation_id` wechselt.

Effekt: Page-Reload, Tab-Switch, Re-Mount — der Trenner steht überall an derselben Stelle, weil aus den persistenten DB-Daten abgeleitet. Plus: Vorbereitung für Phase 3.3 (Multi-Konversations-Sicht) — derselbe Render-Code zeichnet später mehrere historische Konversationen mit Trennern dazwischen, ohne neuen Code.

Plus eine Hybrid-Detail: für Live-Sends, deren `conversation_id` der Server erst nach Reload zurückspielt, gibt's einen kleinen Counter im Parent (`directChatResetSeq`), den der Reset-Button hochzählt. Live-Messages bekommen dann eine synthetische Local-ID, damit der Trenner sofort nach dem nächsten Send erscheint, nicht erst nach Reload. Lokale Hybrid-Logik unter daten-getriebener Render-Logik — beste aus beiden Welten.

Generelles Prinzip: **bei UI-Markern, die aus persistenten Daten ableitbar sind, daten-getrieben rendern statt im State zu führen.** State-Marker driften (Reset-Klick verloren bei Reload), Daten-Marker bleiben.

### Lesson (Tag 10 / 3.2.F): Marker-Pattern statt Throw-Pattern bei AI SDK Tool-Hooks

Beim Sub-Schritt 3.2.F wurde der Approval-Trigger initial als Throw-Pattern designed: `tool-bridge.ts` `execute()` wirft `McpToolApprovalRequiredError`, Twin-Service catcht den auf der `generateText`-Ebene, baut Pending-Audit. Konzeptionell sauber — Custom-Error-Klasse, klar erkennbar, Defense-in-Depth-fähig.

Smoke-Test zeigte aber: AI SDK 6 propagiert Throws aus `execute()` **nicht** nach oben. Stattdessen wird der Error als `tool-result mit output: null` umgewandelt, an den LLM zurückgegeben, LLM-Loop läuft weiter, finishReason: 'tool-calls', leerer Text. Twin-Service sah keinen Throw, schrieb leeren `owner-direct`-Audit, kein Pending entstand. Architektur war konzeptionell richtig, aber AI-SDK-Implementierungs-Detail brach das Pattern.

Lösung: Marker-Pattern als Primary. `execute()` returnt strukturiertes Result mit eindeutig identifizierbarem Marker-String im content-Array (`"__MCP_PENDING_APPROVAL__"`). Twin-Service durchläuft `result.toolCalls` nach `generateText`, prüft auf Marker, wirft dann lokal den `McpToolApprovalRequiredError` damit der existierende Catch-Pfad greift. Plus skillByToolKey-Reverse-Mapping via `buildMcpToolsFromSkills`-Return-Type erweitern, damit Twin-Service vom AI-SDK-konformen Tool-Namen zurück zum DB-Skill kommt.

Throw-Pfad bleibt im Code als Defense-in-Depth — falls AI SDK seine Verhaltens-Logik in einer späteren Version ändert oder ein anderer Code-Pfad doch direkt wirft.

Generelles Prinzip: **bei Third-Party-SDK-Hooks die Verhaltens-Annahmen früh verifizieren, nicht im finalen Smoke-Test feststellen.** Plus: wenn Throw nicht propagiert, ist Marker-Pattern (Strukturiertes Return-Value mit eindeutigem String) der robuste Fallback. Plus: Defense-in-Depth durch beide Pfade parallel ist sauberer als einen wegzuwerfen — falls die Versionsannahmen sich ändern, ist der Code dann schon robust.

### Lesson (Tag 10 / Diagnose): LLM-Halluzinations-Symptom als Diagnose-Signal

Beim 3.2.F-Smoke-Test zeigte sich ein verwirrendes Symptom: Twin antwortete mit „Das Tool braucht Approval und wartet jetzt in der Queue. Sobald Markus es freigibt, läuft der Call durch. Ergebnis wird 12 sein — aber das offiziell vom Tool, sobald approved." Klingt wie ein funktionierender Approval-Workflow, aber Audit zeigte `owner-direct|executed`, nicht `mcp-tool-use|pending`. Kein Pending-Eintrag in Inbox, kein Tool-Call in Logs.

Erste Diagnose-Hypothese: AI-SDK-Throw-Pattern bricht. Aber tieferer Check ergab: `finishReason: stop`, `toolCalls: null` — der LLM hatte das Tool **gar nicht erst gerufen**. Stattdessen halluzinierte er eine plausible Approval-Antwort, weil er die Tools im Set sah und auf Approval-Verhalten geschlossen hat.

Das Symptom „Tool funktioniert nicht, LLM beschreibt aber elegant warum" ist immer ein Hinweis darauf, dass das Tool gar nicht erst gerufen wurde. Bei Item #89 dasselbe Pattern — der LLM erfindet technische Begründungen ("client.experimental.tasks.callToolStream()"), warum Tools angeblich kaputt sind, statt sie wirklich zu rufen.

Diagnose-Workflow für solche Fälle:
1. Audit-Output checken: `finishReason` + `toolCalls`-Array. `null` → kein Tool-Call, `tool-calls` → Tool wurde gerufen
2. Mit `toolChoice: 'required'` zwingen, dann beobachten ob Tool-Use überhaupt funktioniert. Wenn ja: Code-Pfad ok, LLM-Verhalten ist das Problem. Wenn nein: Tool-Bridge-Bug
3. Halluzinierte Antworten sind kein Bug-Symptom des Codes, sondern des LLM-Auto-Pilots

Generelles Prinzip: **bei verdächtigen LLM-Antworten, die „funktional" klingen, immer den Audit-Output verifizieren bevor Code-Bug diagnostiziert wird.** Claude Opus 4.7 ist sehr gut darin, plausible Erklärungen zu erfinden — was technisch klingt, ist nicht automatisch technisch korrekt. `finishReason` plus `toolCalls`-Array sind Ground-Truth.

### Lesson (Tag 10 / 3.2.G): Persistent-Visualization für Approval-States

Beim Inline-Approval-UI im Chat (3.2.G) gab's zwei Optionen für Post-Approve-Verhalten:
- **A:** Pending-Box verschwindet, neue Twin-Antwort erscheint
- **B:** Pending-Box bleibt mit „approved"-Status-Indicator, finale Twin-Antwort erscheint als zusätzlicher Block darunter

Option B implementiert. Begründung: Audit-Trail-Konsistenz. User sieht historisch nachvollziehbar was passiert ist — „Ich habe approved, dann kam diese Antwort." Plus: alle drei Status-Varianten (`pending` mit Buttons, `executed` mit ✓ + Result, `rejected` mit ✗ + Begründung) nutzen dieselbe McpToolCallBox-Komponente, nur Status-Indicator wechselt. Code-Komplexität ist niedriger als bei Option A (Box weghauen + neue Bubble einfügen mit eigener Logik).

Plus: bei Option A würde der Chat-Verlauf nach Approve identisch zu einem normalen Twin-Chat aussehen, ohne Hinweis auf den Tool-Use. Persistent-Visualization macht Tool-Use als Konzept im Chat sichtbar — User sieht, wann der Twin Tools nutzen wollte, was er gemacht hat, was die Ergebnisse waren. Pattern ist auch Vorbereitung für künftige Multi-Tool-Workflows oder Tool-Chaining-Visualisierungen.

Generelles Prinzip: **bei zustandsbehafteten UI-Komponenten (Approve/Reject, Edit/Save, Pending/Resolved) Persistent-Visualization mit Status-Indicator-Wechsel statt Replace-by-New-Block.** User sieht den Verlauf, Code-Komplexität bleibt niedrig, Audit-Trail bleibt im UI sichtbar.

---

## Notiz für später

Sammle weiter Punkte, die im Sparring auftauchen. Nicht jeder Punkt muss eine Phase werden — manches ist Polishing, manches ist Architektur. Die Aufteilung S/M/L/XL und must/should/nice hilft beim Priorisieren wenn die Liste lang wird.

**Item-Dichte 7. Mai 2026 nachmittag (Tag 8):** Vier Items abgeschlossen — #77 (Production-Container-Bootstrap, Commit `2e96ddb`), #74 (Persona-Skill-Layering, Commit `f045dd8`), #78 (Persona/Mandates-Reload-CLI, Commit `61154c0`), #81 (docs/-Volume-Mount via VPS-Override-File, kein Repo-Commit). Plus Production-komplett aktualisiert auf Tag-7+8-Stand. Plus zwei neue Items entstanden (#81 ✅ via Override-Pattern, #82 Heikos Persona-Source-File fehlt — open). Plus #71b von should auf must hochgestuft (Test-Hygiene als Pflicht-Vorbedingung vor 3.2). Plus 7 neue Lessons (Engine-Test als Truth-Source bei Persona-File-DB-Diskrepanz, Architektur-Befunde finden sich beim Verifizieren, tsx-Wegwerf-Skripts-Patterns, ps-Optionen Cross-Platform, Helper-Extraktion bei zweitem Aufruf, Compose-Symlinks und relative Pfad-Auflösung, Production-Drift-Pattern). Items insgesamt jetzt: 78 (74 + 4 neue Items #78-#82, davon #78 + #81 schon erledigt).

**Item-Dichte 9. Mai 2026 mittag (Tag 10):** Phase 3.2 komplett — sieben Sub-Schritte A bis G plus Marker-Pattern-Patch in F durchgezogen. Acht Commits insgesamt: `2bf1ee0` Schema+Repo, `daa03b7` Client+Lifecycle, `cd5b295` Tool-Discovery+Skill-Sync, `366ca93` Tool-Execution via AI-SDK, `5f0f80c` BACKLOG-Update für #86-#89, `43258cf` CLI, `b58df94` Approval-Workflow (Inbox-Foundation), `bce54fb` Inline-Approval-UI im Chat. Plus drei neue Items: #90 (Resume-Prompt-Tuning für Reject), #91 (Reject-Reason-UI ersetzt window.prompt), #92 (Production-Deploy Phase 3.2). Plus drei neue Lessons (Throw-vs-Marker bei AI SDK 6, LLM-Halluzinations-Symptom als Diagnose-Signal, Persistent-Visualization für Approval-States). Items insgesamt jetzt: 87 (84 + #90 + #91 + #92, alle drei neu).

**Was als Nächstes ansteht:** Phase 3.2 ist komplett, der Pfad zu 3.3 ist frei — aber ein Production-Deploy steht zwischen den beiden Phasen:
- **#92 Production-Deploy von Phase 3.2** (must) — vier Migrations plus MCP-Setup auf VPS, Pre-Deploy-Checklist abarbeiten
- **#90 Resume-Prompt-Tuning** (should) — bei trivialen Math-Problemen ignoriert der LLM Reject-Signale, Resume-Prompt härter formulieren
- **#89 LLM-Tool-Use-Verhalten** (should) — Tools werden ohne `toolChoice: 'required'` ignoriert, langfristig brauchen wir entweder bessere Prompts oder strukturelle Lösung
- **#91 Reject-Reason-UI** (nice) — window.prompt durch saubere Modal-Komponente ersetzen
- **Strategie-Session vor 3.3** (Memory: Conversation + Semantic) — Auto-Summary-Schwelle, KV-Store-Lifecycle, facts.md-Schreibrechte, Embedding-Provider-Wahl
- **3.3 — Memory: Conversation + Semantic** (L) — erste zwei Memory-Schichten, schneller ROI

**Tag 10 Bilanz:** Acht Commits, ~3500+ Zeilen Code-Diff. Phase 3.2 in einem Tag durchgezogen — Sub-Schritt-Aufteilung mit eigenem Test pro Layer hat sich erneut bewährt (Pattern aus Tag 9). Plus zwei harte Diagnose-Blöcke (AI-SDK-Throw-Verhalten, LLM-Halluzinations-Pattern) plus ein CLI-Working-Dir-Bug. MCP-Foundation ist end-to-end produktiv: Server-Provisioning via CLI, Tool-Discovery, Tool-Execution mit Multi-Provider-Support, Approval-Workflow mit Pending-State, UI in Inbox UND Chat-Inline. Production-Deploy folgt als nächster großer Block.

---

**Item-Dichte 8. Mai 2026 abend (Tag 9):** Test-Hygiene-Block komplett — #71b und #80 ✅, plus #84 (Inline-Confirm) und #85 (Konversations-Trenner) als UX-Polish im selben Block ✅. Sechs Commits über fünf Sub-Schritte (A/B/C/D/E) plus die UX-Polish-Items: `bc1669a` Schema+Repo, `d0b8cc7` Twin-Service, `b694d0d` History-Loader, `8f604fa` UI-Reset-Button, `76e2728` UX-Polish, `e18f58c` Cleanup+Doku. Plus zwei neue Lessons (5-Sub-Schritt-Aufteilung beim Schema-Refactor, Backend-getriebene UI-Marker statt State-Marker). Items insgesamt jetzt: 80 (78 + #84 + #85, alle vier neu erledigten Items aus dem Test-Hygiene-Block ✅).

**Was als Nächstes ansteht:** Test-Hygiene-Block ist abgeschlossen, der Pfad zu 3.2 ist frei:
- **Strategie-Session vor 3.2 (MCP-Client)** — Pre-Implementation-Diskussion mit konkreten Architektur-Festlegungen (Tool-Discovery, Server-Lifecycle, Auth-Modell, Mandate-Integration für MCP-Tools, Failure-Modes)
- **3.2 — MCP-Client als Skill-Provider** — externe Tools als Skills exponieren, Mandate-Gating analog zum existierenden Skill-System
- Optional dazwischen: **#79 Persona-Tabelle droppen** (~XS, nice) — kann beim nächsten Migrations-Anlass mit angehängt werden
- Optional: **#82 Heikos Persona-File anlegen** — nice, wenn Heiko Persona-Updates braucht
- Optional: **#83 UI-Reply-Verkettung** — wartet auf weitere Reproduktion, kein akuter Blocker

**Tag 9 Bilanz:** Sechs Commits über fünf Sub-Schritte plus UX-Polish, plus dieser Cleanup-+-Doku-Commit (`e18f58c`). Test-Hygiene-Block ist Schema-Refactor mit Migration 009 (`conversations`-Tabelle + `audit.conversation_id`), Migration 010 (Bestand-Cleanup), neuem Repo (`ConversationsRepo`), umgestelltem History-Loader (server-seitig per Konversation gefiltert mit 40-Messages-Cap), neuem UI-Reset-Button mit Inline-Confirm und Konversations-Trenner. Hauptpunkt erreicht: Skill-Toggle-Tests sind sauber, kein Memory-Leak nach Reset. Plus eine wichtige Architektur-Erkenntnis: bei Multi-Layer-Refactors zahlt sich die Sub-Schritt-Aufteilung mit eigenen Test-Skripten pro Layer aus — Bugs fallen sofort an der richtigen Stelle auf. Production-Update folgt beim nächsten regulären Pull (Tag-9-Stand ist nicht produktionskritisch).
