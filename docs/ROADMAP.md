# twin-lab Roadmap

Stand: 11. Mai 2026 Abend, nach Phase 3.3 (Memory: Conversation + Semantic) komplett lokal.

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

### Architektur-Entscheidungen (11. Mai 2026, vor Phase 3.3)

**Eigen-Bau für Memory-Schichten statt Cognee/Dreams-Adoption.** Geprüft: Cognee (16.6k Stars, Apache 2.0, Knowledge-Graph + Vector-Search + Ontology) und Anthropic Managed-Agents-Dreams (Memory-Stores plus Async-Reflection-Jobs). Beide konzeptionell wertvoll. Entscheidung: Eigen-Bau für 3.3, Begründung — Anti-Lock-in, Provider-Agnostik (Cognee Python-Stack, Dreams Anthropic-only), Pilot-Größe rechtfertigt keine komplexe externe Integration, eigene Implementation gibt volle Kontrolle über Multi-Tenant-Architektur. Beide als Backlog-Items (#93 Cognee als optionaler MCP-Skill für Knowledge-Recall, #94 Dream-Pattern für periodische Memory-Kuratierung) für Phase 3.6+ oder Phase 4.

**Conversation-Memory: Sliding-Window mit Auto-Summary.** Trigger >50 zählende Messages, Summary-Block der ältesten 40, Live-Window 10. Multiple Summary-Segmente pro Konversation möglich. Twin selbst macht Summary-LLM-Call (Persona-Konsistenz, Provider-Agnostik statt Anthropic-Prompt-Caching). Sync vor LLM-Call (Edge-Case bei >50 Messages, Latenz okay). Failure-Fallback auf Hard-Cap. Function-Injection für Test-Mocking.

**Semantic-Memory: KV-Store als Truth-Source, keine echte facts.md-Datei.** Tabelle `facts` mit Multi-Tenant-Isolation pro twin_id, UNIQUE(twin_id, fact_key). source ∈ {user, twin, import}, confidence ∈ {approved, pending, auto, rejected}. UI rendert als Liste mit Status-Sektionen, kein File-Pattern.

**Facts als Persona-konstitutiv im System-Prompt.** Facts werden direkt nach Persona kombiniert via `personaWithFacts` als 2. Schicht (statt eigene 7. Schicht). Begründung: Facts sind Identitäts-Wissen, nicht Conversation-Kontext. Smoke-Test bestätigt: Twin reichert Facts mit Persona-Stimme an statt sie als isolierte Daten auszuspucken.

**Twin-getriebene Fact-Extraction via Approval-Pattern aus 3.2.F.** Pattern wiederverwendet: pro Fact ein Pending-Audit mit `capability='semantic-fact-write'`, Approve via generischen `/audit/:id/approve|reject`-Routen mit capability-Switch. `confidence='rejected'` (Migration 016) verhindert Endlos-Loop bei abgelehnten Facts (Twin sieht rejected-Liste, schlägt nicht erneut vor).

---

## Phase 3 — Sub-Schritte

### 3.1 — Skill-System Engine + Pilot ✅
**Abgeschlossen 6. Mai 2026 (Tag 7 Vormittag).** Fünf Sub-Schritte (3.1.A bis 3.1.F) an einem Vormittag durch. Pattern aus 2.5.4.1 (Trust-Repo + Routes) als Vorlage.

- **3.1.A** ✅ DB-Schema + Skill-Repo (Commit `2c1cfd0`)
- **3.1.B+C** ✅ Engine + System-Prompt-Integration (Commit `b2b796e`)
- **3.1.D** ✅ CLI-Tool zum Importieren (Commit `7c65c41`)
- **3.1.E** ✅ Read-only UI + Toggle (Commit `5fbf254`)
- **3.1.F** ✅ Pilot-Skill HARWAY-Workshop-Kontext (kein Commit, Skill-Files gitignored)

**Architektur-Entscheidung Strategie B:** Alle aktiven Skills permanent im System-Prompt. Migrationspfad zu C (Hybrid Core/On-demand) dokumentiert für später.

**Aufgedeckter Architektur-Befund:** Persona-Skill-Doppelung. Backlog-Item #74.

### 3.2 — MCP-Client als Skill-Provider ✅
**Abgeschlossen 9. Mai 2026 (Tag 10).** Sieben Sub-Schritte (3.2.A bis 3.2.G) an einem Tag durch — kompletter MCP-Client plus Approval-Workflow plus Inline-UI. Tag 11 ergänzt 3.2.H Tool-Picker-UI als strukturelle Lösung für Item #89.

- **3.2.A** ✅ MCP-Schema + Repo (Commit `2bf1ee0`)
- **3.2.B** ✅ MCP-Client + Lifecycle-Manager (Commit `daa03b7`)
- **3.2.C** ✅ Tool-Discovery + Skill-Sync (Commit `cd5b295`)
- **3.2.D** ✅ Tool-Execution via AI-SDK-Tool-Bridge (Commit `366ca93`)
- **3.2.E** ✅ MCP-Server-CLI (Commit `43258cf`)
- **3.2.F** ✅ MCP-Tool-Approval-Workflow (Commit `b58df94`) — Marker-Pattern
- **3.2.G** ✅ Inline-Approval-UI im Chat (Commit `bce54fb`)
- **3.2.H** ✅ Tool-Picker-UI im Chat (Commit `b97ae80`, Tag 11 Mittag) — strukturelle Lösung für Item #89 UI-Pfad

**Aufgedeckte LLM-Verhaltens-Probleme:** Item #89 (Tool-Call-Verhalten), Item #90 (Reject-Resume).

### 3.3 — Memory: Conversation + Semantic ✅
**Abgeschlossen 11. Mai 2026 (Tag 12).** Sieben Sub-Schritte (3.3.A bis 3.3.G3) an einem Tag durch — Schema/Repos, Summary-Engine, History-Loader, Facts-API, Facts-im-Prompt, Twin-Extraction mit Approval-Gate, plus drei UI-Sub-Schritte. Neun Commits insgesamt.

- **3.3.A** ✅ Schema + Repos (Commit `9b4d5c5`)
  Migrations 013-015 (conversation_summaries, facts, audit-capability-Doku). ConversationSummariesRepo + FactsRepo. ENV-Tunables. 13 Tests grün.
- **3.3.B** ✅ Summary-Engine im Send-Path (Commit `9fc1ebb`)
  Sliding-Window-Memory mit Auto-Summary. Function-Injection für LLM (Test-Mock). Counting nur respond_to_chat + owner-direct. Cursor via Timestamp wegen nanoid-Sortier-Problem. Sync vor LLM-Call, Failure-Fallback. 6 Tests grün.
- **3.3.C** ✅ History-Loader liest Summaries (Commit `0eb941e`)
  Cursor-basiertes Sliding-Window via `listByConversationAfter`. Doppelter Try-Catch defensive Fallback. Bugfix Repo-Sortierung nach `created_at` (nanoid-Lesson reproduziert). 7 Tests grün.
- **3.3.D** ✅ Facts-API + CLI (Commit `49fe0b7`)
  Vier REST-Endpoints (Owner-gated, create-only mit 409, PATCH ohne source-Drift). Vier CLI-Skripte (list/add/remove/import). Bulk-Import via Flat-JSON.
- **3.3.E** ✅ Facts in Twin-Prompt (Commit `1a8a128`)
  `humanizeFactKey` + `buildFactsBlock`. Facts als 2. System-Prompt-Schicht via `personaWithFacts`. Smoke-Test: Twin nutzt Facts und reichert sie mit Persona-Stimme an. 5 Tests grün.
- **3.3.F** ✅ Twin-Fact-Extraction mit Approval-Gate (Commit `f1cfa65`)
  Migration 016 (confidence='rejected'). ExtractionEngine mit `generateObject`+Zod-Schema. Pattern aus 3.2.F: Pending-Audit + capability='semantic-fact-write'. Skip-Logic. Approve/Reject über generische Routen mit Switch. Smoke-Test: 4 hochwertige Facts aus Toskana-Konversation extrahiert. 8 Tests grün.
- **3.3.G1** ✅ Inbox-Render für semantic-fact-write (Commit `bf7b6d5`)
  FactProposalBody inline in inbox/page.tsx. Capability-Switch zeigt factKey/factValue/reasoning. Pattern analog McpToolCallBox.
- **3.3.G2** ✅ Facts-Settings-View (Commit `fc3f6b3`)
  Eigene Page `/facts?twin=@handle`. CRUD plus Approve/Reject plus Reactivate. AddFactModal + EditFactModal + ModalWrapper. SSE-Live-Reaktivität. TopNav-Counter-Split (Inbox vs Facts).
- **3.3.G3** ✅ Manual-Extract-Button + Reset-Confirm-Dialog (Commit `a3c868b`)
  "Reflektieren"-Button im Chat-Header. Reset-Modal mit drei Optionen (Abbrechen/Nur beenden/Reflektieren+Beenden). ModalWrapper zu shared Component extrahiert. DirectChatResetButton-Inline-Confirm komplett ersetzt.

**End-to-End-Verifikation:** Konversation über Toskana-Urlaub geführt, vier Facts extrahiert (business_partner, company_headquarters, business_partner_wife, planned_vacation_2026). UI-Pfade Add/Edit/Delete/Approve/Reject/Reactivate alle grün. Plus zweite Smoke-Konversation über Bayreuther-Festspielhaus-Karten → `contact_bayreuth`-Fact mit Kontext-Kapselung. Twin reichert Facts mit Persona-Wissen an, vermeidet Trivia, respektiert Skip-Logic.

### 3.4 — Memory: Episodic
**Größe:** L · **Zeitfenster:** 1-2 Wochen

Vector-Embeddings für „Twin erinnert sich an spezifische Events".

- sqlite-vec Setup
- Embedding-Provider-Wahl (OpenAI vs. Anthropic vs. lokal — kein Vendor-Lock)
- Retrieval-Logik: Similarity-Search pro Konversation
- Update-Strategie: was wird embedded, wann

**Vorbedingung Strategie-Session:** Embedding-Provider, Embedding-Granularität (pro Message / pro Konversation / pro Audit), Retrieval-Pattern.

### 3.5 — Hyperbrowser als MCP-Skill
**Größe:** M · **Zeitfenster:** 1 Woche

Cloud-Browser-Infrastruktur (hyperbrowser.ai) als MCP-Server eingebunden. Twin navigiert autonom im Web. Aufbauend auf MCP-Foundation aus 3.2 — sollte ein direkter Drop-In sein, mit ENV-Wert für Hyperbrowser-API-Key.

- Hyperbrowser-MCP-Server konfigurieren (JSON-Spec für `pnpm twin:mcp-add`)
- Mandate-Gate: Web-Aktionen brauchen Approval (default `requires_approval=true`)
- Test-Cases: Web-Research, Form-Filling, Scraping

### 3.6 — Procedural Memory (optional, ggf. Phase 4)
**Größe:** XL · **Zeitfenster:** 2-3 Wochen oder später

Lerngedächtnis. Twin lernt aus Approves/Rejects/Edits, schreibt Skills selbst. Konzeptionell anspruchsvoll, vermutlich erst nach Phase 4 sinnvoll.

Plus möglicher Andock-Punkt für #94 (Dream-Pattern) als periodischer LLM-Job zur Facts-Sammlungs-Kuratierung.

---

## Phase 3 Total

**Zeitfenster:** 7-12 Wochen, je nach Tiefe.
**Realistisch:** 2-3 Monate bei aktuellem Tempo.
**Definition of Done für Phase 3:**
- [x] Skill-System läuft mit Pilot-Skill (3.1.A-F) ✅
- [x] MCP-Client als Skill-Provider integriert (3.2.A-H) ✅
- [x] Conversation-Memory + Semantic-Memory live (3.3.A-G3) ✅
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

**Realität nach Tag 12:** Phase 3.1 + 3.2 + 3.3 komplett — drei von fünf Phase-3-Sub-Schritten in 5 Tagen Arbeit (Tag 7 + Tag 10 + Tag 11 + Tag 12). Tempo deutlich höher als geplant, weil Patterns wiederverwendbar waren (Sub-Schritt-Aufteilung mit Tests pro Layer, Marker-Pattern für Approvals, Function-Injection für LLM-Calls).

---

## Was als Nächstes konkret kommt

**Tag 13 / nächste Session:** Production-Deploy Phase 3.3 auf VPS. Pre-Deploy-Checklist:
- Tag-11-Mittag-Stand prüfen ob in Production deployed (3.2.H + Direktive)
- Migrations 013-016 in Production-DB anwenden lassen
- Image-Rebuild Runtime + Web, Container-Recreate
- Smoke-Test in Production: Facts-Add via UI, Konversation führen, Reflektieren-Button, Approve via Inbox

**Nächste Sessions:**
- Optional Polish-Items aus Backlog (#90, #91, evtl. Toast-Framework statt alert)
- Strategie-Session vor 3.4 (Memory: Episodic) — Embedding-Provider, Embedding-Granularität, Retrieval-Strategie
- Phase 3.4 (Memory: Episodic) starten

**Was als Hintergrund läuft:**
- Backlog-Items in Priorität abarbeiten
- Production-Updates fällig nach jedem zusammenhängenden Block
- Production-Erfahrung sammeln, neue Items dokumentieren

---

## Stop-Punkt-Definition Phase 3

Phase 3 ist abgeschlossen, wenn:
- [x] Skill-System mit Pilot-Skill (3.1) ✅
- [x] MCP-Client als Skill-Provider (3.2) ✅
- [x] Memory: Conversation + Semantic (3.3) ✅
- [ ] Memory: Episodic (3.4)
- [ ] Hyperbrowser als MCP-Skill (3.5)

Wenn alle Häkchen sitzen: Phase 3 done. Pause für Reflexion. Phase 4 starten.
