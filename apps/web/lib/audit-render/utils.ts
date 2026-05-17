import type { AuditEntry, ChatMessage, MemoryHit } from "@twin-lab/shared";

// ─── audit-render utils (#99) ────────────────────────────────────────────────
//
// Schmaler Helper-Layer für Audit-Detail-Templates. Audit-`input`/`output`
// sind `Record<string, unknown>` — pro Capability anders strukturiert.
// Statt jeden Template-Component mit eigenen Type-Assertions zu beschwerden,
// kapseln wir die paar Field-Lookups hier.

/**
 * User-Prompt aus dem Audit-Input — gleiche Heuristik wie
 * `extractLastMessage` aus der Inbox, ohne mcp-tool-use-Sonderpfad
 * (das ist im ToolCallTemplate explizit gerendert).
 */
export function extractUserPrompt(entry: AuditEntry): string | null {
  const input = entry.input as {
    lastMessage?: string;
    messages?: ChatMessage[];
    content?: string;
  };
  if (typeof input.lastMessage === "string") return input.lastMessage;
  if (Array.isArray(input.messages)) {
    const last = input.messages[input.messages.length - 1];
    if (last?.content) return last.content;
  }
  if (typeof input.content === "string") return input.content;
  return null;
}

/** Twin-Antwort aus `output.reply` — null wenn Output fehlt oder reply leer. */
export function extractReply(entry: AuditEntry): string | null {
  const output = entry.output as { reply?: string } | null;
  if (!output) return null;
  if (typeof output.reply !== "string" || output.reply.length === 0) return null;
  return output.reply;
}

/**
 * Token-Usage-Objekt aus `output.providerMetadata.usage` — Format kann
 * Anthropic-camelCase oder OpenAI-snake_case sein. Lass den Caller
 * (formatTokenCost) das parsen; wir returnen den Rohwert.
 */
export function extractUsage(entry: AuditEntry): unknown {
  const output = entry.output as
    | { providerMetadata?: { usage?: unknown } }
    | null;
  return output?.providerMetadata?.usage ?? null;
}

/** Model-String aus providerMetadata, falls vorhanden (sonst null). */
export function extractModel(entry: AuditEntry): string | null {
  const output = entry.output as
    | { providerMetadata?: { model?: string; provider?: string } }
    | null;
  // Anthropic AI-SDK schreibt 'provider' (z.B. 'anthropic/claude-opus-4-7'),
  // OpenAI schreibt 'model'. Provider-String enthält oft das Modell hinten,
  // also extrahieren wir es nach dem '/'.
  if (output?.providerMetadata?.model) return output.providerMetadata.model;
  if (output?.providerMetadata?.provider) {
    const parts = output.providerMetadata.provider.split("/");
    return parts[parts.length - 1] ?? null;
  }
  return null;
}

/** Memory-Hits aus `output.memoryHits`, leer falls fehlt. */
export function extractMemoryHits(entry: AuditEntry): MemoryHit[] {
  const output = entry.output as { memoryHits?: MemoryHit[] } | null;
  return Array.isArray(output?.memoryHits) ? output.memoryHits : [];
}

/**
 * Kürzt einen String auf max-Länge mit Ellipsis. Wird in den Basic-Stages
 * der Templates benutzt — voller Text liegt einen Click entfernt.
 */
export function truncate(text: string, max: number): string {
  const trimmed = text.trim();
  if (trimmed.length <= max) return trimmed;
  return trimmed.slice(0, Math.max(0, max - 1)) + "…";
}

/** Heuristisches "True wenn String länger als die Basic-Stage-Anzeige". */
export function isLong(text: string, max: number): boolean {
  return text.trim().length > max;
}
