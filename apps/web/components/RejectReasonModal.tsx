"use client";

import { useEffect, useRef, useState } from "react";
import { ModalWrapper } from "./ModalWrapper";
import { toast } from "../lib/toast";

// ─── RejectReasonModal (UX.1.A.1 / Item #91) ────────────────────────────────
//
// Ersetzt die `window.prompt()`-Stellen im Reject-Flow (Inbox, Chat, Facts).
// Generisch über ein optionales `subject`-Prop, damit derselbe Modal-Code
// für alle drei Reject-Kontexte funktioniert (Tool-Approval, Fact-Proposal,
// etc.).
//
// Reason ist optional (Briefing-Entscheidung: Reject ist auch ohne
// Begründung valide). Submit ruft `onConfirm(reason)` async — Modal hält
// den Loading-State und zeigt success-Toast „Aktion abgelehnt" nach
// erfolgreichem Resolve. Caller bekommt nur die Daten-Aktion (fetch zur
// Runtime), die UI-Bestätigung passiert hier zentral.
//
// A11y: role="dialog" + aria-modal + Focus-Trap (Textarea auto-focused),
// ESC-Close + Backdrop-Click kommen aus ModalWrapper.

export interface RejectReasonModalProps {
  open: boolean;
  /** Optionaler Kontext-Text. Z.B. Tool-Name oder Fact-Key. */
  subject?: string;
  onConfirm: (reason: string) => Promise<void>;
  onCancel: () => void;
}

export function RejectReasonModal({
  open,
  subject,
  onConfirm,
  onCancel,
}: RejectReasonModalProps) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Reset state on open — wenn dasselbe Modal nacheinander für mehrere
  // Rejects benutzt wird, soll der vorige Reason nicht stehen bleiben.
  useEffect(() => {
    if (open) {
      setReason("");
      setBusy(false);
      // Focus nach Mount + Reset, damit ESC/Tab erwartungsgemäß funktionieren.
      // Kleine Verzögerung, weil das Modal-Element erst nach diesem
      // Effect-Tick existiert.
      const t = setTimeout(() => textareaRef.current?.focus(), 0);
      return () => clearTimeout(t);
    }
  }, [open]);

  if (!open) return null;

  function handleCancel() {
    if (busy) return; // während Submit nicht abbrechen
    onCancel();
  }

  async function handleSubmit() {
    if (busy) return;
    setBusy(true);
    try {
      await onConfirm(reason);
      toast.success("Aktion abgelehnt");
      onCancel(); // close after success
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Reject fehlgeschlagen",
      );
      setBusy(false);
    }
  }

  return (
    <ModalWrapper onClose={handleCancel}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="reject-modal-title"
        className="p-6"
      >
        <h2
          id="reject-modal-title"
          className="text-lg font-semibold mb-2"
        >
          Aktion ablehnen?
        </h2>
        {subject ? (
          <p className="text-sm text-muted mb-4">
            Twin wollte: <span className="font-mono">{subject}</span>
          </p>
        ) : null}
        <label className="block mb-4">
          <span className="text-sm text-muted">
            Begründung (optional, hilft dem Twin zu lernen)
          </span>
          <textarea
            ref={textareaRef}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            onKeyDown={(e) => {
              // Cmd/Ctrl+Enter submitted — Power-User-Komfort.
              if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                e.preventDefault();
                void handleSubmit();
              }
            }}
            disabled={busy}
            rows={4}
            placeholder="Warum lehnst du das ab?"
            className="mt-1 w-full border border-border rounded p-2 bg-surface font-sans text-sm disabled:opacity-50"
          />
        </label>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={handleCancel}
            disabled={busy}
            className="px-3 py-1 rounded border border-border hover:bg-surface-hover disabled:opacity-50"
          >
            Abbrechen
          </button>
          <button
            type="button"
            onClick={() => void handleSubmit()}
            disabled={busy}
            className="px-3 py-1 rounded bg-red-600 text-white hover:bg-red-700 disabled:opacity-50"
          >
            {busy ? "Lehne ab…" : "Ablehnen"}
          </button>
        </div>
      </div>
    </ModalWrapper>
  );
}
