import Fastify from "fastify";
import cors from "@fastify/cors";
import type { TwinsRepo } from "./twins-repo.js";
import { TwinAlreadyExistsError } from "./twins-repo.js";
import type { MessagesRepo } from "./messages-repo.js";
import type { DeliveryHub } from "./delivery.js";
import { requireTwinAuth } from "./auth.js";

// ─── HTTP SERVER ─────────────────────────────────────────────────────────────
//
// Endpoints:
//   POST /twins/register             → neuen Twin anlegen, Token vergeben
//   GET  /twins                      → alle Twins listen (auth)
//   POST /messages                   → Nachricht an anderen Twin senden (auth)
//   GET  /messages/inbox?since=...   → ungelieferte Nachrichten holen (auth)
//   POST /messages/:id/ack           → Nachricht als zugestellt markieren (auth)
//   GET  /stream                     → SSE-Live-Empfang (auth)
//   GET  /health                     → Heartbeat-Check
//
// Phase 2: Pre-Shared Bearer-Token Auth, läuft hinter Traefik auf VPS.

export interface ServerDeps {
  twins: TwinsRepo;
  messages: MessagesRepo;
  delivery: DeliveryHub;
}

export async function createServer(deps: ServerDeps) {
  const app = Fastify({ logger: true });

  await app.register(cors, {
    origin: true,
    credentials: true,
  });

  const auth = requireTwinAuth(deps.twins);

  // ─── Health ────────────────────────────────────────────────────────────────
  app.get("/health", async () => ({
    status: "ok",
    registeredTwins: deps.twins.list().length,
    onlineTwins: deps.delivery.size(),
    timestamp: new Date().toISOString(),
  }));

  // ─── Register ──────────────────────────────────────────────────────────────
  app.post<{ Body: { handle?: string; displayName?: string } }>(
    "/twins/register",
    async (request, reply) => {
      const handle = request.body?.handle?.trim();
      const displayName = request.body?.displayName?.trim();
      if (!handle || !displayName) {
        return reply.status(400).send({
          error: "handle und displayName sind Pflicht",
        });
      }
      try {
        const twin = deps.twins.register(handle, displayName);
        return reply.status(201).send({
          handle: twin.handle,
          displayName: twin.displayName,
          apiToken: twin.apiToken,
          registeredAt: twin.registeredAt,
        });
      } catch (err) {
        if (err instanceof TwinAlreadyExistsError) {
          return reply.status(409).send({ error: err.message });
        }
        throw err;
      }
    },
  );

  // ─── Twins-Liste ───────────────────────────────────────────────────────────
  app.get("/twins", { preHandler: auth }, async () => {
    const twins = deps.twins.list();
    return {
      twins: twins.map((t) => ({
        handle: t.handle,
        displayName: t.displayName,
        registeredAt: t.registeredAt,
        lastSeenAt: t.lastSeenAt,
        online: deps.delivery.isOnline(t.handle),
      })),
    };
  });

  // ─── Nachricht senden ──────────────────────────────────────────────────────
  app.post<{ Body: { to?: string; content?: string; inReplyTo?: string | null } }>(
    "/messages",
    { preHandler: auth },
    async (request, reply) => {
      const sender = request.twin!;
      const to = request.body?.to?.trim();
      const content = request.body?.content;
      const inReplyTo = request.body?.inReplyTo ?? null;

      if (!to || typeof content !== "string" || content.length === 0) {
        return reply.status(400).send({
          error: "to und content sind Pflicht",
        });
      }
      if (to === sender.handle) {
        return reply.status(400).send({
          error: "Selbst-Nachrichten sind nicht erlaubt",
        });
      }
      const recipient = deps.twins.getByHandle(to);
      if (!recipient) {
        return reply.status(404).send({ error: `Empfänger "${to}" ist unbekannt` });
      }
      if (inReplyTo) {
        const ref = deps.messages.get(inReplyTo);
        if (!ref) {
          return reply.status(400).send({ error: `inReplyTo "${inReplyTo}" existiert nicht` });
        }
      }

      const message = deps.messages.create({
        fromHandle: sender.handle,
        toHandle: to,
        content,
        inReplyTo,
      });

      // Best-Effort Push. Ack kommt separat über POST /messages/:id/ack.
      deps.delivery.push(to, { type: "message", payload: message });

      return reply.status(202).send({ ok: true, messageId: message.id });
    },
  );

  // ─── Inbox abholen ─────────────────────────────────────────────────────────
  app.get<{ Querystring: { since?: string } }>(
    "/messages/inbox",
    { preHandler: auth },
    async (request) => {
      const handle = request.twin!.handle;
      const messages = deps.messages.listForRecipient(handle, request.query.since);
      return { messages };
    },
  );

  // ─── Ack ───────────────────────────────────────────────────────────────────
  app.post<{ Params: { id: string } }>(
    "/messages/:id/ack",
    { preHandler: auth },
    async (request, reply) => {
      const handle = request.twin!.handle;
      const message = deps.messages.get(request.params.id);
      if (!message) {
        return reply.status(404).send({ error: "Nachricht nicht gefunden" });
      }
      if (message.toHandle !== handle) {
        return reply.status(403).send({
          error: "Diese Nachricht ist nicht für dich",
        });
      }
      const changed = deps.messages.markDelivered(message.id);
      return { ok: true, alreadyAcked: !changed };
    },
  );

  // ─── Stream (SSE) ──────────────────────────────────────────────────────────
  app.get("/stream", { preHandler: auth }, async (request, reply) => {
    const handle = request.twin!.handle;

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

    // Catch-up: alle noch nicht zugestellten Nachrichten direkt nachschieben.
    // Ack bleibt explizit beim Empfänger — wir markieren hier nichts als
    // delivered, nur weil wir gepusht haben.
    for (const message of deps.messages.listForRecipient(handle)) {
      send({ type: "message", payload: message });
    }

    const unsubscribe = deps.delivery.register(handle, send);

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
