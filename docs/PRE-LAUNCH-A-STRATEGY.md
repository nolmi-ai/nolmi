# Pre-Launch-Phase A: Self-Hosting-Launch

**Datum:** 17. Mai 2026 (Tag 18, Strategie-Session Vormittag)
**Ziel:** Twin-Lab Open-Source-Repo öffentlich nutzbar für Tech-Affine,
~6 Wochen Bauzeit
**Launch-Datum:** Ende Juni / Anfang Juli 2026 (weiches Ziel)
**Scope:** Self-Hosting only. SaaS folgt in Phase B.

**Charakter dieses Dokuments:** Strategie-Setzung, **nicht Bau-Briefing**.
Konkrete Sub-Schritte und Item-Tickets entstehen in Folge-Briefings auf
Basis dieser Setzungen. Geänderte ROADMAP/STAND/BACKLOG/VISION-Updates
kommen ebenfalls in einem Folge-Briefing — dieses Doc ist die Foundation.

## Kontext

Drei-Monats-Public-Launch-Ziel: tech-affine User können Twin-Lab
klonen, deployen, einen Twin anlegen, ihn nutzen — ohne externe Hilfe
oder Doku-Marathon.

Daraus emergiert ein **Zwei-Phasen-Launch:**

- **Phase A (jetzt, ~6 Wochen):** Self-Hosting für Tech-Affine.
  Open-Source-Repo, eigene VPS, Tech-Setup machbar. Schnelle externe
  User-Iteration, Real-Use-Feedback.
- **Phase B (danach, ~6-8 Wochen):** SaaS für Casual. Hosted-Variante
  auf twin-lab.com, kein Tech-Setup, Freemium-Modell.

Phase A liefert Differenzierungs-Story-Validation mit echten Usern.
Phase B baut auf Real-Use-Daten aus Phase A auf.

Pre-Launch-Phase A ist **orthogonal** zu den Engineering-Phasen (analog
zur UX-Welle-1-Klärung Tag 17 Abend): sie zieht Items aus UX-Welle 1,
aus offenen Backlog-Plänen und neuen Launch-Vorbereitungs-Items in einen
zeit-getakteten 6-Wochen-Plan zusammen.

## Strategische Entscheidungen

### Entscheidung 1 — Differenzierungs-Story

**Setzung:** Twin-Lab differenziert sich über **Memory-Tiefe + Persona +
A2A-Bridge**, nicht über Computer-Use-Agent.

**Begründung:**
- **A2A-Bridge** ist strukturell einzigartig — kein anderer Twin-/
  AI-Stack hat Twins, die untereinander kommunizieren mit
  Vertrauens-Levels und Owner-Direkt-Chats.
- **Memory-Tiefe als Identitäts-Kern** (Episodic + Semantic + Facts +
  Vision-Patterns wie Twin-Reife) — bei anderen ist Memory ein Feature,
  hier ist es die Identität.
- **Computer-Use** ist cool, aber kein Differenzierer — Hermes,
  OpenClaw, Anthropic-eigene Tools machen das alle.

**Konsequenz:** Vision-Sichtbarkeit-Items sind nicht „nice-to-have",
sondern **Pflicht für die Differenzierungs-Story**:
- #100 Memory-Hit-Indikator (User sieht, dass Twin sich erinnert)
- #101 Twin-Reife-Anzeige (User sieht, dass Twin sich entwickelt)
- #99 Audit-Trail menschlich lesbar (Vision Vererbung — Block 4)

### Entscheidung 2 — Computer-Use als schmaler Hook, nicht als Phase

**Setzung:** Phase 3.6 (Computer-Use-Agent-Pattern) wird auf Phase B
oder später **verschoben** (nicht gestrichen). **Schmaler Recherche-
Workflow** bleibt im Self-Hosting-Launch als Hook-Feature,
**Beta-deklariert**.

**Konkret bleibt drin:** Twin kann auf Anfrage zu einem Thema
recherchieren — `search_with_bing` + `scrape_webpage` auf 2–5 Quellen
plus Synthese. Latenz 30–60 s, Kosten überschaubar, funktional seit
Hyperbrowser-Foundation (3.5, Tag 17 in Production) möglich.

**Konkret raus:** Multi-Step-Browser-Workflows mit
`claude_computer_use_agent` (z.B. Workshop-Slot buchen, Plattform-Logins,
Persistent-Profiles). Das ist Phase B oder 3.6-formell.

**Begründung:** Recherche-Workflow ist eine klare Capability mit
verständlichem User-Wert, ohne die Komplexität von echtem autonomen
Browser-Handeln. Plus: er nutzt die seit Tag 17 deployed
Hyperbrowser-Foundation — kein neuer Backend-Bau nötig, nur Skill-/
Persona-Pattern.

### Entscheidung 3 — Solo Bau, kein Team-Parallelisierung

**Setzung:** Pre-Launch-Phase A wird solo gebaut. Florian/Heiko nicht
eingebunden.

**Begründung:** Markus' Entscheidung. Florian (Designer) und Heiko
(Engineering) haben andere Prioritäten. Solo-Pace ist realistisch, wenn
Scope diszipliniert bleibt.

**Konsequenz:** Scope-Disziplin ist Pflicht. Items, die nicht in der
unten definierten Pflicht-Liste stehen, werden in Phase B oder später
geschoben — kein „nice-to-have"-Drift.

### Entscheidung 4 — Build-Pfad: Hybrid (Tranche A erst, dann Vision-kritisch, dann Rest)

**Setzung:**

1. **UX-Welle 1 Tranche A abschließen** — #95 zuerst, sofort
2. **Vision-kritische Items aus Tranche B/C vorziehen** — #100
   Memory-Hit, #101 Twin-Reife
3. **Restliche UX-Welle-1-Items** — #86 Skill-Editor, #87 MCP-
   Configurator, #98 Cost-Preview, #99 Audit-View
4. **Architektur-Follow-ups** — #105 A2A-Modal, #106 DirectChat-View
5. **Schmaler Recherche-Workflow** — neue Skill-/Pattern-Definition
6. **Self-Hosting-Polish** — neue Items, siehe Block 4
7. **Launch-Vorbereitung** — neue Items, siehe Block 5

**Begründung:** Tranche A räumt die Quick-Wins ab und gibt Foundation
für #100/#101. Vision-Items früh, weil sie die Story tragen — wenn ein
Test-User in Woche 4 schaut, müssen sie sichtbar sein.

## Pflicht-Items für Pre-Launch-Phase A

Items mit Größen-Schätzung und Status. Items mit `#NN` sind bereits im
BACKLOG.md; Items mit `(neu)` werden im Folge-Briefing dort angelegt.

### Block 1 — UX-Welle 1 vollständig (~20–25 Tage)

| Item | Größe | Status | Anmerkung |
|---|---|---|---|
| #95 Tool-Names human-readable | S | offen | sofort, heute |
| #100 Memory-Hit-Indikator | S | offen | vorgezogen, Vision-Foundation |
| #101 Twin-Reife-Anzeige | L | offen | vorgezogen, Vision-Foundation, eigene Strategie-Session vorab |
| #98 Cost-Preview vor Approve | M | offen | |
| #99 Audit-Trail menschlich | M | offen | Vision Vererbung |
| #86 Skill-Editor-UI | L | offen | Tranche C |
| #87 MCP-Configurator-UI | L | offen | Tranche C |

### Block 2 — Architektur-Follow-ups (~5–8 Tage)

| Item | Größe | Status |
|---|---|---|
| #105 A2A-Modal: erste Nachricht optional | M | offen |
| #106 DirectChat-View-Architektur | L | offen (mit Strategy-Session vorab) |

### Block 3 — Schmaler Computer-Use-Hook (~2–3 Tage)

**Neue Items, im Folge-Briefing anzulegen:**

- **Recherche-Workflow-Skill:** User-Query → `search` + `scrape` +
  Synthese. Pattern als Skill-Definition (kein neuer Code), Persona-
  Pattern-Hinweis, dass Twin proaktiv recherchieren soll.
- **Launch-Deklaration „Recherche-Capability (Beta)"** in README +
  Landing-Page.

### Block 4 — Self-Hosting-Polish (~5–7 Tage)

**Neue Items, im Folge-Briefing anzulegen:**

- **DEPLOYMENT.md production-fest** mit Self-Hoster-Smoke-Test
  (externer Tester, evtl. Heiko punktuell).
- **Onboarding-Wizard im UI** (erster Login + Twin-Anlage).
- **Public-Repo-Hygiene:** README mit klarer Pitch + Quick-Start,
  LICENSE (MIT? Apache 2.0?), CONTRIBUTING.md, Issue-Templates.

### Block 5 — Launch-Vorbereitung (~5–7 Tage)

**Neue Items, im Folge-Briefing anzulegen:**

- **Landing-Page** (minimal, README-style ok): What is Twin-Lab,
  Differenzierungs-Pitch, Quick-Start-Demo.
- **Demo-Video oder schriftlicher Walkthrough** (5–10 Min).
- **Launch-Post-Drafts** (Twitter-Thread, Hacker-News-Submission).
- **Launch-Timing-Plan** (Wochentag, Uhrzeit, Reichweiten-Strategie).

## Pflicht-Aufwand-Summe

| Block | Tage |
|---|---|
| Block 1 — UX-Welle 1 vollständig | 20–25 |
| Block 2 — Architektur-Follow-ups | 5–8 |
| Block 3 — Schmaler Computer-Use-Hook | 2–3 |
| Block 4 — Self-Hosting-Polish | 5–7 |
| Block 5 — Launch-Vorbereitung | 5–7 |
| **Total** | **37–50 Tage Pflicht** |

Bei **42 Tagen verfügbar** (6 Wochen × 7 Tage; in der Praxis mit
Wochenenden-Mix-Use realistisch) ist das **knapp, aber machbar bei
strikter Scope-Disziplin**.

## Anti-Goals für Pre-Launch-Phase A

- **SaaS-Hosting-Infrastruktur** — Phase B
- **Persona-Builder als Chat** statt YAML — Phase B
- **MCP-Marketplace** statt CLI/UI-Configurator — Phase B
- **Mandate-Wizard mit Presets** — Phase B
- **Phase 3.6 formell** mit `claude_computer_use_agent` — Phase B
  oder später
- **Mobile-App** — langfristig, UX-Stufe 3
- **Vererbungs-Modus First-Class** — langfristig
- **Pattern-Phasen** (Zeit-Erleben, Diary-UI, Narrativ-Pattern) — nach
  Launch

## Risiko-Hinweise

### Risiko 1 — Scope-Creep

Solo-Bau in 6 Wochen ist eng. Wenn ein Block länger braucht als
geschätzt, **muss ein anderer Block gekürzt werden** — nicht alle
aufgeblasen. Konkreter Kürzungs-Hebel: Block 1 #86/#87 könnten in der
ersten Iteration mit reduziertem Feature-Umfang (Read-Only-UI, CRUD via
Folge-Bau) ausgeliefert werden.

### Risiko 2 — Vision-Sichtbarkeit greift nicht

Wenn #100 und #101 nach Bau visuell schwach sind („Memory-Hit-Icon ist
da, aber niemand klickt drauf"), kollabiert die Differenzierungs-Story.

**Mitigation:** nach #100/#101 Smoke mit externem Test-User (z.B. Heiko
punktuell als kritischer Reviewer). Falls Pattern nicht trägt, vor dem
Launch nachjustieren — nicht das Pattern, sondern die Sichtbarkeit
(größeres Badge, mehr Kontext-Tooltip, Onboarding-Hinweis im Empty-State).

### Risiko 3 — Recherche-Workflow-Hook funktioniert nicht

Hyperbrowser-Foundation läuft seit Tag 17, aber das *Pattern* „Twin
recherchiert proaktiv" braucht Persona-Tuning. Falls das nicht klappt,
fällt der Hook weg — Differenzierung trägt sich dann allein über A2A +
Memory.

**Mitigation:** Block 3 ist explizit auf 2–3 Tage scoped. Wenn nach
zwei Tagen klar wird, dass Persona-Tuning nicht zuverlässig greift,
Hook deklarieren als „experimentell, manuell triggern" statt „Twin
recherchiert proaktiv". Keine Investition in Persona-Engineering über
zwei Tage hinaus.

### Risiko 4 — Self-Hosting-Onboarding-Friktion höher als erwartet

Solo-Test reicht nicht — externer Self-Hoster-Test ist Pflicht. Falls
Heiko nicht verfügbar: Florian oder ein externer Tech-Affine.

**Mitigation:** Self-Hoster-Test ist Block-4-Bestandteil und sollte
mindestens 2 Wochen vor dem Launch passieren, damit Friktions-Fixes
nicht in die letzten Tage rutschen.

## Was nach Pre-Launch-Phase A

### Pre-Launch-Phase B (~6–8 Wochen, nach Phase-A-Launch)

- **SaaS-Hosting-Infrastruktur** (Quota, Pricing, API-Key-Abstraktion)
- **Persona-Builder als Chat**
- **Onboarding-Wizard mit Hand-Holding**
- **Mandate-Wizard**
- **Phase 3.6 Computer-Use-Agent formell** (oder schmaler Hyperbrowser-
  Workflow-Pattern-Erweiterung, je nach Real-Use-Daten aus Phase A)

### UX-Welle 2 (nach Phase B oder parallel)

- **Stufe-2-Ziel:** Casual-User-fähig ohne Hand-Holding
- **MCP-Marketplace**
- **Mobile-App-Adaption**

## Verweise

- `docs/TWIN-VISION.md` — Vision-Foundation; insb. Block 2.5
  (Reife-sichtbar) und Block 1.3 (SaaS-Onboarding)
- `docs/ROADMAP.md` — wird im Folge-Briefing an die neue Phase-A/B-
  Struktur angepasst
- `docs/UX-STRATEGY.md` — Welle 1 wird Teil von Pre-Launch-Phase A
- `docs/BACKLOG.md` — neue Items aus Block 3/4/5 werden im Folge-
  Briefing angelegt
- `docs/BACKLOG.md` #27 — Phase 3.6 (Hyperbrowser/Computer-Use) wird
  formal auf Phase B verschoben
- `docs/3.5-STRATEGY.md` Section „Was nach 3.5 Foundation kommt" —
  die dort formulierte Phase-3.6-Erwartung wird hier formal pausiert
- `docs/3.4-STRATEGY.md` / `docs/3.5-STRATEGY.md` — Format-Vorlage für
  dieses Dokument
