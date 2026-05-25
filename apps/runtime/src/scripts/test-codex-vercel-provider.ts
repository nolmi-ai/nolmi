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

// ─── PHASE 3.4.1 STANDALONE-SMOKE ────────────────────────────────────────────
//
// Verifiziert die Provider-Basis (`codex-vercel-provider.ts`) via `generateText`
// mit Simple-Text-Prompt. Production-Pfad: Token aus DB (vorher via
// `pnpm twin:oauth-phase3-spike setup`), OAuthRefreshService injiziert in den
// CodexAdapter, Provider wraps Adapter als LanguageModelV3.
//
// Out of Scope:
//   - Tool-Call-Roundtrip (Phase 3.4.2)
//   - Approval-Pipeline (Phase 3.4.3)
//   - Reasoning-Mapping über Token-Count hinaus (Phase 3.4.4)
//
// Aufruf:
//   pnpm twin:oauth-phase3-spike setup    # @markus → oauth
//   pnpm --filter @twin-lab/runtime twin:codex-vercel-provider-smoke
//   pnpm twin:oauth-phase3-spike cleanup  # @markus → api_key

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WORKSPACE_ROOT = path.resolve(__dirname, "../../../..");
const DB_PATH =
  process.env.TWIN_DATABASE_PATH ??
  path.resolve(WORKSPACE_ROOT, "data/twin.db");

async function main(): Promise<void> {
  console.log("=== #131 Phase 3.4.1 Smoke — Codex-Vercel-Provider Basis ===\n");

  // ─── Setup: DB + Refresh-Service + Twin-Lookup ────────────────────────────
  const masterKey = loadMasterKey();
  const repo = createSqliteRepository(DB_PATH);
  const profilesRepo = new TwinProfilesRepo(repo.db);
  const tokensRepo = new OAuthTokensRepo(repo.db, masterKey);
  const refreshService = new OAuthRefreshService(tokensRepo, repo.audit);

  // Ersten oauth-Twin nehmen
  const profiles = profilesRepo.list({ activeOnly: true });
  const oauthTwin = profiles.find((p) => p.authMode === "oauth");
  if (!oauthTwin) {
    throw new Error(
      `Kein Twin mit authMode='oauth' in ${DB_PATH}.\n` +
        `→ Vor Smoke ausführen: pnpm twin:oauth-phase3-spike setup`,
    );
  }
  console.log(
    `🧪 Twin: ${oauthTwin.handle} (twinId=${oauthTwin.twinId}, authMode=${oauthTwin.authMode})`,
  );

  // ─── Provider via Factory ─────────────────────────────────────────────────
  const codex = createCodexProvider({
    refreshService,
    twinId: oauthTwin.twinId,
  });

  // Convention-Check: Provider ist callable + .languageModel()-Method
  const modelCallable = codex("gpt-5.5");
  const modelMethod = codex.languageModel("gpt-5.5");
  console.log(
    `🔗 Provider-Shape: callable=${modelCallable.specificationVersion}, method=${modelMethod.specificationVersion}`,
  );

  // ─── Simple-Text-Test ────────────────────────────────────────────────────
  console.log("\n═══ TEST — generateText mit Simple-Text-Prompt ═══");
  console.log('Prompt: "Was ist 17 plus 25?"');

  const startMs = Date.now();
  const result = await generateText({
    model: codex.languageModel("gpt-5.5"),
    system: "You are a helpful assistant. Answer briefly in German.",
    prompt: "Was ist 17 plus 25?",
  });
  const latencyMs = Date.now() - startMs;

  console.log(`\n✓ ${latencyMs}ms`);
  console.log(`  text: "${result.text}"`);
  console.log(`  finishReason: ${result.finishReason}`);
  console.log(`  usage:`, result.usage);
  console.log(`  providerMetadata:`, result.providerMetadata);

  // ─── Verifikation ─────────────────────────────────────────────────────────
  const checks: Array<{ name: string; pass: boolean; detail?: string }> = [];

  checks.push({
    name: "Text enthält '42'",
    pass: result.text.includes("42"),
    detail: `text=${result.text.slice(0, 80)}`,
  });
  checks.push({
    name: "finishReason = 'stop'",
    pass: result.finishReason === "stop",
    detail: `actual=${result.finishReason}`,
  });
  const meta = (result.providerMetadata?.["openai-codex"] ?? {}) as Record<
    string,
    unknown
  >;
  checks.push({
    name: "providerMetadata['openai-codex'].planType populated",
    pass: typeof meta.planType === "string" && meta.planType.length > 0,
    detail: `planType=${String(meta.planType ?? "<missing>")}`,
  });
  checks.push({
    name: "providerMetadata['openai-codex'].cfRay populated",
    pass: typeof meta.cfRay === "string" && meta.cfRay.length > 0,
    detail: `cfRay=${String(meta.cfRay ?? "<missing>")}`,
  });
  checks.push({
    name: "providerMetadata['openai-codex'].responseId populated",
    pass: typeof meta.responseId === "string" && meta.responseId.length > 0,
    detail: `responseId=${String(meta.responseId ?? "<missing>").slice(0, 40)}…`,
  });
  checks.push({
    name: "providerMetadata['openai-codex'].latencyMs > 0",
    pass: typeof meta.latencyMs === "number" && meta.latencyMs > 0,
    detail: `latencyMs=${String(meta.latencyMs ?? "<missing>")}`,
  });

  console.log("\n═══ Verifikation ═══");
  let allPass = true;
  for (const c of checks) {
    const symbol = c.pass ? "✅" : "❌";
    console.log(`  ${symbol} ${c.name}${c.detail ? `  (${c.detail})` : ""}`);
    if (!c.pass) allPass = false;
  }

  if (!allPass) {
    console.error("\n❌ Test 1 fehlgeschlagen — siehe Verifikation");
    process.exit(1);
  }
  console.log("\n✅ Test 1 grün — Simple-Text-Mapping funktional.");

  // ─── TEST 2 (Phase 3.4.2) — Tool-Roundtrip via Vercel-Multi-Step ────────
  //
  // Verify §l-Pattern transparent via Vercel-SDK: Provider macht eine
  // Iteration, Vercel-SDK orchestriert function_call → execute → tool-Role-
  // Message → nächste Iteration. Phase-3.4.0-Spike hatte das in 2.5s
  // verifiziert; jetzt Production-Provider unter identischem Pattern.
  console.log("\n═══ TEST 2 (Phase 3.4.2) — Tool-Roundtrip via Vercel-Multi-Step ═══");
  console.log('Prompt: "Was ist 17 plus 25? Nutze das get_sum Tool."');

  const startMs2 = Date.now();
  const result2 = await generateText({
    model: codex.languageModel("gpt-5.5"),
    system:
      "You are a helpful assistant. Use the get_sum tool when asked to add numbers. Answer in German.",
    prompt: "Was ist 17 plus 25? Nutze das get_sum Tool.",
    tools: {
      get_sum: tool({
        description: "Returns the sum of two numbers a and b",
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
  const latencyMs2 = Date.now() - startMs2;

  console.log(`\n✓ ${latencyMs2}ms`);
  console.log(`  text: "${result2.text.slice(0, 200)}"`);
  console.log(`  finishReason: ${result2.finishReason}`);
  console.log(`  steps: ${result2.steps.length}`);
  // Note: top-level toolCalls=0 ist erwartet (Step-Walk-Pattern wie Phase 3.2.E),
  // die echten Tool-Calls leben in steps[i].toolCalls. Dokumentiert für Phase 3.4.5.
  console.log(
    `  top-level toolCalls: ${result2.toolCalls.length} (step-walk erwartet 0)`,
  );
  for (let i = 0; i < result2.steps.length; i++) {
    const s = result2.steps[i];
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

  // Step-walken-Verifikation (matched Spike + Phase 3.2.E)
  const checks2: Array<{ name: string; pass: boolean; detail?: string }> = [];

  checks2.push({
    name: "result.steps.length === 2",
    pass: result2.steps.length === 2,
    detail: `actual=${result2.steps.length}`,
  });

  const step0 = result2.steps[0];
  const step1 = result2.steps[1];
  checks2.push({
    name: "step[0].toolCalls.length === 1",
    pass: !!step0 && step0.toolCalls.length === 1,
    detail: `actual=${step0?.toolCalls.length ?? "<missing>"}`,
  });

  const step0Tc = step0?.toolCalls[0];
  checks2.push({
    name: "step[0].toolCalls[0].toolName === 'get_sum'",
    pass: step0Tc?.toolName === "get_sum",
    detail: `actual=${step0Tc?.toolName ?? "<missing>"}`,
  });

  const tcInput = step0Tc?.input as { a?: number; b?: number } | undefined;
  checks2.push({
    name: "step[0] Args parsed: {a:17, b:25}",
    pass: tcInput?.a === 17 && tcInput?.b === 25,
    detail: `actual=${JSON.stringify(tcInput ?? "<missing>")}`,
  });

  checks2.push({
    name: "step[1].text contains '42'",
    pass: !!step1 && step1.text.includes("42"),
    detail: `actual="${step1?.text.slice(0, 80) ?? "<missing>"}"`,
  });

  checks2.push({
    name: "result.finishReason === 'stop' (final iteration)",
    pass: result2.finishReason === "stop",
    detail: `actual=${result2.finishReason}`,
  });

  console.log("\n═══ Verifikation Test 2 ═══");
  let allPass2 = true;
  for (const c of checks2) {
    const symbol = c.pass ? "✅" : "❌";
    console.log(`  ${symbol} ${c.name}${c.detail ? `  (${c.detail})` : ""}`);
    if (!c.pass) allPass2 = false;
  }

  if (!allPass2) {
    console.error("\n❌ Test 2 fehlgeschlagen — siehe Verifikation");
    process.exit(1);
  }

  console.log(
    "\n✅ Test 2 grün — Tool-Roundtrip via Vercel-Multi-Step funktional.",
  );

  // ─── Final ─────────────────────────────────────────────────────────────
  console.log("\n✅ Phase 3.4.1 + 3.4.2 Smoke vollständig grün.");
  console.log("   Out of Scope (next sub-phases):");
  console.log("     - Approval-Pipeline (3.4.3, ~3-4h)");
  console.log("     - Reasoning-Mapping-Smoke (3.4.4, ~10 Min)");
  console.log("     - TwinService-Integration (3.4.5, ~2h)");
}

main().catch((err) => {
  console.error("\n❌ Smoke-Fehler:", err instanceof Error ? err.message : err);
  if (err instanceof Error && err.stack) {
    console.error(err.stack.split("\n").slice(0, 6).join("\n"));
  }
  process.exit(1);
});
