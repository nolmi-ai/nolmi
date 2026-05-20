"use client";

import type { ToolCallState } from "../lib/use-tool-call-stream";
import { resolveToolDisplay } from "../lib/tool-display";

// ─── ResearchLiveProgress (#107) ─────────────────────────────────────────────
//
// Inline-Render während aktiver Recherche-Cycles. Hyperbrowser-Tool-Calls
// werden per Prefix-Match isoliert; andere Tools (z.B. zukünftiger Calendar-
// MCP) blieben unsichtbar — der Hook gibt zwar alle Tool-Calls weiter, hier
// schneiden wir auf das Recherche-Feature zu.
//
// Visual-Stil orientiert sich an MemoryHitBadge (#100) und ResetMarker (#106):
// subtile Border, kompakter Mono-Block für Domains, kein full-width-Background.
// Pulse-Animation auf 'running' kommt aus Tailwind's `animate-pulse`.

const HYPERBROWSER_PREFIX = "mcp:hyperbrowser-approval:";

interface ResearchLiveProgressProps {
  toolCalls: ToolCallState[];
}

export function ResearchLiveProgress({ toolCalls }: ResearchLiveProgressProps) {
  const researchCalls = toolCalls.filter((tc) =>
    tc.toolName.startsWith(HYPERBROWSER_PREFIX),
  );

  if (researchCalls.length === 0) return null;

  return (
    <div className="border border-border rounded px-3 py-2 bg-surface/60 text-xs space-y-1.5">
      <div className="text-accent font-mono tracking-wide">
        🔍 Twin recherchiert…
      </div>
      <ul className="space-y-1">
        {researchCalls.map((call) => (
          <ResearchToolCallRow key={call.callId} call={call} />
        ))}
      </ul>
    </div>
  );
}

function ResearchToolCallRow({ call }: { call: ToolCallState }) {
  const tool = call.toolName;
  const isScrape = tool.endsWith(":scrape_webpage");
  const isSearch = tool.endsWith(":search_with_bing");

  let domain: string | null = null;
  if (isScrape && typeof call.args.url === "string") {
    try {
      domain = new URL(call.args.url).hostname.replace(/^www\./, "");
    } catch {
      // Ungültige URL — wir zeigen nur "Lese Seite" als Fallback.
    }
  }
  let query: string | null = null;
  if (isSearch && typeof call.args.query === "string") {
    query = call.args.query;
  }

  // Label-Mapping: für die häufigen Recherche-Tools direkt verständlich
  // formuliert (Domain bzw. Query inline). Sonst Fallback auf #95-Resolver.
  let label: string;
  let detail: string | null = null;
  if (isScrape) {
    label = "Lese";
    detail = domain ?? "Seite";
  } else if (isSearch) {
    label = "Web-Suche";
    detail = query;
  } else {
    label = resolveToolDisplay(tool, call.args).label;
    detail = null;
  }

  const icon =
    call.status === "running"
      ? "○"
      : call.status === "executed"
        ? "✓"
        : call.status === "failed"
          ? "✗"
          : "•";

  if (call.status === "failed") {
    return (
      <li className="flex items-baseline gap-2 text-warn">
        <span aria-hidden className="font-mono">
          {icon}
        </span>
        <span>{label}</span>
        {detail && (
          <span className="font-mono text-muted truncate">{detail}</span>
        )}
        <span className="text-muted">
          — Recherche fehlgeschlagen, Twin antwortet aus Memory
        </span>
      </li>
    );
  }

  return (
    <li className="flex items-baseline gap-2">
      <span
        aria-hidden
        className={
          "font-mono " +
          (call.status === "running"
            ? "text-accent animate-pulse"
            : "text-accent")
        }
      >
        {icon}
      </span>
      <span className="text-text">{label}</span>
      {detail && (
        <span className="font-mono text-muted truncate">{detail}</span>
      )}
    </li>
  );
}
