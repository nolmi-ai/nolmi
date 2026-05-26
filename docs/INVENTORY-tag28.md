# Repo-Inventur Tag 28 (26. Mai 2026)

Read-Only-Snapshot. Pro Kategorie: was liegt da, mit Größe/Datum/Referenzen.
Cleanup-Entscheidungen folgen in separatem Block.

## A. Top-Level

```
.claude/             → IDE-Konfig (Claude Code)
.env                 → lokal, in .gitignore
.env.example         → 7.4KB, dokumentiert alle ENV-Vars
.git/
.github/             → GitHub-Konfig
.gitignore           → 237 B, Standard-Patterns drin
.husky/              → pre-push-Hook (Tag-27 #137)
.DS_Store            → von .gitignore abgedeckt, lokal nur

CLAUDE.md            → 5.4KB, Project-Instructions für Claude Code
CONTRIBUTING.md      → 2.7KB
LICENSE              → 11.6KB
README.md            → 5.0KB
SECURITY.md          → 0.5KB

apps/                → Workspaces (runtime, web, bridge)
data/                → Untracked, lokale SQLite-DBs (in .gitignore)
docker/              → Compose-Files für Production
docs/                → Strategie + STAND + BACKLOG + Archiv
examples/            → examples/skills/recherche-workflow + README
mcp-servers/         → JSON-Configs für MCP-Server (everything, hyperbrowser)
node_modules/        → pnpm-managed
package.json         → Root-Workspace + pnpm-Scripts
packages/            → packages/shared
pnpm-lock.yaml       → 144KB
pnpm-workspace.yaml  → 40 B
scripts/             → UNTRACKED, enthält smoke-139.sh (Block 5)
tsconfig.base.json   → Root-tsconfig
```

**Auffällig:**
- `scripts/` am Top-Level ist UNTRACKED, enthält nur `smoke-139.sh` (Block-5-Ad-hoc, bewusst nicht committed).
- Keine `tmp-*`, `test-output.*`, `Untitled*`, `*.bak`, `*.orig`, `*.log` im Tracked-Bereich.

## B1. Vitest-Tests (gehören ins Repo)

**0 Treffer.** `find apps packages -name "*.test.ts" -o -name "*.test.tsx" -o -name "*.spec.ts"` liefert nichts.

Bestätigt CLAUDE.md-Setzung „Es gibt keine Test-Suite. Manuelles Smoke-Testing läuft über die UI." Alle `test-*.ts`-Files im Repo sind **Smoke-Scripts** (siehe B2), keine Vitest-Tests.

## B2. Smoke/CLI-Scripts

`apps/runtime/src/scripts/` enthält **63 Files** (git-tracked):
- 4 Helpers mit `_`-Prefix (privat, von anderen Scripts importiert): `_diary-cli-helpers`, `_facts-cli-helpers`, `_mcp-cli-helpers`, `_twin-source-paths`
- 27 reguläre CLI-Scripts (Bootstrap, MCP, Facts, Diary, Memory, OAuth-CLI, Generate-Key, etc.)
- 35 `test-*.ts`-Smoke-Scripts (kein Vitest!)

Plus `apps/bridge/src/scripts/init-db.ts` (Bridge-DB-Init).

### B2.1 Scripts in `package.json:scripts` registriert (kanonische CLI-Tools)

| Script | Pfad | Registriert als |
|---|---|---|
| Bootstrap | `bootstrap-twin.ts` | `twin:bootstrap` |
| Reload | `twin-reload.ts` | `twin:reload` |
| Set API-Key | `set-api-key.ts` | `twin:set-api-key` |
| Skill Create | `skill-create.ts` | `twin:skill-create` |
| MCP CLI | `mcp-add/list/refresh/remove.ts` | `twin:mcp-*` |
| Facts CLI | `facts-add/list/remove/import/extract.ts` | `twin:facts-*` |
| Diary CLI | `diary-add/list.ts` | `twin:diary-*` |
| Memory-Embed | `memory-embed-all.ts` | `twin:memory-embed-all` |
| OAuth-Login | `cli-oauth-login.ts` | `twin:oauth-login` |
| DB-Init | `init-db.ts` | `db:init` |
| Key Generate | `generate-master-key.ts` | `key:generate` |
| Session-Secret | `generate-session-secret.ts` | `session-secret:generate` |
| User Create | `create-user.ts` | `user:create` |

### B2.2 Smoke/Spike-Scripts in `package.json:scripts` registriert

```
twin:oauth-phase1-smoke           → test-oauth-phase1.ts
twin:oauth-phase2-smoke           → test-oauth-phase2.ts
twin:oauth-phase3-spike           → test-oauth-phase3-spike.ts
twin:oauth-phase3-3-spike         → test-oauth-phase3-3-spike.ts
twin:oauth-phase3-3-2-spike       → test-oauth-phase3-3-2-spike.ts
twin:oauth-phase3-3-3-spike       → test-oauth-phase3-3-3-spike.ts
twin:oauth-phase3-4-spike         → test-oauth-phase3-4-spike.ts
twin:oauth-phase3-4-3-spike       → test-oauth-phase3-4-3-spike.ts
twin:codex-vercel-provider-smoke  → test-codex-vercel-provider.ts
test-codex-sse-parser             → test-codex-sse-parser.ts
test-codex-retry                  → test-codex-retry.ts
trust:test                        → test-trust-flow.ts
test-memory-repos                 → test-memory-repos.ts
test-episodic-repos               → test-episodic-repos.ts
test-embedding-providers          → test-embedding-providers.ts
test-model-cache-dir              → test-model-cache-dir.ts
test-memory-embedding-service     → test-memory-embedding-service.ts
test-memory-retrieval-service     → test-memory-retrieval-service.ts
test-memory-retrieval-hybrid      → test-memory-retrieval-hybrid.ts
test-twin-diary-cli               → test-twin-diary-cli.ts
test-memory-maintenance           → test-memory-maintenance.ts
test-summary-engine               → test-summary-engine.ts
test-history-with-summary         → test-history-with-summary.ts
test-prompt-builder               → test-prompt-builder.ts
test-extraction-engine            → test-extraction-engine.ts
```

**22 Smoke-Scripts** sind über `pnpm <name>` reproduzierbar dokumentiert. Bauphasen-Spuren von Phase 3 (Memory), Phase 3.3 (Summary/Facts), Phase 3.4 (OAuth/Codex).

### B2.3 Scripts ohne `package.json`-Registrierung (13 Files)

Diese Files existieren in `apps/runtime/src/scripts/` aber sind in **keinem** `package.json`-Eintrag referenziert — nur via `tsx <path>` aufrufbar. Stärkste Wegwerf-Kandidaten.

| File | Vermutete Funktion |
|---|---|
| `test-conversation-flow.ts` | Conversation-Pfad-Smoke (Phase 3.3.B/C) |
| `test-conversation-history.ts` | History-Loader-Smoke (Phase 3.3.B) |
| `test-conversations-repo.ts` | Repo-Layer-Smoke (Phase 3.3.A) |
| `test-mcp-client-manager.ts` | MCP-Client-Smoke (Phase 3.2) |
| `test-mcp-servers-repo.ts` | MCP-Repo-Smoke |
| `test-mcp-skill-sync.ts` | Skill-Sync-Smoke (Phase 3.2) |
| `test-mcp-tool-execution.ts` | Tool-Execute-Smoke (Phase 3.2) |
| `test-skill-engine.ts` | Skill-Engine-Smoke (Phase 3.1) |
| `test-skill-repo.ts` | Skill-Repo-Smoke (Phase 3.1) |
| `test-telegram-phase2.ts` | #130 Telegram-Phase-2-Smoke |
| `test-telegram-phase3.ts` | #130 Telegram-Phase-3-Smoke |
| `test-telegram-repos.ts` | Telegram-Repo-Smoke |
| `setup-telegram-manual-smoke.ts` | Telegram-Manual-Setup-Smoke |

Diese sind tracked im Git, aber kein offizielles CLI-Surface.

## B3. Wegwerf-Pattern-Treffer (`test-*`, `tmp-*`, `debug-*`, `*.bak`, ...)

Außerhalb von `node_modules/`, `.git/`, `.next/` und `dist/`: **keine echten Treffer.** Alle B3-Matches im Initial-Find waren aus `apps/runtime/dist/scripts/` — das ist Build-Output, von `.gitignore` abgedeckt.

## C. Docs

### Live (`docs/`)

| File | Größe | Referenzen | Stand laut Header |
|---|---|---|---|
| `STAND.md` | 143 KB | 8 | Tag 28 (heute) |
| `BACKLOG.md` | 226 KB | 11 | Tag 28 (heute) |
| `131-OAUTH-STRATEGY.md` | 141 KB | 15 | Tag 27/28 (§a-§y) |
| `DEPLOYMENT.md` | 63 KB | 10 | Tag 25 (#109 Closure) |
| `ROADMAP.md` | 20 KB | 10 | Tag 12 + Stand-Warnung Tag 28 |
| `TWIN-VISION.md` | 20 KB | 9 | Tag 18 |
| `130-TELEGRAM-STRATEGY.md` | 18 KB | 6 | Tag 25 |
| `BLOCK-5-STRATEGY.md` | 13 KB | 5 | Tag 25 |
| `PRE-LAUNCH-A-STRATEGY.md` | 14 KB | 7 | Tag 18 + Refresh Tag 28 |
| `UX-STRATEGY.md` | 7.6 KB | 5 | Tag 17 + Anmerkung Tag 28 |
| `BLOCK-4-STRATEGY.md` | 5.0 KB | 2 | Tag 19/20 |
| `SETUP.md` | 4.3 KB | 4 | Tag 27 |
| `ARCHITECTURE.md` | 3.2 KB | 2 | (selten geändert) |
| `mandates.yaml` | 2.6 KB | — | Boot-Konfig |
| `persona.md` | 7.5 KB | 29 | @markus-Default |
| `persona-meta.yaml` | 0.2 KB | — | @markus-Default |
| `persona-florian.md` | 0.6 KB | 0 (direkte Filename-Match) | dynamisch geladen via `_twin-source-paths.ts:39` (`docs/persona-${handle}.md`) — **NICHT verwaist** |
| `persona-florian-meta.yaml` | 0.2 KB | — | dynamisch wie oben |
| `screenshots/.gitkeep` | 0 B | — | Verzeichnis-Platzhalter, sonst leer |

### Archive (`docs/archive/`)

| File | Größe | Referenzen | Inhalt |
|---|---|---|---|
| `STAND-history-pre-tag25.md` | 71 KB | 1 | Tag-28-Block-18-Auslagerung Phase 2.5 bis Tag 24 |
| `BACKLOG-closed-pre-tag26.md` | 72 KB | 1 | Tag-28-Block-18-Auslagerung Closed-Items vor Tag 26 |
| `3.4-STRATEGY.md` | 28 KB | 9 | Phase 3.4 Strategy (alt) |
| `3.4-SMOKE.md` | 21 KB | 4 | Phase 3.4 Smoke-Doku (alt) |
| `3.5-STRATEGY.md` | 17 KB | 2 | Phase 3.5 Strategy (alt) |
| `3.4.I-STRATEGY.md` | 13 KB | 4 | Phase 3.4.I Sub-Strategy (alt) |
| `3.5-SPIKE-89-FINDINGS.md` | 12 KB | 1 | Phase 3.5 Spike #89 Findings (alt) |
| `README.md` | 0.7 KB | 7 | Archive-Index |

## D1. Verwaiste Module (Heuristik, kein Verlass)

**Top-Level-Frame** (Entry-Points ausgenommen):

- `apps/runtime/src/auth-stub.ts` — **0 Importer.** Datei-Header sagt explizit "DEPRECATED — Re-exports für Refactor-Welle". Re-exportiert `getCurrentUser` aus `auth/get-current-user.js`. Wenn keine Importer existieren, ist die Refactor-Welle durch und der Stub ist obsolet. **Klarster Cleanup-Kandidat.**

**Apps/web:** Heuristik findet keine verwaisten Module (alle Components werden importiert, Next.js-Magic-Files wie `page.tsx`/`layout.tsx` rausgefiltert).

**Apps/runtime/src/scripts/:** Heuristik markiert alle CLI-Scripts als "verwaist", weil sie keine TypeScript-Importer haben — sie sind **CLI-Entry-Points** (via `tsx <path>`). Siehe B2.1-B2.3 für die echte Klassifizierung (registriert / unregistriert).

## D2. Auskommentierter Code (Top 15 nach `^// `-Density)

Nach Filter von `.next/standalone/`-Treffern (Build-Output):

| Datei | `// `-Zeilen | Charakter |
|---|---|---|
| `apps/runtime/src/server.ts` | 101 | Header-Doku + Inline-Erklärungen |
| `apps/web/app/chat/[handle]/page.tsx` | 94 | Header-Doku + viele Component-Kommentare |
| `apps/web/components/Tabs.tsx` | 66 | Component-Doku |
| `apps/web/app/onboarding/page.tsx` | 52 | Wizard-Schritt-Doku |
| `apps/runtime/src/twin-service.ts` | 46 | Header + Inline (Capability-Logik) |
| `apps/runtime/src/episodic/embeddings-repo.ts` | 39 | Repo-Doku |
| `apps/runtime/src/scripts/test-oauth-phase3-4-spike.ts` | 37 | Spike-Doku |
| `apps/runtime/src/oauth/codex-sse-parser.ts` | 35 | Parser-Doku |
| `apps/runtime/src/oauth/codex-vercel-provider.ts` | 34 | Provider-Doku |
| `apps/runtime/src/scripts/test-codex-sse-parser.ts` | 31 | Test-Doku |
| `apps/runtime/src/episodic/memory-embedding-service.ts` | 30 | Service-Doku |

**Beobachtung:** Alle Top-Treffer sind **Doku-Header + Inline-Erklärungen**, kein deaktivierter Code-Block. Pattern-Match auf `^// ` ist hier kein Cleanup-Signal — das ist normale Codestil-Diktion (CLAUDE.md `Doku ist auf Deutsch`).

## E. Build-Artefakte & .gitignore

### E1. Treffer im Working-Tree (von `.gitignore` abgedeckt, lokal sichtbar)

```
.DS_Store              → 8 Stück verteilt (./, ./docker/, ./docs/, ./packages/, ./apps/, /apps/web/, ./apps/bridge/, ./apps/runtime/, ./packages/shared/, ./apps/runtime/skills-templates/, ./apps/runtime/src/)
.env                   → 3 Stück (./, ./apps/bridge/, ./apps/runtime/)
*.tsbuildinfo          → 2 Stück (./apps/web/tsconfig.tsbuildinfo, ./apps/web/.next/cache/.tsbuildinfo)
```

Alle in `.gitignore` — werden nicht committed. Reine OS-/Build-Artefakte.

### E2. .gitignore-Stand

```
node_modules
.next
dist
.env
.env.local
data/*.db
data/*.db-journal
apps/bridge/data/*.db
apps/bridge/data/*.db-journal
apps/bridge/data/*.db-shm
apps/bridge/data/*.db-wal
*.log
.DS_Store
.turbo
data/*.db-shm
data/*.db-wal
*.tsbuildinfo
```

**Lücken:**
- Kein `coverage/` (würde aber nur greifen wenn Test-Coverage-Run dazu kommt — aktuell kein Test-Setup, also irrelevant)
- Kein `*.orig`, `*.bak`, `*.swp`, `*.swo` (Editor-Backups) — bisher nicht beobachtet
- Top-Level-`scripts/` (untracked, enthält Ad-hoc-Smokes wie `smoke-139.sh`) — kein Pattern für temporäre Skripte, ist aber bewusst untracked seit Tag 28 Block 5

**Insgesamt:** `.gitignore` ist sauber für aktuellen Repo-Stand.

## F. Examples-Folder

```
examples/
└── skills/
    ├── README.md              (1.1 KB)
    └── recherche-workflow/
        └── ... (3 Files vermutet, nicht weiter aufgelistet)
```

Klein und fokussiert. README + ein Beispiel-Skill (`recherche-workflow`, von #107/#108 Computer-Use-Hook Tag 19/20). Im Repo-Dockerfile via Memory-Notiz erwähnt.

## Beobachtungen

**Was sich für Cleanup-Diskussion anbietet (keine Empfehlung, nur Inventur-Auffälligkeiten):**

1. **`apps/runtime/src/auth-stub.ts`** — explizit als DEPRECATED markiert, 0 Importer im Codebase. Wahrscheinlich Refactor-Welle-Reste.

2. **13 unregistrierte `test-*.ts`-Scripts in `apps/runtime/src/scripts/`** — alle aus konkreten Bauphasen (Phase 3.1-3.3 Memory/Skill/MCP, #130 Telegram Phase 2-3). Nicht über `pnpm`-CLI ansprechbar, nur via `tsx <path>`. Sind sie noch Bezug-relevante Bauphasen-Spuren oder Wegwerf? Pro File entscheiden.

3. **22 registrierte Spike/Smoke-Scripts** in `package.json` (Phase 3 Memory + Phase 3.4 OAuth/Codex). Sind Bauphasen-dokumentiert. Bleiben sie als "wie haben wir verifiziert?"-Trail, oder können einige ins Archiv (zusammen mit ihren `package.json`-Einträgen)?

4. **`docs/screenshots/` ist leer** (nur `.gitkeep`). Verzeichnis ist Boot-Konfig oder Future-Use?

5. **Pre-Phase-3.4-Strategy-Docs in `docs/archive/`** (`3.4-STRATEGY.md`, `3.4-SMOKE.md`, `3.4.I-STRATEGY.md`, `3.5-STRATEGY.md`, `3.5-SPIKE-89-FINDINGS.md`) — sind schon archiviert, aber `archive/README.md` (700 B) ist evtl. veraltet seit Block 18 zwei neue Archive-Files dazu kamen. Wert prüfen.

6. **`data/twin.db.backup` + `data/twin.db.backup-pre-commit-11a`** — lokale DB-Backups (untracked via `data/*.db`), beide ~38MB. Lokal, nicht im Repo. Aber: lokale Disk-Hygiene-Sache, ob Backups noch nötig sind (Pre-Commit-11a-Backup z.B. ist 5 Tage alt).

7. **`scripts/`-Verzeichnis am Top-Level** (untracked, enthält nur `smoke-139.sh`) — bewusst nicht committed (Briefing Block 5/Block 8). Aber: gibt es eine Doku-Konvention für ad-hoc-Smokes, oder soll das langfristig anders organisiert werden (eigenes `tools/`-Verzeichnis o.ä.)?

8. **`docs/BACKLOG.md` mit 226 KB / `docs/STAND.md` mit 143 KB** sind nach Block-18-Archivierung schon halbiert. Falls weitere Hygiene-Welle gewünscht: in BACKLOG könnte z.B. die Section "Lessons gelernt" (große Stack) in eigenes File ausgelagert werden.

9. **`docs/131-OAUTH-STRATEGY.md` mit 141 KB / 25 Sub-Sections §a-§y** — sehr detailliertes Bauphasen-Tagebuch von #131. Macht als Strategy-Doc Sinn, aber: wenn das Pattern für Phase B oder andere Substantielle Items wiederholt wird, entstehen viele große Strategy-Docs. Frage: brauchen wir eine Konvention "Strategy-Doc-Lifecycle" (live für aktive Phase, ins Archiv nach Closure)?

10. **No-Vitest-Setup** — bestätigt CLAUDE.md. Alle `test-*`-Files sind Smoke-Scripts. Eindeutige Benennungs-Konvention (z.B. `smoke-*` statt `test-*`) würde das Mental-Model schärfen, aber bricht alle existing `pnpm`-Aliases. Trade-off.
