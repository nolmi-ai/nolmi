# twin-lab — Stand

**Letztes Update:** 7. Mai 2026, nachmittag (Tag 8)

## Aktuell in Arbeit
Nichts. Vier Pflicht-Items vor 3.2 abgehakt — #77, #74, #78, #81.
Production komplett auf Tag-8-Stand. Vor 3.2 fehlt nur noch der
Test-Hygiene-Block (#71b + #80, ~3-4h).

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
- **Production heute Nachmittag verifiziert:** beim Container-
  Restart `[db:init] 8 Migration(en) bereits angewendet (skipped)`
  in den Logs

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

Browser-Test verifiziert lokal:
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
wirkungslos. → **Backlog #78** dokumentiert das Sync-Problem
(heute behoben mit CLI-Tool).

**2. `persona`-Tabelle ist Phase-1-Altlast.** Schema mit
`CHECK (id = 1)` (single-twin), enthält alten Phase-1-Snapshot,
wird vom Code nicht mehr genutzt. → **Backlog #79** dokumentiert
den geplanten DROP via Migration 009.

**3. Direct-Chat-History persistiert ohne Reset-Pfad.** Audit-Log
wächst monoton, History-Kontext beim nächsten Send enthält alle
früheren Konversationen. Verfälscht jeden Skill-Toggle-Test.
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

### #81 — `docs/`-Volume-Mount für `twin:reload` in Production (~30 Min, davon ~10 Min false-positive)
**Kein Repo-Commit (siehe unten), nur VPS-Override-File angelegt.**

Beim Production-Deploy entdeckt: das `twin:reload`-CLI funktioniert
lokal, aber nicht im Production-Container — `docs/`-Verzeichnis
fehlt im Image (apps/runtime ist standalone, docs liegt nur im
Repo).

Erste fehlgeschlagene Lösung (committet `fc3389d`, dann reverted
`5ee5352`): Volume-Mount mit relativem Pfad `../../docs:/app/docs:ro`
direkt in `repo/docker/twin-lab-web/docker-compose.yml`. Funktionierte
lokal (echte Datei), aber nicht auf VPS — `docker-compose.yml` ist
dort ein Symlink. Compose löst relative Pfade vom Symlink-Standort,
nicht vom Symlink-Ziel auf. Heißt `../../docs` von
`/docker/twin-lab-web/` aus = `/docs` (Root + zweimal hoch geht
nicht weiter). Compose mountete leeres Verzeichnis. Diagnose mit
`docker compose config` und `docker inspect <container>` zeigte
das eindeutig.

Endgültige Lösung — Override-File-Pattern auf VPS:
`/docker/twin-lab-web/docker-compose.override.yml` mit absolutem
Pfad-Mount `/docker/twin-lab-web/repo/docs:/app/docs:ro`. Compose
lädt Override automatisch und merged mit Haupt-Compose-File.
Override-File ist NICHT im Repo (VPS-spezifisch). Pattern für
künftige VPS-spezifische Konfiguration etabliert.

### Production-komplett aktualisiert (~45 Min)

**Auf VPS gepullt von `1221573` auf `5ee5352`** (sechs Commits
seit gestern Mittag):
- `c7e4886` docs (Tag-7-Backlog-Update mit #77)
- `2e96ddb` fix(runtime): #77 Migration-Auto-Bootstrap
- `f045dd8` docs(persona): #74 Workshop-Block raus
- `f0705c2` docs (Tag-8-Vormittag)
- `61154c0` feat(runtime): #78 twin:reload-CLI
- `5def45b` docs (Tag-8-Mittag)

Plus später `5ee5352` (Revert von #81-Fail-Try) und VPS-Override-
File `/docker/twin-lab-web/docker-compose.override.yml` für #81.

**Production-Verifikation:**
- Migration-Auto-Bootstrap aus #77 funktioniert in Production:
  `[db:init] 8 Migration(en) bereits angewendet (skipped)` in den
  Boot-Logs nach Container-Recreate
- `twin:reload @markus --force` zeigt überraschenden Diff:
  `persona_md: 244 → 6991 chars (+6747)`. Production-Markus hatte
  einen 244-Zeichen-Stub aus dem Onboarding-Wizard, nicht die
  volle Persona aus `docs/persona.md`. Niemand hat's gemerkt
  vorher
- `twin:reload @florian --force`: gleicher Drift, `191 → 575`
- `twin:reload @heiko --force`: failed mit
  `persona-heiko.md fehlt unter /app/docs/persona-heiko.md`. Heikos
  Twin wurde via Onboarding-Wizard angelegt, hat keine docs/-Source.
  → **Backlog #82**, kein Druck (Stub funktioniert)
- Browser-Smoke-Test auf Production: @markus antwortet jetzt mit
  voller Persona — Roding, Founder HARWAY, Florian als Co-Founder,
  16 AI-Agenten, „kein Demo-Theater, sondern echtes
  Produktionssystem". Ton stimmt, Inhalt stimmt

## Phase 3 Status (unverändert seit Tag 7)

- 3.1 ✅ **Skill-System Engine + Pilot**
  - 3.1.A ✅ DB-Schema + Skill-Repo
  - 3.1.B+C ✅ Engine + System-Prompt-Integration
  - 3.1.D ✅ CLI-Tool zum Importieren
  - 3.1.E ✅ Read-only UI + Toggle (heute morgens nach
    #74-Persona-Cleanup final verifiziert)
  - 3.1.F ✅ Pilot-Skill `harway-workshops`
- 3.2 offen — MCP-Client als Skill-Provider
- 3.3 offen — Memory: Conversation + Semantic
- 3.4 offen — Memory: Episodic
- 3.5 offen — Hyperbrowser als MCP-Skill
- 3.6 offen — Procedural Memory (ggf. Phase 4)

## Was als nächstes ansteht
1. **Pause / Mittagspause.** Sieben Commits heute (vier Code,
   drei Doku, ein Revert) plus Production-Update, sauber
   abgeschlossen.
2. **#71b + #80 als Test-Hygiene-Block** (~M, ~3-4h) — letzter
   must-Block vor 3.2. Audit-Schema fixen (kumulative History
   raus) plus History-Reset-Pfad in UI/Backend. Beide hängen
   konzeptionell zusammen — könnten in einem Sub-Schritt
   gemeinsam angegangen werden, evtl. mit Vorarbeit für 3.3
   Conversation-Memory (Sliding-Window-Pattern).
3. **Strategie-Session vor 3.2 (MCP-Client)** — sobald Test-
   Hygiene steht. Pre-Implementation-Diskussion mit konkreten
   Architektur-Festlegungen.
4. **Optional: #79 Persona-Tabelle droppen** (XS, nice) — kann
   beim nächsten Migrations-Anlass mit angehängt werden.
5. **Optional: #82 Heikos Persona-File** — wenn Heiko Persona-
   Updates braucht. Pragmatisch: einmalig manuell File anlegen,
   dann läuft `twin:reload`.

## Production-Stack — live, jetzt auf Tag-8-Stand

- **`https://app.twin.harwayexperience.com`** — Web (Tag-8-Image
  unverändert, kein Web-Code geändert seit Tag 7)
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

Production-Skill-System ist deployt aber kein Skill in Production-DB
(Skills sind heute nur lokal in @markus' DB).

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
github.com/markusbaier/twin-lab — origin/main aktuell auf `5ee5352`
(Tag 8 Nachmittag, sieben Commits seit gestern Mittag inklusive
#81-Revert: 2e96ddb Dockerfile, f045dd8 Persona-Edit, f0705c2
Tag-8-Vormittag-Doku, 61154c0 twin:reload-CLI, 5def45b Tag-8-
Mittag-Doku, fc3389d #81-False-Try, 5ee5352 #81-Revert).

VPS-Override-File `/docker/twin-lab-web/docker-compose.override.yml`
für #81-docs-Volume-Mount lebt nur auf VPS, nicht im Repo.
