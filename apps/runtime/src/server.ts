import Fastify from "fastify";
import cors from "@fastify/cors";
import type { TwinService } from "./twin-service.js";
import type { AuditRepository } from "./repository/types.js";
import type { EventBus } from "./events/bus.js";
import { ChatRequestSchema } from "@twin-lab/shared";

// ─── HTTP SERVER ─────────────────────────────────────────────────────────────
//
// Endpoints:
//   POST /chat             → Twin antworten lassen
//   GET  /audit?limit=50   → Audit-Log lesen
//   GET  /stream           → Server-Sent Events (Live-Stream der Twin-Aktivität)
//   GET  /health           → Heartbeat-Check
//
// Phase 1: keine Auth — läuft nur lokal auf 127.0.0.1.
// Phase 2+: Auth-Layer kommt obendrauf.

export interface ServerDeps {
  twin: TwinService;
  audit: AuditRepository;
  bus: EventBus;
}

export async function createServer(deps: ServerDeps) {
  const app = Fastify({ logger: true });

  await app.register(cors, {
    origin: true, // in Phase 1 unkritisch, läuft nur lokal
    credentials: true,
  });

  // ─── Health ────────────────────────────────────────────────────────────────
  app.get("/health", async () => ({
    status: "ok",
    timestamp: new Date().toISOString(),
    subscribers: deps.bus.size(),
  }));

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

  // ─── Audit ─────────────────────────────────────────────────────────────────
  app.get<{ Querystring: { limit?: string; offset?: string } }>(
    "/audit",
    async (request) => {
      const limit = Math.min(Number(request.query.limit ?? 50), 200);
      const offset = Number(request.query.offset ?? 0);
      const entries = await deps.audit.list({ limit, offset });
      return { entries };
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

    // Initialer Heartbeat
    send({ type: "heartbeat", payload: { timestamp: new Date().toISOString() } });

    // Subscribe an EventBus
    const unsubscribe = deps.bus.subscribe((event) => send(event));

    // Heartbeat alle 15s, damit Proxies die Verbindung nicht killen
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
