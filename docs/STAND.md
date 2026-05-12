# twin-lab — Stand

**Letztes Update:** 12. Mai 2026, Nachmittag (Tag 13)

## Aktuell in Arbeit
**Strategie-Session vor Phase 3.4 (Memory: Episodic) abgeschlossen.**
Architektur-Entscheidungen festgehalten in `docs/3.4-STRATEGY.md`.
Bau-Start unmittelbar nach Doku-Commit: Sub-Schritt 3.4.A
(Schema + Repos).

**Phase 3 Definition of Done — 3 von 5 Häkchen.** Plus Phase 3.3
heute Morgen in Production deployed.

## Heute (Tag 13) abgeschlossen

### Vormittag — Production-Deploy Phase 3.3 (~60 Min)

Tag-12-Stand auf VPS deployed. Saubere Single-Phase-Deploy-Sequenz,
keine Komplikationen.

**Sequenz:**
1. VPS-Status geprüft: `5aef14b` (Tag 11 Mittag — 3.2.H + Direktive
   waren also doch bereits in Production, hatte gestern in Doku
   nicht klar dokumentiert)
2. Repo-Pull `5aef14b → 189acbc` (10 Commits Diff, 6406 insertions
   total)
3. Image-Rebuild Runtime (48.5s) + Web (83.1s)
4. Container-Recreate via `docker compose up -d`
5. Migrations 013-016 sauber angewendet (Auto-Bootstrap aus #77)
6. Container-Stabilität verifiziert: beide Up, kein Restart-Loop
7. Initial-Facts für Production-@markus via Container-CLI:
   - `node dist/scripts/facts-add.js @markus wife_name Anna`
   - `node dist/scripts/facts-add.js @markus company "Harway Experience"`
   - `node dist/scripts/facts-add.js @markus city Roding`

**Smoke-Test in Production verifiziert:**
- Facts-Page `/facts?twin=@markus` zeigt drei approved Facts
- Konversation `/chat/@markus`: Twin nutzt alle drei Facts in
  Persona-typischer Antwort ("Meine Frau ist Anna, ich wohne in
  Roding im Bayerischen Wald, und ich arbeite bei HARWAY
  Experience — der Agentur, die ich mit Florian Ristig führe.
  Sitz ist Hamburg, ich selbst arbeite remote aus Roding.")
- Substanziellere Maria/TechCorp-Konversation geführt mit
  beeindruckend pragmatischer Markus-typischer Twin-Antwort
- Reflektieren-Button: 7 Pending-Facts extrahiert. Sehr hohe
  Qualität (business_partner=Florian Ristig, company_headquarters=
  Hamburg, contact_email=info@harwayexperience.com, discovery_call_
  link=calendly.com/harwayexperience/discoverycall, expertise_
  areas=AI-Literacy/Vibe Coding/AI-native Delivery/Design Systems,
  region=Bayerischer Wald, work_mode=remote aus Roding)
- Inbox zeigt 7 SEMANTIC-FACT-WRITE-Audits mit substanziellen
  Reasoning-Texten

Plus Lessons aus Production-Deploy:
- Docker-Compose-Setup auf VPS hat keine `build:`-Section, nutzt
  vor-gebaute `:latest`-Images. Build erfolgt manuell via
  `docker build` im Repo-Root (sequenz aus
  `docker/twin-lab-web/README.md` im Repo)
- Production-Container hat keinen pnpm-Binary (Runner-Stage des
  Multi-Stage-Builds ist slim). CLI-Skripte direkt via `node
  dist/scripts/...` aufrufen, nicht via `pnpm twin:...`

### Mittag/Nachmittag — Vision-Session (~3h)

Strategie-Session über die langfristige Vision von twin-lab und
des Markus-Twins. Initiiert durch Markus' Morgenfrage:
*"Think about an autonomous agent with a persistent memory who is
dreaming during sleep like a human."*

Vier Blöcke durchgegangen:
1. **Wer soll der Twin sein** — Persona-Konzept, Range, A/B/C-
   Priorisierung
2. **Welche menschlichen Patterns sind essentiell** — acht Patterns
   gleichgewichtet, Reifungs-Konzept, Veröffentlichungs-Strategie
3. **Ethische Grenzen** — Identitäts-Transparenz, Ehrlichkeits-
   Prinzip, Interpretationen, Drittpersonen-Information
4. **Eigentum und Existenz** — Tod, Selbst-Veränderung, Drift,
   Eingriffs-Rechte, Selbst-Abgrenzung

**Kern-Setzung in einem Satz:**
> "Twin hat Markus' Substanz, bessere Disziplin als Markus an
> müden Tagen, und entwickelt sich über Zeit zu einem
> eigenständigen Wesen — mit klaren Reifungs-Stufen und unter
> ethischen Leitplanken."

**Vision-Pattern:** Du baust kein vorsichtiges Tool und kein
experimentelles Wesen mit unklaren Folgen. Du baust einen Twin
mit maximalem End-Zustand (eigenständig, autonom, mit eigener
Stimme), aber mit Stufen, Verantwortung, und eingebauten
Reifungs-Mechanismen. Ambition und Verantwortung gleichzeitig.

Ergebnis: `docs/TWIN-VISION.md` (275 Zeilen). Commit `6bc9a05`.

**Bonus-Output:** Pitch-Deck `twin-lab-pitch.html` als
self-contained HTML-Datei (10 Slides, Terminal-Aesthetik mit warmen
Akzenten, deutsch).

### Nachmittag — Strategie-Session vor Phase 3.4 (~45 Min)

Fünf Architektur-Fragen für Episodic-Memory geklärt:

1. **Embedding-Provider** — Swappable Interface mit drei
   Implementierungen (Local, OpenAI, Voyage), ENV-konfigurierbar.
   Default lokal mit `Xenova/multilingual-e5-large` für deutsche
   Inhalte. Begründung: Self-Hosting-Use-Cases (besonders
   Enterprise) müssen ohne externe APIs funktionieren.
2. **Granularität** — Primary pro Summary-Segment, plus pro
   abgeschlossene Konversation falls keine Segments. Direkte
   Anknüpfung an 3.3.B Output.
3. **Retrieval** — Always-On Top-K=3 mit Similarity-Threshold 0.7.
   Sechste Schicht im System-Prompt zwischen Summaries und
   Live-Window.
4. **Update** — Synchron beim Schreiben. Boolean-Flag
   `embedding_status` auf Quell-Tabellen für Failure-Handling.
5. **Vision-Connection** — Extended Foundation. Datenschicht-
   Erweiterungen für alle fünf abhängigen Patterns (Zeit-Erleben,
   Aufmerksamkeit, Selbst-Reflexion, Lebens-Narrativ, Schlaf/
   Träume). Pattern-Logic kommt in eigenen späteren Phasen.

Ergebnis: `docs/3.4-STRATEGY.md`. Acht Sub-Schritte geplant
(3.4.A bis 3.4.H), geschätzter Aufwand 1.5-2 Sessions.

## Tag 12 abgeschlossen (gestern, zur Erinnerung)

Phase 3.3 Memory: Conversation + Semantic — komplett. Neun Code-
Commits plus Doku-Commit:
- `9b4d5c5` 3.3.A Schema + Repos
- `9fc1ebb` 3.3.B Summary-Engine im Send-Path
- `0eb941e` 3.3.C History-Loader liest Summaries
- `49fe0b7` 3.3.D Facts-API + CLI
- `1a8a128` 3.3.E Facts in Twin-Prompt
- `f1cfa65` 3.3.F Twin-Fact-Extraction mit Approval-Gate
- `bf7b6d5` 3.3.G1 Inbox-Render für semantic-fact-write
- `fc3f6b3` 3.3.G2 Facts-Settings-View
- `a3c868b` 3.3.G3 Manual-Extract-Button + Reset-Confirm-Dialog
- `189acbc` Doku Tag 12

## Phase 3 Status

- 3.1 ✅ **Skill-System Engine + Pilot** (Tag 7)
- 3.2 ✅ **MCP-Client als Skill-Provider plus UI-Tool-Picker**
  (Tag 10/11)
- 3.3 ✅ **Memory: Conversation + Semantic** (Tag 12 lokal,
  Tag 13 in Production)
- 3.4 ⏳ **Memory: Episodic — Strategie abgeschlossen,
  Bau-Phase startet**
- 3.5 offen — Hyperbrowser als MCP-Skill
- 3.6 offen — Procedural Memory (ggf. Phase 4)

**Phase 3 Definition of Done — 3 von 5 Häkchen gesetzt**
(3.1, 3.2, 3.3). Phase 3.4 ist nicht nur eine weitere Memory-
Schicht, sondern das technische Fundament für fünf der acht
menschlichen Patterns aus TWIN-VISION (Zeit-Erleben, Schlaf/
Träume, Aufmerksamkeit/Fokus, Lebens-Narrativ, Selbst-Reflexion).

## Was als nächstes ansteht

1. **Bau-Phase 3.4 starten** — Sub-Schritt 3.4.A (Schema + Repos)
   nach Doku-Commit. Acht Sub-Schritte insgesamt geplant
   (siehe `docs/3.4-STRATEGY.md`)
2. **Phase 3.4 in Production deployen** — nach Abschluss aller
   Sub-Schritte und Smoke-Tests
3. **Strategie-Session vor 3.5 (Hyperbrowser)** — kleinere Session,
   weil 3.5 auf etablierter MCP-Foundation aufbaut
4. **Pattern-Phasen nach 3.4** — die fünf abhängigen Patterns
   können relativ schnell folgen, weil Datenschicht aus 3.4
   bereits vorbereitet ist. Reihenfolge offen, abhängig von
   Roadmap-Priorisierung

Optional weiterhin im Backlog:
- **#90 Resume-Prompt-Tuning** (M, should)
- **#91 Reject-Reason-UI** (S, nice) — ModalWrapper aus 3.3.G3
  verfügbar
- **Toast-Framework statt alert()** (M, nice)
- **#79 Persona-Tabelle droppen** (XS, nice)

## Production-Stack — Tag-12-Stand auf VPS

**Phase 3.3 in Production aktiv** (deployed Tag 13 Vormittag).
Production-VPS auf Commit `189acbc`.

- **`https://app.twin.harwayexperience.com`** — Web
- **`https://runtime.twin.harwayexperience.com`** — Runtime
- **`https://bridge.twin.harwayexperience.com`** — Bridge (vom
  3. Mai, unverändert)

Alle drei mit `restart: unless-stopped`, HTTPS via Let's Encrypt,
Traefik-Routing.

**Persona-Stand auf Production:**
- @markus: 6991 chars
- @florian: 575 chars
- @heiko: 344 chars (Stub)

**Production-Twin @markus hat:**
- Drei initial approved Facts (city=Roding, company=Harway
  Experience, wife_name=Anna)
- Sieben Pending-Facts aus Tag-13-Smoke-Test (zu approven
  oder pflegen)
- 26 MCP-Tools aktiv (zwei everything-Server)
- Pilot-Skill `harway-workshops`

**VPS-Override-File** `/docker/twin-lab-web/docker-compose.override.yml`
hat zwei bind-mounts (lebt nur auf VPS, nicht im Repo):
- `/docker/twin-lab-web/repo/docs:/app/docs:ro` (#81 vom Tag 8)
- `/docker/twin-lab-web/repo/mcp-servers:/app/mcp-servers:ro` (#92
  vom Tag 11)

## Lokal
`/Users/mjb/Visual Studio/twin-lab` — drei Twins (@markus,
@florian, @heiko), lokale Bridge auf 5100. Markus-Twin hat:
- Pilot-Skill `harway-workshops` aktiv
- 26 MCP-Tools
- Acht Facts (4 user + 4 approved twin-extracted)
- Plus zwei Pending-Facts aus Tag-12 (company_headquarters
  Hamburg, contact_bayreuth Marc — können nächste Session
  approved werden)

**Konversations-System aktiv (seit Tag 9):** `conversations`-
Tabelle, `audit.conversation_id` gefüllt seit Migration 009.

**MCP-System aktiv (seit Tag 10):** `mcp_servers`-Tabelle,
`skills`-Tabelle erweitert um `mcp_server_id`/`mcp_tool_name`.

**Tool-Picker-UI aktiv (seit Tag 11 Mittag):** ToolPicker-
Komponente im Chat, GET `/twins/:handle/tools`-Endpoint, Multi-
Step-Followup im Twin-Service.

**Memory-System aktiv (seit Tag 12):**
- `conversation_summaries`-Tabelle, ConversationSummariesRepo,
  Auto-Summary bei >50 zählenden Messages
- `facts`-Tabelle, FactsRepo, Facts im System-Prompt als 2. Schicht
- Twin-Extraction via POST /facts/extract plus CLI twin:facts-extract
- Facts-UI unter /facts mit CRUD + Approval-Workflow
- Manual-Extract-Button + Reset-Confirm-Modal im Chat (3.3.G3)

## Drei User auf Production
- Owner: @markus (markus.baier@harway.de)
- Owner: @florian (florian.ristig@harway.de)
- Owner: @heiko (heiko.gregor@harway.de)

Alle drei mit anthropic/claude-opus-4-7, Production-Bridge.

## Repo
github.com/markusbaier/twin-lab — `origin/main` lokal auf
`6bc9a05` (Tag 13 Mittag — Vision-Doc-Commit). Production-VPS
auf `189acbc` (Tag 12 Doku-Commit). Vision-Doc und 3.4-Strategy
sind Backend-irrelevant, brauchen daher keine Production-Image-
Rebuild — aber für Doku-Konsistenz wäre ein Repo-Pull auf VPS
sinnvoll mit dem nächsten Code-Deploy.

**Tag-13-Commits (bisher):**
- `6bc9a05` docs: TWIN-VISION.md — Vision-Session vom 11.-12. Mai
- (kommt: docs: 3.4-STRATEGY.md plus STAND.md + ROADMAP.md
  Update)

**Tag-12-Commits:**
- `9b4d5c5` 3.3.A bis `a3c868b` 3.3.G3 (9 Code-Commits)
- `189acbc` Doku Tag 12

**Tag-11-Commits:**
- `f3532e8` Doku Tag 11 Vormittag (#92 ✅)
- `b97ae80` 3.2.H Tool-Picker-UI plus Multi-Step-Patch plus
  UX-Polish
- `2e7c1d0` TOOL_USE_DIRECTIVE härter (Polish für #89)
- `5aef14b` Doku Tag 11 Mittag

VPS-Override-File hat zwei bind-mounts (#81 docs/ + #92
mcp-servers/), lebt nur auf VPS, nicht im Repo.
