# twin-lab — Stand

**Letztes Update:** 17. Mai 2026, Vormittag (Tag 18)

## Aktuell in Arbeit

**Pre-Launch-Phase A gestartet (Tag 18, 17. Mai 2026).** Ziel:
Self-Hosting-Launch in 6 Wochen (Ende Juni / Anfang Juli 2026).
Strategy-Doc: `docs/PRE-LAUNCH-A-STRATEGY.md`.

Build-Pfad (Hybrid-Sequenz aus dem Strategy-Pivot):
1. UX-Welle 1 Tranche A abschließen (#95 Tool-Names human-readable)
2. Vision-kritisch vorgezogen: #100 Memory-Hit, #101 Twin-Reife
3. Restliche Welle-1-Items (#86, #87, #98, #99)
4. Architektur-Follow-ups (#105, #106)
5. Schmaler Computer-Use-Recherche-Workflow (Block 3, #107/#108)
6. Self-Hosting-Polish (Block 4, #109/#110/#111)
7. Launch-Vorbereitung (Block 5, #112/#113/#114/#115)

**Phase 3.6 (Computer-Use-Agent-Pattern) verschoben auf
Pre-Launch-Phase B** oder später. Schmaler Recherche-Workflow
bleibt als Hook-Feature in Phase A (Beta-deklariert).

Differenzierungs-Story für Launch: **Memory-Tiefe + Persona +
A2A-Bridge**. Nicht Computer-Use.

**UX-Welle 1 ist jetzt Block 1 von Pre-Launch-Phase A.** Welle-1-
Inhalte (11 Items in drei Tranchen) unverändert, nur Build-Pfad
leicht angepasst (#100/#101 vorgezogen, weil Vision-kritisch für
die Differenzierungs-Story).

## Heute (Tag 17) abgeschlossen

### Vormittag — Diagnose-Wende #89 (~3h)

**Spike `3.5.E.0`** (Branch `spike/89-tool-autonomy`, Commit
`0d6cfd7`): drei LLM-Hypothesen via Standalone-Skripten getestet
(identisches Tool-Schema, identische TOOL_USE_DIRECTIVE, nur die
LLM-Send-Config variiert, kein MCP-Roundtrip):

- **H1** (Anthropic tool-shy): widerlegt — gpt-4o zeigt identisches
  Symptom in step[0]
- **H2** (AI SDK v6 Tool-Schema): widerlegt — Raw Anthropic API
  zeigt identisches Symptom
- **H3** (Extended Thinking fehlt): widerlegt — adaptive Thinking
  ändert nichts; nebenbei Befund #93: Opus 4.7 hat `enabled` deprecated

**Echte Wurzel: Step-Walk-Bug in `twin-service.ts`.**
`detectPendingToolCall` und Audit-Builder lasen `result.toolCalls`
top-level. In AI SDK 6 ist top-level der LETZTE Step — Tool-Calls
aus früheren Steps liegen in `result.steps[i].toolCalls`.
Marker-Pattern aus 3.2.F wurde dadurch unerkannt durchgereicht,
AI SDK synthetisierte plausiblen Antwort-Text aus dem Marker-Result,
User sah „Halluzination".

Tag-16-Designprinzip („Tool-Aufruf nur als Fallback") bleibt
gültig — wurde aber aus falscher Diagnose abgeleitet (neue Lesson
in BACKLOG.md).

Sub-Schritte:
- **3.5.E.A** (`4be99b3`) — Diagnose-Wende dokumentiert:
  3.5-STRATEGY-Patch, BACKLOG #89 Tag-17-Update, neue Lesson über
  zwei Wurzeln von „Halluzination", neues Item #93 (Thinking-
  Aktivierung-Form).
- **3.5.E.B** (`d0954a6`) — Step-Walk-Patch in `twin-service.ts`:
  `collectAllToolCalls` / `collectAllToolResults`-Helper (mit
  defensiv-Fallback auf top-level), step-walking
  `detectPendingToolCall` + Audit-Builder, plus
  `stopOnPendingApprovalMarker` als StopCondition<ToolSet>
  (OR-Kombi mit `stepCountIs` — Defense-in-Depth, bricht Multi-Step
  bei Marker im Last-Step ab).

### Mittag — Lokal-Re-Smoke + Regression-Guard (~1h)

**3.5.E.C** Re-Smoke lokal, alle drei Tests grün:
- Test 1 (autonom): Twin macht `scrape_webpage`-Call ohne Tool-
  Trigger im Prompt, Pending-Box im Chat, nach Approve substantielle
  Zusammenfassung.
- Test 2 (forced): Direct-Invocation-Pfad unangetastet.
- Test 3 (smalltalk): kein Tool-Call, normale Antwort.

**3.5.E.D** (`1e57aec`) Regression-Guard:
`apps/runtime/src/scripts/test-regression-89-step-walk.ts` mit vier
Test-Cases (Multi-Step + Marker, Negativ, Single-Step-Fallback,
Non-Marker False-Positive). Mutation-Test beim Patch-Bau ausgeführt:
Helper temporär auf top-level zurückbauen → TEST 1 + TEST 4 rot
mit 4 Issues (Exit 2), TEST 3 grün (top-level ist dort gewünscht).
Helper restored, alle grün. Registriert als
`pnpm --filter @twin-lab/runtime test-regression-89-step-walk`.

### Nachmittag — Production-Deploy (~1.5h)

**3.5.E.E** Production-Deploy auf VPS `srv1046432`:
- Repo-Pull → HEAD `1e57aec`.
- Image-Rebuild Runtime + Web (~110s mit Layer-Cache).
- Container-Recreate, Boot sauber: 19 Migrations skipped, 3 Twins
  boot, Bridge-Connections live.
- Image-Patch-Verifikation: `grep collectAllToolCalls` +
  `stopOnPendingApprovalMarker` im gebauten `dist/twin-service.js`
  je 3 Treffer.
- Mount-Verifikation via `docker inspect` (nicht `compose config` —
  Tag-11/#92-Lesson): alle 4 Mounts bestätigt.
- Hyperbrowser-MCP für Production-@markus registriert via verdecktem
  Prompt (Lesson 3.5.A — Markus selbst, kein Agent-Touch). Server-ID
  `mcp_QjIi2cpQktSo8mBj`, 10 Tools, env encrypted.
- Production-Smoke alle drei Tests grün, identisches Verhalten
  zu lokal.

Plus kleiner Stolperstein dokumentiert in neuer Lesson: das Deploy-
Briefing nahm `docker compose build` an, Twin-Lab-Compose ist aber
image-tag-only — Build muss direkt via `docker build`. Quick-Win:
DEPLOYMENT.md Section 3 (First-Time-Setup) hat jetzt den Build-Block
explizit, nicht nur als README-Verweis.

### Abend — Closure (3.5.E.F)

Diese STAND-Aktualisierung, BACKLOG #89 closed mit Closure-Notiz,
Spike-Findings-Doc auf main cherry-picked, Spike-Branch lokal
gelöscht.

## Tag-16-Sequenz (zur Erinnerung, unverändert)

### Vormittag — Self-Hosting-Doku #102 (~2h)

**DEPLOYMENT.md + docker-compose.override.yml.example** (Commit
`d13da41`). Self-Hosting-Doku als Skelett-Variante mit drei voll-
ausgebauten Sektionen aus Tag-15-Lessons:

1. **Pre-Deploy-Anforderungen** — inkl. expliziter glibc-Anforderung
   (sqlite-vec liefert nur glibc-Builds, musl-Distros wie Alpine
   nicht supported)
2. **Volume-Konfiguration** — DB-Volume, docs/mcp-servers bind-mounts,
   Modell-Cache-Volume für Phase 3.4 Episodic-Memory
3. **Troubleshooting** — vec0.so.so-Pattern erklärt (SQLite-Auto-
   Fallback bei dlopen-Fail, nicht Pfad-Problem), plus Modell-
   Cache-Persistenz-Issue und `docker compose config` vs `inspect`

Fünf weitere Sektionen als Skelett mit TODO-Markern. Companion-File
`docker/twin-lab-web/docker-compose.override.yml.example` dokumentiert
das Production-Override-Pattern.

Backlog #102 closed.

### Mittag — Strategie-Session Phase 3.5 (~1h)

**3.5-Strategy-Doc** (Commit `80d77fa`) analog zum 3.4-STRATEGY-
Pattern. Fünf Architektur-Entscheidungen:

1. **Scope:** Foundation only — Hyperbrowser-MCP einbinden, Tools
   direkt nutzbar, keine Custom-Wrapping-Logik
2. **API-Key:** Per-Twin verschlüsselt via `"?"`-Pattern (analog
   `mcp-servers/README.md`)
3. **Hosting:** Lokal in `mcp-servers/`, NPM-Package via npx
4. **Twin-Scope:** Nur @markus initial
5. **Approval:** Server-weit ON (`defaultRequiresApproval: true`)

Plus Sub-Schritt-Plan 3.5.A-D, Use-Cases, Verweise auf Backlog #27.

**OpenClaw-Reflexion in der Strategie-Session:** Markus' Vision-
Nordstern ist der OpenClaw-WoW-Effekt (Peter Steinberger's persönlicher
Agent). Ehrlich eingeordnet: OpenClaw-Vibe entsteht durch Kombination
aus Multi-Channel + Proaktivität + Computer-Use + Self-extending
Skills. Twin-Lab hat alle Patterns in Roadmap/Backlog. Phase 3.5/3.6
ist Foundation für *einen* Pattern. WoW-Moment kommt vermutlich in
Phase 4-Mitte, wenn mehrere Patterns gleichzeitig sichtbar sind.

### Nachmittag — 3.5.A Spec-Datei + Key-Cleanup-Drama (~1.5h)

**3.5.A — Hyperbrowser-Spec** (Commit `c442c71`)
- `mcp-servers/hyperbrowser-approval.json` mit `"?"`-Pattern
- 10 Tools synchronisiert nach `pnpm twin:mcp-add @markus ...`
- Server-ID `mcp_5gdVaHNu2CA4RvLF` für `twin_YuB4Qaqmbrimv1Mz`
- Approval-Default required, env verschlüsselt in DB

**Key-Cleanup-Sequenz (Lesson):** Beim ersten `mcp-add`-Run (via
Claude Code im Briefing-Workflow) ist der API-Key in die JSON-Datei
geleakt — Claude Code hat ihn dort eingefügt statt nur im verdeckten
Prompt einzugeben. Cleanup-Sequenz:

1. Key in Hyperbrowser-UI rotiert (alter Key revoked)
2. JSON-File auf `"?"` zurückgesetzt
3. `mcp-remove @markus hyperbrowser-approval` (Cascade-Delete der
   10 Skills bestätigt)
4. `mcp-add` neu — diesmal Markus selbst via Terminal (nicht via
   Claude Code), neuer Key beim verdeckten Prompt eingegeben

Sauberer Stand wiederhergestellt, neue Server-ID
`mcp_5gdVaHNu2CA4RvLF` (Re-Insert).

**Lesson für künftige Secrets-Workflows:** Bei Briefings für Claude
Code mit Secrets explizit Optionen ausschließen statt nur "nicht
ausgeben" zu sagen. Pattern: "Markus führt CLI-Schritte mit Secrets
selbst aus, du verifizierst nur vorher und nachher. Du fragst nie
nach dem Key."

### Nachmittag — 3.5.B Smoke mit substantiellem Befund (~30 Min)

**Bayreuth-Pattern reproduziert sich, diesmal mit Hyperbrowser-Tools.**

Zwei Smoke-Pfade verglichen, identische Query, unterschiedliche
Verpackung:

**Pfad 1 — Natural-Language ohne Tool-Anweisung:**

> "Schau dir die Anthropic-Homepage an (https://www.anthropic.com)
> und fass die wichtigsten drei Sätze zusammen."

**Twin-Antwort:** "Der Scrape-Call liegt in der Approval-Queue —
sobald freigegeben, ziehe ich den Inhalt und liefere die drei Sätze.
Vorher rate ich nicht."

**Runtime-Logs zeigen:** `[mcp:tools] passing 36 tool(s) to LLM`
— Tools wurden dem LLM angeboten. Aber: kein `[mcp:call]`-Event,
keine Pending-Approval-Queue.

**Heißt:** Twin halluziniert eine plausible Antwort über eine
angeblich-existierende Approval-Queue, ohne dass jemals ein Tool-Call
gemacht wurde. **Identisches Pattern wie #89 aus Tag 10/11** — nicht
auf `everything`-Tools beschränkt, reproduziert sich auch mit
echten Hyperbrowser-Tools.

**Pfad 2 — Explizite Tool-Anweisung:**

> `[Tool-Aufruf] mcp_hyperbrowser-approval_scrape_webpage mit Args`
> `{"url":"https://www.anthropic.com","outputFormat":["markdown"]}`

**Twin-Antwort:** "Ich möchte das Tool 'scrape_webpage' mit Argumenten
{...} nutzen, brauche aber deine Genehmigung. Bitte schau in der
Inbox."

→ Pending in Inbox → manuelle Approval → Hyperbrowser-Cloud-Browser
scraped Anthropic-Homepage → 3-5 KB Markdown zurück → Twin
synthetisiert substantielle Zusammenfassung mit eigener Beobachtung
("Anthropic spielt die Safety-Karte konsequent als Teil der Marke...")
plus zwei Follow-up-Angeboten.

**Funktional verifiziert end-to-end** für Direct-Invocation- und
explizit-getriggerten Pfad. Hyperbrowser-MCP technisch sauber,
Approval-Pipeline funktional, Output-Qualität gut.

### Designprinzip-Setzung Markus

> **"Tool-Aufruf darf nur Fallback sein, Tools müssen direkt in der
> Konversation automatisch aufgerufen werden."**

Heißt: Tool-Picker-UI mit Direct-Invocation-Formular (Phase 3.2.H)
ist strukturelle Workaround-Lösung für #89, aber nicht das Vision-
Ziel. Twin soll Tools autonom nutzen, ohne dass User explizit
`[Tool-Aufruf] ...` schreiben oder das Picker-Formular ausfüllen muss.

Plus Vision-Implikation: für Phase 3.6 Computer-Use-Agent ist
autonomer Tool-Use fundamental. Twin muss mehrere Browser-Actions
in Sequenz ausführen — geht nicht ohne `toolChoice: 'auto'` zu
lösen.

### Konsequenzen für Phase 3.5

**#89 von "should" auf "must" hochgestuft.** Das Item ist jetzt
Phase-3.5-Blocker, nicht mehr "nice-to-have-fix". Backlog-Eintrag
um Tag-16-Befund erweitert mit:
- Hyperbrowser-Smoke-Reproduktion
- Markus' Designprinzip-Setzung
- Vier Fix-Pfade als Vorbereitung für Tag-17-Strategie-Session

**3.5.C Production-Deploy auf später verschoben.** Foundation in
Production deployen, die nur halb-funktional ist (Tool-Picker ja,
autonomer Pfad nein), wäre vor dem Vision-Ziel inkonsistent.

**Phase 3 DoD bleibt bei 4 von 5.** 3.5 nicht "open wegen fehlendem
Bau", sondern "blocked durch LLM-Verhaltens-Problem".

## Tag-15-Sequenz (zur Erinnerung, unverändert)

**Vormittag:** Pre-Deploy-Patch 3.4.J.1 (Modell-Cache-ENV, `4ade195`)
plus VPS-Vorbereitung. Initial-Deploy scheiterte mit vec0.so.so-Bug.

**Vormittag/Mittag:** Diagnose-Marathon (1.5h) — musl/glibc-
Inkompatibilität bei sqlite-vec via `ldd` verifiziert.

**Mittag:** Base-Image-Wechsel Alpine → Debian-Slim (`706977b`),
Re-Deploy erfolgreich, 7 Konversationen embedded in 10.9s, Bayreuth-
Re-Test gegen Production: keine Halluzination, Vision-Pattern aktiv.
Phase 3.4 in Production live.

**Nachmittag:** STAND/Backlog-Update (`238872e`), plus drei neue
Backlog-Items (#102 DEPLOYMENT.md, #103 Pre-Check-Container, #104
sqlite3-CLI).

## Tag-14-Sequenz (zur Erinnerung, unverändert)

**Vormittag:** Bau-Sprint 3.4.E (`44ab971`) + 3.4.F (`745d660`) +
3.4.G (`e912130`). Plus 3.4.H Smoke-Doc.

**Mittag:** 23 Bestandsdaten-Konvs lokal embedded.

**Nachmittag:** Phase 3.1 Browser-Smoke → Bayreuth-Halluzinations-
Befund. Reaktive Strategie-Session + 3.4.I-Bau (`e3a8ea1`). Plus #101.

**Abend:** STAND-Update Tag 14 Abend (`13c9056`).

## Phase 3 Status

- 3.1 ✅ **Skill-System Engine + Pilot** (Tag 7)
- 3.2 ✅ **MCP-Client als Skill-Provider plus UI-Tool-Picker**
  (Tag 10/11)
- 3.3 ✅ **Memory: Conversation + Semantic** (Tag 12 lokal,
  Tag 13 Vormittag in Production)
- 3.4 ✅ **Memory: Episodic** (Tag 13/14 lokal komplett, Tag 15
  in Production)
- 3.5 ✅ **Hyperbrowser-Foundation** (Tag 16 lokal, Tag 17
  Production — inkl. #89-Step-Walk-Patch als Wurzel-Fix)
- 3.6 **verschoben auf Pre-Launch-Phase B** (Strategy-Pivot
  Tag 18 Vormittag, siehe `docs/PRE-LAUNCH-A-STRATEGY.md`).
  Schmaler Recherche-Workflow bleibt als Hook-Feature in
  Phase A.

**Phase 3 Definition of Done — 5 von 5 Häkchen.** ✅

## Was als nächstes ansteht

**Pre-Launch-Phase A Block 1 — UX-Welle 1 vollständig (~20–25 Tage)**

Aktive Items in Bau-Reihenfolge:
1. **#95 Tool-Names human-readable** (S, jetzt) — Tranche A
   abschließen
2. **#100 Memory-Hit-Indikator** (S, vorgezogen) — Vision-kritisch
3. **#101 Twin-Reife-Anzeige** (L, vorgezogen, Strategy-Session
   vorab) — Vision-kritisch
4. **#98 Cost-Preview vor Approve** (M)
5. **#99 Audit-Trail menschlich** (M) — Vision Vererbung
6. **#86 Skill-Editor-UI** (L)
7. **#87 MCP-Configurator-UI** (L)

Danach (alle aus `docs/PRE-LAUNCH-A-STRATEGY.md`):
- **Block 2 Architektur-Follow-ups:** #105 A2A-Modal, #106
  DirectChat-View
- **Block 3 Computer-Use-Hook:** #107 Recherche-Workflow-Skill,
  #108 Beta-Deklaration
- **Block 4 Self-Hosting-Polish:** #109 DEPLOYMENT-Test, #110
  Onboarding-Wizard, #111 Public-Repo-Hygiene
- **Block 5 Launch-Vorbereitung:** #112 Landing, #113 Demo, #114
  Launch-Posts, #115 Timing-Plan

Total 37–50 Tage Pflicht bei 42 Tagen verfügbar — knapp, aber
machbar bei strikter Scope-Disziplin.

Weiterhin im Backlog (nicht zeit-kritisch, **nicht** Teil von
Pre-Launch-Phase A):
- **#90 Resume-Prompt-Tuning** (M, should) — vermutlich nicht
  mehr akut, weil #89 strukturell gelöst ist
- **#93 Thinking-Aktivierung-Form für Opus 4.7** (XS, nice) —
  aus Spike 3.5.E.0 mitgebracht
- **#101 FTS5-AND-Befund** evaluieren, wenn Real-Data zeigt, dass
  Pronominal-Queries Pain Point werden
- **#103 Pre-Check im production-äquivalenten Container** (S, should)
- **#104 sqlite3-CLI im Runtime-Image** (XS, nice)
- **#79 Persona-Tabelle droppen** (XS, nice)

## Production-Stack — Tag-17-Stand auf VPS

**Phase 3.5 in Production LIVE** (deployed Tag 17 Nachmittag).
Vorher: Phase 3.4 seit Tag 15 live, unverändert übernommen.

Production-VPS auf Commit `1e57aec`.

- **`https://app.twin.harwayexperience.com`** — Web
- **`https://runtime.twin.harwayexperience.com`** — Runtime
- **`https://bridge.twin.harwayexperience.com`** — Bridge

**Stack-Stand:**
- Base-Image: `node:20-slim` (Debian, glibc) seit Tag 15
- Images: Runtime `d5dd62255959`, Web `a385778ff370` (Tag-17-Rebuild)
- Image-Größen unverändert: Runtime ~854 MB, Web ~427 MB
- Volumes: drei bind-mounts + ein Named Volume (unverändert)
- ENVs in override.yml: `TWIN_LAB_MODEL_CACHE_DIR` (unverändert)

**Production-Twin @markus** (`twin_jgqzOIkzdTsTx6vv`):
- Drei initial approved Facts + sieben Pending-Facts (unverändert)
- Pilot-Skill `harway-workshops` (unverändert)
- 7 embedded Konversationen in Episodic-Memory (unverändert)
- **MCP-Server jetzt drei** (Tag 17 Nachmittag dazu):
  - `everything` (13 Tools)
  - `everything-approval` (13 Tools)
  - `hyperbrowser-approval` (`mcp_QjIi2cpQktSo8mBj`, 10 Tools,
    env encrypted, approval required)
  - **insgesamt 36 MCP-Tools**

**VPS-Override-File** (unverändert seit Tag 15):
- `/docker/twin-lab-web/repo/docs:/app/docs:ro` (#81)
- `/docker/twin-lab-web/repo/mcp-servers:/app/mcp-servers:ro` (#92)
- `/docker/twin-lab-web/model-cache:/app/data/model-cache` (Tag 15)
- `TWIN_LAB_MODEL_CACHE_DIR=/app/data/model-cache`

## Lokal
`/Users/mjb/Visual Studio/twin-lab` — drei Twins, lokale Bridge
auf 5100.

**Hyperbrowser-MCP aktiv (lokal seit Tag 16, in Production seit Tag 17):**
- Spec-Datei `mcp-servers/hyperbrowser-approval.json`
- Lokal: Server-ID `mcp_5gdVaHNu2CA4RvLF` für `twin_YuB4Qaqmbrimv1Mz`
- Production: Server-ID `mcp_QjIi2cpQktSo8mBj` für `twin_jgqzOIkzdTsTx6vv`
- 10 Tools synchronisiert (scrape, crawl, extract, search,
  browser_use_agent, openai_computer_use_agent,
  claude_computer_use_agent, create_profile, delete_profile, plus
  eins mehr als ursprünglich erwartet — vermutlich Server-Update)
- Approval-Default required, env verschlüsselt (AES-256-GCM)
- API-Key: rotiert nach Cleanup-Drama (Tag 16), nur in DB encrypted
- **Autonomer Pfad jetzt funktional** dank Step-Walk-Patch (`d0954a6`)

**Episodic-Memory-System aktiv (unverändert seit Tag 14):**
- vec0 + FTS5 + Hybrid-Search
- 24+ Memory-Einträge in der DB plus Tag-16-Konvs (Bayreuth-
  Tests, Scrape-Test, Hyperbrowser-Smoke)

**Markus-Twin lokal:**
- Pilot-Skill `harway-workshops`
- Drei MCP-Server: hyperbrowser-approval + everything + everything-
  approval (insgesamt 36 Tools)
- 8 Facts plus Pending-Facts

## Drei User auf Production
- Owner: @markus (markus.baier@harway.de)
- Owner: @florian (florian.ristig@harway.de)
- Owner: @heiko (heiko.gregor@harway.de)

Alle drei mit anthropic/claude-opus-4-7.

## Repo
github.com/markusbaier/twin-lab — `origin/main` auf `1e57aec`
(Tag 17 Nachmittag, 3.5.E.D Regression-Guard). Production-VPS auf
`1e57aec` (synchron seit 3.5.E.E-Deploy heute Nachmittag).

**Tag-17-Commits (alle gepushed, alle in Production):**
- `0d6cfd7` (Branch `spike/89-tool-autonomy`) spike(89): Diagnose
  3.5.E.0 — alle 3 LLM-Hypothesen widerlegt
- `4be99b3` docs(3.5.E.A): Diagnose-Wende #89 — Step-Walk-Bug
- `d0954a6` fix(3.5.E.B): Step-Walk-Patch für Marker-Detection +
  Audit-Builder (Wurzel-Fix #89)
- `1e57aec` test(3.5.E.D): Regression-Guard mit Mutation-Test-
  verifiziertem Step-Walk-Schutz
- (kommt: 3.5.E.F Closure — diese STAND-Updates + BACKLOG #89
  closure + Findings-Cherry-Pick + Spike-Branch-Cleanup)

**Tag-16-Commits (alle gepushed, alle in Production seit Tag 17):**
- `d13da41` docs: DEPLOYMENT.md + docker-compose.override.yml.example
  (Backlog #102)
- `80d77fa` docs(3.5): Strategy-Doc für Hyperbrowser MCP-Integration
  (Foundation)
- `c442c71` feat(3.5.A): Hyperbrowser-MCP-Spec für @markus

**Tag-15-Commits:**
- `4ade195` feat(runtime): Modell-Cache-Pfad via
  TWIN_LAB_MODEL_CACHE_DIR konfigurierbar
- `706977b` fix(deploy): Runtime-Image von Alpine auf Debian-Slim
- `238872e` docs(3.4): Phase 3.4 in Production LIVE — Tag 15

**Tag-14-Commits:** siehe vorige Stand-Einträge

**Tag-13-Commits:** siehe vorige Stand-Einträge

**Tag-12-Commits:**
- `9b4d5c5` 3.3.A bis `a3c868b` 3.3.G3 (9 Code-Commits)
- `189acbc` Doku Tag 12
