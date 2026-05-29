import "dotenv/config";
import type { Fact } from "../facts/repo.js";
import {
  buildFactsBlock,
  humanizeFactKey,
} from "../facts/prompt-builder.js";

// ─── TEST: FACTS PROMPT-BUILDER (Phase 3.3 Sub-Schritt E) ───────────────────
//
// Pure-Function-Tests — keine DB, keine Migrations, keine Fixtures. Wir
// füttern `humanizeFactKey` + `buildFactsBlock` mit handgebauten Inputs und
// prüfen die Outputs. Schnell und deterministisch.
//
// Aufruf: pnpm --filter @nolmi/runtime test-prompt-builder

async function main() {
  let issues = 0;

  // ─── TEST 1: humanizeFactKey ───────────────────────────────────────────
  banner("TEST 1 — humanizeFactKey: snake_case → Sentence case");
  {
    const cases: Array<[string, string]> = [
      ["wife_name", "Wife name"],
      ["company", "Company"],
      ["FAVORITE_COLOR", "Favorite color"],
      ["a_b_c_d", "A b c d"],
      ["", ""],
      ["single", "Single"],
      ["_leading_underscore", " leading underscore"], // edge — sehen wir das
      ["trailing_", "Trailing "],
    ];
    for (const [input, expected] of cases) {
      const got = humanizeFactKey(input);
      if (got !== expected) {
        issues += 1;
        log(`  ⚠ "${input}" → expected "${expected}", got "${got}"`);
      } else {
        log(`  "${input}" → "${got}" ✓`);
      }
    }
  }

  // ─── TEST 2: buildFactsBlock mit leerer Liste → null ───────────────────
  banner("TEST 2 — buildFactsBlock([]) → null");
  {
    const got = buildFactsBlock([]);
    if (got !== null) {
      issues += 1;
      log(`  ⚠ buildFactsBlock([]) sollte null sein, got: ${got}`);
    } else {
      log("  null ✓");
    }
  }

  // ─── TEST 3: buildFactsBlock mit 1 Fact ────────────────────────────────
  banner("TEST 3 — buildFactsBlock mit einem Fact");
  {
    const got = buildFactsBlock([makeFact("wife_name", "Anna")]);
    const expected = "**Was du weißt:**\n- Wife name: Anna";
    if (got !== expected) {
      issues += 1;
      log(`  ⚠ unexpected:\n--- expected ---\n${expected}\n--- got ---\n${got}`);
    } else {
      log("  Header + 1 Bullet ✓");
    }
  }

  // ─── TEST 4: buildFactsBlock mit 3 Facts, alphabetisch sortiert ────────
  banner("TEST 4 — buildFactsBlock mit 3 Facts (alphabetisch sortiert)");
  {
    // Bewusst NICHT alphabetisch reinreichen — der Builder muss selbst
    // sortieren.
    const got = buildFactsBlock([
      makeFact("wife_name", "Anna"),
      makeFact("company", "Harway Experience"),
      makeFact("city", "Roding"),
    ]);
    const expected = [
      "**Was du weißt:**",
      "- City: Roding",
      "- Company: Harway Experience",
      "- Wife name: Anna",
    ].join("\n");
    if (got !== expected) {
      issues += 1;
      log(`  ⚠ unexpected:\n--- expected ---\n${expected}\n--- got ---\n${got}`);
    } else {
      log("  3 Facts alphabetisch ✓");
    }
  }

  // ─── TEST 5: Format-Verification ───────────────────────────────────────
  banner("TEST 5 — Format-Details (Header, Bullets, Newlines)");
  {
    const got = buildFactsBlock([
      makeFact("alpha", "A"),
      makeFact("beta", "B"),
    ]);
    if (!got) {
      issues += 1;
      log("  ⚠ Block ist null — sollte gerendert werden");
    } else {
      if (!got.startsWith("**Was du weißt:**\n")) {
        issues += 1;
        log("  ⚠ Header fehlt oder falsch positioniert");
      } else {
        log("  Header korrekt ✓");
      }
      const lines = got.split("\n");
      const bullets = lines.filter((l) => l.startsWith("- "));
      if (bullets.length !== 2) {
        issues += 1;
        log(`  ⚠ erwartet 2 Bullets, gefunden ${bullets.length}`);
      } else {
        log("  Bullets korrekt ✓");
      }
      // Keine Trailing-Newlines am Ende
      if (got.endsWith("\n")) {
        issues += 1;
        log("  ⚠ Trailing-Newline am Ende — sollte gestrippt sein");
      } else {
        log("  Keine Trailing-Newlines ✓");
      }
    }
  }

  banner("ZUSAMMENFASSUNG");
  if (issues === 0) {
    log("✓ alle Tests grün");
  } else {
    log(`✗ ${issues} Issue(s) — Details oben.`);
  }
  if (issues > 0) process.exit(2);
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeFact(factKey: string, factValue: string): Fact {
  // Dummy-Werte für die nicht-relevanten Felder — buildFactsBlock liest nur
  // factKey + factValue. Source/Confidence sind hier "approved" weil der
  // Caller das ja schon gefiltert hätte; semantisch ist es egal für den
  // Renderer.
  const now = new Date().toISOString();
  return {
    id: `fact_test_${factKey}`,
    twinId: "twin_test",
    factKey,
    factValue,
    source: "user",
    confidence: "approved",
    createdAt: now,
    updatedAt: now,
  };
}

function banner(title: string) {
  const line = "─".repeat(72);
  console.log(`\n${line}\n  ${title}\n${line}`);
}

function log(msg: string) {
  console.log(msg);
}

main().catch((err) => {
  console.error(
    "\n[prompt-builder:test] Fehler:",
    err instanceof Error ? err.message : err,
  );
  process.exit(1);
});
