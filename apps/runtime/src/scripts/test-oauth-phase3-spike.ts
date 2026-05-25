import "dotenv/config";

import path from "node:path";
import { fileURLToPath } from "node:url";

import { loadMasterKey } from "../crypto-utils.js";
import { createSqliteRepository } from "../repository/index.js";
import { loadCodexToken } from "../oauth/codex-auth-file.js";
import { OAuthTokensRepo } from "../oauth/oauth-tokens-repo.js";
import { OAuthRefreshService } from "../oauth/refresh-service.js";
import { CodexAdapter } from "../oauth/codex-adapter.js";
import { TwinProfilesRepo } from "../twin-profiles-repo.js";

// ─── TEST: #131 PHASE 3.0 SPIKE — CODEX-ADAPTER WALKING-SKELETON ─────────────
//
// Adapter-only Smoke 1:
//   1. Token aus ~/.codex/auth.json laden (echter Codex-CLI-Login).
//   2. Ersten aktiven Twin aus DB nehmen, authMode auf 'oauth' setzen.
//   3. Token via OAuthTokensRepo.upsert speichern (50min expiry, damit
//      ensureFresh den Token NICHT refresht — Spike-Pragmatik).
//   4. CodexAdapter.generateText mit User-Message rufen.
//   5. Response-Text + Plan-Type + Latency loggen.
//   6. Cleanup: authMode zurück auf 'api_key', Token löschen.
//
// End-to-End-Smoke 2 (curl gegen /twins/:handle/chat) läuft separat, weil
// dafür `pnpm dev` parallel mitlaufen muss.
//
// Aufruf:
//   pnpm twin:oauth-phase3-spike

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WORKSPACE_ROOT = path.resolve(__dirname, "../../../..");
const DB_PATH =
  process.env.TWIN_DATABASE_PATH ??
  path.resolve(WORKSPACE_ROOT, "data/twin.db");

type Mode = "smoke" | "setup" | "cleanup";

function parseMode(): Mode {
  const arg = process.argv[2];
  if (!arg || arg === "smoke") return "smoke";
  if (arg === "setup" || arg === "cleanup") return arg;
  throw new Error(
    `Unbekannter Mode '${arg}'. Erlaubt: smoke (default) | setup | cleanup.`,
  );
}

// Phase 4.1: setup-Mode dieses Spikes ist DEPRECATED — Production-CLI
// `pnpm twin:oauth-login <@handle>` ersetzt ihn vollständig (inkl. codex
// login Subprocess-Wrapper). smoke + cleanup bleiben für Diagnose-Sessions.

async function main(): Promise<void> {
  const mode = parseMode();
  console.log(`=== #131 Phase 3.0 Spike — Mode: ${mode} ===\n`);

  if (mode === "setup") {
    console.warn(
      `⚠️  setup-Mode ist DEPRECATED seit Phase 4.1. Bitte stattdessen:\n` +
        `      pnpm twin:oauth-login @<handle>\n` +
        `   Production-CLI wrapt 'codex login' direkt — kein manueller ` +
        `Token-Refresh nötig.\n`,
    );
  }

  const masterKey = loadMasterKey();
  const repo = createSqliteRepository(DB_PATH);
  const profilesRepo = new TwinProfilesRepo(repo.db);
  const tokensRepo = new OAuthTokensRepo(repo.db, masterKey);

  const profiles = profilesRepo.list({ activeOnly: true });
  if (profiles.length === 0) {
    throw new Error(`Kein aktiver Twin in ${DB_PATH}.`);
  }
  const testTwin = profiles[0]!;
  console.log(
    `Test-Twin: ${testTwin.handle} (twinId=${testTwin.twinId}, ` +
      `aktueller authMode=${testTwin.authMode})`,
  );

  if (mode === "cleanup") {
    profilesRepo.setAuthMode(testTwin.twinId, "api_key");
    try {
      tokensRepo.delete(testTwin.twinId, "openai");
    } catch {
      /* war evtl. nie geschrieben */
    }
    console.log(
      `🧹 ${testTwin.handle}: authMode='api_key', oauth_tokens-Eintrag entfernt.`,
    );
    return;
  }

  // setup oder smoke → Token laden und authMode='oauth' setzen
  const { accessToken, refreshToken, accountId } = loadCodexToken();
  console.log(`✅ Codex-Token geladen (account=${accountId ?? "?"})`);

  profilesRepo.setAuthMode(testTwin.twinId, "oauth");
  const expiresAt = new Date(Date.now() + 50 * 60 * 1000).toISOString();
  tokensRepo.upsert({
    twinId: testTwin.twinId,
    provider: "openai",
    accessToken,
    refreshToken,
    expiresAt,
    accountId,
  });
  console.log(
    `✅ authMode='oauth' gesetzt, Token persistiert (expires ${expiresAt})`,
  );

  if (mode === "setup") {
    console.log(
      `\n🔧 Setup fertig. Twin ${testTwin.handle} ist jetzt im OAuth-Mode.\n` +
        `   - curl-Smoke gegen /twins/${testTwin.handle}/chat möglich (pnpm dev)\n` +
        `   - Cleanup danach: pnpm twin:oauth-phase3-spike cleanup`,
    );
    return;
  }

  // mode === "smoke" → Adapter direkt rufen, mit Cleanup
  const originalAuthMode = testTwin.authMode;
  try {
    const refreshService = new OAuthRefreshService(tokensRepo, repo.audit);
    const adapter = new CodexAdapter(refreshService);

    console.log("\n→ Codex-Endpoint-Call läuft …");
    // Phase 3.2: Adapter ist jetzt reiner HTTP-Client — Caller liefert
    // pre-built instructions + input. Smoke nutzt Minimal-Variante (kein
    // Persona/Facts/Memory — das verifiziert der End-to-End-Smoke gegen
    // /twins/:handle/chat).
    const result = await adapter.generateText({
      twinId: testTwin.twinId,
      instructions: "You are a helpful coding assistant.",
      input: [
        {
          type: "message",
          role: "user",
          content: [
            { type: "input_text", text: "Say hello in exactly three words." },
          ],
        },
      ],
    });

    console.log(`\n✅ HTTP 200 in ${result.latencyMs}ms`);
    console.log(`   plan-type: ${result.planType ?? "(kein Header)"}`);
    console.log(`   cf-ray:    ${result.cfRay ?? "(kein Header)"}`);
    console.log(`   text:      "${result.text}"`);

    if (!result.text || result.text.trim().length === 0) {
      throw new Error(
        "Response-Text ist leer — Adapter hat keine Deltas gesammelt",
      );
    }
  } finally {
    profilesRepo.setAuthMode(testTwin.twinId, originalAuthMode);
    try {
      tokensRepo.delete(testTwin.twinId, "openai");
    } catch {
      /* war evtl. nie geschrieben */
    }
    console.log(
      `\n🧹 Cleanup: ${testTwin.handle} authMode zurück auf '${originalAuthMode}'.`,
    );
  }

  console.log("\n=== Smoke 1 grün ===");
}

main().catch((err) => {
  console.error("\n❌ Smoke 1 failed:", err);
  process.exit(1);
});
