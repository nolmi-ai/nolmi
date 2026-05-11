"use client";

import { useEffect, type ReactNode } from "react";

// ─── ModalWrapper (Phase 3.3.G3) ─────────────────────────────────────────────
//
// Generischer Modal-Container: Backdrop + Center-Box, Schließen via Backdrop-
// Click und Escape-Key. Pattern zuerst inline in der Facts-Page eingeführt
// (3.3.G2), in G3 zu shared Component extrahiert, weil der Reset-Confirm-
// Dialog im Chat dasselbe Verhalten braucht.
//
// `onClose` wird sowohl beim Backdrop-Click als auch beim ESC-Key gerufen.
// Caller kann den Close blockieren, indem er die Funktion intern guardet
// (z.B. während eines laufenden Extract-Calls).

interface ModalWrapperProps {
  children: ReactNode;
  onClose: () => void;
}

export function ModalWrapper({ children, onClose }: ModalWrapperProps) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-surface border border-border rounded shadow-xl max-w-md w-full"
      >
        {children}
      </div>
    </div>
  );
}
