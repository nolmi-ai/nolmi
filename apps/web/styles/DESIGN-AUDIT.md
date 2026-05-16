# Design-Audit Twin-Lab Web (UX.1.A.2.A)

**Datum:** 16. Mai 2026, Abend (Tag 17)
**Scope:** lesender Audit-Pass durch `apps/web` zum Identifizieren des
impliziten Design-Systems. Keine Code-Änderungen.
**Folge-Steps:** Token-Kodifizierung (UX.1.A.2.B), Primitives + Refactor
(UX.1.A.2.C), finale Design-Doc (UX.1.A.2.D).

## TL;DR

twin-lab hat ein **starkes, in sich stimmiges implizites Design-System**:
Monospace-First, Dark-Mode, mintgrüner Akzent, ziegelroter Warn, 1px-Border
statt Shadow, Card-Sections. Die Foundation-Tokens stehen sauber in
`apps/web/tailwind.config.js`, und das App-Code-Layer **respektiert sie zu
100 %** — kein einziger inline-Hex-Wert in `apps/web/app/**` oder
`apps/web/components/**` (außer Backlog-Referenzen wie `#71b` in Kommentaren).

**Was fehlt** für Skalierung auf Welle-1-Bauvolumen:

1. **Semantische Mid-Layer-Tokens** (Button-Variants, surface-hover,
   border-focus) — heute werden Foundation-Tokens direkt zu Long-Form-
   Utility-Klassen kombiniert, was 6–18 Inline-Variationen pro semantischem
   Pattern produziert.
2. **Component-Primitives** (`Card`, `Button`, `Input`, `Tag`, `Badge`).
   Section-Wrapper ist 2× per Inline-Klassen-Copy dupliziert; Buttons
   sind ~18× inline variiert; das neue Toast/Modal aus UX.1.A.1 bricht
   den Stil sichtbar.
3. **Sonner-/3rd-Party-Theming** — sonner rendert in Default-Light-Optik
   gegen den Twin-Lab-Dark-Stack; nicht überschrieben.

Plus: **mein eigener UX.1.A.1-Code hat zwei Token-Leaks eingeführt**
(siehe Sektion „Doppel-Implementierungen", Punkt 5). Beide harmlos
funktional, aber stilistisch off — exakt das Symptom, das den Audit
ausgelöst hat. Erste Refactor-Kandidaten in UX.1.A.2.C.

---

## 1. Farbpalette

### Foundation (Tailwind-Config, `apps/web/tailwind.config.js:6-14`)

| Token | Hex | Rolle | Verwendungs-Counts |
|---|---|---|---|
| `bg` | `#0a0a0a` | Page-Background, Button-Invert-Text | `bg-bg` 46× |
| `surface` | `#141414` | Card-/Modal-/Panel-Background | `bg-surface` 31× |
| `border` | `#2a2a2a` | Card-/Input-/Section-Border | `border-border` 102× |
| `muted` | `#666666` | Sekundär-Text, disabled, Labels | `text-muted` 179× |
| `text` | `#e8e8e8` | Primär-Text | `text-text` 118× |
| `accent` | `#4a9e6a` | Mint — Active/Confirm/Success/Tag | `text-accent` 66×, `border-accent` 79× |
| `warn` | `#cc4444` | Brick-Red — Destructive/Reject/Error/Badge | `text-warn` 47×, `border-warn` 23× |

### Globale Defaults (`apps/web/app/globals.css`)

- `color-scheme: dark`
- `html/body` Background = `#0a0a0a` (entspricht `bg`-Token)
- `html/body` Color = `#e8e8e8` (entspricht `text`-Token)
- `::selection` Background = `#4a9e6a` (Accent), Text = `#0a0a0a` (BG)

### Inline-Hex-Lecks im App-Code

**Keine.** `grep -rnE "#[0-9a-fA-F]{3,8}"` in `apps/web/app|components`
findet nur Backlog-Referenzen (`#71b/#80` in JSDoc-Kommentaren).

### Was im Token-Stack fehlt (siehe Empfehlungen)

- **`surface-hover`** — heute keine separate Token für Card-Hover-States;
  meine RejectModal-Cancel-Button-Klasse `hover:bg-surface-hover` ist ein
  Tailwind-No-Op (siehe Doppel-Implementierungen, Punkt 5).
- **`border-focus`** — Inputs nutzen `focus:border-accent` (semantisch
  „Akzent = aktiver Fokus"). Sauber, aber wenn Welle 1 mehrere
  Akzent-Bedeutungen einführt (Confirm vs. Active vs. Focus), wäre eine
  Trennung sinnvoll.
- **Semantic-Aliases** wie `success` / `danger` als Aliase auf
  `accent` / `warn` — heute kein direkter Bedarf, aber für 3rd-Party-
  Theming (sonner) klärt das die Intent.

---

## 2. Typography

### Font-Family-Stack

**`IBM Plex Mono`** als globale Default-Font für `html, body`
(`globals.css:11-13`), Stack: `"IBM Plex Mono", "Courier New", monospace`.
Google-Font-Import mit Weights 300, 400, 500, 600, 700.

Tailwind-Mapping (`tailwind.config.js:15-17`):
```js
fontFamily: { mono: ["IBM Plex Mono", "Courier New", "monospace"] }
```

**Monospace-only** in der ganzen App — kein Fallback auf Sans-Serif für
Body-Text. `font-mono` wird 48× explizit gesetzt (Tag- und Code-Boxen),
sonst erbt alles von `body`.

### Font-Sizes

| Klasse | px | Count | Rolle |
|---|---|---|---|
| `text-xs` | 12 | 160× | Buttons, UI-Chrome, Sub-Labels |
| `text-sm` | 14 | 121× | Body, Links, Inputs |
| `text-[10px]` | 10 | 21× | Micro-Labels (mit `uppercase tracking-wider`) |
| `text-xl` | 20 | 9× | Page-Headings |
| `text-[11px]` | 11 | 6× | Edge-Cases |
| `text-base` | 16 | 4× | selten |
| `text-lg` | 18 | 2× | Modal-Titles |
| `text-2xl+` | — | 0× | bewusst keine Hero-Größen |

**Hierarchie kompakt:** 10/12/14 dominieren, größere Schriften sind
sparsam — passt zum dichten Lab-Charakter.

### Font-Weights

| Klasse | Count |
|---|---|
| `font-mono` | 48× (explizit, Tag/Code) |
| `font-semibold` | 21× (Headings, Buttons, Counts) |
| `font-medium` | 6× |
| `font-bold` | 0× (semibold reicht für Mono) |

---

## 3. Spacing

Tailwind-Default 4 px-Scale, 100 % konsistent verwendet.

| Klasse | px | Häufigkeit |
|---|---|---|
| `py-2` | 8 | 73× |
| `px-3` | 12 | 69× |
| `py-1` | 4 | 36× |
| `gap-2` | 8 | 33× |
| `px-4` | 16 | 27× |
| `px-6` | 24 | 21× |
| `px-2` | 8 | 19× |
| `gap-3` | 12 | 17× |
| `py-3` | 12 | 13× |
| `p-4` | 16 | 13× |

**Beobachtung:** Die Buttons nutzen fast immer `px-3 py-1.5` (Small) oder
`px-4 py-2` (Medium) oder `px-3 py-2`. Section-Padding ist `p-5` (siehe
Section-Component). Page-Container `px-6 py-4`.

**4 px-Vielfache durchgängig**, keine Pixel-perfect Edge-Werte
(z.B. keine `px-[7px]`).

---

## 4. Border + Radius

### Border-Width

- **1 px** ist die einzige verwendete Border-Width (Tailwind-Default).
  Keine `border-2` o.ä. in der Codebase.
- Directional Borders: `border-b` 113×, `border-t` 20×, `border-r` 1×
  — dominantes Pattern: Section-Separator unten.

### Radius

| Klasse | px | Count |
|---|---|---|
| `rounded` | 4 | 124× |
| `rounded-full` | ∞ | 6× (Badges + Dots) |
| `rounded-lg` | 8 | 1× |

**`rounded` (4 px) ist der Quasi-Standard.** Kein `rounded-md`, kein
`rounded-xl` — die App hat eine eindeutige Radius-Stimme.

### Focus

`focus:outline-none focus:border-accent` ist das Universal-Pattern für
Inputs/Textareas (16+ Stellen). Keine Outline-Ring-Variante.

---

## 5. Component-Patterns

### 5.1 Section / Card

**Pattern:**
```tsx
<section className="bg-surface border border-border rounded p-5">
  <h2 className="text-sm font-semibold text-text mb-3 tracking-tight">{title}</h2>
  {children}
</section>
```

**Implementiert in 2 Files als lokaler `function Section(...)`:**
- `apps/web/app/inbox/page.tsx:388`
- `apps/web/app/settings/page.tsx:513`

Beide Files haben praktisch byte-identische Section-Komponenten. **Direkter
Dedup-Kandidat** (UX.1.A.2.C).

### 5.2 Button-Variants

Drei semantische Varianten, mit jeweils ~6 Größen-/Layout-Permutationen.

**Variant A: Accent / Confirm / Primary**
- Universal-Pattern: `border border-accent text-accent rounded hover:bg-accent hover:text-bg disabled:opacity-30 disabled:cursor-not-allowed transition-colors`
- Größen-Varianten (gefunden 7×):
  - `px-3 py-1.5 text-xs` (Inbox-Approve, kompakt)
  - `px-4 py-2 text-sm` (Chat-Send, Standard)
  - `px-3 py-2` (Login)
  - `mt-3 px-4 py-2` (Forms)
  - `w-full px-3 py-2` (Full-Width-CTA)
  - `w-full px-3 py-2 text-sm` (Modal-Submit)
  - `inline-block px-4 py-2 border border-accent ...` (Tabs/Cards)

**Variant B: Warn / Destructive / Reject**
- Identisches Pattern wie A, nur mit `warn` statt `accent`
- Größen-Varianten (gefunden 3×):
  - `px-3 py-1.5 text-xs ... border-warn text-warn ...`
  - `px-3 py-1 text-xs ... border-warn ...`
  - `px-2 py-1 border-warn ...` (Icon-Size)

**Variant C: Ghost / Secondary**
- `px-3 py-1 rounded border border-border hover:bg-surface-hover disabled:opacity-50`
- Bisher nur 1× im Code (RejectReasonModal Cancel-Button — siehe Leak)

**Fazit:** **18+ Inline-Permutationen für 3 semantische Buttons.** Stärkster
Primitives-Kandidat. Ein `<Button variant="accent|warn|ghost" size="xs|sm|md">`
würde 90 % der Inline-Klassen ersetzen, ohne dass eine einzige Style-
Entscheidung sich ändert.

### 5.3 Input / Textarea

**Pattern:**
```tsx
className="w-full bg-bg border border-border rounded px-3 py-2 text-sm text-text focus:outline-none focus:border-accent disabled:opacity-50"
```

Variations:
- Mit `font-mono` (Code-Inputs)
- Mit `resize-none` (Textarea)
- Mit `w-1/3` (Inline-Inputs)
- Mit `h-full` (Chat-Textarea, fülle den Container)

Sehr konsistent. **Mittlerer Dedup-Kandidat** — Input ist ein
React-Standard-Wrapper, lohnt sich auch wenn die Klassen-Liste schon
weniger streut als Buttons.

### 5.4 Tag (Code-/Identifier-Box)

**Pattern (1 Variante, durchgängig):**
```tsx
className="inline-flex items-center text-xs font-mono px-2 py-1 border border-border rounded text-text"
```

Verwendet für Tool-Identifier, Skill-Namen, Handles. **Bereits visuell
konsistent**, Component-Wrapping wäre Convenience.

### 5.5 Badge (Count-Indikator)

**Pattern (1 Variante, in TopNav 2× dupliziert für inbox + facts):**
```tsx
className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 text-[10px] font-semibold rounded-full bg-warn text-bg leading-none"
```

Files: `apps/web/components/TopNav.tsx:164` + `:178`.

**Direkter Dedup-Kandidat** (lokale Doppelung in einem File).

### 5.6 Status-Dot

**Pattern:**
```tsx
className="inline-block w-2 h-2 rounded-full bg-warn flex-shrink-0"
```

Kleine Dot-Indikatoren — sehr atomar, vermutlich nur 1–2 Stellen.

### 5.7 Modal-Wrapper

**Zentralisiert** in `apps/web/components/ModalWrapper.tsx` (Phase 3.3.G3,
Tag 12):
```tsx
<div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
  <div className="bg-surface border border-border rounded shadow-xl max-w-md w-full">
    {children}
  </div>
</div>
```

Backdrop-Click + ESC-Close handhabt der Wrapper. **Verwender (4):**
- `RejectReasonModal` (UX.1.A.1)
- `AddFactModal` (in `facts/page.tsx`)
- `EditFactModal` (in `facts/page.tsx`)
- Chat-Reset-Confirm-Modal (in `chat/[handle]/page.tsx`)

**Was fehlt:** Standardisierte Body-Konventionen (Header/Body/Footer-
Slots, `role="dialog"`/`aria-modal`/Focus-Trap). RejectReasonModal
implementiert das jetzt manuell — die anderen 3 Modal-Bodies haben
diese a11y-Patterns vermutlich nicht.

### 5.8 Navigation

**Top-Bar** (`AppHeader.tsx:29`):
```tsx
<header className="border-b border-border px-6 py-4 flex items-center justify-between gap-4">
```

**Tab-Link** (`TopNav.tsx:154`):
```tsx
<Link className="hover:text-text transition-colors">…</Link>
```
(Standardtext ist `text-muted`, Hover schaltet auf `text-text`.)

**Footer** (`AppFooter.tsx:25`):
```tsx
<footer className="border-t border-border px-6 py-3 text-xs text-muted">
```

Konsistent mit dem 1 px-Border-Pattern (oben/unten Section-Trenner).

### 5.9 Section-Divider in Chat

Pattern `px-4 py-3 border-b border-border` und Varianten (mit
`flex-shrink-0`, `bg-surface`) sind in Chat-Page mehrfach inline
verstreut für Sub-Section-Header.

---

## 6. Doppel-Implementierungen

1. **`Section`-Component** — byte-identisch 2× implementiert
   (`inbox/page.tsx:388` + `settings/page.tsx:513`). Klarer Dedup.

2. **Button-Variants (Accent/Warn/Ghost)** — ~18 Inline-Klassen-
   Permutationen für 3 semantische Buttons. Größte Hebelwirkung für
   Primitives.

3. **TopNav-Count-Badge** — exakt identisch 2× nebeneinander im selben
   File für inbox- und facts-Count.

4. **Modal-Bodies** — `ModalWrapper` ist zentral, aber die 4 Verwender-
   Bodies haben unterschiedliche a11y-Pattern (RejectReasonModal hat
   `role="dialog"`+Focus-Trap, andere vermutlich nicht).

5. **Eigene Token-Leaks aus UX.1.A.1** in `RejectReasonModal.tsx`:
   - Zeile 122: `hover:bg-surface-hover` — `surface-hover` ist **nicht**
     im Tailwind-Token-Stack → der Klasse fehlt jede Wirkung (silent
     no-op). Cancel-Button hat keinen sichtbaren Hover-State.
   - Zeile 130: `bg-red-600 text-white hover:bg-red-700` — verwendet
     Tailwind-Default-Red statt des `warn`-Tokens und Tailwind-`white`
     statt `bg`-Token. Sieht funktional korrekt aus, ist aber **außerhalb**
     des Twin-Lab-Color-Stacks.
   - **Ironie:** das Modal, das den Audit ausgelöst hat (zusammen mit
     Sonner-Toast), ist selbst der frischeste Design-Leak. Ein Lehrstück
     für „warum Primitives".

6. **Sonner-Toaster-Stil** — `<Toaster richColors closeButton />` in
   `app/layout.tsx:31` rendert in Sonner-Defaults (hellere Backgrounds,
   andere Schriften). Greift NICHT auf `accent`/`warn`/`surface` zu.
   Cross-Component-Inconsistenz, gut sichtbar weil Toasts oben rechts
   prominent erscheinen.

---

## Empfehlung für UX.1.A.2.B (Token-Kodifizierung)

Foundation-Tokens sind sauber. Erweiterungen, die das Welle-1-Bauvolumen
unterstützen:

**Neue Foundation-Tokens (`tailwind.config.js`):**
- `surface-hover: #1f1f1f` (subtiler Lift gegenüber `surface`) — schließt
  die `bg-surface-hover`-Lücke aus dem RejectModal-Leak
- Optional: `accent-strong: #5fb480` und `warn-strong: #d65555` für
  Hover-States, falls die heutige Invert-Hover-Semantik
  (`hover:bg-accent`) durch eine subtilere Variante ersetzt werden soll
  (eher nicht — Invert passt zur Lab-Identity, lassen)

**Optional: Semantische Aliases als CSS-Variables**
(nur falls 3rd-Party-Theming wie sonner einfacher konsumieren soll):
- `--color-success: var(--color-accent)`
- `--color-danger: var(--color-warn)`

Größeres Refactoring nicht nötig — die bestehende Token-Disziplin ist
solide.

## Empfehlung für UX.1.A.2.C (Primitives + Refactor)

Vorgeschlagene Ordnerstruktur: `apps/web/components/ui/` für
zentralisierte Primitives, bestehende Components bleiben in
`apps/web/components/` als Composite-Components.

**Priorisierte Primitives (Reihenfolge = Hebel):**

1. **`Button`** — Variants `accent | warn | ghost`, Sizes `xs | sm | md`.
   Löst ~18 Inline-Permutationen über die ganze App. **Größter Hebel.**
2. **`Card` / `Section`** — Löst die 2× duplizierte Section-Component
   aus inbox + settings. **Schneller Win.**
3. **`Badge`** — Count-Variante. Löst TopNav-Doppelung sofort.
4. **`Input` / `Textarea`** — Konsistent, aber als Component leichter
   `disabled`/`error`/`label`-Props zu führen.
5. **`Tag`** — Einfacher Wrapper, niedriger Hebel aber 0 Risiko.
6. **`Modal`-Refactor** — `ModalWrapper` um konsistente Slots erweitern
   (`<Modal.Header>`, `<Modal.Body>`, `<Modal.Footer>`) plus
   `role="dialog"`/`aria-modal`/Focus-Trap als Default. Alle 4 Verwender
   profitieren.
7. **`ToastTheme`** — sonner-Custom-CSS bzw. `<Toaster toastOptions>` so
   konfigurieren, dass Toasts wie Twin-Lab-Cards aussehen
   (`bg-surface border border-border text-text`, Success-Border
   `border-accent`, Error-Border `border-warn`).

**Refactor-Kandidaten direkt nach Primitives-Bau:**
- `RejectReasonModal.tsx` Zeilen 122 + 130 auf `Button variant="ghost"` /
  `Button variant="warn"` umstellen, Token-Leaks entfernen.
- inbox/settings `Section`-Inline-Component löschen → Import aus
  `components/ui/Card`.
- TopNav-Badges → `<Badge count={n} />`.

**Radix-Primitives:** für Welle 1 NICHT nötig — die Modal-/Button-/Tag-
Patterns sind einfach genug, dass nativer Code reicht. Radix wird
relevant bei Tranche C (#86 Skill-Editor, #87 MCP-Configurator), die
Dropdown-Menüs und Popovers brauchen werden.

---

## Stop-Bedingungen-Update

Briefing-Pfad `apps/web/src/styles/DESIGN-AUDIT.md` ging nicht (Twin-Lab
nutzt App-Router flach, kein `src/`-Layout). Pfad pragmatisch auf
`apps/web/styles/DESIGN-AUDIT.md` angepasst (neuer Ordner für die
temporäre Audit-/Token-Doku). Briefing-Referenz auf „Backlog #102"
trifft existierendes DEPLOYMENT.md-Item — Doc trägt nur den Sub-Step-Code
`UX.1.A.2.A`, Backlog-Numbering bleibt deinem Entscheid in UX.1.A.2.B
überlassen.

Sonst keine Stop-Bedingungen ausgelöst — die Tailwind-Config ist
Standard-Setup, keine PostCSS-Plugin-Überraschungen.
