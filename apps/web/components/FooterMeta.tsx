"use client";

import { useEffect, useState } from "react";

const RUNTIME_URL = process.env.NEXT_PUBLIC_RUNTIME_URL ?? "http://localhost:4000";

// Kleine Client-Komponente für den Footer: zeigt die aktuelle Twin-Anzahl
// aus /twins. Bei Fehler oder noch-nicht-geladen: Fallback "multi-twin",
// damit der Footer nie leer aussieht oder springt.

export function FooterMeta() {
  const [count, setCount] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`${RUNTIME_URL}/twins`, { credentials: "include" })
      .then((res) => (res.ok ? res.json() : Promise.reject(res.status)))
      .then((data: { twins: unknown[] }) => {
        if (!cancelled) setCount(data.twins.length);
      })
      .catch(() => {
        // Fallback bleibt "multi-twin" via count===null
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (count === null) return <>multi-twin</>;
  if (count === 1) return <>1 Twin aktiv</>;
  return <>{count} Twins aktiv</>;
}
