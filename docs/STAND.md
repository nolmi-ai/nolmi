# twin-lab — Stand

**Letztes Update:** 14. Mai 2026, Mittag (Tag 15)

## Aktuell in Arbeit
**Phase 3.4 Memory: Episodic — IN PRODUCTION LIVE.** Production-Deploy
abgeschlossen nach substantiellem Diagnose-Marathon (musl/glibc-
Inkompatibilität bei sqlite-vec). 7 Production-Konversationen embedded,
Hybrid-Search via Bayreuth-Re-Test verifiziert — Twin antwortet ehrlich
ohne Halluzination, exakt wie Phase 5 lokal validiert.

**Phase 3 Definition of Done — 4 von 5 Häkchen WIRKLICH vollständig**
(3.1, 3.2, 3.3, 3.4 in Production). 3.5 (Hyperbrowser) bleibt offen
für Häkchen 5.

## Heute (Tag 15) abgeschlossen

### Vormittag — Pre-Deploy-Patch 3.4.J.1 (~30 Min)

**Recherche Modell-Cache-Pfad:** `@huggingface/transformers` 4.2.0
ignoriert `HF_HOME` und `TRANSFORMERS_CACHE` komplett (null process.env-
Refs in env.js). Default-Cache landet in `node_modules/.../@huggingface/
transformers/.cache/` — bei jedem Container-Recreate weggeworfen.

**3.4.J.1 — Modell-Cache-Pfad via ENV konfigurierbar** (Commit `4ade195`)
- Helper `applyModelCacheDir(env)` in `local-provider.ts` — liest
  `TWIN_LAB_MODEL_CACHE_DIR` und setzt `env.cacheDir`. Default-
  Verhalten unverändert (Cache landet wie bisher in node_modules
  für lokales Dev).
- `.env.example`-Eintrag mit Erklärung
- 2 Unit-Tests grün (ENV ungesetzt → cacheDir unverändert; ENV
  gesetzt → cacheDir übernommen)

### Vormittag — VPS-Vorbereitung + Deploy-Versuch (~45 Min, scheiterte)

**VPS-Vorbereitung:**
- `/docker/twin-lab-web/model-cache` Verzeichnis angelegt
- `docker-compose.override.yml` erweitert um:
  - `environment: TWIN_LAB_MODEL_CACHE_DIR=/app/data/model-cache`
  - `volumes: /docker/twin-lab-web/model-cache:/app/data/model-cache`
- Volume-Pfad-Entscheidung: bind-mount auf VPS-Filesystem (statt
  Sub-Pfad des `twin-lab-web-data`-Volumes), wegen clean separation
  of concerns DB vs Cache

**Builds erfolgreich** (Runtime 68.5s, Web 52.3s).

**Recreate scheiterte:** Runtime-Container in Restart-Loop mit
```
Error loading shared library .../vec0.so.so: No such file or directory
```

### Vormittag/Mittag — Diagnose-Marathon (~1.5h)

**Hypothesen-Iteration:** Versions-Drift (verworfen, lokal und VPS
hatten identisch `better-sqlite3@11.10.0`). Symlink-Workaround (als
Quick-Fix erwogen, aber nicht Wurzel-Fix). Library-Update (nicht
garantiert wirksam).

**Endgültige Diagnose via Container-Inspect:**

```bash
docker run --rm -it --entrypoint sh twin-lab-runtime:latest
ldd /app/apps/runtime/node_modules/.pnpm/sqlite-vec-linux-x64@0.1.9/
  node_modules/sqlite-vec-linux-x64/vec0.so
```

Output:
```
libc.so.6 => /lib/ld-musl-x86_64.so.1
Error relocating .../vec0.so: __memcpy_chk: symbol not found
Error relocating .../vec0.so: __fread_chk: symbol not found
```

**Wurzel:** `sqlite-vec-linux-x64@0.1.9` liefert nur glibc-Builds.
`__memcpy_chk` und `__fread_chk` sind FORTIFY_SOURCE-Hardening-
Wrappers, die musl explizit nicht implementiert. Alpine nutzt musl,
also: Plattform-Inkompatibilität.

**Die irreführende `vec0.so.so`-Fehlermeldung** entsteht durch SQLite's
Auto-Fallback (siehe `sqlite3_load_extension`-Doku): wenn direkter
Pfad-Load fehlschlägt, hängt SQLite `.so` nochmal an als zweiten
Versuch. Wir hatten die ganze Zeit Pfad-Auflösung verdächtigt — war
aber Symbol-Loading-Problem.

**Lesson:** Pre-Check vom 12. Mai war lokal auf macOS arm64, nicht im
Production-Container. Diese Plattform-Inkompatibilität (glibc vs musl)
ließ sich lokal nicht aufdecken. Backlog #103 für künftige Pre-Checks.

### Mittag — Base-Image-Wechsel + Re-Deploy (~1h)

**3.4.J.2 — Runtime-Image von Alpine auf Debian-Slim** (Commit `706977b`)
- `apps/runtime/Dockerfile`: beide Stages auf `node:20-slim`,
  `apk add` → `apt-get install`
- `apps/web/Dockerfile`: auch auf slim für Konsistenz (kein glibc-
  Zwang, aber sauber)
- Image-Größe Runtime: +166 MB (688 MB → 854 MB, reiner Base-Image-
  Anteil. onnxruntime-App-Layer byte-identisch)
- Verifikation lokal: `ldd vec0.so` keine "symbol not found"-Errors
  mehr, glibc 2.36 sauber aufgelöst
- Plus init-db-Smoke auf amd64: 19 Migrationen durch inkl.
  017_embeddings_and_fts.sql

**VPS-Deploy nach Push:**
- Repo-Pull `13c9056 → 706977b` (zwei Commits)
- Image-Rebuild (Runtime 114.8s, Web 47.8s — länger weil neue Debian-
  Base + native Module gegen glibc kompiliert)
- Container-Recreate: **beide Up nach 3 Sekunden**, keine Restart-Loop
- Migrationen 017-019 sauber angewendet, log-bestätigt
- ENV-Var und Volume verifiziert: `TWIN_LAB_MODEL_CACHE_DIR=
  /app/data/model-cache` aktiv, Verzeichnis gemountet

### Mittag — Initial-Embedding + Real-Data-Smoke (~15 Min)

**Initial-Embedding auf Production:**
- `node dist/scripts/memory-embed-all.js @markus`
- 7 Konversationen embedded in **10.9s** (Modell schnell gepulled,
  vermutlich aus CDN-Cache nahe an VPS)
- 1 Konversation skipped (Skip-Logic für Summary-Segments)
- Modell-Cache: 553 MB in `/docker/twin-lab-web/model-cache/Xenova/`
- @florian + @heiko: 0 Konversationen (sind kaum genutzt)

**DB-Verifikation:** 7 embeddings, 8 conversations_done (+1 wegen
Skip-Logic), 7 FTS-Einträge — konsistent.

**Bayreuth-Re-Test gegen Production:** identische Query wie Tag-14
Phase 3.1 und 5.1, jetzt gegen Production-Twin:

> "Hey, was hatten wir gestern eigentlich nochmal über Bayreuth-Karten
> und Marc besprochen? Mir entfällt da ein Detail."

**Runtime-Log:**
```
[memory-retrieval] twin=twin_jgqzOIkzdTsTx6vv returned 3 hit(s),
  top-rrf=0.0164 (vec-rank=1 vec-sim=0.697 bm25-rank=—) fts5=on
```

**Twin-Antwort:**

> "Dazu habe ich keine Erinnerung. Weder Bayreuth-Karten noch ein Marc
> tauchen in dem auf, was ich aus früheren Gesprächen mit dir habe.
> Was ich finde: ein kurzer Test nach einem Deploy, eine Frage zu
> Frau/Wohnort/Arbeit, und eine Hauptstadt-Frage. Mehr nicht.
>
> Falls du das mit Markus direkt besprochen hast (nicht mit mir als
> Twin), müsstest du ihn selbst fragen — info@harwayexperience.com
> oder LinkedIn."

**Pass.** Drei Sachen sind hier richtig: keine Halluzination,
Transparenz über echte Memory (nennt konkret die 7 embedded
Konversationen), saubere Self-vs-Original-Markus-Trennung.

Plus: `bm25-rank=—` bestätigt #101 FTS5-AND-Befund in Production —
gleiche Pattern wie Phase 5.2/5.3 lokal. Nicht kritisch, weil Vector-
Layer den Hit liefert und Facts-Layer strukturelle Truth abdeckt.

**Phase 3.4 in Production LIVE und Halluzinations-Bug behoben.**

## Tag-14-Sequenz (zur Erinnerung, unverändert)

**Vormittag:** Bau-Sprint 3.4.E (`44ab971`) + 3.4.F (`745d660`) +
3.4.G (`e912130`). Plus 3.4.H Smoke-Doc.

**Mittag:** 23 Bestandsdaten-Konvs lokal embedded via Maintenance-CLI.

**Nachmittag:** Phase 3.1 Browser-Smoke → Bayreuth-Halluzinations-
Befund. Reaktive Strategie-Session + 3.4.I-Bau (`e3a8ea1`). Phase 5
validiert Resolution. Plus #101 als FTS5-AND-Befund.

**Abend:** STAND-Update Tag 14 Abend (`13c9056`).

## Tag-13-Sequenz (zur Erinnerung, unverändert)

**Vormittag:** Production-Deploy Phase 3.3 — Tag-12-Stand auf VPS.

**Mittag/Nachmittag:** Vision-Session (~3h). `docs/TWIN-VISION.md`
(`6bc9a05`). Plus Pitch-Deck.

**Nachmittag:** Strategie-Session vor 3.4. `docs/3.4-STRATEGY.md`
(`897aa34`). Plus Pre-Check + Patch (`88a98b7`).

**Abend:** Bau 3.4.A (`168986c`), 3.4.B (`7fb5551`), 3.4.D (`260186b`).
Plus 3.4.C entfallen (`ca1f2ff`).

## Phase 3 Status

- 3.1 ✅ **Skill-System Engine + Pilot** (Tag 7)
- 3.2 ✅ **MCP-Client als Skill-Provider plus UI-Tool-Picker**
  (Tag 10/11)
- 3.3 ✅ **Memory: Conversation + Semantic** (Tag 12 lokal,
  Tag 13 Vormittag in Production)
- 3.4 ✅ **Memory: Episodic** (Tag 13/14 lokal komplett, Tag 15
  in Production)
- 3.5 offen — Hyperbrowser als MCP-Skill
- 3.6 offen — Procedural Memory (ggf. Phase 4)

**Phase 3 Definition of Done — 4 von 5 Häkchen wirklich vollständig.**

Phase 3.4 ist das technische Fundament für fünf der acht menschlichen
Patterns aus TWIN-VISION (Zeit-Erleben, Schlaf/Träume, Aufmerksamkeit/
Fokus, Lebens-Narrativ, Selbst-Reflexion).

## Was als nächstes ansteht

1. **Strategie-Session vor 3.5 (Hyperbrowser)** (S, primär)
   - 3.5 baut auf etablierter MCP-Foundation aus 3.2 auf
   - Kleinere Strategie-Session — vermutlich drei Architektur-Fragen
     (Server-Pattern, Skill-Exposure, Use-Cases)
2. **DEPLOYMENT.md + docker-compose.override.yml.example** (#102, M,
   should). Self-Hosting-Doku, die heute-gelernte Sachen wie Base-
   Image-Anforderung und Modell-Cache-Volume sauber dokumentiert.
   Nicht zeitkritisch, aber Vision-relevant.
3. **Optional**: #101 FTS5-AND-Befund evaluieren wenn Real-Data zeigt
   dass Pronominal-Queries Pain Point werden
4. **Optional**: 3.4.J (LLM-Re-Rank + #100 Persona-Anti-Halluzinations)
   — nicht akut, weil Hybrid + #99 reichen

Weiterhin im Backlog:
- **#90 Resume-Prompt-Tuning** (M, should)
- **#91 Reject-Reason-UI** (S, nice)
- **#103 Pre-Check im production-äquivalenten Container** (S, should)
- **#104 sqlite3-CLI im Runtime-Image** (XS, nice)
- **Toast-Framework statt alert()** (M, nice)
- **#79 Persona-Tabelle droppen** (XS, nice)

## Production-Stack — Tag-15-Stand auf VPS

**Phase 3.4 in Production LIVE** (deployed Tag 15 Mittag).
Production-VPS auf Commit `706977b`.

- **`https://app.twin.harwayexperience.com`** — Web
- **`https://runtime.twin.harwayexperience.com`** — Runtime
- **`https://bridge.twin.harwayexperience.com`** — Bridge

**Stack-Änderungen seit Tag 13:**
- Base-Image: `node:20-alpine` → `node:20-slim` (Debian, glibc) —
  wegen sqlite-vec musl-Inkompatibilität
- Image-Größen: Runtime ~854 MB, Web ~427 MB (Debian-Base-Anteil)
- Neue Volumes: `/docker/twin-lab-web/model-cache` (553 MB Modell-
  Cache, persistiert über Container-Recreates)
- Neue ENV: `TWIN_LAB_MODEL_CACHE_DIR=/app/data/model-cache` in
  override.yml

**Production-Twin @markus hat:**
- Drei initial approved Facts (city=Roding, company=Harway
  Experience, wife_name=Anna)
- Sieben Pending-Facts aus Tag-13-Smoke-Test
- 26 MCP-Tools aktiv
- Pilot-Skill `harway-workshops`
- **7 embedded Konversationen** in Episodic-Memory (Tag-15-Mittag)
- Plus Bayreuth-Test-Konv von Tag 15 (self-referential Memory aktiv)

**VPS-Override-File** hat jetzt drei bind-mounts und eine ENV-Var:
- `/docker/twin-lab-web/repo/docs:/app/docs:ro` (#81)
- `/docker/twin-lab-web/repo/mcp-servers:/app/mcp-servers:ro` (#92)
- `/docker/twin-lab-web/model-cache:/app/data/model-cache` (Tag 15)
- `TWIN_LAB_MODEL_CACHE_DIR=/app/data/model-cache`

## Lokal
`/Users/mjb/Visual Studio/twin-lab` — drei Twins, lokale Bridge
auf 5100.

**Episodic-Memory-System aktiv (seit Tag 13 Abend, komplett seit
Tag 14):**
- `embeddings`-Tabelle mit vec0-Virtual-Tabelle (1024 dim)
- `memory_fts`-Virtual-Tabelle mit unicode61-Tokenizer
- `twin_diary`-Tabelle
- `embedding_status`-Spalten
- 3.4.I Hybrid-Search aktiv (Vector + FTS5 via RRF, zweistufige
  Threshold-Sicherung, #99 Anti-Halluzinations-Prompt-Wording)

**24+ Memory-Einträge in der DB** aus Tag 13/14.

**Markus-Twin lokal:**
- Pilot-Skill `harway-workshops`, 26 MCP-Tools
- 8 Facts (4 user + 4 approved twin-extracted)
- Plus Pending-Facts

## Drei User auf Production
- Owner: @markus (markus.baier@harway.de)
- Owner: @florian (florian.ristig@harway.de)
- Owner: @heiko (heiko.gregor@harway.de)

Alle drei mit anthropic/claude-opus-4-7.

## Repo
github.com/markusbaier/twin-lab — `origin/main` auf `706977b`
(Tag 15 Mittag, Base-Image-Wechsel). Production-VPS auf `706977b`.
Repo und VPS sind synchron.

**Tag-15-Commits (alle gepushed):**
- `4ade195` feat(runtime): Modell-Cache-Pfad via
  TWIN_LAB_MODEL_CACHE_DIR konfigurierbar
- `706977b` fix(deploy): Runtime-Image von Alpine auf Debian-Slim
  wegen sqlite-vec musl-Inkompatibilität
- (kommt: docs Tag 15 — STAND + Backlog #102/103/104)

**Tag-14-Commits:**
- `4411fb4` docs: STAND Tag 13 Abend
- `ad308b6` docs: MemPalace-Inspirationen
- `44ab971` feat(runtime): 3.4.E Vector-Search im Send-Path
- `745d660` feat(runtime): 3.4.F Twin-Diary-CLI
- `e912130` feat(runtime): 3.4.G Maintenance-CLI
- `6e9771f` docs(3.4): 3.4.H End-to-End-Smoke-Protokoll
- `f2865d7` docs(3.4.I): Strategy-Doc für Hybrid-Search
- `e3a8ea1` feat(runtime): 3.4.I Hybrid-Search via RRF + #99
- `00ded89` docs: #101 FTS5-AND-Befund
- `13c9056` docs(3.4): Phase 3.4 abgeschlossen — Tag 14 Abend

**Tag-13-Commits:** siehe vorige Stand-Einträge

**Tag-12-Commits:**
- `9b4d5c5` 3.3.A bis `a3c868b` 3.3.G3 (9 Code-Commits)
- `189acbc` Doku Tag 12
