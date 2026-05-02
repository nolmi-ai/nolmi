"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

const RUNTIME_URL = process.env.NEXT_PUBLIC_RUNTIME_URL ?? "http://127.0.0.1:4000";

interface TwinSummary {
  twinId: string;
  handle: string;
  displayName: string;
}

// Twin-Switcher in der Top-Nav. Lädt die Liste der aktiven Twins von /twins
// und navigiert je nach aktueller Page entweder die Chat-Route (/chat/<h>)
// oder den Settings-Query-Param (?twin=<h>).

export function TwinSwitcher() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [twins, setTwins] = useState<TwinSummary[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`${RUNTIME_URL}/twins`)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json() as Promise<{ twins: TwinSummary[] }>;
      })
      .then((data) => {
        if (!cancelled) setTwins(data.twins);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed");
      });
    return () => {
      cancelled = true;
    };
  }, []);

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

  if (error) {
    return <span className="text-xs text-warn">twins: {error}</span>;
  }
  // Empty-State: kein Twin vorhanden → einziger Call-to-Action ist Onboarding.
  if (twins.length === 0) {
    return (
      <a
        href="/onboarding"
        className="text-xs text-accent hover:underline"
      >
        + Twin anlegen
      </a>
    );
  }

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

  return (
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
  );
}
