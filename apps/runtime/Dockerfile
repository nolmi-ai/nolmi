# syntax=docker/dockerfile:1.7
#
# ─── RUNTIME-IMAGE ─────────────────────────────────────────────────────────
# Build aus dem Repo-Root, weil pnpm den Workspace-Lockfile braucht:
#   docker build -t twin-lab-runtime -f apps/runtime/Dockerfile .
#
# Pattern 1:1 von apps/bridge/Dockerfile übernommen, nur Filter-Targets
# wechseln und @twin-lab/shared mitkopieren (Runtime nutzt es als
# Workspace-Dep — Bridge nicht).

# ─── Stage 1: Builder ───────────────────────────────────────────────────────
FROM node:20-alpine AS builder

# better-sqlite3 hat ein natives Modul. Auf Alpine (musl) ist meist kein
# Prebuild verfügbar → python3/make/g++ werden gebraucht.
RUN apk add --no-cache python3 make g++

# pnpm-Version stammt aus dem packageManager-Feld der Root-package.json
RUN corepack enable

WORKDIR /repo

# Workspace-Manifeste zuerst — Docker-Layer-Cache greift, solange Lockfile
# und Manifeste sich nicht ändern.
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json tsconfig.base.json ./
COPY apps/runtime/package.json apps/runtime/
COPY packages/shared/package.json packages/shared/

# `...` hängt transitive Workspace-Deps an (hier: @twin-lab/shared).
RUN pnpm install --frozen-lockfile --filter @twin-lab/runtime...

# Sources kopieren und bauen (shared muss vor runtime kompiliert werden,
# pnpm ordnet das via Topologie selbst).
COPY apps/runtime apps/runtime
COPY packages/shared packages/shared

# shared explizit vor Runtime bauen — Runtime importiert @twin-lab/shared,
# dessen package.json zeigt main/exports auf dist/index.js. Ohne diesen
# Schritt wirft `node dist/index.js` zur Laufzeit ERR_UNKNOWN_FILE_EXTENSION,
# weil pnpm deploy zwar die Source-TS materialisiert, aber Node sie nicht
# laden kann.
RUN pnpm --filter @twin-lab/shared build
RUN pnpm --filter @twin-lab/runtime build

# `pnpm deploy` materialisiert ein deploybares Verzeichnis ohne pnpm-Symlinks:
# flaches node_modules (nur prod-Deps), plus alle Files aus apps/runtime/
# (dist/, migrations/, package.json). shared kommt mit dist/ rein, weil
# packages/shared/package.json files: ["dist"] gesetzt hat.
RUN pnpm deploy --filter @twin-lab/runtime --prod /out


# ─── Stage 2: Runner ────────────────────────────────────────────────────────
FROM node:20-alpine AS runner

ENV NODE_ENV=production

WORKDIR /app/apps/runtime

COPY --from=builder /out ./

# Mount-Point fürs Compose-Volume (TWIN_DATABASE_PATH=/data/twin.db). Wird
# beim ersten Schreibzugriff von better-sqlite3 ohnehin angelegt — explizit
# anlegen ist nur Doku und schützt vor Permission-Edge-Cases.
RUN mkdir -p /data

# Nur Doku für `docker inspect` und Compose-Lesbarkeit.
EXPOSE 4000

# Wichtig: im Container muss RUNTIME_HOST=0.0.0.0 gesetzt werden, sonst
# hört die Runtime nur auf localhost (Default 127.0.0.1) und ist von außen
# nicht erreichbar. DB-Init läuft separat:
#   docker compose exec runtime node dist/scripts/init-db.js
CMD ["node", "dist/index.js"]
