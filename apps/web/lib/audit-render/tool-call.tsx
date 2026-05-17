"use client";

import { estimateToolCost, formatEstimate } from "../tool-cost";
import { resolveToolDisplay } from "../tool-display";
import { formatRelative } from "../time-format";
import { extractReply } from "./utils";
import {
  ExpandToggle,
  Field,
  MonoBlock,
  StatusBadge,
  TextBlock,
  type AuditTemplateProps,
} from "./shared";
import type { AuditEntry } from "@twin-lab/shared";

// ─── ToolCallTemplate (#99) ──────────────────────────────────────────────────
//
// Für mcp-tool-use-Audits. Drei Lebenszyklen:
//   - pending  → toolCall im input, kein Result yet
//   - executed → toolCall + toolResult im output, optional reply
//   - rejected → reason im audit, kein Result
// Wir lesen aus output.toolCall + output.toolResult, mit Fallback auf
// input.toolCall (Pending-Phase).
//
// Tool-Result ist potenziell groß (z.B. 50KB Scrape-Page) — MonoBlock
// in der Expand-Stage hat max-h-96 + overflow.

const REPLY_PREVIEW_LENGTH = 250;

interface ToolCallView {
  toolName: string;
  args: Record<string, unknown> | undefined;
  result: string | null;
  isError: boolean;
}

function readToolCall(entry: AuditEntry): ToolCallView | null {
  const output = entry.output as {
    toolCall?: { mcpToolName?: string; args?: Record<string, unknown> };
    toolResult?: unknown;
    toolIsError?: boolean;
  } | null;
  const input = entry.input as {
    toolCall?: { mcpToolName?: string; args?: Record<string, unknown> };
  };

  const tc = output?.toolCall ?? input.toolCall;
  if (!tc?.mcpToolName) return null;

  let result: string | null = null;
  if (output?.toolResult !== undefined && output?.toolResult !== null) {
    // toolResult ist meist Array<{type, text}> aus MCP — flatten zu String.
    if (Array.isArray(output.toolResult)) {
      result = output.toolResult
        .map((p) => {
          if (typeof p === "string") return p;
          if (p && typeof p === "object" && "text" in p) {
            const t = (p as { text?: unknown }).text;
            return typeof t === "string" ? t : JSON.stringify(p);
          }
          return JSON.stringify(p);
        })
        .join("\n\n");
    } else if (typeof output.toolResult === "string") {
      result = output.toolResult;
    } else {
      result = JSON.stringify(output.toolResult, null, 2);
    }
  }

  return {
    toolName: tc.mcpToolName,
    args: tc.args,
    result,
    isError: output?.toolIsError === true,
  };
}

export function ToolCallTemplate({
  audit,
  expanded,
  onToggle,
}: AuditTemplateProps) {
  const view = readToolCall(audit);
  if (!view) {
    return (
      <div className="text-sm text-muted">
        Tool-Call-Detail nicht verfügbar (kein toolCall im Audit).
      </div>
    );
  }

  const display = resolveToolDisplay(view.toolName, view.args);
  const estimate = estimateToolCost(view.toolName, view.args);
  const reply = extractReply(audit);
  const hasExpandable =
    (view.result !== null && view.result.length > 0) ||
    (reply !== null && reply.length > REPLY_PREVIEW_LENGTH);

  return (
    <div className="space-y-4">
      <Field label="Tool">
        <div className="space-y-1">
          <div className="text-text">{display.label}</div>
          <div className="text-xs font-mono text-muted">{display.argsPreview}</div>
        </div>
      </Field>

      <div className="flex flex-wrap items-center gap-3 text-xs text-muted">
        <StatusBadge status={audit.status} />
        {view.isError && (
          <span className="text-warn font-mono text-[10px] uppercase tracking-wider">
            tool-error
          </span>
        )}
        <span>·</span>
        <span>{formatRelative(audit.timestamp)}</span>
        <span>·</span>
        <span className="font-mono">{formatEstimate(estimate)}</span>
      </div>

      {reply && (
        <Field label="Twin-Antwort nach Tool-Use">
          <div className="text-text whitespace-pre-wrap leading-relaxed">
            {reply.length > REPLY_PREVIEW_LENGTH && !expanded
              ? reply.slice(0, REPLY_PREVIEW_LENGTH) + "…"
              : reply}
          </div>
        </Field>
      )}

      {hasExpandable && (
        <ExpandToggle
          expanded={expanded}
          onToggle={onToggle}
          label={expanded ? "weniger" : "Tool-Output anzeigen"}
        />
      )}

      {expanded && view.result !== null && (
        <Field label="Tool-Output">
          <MonoBlock>{view.result}</MonoBlock>
        </Field>
      )}

      {expanded && audit.reason && (
        <Field label="Reason">
          <TextBlock>{audit.reason}</TextBlock>
        </Field>
      )}
    </div>
  );
}
