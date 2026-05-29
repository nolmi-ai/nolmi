import "dotenv/config";

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// ─── #131 PHASE 3.3.2 SPIKE — MULTI-STEP-TOOL-ROUNDTRIP-DISCOVERY ────────────
//
// Zweiter Discovery-Spike der Phase 3.3. Phase 3.3.0 hat das Tool-Call-
// Event-Format verifiziert (§k). Phase 3.3.2 verifiziert das Tool-Result-
// Roundtrip-Format: wie wird ein Tool-Output an Codex zurückgegeben, damit
// der Twin eine finale Antwort generieren kann?
//
// Spike-Disziplin (analog Phase 3.0, 3.3.0):
//   - Token-Quelle ~/.codex/auth.json direkt (Memory-Setzung Discovery vs.
//     Production-Pfad)
//   - Kein CodexSSEParser-Touch, kein TwinService-Wiring (Phase 3.3.1)
//   - Mock-Tool + Mock-Result, keine echte Tool-Execution
//
// Scope-Reduktion gegenüber initialem Briefing: Tool-Definition-Format ist
// konzeptionell geklärt (Phase 3.3.0 hat HTTP 200 mit Hand-built-Format
// gezeigt, Codex hat strict:true auto-ergänzt). Hauptfokus 3.3.2 ist
// Multi-Step. Step 1 dient als Setup zum Capturen eines echten callId,
// Step 2 testet 3 Hypothesen sequenziell:
//
//   A) function_call_output im input-Array (gleiche conversation)
//   B) previous_response_id im body
//   C) Tool-Output als context-Message in instructions (Fallback-Pattern)
//
// Stop-Punkt: erste 2xx-Hypothese gewinnt. Final-Events der erfolgreichen
// Variante werden gedumped, damit §l mit echtem Response-Format dokumentiert
// werden kann.
//
// Aufruf:
//   pnpm --filter @nolmi/runtime twin:oauth-phase3-3-2-spike

const CODEX_ENDPOINT = "https://chatgpt.com/backend-api/codex/responses";
const CODEX_AUTH_PATH = path.resolve(os.homedir(), ".codex/auth.json");

interface CodexAuthFile {
  tokens?: { access_token?: string };
}

interface MakeRequestResult {
  status: number;
  events: string[];
  responseId?: string;
  toolCall?: {
    itemId: string;
    callId: string;
    name: string;
    arguments: string;
  };
  finalText: string;
  errorBody?: string;
}

function loadAccessToken(): string {
  if (!fs.existsSync(CODEX_AUTH_PATH)) {
    throw new Error(`Codex-Auth-File fehlt: ${CODEX_AUTH_PATH}`);
  }
  const auth = JSON.parse(
    fs.readFileSync(CODEX_AUTH_PATH, "utf-8"),
  ) as CodexAuthFile;
  const token = auth.tokens?.access_token;
  if (!token) throw new Error(`Kein access_token in ${CODEX_AUTH_PATH}`);
  return token;
}

const accessToken = loadAccessToken();

const mockTools = [
  {
    type: "function",
    name: "get_current_time",
    description: "Get the current time in a specific IANA timezone.",
    parameters: {
      type: "object",
      properties: {
        timezone: {
          type: "string",
          description: "IANA timezone like 'Europe/Berlin'.",
        },
      },
      required: ["timezone"],
      additionalProperties: false,
    },
  },
];

async function makeRequest(
  body: Record<string, unknown>,
  label: string,
): Promise<MakeRequestResult> {
  console.log(`\n=== ${label} ===`);
  const startMs = Date.now();
  const res = await fetch(CODEX_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      "OpenAI-Beta": "responses=v1",
    },
    body: JSON.stringify(body),
  });
  const httpMs = Date.now() - startMs;
  console.log(`  HTTP ${res.status} (${httpMs}ms to first byte)`);

  if (!res.ok) {
    const errBody = await res.text().catch(() => "");
    console.log(`  Error-Body (first 600 chars):`);
    console.log(`  ${errBody.slice(0, 600).split("\n").join("\n  ")}`);
    return {
      status: res.status,
      events: [],
      finalText: "",
      errorBody: errBody,
    };
  }

  // SSE-Collect
  const events: string[] = [];
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const blocks = buffer.split("\n\n");
    buffer = blocks.pop() ?? "";
    for (const b of blocks) if (b.trim()) events.push(b);
  }
  if (buffer.trim()) events.push(buffer);

  // Extract: responseId, toolCall, finalText
  let responseId: string | undefined;
  let toolCall: MakeRequestResult["toolCall"];
  let finalText = "";
  for (const e of events) {
    const dataLine = e.split("\n").find((l) => l.startsWith("data: "));
    if (!dataLine) continue;
    const dataStr = dataLine.slice(6).trim();
    if (dataStr === "[DONE]") continue;
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(dataStr) as Record<string, unknown>;
    } catch {
      continue;
    }
    const type = parsed.type;
    if (type === "response.created" || type === "response.completed") {
      const r = parsed.response as { id?: string } | undefined;
      if (r?.id && !responseId) responseId = r.id;
    }
    if (type === "response.output_item.added") {
      const item = parsed.item as
        | { type?: string; id?: string; call_id?: string; name?: string; arguments?: string }
        | undefined;
      if (item?.type === "function_call") {
        toolCall = {
          itemId: item.id ?? "",
          callId: item.call_id ?? "",
          name: item.name ?? "",
          arguments: item.arguments ?? "",
        };
      }
    }
    if (type === "response.function_call_arguments.done" && toolCall) {
      const args = parsed.arguments;
      if (typeof args === "string") toolCall.arguments = args;
    }
    if (type === "response.output_text.delta") {
      const delta = parsed.delta;
      if (typeof delta === "string") finalText += delta;
    }
  }

  console.log(
    `  Events: ${events.length}, responseId: ${responseId ?? "(none)"}, ` +
      `toolCall: ${toolCall ? `${toolCall.name}(${toolCall.arguments})` : "no"}, ` +
      `finalText: ${finalText.length > 0 ? `"${finalText.slice(0, 80)}…"` : "(empty)"}`,
  );

  return {
    status: res.status,
    events,
    responseId,
    toolCall,
    finalText,
  };
}

function dumpEventTypes(events: string[]): void {
  const types = new Map<string, number>();
  for (const e of events) {
    const dataLine = e.split("\n").find((l) => l.startsWith("data: "));
    if (!dataLine) continue;
    const dataStr = dataLine.slice(6).trim();
    if (dataStr === "[DONE]") {
      types.set("[DONE]", (types.get("[DONE]") ?? 0) + 1);
      continue;
    }
    try {
      const parsed = JSON.parse(dataStr) as { type?: string };
      const t = parsed.type ?? "(no-type)";
      types.set(t, (types.get(t) ?? 0) + 1);
    } catch {
      types.set("(parse-error)", (types.get("(parse-error)") ?? 0) + 1);
    }
  }
  console.log("  Event-Type-Histogram:");
  for (const [t, c] of [...types.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`    ${String(c).padStart(3)}× ${t}`);
  }
}

async function main(): Promise<void> {
  console.log("=== #131 Phase 3.3.2 Spike — Multi-Step-Tool-Roundtrip ===\n");

  // ── SETUP: Step 1 — Tool-Call provozieren um callId zu bekommen ──────────
  // Re-Run von Phase 3.3.0-Pattern. Ergebnis: callId/itemId/name/arguments.
  const userPrompt =
    "What time is it in Berlin right now? Use the get_current_time tool.";
  const step1Body = {
    model: "gpt-5.5",
    instructions:
      "You are a helpful assistant. When the user asks about time, you MUST call the get_current_time tool — do not answer from your own knowledge.",
    input: [
      {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: userPrompt }],
      },
    ],
    tools: mockTools,
    tool_choice: "auto",
    parallel_tool_calls: false,
    store: false,
    stream: true,
  };
  const step1 = await makeRequest(step1Body, "STEP 1 (Setup): Tool-Call triggern");

  if (step1.status !== 200) {
    console.error("\n❌ Step 1 failed — Setup nicht möglich, Spike abgebrochen.");
    process.exit(1);
  }
  if (!step1.toolCall) {
    console.error(
      "\n⚠️  Step 1: Codex hat keinen Tool-Call gemacht — Setup fehlgeschlagen.",
    );
    process.exit(1);
  }
  console.log(
    `\n✅ Setup ok. callId=${step1.toolCall.callId}, itemId=${step1.toolCall.itemId}`,
  );

  // Mock-Tool-Result (würde von echtem MCP-Tool-Call kommen)
  const mockToolOutput = JSON.stringify({
    time: "2026-05-25T14:30:00+02:00",
    timezone: "Europe/Berlin",
  });

  // ── HYPOTHESE A — function_call_output im input-Array (OpenAI-Standard) ─
  // Pattern matched OpenAI Responses API: User-Message + function_call-Item
  // (echo des LLM-Calls) + function_call_output-Item (Tool-Result) im
  // input-Array, gleiche tools-Definition, kein previous_response_id.
  const step2aBody = {
    model: "gpt-5.5",
    instructions: step1Body.instructions,
    input: [
      {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: userPrompt }],
      },
      {
        type: "function_call",
        call_id: step1.toolCall.callId,
        name: step1.toolCall.name,
        arguments: step1.toolCall.arguments,
      },
      {
        type: "function_call_output",
        call_id: step1.toolCall.callId,
        output: mockToolOutput,
      },
    ],
    tools: mockTools,
    tool_choice: "auto",
    parallel_tool_calls: false,
    store: false,
    stream: true,
  };
  const step2a = await makeRequest(
    step2aBody,
    "HYPOTHESE A: function_call_output im input-Array",
  );

  let winner: "A" | "B" | "C" | null = null;
  let winnerResult: MakeRequestResult | null = null;

  if (step2a.status === 200 && step2a.finalText.length > 0) {
    winner = "A";
    winnerResult = step2a;
    console.log("\n✅ HYPOTHESE A funktioniert.");
  } else {
    console.log(
      `\n⚠️  HYPOTHESE A status=${step2a.status} text="${step2a.finalText.slice(0, 60)}" — versuche B.`,
    );

    // ── HYPOTHESE B — previous_response_id ──────────────────────────────────
    const step2bBody = {
      model: "gpt-5.5",
      previous_response_id: step1.responseId,
      input: [
        {
          type: "function_call_output",
          call_id: step1.toolCall.callId,
          output: mockToolOutput,
        },
      ],
      store: false,
      stream: true,
    };
    const step2b = await makeRequest(
      step2bBody,
      "HYPOTHESE B: previous_response_id + nur function_call_output",
    );

    if (step2b.status === 200 && step2b.finalText.length > 0) {
      winner = "B";
      winnerResult = step2b;
      console.log("\n✅ HYPOTHESE B funktioniert.");
    } else {
      console.log(
        `\n⚠️  HYPOTHESE B status=${step2b.status} text="${step2b.finalText.slice(0, 60)}" — versuche C.`,
      );

      // ── HYPOTHESE C — Tool-Output als context-Message in instructions ────
      const step2cBody = {
        model: "gpt-5.5",
        instructions:
          "You are a helpful assistant. The user asked about Berlin time. " +
          `The get_current_time tool returned: ${mockToolOutput}. ` +
          "Now provide a natural-language answer.",
        input: [
          {
            type: "message",
            role: "user",
            content: [{ type: "input_text", text: userPrompt }],
          },
        ],
        store: false,
        stream: true,
      };
      const step2c = await makeRequest(
        step2cBody,
        "HYPOTHESE C: Tool-Output als context, neuer Roundtrip ohne tools",
      );

      if (step2c.status === 200 && step2c.finalText.length > 0) {
        winner = "C";
        winnerResult = step2c;
        console.log("\n✅ HYPOTHESE C funktioniert (Fallback-Pattern).");
      } else {
        console.log("\n❌ Alle 3 Hypothesen failed — Surprise-Finding.");
      }
    }
  }

  if (!winner || !winnerResult) {
    console.log("\n=== Spike-Output: Keine Hypothese erfolgreich ===");
    process.exit(1);
  }

  // ── Winner-Detail-Dump für §l-Doku ──────────────────────────────────────
  console.log(`\n\n=== Winner-Detail: HYPOTHESE ${winner} ===`);
  dumpEventTypes(winnerResult.events);
  console.log(`\n  finalText (full): "${winnerResult.finalText}"`);
  console.log(`\n  responseId: ${winnerResult.responseId}`);
  console.log(`  Events total: ${winnerResult.events.length}`);

  console.log(`\n=== Raw Events der Winner-Hypothese (alle ${winnerResult.events.length}) ===\n`);
  for (let i = 0; i < winnerResult.events.length; i++) {
    console.log(`--- Event ${i + 1} ---`);
    console.log(winnerResult.events[i]);
    console.log();
  }

  console.log("=== Spike komplett ===");
  console.log(
    `→ Findings in docs/131-OAUTH-STRATEGY.md §l dokumentieren ` +
      `(Winner=${winner}, Multi-Step-Format mit echtem Roundtrip-Output).`,
  );
}

main().catch((err) => {
  console.error("\n❌ Spike failed:", err);
  process.exit(1);
});
