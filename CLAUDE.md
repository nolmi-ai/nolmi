# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Sprache

Code-Kommentare, Doku, Commit-Messages und User-facing Strings sind auf **Deutsch**. Halte dich daran, wenn du Code änderst oder ergänzt.

## Commands

```bash
pnpm install                  # Dependencies (pnpm 9+ / Node 20+ Pflicht)
pnpm db:init                  # SQL-Migrationen aus apps/runtime/migrations ausführen, data/twin.db anlegen
pnpm dev                      # Runtime (:4000) + Web (:3000) parallel über pnpm -r
pnpm build                    # alle Workspaces
pnpm typecheck                # alle Workspaces (kein einzelner Lauf nötig — pro Workspace via pnpm --filter)
pnpm lint                     # nur apps/web hat ein Lint-Script (next lint)
pnpm --filter @twin-lab/runtime dev    # nur Runtime starten
pnpm --filter @twin-lab/web dev        # nur Web starten
```

Es gibt **keine Test-Suite**. Manuelles Smoke-Testing läuft über die UI (`/chat`, `/stream`, `/settings`) — siehe `docs/SETUP.md`.

`pnpm db:init` ist idempotent (`CREATE TABLE IF NOT EXISTS`). Nach Schema-Änderung: neue SQL-Datei in `apps/runtime/migrations/` anlegen — Filename-Konvention `NNN_name.sql` mit zero-padded Präfix; der Runner lädt alle `.sql`-Files in lexikographischer Reihenfolge (`apps/runtime/src/scripts/init-db.ts`).

## Architektur — was beim Lesen einzelner Files nicht sofort sichtbar ist

### Runtime ist ein separater Prozess, nicht Next.js API Routes

`apps/runtime` läuft als langlaufender Fastify-Server auf `127.0.0.1:4000`. `apps/web` ist Next.js und spricht **direkt** mit dem Runtime via `NEXT_PUBLIC_RUNTIME_URL`. Die leeren Ordner `apps/web/app/api/chat` und `apps/web/app/api/stream` sind Platzhalter — UI ruft den Runtime direkt auf. Diese Trennung ist bewusst (ADR-1 in `docs/ARCHITECTURE.md`): ein Twin ist konzeptionell ein Prozess, der lebt — Heartbeats, geplante Aktionen, später Verhandlungen.

### Boot-Reihenfolge (`apps/runtime/src/index.ts`)

1. SQLite-Repository erzeugen (`data/twin.db`, WAL-Mode)
2. Persona aus `docs/persona.md` + `docs/persona-meta.yaml` laden, in `persona`-Tabelle speichern (überschreibt jedes Mal)
3. Mandates aus `docs/mandates.yaml` laden, per `upsert` mit DB syncen
4. Provider aus `ACTIVE_PROVIDER` env (`openai` | `anthropic`) erzeugen
5. EventBus, AuditService, TwinService verkabeln
6. Fastify starten

**Konsequenz:** Persona- und Mandate-Änderungen brauchen einen Runtime-Neustart, kein `db:init`. UI hat (Phase 1) keine Edit-Möglichkeit — alles geht über die Files in `docs/`.

### Chat-Flow (`apps/runtime/src/twin-service.ts`)

Jede `POST /chat`-Anfrage durchläuft:

1. **Capability-Detection** — keyword-basiert in `detectCapability()` (`twin-service.ts:164`). Bewusst eng (z.B. LinkedIn-Draft braucht *zusätzlich* "draft"/"entwurf"/"formulier"...). Default: `respond_to_chat`.
2. **Mandate-Check** — `checkMandate()` schlägt nach `capability` in `mandates`-Tabelle. Kein Mandate → `block` → 500 mit Fehler.
3. **Escalation-Check** — Mandate mit `escalation: always_pending` (z.B. `draft_linkedin_post`) erzeugt einen Audit-Eintrag mit Status `pending` und führt **kein Modell-Call** aus. UI muss dann `POST /audit/:id/approve` callen.
4. **Audit start** → Provider-Call → **Audit complete** (Status `executed`) bzw. `fail` mit Reason.

Mandate-Conditions (`maxLength`, `requiresApproval`, ...) werden in Phase 1 noch **nicht** ausgewertet — Mandate vorhanden = erlaubt (`mandates/service.ts:73`). Wenn du das ergänzt, an dieser Stelle.

### Audit-Lifecycle

Append-only Log mit Status-Updates: `pending` → `approved` → `executed` (oder `failed`/`rejected`/`blocked`). Jede Mutation emittiert `audit.created`/`audit.updated` auf den `EventBus`, der per SSE an `/stream` rausgeht. Beim Implementieren neuer Twin-Aktionen: immer `AuditService.start/complete/fail` benutzen, nicht direkt ans Repository.

### Repository-Pattern

Alle DB-Zugriffe gehen über die Interfaces in `apps/runtime/src/repository/types.ts`. SQLite-Implementierung in `sqlite.ts` ist die einzige; geplant ist Postgres (Phase 3+). Die Tabellen halten den vollen JSON-State im `data`-Feld plus indizierte Spalten — neue Felder im Schema heißt nicht zwingend Migration, solange sie nur in `data` landen und nicht indiziert werden müssen.

### Provider-Abstraktion

`createProvider()` (`apps/runtime/src/providers/index.ts`) wählt anhand `ACTIVE_PROVIDER`. Neue Provider implementieren das `ModelProvider`-Interface aus `providers/types.ts` und werden im Switch eingehängt. **Kein Code-Change in TwinService nötig.**

Default-Models sind in `providers/index.ts` hartkodiert (`gpt-5.5`, `claude-opus-4-7`) und per `OPENAI_MODEL` / `ANTHROPIC_MODEL` env überschreibbar.

### Shared Types

`packages/shared/src/index.ts` ist der einzige Source of Truth für `Persona`, `Mandate`, `AuditEntry`, `TwinEvent`, `ChatMessage` — als Zod-Schemas mit abgeleiteten Types. Web und Runtime importieren von `@twin-lab/shared`. Schema-Änderung dort propagiert in beide Apps.

## Phase-1-Scope-Disziplin

Aus `docs/ROADMAP.md`: **bewusst nicht** in Phase 1 — Twin-zu-Twin-Kommunikation, Public-Profilseite, Identity/Reputation/Trust, Conditions-Auswertung in Mandates, UI-Editor für Persona/Mandates. Wenn ein Feature wie eines davon klingt, vor dem Bauen prüfen, ob es nicht eigentlich Phase 2+ ist.
