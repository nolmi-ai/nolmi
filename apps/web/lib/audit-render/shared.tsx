"use client";

import type { AuditEntry, AuditStatus } from "@twin-lab/shared";

// ─── shared template helpers (#99) ───────────────────────────────────────────
//
// Mini-Layout-Bausteine, die alle vier Templates wiederverwenden. Bewusst
// klein gehalten — Anti-Goal "keine generische Audit-Komponenten-Library".

export interface AuditTemplateProps {
  audit: AuditEntry;
  /** Sub-Expand für lange Inhalte (voller Reply / Tool-Output / Memory-Hits). */
  expanded: boolean;
  onToggle: () => void;
}

/** Label + Value-Block, einheitlicher Vertical-Rhythm pro Template. */
export function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-muted mb-1">
        {label}
      </div>
      <div className="text-sm text-text">{children}</div>
    </div>
  );
}

/**
 * Mono-Container für längere Text-Blöcke (Tool-Output, voller Reply).
 * `max-h-96` plus `overflow-auto` deckelt riesige Scrape-Pages.
 */
export function MonoBlock({ children }: { children: React.ReactNode }) {
  return (
    <pre className="text-xs font-mono text-text bg-bg border border-border rounded p-3 whitespace-pre-wrap break-words max-h-96 overflow-auto leading-relaxed">
      {children}
    </pre>
  );
}

/** Plain-Text-Block (Twin-Antwort etc.), nicht-mono. */
export function TextBlock({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-sm text-text whitespace-pre-wrap break-words bg-bg border border-border rounded p-3 max-h-96 overflow-auto leading-relaxed">
      {children}
    </div>
  );
}

/** Inline-Status-Badge analog zur Audit-Log-Tabelle. */
export function StatusBadge({ status }: { status: AuditStatus }) {
  const colorClass =
    status === "executed"
      ? "text-accent border-accent/40"
      : status === "rejected" || status === "blocked" || status === "failed"
        ? "text-warn border-warn/40"
        : status === "pending" || status === "approved"
          ? "text-accent border-accent/40"
          : "text-muted border-border";
  return (
    <span
      className={`inline-block text-[10px] uppercase tracking-wider font-mono border rounded px-1.5 py-0.5 ${colorClass}`}
    >
      {status}
    </span>
  );
}

/** Expand-Toggle-Button (▸ / ▾), Mono-Pattern aus MemoryHitBadge. */
export function ExpandToggle({
  expanded,
  onToggle,
  label,
}: {
  expanded: boolean;
  onToggle: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={expanded}
      className="text-xs text-muted hover:text-accent font-mono inline-flex items-center gap-1 transition-colors"
    >
      <span aria-hidden="true">{expanded ? "▾" : "▸"}</span>
      <span>{label}</span>
    </button>
  );
}
