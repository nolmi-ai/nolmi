"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

const RUNTIME_URL = process.env.NEXT_PUBLIC_RUNTIME_URL ?? "http://localhost:4000";

// Index-Route /chat: redirected zur Chat-Page des ersten owned Twins. Wenn
// der User noch keinen Twin hat, geht's stattdessen zum Onboarding-Wizard
// (#110 Phase 2B Commit 10 Hard-Trigger). Client-seitig, weil wir die
// Twin-Liste vom Runtime brauchen — der ist nur lokal erreichbar
// (NEXT_PUBLIC_RUNTIME_URL).
//
// Der /twins-Endpoint ist server-seitig schon owner-gefiltert
// (server.ts:216-229) — `data.twins.length === 0` heißt zuverlässig
// „User hat keinen eigenen Twin", nicht „keine Twins im System".

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
          // #110 Phase 2B Hard-Trigger: kein owned Twin → ab zum Wizard.
          // `router.replace` statt `push`, damit Browser-Back nicht in eine
          // /chat-↔-/onboarding-Schleife läuft.
          router.replace("/onboarding");
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
    return (
      <div className="px-6 py-8 text-sm text-warn">
        Konnte Twin-Liste nicht laden: {error}
      </div>
    );
  }
  return <div className="px-6 py-8 text-sm text-muted">Lade aktiven Twin…</div>;
}
