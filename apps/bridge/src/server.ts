import Fastify from "fastify";
import cors from "@fastify/cors";
import { Buffer } from "node:buffer";
import { timingSafeEqual } from "node:crypto";
import type { TwinsRepo } from "./twins-repo.js";
import { TwinAlreadyExistsError } from "./twins-repo.js";
import type { MessagesRepo, MessageType } from "./messages-repo.js";
import { MESSAGE_TYPES } from "./messages-repo.js";
import type { DeliveryHub } from "./delivery.js";
import { requireTwinAuth, requireAdmin } from "./auth.js";

// ─── HTTP SERVER ─────────────────────────────────────────────────────────────
//
// Endpoints:
//   POST /twins/register             → neuen Twin anlegen, Token vergeben
//                                       (Allowlist via X-Register-Token)
//   DELETE /twins/:handle            → Handle deregistrieren (auth, Owner-Scope)
//   DELETE /admin/twins/:handle      → Orphan-Cleanup (Admin-Token, #744-Rest)
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
  /**
   * Allowlist-Token für POST /twins/register. null → Endpoint deaktiviert
   * (alle Calls 503). Wenn gesetzt: Caller muss `X-Register-Token`-Header
   * mit exakt diesem Wert mitsenden, sonst 401.
   *
   * Fail-closed: Bridge wird ohne ENV nicht offen erreichbar — Boot-Warning
   * im index.ts macht das laut.
   */
  registerToken: string | null;
  /**
   * Admin-Token für privilegierte Cleanup-Endpoints (DELETE /admin/twins/:handle,
   * #744-Rest Orphan-Cleanup). null → Endpoint deaktiviert (503). OPT-IN, fail-
   * closed: ohne ENV ist der Admin-Pfad nicht erreichbar.
   */
  adminToken: string | null;
}

// Format-Check für Message-IDs: msg_<nanoid(16)>. Verhindert DB-Lookups mit
// Garbage-IDs und liefert ehrliche 400 statt 404.
const MESSAGE_ID_REGEX = /^msg_[A-Za-z0-9_-]{16}$/;

export async function createServer(deps: ServerDeps) {
  const app = Fastify({ logger: true });

  await app.register(cors, {
    origin: true,
    credentials: true,
  });

  const auth = requireTwinAuth(deps.twins);
  const admin = requireAdmin(deps.adminToken);

  // ─── Health ────────────────────────────────────────────────────────────────
  app.get("/health", async () => ({
    status: "ok",
    registeredTwins: deps.twins.list().length,
    onlineTwins: deps.delivery.size(),
    timestamp: new Date().toISOString(),
  }));

  // ─── Register ──────────────────────────────────────────────────────────────
  // Allowlist-Schutz via X-Register-Token-Header. Generische Fehlermeldung —
  // kein Hinweis darauf, ob der Header fehlt oder falsch ist.
  app.post<{ Body: { handle?: string; displayName?: string } }>(
    "/twins/register",
    async (request, reply) => {
      if (deps.registerToken === null) {
        request.log.warn(
          { ip: request.ip },
          "[register] abgelehnt — Endpoint ist disabled (BRIDGE_REGISTER_TOKEN nicht gesetzt)",
        );
        return reply.status(503).send({ error: "registration disabled" });
      }
      const provided = request.headers["x-register-token"];
      if (!isValidRegisterToken(provided, deps.registerToken)) {
        request.log.warn(
          { ip: request.ip, hasHeader: provided !== undefined },
          "[register] abgelehnt — Token fehlt oder ungültig",
        );
        return reply.status(401).send({ error: "registration not allowed" });
      }

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

  // ─── Deregister ──────────────────────────────────────────────────────────────
  //
  // Gegenstück zu POST /twins/register: entfernt einen Handle restlos aus der
  // Bridge-Registry. Gerufen vom Runtime-Client `deregisterHandleFromBridge`,
  // wenn ein Owner seinen Twin löscht (#744).
  //
  // Auth-Modell: identisch zu allen anderen authentifizierten Routen
  // (requireTwinAuth → Bearer-Token → getByToken). Anders als beim Register
  // gibt es hier KEINEN shared X-Register-Token — der Twin existiert ja schon
  // und weist sich mit seinem eigenen api_token aus. Zusätzlich Owner-Scope:
  // der Token muss zum :handle gehören, sonst 403 (kein Twin löscht einen
  // anderen). Idempotent gedacht: existiert der Handle nicht mehr → 404, der
  // Client schluckt das als Erfolg.
  app.delete<{ Params: { handle: string } }>(
    "/twins/:handle",
    { preHandler: auth },
    async (request, reply) => {
      const caller = request.twin!;
      const target = request.params.handle;
      if (caller.handle !== target) {
        return reply.status(403).send({
          error: "Token gehört nicht zu diesem Handle",
        });
      }
      const deleted = deps.twins.delete(target);
      if (!deleted) {
        // Sollte nach erfolgreicher Auth kaum vorkommen (Token resolved ja auf
        // genau diesen Handle), aber sauber 404 für den idempotenten Pfad.
        return reply.status(404).send({ error: "Handle nicht gefunden" });
      }
      return reply.status(204).send();
    },
  );

  // ─── Admin-Deregister (Orphan-Cleanup, #744-Rest) ────────────────────────────
  //
  // Twin-UNABHÄNGIGER Deregister-Pfad: ein verwaister Handle (Runtime-Twin
  // gelöscht, aber Bridge-Deregister damals fehlgeschlagen → bridgeOrphan) hat
  // kein gültiges api_token mehr, also kann ihn die per-twin DELETE /twins/:handle
  // oben NICHT entfernen. Hier zählt allein der Admin-Token (X-Admin-Token via
  // requireAdmin) — kein Owner-Scope, kein Bearer. Idempotent: nicht-existenter
  // Handle → 200 deleted:false (KEIN 404/throw), damit ein Cleanup-Lauf gegen
  // einen schon weg-geräumten Handle sauber durchläuft.
  app.delete<{ Params: { handle: string } }>(
    "/admin/twins/:handle",
    { preHandler: admin },
    async (request, reply) => {
      const handle = request.params.handle;
      const deleted = deps.twins.delete(handle);
      return reply.status(200).send({ handle, deleted });
    },
  );

  // ─── Nachricht senden ──────────────────────────────────────────────────────
  app.post<{
    Body: {
      to?: string;
      content?: string;
      inReplyTo?: string | null;
      messageType?: string;
    };
  }>(
    "/messages",
    { preHandler: auth },
    async (request, reply) => {
      const sender = request.twin!;
      const to = request.body?.to?.trim();
      const content = request.body?.content;
      const inReplyTo = request.body?.inReplyTo ?? null;
      const rawType = request.body?.messageType;

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
      // CHECK-Constraint geht in SQLite-ALTER nicht — App-Validation hier.
      let messageType: MessageType = "twin";
      if (rawType !== undefined) {
        if (!MESSAGE_TYPES.includes(rawType as MessageType)) {
          return reply.status(400).send({
            error: `messageType muss einer von [${MESSAGE_TYPES.join(", ")}] sein`,
          });
        }
        messageType = rawType as MessageType;
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
        messageType,
      });

      // Best-Effort Push. Ack kommt separat über POST /messages/:id/ack.
      deps.delivery.push(to, { type: "message", payload: message });

      return reply.status(202).send({ ok: true, messageId: message.id });
    },
  );

  // ─── Sender-Lookup (für Reply-Detection im Receiver-Runtime) ───────────────
  //
  // Empfänger-Twin braucht das, um zu prüfen, ob eine eingehende Nachricht
  // mit `inReplyTo` auf eine eigene zuvor gesendete Message verweist. Bei
  // Treffer: kein neuer Mandate-Check, sondern reply-received-Audit.
  //
  // Auth + Owner-Scope (#59): Endpoint ist auf der Production-Bridge öffentlich
  // erreichbar. Drei Schutzschichten:
  //   1. requireTwinAuth — gültiger Bridge-Bearer-Token Pflicht
  //   2. ID-Format-Regex früh — kaputte IDs liefern 400 ohne DB-Hit
  //   3. Owner-Scope — Antwort nur, wenn der einloggende Twin from oder to ist;
  //      Existence-Block (Message gibt's nicht) und Scope-Block (gibt's, aber
  //      nicht für dich) liefern dieselbe 404, damit ein Angreifer keine
  //      Existenz-Information mitnehmen kann.
  app.get<{ Params: { id: string } }>(
    "/messages/:id/sender",
    { preHandler: auth },
    async (request, reply) => {
      if (!MESSAGE_ID_REGEX.test(request.params.id)) {
        return reply.status(400).send({ error: "ID-Format ungültig" });
      }
      const callerHandle = request.twin!.handle;
      const message = deps.messages.get(request.params.id);
      const isParticipant =
        !!message &&
        (message.fromHandle === callerHandle || message.toHandle === callerHandle);
      if (!message || !isParticipant) {
        // Identische Antwort für „existiert nicht" und „nicht beteiligt" —
        // sonst wäre die Existenz einer Message-ID schon ein Info-Leak.
        return reply.status(404).send({ error: "Nachricht nicht gefunden" });
      }
      return {
        id: message.id,
        fromHandle: message.fromHandle,
        toHandle: message.toHandle,
        createdAt: message.createdAt,
      };
    },
  );

  // ─── Conversation-Verlauf zwischen zwei Handles (2.5.4.3) ────────────────
  //
  // Symmetrische View: beide Seiten sehen denselben chronologischen Bridge-
  // Verlauf. Auth via Bearer-Token; der einloggende Twin muss einer der beiden
  // Conversation-Partner sein, sonst 403 (verhindert Schnüffeln in fremde
  // Conversations).
  //
  // me kommt aus dem Auth-Token (request.twin.handle); with als Query-Param.
  app.get<{ Querystring: { with?: string } }>(
    "/messages/conversation",
    { preHandler: auth },
    async (request, reply) => {
      const me = request.twin!.handle;
      const partner = request.query.with?.trim();
      if (!partner) {
        return reply.status(400).send({ error: "Query-Param 'with' ist Pflicht" });
      }
      if (partner === me) {
        return reply.status(400).send({ error: "Selbst-Conversation nicht erlaubt" });
      }
      const messages = deps.messages.listConversation(me, partner);
      return { messages };
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

// ─── Register-Token-Vergleich ───────────────────────────────────────────────
//
// Konstant-zeitlicher String-Vergleich, damit ein Angreifer nicht über die
// Antwort-Zeit byte-für-byte den korrekten Token erraten kann. Buffer müssen
// gleich lang sein — ungleiche Längen vorab ablehnen, sonst wirft
// timingSafeEqual.
function isValidRegisterToken(
  provided: string | string[] | undefined,
  expected: string,
): boolean {
  if (typeof provided !== "string" || provided.length === 0) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
