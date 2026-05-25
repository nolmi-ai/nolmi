"use client";

import { useState } from "react";
import { ModalWrapper } from "./ModalWrapper";
import { toast } from "../lib/toast";

// ─── OAuthActivationModal (#131 Phase 5.2) ───────────────────────────────────
//
// Zeigt den Phase-4-CLI-Befehl `pnpm twin:oauth-login @<handle>` mit Copy-
// Button. Kein Web-OAuth-Flow in Phase A — der CLI-Wrapper aus Phase 4 ist
// der Login-Pfad. Modal-Close triggert automatischen Refresh der Settings-
// Data, damit der neue Auth-Status sichtbar wird ohne manuellen Reload.

interface OAuthActivationModalProps {
  handle: string;
  /** Wird auch bei Modal-Close gefeuert (Setzung Phase 5.2 §v.8 #4). */
  onRefresh: () => Promise<void>;
  onClose: () => void;
}

export function OAuthActivationModal({
  handle,
  onRefresh,
  onClose,
}: OAuthActivationModalProps) {
  const cmd = `pnpm twin:oauth-login ${handle}`;
  const [refreshing, setRefreshing] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(cmd);
      toast.success("Befehl kopiert");
    } catch {
      toast.error("Kopieren fehlgeschlagen — Befehl manuell markieren");
    }
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await onRefresh();
      toast.success("Status aktualisiert");
    } catch {
      toast.error("Status-Refresh fehlgeschlagen");
    } finally {
      setRefreshing(false);
    }
  };

  const handleClose = async () => {
    try {
      await onRefresh();
    } catch {
      /* close darf an refresh-fail nicht hängenbleiben */
    }
    onClose();
  };

  return (
    <ModalWrapper onClose={handleClose} maxWidthClass="max-w-lg">
      <div className="p-6 space-y-4">
        <div>
          <h2 className="text-lg text-text">OAuth für {handle} aktivieren</h2>
          <p className="mt-1 text-sm text-muted">
            Phase A: OAuth-Login läuft über das CLI-Tool. Befehl unten kopieren,
            in einem Terminal ausführen und die ChatGPT-Approval-Seite im
            Browser durchklicken.
          </p>
        </div>

        <ol className="space-y-1.5 text-sm text-text list-decimal list-inside">
          <li>Terminal öffnen (Repository-Root)</li>
          <li>Befehl ausführen — Browser öffnet sich automatisch</li>
          <li>ChatGPT-OAuth-Approval durchklicken</li>
          <li>Hier zurück + „Status aktualisieren"</li>
        </ol>

        <div className="flex items-center gap-2">
          <code className="flex-1 bg-surface-2 border border-border rounded px-3 py-2 text-xs font-mono text-text overflow-x-auto whitespace-nowrap">
            {cmd}
          </code>
          <button
            type="button"
            onClick={handleCopy}
            className="px-3 py-2 text-xs border border-border rounded hover:bg-surface-2"
          >
            Kopieren
          </button>
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={handleRefresh}
            disabled={refreshing}
            className="px-3 py-2 text-sm border border-border rounded hover:bg-surface-2 disabled:opacity-50"
          >
            {refreshing ? "Lade…" : "Status aktualisieren"}
          </button>
          <button
            type="button"
            onClick={handleClose}
            className="px-3 py-2 text-sm bg-accent text-white rounded hover:opacity-90"
          >
            Schließen
          </button>
        </div>
      </div>
    </ModalWrapper>
  );
}
