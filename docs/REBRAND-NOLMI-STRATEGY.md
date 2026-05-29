# Rebrand-Strategy — Twin-Lab → Nolmi

**Strategy-Session:** 28. Mai 2026 (Tag 30, Arbeitstitel „Tavryn") → 29. Mai 2026 (Tag 31, Name finalisiert auf „Nolmi")
**Master-Doku:** [`docs/PRE-LAUNCH-A-STRATEGY.md`](./PRE-LAUNCH-A-STRATEGY.md) (Phase A / Block 5 Kontext)
**Quellen:** `Nolmi_Branding_Guide.docx` + `Nolmi_Launch_Steps.docx` (Codex, Hex-identisch zu den Tavryn-/Aurelun-/Brelon-/Nerlo-Vorgängern) + Twin-Konversation Produkt-Narrativ (27. Mai 2026)
**Doc-Lifecycle:** umbenannt Tag 31 von `REBRAND-TAVRYN-STRATEGY.md` (Tavryn verworfen, siehe §0)

Dieses Dokument rahmt den Rebrand von **Twin-Lab** zu **Nolmi** und den Switch von Dark- auf Light-Mode als finale Marken-Identität vor dem Self-Hosting-Launch. Es ist Strategie-Setzung, **nicht Bau-Briefing** — konkrete Sub-Schritt-Briefings entstehen pro Phase.

---

## 0. Launch-Gate — Trademark-Status (GRÜN, Tag 30/31)

**Befund Tag 30/31:** Professioneller Trademark-Quick-Search durch — **USPTO 0 Treffer, EUIPO Class 09 + 42 0 Treffer** für „Nolmi". Kein phonetischer Cluster, kein verwandter Sektor-Konflikt.

**5 Namens-Iterationen Tag 30/31 (alle aus Codex-Vorschlägen):**

| Iteration | Verworfen weil |
|---|---|
| **Tavryn** | `tavrn.ai` (Series-A AI-Legal-Tech, San Francisco) — phonetisch identisch, gleicher AI-Sektor, gleicher `.ai`-TLD. Tavrn-Zwilling als unverhältnismäßiges Risiko bewertet. |
| **Aurelun** | Aurel-Cluster zu dicht: Aurelio AI, Aureum, AureliaX — Markenverwässerung in der Wahrnehmung. |
| **Brelon** | Bre-Cluster + aktive BREV-Trademark-Anmeldung in verwandten Klassen. |
| **Nerlo** | GitHub-Org `nerlo` belegt, plus Musiker-Cluster (Verwechslungsgefahr im organischen Suchverhalten). |
| **Nolmi** ✅ | USPTO + EUIPO sauber, GitHub frei (siehe Inkonsistenz unten), npm/PyPI/Docker frei. **Finalisiert Tag 31.** |

**GitHub-Inkonsistenz (bewusste Setzung):** `nolmi` als GitHub-Org-Name ist intern reserviert (kein sichtbarer Trademark-Grund, GitHub-eigenes Block). Statt GitHub-Support-Anfrage zu eskalieren (Form-Routing-Sackgasse, niedrige Erfolgswahrscheinlichkeit) wurde die AI-Sektor-Konvention `nolmi-ai` gewählt — Präzedenz bei `langchain-ai`, `anthropic-ai`. npm/PyPI/Docker-Hub-Namespace bleibt überall `nolmi`. Ergibt 3× `nolmi` + 1× `nolmi-ai`, akzeptiert (Lesson Tag 31 #1).

**GATE-STATUS:** ✅ **OFFEN** — Phase 2 (Name-Strings im Code), Phase 3 (Env/Package-Aliasing) und Phase 4 (VPS-Setup) sind entblockt.

**Markus' parallele Arbeit (außerhalb Pair-Programming, Stand Tag 31):** abgeschlossen — Foundation gesichert, siehe §9.

---

## 1. Kontext + Entscheidungen

Drei zusammenhängende Setzungen vom 28./29. Mai 2026:

1. **Name:** Twin-Lab → **Nolmi** (Domain `nolmi.ai` + `getnolmi.com`, Wordmark-first, Title Case) — Tag 31 nach 4 Verwerfungen finalisiert (Tavryn/Aurelun/Brelon/Nerlo, siehe §0)
2. **Theme:** Dark-Mode → **Light-Mode** als Hauptidentität (visuelle Differenzierung gegen OpenClaw/Hermes/NanoClaw, die alle dark sind)
3. **Narrativ:** Drei-Stufen-Produktstory statt "AI-Agenten reden miteinander" (aus Twin-Konversation, siehe §6)

**Infrastruktur-Setzung:** Nolmi bekommt einen **separaten Hostinger-VPS** (nicht der bestehende `srv1046432`), Domain direkt bei Hostinger. Heißt: Production-Deploy ist ein **Neu-Aufsetz**, kein In-Place-Rebrand des laufenden Twin-Lab-Stacks. **Stand Tag 31:** VPS provisioniert (Frankfurt, Ubuntu 24.04 LTS, IP `187.124.3.235`) — Details §9.

---

## 2. Code-Realität (Diagnose Tag 30)

### Theme-System — sauber zentralisiert

Zwei Dateien definieren das gesamte Theme, Components haben **keine** eigenen Hex-Farben (Hardcoded-Scan leer außer Kommentaren):

- **`apps/web/tailwind.config.js`** — kanonische Token-Quelle (8 Farben)
- **`apps/web/app/globals.css`** — CSS-Variablen-Spiegel (für 3rd-Party wie sonner) + `color-scheme: dark` + 3 hardcoded Stellen (`html,body` bg+color, `::selection`)

Light-Mode-Switch = diese 2 Dateien + 3 hardcoded Stellen umstellen. ~30 Components folgen automatisch über die Token-Klassen.

### Token-Mapping Dark → Nolmi-Light

Hex-Werte sind in allen Codex-Branding-Guides (Tavryn/Aurelun/Brelon/Nerlo/Nolmi) **identisch** — bei jedem Namens-Wechsel wurde nur die Wordmark getauscht, nicht das Farbsystem. Phase 1 wurde Tag 30 als „Tavryn-Light" gebaut, ist als Nolmi-Light **unverändert gültig**.

| Token (Tailwind) | Heute (Dark) | Nolmi-Light | Anmerkung |
|---|---|---|---|
| `bg` | `#0a0a0a` | `#F4F1EA` | warmer Light-Grund |
| `surface` | `#141414` | `#FFFCF6` | Karten/Inputs |
| `surface-hover` | `#1f1f1f` | `#F4F1EA` o.ä. | leicht dunkler als surface |
| `border` | `#2a2a2a` | `#D8D3CA` | |
| `muted` | `#666666` | `#6F6A60` | |
| `text` | `#e8e8e8` | `#111111` | (Guide: "ink") |
| `accent` | `#4a9e6a` | `#1E9B5A` | grün bleibt grün, sattere Variante |
| `warn` | `#cc4444` | `#C8332A` | (Guide: "error") |

**Glücksfall:** Accent ist heute schon grün. Nolmis Memory/Permission-Grün ist kein Farbwechsel, nur Sättigung. Semantik (grün = success/accent) bereits vorhanden.

**Additive Erweiterung:** Nolmi bringt neue Status-Tokens (`info #2F6FDB`, `warning #B86E00`, `pending #7A5CC8`, `success #1E9B5A`, `accent-dark #178C4D`), die heute fehlen. Als neue Tokens ergänzen — kein Bruch.

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
- `tailwind.config.js`: 8 Token-Werte Dark → Nolmi-Light + neue Status-Tokens ergänzen
- `globals.css`: CSS-Variablen-Aliases spiegeln, `color-scheme: dark → light`, 3 hardcoded Stellen (`html,body`, `::selection`)
- Kontrast-/Lesbarkeits-Verifikation: jede Status-Farbe, Hover-State, Border-Left-Akzent (Toast), Focus-State
- Browser-Smoke: alle Haupt-Views (Chat, Inbox, Settings, Onboarding, Login, Facts, Stream) im Light-Mode durchklicken

**Risiko:** Dark-Mode-Texte (`#e8e8e8` hell) werden im Light unsichtbar. Jede Stelle die heute auf "hell auf dunkel" baut, invertiert. Smoke ist Pflicht, kein optionaler Check.

**Aufwand:** S-M (1 Sub-Block Bau + 1 Smoke-Welle). Architektur-Glücksfall macht es kleiner als gedacht.

### Phase 2 — Sichtbarer Name-Rebrand ✅ DONE Tag 31 (Block 2)

§0-Gate erledigt (Tag 30/31 USPTO + EUIPO 0 Treffer). Phase 2 Tag 31 Block 2 abgeschlossen — 7 Files (4× `apps/web` + 3× `docs/`-Headlines/Intros), Browser-Smoke 7/7 grün, Cmd+F „Twin-Lab" pro Page = 0 Treffer.

**Scope (abgeschlossen):**
- `apps/web/app/layout.tsx` HTML `<title>` + `<meta name="description">` auf Nolmi-Leitsatz
- `apps/web/app/login/page.tsx` h1
- `apps/web/components/AppHeader.tsx` Brand-Link
- `apps/web/components/FooterMeta.tsx` Fallback (Mini-Justierung nach Smoke-Befund)
- `README.md` H1 + What/Why-Sections + 2 Pre-Launch-Tagline-Zeilen
- `docs/DEPLOYMENT.md` H1 + Intro + 2 Display-Stellen
- `docs/ROADMAP.md` H1

**Bewusst NICHT (verschoben auf Phase 3):**
- Session-Cookie-Name `twin-lab-session` (würde Live-Sessions invalidieren)
- `@twin-lab/shared`-Imports (Workspace-Package-Rename)
- Docker-Container-Namen + Pfade
- Repo-URL `markusbaier/twin-lab.git` + `cd twin-lab` in README — Repo-Rename gehört zur Org-Migration `nolmi-ai`
- Code-Kommentare (interne historische Notizen, nicht user-visible)
- OG-Metadata + Favicon-Referenzen (gehört zu Phase 4 Brand-Assets)

**Aufwand:** S, real ~1h netto inkl. Diagnose + Smoke + Mini-Justierung.

### Phase 3 — Technische Renames

Aufgeteilt in zwei Blöcke:

#### Phase 3a — Env / Package / Cookie ✅ DONE Tag 31 (Block 3)

Code-Renames mit Backward-Compat-Aliasing (Env + Cookie) und Hard-Switch (Workspace-Packages, technisch nicht aliasable).

**Scope (abgeschlossen):**
- **`getEnv`-Helper:** `packages/shared/src/env.ts` + Subpath-Export `@nolmi/shared/env`. Liest neuen Namen, fällt auf alten zurück, warnt einmal pro Prozess pro Var (`warnOnce`). Unit-Smoke (`src/env.test.ts`) prüft 4 Pfade: new-wins / only-old-warns / only-new-silent / both-unset. Lauf via `pnpm --filter @nolmi/shared test:env`.
- **10 Env-Vars umgestellt:** Production-Read-Pfad (`NOLMI_SESSION_SECRET`, `NOLMI_ENCRYPTION_KEY`, `NOLMI_DEFAULT_BRIDGE_URL`, `NOLMI_MODEL_CACHE_DIR`, `NOLMI_EMBEDDING_{PROVIDER,MODEL,DTYPE,API_KEY}`) via `getEnv`; Test-Only (`NOLMI_RUN_LOCAL_RETRIEVAL_TEST`, `NOLMI_SKIP_LOCAL`) als stumpfer Rename ohne Aliasing.
- **4 Workspace-Packages atomar umbenannt:** `@twin-lab/{web,runtime,bridge,shared}` → `@nolmi/{web,runtime,bridge,shared}`. 124 Import-Statements + Root-`package.json` Script-Refs mit-rewriten. Aliasing technisch nicht möglich (Workspace-Auflösung über `name`-Feld), daher Hart-Cut.
- **Cookie-Aliasing:** `SESSION_COOKIE_NAME = "nolmi-session"` (write) + `LEGACY_SESSION_COOKIE_NAME = "twin-lab-session"` (read-fallback). `getSession()` liest beide, `setSession()` schreibt nur den neuen, `destroySession()` löscht beide aktiv (sonst überschattet ein Bestands-Legacy-Cookie das Logout). Web-`middleware.ts` spiegelt die Konstanten lokal — Konsolidierung via `@nolmi/shared/auth-cookies` als Backlog-Item, weil Cross-App-Import vom Runtime nicht strukturell vorgesehen ist.
- **`.env.example`:** Alle `TWIN_LAB_*` + `@twin-lab/*`-Vorkommen umgestellt, Header-Notiz zum Aliasing-Fenster (6–12 Monate, Hart-Cut Mai 2027).

**Verifikation:**
- `pnpm install` + `pnpm typecheck` (alle 4 Workspaces) + `pnpm -r build` minus `@nolmi/web` (next-build während Dev korrumpiert geteilten `.next/`) — alles grün.
- `pnpm --filter @nolmi/shared test:env` 4/4 Cases OK.

**Bewusst NICHT in 3a (operativer Folge-Block 3b):**
- Verzeichnis-Rename `twin-lab/` → `nolmi/` lokal
- GitHub-Repo-Move `markusbaier/twin-lab` → `nolmi-ai/nolmi`
- Docker-Image-Tags Rename
- Production-Deploy (Nolmi-Stack lebt nur im Repo, Production-Twin-Lab unverändert)

#### Phase 3b — Verzeichnis-Rename + GitHub-Repo-Move (S, must) ✅ DONE Tag 31

**Abgeschlossen Tag 31 (29. Mai 2026, Freitag), Block 4.** Operative
Closure der Code-Rebrand-Pipeline.

Durchgeführt:
- GitHub-Repo `markusbaier/twin-lab` → `markusbaier/nolmi` umbenannt
  (Settings → General → Rename)
- GitHub-Repo-Transfer zu Org `nolmi-ai` durchgeführt (Settings → Danger
  Zone → Transfer ownership). Ziel: `nolmi-ai/nolmi`.
- Lokales Verzeichnis-Rename: `mv /Users/mjb/Visual Studio/twin-lab/
  /Users/mjb/Visual Studio/nolmi/`
- Git-Remote umgestellt: `git remote set-url origin
  https://github.com/nolmi-ai/nolmi.git`
- Smoke verifiziert: `pnpm dev` boot sauber im neuen Pfad, 9 Twins
  geladen, Bridge-Connection grün, Chat-Flow (POST /twins/@markus/chat)
  responseTime 11.9s — LLM-Call durch.
- Root-`package.json`-Metadaten auf Nolmi-Stand (name + description +
  author.email + repository.url + bugs.url + homepage)
- `.gitignore` Hygiene: `.claude/` ergänzt

**Bewusst unverändert (Phase-4-Material):**
- `docker/twin-lab-web/` (Verzeichnis + README.md + docker-compose.yml +
  Container-Namen `twin-lab-runtime`/`twin-lab-web`/`twin-lab-web-data`):
  Production-Stack auf VPS `srv1046432` läuft mit dieser Konfig.
  Rename-Pflicht entsteht erst beim Phase-4-VPS-Setup auf
  `srv1712371.hstgr.cloud` — dort wird ein neues `docker/nolmi/`-
  Verzeichnis angelegt, das alte `docker/twin-lab-web/` wird mit
  Phase 4 archiviert oder gelöscht.
- SSH-Alias `github.com-twin-lab` in `~/.ssh/config` (lokal beim
  User): wird beim Phase-4-Deploy mit aktualisiert
- BACKLOG-Item: "Production-VPS srv1046432 abschalten nach Phase 4 ist
  live"

**Phase 4 ist der nächste natürliche Block** (Nolmi-VPS-Setup auf
`srv1712371.hstgr.cloud`).

### Phase 4 — Nolmi-VPS Production-Deploy (nach 1-3, VPS bereits provisioniert)

Separater Hostinger-VPS (Frankfurt, Ubuntu 24.04 LTS, IP `187.124.3.235`). Neu-Aufsetz analog DEPLOYMENT.md §9 Cookbook, aber mit Nolmi-Branding + Light-Mode + neuer Domain.

**Scope:**
- ✅ VPS provisioniert, Domain `nolmi.ai` + `getnolmi.com` + 5 DNS-A-Records grün (Tag 30/31, siehe §9) — Setup-Block kann starten
- Traefik + Stack deployen
- Brand-Assets (Wordmark, Favicon, OG-Image) — Light-first
- Screenshots neu aufnehmen (Light-Branding) für #112 Landing / #113 Demo

**Aufwand:** M-L (eigene VPS-Session, teils Markus-manuell).

---

## 4. Phasen-Reihenfolge + Gates (Übersicht)

```
Phase 1 (Light-Mode)        ────────▶  ✅ DONE Tag 30 (kein Gate)
                                        │
        [GATE: ✅ Trademark-grün Tag 30/31 (USPTO + EUIPO 0 Treffer)]
                                        │
Phase 2 (Name sichtbar)     ════════▶  ✅ DONE Tag 31 (Block 2)
                                        │
Phase 3a (Env/Package/Cookie) ══════▶  ✅ DONE Tag 31 (Block 3)
                                        │
Phase 3b (Verzeichnis+Repo) ════════▶  offen, operativer Folge-Block
                                        │
Phase 4 (Nolmi-VPS-Deploy)  ════════▶  VPS bereits provisioniert (Tag 30/31), ready nach 3b
```

**Parallel (Markus, außerhalb Code) — Stand Tag 31:** ✅ Foundation gesichert (Domain + VPS + GitHub-Org `nolmi-ai` + npm `@nolmi` + PyPI + Docker Hub `nolmi` + Mail-Stack + Trademark-Quick-Search durch — Details §9). Verbleibt: Social-Handles + Brand-Assets-Produktion.

---

## 5. Setzungen (zu bestätigen / offen)

| # | Setzung | Status |
|---|---|---|
| S1 | Light-Mode ist Hauptidentität, Dark nur Fallback | ✅ bestätigt |
| S2 | Name = Nolmi (Title Case, Wordmark-first) | ✅ bestätigt Tag 31, Trademark grün |
| S3 | Separater Hostinger-VPS für Nolmi | ✅ bestätigt + provisioniert Tag 30/31 |
| S4 | Code-Rebrand erst nach Trademark-Klärung | ✅ Gate offen (Trademark grün Tag 30/31), Code-Rebrand entblockt |
| S5 | Env-Vars via Alias, kein Hard-Break | ✅ umgesetzt Tag 31 Block 3 (`getEnv`-Helper, 6–12 Monate Aliasing-Fenster) |
| S6 | Phase 1 (Light-Mode) startet sofort, namens-unabhängig | ✅ DONE Tag 30 Block 3 |
| S7 | Dark-Mode bleibt als Fallback erhalten (nicht gelöscht) | ✅ Tag 30 hart auf Light entschieden (kein Toggle, Phase-B-Item für späteren Toggle) |
| S8 | GitHub-Org-Name = `nolmi-ai` (mit Bindestrich), npm/PyPI/Docker = `nolmi` — bewusste Inkonsistenz, GitHub-internes Block auf `nolmi` ohne sichtbaren Trademark-Grund, AI-Sektor-Konvention `nolmi-ai` (vgl. `langchain-ai`, `anthropic-ai`) | ✅ akzeptiert Tag 31 |

**S7 entschieden Tag 30:** Hart auf Light, kein Toggle. Dark-Fallback als späteres Phase-B-Item — der Toggle ist kein Launch-Blocker und die Branding-Identität ist explizit light-first.

---

## 6. Produkt-Narrativ (aus Twin-Konversation, fürs Marketing-Framing)

Nicht Code, aber strategisch für #112 Landing / #113 Demo / #114 Posts.

### Nolmi-Leitsatz (Branding-Guide)

**„Aktive Erinnerung unter Owner-Kontrolle."**

Komplementiert das Drei-Stufen-Narrativ aus der Twin-Konversation (siehe unten): „Aktive Erinnerung" ist Memory-Tiefe + Persona (Stufe 1), „unter Owner-Kontrolle" ist Mandat + Approval + Trust by Design (Stufe 2). Beides zusammen ist das Differenzierungs-Versprechen — Memory und Mandat sind nicht zwei Features, sondern eine gemeinsame Identität: eine vertrauenswürdige Repräsentation. Damit deckt der Leitsatz das Produkt-Versprechen in einem Satz ab und greift visuell ins grüne Branding-Akzent (Memory/Permission/Status sind beide grün).

### Drei-Stufen-Story (Twin-Konversation 27. Mai 2026)

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

Der Rebrand **rahmt Block 5 neu.** Die Marketing-Items bauen jetzt auf Nolmi + Light + dem neuen Narrativ:
- **#112 Landing** — Nolmi-Branding, Light-first, Drei-Stufen-Narrativ + Leitsatz „Aktive Erinnerung unter Owner-Kontrolle", grüner Akzent
- **#113 Demo** — Light-Mode-Screenshots, 60-Sek-Bogen aus §6
- **#114 Posts** — „Nolmi", Differenzierungs-Story aus §6
- **#115 Timing** — Trademark-Gate ✅ erledigt, abhängig von Phase 2-4-Fortschritt + VPS-Setup-Block

Heißt: Block-5-Bau wartet sinnvoll auf Phase 1-2 des Rebrands (Light + Name), sonst produzieren wir Marketing-Material mit altem Branding zum Wegwerfen.

---

## 8. Aufwand-Gesamtschätzung

| Phase | Aufwand | Gate |
|---|---|---|
| 1 — Light-Mode | S-M | kein — ✅ DONE Tag 30 |
| 2 — Name sichtbar | S | ✅ DONE Tag 31 Block 2 |
| 3a — Env/Package/Cookie | M | ✅ DONE Tag 31 Block 3 |
| 3b — Verzeichnis/Repo | S | entblockt, operativer Folge-Block |
| 4 — Nolmi-VPS | M-L | nach 3b (VPS bereits provisioniert) |

Phasen 1–3a sind DONE. Verbleibt 3b (operativ) + 4 (Production-Deploy).

---

## 10. Aliasing-Pattern (wiederverwendbar)

Phase 3a hat ein Pattern etabliert, das für künftige Renames in `nolmi`
(Tag 31+) als Vorlage dient: **Read-Both, Write-New, Warn-Once,
Hart-Cut nach Migrations-Fenster.**

### Mechanik

Zentral in `@nolmi/shared/env`:

```ts
export function getEnv(newName: string, oldName: string): string | undefined {
  const newValue = process.env[newName];
  if (newValue !== undefined) return newValue;
  const oldValue = process.env[oldName];
  if (oldValue !== undefined) { warnOnce(oldName, newName); return oldValue; }
  return undefined;
}
```

- **Read-Both:** neuer Name gewinnt, alter Name als Fallback
- **Warn-Once:** pro Prozess-Lifetime einmalige Deprecation-Warning pro Var
- **Hart-Cut:** nach 6–12 Monaten wird der `oldName`-Parameter entfernt;
  Call-Sites bleiben unverändert (nur das zweite Argument fällt weg)

### Wo das Pattern greift

| Asset-Typ | Aliasable? | Pattern |
|---|---|---|
| Env-Vars | ✅ ja | `getEnv("NOLMI_X", "TWIN_LAB_X")` |
| Cookies | ✅ ja | `SESSION_COOKIE_NAME` + `LEGACY_SESSION_COOKIE_NAME`, Read-Both im Reader, Write-New im Setter |
| Workspace-Package-Namen | ❌ nein | atomarer Hart-Switch — pnpm-Workspace-Resolution sieht nur das `name`-Feld |
| Verzeichnis-Pfade | ❌ nein | git-mv + `cd` neuer Pfad, kein Aliasing möglich |
| Repo-URLs | ⚠ teilweise | GitHub macht 301-Redirects auf alten URLs, aber kein Aliasing in `git remote` |

### Lifecycle einer Aliasing-Stelle

1. **Bau (Phase 3a, Tag 31, Mai 2026):** `getEnv("NOLMI_X", "TWIN_LAB_X")` rein
2. **Warn-Phase (6–12 Monate):** Production-Logs zeigen Deprecation-Warnings, User stellt um
3. **Hart-Cut (ca. Mai 2027):** zweites Argument raus → `getEnv("NOLMI_X")` (oder direktes `process.env.NOLMI_X`)
4. **Cleanup:** Aliasing-Hinweise in Doc-Strings + `.env.example`-Header
   entfernen

Wer den Hart-Cut macht, schlägt hier nach.

---

## 9. Operative Foundation Status (Tag 30/31)

Stand der Marken-Infrastruktur, gesichert Tag 30 Nachmittag/Abend und Tag 31 Vormittag.

### Domain + DNS

| Asset | Status |
|---|---|
| `nolmi.ai` (Hostinger) | ✅ registriert |
| `getnolmi.com` (Hostinger) | ✅ registriert (Marketing-/Fallback-URL) |
| DNS A-Records (5) | ✅ grün propagiert — `nolmi.ai`, `app.nolmi.ai`, `runtime.nolmi.ai`, `bridge.nolmi.ai`, `docs.nolmi.ai` alle → `187.124.3.235` |

### VPS

| Feld | Wert |
|---|---|
| Anbieter | Hostinger |
| Region | Frankfurt |
| OS | Ubuntu 24.04 LTS |
| IP | `187.124.3.235` |
| Status | ✅ provisioniert, leer (kein Stack deployed — Phase 4 Setup-Block) |

### E-Mail-Stack

- ✅ `hello@nolmi.ai` (primäre Owner-Adresse)
- ✅ Aliase `security@nolmi.ai` + `founders@nolmi.ai`
- ✅ Forwarding zu `markus.baier@harway.de` Tag 31 verifiziert (Test-Mail durchgegangen)

### Namespaces (4)

| Plattform | Name | Status |
|---|---|---|
| npm | Org `@nolmi` | ✅ reserviert, 2FA aktiv |
| PyPI | Account `markusbaier` | ✅ erstellt, 2FA aktiv; Package-Name `nolmi` verifiziert frei (Publishing erst in Phase 3) |
| Docker Hub | Personal-Account `nolmi` | ✅ reserviert, 2FA aktiv |
| GitHub | Org `nolmi-ai` (mit Bindestrich) | ✅ erstellt — AI-Sektor-Konvention, weil GitHub `nolmi` intern reserviert hat (siehe §0) |

**Bewusste Inkonsistenz:** 3× `nolmi` (npm/PyPI/Docker) + 1× `nolmi-ai` (GitHub). Präzedenz bei `langchain-ai`, `anthropic-ai` — im AI-Sektor etabliert. Support-Anfrage an GitHub zum Freigeben von `nolmi` wurde Tag 30 Abend gestoppt (Form-Routing-Sackgasse, niedriger Erfolgs-ROI gegenüber sofortiger `nolmi-ai`-Entscheidung). Cross-Ref Lesson Tag 31 #1.

### Verbleibend (Markus, außerhalb Pair-Programming)

- Social-Handles (X, LinkedIn, BlueSky, …)
- Brand-Assets-Produktion (Wordmark, Favicon, OG-Image — Codex-Guide liefert Tokens, Asset-Files separat)

---

## Verweis

Master-Doku: [`docs/PRE-LAUNCH-A-STRATEGY.md`](./PRE-LAUNCH-A-STRATEGY.md). Quellen-Dokumente (Codex): `Nolmi_Branding_Guide.docx` + `Nolmi_Launch_Steps.docx` (Hex-identisch zu Tavryn-/Aurelun-/Brelon-/Nerlo-Vorgängern — nur Wordmark getauscht, nicht das Farbsystem). Narrativ: Twin-Konversation 27. Mai 2026.
