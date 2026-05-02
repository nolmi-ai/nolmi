"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

const RUNTIME_URL = process.env.NEXT_PUBLIC_RUNTIME_URL ?? "http://localhost:4000";

// Index-Route /chat: redirected zur Chat-Page des ersten aktiven Twins.
// Client-seitig, weil wir die Twin-Liste vom Runtime brauchen — der ist
// nur lokal erreichbar (NEXT_PUBLIC_RUNTIME_URL).

export default function ChatIndexPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`${RUNTIME_URL}/twins`, { credentials: "include" })
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json() as Promise<{ twins: Array<{ handle: string }> }>;
      })
      .then((data) => {
        if (cancelled) return;
        const first = data.twins[0]?.handle;
        if (first) {
          router.replace(`/chat/${first}`);
        } else {
          setError("Keine aktiven Twins gefunden.");
        }
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed");
      });
    return () => {
      cancelled = true;
    };
  }, [router]);

  if (error) {
    return <div className="text-sm text-warn">Konnte Twin-Liste nicht laden: {error}</div>;
  }
  return <div className="text-sm text-muted">Lade aktiven Twin…</div>;
}
