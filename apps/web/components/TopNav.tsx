"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import type { TwinEvent } from "@twin-lab/shared";

const RUNTIME_URL = process.env.NEXT_PUBLIC_RUNTIME_URL ?? "http://localhost:4000";

// ─── TOP-NAV (2.5.4.3) ───────────────────────────────────────────────────────
//
// Header-Navigation: chat | inbox | stream | settings.
//
// Inbox-Badge zeigt den Pending-Count des aktuell ausgewählten Twins. Der
// Handle wird aus der URL abgeleitet (Path bei /chat/<h>, Query bei
// /inbox?twin=, /settings?twin=, /stream?twin=). Live-Updates über SSE:
// pending-added → +1, pending-resolved → -1. Beim Handle-Wechsel wird die
// Subscription neu aufgebaut.

interface TwinSummary {
  twinId: string;
  handle: string;
}

export function TopNav() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [twins, setTwins] = useState<TwinSummary[]>([]);
  const [pendingCount, setPendingCount] = useState(0);

  // Twin-Liste einmal beim Mount holen — für Fallback-Handle, falls die URL
  // keinen Twin angibt (z.B. /inbox ohne ?twin= → nimm ersten eigenen Twin).
  useEffect(() => {
    let cancelled = false;
    fetch(`${RUNTIME_URL}/twins`, { credentials: "include" })
      .then((res) => (res.ok ? res.json() : Promise.reject(`HTTP ${res.status}`)))
      .then((data: { twins: TwinSummary[] }) => {
        if (!cancelled) setTwins(data.twins);
      })
      .catch(() => {
        // Nicht eingeloggt o.ä. — kein Badge anzeigen, nicht crashen.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Aktuellen Handle: Path > Query > erster Twin.
  const currentHandle = useMemo(() => {
    if (pathname.startsWith("/chat/")) {
      const seg = pathname.split("/")[2];
      if (seg) return decodeURIComponent(seg);
    }
    if (
      pathname.startsWith("/settings") ||
      pathname.startsWith("/inbox") ||
      pathname.startsWith("/stream")
    ) {
      const fromQuery = searchParams.get("twin");
      if (fromQuery) return fromQuery;
    }
    return twins[0]?.handle ?? null;
  }, [pathname, searchParams, twins]);

  // Pending-Count beim Handle-Wechsel neu laden + SSE-Stream subscriben.
  useEffect(() => {
    if (!currentHandle) {
      setPendingCount(0);
      return;
    }

    let cancelled = false;

    const refetchPending = async () => {
      try {
        const res = await fetch(
          `${RUNTIME_URL}/twins/${currentHandle}/audit/pending`,
          { credentials: "include" },
        );
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as { entries: { id: string }[] };
        if (!cancelled) setPendingCount(data.entries.length);
      } catch {
        if (!cancelled) setPendingCount(0);
      }
    };

    refetchPending();

    // SSE für Live-Updates. Zustand inkrementell führen statt jedes Mal
    // neu zu laden — pending-added/resolved liefern genug Info.
    const es = new EventSource(
      `${RUNTIME_URL}/twins/${currentHandle}/stream`,
      { withCredentials: true },
    );
    es.onmessage = (event) => {
      try {
        const parsed = JSON.parse(event.data) as TwinEvent;
        if (parsed.type === "pending-added") {
          setPendingCount((c) => c + 1);
        } else if (parsed.type === "pending-resolved") {
          setPendingCount((c) => Math.max(0, c - 1));
        }
      } catch {
        // ignore
      }
    };
    es.onerror = () => {
      // EventSource reconnected automatisch — bei wiederholten Fehlern
      // refetchen wir den Count beim nächsten Connect oben.
    };

    return () => {
      cancelled = true;
      es.close();
    };
  }, [currentHandle]);

  // Inbox-href: Twin-Param mitgeben, falls bekannt.
  const inboxHref = currentHandle
    ? `/inbox?twin=${encodeURIComponent(currentHandle)}`
    : "/inbox";

  return (
    <nav className="flex gap-6 text-sm text-muted">
      <Link href="/chat" className="hover:text-text transition-colors">
        chat
      </Link>
      <Link
        href={inboxHref}
        className="hover:text-text transition-colors flex items-center gap-1.5"
      >
        <span>inbox</span>
        {pendingCount > 0 && (
          <span
            className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 text-[10px] font-semibold rounded-full bg-warn text-bg leading-none"
            aria-label={`${pendingCount} wartende Aktionen`}
          >
            {pendingCount}
          </span>
        )}
      </Link>
      <Link href="/stream" className="hover:text-text transition-colors">
        stream
      </Link>
      <Link href="/settings" className="hover:text-text transition-colors">
        settings
      </Link>
    </nav>
  );
}
