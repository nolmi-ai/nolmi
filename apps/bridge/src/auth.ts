import type { FastifyReply, FastifyRequest, preHandlerHookHandler } from "fastify";
import { Buffer } from "node:buffer";
import { timingSafeEqual } from "node:crypto";
import type { TwinsRepo, Twin } from "./twins-repo.js";

// ─── AUTH ────────────────────────────────────────────────────────────────────
//
// Pre-Shared Bearer-Token Auth. Jeder Twin hat bei Registrierung einen
// API-Token bekommen; Header-Format ist `Authorization: Bearer <token>`.
//
// `requireTwinAuth(twins)` liefert einen Fastify preHandler. Bei Erfolg setzt
// er `request.twin` für den Handler. Bei Misserfolg: 401 mit knapper Message.
//
// `requireAdmin(adminToken)` ist der twin-UNABHÄNGIGE Admin-Pfad (#744-Rest,
// Orphan-Cleanup): ein verwaister Handle hat kein gültiges api_token mehr,
// darum kann ihn weder requireTwinAuth noch der Owner-Scope deregistrieren —
// der Admin-Token (Header `X-Admin-Token`) ist der einzige Weg. OPT-IN:
// ohne konfigurierten Token ist die Capability AUS (503).

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

/**
 * Admin-Token-Auth für privilegierte Cleanup-Endpoints. OPT-IN: ohne
 * konfigurierten `adminToken` (null/leer) ist die Capability AUS → 503.
 * Header-Format `X-Admin-Token: <token>`, konstant-zeitlich verglichen
 * (Längen-Mismatch vorab → 401, sonst timingSafeEqual). Setzt kein
 * `request.twin` — der Pfad ist bewusst twin-unabhängig.
 */
export function requireAdmin(adminToken: string | null): preHandlerHookHandler {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    if (!adminToken) {
      return reply
        .status(503)
        .send({ error: "admin endpoint not configured" });
    }
    if (!isValidAdminToken(request.headers["x-admin-token"], adminToken)) {
      return reply
        .status(401)
        .send({ error: "admin token missing or invalid" });
    }
  };
}

// Konstant-zeitlicher Vergleich (analog isValidRegisterToken in server.ts):
// ungleiche Längen vorab ablehnen, sonst wirft timingSafeEqual.
function isValidAdminToken(
  provided: string | string[] | undefined,
  expected: string,
): boolean {
  if (typeof provided !== "string" || provided.length === 0) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
