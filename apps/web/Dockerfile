# syntax=docker/dockerfile:1.7
#
# ─── WEB-IMAGE (Next.js Standalone) ────────────────────────────────────────
# Build aus dem Repo-Root, weil pnpm den Workspace-Lockfile braucht:
#   docker build -t twin-lab-web -f apps/web/Dockerfile .
#
# Next.js Standalone-Output (apps/web/next.config.mjs: output: "standalone")
# erzeugt unter .next/standalone/ einen self-contained Server-Bundle. In einem
# pnpm-Monorepo replicated Next die Workspace-Struktur, daher liegt der
# Einstieg unter apps/web/server.js und nicht direkt unter dem standalone-
# Root — die COPY-Layouts unten respektieren das.

# ─── Stage 1: Builder ───────────────────────────────────────────────────────
FROM node:20-alpine AS builder

RUN corepack enable

WORKDIR /repo

# Workspace-Manifeste zuerst — Layer-Cache greift, solange Lockfile und
# package.json unverändert sind.
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json tsconfig.base.json ./
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/

RUN pnpm install --frozen-lockfile --filter @twin-lab/web...

# Sources kopieren und bauen.
COPY apps/web apps/web
COPY packages/shared packages/shared

# shared explizit vor Web bauen. Next mit transpilePackages liest heute
# Source-TS direkt rein, aber wir bauen für Konsistenz mit dem Runtime-
# Pattern und als Sicherheits-Net, falls Next das später nicht mehr
# automatisch tut oder eine zusätzliche Resolution-Schicht das dist erwartet.
RUN pnpm --filter @twin-lab/shared build

# NEXT_PUBLIC_*-Vars werden zur Build-Zeit ins Client-Bundle inlined.
# Default lokal, in Production via --build-arg overriden:
#   docker build --build-arg NEXT_PUBLIC_RUNTIME_URL=https://... ...
ARG NEXT_PUBLIC_RUNTIME_URL=http://localhost:4000
ENV NEXT_PUBLIC_RUNTIME_URL=${NEXT_PUBLIC_RUNTIME_URL}

RUN pnpm --filter @twin-lab/web build


# ─── Stage 2: Runner ────────────────────────────────────────────────────────
FROM node:20-alpine AS runner

ENV NODE_ENV=production

WORKDIR /app

# Standalone-Bundle übernimmt die komplette Workspace-Pfadstruktur (apps/web,
# node_modules) flach unter /app. Static-Assets liegen im Standalone-Output
# NICHT mit drin, müssen separat rein. (twin-lab hat heute kein public/ —
# COPY dafür wurde aus dem Next-Standalone-Default entfernt; falls später
# Assets dazukommen: Zeile zurück.)
COPY --from=builder /repo/apps/web/.next/standalone ./
COPY --from=builder /repo/apps/web/.next/static ./apps/web/.next/static

EXPOSE 3000

# Standalone-Server-Pfad. HOSTNAME=0.0.0.0 + PORT=3000 setzt Compose explizit.
WORKDIR /app/apps/web
CMD ["node", "server.js"]
