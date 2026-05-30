# Nolmi Roadmap

**Stand: 30. Mai 2026 (Tag 31).** Re-Baseline nach dem Rebrand (Twin-Lab → Nolmi) und dem Self-Hosting-VPS-Deploy. **Nolmi ist produktiv** auf `nolmi.ai` / `187.124.3.235`.

> **Re-Baseline-Vermerk:** Diese Version löst den veralteten „Stand 12. Mai" (Tag 12) ab und bildet den realen Stand nach Rebrand + VPS-Deploy ab. Sie bricht die Roadmap bewusst in **drei orthogonale Achsen** auf (Feature-Phasen / UX-Reifung / Vision-Patterns) und trennt den abgeschlossenen Infrastruktur-Meilenstein von der Produkt-Phasen-Achse — das löst die frühere Doppelbelegung von „Phase 4" auf (VPS-Deploy ≠ Produkt-Phase 4). Detail-Belege: `docs/STAND.md`, `docs/BACKLOG.md`, `docs/PRE-LAUNCH-A-STRATEGY.md`.

---

## Wie diese Roadmap zu lesen ist — drei Achsen

Die Entwicklung läuft auf **drei Achsen, die sich überlagern, aber nicht dasselbe sind**:

1. **Engineering / Feature-Phasen** (Phase 1 … 5+) — *was* der Twin technisch kann.
2. **UX-Reifungs-Stufen** (Stufe 0 … 3) — *für wen* die Oberfläche bedienbar ist. **Orthogonal** zu den Feature-Phasen (`docs/UX-STRATEGY.md`).
3. **Vision-Patterns** (acht menschliche Patterns, je Stufe 1–4) — *wie menschlich* der Twin über Zeit wird (`docs/TWIN-VISION.md`).

Ein Item kann auf einer Feature-Phase liegen, einer UX-Stufe dienen und einen Vision-Pattern reifen lassen — die drei Achsen werden hier getrennt geführt, damit „erledigt auf Achse X" nicht fälschlich „erledigt auf Achse Y" suggeriert.

---

## ✅ Infrastruktur-Meilenstein: Rebrand (Twin-Lab → Nolmi) + Self-Hosting-Deploy

**Abgeschlossen Tag 30–31 (28.–30. Mai 2026).** Kein Teil der Produkt-Phasen-Achse — ein eigenständiger Infrastruktur-/Marken-Meilenstein.

- **Rebrand Twin-Lab → Nolmi** (Phase 1–3b): Light-Mode-Theme, user-facing Strings, Env-/Package-/Cookie-Aliasing (`@twin-lab/*` → `@nolmi/*`), Verzeichnis-Rename + GitHub-Repo-Move zu `nolmi-ai/nolmi`. Strategie: [`docs/REBRAND-NOLMI-STRATEGY.md`](./REBRAND-NOLMI-STRATEGY.md). Trademark-Gate grün (USPTO + EUIPO).
- **Self-Hosting-VPS-Deploy** (B1–B6): eigener Hostinger-VPS `187.124.3.235`, 3-Service-Stack (runtime + web + bridge) unter `app/runtime/bridge.nolmi.ai`, vertraute Let's-Encrypt-Certs, BasicAuth, Doppel-DB-Migration der Echtdaten (byte-genauer Encryption-Key, Token-Match 3/3, A2A end-to-end). Strategie + Verlauf: [`docs/PHASE-4-VPS-STRATEGY.md`](./PHASE-4-VPS-STRATEGY.md).
- **Stand:** Nolmi produktiv. Alter Stack `srv1046432` (`twin.harwayexperience.com`) bleibt **Hot-Standby**; Abschaltung als spätere Einzelentscheidung (BACKLOG).

---

# ══ ACHSE 1 — Engineering / Feature-Phasen ══

## Wo wir stehen

**Phase 1 — Closed Twin** ✅ — Persona-Stil, Mandates, Audit-Log, Pending-Workflow.
**Phase 2 — A2A Bridge** ✅ — eigenständiger Bridge-Service, Twin-zu-Twin, Konversations-Threading.
**Phase 2.5 — Multi-Tenant** ✅ — Web-UI, Onboarding, User-Auth, Trust-Layer, Production. (2.5.5 Notifications bewusst verschoben.)

**Was live ist (Nolmi-Production):** `app.nolmi.ai` (Web-UI) · `runtime.nolmi.ai` (Runtime) · `bridge.nolmi.ai` (A2A-Bridge) · Owner @markus (produktiv) + @florian/@heiko (Test-Twins). Der alte `*.twin.harwayexperience.com`-Stack ist Standby.

---

## Architektur-Grundsetzungen Phase 3 (kompakt)

Vollständig in den Strategy-Docs (`docs/archive/3.4-STRATEGY.md`, `docs/131-OAUTH-STRATEGY.md`); die tragenden Setzungen in Kurzform:

- **Skill-Definition (Hybrid C):** Manifest + SKILL.md (+ optional Script). DB-Storage von Anfang an, Multi-Tenant pro Twin.
- **Skills gehören zu Capabilities, sind nicht selbst Capabilities.** Mandate-Layer bleibt unangetastet; Skill-Manifest hat `requires_approval` als Inner-Mandate.
- **MCP-Tools als Skills** registriert (`source: "mcp"`), kein zweites paralleles System. MCP-Client pro Twin, Lazy-Spawn + Idle-Timeout, Pre-Call-Approval.
- **Memory-Schichten in Eigen-Bau** (Anti-Lock-in): Conversation (Sliding-Window + Auto-Summary), Semantic (`facts`-KV als Truth-Source, Approval-Pattern für Twin-Extraction), Episodic (Vector-Embeddings via sqlite-vec, swappable Embedding-Provider Local/OpenAI/Voyage).
- **Approval async via Audit-State + LLM-Re-Run** (überlebt Restart), Marker-Pattern provider-agnostisch.

---

## Phase 3 — Skills + Memory + Tools ✅ (Production live)

Macht Twins inhaltlich tiefer. **Alle gebauten Sub-Schritte sind Production-live.**

- **3.1 — Skill-System Engine + Pilot** ✅ (Tag 7)
- **3.2 — MCP-Client als Skill-Provider** ✅ (Tag 10–11, inkl. Tool-Picker)
- **3.3 — Memory: Conversation + Semantic** ✅ (Tag 12–13, Production)
- **3.4 — Memory: Episodic** ✅ (Tag 13–15, **Production live**) — sqlite-vec, Hybrid-Search via RRF, Twin-Diary, Maintenance-CLI; Extended Foundation als Datenschicht für fünf Vision-Patterns. *Rest: formale Smoke-Phasen 3.4.H/3-5 nie förmlich abgehakt — Verifikations-Rest, kein Blocker.*
- **3.5 — Hyperbrowser als MCP-Skill** ✅ (Tag 16–17, **Production live, DoD 5/5**) — Cloud-Browser als MCP-Server, Drop-In auf MCP-Foundation.
- **3.7 — OpenAI-Subscription-OAuth (#131)** ✅ **Phase A komplett** (Tag 27–28) — Codex-Pattern als BYOK-Alternative, beide Auth-Modi durch identische Vercel-SDK-Pipeline. CLI-Login + Web-UI-Auth-Status. Polish-Quartett #139/#140/#141/#142 ✅ erledigt. Strategie: [`docs/131-OAUTH-STRATEGY.md`](./131-OAUTH-STRATEGY.md) (§a–§w). **Offen: Phase-B-Reste** #143 (Web-OAuth-Production ohne CLI), #144 (`--device-auth`/VPS-Linux-Pfad), #145 (Multi-Account).
- **3.6 — Procedural Memory / Computer-Use-Agent-Pattern** — **verschoben** auf Pre-Launch-Phase B oder später (Pivot Tag 18). Schmaler Recherche-Workflow (`search`+`scrape`+Synthese) lebt als Beta-Hook in Phase A (#107/#108). Lerngedächtnis (Twin schreibt Skills selbst) + Dream-Pattern-Andock (#94) bleiben langfristig.

**Auth-Bilanz:** Nolmi-Default bleibt BYOK (API-Key); OAuth ist Opt-in für ChatGPT-Subscriber.

### Definition of Done — Phase 3

- [x] Skill-System mit Pilot-Skill (3.1)
- [x] MCP-Client als Skill-Provider (3.2)
- [x] Conversation- + Semantic-Memory (3.3)
- [x] Episodic-Memory mit sqlite-vec (3.4) — Production live *(formale Smoke-Phasen 3-5 offen)*
- [x] Hyperbrowser als MCP-Skill (3.5) — DoD 5/5
- [x] Twin merkt sich Konversationen, kennt Fakten, nutzt externe Tools, navigiert das Web mit Approval-Gates

**Phase 3 ist im Kern abgeschlossen** (alle DoD-Häkchen sitzen). Verbleibende offene Reste sind Verifikations-Smokes, nicht Bau:

- **3.4.H Episodic-Smoke Phasen 3–5** — formale Smoke-Phasen nie grün abgehakt (Episodic ist Production-live). `docs/archive/3.4-SMOKE.md`.
- **3.4.4 Reasoning-Mapping-Smoke** — ~10 Min, nice, „mit Phase 4/5 mit-ziehen".

3.6 (Procedural) und die Vision-Pattern-Phasen sind nicht im engen Phase-3-DoD, ergeben sich aber aus der Vision (Achse 3).

---

## Pre-Launch-Phase A — Self-Hosting-Launch

**Status:** Build-Blöcke 1–5 sind **faktisch durch**. Real offen ist nur das **Launch-Quartett**. Strategy: `docs/PRE-LAUNCH-A-STRATEGY.md`.

| Block | Inhalt | Stand |
|---|---|---|
| 1 — UX-Welle 1 vollständig | #95/#100/#101/#98/#99/#86/#87 | ✅ durch (Tag 16–18) |
| 2 — Architektur-Follow-ups | #105 A2A-Modal, #106 DirectChat-View | ✅ durch (Tag 19) |
| 3 — Schmaler Computer-Use-Hook | #107 Recherche-Workflow, #108 Beta-Deklaration | ✅ durch (Tag 19–20) |
| 4 — Self-Hosting-Polish | #109 DEPLOYMENT, #110 Onboarding-Wizard, #111 Repo-Hygiene | ✅ durch (Tag 21–23) |
| 5 — Launch-Vorbereitung | #112 Landing, #113 Demo, #114 Posts, #115 Timing | ⏳ **offen** |

**Offen = der öffentliche Launch selbst** (#112 Landing-Page · #113 Demo/Walkthrough · #114 Launch-Post-Drafts · #115 Timing-Plan). Alles must, Größe M/S/S/XS.

**Pre-Launch-Phase B (nach Launch):** SaaS-Hosting, Persona-Builder-Chat, Mandate-Wizard, Phase 3.6 formell, OAuth-Phase-B (#143–#145).

---

## Phase 4 — Multi-Channel + Föderation (OFFEN — die echte nächste Feature-Front)

Twins werden überall erreichbar. Mit Vision-Updates: **Beziehungs-Modell** (Vertrautheits-Level pro A2A-Partner) als Phase-4-Erweiterung.

- **4.1 — Telegram-Adapter (Owner-Mode)** — Stufe 1 (Owner-Only-Bridge) **✅ vorgezogen + Production-live als #130** (Tag 23–26, `docs/130-TELEGRAM-STRATEGY.md`). **Vollausbau offen:** Stufe 2/3 (Multi-User, External-Sender-Approval) bleibt Phase 4.1.
- **4.2 — WhatsApp-Adapter (Owner-Mode)** — offen (~2–3 Wochen inkl. KYC).
- **4.3 — Public-Mode + Beziehungs-Modell** — Mandate-Layer für eingehende Channel-Messages + Vertrautheits-Level pro Gegenüber (Vision Block 1.3). Offen.
- **4.4 — Föderation (mehrere Bridges)** — Matrix-Modell, Twin auf Bridge-A ↔ Bridge-B; Cross-Twin-Embedding-Search. Offen (1–2 Monate).
- **4.5 — Google A2A-Adapter** — Ökosystem-Anbindung als Adapter-Schicht über der eigenen Bridge. Offen.

---

## Phase 5+ — Vision

P2P mit DIDs, optional Blockchain. Open-Core-Modus aus dem Vision-Doc.

---

# ══ ACHSE 2 — UX-Reifungs-Stufen (orthogonal) ══

UX-Reifung läuft **parallel zu allen Engineering-Phasen**, nicht als eigene Phase. Vier Reife-Stufen; jedes Item trägt einen Marker „Heute Stufe X → Ziel Stufe Y". Quelle: `docs/UX-STRATEGY.md`.

| Stufe | Zielgruppe | Stand |
|---|---|---|
| **0** | Engineer-Stand (funktional, technisch) | ✅ Ausgangslage |
| **1** | Less Technical (UX-Welle 1) | ✅ **abgeschlossen** (Welle 1, 11/11 Items, Tag 28) |
| **2** | Casual-User (mit Onboarding-Wizard) | ⏳ **nächste offene UX-Front** — Welle-2-Strategie-Session **ausstehend** |
| **3** | komplette Konzept-Abstraktion | Vision-Level, langfristig |

**Wichtig:** UX-Stufen ≠ Engineering-Phasen. „Phase 3 fertig" heißt nicht „Stufe 2 erreicht". Welle 1 hat mit Skill-Editor-UI (#86) + MCP-Konfigurator (#87) + Twin-Reife-Anzeige (#101) schon Stufe-2-Fundamente gelegt; der eigentliche Casual-User-Sprung (Welle 2) ist eine eigene Bau-Runde mit vorgeschalteter Strategie-Session. Persona-/Mandate-Editor-UI ist noch offen (BACKLOG #10/#76).

---

# ══ ACHSE 3 — Vision-Patterns (Reifungs-Pfade) ══

Aus `docs/TWIN-VISION.md`: Der Twin soll nicht wie ein Bot wirken, sondern wie ein Mensch. **Acht Patterns**, gleichgewichtet — jedes ist **kein Feature, sondern ein Reifungs-Pfad** mit Stufen 1–4 (Übergänge sind Vertrauens-Trigger, kein Zeitplan).

**Stufen-Schema (am Beispiel Soziale Proaktivität):** Stufe 1 = Twin schlägt vor, Markus entscheidet · Stufe 2 = autonom in klar definierten Kontexten (Trusted-Twins) mit Audit-Trail · Stufe 3 = autonom in mehr Kontexten, Markus beobachtet · Stufe 4 (Vision) = Twin pflegt eigenständig, Markus nur bei Ungewöhnlichem.

### Die acht Patterns (Ist → Ziel)

1. **Schlaf/Träume** — Memory-Verdichtung zwischen Konversationen → Background-Job (Dream-Pattern #94). *Ist: Datenschicht via 3.4 vorbereitet, Logic offen.*
2. **Zeit-Erleben** — „was ist lange her / frisch", Frequenz-Tracking. *Ist: Episodic-Foundation da, Helper-Logic offen.*
3. **Aufmerksamkeit/Fokus** — aktuelles Hauptthema, Cross-Conversation-Clustering. *Ist: Foundation da, Logic offen.*
4. **Gewohnheiten/Rituale** — Markus-typische Muster. *Ist: offen.*
5. **Werte-Drift** — Twin entwickelt sich mit Markus, mit Anker (siehe Leitplanken). *Ist: konzeptionell, offen.*
6. **Selbst-Reflexion** — Twin denkt über sich selbst nach (Auto-Diary, Inferenzen mit Approval). *Ist: Twin-Diary-CLI (3.4.F) als Baustein, Reflexions-Logic offen.*
7. **Lebens-Narrativ** — kohärente Story aus Fragmenten. *Ist: Foundation da, Narrative-Construction offen.*
8. **Soziale Proaktivität** — proaktiv an Beziehungen denken. *Ist: Stufe 1 (Vorschläge), höhere Stufen offen.*

*Verzichtbar (Backlog): Inkonsistenz, Erwartungs-Asymmetrie. Ausdrücklich ausgeschlossen: Stille/Pausen, Müdigkeit, emotionale Performance, Vergessen-mit-Bias (Relevanz-Pruning als Architektur-Feature aber erlaubt).*

### Verortete Bau-Stränge

- **Dream-Pattern (#94)** — periodischer Memory-Verdichtungs-Job; dockt an 3.4-Foundation, gehört konzeptionell zu 3.6.
- **Procedural Memory (Phase 3.6)** — Lerngedächtnis (Twin schreibt Skills selbst); **lt. UX-/Pre-Launch-Pivot auf Phase B verschoben**.
- **Selbst-Reflexion** — baut auf Twin-Diary (3.4.F) + Extract-Pattern (3.3.F).

Schätzung pro Pattern-Phase: 1–2 Tage Logic auf vorbereiteter Datenschicht. Reihenfolge offen, abhängig von Priorisierung.

### Ethische Leitplanken

Nicht hier dupliziert — **Source of Truth: `docs/TWIN-VISION.md` Block 3+4.** Kurz referenziert:
- **Identitäts-Transparenz** + **Ehrlichkeits-Prinzip** — Twin gibt sich nie als Markus selbst aus.
- **Approval-Pflicht für Inferenzen** — Twin-Interpretationen über Markus werden als Pending-Vorschläge gespeichert (Pattern wie 3.3.F), Markus approved/rejected; keine autonomen „eigenen Meinungen über Markus".
- **Drift mit Anker + Sichtbarkeit** — Identitäts-Kern bleibt stabil, Drift nur im Werte-Korridor, mit Drift-Tracking (Twin-Diary/Charakter-Report) und Reset-Möglichkeit.

---

# ══ Synthese ══

## Was als Nächstes konkret kommt

Die offene Front (ohne Priorisierung — das ist die **nächste Entscheidung**, siehe unten):

- **(a) Öffentlicher Launch** — Launch-Quartett #112 (Landing) / #113 (Demo) / #114 (Posts) / #115 (Timing). Das einzige real offene Stück von Pre-Launch-Phase A.
- **(b) Multi-Channel / Föderation (Phase 4)** — WhatsApp (4.2), Public-Mode + Beziehungs-Modell (4.3), Föderation (4.4), A2A-Adapter (4.5); Telegram-Vollausbau (4.1 Stufe 2/3).
- **(c) UX-Welle 2 / Stufe 2 (Casual-User)** — eigene Strategie-Session ausstehend; Persona-/Mandate-Editor-UI offen.
- **(d) Vision-Patterns (langfristig)** — die acht Reifungs-Pfade auf der 3.4-Foundation, plus 3.6 Procedural/Dream in Phase B.

> **Nächste Entscheidung (offen, hier bewusst nicht vorweggenommen):** Richtungs-Priorisierung — **Launch zuerst** (a) vs. **Multi-Channel-Tiefe zuerst** (b) vs. **Casual-User-UX zuerst** (c). Wird in der nächsten Strategie-Besprechung gesetzt.

---

## Timeline (grob, bei realistischem Tempo)

| Strang | Größenordnung |
|---|---|
| Öffentlicher Launch (#112–#115) | Tage |
| Phase 4 Multi-Channel (4.2–4.5) | Monate |
| UX-Welle 2 / Stufe 2 | eigene Bau-Runde nach Strategie-Session |
| Vision-Pattern-Phasen | je 1–2 Tage Logic, Reihenfolge offen |

**Realitäts-Note:** Phase 1–3.5 + 3.7-Phase-A + Rebrand + VPS-Deploy in ~31 Arbeitstagen. Tempo blieb hoch, weil Patterns wiederverwendbar sind und die Sub-Schritt-Aufteilung mit Smoke pro Layer trägt.

## Veröffentlichungs-Strategie (aus Vision-Doc)

**Aktuell offen, Tendenz Open Core.** SaaS-Hosting-Service als Default, Open-Source-Komponente offen; Code Public-tauglich strukturiert. **MVP first** — in Konfliktfällen gewinnt MVP-Pragmatik, Migrations-Schmerz später akzeptiert.

## Verweise

- `docs/STAND.md` — laufender Bau-Stand (Tag-für-Tag, Blöcke)
- `docs/BACKLOG.md` — offene Items nach Priorität/Größe
- `docs/PRE-LAUNCH-A-STRATEGY.md` — Launch-Sondersituation (Blöcke 1–5)
- `docs/UX-STRATEGY.md` — Achse 2 (UX-Reifung)
- `docs/TWIN-VISION.md` — Achse 3 (Vision-Patterns + ethische Leitplanken)
- `docs/REBRAND-NOLMI-STRATEGY.md` + `docs/PHASE-4-VPS-STRATEGY.md` — Infrastruktur-Meilenstein
- `docs/131-OAUTH-STRATEGY.md` — OAuth (#131) Voll-Doku
