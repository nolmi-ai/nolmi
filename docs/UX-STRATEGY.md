# UX-Reifung Strategy: Less Technical First

**Datum:** 16. Mai 2026, Abend (Tag 17)
**Scope:** Welle 1 — erste Bau-Runde der UX-Reifung-Spur. Bringt
die UI auf Stufe 1 (Less Technical) und legt mit drei Tranche-C-
Vorbereitungs-Items schon Fundamente für Stufe 2. Parallel zu
Phase 3.6. Stufe 2 / Welle 2 als eigene Strategie-Session,
Stufe 3 langfristig.

**Vokabular:** „Welle" ist eine Bau-Runde (zeitlich, mehrere Items),
„Stufe" ist die Reife-Ziel-Marke eines einzelnen Items. Welle 1
adressiert primär Items mit Ziel Stufe 1, plus drei mit Ziel Stufe 2.

**Stand Tag 28 (26. Mai 2026):** UX-Welle 1 ist abgeschlossen (11/11 Items
durch, alle in Production). „Parallel zu Phase 3.6"-Formulierung im Original
ist nicht mehr aktuell — Phase 3.6 (Computer-Use-Agent-Pattern) wurde Tag 18
auf Pre-Launch-Phase B verschoben (siehe `PRE-LAUNCH-A-STRATEGY.md` Entscheidung
2). Schmaler Computer-Use-Hook (#107/#108) statt formelle Phase 3.6 ist live.

## Kontext

twin-lab ist nach Phase 3.5 Production-Live funktional vollständig —
Phase 3 Definition of Done erfüllt. Aber UX-mäßig ist die Plattform
heute auf Engineer-Niveau:

- Skills/MCP-Server nur via CLI anlegbar
- Tool-Names im Approve-Dialog sind Engineering-Identifier
- Mandates und Facts in YAML, nicht UI-bedienbar
- Memory-Effekt nicht sichtbar
- Twin-Reife-Stufen nicht UI-sichtbar (Vision Block 2.5)
- `window.prompt()` und `alert()` statt App-konsistenter Modals/Toasts

Diese Reibung ist für aktuelle User (Markus, Florian, Heiko) lösbar
durch Doku-Lookup, aber blockt das Vision-Ziel (Open Core, breitere
User-Schicht). Plus: UX ist der Bereich, wo twin-lab gegenüber
Hermes/OpenClaw und ähnlichen Open-Source-Frameworks am meisten
differenzieren kann — Engineering-Substanz ist ähnlich, UX nicht.

## Reife-Stufen-Konzept

Statt „Phase X macht alles, Phase Y macht alles besser" wird jeder
Pain-Point gestuft. Das hat zwei Effekte: (a) ehrlicher Stand, (b)
inkrementelle Verbesserung statt Big-Bang.

| Stufe | Wer kommt klar? | Wann |
|---|---|---|
| **0** | Engineer mit Repo-Kenntnis | heute |
| **1** | Tech-Affine ohne Doku-Lookup | parallel Phase 3.6 |
| **2** | Casual-User mit Onboarding-Wizard | Phase 4-Vorbereitung |
| **3** | Ohne tech. Vorkenntnis | langfristig, mit SaaS-Launch |

**Backlog-Stufung:** jedes Item bekommt einen Stufen-Marker, der
sagt: „Heute Stufe X, Ziel Stufe Y". Items ohne Marker = Stufe 0
implizit (Engineer-Stand, UX-irrelevant für aktuelle Spur).

## Verhältnis zur Roadmap

UX-Reifung ist **orthogonal** zu den Engineering-Phasen. Roadmap
hat Phasen (1, 2, 2.5, 3, 4, 5+), UX-Reifung hat Stufen (0, 1,
2, 3). Beide Dimensionen gleichzeitig.

In jeder Engineering-Phase kann an UX-Stufen parallel gebaut
werden. Welle 1 läuft konkret parallel zu Phase 3.6.

**Phase-Druck nicht mischen.** Bei Konflikt „soll ich heute 3.6
oder UX-Item bauen" gewinnt die klarere Bau-Aufgabe — nicht
ein Schema.

## Welle-1-Scope

11 priorisierte Items, in drei Tranchen. Backlog-Nummern siehe
`BACKLOG.md` Section „UX-Reifung — Welle 1 (Less Technical)".

### Tranche A — Quick-Wins (XS-S, ca. 2-3 Tage gesamt)

1. **Toast-Framework statt `alert()`** (#94) — universeller
   UX-Verbesserer
2. **Reject-Reason-Modal** (#91, re-klassifiziert) —
   `window.prompt()` ersetzen
3. **Tool-Names human-readable im Approve-Dialog** (#95) — statt
   `mcp_hyperbrowser-approval_scrape_webpage` etwas wie
   „Webseite lesen: anthropic.com"
4. **Empty-State-Onboarding für Chat** (#96) — Erstuser sieht im
   Empty-Chat eine Anleitung statt nur leeres Feld
5. **Inbox-Tab Tutorial/Empty-State** (#97) — Konzept „Inbox" wird
   erklärt

### Tranche B — Mittlere Investments (M, je 1-2 Tage)

6. **Cost/Time-Preview vor Approve** (#98) — wichtig für Phase 3.6
   Computer-Use, wo Sessions echtes Geld kosten
7. **Audit-Trail-View menschlich lesbar formatieren** (#99) — Vision
   Block 4 (Vererbung): Anna muss das später lesen können
8. **Memory-Hit-Indikator im Chat** (#100) — „Twin hat sich an X
   erinnert" sichtbar machen, Vision Block 2 Pattern 2

### Tranche C — Strategische Investments (M-L)

9. **MCP-Configurator-UI** (#87, re-klassifiziert) — hart Blocker
   für Casual-User, substantieller Bau
10. **Skill-Editor-UI** (#86, re-klassifiziert) — analog
11. **Twin-Reife-Stufen-Anzeige** (#101) — Vision Block 2.5 zentral,
    Engagement-Hook für SaaS-Launch

## Sub-Schritt-Plan

Sub-Schritte werden granular bei Bau-Beginn der jeweiligen
Tranche festgelegt. Vorab grobe Struktur:

- **UX.1.A** — Tranche A (Quick-Wins) durchziehen
- **UX.1.B** — Tranche B (Mittlere) durchziehen
- **UX.1.C** — Tranche C (Strategisch) durchziehen, jedes Item
  als eigene Sub-Phase
- **UX.1.D** — Welle-1-Abschluss-Review + Welle-2-Strategie-Session (Scope vermutlich Ziel Stufe 2)

Tranche A und B können parallel zu Phase 3.6 laufen. Tranche C
ist je nach Item priorisierbar — MCP-Configurator-UI und
Skill-Editor-UI sind Voraussetzung für Stufe 2, Twin-Reife-Anzeige
ist Vision-Engagement-Pattern.

## Welle-1-Abschluss-Kriterien

- [ ] Alle 11 Items in Tranche A/B/C gebaut, lokal verifiziert
- [ ] Production-Deploy für alle Items
- [ ] Smoke-Test mit echtem Casual-User (Markus' Frau, Kollege,
  jemand außerhalb der Bubble) — User schafft Chat, Tool-Approve,
  Fact-Pflege ohne Doku-Lookup
- [ ] BACKLOG-Items aus Welle 1 als closed markiert
- [ ] Welle-2-Strategie-Session geplant (Scope vermutlich Stufe 2)

## Was kommt nach Welle 1

**Welle 2 mit Ziel Stufe 2 (Casual-User-fähig)** ist eigene
Strategie-Session.
Hauptthemen:

- **SaaS-Hosting** statt Self-Hosting-Pflicht (eigener
  Strategie-Stack: Quota, Pricing, API-Key-Abstraction)
- **Persona-Builder als Chat** statt YAML-File
- **MCP-Marketplace** statt CLI/UI-Configurator (Ein-Klick
  Hyperbrowser, Notion, Calendar, etc.)
- **Onboarding-Wizard** mit Hand-Holding
- **Mandate-Wizard mit Presets** statt YAML-Editor

**Stufe 3 (komplette Konzept-Abstraktion)** ist Vision-Level und
hängt mit SaaS-Reife zusammen. Skill/Mandate/MCP-Konzepte
verschwinden aus der User-UI, ersetzt durch Capability-Sprache.
Plus Mobile-App, Vererbungs-Modus First-Class, etc.

## Verhältnis zu Pre-Launch-Phase A

Seit Tag 18 (`docs/PRE-LAUNCH-A-STRATEGY.md`) ist UX-Welle 1
**Block 1 der Pre-Launch-Phase A**. Die Welle-1-Inhalte (11 Items
in drei Tranchen) bleiben unverändert — Pre-Launch-Phase A
ergänzt sie um:

- **Block 2 — Architektur-Follow-ups** (#105, #106)
- **Block 3 — Computer-Use-Hook** (#107, #108)
- **Block 4 — Self-Hosting-Polish** (#109, #110, #111)
- **Block 5 — Launch-Vorbereitung** (#112, #113, #114, #115)

Der Build-Pfad innerhalb von Welle 1 wurde leicht angepasst:
**#100 (Memory-Hit) und #101 (Twin-Reife) werden direkt nach
Tranche A vorgezogen**, weil sie Vision-kritisch für die
Differenzierungs-Story (Memory-Tiefe + Persona + A2A) sind.
Tranche B/C-Reihenfolge sonst unverändert.

## Verweise

- `docs/PRE-LAUNCH-A-STRATEGY.md` (Welle 1 = Block 1 von Phase A)
- `docs/TWIN-VISION.md` Block 2.5 (Twin-Reife sichtbar machen)
- `docs/TWIN-VISION.md` Block 1.3 (SaaS-Onboarding niedrigschwellig)
- `docs/BACKLOG.md` neue Section „UX-Reifung — Welle 1 (Less Technical)"
- `docs/ROADMAP.md` Section „Orthogonaler Strang: UX-Reifung"
- Bestehende Backlog-Items #86 (Skill-Editor-UI), #87 (MCP-
  Configurator-UI), #91 (Reject-Reason-Modal) — jetzt re-klassifiziert
- Neue Items #94–#101 (Toast, Tool-Names, Empty-State, Inbox-Tutorial,
  Cost-Preview, Audit-View, Memory-Hit, Twin-Reife-Anzeige)
