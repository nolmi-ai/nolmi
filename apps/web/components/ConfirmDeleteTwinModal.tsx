"use client";

import { useState } from "react";
import { ModalWrapper } from "./ModalWrapper";

const RUNTIME_URL = process.env.NEXT_PUBLIC_RUNTIME_URL ?? "http://localhost:4000";

// ─── ConfirmDeleteTwinModal (#744 Schritt 3) ─────────────────────────────────
//
// Type-to-confirm-Dialog für das irreversible Twin-Löschen. Baut auf dem
// generischen ModalWrapper auf (kein neues Modal-Gerüst). Die Reibung: der
// User muss den Handle exakt tippen, sonst bleibt der Löschen-Button disabled.
//
// Ruft DELETE /twins/:handle (Schritt 2, owner-gegatet) mit derselben Fetch-
// Konvention wie die übrigen mutierenden Calls in settings/page.tsx
// (credentials: "include"). Erfolg liefert { deleted, handle, bridgeOrphan }.
//
// bridgeOrphan === true ist KEIN Fehler: der lokale Twin ist weg, nur der
// Handle blieb auf der Bridge registriert (Bridge war beim Deregister nicht
// erreichbar). Wir zeigen das als sichtbaren Hinweis, bevor wir navigieren —
// nicht als Fehler.

type Status =
  | { kind: "idle" }
  | { kind: "deleting" }
  | { kind: "error"; message: string }
  | { kind: "orphan" }; // Erfolg, aber Handle bleibt auf der Bridge

export function ConfirmDeleteTwinModal({
  handle,
  onClose,
  onDeleted,
}: {
  handle: string;
  /** Schließt das Modal ohne Löschen (Abbruch). Während `deleting` geguardet. */
  onClose: () => void;
  /** Nach erfolgreichem Löschen — Parent navigiert + refresht die Twin-Liste. */
  onDeleted: () => void;
}) {
  const [typed, setTyped] = useState("");
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  const isDeleting = status.kind === "deleting";
  const confirmMatches = typed.trim() === handle;

  // ESC/Backdrop nur erlauben, wenn gerade kein Delete läuft.
  const guardedClose = () => {
    if (!isDeleting) onClose();
  };

  async function handleDelete() {
    if (!confirmMatches || isDeleting) return;
    setStatus({ kind: "deleting" });
    try {
      const res = await fetch(`${RUNTIME_URL}/twins/${handle}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setStatus({
          kind: "error",
          message: body.error ?? `HTTP ${res.status} — Löschen fehlgeschlagen`,
        });
        return;
      }
      const body = (await res.json()) as {
        deleted: boolean;
        handle: string;
        bridgeOrphan: boolean;
      };
      if (body.bridgeOrphan) {
        // Erfolg mit Hinweis — sichtbar machen, dann erst navigieren.
        setStatus({ kind: "orphan" });
        return;
      }
      onDeleted();
    } catch (err) {
      setStatus({
        kind: "error",
        message: err instanceof Error ? err.message : "Netzwerk-Fehler beim Löschen",
      });
    }
  }

  // Erfolg-mit-Bridge-Waise: eigener Panel-State, „Weiter" navigiert.
  if (status.kind === "orphan") {
    return (
      <ModalWrapper onClose={onDeleted}>
        <div className="p-5 space-y-4">
          <h2 className="text-sm font-semibold text-text">Twin gelöscht</h2>
          <div className="text-sm text-warning border border-warning rounded px-3 py-2 leading-relaxed">
            <span aria-hidden="true">⚠ </span>
            Twin lokal gelöscht. Der Handle{" "}
            <span className="font-mono">{handle}</span> bleibt auf der Bridge
            registriert (Cleanup nötig) — die Bridge war beim Löschen nicht
            erreichbar.
          </div>
          <div className="flex justify-end">
            <button
              type="button"
              onClick={onDeleted}
              className="px-4 py-2 text-sm border border-accent text-accent rounded hover:bg-accent hover:text-bg transition-colors"
            >
              Weiter
            </button>
          </div>
        </div>
      </ModalWrapper>
    );
  }

  return (
    <ModalWrapper onClose={guardedClose}>
      <div className="p-5 space-y-4">
        <h2 className="text-sm font-semibold text-warn">Twin löschen</h2>

        <div className="text-sm text-text leading-relaxed space-y-2">
          <p>
            Das löscht <span className="font-mono">{handle}</span>{" "}
            <strong>unwiderruflich</strong> mit allen Daten: Konversationen,
            Facts, Memory, Skills, MCP-Server, Telegram- und OAuth-Verknüpfungen.
            Der Twin wird zudem von der Bridge deregistriert.
          </p>
          <p className="text-muted">Das kann nicht rückgängig gemacht werden.</p>
        </div>

        <div>
          <label className="block text-xs text-muted mb-1">
            Zur Bestätigung den Handle{" "}
            <span className="font-mono text-text">{handle}</span> eintippen:
          </label>
          <input
            type="text"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            disabled={isDeleting}
            autoFocus
            placeholder={handle}
            spellCheck={false}
            autoComplete="off"
            className="w-full px-3 py-2 bg-bg border border-border rounded text-sm font-mono text-text focus:outline-none focus:border-warn disabled:opacity-50"
          />
        </div>

        {status.kind === "error" && (
          <div className="text-xs text-warn border border-warn rounded px-3 py-2">
            {status.message}
          </div>
        )}

        <div className="flex items-center justify-end gap-3 pt-1">
          <button
            type="button"
            onClick={guardedClose}
            disabled={isDeleting}
            className="px-3 py-2 text-sm text-muted hover:text-text transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          >
            Abbrechen
          </button>
          <button
            type="button"
            onClick={() => void handleDelete()}
            disabled={!confirmMatches || isDeleting}
            className="px-4 py-2 text-sm border border-warn bg-warn text-bg rounded hover:opacity-80 disabled:opacity-30 disabled:cursor-not-allowed transition-opacity font-mono"
          >
            {isDeleting ? "Lösche…" : "Endgültig löschen"}
          </button>
        </div>
      </div>
    </ModalWrapper>
  );
}
