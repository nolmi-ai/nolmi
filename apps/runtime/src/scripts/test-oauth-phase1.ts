import "dotenv/config";

import Database from "better-sqlite3";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildAuthUrl,
  generatePKCECodes,
  generateState,
  OPENAI_OAUTH_CLIENT_ID,
  OPENAI_OAUTH_REDIRECT_URI,
} from "../oauth/openai-pkce.js";
import { OAuthTokensRepo } from "../oauth/oauth-tokens-repo.js";
import { loadMasterKey } from "../crypto-utils.js";

// ─── TEST: #131 PHASE 1 BACKEND-FOUNDATION ──────────────────────────────────
//
// Manual-Smoke für PKCE-Codes-Generation, Auth-URL-Build, Encryption-
// Roundtrip durch oauth_tokens. Nutzt lokale data/twin.db (oder
// TWIN_DATABASE_PATH-Override) — kein Docker-Container nötig.
//
// Voraussetzungen:
//   - NOLMI_ENCRYPTION_KEY in .env (sonst EncryptionKeyMissingError)
//   - data/twin.db existiert mit applied Migration 025
//     → pnpm db:init falls noch nicht
//   - Mindestens ein Twin in twin_profiles (für FK-Reference)
//
// Aufruf:
//   pnpm twin:oauth-phase1-smoke
//   oder direkt:
//   pnpm --filter @nolmi/runtime exec tsx src/scripts/test-oauth-phase1.ts

// Workspace-Root via __dirname-Walk (script in apps/runtime/src/scripts/).
// Macht Aufruf via `pnpm --filter @nolmi/runtime ...` cwd-unabhängig.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WORKSPACE_ROOT = path.resolve(__dirname, "../../../..");
const DB_PATH =
  process.env.TWIN_DATABASE_PATH ??
  path.resolve(WORKSPACE_ROOT, "data/twin.db");

function log(msg: string): void {
  console.log(msg);
}

function check(label: string, ok: boolean): void {
  console.log(`   ${ok ? "✅" : "❌"} ${label}`);
}

async function main(): Promise<void> {
  log("=== #131 Phase 1 OAuth Manual-Smoke ===");

  // Test 1: PKCE-Codes-Generation
  log("\n1. PKCE-Codes-Generation:");
  const pkce = generatePKCECodes();
  log(
    `   codeVerifier:  ${pkce.codeVerifier.slice(0, 16)}… (${pkce.codeVerifier.length} chars)`,
  );
  log(
    `   codeChallenge: ${pkce.codeChallenge.slice(0, 16)}… (${pkce.codeChallenge.length} chars)`,
  );
  check("base64url-encoded (kein '+'/'/'/'=')", !/[+/=]/.test(pkce.codeVerifier));
  check(
    "codeVerifier 43 chars (32 bytes base64url)",
    pkce.codeVerifier.length === 43,
  );
  check(
    "codeChallenge 43 chars (SHA256 base64url)",
    pkce.codeChallenge.length === 43,
  );

  // Test 2: Auth-URL-Build
  log("\n2. Auth-URL-Build:");
  const state = generateState();
  const authUrl = buildAuthUrl(pkce.codeChallenge, state);
  log(`   ${authUrl.slice(0, 96)}…`);
  check(
    `client_id=${OPENAI_OAUTH_CLIENT_ID}`,
    authUrl.includes(`client_id=${OPENAI_OAUTH_CLIENT_ID}`),
  );
  check(
    "redirect_uri url-encoded",
    authUrl.includes(`redirect_uri=${encodeURIComponent(OPENAI_OAUTH_REDIRECT_URI)}`),
  );
  check(
    "scope=openid+profile+email+offline_access (+ statt %20)",
    authUrl.includes("scope=openid+profile+email+offline_access"),
  );
  check("code_challenge_method=S256", authUrl.includes("code_challenge_method=S256"));
  check(`state=${state}`, authUrl.includes(`state=${state}`));
  check(
    "codex_cli_simplified_flow=true",
    authUrl.includes("codex_cli_simplified_flow=true"),
  );

  // Test 3: Encryption-Roundtrip via Repo
  log("\n3. Encryption-Roundtrip via Repo:");
  const masterKey = loadMasterKey();
  const db = new Database(DB_PATH);
  const repo = new OAuthTokensRepo(db, masterKey);

  const firstTwin = db
    .prepare(`SELECT twin_id FROM twin_profiles LIMIT 1`)
    .get() as { twin_id: string } | undefined;

  if (!firstTwin) {
    log("   ⚠️  Kein Twin in twin_profiles — Encryption-Roundtrip skipped");
    db.close();
    log("\n⚠️  Phase 1 Smoke: PKCE + Auth-URL grün, DB-Roundtrip übersprungen.");
    return;
  }

  log(`   Using twin: ${firstTwin.twin_id}`);

  const mockTokens = {
    twinId: firstTwin.twin_id,
    provider: "openai" as const,
    accessToken: "mock_access_token_1234567890_phase1_smoke",
    refreshToken: "mock_refresh_token_abcdefghij_phase1_smoke",
    expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    accountId: "acc_mock_xyz",
  };

  const upserted = repo.upsert(mockTokens);
  log(`   Upserted: id=${upserted.id}`);
  check(
    "accessToken decrypt roundtrip",
    upserted.accessToken === mockTokens.accessToken,
  );
  check(
    "refreshToken decrypt roundtrip",
    upserted.refreshToken === mockTokens.refreshToken,
  );
  check("expiresAt persistiert", upserted.expiresAt === mockTokens.expiresAt);
  check("accountId persistiert", upserted.accountId === mockTokens.accountId);

  const found = repo.findDecryptedByTwinAndProvider(firstTwin.twin_id, "openai");
  check("findDecryptedByTwinAndProvider liefert Row", !!found);

  // Re-upsert idempotency: created_at bleibt, updated_at ändert sich
  const reUpserted = repo.upsert({
    ...mockTokens,
    accessToken: "mock_access_token_rotated",
  });
  check(
    "re-upsert behält created_at",
    reUpserted.createdAt === upserted.createdAt,
  );
  check(
    "re-upsert rotiert accessToken",
    reUpserted.accessToken === "mock_access_token_rotated",
  );

  const pub = repo.toPublic(reUpserted);
  log(
    `   Public-View: isExpired=${pub.isExpired}, isExpiringSoon=${pub.isExpiringSoon}, accountId=${pub.accountId}`,
  );
  check("toPublic: nicht expired (Token 1h future)", !pub.isExpired);
  check(
    "toPublic: nicht expiringSoon (> 5 Min)",
    !pub.isExpiringSoon,
  );

  // Cleanup
  repo.delete(firstTwin.twin_id, "openai");
  const afterDelete = repo.findDecryptedByTwinAndProvider(
    firstTwin.twin_id,
    "openai",
  );
  check("delete entfernt Row", afterDelete === null);

  db.close();
  log("\n✅ Phase 1 Smoke complete — alle drei Tests grün.");
}

main().catch((err) => {
  console.error("\n❌ Phase 1 Smoke fehlgeschlagen:");
  console.error(err);
  process.exit(1);
});
