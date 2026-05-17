"use client";

import { formatRelative } from "../time-format";
import {
  ExpandToggle,
  Field,
  MonoBlock,
  StatusBadge,
  type AuditTemplateProps,
} from "./shared";

// ─── GenericFallbackTemplate (#99) ───────────────────────────────────────────
//
// Für Capabilities, die noch kein Mapping in resolve-template.ts haben
// (heute: trust-added, trust-removed, draft_linkedin_post, trusted-bypass).
// Anstatt zu raten rendern wir das Audit-Objekt als pretty-printed JSON —
// gut genug zum Debuggen, sauberer Trigger für ein neues Capability-
// Template wenn der Audit-Typ relevant genug wird.

export function GenericFallbackTemplate({
  audit,
  expanded,
  onToggle,
}: AuditTemplateProps) {
  return (
    <div className="space-y-4">
      <Field label="Capability">
        <code className="font-mono text-text">{audit.capability}</code>
      </Field>

      <div className="flex flex-wrap items-center gap-3 text-xs text-muted">
        <StatusBadge status={audit.status} />
        <span>· {formatRelative(audit.timestamp)}</span>
        {audit.mandateId && (
          <span className="font-mono">· Mandate: {audit.mandateId}</span>
        )}
      </div>

      {audit.reason && (
        <Field label="Reason">
          <div className="text-sm text-warn whitespace-pre-wrap">
            {audit.reason}
          </div>
        </Field>
      )}

      <ExpandToggle
        expanded={expanded}
        onToggle={onToggle}
        label={expanded ? "weniger" : "Roh-Daten"}
      />

      {expanded && (
        <div className="space-y-3">
          <Field label="Input">
            <MonoBlock>{JSON.stringify(audit.input, null, 2)}</MonoBlock>
          </Field>
          {audit.output && (
            <Field label="Output">
              <MonoBlock>{JSON.stringify(audit.output, null, 2)}</MonoBlock>
            </Field>
          )}
        </div>
      )}
    </div>
  );
}
