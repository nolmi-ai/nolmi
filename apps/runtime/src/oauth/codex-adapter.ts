import { CodexHttpError } from "./codex-http-error.js";
import { CodexSSEParser, type CodexToolCall } from "./codex-sse-parser.js";
import { withRetry } from "./codex-retry.js";
import type { OAuthRefreshService } from "./refresh-service.js";
import type { CodexToolDefinition } from "./codex-tool-mapper.js";

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

// #131 Phase 3.3.1.3.1: Multi-Step-Resume per §l-Pattern appendet zusätzlich
// `function_call`- und `function_call_output`-Items ans input-Array. Phase
// 3.2/3.3.1.2 hat das per `as unknown as CodexInputItem`-Cast gemacht — für
// Resume-Context-Persistence (audit.input.codexResumeContext.inputItems)
// brauchen wir aber einen Type, der das diskriminiert wieder hochlesen kann.
// `CodexInputItemAny` ist die volle Union; `CodexInputItem` bleibt als
// Schmal-Type für CodexAdapterInput.input erhalten — der Adapter selbst
// braucht nur `message`-Strukturkenntnis, alle anderen Items werden
// transparent durchgereicht (JSON-Serialisierung im Body).
export interface CodexFunctionCallItem {
  type: "function_call";
  call_id: string;
  name: string;
  arguments: string;
}
export interface CodexFunctionCallOutputItem {
  type: "function_call_output";
  call_id: string;
  output: string;
}
export type CodexInputItemAny =
  | CodexInputItem
  | CodexFunctionCallItem
  | CodexFunctionCallOutputItem;

// #131 Phase 3.3.1.3.1: Resume-Context für Codex-OAuth-Approval-Pause.
// Beim Pre-Call-Detect eines `requiresApproval=true`-Skills wirft
// runModelViaCodex `McpToolApprovalRequiredError` mit diesem Snapshot als
// `codexResumeContext`-Property. Der existierende Catch in
// `runOwnerDirect` persistiert das additiv in `audit.input.codexResumeContext`,
// damit Phase 3.3.1.3.2 die Loop ab dem Pending-Tool-Call fortsetzen kann.
//
// WICHTIG zur Reihenfolge-treuen Semantik: `inputItems` ist der Snapshot
// VOR dem `function_call`-Echo des Pending-Tools — Auto-Tools davor in
// derselben Iteration sind bereits ausgeführt und stehen als
// `function_call`+`function_call_output`-Paar im Array; das Pending-Tool
// selbst noch nicht. Resume hängt beim Approve den ausgeführten
// Pending-Output an dieser Stelle ein und startet die nächste Iteration.
export interface CodexResumeContext {
  /** Tool-Call, der approved werden muss. `name` ist der Codex-Tool-Name
   *  (z.B. `mcp_everything-approval_get-sum`), nicht der Twin-Lab-Skill-
   *  Name — Resume muss den Reverse-Lookup über `skillByCodexName`
   *  wiederholen. */
  pendingToolCall: {
    name: string;
    callId: string;
    arguments: string;
    itemId: string;
  };
  /** Snapshot des input-Arrays bis kurz VOR dem Pending-Tool-Call.
   *  Auto-Tool-Roundtrips früherer Iterations stehen als
   *  function_call+function_call_output-Paare drin. */
  inputItems: CodexInputItemAny[];
  /** Tool-Definitionen die Codex in dieser Iteration hatte — Resume nutzt
   *  die gleiche Liste, falls der User zwischen Pause und Resume Skills
   *  toggelt (semantische Stabilität). */
  toolDefinitions: CodexToolDefinition[];
  /** Loop-Iteration in der die Pause ausgelöst wurde (1-indexed). */
  iterationCount: number;
  /** Akkumulierter Text aus früheren Iterations (meist leer, weil Tools
   *  vor finalem Text laufen). */
  aggregatedText: string;
  /** Bereits ausgeführte Tool-Calls — für Audit-Trail-Kontinuität im
   *  Resume (Phase 3.3.1.3.2 mergt die in den finalen audit.output). */
  previousToolCalls: AuditToolCallSnapshot[];
  /** Codex-Response-Metadaten der letzten Iteration — informational, nicht
   *  funktional für Resume (Codex liest `input`-Array, nicht
   *  `previous_response_id`, siehe §l). */
  lastResponseId: string | undefined;
  lastStatus: string | undefined;
  lastPlanType: string | null;
  lastCfRay: string | null;
  totalLatencyMs: number;
  unknownEventTypes: string[];
}

/** Lokale Mini-Shape — wir wollen Resume-Context typesafe ohne harten Import
 *  des `AuditToolCall`-Shared-Types in den OAuth-Layer. Felder matched
 *  `AuditToolCall` aus `@twin-lab/shared` (input/output sind `z.unknown()` →
 *  TypeScript mapped das auf `unknown` mit implizitem undefined-Subset, also
 *  optional). */
export interface AuditToolCallSnapshot {
  toolName: string;
  input?: unknown;
  output?: unknown;
  codexCallId?: string;
}

export interface CodexAdapterInput {
  twinId: string;
  /** Pre-built System-Prompt-String — Caller komponiert Persona + Facts +
   *  Memory + Language-Direktive. */
  instructions: string;
  /** Pre-built Input-Items — Caller mappt History + aktuelle User-Message,
   *  bei Multi-Step-Resume zusätzlich `function_call` + `function_call_output`
   *  per §l-Pattern. */
  input: CodexInputItem[];
  /** Tool-Definitionen aus `mapSkillsToCodexTools`. Wenn leer/undefined,
   *  schickt der Adapter `tools: []` und Codex antwortet ohne Tool-Use.
   *  Bei Multi-Step muss der Caller die Tools PRO Iteration mitgeben
   *  (§l: tools-Field muss wiederholt werden). */
  tools?: CodexToolDefinition[];
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
  /** Tool-Calls aus `function_call`-Items (§k/§l, Phase 3.3.1.1 Parser).
   *  Bei leerem Array hat Codex direkt geantwortet ohne Tool-Use. */
  toolCalls: CodexToolCall[];
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
      tools: input.tools ?? [],
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
      toolCalls: parseResult.toolCalls,
      unknownEventTypes: parseResult.unknownEventTypes,
    };
  }
}
