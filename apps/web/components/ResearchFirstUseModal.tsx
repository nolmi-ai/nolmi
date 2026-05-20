"use client";

import { ModalWrapper } from "./ModalWrapper";

// ─── ResearchFirstUseModal (#107) ────────────────────────────────────────────
//
// Einmaliger Beta-Hint nach der ersten Recherche pro Twin. Trigger kommt aus
// dem Send-Response-Body (`firstUseHint: 'research'`); das Backend setzt das
// Feld nur, wenn der research_first_use_seen-Flag vorher 0 war und gleich
// danach auf 1 flippt — repetitive Anzeigen sind dadurch ausgeschlossen.
//
// Bewusst kein LocalStorage-Suppression (verworfen): das Modal soll
// twin-bezogen sein, nicht browser-bezogen. Wer einen frischen Twin anlegt,
// soll den Hint einmal sehen, auch wenn er auf einem Browser ist, der schon
// für einen anderen Twin den Hint quittiert hat.

interface ResearchFirstUseModalProps {
  onDismiss: () => void;
}

export function ResearchFirstUseModal({
  onDismiss,
}: ResearchFirstUseModalProps) {
  return (
    <ModalWrapper onClose={onDismiss}>
      <div className="p-5 space-y-4">
        <h3 className="text-sm font-mono tracking-wide text-text">
          Recherche-Capability (Beta)
        </h3>
        <p className="text-sm text-text leading-relaxed">
          Dein Twin kann jetzt im Web recherchieren. Diese Capability ist
          Beta:
        </p>
        <ul className="text-xs text-muted space-y-1 list-disc pl-5">
          <li>Latenz 30–90s pro Recherche</li>
          <li>Single-Step-Suche (kein Multi-Page-Crawling)</li>
          <li>Gelegentliche Quellen-Schwäche möglich</li>
        </ul>
        <div className="flex justify-end pt-2">
          <button
            onClick={onDismiss}
            className="px-4 py-2 border border-accent text-accent text-sm rounded hover:bg-accent hover:text-bg transition-colors"
          >
            Verstanden
          </button>
        </div>
      </div>
    </ModalWrapper>
  );
}
