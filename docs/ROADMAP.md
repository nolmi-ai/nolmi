# twin-lab Roadmap

Stand: 9. Mai 2026 Mittag, nach Phase 3.2 (MCP-Client als Skill-Provider) komplett.

---

## Wo wir stehen

**Phase 1 — Closed Twin** ✅
Markus-Twin antwortet im Persona-Stil, Mandates aktiv, Audit-Log, Pending-Workflow.

**Phase 2 — A2A Bridge** ✅
Bridge-Service eigenständig, Twin-zu-Twin-Kommunikation läuft, Konversations-Threading, VPS-Deployment unter `bridge.twin.harwayexperience.com` mit HTTPS.

**Phase 2.5 — Multi-Tenant** ✅
Web-UI, Onboarding, User-Auth, Trust-Layer, Production-Deployment. Drei User live unter `app.twin.harwayexperience.com`. 2.5.5 (Notifications) bewusst verschoben — kein Blocker.

**Was live ist:**
- `bridge.twin.harwayexperience.com` — A2A-Bridge
- `runtime.twin.harwayexperience.com` — Twin-Runtime
- `app.twin.harwayexperience.com` — Web-UI
- Drei Owner: @markus, @florian, @heiko

---

## Phase 3 — Skills + Memory + Tools

Macht Twins inhaltlich tiefer. Reihenfolge ist klar: **Skill-System ist Fundament, MCP nutzt Skill-System, Memory läuft parallel.**

### Architektur-Entscheidungen (6. Mai 2026)

**Skill-Definition (Hybrid C):** Ein Skill besteht aus Manifest (YAML/JSON), SKILL.md (Instruktionen fürs LLM), optional Script (TS/Python). Wissens-Skills haben nur Manifest + Markdown. Action-Skills haben zusätzlich Script. Pattern angelehnt an Hermes/Cline plus agentskills.io.

**Skill-Storage:** DB von Anfang an. Tabelle `skills` mit `twin_id`, `manifest_json`, `instructions_md`, `script_ts`, `is_active`, `created_at`, `updated_at`. Multi-Tenant-Isolation pro Twin (nicht pro User), konsistent mit `mandates`-Pattern.

**Capability-Mapping:** Skills gehören zu Capabilities, sind nicht selbst Capabilities. Mandate-Layer aus 2.5.4.1 bleibt unangetastet. Skill-Manifest hat `requires_approval`-Feld als Inner-Mandate. Default `false` für Wissens-Skills, `true` für Action-Skills.

**MCP-Integration:** MCP-Tools werden als Skills im Skill-System registriert (`source: "mcp"` vs. `source: "manual"`). Kein zweites paralleles System.

**UI-Editierbarkeit:** Phase-3-Ende oder Phase 4. In 3.1 nur Read-only-Anzeige der Skills. Skills werden via CLI angelegt, später UI-fähig.

### Architektur-Entscheidungen (9. Mai 2026, vor Phase 3.2)

**MCP-Client pro Twin (Multi-Tenant).** Jeder Twin hat eigene Server-Configs in `mcp_servers`-Tabelle, eigenen ClientManager-Pool. Konsistent mit allen Konfigurationen pro Twin (`apiKeyEncrypted`, Skills, Persona).

**Lazy-Spawn beim ersten Tool-Call, Idle-Timeout 5 Min.** Server startet erst, wenn Twin ihn braucht. Idle-Disconnect schont Ressourcen. ENV-tunable für Production-Tuning.

**Pre-Call-Approval, kein Post-Call-Reject.** Schreibende Tools sind das eigentliche Risiko, Post-Call wäre zu spät. Read-only-Tools können mit `requires_approval=false` direkt durchgewunken werden. Owner-Bypass für Tool-Approval explizit NICHT implementiert — konsistent mit Tag-3-Architektur für `send_to_twin`.

**Async via Audit-State + LLM-Re-Run, nicht synchroner Block.** Pending-State persistiert via Audit, überlebt Server-Restart. Resume nach Approve startet neuen `runOwnerDirect`-Call mit angereichter Message-History (System-Tool-Result als User-Message, provider-agnostisch).

**Marker-Pattern als Primary für Approval-Trigger.** AI SDK 6 propagiert Throws aus `execute()` nicht nach oben (Smoke-Test verifiziert). Marker-String im content-Array ist provider-agnostisch und eindeutig identifizierbar. Throw-Pfad bleibt als Defense-in-Depth.

---

## Phase 3 — Sub-Schritte

### 3.1 — Skill-System Engine + Pilot ✅
**Abgeschlossen 6. Mai 2026 (Tag 7 Vormittag).** Fünf Sub-Schritte (3.1.A bis 3.1.F) an einem Vormittag durch — die Hälfte von Phase 3 in einer Session. Tempo höher als geplant, weil das Pattern aus 2.5.4.1 (Trust-Repo + Routes) als Vorlage gepasst hat und Claude Code die Implementations-Schritte zügig durchgereicht hat.

- **3.1.A** ✅ DB-Schema + Skill-Repo (Commit `2c1cfd0`)
  Migration `008_skills.sql` mit `UNIQUE(twin_id, name)`, FK auf `twin_profiles` mit `ON DELETE CASCADE`. SkillRepo mit `add/remove/list/findById/findByName/setActive/update`. Test-Skript mit 9 Steps grün.
- **3.1.B+C** ✅ Engine + System-Prompt-Integration (Commit `b2b796e`)
  `prompt-builder.ts` baut Skills-Block, `runModel()` lädt Skills bei jedem Call frisch. Vierte Schicht im System-Prompt zwischen Persona und Language-Directive. Mock-LLM-Test mit Reihenfolge-Check und setActive-Verifikation grün. 3.1.C fiel zusammen mit 3.1.B — Engine-Integration und Prompt-Integration sind ein Schritt.
- **3.1.D** ✅ CLI-Tool zum Importieren (Commit `7c65c41`)
  `pnpm twin:skill-create <handle> <skill-dir> [--force]` mit YAML-Manifest-Parser, snake→camel-Mapping, Conflict-Detection. Verzeichnis-Konvention `skills-templates/<name>/manifest.yaml + SKILL.md (+ optional script.ts)`. Pattern angelehnt an agentskills.io.
- **3.1.E** ✅ Read-only UI + Toggle (Commit `5fbf254`)
  Settings-Section mit Skills-Liste, Aktiv-Toggle pro Skill, Optimistic-Update mit Revert-bei-Error. Backend-Routes `GET /twins/:handle/skills` + `PATCH /twins/:handle/skills/:skillId/active`, beide Owner-gated. UI-Payload schneidet Markdown raus (chars-Count statt Inhalt). Cross-Twin-Isolation verifiziert.
- **3.1.F** ✅ Pilot-Skill HARWAY-Workshop-Kontext (kein Commit, Skill-Files gitignored)
  Skill in `apps/runtime/skills-templates/harway-workshops/` lokal, via CLI in @markus' DB importiert. skillId `skill_2-T2zqvxf3m-0bbD`, 1800 chars Instructions. Browser-Test mit drei Workshop-Fragen: Twin antwortet sauber im Markus-Stil, keine Halluzinationen, keine erfundenen Tagessätze.

**Architektur-Entscheidung Strategie B (vor 3.1.B festgelegt):** Alle aktiven Skills permanent im System-Prompt. Migrationspfad zu C (Hybrid Core/On-demand) dokumentiert für später, wenn Token-Volumen es erzwingt. Heute kein Klassifikator-Call vor jedem Chat — würde unnötige Latenz und Kosten verursachen bei aktuell wenigen Skills pro Twin.

**Aufgedeckter Architektur-Befund:** Persona-Skill-Doppelung. Wenn Persona dasselbe Wissen enthält wie ein Skill, ist der Skill-Toggle wirkungslos — Twin antwortet aus Persona. Backlog-Item #74 für sauberes Layering (Persona = identitäts-stabiles Wissen, Skill = austauschbares).

### 3.2 — MCP-Client als Skill-Provider ✅
**Abgeschlossen 9. Mai 2026 (Tag 10).** Sieben Sub-Schritte (3.2.A bis 3.2.G) an einem Tag durch — kompletter MCP-Client als Skill-Provider mit Approval-Workflow plus Inline-UI. Acht Commits insgesamt plus BACKLOG-Update.

- **3.2.A** ✅ MCP-Schema + Repo (Commit `2bf1ee0`)
  Migration 011 mit `mcp_servers`-Tabelle, Multi-Tenant-Isolation pro Twin via FK. McpServersRepo mit AES-256-GCM-ENV-Encryption analog apiKeyEncrypted, Master-Key per Constructor injected.
- **3.2.B** ✅ MCP-Client + Lifecycle-Manager (Commit `daa03b7`)
  `@modelcontextprotocol/sdk` Dependency, McpClient für stdio-Transport. McpClientManager pro Twin mit Lazy-Spawn beim ersten Tool-Call, Idle-Disconnect nach 5 Min, pendingSpawns-Mutex gegen Concurrent-Spawns. ENV-Tunables. Registry-disposeAll() beim Shutdown.
- **3.2.C** ✅ Tool-Discovery + Skill-Sync (Commit `cd5b295`)
  Migration 012 erweitert `skills`-Tabelle um `mcp_server_id`/`mcp_tool_name`. McpSkillSync mit syncOnAdd() plus refresh()-Diff. Synthetisches Skill-Manifest mit `capability: "mcp_tool"` als Marker. Skill-Naming `mcp:<server>:<tool>`.
- **3.2.D** ✅ Tool-Execution via AI-SDK-Tool-Bridge (Commit `366ca93`)
  `tool-bridge.ts` mit buildMcpToolsFromSkills(). MCP-Skills NICHT mehr im System-Prompt-Block, stattdessen via AI-SDK-Tools an LLM übergeben. TOOL_USE_DIRECTIVE bei Tool-Call. Tool-Naming-Bug-Fix (Doppelpunkte zu Underscores für AI-SDK).
- **3.2.E** ✅ MCP-Server-CLI (Commit `43258cf`)
  Vier CLI-Skripte: `twin:mcp-add`, `twin:mcp-list` (mit `--json`), `twin:mcp-refresh`, `twin:mcp-remove` (mit `--yes`). JSON-Spec-Format mit Transport/Command/Args/Env, ENV-`?`-Marker für Interactive-Prompt. REPO_ROOT-Helper für pnpm-Filter-CWD-Bug.
- **3.2.F** ✅ MCP-Tool-Approval-Workflow (Commit `b58df94`)
  Pre-Call-Approval-Pattern mit Marker-String als Primary, Throw-Pattern als Defense-in-Depth (AI SDK 6 propagiert Throws nicht). Twin-Service detectPendingToolCall() erkennt Marker, baut Pending-Audit mit `capability='mcp-tool-use'`. Approve/Reject-Endpoints, Resume via User-Message provider-agnostisch. Inbox-UI erweitert.
- **3.2.G** ✅ Inline-Approval-UI im Chat (Commit `bce54fb`)
  McpToolCallBox-Component für Pending-Audits im Chat. Hybrid-Render plus Persistent-Visualization (Box bleibt nach Approve/Reject sichtbar mit Status-Indicator). buildChatBlocksFromAudits() mapped vier Capability/Status-Varianten auf Block-Sequenzen. 5s-Polling plus manueller Trigger nach send/approve/reject.

**Aufgedeckte LLM-Verhaltens-Probleme während 3.2:**
- Item #89: Claude Opus 4.7 ruft Tools selbst bei expliziter Anforderung nicht (mit `toolChoice: 'auto'`). Workaround: `toolChoice: 'required'` für Beweistests, langfristig User-getriggerte Approval-Forcierung über UI.
- Item #90: Bei trivialen Math-Problemen ignoriert der LLM Reject-Resume-Signale. Architektur ist korrekt, Reject-Prompt-Tuning steht aus.

**End-to-End-Verifikation:** Sub-Schritt-3.2.G-Smoke-Test mit `everything-approval`-Pilot-Server: Tool-Call-Box im Chat, Approve mit echtem Tool-Result, Reject mit Begründung, Cross-Stellen-Test (Inbox-Approve → Chat-Polling-Refresh).

### 3.3 — Memory: Conversation + Semantic
**Größe:** L · **Zeitfenster:** 2-3 Wochen

Erste zwei Memory-Schichten — schneller ROI.

- **Conversation-Memory:** Sliding-Window mit Auto-Summary. Bei jedem Chat werden die letzten N Messages plus zusammengefasste ältere Messages in Kontext geladen. Pro `(twin_id, partner_handle)`-Paar separater Verlauf. Aufbauend auf `conversations`-Tabelle aus 3.1-Konversations-Refactor (Tag 9).
- **Semantic-Memory:** KV-Store + `facts.md`. Persistente Fakten ("Markus' Frau heißt X", "Florians Geburtstag ist Y"). Vom User editierbar (UI), vom Twin schreibbar mit Approval-Gate.

### 3.4 — Memory: Episodic
**Größe:** L · **Zeitfenster:** 1-2 Wochen

Vector-Embeddings für „Twin erinnert sich an spezifische Events".

- sqlite-vec Setup
- Embedding-Provider-Wahl (OpenAI vs. Anthropic vs. lokal — kein Vendor-Lock)
- Retrieval-Logik: Similarity-Search pro Konversation
- Update-Strategie: was wird embedded, wann

### 3.5 — Hyperbrowser als MCP-Skill
**Größe:** M · **Zeitfenster:** 1 Woche

Cloud-Browser-Infrastruktur (hyperbrowser.ai) als MCP-Server eingebunden. Twin navigiert autonom im Web. Aufbauend auf MCP-Foundation aus 3.2 — sollte ein direkter Drop-In sein, mit ENV-Wert für Hyperbrowser-API-Key.

- Hyperbrowser-MCP-Server konfigurieren (JSON-Spec für `pnpm twin:mcp-add`)
- Mandate-Gate: Web-Aktionen brauchen Approval (default `requires_approval=true`)
- Test-Cases: Web-Research, Form-Filling, Scraping

### 3.6 — Procedural Memory (optional, ggf. Phase 4)
**Größe:** XL · **Zeitfenster:** 2-3 Wochen oder später

Lerngedächtnis. Twin lernt aus Approves/Rejects/Edits, schreibt Skills selbst. Konzeptionell anspruchsvoll, vermutlich erst nach Phase 4 sinnvoll.

---

## Phase 3 Total

**Zeitfenster:** 7-12 Wochen, je nach Tiefe.
**Realistisch:** 2-3 Monate bei aktuellem Tempo.
**Definition of Done für Phase 3:**
- [x] Skill-System läuft mit Pilot-Skill (3.1.A-F) ✅
- [x] MCP-Client als Skill-Provider integriert (3.2.A-G) ✅
- [ ] Conversation-Memory + Semantic-Memory live (3.3)
- [ ] Episodic-Memory mit sqlite-vec (3.4)
- [ ] Hyperbrowser als MCP-Skill (3.5)
- [ ] Twin merkt sich Konversationen, kennt Fakten, nutzt externe Tools, navigiert das Web mit Approval-Gates

3.6 (Procedural Memory) kann nachgezogen werden, ist nicht im DoD.

---

## Phase 4 — Multi-Channel + Föderation

Twins werden überall erreichbar.

### 4.1 — Telegram-Adapter (Owner-Mode)
Markus chattet mit Markus-Twin via Telegram. Bot-API.
**Zeitfenster:** ~1 Woche

### 4.2 — WhatsApp-Adapter (Owner-Mode)
Meta-Business-API, KYC-Bürokratie.
**Zeitfenster:** 2-3 Wochen inkl. Wartezeit

### 4.3 — Public-Mode (Externe schreiben Twins an)
Mandate-Layer für eingehende Channel-Messages. DSGVO.
**Zeitfenster:** 2-3 Wochen

### 4.4 — Föderation (mehrere Bridges)
Matrix-Modell. Twin auf Bridge-A spricht mit Twin auf Bridge-B.
**Zeitfenster:** 1-2 Monate

### 4.5 — Google A2A-Adapter
Twins als A2A-Server für Ökosystem-Anbindung. Adapter-Schicht über interner Bridge.
**Zeitfenster:** 2-3 Wochen

---

## Phase 5+ — Vision

P2P mit DIDs, optional Blockchain als Bezahlebene. Nicht jetzt planen.

---

## Zusammenfassende Timeline

Bei realistischem Tempo (2-3 Sessions pro Woche, je 2-4h):

| Phase | Zeitfenster | Kalenderzeit |
|-------|-------------|--------------|
| 3 (Skills + Memory + Tools) | 7-12 Wochen | 2-3 Monate |
| 4 (Multi-Channel) | 3-4 Monate | 4-5 Monate |

**Bis Ende Juli/August 2026:** Phase 3 abgeschlossen.
**Bis Ende 2026:** Phase 4 weitgehend fertig.

**Realität nach Tag 10:** Phase 3.1 + 3.2 komplett — fast die Hälfte der Phase-3-Sub-Schritte in 4 Tagen Arbeit (Tag 7 + Tag 10) durch. Tempo höher als geplant, weil Patterns wieder verwendbar waren und die Sub-Schritt-Aufteilung mit eigenen Tests pro Layer bei beiden großen Refactors gehalten hat.

---

## Was als Nächstes konkret kommt

**Heute (9. Mai) nach 3.2:** Production-Deploy von Phase 3.2 als nächster großer Block. Pre-Deploy-Checklist:
- Migrations 009-012 in Production-DB anwenden lassen (Auto-Bootstrap aus #77)
- Pilot-Server-Setup auf Production-DB (separater @markus-Production-Twin)
- ENV-Tunables für MCP-Lifecycle setzen (`MCP_IDLE_TIMEOUT_MS`, `MCP_SPAWN_TIMEOUT_MS`)
- Smoke-Test in Production: ein everything-Server adden, Tool-Call-Test über Chat-UI

**Nächste Sessions:**
- Phase 3.2-Polish-Items (#89, #90, #91) abarbeiten — sind nice-to-have, nicht blockierend für 3.3
- Strategie-Session vor 3.3 (Conversation- + Semantic-Memory) — Pre-Implementation-Diskussion mit konkreten Festlegungen zu Auto-Summary-Schwelle, KV-Store-Lifecycle, facts.md-Schreibrechte
- Phase 3.3 (Memory: Conversation + Semantic) starten

**Was als Hintergrund läuft:**
- Backlog-Items in Priorität abarbeiten
- Production-Updates fällig nach jedem zusammenhängenden Block
- Production-Erfahrung sammeln, neue Items dokumentieren

---

## Stop-Punkt-Definition Phase 3

Phase 3 ist abgeschlossen, wenn:
- [x] Skill-System mit Pilot-Skill (3.1) ✅
- [x] MCP-Client als Skill-Provider (3.2) ✅
- [ ] Memory: Conversation + Semantic (3.3)
- [ ] Memory: Episodic (3.4)
- [ ] Hyperbrowser als MCP-Skill (3.5)

Wenn alle Häkchen sitzen: Phase 3 done. Pause für Reflexion. Phase 4 starten.
