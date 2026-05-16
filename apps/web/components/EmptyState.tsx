import type { ReactNode } from "react";

// ─── EmptyState (UX.1.A.3) ──────────────────────────────────────────────────
//
// Wiederverwendbarer Empty-State-Container für Pages/Sections ohne Inhalt.
// Anstelle eines lakonischen „kein Inhalt"-Strings (z.B. Inbox-Pending) zeigt
// EmptyState den Title + erklärende Description zentriert mit der visuellen
// Sprache der Modal-Cards: gleiche Schrift-Hierarchie (text-text semibold
// für Title, text-muted text-sm für Description), Twin-Lab-Padding-Disziplin
// (py-12), Mono-Font via Inheritance.
//
// Slots:
//  - `icon`: optionales kleines Visual oben (z.B. ein einzelnes Mono-Glyph
//    oder SVG, atomar). Heute leer; Door für künftige Verfeinerungen offen.
//  - `title`: kurze Überschrift, Pflicht.
//  - `description`: ReactNode (nicht nur String) — erlaubt Inline-Code-Tags
//    oder Multi-Line-JSX.
//  - `action`: optionales CTA-Element (Button/Link).
//
// `className`-Override erlaubt Pages bei Bedarf abweichendes Spacing
// (z.B. Chat-Bereich braucht `min-h-[60vh]` für sinnvolle vertikale Mitte).

interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={`flex flex-col items-center justify-center text-center py-12 px-6 gap-3${
        className ? ` ${className}` : ""
      }`}
    >
      {icon ? <div className="text-muted">{icon}</div> : null}
      <h3 className="text-text font-semibold">{title}</h3>
      {description ? (
        <div className="text-muted max-w-md text-sm leading-relaxed">
          {description}
        </div>
      ) : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}
