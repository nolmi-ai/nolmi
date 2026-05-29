import type { FastifyReply, FastifyRequest } from "fastify";
import { sealData, unsealData } from "iron-session";
import { getEnv } from "@nolmi/shared/env";

// ─── SESSION ─────────────────────────────────────────────────────────────────
//
// iron-session über die Low-Level-API (sealData/unsealData) plus
// @fastify/cookie für Cookie-Handling. Cookie-Name fest "nolmi-session"
// (Rebrand Tag 31). Das alte "twin-lab-session" wird beim Read noch als
// Fallback akzeptiert (LEGACY_SESSION_COOKIE_NAME), damit Bestandssessions
// weiterleben — geschrieben wird ausschließlich der neue Name.
// Session-Daten heute schmal: nur userId. Email/displayName werden bei jedem
// /auth/me-Call aus DB nachgeladen — Cookie bleibt stateless gegen Profil-
// Änderungen.
//
// Das Secret kommt aus NOLMI_SESSION_SECRET (separat von
// NOLMI_ENCRYPTION_KEY für API-Keys). Mind. 32 Zeichen, sonst wirft
// iron-session selbst. Aliasing: TWIN_LAB_SESSION_SECRET wird via getEnv
// noch als Fallback gelesen (6–12 Monate, dann Hart-Cut).

export const SESSION_COOKIE_NAME = "nolmi-session";
export const LEGACY_SESSION_COOKIE_NAME = "twin-lab-session";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 Tage

export interface SessionData {
  userId: string;
}

export class SessionSecretMissingError extends Error {
  constructor() {
    super(
      "NOLMI_SESSION_SECRET (oder deprecated TWIN_LAB_SESSION_SECRET) ist nicht gesetzt oder zu kurz (min. 32 Zeichen).\n" +
        "Hinweis: 'pnpm --filter @nolmi/runtime session-secret:generate' erzeugt einen passenden Wert.",
    );
    this.name = "SessionSecretMissingError";
  }
}

function loadSecret(): string {
  const raw = getEnv("NOLMI_SESSION_SECRET", "TWIN_LAB_SESSION_SECRET")?.trim();
  if (!raw || raw.length < 32) {
    throw new SessionSecretMissingError();
  }
  return raw;
}

/**
 * Optionale Cookie-Attribute aus ENV. Production setzt
 *   SESSION_COOKIE_DOMAIN=.twin.harwayexperience.com
 *   SESSION_COOKIE_SECURE=true
 * damit der Cookie auf der Parent-Domain gilt (Web auf app.*, Runtime auf
 * runtime.*) und Browser ihn nur über HTTPS senden. Lokal beide ungesetzt →
 * kein Domain-Attribut, kein Secure-Flag (sonst lehnt Chrome den Secure-
 * Cookie auf http://localhost ab und der Login-Loop bricht stumm).
 *
 * Backlog: Reverse-Proxy mit Same-Origin macht das überflüssig.
 */
function cookieAttrs(): { domain?: string; secure?: boolean } {
  const out: { domain?: string; secure?: boolean } = {};
  const domain = process.env.SESSION_COOKIE_DOMAIN?.trim();
  if (domain) out.domain = domain;
  const secure = process.env.SESSION_COOKIE_SECURE?.trim().toLowerCase();
  if (secure === "true") out.secure = true;
  return out;
}

/**
 * Liest und entsiegelt den Session-Cookie. null wenn kein Cookie oder
 * Cookie ungültig (gefälscht, abgelaufen, anderes Secret). Dürfte bei
 * Letzterem leise null zurückgeben — Fastify entscheidet je nach Route,
 * ob das ein 401 wird.
 *
 * Read-Both (Rebrand Tag 31): erst neuer Name, dann Legacy-Fallback. Beide
 * Werte sind mit demselben Secret gesealt, also funktioniert der alte
 * Cookie nahtlos weiter.
 */
export async function getSession(
  request: FastifyRequest,
): Promise<SessionData | null> {
  const cookie =
    request.cookies?.[SESSION_COOKIE_NAME] ??
    request.cookies?.[LEGACY_SESSION_COOKIE_NAME];
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
    maxAge: SESSION_TTL_SECONDS,
    ...cookieAttrs(),
  });
}

export function destroySession(reply: FastifyReply): void {
  // domain + secure müssen identisch zum Set sein, sonst ignoriert der
  // Browser das Delete und der Cookie bleibt aktiv bis TTL. Wir löschen
  // den neuen Cookie aktiv; der Legacy-Cookie (falls vorhanden) wird hier
  // ebenfalls explizit beendet, damit Logout sauber wirkt — sonst würde
  // getSession() bei einem unverbrannten Bestandscookie noch greifen.
  reply.setCookie(SESSION_COOKIE_NAME, "", {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    maxAge: 0,
    ...cookieAttrs(),
  });
  reply.setCookie(LEGACY_SESSION_COOKIE_NAME, "", {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    maxAge: 0,
    ...cookieAttrs(),
  });
}
