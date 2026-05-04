import "./globals.css";
import { Suspense, type ReactNode } from "react";
import { AppHeader } from "../components/AppHeader";
import { AppFooter } from "../components/AppFooter";

export const metadata = {
  title: "twin-lab",
  description: "Persönlicher AI-Twin — Phase 1 Lab",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="de">
      <body className="min-h-screen flex flex-col">
        {/* Suspense um Header/Footer: beide nutzen transitiv useSearchParams
         * (ProfileMenu) bzw. usePathname und triggern sonst Next-15.5-
         * Static-Prerender-Bailout. Fallback null = kein sichtbarer Flash,
         * da Header/Footer bereits client-only rendern. */}
        <Suspense fallback={null}>
          <AppHeader />
        </Suspense>
        {/* main hat bewusst keinen max-w / mx-auto / px mehr — jede Page
         * setzt ihren Container selbst (PageContainer für Standard-Pages,
         * Full-Viewport für Chat). flex-1 + min-h-0 reicht aus, damit
         * Children mit h-full den verfügbaren Platz nutzen können. */}
        <main className="flex-1 min-h-0 flex flex-col">{children}</main>
        <Suspense fallback={null}>
          <AppFooter />
        </Suspense>
      </body>
    </html>
  );
}
