"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { MaturityResult } from "@twin-lab/shared";

// ─── MaturityBadge (#101) ────────────────────────────────────────────────────
//
// Dauer-sichtbares Mono-Badge im Chat-Header: zeigt aktuelle Twin-Reife-Stufe
// plus Progress zur nächsten Stufe. Unterscheidet sich vom MemoryHitBadge
// (#100, situativ + expand-on-click) bewusst: keine Inline-Detail-Card im
// Chat, Detail-View lebt in Settings (#101 Phase 3). Klick führt direkt
// dorthin.
//
// Datenholung pro Twin-Handle: on-mount + bei Handle-Wechsel. Kein Polling
// und kein SSE-Push — Reife-Stufen ändern sich langsam (Konv-Schwellen, Tage-
// Spanne), die Stale-Toleranz beträgt eine Session. Nach Page-Reload kommen
// die neuesten Zahlen.

const RUNTIME_URL =
  process.env.NEXT_PUBLIC_RUNTIME_URL ?? "http://localhost:4000";

interface Props {
  twinHandle: string;
}

export function MaturityBadge({ twinHandle }: Props) {
  const [data, setData] = useState<MaturityResult | null>(null);
  const [error, setError] = useState<boolean>(false);

  useEffect(() => {
    let cancelled = false;
    setData(null);
    setError(false);
    fetch(`${RUNTIME_URL}/twins/${twinHandle}/maturity`, {
      credentials: "include",
    })
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json() as Promise<MaturityResult>;
      })
      .then((d) => {
        if (!cancelled) setData(d);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [twinHandle]);

  if (error || !data) return null;

  const progress = data.progressToNext;
  // #130 Phase 4.3: Settings-Page nutzt jetzt Tab-URLs (`?tab=reife`)
  // statt Anchor-Scroll (`#twin-reife`). Settings-Mount-Hook übersetzt
  // den alten Anchor als Bookmark-Backward-Compat, neue Links benutzen
  // direkt das Tab-Param.
  const settingsHref = `/settings?twin=${encodeURIComponent(twinHandle)}&tab=reife`;
  const tooltip =
    progress === null
      ? `Stufe ${data.currentLabel} (höchste Stufe). Detail in Settings.`
      : `${progress.percent}% bis ${progress.targetLabel}. Detail in Settings.`;

  return (
    <Link
      href={settingsHref}
      title={tooltip}
      aria-label={tooltip}
      className="text-[10px] uppercase tracking-wider text-muted hover:text-accent border border-border rounded px-2 py-0.5 font-mono inline-flex items-center gap-1.5 transition-colors"
    >
      <span>{data.currentLabel}</span>
      {progress !== null && (
        <span aria-hidden="true" className="text-muted/70">
          · {progress.percent}%
        </span>
      )}
    </Link>
  );
}
