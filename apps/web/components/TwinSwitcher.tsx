"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

const RUNTIME_URL = process.env.NEXT_PUBLIC_RUNTIME_URL ?? "http://localhost:4000";

// ─── TWIN SWITCHER ───────────────────────────────────────────────────────────
//
// Eigenes Dropdown im selben Visual-Pattern wie ProfileMenu (Trigger-Button
// + Panel mit Header / Items / Trennlinie). Vorher: natives <select> — sah
// in jedem Browser anders aus und brach das Header-Styling.
//
// Inhalt:
//   - kleiner Header "Twins"
//   - Liste aktiver Twins, aktiver visuell hervorgehoben (Häkchen)
//   - Trennlinie + "+ Neuer Twin…" als CTA
//
// Vanilla-React (kein Radix etc.): useState fürs Open-Flag, Outside-Click +
// ESC-Handler — analog zu ProfileMenu, damit Verhalten 1:1 gleich.

interface TwinSummary {
  twinId: string;
  handle: string;
  displayName: string;
}

export function TwinSwitcher() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [twins, setTwins] = useState<TwinSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`${RUNTIME_URL}/twins`, { credentials: "include" })
      .then((res) => (res.ok ? res.json() : Promise.reject(`HTTP ${res.status}`)))
      .then((data: { twins: TwinSummary[] }) => {
        if (!cancelled) setTwins(data.twins);
      })
      .catch((err) => {
        if (!cancelled) setError(typeof err === "string" ? err : "Failed");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Outside-Click + ESC schließen das Dropdown — gleiche Mechanik wie
  // ProfileMenu.
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

  // Aktuellen Handle aus URL ableiten — Chat aus Path, Settings/Inbox aus Query.
  const currentHandle = useMemo(() => {
    if (pathname.startsWith("/chat/")) {
      const seg = pathname.split("/")[2];
      return seg ? decodeURIComponent(seg) : "";
    }
    if (pathname.startsWith("/settings") || pathname.startsWith("/inbox")) {
      return searchParams.get("twin") ?? "";
    }
    return "";
  }, [pathname, searchParams]);

  const navigateTo = (handle: string) => {
    if (pathname.startsWith("/chat")) {
      router.push(`/chat/${handle}`);
      return;
    }
    if (pathname.startsWith("/settings")) {
      const params = new URLSearchParams(searchParams.toString());
      params.set("twin", handle);
      router.push(`/settings?${params.toString()}`);
      return;
    }
    if (pathname.startsWith("/inbox")) {
      const params = new URLSearchParams(searchParams.toString());
      params.set("twin", handle);
      router.push(`/inbox?${params.toString()}`);
      return;
    }
    router.push(`/chat/${handle}`);
  };

  const onPick = (handle: string) => {
    setOpen(false);
    navigateTo(handle);
  };

  if (error) {
    return <span className="text-xs text-warn">twins: {error}</span>;
  }
  if (twins.length === 0) {
    return (
      <Link href="/onboarding" className="text-xs text-accent hover:underline">
        + Twin anlegen
      </Link>
    );
  }

  // Active-Twin für die Trigger-Anzeige: aus URL oder Fallback erster Twin.
  const active =
    twins.find((t) => t.handle.toLowerCase() === currentHandle.toLowerCase()) ??
    twins[0]!;
  const activeLower = active.handle.toLowerCase();

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Twin auswählen"
        className={`h-8 inline-flex items-center gap-2 px-3 rounded border text-xs font-mono transition-colors ${
          open
            ? "border-accent text-accent bg-bg"
            : "border-border text-text hover:border-accent hover:text-accent"
        }`}
      >
        <span className="truncate max-w-[140px]">{active.handle}</span>
        <span className="text-[10px] opacity-70">▾</span>
      </button>

      {open && (
        <div
          role="menu"
          aria-label="Twin-Switcher"
          className="absolute right-0 mt-2 w-64 bg-surface border border-border rounded shadow-lg z-50 overflow-hidden"
        >
          <div className="px-4 py-3 border-b border-border">
            <div className="text-xs uppercase tracking-wider text-muted">
              Twins
            </div>
          </div>
          <ul role="none" className="max-h-[300px] overflow-y-auto">
            {twins.map((t) => {
              const isActive = t.handle.toLowerCase() === activeLower;
              return (
                <li key={t.handle} role="none">
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => onPick(t.handle)}
                    className={`w-full text-left px-4 py-2 text-sm transition-colors flex items-center gap-2 focus:outline-none focus:bg-bg ${
                      isActive
                        ? "text-accent bg-bg"
                        : "text-text hover:bg-bg"
                    }`}
                  >
                    <span className="w-3 flex-shrink-0 text-accent">
                      {isActive ? "✓" : ""}
                    </span>
                    <span className="flex-1 min-w-0">
                      <span className="block truncate">{t.displayName}</span>
                      <span className="block text-xs text-muted font-mono truncate">
                        {t.handle}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          <div className="border-t border-border" />
          <Link
            href="/onboarding"
            role="menuitem"
            onClick={() => setOpen(false)}
            className="block px-4 py-2 text-sm text-text hover:bg-bg transition-colors focus:outline-none focus:bg-bg"
          >
            + Neuer Twin…
          </Link>
        </div>
      )}
    </div>
  );
}
