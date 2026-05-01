# twin-lab

Lab-Setup für die Entwicklung eines persönlichen AI-Twins mit A2A-Kommunikation.
Phase 1: Closed Twin — rein privat, mit Persona, Mandates und Audit-Log.

## Was das hier ist

Ein Monorepo mit zwei Apps:

- **`apps/runtime`** — Node/TypeScript-Backend, das den Twin als langlaufenden Prozess hält.
  Spricht mit Modell-Providern, prüft Mandates, schreibt Audit-Log, hält Memory.
- **`apps/web`** — Next.js-UI für Chat, Stream, Settings.
  Spricht mit dem Runtime via HTTP/SSE.

Geteilte Schemas und Types liegen in `packages/shared`.

Persistenz ist **SQLite** (lokale Datei, kein externer Service nötig).
Realtime über **Server-Sent Events** vom Runtime an die UI.

## Architektur in einem Bild

```
┌─────────────────┐         ┌──────────────────┐
│   apps/web      │  HTTP   │  apps/runtime    │
│   Next.js UI    │ ◄────► │  Node Process    │
│   Port 3000     │   SSE   │  Port 4000       │
└─────────────────┘         └────────┬─────────┘
                                     │
                            ┌────────▼─────────┐
                            │   SQLite File    │
                            │   data/twin.db   │
                            └──────────────────┘
```

Der Runtime lebt unabhängig von der UI. Wenn die UI zu ist, läuft der Twin
trotzdem weiter (Heartbeat, geplante Aktionen, Audit-Log).

## Quickstart

```bash
# Voraussetzungen: Node 20+, pnpm 9+
pnpm install

# .env aus Template kopieren und API-Key eintragen
cp .env.example .env
# OPENAI_API_KEY=sk-...

# Datenbank initialisieren (führt SQL-Migrations aus)
pnpm db:init

# Beides parallel starten (Runtime auf :4000, Web auf :3000)
pnpm dev
```

Dann: http://localhost:3000

## Repository-Struktur

```
twin-lab/
├── apps/
│   ├── web/                    Next.js Frontend
│   └── runtime/                Twin-Runtime (langlaufender Prozess)
├── packages/
│   └── shared/                 Geteilte Types & Schemas
└── docs/                       Persona, Mandates, Architektur-Notes
```

## Phase-1-Scope

Was funktioniert:
- Chat mit dem Twin in deinem Stil (Persona aus `docs/persona.md`)
- Drei initiale Mandates aus `docs/mandates.yaml` werden geprüft
- Jede Aktion landet im Audit-Log
- Live-Stream-Ansicht zeigt, was der Twin gerade tut
- Provider-Abstraktion: heute OpenAI, morgen Anthropic, übermorgen lokal

Was bewusst nicht funktioniert (das ist Phase 2+):
- Twin-zu-Twin-Kommunikation
- Public-Profilseite
- Identity / Reputation / Trust

## Nächste Schritte

Siehe `docs/ROADMAP.md`.
