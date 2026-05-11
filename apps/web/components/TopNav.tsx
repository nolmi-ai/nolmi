"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import type { AuditEntry, TwinEvent } from "@twin-lab/shared";

const RUNTIME_URL = process.env.NEXT_PUBLIC_RUNTIME_URL ?? "http://localhost:4000";

// ─── TOP-NAV ─────────────────────────────────────────────────────────────────
//
// Header-Navigation: chat | inbox | facts | stream.
//
// Settings ist seit dem Profil-Menu-Refactor (2.5.4.4) nur noch über das
// Profil-Dropdown rechts erreichbar — Settings ist Account-/Konfig-Stuff,
// nicht Tab-Navigation.
//
// Zwei Pending-Counter (3.3.G2): Inbox-Badge zählt non-fact-Pendings
// (Mandate/Tool/Bridge), Facts-Badge zählt nur `semantic-fact-write`.
// Damit sieht der User auf einen Blick, wo welche Aktionen anstehen — fact-
// pendings werden in der Facts-Page approved/rejected, der Rest in der
// Inbox. Live-Updates über SSE: bei pending-added/resolved refetchen wir
// die Liste neu, damit der Split-Counter konsistent bleibt (cheaper als
// inkrementelle Zählung mit Capability-Lookup).

interface TwinSummary {
  twinId: string;
  handle: string;
}

export function TopNav() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [twins, setTwins] = useState<TwinSummary[]>([]);
  const [pendingInboxCount, setPendingInboxCount] = useState(0);
  const [pendingFactsCount, setPendingFactsCount] = useState(0);

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
      pathname.startsWith("/stream") ||
      pathname.startsWith("/facts")
    ) {
      const fromQuery = searchParams.get("twin");
      if (fromQuery) return fromQuery;
    }
    return twins[0]?.handle ?? null;
  }, [pathname, searchParams, twins]);

  // Pending-Counter beim Handle-Wechsel neu laden + SSE-Stream subscriben.
  // 3.3.G2: zwei getrennte Counter — semantic-fact-write geht in den Facts-
  // Badge, alle anderen Pending-Capabilities in den Inbox-Badge.
  useEffect(() => {
    if (!currentHandle) {
      setPendingInboxCount(0);
      setPendingFactsCount(0);
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
        const data = (await res.json()) as { entries: AuditEntry[] };
        if (cancelled) return;
        let inbox = 0;
        let facts = 0;
        for (const entry of data.entries) {
          if (entry.capability === "semantic-fact-write") facts += 1;
          else inbox += 1;
        }
        setPendingInboxCount(inbox);
        setPendingFactsCount(facts);
      } catch {
        if (cancelled) return;
        setPendingInboxCount(0);
        setPendingFactsCount(0);
      }
    };

    refetchPending();

    // SSE: bei pending-added/resolved refetchen wir die Liste neu. Inkremen-
    // telles Zählen pro Capability wäre möglich, aber pending-resolved
    // liefert nur die auditId — wir müssten die Capability erst auflösen.
    // Pragmatischer: ein REST-Call pro Pending-Mutation, im Pilot-Volumen
    // unkritisch.
    const es = new EventSource(
      `${RUNTIME_URL}/twins/${currentHandle}/stream`,
      { withCredentials: true },
    );
    es.onmessage = (event) => {
      try {
        const parsed = JSON.parse(event.data) as TwinEvent;
        if (
          parsed.type === "pending-added" ||
          parsed.type === "pending-resolved"
        ) {
          void refetchPending();
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

  // Hrefs: Twin-Param mitgeben, falls bekannt.
  const inboxHref = currentHandle
    ? `/inbox?twin=${encodeURIComponent(currentHandle)}`
    : "/inbox";
  const factsHref = currentHandle
    ? `/facts?twin=${encodeURIComponent(currentHandle)}`
    : "/facts";

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
        {pendingInboxCount > 0 && (
          <span
            className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 text-[10px] font-semibold rounded-full bg-warn text-bg leading-none"
            aria-label={`${pendingInboxCount} wartende Aktionen`}
          >
            {pendingInboxCount}
          </span>
        )}
      </Link>
      <Link
        href={factsHref}
        className="hover:text-text transition-colors flex items-center gap-1.5"
      >
        <span>facts</span>
        {pendingFactsCount > 0 && (
          <span
            className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 text-[10px] font-semibold rounded-full bg-warn text-bg leading-none"
            aria-label={`${pendingFactsCount} Fakt-Vorschläge offen`}
          >
            {pendingFactsCount}
          </span>
        )}
      </Link>
      <Link href="/stream" className="hover:text-text transition-colors">
        stream
      </Link>
    </nav>
  );
}
