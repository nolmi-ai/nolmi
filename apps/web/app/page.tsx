"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

// ─── HOME ────────────────────────────────────────────────────────────────────
//
// Reiner Redirector. Middleware hat schon entschieden, dass der User
// eingeloggt ist (sonst wären wir nie hier — Middleware schickt nicht-
// eingeloggte zu /login). Wir routen weiter zu /chat, das wiederum auf
// /chat/<first-active-twin> redirected (oder /onboarding wenn 0 Twins).

export default function HomePage() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/chat");
  }, [router]);
  return <div className="text-sm text-muted">Lade…</div>;
}
