"use client";

import { MemoryHitBadge } from "../../components/MemoryHitBadge";
import { formatTokenCost } from "../token-cost";
import { formatRelative } from "../time-format";
import {
  extractMemoryHits,
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
  TextBlock,
  type AuditTemplateProps,
} from "./shared";

// ─── TwinAnswerTemplate (#99) ────────────────────────────────────────────────
//
// Für Capabilities, in denen der Twin direkt eine Antwort produziert:
// owner-direct, owner-direct-send, respond_to_chat, system-message. Basic-
// Stage zeigt Anfrage gekürzt + Antwort gekürzt + Token/Cost + Timestamp.
// Sub-Expand klappt vollen Antwort-Text + Memory-Hits auf.

const REPLY_PREVIEW_LENGTH = 300;
const PROMPT_PREVIEW_LENGTH = 200;

export function TwinAnswerTemplate({
  audit,
  expanded,
  onToggle,
}: AuditTemplateProps) {
  const prompt = extractUserPrompt(audit);
  const reply = extractReply(audit);
  const tokens = formatTokenCost(extractUsage(audit), extractModel(audit) ?? undefined);
  const memoryHits = extractMemoryHits(audit);

  const replyIsLong = reply ? isLong(reply, REPLY_PREVIEW_LENGTH) : false;
  const hasExpandable = replyIsLong || memoryHits.length > 0;

  return (
    <div className="space-y-4">
      {prompt && (
        <Field label="Anfrage">
          <div className="text-muted italic whitespace-pre-wrap">
            {truncate(prompt, PROMPT_PREVIEW_LENGTH)}
          </div>
        </Field>
      )}

      {reply && (
        <Field label="Antwort">
          {expanded || !replyIsLong ? (
            <TextBlock>{reply}</TextBlock>
          ) : (
            <div className="text-text whitespace-pre-wrap leading-relaxed">
              {truncate(reply, REPLY_PREVIEW_LENGTH)}
            </div>
          )}
        </Field>
      )}

      <div className="flex flex-wrap items-center gap-3 text-xs text-muted">
        <span>{formatRelative(audit.timestamp)}</span>
        {tokens && (
          <span className="font-mono">· {tokens.combined}</span>
        )}
        {memoryHits.length > 0 && (
          <span>· {memoryHits.length} Memory-Hits</span>
        )}
      </div>

      {hasExpandable && (
        <ExpandToggle
          expanded={expanded}
          onToggle={onToggle}
          label={expanded ? "weniger" : "Details"}
        />
      )}

      {expanded && memoryHits.length > 0 && (
        <div className="pt-2">
          <MemoryHitBadge hits={memoryHits} />
        </div>
      )}
    </div>
  );
}
