import type { FastifyReply, FastifyRequest } from "fastify";
import { sealData, unsealData } from "iron-session";

// ─── SESSION ─────────────────────────────────────────────────────────────────
//
// iron-session über die Low-Level-API (sealData/unsealData) plus
// @fastify/cookie für Cookie-Handling. Cookie-Name fest "twin-lab-session".
// Session-Daten heute schmal: nur userId. Email/displayName werden bei jedem
// /auth/me-Call aus DB nachgeladen — Cookie bleibt stateless gegen Profil-
// Änderungen.
//
// Das Secret kommt aus TWIN_LAB_SESSION_SECRET (separat von
// TWIN_LAB_ENCRYPTION_KEY für API-Keys). Mind. 32 Zeichen, sonst wirft
// iron-session selbst.

export const SESSION_COOKIE_NAME = "twin-lab-session";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 Tage

export interface SessionData {
  userId: string;
}

export class SessionSecretMissingError extends Error {
  constructor() {
    super(
      "TWIN_LAB_SESSION_SECRET ist nicht gesetzt oder zu kurz (min. 32 Zeichen).\n" +
        "Hinweis: 'pnpm --filter @twin-lab/runtime session-secret:generate' erzeugt einen passenden Wert.",
    );
    this.name = "SessionSecretMissingError";
  }
}

function loadSecret(): string {
  const raw = process.env.TWIN_LAB_SESSION_SECRET?.trim();
  if (!raw || raw.length < 32) {
    throw new SessionSecretMissingError();
  }
  return raw;
}

/**
 * Liest und entsiegelt den Session-Cookie. null wenn kein Cookie oder
 * Cookie ungültig (gefälscht, abgelaufen, anderes Secret). Dürfte bei
 * Letzterem leise null zurückgeben — Fastify entscheidet je nach Route,
 * ob das ein 401 wird.
 */
export async function getSession(
  request: FastifyRequest,
): Promise<SessionData | null> {
  const cookie = request.cookies?.[SESSION_COOKIE_NAME];
  if (!cookie) return null;
  try {
    const data = await unsealData<SessionData>(cookie, {
      password: loadSecret(),
      ttl: SESSION_TTL_SECONDS,
    });
    if (!data?.userId) return null;
    return data;
  } catch {
    // Cookie korrupt/abgelaufen/anderes Secret — leise als "nicht
    // eingeloggt" behandeln.
    return null;
  }
}

export async function setSession(
  reply: FastifyReply,
  data: SessionData,
): Promise<void> {
  const sealed = await sealData(data, {
    password: loadSecret(),
    ttl: SESSION_TTL_SECONDS,
  });
  reply.setCookie(SESSION_COOKIE_NAME, sealed, {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    // secure: true,  // einschalten sobald wir hinter HTTPS deployen
    maxAge: SESSION_TTL_SECONDS,
  });
}

export function destroySession(reply: FastifyReply): void {
  reply.setCookie(SESSION_COOKIE_NAME, "", {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    maxAge: 0,
  });
}
