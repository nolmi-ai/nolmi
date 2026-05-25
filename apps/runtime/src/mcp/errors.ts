// ─── MCP ERRORS ──────────────────────────────────────────────────────────────
//
// `McpServerInactive/NotSupported/SpawnError` leben in `client-manager.ts`
// (Lifecycle-spezifisch). Approval-Errors gehören separat hierher, weil sie
// in `runModel` geworfen, in `runOwnerDirect` gefangen und an mehrere Pfade
// (Pending-Audit-Build, History-Replay-Resume) signalisieren — Lifecycle-
// Errors haben keinen vergleichbaren Multi-Konsument-Charakter.

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
 * Ersetzt das ältere Marker-Pattern aus 3.2.F + Codex-Pre-Call-Detect aus
 * 3.3.1.3.1 (beide mit Sub-Phase F entfernt — einziger Approval-Error-Type
 * im Codebase ist seither dieser).
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
