# twin-lab — Stand

**Letztes Update:** 13. Mai 2026, Abend (Tag 14)

## Aktuell in Arbeit
**Phase 3.4 Memory: Episodic — COMPLETE.** Acht von acht Sub-Schritten
(7 ursprünglich geplant + 1 reaktiv aus Smoke-Befund) lokal verifiziert.
End-to-End-Smoke durch (Phasen 1+2 + 3.1 + 3.3 + 5), substantieller
Real-Data-Befund (Bayreuth-Halluzination) hat 3.4.I Hybrid-Search
ausgelöst — Phase 5 validiert die Resolution.

**Nächster Schritt:** Phase 3.4 Production-Deploy. Pre-Deploy: Docker-
Volume-Setup für Model-Cache (war Bestandteil des entfallenen 3.4.C).

**Phase 3 Definition of Done — 4 von 5 Häkchen** (3.1, 3.2, 3.3, 3.4
lokal komplett). Phase 3.4 in Production deployen ist der nächste
Schritt für DoD-Häkchen 4 vollständig. 3.5 (Hyperbrowser) bleibt offen
für Häkchen 5.

## Heute (Tag 14) abgeschlossen

### Vormittag — Bau-Sprint 3.4.E + 3.4.F + 3.4.G (~3-4h)

**3.4.E — Vector-Search im Send-Path** (Commit `44ab971`)
- MemoryRetrievalService mit E5-Query-Prefix, Threshold/Min-Query-
  Length-Filter, Same-Conv-Filter, Access-Tracking
- EmbeddingsRepo.getFtsContent für die Prompt-Rendering-Schicht
- buildEpisodicBlock — neue sechste System-Prompt-Schicht
  ("Erinnerungen an vergangene Gespräche") nach dem summaryBlock
- runOwnerDirect ruft retrieve() vor LLM-Call, filtert auf
  currentConversation + summaries[].id
- Config-Tunables EPISODIC_TOP_K (3), EPISODIC_SIMILARITY_THRESHOLD
  (0.7), EPISODIC_MIN_QUERY_LENGTH (10) + parseFloatEnv
- 10 Test-Cases grün, inkl. Live-LocalProvider-Pattern-Verifikation
  ("Wer ist Markus' Frau?" → "Anna" mit sim=0.7395)

**3.4.F — Twin-Diary-CLI** (Commit `745d660`)
- `twin:diary-add` + `twin:diary-list` mit Auto-Embedding via
  TwinDiaryService aus 3.4.D
- Foundation-CLI für die Selbst-Reflexions-Pattern-Phase
- 6 Service-Level-Tests grün

**3.4.G — Maintenance-CLI** (Commit `e912130`)
- `twin:memory-embed-all <handle> [--force] [--type ...] [--dry-run]`
- MemoryMaintenanceService deckt drei Use-Cases ab: Initial-
  Migration für 3.3-Bestandsdaten, Failure-Retry, Provider-Wechsel
  mit deleteByTarget-vor-Re-Embed
- Skip-Logic für Konversationen mit Summary-Segments
- 7 Test-Cases grün, inkl. provider-A→provider-B-Swap

### Mittag — Bestandsdaten-Embedding + Smoke-Phase 1+2 (~30 Min)

`pnpm twin:memory-embed-all @markus` auf den 26 pending Konversationen
aus Phase 3.3 ausgeführt:
- 23 Konversationen embedded (2.9s, q8-Modell schon warm)
- 3 Konversationen mit Summary-Segments übersprungen (Skip-Logic
  zieht sie auf `embedding_status='done'`)
- Embeddings-Tabelle: 1 → 24 conversation-Rows
- FTS5-Tabelle synchron befüllt

Smoke-Doc `docs/3.4-SMOKE.md` mit Phase 1+2 ausgeführt, Phasen 3-5
als Owner-TODO mit klaren Erwartungen.

### Nachmittag — Phase 3.1 Browser-Smoke (~20 Min, substantieller Befund)

**Bayreuth-Retrieval-Test in echter Runtime.** Query "Hey, was hatten
wir gestern eigentlich nochmal über Bayreuth-Karten und Marc
besprochen? Mir entfällt da ein Detail."

**Befund:**
- Retrieval-Pipeline funktional: 3 Hits mit Top-Sim 0.704
- **Aber Retrieval-Ranking semantisch falsch** — keine der 3 Hits ist
  thematisch Bayreuth-relevant (Pending-Fact `contact_bayreuth` ist
  nicht im Memory-FTS-Index, Bayreuth-Konv existiert nicht als
  conversation-Row)
- **Twin halluziniert detaillierte Konversation** aus thematisch
  falschen Memories + Pending-Fact-Wissen: vier strukturierte Punkte
  (Preis/Termin/Acht-Karten/Compliance) plus Fazit
- **Twin korrigiert sich aus eigenem Antrieb** beim Folge-Turn:
  "Stopp — meine vorige Antwort war Bullshit. Ich hab das erfunden."
  Vision-Pattern "Ehrlichkeit über Tatsachen" greift sauber.

**Implikation:** Pure Vector-Search mit Threshold 0.7 produziert bei
deutschen Eigennamen-Queries Token-Overlap-Treffer, die der LLM als
legitimes Memory interpretiert. Pre-Check-Antizipation in realer
Datenlage *deutlich schärfer* als erwartet.

**Konsequenz:** vier neue Backlog-Items erzeugt (#96 Hierarchical
Scoping als must, #98 Hybrid-Search, #99 Prompt-Wording, #100 Anti-
Halluzinations-Pattern). Strategie-Session für 3.4.I als Reaktion
geplant.

### Nachmittag — Strategie-Session + 3.4.I-Bau (~3h)

**Strategie-Session Hybrid-Search.** Vier Architektur-Fragen geklärt
in kompaktem Format (Frage 1 Ranking, Frage 2 Query-Preprocessing,
Frage 3 Pool/Threshold, Frage 4 Scope). Ergebnis:

1. **RRF** (Reciprocal Rank Fusion, k=60) als Ranking. LLM-Re-Rank
   als 3.4.J nach Phase-5-Validierung.
2. **Aggressive Sanitization** vor FTS5 (alle Nicht-Buchstaben/Zahlen
   → Space). Vector-Pfad unverändert.
3. **Top-10 Pool pro Source**, Missing-Rank-Penalty. Zweistufige
   Threshold-Sicherung: Pre-RRF Min-Vector-Sim 0.5, Post-RRF Score-
   Threshold 0.015.
4. **Scope:** RRF + Sanitization + #99 Prompt-Update in 3.4.I. #100
   + LLM-Re-Rank als 3.4.J. #96 Hierarchical Scoping bleibt offen.

Strategy-Doc `docs/3.4.I-STRATEGY.md` (Commit `f2865d7`, 368 Zeilen).

**3.4.I — Hybrid-Search via RRF + Sanitization + #99** (Commit
`e3a8ea1`)
- `sanitize.ts` (neu) — `sanitizeForFts5` + `sanitizedTokenCount` als
  Pure Helpers
- `EmbeddingsRepo.searchFts5` — BM25-Search mit JOIN auf embeddings
  für Tenant + Modell-Filter, defensiv mit try/catch
- `MemoryRetrievalService.retrieve` Refactor auf Hybrid: Vector +
  FTS5 parallel → Pre-RRF Vector-Filter → RRF (k=60) → Post-RRF
  Threshold → Same-Conv-Filter → Top-K + Content
- `rrfMerge` als exportierte Pure-Function für Unit-Tests
- Config-Refactor: alter `EPISODIC_SIMILARITY_THRESHOLD` raus, vier
  neue ENVs (`EPISODIC_HYBRID_RRF_K`, `EPISODIC_HYBRID_POOL_SIZE`,
  `EPISODIC_HYBRID_MIN_VECTOR_SIM`, `EPISODIC_RRF_THRESHOLD`)
- `buildEpisodicBlock` (#99): Header "Mögliche Erinnerungen", explizite
  Anti-Halluzinations-Anweisung
- 8 neue Mock-Tests + Live-E5-Vergleich, alle grün
- Real-Data-Befund (#101 als Backlog): FTS5 macht implizit AND-
  Konjunktion über Tokens — bei Pronominal-Queries killen Stopwords
  den FTS5-Hit. Hybrid-Boost greift dann nicht, Pure-Vector-Ranking
  bleibt. Drei Mitigations-Pfade dokumentiert.

### Nachmittag — Phase-5-Validierung in echter Runtime (~20 Min)

Drei Tests gegen 3.4.I in echter Runtime:

**5.1 Bayreuth-Re-Test (identische Query wie 3.1):**
- Runtime-Log: `returned 3 hit(s), top-rrf=0.0328 (vec-rank=1
  vec-sim=0.765 bm25-rank=1) fts5=on`
- Twin-Antwort: **"Dazu hab ich nichts. Weder Bayreuth noch Marc noch
  Parsifal-Karten tauchen in meinen Erinnerungen auf."** Ehrlich,
  sauber, Vision-konform.
- Self-referential Memory: gestrige Halluzinations-Konv wurde durch
  3.4.D embedded, ist jetzt selbst Top-Hit. Twin sieht seinen Fehler
  und reagiert sauber. **Halluzinations-Bug behoben.**

**5.2 Anna-Test (pronominal):**
- `bm25-rank=—` — FTS5 fand 0 Hits wegen AND-Stopwords. Bestätigt #101.
- Twin antwortet trotzdem "Anna" via Facts-Layer (3.3). Saubere
  Verantwortungstrennung: strukturelle Truth via Facts, Konversations-
  Verläufe via Episodic.

**5.3 Maria-Topic-Query:**
- `bm25-rank=—` — wieder Stopwords-Problem
- Vector findet Maria-Konv mit Sim 0.749 (Top-1)
- Twin nutzt Memory konsistent ("Mail und CRM nicht angebunden")

**Befund:** Hybrid-Search + #99 löst Halluzinations-Problem. FTS5-AND-
Befund (#101) ist real, aber nicht kritisch — Facts-Layer fängt
strukturelle Fragen ab, Vector zuverlässig bei Topic-Queries.

**Phase 3.4 production-ready.**

### Plus: MemPalace-Inspirationen + Backlog-Items (~30 Min)

Recherche zu MemPalace (github.com/mempalace/mempalace, 48.2k Stars,
MIT, Python). Vier Patterns als Inspirationsquelle dokumentiert ohne
Architektur-Switch:
- Wings/Rooms/Drawers-Hierarchie
- Temporal-Knowledge-Graph mit Validity-Windows
- Verbatim-Storage statt Summary-Compression
- Auto-Save-Hooks für Claude Code

Drei Backlog-Items angelegt (#95, #96, #97). Commit `ad308b6`.

Plus aus Phase 3.1 vier weitere Items: #98 (Hybrid-Search via FTS5,
durch 3.4.I umgesetzt), #99 (Prompt-Wording, in 3.4.I integriert),
#100 (Anti-Halluzinations-Persona, bleibt für 3.4.J), #101 (FTS5-AND-
Befund aus 3.4.I).

## Tag-13-Sequenz (zur Erinnerung, unverändert)

**Vormittag:** Production-Deploy Phase 3.3 — Tag-12-Stand auf VPS,
keine Komplikationen. Initial-Facts via Container-CLI.

**Mittag/Nachmittag:** Vision-Session (~3h). `docs/TWIN-VISION.md`
(275 Zeilen, Commit `6bc9a05`). Plus Pitch-Deck.

**Nachmittag:** Strategie-Session vor Phase 3.4 (~45 Min). Fünf
Architektur-Entscheidungen. `docs/3.4-STRATEGY.md` (Commit `897aa34`).

**Nachmittag/Abend:** Pre-Check + 3.4-STRATEGY-Patch (~45 Min).
Stack-Validation für sqlite-vec + better-sqlite3 + transformers auf
M1 Max. q8 + E5-Prefix + FTS5-Vorbereitung. Commit `88a98b7`.

**Abend:** Bau 3.4.A (`168986c`), 3.4.B (`7fb5551`), 3.4.D (`260186b`).
Plus 3.4.C entfallen (`ca1f2ff`). Plus STAND-Update (`4411fb4`).

## Phase 3 Status

- 3.1 ✅ **Skill-System Engine + Pilot** (Tag 7)
- 3.2 ✅ **MCP-Client als Skill-Provider plus UI-Tool-Picker**
  (Tag 10/11)
- 3.3 ✅ **Memory: Conversation + Semantic** (Tag 12 lokal,
  Tag 13 Vormittag in Production)
- 3.4 ✅ **Memory: Episodic** (Tag 13/14 lokal komplett, inkl. 3.4.I
  Hybrid-Search-Resolution aus Smoke-Befund) — Production-Deploy
  pending
- 3.5 offen — Hyperbrowser als MCP-Skill
- 3.6 offen — Procedural Memory (ggf. Phase 4)

**Phase 3 Definition of Done — 4 von 5 Häkchen.** Phase 3.4 lokal
komplett. Production-Deploy steht aus. Phase 3.4 ist das technische
Fundament für fünf der acht menschlichen Patterns aus TWIN-VISION
(Zeit-Erleben, Schlaf/Träume, Aufmerksamkeit/Fokus, Lebens-Narrativ,
Selbst-Reflexion).

## Was als nächstes ansteht

1. **Phase 3.4 in Production deployen** (M, primär)
   - Pre-Deploy: Docker-Volume für Model-Cache vorbereiten
   - Normaler Deploy-Pfad: Repo-Pull, Image-Rebuild, Container-Recreate
   - Migrationen 017-019 werden auto-angewendet
   - Maintenance-CLI auf Production-Bestandsdaten ausführen (alle
     Production-Konversationen sind aktuell pending)
   - Real-Data-Smoke: Bayreuth-Re-Test gegen Production
2. **Strategie-Session vor 3.5 (Hyperbrowser)** (S, danach)
3. **Optional**: #101 FTS5-AND-Befund evaluieren wenn Real-Data zeigt
   dass Pronominal-Queries Pain Point werden (Stopword-Filter wäre
   kleiner Patch)
4. **Optional**: 3.4.J (LLM-Re-Rank + #100 Persona-Anti-Halluzinations)
   — nicht mehr akut, weil Hybrid + #99 reichen. Bei Datenmengen-
   Wachstum als Premium-Schicht verfügbar

Weiterhin im Backlog:
- **#90 Resume-Prompt-Tuning** (M, should)
- **#91 Reject-Reason-UI** (S, nice)
- **Toast-Framework statt alert()** (M, nice)
- **#79 Persona-Tabelle droppen** (XS, nice)

## Production-Stack — Tag-12-Stand auf VPS

**Phase 3.3 in Production aktiv** (deployed Tag 13 Vormittag).
Production-VPS auf Commit `189acbc`. Phase 3.4 lokal komplett, noch
nicht deployed.

- **`https://app.twin.harwayexperience.com`** — Web
- **`https://runtime.twin.harwayexperience.com`** — Runtime
- **`https://bridge.twin.harwayexperience.com`** — Bridge

**Persona-Stand auf Production:**
- @markus: 6991 chars
- @florian: 575 chars
- @heiko: 344 chars (Stub)

**Production-Twin @markus hat:**
- Drei initial approved Facts (city=Roding, company=Harway
  Experience, wife_name=Anna)
- Sieben Pending-Facts aus Tag-13-Smoke-Test
- 26 MCP-Tools aktiv
- Pilot-Skill `harway-workshops`

**VPS-Override-File** hat zwei bind-mounts:
- `/docker/twin-lab-web/repo/docs:/app/docs:ro` (#81)
- `/docker/twin-lab-web/repo/mcp-servers:/app/mcp-servers:ro` (#92)

## Lokal
`/Users/mjb/Visual Studio/twin-lab` — drei Twins, lokale Bridge
auf 5100.

**Episodic-Memory-System aktiv (seit Tag 13 Abend, komplett seit
Tag 14):**
- `embeddings`-Tabelle mit vec0-Virtual-Tabelle (1024 dim)
- `memory_fts`-Virtual-Tabelle mit unicode61-Tokenizer
- `twin_diary`-Tabelle
- `embedding_status`-Spalten auf conversation_summaries und
  conversations
- EmbeddingsRepo + TwinDiaryRepo
- LocalEmbeddingProvider mit multilingual-e5-large q8
- MemoryEmbeddingService + TwinDiaryService
- **3.4.I Hybrid-Search aktiv:** MemoryRetrievalService kombiniert
  Vector + FTS5 via RRF, zweistufige Threshold-Sicherung, #99 Anti-
  Halluzinations-Prompt-Wording

**24+ Memory-Einträge in der DB:**
- Maria-Konv (Tag 13 Abend)
- 23 Bestandsdaten-Konvs (Tag 14 Vormittag via Maintenance-CLI)
- Drei Tag-14-Nachmittag-Konvs (Bayreuth-Halluzination, Anna-Test,
  Maria-Test) plus deren Reflektieren-Konvs

**Memory-System aktiv (seit Tag 12):**
- `conversation_summaries`-Tabelle, Auto-Summary bei >50 Messages
- `facts`-Tabelle, Facts im System-Prompt als 2. Schicht
- Twin-Extraction via POST /facts/extract
- Facts-UI unter /facts
- Manual-Extract-Button + Reset-Confirm-Modal im Chat (3.3.G3)

**Markus-Twin lokal:**
- Pilot-Skill `harway-workshops`, 26 MCP-Tools
- 8 Facts (4 user + 4 approved twin-extracted)
- Plus Pending-Facts aus Tag-12 + Tag-13-Smoke

## Drei User auf Production
- Owner: @markus (markus.baier@harway.de)
- Owner: @florian (florian.ristig@harway.de)
- Owner: @heiko (heiko.gregor@harway.de)

Alle drei mit anthropic/claude-opus-4-7.

## Repo
github.com/markusbaier/twin-lab — `origin/main` auf `e3a8ea1`
(Tag 14 Nachmittag, 3.4.I). Production-VPS auf `189acbc` (Tag 12
Doku-Commit). Tag-13/14-Code-Commits sind noch nicht in Production
— das kommt mit dem 3.4-Production-Deploy.

**Tag-14-Commits (alle gepushed):**
- `4411fb4` docs: STAND Tag 13 Abend — 3.4.A/B/D durch und
  smoke-verifiziert
- `ad308b6` docs: MemPalace-Inspirationen als Backlog-Items #95/96/97
- `44ab971` feat(runtime): 3.4.E Vector-Search im Send-Path als
  sechste Memory-Schicht
- `745d660` feat(runtime): 3.4.F Twin-Diary-CLI
- `e912130` feat(runtime): 3.4.G Maintenance-CLI twin:memory-embed-all
- `6e9771f` docs(3.4): 3.4.H End-to-End-Smoke-Protokoll + Phase-3.4-
  Status-Updates
- `f2865d7` docs(3.4.I): Strategy-Doc für Hybrid-Search nach Smoke-
  Befund
- `e3a8ea1` feat(runtime): 3.4.I Hybrid-Search via RRF + Sanitization
  + #99 Prompt-Update
- (kommt: docs Tag 14 Abend — Smoke-Phase-5 + STAND + Backlog #101)

**Tag-13-Commits:** siehe vorigen Stand-Eintrag

**Tag-12-Commits:**
- `9b4d5c5` 3.3.A bis `a3c868b` 3.3.G3 (9 Code-Commits)
- `189acbc` Doku Tag 12

VPS-Override-File hat zwei bind-mounts (#81 docs/ + #92
mcp-servers/), lebt nur auf VPS.
