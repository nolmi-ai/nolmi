import { NextResponse, type NextRequest } from "next/server";

// ─── AUTH MIDDLEWARE ─────────────────────────────────────────────────────────
//
// Bewacht die User-sichtbaren Routen. Edge-Runtime hat keinen Zugriff auf
// die iron-session-Verifikation (würde Node-Crypto + ENV-Secret brauchen),
// daher hier nur ein Cookie-Presence-Check: gibt's das Cookie, wird die
// Anfrage durchgelassen — der Backend-Endpoint validiert dann den Inhalt
// und gibt bei stale-Cookie 401, was die Pages als "neu einloggen" rendern.
//
// Public Paths: /login + /onboarding (AccountBlock muss von nicht-eingeloggten
// Usern erreichbar sein — Register-Form lebt da drin). Onboarding-Backend-
// Endpoints (/onboarding/submit + /validate-api-key) prüfen Auth selbst,
// /onboarding/check-handle ist absichtlich offen.
//
// Protected: /chat/*, /settings, /stream/*, /inbox/*, /account + die
// Home-Route /.
//
// Cookie-Names (Rebrand Tag 31): primärer Cookie ist `nolmi-session`,
// das alte `twin-lab-session` wird als Fallback akzeptiert, damit
// Bestandssessions weiterleben. Geschrieben wird ausschließlich der neue
// Name — destroySession() im Runtime kümmert sich um beide Varianten.
//
// Diese Konstanten sind heute hier dupliziert (auch in
// `apps/runtime/src/auth/session.ts`). Für Edge-Runtime im Web-Workspace
// ist ein Cross-App-Import vom Runtime nicht strukturell vorgesehen
// (Runtime exportiert keine Subpaths). Konsolidierung über
// `@nolmi/shared/auth-cookies` ist als BACKLOG-Item vermerkt.

const SESSION_COOKIE_NAME = "nolmi-session";
const LEGACY_SESSION_COOKIE_NAME = "twin-lab-session";

const PROTECTED_PREFIXES = ["/chat", "/settings", "/stream", "/inbox", "/account"];

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Public Paths
  if (pathname.startsWith("/login")) return NextResponse.next();
  if (pathname.startsWith("/onboarding")) return NextResponse.next();

  // / und alle PROTECTED_PREFIXES brauchen Auth.
  const needsAuth =
    pathname === "/" ||
    PROTECTED_PREFIXES.some(
      (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
    );
  if (!needsAuth) return NextResponse.next();

  const hasCookie =
    request.cookies.has(SESSION_COOKIE_NAME) ||
    request.cookies.has(LEGACY_SESSION_COOKIE_NAME);
  if (hasCookie) return NextResponse.next();

  // Redirect zu /login mit ?next=<original-path>, damit nach Login zurück.
  const loginUrl = new URL("/login", request.url);
  loginUrl.searchParams.set("next", pathname);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  // Skip static files + Next-internals + API-Pfade (gibt's heute keine
  // im /api-Ordner, aber defensive). Alles andere geht durch die Middleware.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|api/).*)",
  ],
};
