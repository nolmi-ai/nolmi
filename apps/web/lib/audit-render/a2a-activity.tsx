"use client";

import { formatRelative } from "../time-format";
import { formatTokenCost } from "../token-cost";
import {
  extractModel,
  extractReply,
  extractUsage,
  extractUserPrompt,
  isLong,
  truncate,
} from "./utils";
import {
  ExpandToggle,
  Field,
  StatusBadge,
  TextBlock,
  type AuditTemplateProps,
} from "./shared";
import type { AuditEntry } from "@nolmi/shared";

// ─── A2AActivityTemplate (#99) ───────────────────────────────────────────────
//
// Für Bridge-Aktivitäten zwischen Twins. Vier Capabilities:
//   - send_to_twin           outgoing   → audit.output.reply (Sender-Text)
//   - reply-received         incoming   → audit.input.content
//   - system-message-received incoming   → audit.input.content + reasonCode
//   - respond_to_twin_message twin-side  → audit.output.reply
//
// Direction + Partner-Handle lesen wir aus den entsprechenden Feldern;
// fehlt eines, fallen wir auf "unbekannt" zurück.

const CONTENT_PREVIEW_LENGTH = 250;

interface A2AView {
  direction: "incoming" | "outgoing";
  partnerHandle: string | null;
  content: string | null;
}

function readA2A(entry: AuditEntry): A2AView {
  const input = entry.input as {
    fromHandle?: string;
    targetHandle?: string;
    toHandle?: string;
    content?: string;
  };
  const output = entry.output as
    | { reply?: string; targetHandle?: string }
    | null;

  const outgoing =
    entry.capability === "send_to_twin" ||
    entry.capability === "respond_to_twin_message";

  return {
    direction: outgoing ? "outgoing" : "incoming",
    partnerHandle: outgoing
      ? (output?.targetHandle ?? input.targetHandle ?? input.toHandle ?? null)
      : (input.fromHandle ?? null),
    content: outgoing
      ? (output?.reply ?? extractUserPrompt(entry))
      : (input.content ?? extractUserPrompt(entry)),
  };
}

export function A2AActivityTemplate({
  audit,
  expanded,
  onToggle,
}: AuditTemplateProps) {
  const view = readA2A(audit);
  const tokens = formatTokenCost(extractUsage(audit), extractModel(audit) ?? undefined);
  const reply = extractReply(audit);
  const contentIsLong = view.content ? isLong(view.content, CONTENT_PREVIEW_LENGTH) : false;
  const hasExpandable = contentIsLong || (reply !== null && view.direction === "incoming");

  const directionLabel =
    view.direction === "outgoing" ? "An" : "Von";
  const directionGlyph = view.direction === "outgoing" ? "→" : "←";

  return (
    <div className="space-y-4">
      <Field label={`${directionLabel} ${view.partnerHandle ?? "(unbekannt)"}`}>
        <div className="text-xs text-muted font-mono">
          {directionGlyph} {view.partnerHandle ?? "?"}
        </div>
      </Field>

      {view.content && (
        <Field label="Nachricht">
          {expanded || !contentIsLong ? (
            <TextBlock>{view.content}</TextBlock>
          ) : (
            <div className="text-text whitespace-pre-wrap leading-relaxed">
              {truncate(view.content, CONTENT_PREVIEW_LENGTH)}
            </div>
          )}
        </Field>
      )}

      <div className="flex flex-wrap items-center gap-3 text-xs text-muted">
        <StatusBadge status={audit.status} />
        <span>· {formatRelative(audit.timestamp)}</span>
        {tokens && (
          <span className="font-mono">· {tokens.combined}</span>
        )}
      </div>

      {hasExpandable && (
        <ExpandToggle
          expanded={expanded}
          onToggle={onToggle}
          label={expanded ? "weniger" : "Details"}
        />
      )}

      {expanded && view.direction === "incoming" && reply && (
        <Field label="Twin-Antwort">
          <TextBlock>{reply}</TextBlock>
        </Field>
      )}
    </div>
  );
}
