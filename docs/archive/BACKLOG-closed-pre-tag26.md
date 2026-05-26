# twin-lab BACKLOG-Archiv (Closed Items vor Tag 26)

Ausgelagert am 26. Mai 2026 (Tag 28) als Teil der Doku-Hygiene-Welle.

Dieses Archiv enthält alle ✅-DONE-Items mit Closure-Datum vor dem 25. Mai 2026
(Tag 26). Aktuelles Live-BACKLOG unter `docs/BACKLOG.md`.

Schnitt-Datum: Tag 25 (24. Mai 2026 — Block-5-Strategy-Session). Tag-26+ -
Closures bleiben im Live-BACKLOG wegen frischer Status-Notizen mit Cross-Refs.

Reihenfolge der Items spiegelt das Live-BACKLOG zum Zeitpunkt der Archivierung.

---

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

### 14. Owner-Recognition im System-Prompt — präzisiert nach 2.5.3 Live-Test ✅
**Abgeschlossen 2. Mai (2.5.4) + 4. Mai (Production-Verifizierung).** Twin behandelte aktuell jeden Web-UI-Chat als Fremder, auch wenn der Owner selbst chattet.

Live-Test 2.5.3: Heiko-Twin antwortet "Diese Anfrage habe ich an **Markus** zur Freigabe weitergeleitet". Markus ist aber nicht Heikos Owner — der Twin hat aus seiner Persona-Beziehungs-Liste geraten und den ersten Eintrag als "Owner" interpretiert.

Plus: Web-UI-Chat überspringt Approval-Flow für Markus (`requires_approval=false` in seinen Mandates), aber **nicht** für Heiko (`cautious`-Template hat `requires_approval=true`). Owner sollte mit eigenem Twin chatten können ohne sich selbst approven zu müssen.

Fix in 2.5.4: System-Prompt erweitert um Owner-Erkennung via `req.user_id == twin.owner_user_id`. Approval-Logic mit Bypass für Owner. Production-Verifizierung in 2.5.6: drei Owner haben mit eigenen Twins gechattet, keine Pending-Approvals, korrekte Persona-Adressierung.

### 15. Footer-Text aktualisieren ✅
**Abgeschlossen 5. Mai 2026 (Tag 6, Commit `5ed4365`).** Hartcodiertes „phase 2.5 · ... · läuft lokal" durch ENV-getriebene Konstante ersetzt. Neue Variable `NEXT_PUBLIC_DEPLOYMENT_LABEL` mit Default „läuft lokal", Production-Wert „production". Pattern analog zu `NEXT_PUBLIC_RUNTIME_URL` aus 2.5.6.A.4 — ARG/ENV im Dockerfile-Builder, `--build-arg` beim `docker build`. Footer zeigt jetzt „X Twins aktiv · läuft lokal" lokal und „X Twins aktiv · production" in Production. Lokal verifiziert, Production-Deploy steht aus (kein Druck, beim nächsten regulären Pull).

### 37. Hot-Reload für TwinServiceRegistry ✅
**Abgeschlossen 4. Mai 2026 (2.5.6 Phase A.3, Commit `a4f1465`).** Vorher: nach Onboarding-Submit musste `pnpm dev` neu gestartet werden, damit der neue Twin in der laufenden Runtime aktiv wird. Submit-Response trug `requiresRestart: true`, Wizard redirected zu `/chat/<handle>`, dort scheiterte Chat bis zum Restart.

Implementation: Boot-Code akzeptiert leere DB als gültigen Onboarding-only-Modus (statt `process.exit(1)`). `addTwin(twinId)`-Methode auf TwinServiceRegistry, idempotent und atomisch via `pendingAdds`-Mutex (Map<twinId, Promise<void>>). Onboarding-Submit ruft addTwin nach DB-Insert, `requiresRestart: false`. Race-Conditions abgefangen via Mutex.

Production-Verifizierung in 2.5.6: drei User registriert, drei Twins hot-geladen ohne Container-Restart.

### 43. Top-Nav auf /login + /onboarding versteckt ✅
**Implementation vor 5. Mai 2026, Reality-Check 5. Mai (Tag 6 Polish-Sprint).** `apps/web/components/AppHeader.tsx` returned `null` für Routes mit Prefix `/login` oder `/onboarding` via `PUBLIC_PREFIXES`-Array und `usePathname`-Check. Implementiert vermutlich in 2.5.4 UX-Iteration Briefing #19 (Tag 4 — exakter Commit nicht zugeordnet, aber Datei `AppHeader.tsx` letzter Commit `445d1a3` enthielt die `PUBLIC_PREFIXES`-Logik bereits).

Tag-6-Reality-Check vor Briefing-Schreibung: Login-Page zeigt nur Brand + Login-Form + Footer, keine Tabs, kein TwinSwitcher, kein ProfileMenu. Item als ✅ markiert ohne Code-Change.

Footer rendert weiterhin auf Public-Routes — Twin-Count fällt auf "multi-twin"-Fallback zurück, da `/twins` ohne Auth 401 returnt (graceful degradation, kein Bug).

### 45. Bridge-Production-Sync nach 2.5.4.x ✅
**Abgeschlossen 3. Mai 2026 nachmittags.** Production-Bridge unter `bridge.twin.harwayexperience.com` neu deployed — altes Setup vom 1. Mai war abgeräumt (Container gelöscht, Volume jungfräulich mit 0 Messages und Stub-Twins). Sauberer Neustart statt Migration: altes Volume + Image entfernt, frisches Setup unter `/docker/twin-lab-bridge/` mit eigenem `docker-compose.yml` (Project-Name `twin-lab-bridge`, Volume `twin-lab-bridge-data`, hängt am `traefik-proxy`-Network). Image gebaut aus `apps/bridge/Dockerfile`, DB initialisiert mit Migrations 001 + 002 (`message_type`-Spalte aus 2.5.4.1.1 inklusive), drei Twins frisch registriert (Markus Johannes Baier, Florian Ristig, Heiko Gregor). Traefik-Routing via Docker-Labels, Let's Encrypt-Cert beim ersten Hit ausgestellt, Health-Check via HTTPS in 2ms. Token-Werte in Passwort-Manager.

NICHT erledigt in diesem Sub-Schritt: lokale Twin-Profile auf Production-Bridge umstellen — bleibt bei `localhost:5100`. Production-Web-App in 2.5.6 wird beim Bootstrap eigene Profile mit Production-Bridge-URL und neuen Tokens anlegen.

Während Deployment aufgefallen, neu im Backlog: #59-#62 unten.

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

### 84. Reset-Button: Inline-Confirm statt window.confirm() ✅
**Abgeschlossen 8. Mai 2026 (Tag 9), gemeinsam mit #85 als UX-Polish-Item zum #71b/#80-Block.** Sub-Schritt D hatte den Reset-Button funktional gelöst, aber `window.confirm()` als OS-natives Overlay war ein visueller Bruch zum Tailwind-Stil. Lösung: lokaler `confirming`-State im Button selbst, Klick toggled in einen Zwei-Knopf-Mini-Dialog „Wirklich? [✓ Bestätigen] [Abbrechen]". 5-Sekunden-`useEffect`-Timeout setzt zurück, wenn der User wegklickt. Pattern-Konsistenz mit den anderen kompakten Header-Buttons im Direct-Chat. Commit `76e2728`.

**Größe:** XS · **Priorität:** must · **Aus:** Tag-8 #71b/#80 Sub-Schritt D-Verifikation

### 85. Konversations-Trenner im Chat-Verlauf ✅
**Abgeschlossen 8. Mai 2026 (Tag 9), gemeinsam mit #84.** Nach Reset blieb der visuelle Verlauf unverändert (gewollt — Twin-Memory ≠ visueller Scroll), aber ohne Marker konnte der User nicht sehen wo die alte Konversation aufhörte und die neue begann. Lösung: daten-getriebene `ConversationDivider`-Komponente, die zwischen Messages mit unterschiedlicher `conversationId` gerendert wird. Backend-getrieben aus den geladenen Audits (Audit-Schema enthält `conversationId` seit Sub-Schritt B), also robust gegen Page-Reload und vorbereitet für Phase 3.3 (Multi-Konversations-Sicht). Live-Sends bekommen via `directChatResetSeq`-Counter im Parent eine synthetische Local-ID, damit der Trenner sofort nach dem nächsten Send erscheint, ohne auf einen Reload zu warten. Commit `76e2728`.

**Größe:** S · **Priorität:** must · **Aus:** Tag-8 #71b/#80 Sub-Schritt D-Verifikation

### 86. ✅ UI-Editor für Skills (Manifest + Markdown) (CLOSED Tag 18)
Heute werden Skills via CLI angelegt und über die UI nur als Read-Only-Liste mit Aktiv-Toggle dargestellt. Sub-Schritt 3.2.E erweitert das nicht — die CLI bleibt der primäre Einstiegspunkt für MCP-Server-Setup.

Was fehlt: Skill-Detail-View mit Markdown-Editor für SKILL.md, Form-Fields für Manifest, PATCH-Endpoint analog zu Persona-Reload-CLI (#78). Vorbedingung: Skill-Sync-Endpoint aus #75. Verknüpft mit #76 (Skill-Edit/Delete via UI), könnte gemeinsam adressiert werden.

**Größe:** L · **Priorität:** should · **Aus:** 3.2-Strategie-Session, langfristige UI-Editierbarkeit
**Stufe:** 0 → 2 · **Tranche:** C · **Spur:** UX-Reifung Welle 1 (Bau-Plan in `docs/UX-STRATEGY.md`)

**Update Tag 18 (CLOSED):** Implementiert in Commits `4efe6d5` (Backend) und `2788b72` (UI). Diagnose-Stop hat M-Item-Realität bestätigt (nicht L wie ursprünglich klassifiziert): SkillRepo-Methoden existierten schon (`add`, `update`, `findById`, `findByName`, `remove`), nur Routes mussten exposed werden. Bau: 4 neue Backend-Routes (POST/PATCH/DELETE plus GET-Detail für Edit-Prefill) mit Manifest-Spiegelung (Top-Level name/description → Manifest), MCP-Skill-Edit-Verbot mit 403, Name-Unchangeable via Schema-Refinement (vermeidet Sync-Konflikte). UI: `SkillEditorModal` mit Multi-Field-Form, ModalWrapper um `maxWidthClass`-Prop erweitert (max-w-2xl für Skill-Modal), Manifest-Textarea ohne name/description (Spiegel-Pattern), Inline-Validation mit `border-warn` analog #99/#86-Pattern, Add+Edit+Delete in Skills-Section, Edit-Link nur für manual-Skills, MCP-Skills bekommen "Via MCP-Server verwaltet"-Hinweis. Bug während Bau gefunden+gefixt: Manifest-Spiegelung war nur bei POST, nicht PATCH. Browser-Smoke 6/6 grün.

### 87. ✅ UI-Konfigurator für MCP-Server pro Twin (CLOSED Tag 18)
Heute werden MCP-Server via CLI/SQL hinzugefügt (Sub-Schritt 3.2.E baut die CLI). Langfristig brauchen non-tech-User eine UI: Server-Add-Form mit Transport-Wahl (stdio/http), Command + Args, optionalen ENV-Vars (verschlüsselt analog zu API-Key), Default-Approval-Setting. Plus Server-Liste mit Aktiv-Toggle, Refresh-Tool-Discovery-Button, Server-Remove mit Cascade-Confirm.

Konzeptionell parallel zu #86 — beide sind Backend-getriebene Configs, die heute via CLI laufen, langfristig UI brauchen. Schema und Repo (3.2.A) sind so designed, dass UI später ohne Refactor möglich ist (`hasEnv`-Marker statt Plain-ENV im Output, Encrypted-Storage, Validation im Repo).

**Größe:** L · **Priorität:** should · **Aus:** 3.2-Strategie-Session
**Stufe:** 0 → 2 · **Tranche:** C · **Spur:** UX-Reifung Welle 1 (Bau-Plan in `docs/UX-STRATEGY.md`)

**Update Tag 18 (CLOSED):** Implementiert in Commits `8e12c43` (Backend) und `a2336bf` (UI). Diagnose-Stop hat MVP-Scope auf M reduziert (nicht L): MCP-Konfig war heute gar nicht in UI sichtbar (nur CLI), `McpServersRepo` + twin-eigener `McpSkillSync` + `McpClientManager` waren wiederverwendbar, kein Service-Modul-Refactor nötig. UX-Setzungen via Strategy-Session: JSON-Spec via Textarea-Paste (kein File-Upload, kein Drag-Drop), ENV-Prompt als Inline-Form-Erweiterung unter Textarea (kein Submodal), Cascade-Delete-Warnung mit Skill-Count, kein Edit-Mode für MVP (Re-Encryption + Skill-Resync zu komplex). Bau: 4 Backend-Routes mit Zod-Refinement gegen `"?"`-Marker (Defense-in-Depth), Sensitive-Felder NIE in API-Response (command/args/env/url server-only), Master-Key-Encryption bleibt backend-side. UI: `McpServerAddModal` mit Spec-Validation + ENV-Marker-Detection (nur `"?"`-Werte werden gefragt, Non-Marker-Werte bleiben Original), Submit-Komposition mit Marker-Replacement, MCP-Section in Settings **vor** Skills (kausale Reihenfolge: MCP liefert Skills), Optimistic-Toggle mit Revert, Cascade-Delete-Banner inline in der Row mit Skill-Count, Toast mit `syncedSkills`/`deletedSkills` aus Backend-Response. Browser-Smoke 6/6 grün.

### 89. ✅ LLM-Tool-Use-Verhalten tunen — Tools werden ignoriert (CLOSED Tag 17)
Beim Sub-Schritt-3.2.D-Verifikations-Test mit Claude Opus 4.7 ist aufgefallen: der LLM ruft Tools selbst dann nicht auf, wenn sie explizit angefordert werden. Bei „Bitte rufe das simulate-research-query Tool auf" antwortet er stattdessen mit einer halluzinierten Erklärung warum das Tool angeblich nicht funktioniert (technisch klingender Bullshit über `client.experimental.tasks.callToolStream()`).

Selbst mit aggressiver TOOL_USE_DIRECTIVE im System-Prompt („Behaupte nicht, dass ein Tool nicht funktioniert ohne es tatsächlich aufgerufen zu haben") ignoriert er die Anweisung. Mit `toolChoice: 'required'` ruft er Tools (Beweistest hat funktioniert), aber dann gibt er nach Tool-Result keinen finalen User-Text mehr aus — `finishReason: tool-calls`, leere Reply-Bubble.

**Diagnose:** Architektur ist korrekt (Tools werden gerendered, MCP-Call passiert bei `required`, Result fließt zurück). Das ist ein **LLM-Prompting-Problem**, nicht ein Code-Problem. Mögliche Ansätze:

1. **Aggressivere System-Prompt-Direktive** mit konkreten Negativ-Beispielen („Antworte nicht: 'Tool-Result: ...' wenn kein Tool gerufen wurde")
2. **Per-Tool-Hints im User-Prompt** statt System-Prompt — der LLM gewichtet User-Anweisungen oft stärker
3. **`toolChoice: { type: 'tool', toolName: '...' }`** für UI-getriggerte Tool-Calls (User klickt Button → Tool wird zwingend gerufen, kein LLM-Ermessen)
4. **Multi-Step-Strategy:** erster Step mit `toolChoice: 'required'` für Tool-Use, zweiter Step mit `auto` für die finale Antwort

Punkt 3 ist die robusteste Lösung, weil sie das LLM-Ermessen aus der Tool-Use-Frage rausnimmt. Verknüpft mit dem Approval-Flow aus 3.2.F — User klickt „Approve" auf einen Tool-Call, dann wird er forciert ausgeführt.

**Größe:** M · **Priorität:** must (hochgestuft Tag 16) · **Aus:** Tag-10-Vormittag 3.2.D-Verifikations-Test

**Update Tag-10-Mittag (nach 3.2.F-G):** Verhalten reproduziert sich beim Approval-Smoke-Test — ohne `toolChoice: 'required'` ruft Claude Opus 4.7 das `everything-approval`-Tool nicht, halluziniert stattdessen Approval-Antworten. Architektur ist nachweislich korrekt — bei `required` greift der Marker-Pfad sauber, Pending-Audit entsteht, Inbox + Chat-UI rendern alle States. Brücken-Lösung: User-getriggerte Approval-Forcierung über UI (3.2.G-Inline-UI) erzwingt Tool-Use indirekt.

**Update Tag-11-Vormittag (nach #92 Production-Deploy):** Item ist UX-mäßig dringlicher als gedacht. In Production reproduziert sich das Verhalten exakt wie lokal — der LLM ruft Tools nicht autonom, halluziniert plausible Antworten. **Neue Beobachtung:** der LLM erfindet sogar Code-interne Marker-Strings als plausibles Halluzinations-Material. Beim Approval-Smoke-Test in Production antwortete Claude mit `__MCP_PENDING_APPROVAL__` als „Beweis" für eine angebliche Approval-Queue. Verifiziert dass der Marker NICHT im System-Prompt oder Tool-Description leakt — der LLM erfindet ihn selbst. Plus Echo-Test: Twin halluziniert das Tool-Output (`Echo: Hello Production`), sagt explizit „Tool läuft" obwohl nichts läuft. UX-mäßig gefährlich.

**Update Tag-11-Mittag (3.2.H + Direktive-Polish):** **Strukturell gelöst für UI-Pfad** via 3.2.H Tool-Picker-UI (Commit `b97ae80`). User klickt Plus-Button im Chat-Input, Modal mit Tool-Liste (nach Server gruppiert mit Approval-Markern), Args-Form aus JSON-Schema, Submit triggert Tool-Call mit `forcedToolChoice: { type: 'tool', toolName: '...' }`. Tool wird deterministisch gerufen, kein LLM-Ermessen. Plus Multi-Step-Followup-Patch: nach forciertem Tool-Call mit leerem Text wird zweiter `generateText`-Call mit `response.messages` und `toolChoice: 'auto'` ausgelöst, damit LLM Final-Text aus Tool-Result synthetisiert.

**Direktive-Polish-Befund (Commit `2e7c1d0`):** TOOL_USE_DIRECTIVE härter formuliert mit REGEL 4 (keine Marker erfinden) und REGEL 6 (Tool MUSS gerufen werden bei expliziter Aufforderung). Smoke-Test gemischt:
- ✓ REGEL 4 wirkt: Marker-Strings werden nicht mehr in Halluzinationen eingebaut. Twin antwortet jetzt User-freundlich („Liegt in der Approval-Queue. Markus muss das freigeben") statt mit Internal-Markern
- ✗ REGEL 6 wirkungslos: Tool wird trotz expliziter Aufforderung weiter nicht gerufen bei trivial-lösbaren Anfragen (10+20). Halluzination ist UX-mäßig fast schlimmer geworden, weil plausibler

Direktive ist marginal effektiv — Defense-in-Depth gegen Marker-Pollution, aber NICHT die Lösung. **Strukturelle Lösung bleibt UI-Picker.** Item bleibt OPEN für Natural-Language-Pfad — User der „Bitte rufe Tool X auf" tippt kriegt weiter Halluzinationen. Mögliche Folge-Lösung: Auto-Detection von „rufe das X-Tool auf"-Pattern im User-Text → automatisches `toolChoice: 'required'` für diesen Send. Ist Backlog-Material, vermutlich nicht akut nötig (Pilot-User können trainiert werden, Picker zu nutzen).

**Update Tag-16 (Phase 3.5 Smoke mit Hyperbrowser):** **Item ist von "should" zu "must" hochgestuft, wird zum Phase-3.5-Blocker.** Bei Phase 3.5.B Browser-Smoke mit Hyperbrowser-MCP zwei Pfade verglichen:

1. **User-Prompt ohne Tool-Anweisung** ("Schau dir die Anthropic-Homepage an und fass die wichtigsten drei Sätze zusammen"): Twin halluziniert eine plausible Antwort über eine angeblich-existierende Approval-Queue, ohne dass jemals ein Tool-Call gemacht wurde. Identisches Pattern wie beim everything-Smoke aus Tag 10/11 — kein Tool, plausible Halluzination.

2. **User-Prompt mit expliziter Tool-Anweisung** (`[Tool-Aufruf] mcp_hyperbrowser-approval_scrape_webpage mit Args {...}`): Twin macht den Tool-Call sauber, Approval-Pfad funktioniert, Hyperbrowser scraped korrekt, Twin synthetisiert eine substantielle Zusammenfassung. End-to-End funktional.

**Designprinzip-Setzung Markus (Tag 16):** "Tool-Aufruf darf nur Fallback sein, Tools müssen direkt in der Konversation automatisch aufgerufen werden." Heißt: Tool-Picker mit Direct-Invocation-Formular ist strukturelle Workaround-Lösung, aber nicht das Ziel. Vision-konform ist autonomer Tool-Use durch Twin.

**Implikation für Phase 3.5/3.6:** Solange #89 nicht gelöst ist, ist Hyperbrowser-Foundation nur halb-funktional — Tool-Picker funktioniert (für User-getriggerte Direct-Invocation), aber Twin-vermittelter Tool-Use bei normalen Konversationen halluziniert weiterhin. Für 3.6 Computer-Use-Agent (Twin handelt autonom mehrere Browser-Actions) ist das ein fundamentaler Blocker — autonomes Handeln geht nicht ohne autonome Tool-Calls.

**Fix-Pfad-Erwägungen für Tag-17+-Strategie-Session:**

- **Strukturell A:** Auto-Detection von Tool-Use-Intent im User-Text (NLP-Pre-Pass oder LLM-Pre-Call), dann automatisches `toolChoice: { type: 'tool', toolName: '...' }` für relevanten Send. Robust, aber Pre-Pass kostet Latenz + LLM-Call.
- **Strukturell B:** `toolChoice: 'required'` für alle Sends in Konversationen mit verfügbaren Tools, plus Multi-Step-Followup-Pattern wie bei 3.2.H. Risiko: Twin macht Tool-Calls auch wenn keine nötig wären.
- **Hybrid:** "Tool-Awareness"-Layer im System-Prompt der explizit deklariert "Du hast diese Tools, hier sind Beispiel-Trigger-Patterns" plus Auto-Detection.
- **Provider-Wechsel-Hypothese (untested):** Möglicherweise reproduziert sich das Verhalten *nicht* mit anderen LLM-Providern (OpenAI, Gemini). Test wäre informativ, aber Anthropic ist die strategische Wahl für Twin-Lab.

**Eigene Strategie-Session vor 3.5.C/3.6 erforderlich** — substantielle Architektur-Frage. Tag-16-Abend-STAND-Update markiert 3.5 als "Foundation lokal verifiziert, autonomer Pfad blocked durch #89". Production-Deploy 3.5.C wartet auf #89-Fix.

**Update Tag-17 (Diagnose-Wende):** Spike `3.5.E.0` hat alle drei LLM-Hypothesen widerlegt. Wurzel ist Step-Walk-Bug in `twin-service.ts` — `detectPendingToolCall` und Audit-Builder lesen `result.toolCalls` top-level, sehen Multi-Step-Tool-Calls in `result.steps[i].toolCalls` nicht. Marker-Pattern wird dadurch unerkannt durchgereicht, AI SDK synthetisiert plausiblen Antwort-Text aus Marker-Result, User sieht "Halluzination".

Fix: 1-Tages-Patch (3.5.E.B), keiner der vier strukturellen Fix-Pfade wird gebaut. Re-Klassifizierung: **must → must (Patch)**, nicht mehr "Strategie-Frage".

Plus Defense-in-Depth: Custom `stopWhen`-Predicate, das Multi-Step bei Marker-Detection abbricht.

**Update Tag-17 (CLOSED):** Step-Walk-Patch in `d0954a6` (3.5.E.B) plus Regression-Guard in `1e57aec` (3.5.E.D, `test-regression-89-step-walk.ts` mit Mutation-Verifikation). Re-Smoke lokal + Production alle drei Tests grün (autonom, forced, smalltalk). Production-Deploy Tag 17 Nachmittag (`mcp_QjIi2cpQktSo8mBj` für Production-@markus). Phase 3 DoD: 5/5.

### 92. Production-Deploy von Phase 3.2 (Migrations + MCP-Setup) ✅ Tag 11
**Erledigt 10. Mai 2026 vormittag (Tag 11), kein Repo-Commit für VPS-Override-Update.**

Tag-10-Stand auf Production-VPS gebracht. Sequenz: Repo-Pull (`7ed573d → 20aaa36`), Override-File erweitert um `mcp-servers/`-Volume-Mount (lebt nur auf VPS, analog #81), Image-Rebuild Runtime + Web (57.7s + 75.7s), Container-Recreate via `docker compose up -d`. Migrations 011 (`mcp_servers`-Tabelle) und 012 (`skills`-Erweiterung) frisch eingespielt — 010 Migrations waren überraschenderweise bereits drin (Production-DB hatte den Tag-9-Stand schon, vermutlich durch früheren Container-Restart). Schema-Stand jetzt 12 Migrations.

MCP-Server provisioniert für @markus via CLI im Container:
- `mcp_Psd-MfjYN7UJkIPM` — `everything` (no-approval, 13 Tools, Spawn 5.3s erstmalig)
- `mcp_TdslZrvQccflqHzS` — `everything-approval` (approval-required, 13 Tools, Spawn 1.4s — npx-Cache warm)
- 26 Tools insgesamt aktiv in Production

Production-Smoke-Test verifiziert die Architektur, aber nicht den End-to-End-Tool-Use:
- Tool-Aufforderung im Chat: `mcp_everything_get-sum` mit a=10, b=20 → Twin antwortet `30.`, aber `tool_calls: null` (Halluzination)
- Approval-Tool im Chat: Twin halluziniert Approval-Bestätigung mit Internal-Marker `__MCP_PENDING_APPROVAL__`
- Echo-Test (nicht-trivial): Twin halluziniert Echo-Output

Befund: Architektur sauber deployed, aber Item #89 reproduziert sich auch in Production. Marker-Code-Leak ausgeschlossen (Verifikation: Marker erscheint nur in `tool-bridge.js` Zeile 16/55 und `twin-service.js` Zeile 1065, NIRGENDWO in System-Prompt oder Tool-Description). LLM erfindet den Marker-String selbst.

VPS-Override-File `/docker/twin-lab-web/docker-compose.override.yml` hat jetzt zwei bind-mounts: `docs/` (#81) plus `mcp-servers/` (#92).

Plus eine kleine Lesson zur Compose-Diagnose: `docker compose config` zeigt Override-Volume-Mounts NICHT an, obwohl sie aktiv sind. `docker inspect <container>` ist die zuverlässige Wahrheit. Beim Diagnostizieren in #92 erst irritierend.

**Größe:** M · **Priorität:** must · **Aus:** Tag-10-Mittag, Production-Drift 7 Commits

### 95. ✅ Tool-Names human-readable im Approve-Dialog (CLOSED Tag 18)
Aktuell zeigt der Approve-Dialog technische Identifier wie `mcp_hyperbrowser-approval_scrape_webpage`. Für Casual-User unverständlich, für Tech-Affine zumindest reibungsfähig.

Was zu tun ist: Mapping-Layer Tool-Identifier → human-readable Label plus Args-Kurzbeschreibung. Quellen für das Label, in dieser Reihenfolge:
1. `manifestJson.displayName` falls vom Skill explizit gesetzt (neue Optional-Property, Owner kann override)
2. Aus dem `description`-Feld des Tool-Manifests den ersten Satz extrahieren
3. Heuristik aus Tool-Identifier (kebab-/snake-Case → Title Case, MCP-Server-Prefix entfernen)

Plus Args-Preview: für `scrape_webpage({url: 'https://anthropic.com', outputFormat: ['markdown']})` → „Webseite lesen: anthropic.com". Heuristik pro bekanntem Tool-Pattern, generischer Fallback ist die Args-JSON.

**Größe:** S · **Priorität:** should · **Aus:** UX-Strategie-Session Tag 17 Abend (Tool-Picker UX-Audit)
**Stufe:** 0 → 1 · **Tranche:** A · **Spur:** UX-Reifung Welle 1 (Bau-Plan in `docs/UX-STRATEGY.md`)

**Update Tag 18 (CLOSED):** Implementiert in Commit `ece8109` (`apps/web/lib/tool-display.ts` mit `resolveToolDisplay()` + `formatArgs()` für 13 Tool-Patterns). Generic Title-Case-Fallback mit Mono-Identifier-Hint für Power-User. Integration in Inbox + Chat + Reject-Modal. Browser-Smoke 3/3 grün. Tranche A damit komplett.

### 97. ✅ Inbox-Tab Tutorial / Empty-State (CLOSED Tag 17)
Aktuell ist die leere Inbox einfach leer. Das Konzept „Approvals" / „Pending-Actions" ist twin-lab-spezifisch und wird nicht erklärt.

Was zu tun ist: Empty-Inbox zeigt einen 2-3-Zeilen-Erklärtext: „Wenn dein Twin eine Aktion vorschlägt, die Genehmigung braucht (z.B. eine Webseite lesen, eine Mail senden), landet sie hier. Du genehmigst per Klick — oder lehnst ab." Plus einen Mini-Screenshot oder eine vereinfachte Demo eines Pending-Eintrags.

Aktiviert sich nur wenn Inbox leer ist; verschwindet sobald irgendein Pending existiert hat.

**Größe:** XS · **Priorität:** nice · **Aus:** UX-Strategie-Session Tag 17 Abend
**Stufe:** 0 → 1 · **Tranche:** A · **Spur:** UX-Reifung Welle 1 (Bau-Plan in `docs/UX-STRATEGY.md`)

**Update Tag 17 Abend (CLOSED):** Implementiert in Commit `9121405` (EmptyState-Component + Inbox-Pending-Block). Funktional verifiziert per Screenshot. Anders als #96 ist die Inbox-Architektur kompatibel mit dem Empty-State-Pattern — bei leerem Pending-Block wird der Tutorial-Text sauber angezeigt, verschwindet sobald irgendein Pending da ist.

### Tranche B — Mittlere Investments

### 98. ✅ Cost/Time-Preview vor Approve (CLOSED Tag 18)
Aktuell ist Approve ein blinder Klick — User weiß nicht, ob die nachfolgende Aktion 2 Sekunden oder 2 Minuten dauert, 0 Cent oder 50 Cent kostet. Pflicht für Hyperbrowser-Calls (Cloud-Browser-Session kostet), kritisch für Phase 3.6 Computer-Use-Agent (Multi-Step-Sessions mit substantieller Inferenz-Last).

Was zu tun ist: Approve-Dialog zeigt vor Bestätigung:
- Geschätzte Latenz („~30 s")
- Geschätzte Kosten („~0,12 €", optional)
- Heuristik pro Tool-Type-Pattern (scrape: niedrig, computer_use_agent: hoch)
- Fallback: „Unbekannt" wenn keine Heuristik matched

Cost-Heuristik braucht eine Kosten-Tabelle pro Tool-Pattern; für Phase 3.6 als Pflicht-Block separat angesetzt. Für jetzt: Latenz-Schätzung reicht erstmal als MVP.

**Größe:** M · **Priorität:** should · **Aus:** UX-Strategie-Session Tag 17 Abend (Phase-3.6-Vorbereitung)
**Stufe:** 0 → 1 · **Tranche:** B · **Spur:** UX-Reifung Welle 1 (Bau-Plan in `docs/UX-STRATEGY.md`)

**Update Tag 18 (CLOSED):** Implementiert in Commit `12aad33` (`apps/web/lib/tool-cost.ts` mit `estimateToolCost()` + `formatEstimate()`). Heuristik-Tabelle für 16 Tools (9 Hyperbrowser + 7 Everything). Vier Display-Branches (Fallback / kostenlos / mit-cost / nur-Latenz). Deutsche Komma-Notation via `toLocaleString("de-DE")`. Integration nur in Pending-States (nicht executed/rejected).

### 99. ✅ Audit-Trail-View menschlich lesbar formatieren (CLOSED Tag 18)
Aktuell ist die Audit-Detail-View Roh-JSON: Tool-Calls als `{toolName, input, output}`-Objekte, Token-Usage als nested Object, Timestamps als epoch ms. Funktional fürs Debugging, aber unzumutbar für Casual-User. Plus: Vision Block 4 (Vererbung — Anna soll später auf Markus' Audit-Trail Zugriff haben können) braucht das in menschlicher Form.

Was zu tun ist: Audit-Entry-Renderer mit Tool-Call-Sätzen statt JSON:
- „Twin hat die Webseite *anthropic.com* gelesen" statt `{toolName:'scrape_webpage', input:{url:'...'}}`
- Args als Plain-Text-Liste (Label + Wert)
- Result als gekürzter Preview mit Expand-Toggle für den vollen Output
- Timestamps human-readable („vor 3 Minuten", „heute 14:23")
- Token-Usage als „~1500 Tokens, ~0,08 €" statt nested JSON

Pro Tool-Type ein eigenes Render-Template (mit generischem Fallback). Wartbar, weil pro Skill anpassbar.

**Größe:** M · **Priorität:** should · **Aus:** UX-Strategie-Session Tag 17 Abend (Vererbungs-Argument)
**Stufe:** 0 → 1 · **Tranche:** B · **Spur:** UX-Reifung Welle 1 (Bau-Plan in `docs/UX-STRATEGY.md`)

**Update Tag 18 (CLOSED):** Implementiert in Commits `3d70f82`, `b1ba6ea`. Phase-A-Diagnose hat das Backlog-Verständnis korrigiert: das echte Problem war nicht "Roh-JSON sichtbar" (Inbox-Pending war schon menschlich nach #95/#98), sondern "reiche Audit-Daten unsichtbar" (output, usage, memoryHits, Tool-Output). Bau: Token-Cost-Library mit Opus-4.7-Pricing (`apps/web/lib/token-cost.ts`), formatRelativeTime extrahiert (`apps/web/lib/time-format.ts`), Audit-Render-Library mit 4 Template-Klassen (`apps/web/lib/audit-render/`): TwinAnswer / ToolCall / FactProposal / A2AActivity plus GenericFallback. Inbox-Audit-Log mit Click-to-Expand pro Row + AuditDetailRenderer + Single-Expand-Pattern. Heavy Reuse von #95 (resolveToolDisplay), #98 (estimateToolCost), #100 (MemoryHitBadge). Browser-Smoke 5/6 explizit grün (A2A-Template strukturell verifiziert, Daten vorhanden).

### 100. ✅ Memory-Hit-Indikator im Chat (CLOSED Tag 18)
Wenn Twin Memory-Hits (Episodic, Semantic) in seine Antwort einbezogen hat, gibt es heute keinen UI-Hinweis. Das ist Vision Block 2 Pattern 2 (Zeit-Erleben) — Memory soll *spürbar* sein, nicht nur funktional vorhanden.

Was zu tun ist: pro Twin-Antwort, die Memory-Retrieval-Hits hatte, ein kleines Icon/Badge in der Antwort-Bubble. Hover/Klick zeigt:
- Anzahl Hits („Twin hat sich an 3 frühere Konversationen erinnert")
- Optional die genauen Memory-Snippets (gekürzt, mit Datum)

Backend liefert die Hits ohnehin schon (3.4 Hybrid-Search Logging), muss in der API-Response surfaced werden (heute vermutlich nur intern geloggt).

**Größe:** S · **Priorität:** nice · **Aus:** UX-Strategie-Session Tag 17 Abend (Vision Block 2 Pattern 2)
**Stufe:** 0 → 1 · **Tranche:** B · **Spur:** UX-Reifung Welle 1 (Bau-Plan in `docs/UX-STRATEGY.md`)

**Update Tag 18 (CLOSED):** Implementiert in Commit `3eb645b`. Backend `RetrievalResult.createdAt` + `audit.output.memoryHits` als SSoT (UI re-lädt nach Reload den Audit-Stream, nicht den Response-Body). `MemoryHitBadge` mit Mono-Stil + Expand-on-Click. Snippets gruppiert nach `targetType` (Vergangenes Gespräch / Auszug / Eigene Notiz). Nur DirectChat-Integration (A2AChat hat kein Memory-Pfad). Browser-Smoke 🟢🟢🟢 mit echten Hits.

### Tranche C — Strategische Investments

Bestehende Items, jetzt re-klassifiziert:
- **#86 UI-Editor für Skills (Manifest + Markdown)** — siehe Item oben, jetzt `Stufe: 0 → 2`, `Tranche: C`
- **#87 UI-Konfigurator für MCP-Server pro Twin** — siehe Item oben, jetzt `Stufe: 0 → 2`, `Tranche: C`

Neu für Tranche C:

### 101. ✅ Twin-Reife-Stufen-Anzeige (CLOSED Tag 18)
Vision Block 2.5 zentral: Twin-Reife ist gestuft (Onboarding-Twin → tiefer Twin nach Monaten/Jahren Pflege), und Stufen sollen für User sichtbar sein. Engagement-Hook für SaaS-Launch (User sieht eigenen Fortschritt) und Differenzierung gegen flache Twins-as-Chatbots.

Was zu tun ist: Reife-Berechnungs-Engine plus UI-Anzeige.
- Stufen-Definition (z.B. 0 = Onboarding, 1 = Bewohnt, 2 = Vertraut, 3 = Tief) mit objektiven Schwellen aus Memory-Tiefe (Konv-Count, Facts-Count, Embedding-Density, Pattern-Aktivität)
- Engine berechnet aktuelle Stufe + Distanz zur nächsten
- UI-Component: Stufen-Badge in der Persona-Sidebar, plus Detail-View „Was fehlt zur nächsten Stufe?"
- Optional Notifications bei Stufen-Aufstieg

Strategische Entscheidung vor Bau: Stufen-Definition braucht eine eigene Strategie-Session (Markus + Vision-Doc abgleichen, ob Stufen-Granularität passt).

**Größe:** L · **Priorität:** should · **Aus:** UX-Strategie-Session Tag 17 Abend (Vision Block 2.5)
**Stufe:** 0 → 2 · **Tranche:** C · **Spur:** UX-Reifung Welle 1 (Bau-Plan in `docs/UX-STRATEGY.md`)

**Update Tag 18 (CLOSED):** Implementiert in Commits `63b423f`, `b6a88ef`, `3a964fb`. Backend `TwinMaturityService` mit 4-Dimensionen-Heuristik (Konvs + Facts + Themen + Zeitspanne, 3-von-4-Regel). Greedy-Cosine-Clustering auf conversation-Embeddings für Themen-Vielfalt (kalibriert: Threshold 0.85, Topic-Schwellen [2,5,12]). `MaturityBadge` im Chat-Header (Dauer-Sichtbarkeit) + `MaturityDetail` in Settings (Stats + Progress + Was-fehlt). Edge-Case verifiziert (@florian "Onboarding · 0%"). @markus jetzt auf "Bewohnt · 66% bis Vertraut".

### Architektur-Follow-ups aus UX.1.A.3 (kein Welle-1-Scope, Welle-2-Material)

Aus der Empty-State-Verifikation Tag 17 Abend emergiert: Die Inbox- und Chat-Empty-States sind als Component sauber gebaut (#96/#97 Commit `9121405`), aber die strukturelle Chat-Flow-Architektur macht sie praktisch fast unsichtbar. Zwei Items dokumentieren die Fixes für Welle 2.

### 105. ✅ A2A-Konversations-Flow: erste Nachricht optional (CLOSED Tag 19)
Aktuell zwingt `NewConversationModal` (`apps/web/app/chat/[handle]/page.tsx:1431-1434`) beim Anlegen einer A2A-Konversation zur Erst-Nachricht. User landet sofort im Message-Mode, sieht keinen Empty-State.

**Befund aus UX.1.A.3-Verifikation Tag 17 Abend:** Diese Architektur macht das EmptyState-Pattern für A2A strukturell unerreichbar. Konzeptionell wäre „Konv anlegen ohne Pflicht-Nachricht, dann tippen" natürlicher — User sieht erst, dass die Konv existiert, und schreibt dann. In Folge dieses Befunds wurde der A2A-EmptyState im Code wieder entfernt (er war toter Pfad).

Was zu tun ist: `NewConversationModal` umbauen — Erst-Nachricht optional. Wenn das Content-Feld beim Submit leer ist: nur die Konversation anlegen (POST gegen neuen Endpoint, ohne `/send`), dann zum A2AChat-View springen. EmptyState wird sichtbar, User tippt erste Nachricht regulär.

Backend-Frage: existiert ein Endpoint „Konversation anlegen ohne Send"? Falls nicht, muss er gebaut werden (kleiner Bridge-/Runtime-Touch).

**Größe:** M · **Priorität:** should · **Aus:** UX.1.A.3-Verifikation Tag 17 Abend
**Stufe:** 0 → 1 · **Spur:** UX-Reifung

**Update Tag 19 (CLOSED):** Implementiert in Commit `49e059e` (3 Files, +147/-25). Drei Patches: (1) Backend `POST /twins/:handle/conversations/:partner` (Start ohne Send, idempotent via `getOrStart`, Bridge-Handle-Validation analog zur Send-Route); (2) `NewConversationModal` Content-Feld optional, Submit-Button-Label dynamisch "Starten" vs "Senden"; (3) A2AChat-EmptyState reaktiviert mit Partner-Name-Hint. Zwei Architektur-Bugs während Bau gefixt: (a) Fastify `FST_ERR_CTP_EMPTY_JSON_BODY` bei POST mit leerem Body (Fix: `JSON.stringify({})`), (b) Sidebar-Filter-Architektur — List-Endpoint baute nur aus Bridge-Partner-Aggregat, ignorierte lokale Konvs ohne Bridge-Messages. Pre-#105 maskiert, post-#105 echter UX-Bug. Fix: neue `listActiveByOwnerAndTwin`-Repo-Methode, Merge nach Bridge-Aggregat mit Filter (no-self, no-bridge-duplicates). Sub-Bug `status: null` in List-Response durch `ConversationItem`-Interface-Erweiterung mitgelöst. Browser-Smoke 4/4 grün.

### 106. ✅ DirectChat: aktive Konversation als View, Audit als Historie (CLOSED Tag 19)
Aktuell rendert DirectChat alle Audits aus dem Audit-Stream zeitlich gestapelt. Der Reset-Button setzt einen synthetischen Conversation-Divider (`directChatResetSeq`-Mechanismus, `chat/[handle]/page.tsx:984-986`), aber die alten Audits bleiben sichtbar. Heißt: nach erstem Twin-Use ist der EmptyState für immer weg, weil immer Audit-Historie da ist.

**Befund aus UX.1.A.3-Verifikation Tag 17 Abend:** Strukturell ist DirectChat ein „Audit-Log-Viewer", nicht „Konversations-View". Trade-off:
- Pro Status-Quo: Vollständiger Verlauf sichtbar, nichts geht verloren.
- Contra: Keine „frische Konversation"-Erfahrung möglich, EmptyState-Pattern für Wieder-Onboarding/Reset wertlos, und auch konzeptionell hat User keine Trennung zwischen „aktuellem Thread" und „alter Verlauf".

Was zu entscheiden ist (eigene Strategie-Session vor Bau):

- **Variante A — Conversation-View-Filter:** UI-Filter „nur aktuelle Konversation anzeigen" / „Vollhistorie anzeigen". Standard bei neuer Konv: nur aktuelle, EmptyState sichtbar. Power-User schaltet bei Bedarf auf Vollhistorie um.
- **Variante B — Soft-Hide-Reset:** Reset markiert alle bisherigen Audits als „vor-Reset", DirectChat blendet sie standardmäßig aus. Toggle „Vor-Reset-Verlauf einblenden" für Power-User.

**Größe:** L (Strategie-Session + M-Bau) · **Priorität:** should · **Aus:** UX.1.A.3-Verifikation Tag 17 Abend
**Stufe:** 0 → 1 · **Spur:** UX-Reifung

**Update Tag 19 (CLOSED):** Implementiert in Commit `412326b` (5 Files, +255/-49). Variante B (Soft-Hide-Reset) gewählt nach Mini-Strategy-Session mit 6 Setzungen (Mental-Model Mix, Persistierung β.1 als neue Spalte, Toggle-UI Inline-Hint, UI-State only, nur Direct-Chat, EmptyState wie brand-new). Phase-1.1-Diagnose enthüllte drei Architektur-Punkte: Reset musste auf Eager-Start (statt Lazy-Start beim nächsten Send), ChatBlock hat kein timestamp-Feld (AuditEntries-Filter VOR `buildChatBlocksFromAudits`), Detail-Endpoint braucht Conversation-Metadata. Bau: Migration 020 (`last_reset_at`-Spalte), Reset-Endpoint mit Eager-Start, Detail-Endpoint mit `{id, status, startedAt, endedAt, lastResetAt}`, Frontend AuditEntries-Filter mit `showFullHistory`-State (UI-only), `ResetMarker`-Component analog `ConversationDivider`, Post-Reset-EmptyState. Sub-Bug Detail-Endpoint Self-Chat mit-gelöst (`isDirectChat`-Konditionalisierung, Bridge-Call übersprungen für Direct-Chat). **Mit Block-2-Closure ist #96 vollständig funktional** — beide Pain-Points (A: A2A-Empty-State, B: DirectChat-Audit-Log-Viewer) gelöst. A2A-Reset bleibt späteres Item (#118). Backend-Smoke 4/4 grün, Browser-Smoke 7/7 grün.

### 109. DEPLOYMENT.md production-fest mit Self-Hoster-Smoke-Test ✅
`docs/DEPLOYMENT.md` (#102, Tag 16) existiert, ist aber Markus' eigener Setup-Wegweiser. Für Public-Launch braucht es:

1. **Externer Self-Hoster führt die Doku durch** (Florian punktuell oder externer Tech-Affine), Reibungspunkte werden dokumentiert und gefixt
2. **Klare Voraussetzungen am Anfang** (VPS-Specs, Domain-Bedarf, Reverse-Proxy-Wissen, Docker-Compose-Basics)
3. **Troubleshooting-Section** für die häufigsten Stolpersteine (TLS-Setup, MCP-Server-Provisioning, Bridge-Token-Generation)
4. **Optional: Self-Hosting-Cookbook** für Standard-Stacks (Coolify, CapRover, Plain-Docker, …)

**Größe:** M · **Priorität:** must · **Aus:** Pre-Launch-Phase-A-Strategy (Block 4) · **Spur:** Pre-Launch-Phase A

**Status-Notiz Tag 20:** Strategy-Setzungen in `docs/BLOCK-4-STRATEGY.md`:
- Tester: Self-Test als Dogfooding mit ehrlichen Regeln
- Scope: Skelett-Vervollständigen + Cookbook für Plain Docker + Traefik (heutiges Pattern auf srv1046432)
- Position in Block-4-Reihenfolge: 2 (nach #110)

**Abgeschlossen Tag 23+24** — siehe STAND.md für Bau-Details (Closure-Commit `cf2ccf6`). DEPLOYMENT.md von 540 → 1757 Zeilen, neun Sektionen voll-ausgebaut (§3 Deploy-Sequenz, §5 ENV-Reference, §6 Smoke, §7 Troubleshooting, §8 Backup+Recovery, §9 Plain-Docker+Traefik-Cookbook). Closure-Marker nachgetragen Tag 25 mit Block-4-Closure.

### 110. Onboarding-Wizard für ersten Login + Twin-Anlage ✅
Aktueller Erst-Login-Flow setzt voraus, dass User direkt zur Settings/Twin-Anlage navigiert und manuell Persona-YAML, MCP-Server etc. provisioniert. Für Self-Hosting-Launch zu hoch.

Onboarding-Wizard nach Erst-Login:
- **Welcome-Screen** (was ist Twin-Lab, was passiert als Nächstes)
- **Schritt 1:** Anthropic-API-Key eingeben + verifizieren
- **Schritt 2:** Erste Persona anlegen (vereinfachte UI, keine YAML-Direktbearbeitung)
- **Schritt 3:** Mandates-Setup mit Standard-Presets (z.B. „Persönlich" / „Beruflich" / „Custom")
- **Schritt 4:** Optional ein erster MCP-Server (Standard-Workflows: Hyperbrowser, oder „skip for now")
- **Schritt 5:** Erste Konversation mit Beispiel-Prompts

Wizard ist überspringbar für Tech-Affine („Skip to dashboard"), aber Default-Pfad für neue User.

**Größe:** M · **Priorität:** must · **Aus:** Pre-Launch-Phase-A-Strategy (Block 4) · **Spur:** Pre-Launch-Phase A

**Status-Notiz Tag 20:** Strategy-Setzungen in `docs/BLOCK-4-STRATEGY.md`:
- Audience: Tech-Affine primär, Wizard für beide nützlich
- Trigger: Hard-Trigger mit Skip-Option
- Persona: Minimal (4-5 Felder), Vertiefung in Settings
- Mandates: Default-Mandates, kein Wizard-Touch
- MCP: Hyperbrowser-Preset mit Skip-Default
- Mehrfach-Twins: Wiederholbar via Button neben Manual
- Position in Block-4-Reihenfolge: 1 (zuerst)

**Abgeschlossen Tag 22** — siehe STAND.md für Bau-Details (Closure-Commit `b578ad1`). Onboarding-Wizard über drei Phasen gebaut (Phase 1 + 2A + 2B), 13 Commits. Wizard von 8 → 4 Steps, Settings-Page UI-editierbar für Persona/LLM/Presets. Closure-Marker nachgetragen Tag 25 mit Block-4-Closure.

### 111. Public-Repo-Hygiene (README, LICENSE, CONTRIBUTING) ✅
Repo wird als Open-Source-Self-Hosting-Distro öffentlich. Hygiene-Items:

- **README.md** Hauptpitch: was ist Twin-Lab, Quick-Start, Differenzierungs-Story (Memory + Persona + A2A), Screenshots oder Mini-Demo, Verweis auf DEPLOYMENT.md für Self-Hosting
- **LICENSE** wählen: MIT (permissiv) oder Apache 2.0 (mit Patent-Schutz) — Open-Core-konsistent
- **CONTRIBUTING.md** für externe Contributors: Code-Style, Sub-Schritt-Workflow (analog Markus' Pair-Programming-Pattern), PR-Reviewer-Hinweise
- **GitHub-Issue-Templates** (Bug, Feature-Request, Question)
- **GitHub-Discussions** evtl. aktivieren für Community

**Größe:** S · **Priorität:** must · **Aus:** Pre-Launch-Phase-A-Strategy (Block 4) · **Spur:** Pre-Launch-Phase A

**Status-Notiz Tag 20:** Strategy-Setzungen in `docs/BLOCK-4-STRATEGY.md`:
- LICENSE: Apache 2.0
- README-Struktur: Demo-First mit Hero-GIF und Story-driven Pitch
- CONTRIBUTING.md + Issue-Templates: Standard-Pattern
- Position in Block-4-Reihenfolge: 3 (zuletzt)

**Abgeschlossen 24. Mai 2026 (Tag 25)** — zwei Sub-Schritte:

- **Schritt 6** (Commit `eef78f3`): Apache 2.0 LICENSE (Copyright 2026 Markus Baier), CONTRIBUTING.md, SECURITY.md (5-Zeilen-Variante), Issue-Templates (bug + feature + question + config.yml), package.json updated (license + author + repository + bugs + homepage)
- **Schritt 7** (Commit `217d299`): README komplett überschrieben (85 Z deutsch → 126 Z EN), Demo-First-Struktur 11 Sektionen, 3 Badges (License + pre-launch + Built with Claude), Hero-GIF-Placeholder mit #113-Marker, Quick-Start pnpm-native + DEPLOYMENT.md-Verweis, Screenshots-Stubs in `docs/screenshots/`, Status-&-Beta mit #108-Footprint
- **Emergent:** Backlog #129 (`.env.example`-Default auf Anthropic switchen) als Phase-1.1-Catch
- **Production-Re-Deploy** als separater Schritt 9 morgen Vormittag

Block 4 = 3/3 ✅.

