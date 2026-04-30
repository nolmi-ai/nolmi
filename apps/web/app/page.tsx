import Link from "next/link";

export default function HomePage() {
  return (
    <div className="space-y-8">
      <section>
        <h1 className="text-3xl font-semibold text-text mb-3 tracking-tight">
          twin-lab
        </h1>
        <p className="text-muted leading-relaxed max-w-2xl">
          Lab-Setup für die Entwicklung eines persönlichen AI-Twins mit
          A2A-Kommunikation. Phase 1 — Closed Twin, rein privat.
        </p>
      </section>

      <section className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <NavCard
          href="/chat"
          title="Chat"
          desc="Mit dem Twin reden. Persona aktiv, Audit aktiv."
        />
        <NavCard
          href="/stream"
          title="Stream"
          desc="Live-Aktivität. Was tut der Twin gerade?"
        />
        <NavCard
          href="/settings"
          title="Settings"
          desc="Persona, Mandates, Switch-Stati."
        />
      </section>
    </div>
  );
}

function NavCard({ href, title, desc }: { href: string; title: string; desc: string }) {
  return (
    <Link
      href={href}
      className="block bg-surface border border-border rounded p-4 hover:border-accent transition-colors"
    >
      <div className="text-text font-semibold mb-1">{title}</div>
      <div className="text-xs text-muted leading-relaxed">{desc}</div>
    </Link>
  );
}
