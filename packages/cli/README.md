# nolmi (CLI)

One-Command-Installer für selbst-gehostete Nolmi-AI-Twins.

```bash
npm i -g nolmi
nolmi onboard
```

> **Status: Phase 1 (Gerüst + Kern).** Noch **nicht** auf npm publiziert — das ist
> ein eigener späterer Schritt nach VM-End-to-End-Verifikation.

## Was `nolmi onboard` tut

Ein **Node-Port der bewiesenen [`install/install.sh`](../../install/install.sh)**
(7 Schritte, Frische-Test Block 27 bestanden), mit drei bewussten Abweichungen:

1. **Öffentliches Repo klonen** statt git-archive — kein PAT nötig (Repo ist public).
2. **`node:crypto` statt `openssl`** für die Secrets — kein openssl-Zwang.
3. **TTY-Passthrough** (`stdio: 'inherit'`) für die interaktive Onboard-Übergabe.

Ablauf: Vorbedingungen (git, Docker, Compose v2, Daemon) → Repo bereitstellen
(in-repo / `pull --ff-only` / `clone --depth 1`) → **Browser-Adresse auflösen**
(s.u.) → Secrets + `docker/nolmi/.env` (idempotent: vorhandene `.env` wird
**nie** überschrieben) → `docker compose -f docker-compose.single-host.yml up
--build -d` → warten bis Runtime lauscht → `docker compose exec -it nolmi-runtime
node dist/scripts/onboard.js` → URLs.

## Browser-Adresse (`NEXT_PUBLIC_RUNTIME_URL`)

Die Adresse, unter der **dein Browser** den Server erreicht, wird **build-time
ins Web-Bundle gebacken**. Auf einem VPS (Browser vom Laptop) muss sie die
**Server-IP/Domain** sein — `localhost` zeigt sonst auf den Laptop und der Login
bricht mit „Failed to fetch".

Auflösung beim `onboard`:
- **`--host <adresse>` / `NOLMI_HOST` gesetzt** → wird genommen, **kein Prompt**.
- **sonst, im Terminal (TTY)** → die erkannte IP wird **vorgeschlagen**
  (`os.networkInterfaces()`, kein externer Dienst), **Enter bestätigt**, Eingabe
  überschreibt (IP/Domain).
- **sonst (kein TTY)** → erkannte IP wird genommen + **laut geloggt** (Fallback
  `localhost`, ebenfalls geloggt).
- **`https://…`** wird abgelehnt mit Hinweis: HTTPS/Domain ist der TLS-Pfad
  (Schritt 3b, Traefik + Secure-Cookie) — Phase 1 macht nur **http+IP**.

### Adresse nachträglich ändern: `nolmi reconfigure-host`

Repariert den Fall „onboard hat `localhost` gebacken, Zugriff ist remote". Löst
die Adresse neu auf (gleicher Prompt/Detect) und **ersetzt ausschließlich die
`NEXT_PUBLIC_RUNTIME_URL`-Zeile** in der bestehenden `.env`, dann
`docker compose up -d --build` (rebaut nur das web-Image mit neuem Build-Arg).

> 🔒 **Datenverlust-Schutz:** `reconfigure-host` fasst **niemals**
> `NOLMI_ENCRYPTION_KEY`, Session-Secret oder Bridge-Token an. Die Ersetzung
> läuft **zeilenweise** — nur `NEXT_PUBLIC_RUNTIME_URL`-Zeilen werden geändert,
> jede andere Zeile (inkl. der Secrets) wird verbatim durchgereicht. Gleicher
> Host = no-op (kein Schreiben, kein Rebuild).

`SESSION_COOKIE_SECURE=false` bleibt für den http+IP-Fall korrekt (host-only
Cookie ohne Secure-Flag über http) — erst der TLS/Domain-Pfad (3b) braucht `true`.

## ⚠ DRY-Kopplung an install.sh

`install.sh` (bash) und dieser Wrapper (TS) sind **zwei Türen zum selben
Single-Host-Stack**. Die `.env`-Vorlage in [`src/lib/env-template.ts`](src/lib/env-template.ts)
ist **byte-identisch** zu install.sh Schritt 4. Ändert sich eine Seite (neue
Single-Host-Variable, anderer Default, anderer Compose-Pfad), **muss die andere
mitgezogen werden** — sonst driften die Onboarding-Wege.

Ein gemeinsamer Extract (ein von bash **und** Node gelesenes `.env`-Template-File)
ist als Folge-Item vorgeschlagen, in Phase 1 aber bewusst nicht gebaut.

Auch die **Host-Auflösung** ist beidseitig gespiegelt: `install.sh` hat
`detect_ip()` + `resolve_host()` (gleicher Default-Vorschlag, TTY-Prompt, http+IP).
bash↔TS können keinen Code teilen — geteilt bleibt die **Formel**
`http://<host>:4000` (byte-identisch), parallel sind nur Detection + Prompt.

## Noch nicht in dieser Phase

- **`npm publish`** — eigener Schritt nach Verifikation.
- **`--no-docker` (Phase A, Single-Process)** — Flag ist reserviert (Groove
  gelegt), meldet aktuell „noch nicht implementiert".
- **B1-Image-Pull** — entfällt als primärer Weg (B1-Clone ist der Pfad).

## Build

```bash
pnpm --filter ./packages/cli build      # tsc → dist/
node packages/cli/dist/cli.js --help
```
