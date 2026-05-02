"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

const RUNTIME_URL = process.env.NEXT_PUBLIC_RUNTIME_URL ?? "http://localhost:4000";

interface TwinSummary {
  twinId: string;
  handle: string;
  displayName: string;
}

interface MeResponse {
  userId: string;
  email: string;
  displayName: string | null;
}

// Twin-Switcher in der Top-Nav. Lädt die Liste der aktiven Twins von /twins
// und navigiert je nach aktueller Page entweder die Chat-Route (/chat/<h>)
// oder den Settings-Query-Param (?twin=<h>). Plus Email + Logout-Button
// rechts daneben.

export function TwinSwitcher() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [twins, setTwins] = useState<TwinSummary[]>([]);
  const [me, setMe] = useState<MeResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetch(`${RUNTIME_URL}/twins`, { credentials: "include" })
        .then((res) => (res.ok ? res.json() : Promise.reject(`HTTP ${res.status}`)))
        .then((data: { twins: TwinSummary[] }) => data.twins),
      fetch(`${RUNTIME_URL}/auth/me`, { credentials: "include" })
        .then((res) => (res.ok ? (res.json() as Promise<MeResponse>) : null))
        .catch(() => null),
    ])
      .then(([twinList, meData]) => {
        if (cancelled) return;
        setTwins(twinList);
        setMe(meData);
      })
      .catch((err) => {
        if (!cancelled) setError(typeof err === "string" ? err : "Failed");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function logout() {
    try {
      await fetch(`${RUNTIME_URL}/auth/logout`, {
        method: "POST",
        credentials: "include",
      });
    } catch {
      // Egal — wir navigieren auch bei Network-Fail weg, weil der
      // wahrscheinlichste Fall "Server tot" ist und der User dann sowieso
      // nichts machen kann.
    }
    // Hard-Reload statt router.replace — TwinSwitcher/FooterMeta cachen
    // den /auth/me-Status im React-State, Client-Navigation würde den
    // veralteten "eingeloggt"-State weiterzeigen.
    window.location.href = "/login";
  }

  // Aktuellen Handle aus URL ableiten — Chat aus Path, Settings aus Query.
  const currentHandle = useMemo(() => {
    if (pathname.startsWith("/chat/")) {
      const seg = pathname.split("/")[2];
      return seg ? decodeURIComponent(seg) : "";
    }
    if (pathname.startsWith("/settings")) {
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
    router.push(`/chat/${handle}`);
  };

  // "+ neuer Twin"-Sentinel im Dropdown — clickt der User darauf, navigieren
  // wir zu /onboarding statt zur Twin-Page.
  const NEW_TWIN_SENTINEL = "__new__";

  const onChange = (value: string) => {
    if (value === NEW_TWIN_SENTINEL) {
      router.push("/onboarding");
      return;
    }
    navigateTo(value);
  };

  // Wir bauen drei Elemente: Switcher (oder Empty-CTA), Email, Logout.
  return (
    <div className="flex items-center gap-3">
      {error ? (
        <span className="text-xs text-warn">twins: {error}</span>
      ) : twins.length === 0 ? (
        <a href="/onboarding" className="text-xs text-accent hover:underline">
          + Twin anlegen
        </a>
      ) : (
        <select
          value={currentHandle || twins[0]?.handle || ""}
          onChange={(e) => onChange(e.target.value)}
          className="bg-bg border border-border text-text text-xs rounded px-2 py-1 font-mono focus:outline-none focus:border-accent"
          aria-label="Twin auswählen"
        >
          {twins.map((t) => (
            <option key={t.handle} value={t.handle}>
              {t.displayName} ({t.handle})
            </option>
          ))}
          <option disabled value="">
            ────────
          </option>
          <option value={NEW_TWIN_SENTINEL}>+ Neuer Twin…</option>
        </select>
      )}

      {me && (
        <>
          <span className="text-xs text-muted hidden sm:inline">{me.email}</span>
          <button
            onClick={logout}
            className="text-xs text-muted hover:text-warn transition-colors"
            aria-label="Logout"
          >
            Logout
          </button>
        </>
      )}
    </div>
  );
}
