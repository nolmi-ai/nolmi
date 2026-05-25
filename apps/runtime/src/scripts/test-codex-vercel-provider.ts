import "dotenv/config";

import path from "node:path";
import { fileURLToPath } from "node:url";

import { generateText } from "ai";

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
    console.error("\n❌ Smoke fehlgeschlagen — siehe Verifikation");
    process.exit(1);
  }
  console.log("\n✅ Phase 3.4.1 Smoke grün — Provider-Basis funktional.");
  console.log("   Out of Scope: Tool-Roundtrip (3.4.2), Approval (3.4.3),");
  console.log("                 Reasoning-Mapping (3.4.4), TwinService-Integration (3.4.5)");
}

main().catch((err) => {
  console.error("\n❌ Smoke-Fehler:", err instanceof Error ? err.message : err);
  if (err instanceof Error && err.stack) {
    console.error(err.stack.split("\n").slice(0, 6).join("\n"));
  }
  process.exit(1);
});
