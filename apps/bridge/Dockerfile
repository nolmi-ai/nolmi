# syntax=docker/dockerfile:1.7
#
# ─── BRIDGE-IMAGE ──────────────────────────────────────────────────────────
# Build aus dem Repo-Root, weil pnpm den Workspace-Lockfile braucht:
#   docker build -t twin-lab-bridge -f apps/bridge/Dockerfile .
#
# Zwei Stages:
#   1. builder  → installiert alle Deps, kompiliert TypeScript, materialisiert
#                 ein flaches prod-Verzeichnis via `pnpm deploy` (löst das
#                 Symlink-Drama von pnpms .pnpm/-Store komplett auf).
#   2. runner   → minimaler Runtime-Container, nur Node + Deploy-Output.

# ─── Stage 1: Builder ───────────────────────────────────────────────────────
FROM node:20-alpine AS builder

# better-sqlite3 hat ein natives Modul. Auf Alpine (musl) ist meist kein
# Prebuild verfügbar → python3/make/g++ werden gebraucht. Der gebaute
# .node-Binary läuft danach ohne diese Tools.
RUN apk add --no-cache python3 make g++

# pnpm-Version stammt aus dem packageManager-Feld der Root-package.json
RUN corepack enable

WORKDIR /repo

# Workspace-Manifeste zuerst — Docker-Layer-Cache greift, solange Lockfile
# und Manifeste sich nicht ändern. Spart bei Code-Änderungen den Install-Schritt.
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json tsconfig.base.json ./
COPY apps/bridge/package.json apps/bridge/
COPY packages/shared/package.json packages/shared/

# Bridge importiert @twin-lab/shared nicht, aber pnpm-Workspace-Resolution
# braucht die Manifeste aller deklarierten Workspaces. Das `...` hängt
# transitive Dependencies der Bridge an, alles andere wird ausgelassen.
RUN pnpm install --frozen-lockfile --filter @twin-lab/bridge...

# Sources kopieren und Bridge bauen
COPY apps/bridge apps/bridge
COPY packages/shared packages/shared

RUN pnpm --filter @twin-lab/bridge build

# `pnpm deploy` materialisiert ein deploybares Verzeichnis ohne pnpm-Symlinks:
# flaches node_modules (nur prod-Deps), plus alle Files aus apps/bridge/
# (dist/, migrations/, package.json).
RUN pnpm deploy --filter @twin-lab/bridge --prod /out


# ─── Stage 2: Runner ────────────────────────────────────────────────────────
FROM node:20-alpine AS runner

ENV NODE_ENV=production

WORKDIR /app/apps/bridge

COPY --from=builder /out ./

# Nur Doku für `docker inspect` und Compose-Lesbarkeit — Compose mappt explizit.
EXPOSE 5100

# Wichtig: im Container muss BRIDGE_HOST=0.0.0.0 gesetzt werden, sonst hört
# die Bridge nur auf localhost (Default 127.0.0.1) und ist von außerhalb des
# Containers nicht erreichbar. Erstinit der DB läuft separat:
#   docker run … node dist/scripts/init-db.js
CMD ["node", "dist/index.js"]
