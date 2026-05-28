# Rebrand-Strategy — Twin-Lab → Tavryn

**Strategy-Session:** 28. Mai 2026 (Tag 30)
**Master-Doku:** [`docs/PRE-LAUNCH-A-STRATEGY.md`](./PRE-LAUNCH-A-STRATEGY.md) (Phase A / Block 5 Kontext)
**Quellen:** `Tavryn_Branding_Guide.docx` + `Tavryn_Launch_Steps.docx` (Codex, 26. Mai 2026) + Twin-Konversation Produkt-Narrativ (27. Mai 2026)

Dieses Dokument rahmt den Rebrand von **Twin-Lab** zu **Tavryn** und den Switch von Dark- auf Light-Mode als finale Marken-Identität vor dem Self-Hosting-Launch. Es ist Strategie-Setzung, **nicht Bau-Briefing** — konkrete Sub-Schritt-Briefings entstehen pro Phase.

---

## 0. Launch-Gate — Trademark-Risiko (BLOCKIEREND für Code-Rebrand)

**Befund Tag 30 (Web-Recherche vor Doc-Anlage):**

Es existiert eine **aktive AI-Software-Firma mit fast identischem Namen:**
- **`tavrn.ai`** (ohne y — T-A-V-R-N) — AI-Legal-Tech, San Francisco, Series-A (Left Lane Capital). AI-powered medical chronologies + demand letters für Anwälte. Aktiv, finanziert, im AI-Space.
- **Tavryn** (mit y — T-A-V-R-Y-N) — eure Schreibweise. Anderer String, andere Domain, aber phonetisch quasi identisch.

**Risiko-Einschätzung (kein Rechtsrat — Engineering-Sparring-Hinweis):**
- Beide im AI-Software-Sektor, beide `.ai`-TLD, Unterschied nur ein "y"
- Ein Markenrechtler würde Verwechslungsgefahr in verwandten Klassen prüfen
- Die Launch-Steps nennen "Trademark Quick Search ohne harte Kollision" selbst als Launch-Gate

**GATE-REGEL:** Die **sichtbare Code-Rebrand-Stufe (Phase 2) startet erst, wenn Markus das Trademark-Risiko geklärt hat** (professioneller Quick-Search USA/EU/UK, Software-/AI-Klassen). Bis dahin laufen nur namens-**unabhängige** Arbeiten (Light-Mode, Phase 1).

**Markus' Aufgabe (außerhalb Pair-Programming):** Trademark-Quick-Search beauftragen, Domain `tavryn.ai` + VPS bei Hostinger sichern, GitHub-Org / npm-Scope / Social-Handles reservieren.

---

## 1. Kontext + Entscheidungen

Drei zusammenhängende Setzungen vom 28. Mai 2026:

1. **Name:** Twin-Lab → **Tavryn** (Domain `tavryn.ai`, Wordmark-first, Title Case)
2. **Theme:** Dark-Mode → **Light-Mode** als Hauptidentität (visuelle Differenzierung gegen OpenClaw/Hermes/NanoClaw, die alle dark sind)
3. **Narrativ:** Drei-Stufen-Produktstory statt "AI-Agenten reden miteinander" (aus Twin-Konversation, siehe §6)

**Infrastruktur-Setzung:** Tavryn bekommt einen **separaten Hostinger-VPS** (nicht der bestehende `srv1046432`), Domain direkt bei Hostinger. Heißt: Production-Deploy ist ein **Neu-Aufsetz**, kein In-Place-Rebrand des laufenden Twin-Lab-Stacks.

---

## 2. Code-Realität (Diagnose Tag 30)

### Theme-System — sauber zentralisiert

Zwei Dateien definieren das gesamte Theme, Components haben **keine** eigenen Hex-Farben (Hardcoded-Scan leer außer Kommentaren):

- **`apps/web/tailwind.config.js`** — kanonische Token-Quelle (8 Farben)
- **`apps/web/app/globals.css`** — CSS-Variablen-Spiegel (für 3rd-Party wie sonner) + `color-scheme: dark` + 3 hardcoded Stellen (`html,body` bg+color, `::selection`)

Light-Mode-Switch = diese 2 Dateien + 3 hardcoded Stellen umstellen. ~30 Components folgen automatisch über die Token-Klassen.

### Token-Mapping Dark → Tavryn-Light

| Token (Tailwind) | Heute (Dark) | Tavryn-Light | Anmerkung |
|---|---|---|---|
| `bg` | `#0a0a0a` | `#F4F1EA` | warmer Light-Grund |
| `surface` | `#141414` | `#FFFCF6` | Karten/Inputs |
| `surface-hover` | `#1f1f1f` | `#F4F1EA` o.ä. | leicht dunkler als surface |
| `border` | `#2a2a2a` | `#D8D3CA` | |
| `muted` | `#666666` | `#6F6A60` | |
| `text` | `#e8e8e8` | `#111111` | (Guide: "ink") |
| `accent` | `#4a9e6a` | `#1E9B5A` | grün bleibt grün, sattere Variante |
| `warn` | `#cc4444` | `#C8332A` | (Guide: "error") |

**Glücksfall:** Accent ist heute schon grün. Tavryns Memory/Permission-Grün ist kein Farbwechsel, nur Sättigung. Semantik (grün = success/accent) bereits vorhanden.

**Additive Erweiterung:** Tavryn bringt neue Status-Tokens (`info #2F6FDB`, `warning #B86E00`, `pending #7A5CC8`, `success #1E9B5A`, `accent-dark #178C4D`), die heute fehlen. Als neue Tokens ergänzen — kein Bruch.

### Namens-Vorkommen — drei Stufen (Launch-Steps-Reihenfolge)

| Stufe | Wo | Files | Risiko |
|---|---|---|---|
| **1 sichtbar** | User-facing Strings (`apps/web` UI) | ~19+ tsx | niedrig, kosmetisch |
| **2 technisch** | Env-Vars `TWIN_LAB_*` | ~20+ ts | **hoch** — Production-Twins laufen damit |
| **3 tief** | Package-Namen `@twin-lab/*` | alle package.json | Breaking-Change |

---

## 3. Phasen-Plan

### Phase 1 — Light-Mode-Switch (namens-UNABHÄNGIG, startet SOFORT)

Komplett unabhängig vom Namen — wird in **jedem** Szenario gebraucht, egal wie das Produkt am Ende heißt. Kein Gate.

**Scope:**
- `tailwind.config.js`: 8 Token-Werte Dark → Tavryn-Light + neue Status-Tokens ergänzen
- `globals.css`: CSS-Variablen-Aliases spiegeln, `color-scheme: dark → light`, 3 hardcoded Stellen (`html,body`, `::selection`)
- Kontrast-/Lesbarkeits-Verifikation: jede Status-Farbe, Hover-State, Border-Left-Akzent (Toast), Focus-State
- Browser-Smoke: alle Haupt-Views (Chat, Inbox, Settings, Onboarding, Login, Facts, Stream) im Light-Mode durchklicken

**Risiko:** Dark-Mode-Texte (`#e8e8e8` hell) werden im Light unsichtbar. Jede Stelle die heute auf "hell auf dunkel" baut, invertiert. Smoke ist Pflicht, kein optionaler Check.

**Aufwand:** S-M (1 Sub-Block Bau + 1 Smoke-Welle). Architektur-Glücksfall macht es kleiner als gedacht.

### Phase 2 — Sichtbarer Name-Rebrand (GATED auf Trademark-Klärung)

Erst nach §0-Gate. User-facing Strings Twin-Lab → Tavryn.

**Scope:**
- ~19+ tsx Strings (`AppHeader`, `TopNav`, `layout.tsx` Metadata, `login`, `onboarding`, EmptyStates, etc.)
- README, DEPLOYMENT, ROADMAP, BACKLOG Display-Name (keine Mischbotschaften)
- HTML `<title>`, OG-Metadata, Favicon-Referenzen
- **NICHT:** Env-Vars, Package-Namen (das ist Phase 3)

**Aufwand:** S (mechanisch, aber sorgfältig — keine Stelle übersehen).

### Phase 3 — Technische Renames (GATED, mit Kompatibilität, SPÄTER)

Am riskantesten. Erst wenn Phase 2 stabil + neuer VPS steht.

**Scope:**
- **Env-Vars `TWIN_LAB_*`:** Alias-Pattern statt Hard-Break. Code liest neuen Namen (`TAVRYN_*`) UND alten (`TWIN_LAB_*`) als Fallback. Migration-Window, dann alter Name raus. **Production-kritisch** — die 3 laufenden Twins nutzen die alten Vars.
- **Package-Namen `@twin-lab/*` → `@tavryn/*`:** Workspace-weiter Rename. Breaking, daher kontrolliert + nach Phase 2.
- **Docker-Image-Namen:** erst nach finaler Org/Registry-Entscheidung.

**Aufwand:** M (Env-Aliasing ist nontrivial, braucht eigenes Sub-Briefing + Smoke gegen Production-Pattern).

### Phase 4 — Neuer Tavryn-VPS + Production-Deploy (GATED, nach 1-3)

Separater Hostinger-VPS. Neu-Aufsetz analog DEPLOYMENT.md §9 Cookbook, aber mit Tavryn-Branding + Light-Mode + neuer Domain.

**Scope:**
- VPS provisionieren, Domain `tavryn.ai` (+ Subdomains `app.`/`runtime.`/`docs.`) DNS
- Traefik + Stack deployen
- Brand-Assets (Wordmark, Favicon, OG-Image) — Light-first
- Screenshots neu aufnehmen (Light-Branding) für #112 Landing / #113 Demo

**Aufwand:** M-L (eigene VPS-Session, teils Markus-manuell).

---

## 4. Phasen-Reihenfolge + Gates (Übersicht)

```
Phase 1 (Light-Mode)  ──────────────▶  SOFORT, kein Gate
                                        │
        [GATE: Trademark-Quick-Search durch Markus]
                                        │
Phase 2 (Name sichtbar) ────────────▶  nach Gate
                                        │
Phase 3 (Env/Package-Aliasing) ─────▶  nach Phase 2 + neuer VPS-Plan
                                        │
Phase 4 (Tavryn-VPS-Deploy) ────────▶  nach 1-3
```

**Parallel (Markus, außerhalb Code):** Domain + VPS Hostinger, GitHub-Org, npm/PyPI/Docker-Scope, Social-Handles, Trademark-Search, Brand-Assets.

---

## 5. Setzungen (zu bestätigen / offen)

| # | Setzung | Status |
|---|---|---|
| S1 | Light-Mode ist Hauptidentität, Dark nur Fallback | ✅ bestätigt |
| S2 | Name = Tavryn (Title Case, Wordmark-first) | ✅ bestätigt, Trademark-gated |
| S3 | Separater Hostinger-VPS für Tavryn | ✅ bestätigt |
| S4 | Code-Rebrand erst nach Trademark-Klärung | ✅ Gate gesetzt |
| S5 | Env-Vars via Alias, kein Hard-Break | Vorschlag, zu bestätigen bei Phase 3 |
| S6 | Phase 1 (Light-Mode) startet sofort, namens-unabhängig | ✅ heute |
| S7 | Dark-Mode bleibt als Fallback erhalten (nicht gelöscht) | offen — siehe Frage unten |

**Offene Frage S7:** Soll Dark-Mode als toggle-barer Fallback erhalten bleiben (Branding-Guide: "Dark Mode sekundärer Fallback"), oder Light-Mode hart als einziges Theme? Erhalten = mehr Aufwand (Theme-Toggle-Mechanik), hart = einfacher jetzt. Empfehlung: **jetzt hart auf Light** (kein Toggle bauen), Dark-Fallback als späteres Phase-B-Item — der Toggle ist kein Launch-Blocker und die Branding-Identität ist explizit light-first.

---

## 6. Produkt-Narrativ (aus Twin-Konversation, fürs Marketing-Framing)

Nicht Code, aber strategisch für #112 Landing / #113 Demo / #114 Posts. Der Kern aus der Twin-Konversation:

**NICHT** "AI-Agenten reden miteinander" (A2A als Einstieg = zu abstrakt).

**SONDERN** Drei-Stufen-Story, vom emotionalen Anker zur Infrastruktur:

1. **Persönlicher Twin** — "Hilft mir zu denken, zu schreiben, mich zu erinnern, Dinge vorzubereiten." (Der emotionale Einstieg, wie die Owner-Chat-Erfahrung.)
2. **Repräsentierender Twin** — "Repräsentiert mich kontrolliert, wenn ich nicht selbst verfügbar bin." (Trust by Design: Mandat, Approval, Grenzen.)
3. **A2A** — "Twins koordinieren vor, entscheiden aber nicht unkontrolliert." (Infrastruktur-Layer, dritte Stufe.)

**Differenzierungs-Kern:** *"Ich bekomme eine digitale Repräsentation, die mich versteht, aber nicht unkontrolliert für mich handelt."* Vertrauen (Mandat/Approval/Memory/Grenzen) ist nicht Beiwerk — es ist das Produkt.

**60-Sekunden-Demo-Bogen (aus Twin-Konversation):** Jemand schreibt dem Twin → Twin antwortet sauber im Mandat → etwas Kritisches geht ins Approval → Owner bleibt in Kontrolle. Fertig. Erst danach wird A2A spannend.

Das deckt sich mit dem grünen Branding-Akzent (Memory/Permission/Status) — visuelle und narrative Identität greifen ineinander.

---

## 7. Verhältnis zu Block 5

Der Rebrand **rahmt Block 5 neu.** Die Marketing-Items bauen jetzt auf Tavryn + Light + dem neuen Narrativ:
- **#112 Landing** — Tavryn-Branding, Light-first, Drei-Stufen-Narrativ, grüner Akzent
- **#113 Demo** — Light-Mode-Screenshots, 60-Sek-Bogen aus §6
- **#114 Posts** — "Tavryn", Differenzierungs-Story aus §6
- **#115 Timing** — abhängig von Trademark-Gate + neuem VPS

Heißt: Block-5-Bau wartet sinnvoll auf Phase 1-2 des Rebrands (Light + Name), sonst produzieren wir Marketing-Material mit altem Branding zum Wegwerfen.

---

## 8. Aufwand-Gesamtschätzung

| Phase | Aufwand | Gate |
|---|---|---|
| 1 — Light-Mode | S-M | kein |
| 2 — Name sichtbar | S | Trademark |
| 3 — Env/Package | M | nach 2 + VPS-Plan |
| 4 — Tavryn-VPS | M-L | nach 1-3 |

Phase 1 ist heute machbar. Phasen 2-4 takten sich nach Markus' Sicherungs-Fortschritt.

---

## Verweis

Master-Doku: [`docs/PRE-LAUNCH-A-STRATEGY.md`](./PRE-LAUNCH-A-STRATEGY.md). Quellen-Dokumente (Codex): Branding-Guide + Launch-Steps. Narrativ: Twin-Konversation 27. Mai 2026.
