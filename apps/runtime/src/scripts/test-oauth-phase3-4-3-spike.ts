import "dotenv/config";

import path from "node:path";
import { fileURLToPath } from "node:url";

import { generateText, stepCountIs, tool } from "ai";
import { z } from "zod";

import { loadMasterKey } from "../crypto-utils.js";
import { createSqliteRepository } from "../repository/index.js";
import { OAuthRefreshService } from "../oauth/refresh-service.js";
import { OAuthTokensRepo } from "../oauth/oauth-tokens-repo.js";
import { TwinProfilesRepo } from "../twin-profiles-repo.js";
import { createCodexProvider } from "../oauth/codex-vercel-provider.js";

// ─── #131 PHASE 3.4.3.0 SPIKE — TOOL-APPROVAL-REQUEST DISCOVERY ──────────────
//
// Doku-Check (§r-WIP) hat verifiziert:
//   - `needsApproval` ist Tool-Field in Vercel-SDK 6 (boolean | Function)
//   - `tool-approval-request` ist first-class Content-Part-Type (V3-Spec)
//   - Approve via History-Replay: tool-Role-Message mit
//     `tool-approval-response`-Part
//   - Provider-Code bleibt UNVERÄNDERT — Approval-Mechanik ist Caller-Side
//
// Spike-Zweck:
//   Test 1: tool({needsApproval:true, execute}) durch Codex-Provider
//           → wird tool-approval-request tatsächlich emittiert?
//           → wo lebt das Part: result.content[] vs result.steps[i].content[]?
//           → finishReason bei Approval-Pending?
//   Test 2: Resume via History-Replay → SDK ruft execute() automatisch?
//   Test 3: Reject via approved:false → wie verhält sich SDK?
//
// Production-Provider 1:1 reuse (Phase 3.4.1 ist final).
//
// Aufruf:
//   pnpm twin:oauth-phase3-spike setup
//   pnpm --filter @twin-lab/runtime twin:oauth-phase3-4-3-spike
//   pnpm twin:oauth-phase3-spike cleanup

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WORKSPACE_ROOT = path.resolve(__dirname, "../../../..");
const DB_PATH =
  process.env.TWIN_DATABASE_PATH ??
  path.resolve(WORKSPACE_ROOT, "data/twin.db");

const TRIGGER_PROMPT = "Was ist 17 plus 25? Nutze das get_sum Tool.";
const SYSTEM_PROMPT =
  "You are a helpful assistant. Use the get_sum tool when asked to add numbers. Answer in German.";

function makeApprovalTool() {
  return {
    get_sum: tool({
      description: "Returns the sum of two numbers a and b",
      inputSchema: z.object({
        a: z.number().describe("First number"),
        b: z.number().describe("Second number"),
      }),
      needsApproval: true, // SPIKE: Static-Boolean — Vercel-SDK soll
      // tool-approval-request emittieren statt execute() zu rufen.
      execute: async ({ a, b }: { a: number; b: number }) => {
        // Test-Tracking: wenn diese Function gerufen wird, war Approval
        // entweder umgangen oder Resume-Pfad aktiv.
        executeCallCount++;
        return { sum: a + b };
      },
    }),
  };
}

let executeCallCount = 0;

function dumpContent(label: string, content: unknown[]): void {
  console.log(`  ${label} (${content.length} parts):`);
  for (const part of content) {
    const p = part as { type?: string };
    console.log(
      `    - type=${p.type ?? "<unknown>"}  ${JSON.stringify(part).slice(0, 200)}`,
    );
  }
}

function dumpStep(i: number, step: {
  text: string;
  toolCalls: { toolName: string; toolCallId: string; input: unknown }[];
  toolResults: { toolName: string; output: unknown }[];
  content: unknown[];
  finishReason: string;
}): void {
  console.log(
    `  step[${i}]: text="${step.text.slice(0, 60)}", toolCalls=${step.toolCalls.length}, toolResults=${step.toolResults.length}, finishReason=${step.finishReason}`,
  );
  for (const tc of step.toolCalls) {
    console.log(
      `    - tool-call: ${tc.toolName}(${JSON.stringify(tc.input)}) callId=${tc.toolCallId}`,
    );
  }
  for (const tr of step.toolResults) {
    console.log(`    - tool-result: ${tr.toolName} → ${JSON.stringify(tr.output)}`);
  }
  dumpContent(`step[${i}].content`, step.content);
}

// ─── MAIN ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log("=== #131 Phase 3.4.3.0 Spike — tool-approval-request Discovery ===\n");

  const masterKey = loadMasterKey();
  const repo = createSqliteRepository(DB_PATH);
  const profilesRepo = new TwinProfilesRepo(repo.db);
  const tokensRepo = new OAuthTokensRepo(repo.db, masterKey);
  const refreshService = new OAuthRefreshService(tokensRepo, repo.audit);

  const profiles = profilesRepo.list({ activeOnly: true });
  const oauthTwin = profiles.find((p) => p.authMode === "oauth");
  if (!oauthTwin) {
    throw new Error(
      `Kein Twin mit authMode='oauth' in ${DB_PATH}.\n` +
        `→ Vor Spike: pnpm twin:oauth-phase3-spike setup`,
    );
  }
  console.log(`🧪 Twin: ${oauthTwin.handle} (twinId=${oauthTwin.twinId})`);

  const codex = createCodexProvider({
    refreshService,
    twinId: oauthTwin.twinId,
  });

  // ─── TEST 1: needsApproval triggert tool-approval-request? ───────────────
  console.log("\n═══ TEST 1 — needsApproval:true → tool-approval-request? ═══");
  console.log(`Prompt: "${TRIGGER_PROMPT}"`);

  executeCallCount = 0;
  // Spike-pragmatisch: typed any-array via cast — generateText-Result-Type
  // ist invariant in ToolSet-Generic, sonst Type-Mismatch zwischen let-Decl
  // und Assignment-Side. Spike braucht keine Type-Safety auf result-Side.
  let test1Result: any = null;
  let test1Err: unknown = null;
  const startMs1 = Date.now();
  try {
    test1Result = await generateText({
      model: codex.languageModel("gpt-5.5"),
      system: SYSTEM_PROMPT,
      prompt: TRIGGER_PROMPT,
      tools: makeApprovalTool(),
      stopWhen: stepCountIs(5),
    });
  } catch (err) {
    test1Err = err;
  }
  const latency1 = Date.now() - startMs1;

  if (test1Err) {
    console.error(`❌ TEST 1 threw: ${test1Err instanceof Error ? test1Err.message : test1Err}`);
    if (test1Err instanceof Error && test1Err.stack) {
      console.error(test1Err.stack.split("\n").slice(0, 8).join("\n"));
    }
  } else if (test1Result) {
    console.log(`\n✓ ${latency1}ms`);
    console.log(`  text: "${test1Result.text.slice(0, 200)}"`);
    console.log(`  finishReason: ${test1Result.finishReason}`);
    console.log(`  steps: ${test1Result.steps.length}`);
    console.log(`  top-level toolCalls: ${test1Result.toolCalls.length}`);
    console.log(`  top-level toolResults: ${test1Result.toolResults.length}`);
    console.log(`  executeCallCount (Mock-Tracking): ${executeCallCount}`);

    dumpContent("top-level result.content", test1Result.content);

    for (let i = 0; i < test1Result.steps.length; i++) {
      const s = test1Result.steps[i];
      if (!s) continue;
      dumpStep(i, s as Parameters<typeof dumpStep>[1]);
    }

    // Verify: tool-approval-request irgendwo?
    const collectApprovalParts = () => {
      const parts: unknown[] = [];
      for (const p of test1Result!.content) {
        if ((p as { type?: string }).type === "tool-approval-request") {
          parts.push(p);
        }
      }
      for (const s of test1Result!.steps) {
        for (const p of s.content ?? []) {
          if ((p as { type?: string }).type === "tool-approval-request") {
            parts.push(p);
          }
        }
      }
      return parts;
    };
    const approvalParts = collectApprovalParts();
    console.log(`\n  → tool-approval-request-Parts gefunden: ${approvalParts.length}`);
    for (const p of approvalParts) {
      console.log(`    ${JSON.stringify(p, null, 2).replace(/\n/g, "\n    ")}`);
    }
    console.log(`  → execute() wurde${executeCallCount > 0 ? "" : " NICHT"} gerufen`);
  }

  // ─── TEST 2: Resume via History-Replay ───────────────────────────────────
  //
  // Voraussetzung: Test 1 hat ein tool-approval-request emittiert mit
  // approvalId + toolCallId. Wir bauen den expliziten messages-Array mit:
  //   user → assistant-with-tool-call → tool-role-with-approval-response
  // und prüfen ob SDK execute() ruft + finale Antwort liefert.
  console.log("\n═══ TEST 2 — Resume via History-Replay (approved:true) ═══");

  // Approval-IDs aus Test 1 extrahieren falls da
  let approvalId: string | null = null;
  let toolCallId: string | null = null;
  let toolInput: unknown = null;
  if (test1Result) {
    for (const p of [
      ...test1Result.content,
      ...test1Result.steps.flatMap((s: { content?: unknown[] }) => s.content ?? []),
    ]) {
      const part = p as {
        type?: string;
        approvalId?: string;
        toolCall?: { toolCallId?: string; input?: unknown };
        toolCallId?: string;
      };
      if (part.type === "tool-approval-request") {
        approvalId = part.approvalId ?? null;
        toolCallId = part.toolCall?.toolCallId ?? part.toolCallId ?? null;
        toolInput = part.toolCall?.input ?? null;
        break;
      }
    }
  }

  if (!approvalId || !toolCallId) {
    console.log("⏭️  Test 2 skip — keine approvalId/toolCallId aus Test 1");
  } else {
    console.log(`  Using approvalId=${approvalId}, toolCallId=${toolCallId}`);
    console.log(`  toolInput=${JSON.stringify(toolInput)}`);

    executeCallCount = 0;
    let test2Result: any = null;
    let test2Err: unknown = null;
    const startMs2 = Date.now();
    try {
      test2Result = await generateText({
        model: codex.languageModel("gpt-5.5"),
        system: SYSTEM_PROMPT,
        messages: [
          { role: "user", content: TRIGGER_PROMPT },
          {
            role: "assistant",
            // SDK collectToolApprovals scannt message-history nach
            // tool-approval-request-Parts, daher muss der Pending-Request
            // im assistant-content liegen — NICHT nur der tool-call.
            content: [
              {
                type: "tool-call",
                toolCallId,
                toolName: "get_sum",
                input: toolInput as { a: number; b: number },
              },
              {
                type: "tool-approval-request",
                approvalId,
                toolCallId,
              } as never,
            ],
          },
          {
            role: "tool",
            content: [
              {
                type: "tool-approval-response",
                approvalId,
                approved: true,
              },
            ],
          },
        ],
        tools: makeApprovalTool(),
        stopWhen: stepCountIs(5),
      });
    } catch (err) {
      test2Err = err;
    }
    const latency2 = Date.now() - startMs2;

    if (test2Err) {
      console.error(
        `❌ TEST 2 threw: ${test2Err instanceof Error ? test2Err.message : test2Err}`,
      );
      if (test2Err instanceof Error && test2Err.stack) {
        console.error(test2Err.stack.split("\n").slice(0, 8).join("\n"));
      }
    } else if (test2Result) {
      console.log(`\n✓ ${latency2}ms`);
      console.log(`  text: "${test2Result.text.slice(0, 200)}"`);
      console.log(`  finishReason: ${test2Result.finishReason}`);
      console.log(`  steps: ${test2Result.steps.length}`);
      console.log(`  executeCallCount: ${executeCallCount}`);

      for (let i = 0; i < test2Result.steps.length; i++) {
        const s = test2Result.steps[i];
        if (!s) continue;
        dumpStep(i, s as Parameters<typeof dumpStep>[1]);
      }

      const containsAnswer = test2Result.text.includes("42");
      console.log(
        `\n  → execute() gerufen: ${executeCallCount}x`,
      );
      console.log(`  → finale Antwort enthält "42": ${containsAnswer}`);
    }
  }

  // ─── TEST 3: Reject via approved:false ───────────────────────────────────
  console.log("\n═══ TEST 3 — Reject via History-Replay (approved:false) ═══");

  if (!approvalId || !toolCallId) {
    console.log("⏭️  Test 3 skip — keine approvalId/toolCallId aus Test 1");
  } else {
    executeCallCount = 0;
    let test3Result: any = null;
    let test3Err: unknown = null;
    const startMs3 = Date.now();
    try {
      test3Result = await generateText({
        model: codex.languageModel("gpt-5.5"),
        system: SYSTEM_PROMPT,
        messages: [
          { role: "user", content: TRIGGER_PROMPT },
          {
            role: "assistant",
            // SDK collectToolApprovals scannt message-history nach
            // tool-approval-request-Parts, daher muss der Pending-Request
            // im assistant-content liegen — NICHT nur der tool-call.
            content: [
              {
                type: "tool-call",
                toolCallId,
                toolName: "get_sum",
                input: toolInput as { a: number; b: number },
              },
              {
                type: "tool-approval-request",
                approvalId,
                toolCallId,
              } as never,
            ],
          },
          {
            role: "tool",
            content: [
              {
                type: "tool-approval-response",
                approvalId,
                approved: false,
                reason: "User hat abgelehnt — bitte ohne Tool antworten.",
              },
            ],
          },
        ],
        tools: makeApprovalTool(),
        stopWhen: stepCountIs(5),
      });
    } catch (err) {
      test3Err = err;
    }
    const latency3 = Date.now() - startMs3;

    if (test3Err) {
      console.error(
        `❌ TEST 3 threw: ${test3Err instanceof Error ? test3Err.message : test3Err}`,
      );
      if (test3Err instanceof Error && test3Err.stack) {
        console.error(test3Err.stack.split("\n").slice(0, 8).join("\n"));
      }
    } else if (test3Result) {
      console.log(`\n✓ ${latency3}ms`);
      console.log(`  text: "${test3Result.text.slice(0, 200)}"`);
      console.log(`  finishReason: ${test3Result.finishReason}`);
      console.log(`  steps: ${test3Result.steps.length}`);
      console.log(`  executeCallCount: ${executeCallCount}`);
      console.log(
        `  → execute() gerufen: ${executeCallCount}x (sollte 0 bei Reject sein)`,
      );
    }
  }

  // ─── Summary ──────────────────────────────────────────────────────────────
  console.log("\n═══ Spike-Summary ═══");
  console.log("Findings für §r-Doku:");
  console.log("  - Welche Felder im content[] vs steps[i].content[]?");
  console.log("  - tool-approval-request Schema (echt vs Doku)?");
  console.log("  - finishReason-Wert bei Pending-Approval?");
  console.log("  - History-Replay-Format funktional?");
  console.log("  - Reject-Verhalten (kein execute, Codex antwortet direkt)?");
}

main().catch((err) => {
  console.error("\n❌ Spike-Fehler:", err instanceof Error ? err.message : err);
  if (err instanceof Error && "cause" in err) {
    console.error("   cause:", err.cause);
  }
  if (err instanceof Error && err.stack) {
    console.error("   stack:", err.stack.split("\n").slice(0, 6).join("\n"));
  }
  process.exit(1);
});
