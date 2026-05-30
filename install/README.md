# Nolmi — Single-Host-Install (ohne TLS)

Ein-Befehl-Installation für den **Single-Host-Fall**: ein Server (oder dein
Laptop), erreichbar über `http://localhost` bzw. `http://<server-ip>`, **ohne
TLS/Domain**. Das ist der schnelle Self-Hosting-Einstieg; HTTPS + eigene Domain
kommen mit dem späteren Schritt 3b (Traefik).

## Schnellstart

```bash
# Lokal (Browser auf demselben Rechner):
curl -fsSL https://raw.githubusercontent.com/nolmi-ai/nolmi/main/install/install.sh | bash

# VPS (Browser von außerhalb → Server-IP angeben):
curl -fsSL https://raw.githubusercontent.com/nolmi-ai/nolmi/main/install/install.sh | NOLMI_HOST=203.0.113.10 bash
```

Aus einem bestehenden Clone heraus:

```bash
bash install/install.sh                 # localhost
NOLMI_HOST=203.0.113.10 bash install/install.sh   # VPS
```

## Was das Skript tut

1. Voraussetzungen prüfen (Linux/macOS, `git`, `openssl`).
2. Docker + Compose v2 prüfen (auf Linux/apt bei Bedarf via `get.docker.com`
   installieren; auf macOS nur Hinweis auf Docker Desktop).
3. Repo holen (klonen nach `~/nolmi`, oder vorhandenen Clone nutzen).
4. `docker/nolmi/.env` erzeugen: `NOLMI_ENCRYPTION_KEY`, `NOLMI_SESSION_SECRET`,
   `BRIDGE_REGISTER_TOKEN` (lokal via `openssl`, **nie geloggt**), plus
   Single-Host-Defaults (`SESSION_COOKIE_SECURE=false`, `TELEGRAM_USE_POLLING=true`,
   `NEXT_PUBLIC_RUNTIME_URL=http://<host>:4000`).
5. Stack bauen + starten: `docker compose -f docker-compose.single-host.yml up --build -d`.
6. DB-Init läuft **idempotent im Container** beim Boot (kein manueller Schritt).
7. Übergabe an das Onboarding (siehe unten).

## Nach der Installation

```bash
cd ~/nolmi/docker/nolmi

# 1) Ersten Account anlegen (interaktiv):
docker compose -f docker-compose.single-host.yml exec -it nolmi-runtime node dist/scripts/onboard.js

# 2) Browser: http://<host>:3000 → einloggen → der Wizard legt deinen Twin an.
```

## Konfiguration (ENV, alle optional)

| Variable         | Default                               | Zweck |
|------------------|---------------------------------------|-------|
| `NOLMI_HOST`     | `localhost`                           | Adresse, unter der **dein Browser** den Server erreicht (VPS: Server-IP). Steckt im Web-Bundle (#126). |
| `NOLMI_DIR`      | `$HOME/nolmi`                         | Ziel-Clone-Verzeichnis |
| `NOLMI_REPO_URL` | `https://github.com/nolmi-ai/nolmi.git` | Repo-URL |
| `NOLMI_BRANCH`   | `main`                                | Branch |

## Ports

| Dienst  | Port  | Sichtbarkeit |
|---------|-------|--------------|
| Web     | 3000  | öffentlich (Browser-Einstieg) |
| Runtime | 4000  | öffentlich (Browser spricht den Runtime **direkt** an) |
| Bridge  | 5100  | öffentlich (eigene Bridge möglich; `POST /twins/register` ist token-geschützt) |

> **VPS-Hinweis:** Ohne Reverse-Proxy sind alle drei Ports offen und der
> Verkehr läuft über **http** (kein TLS). Für mehr als ein vertrauenswürdiges
> Netz: auf 3b (Traefik + Domain + HTTPS + BasicAuth) warten oder selbst eine
> Firewall/Proxy davorsetzen.

## Wichtig

- **`docker/nolmi/.env` sichern** — `NOLMI_ENCRYPTION_KEY` verschlüsselt alle
  API-Keys und OAuth-Tokens in der DB. Bei Verlust sind diese Daten weg.
- Das Skript ist **idempotent**: eine vorhandene `.env` wird nicht überschrieben
  (Secrets bleiben stabil); ein erneuter Lauf baut den Stack neu auf.
- **Single-Host vs. Production:** diese Variante nutzt
  `docker-compose.single-host.yml` (kein Traefik). Der Production-Stack mit
  TLS/Domain/BasicAuth ist `docker-compose.yml` (Schritt 3b).
