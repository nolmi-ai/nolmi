# twin-lab — Stand

**Letztes Update:** 9. Mai 2026, Mittag (Tag 10)

## Aktuell in Arbeit
Nichts. Phase 3.2 (MCP-Client als Skill-Provider) komplett —
sieben Sub-Schritte A bis G durchgezogen, MCP-Foundation ist
end-to-end produktiv. Nächster Block: Production-Deploy von
Phase 3.2 (Tag-10-Stand auf VPS bringen).

## Heute (Tag 10) abgeschlossen

### Phase 3.2 — MCP-Client als Skill-Provider (~6h, sieben Sub-Schritte plus Patch)

**Sieben Commits (A bis G), jeder einzeln testbar.** Vormittag
Sub-Schritte A bis D plus Strategie-Session, Nachmittag E bis G plus
ein Marker-Pattern-Patch in F. Plus BACKLOG-Update als eigener
Commit zwischendurch.

- **3.2.A** ✅ MCP-Schema + Repo (Commit `2bf1ee0`, +836 Zeilen)
  Migration 011 mit `mcp_servers`-Tabelle, Multi-Tenant-Isolation
  pro Twin via FK auf `twin_profiles`. McpServersRepo mit allen
  CRUD-Methoden plus AES-256-GCM-ENV-Encryption analog zur
  apiKeyEncrypted-Logik. Master-Key per Constructor injected, kein
  globaler State. 12-Step-Test grün.
- **3.2.B** ✅ MCP-Client + Lifecycle-Manager (Commit `daa03b7`,
  +1749 Zeilen). `@modelcontextprotocol/sdk@^1.29.0` als Dependency,
  McpClient für stdio-Transport mit 30s-Spawn-Timeout. McpClientManager
  pro Twin: Lazy-Spawn beim ersten Tool-Call, Idle-Disconnect nach
  5 Min, pendingSpawns-Mutex gegen Concurrent-Spawns. ENV-Tunables
  via `MCP_IDLE_TIMEOUT_MS`, `MCP_SPAWN_TIMEOUT_MS`. Registry-
  disposeAll() beim SIGTERM/SIGINT. Manueller Smoke-Test mit
  everything-Server (Spawn ~4s lokal, 13 Tools discovered).
- **3.2.C** ✅ Tool-Discovery + Skill-Sync (Commit `cd5b295`,
  +783 Zeilen). Migration 012 erweitert `skills`-Tabelle um
  `mcp_server_id` (FK ON DELETE CASCADE) plus `mcp_tool_name`.
  McpSkillSync mit `syncOnAdd()` und `refresh()`-Diff (added/
  deactivated/unchanged, plus Reaktivierung). Synthetisches Skill-
  Manifest mit `capability: "mcp_tool"` als Marker. Skill-Naming
  `mcp:<server>:<tool>`. 11-Step-Test grün.
- **3.2.D** ✅ Tool-Execution via AI-SDK-Tool-Bridge (Commit
  `366ca93`). `apps/runtime/src/mcp/tool-bridge.ts` mit
  `buildMcpToolsFromSkills()`, `runModel()` reicht Tools an
  `generateText` durch wenn `enableMcpTools=true`. MCP-Skills
  werden NICHT mehr im System-Prompt-Block geführt (filtert
  `source !== 'mcp'`), stattdessen `TOOL_USE_DIRECTIVE`. Tool-
  Naming-Bug-Fix: Doppelpunkte in `mcp:<server>:<tool>` zu
  Underscores für AI-SDK (`mcp_<server>_<tool>` als Tool-Key,
  DB-Skill-Name bleibt mit Doppelpunkten). 5-Step-Test grün
  plus toolChoice='required'-Beweistest erfolgreich.
- **3.2.E** ✅ MCP-Server-CLI (Commit `43258cf`, +635 Zeilen).
  Vier CLI-Skripte: `twin:mcp-add` mit JSON-Spec-File, `twin:mcp-list`
  mit `--json`-Flag, `twin:mcp-refresh` für manuelles Re-Sync,
  `twin:mcp-remove` mit `--yes` für Scripting. ENV-Werte mit
  `?`-Marker werden interaktiv via Readline abgefragt.
  Pilot-File `mcp-servers/everything.json` plus README. Helper
  `_mcp-cli-helpers.ts` für loadMcpCliContext, resolveServer,
  formatPlaintextServer plus `REPO_ROOT`/`resolveRepoPath` für
  pnpm-Filter-CWD-Bug.
- **3.2.F** ✅ MCP-Tool-Approval-Workflow (Commit `b58df94`,
  +524/-51 Zeilen). Pre-Call-Approval-Pattern für Tools mit
  `requires_approval=true`. Marker-Pattern als Primary
  (`MCP_PENDING_APPROVAL_MARKER`-String im content-Array, weil AI
  SDK 6 Throws aus execute() nicht propagiert), Throw-Pfad bleibt
  als Defense-in-Depth. Twin-Service `detectPendingToolCall()`
  erkennt Marker, wirft `McpToolApprovalRequiredError`, runOwnerDirect-
  Catch baut Pending-Audit mit `capability='mcp-tool-use'`.
  Approve/Reject-Endpoints, Resume-Pattern via User-Message
  ("[System] Tool '...' wurde ausgeführt. Ergebnis: ...") provider-
  agnostisch, kein Tool-Result-Schema. Tools im Resume deaktiviert
  (kein Multi-Tool-Loop). Inbox-UI erweitert um mcp-tool-use-
  Render-Case. Smoke-Test mit toolChoice='required' grün.
- **3.2.G** ✅ Inline-Approval-UI im Chat (Commit `bce54fb`,
  +415/-96 Zeilen). Pending-mcp-tool-use-Audits werden im Chat als
  kombinierte Box gerendert: composeToolApprovalRequest-Text plus
  strukturierter Tool-Call-Block (McpToolCallBox) mit Tool-Name,
  Args, Approve/Reject-Buttons. Persistent-Visualization: Pending-
  Box bleibt nach Approve/Reject sichtbar mit Status-Indicator
  (✓/✗), finale Twin-Antwort als neuer Bubble darunter.
  `DIRECT_CHAT_CAPABILITIES` um `mcp-tool-use` erweitert,
  `buildChatBlocksFromAudits()`-Helper rekonstruiert ASC aus DESC-
  Audit-Stream und mapped die vier Capability/Status-Varianten auf
  Block-Sequenzen. 5s-Polling via useEffect+setInterval plus
  manueller Trigger nach send/approve/reject. Smoke-Test komplett
  (Approve-Pfad mit echtem Tool-Result, Reject-Pfad mit Begründung,
  Cross-Stellen-Test Inbox-Approve → Chat-Polling-Refresh).

Plus BACKLOG-Update als eigener Commit (`5f0f80c`) für die vier
Items #86-#89, die in der 3.2-Strategie-Session entstanden sind.

### Architektur-Entscheidungen während Phase 3.2

Wichtige Festlegungen aus der Strategie-Session und während der
Implementation, die für künftige Sessions Referenz sind:

- **MCP-Client pro Twin (Multi-Tenant).** Jeder Twin hat eigene
  Server-Configs in `mcp_servers`-Tabelle, eigenen ClientManager-
  Pool. Konsistent mit allen Konfigurationen pro Twin
  (`apiKeyEncrypted`, Skills, Persona).
- **Lazy-Spawn beim ersten Tool-Call, Idle-Timeout 5 Min.** Server
  startet erst, wenn Twin ihn braucht. Idle-Disconnect schont
  Ressourcen. ENV-tunable für Production-Tuning.
- **Tools werden Skills mit `source: "mcp"`.** Kein zweites
  paralleles System. Tool-Discovery erzeugt synthetische Skill-
  Manifeste, die im Skill-Repo liegen. Sub-Schritt-3.2.D filtert
  MCP-Skills aus dem System-Prompt-Block raus (`source !== 'mcp'`),
  stattdessen werden sie via AI-SDK-Tools an den LLM übergeben.
- **5 Iterationen Limit via `stepCountIs(5)`.** Pro User-Send
  maximal 5 Tool-Use-Schritte. Verhindert Endlos-Loops bei buggy
  Tools oder Halluzinationen.
- **Audit-Tool-Calls eingebettet in Audit-output.** Eigene Audit-
  Capability `mcp-tool-use` für Pending/Executed/Rejected, Tool-
  Call-Details direkt in Audit-output. Kein separater
  `tool_executions`-Table — alles audit-zentrisch.
- **Pre-Call-Approval, kein Post-Call-Reject.** Schreibende Tools
  sind das eigentliche Risiko, Post-Call wäre zu spät. Read-only-
  Tools können mit `requires_approval=false` direkt durchgewunken
  werden. Owner-Bypass für Tool-Approval explizit NICHT
  implementiert — konsistent mit Tag-3-Architektur für `send_to_twin`.
- **Async via Audit-State + LLM-Re-Run, nicht synchroner Block.**
  Pending-State persistiert via Audit, überlebt Server-Restart.
  Resume nach Approve startet neuen `runOwnerDirect`-Call mit
  angereichter Message-History (System-Tool-Result als User-Message).
- **Marker-Pattern als Primary für Approval-Trigger.** AI SDK 6
  propagiert Throws aus `execute()` nicht nach oben — Smoke-Test
  hat das verifiziert (Tool-Call lief, aber Audit war
  `owner-direct|executed` mit leerer Reply). Marker-String im
  content-Array ist provider-agnostisch und eindeutig
  identifizierbar. Throw-Pfad bleibt als Defense-in-Depth.
- **Hybrid-Render im Chat plus Persistent-Visualization.** Pending-
  Tool-Call wird als Hybrid (Twin-Antwort plus strukturierter
  Tool-Call-Block) dargestellt. Nach Approve/Reject bleibt der
  Block sichtbar mit Status-Indicator-Wechsel, finale Twin-Antwort
  als neuer Bubble. User sieht historisch nachvollziehbar was
  passiert ist.

### Architektur-Befunde während Phase 3.2

Drei Befunde, die heute aufgetaucht sind und teils zu Backlog-
Items wurden:

**1. AI SDK 6 propagiert Throws aus `execute()` nicht.** Erste
3.2.F-Implementation nutzte Throw-Pattern (`McpToolApprovalRequiredError`
aus tool-bridge), Twin-Service catcht. Smoke-Test zeigte: Throw
wird zu `tool-result mit output: null` umgewandelt, LLM-Loop
läuft weiter, finishReason: 'tool-calls', leerer Text. Marker-
Pattern-Fallback eingebaut. Defense-in-Depth: Throw-Pfad bleibt
für hypothetische direkte Throws aus interner Logik.

**2. Claude Opus 4.7 ist autonom bei Tool-Use.** Item #89 — der
LLM ruft Tools selbst dann nicht auf, wenn sie explizit angefordert
werden. Stattdessen halluziniert er technisch klingende
Erklärungen warum das Tool angeblich nicht funktioniert
("client.experimental.tasks.callToolStream()" als Bullshit-
Begründung). Mit `toolChoice: 'required'` ruft er sicher (Beweis
durch Smoke-Tests), aber für freie Tool-Wahl in Production
brauchen wir entweder bessere Prompts, User-getriggerte
Approval-Forcierung (was 3.2.F-G genau ist), oder eine
strukturelle Lösung für Item #89.

**3. Bei trivialen Math-Problemen ignoriert der LLM Reject-Signale.**
Smoke-Test mit Reject auf `get-sum(99, 1)`: Twin antwortet trotz
Reject-Resume-Prompt mit „99 + 1 = 100." statt „Verstanden, ohne
Tool kann ich nicht antworten." LLM-Verhalten bei Trivialitäten,
nicht Architektur-Bug. Dokumentiert als #90 im Backlog (Resume-
Prompt-Tuning).

### Pilot-Setup auf @markus

- Server `mcp_pilot_everything` (everything, no approval) — 13 Tools
- Server `mcp_xkSaTJvmajv5KG4r` (everything-approval, approval
  required) — 13 Tools
- 26 Tools insgesamt aktiv für End-to-End-Tests

## Tag 9 abgeschlossen

### #71b + #80 — Konversations-Konzept als Test-Hygiene-Block (~3h)
**Sechs Commits über fünf Sub-Schritte plus zwei UX-Polish-Items.**

Konversations-Modellierung als Ersatz für die flache Audit-History.
Die DB hat jetzt eine eigene `conversations`-Tabelle, jeder
`owner-direct`-Audit ist via `conversation_id` daran gebunden, der
LLM-History-Loader filtert strict pro Konversation, und der User
hat einen Reset-Button mit Inline-Confirm und einem visuellen
Trenner im Verlauf.

- **A**: Migration 009 + `ConversationsRepo` (Commit `bc1669a`)
- **B**: Twin-Service-Anpassung mit `getOrStart()` vor Audit-Insert,
  `audit.conversation_id`-Spalte (Commit `d0b8cc7`)
- **C**: History-Loader auf Konversations-Scope plus 40-Messages-
  Sliding-Window-Cap (Commit `b694d0d`)
- **D**: UI-Reset-Button im Direct-Chat-Header plus Backend-Route
  `POST /twins/:handle/conversations/reset`. Lazy-Start der nächsten
  Konversation passiert beim nächsten Send via `getOrStart()`,
  nicht beim Reset selbst (Commit `8f604fa`)
- **#84/#85 UX-Polish**: `window.confirm()` raus, Inline-Bestätigung
  am Reset-Button mit 5-Sekunden-Auto-Reset. Plus daten-getriebener
  Konversations-Trenner im Verlauf — überlebt Page-Reload, weil aus
  geladenen Audits abgeleitet (Commit `76e2728`)
- **E**: Migration 010 (Cleanup von Pre-Konversations-Audits ohne
  `conversation_id` mit `capability='owner-direct'`). Andere
  Capabilities bleiben erhalten. Doku auf Tag-9-Stand
  (Commit `e18f58c`)

Hauptpunkt: Skill-Toggle-Tests sind jetzt sauber — nach
Konversations-Reset kein Memory-Leak aus voriger Session.

## Phase 3 Status

- 3.1 ✅ **Skill-System Engine + Pilot** (Tag 7)
- 3.2 ✅ **MCP-Client als Skill-Provider** (Tag 10) — Sub-Schritte
  A bis G komplett
- 3.3 offen — Memory: Conversation + Semantic
- 3.4 offen — Memory: Episodic
- 3.5 offen — Hyperbrowser als MCP-Skill (auf MCP-Foundation
  aus 3.2 obendrauf)
- 3.6 offen — Procedural Memory (ggf. Phase 4)

**Phase 3 Definition of Done — 2 von 5 Häkchen gesetzt** (3.1 + 3.2).

## Was als nächstes ansteht

1. **Production-Deploy von Phase 3.2.** Tag-10-Stand auf VPS
   bringen. Diff seit letztem Production-Deploy ist groß: vier
   neue Migrations (009-012), neue MCP-CLI, neue Inbox-UI-Render-
   Cases, neue Chat-Inline-Approval-UI. Pre-Deploy-Check: Migrations-
   Pfad in Production verifizieren, Pilot-Server-Setup auf
   Production-DB aufbauen (separater @markus-Production-Twin),
   ENV-Tunables für MCP-Lifecycle setzen.
2. **3.2-Polish-Items abarbeiten** — sind alle nice-to-have, nicht
   blockierend für 3.3:
   - **#90** Resume-Prompt-Tuning für Reject-Pfad (LLM ignoriert
     Reject bei trivialen Aufgaben) — M, should
   - **#91** Reject-Reason-UI (window.prompt durch saubere UI-
     Komponente ersetzen) — S, nice
   - **#89** LLM-Tool-Use-Verhalten tunen (Tools werden ohne
     `toolChoice: 'required'` ignoriert) — M, should
3. **Strategie-Session vor 3.3** — Conversation- und Semantic-
   Memory. Pre-Implementation-Diskussion mit konkreten Festlegungen
   zu Auto-Summary-Schwelle, KV-Store-Lifecycle, facts.md-
   Schreibrechte, Embedding-Provider-Wahl für 3.4.
4. Optional: **#79 Persona-Tabelle droppen** (XS, nice) — kann
   beim nächsten Migrations-Anlass mit angehängt werden.

## Production-Stack — live, aktuell auf Tag-9-Stand

**Tag-10-Phase-3.2 ist lokal komplett verifiziert, aber noch nicht
deployed.** Production läuft weiter mit dem Tag-9-Konversations-
System aber ohne MCP-Foundation. Production-Skills-DB hat keine
Skills (Skills sind heute nur lokal in @markus' DB), MCP-Tabelle
existiert dort noch nicht.

- **`https://app.twin.harwayexperience.com`** — Web (Tag-9-Image
  unverändert)
- **`https://runtime.twin.harwayexperience.com`** — Runtime
  (Tag-8-Image mit #77-Auto-Migration plus #78 twin:reload-CLI)
- **`https://bridge.twin.harwayexperience.com`** — Bridge (vom
  3. Mai, unverändert)

Alle drei mit `restart: unless-stopped`, HTTPS via Let's Encrypt,
Traefik-Routing.

**Persona-Stand auf Production (nach Tag-8-Sync):**
- @markus: 6991 chars (volle Persona aus docs/persona.md, Workshop-
  Block raus dank #74)
- @florian: 575 chars (volle Persona aus docs/persona-florian.md)
- @heiko: 344 chars (Stub aus Onboarding-Wizard, keine docs/-Source)

## Lokal
`/Users/mjb/Visual Studio/twin-lab` — drei Twins (@markus, @florian,
@heiko), lokale Bridge auf 5100. Markus-Twin hat Pilot-Skill
`harway-workshops` aktiv plus 26 MCP-Tools (zwei everything-Server,
einer ohne und einer mit Approval). Persona-DB-Spalte ist nach
Tag-8-Sync identisch zu `docs/persona.md`.

**Konversations-System aktiv (seit Tag 9):** `conversations`-Tabelle
mit Test-Konversationen aus Smoke-Tests, `audit.conversation_id`
gefüllt für `owner-direct`-Audits seit Migration 009. Pre-Migration-
Bestand wurde via Migration 010 entfernt.

**MCP-System aktiv (seit Tag 10):** `mcp_servers`-Tabelle mit zwei
Pilot-Server-Einträgen, `skills`-Tabelle erweitert um
`mcp_server_id`/`mcp_tool_name` (Migration 012). Plus Tag-10-Test-
Audits in der `audit`-Tabelle (mcp-tool-use mit pending/executed/
rejected-Status).

## Drei User auf Production
- Owner: @markus (markus.baier@harway.de)
- Owner: @florian (florian.ristig@harway.de)
- Owner: @heiko (heiko.gregor@harway.de)

Alle drei mit anthropic/claude-opus-4-7, Production-Bridge.

## Repo
github.com/markusbaier/twin-lab — `origin/main` lokal aktuell auf
`bce54fb` (Tag 10 Mittag, acht Commits aus Phase 3.2 plus
BACKLOG-Update: `2bf1ee0` Schema+Repo, `daa03b7` Client+Lifecycle,
`cd5b295` Tool-Discovery+Skill-Sync, `366ca93` Tool-Execution,
`5f0f80c` BACKLOG-Update für #86-#89, `43258cf` CLI, `b58df94`
Approval-Workflow, `bce54fb` Inline-Approval-UI).

Production-VPS hängt weiter auf `5ee5352` (Tag-8-Stand) — siehe
Hinweis im Production-Stack-Block oben.

VPS-Override-File `/docker/twin-lab-web/docker-compose.override.yml`
für #81-docs-Volume-Mount lebt nur auf VPS, nicht im Repo.
