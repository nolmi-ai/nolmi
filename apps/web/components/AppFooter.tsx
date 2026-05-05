"use client";

import { usePathname } from "next/navigation";
import { FooterMeta } from "./FooterMeta";

const DEPLOYMENT_LABEL =
  process.env.NEXT_PUBLIC_DEPLOYMENT_LABEL ?? "läuft lokal";

// ─── APP FOOTER ──────────────────────────────────────────────────────────────
//
// Versteckt sich auf /chat-Routes — ChatLayout nutzt `h-[calc(100vh-65px)]`,
// was den Bereich UNTER dem Header voll ausreizt. Würde der Footer hier
// sichtbar bleiben, müsste die Page um die Footer-Höhe nach unten scrollen
// (oder ChatLayout müsste auch noch die Footer-Höhe abziehen — fragiler).
//
// Auf allen anderen Routes: normaler Footer mit FooterMeta.

export function AppFooter() {
  const pathname = usePathname();
  const isChat =
    pathname === "/chat" || pathname.startsWith("/chat/");
  if (isChat) return null;

  return (
    <footer className="border-t border-border px-6 py-3 text-xs text-muted">
      <FooterMeta /> · {DEPLOYMENT_LABEL}
    </footer>
  );
}
