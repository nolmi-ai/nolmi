import type { FastifyReply, FastifyRequest, preHandlerHookHandler } from "fastify";
import type { TwinsRepo, Twin } from "./twins-repo.js";

// ─── AUTH ────────────────────────────────────────────────────────────────────
//
// Pre-Shared Bearer-Token Auth. Jeder Twin hat bei Registrierung einen
// API-Token bekommen; Header-Format ist `Authorization: Bearer <token>`.
//
// `requireTwinAuth(twins)` liefert einen Fastify preHandler. Bei Erfolg setzt
// er `request.twin` für den Handler. Bei Misserfolg: 401 mit knapper Message.

declare module "fastify" {
  interface FastifyRequest {
    twin?: Pick<Twin, "handle" | "displayName">;
  }
}

export function requireTwinAuth(twins: TwinsRepo): preHandlerHookHandler {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const header = request.headers.authorization;
    if (!header || !header.startsWith("Bearer ")) {
      return reply.status(401).send({ error: "Bearer-Token fehlt" });
    }
    const token = header.slice("Bearer ".length).trim();
    if (!token) {
      return reply.status(401).send({ error: "Bearer-Token leer" });
    }
    const twin = twins.getByToken(token);
    if (!twin) {
      return reply.status(401).send({ error: "Token ist unbekannt" });
    }
    request.twin = { handle: twin.handle, displayName: twin.displayName };
    twins.touchLastSeen(twin.handle);
  };
}
