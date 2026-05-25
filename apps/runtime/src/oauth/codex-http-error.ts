// ─── CODEX HTTP ERROR (#131 PHASE 3.1.2) ────────────────────────────────────
//
// Eigene Error-Klasse für non-2xx-Responses vom Codex-Endpoint. Hält den
// HTTP-Status als typed Field — damit kann der Retry-Helper sauber
// klassifizieren (4xx no-retry / User-Action, 5xx retry / transient).
//
// Pattern analog {@link CodexStreamParseError} aus codex-sse-parser.ts
// (eigenes File, dedizierte Error-Klasse mit Name + Code/Status).
//
// Vermeidet String-Matching auf der Message — das war Spike-Pragmatik in
// Phase 3.0, Phase 3.1.2 macht das robust.

export class CodexHttpError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    /** Optional: erste paar hundert Bytes des Response-Bodys für Debug. */
    public readonly bodySnippet?: string,
  ) {
    super(message);
    this.name = "CodexHttpError";
  }
}
