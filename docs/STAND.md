# twin-lab — Stand

**Letztes Update:** 6. Mai 2026, ~12:00

## Aktuell in Arbeit
Nichts. Phase 3.1 (Skill-System Engine + Pilot) komplett durch — fünf
Sub-Schritte (3.1.A bis 3.1.F) an einem Vormittag. Production-Stack
weiter stabil seit Tag 5.

## Heute (Tag 7) abgeschlossen

### Strategie-Session: Phase 3 konkretisiert (vormittags, ~30 Min)
Fünf Architektur-Entscheidungen festgelegt:
- **Skill-Definition Hybrid C** — Manifest (YAML) + SKILL.md +
  optional Script. Pattern angelehnt an Hermes/Cline/agentskills.io
- **Storage in DB von Anfang an** — Tabelle `skills` mit
  Multi-Tenant-Isolation pro `twin_id`
- **Capability-Mapping** — Skills gehören zu Capabilities, sind
  selbst keine. Mandate-Layer aus 2.5.4.1 unangetastet
- **MCP als Skill-Source** — keine zweite Architektur, MCP-Tools
  registrieren als Skills mit `source: "mcp"`
- **Skill-Selection Strategie B** — alle aktiven Skills permanent
  im System-Prompt. Migrationspfad zu C (Hybrid Core/On-demand)
  dokumentiert für später, wenn Token-Volumen es erzwingt

Plus: Phase-3-Reihenfolge umgestellt — Skill-System (3.1) ist
Fundament, MCP (3.2) ist Tool-Provider. Vorher war's andersherum.
ROADMAP.md aktualisiert.

### 3.1.A — DB-Schema + Skill-Repo (~45 Min)
**Commit `2c1cfd0`**
- Migration `008_skills.sql`: Tabelle `skills` mit
  `UNIQUE(twin_id, name)`, FK auf `twin_profiles` mit
  `ON DELETE CASCADE`, Indizes für `twin_id` / `is_active` / `source`
- `apps/runtime/src/skills/repo.ts`: SkillRepo mit
  `add` / `findById` / `findByName` / `list` / `update` / `setActive` /
  `remove` plus eigene Error-Typen `SkillAlreadyExistsError` /
  `SkillNotFoundError`
- `apps/runtime/src/scripts/test-skill-repo.ts`: 9 Steps grün
- `packages/shared/src/index.ts`: Zod-Schemas für `Skill`,
  `SkillManifest`, `SkillInput`, `SkillOutput`, `SkillSource`
- ID-Format: `skill_<nanoid(16)>`

### 3.1.B+C — Skill-Engine + System-Prompt-Integration (~7 Min Code, +Verifikation)
**Commit `b2b796e`**
- Neu: `apps/runtime/src/skills/prompt-builder.ts` —
  `buildSkillsBlock(skills)` baut die vierte System-Prompt-Schicht
  (`# Verfügbare Skills` Header + Hinweis-Satz + pro Skill
  `## name` + Beschreibung + `instructionsMd`, getrennt durch `---`)
- `apps/runtime/src/twin-service.ts`: `runModel()` lädt vor jedem
  Call `skills.list({activeOnly: true})`, baut Block, loggt
  `[skills] block in system-prompt: twinId=…, skillCount=…,
  skillsBlockChars=…` als Token-Volumen-Proxy. Reiht ihn als
  dritte Schicht zwischen Persona und LANGUAGE_DIRECTIVE ein.
  Skills automatisch aktiv für alle Aufrufer (chat,
  runOwnerDirect, approveDefault, approveTwinSend,
  approveTwinResponse, handleTrustedBridgeMessage).
- `apps/runtime/src/twin-service-registry.ts` und `index.ts`:
  SkillRepo via Registry-Pattern durchgereicht (analog TrustRepo)
- Neu: `apps/runtime/src/scripts/test-skill-engine.ts` — Mock-LLM
  via `MockLanguageModelV3` aus `ai/test`, 6 Stages alle grün
  (Skill anlegen, Chat-Call, Assertions auf Schichten-Reihenfolge,
  setActive(false) + zweiter Call, Cleanup)
- 3.1.C ist konzeptionell Teil von 3.1.B — Claude Code hat beides
  in einem Schritt gebaut, ein Commit reicht

### 3.1.D — CLI-Tool für Skill-Anlegen (~30 Min)
**Commit `7c65c41`**
- `apps/runtime/src/scripts/skill-create.ts` — CLI-Tool:
  Args-Parsing `<handle> <skill-dir> [--force]`, Verzeichnis-Sanity
  (manifest.yaml + SKILL.md Pflicht, script.ts optional),
  YAML-Parse mit snake→camel-Mapping (`requires_approval` →
  `requiresApproval`), Validierung gegen `SkillManifestSchema`,
  Twin-Lookup über `TwinProfilesRepo`, Conflict-Detection via
  `SkillRepo.findByName()` (Default = Error mit `--force`-Hinweis,
  `--force` triggert `update()`)
- `apps/runtime/package.json`: Script-Eintrag `twin:skill-create`
- Neu: `apps/runtime/skills-templates/` mit `.gitignore`-Whitelist
  (README.md, `_test-skill/**`), README mit Format-Doku,
  `_test-skill/manifest.yaml` + `_test-skill/SKILL.md` (Marker-Wort
  `twinlab-skill-test-marker` für späteren Engine-Sanity-Check)
- Source-Format `manual` (Platz für `mcp` in 3.2)
- Verifikation: 4 Steps grün (Import → Re-Import-Error → --force →
  Update mit gleicher skillId)

### 3.1.F — Pilot-Skill HARWAY-Workshop-Kontext (~15 Min)
- Skill-Files lokal in `apps/runtime/skills-templates/harway-workshops/`
  (gitignored — Skills sind User-Daten, nicht Repo-Inhalt)
- Manifest: `name: harway-workshops`,
  `capability: respond_to_chat`, `requires_approval: false`
- SKILL.md: drei Workshop-Formate (Konzept / Hands-on /
  Team-Enablement), Konditionen, Kontaktdaten — Inhalt aus
  `docs/persona.md` extrahiert
- Import via CLI: `pnpm --filter @twin-lab/runtime
  twin:skill-create @markus skills-templates/harway-workshops`
- skillId: `skill_2-T2zqvxf3m-0bbD`, 1800 chars Instructions
- Browser-Test mit drei Fragen (Termin / Preise / Übersicht): Twin
  antwortet sauber im Markus-Stil mit den Skill-Daten, keine
  Halluzinationen, keine erfundenen Tagessätze
- Kein Commit — reine Datenoperation, Skill-Files gitignored

### 3.1.E — Read-only UI in Settings + Toggle (~3h Pair-Programming)
**Commit `5fbf254`**
- Backend `apps/runtime/src/server.ts`:
  `registerSkillRoutes(app, deps, requireOwner)` analog zu
  `registerTrustRoutes`. Hilfs-Funktion `toSkillUiPayload()`
  schneidet Manifest/Markdown/Script raus und konvertiert
  Timestamps (DB epoch ms → ISO-String)
- Backend Routes: `GET /twins/:handle/skills` (Owner-gated,
  sortiert aktive zuerst alphabetisch, dann inaktive) und
  `PATCH /twins/:handle/skills/:skillId/active` (Body
  `{ isActive: boolean }`, Cross-Twin-Check → 404 wenn Skill
  nicht zum Handle gehört)
- `apps/runtime/src/index.ts`: SkillRepo-Instanz aus 3.1.B
  zusätzlich an `createServer({...})` durchgereicht
- `packages/shared/src/index.ts`: `SkillUiPayloadSchema` +
  `SkillUiPayload`-Type
- Frontend `apps/web/app/settings/page.tsx`: neue Skills-Section
  zwischen „Vertraute Twins" und „Persona und Mandates". Pro
  Skill: Name + Description, Aktiv-Toggle rechts, Badges
  (Capability, Source, Instructions-Länge, ggf. „Script" /
  „requires approval"). Toggle mit Optimistic-Update +
  Revert-bei-Error + 5s-Auto-Clear. Empty-State mit CLI-Befehl
  als monospace-Block. `mcp`-Source-Badge accent-coloriert
  (vorbereitet auf 3.2)
- `skillBusyIds`-Set statt globalem busy-Boolean — User kann
  mehrere Skills parallel toggeln ohne UI-Block
- Browser-Test: Settings-Block korrekt, PATCH ändert DB-Wert,
  Cross-Twin-Isolation grün (Florian sieht keine Markus-Skills),
  Owner-Gating Backend liefert 401 ohne Cookie
- Mit `5fbf254` ist Phase 3.1 inhaltlich abgeschlossen

### Persona-Skill-Doppelung als Architektur-Befund
- Beim Toggle-Test entdeckt: Twin antwortet mit Workshop-Daten
  obwohl Skill deaktiviert. Ursache: `docs/persona.md` enthält
  Workshop-Block 1:1 (aus dem der Skill-Inhalt extrahiert wurde)
- Engine selbst ist clean (`test-skill-engine.ts` grün,
  Skill-Block bei `is_active=0` korrekt nicht im System-Prompt)
- Confound, kein Bug — gehört als Architektur-Frage in den
  Backlog (Item #74). Vote: Layering klar dokumentieren
  (Persona = identitäts-stabiles Wissen, Skill = austauschbares),
  Workshop-Inhalt aus Persona raus

### Hydration-Error wieder aufgetaucht
- Nach Schema-Erweiterung in `packages/shared` und Server-Code-
  Änderungen zeigte Browser kurz Hydration-Error auf `<footer>`
- Bekannt aus Tag 6 (Backlog #71c, Stale-Bundle-Phantom). Hard-
  Reload räumt's
- Bestätigt das Pattern: bei ENV-Var-Änderungen UND bei
  Schema-Erweiterungen in `packages/shared` lokal Hard-Reload

## Phase 3 Status

- 3.1 ✅ **Skill-System Engine + Pilot** (5/5 Sub-Schritte, ein
  Vormittag)
  - 3.1.A ✅ DB-Schema + Skill-Repo
  - 3.1.B+C ✅ Engine + System-Prompt-Integration
  - 3.1.D ✅ CLI-Tool zum Importieren
  - 3.1.E ✅ Read-only UI + Toggle
  - 3.1.F ✅ Pilot-Skill `harway-workshops`
- 3.2 offen — MCP-Client als Skill-Provider
- 3.3 offen — Memory: Conversation + Semantic
- 3.4 offen — Memory: Episodic
- 3.5 offen — Hyperbrowser als MCP-Skill
- 3.6 offen — Procedural Memory (ggf. Phase 4)

## Was als nächstes ansteht
1. **Pause / Mittagspause.** Vier Commits am Vormittag, sauber
   abgeschlossen.
2. **3.2 starten** — MCP-Client als Skill-Provider. Großer Brocken,
   braucht eigene Planungs-Session: MCP-Protokoll-Implementation,
   MCP-Server-Konfiguration pro Twin, Pilot-MCP-Server (z.B.
   Filesystem oder Time), Mandate-Gates für Tool-Calls.
3. **Backlog-Items in Reihenfolge** — #71b kumulative
   Audit-Messages, #65 Reverse-Proxy, #74 Persona-Skill-Layering.
4. **Production-Update fällig** — Tag-7-Commits noch nicht
   deployed. Beim nächsten regulären Pull mitnehmen.

## Production-Stack — live (unverändert)
- **`https://app.twin.harwayexperience.com`** — Web
- **`https://runtime.twin.harwayexperience.com`** — Runtime
- **`https://bridge.twin.harwayexperience.com`** — Bridge

Alle drei mit `restart: unless-stopped`, HTTPS via Let's Encrypt,
Traefik-Routing.

Hinweis: Tag-7-Commits (3.1.A-F) noch nicht in Production
deployed. Skill-System läuft nur lokal. Beim nächsten Pull +
Rebuild geht's mit. Kein Druck — niemand auf Production hat
heute Skills.

## Lokal
`/Users/mjb/Visual Studio/twin-lab` — drei Twins (@markus, @florian,
@heiko), lokale Bridge auf 5100. Markus-Twin hat den Pilot-Skill
`harway-workshops` aktiv in seiner DB.

## Drei User auf Production
- Owner: @markus (markus.baier@harway.de)
- Owner: @florian (florian.ristig@harway.de)
- Owner: @heiko (heiko.gregor@harway.de)

Alle drei mit anthropic/claude-opus-4-7, Production-Bridge. Keine
Skills auf Production.

## Repo
github.com/markusbaier/twin-lab — origin/main aktuell auf `5fbf254`
(Tag-7 Mittag, vier neue Commits seit gestern: 2c1cfd0, b2b796e,
7c65c41, 5fbf254).
