import type {
  LanguageModelV3,
  LanguageModelV3CallOptions,
  LanguageModelV3Content,
  LanguageModelV3FinishReason,
  LanguageModelV3FunctionTool,
  LanguageModelV3GenerateResult,
  LanguageModelV3Prompt,
  LanguageModelV3ProviderTool,
  LanguageModelV3StreamResult,
} from "@ai-sdk/provider";

import { CodexAdapter } from "./codex-adapter.js";
import type {
  CodexAdapterOutput,
  CodexInputItemAny,
} from "./codex-adapter.js";
import type { CodexToolDefinition } from "./codex-tool-mapper.js";
import type { OAuthRefreshService } from "./refresh-service.js";

// ─── CODEX-VERCEL-PROVIDER (#131 PHASE 3.4.1) ───────────────────────────────
//
// Wraps the existing `CodexAdapter` as a Vercel AI SDK 6 `LanguageModelV3`-
// kompatibler Provider. Zweck: einheitlicher `generateText`-Pfad im TwinService
// (Phase 3.4.5), ersetzt den heutigen oauth-Branch in `runModel`.
//
// Spike-Discovery (§q) hat verifiziert: Vercel-SDK orchestriert Multi-Step-
// Tool-Loops + §l-Pattern (function_call_output ans input-Array) transparent
// via Re-Aufruf von `doGenerate`. Custom-Provider macht pro Call genau eine
// Codex-Iteration; Loop ist in `generateText` außen.
//
// Phase 3.4.1-Scope:
//   - doGenerate implementiert (Prompt-Mapping + Tool-Definition-Mapping +
//     Output-Mapping inkl. Reasoning)
//   - doStream throws (Phase 3.4.5 wenn überhaupt — TwinService nutzt heute
//     auch nur generateText, kein streamText)
//   - Smoke-Surface in 3.4.1 nur Simple-Text; Tool-Smoke kommt in 3.4.2
//
// Convention-Match: existing `createOpenAI/Anthropic` returnt eine callable
// Function plus Helper-Methoden. Wir bieten dasselbe Pattern:
//   const codex = createCodexProvider({refreshService, twinId});
//   const model = codex("gpt-5.5");                // direct-callable
//   const model = codex.languageModel("gpt-5.5"); // explicit method
// Beide returnt dasselbe LanguageModelV3-Instance.

export interface CodexProviderConfig {
  refreshService: OAuthRefreshService;
  /** Twin-ID für Token-Lookup. Pro Twin-Lifecycle ein Provider, weil
   *  der RefreshService twin-spezifische Tokens hält. */
  twinId: string;
}

export interface CodexProvider {
  (modelId: string): LanguageModelV3;
  languageModel(modelId: string): LanguageModelV3;
}

export function createCodexProvider(config: CodexProviderConfig): CodexProvider {
  const adapter = new CodexAdapter(config.refreshService);
  const build = (modelId: string): LanguageModelV3 =>
    new CodexLanguageModel(modelId, config.twinId, adapter);
  const provider = ((modelId: string) => build(modelId)) as CodexProvider;
  provider.languageModel = build;
  return provider;
}

// ─── LANGUAGE-MODEL ─────────────────────────────────────────────────────────

class CodexLanguageModel implements LanguageModelV3 {
  readonly specificationVersion = "v3" as const;
  readonly provider = "openai-codex";
  readonly modelId: string;
  readonly supportedUrls: Record<string, RegExp[]> = {};

  constructor(
    modelId: string,
    private readonly twinId: string,
    private readonly adapter: CodexAdapter,
  ) {
    this.modelId = modelId;
  }

  async doGenerate(
    options: LanguageModelV3CallOptions,
  ): Promise<LanguageModelV3GenerateResult> {
    const { instructions, input } = mapV3PromptToCodex(options.prompt);
    const tools = mapV3ToolsToCodex(options.tools);

    const output = await this.adapter.generateText({
      twinId: this.twinId,
      instructions,
      input: input as never, // CodexAdapterInput verlangt CodexInputItem[] (schmal-Type),
      // die Mapping-Helper liefern CodexInputItemAny[] (Union mit function_call*).
      // Adapter reicht alle Items transparent durch — Cast ist sicher.
      ...(tools.length > 0 ? { tools } : {}),
      model: this.modelId,
    });

    return mapCodexOutputToV3Result(output);
  }

  async doStream(
    _options: LanguageModelV3CallOptions,
  ): Promise<LanguageModelV3StreamResult> {
    throw new Error(
      "[codex-vercel-provider] doStream not implemented in Phase 3.4.1 — " +
        "TwinService nutzt nur generateText (doGenerate-only). Phase 3.4.5 " +
        "entscheidet ob doStream gebraucht wird.",
    );
  }
}

// ─── MAPPING: Vercel V3 Prompt → Codex Input ────────────────────────────────
//
// V3-Message-Rollen:
//   - 'system'    → top-level instructions-Field (Codex hat dedicated slot)
//   - 'user'      → message-Item, role:"user", input_text-Parts
//   - 'assistant' → message-Item PLUS function_call-Items für Tool-Calls
//   - 'tool'      → function_call_output-Items (§l-Pattern)
//
// Multi-Step: Vercel-SDK ruft doGenerate mehrfach auf, jedes Mal mit
// History + Tool-Call-Echo + Tool-Result-Message im Prompt. Provider
// übersetzt das transparent in Codex' §l-Pattern.

export function mapV3PromptToCodex(prompt: LanguageModelV3Prompt): {
  instructions: string;
  input: CodexInputItemAny[];
} {
  const instructionsParts: string[] = [];
  const input: CodexInputItemAny[] = [];

  for (const msg of prompt) {
    if (msg.role === "system") {
      instructionsParts.push(msg.content);
      continue;
    }
    if (msg.role === "user") {
      const text = msg.content
        .filter(
          (p: { type: string }): p is { type: "text"; text: string } =>
            p.type === "text",
        )
        .map((p: { text: string }) => p.text)
        .join("\n");
      input.push({
        type: "message",
        role: "user",
        content: [{ type: "input_text", text }],
      });
      continue;
    }
    if (msg.role === "assistant") {
      // Text-Parts + Tool-Call-Parts pro assistant-Message
      const textParts: string[] = [];
      for (const p of msg.content) {
        if (p.type === "text") {
          textParts.push(p.text);
        } else if (p.type === "tool-call") {
          input.push({
            type: "function_call",
            call_id: p.toolCallId,
            name: p.toolName,
            arguments:
              typeof p.input === "string"
                ? p.input
                : JSON.stringify(p.input),
          });
        }
        // reasoning/file ignoriert — kein Roundtrip-Effekt für Codex
      }
      if (textParts.length > 0) {
        input.push({
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text: textParts.join("\n") }],
        });
      }
      continue;
    }
    if (msg.role === "tool") {
      for (const p of msg.content) {
        if (p.type === "tool-result") {
          const output = stringifyToolResultOutput(p.output);
          input.push({
            type: "function_call_output",
            call_id: p.toolCallId,
            output,
          });
        }
        // tool-approval-response wäre Phase-3.4.3 (kommt in v3-Spec vor,
        // heute kein Mapping)
      }
      continue;
    }
  }

  return {
    instructions: instructionsParts.join("\n\n"),
    input,
  };
}

// Helper für tool-result.output: V3 erlaubt verschiedene Shape-Varianten.
// Codex erwartet einen String. Defensive Stringification.
function stringifyToolResultOutput(output: unknown): string {
  if (output === null || output === undefined) return "";
  if (typeof output === "string") return output;
  if (typeof output === "object" && output !== null) {
    if ("value" in output) {
      const v = (output as { value: unknown }).value;
      return typeof v === "string" ? v : JSON.stringify(v);
    }
    return JSON.stringify(output);
  }
  return String(output);
}

// ─── MAPPING: Vercel V3 Tools → Codex tools-Field ───────────────────────────

export function mapV3ToolsToCodex(
  tools:
    | Array<LanguageModelV3FunctionTool | LanguageModelV3ProviderTool>
    | undefined,
): CodexToolDefinition[] {
  if (!tools || tools.length === 0) return [];
  const out: CodexToolDefinition[] = [];
  for (const t of tools) {
    if (t.type !== "function") continue; // provider-defined tools ignored
    // CodexToolDefinition erwartet description als required-string. Vercel
    // V3 lässt sie optional — defaulten auf leeren String, Codex behandelt
    // das tolerant.
    out.push({
      type: "function",
      name: t.name,
      description: t.description ?? "",
      parameters: t.inputSchema as object,
    });
  }
  return out;
}

// ─── MAPPING: Codex Output → Vercel V3 Result ───────────────────────────────

export function mapCodexOutputToV3Result(
  output: CodexAdapterOutput,
): LanguageModelV3GenerateResult {
  const content: LanguageModelV3Content[] = [];

  // Text-Content (falls vorhanden — kann leer sein bei pure-tool-call-Iteration)
  if (output.text) {
    content.push({ type: "text", text: output.text });
  }

  // Tool-Calls — V3 ToolCall hat input als JSON-String, Codex liefert
  // arguments schon als String (1:1 pass-through)
  for (const tc of output.toolCalls) {
    content.push({
      type: "tool-call",
      toolCallId: tc.callId,
      toolName: tc.name,
      input: tc.arguments,
    });
  }

  // Reasoning — Codex liefert `summary: []` (Anti-Distillation, §p), Mapping
  // ist leerer Text-String pro Reasoning-Item. Token-Count geht via usage.
  for (const _trace of output.reasoningTraces) {
    content.push({ type: "reasoning", text: "" });
  }

  return {
    content,
    finishReason: mapFinishReason(output.status, output.toolCalls.length > 0),
    usage: {
      // Codex liefert keine input-/output-Token-Counts heute, nur reasoning.
      // Alle Felder explizit undefined setzen (V3-Spec erfordert sie).
      inputTokens: {
        total: undefined,
        noCache: undefined,
        cacheRead: undefined,
        cacheWrite: undefined,
      },
      outputTokens: {
        total: undefined,
        text: undefined,
        reasoning: output.reasoningTokens,
      },
    },
    providerMetadata: {
      "openai-codex": {
        planType: output.planType ?? "",
        cfRay: output.cfRay ?? "",
        latencyMs: output.latencyMs,
        responseId: output.responseId ?? "",
        codexStatus: output.status ?? "",
        ...(output.unknownEventTypes.length > 0
          ? { unknownEventTypes: output.unknownEventTypes.join(",") }
          : {}),
      },
    },
    warnings: [],
  };
}

function mapFinishReason(
  status: string | null,
  hasToolCalls: boolean,
): LanguageModelV3FinishReason {
  if (hasToolCalls) {
    return { unified: "tool-calls", raw: status ?? undefined };
  }
  if (status === "completed") {
    return { unified: "stop", raw: status };
  }
  if (status === "incomplete") {
    return { unified: "length", raw: status };
  }
  return { unified: "other", raw: status ?? undefined };
}
