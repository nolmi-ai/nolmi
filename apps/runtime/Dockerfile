# syntax=docker/dockerfile:1.7
#
# ─── RUNTIME-IMAGE ─────────────────────────────────────────────────────────
# Build aus dem Repo-Root, weil pnpm den Workspace-Lockfile braucht:
#   docker build -t twin-lab-runtime -f apps/runtime/Dockerfile .
#
# Pattern 1:1 von apps/bridge/Dockerfile übernommen, nur Filter-Targets
# wechseln und @nolmi/shared mitkopieren (Runtime nutzt es als
# Workspace-Dep — Bridge nicht). Abweichung: Base-Image ist hier
# node:20-slim statt -alpine (sqlite-vec braucht glibc, siehe Stage 1).

# ─── Stage 1: Builder ───────────────────────────────────────────────────────
# Debian-Slim statt Alpine: sqlite-vec-linux-x64 liefert vec0.so nur als
# glibc-Build (FORTIFY_SOURCE-Symbole __memcpy_chk / __fread_chk). Alpines
# musl libc implementiert die nicht → "symbol not found" beim Extension-Load,
# der Container-Init scheitert. glibc-Base ist daher Pflicht für die Runtime.
FROM node:20-slim AS builder

# better-sqlite3 hat ein natives Modul. Build-Toolchain als Sicherheits-Net,
# falls kein passender Prebuild gezogen wird (auf Debian/glibc-x64 meist
# vorhanden — wir verlassen uns aber nicht drauf).
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

# pnpm-Version stammt aus dem packageManager-Feld der Root-package.json
RUN corepack enable

WORKDIR /repo

# Workspace-Manifeste zuerst — Docker-Layer-Cache greift, solange Lockfile
# und Manifeste sich nicht ändern.
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json tsconfig.base.json ./
COPY apps/runtime/package.json apps/runtime/
COPY packages/shared/package.json packages/shared/

# `...` hängt transitive Workspace-Deps an (hier: @nolmi/shared).
RUN pnpm install --frozen-lockfile --filter @nolmi/runtime...

# Sources kopieren und bauen (shared muss vor runtime kompiliert werden,
# pnpm ordnet das via Topologie selbst).
COPY apps/runtime apps/runtime
COPY packages/shared packages/shared

# shared explizit vor Runtime bauen — Runtime importiert @nolmi/shared,
# dessen package.json zeigt main/exports auf dist/index.js. Ohne diesen
# Schritt wirft `node dist/index.js` zur Laufzeit ERR_UNKNOWN_FILE_EXTENSION,
# weil pnpm deploy zwar die Source-TS materialisiert, aber Node sie nicht
# laden kann.
RUN pnpm --filter @nolmi/shared build
RUN pnpm --filter @nolmi/runtime build

# `pnpm deploy` materialisiert ein deploybares Verzeichnis ohne pnpm-Symlinks:
# flaches node_modules (nur prod-Deps), plus alle Files aus apps/runtime/
# (dist/, migrations/, package.json). shared kommt mit dist/ rein, weil
# packages/shared/package.json files: ["dist"] gesetzt hat.
RUN pnpm deploy --filter @nolmi/runtime --prod /out


# ─── Stage 2: Runner ────────────────────────────────────────────────────────
FROM node:20-slim AS runner

ENV NODE_ENV=production

WORKDIR /app/apps/runtime

COPY --from=builder /out ./

# Production-Skill-Templates aus dem Repo-Root. examples/ ist nicht Teil des
# Workspaces (keine package.json), wird also weder von `pnpm deploy` noch von
# den apps/runtime/-COPYs im Builder erfasst. Self-Hosting-Pattern braucht
# /app/examples für `twin:skill-create @<handle> /app/examples/skills/<name>`
# (#120, Tag 20 Production-Deploy).
COPY examples /app/examples

# #122: MCP-Server-Templates für Auto-Provisioning im Onboarding-Wizard.
# Gleiches Pattern wie examples/ — kein Workspace-Member, manueller COPY.
# Resolved zur Laufzeit via `WORKSPACE_ROOT = resolve(__dirname, "../../..")`
# in config.ts → `/app` im Container → `/app/mcp-servers`.
COPY mcp-servers /app/mcp-servers

# Mount-Point fürs Compose-Volume (TWIN_DATABASE_PATH=/data/twin.db). Wird
# beim ersten Schreibzugriff von better-sqlite3 ohnehin angelegt — explizit
# anlegen ist nur Doku und schützt vor Permission-Edge-Cases.
RUN mkdir -p /data

# Nur Doku für `docker inspect` und Compose-Lesbarkeit.
EXPOSE 4000

# Wichtig: im Container muss RUNTIME_HOST=0.0.0.0 gesetzt werden, sonst
# hört die Runtime nur auf localhost (Default 127.0.0.1) und ist von außen
# nicht erreichbar. Migration läuft automatisch beim Container-Start
# (idempotent — bereits angewendete Migrations werden übersprungen). `exec`
# ersetzt den Shell-Prozess durch Node, damit SIGTERM von `docker stop`
# direkt beim Server ankommt und der Shutdown sauber bleibt.
CMD ["sh", "-c", "node dist/scripts/init-db.js && exec node dist/index.js"]
