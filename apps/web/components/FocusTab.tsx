"use client";

import { useCallback, useEffect, useState } from "react";
import { ModalWrapper } from "./ModalWrapper";
import { toast } from "../lib/toast";

const RUNTIME_URL = process.env.NEXT_PUBLIC_RUNTIME_URL ?? "http://localhost:4000";

// ─── FOCUS-TAB (Aufmerksamkeit/Fokus Stufe 1 — Schritt 3, Leitplanke) ────────
//
// Sichtbarkeit + Reset des autonom gepflegten Fokus. Pflicht-Leitplanke für
// das autonom-ohne-Approval-Pattern: Owner SIEHT, was der Twin als seinen Fokus
// gespeichert hat, und kann ihn ZURÜCKSETZEN (non-destruktiv, supersede).
//
//   GET  /twins/:handle/focus        — aktueller Fokus oder null
//   POST /twins/:handle/focus/reset  — supersedet den aktiven Snapshot
//
// KEIN manueller „Neu ableiten"-Knopf in Schritt 3 (Reset-allein, bewusst);
// das automatische Ableiten kommt über den Loop in Schritt 4.

interface FocusData {
  focusText: string;
  themes: string[];
  basisSummary: string | null;
  derivedAt: string;
}

export function FocusTab({ twinHandle }: { twinHandle: string }) {
  const [focus, setFocus] = useState<FocusData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [resetting, setResetting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `${RUNTIME_URL}/twins/${encodeURIComponent(twinHandle)}/focus`,
        { credentials: "include" },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { focus: FocusData | null };
      setFocus(data.focus);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Fokus konnte nicht geladen werden");
    } finally {
      setLoading(false);
    }
  }, [twinHandle]);

  useEffect(() => {
    void load();
  }, [load]);

  async function confirmReset() {
    setResetting(true);
    try {
      const res = await fetch(
        `${RUNTIME_URL}/twins/${encodeURIComponent(twinHandle)}/focus/reset`,
        { method: "POST", credentials: "include" },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      toast.success("Fokus zurückgesetzt");
      setConfirmOpen(false);
      await load(); // → Empty-State (getCurrent ist jetzt null)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Zurücksetzen fehlgeschlagen");
    } finally {
      setResetting(false);
    }
  }

  return (
    <section className="bg-surface border border-border rounded p-5 space-y-4">
      <div>
        <h2 className="text-sm font-semibold text-text tracking-tight">Aktueller Fokus</h2>
        <p className="text-xs text-muted mt-1 leading-relaxed">
          Dein Twin leitet aus euren jüngsten Gesprächen ab, woran du gerade
          arbeitest, und nutzt das im Chat als Kontext. Du kannst den Fokus
          jederzeit hier einsehen und zurücksetzen.
        </p>
      </div>

      {loading ? (
        <div className="text-sm text-muted">Lade Fokus…</div>
      ) : error ? (
        <div className="space-y-2">
          <div className="text-sm text-warn">{error}</div>
          <button onClick={() => void load()} className="text-xs text-accent hover:underline">
            Erneut versuchen
          </button>
        </div>
      ) : focus ? (
        <div className="space-y-4">
          <div className="border border-border rounded p-4 bg-bg space-y-3">
            <p className="text-sm text-text whitespace-pre-wrap leading-relaxed">
              {focus.focusText}
            </p>
            {focus.themes.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {focus.themes.map((t) => (
                  <span
                    key={t}
                    className="text-xs text-accent border border-accent rounded-full px-2 py-0.5"
                  >
                    {t}
                  </span>
                ))}
              </div>
            )}
            <div className="text-xs text-muted">
              abgeleitet am {new Date(focus.derivedAt).toLocaleString("de-DE")}
              {focus.basisSummary ? ` · ${focus.basisSummary}` : ""}
            </div>
          </div>

          <button
            onClick={() => setConfirmOpen(true)}
            className="px-3 py-1.5 text-xs border border-warn text-warn rounded hover:bg-warn hover:text-bg transition-colors"
          >
            Fokus zurücksetzen
          </button>
        </div>
      ) : (
        <div className="text-sm text-muted border border-border rounded p-4">
          Aktuell kein gespeicherter Fokus. Der Twin leitet ihn aus jüngsten
          Gesprächen ab.
        </div>
      )}

      {confirmOpen && (
        <ModalWrapper onClose={() => (resetting ? undefined : setConfirmOpen(false))}>
          <div className="p-5 space-y-4">
            <h3 className="text-sm font-semibold text-text">Fokus zurücksetzen?</h3>
            <p className="text-sm text-muted leading-relaxed">
              Den aktuellen Fokus zurücksetzen? Der Twin nutzt ihn dann nicht mehr
              im Chat, bis ein neuer abgeleitet wird.
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setConfirmOpen(false)}
                disabled={resetting}
                className="px-3 py-1.5 text-xs border border-border text-muted rounded hover:bg-bg disabled:opacity-30 transition-colors"
              >
                Abbrechen
              </button>
              <button
                onClick={() => void confirmReset()}
                disabled={resetting}
                className="px-3 py-1.5 text-xs border border-warn text-warn rounded hover:bg-warn hover:text-bg disabled:opacity-30 transition-colors"
              >
                {resetting ? "…" : "Zurücksetzen"}
              </button>
            </div>
          </div>
        </ModalWrapper>
      )}
    </section>
  );
}
