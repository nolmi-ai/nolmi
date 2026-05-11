# twin-lab — Stand

**Letztes Update:** 11. Mai 2026, Abend (Tag 12)

## Aktuell in Arbeit
Nichts. **Phase 3.3 (Memory: Conversation + Semantic) lokal komplett.**
Neun Commits in einer Session, alle sieben Sub-Schritte (A, B, C, D, E,
F, G1, G2, G3) durch — Schema/Repos, Summary-Engine, History-Loader,
Facts-API+CLI, Facts-im-Prompt, Twin-Extraction mit Approval-Gate, plus
drei UI-Sub-Schritte (Inbox-Render, Facts-Settings-View, Manual-Extract
+ Reset-Modal). Alle Tests grün, alle UI-Pfade verifiziert mit echtem
Twin.

**Phase 3 Definition of Done — 3 von 5 Häkchen** (3.1 + 3.2 + 3.3).

Nächster Block: Production-Deploy Phase 3.3 auf VPS, dann Strategie-
Session vor 3.4 (Memory: Episodic mit sqlite-vec + Embeddings).

## Heute (Tag 12) abgeschlossen

### Phase 3.3 — Memory: Conversation + Semantic — komplett

Strategie-Session morgens: Cognee (knowledge-engine.ai, 16.6k Stars)
und Anthropic Managed-Agents-Dreams als externe Inspirationen geprüft.
Beide spannend, aber Eigen-Bau für 3.3 festgehalten — Anti-Lock-in,
Provider-Agnostik, Pilot-Größe rechtfertigt keine externe Dependency.
Beide als Backlog-Items dokumentiert (#93 Cognee als optionaler MCP-
Skill, #94 Dream-Pattern für Memory-Kuratierung).

**3.3.A ✅ Schema + Repos (Commit `9b4d5c5`, +972)**

Migrations 013-015 plus zwei neue Repos. Foundation für beide Memory-
Schichten ohne Business-Logic, Pattern wie 3.2.A.
- 013 `conversation_summaries` mit FK auf conversations+audit, CASCADE
- 014 `facts` Multi-Tenant pro twin_id, UNIQUE(twin_id, fact_key),
  source ∈ {user, twin, import}, confidence ∈ {approved, pending, auto}
- 015 audit.capability Doku-No-op (offenes TEXT-Feld)
- ConversationSummariesRepo + FactsRepo mit upsert-Semantik
- ENV-Tunables: CONVERSATION_SUMMARY_THRESHOLD=50,
  CONVERSATION_SUMMARY_BATCH_SIZE=40, CONVERSATION_LIVE_WINDOW=10
- 13 Tests grün gegen :memory:-DB

**3.3.B ✅ Summary-Engine im Send-Path (Commit `9fc1ebb`, +880)**

Sliding-Window-Memory: bei >50 zählenden Messages werden die ältesten
40 vom Twin selbst zu einer Markdown-Summary verdichtet, mehrere
Summary-Segmente pro Konversation möglich.
- SummaryEngine mit Function-injizierter LLM (Test-Mock-Pattern)
- Counting nur für respond_to_chat + owner-direct (Tool-Use ignoriert)
- Cursor-Logik via Timestamp des segment_end_audit_id (nanoid hat
  keine Sortier-Garantie — Lesson für 3.3.C wiederverwendet)
- Sync vor LLM-Call (Edge-Case bei >50 Messages, Latenz okay)
- Failure-Fallback auf Hard-Cap bei LLM-Throw
- 6 Tests grün

**3.3.C ✅ History-Loader liest Summaries (Commit `0eb941e`, +729/-43)**

History-Loader-Erweiterung um Summary-Loading plus Sliding-Window-Cut.
- Neue Datei `conversations/history-loader.ts` mit
  `loadConversationHistory` plus `buildSummaryBlock`
- `AuditRepository.listByConversationAfter` für Cursor-basiertes
  Sliding-Window (Timestamp-Filter wegen nanoid-Sortier-Problem)
- Doppelter Try-Catch für defensive Fallbacks
- Bugfix: `ConversationSummariesRepo.listByConversation` sortierte
  nach segment_start_audit_id ASC (nanoid!) → umgestellt auf
  created_at ASC. 3.3.B-Lesson wiederverwendet
- Alte `auditsToOwnerDirectMessages` durch chronologische ASC-First-
  Variante ersetzt (filter Tool-Use raus)
- 7 Tests grün, plus Regression auf vorhandene Test-Suites

**3.3.D ✅ Facts-API + CLI (Commit `49fe0b7`, +751)**

REST-Endpoints (alle Owner-gated) plus vier CLI-Skripte. Pattern direkt
aus 3.2.E (MCP-CLI) und 3.2.H (/tools-Endpoint).
- GET /twins/:handle/facts (optional `?status=approved|pending|auto`)
- POST /facts (create-only, 409 mit Code FACT_ALREADY_EXISTS)
- PATCH /facts/:factKey (Value + optional Confidence, source bleibt
  unverändert — Provenance-Schutz)
- DELETE /facts/:factKey (204 No Content)
- CLI: twin:facts-list (--json), twin:facts-add (--pending/--source/
  --force), twin:facts-remove (--yes), twin:facts-import (Flat-JSON)
- Shared-Schemas mit Längen-Constraints (key 1-200, value 1-10000)
- Manueller Smoke-Test gegen echte DB: alle Pfade grün

**3.3.E ✅ Facts in Twin-Prompt (Commit `1a8a128`, +275/-6)**

Facts als Semantic-Memory-Schicht im System-Prompt, direkt nach Persona
kombiniert via `personaWithFacts`.
- `apps/runtime/src/facts/prompt-builder.ts` mit `humanizeFactKey`
  (snake_case → Sentence case) plus `buildFactsBlock`
- TwinServiceDeps um facts: FactsRepo erweitert
- runOwnerDirect lädt facts.listByTwin({onlyApproved:true}) vor
  runModel, baut factsBlock, reicht durch
- System-Prompt: persona+facts (combined) als 2. Schicht statt
  direkter persona.systemPrompt-Referenz
- Manueller Smoke-Test mit echtem Twin: "Wie heißt meine Frau?" →
  "Anna.", "Wo arbeitest du?" → "HARWAY Experience. Eigene Bude,
  zusammen mit Florian gegründet..." (Twin reichert Facts mit
  Persona-Wissen an — UX wie beabsichtigt)
- 5 Tests grün, Regression auf 4 Test-Suites grün

**3.3.F ✅ Twin-Fact-Extraction mit Approval-Gate (Commit `f1cfa65`,
+1151/-6)**

Twin reflektiert über Konversation, schlägt Fact-Vorschläge vor, User
approved/rejected. Pattern analog zu 3.2.F MCP-Approval.
- Migration 016 erweitert facts.confidence-CHECK um 'rejected' (Table-
  Rebuild). Verhindert Endlos-Loop bei abgelehnten Facts
- ExtractionEngine mit `extractFromConversation`: lädt aktive +
  rejected Facts, Summaries, Live-Audits → AI SDK `generateObject`
  mit Zod-Schema → persistiert pro Fact `facts.upsert(confidence=
  'pending', source='twin')` plus Audit `capability=semantic-fact-write`
- Skip-Logic: existierende approved/pending/auto übersprungen, nur
  rejected darf erneut pending werden
- FactSource/FactConfidence-Types aus shared re-exportiert (Source-of-
  Truth-Konsolidierung)
- POST /twins/:handle/facts/extract Endpoint, Approve/Reject läuft
  über generische /audit/:id/approve|reject mit capability-Switch
- CLI: twin:facts-extract <handle> [--conversation <id>]
- 8 Tests grün
- Smoke-Test mit echtem Twin: Konversation über Toskana-Urlaub geführt,
  Extract triggered, vier qualitativ hochwertige Facts extrahiert
  (business_partner=Florian Ristig, company_headquarters=Hamburg,
  business_partner_wife=Sarah Frau von Florian, planned_vacation_2026=
  kompletter Toskana-Plan). Skip-Logic funktional, Trivia vermieden.
  Approve via UI: pending → approved. Reject via UI: pending → rejected

**3.3.G1 ✅ Inbox-Render für semantic-fact-write (Commit `bf7b6d5`,
+69/-4)**

Inbox-Capability-Switch erkennt semantic-fact-write und rendert Fact-
Vorschlag prominent: factKey raw (Mono mit Border-Box), factValue,
plus Reasoning als Trust-Layer.
- FactProposalBody inline in inbox/page.tsx (Capability-Check via
  isFactWrite-Flag, kein neuer Component-File)
- formatCapability erweitert für Recent-Approvals-Header:
  "Fakt-Vorschlag: <factKey>"
- Defensive Fallbacks für fehlende factKey/factValue
- Smoke-Test: 2 Pending-Items aus 3.3.F zeigen Fact-Details statt
  "keine Eingabe gefunden"

**3.3.G2 ✅ Facts-Settings-View (Commit `fc3f6b3`, +823/-24)**

Eigene Page `/facts?twin=@handle` mit voller CRUD-Funktionalität plus
Pending-Approve und Rejected-Reactivate.
- apps/web/app/facts/page.tsx NEU (~600 Zeilen self-contained)
- Vier Sections nach Confidence: Pending (zuoberst), Approved,
  Rejected, Auto (Reserve); leere Sections hidden
- FactSection + FactRow mit Status-Marker (✓/⏳/✗/?), factKey in
  Mono mit Border-Box, source/updated-Meta
- Action-Buttons je nach Status:
  - Approved: [edit] [delete]
  - Pending: [approve] [reject] [delete]
  - Rejected: [reactivate] [delete]
  - Auto: [delete]
- AddFactModal (Key+Value, POST, 409→Inline-Error)
- EditFactModal (factKey read-only, factValue editierbar, PATCH)
- ModalWrapper: Backdrop-Click + Escape-Key
- Reactivate: PATCH mit {factValue: existing, confidence: 'approved'}
- SSE-Subscription auf pending-added/-resolved/audit.created/updated
  für Live-Reaktivität
- Parallel-Fetch /facts + /audit?capability=semantic-fact-write&status
  =pending, Mapping factKey → auditId
- TopNav: Counter-Split pendingInboxCount (non-fact) +
  pendingFactsCount (semantic-fact-write), neuer Link mit Badge
- Browser-Smoke-Test: alle 6 Pfade verifiziert (Add favorite_food=
  Pizza, Edit, Delete, Approve business_partner, Reactivate
  planned_vacation_2026, Counter live aktualisiert)

**3.3.G3 ✅ Manual-Extract-Button + Reset-Confirm-Dialog (Commit
`a3c868b`, +295/-87)**

Zwei UI-Touchpoints im Chat-Header für Twin-getriebene Fact-Extraction.
- DirectChatActions ersetzt komplett DirectChatResetButton plus
  RESET_CONFIRM_TIMEOUT_MS-Inline-Confirm-Mechanismus
- "Reflektieren"-Button vor "↻ Neu starten", Disabled-State
  extracting||busy||!hasConversation, Text-Wechsel zu
  "Reflektiere..." während Call
- POST /facts/extract, Toast (alert()-Fallback): "N neue Facts
  extrahiert. Review in /facts."
- Reset-Modal mit drei Optionen: Abbrechen / Nur beenden /
  Reflektieren + Beenden. Bei letzterer: Extract → Reset sequenziell,
  bei Extract-Failure trotzdem Reset
- Modal-Close-Guard während extracting/busy
- ChatLayout hält neuen State directChatConvId, DirectChat ruft
  onConvIdChange auf newestConvId (echte Server-ID, keine
  local-after-reset-*-Synthetics)
- ModalWrapper aus facts/page.tsx zu shared Component extrahiert
  (apps/web/components/ModalWrapper.tsx)
- Smoke-Test: Konversation über Marc/Bayreuther Festspielhaus/Parsifal-
  Karten geführt → Twin extrahierte `contact_bayreuth → Marc vom
  Bayreuther Festspielhaus — Kontakt für Karten (z.B. Parsifal
  Premium-Sitze)` mit proaktiver Kontext-Kapselung. Toast bestätigte,
  Topbar-Counter aktualisierte sich live. Alle drei Modal-Pfade
  verifiziert

### Architektur-Erkenntnisse Tag 12

**Function-Injection für LLM-Calls.** Production wrappt
generateText/generateObject, Tests reichen Mock-Function durch.
Pattern in SummaryEngine (3.3.B) etabliert, in ExtractionEngine
(3.3.F) wiederverwendet. Saubere DI statt Mock-LLM-Setup,
Provider-Agnostik erhalten.

**nanoid-IDs sind NICHT lexikografisch sortierbar.** Pattern-Lesson:
sortiere nach Timestamp-Spalten oder created_at, niemals nach
nanoid-Spalten. In 3.3.B als Cursor-Problem aufgetreten (Bugfix
inline), in 3.3.C als Repo-Sortier-Problem reproduziert (Bugfix in
ConversationSummariesRepo). Allgemeines Pattern für künftige Repos
mit nanoid-IDs.

**Marker-Pattern + Capability-Switch wiederverwendet.** 3.3.F nutzt
das 3.2.F-Pattern (capability='semantic-fact-write', Audit mit
status='pending', generische Approve/Reject-Routen mit Switch). Kein
Parallel-System gebaut, eine Approval-Mechanik für alle Capability-
Typen. Bewährt sich erneut.

**Inline-Components vs eigene Files.** 3.3.G1+G2+G3 haben kompakte
Inline-Component-Definitions in den Page-Files statt Component-
Extraktion. Pragmatisch für self-contained Pages mit < 600 Zeilen.
ModalWrapper wurde erst in G3 extrahiert, als zwei Pages ihn
brauchten — Lesson: erst extrahieren wenn Wiederverwendung tatsächlich
gebraucht.

**Facts als Persona-konstitutiv.** Position A im Strategie-Vote für
3.3.E (Facts direkt nach Persona via personaWithFacts) hat sich im
Smoke-Test bewährt. Twin reichert Facts mit Persona-Wissen an
(„HARWAY Experience. Eigene Bude, zusammen mit Florian gegründet..."
statt nur „Harway Experience"). Facts als Daten-Punkte allein wären
trockener.

**Defensive Fallbacks an mehreren Ebenen.** loadConversationHistory
hat doppelten Try-Catch (Cursor-Pfad → Hard-Cap-Fallback → leere
History). Pattern: bei kritischer User-Funktion (Send-Path) lieber
mehrstufiger Fallback statt eine Exception-Quelle, die alles
killt.

**Toast als alert()-Fallback.** 3.3.G3 nutzt alert() weil kein Toast-
System in der App. Pragmatisch für Pilot. Backlog-Kandidat: Toast-
Framework bei nächstem UX-Polish-Block.

**zsh + eckige Klammern.** `apps/web/app/chat/[handle]/page.tsx` ohne
Quotes wird von zsh als Globbing-Pattern interpretiert. Lesson für
git-add-Sequenzen: Pfade mit `[...]` immer in Single-Quotes setzen.
Doku-Detail.

## Tag 11 abgeschlossen (Vormittag + Mittag)

**Vormittag:** #92 Production-Deploy von Phase 3.2 (A-G) auf VPS,
Sequenz Repo-Pull → Override-File-Erweiterung → Image-Rebuild →
Container-Recreate → Migrations 011/012 → Pilot-MCP-Server.

**Mittag:** 3.2 Sub-Schritt H Tool-Picker-UI als strukturelle Lösung
für Item #89 (Commit `b97ae80`, +821/-9). Plus Multi-Step-Followup-
Patch bei forcedToolChoice plus UX-Polish (Server-Sections mit
Approval-Badge). Plus TOOL_USE_DIRECTIVE-Polish (`2e7c1d0`) als
Defense-in-Depth (REGEL 4 wirkt, REGEL 6 wirkungslos).

**Production-Deploy 3.2.H + Direktive Tag 11 Abend:** Status unklar
in der Doku, ggf. zusammen mit 3.3-Deploy nachzuholen.

## Tag 10 abgeschlossen

Phase 3.2 Sub-Schritte A-G — MCP-Foundation komplett:
- 3.2.A Schema + Repo (`2bf1ee0`)
- 3.2.B Client + Lifecycle (`daa03b7`)
- 3.2.C Tool-Discovery + Skill-Sync (`cd5b295`)
- 3.2.D Tool-Execution via AI-SDK (`366ca93`)
- 3.2.E CLI (`43258cf`)
- 3.2.F Approval-Workflow (`b58df94`) — Marker-Pattern
- 3.2.G Inline-Approval-UI im Chat (`bce54fb`)

## Phase 3 Status

- 3.1 ✅ **Skill-System Engine + Pilot** (Tag 7)
- 3.2 ✅ **MCP-Client als Skill-Provider plus UI-Tool-Picker**
  (Tag 10 lokal, Tag 11 Vormittag Production 3.2.A-G, Tag 11 Mittag
  lokal 3.2.H)
- 3.3 ✅ **Memory: Conversation + Semantic** (Tag 12 lokal,
  Production-Deploy ausstehend)
- 3.4 offen — Memory: Episodic
- 3.5 offen — Hyperbrowser als MCP-Skill (auf MCP-Foundation
  aus 3.2 obendrauf)
- 3.6 offen — Procedural Memory (ggf. Phase 4)

**Phase 3 Definition of Done — 3 von 5 Häkchen gesetzt** (3.1, 3.2,
3.3).

## Was als nächstes ansteht

1. **Production-Deploy Phase 3.3 auf VPS** — Tag-12-Stand auf
   Production. Sequenz analog Tag 11 Vormittag: Repo-Pull, Image-
   Rebuild Runtime + Web, Container-Recreate, Migrations 013-016
   anwenden lassen. KEIN neuer Volume-Mount nötig. Plus ggf. nachholen:
   Tag-11-Mittag-Stand (3.2.H + Direktive-Polish), falls Tag-11-Abend-
   Deploy nicht durchgeführt wurde. Geschätzt 60-90 Min.
2. **#90 Resume-Prompt-Tuning** (M, should) — vermutlich nur partiell
   wirksam, 5-Min-Edit
3. **#91 Reject-Reason-UI** (S, nice) — window.prompt durch Modal
   ersetzen (ModalWrapper aus 3.3.G3 verfügbar)
4. **Strategie-Session vor 3.4** — Memory: Episodic mit sqlite-vec.
   Pre-Implementation: Embedding-Provider-Wahl (OpenAI vs Anthropic
   vs lokal — kein Vendor-Lock), Embedding-Granularität (pro Message
   vs pro Konversation vs pro Audit), Retrieval-Strategie
5. **3.4 — Memory: Episodic** (L) — dritte Memory-Schicht

Optional: **#79 Persona-Tabelle droppen** (XS, nice) — beim nächsten
Migrations-Anlass mit anhängen.

## Production-Stack — Tag-10-Stand auf VPS, Tag-11-Mittag + Tag-12 offen

**Phase 3.2 A-G in Production aktiv** (deployed Tag 11 Vormittag).
**Tag-11-Mittag (3.2.H + Direktive-Polish) Production-Status:** ggf.
nicht deployed, vor 3.3-Deploy prüfen.
**Tag-12 (Phase 3.3) noch nicht in Production.**

- **`https://app.twin.harwayexperience.com`** — Web
- **`https://runtime.twin.harwayexperience.com`** — Runtime
- **`https://bridge.twin.harwayexperience.com`** — Bridge (vom 3.
  Mai, unverändert)

Alle drei mit `restart: unless-stopped`, HTTPS via Let's Encrypt,
Traefik-Routing.

**Persona-Stand auf Production (nach Tag-8-Sync):**
- @markus: 6991 chars
- @florian: 575 chars
- @heiko: 344 chars (Stub)

**MCP-Server in Production für @markus:**
- `mcp_Psd-MfjYN7UJkIPM` — `everything` (no-approval, 13 Tools)
- `mcp_TdslZrvQccflqHzS` — `everything-approval` (approval, 13 Tools)
- 26 Tools insgesamt aktiv

**VPS-Override-File** `/docker/twin-lab-web/docker-compose.override.yml`
hat zwei bind-mounts (lebt nur auf VPS, nicht im Repo):
- `/docker/twin-lab-web/repo/docs:/app/docs:ro` (#81 vom Tag 8)
- `/docker/twin-lab-web/repo/mcp-servers:/app/mcp-servers:ro` (#92
  vom Tag 11)

## Lokal
`/Users/mjb/Visual Studio/twin-lab` — drei Twins (@markus, @florian,
@heiko), lokale Bridge auf 5100. Markus-Twin hat:
- Pilot-Skill `harway-workshops` aktiv
- 26 MCP-Tools (zwei everything-Server, einer ohne und einer mit
  Approval)
- Sechs approved Facts plus zwei pending Facts (aus Tag-12-Smoke-Tests:
  Anna, Roding, Harway Experience, Florian Ristig, Sarah, planned
  vacation 2026; pending: company_headquarters Hamburg,
  contact_bayreuth Marc)

**Konversations-System aktiv (seit Tag 9):** `conversations`-Tabelle
mit Test-Konversationen, `audit.conversation_id` gefüllt seit
Migration 009.

**MCP-System aktiv (seit Tag 10):** `mcp_servers`-Tabelle, `skills`-
Tabelle erweitert um `mcp_server_id`/`mcp_tool_name`.

**Tool-Picker-UI aktiv (seit Tag 11 Mittag):** ToolPicker-Komponente
im Chat, GET `/twins/:handle/tools`-Endpoint, Multi-Step-Followup im
Twin-Service.

**Memory-System aktiv (seit Tag 12):**
- `conversation_summaries`-Tabelle, ConversationSummariesRepo, Auto-
  Summary bei >50 zählenden Messages
- `facts`-Tabelle, FactsRepo, Facts im System-Prompt als 2. Schicht
- Twin-Extraction via POST /facts/extract plus CLI twin:facts-extract
- Facts-UI unter /facts mit CRUD + Approval-Workflow

## Drei User auf Production
- Owner: @markus (markus.baier@harway.de)
- Owner: @florian (florian.ristig@harway.de)
- Owner: @heiko (heiko.gregor@harway.de)

Alle drei mit anthropic/claude-opus-4-7, Production-Bridge.

## Repo
github.com/markusbaier/twin-lab — `origin/main` lokal aktuell auf
`a3c868b` (Tag 12 Abend, 3.3.G3 + ModalWrapper-Extraction).

**Tag-12-Commits (9 Stück):**
- `9b4d5c5` 3.3.A Schema + Repos
- `9fc1ebb` 3.3.B Summary-Engine im Send-Path
- `0eb941e` 3.3.C History-Loader liest Summaries
- `49fe0b7` 3.3.D Facts-API + CLI
- `1a8a128` 3.3.E Facts in Twin-Prompt
- `f1cfa65` 3.3.F Twin-Fact-Extraction mit Approval-Gate
- `bf7b6d5` 3.3.G1 Inbox-Render für semantic-fact-write
- `fc3f6b3` 3.3.G2 Facts-Settings-View
- `a3c868b` 3.3.G3 Manual-Extract-Button + Reset-Confirm-Dialog

**Tag-11-Commits:**
- `f3532e8` Doku Tag 11 Vormittag (#92 ✅)
- `b97ae80` 3.2.H Tool-Picker-UI plus Multi-Step-Patch plus UX-Polish
- `2e7c1d0` TOOL_USE_DIRECTIVE härter (Polish für #89)
- `5aef14b` Doku Tag 11 Mittag

Production-VPS auf `20aaa36` (Tag-10-Stand, deployed Tag 11 Vormittag).
Tag-11-Mittag (3.2.H + Direktive) und Tag-12 (Phase 3.3) Deploy-Status
vor nächstem Production-Deploy klären.

VPS-Override-File hat zwei bind-mounts (#81 docs/ + #92 mcp-servers/),
lebt nur auf VPS, nicht im Repo.
