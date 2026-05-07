# twin-lab — Stand

**Letztes Update:** 7. Mai 2026, mittag (Tag 8)

## Aktuell in Arbeit
Nichts. Vier Pflicht-Items vor 3.2 abgehakt — #77, #74, #78, plus
heute morgen final verifizierter 3.1.E-Toggle-Test. Vor 3.2 fehlt
nur noch der Test-Hygiene-Block (#71b + #80, ~3-4h).

## Heute (Tag 8) abgeschlossen

### #77 — Production-Container-Bootstrap-Fix (~30 Min)
**Commit `2e96ddb`**

Beim Tag-7-Production-Deploy entdeckt: Container ruft kein
`init-db` auf, Migration 008 (Skills) wurde nicht angewendet.
Symptom: `SqliteError: no such table: skills` bei jedem
Skills-Endpoint-Aufruf. Ad-hoc-Fix war manueller
`docker compose exec runtime node /app/apps/runtime/dist/scripts/init-db.js`.

Heute strukturell gelöst:
- `apps/runtime/Dockerfile`: CMD ist jetzt
  `sh -c "node dist/scripts/init-db.js && exec node dist/index.js"`
- `exec` ersetzt Shell-Prozess durch Node — sauberes
  Signal-Handling bei `docker stop` (kein Phantom-`sh`-Parent)
- Migration läuft idempotent bei jedem Container-Start, skipped
  wenn alle Migrations schon angewendet
- Lokal verifiziert mit `docker build` + `docker run` —
  Migration-Pfad-Test grün

Production-Update für #77 nicht akut, da Production heute morgen
manuell init-db gemacht hat. Beim nächsten regulären Pull kommt
das neue Dockerfile mit, dann läuft Migration auch dort
automatisch.

### #74 — Persona-Skill-Layering (~90 Min, davon ~60 Min Diagnose)
**Commit `f045dd8`** (File-Edit) plus DB-Update via Wegwerf-Skript

Workshop-Block aus `docs/persona.md` entfernt, Fallback-Hinweis
ergänzt:

```
## HARWAY Experience — was du sagen darfst

Du kennst die öffentliche Außendarstellung von HARWAY Experience.
Konkrete Workshop-Termine, Preise und Buchungs-Links erhältst du
über separat geladenen Kontext. Wenn dir keine konkreten Daten zur
Verfügung stehen und jemand danach fragt: keine Zahlen erfinden,
keine Termine spekulieren. Verweis auf info@harwayexperience.com
oder Discovery Call (calendly.com/harwayexperience/discoverycall).
```

Browser-Test verifiziert:
- Skill `harway-workshops` aus → Twin verweist auf Discovery
  Call: „Konkrete Preise hab ich gerade nicht parat. Schreib am
  besten kurz an info@..."
- Skill an → Twin nennt 599/499 Euro, Daten aus Skill
- `[skills] block in system-prompt: ... skillCount=1,
  skillsBlockChars=2152`-Logging bestätigt System-Prompt-Layering

Saubere Trennung erreicht: Persona = identitäts-stabiles Wissen,
Skill = austauschbares Workshop-Wissen.

### Architektur-Befunde während #74-Verifikation

Ein 30-Min-Sub-Schritt produzierte ~60 Min Diagnose plus drei
neue Backlog-Items. Drei wichtige Erkenntnisse über die
Persona/History-Architektur:

**1. Persona wird aus DB gelesen, nicht aus File.** Der Server
liest `twin_profiles.persona_md` beim Boot, File-Edit allein ist
wirkungslos. `loadPersona` aus `apps/runtime/src/persona/loader.ts`
wird nur in `bootstrap-twin.ts` aufgerufen — also nur beim
initialen Setup eines Twins. → **Backlog #78** dokumentiert das
Sync-Problem (heute behoben mit CLI-Tool, siehe unten).

**2. `persona`-Tabelle ist Phase-1-Altlast.** Schema mit
`CHECK (id = 1)` (single-twin), enthält alten Phase-1-Snapshot,
wird vom Code nicht mehr genutzt. → **Backlog #79** dokumentiert
den geplanten DROP via Migration 009.

**3. Direct-Chat-History persistiert ohne Reset-Pfad.** Audit-Log
wächst monoton, History-Kontext beim nächsten Send enthält alle
früheren Konversationen. Verfälscht jeden Skill-Toggle-Test:
Twin antwortet mit Workshop-Daten aus eigener früherer Antwort.
→ **Backlog #80** dokumentiert den fehlenden Reset-Pfad. Plus
**#71b von should auf must hochgestuft** vor 3.2.

### #78 — CLI-Tool `pnpm twin:reload <handle>` (~45 Min)
**Commit `61154c0`**

Drei Source-Files in einem Befehl synchronisiert:
- `docs/persona.md` (oder `docs/persona-<handle>.md`)
- `docs/persona-meta.yaml` (oder `docs/persona-<handle>-meta.yaml`)
- `docs/mandates.yaml` (immer global)

Pattern angelehnt an `twin:set-api-key` und `twin:skill-create`.
Args: `<handle> [--force]`. Confirm-Prompt mit y/yes/j/ja-Akzeptanz,
`--force` für Skripte. Diff-Summary zeigt persona_md-chars-delta,
display_name-Wechsel, mandates-count-delta. Restart-Hinweis am
Ende, weil Persona/Mandates nur beim Twin-Service-Boot in den
Speicher geladen werden (anders als Skills, die bei jedem Chat
frisch aus DB gelesen werden).

Architektur-Detail: Pfad-Resolution in eigenen Helper extrahiert
(`apps/runtime/src/scripts/_twin-source-paths.ts`), den auch
`bootstrap-twin.ts` jetzt nutzt — keine doppelte Pfad-Logik.
Underscore-Prefix als Konvention für shared Helpers im
scripts-Ordner.

Verifikation: drei Aufrufe (`@markus` mit Confirm, `@markus`
`--force`, `@florian` `--force`) plus DB-Inspect — alle drei
Twins korrekt synchron, kein Cross-Twin-Kontamination.

### Persona-DB-Synchronisierung im Test

Der ursprüngliche Test heute morgen scheiterte am Persona-File-
zu-DB-Sync-Bug. Eingriff: Wegwerf-Skript in `/tmp/update-persona.ts`
mit absoluten Imports und async-main-Wrapper, weil tsx-Inline-Eval
relative Imports nicht auflöst und top-level-await im CJS-Modus
nicht funktioniert. Lessons aus diesem Side-Quest sind als #78
und Tag-8-Lessons in BACKLOG dokumentiert.

## Phase 3 Status (unverändert seit Tag 7)

- 3.1 ✅ **Skill-System Engine + Pilot**
  - 3.1.A ✅ DB-Schema + Skill-Repo
  - 3.1.B+C ✅ Engine + System-Prompt-Integration
  - 3.1.D ✅ CLI-Tool zum Importieren
  - 3.1.E ✅ Read-only UI + Toggle (heute final verifiziert nach
    #74-Persona-Cleanup)
  - 3.1.F ✅ Pilot-Skill `harway-workshops`
- 3.2 offen — MCP-Client als Skill-Provider
- 3.3 offen — Memory: Conversation + Semantic
- 3.4 offen — Memory: Episodic
- 3.5 offen — Hyperbrowser als MCP-Skill
- 3.6 offen — Procedural Memory (ggf. Phase 4)

## Was als nächstes ansteht
1. **Pause / Mittagspause.** Vier Code-Commits plus zwei Doku-
   Commits am Vormittag, sauber abgeschlossen.
2. **#71b + #80 als Test-Hygiene-Block** (~M, ~3-4h) — letzter
   must-Block vor 3.2. Audit-Schema fixen (kumulative History
   raus) plus History-Reset-Pfad in UI/Backend. Beide hängen
   konzeptionell zusammen — könnten in einem Sub-Schritt
   gemeinsam angegangen werden, evtl. mit Vorarbeit für 3.3
   Conversation-Memory (Sliding-Window-Pattern).
3. **Strategie-Session vor 3.2 (MCP-Client)** — sobald Test-
   Hygiene steht. Pre-Implementation-Diskussion mit konkreten
   Architektur-Festlegungen, analog zur Phase-3-Strategie-Session
   gestern morgen.
4. **Optional: #79 Persona-Tabelle droppen** (XS, nice) — kann
   beim nächsten Migrations-Anlass mit angehängt werden.
5. **Production-Update fällig** — Tag-7- und Tag-8-Commits noch
   nicht alle deployed. Beim nächsten regulären Pull mitnehmen.

## Production-Stack — live (unverändert)
- **`https://app.twin.harwayexperience.com`** — Web
- **`https://runtime.twin.harwayexperience.com`** — Runtime
- **`https://bridge.twin.harwayexperience.com`** — Bridge

Alle drei mit `restart: unless-stopped`, HTTPS via Let's Encrypt,
Traefik-Routing.

Hinweis: Tag-7-Skill-System ist deployed (manuelles init-db lief
gestern Mittag), aber Tag-8-Commits (#77 Dockerfile-Fix, #74
Persona-Cleanup, #78 twin:reload CLI) noch nicht. Beim nächsten
regulären Pull kommen die mit. #74 in Production braucht
zusätzlich `pnpm twin:reload @markus --force` plus Container-
Restart, sonst hat Production-Markus-Twin noch den alten
Workshop-Block in der Persona-DB-Spalte. Kein Druck — niemand auf
Production hat heute Skill-Toggles.

## Lokal
`/Users/mjb/Visual Studio/twin-lab` — drei Twins (@markus, @florian,
@heiko), lokale Bridge auf 5100. Markus-Twin hat Pilot-Skill
`harway-workshops` aktiv in seiner DB. Persona-DB-Spalte ist nach
#78-Tool-Lauf synchron mit `docs/persona.md`-File.

## Drei User auf Production
- Owner: @markus (markus.baier@harway.de)
- Owner: @florian (florian.ristig@harway.de)
- Owner: @heiko (heiko.gregor@harway.de)

Alle drei mit anthropic/claude-opus-4-7, Production-Bridge.

## Repo
github.com/markusbaier/twin-lab — origin/main aktuell auf `61154c0`
(Tag 8 Mittag, vier neue Commits seit gestern Mittag: 2e96ddb
Dockerfile, f045dd8 Persona-Edit, f0705c2 Tag-8-Doku, 61154c0
twin:reload-CLI).
