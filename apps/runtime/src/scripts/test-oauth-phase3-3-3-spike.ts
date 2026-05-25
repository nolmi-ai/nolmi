import "dotenv/config";

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { CodexSSEParser } from "../oauth/codex-sse-parser.js";

// ─── #131 PHASE 3.3.3.0 SPIKE — REASONING-TRACE-DISCOVERY ────────────────────
//
// Dritter Discovery-Spike der Phase 3.3. Phase 3.3.0 hat das Tool-Call-
// Event-Format verifiziert (§k), Phase 3.3.2 das Multi-Step-Tool-Roundtrip-
// Format (§l). Phase 3.3.3.0 verifiziert das Reasoning-Trace-Format: triggert
// Codex Reasoning bei nicht-trivialen Prompts, und wenn ja — welches Item-
// Format kommt im Stream?
//
// Spike-Disziplin (analog 3.0, 3.3.0, 3.3.2):
//   - Token-Quelle ~/.codex/auth.json direkt (Discovery vs. Production-Pfad
//     ist Memory-Setzung)
//   - Kein TwinService-Wiring, kein Audit-Insert
//   - Parser-Compare: existing CodexSSEParser läuft parallel zum Raw-Capture
//     für Live-Test ob das Phase-3.3.1.1-Setup (reasoningTraces-Field) real
//     captured was Raw-SSE liefert
//
// Trigger-Strategie (Diagnose-C-Hypothesen):
//   Step 1: Math-Multi-Step-Prompt + reasoning.effort:"high"
//   Step 2 (conditional): wenn Math nichts triggert → Code-Refactor-Prompt
//   Step 3 (conditional): wenn beide nichts triggern → Hypothese C
//     (Subscription-Plan exposed Reasoning-Items nicht im Stream)
//
// Token-Pre-Check: JWT-Decode des access_token + exp-Claim-Vergleich. Bei
// fehlendem JWT-Format → Fallback Heuristik via last_refresh + 1h-Buffer.
// Bei expired → hard-error mit "codex login --force"-Hinweis vor fetch.
//
// Aufruf:
//   pnpm --filter @twin-lab/runtime twin:oauth-phase3-3-3-spike

const CODEX_ENDPOINT = "https://chatgpt.com/backend-api/codex/responses";
const CODEX_AUTH_PATH = path.resolve(os.homedir(), ".codex/auth.json");
const DEFAULT_MODEL = "gpt-5.5";
// Codex-OAuth-Tokens leben typisch 1h. Heuristik-Buffer für Pre-Check wenn
// access_token kein JWT ist und kein expires_at-Field existiert.
const HEURISTIC_TOKEN_LIFETIME_SEC = 3600;

interface CodexAuthFile {
  tokens?: { access_token?: string };
  last_refresh?: string;
}

interface MakeRequestResult {
  label: string;
  status: number;
  rawEventCount: number;
  eventTypes: Map<string, number>;
  reasoningItemCountRaw: number;
  reasoningItemSamples: string[]; // erste 2 Reasoning-Events als JSON-String
  reasoningTokens: number;
  totalTokens: number;
  parserReasoningTracesCount: number;
  parserUnknownEventTypes: string[];
  finalText: string;
  latencyMs: number;
  errorBody?: string;
}

// ─── TOKEN PRE-CHECK ─────────────────────────────────────────────────────────

function decodeJwtExp(jwt: string): number | null {
  // JWT = header.payload.signature, payload ist base64url-encoded JSON
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
      `Codex-Auth-File fehlt: ${CODEX_AUTH_PATH}\n` +
        `→ Bitte 'codex login --force' ausführen.`,
    );
  }
  const auth = JSON.parse(
    fs.readFileSync(CODEX_AUTH_PATH, "utf-8"),
  ) as CodexAuthFile;
  const token = auth.tokens?.access_token;
  if (!token) {
    throw new Error(
      `Kein access_token in ${CODEX_AUTH_PATH}\n` +
        `→ Bitte 'codex login --force' ausführen.`,
    );
  }

  const nowSec = Math.floor(Date.now() / 1000);
  const jwtExp = decodeJwtExp(token);

  if (jwtExp !== null) {
    const remainingSec = jwtExp - nowSec;
    if (remainingSec <= 0) {
      throw new Error(
        `Codex access_token expired (JWT exp=${jwtExp}, now=${nowSec}, ` +
          `Δ=${remainingSec}s).\n→ Bitte 'codex login --force' ausführen.`,
      );
    }
    console.log(
      `🔑 Token-Check JWT: gültig noch ${remainingSec}s ` +
        `(~${(remainingSec / 60).toFixed(0)}min)`,
    );
  } else {
    // Fallback: Heuristik via last_refresh + 1h
    if (auth.last_refresh) {
      const refreshMs = Date.parse(auth.last_refresh);
      if (Number.isFinite(refreshMs)) {
        const ageSec = (Date.now() - refreshMs) / 1000;
        const remainingSec = HEURISTIC_TOKEN_LIFETIME_SEC - ageSec;
        if (remainingSec <= 0) {
          throw new Error(
            `Codex access_token vermutlich expired ` +
              `(last_refresh=${auth.last_refresh}, age=${ageSec.toFixed(0)}s, ` +
              `Heuristik-Buffer=${HEURISTIC_TOKEN_LIFETIME_SEC}s).\n` +
              `→ Bitte 'codex login --force' ausführen.`,
          );
        }
        console.log(
          `🔑 Token-Check Heuristik (kein JWT): noch ~${remainingSec.toFixed(0)}s ` +
            `bis Refresh-Buffer (last_refresh ${ageSec.toFixed(0)}s alt)`,
        );
      }
    } else {
      console.warn(
        `⚠️  access_token ist kein JWT und kein last_refresh — Pre-Check skipped`,
      );
    }
  }

  return token;
}

// ─── REQUEST + RAW-CAPTURE + PARSER-COMPARE ──────────────────────────────────

async function makeRequest(
  accessToken: string,
  triggerPrompt: string,
  label: string,
): Promise<MakeRequestResult> {
  const body = {
    model: DEFAULT_MODEL,
    instructions:
      "You are a helpful assistant. Think carefully through complex problems before answering.",
    input: [
      {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: triggerPrompt }],
      },
    ],
    tools: [],
    tool_choice: "auto",
    parallel_tool_calls: false,
    store: false,
    stream: true,
    // Spike-Setzung: effort:"high" für maximales Reasoning-Provoke. Codex-
    // Server-Default ist "medium" (Phase-3.3.0-Smoke hatte das implizit).
    reasoning: { effort: "high" },
  };

  console.log(`\n═══ ${label} ═══`);
  console.log(`Prompt (${triggerPrompt.length} chars): ${triggerPrompt.slice(0, 80)}…`);
  console.log(`reasoning.effort: "high"  |  tools: []  |  model: ${DEFAULT_MODEL}`);

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
  const latencyToFirstByte = Date.now() - startMs;

  if (!res.ok) {
    const errBody = await res.text().catch(() => "<no body>");
    console.error(`❌ HTTP ${res.status} (${latencyToFirstByte}ms)`);
    console.error(`Error-Body: ${errBody.slice(0, 500)}`);
    return {
      label,
      status: res.status,
      rawEventCount: 0,
      eventTypes: new Map(),
      reasoningItemCountRaw: 0,
      reasoningItemSamples: [],
      reasoningTokens: 0,
      totalTokens: 0,
      parserReasoningTracesCount: 0,
      parserUnknownEventTypes: [],
      finalText: "",
      latencyMs: latencyToFirstByte,
      errorBody: errBody.slice(0, 500),
    };
  }

  // Raw-Capture: SSE-Events sammeln (split bei \n\n), parallel Parser füttern
  // via parseChunk — am Ende parser.finalize() für CodexParseResult-Compare.
  const rawEvents: string[] = [];
  const parser = new CodexSSEParser();
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const chunk = decoder.decode(value, { stream: true });
    buffer += chunk;
    // Parser kriegt jeden Chunk identisch zum Production-Pfad (parseChunk
    // erwartet komplette SSE-Daten-Stream-Chunks, nicht zerlegte Events).
    parser.parseChunk(chunk);
    const events = buffer.split("\n\n");
    buffer = events.pop() ?? "";
    for (const ev of events) if (ev.trim()) rawEvents.push(ev);
  }
  if (buffer.trim()) rawEvents.push(buffer);

  const parseResult = parser.finalize();
  const latencyMs = Date.now() - startMs;

  // Histogram + Reasoning-Detection
  const eventTypes = new Map<string, number>();
  let reasoningItemCountRaw = 0;
  const reasoningItemSamples: string[] = [];
  let reasoningTokens = 0;
  let totalTokens = 0;
  let finalText = "";

  for (const raw of rawEvents) {
    const dataLine = raw.split("\n").find((l) => l.startsWith("data: "));
    if (!dataLine) continue;
    const dataStr = dataLine.slice(6).trim();
    if (dataStr === "[DONE]") continue;
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(dataStr) as Record<string, unknown>;
    } catch {
      continue;
    }
    const type = typeof parsed.type === "string" ? parsed.type : "unknown";
    eventTypes.set(type, (eventTypes.get(type) ?? 0) + 1);

    // Reasoning-Item-Capture: output_item.added/done mit item.type==="reasoning"
    const item = parsed.item as { type?: string } | undefined;
    if (
      (type === "response.output_item.added" ||
        type === "response.output_item.done") &&
      item?.type === "reasoning"
    ) {
      reasoningItemCountRaw++;
      if (reasoningItemSamples.length < 2) {
        reasoningItemSamples.push(JSON.stringify(parsed, null, 2));
      }
    }

    // response.completed → usage-Tracking
    if (type === "response.completed") {
      const resp = parsed.response as
        | {
            usage?: {
              total_tokens?: number;
              output_tokens_details?: { reasoning_tokens?: number };
            };
          }
        | undefined;
      const usage = resp?.usage;
      if (usage) {
        totalTokens = usage.total_tokens ?? 0;
        reasoningTokens =
          usage.output_tokens_details?.reasoning_tokens ?? 0;
      }
    }

    // Text-Akkumulation für Sanity-Check
    if (type === "response.output_text.delta") {
      const delta = parsed.delta;
      if (typeof delta === "string") finalText += delta;
    }
  }

  console.log(`✓ HTTP ${res.status} | ${latencyMs}ms total`);
  console.log(`  rawEventCount=${rawEvents.length}`);
  console.log(`  reasoningItems raw=${reasoningItemCountRaw}`);
  console.log(`  reasoningTraces parser=${parseResult.reasoningTraces.length}`);
  console.log(`  reasoning_tokens=${reasoningTokens}, total_tokens=${totalTokens}`);
  if (parseResult.unknownEventTypes.length > 0) {
    console.log(
      `  parser unknownEventTypes: ${parseResult.unknownEventTypes.join(", ")}`,
    );
  }

  return {
    label,
    status: res.status,
    rawEventCount: rawEvents.length,
    eventTypes,
    reasoningItemCountRaw,
    reasoningItemSamples,
    reasoningTokens,
    totalTokens,
    parserReasoningTracesCount: parseResult.reasoningTraces.length,
    parserUnknownEventTypes: parseResult.unknownEventTypes,
    finalText,
    latencyMs,
  };
}

// ─── REPORTING ───────────────────────────────────────────────────────────────

function printHistogram(types: Map<string, number>): void {
  const sorted = [...types.entries()].sort((a, b) => b[1] - a[1]);
  for (const [type, count] of sorted) {
    console.log(`    ${String(count).padStart(4)}× ${type}`);
  }
}

function printResultSummary(r: MakeRequestResult): void {
  console.log(`\n--- ${r.label} ---`);
  console.log(`  HTTP ${r.status} | ${r.latencyMs}ms | ${r.rawEventCount} events`);
  console.log(`  reasoningItems raw=${r.reasoningItemCountRaw}, parser=${r.parserReasoningTracesCount}`);
  console.log(`  reasoning_tokens=${r.reasoningTokens} (of total_tokens=${r.totalTokens})`);
  console.log(`  finalText (first 200 chars): ${r.finalText.slice(0, 200).replace(/\n/g, " ")}`);
  console.log(`  Event-Histogram:`);
  printHistogram(r.eventTypes);
  if (r.reasoningItemSamples.length > 0) {
    console.log(`\n  --- Reasoning-Item-Samples (${r.reasoningItemSamples.length}) ---`);
    r.reasoningItemSamples.forEach((s, i) => {
      console.log(`\n  [Sample ${i + 1}]`);
      console.log(s.split("\n").map((l) => `  ${l}`).join("\n"));
    });
  }
}

function evaluateHypotheses(
  step1: MakeRequestResult,
  step2: MakeRequestResult | null,
): void {
  console.log("\n═══ Hypothesen-Verifikation ═══\n");

  const anyReasoningItems =
    step1.reasoningItemCountRaw > 0 ||
    (step2?.reasoningItemCountRaw ?? 0) > 0;
  const anyReasoningTokens =
    step1.reasoningTokens > 0 || (step2?.reasoningTokens ?? 0) > 0;

  // Hypothese A: Reasoning kommt nur bei non-trivial Prompts
  if (step1.reasoningItemCountRaw > 0) {
    console.log(
      `  ✅ Hypothese A: Math-Trigger produziert Reasoning-Items ` +
        `(${step1.reasoningItemCountRaw} items, ${step1.reasoningTokens} tokens)`,
    );
  } else if (step2 && step2.reasoningItemCountRaw > 0) {
    console.log(
      `  ✅ Hypothese A (partial): Code-Refactor-Trigger triggert Reasoning, ` +
        `Math-Trigger nicht. Trigger-Domain matters.`,
    );
  } else {
    console.log(
      `  ❌ Hypothese A widerlegt: weder Math noch Code-Refactor produzieren ` +
        `Reasoning-Items im Stream.`,
    );
  }

  // Hypothese B: effort:"high" macht Unterschied
  // (Vergleich gegen Phase-3.3.0-Smoke mit effort:"medium" + 0 items)
  if (anyReasoningItems) {
    console.log(
      `  ✅ Hypothese B: effort:"high" produziert Reasoning ` +
        `(Phase-3.3.0-Smoke mit effort:"medium" hatte 0 items für Tool-Call-Pfad)`,
    );
  } else {
    console.log(
      `  ⚠️  Hypothese B unentscheidbar: effort:"high" liefert auch nichts. ` +
        `Effort-Setting allein reicht nicht.`,
    );
  }

  // Hypothese C: Subscription-Plan exposed Items nicht
  if (!anyReasoningItems && anyReasoningTokens) {
    console.log(
      `  ⚠️  Hypothese C VERIFIZIERT: reasoning_tokens > 0 aber keine ` +
        `Stream-Items. Codex-Subscription expose Reasoning intern aber ` +
        `nicht im SSE. Phase 3.3.3.1 kann nur Token-Counts persistieren, ` +
        `keine Traces.`,
    );
  } else if (!anyReasoningItems && !anyReasoningTokens) {
    console.log(
      `  ⚠️  Hypothese C verstärkt: kein Reasoning weder als Items noch ` +
        `als Tokens. Entweder ist Codex-Subscription Reasoning-frei oder ` +
        `Trigger-Bedingungen sind anders als gedacht.`,
    );
  } else {
    console.log(
      `  ✅ Hypothese C widerlegt: Reasoning-Items IM Stream sichtbar.`,
    );
  }

  // Parser-Diskrepanz-Check
  const step1Diff =
    step1.reasoningItemCountRaw - step1.parserReasoningTracesCount;
  const step2Diff = step2
    ? step2.reasoningItemCountRaw - step2.parserReasoningTracesCount
    : 0;
  if (step1Diff !== 0 || step2Diff !== 0) {
    console.log(
      `\n  ⚠️  Parser-Raw-Diskrepanz: step1=${step1Diff}, step2=${step2Diff}. ` +
        `CodexSSEParser captured nicht alle Reasoning-Items aus dem Stream — ` +
        `Parser-Logic prüfen.`,
    );
  } else if (step1.reasoningItemCountRaw > 0) {
    console.log(
      `\n  ✅ Parser-Raw-Parität: Raw-Count = Parser-Count. Phase-3.3.1.1- ` +
        `Setup captured korrekt was Raw-SSE liefert.`,
    );
  }

  // Phase-3.3.3.1-Recommendation
  console.log("\n═══ Phase-3.3.3.1-Recommendation ═══\n");
  if (anyReasoningItems) {
    console.log(
      `  → WEITERBAUEN: Phase 3.3.3.1 hat verifizierte Format-Basis. Schritte:\n` +
        `    1. CodexAdapterOutput um reasoningTraces: unknown[] erweitern\n` +
        `    2. CodexAdapterOutput.reasoningTokens?: number aus usage extrahieren\n` +
        `    3. TwinService.runModelViaCodex reicht beide ans audit.output.providerMetadata\n` +
        `    4. Audit-UI optional in Phase 5 (heute kein Render-Bedarf)`,
    );
  } else if (anyReasoningTokens) {
    console.log(
      `  → REDUZIERT WEITERBAUEN: nur reasoningTokens persistieren\n` +
        `    1. CodexAdapterOutput.reasoningTokens?: number\n` +
        `    2. providerMetadata.reasoningTokens ans audit.output\n` +
        `    Skip reasoningTraces — Stream liefert keine Items.`,
    );
  } else {
    console.log(
      `  → SKIP: Phase 3.3.3.1 entfällt. Codex-Subscription liefert kein ` +
        `Reasoning für diesen Pfad. CodexSSEParser-reasoningTraces-Field ` +
        `kann als Dead-Code bleiben (kostet nichts) oder cleanup in Phase 5.`,
    );
  }
}

// ─── MAIN ────────────────────────────────────────────────────────────────────

const MATH_PROMPT =
  "Solve this step by step and show your reasoning: A train leaves Station A " +
  "at 9:00 AM traveling east at 60 mph. Another train leaves Station B (240 " +
  "miles east of Station A) at 10:00 AM traveling west at 80 mph. At what " +
  "time do they meet, and how far from Station A? Show your complete reasoning " +
  "before giving the answer.";

const CODE_REFACTOR_PROMPT =
  "Refactor the following code for better readability and explain your " +
  "reasoning step by step:\n\n" +
  "function f(a,b){if(a>b){return a-b}else if(a<b){return b-a}else{return 0}}\n\n" +
  "Walk through your refactoring decisions one at a time.";

async function main() {
  console.log("=== #131 Phase 3.3.3.0 Spike — Reasoning-Trace-Discovery ===\n");

  const accessToken = loadAndCheckAccessToken();

  // Step 1: Math
  const step1 = await makeRequest(accessToken, MATH_PROMPT, "STEP 1 — Math");

  // Step 2 conditional: nur wenn Step 1 weder Items noch Tokens triggert
  let step2: MakeRequestResult | null = null;
  if (step1.reasoningItemCountRaw === 0 && step1.reasoningTokens === 0) {
    console.log(
      `\n→ Step 1 produzierte 0 Reasoning-Items + 0 reasoning_tokens. ` +
        `Re-Run mit Code-Refactor-Domain.`,
    );
    step2 = await makeRequest(
      accessToken,
      CODE_REFACTOR_PROMPT,
      "STEP 2 — Code-Refactor",
    );
  } else {
    console.log(
      `\n→ Step 1 hat Reasoning-Signal (items=${step1.reasoningItemCountRaw}, ` +
        `tokens=${step1.reasoningTokens}). Step 2 übersprungen.`,
    );
  }

  // Reports
  console.log("\n\n╔═══════════════════════════════════════════════════╗");
  console.log("║              Spike-Result-Summary                  ║");
  console.log("╚═══════════════════════════════════════════════════╝");
  printResultSummary(step1);
  if (step2) printResultSummary(step2);

  evaluateHypotheses(step1, step2);
}

main().catch((err) => {
  console.error("\n❌ Spike-Fehler:", err instanceof Error ? err.message : err);
  if (err instanceof Error && "cause" in err) {
    console.error("   cause:", err.cause);
  }
  if (err instanceof Error && err.stack) {
    console.error("   stack:", err.stack.split("\n").slice(0, 5).join("\n"));
  }
  process.exit(1);
});
