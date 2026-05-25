import type { OAuthRefreshService } from "./refresh-service.js";

// ─── CODEX-ADAPTER (#131 PHASE 3.0 SPIKE) ────────────────────────────────────
//
// Direct-fetch gegen das Codex-Backend von ChatGPT. Walking-Skeleton — beweist
// die End-to-End-Architektur (OAuth-Token-Refresh → Codex-Endpoint → SSE-Text).
//
// Out-of-Scope für Phase 3.0 (kommt in 3.1-3.4):
//   - Tool-Calls (tools=[] hardcoded)
//   - Persona-/Mandate-Mapping (Minimal-Instructions, siehe SPIKE_INSTRUCTIONS)
//   - SSE-Streaming bis zum Web-Client (collect-to-string-Pattern)
//   - Disconnection-Recovery / Cookie-Jar-Wiederverwendung
//   - Reasoning-Traces, Audit-Mapping
//   - Vercel-AI-SDK-Custom-Provider (3.4, optional)
//
// Endpoint + Schema sind via Pre-Flight Tag 27 verifiziert (3/3 HTTP 200,
// inkl. VPS-Container). Quellen: Simon Willison Reverse-Engineering (Nov
// 2025), HuggingFace codex-proxy. Siehe docs/131-OAUTH-STRATEGY.md §g/§h.

const CODEX_ENDPOINT = "https://chatgpt.com/backend-api/codex/responses";

// Pre-Flight-verifizierter Minimal-Codex-Prefix. Phase 3.2 ersetzt das mit
// echtem Codex-CLI-Reverse-Engineering plus Twin-Persona-Mapping als
// developer-Role-Message.
const SPIKE_INSTRUCTIONS = "You are a helpful coding assistant.";

const DEFAULT_MODEL = "gpt-5.5";

export interface CodexAdapterInput {
  twinId: string;
  userMessage: string;
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
}

export class CodexAdapter {
  constructor(private refreshService: OAuthRefreshService) {}

  async generateText(input: CodexAdapterInput): Promise<CodexAdapterOutput> {
    const token = await this.refreshService.ensureFresh(input.twinId);
    const startMs = Date.now();

    const body = {
      model: input.model ?? DEFAULT_MODEL,
      instructions: SPIKE_INSTRUCTIONS,
      input: [
        {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: input.userMessage }],
        },
      ],
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
      const errText = await res.text().catch(() => "");
      throw new Error(
        `[codex-adapter] HTTP ${res.status}: ${errText.slice(0, 300)}`,
      );
    }

    const text = await collectSSEText(res);
    const latencyMs = Date.now() - startMs;

    return {
      text,
      planType: res.headers.get("x-codex-plan-type"),
      cfRay: res.headers.get("cf-ray"),
      latencyMs,
    };
  }
}

/**
 * Spike-Pragmatik: collect-to-string. Iteriert SSE-Events, sammelt
 * `response.output_text.delta`-Chunks. Phase 3.1 ersetzt das mit einem robusten
 * Stream-Parser (Event-Types, Tool-Calls, Reasoning-Traces, Recovery).
 */
async function collectSSEText(res: Response): Promise<string> {
  if (!res.body) {
    throw new Error("[codex-adapter] response.body ist null — kein Stream");
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let collected = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    // SSE-Events sind durch `\n\n` getrennt. Wir spalten am Doppel-Newline,
    // letzter (potenziell unvollständiger) Teil bleibt im Buffer.
    const events = buffer.split("\n\n");
    buffer = events.pop() ?? "";

    for (const event of events) {
      const trimmed = event.trim();
      if (!trimmed) continue;
      const dataLine = trimmed
        .split("\n")
        .find((line) => line.startsWith("data: "));
      if (!dataLine) continue;
      const dataStr = dataLine.slice(6);
      if (dataStr === "[DONE]") continue;

      try {
        const parsed = JSON.parse(dataStr) as { type?: string; delta?: string };
        if (parsed.type === "response.output_text.delta" && parsed.delta) {
          collected += parsed.delta;
        }
      } catch {
        // Spike: malformed Events einfach überspringen. Phase 3.1 loggt das
        // mit Sample, damit unbekannte Event-Types ans Tageslicht kommen.
      }
    }
  }

  return collected;
}
