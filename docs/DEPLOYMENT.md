# DEPLOYMENT — Twin-Lab Self-Hosting

> **Status:** Skelett-Version mit drei voll-ausgebauten Sektionen
> (Pre-Deploy-Anforderungen, Volume-Konfiguration, Troubleshooting).
> Andere Sektionen sind als Skelett mit `TODO`-Markern angelegt und
> wachsen iterativ.

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

## 3. First-Time-Setup

> **Status:** TODO — Skelett-Sektion mit Initial-Build-Block. Voller
> Self-Hosting-Walkthrough folgt.
>
> Das initiale Production-Setup ist in `docker/twin-lab-web/README.md`
> komplett dokumentiert. Diese Sektion soll daraus eine self-hosting-
> freundliche Version werden, mit:
>
> - Verzeichnis-Struktur-Empfehlung
> - Repo-Klonen mit Deploy-Key
> - `.env` aus `.env.example` ableiten (welche Variables Pflicht?)
> - Compose-Symlink-Setup
> - DB-Init und erste Twin-Anlage
>
> Bis dahin: siehe `docker/twin-lab-web/README.md` für die rohe
> Setup-Sequenz.

### Initial-Build der beiden Images

Twin-Lab-Compose ist image-tag-only — `docker compose build`
funktioniert NICHT (kein `build:`-Block im Compose-File, wir
bauen die Images extern und Compose pullt sie per Tag). Build
direkt via `docker build` aus dem Repo-Root:

```bash
cd /docker/twin-lab-web/repo
docker build -t twin-lab-runtime:latest -f apps/runtime/Dockerfile .
docker build \
  -t twin-lab-web:latest \
  -f apps/web/Dockerfile \
  --build-arg NEXT_PUBLIC_RUNTIME_URL=https://runtime.<deine-domain> \
  --build-arg NEXT_PUBLIC_DEPLOYMENT_LABEL=production \
  .
```

Re-Deploys nach Code-Updates folgen demselben Build-Block plus
`docker compose up -d --force-recreate runtime web` — vollständig
in §6 (Updates und Re-Deploys).

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

> **Status:** TODO — Skelett mit den wichtigsten Pflicht-Variables.
> Vollständige Reference folgt.

### Pflicht (Production)

Diese Variables müssen in der `.env` gesetzt sein, sonst startet
der Stack nicht oder ist unsicher:

| Variable | Zweck | Generierung |
|----------|-------|-------------|
| `TWIN_LAB_ENCRYPTION_KEY` | AES-256-GCM Master-Key für API-Key-Verschlüsselung in DB | `openssl rand -base64 32` |
| `TWIN_LAB_SESSION_SECRET` | iron-session Cookie-Signing-Secret | `openssl rand -base64 48` |
| `BRIDGE_REGISTER_TOKEN` | Allowlist-Token für POST /twins/register an Production-Bridge | aus Bridge-Config |
| `SESSION_COOKIE_DOMAIN` | Cookie-Domain (z.B. `.twin.example.com`) | deine Domain |
| `SESSION_COOKIE_SECURE` | `true` in Production (HTTPS), `false` für lokales Dev | — |

### Optional / Defaults okay

Phase-3.4-Episodic-Memory-Variables haben sinnvolle Defaults im
Code. Setze sie nur, wenn du das Verhalten anpassen willst:

| Variable | Default | Zweck |
|----------|---------|-------|
| `TWIN_LAB_MODEL_CACHE_DIR` | (unset, Cache in node_modules) | Persistenter Modell-Cache-Pfad — in Production via override.yml setzen |
| `TWIN_LAB_EMBEDDING_PROVIDER` | `local` | `local` / `openai` / `voyage` |
| `TWIN_LAB_EMBEDDING_DTYPE` | `q8` | `q8` / `fp32` (q8 ist 4x kleiner, fast gleichgut für Retrieval) |
| `EPISODIC_TOP_K` | `3` | Anzahl Memory-Hits pro Query |
| `EPISODIC_MIN_QUERY_LENGTH` | `10` | Mindest-Zeichen einer Query für Retrieval |
| `EPISODIC_HYBRID_RRF_K` | `60` | RRF-Fusion-Konstante |
| `EPISODIC_HYBRID_POOL_SIZE` | `10` | Top-N pro Source vor RRF-Fusion |
| `EPISODIC_HYBRID_MIN_VECTOR_SIM` | `0.5` | Pre-RRF Vector-Similarity-Schwelle |
| `EPISODIC_RRF_THRESHOLD` | `0.015` | Post-RRF Score-Schwelle |

**TODO:** komplette Variable-Reference aus `.env.example` aufnehmen,
plus Pflicht-Markierung pro Variable, plus Empfehlungen für
verschiedene Deployment-Szenarien.

---

## 6. Updates und Re-Deploys

> **Status:** TODO — Skelett mit Standard-Sequenz.

### Standard-Update

```bash
cd /docker/twin-lab-web/repo
git pull origin main

# Images neu bauen
docker build -t twin-lab-runtime:latest -f apps/runtime/Dockerfile .
docker build \
  -t twin-lab-web:latest \
  -f apps/web/Dockerfile \
  --build-arg NEXT_PUBLIC_RUNTIME_URL=https://runtime.<deine-domain> \
  --build-arg NEXT_PUBLIC_DEPLOYMENT_LABEL=production \
  .

# Container neu erstellen
cd ..
docker compose up -d --force-recreate
```

Migrationen werden beim Runtime-Start automatisch angewendet (siehe
init-db.ts).

**TODO:** Sektion ausbauen mit:
- Rollback-Strategie (alter Image-Tag, override.yml)
- Initial-Embedding nach neuen Memory-Schichten (z.B.
  `node dist/scripts/memory-embed-all.js @handle` nach Phase-3.4-
  Upgrade)
- Sicherheits-Checks vor Update (Backup, Verifikation, Smoke)

---

## 7. Smoke-Tests post-Deploy

> **Status:** TODO — Skelett mit Basis-Checks.

Nach jedem Update verifizieren:

```bash
# Container-Status
docker compose ps
# Erwartung: alle Services Up, nicht Restarting

# Runtime-Health
curl -i https://runtime.<deine-domain>/health
# Erwartung: 200 OK

# Web erreichbar
curl -i https://app.<deine-domain>/
# Erwartung: 200 oder 307 zu /login

# Bridge erreichbar (falls separat)
curl -i https://bridge.<deine-domain>/health
# Erwartung: 200 OK

# Logs auf Errors checken
docker logs twin-lab-runtime --tail 60 | grep -E "error|Error|ERROR"
```

**TODO:** Sektion ausbauen mit:
- Browser-basierter Real-Data-Smoke (Twin-Antwort verifizieren)
- DB-Health-Check (Tabellen-Counts, embedding_status-Verteilung)
- Memory-Retrieval-Smoke (Episodic-Hits via Test-Query)

---

## 8. Troubleshooting

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
