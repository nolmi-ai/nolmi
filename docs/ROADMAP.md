# twin-lab Roadmap

Stand: 12. Mai 2026 Nachmittag, nach Phase 3.3 in Production deployed plus Vision-Session plus Strategie-Session vor Phase 3.4.

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

**Pre-Call-Approval, kein Post-Call-Reject.** Schreibende Tools sind das eigentliche Risiko, Post-Call wäre zu spät. Read-only-Tools können mit `requires_approval=false` direkt durchgewunken werden. Owner-Bypass für Tool-Approval explizit NICHT implementiert.

**Async via Audit-State + LLM-Re-Run, nicht synchroner Block.** Pending-State persistiert via Audit, überlebt Server-Restart. Resume nach Approve startet neuen `runOwnerDirect`-Call mit angereichter Message-History.

**Marker-Pattern als Primary für Approval-Trigger.** AI SDK 6 propagiert Throws aus `execute()` nicht nach oben (Smoke-Test verifiziert). Marker-String im content-Array ist provider-agnostisch.

### Architektur-Entscheidungen (11. Mai 2026, vor Phase 3.3)

**Eigen-Bau für Memory-Schichten statt Cognee/Dreams-Adoption.** Geprüft, beide spannend aber Eigen-Bau wegen Anti-Lock-in und Provider-Agnostik. Beide als Backlog (#93 Cognee, #94 Dream-Pattern).

**Conversation-Memory: Sliding-Window mit Auto-Summary.** Trigger >50 zählende Messages, Summary-Block der ältesten 40, Live-Window 10.

**Semantic-Memory: KV-Store als Truth-Source.** Tabelle `facts` mit Multi-Tenant-Isolation. source ∈ {user, twin, import}, confidence ∈ {approved, pending, auto, rejected}.

**Facts als Persona-konstitutiv im System-Prompt.** Facts werden direkt nach Persona kombiniert via `personaWithFacts` als 2. Schicht.

**Twin-getriebene Fact-Extraction via Approval-Pattern aus 3.2.F.** Capability `semantic-fact-write`, generische Approve/Reject-Routen mit Switch.

### Architektur-Entscheidungen (12. Mai 2026, vor Phase 3.4)

**Embedding-Provider als swappable Interface.** Drei Implementierungen von Anfang an (Local, OpenAI, Voyage) — Self-Hosting-Use-Cases (besonders Enterprise) müssen ohne externe APIs funktionieren. Default lokal mit `Xenova/multilingual-e5-large` für deutsche Inhalte. Begründung: User soll nicht zwei API-Keys brauchen, plus Datenschutz-Pfad für Enterprise.

**Embedding-Granularität: primary pro Summary-Segment, plus pro abgeschlossene Konversation.** Direkte Anknüpfung an 3.3.B Output.

**Retrieval: Always-On Top-K=3 mit Similarity-Threshold 0.7.** Sechste Schicht im System-Prompt. Tool-Call-Pattern als spätere Erweiterung (Item #89 blockiert).

**Update: Synchron beim Schreiben.** Embedding-Failure unterbricht Hauptoperation nicht. Boolean-Flag `embedding_status` für Pending-Queue.

**Extended Foundation: Datenschicht-Erweiterungen für die fünf abhängigen Patterns** (Zeit-Erleben, Aufmerksamkeit, Selbst-Reflexion, Lebens-Narrativ, Schlaf/Träume). Pattern-Logic kommt in eigenen späteren Phasen.

Vollständige Strategie-Doku: `docs/3.4-STRATEGY.md`.

---

## Phase 3 — Sub-Schritte

### 3.1 — Skill-System Engine + Pilot ✅
**Abgeschlossen 6. Mai 2026 (Tag 7).** Fünf Sub-Schritte (3.1.A-F) an einem Vormittag.

- **3.1.A** ✅ DB-Schema + Skill-Repo (`2c1cfd0`)
- **3.1.B+C** ✅ Engine + System-Prompt-Integration (`b2b796e`)
- **3.1.D** ✅ CLI-Tool zum Importieren (`7c65c41`)
- **3.1.E** ✅ Read-only UI + Toggle (`5fbf254`)
- **3.1.F** ✅ Pilot-Skill HARWAY-Workshop-Kontext

**Aufgedeckter Architektur-Befund:** Persona-Skill-Doppelung — Backlog-Item #74.

### 3.2 — MCP-Client als Skill-Provider ✅
**Abgeschlossen 9. Mai 2026 (Tag 10).** Sieben Sub-Schritte plus Tool-Picker.

- **3.2.A-G** ✅ MCP-Foundation (`2bf1ee0`, `daa03b7`, `cd5b295`, `366ca93`, `43258cf`, `b58df94`, `bce54fb`)
- **3.2.H** ✅ Tool-Picker-UI als strukturelle Lösung für #89 (`b97ae80`, Tag 11 Mittag)

### 3.3 — Memory: Conversation + Semantic ✅
**Abgeschlossen 11. Mai 2026 (Tag 12) lokal, 12. Mai 2026 (Tag 13 Vormittag) in Production.**

Sieben Sub-Schritte plus drei UI-Sub-Schritte, neun Commits:

- **3.3.A** ✅ Schema + Repos (`9b4d5c5`)
- **3.3.B** ✅ Summary-Engine im Send-Path (`9fc1ebb`)
- **3.3.C** ✅ History-Loader liest Summaries (`0eb941e`)
- **3.3.D** ✅ Facts-API + CLI (`49fe0b7`)
- **3.3.E** ✅ Facts in Twin-Prompt (`1a8a128`)
- **3.3.F** ✅ Twin-Fact-Extraction mit Approval-Gate (`f1cfa65`)
- **3.3.G1** ✅ Inbox-Render für semantic-fact-write (`bf7b6d5`)
- **3.3.G2** ✅ Facts-Settings-View (`fc3f6b3`)
- **3.3.G3** ✅ Manual-Extract-Button + Reset-Confirm-Dialog (`a3c868b`)

**Production-Deploy Tag 13:** Tag-12-Stand auf VPS, sieben qualitativ hochwertige Twin-Extracted Facts aus erstem Smoke-Test. End-to-End-Verifikation grün.

### Vision-Session (11.-12. Mai 2026)

Initiiert durch Markus' Morgenfrage über autonome träumende Agents. Vier Blöcke (Wer soll Twin sein, Menschliche Patterns, Ethische Grenzen, Eigentum/Existenz). Ergebnis: `docs/TWIN-VISION.md` (Commit `6bc9a05`).

**Kern-Setzung:** "Twin hat Markus' Substanz, bessere Disziplin als Markus an müden Tagen, und entwickelt sich über Zeit zu einem eigenständigen Wesen — mit klaren Reifungs-Stufen und unter ethischen Leitplanken."

**Acht menschliche Patterns:** Schlaf/Träume, Zeit-Erleben, Aufmerksamkeit/Fokus, Gewohnheiten/Rituale, Werte-Drift, Selbst-Reflexion, Lebens-Narrativ, Soziale Proaktivität. Plus Reifungs-Stufen pro Pattern.

**Strategische Konsequenzen für die Roadmap:** Phase 3.4 ist nicht nur "noch eine Memory-Schicht", sondern das technische Fundament für fünf der acht Patterns. Episodic-Memory als Träger für Zeit-Erleben, Schlaf/Träume, Aufmerksamkeit, Lebens-Narrativ, Selbst-Reflexion.

### 3.4 — Memory: Episodic
**Größe:** L · **Zeitfenster:** 1.5-2 Sessions · **Status:** Strategie abgeschlossen, Bau-Start unmittelbar.

Vector-Embeddings für "Twin erinnert sich an spezifische Events". Plus Datenschicht-Vorbereitung für die fünf abhängigen Patterns aus der Vision (Extended Foundation).

Acht Sub-Schritte geplant:

- **3.4.A** Schema + Repos (Migrations 017-019: embeddings, twin_diary, embedding-Spalten)
- **3.4.B** Embedding-Provider-Interface (Local, OpenAI, Voyage)
- **3.4.C** Lokales Modell-Setup (multilingual-e5-large)
- **3.4.D** Synchrone Embedding-Generation (Integration in 3.3.B + 3.3.G3)
- **3.4.E** Vector-Search im Send-Path (sixth-layer in System-Prompt)
- **3.4.F** Twin-Diary Foundation (Schema, Repo, CLI)
- **3.4.G** Maintenance-CLI `twin:memory-embed-all`
- **3.4.H** End-to-End-Smoke-Test

Vollständige Spec: `docs/3.4-STRATEGY.md`.

### 3.5 — Hyperbrowser als MCP-Skill
**Größe:** M · **Zeitfenster:** 1 Woche

Cloud-Browser-Infrastruktur (hyperbrowser.ai) als MCP-Server. Direkter Drop-In auf MCP-Foundation aus 3.2, ENV-Wert für API-Key.

### 3.6 — Procedural Memory (optional, ggf. Phase 4)
**Größe:** XL · **Zeitfenster:** 2-3 Wochen oder später

Lerngedächtnis. Twin lernt aus Approves/Rejects/Edits, schreibt Skills selbst. Plus möglicher Andock-Punkt für #94 (Dream-Pattern).

### Pattern-Phasen (nach 3.4, vor oder parallel zu 3.5/3.6)

Nach 3.4-Foundation können die fünf abhängigen Patterns relativ schnell folgen — sind Logic-Erweiterungen auf vorbereiteter Datenschicht.

Reihenfolge offen, abhängig von Priorisierung. Mögliche Pattern-Phasen:

- **Zeit-Erleben** — Helpers für "wann war was zuletzt", Frequenz-Tracking, Aging-Indikatoren
- **Aufmerksamkeit/Fokus** — Cross-Conversation-Clustering, Auto-Topic-Tagging, "aktuelles Hauptthema"-Erkennung
- **Selbst-Reflexion** — Auto-Diary-Generierung, Twin-eigene Notizen, Inferenzen über sich selbst
- **Lebens-Narrativ** — Narrative-Thread-Construction, kohärente Story-Linien aus Fragmenten
- **Schlaf/Träume** — Background-Job-Infrastruktur, periodischer Memory-Verdichtungs-Job (#94 adaptiert)

Schätzung pro Pattern-Phase: 1-2 Tage. Sechs Häkchen nach Phase 3.4 würden den ursprünglichen Phase-3-DoD substantiell erweitern.

---

## Phase 3 Total

**Zeitfenster:** 7-12 Wochen, je nach Tiefe.
**Realistisch:** 2-3 Monate bei aktuellem Tempo. Aber: Pattern-Phasen können in 1-2 Monaten zusätzlich kommen.
**Definition of Done für Phase 3:**
- [x] Skill-System läuft mit Pilot-Skill (3.1.A-F) ✅
- [x] MCP-Client als Skill-Provider integriert (3.2.A-H) ✅
- [x] Conversation-Memory + Semantic-Memory live (3.3.A-G3) ✅
- [ ] Episodic-Memory mit sqlite-vec (3.4.A-H, Bau-Start unmittelbar)
- [ ] Hyperbrowser als MCP-Skill (3.5)
- [ ] Twin merkt sich Konversationen, kennt Fakten, nutzt externe Tools, navigiert das Web mit Approval-Gates

3.6 (Procedural Memory) und die Pattern-Phasen sind nicht im engen DoD, ergeben sich aber natürlich aus der Vision.

---

## Phase 4 — Multi-Channel + Föderation

Twins werden überall erreichbar. **Phase 4-Inhalte mit Vision-Updates:**

- **Beziehungs-Modell** als Phase-4-Erweiterung (Vertrautheits-Level pro A2A-Partner, Kontext-Typ) — sichtbar geworden durch Vision Block 1.3
- **Multi-Channel** (Telegram, WhatsApp, Public-Mode) wie bisher geplant

### 4.1 — Telegram-Adapter (Owner-Mode)
**Zeitfenster:** ~1 Woche

### 4.2 — WhatsApp-Adapter (Owner-Mode)
**Zeitfenster:** 2-3 Wochen inkl. KYC-Bürokratie

### 4.3 — Public-Mode + Beziehungs-Modell
Mandate-Layer für eingehende Channel-Messages plus Vertrautheits-Level pro Gegenüber (aus Vision Block 1.3).
**Zeitfenster:** 2-3 Wochen

### 4.4 — Föderation (mehrere Bridges)
Matrix-Modell. Twin auf Bridge-A spricht mit Twin auf Bridge-B. Plus: Cross-Twin-Embedding-Search wenn Provider abgeglichen sind.
**Zeitfenster:** 1-2 Monate

### 4.5 — Google A2A-Adapter
**Zeitfenster:** 2-3 Wochen

---

## Phase 5+ — Vision

P2P mit DIDs, optional Blockchain. Plus Open-Core-Modus aus Vision-Doc.

---

## Zusammenfassende Timeline

Bei realistischem Tempo:

| Phase | Zeitfenster | Kalenderzeit |
|-------|-------------|--------------|
| 3 (Skills + Memory + Tools) | 7-12 Wochen | 2-3 Monate |
| Pattern-Phasen (optional) | 1-2 Monate | 1-2 Monate |
| 4 (Multi-Channel) | 3-4 Monate | 4-5 Monate |

**Bis Ende Juli/August 2026:** Phase 3 abgeschlossen.
**Bis Ende 2026:** Phase 4 weitgehend fertig.

**Realität nach Tag 13:** Phase 3.1, 3.2, 3.3 komplett — drei von fünf Phase-3-Sub-Schritten in 6 Tagen Arbeit (Tag 7 + Tag 10 + Tag 11 + Tag 12 + Tag 13). Plus Vision-Session als strategisches Doc, plus Production-Deploy 3.3. Tempo bleibt konsequent hoch, weil Patterns wiederverwendbar sind und die Sub-Schritt-Aufteilung mit Tests pro Layer bei allen drei großen Phasen gehalten hat.

---

## Veröffentlichungs-Strategie (aus Vision-Doc)

**Aktuell offen, Tendenz Open Core.** SaaS-Hosting-Service als Default, Open-Source-Komponente offen. Code so strukturiert dass Public-tauglich.

**MVP first, Lebens-Projekt skaliert mit:** in Konfliktfällen gewinnt MVP-Pragmatik, Migrations-Schmerz später akzeptiert.

---

## Was als Nächstes konkret kommt

**Heute Nachmittag (Tag 13) nach Doku-Commits:** Sub-Schritt 3.4.A — Schema + Repos plus Migrations 017-019.

**Nächste Sessions:**
- 3.4.B-H durchziehen (Embedding-Provider, Lokales Modell, Synchrone Embedding-Gen, Vector-Search, Twin-Diary, Maintenance-CLI, Smoke-Test)
- Production-Deploy Phase 3.4
- Strategie-Session vor 3.5 (Hyperbrowser) — kleiner als 3.4-Strategie weil bekannter Bereich

**Vermutlich danach:**
- Optional Pattern-Phase (z.B. Zeit-Erleben, weil schnellster Win auf Foundation)
- Phase 3.5 Hyperbrowser
- Phase 3.6 Procedural Memory inkl. Dream-Pattern

---

## Stop-Punkt-Definition Phase 3

Phase 3 ist abgeschlossen, wenn:
- [x] Skill-System mit Pilot-Skill (3.1) ✅
- [x] MCP-Client als Skill-Provider (3.2) ✅
- [x] Memory: Conversation + Semantic (3.3) ✅
- [ ] Memory: Episodic (3.4) — in Bau
- [ ] Hyperbrowser als MCP-Skill (3.5)

Wenn alle Häkchen sitzen: Phase 3 done. Pause für Reflexion. Phase 4 starten. Pattern-Phasen können parallel mitlaufen oder nachgezogen werden.
