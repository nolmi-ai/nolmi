// ─── audit-render public API (#99) ───────────────────────────────────────────

export { resolveAuditTemplate, type AuditTemplateClass } from "./resolve-template";
export { TwinAnswerTemplate } from "./twin-answer";
export { ToolCallTemplate } from "./tool-call";
export { FactProposalTemplate } from "./fact-proposal";
export { A2AActivityTemplate } from "./a2a-activity";
export { GenericFallbackTemplate } from "./generic-fallback";
export type { AuditTemplateProps } from "./shared";
