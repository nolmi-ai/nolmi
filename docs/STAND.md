# twin-lab — Stand

**Letztes Update:** 10. Mai 2026, Mittag (Tag 11)

## Aktuell in Arbeit
Nichts. Phase 3.2 sowohl lokal als auch in Production komplett —
MCP-Foundation plus Tool-Picker-UI als strukturelle Lösung für
Item #89 (UI-Pfad). Plus TOOL_USE_DIRECTIVE-Polish für Natural-
Language-Pfad. Nächster Block: Production-Deploy von 3.2.H +
Direktive-Polish auf VPS, dann Strategie-Session vor 3.3 (Memory:
Conversation + Semantic).

## Heute (Tag 11) abgeschlossen

### Vormittag — #92 Production-Deploy von Phase 3.2 (~60 Min)

Tag-10-Stand auf VPS. Dreh- und Angelpunkt: Override-File für
`mcp-servers/`-Volume-Mount (analog #81), Image-Rebuild für Runtime
+ Web, Container-Recreate, Migrations 011/012 frisch eingespielt,
Pilot-MCP-Server via CLI provisioniert.

**Sequenz:**
1. Repo-Pull `7ed573d → 20aaa36`. 9 Commits Diff
2. Override-File erweitert um zweiten Volume-Mount für
   `mcp-servers/` (lebt nur auf VPS)
3. Image-Rebuild Runtime (57.7s) + Web (75.7s)
4. Container-Recreate via `docker compose up -d`
5. Migrations 011 + 012 sauber, 10 schon drin (009/010
   überraschend bereits da von früherem Container-Restart)
6. MCP-Server provisioniert für Production-@markus:
   - `mcp_Psd-MfjYN7UJkIPM` — `everything` (no-approval, 13 Tools)
   - `mcp_TdslZrvQccflqHzS` — `everything-approval` (approval,
     13 Tools)
   - 26 Tools insgesamt aktiv
7. Smoke-Test in Production: Item #89 reproduziert sich auch
   in Production — Twin halluziniert Tool-Outputs inklusive
   Internal-Marker `__MCP_PENDING_APPROVAL__` als plausibles
   Halluzinations-Material (Marker-Code-Leak ausgeschlossen)

Plus Lesson zur Compose-Diagnose: `docker compose config`
zeigt Override-Volume-Mounts NICHT an, obwohl sie aktiv sind.
`docker inspect <container>` ist die zuverlässige Wahrheit.

### Mittag — 3.2 Sub-Schritt H + Direktive-Polish (~2h, ein Sub-Schritt plus Patches)

Strategie-Session ergab: Item #89 braucht strukturelle Lösung,
nicht nur Prompt-Tuning. UI-Picker als zuverlässiger Pfad,
Direktive-Härtung als Defense-in-Depth.

**3.2.H ✅ Tool-Picker-UI im Chat (Commit `b97ae80`, +821/-9)**

Plus-Button im Chat-Input öffnet Modal mit aktiven MCP-Tools des
Twins, gruppiert nach Server. User wählt Tool, füllt Auto-
generated Args-Form aus dem JSON-Schema, sendet. Backend setzt
`forcedToolChoice: { type: 'tool', toolName: '...' }` für den
LLM-Call, Tool wird zwingend gerufen — kein LLM-Ermessen mehr.

Backend:
- GET `/twins/:handle/tools` listet aktive MCP-Skills mit Schema
  + Server-Name + Approval-Marker (Owner-gated)
- POST `/twins/:handle/chat` akzeptiert optional `forcedToolChoice`,
  wird an `runModel` durchgereicht und im `generateText`-Call als
  `toolChoice` gesetzt
- **Multi-Step-Followup-Logic** (Patch nach Smoke-Test): bei
  forciertem `toolChoice` ruft AI SDK 6 nur Single-Step. LLM ruft
  Tool, kriegt Result, `finishReason: 'tool-calls'`, leerer Text.
  Fix: zweiter `generateText`-Call mit `response.messages` als
  History und `toolChoice: 'auto'` — LLM darf jetzt Final-Text
  synthetisieren. Approval-Pfad unbeeinflusst (`detectPendingTool-
  Call` läuft VOR Followup-Check). Token-Usage gemergt aus beiden
  Calls via `mergeTokenUsage()`-Helper

Frontend:
- ToolPickerButton (Plus-Icon, zwischen Input und Send-Button)
  toggelt Modal — Reihenfolge `[Input] — [+] — [Send]`, Action-
  Cluster rechts
- ToolPickerModal: Stage 1 Tool-Liste nach Server gruppiert mit
  Section-Headers + Approval-Indikator pro Server (`🔒 APPROVAL`-
  Badge), Pro-Tool-Marker als rechts-bündiges 🔒-Icon. Stage 2
  Args-Form
- ToolArgsForm: Auto-generated aus JSON-Schema, typisierte
  Inputs (number/integer/string/boolean), Required-Validation,
  JSON-Editor-Fallback für nested/array
- Submit baut User-Message `[Tool-Aufruf] <name> mit Args <json>`
  plus `forcedToolChoice`, sendet via existierender Chat-API

Smoke-Test komplett verifiziert:
- No-Approval-Tool (`everything:get-sum` mit a=15, b=27): Multi-
  Step-Followup grün, `tool_calls` gefüllt mit echtem Result
  `"The sum of 15 and 27 is 42."`, `reply: "15 + 27 = 42."`,
  `finishReason: stop`
- Approval-Tool (`everything-approval:get-sum` mit a=5, b=7):
  McpToolCallBox mit Pending erscheint, Approve klicken, Final-
  Antwort `12.` darunter — Approval-Pfad funktioniert auch
  mit Picker-Trigger

**TOOL_USE_DIRECTIVE-Polish (Commit `2e7c1d0`, +19/-9)**

Tag-11-Production-Befunde haben Marker-Halluzination und Echo-
Halluzination gezeigt. Direktive um zwei Regeln erweitert:
- REGEL 4: keine technischen Marker erfinden (`__PENDING__`,
  `approved`, `queued`)
- REGEL 6: bei expliziter User-Aufforderung (`rufe das X Tool
  auf`) MUSS Tool gerufen werden

Smoke-Test-Befund: gemischt.
- ✓ REGEL 4 wirkt: Marker-Strings werden nicht mehr in
  Halluzinationen eingebaut. Bei `Bitte rufe mcp_everything-
  approval_get-sum auf` antwortet Twin jetzt `"Liegt in der
  Approval-Queue. Markus muss das freigeben"` (plausibel,
  aber ohne Internal-Marker)
- ✗ REGEL 6 wirkungslos: Tool wird trotz expliziter
  Aufforderung weiter nicht gerufen bei trivial-lösbaren
  Anfragen. Claude antwortet stattdessen mit User-freundlicher
  Halluzination (also UX-mäßig fast schlimmer)

Konsequenz: Direktive ist marginal effektiv. **Strukturelle
Lösung für Tool-Use ist und bleibt der UI-Picker.** Direktive-
Polish ist Defense-in-Depth gegen Marker-Pollution, aber NICHT
die Lösung für Item #89.

### Architektur-Erkenntnisse Tag 11

**AI-SDK-Multi-Step-Bug bei forcedToolChoice:** zweiter Patch im
3.2-Block (nach Marker-Pattern in 3.2.F). Pattern: AI-SDK-
Verhalten weicht von intuitiver Erwartung ab, manueller Multi-
Step nötig via `response.messages`. Lessons-Material — bei
Third-Party-SDK-Hooks die Verhaltens-Annahmen früh verifizieren.

**Item #89 Struktur-vs-Prompt-Erkenntnis:** Prompt-Tuning ist
Whack-a-Mole. REGEL 4 hat eine konkrete Halluzinations-Variante
unterbunden, aber LLM findet eine andere (User-freundliche
Approval-Halluzination). Strukturelle Lösung über UI-Picker
nimmt das Problem an der Wurzel weg — User-Intent wird
deterministisch übersetzt in Tool-Call.

**Tool-Picker als Pattern für künftige Action-Skills:** das
Picker-Pattern ist nicht nur für MCP-Tools sinnvoll. Künftige
Manual-Action-Skills (Bridge-Send-Aktion, Workflow-Trigger)
können dasselbe UI-Pattern nutzen. Architektur ist
erweiterungsfähig.

**Item-#89-UX-Beobachtung beim Smoke-Test:** Erste Test-Runde
hat zufällig das No-Approval-Tool gepickt statt das Approval-
Tool — Marker im Tool-Picker war zu schwach. Polish-Edit hat
Server-Sections mit prominentem `🔒 APPROVAL`-Badge im Header
plus Pro-Tool-Marker. Lesson: Smoke-Test produziert UX-Befund,
kleiner Polish-Edit vor Commit ist sauber.

## Tag 10 abgeschlossen

### Phase 3.2 Sub-Schritte A bis G — MCP-Foundation komplett

Sieben Sub-Schritte plus Marker-Pattern-Patch:
- 3.2.A Schema + Repo (`2bf1ee0`, +836)
- 3.2.B Client + Lifecycle (`daa03b7`, +1749)
- 3.2.C Tool-Discovery + Skill-Sync (`cd5b295`, +783)
- 3.2.D Tool-Execution via AI-SDK (`366ca93`)
- 3.2.E CLI (`43258cf`, +635)
- 3.2.F Approval-Workflow (`b58df94`, +524/-51) — Marker-Pattern
- 3.2.G Inline-Approval-UI im Chat (`bce54fb`, +415/-96)

Plus BACKLOG-Update `5f0f80c` und Doku `20aaa36`.

## Phase 3 Status

- 3.1 ✅ **Skill-System Engine + Pilot** (Tag 7)
- 3.2 ✅ **MCP-Client als Skill-Provider plus UI-Tool-Picker**
  (Tag 10 lokal, Tag 11 Vormittag in Production für 3.2.A-G,
  Tag 11 Mittag lokal komplett mit 3.2.H)
- 3.3 offen — Memory: Conversation + Semantic
- 3.4 offen — Memory: Episodic
- 3.5 offen — Hyperbrowser als MCP-Skill (auf MCP-Foundation
  aus 3.2 obendrauf)
- 3.6 offen — Procedural Memory (ggf. Phase 4)

**Phase 3 Definition of Done — 2 von 5 Häkchen gesetzt** (3.1 + 3.2).

## Was als nächstes ansteht

1. **Production-Deploy 3.2.H + Direktive-Polish auf VPS** —
   Tag-11-Mittag-Stand auf Production. Sequenz wie Tag 11
   Vormittag (Repo-Pull, Image-Rebuild, Container-Recreate),
   aber KEIN neuer Volume-Mount nötig (mcp-servers/ ist schon
   gemountet seit Vormittag-Deploy). Geschätzt 30-40 Min.
2. **#90 Resume-Prompt-Tuning** (M, should) — gleicher Pattern
   wie #89 Direktive-Polish, vermutlich auch nur partiell
   wirksam, aber 5-Min-Edit
3. **#91 Reject-Reason-UI** (S, nice) — window.prompt durch
   Modal ersetzen
4. **Strategie-Session vor 3.3** — Conversation- und Semantic-
   Memory. Pre-Implementation-Diskussion zu Auto-Summary-
   Schwelle, KV-Store-Lifecycle, facts.md-Schreibrechte,
   Embedding-Provider-Wahl für 3.4
5. **3.3 — Memory: Conversation + Semantic** (L) — erste zwei
   Memory-Schichten

Optional: **#79 Persona-Tabelle droppen** (XS, nice) — kann
beim nächsten Migrations-Anlass mit angehängt werden.

## Production-Stack — Tag-10-Stand auf VPS, Tag-11-Mittag-Stand offen

**Phase 3.2 A-G in Production aktiv (deployed Tag 11 Vormittag).**
Tag-11-Mittag-Stand mit 3.2.H (Tool-Picker) und Direktive-Polish
ist lokal committet, noch nicht in Production.

- **`https://app.twin.harwayexperience.com`** — Web (Tag-10-Image
  vom 10.5., Container-Recreate via Tag-11-Vormittag-Deploy)
- **`https://runtime.twin.harwayexperience.com`** — Runtime
  (Tag-10-Image vom 10.5., Container-Recreate via Tag-11-
  Vormittag-Deploy)
- **`https://bridge.twin.harwayexperience.com`** — Bridge (vom
  3. Mai, unverändert)

Alle drei mit `restart: unless-stopped`, HTTPS via Let's Encrypt,
Traefik-Routing.

**Persona-Stand auf Production (nach Tag-8-Sync):**
- @markus: 6991 chars
- @florian: 575 chars
- @heiko: 344 chars (Stub)

**MCP-Server in Production für @markus:**
- `mcp_Psd-MfjYN7UJkIPM` — `everything` (no-approval, 13 Tools)
- `mcp_TdslZrvQccflqHzS` — `everything-approval` (approval, 13 Tools)
- 26 Tools insgesamt aktiv

**VPS-Override-File** `/docker/twin-lab-web/docker-compose.override.yml`
hat zwei bind-mounts (lebt nur auf VPS, nicht im Repo):
- `/docker/twin-lab-web/repo/docs:/app/docs:ro` (#81 vom Tag 8)
- `/docker/twin-lab-web/repo/mcp-servers:/app/mcp-servers:ro` (#92
  vom Tag 11)

## Lokal
`/Users/mjb/Visual Studio/twin-lab` — drei Twins (@markus, @florian,
@heiko), lokale Bridge auf 5100. Markus-Twin hat Pilot-Skill
`harway-workshops` aktiv plus 26 MCP-Tools (zwei everything-Server,
einer ohne und einer mit Approval).

**Konversations-System aktiv (seit Tag 9):** `conversations`-Tabelle
mit Test-Konversationen, `audit.conversation_id` gefüllt für
`owner-direct`-Audits seit Migration 009.

**MCP-System aktiv (seit Tag 10):** `mcp_servers`-Tabelle mit zwei
Pilot-Server-Einträgen, `skills`-Tabelle erweitert um
`mcp_server_id`/`mcp_tool_name` (Migration 012).

**Tool-Picker-UI aktiv (seit Tag 11 Mittag):** ToolPicker-
Komponente im Chat, GET `/twins/:handle/tools`-Endpoint, Multi-
Step-Followup im Twin-Service bei forcedToolChoice.

## Drei User auf Production
- Owner: @markus (markus.baier@harway.de)
- Owner: @florian (florian.ristig@harway.de)
- Owner: @heiko (heiko.gregor@harway.de)

Alle drei mit anthropic/claude-opus-4-7, Production-Bridge.

## Repo
github.com/markusbaier/twin-lab — `origin/main` lokal aktuell auf
`2e7c1d0` (Tag 11 Mittag). Tag-11-Commits:
- `f3532e8` Doku Tag 11 Vormittag (#92 ✅)
- `b97ae80` 3.2.H Tool-Picker-UI plus Multi-Step-Patch plus UX-
  Polish in einem Commit
- `2e7c1d0` TOOL_USE_DIRECTIVE härter (Polish für #89)

Production-VPS auf `20aaa36` (Tag-10-Stand, deployed Tag 11
Vormittag). Tag-11-Mittag-Stand mit 3.2.H steht für Deploy aus.

VPS-Override-File `/docker/twin-lab-web/docker-compose.override.yml`
hat zwei bind-mounts (#81 docs/ + #92 mcp-servers/) und lebt nur auf
VPS, nicht im Repo.
