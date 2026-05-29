import "dotenv/config";

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// ─── #131 PHASE 3.3.0 SPIKE — CODEX-TOOL-CALL-EVENT-DISCOVERY ────────────────
//
// Reverse-Engineering-Spike: triggert einen Codex-Tool-Call mit einer
// Mock-Function-Definition und dumped die Raw-SSE-Events. Ziel ist NICHT
// pass/fail, sondern Discovery-Daten für Phase 3.3.1 (Parser-Erweiterung +
// CodexAdapter-Integration + MCP-Pipeline-Wiring).
//
// Token-Quelle: ~/.codex/auth.json direkt (Memory-Setzung "Discovery-Spikes
// lesen Token direkt, Production-Tests gehen über DB + OAuthRefreshService").
// Kein DB-Touch, kein authMode-Switch, kein Setup/Cleanup-Mode.
//
// Out of Scope für 3.3.0:
//   - CodexSSEParser-Erweiterung (Phase 3.3.1 auf verifizierter Hypothese)
//   - Echte Tool-Execution (Mock-Result)
//   - Multi-Step-Round-Trip (Tool-Call → Result → Continue)
//   - TwinService-Integration
//   - Frontend/UI-Display
//
// Aufruf:
//   pnpm --filter @nolmi/runtime twin:oauth-phase3-3-spike

const CODEX_ENDPOINT = "https://chatgpt.com/backend-api/codex/responses";
const CODEX_AUTH_PATH = path.resolve(os.homedir(), ".codex/auth.json");

interface CodexAuthFile {
  tokens?: { access_token?: string };
}

function loadAccessToken(): string {
  if (!fs.existsSync(CODEX_AUTH_PATH)) {
    throw new Error(
      `Codex-Auth-File nicht gefunden: ${CODEX_AUTH_PATH}. ` +
        `Bitte 'codex login' lokal laufen lassen vor dem Spike.`,
    );
  }
  const auth = JSON.parse(
    fs.readFileSync(CODEX_AUTH_PATH, "utf-8"),
  ) as CodexAuthFile;
  const token = auth.tokens?.access_token;
  if (!token) {
    throw new Error(
      `Kein access_token in ${CODEX_AUTH_PATH}. ` +
        `'codex login --force' für frischen Token.`,
    );
  }
  return token;
}

async function main(): Promise<void> {
  console.log("=== #131 Phase 3.3.0 Spike — Tool-Call-Event-Discovery ===\n");

  const accessToken = loadAccessToken();
  console.log(`✅ Codex-Token aus ${CODEX_AUTH_PATH} geladen\n`);

  // Mock-Function-Definition. Schema folgt OpenAI Responses API
  // (function-Items: name + description + parameters JSON-Schema).
  // Required-Field testet Codex' Validation-Pfad, parameters bewusst
  // minimal — wir interessieren uns für das Tool-Call-Event-Format,
  // nicht für komplexe Arg-Generierung.
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
            description:
              "IANA timezone like 'Europe/Berlin' or 'America/New_York'.",
          },
        },
        required: ["timezone"],
        additionalProperties: false,
      },
    },
  ];

  const body = {
    model: "gpt-5.5",
    instructions:
      "You are a helpful assistant. When the user asks about time, you MUST call the get_current_time tool — do not answer from your own knowledge.",
    input: [
      {
        type: "message",
        role: "user",
        content: [
          {
            type: "input_text",
            text: "What time is it in Berlin right now? Use the get_current_time tool.",
          },
        ],
      },
    ],
    tools: mockTools,
    tool_choice: "auto",
    parallel_tool_calls: false,
    store: false,
    stream: true,
  };

  console.log("Request-Body (gekürzt):");
  console.log(`  model:           ${body.model}`);
  console.log(`  tools[0].name:   ${mockTools[0]!.name}`);
  console.log(`  tools[0].params: ${JSON.stringify(mockTools[0]!.parameters)}`);
  console.log(`  user-prompt:     "${body.input[0]!.content[0]!.text}"\n`);

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

  console.log(`HTTP ${res.status} (${httpMs}ms to first byte)`);
  console.log(`  x-codex-plan-type: ${res.headers.get("x-codex-plan-type")}`);
  console.log(`  cf-ray:            ${res.headers.get("cf-ray")}\n`);

  if (!res.ok) {
    const errBody = await res.text().catch(() => "");
    console.error("❌ Non-2xx Response. Body (first 500 chars):");
    console.error(errBody.slice(0, 500));
    process.exit(1);
  }

  // ── Raw-SSE-Capture ────────────────────────────────────────────────────────
  // Manual-Parsing (statt CodexSSEParser) damit Phase 3.3.0 keine
  // Parser-Annahmen einbaut. Erst dumpen, dann Phase 3.3.1 bauen.
  const rawEvents: string[] = [];
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const events = buffer.split("\n\n");
    buffer = events.pop() ?? "";
    for (const event of events) {
      if (event.trim()) rawEvents.push(event);
    }
  }
  if (buffer.trim()) rawEvents.push(buffer);

  const totalMs = Date.now() - startMs;
  console.log(`Stream abgeschlossen: ${totalMs}ms gesamt, ${rawEvents.length} SSE-Event-Blöcke\n`);

  // ── Event-Type-Histogram ───────────────────────────────────────────────────
  const types = new Map<string, number>();
  const parsedEvents: Array<{ raw: string; parsed: unknown }> = [];
  for (const raw of rawEvents) {
    const dataLine = raw.split("\n").find((l) => l.startsWith("data: "));
    if (!dataLine) continue;
    const dataStr = dataLine.slice(6).trim();
    if (dataStr === "[DONE]") {
      types.set("[DONE]", (types.get("[DONE]") ?? 0) + 1);
      parsedEvents.push({ raw, parsed: "[DONE]" });
      continue;
    }
    try {
      const parsed = JSON.parse(dataStr) as { type?: string };
      const type = parsed.type ?? "(no-type-field)";
      types.set(type, (types.get(type) ?? 0) + 1);
      parsedEvents.push({ raw, parsed });
    } catch (err) {
      types.set("(parse-error)", (types.get("(parse-error)") ?? 0) + 1);
      parsedEvents.push({ raw, parsed: { error: String(err) } });
    }
  }

  console.log("=== Event-Type-Histogram ===");
  for (const [type, count] of [...types.entries()].sort(
    (a, b) => b[1] - a[1],
  )) {
    console.log(`  ${String(count).padStart(3)}× ${type}`);
  }
  console.log();

  // ── Tool-Call-spezifische Suche ────────────────────────────────────────────
  console.log("=== Tool-Call-Match-Suche ===");
  const toolCallEvents = parsedEvents.filter(({ raw }) => {
    return (
      raw.includes("function_call") ||
      raw.includes("tool_call") ||
      raw.includes("tool_use")
    );
  });
  if (toolCallEvents.length === 0) {
    console.log(
      "  ⚠️ Keine Events mit function_call/tool_call/tool_use gefunden.",
    );
    console.log(
      "     Codex hat vermutlich direkt geantwortet ohne Tool zu rufen.",
    );
  } else {
    console.log(`  ${toolCallEvents.length} Tool-Call-related Events:\n`);
    for (let i = 0; i < toolCallEvents.length; i++) {
      console.log(`  --- Match ${i + 1} ---`);
      console.log(
        "  " + toolCallEvents[i]!.raw.split("\n").join("\n  "),
      );
      console.log();
    }
  }

  // ── Full Raw-Dump (alle Events, für §k-Doku) ──────────────────────────────
  console.log("=== Raw SSE-Event-Dump (alle " + rawEvents.length + ") ===\n");
  for (let i = 0; i < rawEvents.length; i++) {
    console.log(`--- Event ${i + 1} ---`);
    console.log(rawEvents[i]);
    console.log();
  }

  console.log("=== Spike-Discovery beendet ===");
  console.log(
    "→ Findings in docs/131-OAUTH-STRATEGY.md §k dokumentieren " +
      "(Histogram + Tool-Call-Item-Schema + Phase-3.3.1-Mapping-Hypothese).",
  );
}

main().catch((err) => {
  console.error("\n❌ Spike failed:", err);
  process.exit(1);
});
