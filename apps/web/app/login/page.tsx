"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";

const RUNTIME_URL = process.env.NEXT_PUBLIC_RUNTIME_URL ?? "http://localhost:4000";

// ─── LOGIN PAGE ──────────────────────────────────────────────────────────────
//
// Schmales Email/Passwort-Form. POST /auth/login → bei Erfolg redirect
// auf den `?next=`-Param aus der Middleware (oder / als Default).
//
// Suspense-Wrapper für useSearchParams ist Pflicht in Next 15.

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="text-sm text-muted">Lade…</div>}>
      <LoginInner />
    </Suspense>
  );
}

function LoginInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = searchParams.get("next") || "/";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${RUNTIME_URL}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email, password }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      // Hard-Reload statt router.replace — TwinSwitcher/FooterMeta cachen
      // den /auth/me-Status im React-State und reagieren nicht auf
      // Client-Navigation. Full-Page-Mount initialisiert mit aktuellem
      // Cookie-State neu.
      window.location.href = next;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login fehlgeschlagen");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="max-w-sm mx-auto space-y-6 mt-12">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold text-text">twin-lab</h1>
        <div className="text-xs text-muted">Login</div>
      </header>

      <form onSubmit={submit} className="space-y-4">
        <div>
          <label className="block text-xs uppercase tracking-wider text-muted mb-1">
            Email
          </label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            required
            className="w-full bg-bg border border-border rounded px-3 py-2 text-sm text-text focus:outline-none focus:border-accent"
          />
        </div>

        <div>
          <label className="block text-xs uppercase tracking-wider text-muted mb-1">
            Passwort
          </label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            required
            className="w-full bg-bg border border-border rounded px-3 py-2 text-sm text-text font-mono focus:outline-none focus:border-accent"
          />
        </div>

        {error && (
          <div className="text-xs text-warn border border-warn rounded px-3 py-2">
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={busy}
          className="w-full px-4 py-2 border border-accent text-accent text-sm rounded disabled:opacity-30 disabled:cursor-not-allowed hover:bg-accent hover:text-bg transition-colors"
        >
          {busy ? "Login…" : "Login"}
        </button>
      </form>

      <div className="text-xs text-muted text-center">
        Noch kein Account?{" "}
        <Link href="/onboarding" className="text-accent hover:underline">
          Onboarding starten
        </Link>
      </div>
    </div>
  );
}
