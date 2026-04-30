# Architektur-Entscheidungen

Kurzform der wichtigsten Architektur-Entscheidungen aus dem Sparring vor
Tag 1, festgehalten als "Architectural Decision Records lite".

## ADR-1 — Backend separat statt Next.js-Monolith

**Entscheidung:** Twin-Runtime ist ein eigener langlaufender Node-Prozess,
nicht in Next.js API Routes integriert.

**Grund:** Ein Twin ist konzeptionell ein Prozess, der "lebt" — er hat
Heartbeats, geplante Aktionen, langlaufende Verhandlungen (Phase 2+).
Next.js API Routes booten bei jedem Aufruf, halten keinen In-Memory-State,
haben Timeouts. Das passt nicht zur Twin-Logik.

**Vorbild:** Paperclip, OpenClaw, LangGraph, AutoGen — alle ernsthaften
Agent-Systeme bauen Backend separat.

## ADR-2 — SQLite statt Supabase/Postgres

**Entscheidung:** Persistenz ist SQLite (lokal als File `data/twin.db`).

**Grund:** Twin soll Local-First-fähig sein. Ein externer Service als
Default-Abhängigkeit widerspricht der Vision "dein Twin lebt auf deinem
Gerät". Phase 1 hat einen Nutzer (Markus); SQLite ist hier ideal.

**Trade-off:** Realtime für Live-Stream müssen wir selbst bauen — über
Server-Sent Events. Das war 2 Stunden Aufwand am ersten Tag.

**Plan für Phase 3+:** Repository-Pattern macht den Wechsel auf Postgres
oder Multi-Tenancy trivial.

## ADR-3 — Repository-Pattern für Persistenz-Abstraktion

**Entscheidung:** Alle DB-Zugriffe gehen über Interfaces in
`apps/runtime/src/repository/types.ts`. Die SQLite-Implementierung ist
austauschbar.

**Grund:** Zukünftiger Wechsel auf andere Persistenz (Postgres, Supabase,
verteilt) soll lokal in einer Datei passieren, nicht im ganzen Code.

## ADR-4 — Provider-Abstraktion für Modell-Wechsel

**Entscheidung:** Modell-Provider hinter `ModelProvider`-Interface
(`apps/runtime/src/providers/types.ts`). OpenAI und Anthropic sind initial
implementiert, weitere folgen.

**Grund:** Es gibt keinen "richtigen" Modell-Provider für Twin —
Persona-Stilqualität, Kosten, Latenz und Datenschutz-Profile unterscheiden
sich. Die Wahl muss flexibel bleiben, idealerweise per User konfigurierbar.

**Konsequenz:** ENV-Variable `ACTIVE_PROVIDER` schaltet, kein Code-Change.

## ADR-5 — pnpm Workspaces statt Turborepo

**Entscheidung:** Monorepo via pnpm workspaces.

**Grund:** Phase 1 hat zwei Apps. Turborepos Build-Caching lohnt erst
ab 3+ Apps. pnpm workspaces sind einfacher und schneller einzurichten.

## ADR-6 — Persona als Markdown, Mandates als YAML

**Entscheidung:** Persona kommt aus `docs/persona.md` (Prosa für Stil),
Mandates aus `docs/mandates.yaml` (strukturiert).

**Grund:** Persona ist Sprache, schreibt man in Prosa. Mandates sind
maschinen-prüfbare Regeln, brauchen Struktur. Beide liegen im Repo, sind
versionierbar und reviewbar.

**Trade-off:** Bearbeitung in der UI fehlt — kommt in Phase 2.

## ADR-7 — In-Process EventBus statt externes Pub/Sub

**Entscheidung:** Events laufen über einen einfachen In-Process EventBus,
SSE liefert sie an die UI.

**Grund:** Phase 1 ist Single-Process, Single-User. Externes Pub/Sub
(Redis, NATS) ist Phase-3-Komplexität.

**Plan für Phase 2+:** Wenn der Runtime verteilt läuft (z.B. Twin-zu-Twin
über das Netzwerk), wird der EventBus durch eine externe Lösung ersetzt.
