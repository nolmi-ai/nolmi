import { CodexHttpError } from "./codex-http-error.js";
import { CodexSSEParser } from "./codex-sse-parser.js";
import { withRetry } from "./codex-retry.js";
import type { OAuthRefreshService } from "./refresh-service.js";

// ─── CODEX-ADAPTER (#131 PHASE 3.2) ──────────────────────────────────────────
//
// Direct-fetch gegen das Codex-Backend von ChatGPT. Phase 3.0 war Walking-
// Skeleton; Phase 3.1 hat den SSE-Parser standalone gebaut (3.1.1) und ihn
// hier integriert plus Retry-Wrapper drumherum gelegt (3.1.2). Phase 3.2
// macht den Adapter zum reinen HTTP-Client — `instructions` (System-Prompt)
// und `input` (Codex-Input-Items inkl. History) kommen pre-built vom Caller
// (`runModelViaCodex` in twin-service.ts).
//
// Out-of-Scope (kommt in 3.3-3.4):
//   - Tool-Calls (tools=[] hardcoded)
//   - SSE-Streaming bis zum Web-Client (collect-to-string-Pattern)
//   - Reasoning-Traces, Audit-Mapping
//   - Vercel-AI-SDK-Custom-Provider (3.4, optional)
//
// Endpoint + Schema sind via Pre-Flight Tag 27 verifiziert (3/3 HTTP 200,
// inkl. VPS-Container). Quellen: Simon Willison Reverse-Engineering (Nov
// 2025), HuggingFace codex-proxy. Siehe docs/131-OAUTH-STRATEGY.md §g/§h.

const CODEX_ENDPOINT = "https://chatgpt.com/backend-api/codex/responses";

const DEFAULT_MODEL = "gpt-5.5";

/**
 * Codex-Input-Item-Schema (Subset für Phase 3.2 — Text-Messages, kein
 * Tool-Call-Format). Mapped von `ChatMessage[]` durch den Caller:
 *   user → `input_text`, assistant → `output_text` (matched Codex-Response-
 *   Format und ist die naheliegende Symmetrie).
 */
export interface CodexInputItem {
  type: "message";
  role: "user" | "assistant";
  content: Array<{ type: "input_text" | "output_text"; text: string }>;
}

export interface CodexAdapterInput {
  twinId: string;
  /** Pre-built System-Prompt-String — Caller komponiert Persona + Facts +
   *  Memory + Language-Direktive. */
  instructions: string;
  /** Pre-built Input-Items — Caller mappt History + aktuelle User-Message. */
  input: CodexInputItem[];
  model?: string;
}

export interface CodexAdapterOutput {
  text: string;
  /** Response-Header `x-codex-plan-type` — meist `pro` oder `plus`. */
  planType: string | null;
  /** Response-Header `cf-ray` — Cloudflare-Trace-ID, fürs Debugging. */
  cfRay: string | null;
  /** Latenz in ms vom fetch-Aufruf bis zum letzten SSE-Chunk. */
  latencyMs: number;
  /** Aus `response.created`-Event geliefert. */
  responseId: string | null;
  /** Aus `response.completed`-Event geliefert (typisch `"completed"`). */
  status: string | null;
  /** Unbekannte SSE-Event-Types, die der Parser-Hybrid-Fallback aufgesammelt
   *  hat. Phase 3.3 wird darauf reagieren, Phase 3.1.2 logged sie nur. */
  unknownEventTypes: string[];
}

export class CodexAdapter {
  constructor(private refreshService: OAuthRefreshService) {}

  async generateText(input: CodexAdapterInput): Promise<CodexAdapterOutput> {
    return withRetry(() => this.executeRequest(input), {
      onRetry: (attempt, err) => {
        // Konsistenz mit existing Adapter-Logging (console.warn statt
        // Fastify-Logger-Plumbing — letzteres wäre Phase 3.4-Material).
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(
          `[codex-adapter] Retry ${attempt}/3 nach transient Failure: ${msg}`,
        );
      },
    });
  }

  /** Ein vollständiger fetch + SSE-Parse-Durchlauf. Bei Retry wird das
   *  komplett neu gestartet — kein previous_response_id, frischer Parser. */
  private async executeRequest(
    input: CodexAdapterInput,
  ): Promise<CodexAdapterOutput> {
    // ensureFresh INNERHALB des Retry-Loops, damit ein refresh-bedingter
    // Token-Wechsel zwischen Versuchen automatisch greift.
    const token = await this.refreshService.ensureFresh(input.twinId);
    const startMs = Date.now();

    const body = {
      model: input.model ?? DEFAULT_MODEL,
      instructions: input.instructions,
      input: input.input,
      tools: [],
      tool_choice: "auto",
      parallel_tool_calls: false,
      store: false,
      stream: true,
    };

    const res = await fetch(CODEX_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token.accessToken}`,
        "Content-Type": "application/json",
        "OpenAI-Beta": "responses=v1",
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const bodySnippet = await res.text().catch(() => "");
      throw new CodexHttpError(
        `[codex-adapter] HTTP ${res.status}: ${bodySnippet.slice(0, 300)}`,
        res.status,
        bodySnippet.slice(0, 300),
      );
    }

    const parser = new CodexSSEParser();
    const parseResult = await parser.parse(res.body);
    const latencyMs = Date.now() - startMs;

    if (parseResult.unknownEventTypes.length > 0) {
      console.warn(
        `[codex-adapter] unknown SSE event types: ${parseResult.unknownEventTypes.join(", ")} ` +
          `(Phase 3.3 wird das in Tool-Call-/Reasoning-Trace-Handling überführen)`,
      );
    }

    return {
      text: parseResult.text,
      planType: res.headers.get("x-codex-plan-type"),
      cfRay: res.headers.get("cf-ray"),
      latencyMs,
      responseId: parseResult.responseId ?? null,
      status: parseResult.status ?? null,
      unknownEventTypes: parseResult.unknownEventTypes,
    };
  }
}
