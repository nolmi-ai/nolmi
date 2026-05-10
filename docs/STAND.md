# twin-lab — Stand

**Letztes Update:** 10. Mai 2026, Vormittag (Tag 11)

## Aktuell in Arbeit
Nichts. Phase 3.2 in Production deployed (#92 ✅) — Tag-10-Stand
ist auf VPS aktiv, Pilot-MCP-Server für @markus angelegt. Phase 3.2
ist damit komplett — sowohl lokal als auch in Production. Nächster
Block: Item #89 (LLM-Tool-Use-Verhalten) angehen oder Strategie-
Session vor 3.3 (Memory: Conversation + Semantic).

## Heute (Tag 11) abgeschlossen

### #92 — Production-Deploy von Phase 3.2 (~60 Min)

Tag-10-Stand auf VPS. Dreh- und Angelpunkt: Override-File für
`mcp-servers/`-Volume-Mount (analog #81), Image-Rebuild für Runtime
+ Web, Container-Recreate, Migrations 011/012 frisch eingespielt,
Pilot-MCP-Server via CLI provisioniert.

**Sequenz:**
1. **Repo-Pull** auf VPS: `7ed573d → 20aaa36`. 9 Commits Diff,
   5839 insertions, 401 deletions. Alle Tag-9- und Tag-10-Commits
   gelandet.
2. **Override-File erweitert** um zweiten Volume-Mount für
   `mcp-servers/` (lebt nur auf VPS, nicht im Repo — Pattern aus
   #81).
3. **Image-Rebuild** für Runtime (57.7s) und Web (75.7s). Beide
   Builds grün, neue SHA-Hashes triggern Container-Recreate.
4. **Container recreated** mit `docker compose up -d` — beide
   Services Up, Health-Endpoints antworten (`/health` 200,
   `/login` 307).
5. **Migrations sauber:** `[db:init] 011_mcp_servers.sql angewendet`,
   `[db:init] 012_skills_mcp_source.sql angewendet`. 10 schon drin
   (009/010 waren überraschenderweise schon da — Production-DB
   hatte den Tag-9-Stand bereits, vermutlich durch einen früheren
   Container-Restart, in den Logs nicht mehr sichtbar). Schema-
   Stand jetzt 12 Migrations.
6. **MCP-Server provisioniert** — beide Pilot-Server für @markus:
   - `everything` (no-approval, 13 Tools, Spawn 5.3s erste
     Initialisierung)
   - `everything-approval` (approval-required, 13 Tools, Spawn
     1.4s — npx-Cache warm)
   - 26 Tools insgesamt aktiv in Production
7. **Smoke-Test in Production via Browser:**
   - User-Send: `Bitte rufe das mcp_everything_get-sum Tool mit
     a=10 und b=20 auf.`
   - Twin-Antwort: `30.`
   - Audit: `owner-direct|executed`, `tool_calls: null`
   - **Item #89 reproduziert sich auch in Production** — der LLM
     ruft das Tool nicht autonom, halluziniert die Antwort
8. **Approval-Pfad-Verifikation in Production:**
   - User-Send: `Bitte rufe das mcp_everything-approval_get-sum
     Tool mit a=5 und b=7 auf.`
   - Twin-Antwort: erfundene Approval-Bestätigung mit Internal-
     Marker `__MCP_PENDING_APPROVAL__` als „Beweis" — Halluzination
   - Keine Pending-Box im Chat, kein Pending-Audit
   - Item #89 in härterer Variante: LLM erfindet sogar Internal-
     Marker-Strings als plausibles Halluzinations-Material
9. **Echo-Test (nicht-trivial):**
   - User-Send: `Bitte rufe das mcp_everything_echo Tool auf mit
     message="Hello Production".`
   - Twin-Antwort: `Echo zurück: \`Echo: Hello Production\`. Tool
     läuft.`
   - Audit: wieder `tool_calls: null` — selbst nicht-triviale Tool-
     Outputs werden halluziniert

**Architektur-Status:**
- Production-Deploy erfolgreich, alle MCP-Komponenten aktiv
- Code-Pfade verifiziert (Migration, CLI, Tool-Discovery, Skill-
  Sync, Tool-Bridge)
- Item #89 ist klar diagnostiziert: ohne `toolChoice: 'required'`
  ist der LLM bei autonomer Tool-Wahl unzuverlässig. Architektur
  würde funktionieren wenn Tools tatsächlich gerufen werden — wir
  haben das lokal schon bewiesen
- Code-internes Marker-Leak ausgeschlossen — der Marker
  `__MCP_PENDING_APPROVAL__` ist nicht im System-Prompt oder
  Tool-Description, der LLM erfindet ihn auf Basis von Tool-Namen
  plus Aufforderung „Approval-Workflow zu testen"

### Architektur-Beobachtungen Tag 11

**Item #89 ist UX-mäßig dringlicher als gedacht.** Der LLM
halluziniert nicht nur „Tool-Output", sondern erfindet auch
plausibel klingende Approval-Bestätigungen mit Code-Internals.
User könnte denken Approval-Workflow läuft, aber nichts ist
passiert. Drei Lösungspfade angedacht für #89:
- Stärkere TOOL_USE_DIRECTIVE mit Negativ-Beispielen
- User-getriggerte Tool-Use über UI-Buttons (Force-Tool-Choice
  via UI, kein LLM-Ermessen)
- Dual-Step: erst `toolChoice: 'required'` für Tool-Use, dann
  `auto` für Final-Antwort

**Compose-Override-Verhalten subtle:** `docker compose config`
zeigt Override-Volume-Mounts NICHT an, obwohl sie aktiv sind.
`docker inspect <container>` ist die zuverlässige Wahrheit.
Beim Diagnostizieren in #92 erst irritierend — bestätigt durch
laufenden Container, der die `docs/`-Mounts trotz fehlender
config-Anzeige hatte. Generelles Pattern: bei Mount-Diagnose
nicht nur `compose config`, sondern auch `docker inspect`.

**Tag-10-Architektur in Production produktiv:** Das
Konversations-System (Tag 9) und die Inline-Approval-UI (Tag 10
Sub-Schritt G) rendern sauber — Konversations-Trenner überleben
Page-Reload, neue Konversationen werden gestartet, Audits werden
korrekt angezeigt.

## Tag 10 abgeschlossen

### Phase 3.2 — MCP-Client als Skill-Provider (~6h, sieben Sub-Schritte plus Patch)

**Sieben Commits (A bis G), jeder einzeln testbar.** Vormittag
Sub-Schritte A bis D plus Strategie-Session, Nachmittag E bis G plus
ein Marker-Pattern-Patch in F. Plus BACKLOG-Update als eigener
Commit zwischendurch.

- **3.2.A** ✅ MCP-Schema + Repo (Commit `2bf1ee0`, +836 Zeilen)
- **3.2.B** ✅ MCP-Client + Lifecycle-Manager (Commit `daa03b7`,
  +1749 Zeilen)
- **3.2.C** ✅ Tool-Discovery + Skill-Sync (Commit `cd5b295`,
  +783 Zeilen)
- **3.2.D** ✅ Tool-Execution via AI-SDK-Tool-Bridge (Commit
  `366ca93`)
- **3.2.E** ✅ MCP-Server-CLI (Commit `43258cf`, +635 Zeilen)
- **3.2.F** ✅ MCP-Tool-Approval-Workflow (Commit `b58df94`,
  +524/-51 Zeilen) — Marker-Pattern als Primary, Throw-Pattern als
  Defense-in-Depth (AI SDK 6 propagiert Throws nicht)
- **3.2.G** ✅ Inline-Approval-UI im Chat (Commit `bce54fb`,
  +415/-96 Zeilen) — McpToolCallBox-Component, Persistent-
  Visualization, 5s-Polling

Plus BACKLOG-Update als eigener Commit (`5f0f80c`) für die vier
Items #86-#89, die in der 3.2-Strategie-Session entstanden sind.
Plus Doku-Commit `20aaa36` (STAND/ROADMAP/BACKLOG auf Tag-10-Stand).

## Phase 3 Status

- 3.1 ✅ **Skill-System Engine + Pilot** (Tag 7)
- 3.2 ✅ **MCP-Client als Skill-Provider** (Tag 10 lokal,
  Tag 11 in Production)
- 3.3 offen — Memory: Conversation + Semantic
- 3.4 offen — Memory: Episodic
- 3.5 offen — Hyperbrowser als MCP-Skill (auf MCP-Foundation
  aus 3.2 obendrauf)
- 3.6 offen — Procedural Memory (ggf. Phase 4)

**Phase 3 Definition of Done — 2 von 5 Häkchen gesetzt** (3.1 + 3.2).

## Was als nächstes ansteht

1. **Item #89 angehen** — LLM-Tool-Use-Verhalten tunen. Klar geworden
   in Tag-11-Production-Deploy: ohne strukturelle Lösung ist Tool-
   Use UX-mäßig kaputt. Zwei mögliche Pfade:
   - **Bessere Prompts** (TOOL_USE_DIRECTIVE härter, Negativ-Beispiele,
     pro-Tool-Hints) — schnell, vermutlich nicht ausreichend
   - **Strukturelle Lösung** über UI — User-getriggerte Tool-Buttons
     im Chat, die `toolChoice: { type: 'tool', toolName: '...' }`
     forcieren. Das nimmt das LLM-Ermessen aus der Frage „ruft er das
     Tool oder nicht" raus
2. **Polish-Items #90 + #91** — können vor oder nach #89 abgearbeitet
   werden:
   - **#90** Resume-Prompt-Tuning für Reject-Pfad (M, should)
   - **#91** Reject-Reason-UI (window.prompt durch Modal ersetzen) — S, nice
3. **Strategie-Session vor 3.3** — Conversation- und Semantic-
   Memory. Pre-Implementation-Diskussion mit konkreten Festlegungen
   zu Auto-Summary-Schwelle, KV-Store-Lifecycle, facts.md-
   Schreibrechte, Embedding-Provider-Wahl für 3.4.
4. Optional: **#79 Persona-Tabelle droppen** (XS, nice) — kann
   beim nächsten Migrations-Anlass mit angehängt werden.

## Production-Stack — live, aktuell auf Tag-10-Stand (deployed Tag 11)

**Phase 3.2 ist in Production aktiv.** Drei Twins live, Pilot-MCP-
Server für @markus eingerichtet, Code-Pfade alle deployed.

- **`https://app.twin.harwayexperience.com`** — Web (Tag-10-Image
  vom 10.5., Container-Recreate via Tag-11-Deploy)
- **`https://runtime.twin.harwayexperience.com`** — Runtime
  (Tag-10-Image vom 10.5., Container-Recreate via Tag-11-Deploy)
- **`https://bridge.twin.harwayexperience.com`** — Bridge (vom
  3. Mai, unverändert)

Alle drei mit `restart: unless-stopped`, HTTPS via Let's Encrypt,
Traefik-Routing.

**Persona-Stand auf Production (nach Tag-8-Sync):**
- @markus: 6991 chars (volle Persona aus docs/persona.md, Workshop-
  Block raus dank #74)
- @florian: 575 chars (volle Persona aus docs/persona-florian.md)
- @heiko: 344 chars (Stub aus Onboarding-Wizard, keine docs/-Source)

**MCP-Server in Production für @markus:**
- `mcp_Psd-MfjYN7UJkIPM` — `everything` (no-approval, 13 Tools)
- `mcp_TdslZrvQccflqHzS` — `everything-approval` (approval-required,
  13 Tools)
- 26 Tools insgesamt aktiv

**VPS-Override-File** `/docker/twin-lab-web/docker-compose.override.yml`
hat jetzt zwei bind-mounts (lebt nur auf VPS, nicht im Repo):
- `/docker/twin-lab-web/repo/docs:/app/docs:ro` (#81 vom Tag 8)
- `/docker/twin-lab-web/repo/mcp-servers:/app/mcp-servers:ro` (#92
  vom Tag 11)

## Lokal
`/Users/mjb/Visual Studio/twin-lab` — drei Twins (@markus, @florian,
@heiko), lokale Bridge auf 5100. Markus-Twin hat Pilot-Skill
`harway-workshops` aktiv plus 26 MCP-Tools (zwei everything-Server,
einer ohne und einer mit Approval). Persona-DB-Spalte ist nach
Tag-8-Sync identisch zu `docs/persona.md`.

**Konversations-System aktiv (seit Tag 9):** `conversations`-Tabelle
mit Test-Konversationen aus Smoke-Tests, `audit.conversation_id`
gefüllt für `owner-direct`-Audits seit Migration 009.

**MCP-System aktiv (seit Tag 10):** `mcp_servers`-Tabelle mit zwei
Pilot-Server-Einträgen, `skills`-Tabelle erweitert um
`mcp_server_id`/`mcp_tool_name` (Migration 012).

## Drei User auf Production
- Owner: @markus (markus.baier@harway.de)
- Owner: @florian (florian.ristig@harway.de)
- Owner: @heiko (heiko.gregor@harway.de)

Alle drei mit anthropic/claude-opus-4-7, Production-Bridge.

## Repo
github.com/markusbaier/twin-lab — `origin/main` lokal aktuell auf
`20aaa36` (Tag 10 Mittag, neun Commits aus Phase 3.2 plus Doku:
`2bf1ee0` Schema+Repo, `daa03b7` Client+Lifecycle, `cd5b295` Tool-
Discovery+Skill-Sync, `366ca93` Tool-Execution, `5f0f80c` BACKLOG-
Update für #86-#89, `43258cf` CLI, `b58df94` Approval-Workflow,
`bce54fb` Inline-Approval-UI, `20aaa36` Doku Tag 10).

Production-VPS auf `20aaa36` (Tag-10-Stand, deployed Tag 11). Tag-
11-Doku-Updates kommen mit dem Tag-11-Doku-Commit, der nach diesem
File-Update ansteht.

VPS-Override-File `/docker/twin-lab-web/docker-compose.override.yml`
hat zwei bind-mounts (#81 docs/ + #92 mcp-servers/) und lebt nur auf
VPS, nicht im Repo.
