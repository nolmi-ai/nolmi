"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";

const RUNTIME_URL = process.env.NEXT_PUBLIC_RUNTIME_URL ?? "http://localhost:4000";

// ─── PROFILE MENU ────────────────────────────────────────────────────────────
//
// Avatar-Button rechts oben + Dropdown mit User-Info, Settings-Link, Logout.
// Vorher: Email + Logout waren inline neben dem TwinSwitcher; das hat den
// Header überfrachtet und Account-Aktionen mit App-Navigation vermischt.
//
// Vanilla-React: useState fürs Open-Flag, Outside-Click + ESC-Listener fürs
// Close. Keine Radix-/Headless-UI-Dependency, weil der Stack heute keine hat.

interface MeResponse {
  userId: string;
  email: string;
  displayName: string | null;
}

export function ProfileMenu() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [me, setMe] = useState<MeResponse | null>(null);
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const firstItemRef = useRef<HTMLAnchorElement | null>(null);

  // Auth-Status holen. Bei 401: ProfileMenu rendert nichts (User ist nicht
  // eingeloggt — dann ist eh AppHeader auf Public-Routes hidden, aber doppelt
  // genäht hält besser).
  useEffect(() => {
    let cancelled = false;
    fetch(`${RUNTIME_URL}/auth/me`, { credentials: "include" })
      .then((res) => (res.ok ? (res.json() as Promise<MeResponse>) : null))
      .then((data) => {
        if (!cancelled) setMe(data);
      })
      .catch(() => {
        // Network-Fail: einfach kein Menu rendern.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Outside-Click + ESC schließen das Dropdown.
  useEffect(() => {
    if (!open) return;
    const onMouseDown = (e: MouseEvent) => {
      if (!containerRef.current) return;
      if (!containerRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  // Beim Öffnen: Fokus auf das erste Item (Settings) — Tab/Enter wirken sofort.
  useEffect(() => {
    if (open) firstItemRef.current?.focus();
  }, [open]);

  // Aktuellen Twin-Handle aus URL ziehen, damit das Settings-Link den
  // gewählten Twin behält. Logik analog zur TwinSwitcher-Variante.
  const currentHandle = useMemo(() => {
    if (pathname.startsWith("/chat/")) {
      const seg = pathname.split("/")[2];
      if (seg) return decodeURIComponent(seg);
    }
    if (pathname.startsWith("/settings") || pathname.startsWith("/inbox")) {
      const fromQuery = searchParams.get("twin");
      if (fromQuery) return fromQuery;
    }
    return "";
  }, [pathname, searchParams]);

  const settingsHref = currentHandle
    ? `/settings?twin=${encodeURIComponent(currentHandle)}`
    : "/settings";

  async function logout() {
    try {
      await fetch(`${RUNTIME_URL}/auth/logout`, {
        method: "POST",
        credentials: "include",
      });
    } catch {
      // Network-Fail egal — wir navigieren weg, sonst hängt der User fest.
    }
    // Hard-Reload statt router.push: ProfileMenu/FooterMeta cachen den
    // /auth/me-Status im React-State, Client-Navigation würde den
    // veralteten "eingeloggt"-State weiterzeigen.
    window.location.href = "/login";
  }

  if (!me) return null;

  const initial = (me.displayName ?? me.email).trim().charAt(0).toUpperCase() || "?";

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Profil-Menu"
        className={`w-8 h-8 flex items-center justify-center rounded-full border text-xs font-semibold transition-colors ${
          open
            ? "border-accent text-accent bg-bg"
            : "border-border text-text hover:border-accent hover:text-accent"
        }`}
      >
        {initial}
      </button>

      {open && (
        <div
          role="menu"
          aria-label="Profil-Menu"
          className="absolute right-0 mt-2 w-64 bg-surface border border-border rounded shadow-lg z-50 overflow-hidden"
        >
          <div className="px-4 py-3 border-b border-border">
            <div className="text-sm text-text truncate">
              {me.displayName ?? "Ohne Namen"}
            </div>
            <div className="text-xs text-muted truncate">{me.email}</div>
          </div>
          <Link
            ref={firstItemRef}
            href={settingsHref}
            role="menuitem"
            onClick={() => setOpen(false)}
            className="block px-4 py-2 text-sm text-text hover:bg-bg transition-colors focus:outline-none focus:bg-bg"
          >
            Settings
          </Link>
          <div className="border-t border-border" />
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              void logout();
            }}
            className="block w-full text-left px-4 py-2 text-sm text-text hover:bg-bg hover:text-warn transition-colors focus:outline-none focus:bg-bg focus:text-warn"
          >
            Logout
          </button>
        </div>
      )}
    </div>
  );
}
