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
// Protected: /chat/*, /settings, /stream/* + die Home-Route /.

const SESSION_COOKIE_NAME = "twin-lab-session";

const PROTECTED_PREFIXES = ["/chat", "/settings", "/stream"];

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

  const hasCookie = request.cookies.has(SESSION_COOKIE_NAME);
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
