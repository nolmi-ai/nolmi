import { strict as assert } from "node:assert";

import { CodexHttpError } from "../oauth/codex-http-error.js";
import { CodexStreamParseError } from "../oauth/codex-sse-parser.js";
import { isRetryableError, withRetry } from "../oauth/codex-retry.js";

// ─── SMOKE: #131 PHASE 3.1.2 — CODEX-RETRY ──────────────────────────────────
//
// Standalone-Smoke für Klassifizierung + withRetry-Loop. Pattern analog
// test-codex-sse-parser.ts (node:assert + Counter, kein vitest/jest).
//
// Zehn Cases:
//   1. CodexStreamParseError → no-retry
//   2. CodexHttpError 4xx → no-retry
//   3. CodexHttpError 5xx → retry
//   4. AbortError → no-retry (User-Cancel)
//   5. Network-Errors (ECONNRESET, fetch failed, …) → retry
//   6. Unknown Error mit beliebiger Message → no-retry (conservative default)
//   7. withRetry: Success im ersten Versuch → kein Retry, return value
//   8. withRetry: retry-Loop konvergiert nach 2 Failures
//   9. withRetry: non-retryable Error → sofort propagiert, kein Retry-Versuch
//  10. withRetry: max-Retries erschöpft → letzter Error wird geworfen
//
// Plus 11. — Bonus-Case: Backoff-Timing wird respektiert.
//
// Aufruf:
//   pnpm test-codex-retry

interface TestStats {
  passed: number;
  failed: number;
}

const stats: TestStats = { passed: 0, failed: 0 };

async function test(
  name: string,
  fn: () => Promise<void> | void,
): Promise<void> {
  try {
    await fn();
    stats.passed++;
    console.log(`  ✅ ${name}`);
  } catch (err) {
    stats.failed++;
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`  ❌ ${name}\n     ${msg}`);
    if (err instanceof Error && err.stack) {
      console.error(
        err.stack
          .split("\n")
          .slice(1, 4)
          .map((line) => `     ${line.trim()}`)
          .join("\n"),
      );
    }
  }
}

async function main(): Promise<void> {
  console.log("=== #131 Phase 3.1.2 — CodexRetry Smoke ===\n");

  // ─── isRetryableError-Klassifizierung ─────────────────────────────────────

  await test("isRetryableError: CodexStreamParseError → false", () => {
    const err = new CodexStreamParseError("response.failed", "rate_limit");
    assert.equal(isRetryableError(err), false);
  });

  await test("isRetryableError: CodexHttpError 4xx → false", () => {
    const err = new CodexHttpError("HTTP 401: Unauthorized", 401);
    assert.equal(isRetryableError(err), false);
  });

  await test("isRetryableError: CodexHttpError 5xx → true", () => {
    const err = new CodexHttpError("HTTP 502: Bad Gateway", 502);
    assert.equal(isRetryableError(err), true);
  });

  await test("isRetryableError: AbortError → false (User-Cancel)", () => {
    const err = new Error("user aborted");
    err.name = "AbortError";
    assert.equal(isRetryableError(err), false);
  });

  await test(
    "isRetryableError: Network-Errors (ECONNRESET, fetch failed) → true",
    () => {
      assert.equal(isRetryableError(new Error("socket hang up")), true);
      assert.equal(isRetryableError(new Error("ECONNRESET")), true);
      assert.equal(isRetryableError(new Error("ETIMEDOUT")), true);
      assert.equal(isRetryableError(new Error("ENOTFOUND chatgpt.com")), true);
      assert.equal(isRetryableError(new Error("fetch failed")), true);
    },
  );

  await test(
    "isRetryableError: Unbekannte Message → false (conservative default)",
    () => {
      assert.equal(isRetryableError(new Error("some random error")), false);
    },
  );

  // ─── withRetry-Loop ───────────────────────────────────────────────────────

  await test("withRetry: erster Versuch erfolgreich → kein Retry", async () => {
    let calls = 0;
    const result = await withRetry(async () => {
      calls++;
      return "ok";
    });
    assert.equal(result, "ok");
    assert.equal(calls, 1);
  });

  await test(
    "withRetry: Loop konvergiert nach 2 retry-würdigen Failures",
    async () => {
      let calls = 0;
      const result = await withRetry(
        async () => {
          calls++;
          if (calls < 3) throw new Error("ECONNRESET");
          return "success";
        },
        { backoffsMs: [5, 10, 20] }, // schnell für Test
      );
      assert.equal(result, "success");
      assert.equal(calls, 3); // initial + 2 retries
    },
  );

  await test(
    "withRetry: non-retryable Error wird sofort propagiert",
    async () => {
      let calls = 0;
      await assert.rejects(
        () =>
          withRetry(
            async () => {
              calls++;
              throw new CodexStreamParseError("response.failed", "rate_limit");
            },
            { backoffsMs: [5] },
          ),
        (err: unknown) => err instanceof CodexStreamParseError,
      );
      assert.equal(calls, 1); // kein Retry
    },
  );

  await test(
    "withRetry: max-Retries erschöpft → letzter Error wird geworfen",
    async () => {
      let calls = 0;
      const onRetryCalls: number[] = [];
      await assert.rejects(
        () =>
          withRetry(
            async () => {
              calls++;
              throw new Error("ECONNRESET");
            },
            {
              maxRetries: 3,
              backoffsMs: [5, 10, 20],
              onRetry: (attempt) => onRetryCalls.push(attempt),
            },
          ),
        (err: unknown) =>
          err instanceof Error && err.message.includes("ECONNRESET"),
      );
      assert.equal(calls, 4); // initial + 3 retries
      assert.deepEqual(onRetryCalls, [1, 2, 3]); // onRetry vor jedem Retry
    },
  );

  await test("withRetry: Backoff-Sequenz wird respektiert", async () => {
    const start = Date.now();
    const timings: number[] = [];
    let calls = 0;
    try {
      await withRetry(
        async () => {
          timings.push(Date.now() - start);
          calls++;
          throw new Error("ECONNRESET");
        },
        { maxRetries: 2, backoffsMs: [50, 100] },
      );
    } catch {
      /* expected */
    }
    assert.equal(calls, 3); // initial + 2 retries
    // timings[0] ≈ 0, timings[1] ≈ 50, timings[2] ≈ 150
    // Großzügige Bounds um CI-Jitter zu absorbieren.
    assert.ok(
      timings[1]! >= 45 && timings[1]! < 100,
      `timings[1] = ${timings[1]} ms (erwartet ~50 ± Jitter)`,
    );
    assert.ok(
      timings[2]! >= 145 && timings[2]! < 220,
      `timings[2] = ${timings[2]} ms (erwartet ~150 ± Jitter)`,
    );
  });

  console.log(
    `\n=== Result: ${stats.passed} passed, ${stats.failed} failed ===`,
  );
  if (stats.failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(
    "\n[codex-retry:test] Fataler Fehler:",
    err instanceof Error ? err.message : err,
  );
  process.exit(1);
});
