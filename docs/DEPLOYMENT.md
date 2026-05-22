# DEPLOYMENT — Twin-Lab Self-Hosting

> **Status:** §1–§7 voll-ausgebaut. Original-Skelett hatte §3
> (First-Time), §5 (ENV), §6 (Updates — jetzt in §3 konsolidiert),
> §7 (Smoke) TODO. §8 Backup + §9/§10 Cookbook folgen Tag 24.

Diese Anleitung beschreibt das Self-Hosting-Setup von Twin-Lab auf
einem Linux-VPS mit Docker. Sie ergänzt das knappere Setup-README
unter `docker/twin-lab-web/README.md`, das die initiale Production-
Sequenz für den Haupt-Maintainer dokumentiert.

Twin-Lab läuft als Multi-Container-Setup hinter einem Traefik-Proxy:
Web (Next.js), Runtime (Fastify + SQLite), Bridge (Agent-to-Agent-
Kommunikation). Die Drei-Service-Architektur ist im Repo-Root unter
`docs/ARCHITECTURE.md` (TODO) beschrieben.

---

## 1. Überblick

Twin-Lab ist ein selbst-gehostetes AI-Twin-System, in dem Personen
einen persistenten LLM-Agenten ("Twin") besitzen, der ihre Persona,
Facts und Konversations-Memory über Sessions hinweg verwaltet. Twins
können mit anderen Twins kommunizieren (A2A via Bridge), MCP-Server
als Tools nutzen, und haben drei Memory-Schichten (Conversation,
Semantic Facts, Episodic Vector-Memory).

**Stack-Übersicht:**

- **Web** — Next.js 15 (App-Router), läuft als `node:20-slim` Container
- **Runtime** — Fastify 4 + better-sqlite3 + sqlite-vec, als
  `node:20-slim` Container
- **Bridge** — Fastify + Server-Sent Events, separates Repo
  ([twin-lab-bridge](https://github.com/markusbaier/twin-lab-bridge))
- **DB** — SQLite mit `vec0`-Virtual-Tabellen und FTS5 für
  Hybrid-Search
- **Embedding-Modell** — multilingual-e5-large q8 (~552 MB), lokal
  via `@huggingface/transformers`
- **LLM** — Anthropic Claude (Default) oder OpenAI, per-Twin
  konfigurierbar
- **Proxy** — Traefik mit Let's Encrypt (separat aufgesetzt)

**Wichtig — Base-Image-Anforderung:** Twin-Lab läuft NICHT auf
musl-basierten Linux-Distros (Alpine). `sqlite-vec` liefert nur
glibc-Builds, die `__memcpy_chk` und `__fread_chk` aus glibc's
FORTIFY_SOURCE benötigen — Symbole, die musl explizit nicht
implementiert. Das offizielle Docker-Setup verwendet
`node:20-slim` (Debian-basiert, glibc). Wer ein anderes Base-Image
nutzen will: muss glibc bieten. Siehe Troubleshooting für die
konkrete Fehlermeldung.

**Schematische Datenflüsse:**

```
[Browser] ──HTTPS──▶ [Traefik] ──▶ [Web :3000] ──HTTP──▶ [Runtime :4000]
                                                              │
                                                              ├─▶ [SQLite /data/twin.db]
                                                              │
                                                              ├─▶ [Embedding-Modell /app/data/model-cache]
                                                              │
                                                              └─▶ [Bridge :5100] ──▶ [Andere Twins]
```

---

## 2. Pre-Deploy-Anforderungen

### Server

- **OS:** Linux mit Docker Engine 24+ und Docker Compose v2 (`docker
  compose` statt `docker-compose`). Empfohlen: Debian 12+ oder
  Ubuntu 22.04+ als Host. Container-Base ist Debian-Slim (siehe oben).
- **Architektur:** x86_64 (amd64) ist getestet. ARM64 (aarch64) sollte
  funktionieren — Multi-Arch-Builds via buildx sind möglich, aber nicht
  offiziell verifiziert.
- **Disk:**
  - Container-Images: ~1.3 GB (Runtime ~854 MB + Web ~427 MB, beide
    debian-slim mit native Deps)
  - Modell-Cache: ~553 MB (einmaliger Download von HuggingFace)
  - DB: < 50 MB auch bei intensiver Nutzung (Sentence-Embeddings
    sind kompakt)
  - Plus Build-Cache, Logs, Backup-Headroom
  - **Empfehlung: 5 GB freier Disk für /docker und /var/lib/docker**
- **RAM:**
  - Runtime-Container belegt ~200-400 MB im Idle, beim Embedding-
    Cold-Start kurz bis zu 1.5 GB (Modell-Load)
  - Web-Container ~100-200 MB
  - **Empfehlung: 2 GB freier RAM minimum, 4 GB komfortabel**

### DNS

Drei DNS-Records werden gebraucht, alle vom Host als A-Record auf
die VPS-IP:

```
app.<deine-domain>     → VPS-IP
runtime.<deine-domain> → VPS-IP
bridge.<deine-domain>  → VPS-IP
```

Traefik kümmert sich um Let's Encrypt-Zertifikate automatisch.

### Bridge

Twin-Lab geht davon aus, dass der Bridge-Service erreichbar ist —
entweder lokal (für Single-Twin-Setups) oder als separater Container
mit eigener Domain (für Multi-Twin-Setups mit A2A-Kommunikation).

Die Bridge ist als separates Repo gepflegt:
[github.com/markusbaier/twin-lab-bridge](https://github.com/markusbaier/twin-lab-bridge)

Mehr-Bridge-Details: siehe Bridge-Repo-README.

### Docker-Network

Das `traefik-proxy` Docker-Network muss existieren, bevor
Twin-Lab-Container starten. Wird normalerweise durch die
Bridge-Container-Sequenz angelegt; manuell:

```bash
docker network create traefik-proxy
```

### Repo-Zugang

Wenn das Twin-Lab-Repo privat ist: SSH Deploy-Key auf dem VPS
einrichten, GitHub-Side als Deploy-Key (read-only) registrieren.
Beispiel-Pattern in `docker/twin-lab-web/README.md`.

---

## 3. Deploy-Sequenz

Zwei Pfade: einmaliges Erst-Setup auf frischem VPS (§3.1) und
Standard-Update-Pfad nach Code-Änderungen (§3.2). Stolpersteine
aus produktiven Re-Deploys stehen in §3.3 — wer schon einmal ein
Twin-Lab deployed hat, sollte mit §3.3 anfangen.

### 3.1 First-Time-Setup

#### 3.1.1 Pre-Flight

**Verzeichnis-Layout** (Empfehlung):

```
/docker/twin-lab-web/
├── repo/                              # geklontes Twin-Lab-Repo
├── docker-compose.yml                 # Symlink → repo/docker/twin-lab-web/docker-compose.yml
├── docker-compose.override.yml        # eigene Mounts — siehe §4, Pfade anpassen
├── .env                               # eigene ENV-Variables (siehe §5)
└── model-cache/                       # Bind-Mount für Embedding-Modell (siehe §4)
```

**Repo klonen:**

```bash
mkdir -p /docker/twin-lab-web
cd /docker/twin-lab-web
git clone https://github.com/markusbaier/twin-lab.git repo
# Bei privatem Repo: Deploy-Key auf VPS einrichten, dann:
# git clone git@github.com:markusbaier/twin-lab.git repo
```

**.env aus Template:**

```bash
cd /docker/twin-lab-web
cp repo/.env.example .env
$EDITOR .env  # Pflicht-Variables setzen — siehe §5
```

**Override-File anlegen:**

```bash
cp repo/docker/twin-lab-web/docker-compose.override.yml.example \
   docker-compose.override.yml
$EDITOR docker-compose.override.yml  # Pfade prüfen (siehe §4)
```

**Compose-Symlink:**

```bash
cd /docker/twin-lab-web
ln -s repo/docker/twin-lab-web/docker-compose.yml docker-compose.yml
```

**Verifikation:**

```bash
docker compose config --quiet && echo "Compose OK"
```

#### 3.1.2 Images bauen

Twin-Lab-Compose ist **image-tag-only** — `docker compose build`
warnt "No services to build", weil das Compose-File `image:`-Tags
referenziert, aber keinen `build:`-Block hat. Build-Befehle gehen
direkt über `docker build` aus dem Repo-Root:

```bash
cd /docker/twin-lab-web/repo

# Runtime — kein Build-ARG nötig
docker build -t twin-lab-runtime:latest -f apps/runtime/Dockerfile .

# Web — Build-ARGs PFLICHT
docker build \
  -t twin-lab-web:latest \
  -f apps/web/Dockerfile \
  --build-arg NEXT_PUBLIC_RUNTIME_URL=https://runtime.<deine-domain> \
  --build-arg NEXT_PUBLIC_DEPLOYMENT_LABEL=production \
  .
```

`NEXT_PUBLIC_DEPLOYMENT_LABEL` ist optional und steuert den
sichtbaren Deployment-Marker im UI (z.B. "production",
"staging", "preview"). Wenn nicht gesetzt, zeigt das UI keinen
Marker.

> **⚠️ Wichtig — NEXT_PUBLIC_\* sind Build-Time, nicht Runtime.**
>
> Next.js bakes alle Variables, die mit `NEXT_PUBLIC_` beginnen,
> zur Build-Zeit ins Client-Bundle. Die `environment:`-Sektion im
> Compose-File greift nur server-side, **nicht** im Browser-
> JavaScript.
>
> Ohne `--build-arg NEXT_PUBLIC_RUNTIME_URL=...` wird der
> Dockerfile-Default `http://localhost:4000` ins Bundle gebakt,
> der Browser versucht localhost zu callen, alle /twins-Requests
> failen mit "Failed to fetch" beim Login. Siehe §3.3.

**Bridge — Default vs. eigene:**

Self-Hoster nutzen by default die geteilte Production-Bridge unter
`bridge.twin.harwayexperience.com`. Eintrittskarte ist
`BRIDGE_REGISTER_TOKEN` (siehe §5). Kein zusätzlicher Build nötig.

Für volle Sovereignty oder Multi-Twin-Setups kann eine eigene
Bridge betrieben werden — separates Repo:
https://github.com/markusbaier/twin-lab-bridge. Dann
`TWIN_LAB_DEFAULT_BRIDGE_URL` in `.env` auf eigene Bridge-Domain
setzen.

#### 3.1.3 Container hochfahren

```bash
cd /docker/twin-lab-web
docker compose up -d
```

Beim allerersten Boot ist `--force-recreate` nicht nötig — die
Container existieren noch nicht. Für Re-Deploys siehe §3.2.3.

**Verifikation:**

```bash
docker compose ps
# Erwartung: alle Services Up, nicht Restarting
```

Wenn ein Service "Restarting" zeigt:
`docker compose logs <service>` zeigt warum (typische Ursachen
in §7 Troubleshooting).

#### 3.1.4 DB-Init verifizieren

Beim ersten Runtime-Boot läuft `init-db.ts` automatisch und
applied alle Migrations. Retrospektiv prüfen:

```bash
docker compose logs runtime | grep -E "Migration|db:init"
# Erwartete Zeilen:
# [db:init] NNN_xxx.sql angewendet
# [db:init] X Migration(en) bereits angewendet (skipped)
# [db:init] Schema initialisiert in /data/twin.db
```

Schema-Check via SQLite direkt — listet die letzten 5
angewendeten Migrations; Abgleich mit
`apps/runtime/migrations/`-Verzeichnis im Repo zeigt ob alles
durch ist:

```bash
docker exec twin-lab-runtime node -e "
const db = require('better-sqlite3')('/data/twin.db');
console.log(db.prepare('SELECT id, applied_at FROM schema_migrations ORDER BY 1 DESC LIMIT 5').all());
db.close();
"
```

#### 3.1.5 Erster User-Account

Twin-Lab hat eine UI-Signup-Route. Nach Container-Up:

1. Browser auf `https://app.<deine-domain>/` öffnen
2. Redirect zu `/login` → "Registrieren" anklicken
3. `/auth/register` → Email + Passwort eingeben
4. Nach Submit: Redirect zu `/onboarding`-Wizard (#110, baut den
   ersten Twin in 4 Schritten — Anthropic-API-Key, Persona,
   LLM-Config, Presets)

> **⚠️ Sicherheits-Hinweis — keine Allowlist heute.**
>
> Die Signup-Route ist offen für jeden, der die App-Domain kennt.
> Für Production-Self-Hosting empfohlen:
>
> - **Traefik-BasicAuth-Middleware** vor der App (Standard-Pattern,
>   schnell konfiguriert — siehe §10 Cookbook)
> - Oder DNS-Eintrag nur intern (VPN-only-Zugriff)
>
> Native Allowlist im Twin-Lab ist Backlog-Item für künftige Phase.

### 3.2 Standard-Update / Re-Deploy

#### 3.2.1 Pre-Flight

**DB-Backup** vor jedem Update (Volume-Backup-Pattern siehe §9):

```bash
cd /docker/twin-lab-web
docker run --rm \
  -v twin-lab-web-data:/source:ro \
  -v $(pwd):/backup \
  alpine tar czf /backup/twin-lab-db-$(date +%Y%m%d-%H%M).tar.gz -C /source .
```

Das Tarball landet in `/docker/twin-lab-web/` und sammelt sich
über Zeit an. Rotation und alternative Pfade siehe §9.

**Stand-Check** — was kommt rein:

```bash
cd /docker/twin-lab-web/repo
git fetch origin main
git log --oneline HEAD..origin/main
```

#### 3.2.2 Pull + Rebuild

```bash
cd /docker/twin-lab-web/repo
git pull origin main

# Runtime
docker build --no-cache \
  -t twin-lab-runtime:latest \
  -f apps/runtime/Dockerfile .

# Web — Build-ARGs MUSS gesetzt sein, sonst Login-Bug aus §3.3
docker build --no-cache \
  -t twin-lab-web:latest \
  -f apps/web/Dockerfile \
  --build-arg NEXT_PUBLIC_RUNTIME_URL=https://runtime.<deine-domain> \
  --build-arg NEXT_PUBLIC_DEPLOYMENT_LABEL=production \
  .
```

> **Warum immer `--no-cache`?**
>
> Layer-Cache-Bugs sind frustrierend zu debuggen — Docker erkennt
> nicht zuverlässig, wann ein Sub-Verzeichnis im COPY-Layer sich
> geändert hat (besonders bei pnpm-workspace-monorepos). Plus:
> beim Wechsel von `--build-arg`-Werten ist `--no-cache` Pflicht,
> sonst gilt der gecachte ARG-Layer mit altem Wert. Build dauert
> 2-3 Minuten länger, dafür reproduzierbar.

#### 3.2.3 Container-Recreate

```bash
cd /docker/twin-lab-web
docker compose up -d --force-recreate runtime web
```

> **⚠️ KRITISCH — `--force-recreate` ist Pflicht nach Rebuild.**
>
> Wenn der Image-Tag gleich bleibt (z.B. `latest`), das Image aber
> neu gebaut wurde: `docker compose up -d` ohne `--force-recreate`
> erkennt keine Änderung und macht **nichts**. Der Container läuft
> weiter mit dem alten Image.
>
> Symptom: nach Rebuild kein Verhalten-Update, `docker compose ps`
> zeigt "Created 2 days ago" als Status. Leicht zu übersehen.

#### 3.2.4 Migration-Verifikation

Migrations laufen automatisch beim Runtime-Recreate. Verifikation:

```bash
docker compose logs runtime --tail 50 | grep -E "Migration|db:init"
```

Wenn neue Migrations in der Pull eingegangen sind: erwartete neue
`NNN_xxx.sql angewendet`-Zeilen. Beim "nichts neues" steht nur
"X Migration(en) bereits angewendet (skipped)".

Wenn eine neue Spalte erwartet wird (z.B. nach Schema-Migration):

```bash
docker exec twin-lab-runtime node -e "
const db = require('better-sqlite3')('/data/twin.db');
console.log(db.prepare('PRAGMA table_info(twin_profiles)').all().map(c => c.name));
db.close();
"
```

#### 3.2.5 Smoke-Tests

Siehe §6 — Container-Health, Browser-Smoke, Bridge-Test.

### 3.3 Stolpersteine

**Web-Bundle ohne Build-ARG = "Failed to fetch".** Häufigster
Self-Hosting-Bug, teuerster im Tag-23-Re-Deploy. Symptom: Login
schlägt fehl, Browser DevTools zeigt Request an
`http://localhost:4000` statt `https://runtime.<domain>`.
Ursache: Web-Image ohne `--build-arg NEXT_PUBLIC_RUNTIME_URL=...`
gebaut, Dockerfile-Default greift, localhost wird ins Client-
Bundle gebakt. Fix: Web-Image neu bauen mit Build-ARG (siehe
§3.1.2 / §3.2.2).

**Compose-Build funktioniert nicht.** `docker compose build`
warnt "No services to build" — by design. Compose-File hat nur
`image:`-Tags, kein `build:`-Block. Folge wenn übersehen: kein
neues Image gebaut, Container läuft weiter mit altem Image.
Images werden extern via `docker build` aus dem Repo-Root gebaut
(siehe §3.1.2 / §3.2.2).

**`docker compose up -d` ohne `--force-recreate`.** Bei gleichem
Image-Tag (`:latest`) erkennt Compose keine Image-Änderung,
Container bleibt am alten Image — selbst wenn das Image frisch
neu gebaut wurde. Nach jedem Rebuild explicit
`--force-recreate <service>` (siehe §3.2.3).

**Production-Working-Directory ermitteln.** Wenn unklar wo der
Stack auf dem VPS liegt (z.B. nach längerer Pause oder bei
fremdem Setup):

```bash
docker inspect twin-lab-web \
  --format '{{ index .Config.Labels "com.docker.compose.project.working_dir" }}'
# Output: z.B. /docker/twin-lab-web
```

**Pre-Flight-Check vor und nach jedem Recreate:**

```bash
docker ps --format '{{.Names}} {{.Status}} {{.RunningFor}}'
# Vor + nach Recreate vergleichen — wenn "RunningFor"
# unverändert, hat compose nichts gemacht
```

---

## 4. Volume-Konfiguration

Twin-Lab nutzt vier Volume-Patterns mit unterschiedlichen Zwecken.
Drei davon werden über `docker-compose.override.yml` gemountet
(weil deployment-spezifisch), eins ist im Base-Compose definiert.

### Das DB-Volume — `twin-lab-web-data` (Base-Compose)

Persistiert `/data/twin.db` und alle Migrations-State. Definiert
in `docker-compose.yml` als Named Docker Volume. Self-Hoster müssen
hier nichts konfigurieren — funktioniert out of the box.

**Wichtig:** dieses Volume ist die einzige Datenquelle, die *nicht
regenerierbar* ist. Backup-Strategie sollte mindestens diesen Pfad
abdecken.

```bash
# Backup-Beispiel (rohe Volume-Kopie):
docker run --rm \
  -v twin-lab-web-data:/source:ro \
  -v $(pwd):/backup \
  alpine tar czf /backup/twin-lab-db-$(date +%Y%m%d).tar.gz -C /source .
```

### docs/ und mcp-servers/ Bind-Mounts (Override)

Wenn das Twin-Lab-Repo auf dem Host unter `/docker/twin-lab-web/repo/`
geklont ist, können `docs/` und `mcp-servers/` live in den Runtime-
Container gemountet werden:

```yaml
volumes:
  - /docker/twin-lab-web/repo/docs:/app/docs:ro
  - /docker/twin-lab-web/repo/mcp-servers:/app/mcp-servers:ro
```

**Warum:** `twin:reload-CLI` (Skill-Reload, MCP-Reload) liest aus
diesen Verzeichnissen. Mit Bind-Mount kann ein Self-Hoster Skills
und MCP-Server hinzufügen ohne Image-Rebuild — `git pull` im
Repo-Verzeichnis genügt.

### Modell-Cache-Volume (Override, Phase 3.4)

Phase 3.4 Episodic-Memory braucht ein lokales Embedding-Modell
(multilingual-e5-large q8, ~552 MB). Ohne dediziertes Volume würde
das Modell bei jedem Container-Recreate neu aus HuggingFace
heruntergeladen.

```yaml
services:
  runtime:
    environment:
      - TWIN_LAB_MODEL_CACHE_DIR=/app/data/model-cache
    volumes:
      - /docker/twin-lab-web/model-cache:/app/data/model-cache
```

**Warum bind-mount statt Docker-Volume:**

1. **Inspizierbarkeit** — `ls -la /docker/twin-lab-web/model-cache`
   per SSH zeigt was im Cache liegt
2. **Backup-Trennung** — Cache ist regenerierbar (kann nochmal aus
   HuggingFace geholt werden), DB ist es nicht. Getrennte Volumes
   erlauben getrennte Backup-Strategien
3. **Self-Hosting-Klarheit** — VPS-Pfade sind nachvollziehbarer als
   `/var/lib/docker/volumes/...`-IDs

**Warum eigene ENV-Variable statt `HF_HOME`:** `@huggingface/transformers`
4.2.0 hat null `process.env`-Referenzen in `env.js`. Heißt: `HF_HOME`,
`TRANSFORMERS_CACHE` und ähnliche Standard-Variables werden ignoriert.
Eine eigene Variable, die explizit `env.cacheDir` im Code setzt, ist
nötig.

### Setup-Sequenz auf VPS

```bash
# Verzeichnis anlegen
mkdir -p /docker/twin-lab-web/model-cache
chmod 755 /docker/twin-lab-web/model-cache

# Override-File anlegen (siehe docker/twin-lab-web/docker-compose.override.yml.example)
cd /docker/twin-lab-web
cp repo/docker/twin-lab-web/docker-compose.override.yml.example \
   docker-compose.override.yml
$EDITOR docker-compose.override.yml  # Pfade anpassen falls anders

# Verifikation
docker compose config --quiet && echo "Compose OK"

# Container hochfahren mit Override aktiv
docker compose up -d --force-recreate runtime

# Beim ersten Embed-Call wird Modell aus HuggingFace gepulled
# (~552 MB Download, ~30-60s je nach Bandbreite, danach im Cache)
```

Verifikation nach erstem Embed-Call:

```bash
docker exec twin-lab-runtime ls -la /app/data/model-cache
du -sh /docker/twin-lab-web/model-cache  # ~553 MB nach Pull
```

---

## 5. ENV-Variable-Reference

Twin-Lab liest ENV-Variables aus zwei Quellen:

- **Runtime-ENV** — über `.env` im Compose-Working-Directory in
  die Container injected
- **Build-Time-ENV** — über `--build-arg` zum `docker build`-
  Befehl, wird ins Web-Client-Bundle gebakt (siehe §3.1.2 / §3.3)

Per-Twin-API-Keys (Anthropic, OpenAI, MCP-Server) sind **nicht**
in der `.env` — die werden im Onboarding-Wizard pro Twin gesetzt
und AES-256-GCM-verschlüsselt in der DB gespeichert.

### 5.1 Pflicht-Variables — Übersicht

| Variable | Typ | Format | Wo gesetzt |
|----------|-----|--------|------------|
| `TWIN_LAB_ENCRYPTION_KEY` | Runtime | 32-byte base64 | `.env` |
| `TWIN_LAB_SESSION_SECRET` | Runtime | 48-byte base64 (≥32 Zeichen) | `.env` |
| `TWIN_LAB_DEFAULT_BRIDGE_URL` | Runtime | URL | `.env` |
| `BRIDGE_REGISTER_TOKEN` | Runtime | Hex/Token-String | `.env` |
| `SESSION_COOKIE_DOMAIN` | Runtime | `.deine-domain.tld` | `.env` |
| `SESSION_COOKIE_SECURE` | Runtime | `true` (Production) | `.env` |
| `NEXT_PUBLIC_RUNTIME_URL` | **Build-Time** | URL | `--build-arg` |

### 5.2 Pflicht-Variables — Details

**`TWIN_LAB_ENCRYPTION_KEY`** — AES-256-GCM Master-Key für die
Verschlüsselung von per-Twin-API-Keys in der DB.

```bash
openssl rand -base64 32
# oder, wenn das Repo lokal liegt:
pnpm --filter @twin-lab/runtime key:generate
```

> **Bei Verlust:** alle in der DB verschlüsselten API-Keys
> werden unbrauchbar. Re-Bootstrap pro Twin nötig. Niemals
> committen.

**`TWIN_LAB_SESSION_SECRET`** — Signing-Secret für iron-session-
Cookies. Mindestens 32 Zeichen.

```bash
openssl rand -base64 48
# oder:
pnpm --filter @twin-lab/runtime session-secret:generate
```

> **Bei Rotation:** alle aktiven Sessions werden invalidiert,
> User müssen sich neu einloggen.

**`TWIN_LAB_DEFAULT_BRIDGE_URL`** — Bridge-URL, an die der
Runtime neu angelegte Twins registriert. Default-Fallback ist
`http://127.0.0.1:5100` (lokales Dev).

Beispiele:

```
# Geteilte Production-Bridge (Default für Closed-Beta-Self-Hoster)
TWIN_LAB_DEFAULT_BRIDGE_URL=https://bridge.twin.harwayexperience.com

# Eigene Bridge — ersetze mit deiner Bridge-Domain
TWIN_LAB_DEFAULT_BRIDGE_URL=https://bridge.<deine-domain>
```

**`BRIDGE_REGISTER_TOKEN`** — Eintrittskarte für die Bridge.
Caller sendet den Wert im `X-Register-Token`-Header bei
`POST /twins/register`. Ohne den Token: 401.

Zwei Pfade:

- **Geteilte Production-Bridge** unter
  `bridge.twin.harwayexperience.com`: Token bei Markus
  (markus@harway.de) anfragen. Empfohlen für Closed-Beta-Phase
  oder einzelne Self-Hoster im Markus-Netzwerk.
- **Eigene Bridge** aufsetzen via
  [twin-lab-bridge](https://github.com/markusbaier/twin-lab-bridge),
  eigenen Token generieren:
  ```bash
  openssl rand -hex 32
  ```
  Empfohlen für volle Sovereignty oder Multi-Tenant-Setups.

> **Welcher Pfad?** Wenn du nur deinen eigenen Twin betreibst und
> im Markus-Netzwerk Twins ansprechen können sollst → geteilte
> Bridge. Wenn du eine eigene Plattform aufbaust oder vollständig
> autark sein willst → eigene Bridge.

**`SESSION_COOKIE_DOMAIN`** — Cookie-Domain mit führendem Punkt,
damit der Browser das Session-Cookie an beide Subdomains
(`app.*`, `runtime.*`) sendet.

```
SESSION_COOKIE_DOMAIN=.twin.deine-domain.tld
```

Häufiger Fehler: ohne führenden Punkt oder mit der falschen
Parent-Domain → Login klappt, aber `/twins`-Requests kriegen 401,
weil das Cookie nicht an die Runtime-Subdomain mitgeht.

**`SESSION_COOKIE_SECURE`** — `true` in Production (HTTPS), sonst
lehnt Chrome den Secure-Cookie ab. Lokales Dev: leer lassen (kein
Secure-Flag).

**`NEXT_PUBLIC_RUNTIME_URL`** — Build-Time, nicht Runtime!
Pflicht-Build-ARG für das Web-Image. Details siehe §5.3.

### 5.3 Build-Time-Variables (NEXT_PUBLIC_\*)

Next.js bakes Variables mit `NEXT_PUBLIC_`-Prefix zur Build-Zeit
ins Client-Bundle. Die `environment:`-Sektion im Compose-File
greift **nicht** für diese Variables — der Wert ist im fertigen
Bundle hartkodiert. Setzen passiert ausschließlich beim
`docker build --build-arg`.

| Variable | Pflicht | Default in Dockerfile | Zweck |
|----------|---------|------------------------|-------|
| `NEXT_PUBLIC_RUNTIME_URL` | **Ja** | `http://localhost:4000` (gefährlich!) | Browser-seitige Runtime-URL |
| `NEXT_PUBLIC_DEPLOYMENT_LABEL` | Nein | `"läuft lokal"` | Marker im AppFooter (unten auf jeder Seite) — z.B. `production`, `staging` |

> **⚠️ Erinnerung — Build-Time ≠ Runtime.**
>
> Diese Variables werden **nicht** über `.env` oder Compose-
> `environment:` injiziert. Wenn du sie nachträglich änderst,
> ist ein voller Web-Image-Rebuild mit neuem `--build-arg` Pflicht.
> Build-Befehle siehe §3.1.2 + §3.2.2. Häufigster Bug ohne
> Build-ARG: "Failed to fetch" beim Login, siehe §3.3.

### 5.4 Optional-Variables — Cluster

#### 5.4a LLM-Provider-Fallback (CLI-Bootstrap-Twins)

| Variable | Default | Werte |
|----------|---------|-------|
| `ACTIVE_PROVIDER` | `openai` | `openai` / `anthropic` / `local` |
| `OPENAI_API_KEY` | — | `sk-...` |
| `OPENAI_MODEL` | provider-spezifisch (siehe `.env.example`) | OpenAI-Model-ID |
| `ANTHROPIC_API_KEY` | — | `sk-ant-...` |
| `ANTHROPIC_MODEL` | provider-spezifisch (siehe `.env.example`) | Anthropic-Model-ID |

> **Default-Pfad ist der Onboarding-Wizard**, der pro Twin den
> API-Key verschlüsselt in der DB speichert (AES-256-GCM). Diese
> ENV-Variables sind nur Fallback für Twins, die via Bootstrap-
> CLI angelegt wurden (z.B. die ersten Twins auf Markus'
> Production-VPS). Self-Hoster, die ausschließlich den Wizard
> nutzen, brauchen diese Variables nicht.

#### 5.4b Runtime-Server

| Variable | Default | Zweck |
|----------|---------|-------|
| `RUNTIME_PORT` | `4000` | Runtime-Listen-Port (im Container) |
| `RUNTIME_HOST` | `127.0.0.1` | Runtime-Listen-Host. In Compose-Setup auf `0.0.0.0`, damit Reverse-Proxy zugreift. |

#### 5.4c Runtime-Pfade

| Variable | Default | Zweck |
|----------|---------|-------|
| `TWIN_DATABASE_PATH` | `<workspace>/data/twin.db` | Absoluter oder workspace-relativer Pfad zur SQLite-Datei |
| `PERSONA_PATH` | `<workspace>/docs/persona.md` | System-Prompt-Markdown (Bootstrap-Twin) |
| `PERSONA_META_PATH` | `<workspace>/docs/persona-meta.yaml` | Persona-Metadaten (Bootstrap-Twin) |
| `MANDATES_PATH` | `<workspace>/docs/mandates.yaml` | Mandates-File (Bootstrap-Twin) |

> Diese Variables sind für lokale CLI-Setups mit mehreren Twin-
> Instances pro Maschine (z.B. Markus' Dev-VPS mit @markus +
> @florian + @heiko via Bootstrap-CLI). Für Standard-Self-Hosting
> via Wizard nicht nötig — DB-Pfad ist im Container-Volume
> gemountet, Persona/Mandates kommen aus der DB.

#### 5.4d Episodic-Memory (Phase 3.4)

| Variable | Default | Zweck |
|----------|---------|-------|
| `TWIN_LAB_EMBEDDING_PROVIDER` | `local` | `local` / `openai` / `voyage` |
| `TWIN_LAB_EMBEDDING_MODEL` | provider-spezifisch | Modell-Override (local → `Xenova/multilingual-e5-large`; openai → `text-embedding-3-small`; voyage → `voyage-3`) |
| `TWIN_LAB_EMBEDDING_DTYPE` | `q8` | `q8` (~560 MB) / `fp32` (~2.1 GB) — q8 ist 4× kleiner, fast gleichgut für Retrieval |
| `TWIN_LAB_MODEL_CACHE_DIR` | (Cache in `node_modules/...`) | Persistenter Pfad für Embedding-Modell. **Production-Empfehlung:** via override.yml auf Bind-Mount setzen (siehe §4) |
| `TWIN_LAB_EMBEDDING_API_KEY` | Fallback: `OPENAI_API_KEY` / `VOYAGE_API_KEY` | API-Key wenn Provider `openai` / `voyage` |

> Defaults laufen out-of-the-box mit lokalem Embedding-Modell.
>
> Für Retrieval-Tuning (`EPISODIC_*`-Variables — Top-K, RRF-K,
> Pool-Size, Vector-Sim-Schwelle, RRF-Cutoff) siehe `.env.example`
> — alle Tunables haben sinnvolle Defaults, nur ändern wenn du
> das RRF-Hybrid-Search-Pattern verstehen willst (siehe
> `docs/3.4-STRATEGY.md`).

---

## 6. Smoke-Tests post-Deploy

Vier Stufen nach jedem First-Time-Setup oder Re-Deploy:
Container-Status (§6.1), Migration (§6.2), Browser-Smoke (§6.3),
Bridge-Test (§6.4). Wenn ein Schritt scheitert, stoppen und der
Cross-Reference folgen — die meisten Stolpersteine sind in §3.3
oder §7 Troubleshooting beschrieben.

### 6.1 Container-Status-Check

**Alle Services Up?**

```bash
cd /docker/twin-lab-web
docker compose ps
```

Erwartung: alle Services unter `STATUS` mit `Up X`, nicht
`Restarting (...)`. Wenn ein Service "Restarting": siehe §3.1.3
("Wenn ein Service Restarting") und §7 Troubleshooting.

**Runtime-Boot-Logs:**

```bash
docker compose logs runtime --tail 80
```

Erwartete Sequenz (Auszug aus echtem Boot):

```
[db:init] X Migration(en) bereits angewendet (skipped)
[db:init] Schema initialisiert in /data/twin.db
[boot] DB: /data/twin.db
[boot] N Twin(s) aktiv:
  - @<handle> (twin_<id>)
[boot] @<handle>: LLM=<provider>/<model>, API-Key=<masked>, Bridge=<url>
{"level":30,...,"msg":"Server listening at http://127.0.0.1:4000"}
[boot] Runtime hört auf http://0.0.0.0:4000
{"level":30,...,"msg":"[bridge:stream] verbinde"}
{"level":30,...,"msg":"[bridge:stream] verbunden"}
```

> **Log-Format:** Twin-Lab schreibt teils Plain-Text mit
> `[boot]`/`[db:init]`-Prefixes, teils pino-JSON
> (`{"level":30,...,"msg":"..."}`). Beide Formate sind normal —
> die wichtige Information steht im `msg`-Property der JSON-
> Lines. Bei Bedarf via `| jq '.msg'` filtern.

Wenn diese Sequenz unvollständig ist oder ein Stack-Trace
dazwischen liegt: siehe §7 Troubleshooting.

**Health-Endpoints (curl):**

```bash
curl -i https://runtime.<deine-domain>/health
# Erwartung: 200 OK

curl -i https://app.<deine-domain>/
# Erwartung: 200 oder 307 (Redirect zu /login)

# Eigene Bridge nur, wenn betrieben:
curl -i https://bridge.<deine-domain>/health
# Erwartung: 200 OK
```

### 6.2 Migration-Verifikation

**Migrations-Log:**

```bash
docker compose logs runtime --tail 100 | grep -E "Migration|db:init"
```

Bei einem Re-Deploy mit neuen Migrations: erwartete neue
`NNN_xxx.sql angewendet`-Zeilen. Beim "nichts neues" nur
`X Migration(en) bereits angewendet (skipped)`.

**Schema-Check via Node-Script** — listet die letzten 5
applied Migrations:

```bash
docker exec twin-lab-runtime node -e "
const db = require('better-sqlite3')('/data/twin.db');
console.log(db.prepare('SELECT id, applied_at FROM schema_migrations ORDER BY 1 DESC LIMIT 5').all());
db.close();
"
```

**PRAGMA-Check für erwartete neue Spalten:**

```bash
docker exec twin-lab-runtime node -e "
const db = require('better-sqlite3')('/data/twin.db');
console.log(db.prepare('PRAGMA table_info(twin_profiles)').all().map(c => c.name));
db.close();
"
# Erwartung: die neue Spalte ist in der Liste
```

Beispiel: nach Migration 023 (Tag 22) sollte `persona_input_json`
in der Spalten-Liste auftauchen. Nach einem Re-Deploy mit nur
Doku-Änderungen (ohne neue Migration): keine neue Spalte
erwartet, dieser Check ist dann optional.

### 6.3 Browser-Smoke

> **Warum Browser, nicht curl?** Frontend-Bugs (Build-ARG, CORS,
> Cookie-Domain) lassen sich am schnellsten über das Browser-
> DevTools-Network-Tab diagnostizieren. Curl gegen Health-
> Endpoints reicht für Server-Side, aber der häufigste Self-
> Hosting-Bug (`NEXT_PUBLIC_RUNTIME_URL` fehlt) zeigt sich nur im
> Browser. Tag-23-Lesson.

**Login funktional:**

1. Browser auf `https://app.<deine-domain>/` öffnen
2. Redirect zu `/login`
3. Einloggen → kein "Failed to fetch", landet im Dashboard

> **Wenn "Failed to fetch":** Web-Image wurde ohne
> `--build-arg NEXT_PUBLIC_RUNTIME_URL=...` gebaut. Browser
> versucht localhost:4000 zu callen. Fix: Web-Image neu bauen,
> siehe §3.3.

**Eigene Twin-Liste in /chat:**

`/chat` lädt — links die Liste der eigenen Twins, rechts der
Chat-Bereich. Erste Konversation mit dem Twin klappt
(Schreib-Test).

**Settings-Sections:**

`/settings?twin=@<handle>` zeigt drei Sections:

1. **Persona** — Name, Tonfall, Pronomen, Beziehungen
2. **LLM-Konfiguration** — Provider, Modell, API-Key-Status
3. **Pattern-Presets** — verfügbare Pattern-Skills

> Bei Legacy-Twins (CLI-Bootstrap, vor #110): Persona-Section
> zeigt einen Legacy-Hint mit "Persona neu strukturieren"-Button.
> Klick öffnet leere Form-Felder zum Re-Configuration —
> `persona_input_json` wird dabei gefüllt. Bei Wizard-Twins ist
> die Persona-Section pre-filled aus `persona_input_json`.

**DevTools-Network-Check** (kritisch):

1. Chrome/Firefox DevTools öffnen (F12)
2. Network-Tab auswählen
3. Seite neu laden
4. Filter auf `XHR`/`Fetch` setzen — optional zusätzlich nach
   `twins` im Filter-Feld suchen für gezielten Check

Erwartung: alle Requests gehen an `https://runtime.<deine-domain>`,
**nicht** an `http://localhost:4000`.

> **Wenn Requests an localhost gehen:** Web-Image wurde ohne
> Build-ARG gebaut. Siehe §3.3. Der häufigste Self-Hosting-Bug,
> teuerste Stolperfalle aus dem Tag-23-Re-Deploy.

### 6.4 Bridge-Test

**Bridge-Connection in Runtime-Logs:**

```bash
docker compose logs runtime --tail 100 | grep -E "bridge"
```

Erwartete Sequenz (zweistufig — `verbinde` kommt zuerst,
`verbunden` bestätigt):

```
[bridge:stream] verbinde mit <URL>
[bridge:stream] verbunden
```

Wenn nur `verbinde` ohne `verbunden`, oder mehrfach
`[bridge:stream] reconnect` erscheint: Bridge-URL oder Token
falsch — siehe §5.2 (`TWIN_LAB_DEFAULT_BRIDGE_URL` +
`BRIDGE_REGISTER_TOKEN`).

**Test-Message Twin A → Twin B** (nur möglich wenn mindestens
zwei Twins registriert sind):

1. `/chat?twin=@<a>` öffnen
2. A2A-Chat zu `@<b>` öffnen
3. Test-Message senden
4. Antwort erscheint im Stream (Mandate-Layer kann Approval
   blockieren — Inbox-Pending bei @<b> prüfen)

Bei Single-Twin-Setups: voller A2A-Test ist nicht möglich, aber
die Runtime-Boot-Log-Sequenz (`[bridge:stream] verbunden`)
verifiziert dass Bridge-Connectivity steht. Für vollen A2A-Test:
zweiten Test-User registrieren, der einen eigenen Test-Twin
anlegt, dann Messages zwischen beiden Twins schicken.

---

## 7. Troubleshooting

### "Failed to fetch" beim Login

**Symptom:** Login-Submit wirft "Failed to fetch" oder
NetworkError. `https://app.<deine-domain>/` lädt normal, aber
beim Submit passiert nichts oder eine Fehlermeldung erscheint.

**Diagnose** — Browser DevTools öffnen (F12), Network-Tab,
Seite neu laden + Login versuchen. Schau auf welche URL die
fehlgeschlagenen Requests gehen:

- **Requests gehen an `http://localhost:4000`** → das Web-Image
  wurde ohne `--build-arg NEXT_PUBLIC_RUNTIME_URL=...` gebaut.
  Der Browser versucht localhost zu callen, kommt aber nie an.
  Häufigster Self-Hosting-Bug.
- **Requests gehen an `https://runtime.<domain>` aber mit 401
  oder CORS-Error** → Browser-Console zeigt typisch
  "Cross-Origin Request Blocked" oder "Missing Access-Control-
  Allow-Origin". Cookie geht nicht an die Runtime-Subdomain
  weil `SESSION_COOKIE_DOMAIN` ohne führenden Punkt gesetzt ist
  (richtig: `.deine-domain.tld`, falsch: `deine-domain.tld`).
  Siehe §5.2.

**Wurzel** (häufigster Fall): `NEXT_PUBLIC_RUNTIME_URL` ist eine
Build-Time-Variable, kein Runtime-ENV. Die `environment:`-Sektion
im Compose-File greift nicht — der Wert ist im Web-Client-Bundle
hartkodiert.

**Fix:** Web-Image neu bauen mit Build-ARG. Voller Befehl in
§3.2.2 (Re-Deploy-Kontext; beim Erst-Setup analog §3.1.2). Dann
`docker compose up -d --force-recreate web`.

Verifikation nach Rebuild: gleicher DevTools-Network-Check, jetzt
müssen alle Requests an `https://runtime.<deine-domain>` gehen.

### Pull + Rebuild ohne Verhalten-Update — Container läuft mit altem Image

**Symptom:** Nach `git pull origin main` + `docker build ...` +
`docker compose up -d` zeigt der Stack keine neuen Features. Bug-
Fix aus dem Pull ist nicht da, neue UI-Sections fehlen,
Migration-Logs zeigen nichts Neues.

**Diagnose** — Primary-Check:

```bash
docker ps --format '{{.Names}} {{.Status}} {{.RunningFor}}'
# Erwartung nach Recreate: "RunningFor" zeigt "X seconds ago"
# Wenn "2 days ago": Container wurde NICHT neu erstellt
```

> Optional bei Unsicherheit — Image-Digest-Vergleich:
>
> ```bash
> docker inspect twin-lab-web --format '{{.Image}}'
> docker image inspect twin-lab-web:latest --format '{{.Id}}'
> ```
>
> Wenn die beiden IDs unterschiedlich sind: Container läuft an
> einem alten Image-Build, obwohl `:latest` auf neueres Image
> zeigt.

**Wurzel:** `docker compose up -d` ohne `--force-recreate`
erkennt keine Image-Änderung wenn der Tag gleich bleibt
(`:latest` ist immer `:latest`). Compose vergleicht nur Tags,
nicht Digests — Container bleibt am alten Image hängen.

**Fix:**

```bash
cd /docker/twin-lab-web
docker compose up -d --force-recreate runtime web
```

Detail-Sequenz siehe §3.2.3.

### `vec0.so.so: No such file or directory` beim Runtime-Start

**Symptom:** Runtime-Container in Restart-Loop, Logs zeigen:

```
SqliteError: Error loading shared library
.../sqlite-vec-linux-x64@0.1.9/.../vec0.so.so:
No such file or directory
```

**Was passiert wirklich:** Die Datei `vec0.so` existiert auf
Disk, aber `dlopen()` kann sie nicht laden. Wenn SQLite's
`sqlite3_load_extension()` den direkten Pfad nicht öffnen kann,
hängt es als Fallback nochmal die Plattform-Endung an — daraus
wird `vec0.so.so`. Die Fehlermeldung deutet auf Pfad-Auflösung
hin, das eigentliche Problem ist aber das Symbol-Loading.

**Wurzel:** `sqlite-vec-linux-x64` (das NPM-Sub-Package mit dem
`vec0.so`-Binary) ist gegen glibc gebaut. Auf musl-basierten
Linux-Distros (Alpine) fehlen Symbole wie `__memcpy_chk` und
`__fread_chk` — das sind glibc-FORTIFY_SOURCE-Hardening-Wrappers,
die musl nicht implementiert.

**Verifikation:** im Inspect-Container `ldd` auf das Binary:

```bash
docker run --rm -it --entrypoint sh <image>:latest

# In der Shell:
ldd /app/apps/runtime/node_modules/.pnpm/sqlite-vec-linux-x64@0.1.9/\
node_modules/sqlite-vec-linux-x64/vec0.so
```

Wenn die Ausgabe `Error relocating ... symbol not found` zeigt: das
ist musl-vs-glibc.

**Fix:** Base-Image auf glibc-basiert wechseln. Twin-Lab nutzt
default `node:20-slim` (Debian, glibc). Wenn du das geändert hast,
zurück auf `slim` oder `bookworm` (Debian) oder eine andere glibc-
Distro wechseln. **Nicht** `alpine` oder andere musl-Distros.

### Modell wird bei jedem Container-Recreate neu gepulled

**Symptom:** Erster Embed-Call dauert nach jedem `docker compose
up -d --force-recreate` 30-60s, Logs zeigen Download-Aktivität
gegen HuggingFace.

**Wurzel:** `TWIN_LAB_MODEL_CACHE_DIR` ist nicht gesetzt oder das
Volume ist nicht persistent gemountet. Default-Cache landet in
`node_modules/.../@huggingface/transformers/.cache/`, was beim
Container-Recreate weggeworfen wird.

**Fix:** Override.yml-Konfiguration prüfen — siehe Sektion
"Modell-Cache-Volume" oben.

Verifikation:

```bash
docker exec twin-lab-runtime printenv TWIN_LAB_MODEL_CACHE_DIR
# Erwartung: /app/data/model-cache (oder dein gewählter Pfad)

docker inspect twin-lab-runtime --format '{{json .Mounts}}' | python3 -m json.tool
# Erwartung: ein Eintrag mit "Destination": "/app/data/model-cache"

ls -la /docker/twin-lab-web/model-cache
# Erwartung: nicht leer nach erstem Embed-Call (~553 MB)
```

**Hinweis:** `docker compose config` kann irreführend sein bei
Volume-Verifikation. `docker inspect <container>` ist die
authoritative Quelle.

### `docker compose config` zeigt anderen Mount als `docker inspect`

**Symptom:** `docker compose config` zeigt die Volume-Mounts wie
in der override.yml definiert, aber `docker inspect` zeigt
abweichende Mounts (oder umgekehrt).

**Wurzel:** `docker compose config` zeigt die *deklarative*
Konfiguration nach Override-Merge. `docker inspect` zeigt was
*tatsächlich* im laufenden Container ist. Wenn der Container vor
dem letzten Override-Edit gestartet wurde, sind die Realität
unterschiedlich.

**Fix:** Container neu erstellen mit `--force-recreate`:

```bash
docker compose up -d --force-recreate <service>
```

Dann nochmal `docker inspect` — sollte jetzt der `compose config`-
Ausgabe entsprechen.

### Container "Up" aber `docker exec sqlite3` schlägt fehl

**Symptom:**

```
docker exec twin-lab-runtime sqlite3 /data/twin.db ".tables"
# Error: executable file not found in $PATH
```

**Wurzel:** Das `node:20-slim` Base-Image enthält den `sqlite3`-CLI
nicht. Twin-Lab nutzt `better-sqlite3` als Library, nicht den CLI.

**Workaround via Node:**

```bash
docker exec twin-lab-runtime node -e "
const Database = require('better-sqlite3');
const db = new Database('/data/twin.db');
console.log(db.prepare(\"SELECT name FROM sqlite_master WHERE type='table'\").all());
"
```

Oder den `sqlite3`-CLI im Dockerfile ergänzen (kleiner Patch, ~6 MB
Image-Größe):

```dockerfile
RUN apt-get update && \
    apt-get install -y --no-install-recommends sqlite3 && \
    rm -rf /var/lib/apt/lists/*
```

### Weitere Issues

> Deploy-Stolpersteine (`docker compose build` warnt "No services
> to build", Production-Working-Dir via `docker inspect`
> ermitteln, etc.) sind in §3.3 dokumentiert — sie treten während
> der Deploy-Sequenz auf, nicht im laufenden Betrieb.
>
> **TODO:** Diese Sektion wächst iterativ. Bekannte Patterns die
> noch dokumentiert werden sollen:
>
> - Bridge nicht erreichbar trotz Service running
> - Twin-Antworten kommen nicht durch (LLM-API-Key-Issues,
>   Encryption-Key-Mismatch)
> - Memory-Retrieval gibt keine Hits trotz Konversationen in DB
> - Migration-Lock bei interrupted Deploy

---

## Mitwirkende

Diese Anleitung ist iterativ. Wenn dir beim Self-Hosting was fehlt
oder ein Pattern nicht klar ist: Issue auf
[github.com/markusbaier/twin-lab/issues](https://github.com/markusbaier/twin-lab/issues)
ist willkommen.

Die ausführlichen Sektionen oben (Pre-Deploy, Volume-Konfiguration,
Troubleshooting) sind aus konkreten Production-Deploy-Erfahrungen
entstanden. Die Skelett-Sektionen wachsen wenn die Erfahrung
substantieller wird.
