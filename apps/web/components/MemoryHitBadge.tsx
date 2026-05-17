"use client";

import { useState } from "react";
import type { MemoryHit, MemoryHitTargetType } from "@twin-lab/shared";

// ─── MemoryHitBadge (#100 / UX.1.A) ──────────────────────────────────────────
//
// Mono-Badge unter der Twin-Antwort: „💭 N Erinnerungen", klickbar. Im
// Expanded-State klappt eine Mini-Card mit den Snippets auf, gruppiert nach
// targetType. Diese Komponente ist Pattern-Foundation für #101 Twin-Reife-
// Anzeige — bewusst NICHT generisch („VisionBadge"), das wird beim #101-Bau
// extrahiert, wenn das gemeinsame Pattern klar ist.
//
// Datenquelle: `audit.output.memoryHits`, durchgereicht via TwinService.
// Service projiziert die internen `RetrievalResult`-Felder auf die Slim-
// Variante (`targetType`, `content`, `createdAt`) — Score-Felder bleiben
// backend-intern.
//
// Twin-Lab-Disziplin: keine Animation, Click = instant toggle.

const TARGET_TYPE_LABELS: Record<MemoryHitTargetType, string> = {
  // Identisch zu `episodic/prompt-builder.ts → labelForTarget`. Wenn das
  // Backend dort eines Tages ändert, hier nachziehen — bewusst dupliziert
  // statt aus dem Runtime-Package zu importieren (Web-Bundle bleibt klein).
  conversation: "Vergangenes Gespräch",
  summary_segment: "Auszug aus einem längeren Gespräch",
  diary_entry: "Eigene Notiz",
};

const MAX_SNIPPET_LENGTH = 150;

interface MemoryHitBadgeProps {
  hits: MemoryHit[];
}

export function MemoryHitBadge({ hits }: MemoryHitBadgeProps) {
  const [expanded, setExpanded] = useState(false);
  if (hits.length === 0) return null;

  const grouped = groupByTargetType(hits);
  const total = hits.length;
  const label = total === 1 ? "1 Erinnerung" : `${total} Erinnerungen`;

  return (
    <div className="text-xs space-y-2">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        aria-controls="memory-hit-snippets"
        className="text-muted hover:text-accent font-mono inline-flex items-center gap-1 transition-colors"
      >
        <span aria-hidden="true">💭</span>
        <span>{label}</span>
        <span aria-hidden="true" className="text-muted">
          {expanded ? "▾" : "▸"}
        </span>
      </button>
      {expanded && (
        <div
          id="memory-hit-snippets"
          className="bg-surface border border-border rounded p-3 space-y-3 font-mono"
        >
          {(Object.keys(TARGET_TYPE_LABELS) as MemoryHitTargetType[]).map(
            (type) => {
              const items = grouped[type];
              if (!items || items.length === 0) return null;
              return (
                <div key={type} className="space-y-2">
                  <div className="text-[10px] uppercase tracking-wider text-muted">
                    {TARGET_TYPE_LABELS[type]}
                    {items.length > 1 ? ` (${items.length})` : ""}
                  </div>
                  <ul className="space-y-1.5">
                    {items.map((hit, i) => (
                      <li key={i} className="text-muted leading-relaxed">
                        <span className="text-text">
                          {formatDate(hit.createdAt)}:
                        </span>{" "}
                        <span>{truncate(hit.content, MAX_SNIPPET_LENGTH)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              );
            },
          )}
        </div>
      )}
    </div>
  );
}

// ─── helpers ────────────────────────────────────────────────────────────────

function groupByTargetType(
  hits: MemoryHit[],
): Partial<Record<MemoryHitTargetType, MemoryHit[]>> {
  const out: Partial<Record<MemoryHitTargetType, MemoryHit[]>> = {};
  for (const h of hits) {
    (out[h.targetType] ??= []).push(h);
  }
  return out;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function truncate(s: string, max: number): string {
  const trimmed = s.trim().replace(/\s+/g, " ");
  if (trimmed.length <= max) return trimmed;
  return trimmed.slice(0, Math.max(0, max - 1)) + "…";
}
