# twin-lab — Stand

**Letztes Update:** 4. Mai 2026, ~20:00

## Aktuell in Arbeit
Nichts. 2.5.6 (Production-Web-Deployment) abgeschlossen. Alle drei User
und Twins live unter `app.twin.harwayexperience.com`. Phase 2.5 zu
~95 % durch — nur 2.5.5 (Notifications) bleibt offen, bewusst verschoben.

## Heute (Tag 5) abgeschlossen

### #64 — VPS-Git-Auth via Deploy-Key (vormittags)
- ED25519-Deploy-Key auf VPS srv1046432 generiert (`~/.ssh/twin-lab-deploy`)
- Public-Key bei GitHub als Repo-Deploy-Key hinterlegt (read-only,
  `Allow write access` nicht angekreuzt)
- SSH-Config-Section mit `Host github.com-twin-lab`-Alias plus
  `IdentitiesOnly yes`
- Bridge-Repo `/docker/twin-lab-bridge/repo/` umgestellt auf
  `git@github.com-twin-lab:markusbaier/twin-lab.git`
- Verifikation: `git fetch` und `git pull` ohne Password-Prompt durch
- Deploy-Key wird auch für Web-App-Repo in 2.5.6 wiederverwendet
  (Monorepo, ein Key reicht)

### 2.5.6 — Production-Web-Deployment (nachmittags + abends)

Phase B technisch komplett durch. Drei User registriert, drei Twins
live, Onboarding ohne Restart, Hot-Load funktional, Cookie-
Cross-Subdomain läuft, Bridge-Hop intern stabil, A2A-Infrastruktur
bereit.

Acht Commits in einem Tag:

- **`a5b14a9`** — feat(onboarding): bridge URL aus ENV mit Fallback
  Wizard liest `TWIN_LAB_DEFAULT_BRIDGE_URL` für Bridge-URL beim
  Twin-Profil-Insert. Default-Fallback `http://127.0.0.1:5100` für
  lokale Entwicklung. Vorbedingung für Production: Twins zeigen auf
  Production-Bridge statt localhost.

- **`13cc70a`** — fix(onboarding): Bridge-Register-Token im Header
  Backlog #60 hatte den Bridge-Register-Endpoint mit Allowlist-Token
  geschützt, der Onboarding-Caller war nicht angepasst worden. Pre-
  existing Lücke, durch Production-Versuch aufgedeckt.

- **`bdde263`** — feat(deploy): Code-Artefakte für 2.5.6
  Phase A: Dockerfiles für Web (Next-Standalone) und Runtime,
  Compose-File, .env.example, README mit Deploy-Sequenz. Web-Image
  baute initial nicht durch wegen Suspense-Bug.

- **`85f664e`** — fix(web): Suspense-Boundary für Nav-Komponenten
  AppHeader und AppFooter im Layout in `<Suspense fallback={null}>`
  gewrapped. Static-Generation von 10 Pages grün, Web-Image baut
  durch. Plus: COPY-Zeile für nicht-existentes `apps/web/public/`
  aus dem Web-Dockerfile entfernt.

- **`79e3ae0`** — fix(shared): Production-Build mit dist/
  `packages/shared` zeigte mit `main` auf Source-TS. Lokal okay
  (tsx, next dev), Production-Container brachen mit
  ERR_UNKNOWN_FILE_EXTENSION. Build-Script ergänzt, `main`/`types`/
  `exports` auf `dist/`, predev-Hook in apps/runtime und apps/web
  baut shared automatisch beim ersten `pnpm dev`.

- **`a4f1465`** — feat(runtime): Hot-Reload für TwinServiceRegistry
  Boot-Code akzeptiert leere DB als gültigen Onboarding-only-Modus
  (statt `process.exit(1)`). Plus `addTwin(twinId)`-Methode auf der
  Registry, idempotent und atomisch via pendingAdds-Mutex.
  Onboarding-Submit ruft addTwin nach DB-Insert,
  `requiresRestart: false` zurück. Backlog-Item #37 abgeschlossen.

- **`758058e`** — fix(web): NEXT_PUBLIC_RUNTIME_URL als Build-ARG
  Next inlined `NEXT_PUBLIC_*` zur Build-Zeit ins Client-Bundle.
  Compose-environment kommt zu spät — Bundle hatte hartcodiert
  `localhost:4000`. Dockerfile mit `ARG`/`ENV` vor dem Web-Build,
  README mit `--build-arg`-Aufruf für Production.

- **`f94ae0d`** — feat(auth): Cookie-Domain + Secure-Flag aus ENV
  Cross-Subdomain-Setup (`app.*` Frontend, `runtime.*` Backend)
  scheiterte am Cookie ohne Domain-Attribut. Zwei neue ENVs
  (`SESSION_COOKIE_DOMAIN`, `SESSION_COOKIE_SECURE`) mit
  konservativem Default. Backlog #65 für später: Reverse-Proxy-
  Architektur (Same-Origin) macht das überflüssig.

Plus drei Production-Aktionen ohne Code-Commit:
- Bridge-DB von alten Handles (markus/florian/heiko vom 3. Mai)
  bereinigt — `registeredTwins: 0` vor Onboarding
- Bridge-URL für interne Calls auf `http://twin-lab-bridge:5100`
  umgestellt (Container-zu-Container statt Hairpin-NAT zur Public-URL)
- Drei User registriert via Production-Wizard, drei Twins
  hot-geladen ohne Container-Restart

## Phase 2.5 Status
- 2.5.1 ✅ AI SDK Migration
- 2.5.2a-d ✅ Schema, Multi-Twin Runtime, Florian-Twin
- 2.5.2e ✅ Per-Twin LLM-Config
- 2.5.3 ✅ Onboarding-Wizard
- 2.5.4 ✅ User-Auth + Trust + A2A-UI + UX-Polish
- #45 ✅ Bridge-Production-Sync
- #60 ✅ Bridge-Register-Endpoint abgesichert
- #59 ✅ Bridge-Sender-Endpoint abgesichert
- #63 ✅ CLI-Tool für API-Key-Rotation
- #64 ✅ VPS-Git-Auth via Deploy-Key
- 2.5.6 ✅ Production-Web-Deployment (Tag 5)
- 2.5.5 offen (Notifications) — verschoben, kein akuter Schmerz

## Was als nächstes ansteht
1. **Phase 2.5 als Ganzes bewusst abschließen.** STAND und BACKLOG
   sind aktualisiert, alle drei Power-User können sich registrieren,
   Twins onboarden, chatten. Multi-Tenant-SaaS funktional.
2. **2.5.5 (Notifications)** bleibt verschoben, bis Schmerzen
   sichtbar werden. Inbox-Badge plus drei Power-User vorm Browser
   reicht heute.
3. **Backlog #65 (Reverse-Proxy-Architektur)** als sauberer
   Sub-Schritt, wenn Cookie-Domain-Workaround konsolidiert werden
   soll. L-Größe, kein Notfall.
4. **Phase 3 starten** — Memory-Schichten, Skill-System, MCP-Client.
   Größerer strategischer Block, eigene Planungs-Session vorab.

## Production-Stack — live
- **`https://app.twin.harwayexperience.com`** — Web (Next.js Standalone)
- **`https://runtime.twin.harwayexperience.com`** — Runtime (Fastify,
  drei Twins hot-geladen)
- **`https://bridge.twin.harwayexperience.com`** — Bridge (vom 3. Mai,
  drei Twins registriert)

Alle drei mit `restart: unless-stopped`, HTTPS via Let's Encrypt,
Traefik-Routing.

### Production-Web-Stack
- `/docker/twin-lab-web/` auf VPS srv1046432
- Compose mit zwei Services: `runtime` und `web`
- Volume `twin-lab-web-data` für Runtime-DB
- Networks: `traefik-proxy` (extern) + `internal` (Compose-intern)
- Master-Key + Session-Secret + Bridge-Register-Token in
  `/docker/twin-lab-web/.env` (nicht in Git)
- Bridge-Hop intern via `http://twin-lab-bridge:5100` (kein Hairpin)

### Production-Bridge-Stack (unverändert seit Tag 4)
- `/docker/twin-lab-bridge/` auf VPS srv1046432
- Schema: 001 + 002 (message_type drin)
- Drei NEU registrierte Twins (Mai 4, mit neuen Tokens)
- Container `twin-lab-bridge` mit `restart: unless-stopped`
- Volume `twin-lab-bridge-data`
- Register-Endpoint geschützt via `BRIDGE_REGISTER_TOKEN` (#60)
- Sender-Endpoint geschützt via `requireTwinAuth` + Owner-Scope (#59)
- VPS-Git-Pull via Deploy-Key (#64)

## Lokal
`/Users/mjb/Visual Studio/twin-lab` — drei Twins (markus, florian,
heiko), lokale Bridge auf 5100. Lokale Twin-Profile zeigen weiterhin
auf `localhost:5100`. API-Keys aller drei Twins auf neuen
Anthropic-Key gerollt (Tag 4). Production-Twins haben eigene Profile,
eigene Tokens, eigene API-Keys — komplett getrennt von Lokal.

## Drei User auf Production
- Owner: @markus (markus.baier@harway.de)
- Owner: @florian (florian.ristig@harway.de)
- Owner: @heiko (heiko.gregor@harway.de)

Alle drei mit anthropic/claude-opus-4-7, Production-Bridge.

## Repo
github.com/markusbaier/twin-lab
