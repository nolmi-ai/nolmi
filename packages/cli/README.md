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
(in-repo / `pull --ff-only` / `clone --depth 1`) → Secrets + `docker/nolmi/.env`
(idempotent: vorhandene `.env` wird **nie** überschrieben) → `docker compose -f
docker-compose.single-host.yml up --build -d` → warten bis Runtime lauscht →
`docker compose exec -it nolmi-runtime node dist/scripts/onboard.js` → URLs.

## ⚠ DRY-Kopplung an install.sh

`install.sh` (bash) und dieser Wrapper (TS) sind **zwei Türen zum selben
Single-Host-Stack**. Die `.env`-Vorlage in [`src/lib/env-template.ts`](src/lib/env-template.ts)
ist **byte-identisch** zu install.sh Schritt 4. Ändert sich eine Seite (neue
Single-Host-Variable, anderer Default, anderer Compose-Pfad), **muss die andere
mitgezogen werden** — sonst driften die Onboarding-Wege.

Ein gemeinsamer Extract (ein von bash **und** Node gelesenes `.env`-Template-File)
ist als Folge-Item vorgeschlagen, in Phase 1 aber bewusst nicht gebaut.

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
