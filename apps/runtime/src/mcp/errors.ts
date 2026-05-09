// ─── MCP ERRORS (Phase 3.2 Sub-Schritt F) ───────────────────────────────────
//
// `McpServerInactive/NotSupported/SpawnError` leben in `client-manager.ts`
// (Lifecycle-spezifisch). Approval-Errors gehören separat hierher, weil sie
// vom Tool-Bridge geworfen, vom Twin-Service gefangen und an mehrere Pfade
// (runModel-Catch, approve/reject-Resume) signalisieren — Lifecycle-Errors
// haben keinen vergleichbaren Multi-Konsument-Charakter.

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
 */
export class McpToolApprovalRequiredError extends Error {
  readonly mcpServerId: string;
  readonly mcpToolName: string;
  readonly toolArgs: Record<string, unknown>;

  constructor(
    serverId: string,
    toolName: string,
    args: Record<string, unknown>,
  ) {
    super(`MCP-Tool '${toolName}' (server ${serverId}) requires approval`);
    this.name = "McpToolApprovalRequiredError";
    this.mcpServerId = serverId;
    this.mcpToolName = toolName;
    this.toolArgs = args;
  }
}
