# twin-lab Roadmap

Stand: 6. Mai 2026, nach Phase 2.5 abgeschlossen + Tag 6 Polish-Sprint. Phase 3 konkretisiert in Strategie-Session.

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

---

## Phase 3 — Sub-Schritte

### 3.1 — Skill-System Engine + Pilot
**Größe:** L · **Zeitfenster:** 2-3 Wochen, in 6 Sub-Schritten

Foundation für alles weitere. Sechs Sub-Phasen, alle separat testbar abschließbar:

- **3.1.A** — DB-Schema + Skill-Repo (S, ~2-3h)
  Migration für `skills`-Tabelle, `SkillRepo` mit `add/remove/list/findById/getActive`, Tests
- **3.1.B** — Skill-Engine: Discovery + Selection + Loading (M, ~4-6h)
  Bei jedem `respond_to_chat`: verfügbare Skills holen, Klassifikator entscheidet, SKILL.md in Kontext
- **3.1.C** — System-Prompt-Integration (S, ~2-3h)
  Skill-Markdown wird in LLM-Kontext eingebettet, sauber abgegrenzt von Persona/Mandate
- **3.1.D** — CLI-Tool für Skill-Anlegen (S, ~2-3h)
  `pnpm skill:create <twin-handle>` analog zu `twin:set-api-key`. Liest Manifest + Markdown von Filesystem, schreibt in DB
- **3.1.E** — Read-only UI in Settings (M, ~3-4h)
  Settings-Page erweitert um Skill-Liste pro Twin. Anzeige: Name, Beschreibung, Aktiv-Toggle. Kein Edit, kein Delete (kommt später)
- **3.1.F** — Pilot-Skill: HARWAY-Workshop-Kontext (S, ~2-3h)
  Skill als Markdown anlegen, via CLI in DB schreiben, am Twin testen. Twin kennt jetzt Workshop-Termine, Preise, Inhalte

**Vorab-Strategiefragen vor 3.1.B:**
- Skill-Selection: LLM-Klassifikator-Call vor jedem `respond_to_chat`? Oder Skills permanent im System-Prompt? Hybrid (kleine permanent, große on-demand)?

### 3.2 — MCP-Client als Skill-Provider
**Größe:** L · **Zeitfenster:** 1-2 Wochen

MCP ist das Standard-Protokoll für LLM-Tools (Anthropic-getrieben, breite Adoption). Twin als MCP-Client kann externe Tools nutzen.

- MCP-Protokoll-Implementation (Client-Side)
- MCP-Server-Konfiguration pro Twin (analog zu LLM-Config)
- MCP-Tools werden als Skills im Skill-System registriert (`source: "mcp"`)
- Pilot-MCP-Server (z.B. Filesystem oder Time)
- Mandate-Gates für MCP-Tool-Calls

### 3.3 — Memory: Conversation + Semantic
**Größe:** L · **Zeitfenster:** 2-3 Wochen

Erste zwei Memory-Schichten — schneller ROI.

- **Conversation-Memory:** Sliding-Window mit Auto-Summary. Bei jedem Chat werden die letzten N Messages plus zusammengefasste ältere Messages in Kontext geladen. Pro `(twin_id, partner_handle)`-Paar separater Verlauf.
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

Cloud-Browser-Infrastruktur (hyperbrowser.ai) als MCP-Server eingebunden. Twin navigiert autonom im Web.

- Hyperbrowser-MCP-Server konfigurieren
- Mandate-Gate: Web-Aktionen brauchen Approval
- Test-Cases: Web-Research, Form-Filling, Scraping

### 3.6 — Procedural Memory (optional, ggf. Phase 4)
**Größe:** XL · **Zeitfenster:** 2-3 Wochen oder später

Lerngedächtnis. Twin lernt aus Approves/Rejects/Edits, schreibt Skills selbst. Konzeptionell anspruchsvoll, vermutlich erst nach Phase 4 sinnvoll.

---

## Phase 3 Total

**Zeitfenster:** 7-12 Wochen, je nach Tiefe.
**Realistisch:** 2-3 Monate bei aktuellem Tempo.
**Definition of Done für Phase 3:**
- [ ] Skill-System läuft mit Pilot-Skill (3.1.A-F)
- [ ] MCP-Client als Skill-Provider integriert (3.2)
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

---

## Was als Nächstes konkret kommt

**Heute (6. Mai):**
1. 3.1.A starten — DB-Schema + Skill-Repo

**Nächste Sessions:**
- 3.1.B mit Vorab-Diskussion zu Skill-Selection-Strategie
- 3.1.C-F als geordnete Sub-Schritte

**Was als Hintergrund läuft:**
- Backlog-Items in Priorität abarbeiten (#71b kumulative Audit-Messages, #65 Reverse-Proxy, etc.)
- Production-Erfahrung sammeln, neue Items dokumentieren

---

## Stop-Punkt-Definition Phase 3

Phase 3 ist abgeschlossen, wenn:
- [ ] Skill-System mit Pilot-Skill (3.1)
- [ ] MCP-Client als Skill-Provider (3.2)
- [ ] Memory: Conversation + Semantic (3.3)
- [ ] Memory: Episodic (3.4)
- [ ] Hyperbrowser als MCP-Skill (3.5)

Wenn alle Häkchen sitzen: Phase 3 done. Pause für Reflexion. Phase 4 starten.
