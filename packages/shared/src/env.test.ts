// Smoke-Test für getEnv — verifiziert die 3 Aliasing-Pfade.
//
// Lauf: `pnpm --filter @nolmi/shared test:env`
// Throws bei Assertion-Fehler (non-zero Exit).
//
// Keine Vitest/Jest-Suite hier — der Codebase nutzt durchgehend
// node-assert-Smoke-Scripts. Wenn später ein Test-Runner ergänzt wird,
// passt diese Datei strukturell schon dazu.

import assert from "node:assert/strict";
import { getEnv, __resetEnvWarnings } from "./env.js";

function captureWarn(): { restore: () => void; calls: string[] } {
  const calls: string[] = [];
  const original = console.warn;
  console.warn = (...args: unknown[]) => {
    calls.push(args.map((a) => String(a)).join(" "));
  };
  return {
    calls,
    restore: () => {
      console.warn = original;
    },
  };
}

function withEnv(
  patches: Record<string, string | undefined>,
  fn: () => void,
): void {
  const snapshot: Record<string, string | undefined> = {};
  for (const key of Object.keys(patches)) snapshot[key] = process.env[key];
  for (const [key, value] of Object.entries(patches)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    fn();
  } finally {
    for (const [key, value] of Object.entries(snapshot)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

function testNewWins(): void {
  __resetEnvWarnings();
  const warn = captureWarn();
  withEnv({ NOLMI_FOO: "new", TWIN_LAB_FOO: "old" }, () => {
    const result = getEnv("NOLMI_FOO", "TWIN_LAB_FOO");
    assert.equal(result, "new", "beide gesetzt → neuer Name gewinnt");
    assert.equal(
      warn.calls.length,
      0,
      "neuer Name gesetzt → keine Deprecation-Warning",
    );
  });
  warn.restore();
}

function testOnlyOldWithWarning(): void {
  __resetEnvWarnings();
  const warn = captureWarn();
  withEnv({ NOLMI_BAR: undefined, TWIN_LAB_BAR: "fallback" }, () => {
    const result = getEnv("NOLMI_BAR", "TWIN_LAB_BAR");
    assert.equal(result, "fallback", "nur alter Name → Fallback greift");
    assert.equal(warn.calls.length, 1, "alter Name → genau eine Warning");
    assert.match(
      warn.calls[0] ?? "",
      /TWIN_LAB_BAR/,
      "Warning nennt alten Namen",
    );
    assert.match(
      warn.calls[0] ?? "",
      /NOLMI_BAR/,
      "Warning nennt neuen Namen",
    );

    // Zweiter Call darf nicht erneut warnen (warnOnce).
    getEnv("NOLMI_BAR", "TWIN_LAB_BAR");
    assert.equal(warn.calls.length, 1, "warnOnce → keine zweite Warning");
  });
  warn.restore();
}

function testOnlyNew(): void {
  __resetEnvWarnings();
  const warn = captureWarn();
  withEnv({ NOLMI_BAZ: "fresh", TWIN_LAB_BAZ: undefined }, () => {
    const result = getEnv("NOLMI_BAZ", "TWIN_LAB_BAZ");
    assert.equal(result, "fresh", "nur neuer Name → direkter Treffer");
    assert.equal(warn.calls.length, 0, "neuer Name → keine Warning");
  });
  warn.restore();
}

function testBothUnset(): void {
  __resetEnvWarnings();
  withEnv({ NOLMI_QUX: undefined, TWIN_LAB_QUX: undefined }, () => {
    const result = getEnv("NOLMI_QUX", "TWIN_LAB_QUX");
    assert.equal(result, undefined, "beide unset → undefined");
  });
}

function main(): void {
  testNewWins();
  testOnlyOldWithWarning();
  testOnlyNew();
  testBothUnset();
  console.log("✓ env.test.ts — 4/4 Cases OK");
}

main();
