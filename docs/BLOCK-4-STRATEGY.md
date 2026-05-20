# Block-4-Strategy — Self-Hosting-Polish

**Strategy-Session:** 20. Mai 2026, Nachmittag (Tag 20)
**Master-Doku:** [`docs/PRE-LAUNCH-A-STRATEGY.md`](./PRE-LAUNCH-A-STRATEGY.md)

Dieses Dokument verfeinert Block 4 (Self-Hosting-Polish) der Pre-Launch-Phase A mit zwölf konkreten Setzungen über drei Items: #110 Onboarding-Wizard, #109 DEPLOYMENT.md, #111 Public-Repo-Hygiene.

## Kontext

- **Pre-Launch-Phase A, Block 4** — macht das Repo für externe Tech-Affine deploybar
- **Drei Items:** #110 Onboarding-Wizard, #109 DEPLOYMENT.md production-fest, #111 Public-Repo-Hygiene
- **Übergeordnete Audience-Setzung:** Audience A primär (Tech-Affine Devs, Self-Hoster) für Phase A. Audience B (Casual Users) kommt in Phase B mit SaaS-Hosting.

## Setzungen #110 Onboarding-Wizard

| Aspekt | Setzung | Begründung |
|---|---|---|
| Audience-Fokus | Tech-Affine primär, aber Wizard für beide nützlich | „Twin anlegen" konzeptionell neu, reduziert Zero-State-Confusion auch für Devs |
| Wizard-Trigger Erst-Login | Hard-Trigger mit Skip-Option | Klares User-Modell, transparent dass System Twin erwartet |
| Persona-Editor | Minimal (4-5 Felder) | Persona ist lebendes Dokument, Wizard nur Foundation, YAML-Vertiefung in Settings |
| Mandates-Setup | Default-Mandates, kein Wizard-Touch | Mandates konzeptionell schwer für Erstnutzer, Settings-Sache |
| MCP-Server-Setup | Hyperbrowser-Preset mit Skip-Default | Recherche-Capability ist Phase-A-Hook, soll im Wizard exponiert sein |
| Wizard für weitere Twins | Wiederholbar via Button neben Manual | Pattern-Konsistenz, User-Wahl zwischen Wizard und Manual |

**Effektiver Wizard-Scope:**

- Welcome-Screen
- Schritt 1: Anthropic-API-Key eingeben + verifizieren
- Schritt 2: Minimal-Persona (Name, Handle, „Beschreib dich", Sprache, Tonalität)
- Schritt 3: Mandates-SKIP (Default-Mandates werden automatisch angewendet)
- Schritt 4: Hyperbrowser-Preset-Card (Skip oder API-Key eingeben)
- Schritt 5: Erste Konversation mit Beispiel-Prompts

**Erwartete Größe:** M (statt M-L durch Setzungen reduziert).

## Setzungen #109 DEPLOYMENT.md

| Aspekt | Setzung | Begründung |
|---|---|---|
| Tester | Self-Test als Dogfooding | Immer verfügbar, kein Koordinations-Risiko, disziplinärer Walk-Through findet die meisten Lücken früh |
| Scope | Skelett-Vervollständigen + 1 Cookbook-Stack | Cookbook-Maintenance-Last gering, Audience A kann zu anderen Stacks selbst translatieren |
| Stack | Plain Docker + Traefik | Heutiges Pattern auf srv1046432, Tag-7+ gelebt, Tag-20-Deploy-Erfahrung frisch, transportabel zu allen Hosting-Plattformen |

**Effektiver Bau-Scope:**

- Fünf TODO-Sektionen vollausarbeiten (ENV-Reference, Deploy-Sequenz, Smoke-Tests, Backup, Domain-Setup)
- Plain-Docker+Traefik-Cookbook als neuer Abschnitt
- Self-Test mit ehrlichen Regeln („Nichts aus dem Gedächtnis benutzen, nur was die Doku sagt")
- Troubleshooting-Section ergänzen mit Self-Test-Befunden

**Erwartete Größe:** M.

## Setzungen #111 Public-Repo-Hygiene

| Aspekt | Setzung | Begründung |
|---|---|---|
| LICENSE | Apache 2.0 | Industry-Standard, Patent-Schutz, Open-Core-kompatibel (Phase B SaaS möglich), TensorFlow/Kubernetes/Anthropic-konsistent |
| README-Struktur | Demo-First (Hero-GIF + Story-driven Pitch) | GitHub-Landing als Erst-Eindruck, Differenzierung gegenüber ChatGPT/Claude.ai ist die Story, #113-Reuse-Pattern (60-Sek-GIF aus Block 5) |
| CONTRIBUTING.md | Standard-Pattern | Code-Style + Sub-Schritt-Workflow + PR-Hinweise |
| Issue-Templates | Standard-Pattern | Bug + Feature + Question |

**Erwartete Größe:** S-M.

## Bau-Reihenfolge

**#110 → #109 → #111** (Wizard zuerst, dann Doku darum bauen, dann Public-Hygiene als Schliff)

Begründung: Wizard verändert Erst-Login-Flow drastisch. DEPLOYMENT.md beschreibt nach Setup einen Wizard-Flow, nicht manuelle Settings-Navigation. README-Pitch zeigt Wizard-Screenshot als Highlight.

## Tag-Schätzungen

| Phase | Item | Tage |
|---|---|---|
| 1 | #110 Wizard Backend (Routes, Persona-Builder, Defaults) | 1.5 |
| 2 | #110 Wizard Frontend (5-Schritt-Flow, Trigger, Settings-Button) | 2 |
| 3 | #110 Smoke + Closure | 0.5 |
| 4 | #109 DEPLOYMENT.md Vervollständigen (TODO-Sektionen + Cookbook) | 1.5 |
| 5 | #109 Self-Test + Fixes | 1 |
| 6 | #111 LICENSE + Boilerplate (CONTRIBUTING, Issue-Templates) | 0.5 |
| 7 | #111 README Demo-First (Hero-GIF oder Platzhalter, Story-Pitch) | 1 |
| 8 | Closure + Production-Deploy | 0.5 |

**Total geschätzt:** ~8.5 Tage Bau-Aufwand für Block 4.

## Anmerkungen

- #108 wird im Schritt 7 (README) und im Block 5 (#112 Landing-Page) organisch eingearbeitet — kein eigenes Item-Bau nötig.
- Phase-A-Buffer: bei 22 Tagen verfügbar (Tag 20 → Tag 42) und Block 4 + Block 5 zusammen ~15-17 Tage kalkuliert, bleiben ~5-7 Tage Reserve für Bug-Fixes und Pivots.

## Verweis

Master-Doku: [`docs/PRE-LAUNCH-A-STRATEGY.md`](./PRE-LAUNCH-A-STRATEGY.md). Diese Setzungen verfeinern Block 4 konkret.
