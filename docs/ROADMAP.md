# twin-lab Roadmap

Stand: 6. Mai 2026 Mittag, nach Phase 3.1 (Skill-System Engine + Pilot) komplett.

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
- [x] Skill-System läuft mit Pilot-Skill (3.1.A-F) ✅
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

**Heute (6. Mai) Vormittag:** Phase 3.1 komplett abgeschlossen ✅

**Nächste Sessions:**
- Pause / Mittagspause heute, dann ggf. weitere Polish-Arbeit oder direkt Phase 3.2
- Phase 3.2 (MCP-Client) starten — eigene Strategie-Session vorab nötig: MCP-Protokoll-Implementation, MCP-Server-Konfiguration pro Twin (analog LLM-Config), Pilot-MCP-Server (z.B. Filesystem oder Time), Mandate-Gates für Tool-Calls
- Vor 3.2: Persona-Skill-Layering klären (Backlog #74) — Wissens-Bereinigung oder explizite Layering-Doku

**Was als Hintergrund läuft:**
- Backlog-Items in Priorität abarbeiten (#71b kumulative Audit-Messages, #65 Reverse-Proxy, #74 Persona-Skill-Layering)
- Production-Update fällig — Tag-7-Commits noch nicht deployed, beim nächsten Pull mitnehmen
- Production-Erfahrung sammeln, neue Items dokumentieren

---

## Stop-Punkt-Definition Phase 3

Phase 3 ist abgeschlossen, wenn:
- [x] Skill-System mit Pilot-Skill (3.1) ✅
- [ ] MCP-Client als Skill-Provider (3.2)
- [ ] Memory: Conversation + Semantic (3.3)
- [ ] Memory: Episodic (3.4)
- [ ] Hyperbrowser als MCP-Skill (3.5)

Wenn alle Häkchen sitzen: Phase 3 done. Pause für Reflexion. Phase 4 starten.
