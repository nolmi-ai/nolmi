# twin-lab — Stand

**Letztes Update:** 21. Mai 2026, Abend (Tag 21 — Phase 1 Endpoint + Phase 2A Wizard-Refactor)

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

## Tag 21 (21. Mai 2026, Donnerstag) — Pre-Launch-Phase A Block 4 #110 (Phase 1 + Phase 2A)

**Vormittag — Phase 1 #110 Skill-Import-Endpoint (Commit `ec45b94`):**

Foundation-Endpoint für den Wizard-MCP-Hyperbrowser-Step (Phase 2). `POST /twins/:handle/skills/import` mit Whitelist-Pattern in `packages/shared`:

- `EXAMPLE_SKILL_TEMPLATES = ['recherche-workflow'] as const` als Zod-Enum
- `SkillImportRequestSchema = z.object({ source: z.literal('example'), path: z.enum(...) })`
- Idempotent via `force: true` — existing → 200 updated, neu → 201 created
- Owner-Auth via existing `requireOwner`-Pattern
- Path-Injection-Schutz: Zod-Enum + defensiver `.. / \`-Check

Refactor in einem Schwung: File-IO + YAML-Parse + camelCase-Mapping + Repo-Insert aus `twin:skill-create`-CLI in `apps/runtime/src/skills/import-from-dir.ts` extrahiert. CLI nutzt die neue Funktion, Endpoint auch — keine Duplikation. Plus `config.examplesDir`-Konstante (`WORKSPACE_ROOT`-relativ, funktioniert lokal und im Container nach #120).

**Source-Tracking-Setzung:** `SkillSourceSchema` in shared um `'example'` erweitert (Enum jetzt `'manual' | 'mcp' | 'example'`). Endpoint setzt explizit `source='example'`, CLI bleibt default `'manual'` (Backward-Compat). `validateSourceConsistency` vereinfacht: `mcp` verlangt MCP-Binding, alle Non-MCP-Sources verlangen null. UPDATE-Pfad flippt source unconditional → Tracking-Information für späteres Re-Import bei Template-Updates.

Curl-Smoke 6/6 grün:
- Erst-Aufruf: 201 created mit `recherche-workflow|forced|1|example`
- Zweit-Aufruf (Idempotenz): 200 updated
- Unbekannter Path: 400 Zod-Error
- Path-Traversal `../persona`: 400 (Zod fängt vor Defensive-Check)
- Unknown source: 400
- Non-existing Twin: 404

**Mittag-Nachmittag-Abend — Phase 2A Wizard-Refactor (6 Commits, alle gepusht):**

Inkrementeller Refactor des bestehenden 8-Step-Wizards (Strategie α aus Phase-1.1-Diagnose: Step-für-Step entfernen statt Re-Bau).

| Commit | Was | Größe |
|---|---|---|
| `dca5ef2` | Mandate-Step entfernt, Backend-Default `cautious` via `.optional().default()` | XS |
| `944a09c` | Pfad-Wahl + GoodbyeScreen entfernt, hosted-Default für Phase A | XS |
| `d20c7ff` | Bridge-Step entfernt, Defensive-Hint im Review-Header | XS |
| `fe30af9` | Smoke-Bug-Fixes: Weiter-Button auf Step 0 + Generic-Placeholders + erster Container-Width-Versuch | XS |
| `21407ef` | Section-Cards für Steps 1-4 (Sackgasse — visuelle Konsistenz, aber neue Inkonsistenz vs AccountBlock) | XS |
| `c3e7dbb` | Layout-Harmonisierung (Section-Cards zurückgerollt, alle Container auf `max-w-2xl`) | S |
| `d95f9a2` | w-full-Fix für flex-col-Shrinking + /login auf `max-w-md` | XS |

Resultat:
- Wizard von 8 → 5 Steps (Persona Wer/Wie/Worüber, LLM, Review)
- Datei `apps/web/app/onboarding/page.tsx` von 1466 → 1239 Zeilen (−227)
- Defaults greifen unsichtbar: `mandateTemplate='cautious'` vom Backend, `pathChoice='hosted'` impliziert, Bridge-Anbindung im Submit-Handler
- Layout-Hierarchie: `/login` 448px (kompakt für Auth) → Onboarding/Wizard 672px (großzügig)
- Generic-Placeholders (Open-Source-Hygiene vor #111 Apache-2.0-LICENSE)

Browser-Smoke-Bilanz Tag 21:
- 4 Smokes durchgeführt; 10/10 funktional grün (alle Steps, DB-Default `cautious`-Mandates verifiziert, Submit + Redirect)
- 4 Layout-Iterationen: Mobile-Viewport-Falsch-Diagnose + drei echte Versuche bis `w-full`-Fix saß
- Final: Layout-Hierarchie-Eindruck (Login kompakt, Wizard großzügig) bestätigt

**Lessons Tag 21:**

1. **`w-full` + `max-w-X` in flex-col-Layouts:** `max-w-X` allein gibt nur Obergrenze. In flex-col-Children muss `w-full max-w-X mx-auto` als Pattern gelten, sonst shrinkt das Element auf content-min-width statt `align-items: stretch` zu folgen. Layout-Shell ist `<body flex flex-col>` → `<main flex flex-col>` → Wizard-Container — Pattern jetzt fest.

2. **Mobile-Viewport-Falle in DevTools:** Der DevTools-Header „Responsive 2519 × 775" ist nur Bezeichnung, nicht aktive Simulation. Bei Layout-Bug-Diagnose immer Cmd+Shift+M-Status aktiv prüfen plus `window.innerWidth` in der Console. Mein Diagnose-Bet auf Mobile-Viewport-Mode war auf Tag 21 deshalb falsch — der Bug war echt, nicht der Viewport.

3. **Strategy-Setzungen vor Bau bei Layout-Iterationen:** Nach zwei „halbgar"-Befunden Schluss mit Trial-and-Error, stattdessen drei Setzungen festlegen (Container-Width, Card-Behandlung, Form-Field-Breite), dann Bau. Hat im Layout-Saga den Ausweg gefunden (`c3e7dbb`).

4. **Diminishing-Returns-Disziplin:** Nach drei Smoke-Iterationen ohne sichtbaren Fortschritt → Push trotzdem (Stand objektiv besser als Vor-Stand) + Backlog-Item für vollen Polish. Beim vierten Versuch saß's dann doch (`d95f9a2`) — aber die Disziplin hätte auch früheren Push mit Verweis auf #121 erlaubt.

**Side-Task — NanoClaw-Inspiration Cross-References (Commit `a3a96d8`):**

Vier existing Backlog-Items um NanoClaw-Inspirations-Verweise erweitert: #29 + #30 (Multi-Channel-Adapter, Skills-driven Channel-Install + Container-Isolation), #36 (Google A2A, Credential-Vault), #116 (Conversational Install, `/add-<name>`-Pattern + AI-native Onboarding). Pattern-Bestätigung für `examples/skills/`-Foundation (Tag 20).

**Stand Block 4 nach Tag 21:**

- #110 Onboarding-Wizard: Phase 1 ✅ (Endpoint), Phase 2A ✅ (Step-Removal + Layout)
- #110 Phase 2B offen (Tag 22+): Persona-Kollaps (M), MCP-Hyperbrowser-Step (M), Hard-Trigger in /chat (XS), Settings-Button für Wizard-Re-Aufruf (S)
- #109 DEPLOYMENT.md + #111 Public-Repo-Hygiene: weiter offen, Reihenfolge nach #110-Closure
- #121 Wizard-Layout-Polish: offen, Phase-B-Kandidat — w-full-Pattern + Container-Width-Hierarchie aus Phase 2A als Foundation

**Pre-Launch-Phase A Bilanz nach Tag 21:**

- Block 1: ✅ 11/11 (Tag 18, deployed)
- Block 2: ✅ 2/2 (Tag 19, deployed)
- Block 3: ◐ 1/2 (#107 ✅, #108 in Block 4/5)
- Block 4: ◐ 0.5/3 (#110 zur Hälfte durch, #109 + #111 offen)
- Block 5: 0/4 offen

Bei 21 Tagen verfügbar (Tag 21 → Tag 42) und Block 4-Rest + Block 5 zusammen ~13-15 Tage kalkuliert bleiben ~6-8 Tage Reserve.

## Tag 20 (20. Mai 2026, Mittwoch) — Pre-Launch-Phase A Block 3 #107

**Vorabend Tag 19 — #107 Backend (Commit `fb303de`):**

Nach Block-2-Closure noch ein Backend-Block desselben Tages. Schema-Erweiterung (`triggerMode`, `triggerCondition`, `requiresTools` im `SkillManifestSchema`), Provider-Classifier-Map mit 5 Providern (Haiku/Mini/Flash/Llama/Twin-Default), Pre-Pass-Layer im `runModel` (conditional + 3s AbortController-Timeout), Recherche-Skill-Template (lokal-only via `skills-templates/.gitignore`), Persona-Block für Mode-2-Recherche-Vorschlag. Phase-1.1-Diagnose hatte vorab vier Punkte korrigiert:

- Classifier-Model im Boot konstruieren (statt Send-Path) — kein Crypto-Leak in Send-Layer
- `generateObject` + Zod-Enum statt `generateText`-mit-Trim/Lowercase (Pattern-Reuse von `ExtractionEngine`)
- User-Picker-Priorität explizit (`!options.forcedToolChoice` als Pre-Pass-Bedingung; 3.2.H bleibt härter Override)
- Position: nach `buildMcpToolsFromSkills`, vor `forcedTool`-Resolution

Backend-Smoke 2/2 grün: Test 1 echte Recherche (113s, Multi-Step-Followup gegriffen), Test 2 No-Match 2.8s.

**Vormittag Tag 20 — Frontend-Phase-1.1-Diagnose (Stop-Punkt):**

Vor Frontend-Bau eine zweite Diagnose-Phase. Findings haben das Original-Briefing strukturell gekippt:

- `AuditEntry` hat KEIN `kind`-Field (Discriminator ist `capability`), kein `serverName`. Briefing-Pseudocode (`a.kind === 'tool-call' && a.serverName === 'hyperbrowser-approval'`) funktioniert so nicht
- Auto-Approve-Tool-Calls werden NICHT als separate Audit-Rows persistiert. Tool-Calls landen erst final im `owner-direct.output.toolCalls` am Cycle-Ende — Live-View hätte nichts zu pollen
- SSE-Stream emittiert während Recherche-Cycles nur `twin.thinking` + `twin.idle`, bis zum Audit-Ende opak
- Vier Architektur-Optionen aufgestellt (A Per-Tool-Call-Audits, B SSE-only, C Inkrementeller owner-direct-Audit, D Phasen-Spinner)
- **Setzung: Option B (SSE-Events ohne DB-Persist), Tab-Reload-Variante 1.** Live-State ephemer; Tab-Reload verliert ihn, generic "twin denkt nach…" als Fallback. Keine Audit-DB-Inflation durch große Scrape-Outputs, klares Live-vs-Historisch-Separation
- `research_first_use_seen`-Spalte existierte nicht (Patch 8 aus Tag-19-Briefing war Frontend-Scope) → Migration 022 nötig

**Mittag-Nachmittag — #107 Frontend (Commits `150cdc8` + `d349da4`):**

Drei Patches plus Backlog-Eintrag.

- Patch 1 (Backend SSE): `TwinEventSchema` um `tool.call.start` + `tool.call.complete` erweitert (additive Discriminator-Union). `tool-bridge.execute()` mit neuem `BuildMcpToolsInput.bus`-Field + Args-Truncation 500 chars pro String-Feld. Failure-Pfad emittiert Complete-Event mit `status='failed'` *vor* dem Re-Throw, sonst sähe das Frontend den Fehlschlag nie. `bus` durchgereicht aus `twin-service.ts:1485`.
- Patch 2 (Live-Progress): `useToolCallStream`-Hook in `apps/web/lib/` (eigene EventSource, ephemerer Map keyed by `callId`, race-safe twin.idle-Karenz 1.5s — schneller nächster Cycle bricht den Timer ab). `ResearchLiveProgress`-Component (Hyperbrowser-Prefix-Filter, Pulse-Icon auf running, Domain-Extract bei scrape, Failed-Inline-Hinweis). Integration in DirectChat ersetzt "twin denkt nach…" bei aktiven Tool-Calls; bei busy ohne Tool-Calls bleibt der alte Indikator.
- Patch 3 (First-Use-Hint): Migration 022 (`research_first_use_seen INTEGER NOT NULL DEFAULT 0`), `markResearchFirstUseSeen`-Repo-Methode (idempotente UPDATE, nicht via patch-Update), `runModel` returnt `prePassSkillName`, `runOwnerDirect` flippt Flag genau einmal und setzt `firstUseHint='research'` im Return. `ResearchFirstUseModal` (ModalWrapper-basiert, 3-Bullet-Beta-Hint). `sendChat` liest jetzt Response-Body (war vorher reiner Audit-Stream-Driver — Pattern-Bruch dokumentiert).

Browser-Smoke Tag 20:

- **Test 1 (Mode-1 Recherche): grün** — Live-Progress sichtbar während ~60s Cycle, Tool-Calls sequenziell mit Status-Wechsel ○→✓, Domain-Anzeige bei scrape, First-Use-Modal erstmalig erschienen
- **Test 5 (zweite Recherche): grün** — kein Modal, DB-Flag `research_first_use_seen=1` verifiziert
- **Test 6 (Skill-Deaktivierung): modifiziert grün** — Pre-Pass blockt korrekt (kein `forcedToolChoice` in Logs, DB-State sauber), aber LLM ruft `search_with_bing` weiterhin via `toolChoice='auto'` aus Memory + Persona-Pattern + Tool-Availability. Strukturell richtig (Tag-16-Designprinzip "Tool-Aufruf darf nur Fallback sein"), aber UX-Konsequenz für späteres Item dokumentiert (#119)
- **Emergent positiv:** Memory-Persistierung über mehrere Recherche-Cycles funktioniert. Twin macht proaktiv "haben wir schon recherchiert"-Hint statt redundanter Tool-Calls — Memory-Tiefe-Story aus der Differenzierungs-Vision wirkt im Edge-Case bereits

**Doku-Welle:**

- BACKLOG #119 (Skills-Deaktivierung-Pre-Pass-Trennung) emergent aus Test 6 (Commit `d349da4`) mit drei Lösungs-Optionen (MCP-Server-Toggle, Skill-aware Tool-Filtering, autonomes-Tool-Use-Setting)
- Tag-20-Closure (dieser Stand-Update)

**Production-Deploy ausstehend.** VPS auf `56cb0dc` (Tag-18-Stand). Drei-Tage-Drift im Stack: Tag 18 (Block 1, 11 Items), Tag 19 (Block 2 #105/#106 + #107 Backend), Tag 20 (#107 Frontend). Migrations 020, 021, 022 alle neu für Prod. Deploy wartet auf Bestätigung von Markus.

**Block-3-Stand nach Tag 20:**

- #107 vollständig (Backend `fb303de` + Frontend `150cdc8`)
- #108 (Beta-Deklaration in README/Landing) verbleibt — XS, keine Architektur-Arbeit
- #119 als Befund-Item für später (nice-priority, kein Block-3-Blocker)

**Nachmittag Tag 20 — Block-4-Strategy-Session + #120:**

Plus #120 Dockerfile-Fix (Commits `3041710`, `013b499`):

- `COPY examples /app/examples` im Runner-Stage
- `.dockerignore`-Negation für `examples`-md (emergenter Befund, global `*.md`-Ausschluss filterte `SKILL.md` aus)
- Verifikation im Image-Container 4/4 grün
- Closes #120

Block-4-Strategy-Session mit 12 Setzungen durchgegangen (Audience A primär, #110 → #109 → #111 als Reihenfolge, Apache 2.0 als LICENSE, Plain Docker + Traefik als Cookbook-Stack, Hard-Trigger-Wizard mit minimaler Persona und Default-Mandates).

Strategy-Doc: `docs/BLOCK-4-STRATEGY.md`.
Erwartete Block-4-Größe: ~8.5 Tage Bau.

Bau startet Tag 21 mit #110 Wizard Backend.

**Plus Docs-Cleanup:** Phase-3.4 + Phase-3.5 historische Strategy-Docs (5 Files) nach `docs/archive/` verschoben. `docs/archive/README.md` mit Inventar. Aktive Strategy-Docs in `docs/` bleiben unverändert. Git-History erhalten via `git mv`. Atomic-Refactor: ~7 Source-Code-Refs (`apps/runtime/src/episodic/`, `config.ts`) plus `ROADMAP.md` und `PRE-LAUNCH-A-STRATEGY.md` auf neue Pfade umgebogen.

**Pre-Launch-Phase A Bilanz nach Tag 20:**

- Block 1: ✅ 11/11 (Tag 18, deployed)
- Block 2: ✅ 2/2 (Tag 19, deployed)
- Block 3: ◐ 1/2 (#107 vollständig + deployed, #108 sequentiell mit #111 in Block 4 / Block 5)
- Block 4: 0/3 offen — Strategy done, Bau startet Tag 21 (#110 → #109 → #111, ~8.5 Tage)
- Block 5: 0/4 offen — Strategy noch offen

Bei 22 Tagen verfügbar (Tag 20 → Tag 42) und Block 4+5 zusammen ~15-17 Tage kalkuliert bleiben ~5-7 Tage Reserve.

## Tag 19 (19. Mai 2026, Dienstag) — Pre-Launch-Phase A Block 2

**Vormittag — Diagnose Phase 1.1 für Block 2 (~30 Min):**

Vor dem Bau für #105/#106 eine fokussierte Diagnose-Session.
Hypothese A (orthogonale Items, getrennt baubar) bestätigt:
- Chat-Monolith 1700+ Zeilen mit 15 Inline-Functions/Components
- A2A-Flow erzwingt Erst-Message im NewConversationModal,
  A2AChat-EmptyState ist toter Pfad
- DirectChat ist Audit-Log-Viewer, nicht Konversations-View
- Empfehlung Build-Reihenfolge #105 → #106 übernommen

**Mittag-Nachmittag — #105 A2A-Modal (Commit `49e059e`):**

Drei Patches plus zwei Architektur-Bugs während Bau:

- Patch 1: Backend `POST /twins/:handle/conversations/:partner`
  (Start ohne Send, idempotent via `getOrStart`, Bridge-Handle-
  Validation analog zur Send-Route)
- Patch 2: `NewConversationModal` Content-Feld optional, Submit-
  Button-Label dynamisch "Starten" vs "Senden"
- Patch 3: A2AChat-EmptyState reaktiviert mit Partner-Name-Hint
- **Bug 1:** Fastify `FST_ERR_CTP_EMPTY_JSON_BODY` bei POST mit
  `application/json` aber leerem Body. Fix: `JSON.stringify({})`
  statt body weglassen.
- **Bug 2:** Sidebar-Filter-Architektur. List-Endpoint baute nur
  aus Bridge-Partner-Aggregat, ignorierte lokale `conversations`-
  Rows. Pre-#105 maskiert (Konvs entstanden nur via Send), post-
  #105 echter UX-Bug. Fix: neue `listActiveByOwnerAndTwin`-Repo-
  Methode, Merge nach Bridge-Aggregat mit Filter (no-self, no-
  bridge-duplicates).
- Sub-Bug `status: null` in List-Response durch `ConversationItem`-
  Interface-Erweiterung mitgelöst.
- Browser-Smoke 4/4 grün.

**Nachmittag — #106 DirectChat-View-Architektur (Commit `412326b`):**

Strategy-Session mit 6 Setzungen vor Bau (Mental-Model Mix,
Persistierung β.1 `last_reset_at` als neue Spalte, Toggle-UI
Inline-Hint, UI-State only, nur Direct-Chat, EmptyState wie
brand-new). Phase-1.1-Diagnose enthüllte drei Architektur-Punkte
die das Original-Briefing nicht antizipiert hatte:

- Reset endet heute alte Konv + lazy-startet neue beim nächsten
  Send. Für `last_reset_at` muss Eager-Start (Option β):
  Reset endet alte + startet sofort neue mit `lastResetAt = NOW()`.
- `ChatBlock` hat kein timestamp-Feld → AuditEntries-Filter
  VOR `buildChatBlocksFromAudits`, nicht ChatBlock-Filter.
- Detail-Endpoint hat heute kein `conversation`-Object →
  Erweiterung mit `{id, status, startedAt, endedAt, lastResetAt}`.

Vier Patches plus Sub-Bug:

- Patch 1: Migration 020 + Repo + Reset-Endpoint mit Eager-Start
  + Detail-Endpoint mit Conversation-Metadata
- Patch 2: Frontend AuditEntries-Filter mit `showFullHistory`-
  State (Default false, UI-only)
- Patch 3: `ResetMarker`-Component (analog `ConversationDivider`)
  mit Toggle-Link "Vorherige anzeigen/verbergen"
- Patch 4: Post-Reset-EmptyState mit Tutorial-Wording wie
  brand-new Twin
- **Sub-Bug:** Detail-Endpoint Self-Chat. Bridge-Call mit
  `partner === handle` wirft 502 (Self-Reference). Fix:
  `isDirectChat`-Konditionalisierung, Direct-Chat überspringt
  Bridge-Call (Audit-Stream ist Truth-Source).
- Backend-Smoke 4/4 grün, Browser-Smoke 7/7 grün.

**Doku-Wellen:**

- BACKLOG #118 (Konversations-Lifecycle-UI) emergent während
  #105-Bau angelegt (Commit `74f7d5d`)
- Tag-19-Closure (dieser Stand-Update)

**Production-Deploy ausstehend.** VPS auf `56cb0dc` (Tag-18-
Stand). Tag-19-Stand-Deploy wartet auf Tag 20+.

**Block-2-Stand nach Tag 19:**
- 2 von 2 Items durch (#105, #106)
- #96 mit Block-2-Closure vollständig funktional (Probleme A+B
  beide gelöst, war nach Tag 18 noch partially functional)
- Block 2 von Pre-Launch-Phase A vollständig

**Pre-Launch-Phase A Bilanz:**
- Block 1 ✅ 11/11 (Tag 18)
- Block 2 ✅ 2/2 (Tag 19)
- Block 3: 0/2 offen (#107 Recherche-Workflow, #108 Beta-Deklaration)
- Block 4: 0/3 offen (#109 DEPLOYMENT-Test, #110 Onboarding-Wizard,
  #111 Public-Repo-Hygiene)
- Block 5: 0/4 offen (#112 Landing, #113 Demo, #114 Launch-Posts,
  #115 Timing)

## Tag 18 (17. Mai 2026, Sonntag) — Pre-Launch-Phase A Block 1

**Vormittag (Strategie):**

Phase-3.6-Strategie-Session löste Roadmap-Pivot aus
(Computer-Use als Edge-Case für MVP erkannt). Setzung:
**Pre-Launch-Phase A** mit Self-Hosting-Launch in ~6 Wochen,
Differenzierungs-Story Memory + Persona + A2A-Bridge statt
Computer-Use. Phase 3.6 verschoben auf Phase B.

Verankerung in 4 Doku-Files (Commit `5fefcbe`):
- `docs/PRE-LAUNCH-A-STRATEGY.md` (neu, Commit `53120a1`)
- `docs/BACKLOG.md` (9 neue Items #107–#115 für Block 3/4/5)
- `docs/STAND.md` (Pre-Launch-Phase A statt "Phase 3.6")
- `docs/ROADMAP.md` (Phase 3.6 als "verschoben")
- `docs/UX-STRATEGY.md` (Verhältnis zu Pre-Launch-Phase A)

TWIN-VISION.md per Setzung unverändert.

**Mittag-Nachmittag (5 Items gebaut + gepusht):**

- **#95 Tool-Names human-readable** (Commit `ece8109`)
  - `apps/web/lib/tool-display.ts` mit `resolveToolDisplay()`
    + `formatArgs()` für 13 bekannte Tool-Patterns
  - Hyperbrowser + Everything-Server gemappt
  - Generic Title-Case-Fallback mit Mono-Identifier-Hint
  - Integration in Inbox + Chat + Reject-Modal
  - Tranche A damit komplett abgeschlossen

- **#100 Memory-Hit-Indikator** (Commit `3eb645b`) — Vision-Pattern 1
  - Backend `RetrievalResult.createdAt` + `audit.output.memoryHits` als SSoT
  - `apps/web/components/MemoryHitBadge.tsx` mit Mono-Stil +
    Expand-on-Click
  - Snippets gruppiert nach `targetType` (Vergangenes Gespräch /
    Auszug / Eigene Notiz)
  - Nur DirectChat-Integration (A2AChat hat kein Memory-Pfad)
  - Browser-Smoke 🟢🟢🟢 mit echten Hits

- **#98 Cost-Preview vor Approve** (Commit `12aad33`)
  - `apps/web/lib/tool-cost.ts` mit `estimateToolCost()` +
    `formatEstimate()`
  - Heuristik-Tabelle für 16 Tools (9 Hyperbrowser + 7 Everything)
  - Vier Display-Branches (Fallback / kostenlos / mit-cost /
    nur-Latenz)
  - Deutsche Komma-Notation via `toLocaleString("de-DE")`
  - Integration nur in Pending-States (nicht executed/rejected)

- **#101 Twin-Reife-Anzeige** (Commits `63b423f`, `b6a88ef`,
  `3a964fb`) — Vision-Pattern 2
  - Strategy-Session vorab (4 Stufen, Heuristik-Mix,
    Chat-Header+Settings, Stufe+Progress+Stats-Detail)
  - Backend `TwinMaturityService` mit 4-Dimensionen-Heuristik
    (Konvs + Facts + Themen + Zeitspanne)
  - Greedy-Cosine-Clustering für Themen-Vielfalt
    (kalibriert: Threshold 0.85, Schwellen [2,5,12])
  - Frontend MaturityBadge im Chat-Header (Dauer-Sichtbarkeit) +
    MaturityDetail in Settings (Stats + Progress + Was-fehlt)
  - Edge-Case verifiziert: @florian-Twin zeigt "Onboarding · 0%"
  - @markus jetzt auf Stufe "Bewohnt · 66% bis Vertraut"

- **#99 Audit-Trail menschlich** (Commits `3d70f82`, `b1ba6ea`) —
  Vision Vererbung
  - Phase-A-Diagnose: Backlog-Verständnis korrigiert (echtes
    Problem: reiche Audit-Daten unsichtbar, nicht Roh-JSON)
  - `apps/web/lib/token-cost.ts` mit Opus-4.7-Pricing +
    `formatRelativeTime`
  - `apps/web/lib/audit-render/` mit 4 Template-Klassen +
    Generic-Fallback
  - Inbox-Audit-Log Click-to-Expand mit AuditDetailRenderer
  - Heavy Reuse: #95 (Tool-Names), #98 (Cost), #100 (MemoryHits)
  - Browser-Smoke 5/6 explizit grün

- **#86 Skill-Editor-UI** (Commits `4efe6d5`, `2788b72`) — Block 1
  - Diagnose: M nicht L (SkillRepo-Methoden existierten schon)
  - 4 Backend-Routes mit Manifest-Spiegelung (Bug während Bau gefixt)
  - SkillEditorModal mit Multi-Field-Form, Manifest-Textarea ohne
    name/description (Spiegel-Pattern)
  - ModalWrapper um maxWidthClass-Prop erweitert
  - Add+Edit+Delete für manual-Skills, MCP-Skills read-only
  - Browser-Smoke 6/6 grün

- **#87 MCP-Configurator-UI** (Commits `8e12c43`, `a2336bf`) — Block 1
  - Diagnose: M nicht L (CLI-Helper wiederverwendbar, kein
    Service-Modul-Refactor nötig)
  - Strategy-Session: Textarea-Paste, Inline-ENV-Form, Cascade-
    Warnung, kein Edit MVP
  - 4 Backend-Routes mit Sensitive-Felder-Disziplin
  - McpServerAddModal mit Spec-Validation + ENV-Marker-Detection
  - MCP-Section in Settings vor Skills (kausale Reihenfolge:
    MCP liefert Skills)
  - Cascade-Delete-Banner mit Skill-Count, Toast mit deletedSkills
  - Browser-Smoke 6/6 grün

- **Sticky Header für Inbox/Facts/Stream/Settings** (Commit `79d40c0`)
  - One-Line-Fix: `sticky top-0 z-40 bg-bg` in AppHeader
  - /chat unverändert (Chat hat fixe Viewport-Höhe + internes Overflow)
  - z-40 (statt z-50) damit Modals/Dropdowns drüber rendern

**Nicht-gepusht / nicht-akut Backlog:** keine

**Block-1-Stand nach Tag 18:**
- 11 von 11 Items adressiert:
  - 10 vollständig durch: #94, #91, #95, #97, #100, #98, #101, #99, #86, #87
  - 1 partially functional: #96 (Architektur-Follow-ups #105/#106 in Block 2)
- Block 1 von Pre-Launch-Phase A vollständig

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

Block-1-Bau-Stand (vollständig nach Tag 18):
1. ✅ #95 Tool-Names human-readable (Commit `ece8109`)
2. ✅ #100 Memory-Hit-Indikator (Commit `3eb645b`)
3. ✅ #101 Twin-Reife-Anzeige (Commits `63b423f`, `b6a88ef`, `3a964fb`)
4. ✅ #98 Cost-Preview vor Approve (Commit `12aad33`)
5. ✅ #99 Audit-Trail menschlich (Commits `3d70f82`, `b1ba6ea`)
6. ✅ #86 Skill-Editor-UI (Commits `4efe6d5`, `2788b72`)
7. ✅ #87 MCP-Configurator-UI (Commits `8e12c43`, `a2336bf`)

Plus Welle-1-partial:
- ✅ #96 Empty-State Chat (partially functional, architektonisch
  limitiert; Architektur-Follow-ups #105/#106 in Block 2)

**Block 1 von Pre-Launch-Phase A abgeschlossen.** Nächstes ansteht:
Block 2 (#105/#106), Block 3 (#107/#108), Block 4 (#109/#110/#111),
Block 5 (#112/#113/#114/#115).

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

## Lessons Tag 20

**1. Phase-1.1-Diagnose vor Frontend-Items fängt Briefing-Drift ab.** Der #107-Frontend-Briefing-v1-Pseudocode (`audits.filter(a => a.kind === 'tool-call')`) ist von einem Audit-Stream-Modell ausgegangen, das es im Code so nicht gibt — kein `kind`-Field, keine Per-Tool-Call-Audits im Auto-Approve-Pfad, opaker SSE-Stream während des Cycles. Diagnose hat das vor Bau aufgedeckt; Briefing v2 wurde komplett neu skizziert (Option B SSE-only statt Audit-DB-Persist). Größen-Schätzung blieb stabil (M-L, ~3.5h tatsächlich), Architektur ist sauberer als die Original-Variante.

Lehre: bei Frontend-Items, die auf Backend-State pollen oder filtern, Audit/Event-Schema vor Bau im Code verifizieren — nicht aus Briefing-Pseudocode ableiten. Zwei Tag-Sessions in Folge (Tag 19 #106, Tag 20 #107) haben Phase-1.1 vor Bau Architektur-Drift gestoppt. Pattern verfestigen.

**2. Smoke-Befund "unerwartetes Verhalten" — vor Bug-Fix gegen Vision prüfen.** Test 6 zeigte, dass ein deaktivierter Skill den Pre-Pass-Trigger blockt, aber den LLM nicht daran hindert, Tools autonom zu rufen. Erste Reaktion war "Bug — Skill-Toggle sollte alles blocken". Bei näherer Betrachtung Vision-konform: Tag-16-Designprinzip "Tool-Aufruf darf nur Fallback sein" verlangt genau diese Autonomie. Skill-Toggle steuert *Trigger-Aktivierung*, nicht *Tool-Verfügbarkeit*. Trennung in #119 mit drei Lösungs-Optionen festgehalten.

Lehre: bei Smoke-Tests mit überraschendem Verhalten prüfen, ob das emergente Verhalten dem Vision-Prinzip entspricht, bevor ein Fix-Item entsteht. Manchmal ist der Test-Case zu eng formuliert ("Skill aus → Tool aus"), nicht das System fehlerhaft. Test 6 ist deshalb "modifiziert grün", nicht "rot".

**3. Response-Body als Side-Channel zum Audit-Stream — bewusst dokumentieren.** `sendChat` hat bis Tag 20 den Response-Body ignoriert und vertraute komplett auf `loadAudits()` als SSoT. Für `firstUseHint` ist der Body aber die einzige sinnvolle Quelle, weil das Flag-Signal kein persistiertes Audit-Field ist (es ist ephemerer Lifecycle-State). Pattern-Bruch zum bisherigen "Audit-Stream = SSoT", aber gerechtfertigt. Im Code-Kommentar an der Stelle dokumentiert, damit zukünftige Reads den Grund verstehen.

Lehre: wenn ein etabliertes Daten-Pattern (Audit-Stream-only) gebrochen wird, an der Bruchstelle den *Grund* festhalten, nicht nur das *Was*. Sonst wird die Inkonsistenz später für einen Cleanup-Kandidaten gehalten.

## Lessons Tag 18

**1. Two-Phase-Briefing mit Stop-Punkt für Vision-kritische Items.**
Bei #100 und #101 hat Phase-A-Diagnose / Phase-1.7-Smoke jeweils
Backend-Annahmen korrigiert *vor* dem UI-Bau:
- #100: "Episodic vs Semantic"-Aufteilung existierte im Backend
  nicht (drei `targetType`s statt zwei Memory-Klassen) → Briefing
  angepasst auf "alle drei targetTypes zusammen"
- #101: `topicCount = 0` bei Phase-1.7-Smoke aufgedeckt →
  `summary_segment`-Pipeline existiert, hat aber für Pilot-Twins
  keine Daten → Switch auf `conversation`-Embeddings

Lehre: bei Vision-Items mit Backend-Foundation lohnen Diagnose-/
Smoke-Stops zwischen Phasen. Verhindert Bau in falscher Richtung.

**2. Empirische Kalibrierung von Heuristik-Werten dauert mehrere
Iterationen — und das ist okay.** Bei #101 brauchten wir drei
Threshold-Iterationen (0.7 → 0.8 → 0.85) plus Topic-Schwellen-
Anpassung ([3,8,20] → [2,5,12]) bevor `topicCount` plausibel war.
Im Code dokumentiert mit Pilot-Daten-Begründung. Re-Kalibrierung
mit Phase-B-Diversity-Daten ist eingeplant.

Lehre: Cluster-Threshold ist datenabhängig, nicht theoretisch
optimal. Conversation-Embeddings sind dichter beieinander als
generische Embeddings — brauchen strengere Threshold-Werte als
Standard-Empfehlungen.

**3. `audit.output` ist SSoT für UI-State, nicht Response-Body.**
Bei #100 hat Claude Code eine Architektur-Korrektur gemacht:
Memory-Hits müssen in `audit.output.memoryHits` persistiert werden
(nicht nur im Response-Body), weil das Frontend nach Reload den
Audit-Stream re-lädt, nicht den ursprünglichen Chat-Response.
Briefing hatte das nicht abgefangen.

Lehre: bei UI-Items, die nach Reload sichtbar bleiben sollen, an
Audit-Persistenz denken — Briefings sollten das explizit fragen.

**4. Pattern-Reuse mit Variation > erzwungene Generalisierung.**
MemoryHitBadge (#100) und MaturityBadge (#101) teilen visuelle
Sprache (Mono, Border, dezent), aber unterschiedliche Interaktion
(Expand-in-Chat vs. Navigation zu Settings). Wir haben **nicht**
versucht, eine generische `<VisionBadge>`-Komponente zu
abstrahieren. Konsistenz entstand durch Pattern-Disziplin, nicht
durch shared Code.

Lehre: bei zwei ähnlichen Items das zweite *nicht* abstrahieren,
sondern konkret bauen. Abstraktion lohnt sich erst bei drei+
Instanzen mit klar identischen Anforderungen.

**5. Phase-A-Diagnose korrigiert Backlog-Verständnis.** Bei #99
hat die Diagnose gezeigt, dass das Backlog-Body veraltet war:
"Roh-JSON sichtbar" war nicht mehr der akute Pain Point (Inbox-
Pending war schon menschlich nach #95/#98), sondern "reiche
Audit-Daten unsichtbar". Phase-A-Diagnose verhindert Bau in der
falschen Richtung — und manchmal ist die Wahrheit: das eigentliche
Problem hat sich verändert seit das Backlog-Item geschrieben wurde.

Lehre: bei Items aus älteren Strategie-Sessions vor Bau prüfen ob
Akut-Pain noch matched. Backlog-Body ist Snapshot, nicht Wahrheit.

**6. Pre-Launch-Phase A Block 1 in einem Tag durchgebaut.** Block 1
hat 11 Items (10 voll + #96 partially functional), Tag 18 hat 8 davon
vollständig gebaut plus alle Vormittag-Pivot-Doku plus Sticky Header
plus drei Doku-Wellen. Möglich war das durch:

(a) **Diagnose-vor-Bau-Disziplin (Phase 1.1)** — drei Items (#99, #86,
#87) wurden dadurch von L auf M reklassifiziert mit ~6h Zeitbudget-
Gewinn. #99 deckte auf, dass das Backlog-Body veraltet war (echtes
Problem ist "reiche Audit-Daten unsichtbar", nicht "Roh-JSON sichtbar").
#86 und #87 zeigten, dass die Repo-/Service-Schicht (`SkillRepo`,
`McpServersRepo`, `McpSkillSync`, `McpClientManager`) komplett
wiederverwendbar war — nur Routes mussten exposed werden.

(b) **Pattern-Reuse zwischen Items** — #99-Templates wurden aus #95/#98/
#100 zusammengesetzt (resolveToolDisplay, estimateToolCost,
MemoryHitBadge). #86-Edit-Modal-Pattern (ModalWrapper + Multi-Field-
Form + zweistufige Delete-Confirm + Inline-Validation) wurde in #87
wiederverwendet. Konsistente Visual-Sprache durch Pattern-Disziplin,
nicht durch shared Code.

(c) **Sammel-Doku am Tagesende statt Stück-für-Stück** — eine STAND-
Welle nach 4 Bauten, eine nach #99, eine zur Tages-Closure. Plus
BACKLOG-Closures in Drei-Items-Wellen. Spart 5-10 Min pro Item gegen
Stück-für-Stück-Doku.

Lehre: Block-Planung in M-Items mit Diagnose-Stop ist realistischer
als L-Klassifizierung mit Strategy-Session-Buffer. Über sieben
Bau-Items (heute) wurden drei Strategy-Sessions tatsächlich nötig
(#101 vorab, #87 vorab, plus #99 als Diagnose-driven Re-Scope) — der
Rest lief mit Phase-1.1-Diagnose ohne Session durch.

## Lessons Tag 19

**1. Diagnose-Phase 1.1 mit Stop-Punkt bewährt sich weiter.** Bei #106
hat die Diagnose drei Architektur-Punkte aufgedeckt, die das Original-
Briefing nicht antizipiert hatte: Eager-Start statt Lazy-Start für
`last_reset_at`-Persistierung, AuditEntries-Filter statt ChatBlock-
Filter (ChatBlock hat kein timestamp-Feld), Detail-Endpoint braucht
Conversation-Metadata-Erweiterung. Stop-Punkt nach Diagnose
ermöglichte Setzungs-Konkretisierung vor Bau, statt Briefing-
Annahmen blind umzusetzen.

Lehre: bei Items mit Daten-Modell-Touch zahlt sich Phase-1.1 immer
aus — die ersten 15-30 Min Diagnose sparen Stunden falscher Bau-
Richtung.

**2. Architektur-Bugs werden durch neue Features sichtbar.** Zwei
Beispiele aus Tag 19:

- **Sidebar-Filter-Bug:** List-Endpoint baute seit jeher nur aus
  Bridge-Partner-Aggregat, ignorierte lokale `conversations`-Rows.
  Pre-#105 maskiert, weil Konvs nur über Bridge-Send entstehen
  konnten. Mit #105 (Start ohne Send) wurde der Architektur-Bug
  zum echten UX-Bug — neue A2A-Konvs waren in der Sidebar
  unsichtbar.

- **Detail-Endpoint-Self-Bug:** Bridge-Call für `partner === handle`
  war immer semantisch falsch (Self-Reference, keine Bridge-Messages
  möglich). Aber: pre-#106 wurde der Endpoint für Direct-Chat gar
  nicht aufgerufen — Frontend lud nur den Audit-Stream. Mit #106
  Detail-Erweiterung (`lastResetAt`-Feld) wurde der Self-Call zum
  echten Bug, kommt mit 502 zurück.

Lehre: bei jedem neuen Feature, das einen alten Endpoint anders
nutzt, an die Maskierungs-Schicht denken. Phase-1.1 sollte explizit
fragen "wer hat diesen Endpoint heute schon gerufen, und wie?".

**3. Pattern-Reuse über mehrere Bauten hinweg verstärkt sich.**

- `EmptyState`-Component aus Tag 17 (#96/#97) wurde von #105 für
  A2A reaktiviert und in #106 für Post-Reset-State wiederverwendet
  — drei Bauten, eine Component.
- `formatRelative` aus #99 läuft in 3 Kontexten (Audit-Templates,
  MaturityDetail, ResetMarker).
- `ConversationStartInputSchema`-Erweiterung für `lastResetAt`
  nutzt das Start-Pattern, das #105 etabliert hat (Konv-Anlage
  ohne Send). Symmetrische Architektur entsteht durch Disziplin
  über mehrere Bauten, nicht durch upfront-Design.

Lehre: lieber bestehende Components erweitern als neue parallel
bauen. Selbst wenn das Erweitern 30 Min mehr kostet, vermeidet es
Doppel-Pflege.

**4. Eager-Start statt Lazy-Start als Reset-Pattern.** Reset hat
heute zwei Lifecycles: alte Konv enden (sofort) + neue Konv starten
(lazy beim nächsten Send). Für `last_reset_at`-Persistierung musste
das auf Eager-Start umgestellt werden, weil sonst die Boundary
nicht greift. Plus: AuditEntries-Filter statt ChatBlock-Filter
(Audits haben native `timestamp`, ChatBlocks nicht). Plus: Fastify
`FST_ERR_CTP_EMPTY_JSON_BODY`-Pattern — `Content-Type: application/
json` verlangt valides JSON-Body, leerer Body wirft 400. Lösung:
`JSON.stringify({})` statt body weglassen.

Lehre: bei Tracking-Daten (was wurde wann gemacht?) gilt
Eager-Persist > Lazy-Persist. Lazy spart einen Insert, kostet aber
Korrektheits-Schwierigkeit.
