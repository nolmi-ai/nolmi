"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Suspense } from "react";
import { TwinSwitcher } from "./TwinSwitcher";
import { TopNav } from "./TopNav";
import { ProfileMenu } from "./ProfileMenu";

// ─── APP HEADER ──────────────────────────────────────────────────────────────
//
// Wrapper für den Top-Bereich: Brand, Nav-Tabs, Twin-Switcher, Profil-Menu.
//
// Bewusst Client-Komponente, weil wir per usePathname() entscheiden, ob der
// Header überhaupt sichtbar sein soll. Auf /login und /onboarding ist der
// User nicht (oder noch nicht) authentifiziert — Switcher und Tabs würden
// nur 401-Errors triggern und Tabs zu Auth-Redirects führen.

const PUBLIC_PREFIXES = ["/login", "/onboarding"];

export function AppHeader() {
  const pathname = usePathname();
  const isPublic = PUBLIC_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );
  if (isPublic) return null;

  return (
    <header className="border-b border-border px-6 py-4 flex items-center justify-between gap-4">
      {/* Linke Gruppe: Brand + Tabs direkt nebeneinander, kleiner Abstand
       * dazwischen. Vorher waren die Tabs zentriert — bei breitem Viewport
       * weit weg vom Brand und visuell entkoppelt. */}
      <div className="flex items-center gap-8">
        <Link href="/" className="text-text font-semibold tracking-tight">
          twin-lab
        </Link>
        <Suspense fallback={<span className="text-xs text-muted">nav…</span>}>
          <TopNav />
        </Suspense>
      </div>
      {/* Rechte Gruppe: Twin-Auswahl + Account. */}
      <div className="flex items-center gap-3">
        <Suspense fallback={<span className="text-xs text-muted">…</span>}>
          <TwinSwitcher />
        </Suspense>
        <ProfileMenu />
      </div>
    </header>
  );
}
