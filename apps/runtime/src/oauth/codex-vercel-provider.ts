import type {
  LanguageModelV3,
  LanguageModelV3CallOptions,
  LanguageModelV3Content,
  LanguageModelV3FinishReason,
  LanguageModelV3FunctionTool,
  LanguageModelV3GenerateResult,
  LanguageModelV3Prompt,
  LanguageModelV3ProviderTool,
  LanguageModelV3StreamPart,
  LanguageModelV3StreamResult,
  LanguageModelV3ToolCall,
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
    options: LanguageModelV3CallOptions,
  ): Promise<LanguageModelV3StreamResult> {
    const { instructions, input } = mapV3PromptToCodex(options.prompt);
    const tools = mapV3ToolsToCodex(options.tools);

    const sseBody = await this.adapter.streamFetch({
      twinId: this.twinId,
      instructions,
      input: input as never,
      ...(tools.length > 0 ? { tools } : {}),
      model: this.modelId,
    });

    const TEXT_ID = "text-1";

    const stream = new ReadableStream<LanguageModelV3StreamPart>({
      async start(controller) {
        controller.enqueue({ type: "stream-start", warnings: [] });

        const reader = sseBody.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let textStarted = false;
        // Tool-Calls werden atomar am Ende geliefert (kein streaming der Args).
        // Akkumulierung wie im CodexSSEParser (item_id als Key).
        const toolCallsMap = new Map<
          string,
          { callId: string; name: string; arguments: string }
        >();
        let status: string | null = null;

        const handleEvent = (parsed: Record<string, unknown>): void => {
          const type = parsed.type;
          if (typeof type !== "string") return;

          if (type === "response.output_text.delta") {
            const delta = typeof parsed.delta === "string" ? parsed.delta : "";
            if (!delta) return;
            if (!textStarted) {
              controller.enqueue({ type: "text-start", id: TEXT_ID });
              textStarted = true;
            }
            controller.enqueue({ type: "text-delta", id: TEXT_ID, delta });
          } else if (
            type === "response.output_item.added" ||
            type === "response.output_item.done"
          ) {
            const item =
              typeof parsed.item === "object" && parsed.item !== null
                ? (parsed.item as Record<string, unknown>)
                : null;
            if (!item || item.type !== "function_call") return;
            const itemId = typeof item.id === "string" ? item.id : "";
            if (!itemId) return;
            const callId =
              typeof item.call_id === "string" ? item.call_id : "";
            const name = typeof item.name === "string" ? item.name : "";
            const args =
              typeof item.arguments === "string" ? item.arguments : "";
            const existing = toolCallsMap.get(itemId);
            if (existing) {
              if (callId) existing.callId = callId;
              if (name) existing.name = name;
              if (args) existing.arguments = args;
            } else {
              toolCallsMap.set(itemId, { callId, name, arguments: args });
            }
          } else if (type === "response.function_call_arguments.delta") {
            const itemId =
              typeof parsed.item_id === "string" ? parsed.item_id : "";
            const delta =
              typeof parsed.delta === "string" ? parsed.delta : "";
            if (!itemId || !delta) return;
            const tc = toolCallsMap.get(itemId);
            if (tc) tc.arguments += delta;
          } else if (type === "response.function_call_arguments.done") {
            const itemId =
              typeof parsed.item_id === "string" ? parsed.item_id : "";
            const args =
              typeof parsed.arguments === "string" ? parsed.arguments : "";
            if (!itemId) return;
            const tc = toolCallsMap.get(itemId);
            if (tc && args) tc.arguments = args;
          } else if (type === "response.completed") {
            const resp =
              typeof parsed.response === "object" && parsed.response !== null
                ? (parsed.response as Record<string, unknown>)
                : null;
            if (resp && typeof resp.status === "string") status = resp.status;
          } else if (
            type === "response.failed" ||
            type === "response.error"
          ) {
            const errObj =
              typeof parsed.error === "object" && parsed.error !== null
                ? (parsed.error as Record<string, unknown>)
                : {};
            const msg =
              typeof errObj.message === "string"
                ? errObj.message
                : `Codex-Stream-Error (${type})`;
            throw new Error(`[codex-vercel-provider:doStream] ${msg}`);
          }
          // Bekannte No-Op-Events + unbekannte → ignorieren
        };

        const processRawEvent = (rawEvent: string): void => {
          const dataLine = rawEvent
            .split("\n")
            .find((l) => l.startsWith("data: "));
          if (!dataLine) return;
          const dataStr = dataLine.slice(6).trim();
          if (dataStr === "[DONE]") return;
          try {
            const parsed = JSON.parse(dataStr) as unknown;
            if (typeof parsed === "object" && parsed !== null) {
              handleEvent(parsed as Record<string, unknown>);
            }
          } catch (parseErr) {
            // JSON.parse-Fehler → ignorieren (Konsistenz mit CodexSSEParser).
            // Alle anderen Fehler (aus handleEvent) nach oben propagieren.
            if (parseErr instanceof SyntaxError) return;
            throw parseErr;
          }
        };

        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) {
              if (buffer.trim()) processRawEvent(buffer);
              break;
            }
            buffer += decoder.decode(value, { stream: true });
            const parts = buffer.split("\n\n");
            buffer = parts.pop() ?? "";
            for (const rawEvent of parts) {
              if (rawEvent.trim()) processRawEvent(rawEvent);
            }
          }

          // Text-Ende signalisieren
          if (textStarted) {
            controller.enqueue({ type: "text-end", id: TEXT_ID });
          }

          // Tool-Calls atomar am Ende (kein streaming der Args)
          for (const tc of toolCallsMap.values()) {
            controller.enqueue({
              type: "tool-call",
              toolCallId: tc.callId || tc.name,
              toolName: tc.name,
              input: tc.arguments,
            } satisfies LanguageModelV3ToolCall);
          }

          // Finish-Chunk (Pflicht, letzter Chunk)
          const hasToolCalls = toolCallsMap.size > 0;
          controller.enqueue({
            type: "finish",
            finishReason: {
              unified: hasToolCalls
                ? "tool-calls"
                : status === "completed"
                  ? "stop"
                  : status === "incomplete"
                    ? "length"
                    : "other",
              raw: status ?? undefined,
            },
            usage: {
              inputTokens: {
                total: undefined,
                noCache: undefined,
                cacheRead: undefined,
                cacheWrite: undefined,
              },
              outputTokens: {
                total: undefined,
                text: undefined,
                reasoning: undefined,
              },
            },
          });

          controller.close();
        } catch (err) {
          controller.error(err);
        } finally {
          reader.releaseLock();
        }
      },
    });

    return { stream };
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

// Content-Parts eines user-message-Items im Codex-Input. input_text wie bisher;
// input_image (SS3b) = Spike-Format (image_url als data-URI). Der Adapter reicht
// den Inhalt transparent als JSON durch (kein schmaler Wire-Type nötig).
type CodexUserContentPart =
  | { type: "input_text"; text: string }
  | { type: "input_image"; image_url: string; detail: string }
  | { type: "input_file"; filename: string; file_data: string };

/**
 * Baut aus V3-FilePart-Daten den `image_url`-String fürs Codex-input_image.
 * V3-`data` ist `Uint8Array | string(base64) | URL`. SS3a/SS2 liefern Bytes
 * (Uint8Array) → base64-data-URI; eine bereits fertige data:-URL oder http(s)-
 * URL wird unverändert durchgereicht.
 */
function fileDataToDataUri(data: unknown, mediaType: string): string {
  if (data instanceof URL) return data.toString();
  if (typeof data === "string") {
    return data.startsWith("data:") ? data : `data:${mediaType};base64,${data}`;
  }
  if (data instanceof Uint8Array) {
    return `data:${mediaType};base64,${Buffer.from(data).toString("base64")}`;
  }
  // Defensiv: Buffer/ArrayBuffer-artiges → base64; sonst leerer data-URI.
  try {
    return `data:${mediaType};base64,${Buffer.from(data as Uint8Array).toString("base64")}`;
  } catch {
    return `data:${mediaType};base64,`;
  }
}

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
      // Multimodal SS3b: ALLE Parts mappen statt nur text zu filtern.
      //   - text  → input_text (UNVERÄNDERT: alle text-Parts wie bisher mit
      //             "\n" gejoint zu EINEM input_text → kein Wire-Drift).
      //   - file (image/*) → input_image im Spike-Format (image_url data-URI, d5e757e).
      //   - file (application/pdf) → 🔴 input_file im Spike-Format (file_data
      //     data-URI + filename, OpenAI-Responses, PDF-Spike 5fc3251).
      const textParts: string[] = [];
      const mediaParts: CodexUserContentPart[] = [];
      for (const part of msg.content) {
        if (part.type === "text") {
          textParts.push(part.text);
        } else if (part.type === "file" && typeof part.mediaType === "string") {
          if (part.mediaType.startsWith("image/")) {
            mediaParts.push({
              type: "input_image",
              image_url: fileDataToDataUri(part.data, part.mediaType),
              detail: "auto",
            });
          } else if (part.mediaType === "application/pdf") {
            mediaParts.push({
              type: "input_file",
              filename: part.filename ?? "document.pdf",
              file_data: fileDataToDataUri(part.data, part.mediaType),
            });
          }
          // andere File-Typen ignoriert (nur image + pdf unterstützt).
        }
        // andere Part-Typen (z.B. reasoning) im user-Slot: kein Codex-Effekt.
      }
      const text = textParts.join("\n");
      const content: CodexUserContentPart[] = [];
      if (text.length > 0) content.push({ type: "input_text", text });
      for (const part of mediaParts) content.push(part);
      // 🔴 Abwärtskompat-Edge: ohne Bild + leerer Text → exakt wie heute EIN
      // (leeres) input_text, damit der reine Text-Pfad byte-identisch bleibt.
      if (content.length === 0) content.push({ type: "input_text", text });
      input.push({
        type: "message",
        role: "user",
        content,
      } as unknown as CodexInputItemAny);
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
