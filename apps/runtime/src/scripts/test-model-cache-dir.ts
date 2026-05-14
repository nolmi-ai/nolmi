import "dotenv/config";
import { applyModelCacheDir } from "../episodic/providers/local-provider.js";

// ─── TEST: MODELL-CACHE-PFAD (3.4.J.1 — Pre-Deploy-Patch) ──────────────────
//
// Prüft applyModelCacheDir() — die Funktion, die env.cacheDir von
// @huggingface/transformers aus TWIN_LAB_MODEL_CACHE_DIR setzt. Reiner
// Unit-Test mit Fake-env-Objekt, KEIN Modell-Load (das ist der Sinn der
// Auslagerung aus getExtractor()).
//
// Hintergrund: transformers.js 4.2.0 ignoriert HF_HOME UND TRANSFORMERS_CACHE,
// deshalb die eigene ENV-Variable. Ohne sie bleibt env.cacheDir unangetastet
// (Default: .cache/ in node_modules — überlebt Container-Recreates nicht).
//
// Aufruf:
//   pnpm --filter @twin-lab/runtime test-model-cache-dir

function main() {
  let issues = 0;
  // ENV-Snapshot, damit der Test eine evtl. real gesetzte Variable nicht
  // dauerhaft überschreibt.
  const snapshot = process.env.TWIN_LAB_MODEL_CACHE_DIR;

  banner("TEST 1 — ENV nicht gesetzt → env.cacheDir bleibt unverändert");
  delete process.env.TWIN_LAB_MODEL_CACHE_DIR;
  {
    const fakeEnv: { cacheDir: string | null } = {
      cacheDir: "/default/node_modules/.cache",
    };
    applyModelCacheDir(fakeEnv);
    if (fakeEnv.cacheDir !== "/default/node_modules/.cache") {
      issues += 1;
      log(`  ⚠ cacheDir wurde verändert obwohl ENV ungesetzt: ${fakeEnv.cacheDir}`);
    } else {
      log("  cacheDir unverändert ✓ (lokales Default-Verhalten)");
    }
  }

  banner("TEST 2 — ENV gesetzt → env.cacheDir wird übernommen");
  process.env.TWIN_LAB_MODEL_CACHE_DIR = "/app/data/model-cache";
  {
    const fakeEnv: { cacheDir: string | null } = {
      cacheDir: "/default/node_modules/.cache",
    };
    applyModelCacheDir(fakeEnv);
    if (fakeEnv.cacheDir !== "/app/data/model-cache") {
      issues += 1;
      log(`  ⚠ cacheDir nicht übernommen — got: ${fakeEnv.cacheDir}`);
    } else {
      log("  cacheDir = /app/data/model-cache ✓");
    }
  }

  // ENV restoren.
  if (snapshot === undefined) delete process.env.TWIN_LAB_MODEL_CACHE_DIR;
  else process.env.TWIN_LAB_MODEL_CACHE_DIR = snapshot;

  banner("ZUSAMMENFASSUNG");
  if (issues === 0) {
    log("✓ alle Tests grün");
  } else {
    log(`✗ ${issues} Issue(s) — Details oben.`);
    process.exit(2);
  }
}

// ─── helpers ────────────────────────────────────────────────────────────────

function banner(title: string) {
  const line = "─".repeat(72);
  console.log(`\n${line}\n  ${title}\n${line}`);
}

function log(msg: string) {
  console.log(msg);
}

try {
  main();
} catch (err) {
  console.error(
    "\n[model-cache-dir:test] Fehler:",
    err instanceof Error ? err.stack ?? err.message : err,
  );
  process.exit(1);
}
