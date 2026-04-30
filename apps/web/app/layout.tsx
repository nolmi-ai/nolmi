import "./globals.css";
import Link from "next/link";
import type { ReactNode } from "react";

export const metadata = {
  title: "twin-lab",
  description: "Persönlicher AI-Twin — Phase 1 Lab",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="de">
      <body className="min-h-screen flex flex-col">
        <header className="border-b border-border px-6 py-4 flex items-center justify-between">
          <Link href="/" className="text-text font-semibold tracking-tight">
            twin-lab
          </Link>
          <nav className="flex gap-6 text-sm text-muted">
            <Link href="/chat" className="hover:text-text transition-colors">
              chat
            </Link>
            <Link href="/stream" className="hover:text-text transition-colors">
              stream
            </Link>
            <Link href="/settings" className="hover:text-text transition-colors">
              settings
            </Link>
          </nav>
        </header>
        <main className="flex-1 px-6 py-8 max-w-4xl mx-auto w-full">
          {children}
        </main>
        <footer className="border-t border-border px-6 py-3 text-xs text-muted">
          phase 1 · closed twin · läuft lokal
        </footer>
      </body>
    </html>
  );
}
