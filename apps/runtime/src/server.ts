import Fastify, { type FastifyInstance, type FastifyReply } from "fastify";
import cors from "@fastify/cors";
import type { AuditRepository } from "./repository/types.js";
import { ChatRequestSchema } from "@twin-lab/shared";
import type { RegistryEntry, TwinServiceRegistry } from "./twin-service-registry.js";

// ─── HTTP SERVER ─────────────────────────────────────────────────────────────
//
// Phase 2.5d: Multi-Twin pro Runtime. Routing-Schema:
//
//   GET  /health                                      → server-weit
//   GET  /twins                                       → Liste aller aktiven Twins
//   GET  /twins/:handle/profile                       → Profil eines Twins
//   POST /twins/:handle/chat                          → Chat mit einem Twin
//   GET  /twins/:handle/audit?limit=50                → Audit-Log eines Twins
//   GET  /twins/:handle/audit/pending                 → Pending eines Twins
//   POST /twins/:handle/audit/:id/approve             → Approve
//   POST /twins/:handle/audit/:id/reject              → Reject
//   GET  /twins/:handle/stream                        → SSE für einen Twin
//
// Backward-Compat (legacy, route auf @markus):
//   POST /chat                              → POST /twins/@markus/chat
//   GET  /audit, /audit/pending             → /twins/@markus/audit*
//   POST /audit/:id/approve, /audit/:id/reject
//   GET  /stream                            → /twins/@markus/stream
//   GET  /twin-profile                      → /twins/@markus/profile
//
// Phase 1: keine Auth — läuft nur lokal auf 127.0.0.1.

const LEGACY_HANDLE = "@markus";

export interface ServerDeps {
  audit: AuditRepository;
  registry: TwinServiceRegistry;
}

export async function createServer(deps: ServerDeps) {
  const app = Fastify({ logger: true });

  await app.register(cors, {
    origin: true,
    credentials: true,
  });

  // ─── Helpers ───────────────────────────────────────────────────────────────

  const requireEntry = (
    handle: string,
    reply: FastifyReply,
  ): RegistryEntry | null => {
    const entry = deps.registry.getEntry(handle);
    if (!entry) {
      reply.status(404).send({ error: `Twin "${handle}" nicht gefunden oder inaktiv` });
      return null;
    }
    return entry;
  };

  const profileToResponse = (entry: RegistryEntry) => {
    const p = entry.profile;
    return {
      twinId: p.twinId,
      handle: p.handle,
      displayName: p.displayName,
      llmConfig: {
        provider: p.llmConfig.provider,
        model: p.llmConfig.model,
        baseUrl: p.llmConfig.baseUrl ?? null,
        // API-Key wird NIE im Klartext zurückgegeben; nur die Maske aus dem
        // beim Boot einmal entschlüsselten Wert + die Source.
        apiKeyMasked: entry.llmDisplay.apiKeyMasked,
        apiKeySource: entry.llmDisplay.apiKeySource,
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
  };

  // ─── Health ────────────────────────────────────────────────────────────────
  app.get("/health", async () => ({
    status: "ok",
    timestamp: new Date().toISOString(),
    twins: deps.registry.list().length,
  }));

  // ─── Twin-Liste ────────────────────────────────────────────────────────────
  app.get("/twins", async () => ({ twins: deps.registry.list() }));

  // ─── Profil ────────────────────────────────────────────────────────────────
  app.get<{ Params: { handle: string } }>(
    "/twins/:handle/profile",
    async (request, reply) => {
      const entry = requireEntry(request.params.handle, reply);
      if (!entry) return;
      return profileToResponse(entry);
    },
  );

  // ─── Chat ──────────────────────────────────────────────────────────────────
  app.post<{ Params: { handle: string } }>(
    "/twins/:handle/chat",
    async (request, reply) => {
      const entry = requireEntry(request.params.handle, reply);
      if (!entry) return;
      const parsed = ChatRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: parsed.error.message });
      }
      try {
        return await entry.service.chat(parsed.data.messages);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Unknown error";
        return reply.status(500).send({ error: msg });
      }
    },
  );

  // ─── Audit-Liste ───────────────────────────────────────────────────────────
  app.get<{ Params: { handle: string }; Querystring: { limit?: string; offset?: string } }>(
    "/twins/:handle/audit",
    async (request, reply) => {
      const entry = requireEntry(request.params.handle, reply);
      if (!entry) return;
      const limit = Math.min(Number(request.query.limit ?? 50), 200);
      const offset = Number(request.query.offset ?? 0);
      const entries = await deps.audit.list({ limit, offset, twinId: entry.twinId });
      return { entries };
    },
  );

  // ─── Pending-Liste ─────────────────────────────────────────────────────────
  app.get<{ Params: { handle: string } }>(
    "/twins/:handle/audit/pending",
    async (request, reply) => {
      const entry = requireEntry(request.params.handle, reply);
      if (!entry) return;
      // Pragmatisch: alle holen (200), in JS auf pending filtern. Bei
      // wachsendem Volumen besser eine WHERE status='pending'-Query im Repo.
      const entries = await deps.audit.list({ limit: 200, twinId: entry.twinId });
      return { entries: entries.filter((e) => e.status === "pending") };
    },
  );

  // ─── Approve ───────────────────────────────────────────────────────────────
  app.post<{ Params: { handle: string; id: string } }>(
    "/twins/:handle/audit/:id/approve",
    async (request, reply) => {
      const entry = requireEntry(request.params.handle, reply);
      if (!entry) return;
      const auditEntry = await deps.audit.get(request.params.id);
      if (!auditEntry || auditEntry.twinId !== entry.twinId) {
        return reply.status(404).send({ error: "Audit-Eintrag nicht für diesen Twin" });
      }
      try {
        return await entry.service.approvePending(request.params.id);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Unknown error";
        return reply.status(400).send({ error: msg });
      }
    },
  );

  // ─── Reject ────────────────────────────────────────────────────────────────
  app.post<{ Params: { handle: string; id: string }; Body: { reason?: string } }>(
    "/twins/:handle/audit/:id/reject",
    async (request, reply) => {
      const entry = requireEntry(request.params.handle, reply);
      if (!entry) return;
      const auditEntry = await deps.audit.get(request.params.id);
      if (!auditEntry || auditEntry.twinId !== entry.twinId) {
        return reply.status(404).send({ error: "Audit-Eintrag nicht für diesen Twin" });
      }
      try {
        const reason = request.body?.reason ?? "Rejected by user";
        await entry.service.rejectPending(request.params.id, reason);
        return { ok: true };
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Unknown error";
        return reply.status(400).send({ error: msg });
      }
    },
  );

  // ─── Stream (SSE) ──────────────────────────────────────────────────────────
  app.get<{ Params: { handle: string } }>(
    "/twins/:handle/stream",
    async (request, reply) => {
      const entry = requireEntry(request.params.handle, reply);
      if (!entry) return;

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

      const unsubscribe = entry.bus.subscribe((event) => send(event));

      const heartbeat = setInterval(() => {
        send({ type: "heartbeat", payload: { timestamp: new Date().toISOString() } });
      }, 15_000);

      request.raw.on("close", () => {
        clearInterval(heartbeat);
        unsubscribe();
      });
    },
  );

  // ─── Legacy-Aliases (route auf @markus) ────────────────────────────────────
  // Heute: erhält die Phase-2-UI am Leben, solange sie noch nicht alle
  // Endpoints umgestellt hat. Soll nach UI-Migration entfernt werden.

  registerLegacyAliases(app, deps, profileToResponse);

  return app;
}

// ─── Legacy-Aliases ──────────────────────────────────────────────────────────

function registerLegacyAliases(
  app: FastifyInstance,
  deps: ServerDeps,
  profileToResponse: (entry: RegistryEntry) => unknown,
) {
  const requireLegacyEntry = (reply: FastifyReply): RegistryEntry | null => {
    const entry = deps.registry.getEntry(LEGACY_HANDLE);
    if (!entry) {
      reply.status(404).send({
        error: `Legacy-Default-Twin "${LEGACY_HANDLE}" nicht aktiv — Endpoints sind deprecated, nutze /twins/<handle>/...`,
      });
      return null;
    }
    return entry;
  };

  app.get("/twin-profile", async (_request, reply) => {
    const entry = requireLegacyEntry(reply);
    if (!entry) return;
    return profileToResponse(entry);
  });

  app.post("/chat", async (request, reply) => {
    const entry = requireLegacyEntry(reply);
    if (!entry) return;
    const parsed = ChatRequestSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.message });
    try {
      return await entry.service.chat(parsed.data.messages);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      return reply.status(500).send({ error: msg });
    }
  });

  app.get<{ Querystring: { limit?: string; offset?: string } }>(
    "/audit",
    async (request, reply) => {
      const entry = requireLegacyEntry(reply);
      if (!entry) return;
      const limit = Math.min(Number(request.query.limit ?? 50), 200);
      const offset = Number(request.query.offset ?? 0);
      const entries = await deps.audit.list({ limit, offset, twinId: entry.twinId });
      return { entries };
    },
  );

  app.get("/audit/pending", async (_request, reply) => {
    const entry = requireLegacyEntry(reply);
    if (!entry) return;
    const entries = await deps.audit.list({ limit: 200, twinId: entry.twinId });
    return { entries: entries.filter((e) => e.status === "pending") };
  });

  app.post<{ Params: { id: string } }>(
    "/audit/:id/approve",
    async (request, reply) => {
      const entry = requireLegacyEntry(reply);
      if (!entry) return;
      try {
        return await entry.service.approvePending(request.params.id);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Unknown error";
        return reply.status(400).send({ error: msg });
      }
    },
  );

  app.post<{ Params: { id: string }; Body: { reason?: string } }>(
    "/audit/:id/reject",
    async (request, reply) => {
      const entry = requireLegacyEntry(reply);
      if (!entry) return;
      try {
        const reason = request.body?.reason ?? "Rejected by user";
        await entry.service.rejectPending(request.params.id, reason);
        return { ok: true };
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Unknown error";
        return reply.status(400).send({ error: msg });
      }
    },
  );

  app.get("/stream", async (request, reply) => {
    const entry = requireLegacyEntry(reply);
    if (!entry) return;
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
    const unsubscribe = entry.bus.subscribe((event) => send(event));
    const heartbeat = setInterval(() => {
      send({ type: "heartbeat", payload: { timestamp: new Date().toISOString() } });
    }, 15_000);
    request.raw.on("close", () => {
      clearInterval(heartbeat);
      unsubscribe();
    });
  });
}

// ─── helpers ─────────────────────────────────────────────────────────────────

/**
 * Maskiert einen Bridge-Token für die UI-Anzeige: erste 4 + "…" + letzte 4
 * Zeichen. Bei Tokens unter 9 Zeichen geben wir nur "…" zurück.
 */
function maskToken(token: string): string {
  if (token.length < 9) return "…";
  return `${token.slice(0, 4)}…${token.slice(-4)}`;
}
