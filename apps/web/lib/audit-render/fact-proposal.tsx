"use client";

import { formatRelative } from "../time-format";
import {
  Field,
  StatusBadge,
  TextBlock,
  type AuditTemplateProps,
} from "./shared";

// ─── FactProposalTemplate (#99) ──────────────────────────────────────────────
//
// Für semantic-fact-write-Audits. Schema ist je nach Lifecycle-Phase
// unterschiedlich:
//   - pending: input hat factKey/factValue/reasoning, output ist null
//   - executed: output hat factKey/factValue/factId/reasoning
// Wir lesen erst output, fallen zurück auf input.

export function FactProposalTemplate({ audit }: AuditTemplateProps) {
  const fact = readFact(audit);

  return (
    <div className="space-y-4">
      {fact ? (
        <Field label="Vorgeschlagener Fakt">
          <div className="text-sm flex flex-wrap items-baseline gap-2">
            <code className="font-mono text-text bg-bg border border-border rounded px-1.5 py-0.5">
              {fact.factKey}
            </code>
            <span className="text-muted">→</span>
            <span className="text-text whitespace-pre-wrap break-words">
              {fact.factValue}
            </span>
          </div>
        </Field>
      ) : (
        <div className="text-sm text-muted">Fact-Details nicht verfügbar.</div>
      )}

      {fact?.reasoning && (
        <Field label="Begründung">
          <TextBlock>{fact.reasoning}</TextBlock>
        </Field>
      )}

      <div className="flex flex-wrap items-center gap-3 text-xs text-muted">
        <StatusBadge status={audit.status} />
        <span>· {formatRelative(audit.timestamp)}</span>
        {fact?.factId && (
          <span className="font-mono">· {fact.factId}</span>
        )}
      </div>

      {audit.reason && (
        <Field label="Reason">
          <TextBlock>{audit.reason}</TextBlock>
        </Field>
      )}
    </div>
  );
}

interface FactView {
  factKey: string;
  factValue: string;
  reasoning?: string;
  factId?: string;
}

function readFact(entry: {
  input: Record<string, unknown>;
  output: Record<string, unknown> | null;
}): FactView | null {
  const candidates: Array<Record<string, unknown>> = [];
  if (entry.output) candidates.push(entry.output);
  candidates.push(entry.input);

  for (const c of candidates) {
    const factKey = c["factKey"];
    const factValue = c["factValue"];
    if (typeof factKey === "string" && typeof factValue === "string") {
      return {
        factKey,
        factValue,
        reasoning:
          typeof c["reasoning"] === "string" ? (c["reasoning"] as string) : undefined,
        factId: typeof c["factId"] === "string" ? (c["factId"] as string) : undefined,
      };
    }
  }
  return null;
}
