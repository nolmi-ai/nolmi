import "dotenv/config";

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { loadMasterKey } from "../crypto-utils.js";
import { createSqliteRepository } from "../repository/index.js";
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
const CODEX_AUTH_PATH = path.resolve(os.homedir(), ".codex/auth.json");

interface CodexAuthFile {
  tokens?: {
    access_token?: string;
    refresh_token?: string;
    account_id?: string;
    id_token?: string;
  };
}

type Mode = "smoke" | "setup" | "cleanup";

function parseMode(): Mode {
  const arg = process.argv[2];
  if (!arg || arg === "smoke") return "smoke";
  if (arg === "setup" || arg === "cleanup") return arg;
  throw new Error(
    `Unbekannter Mode '${arg}'. Erlaubt: smoke (default) | setup | cleanup.`,
  );
}

function loadCodexToken(): {
  accessToken: string;
  refreshToken: string;
  accountId: string | null;
} {
  if (!fs.existsSync(CODEX_AUTH_PATH)) {
    throw new Error(
      `Codex-Auth-File nicht gefunden: ${CODEX_AUTH_PATH}. ` +
        `Bitte 'codex login' lokal laufen lassen vor dem Smoke.`,
    );
  }
  const auth = JSON.parse(
    fs.readFileSync(CODEX_AUTH_PATH, "utf-8"),
  ) as CodexAuthFile;
  const accessToken = auth.tokens?.access_token;
  if (!accessToken) {
    throw new Error(
      `Kein access_token in ${CODEX_AUTH_PATH}. ` +
        `'codex login --force' für frischen Token.`,
    );
  }
  return {
    accessToken,
    refreshToken: auth.tokens?.refresh_token ?? "",
    accountId: auth.tokens?.account_id ?? null,
  };
}

async function main(): Promise<void> {
  const mode = parseMode();
  console.log(`=== #131 Phase 3.0 Spike — Mode: ${mode} ===\n`);

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
    const result = await adapter.generateText({
      twinId: testTwin.twinId,
      userMessage: "Say hello in exactly three words.",
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
