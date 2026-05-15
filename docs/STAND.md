# twin-lab — Stand

**Letztes Update:** 15. Mai 2026, Abend (Tag 16)

## Aktuell in Arbeit
**Phase 3.5 Hyperbrowser-Foundation lokal komplett — aber Production-
Deploy blocked durch #89.** 3.5.A (Spec-Datei) committed, 3.5.B Smoke
zeigt: Direct-Invocation funktioniert end-to-end, aber autonomer Tool-
Use-Pfad halluziniert (identisches Pattern zu Backlog #89 aus Tag
10/11). Designprinzip-Setzung Markus: "Tool-Aufruf darf nur Fallback
sein, Tools müssen direkt in der Konversation automatisch aufgerufen
werden."

#89 wurde von "should" zu "must" hochgestuft, blockt 3.5.C
Production-Deploy. Tag-17+ wird eigene Strategie-Session für #89-Fix.

**Phase 3 Definition of Done — bleibt bei 4 von 5 Häkchen.** 3.5 ist
nicht "open" wegen fehlendem Bau, sondern wegen LLM-Verhaltens-Problem.

## Heute (Tag 16) abgeschlossen

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
- 3.5 ⏸ **Hyperbrowser-Foundation** — 3.5.A lokal committed,
  3.5.B partial (Direct-Invocation ✓, autonom blocked durch #89),
  3.5.C blocked
- 3.6 offen — Computer-Use-Agent (substantielle Strategie-Session
  pending, blocked durch #89)

**Phase 3 Definition of Done — 4 von 5 Häkchen.** 3.5 ist nicht
abgeschlossen, weil autonomer Tool-Use-Pfad nicht funktioniert
(#89-Blocker).

## Was als nächstes ansteht

1. **Strategie-Session für #89-Fix** (S, primär — Tag 17 Vormittag)
   - Substantielle Architektur-Frage: wie macht man autonome
     Tool-Calls bei einem LLM-Provider, der sie nicht zuverlässig
     macht?
   - Vier Fix-Pfade durchdenken (siehe #89-Backlog-Eintrag)
   - Strategy-Doc analog 3.4-STRATEGY
2. **#89-Fix bauen** (M-L, abhängig von Strategie-Wahl)
3. **3.5.B Re-Smoke** nach Fix
4. **3.5.C Production-Deploy** nach erfolgreichem Re-Smoke
5. **3.5.D STAND-Update + Phase 3 DoD 5 von 5**
6. **Erst dann:** Phase 3.6 Strategie-Session (Computer-Use-Agent)

Weiterhin im Backlog (nicht zeit-kritisch):
- **#90 Resume-Prompt-Tuning** (M, should)
- **#91 Reject-Reason-UI** (S, nice)
- **#101 FTS5-AND-Befund** evaluieren wenn Real-Data zeigt dass
  Pronominal-Queries Pain Point werden
- **#103 Pre-Check im production-äquivalenten Container** (S, should)
- **#104 sqlite3-CLI im Runtime-Image** (XS, nice)
- **Toast-Framework statt alert()** (M, nice)
- **#79 Persona-Tabelle droppen** (XS, nice)

## Production-Stack — Tag-16-Stand auf VPS

**Phase 3.4 in Production LIVE** (deployed Tag 15 Mittag, unverändert).
**Phase 3.5 NICHT deployed** — Foundation lokal verifiziert,
Production-Deploy wartet auf #89-Fix.

Production-VPS auf Commit `706977b`.

- **`https://app.twin.harwayexperience.com`** — Web
- **`https://runtime.twin.harwayexperience.com`** — Runtime
- **`https://bridge.twin.harwayexperience.com`** — Bridge

**Stack-Stand:**
- Base-Image: `node:20-slim` (Debian, glibc) seit Tag 15
- Image-Größen: Runtime ~854 MB, Web ~427 MB
- Volumes: drei bind-mounts + ein Named Volume
- ENVs in override.yml: `TWIN_LAB_MODEL_CACHE_DIR`

**Production-Twin @markus:**
- Drei initial approved Facts + sieben Pending-Facts
- 26 MCP-Tools aktiv (everything + everything-approval)
- Pilot-Skill `harway-workshops`
- 7 embedded Konversationen in Episodic-Memory
- **NICHT in Production:** Hyperbrowser-Tools (deployed erst nach
  #89-Fix)

**VPS-Override-File** (unverändert seit Tag 15):
- `/docker/twin-lab-web/repo/docs:/app/docs:ro` (#81)
- `/docker/twin-lab-web/repo/mcp-servers:/app/mcp-servers:ro` (#92)
- `/docker/twin-lab-web/model-cache:/app/data/model-cache` (Tag 15)
- `TWIN_LAB_MODEL_CACHE_DIR=/app/data/model-cache`

## Lokal
`/Users/mjb/Visual Studio/twin-lab` — drei Twins, lokale Bridge
auf 5100.

**Hyperbrowser-MCP aktiv (lokal, seit Tag 16):**
- Spec-Datei `mcp-servers/hyperbrowser-approval.json`
- Server-ID `mcp_5gdVaHNu2CA4RvLF` für `twin_YuB4Qaqmbrimv1Mz`
- 10 Tools synchronisiert (scrape, crawl, extract, search,
  browser_use_agent, openai_computer_use_agent,
  claude_computer_use_agent, create_profile, delete_profile, plus
  eins mehr als ursprünglich erwartet — vermutlich Server-Update)
- Approval-Default required, env verschlüsselt (AES-256-GCM)
- API-Key: rotiert nach Cleanup-Drama, nur in DB encrypted

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
github.com/markusbaier/twin-lab — `origin/main` auf `c442c71`
(Tag 16 Nachmittag, 3.5.A Spec-Datei). Production-VPS auf `706977b`
(Tag 15 Base-Image-Wechsel). Tag-16-Code-Commits noch nicht in
Production deployed — das kommt mit Phase 3.5.C nach #89-Fix.

**Tag-16-Commits (alle gepushed):**
- `d13da41` docs: DEPLOYMENT.md + docker-compose.override.yml.example
  (Backlog #102)
- `80d77fa` docs(3.5): Strategy-Doc für Hyperbrowser MCP-Integration
  (Foundation)
- `c442c71` feat(3.5.A): Hyperbrowser-MCP-Spec für @markus
- (kommt: docs Tag 16 Abend — STAND + Backlog #89-Update +
  Strategy-Patch)

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
