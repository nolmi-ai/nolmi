import "./globals.css";
import { Suspense, type ReactNode } from "react";
import { Toaster } from "sonner";
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
        {/* Toaster (UX.1.A.2.C.2): Sonner als reine Stack-/Auto-Dismiss-
         * Engine. `unstyled: true` schaltet Sonners eigenes Visual-Layer ab;
         * Markup-Klassen kommen via `classNames` von uns (siehe
         * `globals.css`, `.twin-toast*`-Block). Damit wirkt der Toast wie
         * eine Mini-Modal-Card, nicht wie eine schwebende Sonner-Notification.
         * Vorherige CSS-Var-Overrides aus UX.1.A.2.B/C.1 wurden in
         * `globals.css` entfernt — sie waren auf Sonners default-styled
         * Markup gebaut und sind im unstyled-Modus wirkungslos. */}
        <Toaster
          position="top-right"
          closeButton
          toastOptions={{
            unstyled: true,
            classNames: {
              toast: "twin-toast",
              title: "twin-toast-title",
              description: "twin-toast-description",
              closeButton: "twin-toast-close",
            },
          }}
        />
      </body>
    </html>
  );
}
