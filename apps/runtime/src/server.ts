import Fastify from "fastify";
import cors from "@fastify/cors";
import type { TwinService } from "./twin-service.js";
import type { AuditRepository } from "./repository/types.js";
import type { EventBus } from "./events/bus.js";
import type { TwinProfile } from "./twin-profiles-repo.js";
import { ChatRequestSchema } from "@twin-lab/shared";

// ─── HTTP SERVER ─────────────────────────────────────────────────────────────
//
// Endpoints:
//   GET  /twin-profile            → aktives Twin-Profil (read-only, Token maskiert)
//   POST /chat                    → Twin antworten lassen
//   GET  /audit?limit=50          → Audit-Log lesen
//   GET  /audit/pending           → nur pending Aktionen (für Settings-UI)
//   POST /audit/:id/approve       → pending Aktion freigeben → Twin führt aus
//   POST /audit/:id/reject        → pending Aktion ablehnen
//   GET  /stream                  → Server-Sent Events (Live-Stream)
//   GET  /health                  → Heartbeat-Check
//
// Phase 1: keine Auth — läuft nur lokal auf 127.0.0.1.

export interface ServerDeps {
  twin: TwinService;
  audit: AuditRepository;
  bus: EventBus;
  /** Aktives Twin-Profil aus `twin_profiles`, beim Boot geladen. */
  profile: TwinProfile;
}

export async function createServer(deps: ServerDeps) {
  const app = Fastify({ logger: true });

  await app.register(cors, {
    origin: true,
    credentials: true,
  });

  // ─── Health ────────────────────────────────────────────────────────────────
  app.get("/health", async () => ({
    status: "ok",
    timestamp: new Date().toISOString(),
    subscribers: deps.bus.size(),
  }));

  // ─── Twin-Profil (read-only) ───────────────────────────────────────────────
  // Spiegelt das beim Boot geladene Profil für die Settings-UI. Sensitive
  // Felder werden gefiltert: api_key gar nicht, bridge_token nur maskiert.
  app.get("/twin-profile", async () => {
    const p = deps.profile;
    return {
      twinId: p.twinId,
      handle: p.handle,
      displayName: p.displayName,
      llmConfig: {
        provider: p.llmConfig.provider,
        model: p.llmConfig.model,
        baseUrl: p.llmConfig.baseUrl ?? null,
      },
      bridge: {
        url: p.bridgeUrl,
        tokenMasked: maskToken(p.bridgeToken),
      },
      mandatesCount: p.mandates.length,
      isActive: p.isActive,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
    };
  });

  // ─── Chat ──────────────────────────────────────────────────────────────────
  app.post("/chat", async (request, reply) => {
    const parsed = ChatRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.message });
    }
    try {
      const result = await deps.twin.chat(parsed.data.messages);
      return result;
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      return reply.status(500).send({ error: msg });
    }
  });

  // ─── Audit-Liste ───────────────────────────────────────────────────────────
  app.get<{ Querystring: { limit?: string; offset?: string } }>(
    "/audit",
    async (request) => {
      const limit = Math.min(Number(request.query.limit ?? 50), 200);
      const offset = Number(request.query.offset ?? 0);
      const entries = await deps.audit.list({ limit, offset });
      return { entries };
    },
  );

  // ─── Pending-Liste ─────────────────────────────────────────────────────────
  app.get("/audit/pending", async () => {
    // Pragmatisch: alle holen, dann filtern. Bei wachsendem Volumen würden
    // wir das ins Repository als eigene Methode mit WHERE status='pending'
    // verschieben.
    const entries = await deps.audit.list({ limit: 200 });
    const pending = entries.filter((e) => e.status === "pending");
    return { entries: pending };
  });

  // ─── Approve ───────────────────────────────────────────────────────────────
  app.post<{ Params: { id: string } }>(
    "/audit/:id/approve",
    async (request, reply) => {
      try {
        const result = await deps.twin.approvePending(request.params.id);
        return result;
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Unknown error";
        return reply.status(400).send({ error: msg });
      }
    },
  );

  // ─── Reject ────────────────────────────────────────────────────────────────
  app.post<{ Params: { id: string }; Body: { reason?: string } }>(
    "/audit/:id/reject",
    async (request, reply) => {
      try {
        const reason = request.body?.reason ?? "Rejected by user";
        await deps.twin.rejectPending(request.params.id, reason);
        return { ok: true };
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Unknown error";
        return reply.status(400).send({ error: msg });
      }
    },
  );

  // ─── Stream (SSE) ──────────────────────────────────────────────────────────
  app.get("/stream", async (request, reply) => {
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "Access-Control-Allow-Origin": "*",
    });

    const send = (event: unknown) => {
      reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
    };

    send({ type: "heartbeat", payload: { timestamp: new Date().toISOString() } });

    const unsubscribe = deps.bus.subscribe((event) => send(event));

    const heartbeat = setInterval(() => {
      send({ type: "heartbeat", payload: { timestamp: new Date().toISOString() } });
    }, 15_000);

    request.raw.on("close", () => {
      clearInterval(heartbeat);
      unsubscribe();
    });
  });

  return app;
}

// ─── helpers ─────────────────────────────────────────────────────────────────

/**
 * Maskiert einen Bridge-Token für die UI-Anzeige: erste 4 + "…" + letzte 4
 * Zeichen. Bei Tokens unter 9 Zeichen geben wir nur "…" zurück, weil sonst
 * der "Maske" so viel offen liegt wie der Klartext.
 */
function maskToken(token: string): string {
  if (token.length < 9) return "…";
  return `${token.slice(0, 4)}…${token.slice(-4)}`;
}