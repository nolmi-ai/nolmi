# twin-lab — Stand

**Letztes Update:** 12. Mai 2026, Abend (Tag 13)

## Aktuell in Arbeit
**Phase 3.4 Memory: Episodic — Bau-Phase läuft.**
Drei von sieben Sub-Schritten durch und in lokaler Runtime
smoke-verifiziert: 3.4.A (Schema + Repos), 3.4.B (Embedding-
Provider-Interface), 3.4.D (Synchrone Embedding-Generation).
Plan-Anpassung: 3.4.C wurde in 3.4.B integriert (isolierter
Modell-Setup nicht sinnvoll testbar), daher 7 statt 8
Sub-Schritte.

**Phase 3 Definition of Done — 3 von 5 Häkchen.** Plus Phase 3.3
in Production deployed. Plus 3.4 zur Hälfte gebaut und lokal
verifiziert.

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
  Persona-typischer Antwort
- Reflektieren-Button: 7 Pending-Facts extrahiert in hoher Qualität
  (business_partner=Florian Ristig, company_headquarters=Hamburg,
  contact_email, discovery_call_link, expertise_areas, region,
  work_mode)

Plus Lessons aus Production-Deploy:
- Docker-Compose-Setup auf VPS hat keine `build:`-Section, nutzt
  vor-gebaute `:latest`-Images
- Production-Container hat keinen pnpm-Binary, CLI-Skripte direkt
  via `node dist/scripts/...` aufrufen

### Mittag/Nachmittag — Vision-Session (~3h)

Strategie-Session über die langfristige Vision von twin-lab.
Vier Blöcke (Wer soll Twin sein, Menschliche Patterns, Ethische
Grenzen, Eigentum/Existenz).

**Kern-Setzung:**
> "Twin hat Markus' Substanz, bessere Disziplin als Markus an
> müden Tagen, und entwickelt sich über Zeit zu einem
> eigenständigen Wesen — mit klaren Reifungs-Stufen und unter
> ethischen Leitplanken."

Ergebnis: `docs/TWIN-VISION.md` (275 Zeilen). Commit `6bc9a05`.

**Bonus-Output:** Pitch-Deck `twin-lab-pitch.html` (10 Slides,
deutsch).

### Nachmittag — Strategie-Session vor Phase 3.4 (~45 Min)

Fünf Architektur-Fragen für Episodic-Memory geklärt:

1. **Embedding-Provider** — Swappable Interface (Local, OpenAI,
   Voyage), Default lokal mit `Xenova/multilingual-e5-large` q8
2. **Granularität** — Primary pro Summary-Segment, plus pro
   abgeschlossene Konversation falls keine Segments
3. **Retrieval** — Always-On Top-K=3 mit Similarity-Threshold 0.7,
   sechste Schicht im System-Prompt
4. **Update** — Synchron beim Schreiben, Boolean-Flag
   `embedding_status` für Failure-Handling
5. **Vision-Connection** — Extended Foundation. Datenschicht-
   Erweiterungen für alle fünf abhängigen Patterns

Ergebnis: `docs/3.4-STRATEGY.md`. Commit `897aa34`.

### Nachmittag/Abend — Pre-Check + 3.4-STRATEGY-Patch (~45 Min)

Stack-Validation für sqlite-vec 0.1.9 + better-sqlite3 12.10.0 +
@huggingface/transformers 4.2.0. Drei Smoke-Tests grün auf M1 Max.
Drei kritische Implementation-Patterns aufgedeckt (BigInt-rowid,
Buffer-Wrap, CTE-KNN). Plus Name-Overlap-Limitation bei Pure
Vector-Search erkannt.

3.4-STRATEGY-Patch mit:
- q8-Quantisierung als Default (~560 MB statt 2.1 GB fp32)
- E5-Prefix-Pattern dokumentiert (`query:` / `passage:`)
- FTS5-Virtual-Tabelle in Migration 017 mit aufgenommen
  (Hybrid-Search-Foundation, Logic später)
- Implementation-Hinweise-Sektion neu
- Name-Overlap-Limitation in Open Questions

Commit `88a98b7`.

### Abend — Bau-Phase 3.4 startet (~3h)

**3.4.A — Schema + Repos** (Commit `168986c`)
- Migrations 017-019 (embeddings + vec0 + FTS5 + embedding_status-
  Spalten + twin_diary)
- EmbeddingsRepo mit gekapselten Helpers für BigInt-rowid,
  Buffer-Wrap, CTE-KNN
- TwinDiaryRepo
- 15 Tests grün inkl. defensive Regression-Guards

**3.4.B — Embedding-Provider-Interface + Lokales Modell**
(Commit `7fb5551`)
- `EmbeddingProvider` Interface mit `inputType: 'query' | 'passage'`
- `LocalEmbeddingProvider` mit multilingual-e5-large q8 (21.5s
  kalt, Pipeline-Singleton, E5-Prefix intern)
- `OpenAIEmbeddingProvider`, `VoyageEmbeddingProvider`
- ENV-Switch via Factory
- 18 Tests grün inkl. OpenAI-Live-Call und E5-Pattern-Verifikation

**3.4.C entfallen** — Modell-Setup nur als integrierter Teil von
LocalEmbeddingProvider sinnvoll testbar. Plan auf 7 Sub-Schritte
korrigiert. (Commit `ca1f2ff`)

**3.4.D — Synchrone Embedding-Generation** (Commit `260186b`)
- MemoryEmbeddingService mit drei embed*-Methoden, alle mit
  Try-Catch und Status-Flag-Pflege
- TwinDiaryService-Wrapper (für 3.4.F bereit)
- TwinService.resetConversation() — kapselt Segments-Check +
  Audit-Aggregation + Embed + conversationsRepo.end()
- Send-Path-Integration in twin-service.ts (nach Summary embedden)
- /conversations/reset-Route delegiert an Service-Methode
- ConversationSummariesRepo + ConversationsRepo bekommen
  updateEmbeddingStatus()
- 8 Test-Cases mit MockProvider grün

**Real-Runtime-Smoke (verifiziert in lokaler Runtime):**
- Konversation `conv_hWa2QH3CJN7Ectk9` (kurz, owner-direct mit
  Markus-Twin): 2 Messages über Maria/TechCorp-September-Workshop
- Nach Reflektieren-Klick: `status='ended'`, `embedding_status=
  'done'`
- Embedding-Eintrag mit `target_type='conversation'`,
  `embedding_model='local-multilingual-e5-large-q8'`, 4096 Bytes
  (1024 dim × 4)
- FTS5-Index: lesbarer Roh-Text mit `[user]/[assistant]`-Markern,
  deutsche Umlaute intakt
- Embedding-Generation fühlte sich im UI nicht spürbar an
  (synchroner Pfad nach Reset akzeptabel)

**Diagnose-Marathon zwischendurch** (~30 Min, Anti-Befund):
Initial nicht erkannt, dass Test-Messages durch `+ Neue Konversation`-
Button als A2A-Send an @florian gingen, nicht als owner-direct mit
Markus. Mehrere falsche Hypothesen über 3.4.D-Bugs verfolgt bevor
echtes Setup-Problem klar wurde. Lesson: bei „nichts passiert"
zuerst Konversations-Partner und Capability-Routing prüfen,
*dann* Code-Hypothesen. 3.4.D war nie kaputt.

## Tag 12 abgeschlossen (zur Erinnerung)

Phase 3.3 Memory: Conversation + Semantic — komplett. Neun Code-
Commits plus Doku-Commit (`189acbc`).

## Phase 3 Status

- 3.1 ✅ **Skill-System Engine + Pilot** (Tag 7)
- 3.2 ✅ **MCP-Client als Skill-Provider plus UI-Tool-Picker**
  (Tag 10/11)
- 3.3 ✅ **Memory: Conversation + Semantic** (Tag 12 lokal,
  Tag 13 Vormittag in Production)
- 3.4 ⏳ **Memory: Episodic — 3 von 7 Sub-Schritten durch**
  (A, B, D), 3.4.E (Vector-Search im Send-Path) ist Nächster.
- 3.5 offen — Hyperbrowser als MCP-Skill
- 3.6 offen — Procedural Memory (ggf. Phase 4)

**Phase 3 Definition of Done — 3 von 5 Häkchen gesetzt**
(3.1, 3.2, 3.3). Phase 3.4 ist das technische Fundament für fünf
der acht menschlichen Patterns aus TWIN-VISION (Zeit-Erleben,
Schlaf/Träume, Aufmerksamkeit/Fokus, Lebens-Narrativ,
Selbst-Reflexion).

## Was als nächstes ansteht

1. **Sub-Schritt 3.4.E — Vector-Search im Send-Path** (substantiell)
   - User-Message embedden mit E5-Prefix `query:`
   - Top-K-Suche mit Threshold-Filter via CTE-Pattern
   - Integration in `loadConversationHistory` als sechste Schicht
   - Increment `access_count` und `last_accessed_at` bei Hit
2. **3.4.F — Twin-Diary Foundation** (Schema, Repo, CLI)
3. **3.4.G — Maintenance-CLI** `twin:memory-embed-all`
4. **3.4.H — End-to-End-Smoke-Test**
5. **Phase 3.4 in Production deployen** — nach Abschluss aller
   Sub-Schritte. Docker-Volume-Setup für Model-Cache als Pre-
   Deploy-Vorbereitung (war Bestandteil des entfallenen 3.4.C)
6. **Strategie-Session vor 3.5 (Hyperbrowser)** — kleinere Session,
   weil 3.5 auf etablierter MCP-Foundation aufbaut

Optional weiterhin im Backlog:
- **#90 Resume-Prompt-Tuning** (M, should)
- **#91 Reject-Reason-UI** (S, nice)
- **Toast-Framework statt alert()** (M, nice)
- **#79 Persona-Tabelle droppen** (XS, nice)

## Production-Stack — Tag-12-Stand auf VPS

**Phase 3.3 in Production aktiv** (deployed Tag 13 Vormittag).
Production-VPS auf Commit `189acbc`. Phase 3.4 noch nicht deployed
— lokale Verifikation läuft.

- **`https://app.twin.harwayexperience.com`** — Web
- **`https://runtime.twin.harwayexperience.com`** — Runtime
- **`https://bridge.twin.harwayexperience.com`** — Bridge (vom
  3. Mai, unverändert)

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
hat zwei bind-mounts:
- `/docker/twin-lab-web/repo/docs:/app/docs:ro` (#81)
- `/docker/twin-lab-web/repo/mcp-servers:/app/mcp-servers:ro` (#92)

## Lokal
`/Users/mjb/Visual Studio/twin-lab` — drei Twins, lokale Bridge
auf 5100.

**Episodic-Memory-System aktiv (seit Tag 13 Abend):**
- `embeddings`-Tabelle mit vec0-Virtual-Tabelle (1024 dim)
- `memory_fts`-Virtual-Tabelle mit unicode61-Tokenizer
- `twin_diary`-Tabelle (Schema vorbereitet, CLI kommt mit 3.4.F)
- `embedding_status`-Spalten auf conversation_summaries und
  conversations
- EmbeddingsRepo + TwinDiaryRepo mit gekapselten Pre-Check-Patterns
- LocalEmbeddingProvider mit multilingual-e5-large q8
- MemoryEmbeddingService + TwinDiaryService

**Memory-System aktiv (seit Tag 12):**
- `conversation_summaries`-Tabelle, Auto-Summary bei >50 Messages
- `facts`-Tabelle, Facts im System-Prompt als 2. Schicht
- Twin-Extraction via POST /facts/extract
- Facts-UI unter /facts
- Manual-Extract-Button + Reset-Confirm-Modal im Chat (3.3.G3)

**Markus-Twin lokal:**
- Pilot-Skill `harway-workshops`, 26 MCP-Tools
- 8 Facts (4 user + 4 approved twin-extracted)
- Plus 2 Pending-Facts aus Tag-12 + 2 weitere aus Tag-13-Smoke
  (contact_bayreuth Marc, company_headquarters Hamburg — können
  approved oder rejected werden)
- Eine eingebettete Konversation `conv_hWa2QH3CJN7Ectk9` (Tag-13-
  Abend-Smoke)

## Drei User auf Production
- Owner: @markus (markus.baier@harway.de)
- Owner: @florian (florian.ristig@harway.de)
- Owner: @heiko (heiko.gregor@harway.de)

Alle drei mit anthropic/claude-opus-4-7.

## Repo
github.com/markusbaier/twin-lab — `origin/main` auf `260186b`
(Tag 13 Abend, 3.4.D). Production-VPS auf `189acbc` (Tag 12
Doku-Commit). Tag-13-Code-Commits sind noch nicht in Production —
das kommt mit dem 3.4-Production-Deploy nach 3.4.H.

**Tag-13-Commits (alle gepushed):**
- `6bc9a05` docs: TWIN-VISION.md
- `897aa34` docs: Tag 13 — Production-Deploy 3.3, Vision-Session,
  3.4-Strategy
- `88a98b7` docs: 3.4-STRATEGY Patch — Pre-Check-Befunde
  eingearbeitet
- `168986c` feat(runtime): 3.4.A Schema + Repos für Episodic-Memory
- `7fb5551` feat(runtime): 3.4.B Embedding-Provider-Interface mit
  Local/OpenAI/Voyage
- `ca1f2ff` docs: 3.4-STRATEGY Sub-Schritt-Plan aktualisiert
  (7 statt 8)
- `260186b` feat(runtime): 3.4.D Synchrone Embedding-Generation im
  Send-Path und Reset-Pfad

**Tag-12-Commits:**
- `9b4d5c5` 3.3.A bis `a3c868b` 3.3.G3 (9 Code-Commits)
- `189acbc` Doku Tag 12

**Tag-11-Commits:**
- `f3532e8` Doku Tag 11 Vormittag (#92 ✅)
- `b97ae80` 3.2.H Tool-Picker-UI plus Multi-Step-Patch
- `2e7c1d0` TOOL_USE_DIRECTIVE härter (Polish für #89)
- `5aef14b` Doku Tag 11 Mittag

VPS-Override-File hat zwei bind-mounts (#81 docs/ + #92
mcp-servers/), lebt nur auf VPS.
