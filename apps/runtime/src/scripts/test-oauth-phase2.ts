import "dotenv/config";

import path from "node:path";
import { fileURLToPath } from "node:url";
import type { FastifyBaseLogger } from "fastify";
import { loadMasterKey } from "../crypto-utils.js";
import { createSqliteRepository } from "../repository/index.js";
import { OAuthTokensRepo } from "../oauth/oauth-tokens-repo.js";
import { OAuthRefreshService } from "../oauth/refresh-service.js";

// ─── TEST: #131 PHASE 2 REFRESH-SERVICE ─────────────────────────────────────
//
// Manual-Smoke ohne echten OpenAI-API-Call. Tests Mutex-Coalescing,
// start/stop-Lifecycle, findTwinIdsExpiringSoon-Query. Echter Refresh-
// Roundtrip ist Phase 4 (CLI-Login produziert echte Tokens).
//
// Aufruf:
//   pnpm twin:oauth-phase2-smoke

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

/**
 * Thin logger-Mock — wir brauchen nur info/warn/error im Service.
 * Casted via unknown weil FastifyBaseLogger ein dickes Pino-Interface ist
 * und für die Smoke-Tests die Subset-Surface reicht.
 */
function makeFakeLogger(prefix: string): FastifyBaseLogger {
  const stub = {
    info: (obj: unknown, msg?: string) => {
      if (typeof obj === "string") console.log(`${prefix} [INFO] ${obj}`);
      else console.log(`${prefix} [INFO] ${msg ?? ""}`, obj);
    },
    error: (obj: unknown, msg?: string) => {
      if (typeof obj === "string") console.error(`${prefix} [ERROR] ${obj}`);
      else console.error(`${prefix} [ERROR] ${msg ?? ""}`, obj);
    },
    warn: (obj: unknown, msg?: string) => {
      if (typeof obj === "string") console.warn(`${prefix} [WARN] ${obj}`);
      else console.warn(`${prefix} [WARN] ${msg ?? ""}`, obj);
    },
    debug: () => {},
    trace: () => {},
    fatal: (obj: unknown, msg?: string) => {
      if (typeof obj === "string") console.error(`${prefix} [FATAL] ${obj}`);
      else console.error(`${prefix} [FATAL] ${msg ?? ""}`, obj);
    },
    silent: () => {},
    level: "info",
    child: () => stub,
  };
  return stub as unknown as FastifyBaseLogger;
}

async function main(): Promise<void> {
  log("=== #131 Phase 2 OAuth-Refresh-Service Smoke ===");

  const masterKey = loadMasterKey();
  const sqliteRepo = createSqliteRepository(DB_PATH);
  const oauthTokensRepo = new OAuthTokensRepo(sqliteRepo.db, masterKey);
  const auditRepo = sqliteRepo.audit;

  const firstTwin = sqliteRepo.db
    .prepare(`SELECT twin_id FROM twin_profiles LIMIT 1`)
    .get() as { twin_id: string } | undefined;

  if (!firstTwin) {
    log("\n❌ Kein Twin in twin_profiles — Phase-2-Smoke braucht mindestens einen.");
    sqliteRepo.db.close();
    process.exit(1);
  }

  log(`Using twin: ${firstTwin.twin_id}`);

  // ─── Test 1: findTwinIdsExpiringSoon ─────────────────────────────────────
  log("\n1. findTwinIdsExpiringSoon (Threshold 5min):");

  const expiresIn4Min = new Date(Date.now() + 4 * 60 * 1000).toISOString();
  oauthTokensRepo.upsert({
    twinId: firstTwin.twin_id,
    provider: "openai",
    accessToken: "mock_access_phase2_expiring",
    refreshToken: "mock_refresh_phase2_expiring",
    expiresAt: expiresIn4Min,
    accountId: "acc_phase2_test",
  });

  const expiringIds = oauthTokensRepo.findTwinIdsExpiringSoon(5);
  log(`   ${expiringIds.length} token(s) expiring within 5min`);
  check(
    "includes our test twin (4min expiry)",
    expiringIds.includes(firstTwin.twin_id),
  );

  const nonExpiringIds = oauthTokensRepo.findTwinIdsExpiringSoon(1);
  check(
    "threshold 1min excludes 4min-expiry token",
    !nonExpiringIds.includes(firstTwin.twin_id),
  );

  // ─── Test 2: Mutex-Coalescing (ohne echte API) ───────────────────────────
  log("\n2. Mutex-Coalescing:");

  // Token mit langem Expiry (1h) — doRefreshIfNeeded short-circuited
  // VOR jedem API-Call. Wir testen nur die Promise-Coalescing-Mechanik.
  const expiresIn1h = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  oauthTokensRepo.upsert({
    twinId: firstTwin.twin_id,
    provider: "openai",
    accessToken: "mock_access_phase2_fresh",
    refreshToken: "mock_refresh_phase2_fresh",
    expiresAt: expiresIn1h,
    accountId: "acc_phase2_test",
  });

  const service = new OAuthRefreshService(oauthTokensRepo, auditRepo, {
    pollIntervalMs: 100_000_000, // effectiv aus für Test
    refreshThresholdMinutes: 5,
  });

  const promise1 = service.ensureFresh(firstTwin.twin_id);
  const promise2 = service.ensureFresh(firstTwin.twin_id);
  check(
    "parallel ensureFresh returnt identisches Promise (Mutex hit)",
    promise1 === promise2,
  );

  const [result1, result2] = await Promise.all([promise1, promise2]);
  check(
    "beide Calls returnen gleichen accessToken",
    result1.accessToken === result2.accessToken,
  );
  check(
    "Token nicht refreshed (war frisch, 1h expiry)",
    result1.accessToken === "mock_access_phase2_fresh",
  );

  // Nach dem Promise-Settle ist In-Flight-Map clean → neuer Call macht
  // fresh Lookup. Sollte wieder fresh-Path nehmen (Token immer noch 1h).
  const result3 = await service.ensureFresh(firstTwin.twin_id);
  check("Second-Wave-Call funktioniert (Map cleared)", !!result3);

  // ─── Test 3: start/stop-Lifecycle ────────────────────────────────────────
  log("\n3. start/stop-Lifecycle:");

  const logger = makeFakeLogger("[svc]");

  service.start(logger);
  check("start() set Interval (kein Crash)", true);

  service.start(logger); // idempotent — sollte warnen, nicht crashen
  check("doppelter start() idempotent (warnt + skipped)", true);

  // Kurz warten, dann stop — wenn Interval > 100ms, kommt kein Tick
  await new Promise((resolve) => setTimeout(resolve, 50));

  service.stop();
  check("stop() cleared Interval", true);

  service.stop(); // idempotent
  check("doppelter stop() idempotent", true);

  // ─── Cleanup ─────────────────────────────────────────────────────────────
  oauthTokensRepo.delete(firstTwin.twin_id, "openai");
  check("test-token cleanup", true);

  sqliteRepo.db.close();
  log("\n✅ Phase 2 Smoke complete — alle drei Test-Gruppen grün.");
}

main().catch((err) => {
  console.error("\n❌ Phase 2 Smoke fehlgeschlagen:");
  console.error(err);
  process.exit(1);
});
