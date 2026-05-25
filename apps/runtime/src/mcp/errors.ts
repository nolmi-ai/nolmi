// ─── MCP ERRORS (Phase 3.2 Sub-Schritt F) ───────────────────────────────────
//
// `McpServerInactive/NotSupported/SpawnError` leben in `client-manager.ts`
// (Lifecycle-spezifisch). Approval-Errors gehören separat hierher, weil sie
// vom Tool-Bridge geworfen, vom Twin-Service gefangen und an mehrere Pfade
// (runModel-Catch, approve/reject-Resume) signalisieren — Lifecycle-Errors
// haben keinen vergleichbaren Multi-Konsument-Charakter.

import type { CodexResumeContext } from "../oauth/codex-adapter.js";

/**
 * Wird vom Tool-Bridge `execute()` geworfen, wenn der LLM ein MCP-Tool mit
 * `requiresApproval: true` aufrufen will. Twin-Service catcht das auf der
 * `generateText`-Ebene, baut einen Pending-Audit (`capability='mcp-tool-use'`)
 * und antwortet dem User mit einer Wartemeldung. Approval/Reject läuft dann
 * über die existierenden `/audit/:id/approve|reject`-Routes, die im Twin-
 * Service-Switch einen neuen Resume-Branch bekommen.
 *
 * Die strukturierten Felder (`mcpServerId`, `mcpToolName`, `toolArgs`) sind
 * exakt das, was später für den Tool-Call beim Approve gebraucht wird —
 * gleichzeitig die Daten, die im Pending-Audit-Input persistiert werden,
 * damit der State Server-Restart-stabil ist.
 *
 * AI-SDK-Risiko: AI-SDK-6 könnte einen `execute()`-throw als Tool-Error
 * interpretieren und den Loop fortsetzen statt zu propagieren. Falls das
 * im Smoke-Test auftritt, dokumentiert der Fallback-Plan ein Marker-
 * Pattern (siehe Briefing 3.2.F-Notes).
 *
 * #131 Phase 3.3.1.3.1: Im Codex-OAuth-Pfad wird der Error vom Multi-Step-
 * Loop in `runModelViaCodex` pre-Tool-Execute geworfen (kein Marker-Pattern
 * nötig, weil der Loop direkt orchestriert wird). `codexResumeContext` trägt
 * dann den Loop-State-Snapshot mit, den der existierende Catch in
 * `runOwnerDirect` additiv in `audit.input.codexResumeContext` persistiert
 * — Phase 3.3.1.3.2 nutzt das für den Resume. Für den Vercel-SDK-Pfad
 * (Anthropic/OpenAI-API) bleibt `codexResumeContext` undefined.
 */
/**
 * #131 Phase 3.4.3.1 Big-Bang: native Vercel-V3-Approval-Error. Wird von
 * `runModel` nach `generateText` geworfen, wenn das Result-Content-Array
 * eine `tool-approval-request`-Part enthält (Vercel-SDK skipped execute()
 * bei needsApproval=true und emittiert die Part). Catch in `runOwnerDirect`
 * baut den Pending-Audit via `createPendingAuditFromApprovalRequest`.
 *
 * Trägt ALLE Daten die für History-Replay-Approve nötig sind — der
 * `assistantContent` enthält tool-call + tool-approval-request, das Resume
 * appendet die Tool-Response-Message und ruft `generateText` erneut.
 *
 * Ersetzt `McpToolApprovalRequiredError` (Phase 3.2.F Marker-Pattern) für
 * den Vercel-SDK-Pfad. Marker-Klasse bleibt parallel bis Sub-Phase F
 * (Codex-Loop nutzt sie noch). Sub-Phase F entfernt beide Klassen.
 */
export class ApprovalRequestedError extends Error {
  readonly approvalId: string;
  readonly toolCallId: string;
  readonly toolName: string;
  readonly toolInput: unknown;
  /** Komplettes `assistant`-Content-Array aus dem Vercel-Result: enthält
   *  `tool-call` + `tool-approval-request`-Part. Resume-History-Replay
   *  appendet dieses Array als assistant-Message + ergänzt tool-role-
   *  Message mit `tool-approval-response`. */
  readonly assistantContent: unknown;

  constructor(opts: {
    approvalId: string;
    toolCallId: string;
    toolName: string;
    toolInput: unknown;
    assistantContent: unknown;
  }) {
    super(
      `Tool '${opts.toolName}' (callId ${opts.toolCallId}) requires approval ` +
        `(approvalId ${opts.approvalId})`,
    );
    this.name = "ApprovalRequestedError";
    this.approvalId = opts.approvalId;
    this.toolCallId = opts.toolCallId;
    this.toolName = opts.toolName;
    this.toolInput = opts.toolInput;
    this.assistantContent = opts.assistantContent;
  }
}

export class McpToolApprovalRequiredError extends Error {
  readonly mcpServerId: string;
  readonly mcpToolName: string;
  readonly toolArgs: Record<string, unknown>;
  readonly codexResumeContext?: CodexResumeContext;

  constructor(
    serverId: string,
    toolName: string,
    args: Record<string, unknown>,
    codexResumeContext?: CodexResumeContext,
  ) {
    super(`MCP-Tool '${toolName}' (server ${serverId}) requires approval`);
    this.name = "McpToolApprovalRequiredError";
    this.mcpServerId = serverId;
    this.mcpToolName = toolName;
    this.toolArgs = args;
    if (codexResumeContext) this.codexResumeContext = codexResumeContext;
  }
}
