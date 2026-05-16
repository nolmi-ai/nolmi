import type { ReactNode } from "react";

// ─── PageContainer (UX.1.A.2.C.1) ───────────────────────────────────────────
//
// Einheitlicher Content-Wrapper für die Standard-Pages (Inbox, Facts, Settings,
// Stream). Zentralisiert die Breite (`max-w-6xl` = 1152 px) und das äußere
// Padding (`px-6 py-8`), damit alle Pages visuell gleich breit erscheinen.
//
// Begründung der Breite: drei der vier Pages nutzten vorher `max-w-[1200px]`
// (Custom-Wert), Facts hatte `max-w-3xl` (768 px, vermutlich Lesbarkeits-
// Sonderfall). `max-w-6xl` (1152 px) ist Tailwind-idiomatisch, liegt nahe
// am bisherigen 1200-px-Standard und gibt der Facts-Page deutlich mehr Platz
// für die Fact-Liste.
//
// Bewusst NICHT im Container:
//  - `space-y-*` — Content-spezifisch (Stream nutzt 6, andere 8). Page setzt
//    das selbst über `className`-Override oder als innere Wrapper-Klasse.
//  - Chat-Page nutzt KEIN PageContainer (zwei-spaltiges Layout mit eigener
//    Breitenlogik, Konversations-Sidebar + Chat-Content).
//  - Onboarding/Login haben eigene schmale Form-Breiten (`max-w-sm`/`max-w-xl`)
//    und bleiben unangetastet — keine Standard-Pages.
//
// `className`-Override ist Pflicht-Feature: Pages mit abweichendem Spacing-
// Bedarf (z.B. Stream mit `space-y-6`) hängen ihn drüber, statt das in
// jeder Page-Page-Page-Wrap-Schicht zu duplizieren.

interface PageContainerProps {
  children: ReactNode;
  className?: string;
}

export function PageContainer({ children, className }: PageContainerProps) {
  return (
    <div
      className={`mx-auto w-full max-w-6xl px-6 py-8${
        className ? ` ${className}` : ""
      }`}
    >
      {children}
    </div>
  );
}
