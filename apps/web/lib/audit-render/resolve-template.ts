// ─── resolve-template (#99) ──────────────────────────────────────────────────
//
// Mapping von Audit-Capability auf eine der vier Template-Klassen plus
// Generic-Fallback. Halte die Liste hier zentral — wenn neue Capabilities
// im Runtime entstehen, fliegt nichts kaputt (Fallback rendert pretty-printed
// JSON), aber das Audit kriegt erst ein menschliches Bild, wenn es hier
// gemappt wird.

export type AuditTemplateClass =
  | "twin-answer"
  | "tool-call"
  | "fact-proposal"
  | "a2a-activity"
  | "generic";

const CAPABILITY_TO_TEMPLATE: Record<string, AuditTemplateClass> = {
  // Twin spricht — LLM-Call mit Reply
  "owner-direct": "twin-answer",
  "owner-direct-send": "twin-answer",
  respond_to_chat: "twin-answer",
  "system-message": "twin-answer",
  // Tool-Use Pre/Post-Approval
  "mcp-tool-use": "tool-call",
  // Fact-Vorschlag aus Extraction-Engine
  "semantic-fact-write": "fact-proposal",
  // A2A-Bridge-Aktivitäten
  send_to_twin: "a2a-activity",
  "reply-received": "a2a-activity",
  "system-message-received": "a2a-activity",
  respond_to_twin_message: "a2a-activity",
};

export function resolveAuditTemplate(capability: string): AuditTemplateClass {
  return CAPABILITY_TO_TEMPLATE[capability] ?? "generic";
}
