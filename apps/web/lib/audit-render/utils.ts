import type { AuditEntry, ChatMessage, MemoryHit } from "@nolmi/shared";

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

/**
 * Model-String aus providerMetadata.model. Pre-Tag-28-Audits ohne flaches
 * `model`-Feld liefern `"unknown"` zurück — der Compound-String-Split aus
 * `providerMetadata.provider` (Pre-#141+#142-Pfad) wurde mit #146 entfernt,
 * weil neue Audits seit Commit `0b02482` `model` immer flach mitschreiben.
 * Drift in alten Audits ist akzeptiert (Debug-Surface, kein User-Facing).
 */
export function extractModel(entry: AuditEntry): string {
  const output = entry.output as
    | { providerMetadata?: { model?: string } }
    | null;
  if (typeof output?.providerMetadata?.model === "string" && output.providerMetadata.model.length > 0) {
    return output.providerMetadata.model;
  }
  return "unknown";
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
