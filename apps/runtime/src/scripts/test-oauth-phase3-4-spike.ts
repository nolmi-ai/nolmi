import "dotenv/config";

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { generateText, stepCountIs, tool } from "ai";
import { z } from "zod";

import type {
  LanguageModelV3,
  LanguageModelV3CallOptions,
  LanguageModelV3GenerateResult,
  LanguageModelV3StreamResult,
  LanguageModelV3Content,
  LanguageModelV3Prompt,
  LanguageModelV3FunctionTool,
  LanguageModelV3ProviderTool,
} from "@ai-sdk/provider";

import { CodexSSEParser } from "../oauth/codex-sse-parser.js";

// ─── #131 PHASE 3.4.0 SPIKE — VERCEL-PROVIDER-MAPPING-DISCOVERY ─────────────
//
// Vierter Discovery-Spike der #131-Reihe (3.0, 3.3.0, 3.3.2, 3.3.3.0, 3.4.0).
// Frage: lässt sich der existing CodexAdapter als Vercel AI SDK V3
// Custom-Provider verpacken? Wenn ja → Phase 3.4 Vollbau kann
// runModelViaCodex eliminieren (~600 LOC) und Vercel-SDK Multi-Step/Reasoning/
// Approval-Mechanik nutzen.
//
// Spike-Disziplin (Memory `feedback_oauth_token_source_spike_vs_production`):
//   - Token aus ~/.codex/auth.json direkt (Discovery-Pfad)
//   - Kein CodexAdapter-Import (würde OAuthRefreshService-DI brauchen)
//   - CodexSSEParser-Import OK (Parser-Logik ist provider-spec-agnostisch)
//   - Inline Provider-Factory, disposable Script
//
// Scope (Setzung β):
//   Test 1: doGenerate + Simple-Text → Basis-Mapping verifizieren
//   Test 2: doGenerate + Tool-Definition + Multi-Step-Loop via Vercel-SDK →
//           Tool-Roundtrip ohne eigenen Loop in runModelViaCodex
//
// Out of Scope:
//   - doStream (Spike fokussiert auf doGenerate-Mapping)
//   - tool-approval-request-Emission (wäre Phase 3.4.3)
//   - Reasoning-Items-Mapping als V3 ReasoningPart (würde funktionieren,
//     aber summary:[] heißt nur leerer text-String — trivial, kein Spike-Wert)
//
// Aufruf: pnpm --filter @nolmi/runtime twin:oauth-phase3-4-spike

const CODEX_ENDPOINT = "https://chatgpt.com/backend-api/codex/responses";
const CODEX_AUTH_PATH = path.resolve(os.homedir(), ".codex/auth.json");
const DEFAULT_MODEL = "gpt-5.5";
const HEURISTIC_TOKEN_LIFETIME_SEC = 3600;

interface CodexAuthFile {
  tokens?: { access_token?: string };
  last_refresh?: string;
}

// ─── TOKEN PRE-CHECK (Pattern aus Phase 3.3.3.0-Spike) ──────────────────────

function decodeJwtExp(jwt: string): number | null {
  const parts = jwt.split(".");
  if (parts.length !== 3) return null;
  const payloadRaw = parts[1];
  if (!payloadRaw) return null;
  try {
    const payloadB64 = payloadRaw.replace(/-/g, "+").replace(/_/g, "/");
    const padding = "=".repeat((4 - (payloadB64.length % 4)) % 4);
    const payloadJson = Buffer.from(payloadB64 + padding, "base64").toString(
      "utf-8",
    );
    const payload = JSON.parse(payloadJson) as { exp?: number };
    return typeof payload.exp === "number" ? payload.exp : null;
  } catch {
    return null;
  }
}

function loadAndCheckAccessToken(): string {
  if (!fs.existsSync(CODEX_AUTH_PATH)) {
    throw new Error(
      `Codex-Auth-File fehlt: ${CODEX_AUTH_PATH}\n→ 'codex login --force' ausführen.`,
    );
  }
  const auth = JSON.parse(
    fs.readFileSync(CODEX_AUTH_PATH, "utf-8"),
  ) as CodexAuthFile;
  const token = auth.tokens?.access_token;
  if (!token) {
    throw new Error(
      `Kein access_token in ${CODEX_AUTH_PATH}\n→ 'codex login --force' ausführen.`,
    );
  }
  const nowSec = Math.floor(Date.now() / 1000);
  const jwtExp = decodeJwtExp(token);
  if (jwtExp !== null) {
    if (jwtExp - nowSec <= 0) {
      throw new Error(
        `access_token expired (exp=${jwtExp}, now=${nowSec}).\n→ 'codex login --force'.`,
      );
    }
    console.log(`🔑 Token: gültig noch ~${((jwtExp - nowSec) / 60).toFixed(0)}min`);
  } else if (auth.last_refresh) {
    const ageSec = (Date.now() - Date.parse(auth.last_refresh)) / 1000;
    if (HEURISTIC_TOKEN_LIFETIME_SEC - ageSec <= 0) {
      throw new Error(
        `Token vermutlich expired (last_refresh ${ageSec.toFixed(0)}s alt).\n→ 'codex login --force'.`,
      );
    }
    console.log(`🔑 Token-Heuristik: ${ageSec.toFixed(0)}s seit Refresh, vermutlich gültig`);
  }
  return token;
}

// ─── MAPPING: Vercel V3 Prompt → Codex Input ─────────────────────────────────
//
// V3-Message-Rollen:
//   - 'system'    → top-level instructions-Field (Codex hat dedicated slot)
//   - 'user'      → message-Item, role:"user", input_text-Parts
//   - 'assistant' → message-Item, role:"assistant", output_text-Parts
//                   PLUS Tool-Call-Parts → function_call-Items
//   - 'tool'      → tool-result-Parts → function_call_output-Items
//
// Multi-Step: Vercel-SDK ruft doGenerate mehrfach auf, jedes Mal mit
// History + Tool-Call-Echo + Tool-Result-Message im Prompt. Provider muss
// das in Codex' §l-Pattern (function_call + function_call_output ans
// input-Array) übersetzen.

function mapV3PromptToCodex(prompt: LanguageModelV3Prompt): {
  instructions: string;
  input: unknown[];
} {
  const instructionsParts: string[] = [];
  const input: unknown[] = [];

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
      // Text-Parts → message-Item; Tool-Call-Parts → function_call-Items
      const textParts: string[] = [];
      for (const p of msg.content) {
        if (p.type === "text") textParts.push(p.text);
        else if (p.type === "tool-call") {
          input.push({
            type: "function_call",
            call_id: p.toolCallId,
            name: p.toolName,
            arguments:
              typeof p.input === "string" ? p.input : JSON.stringify(p.input),
          });
        }
        // reasoning/file ignoriert für Spike (kein Roundtrip-Effekt)
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
      // Tool-Result-Parts → function_call_output-Items
      for (const p of msg.content) {
        if (p.type === "tool-result") {
          const output =
            typeof p.output === "object" && p.output !== null
              ? "value" in p.output
                ? typeof p.output.value === "string"
                  ? p.output.value
                  : JSON.stringify(p.output.value)
                : JSON.stringify(p.output)
              : String(p.output);
          input.push({
            type: "function_call_output",
            call_id: p.toolCallId,
            output,
          });
        }
      }
      continue;
    }
  }

  return {
    instructions: instructionsParts.join("\n\n"),
    input,
  };
}

// ─── MAPPING: Vercel V3 Tools → Codex tools-Field ───────────────────────────

function mapV3ToolsToCodex(
  tools:
    | Array<LanguageModelV3FunctionTool | LanguageModelV3ProviderTool>
    | undefined,
): Array<{
  type: "function";
  name: string;
  description?: string;
  parameters: object;
}> {
  if (!tools || tools.length === 0) return [];
  const out: Array<{
    type: "function";
    name: string;
    description?: string;
    parameters: object;
  }> = [];
  for (const t of tools) {
    if (t.type !== "function") continue; // Provider-defined tools ignored
    out.push({
      type: "function",
      name: t.name,
      ...(t.description ? { description: t.description } : {}),
      parameters: t.inputSchema as object,
    });
  }
  return out;
}

// ─── INLINE PROVIDER-FACTORY ────────────────────────────────────────────────

interface CodexProviderConfig {
  accessToken: string;
}

function createCodexProvider(config: CodexProviderConfig): {
  languageModel(modelId: string): LanguageModelV3;
} {
  return {
    languageModel(modelId: string): LanguageModelV3 {
      return {
        specificationVersion: "v3" as const,
        provider: "openai-codex-spike",
        modelId,
        supportedUrls: {},

        async doGenerate(
          options: LanguageModelV3CallOptions,
        ): Promise<LanguageModelV3GenerateResult> {
          const { instructions, input } = mapV3PromptToCodex(options.prompt);
          const codexTools = mapV3ToolsToCodex(options.tools);

          const body = {
            model: modelId,
            instructions,
            input,
            tools: codexTools,
            tool_choice: "auto",
            parallel_tool_calls: false,
            store: false,
            stream: true,
          };

          const startMs = Date.now();
          const res = await fetch(CODEX_ENDPOINT, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${config.accessToken}`,
              "Content-Type": "application/json",
              "OpenAI-Beta": "responses=v1",
            },
            body: JSON.stringify(body),
          });

          if (!res.ok) {
            const errBody = await res.text().catch(() => "<no body>");
            throw new Error(
              `[codex-provider-spike] HTTP ${res.status}: ${errBody.slice(0, 300)}`,
            );
          }

          const parser = new CodexSSEParser();
          const parseResult = await parser.parse(res.body);
          const latencyMs = Date.now() - startMs;

          // ─── CodexAdapterOutput → V3GenerateResult.content[] ──────────────
          const content: LanguageModelV3Content[] = [];

          // Text-Content (falls vorhanden)
          if (parseResult.text) {
            content.push({ type: "text", text: parseResult.text });
          }

          // Tool-Calls (V3 ToolCall hat input als JSON-String — Codex liefert
          // arguments schon als String, also 1:1 pass-through)
          for (const tc of parseResult.toolCalls) {
            content.push({
              type: "tool-call",
              toolCallId: tc.callId,
              toolName: tc.name,
              input: tc.arguments,
            });
          }

          // Reasoning (heute leer, summary:[] → text:"")
          for (const _trace of parseResult.reasoningTraces) {
            content.push({ type: "reasoning", text: "" });
          }

          // FinishReason
          const finishReasonUnified =
            parseResult.toolCalls.length > 0
              ? ("tool-calls" as const)
              : ("stop" as const);

          return {
            content,
            finishReason: {
              unified: finishReasonUnified,
              raw: parseResult.status,
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
                reasoning: parseResult.reasoningTokens,
              },
            },
            providerMetadata: {
              "openai-codex": {
                planType: res.headers.get("x-codex-plan-type") ?? "",
                cfRay: res.headers.get("cf-ray") ?? "",
                latencyMs,
                responseId: parseResult.responseId ?? "",
                codexStatus: parseResult.status ?? "",
              },
            },
            warnings: [],
          };
        },

        async doStream(
          _options: LanguageModelV3CallOptions,
        ): Promise<LanguageModelV3StreamResult> {
          throw new Error(
            "[codex-provider-spike] doStream not implemented in spike — Test 1+2 nutzen generateText (doGenerate-only)",
          );
        },
      };
    },
  };
}

// ─── TESTS ──────────────────────────────────────────────────────────────────

async function runTest1(provider: ReturnType<typeof createCodexProvider>) {
  console.log("\n═══ TEST 1 — Simple Text via generateText ═══");
  const startMs = Date.now();
  const result = await generateText({
    model: provider.languageModel(DEFAULT_MODEL),
    system:
      "You are a helpful assistant. Answer briefly in German.",
    prompt: "Was ist 17 plus 25?",
  });
  console.log(`✓ ${Date.now() - startMs}ms`);
  console.log(`  text: "${result.text.slice(0, 100)}"`);
  console.log(`  finishReason: ${result.finishReason}`);
  console.log(`  usage:`, result.usage);
  console.log(`  providerMetadata:`, result.providerMetadata);
}

async function runTest2(provider: ReturnType<typeof createCodexProvider>) {
  console.log("\n═══ TEST 2 — Tool-Roundtrip via Multi-Step ═══");
  const startMs = Date.now();
  const result = await generateText({
    model: provider.languageModel(DEFAULT_MODEL),
    system:
      "You are a helpful assistant. Use the get_sum tool when asked to add numbers.",
    prompt: "Use the get_sum tool to add 17 and 25, then tell me the answer in German.",
    tools: {
      get_sum: tool({
        description: "Returns the sum of a and b",
        inputSchema: z.object({
          a: z.number().describe("First number"),
          b: z.number().describe("Second number"),
        }),
        execute: async ({ a, b }: { a: number; b: number }) => ({
          sum: a + b,
        }),
      }),
    },
    stopWhen: stepCountIs(5),
  });
  console.log(`✓ ${Date.now() - startMs}ms`);
  console.log(`  text: "${result.text.slice(0, 200)}"`);
  console.log(`  finishReason: ${result.finishReason}`);
  console.log(`  steps: ${result.steps.length}`);
  console.log(`  toolCalls (top-level): ${result.toolCalls.length}`);
  console.log(`  toolResults (top-level): ${result.toolResults.length}`);
  for (let i = 0; i < result.steps.length; i++) {
    const s = result.steps[i];
    if (!s) continue;
    console.log(
      `  step[${i}]: text="${s.text.slice(0, 60)}", toolCalls=${s.toolCalls.length}, toolResults=${s.toolResults.length}, finishReason=${s.finishReason}`,
    );
    for (const tc of s.toolCalls) {
      console.log(
        `    - tool-call: ${tc.toolName}(${JSON.stringify(tc.input)}) callId=${tc.toolCallId}`,
      );
    }
    for (const tr of s.toolResults) {
      console.log(
        `    - tool-result: ${tr.toolName} → ${JSON.stringify(tr.output)}`,
      );
    }
  }
}

// ─── MAIN ────────────────────────────────────────────────────────────────────

async function main() {
  console.log("=== #131 Phase 3.4.0 Spike — Vercel-Provider-Mapping ===");
  const accessToken = loadAndCheckAccessToken();
  const provider = createCodexProvider({ accessToken });

  let test1Ok = false;
  let test2Ok = false;

  try {
    await runTest1(provider);
    test1Ok = true;
  } catch (err) {
    console.error("❌ Test 1 failed:", err instanceof Error ? err.message : err);
    if (err instanceof Error && err.stack) {
      console.error(err.stack.split("\n").slice(0, 6).join("\n"));
    }
  }

  try {
    await runTest2(provider);
    test2Ok = true;
  } catch (err) {
    console.error("❌ Test 2 failed:", err instanceof Error ? err.message : err);
    if (err instanceof Error && err.stack) {
      console.error(err.stack.split("\n").slice(0, 6).join("\n"));
    }
  }

  console.log("\n═══ Spike-Summary ═══");
  console.log(`  Test 1 (Simple-Text): ${test1Ok ? "✅" : "❌"}`);
  console.log(`  Test 2 (Tool-Roundtrip): ${test2Ok ? "✅" : "❌"}`);
  if (test1Ok && test2Ok) {
    console.log("\n→ Phase-3.4-Vollbau-Empfehlung: ✅ LOHNT SICH");
    console.log("  - Basis-Mapping funktioniert");
    console.log("  - Vercel-Multi-Step-Loop greift mit Codex-Backend");
    console.log("  - runModelViaCodex (~600 LOC) kann eliminiert werden");
  } else if (test1Ok && !test2Ok) {
    console.log("\n→ Phase-3.4-Vollbau-Empfehlung: ⚠️ TEILWEISE");
    console.log("  - Basis funktioniert, Tool-Loop nicht");
    console.log("  - Code-Diagnose nötig vor Vollbau");
  } else {
    console.log("\n→ Phase-3.4-Vollbau-Empfehlung: ❌ SKIP");
    console.log("  - Basis-Mapping bricht — fundamentaler Mismatch");
  }
}

main().catch((err) => {
  console.error("\n❌ Spike-Fehler:", err instanceof Error ? err.message : err);
  if (err instanceof Error && "cause" in err) {
    console.error("   cause:", err.cause);
  }
  process.exit(1);
});
