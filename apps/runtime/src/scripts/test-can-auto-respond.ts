import Database from "better-sqlite3";
import { TrustRepo } from "../trust/trust-repo.js";

// ─── TEST: canAutoRespond — Autonomie-Abstufung (Phase 4.3 Schritt 5/5) ─────
//
// Self-contained gegen :memory: (029-Schema), foreign_keys OFF.
//   pnpm --filter @nolmi/runtime exec tsx src/scripts/test-can-auto-respond.ts

let failures = 0;
function assert(cond: boolean, label: string): void {
  if (cond) console.log(`  ✓ ${label}`);
  else { console.error(`  ✗ FAIL: ${label}`); failures += 1; }
}

const SCHEMA = `
  CREATE TABLE trust_relationships (
    trust_id TEXT PRIMARY KEY NOT NULL, twin_id TEXT NOT NULL,
    trusted_handle TEXT NOT NULL, note TEXT, created_at TEXT NOT NULL,
    created_by_user_id TEXT NOT NULL,
    familiarity_level TEXT NOT NULL DEFAULT 'vertraut'
      CHECK (familiarity_level IN ('fremd','bekannt','vertraut','eng')),
    UNIQUE (twin_id, trusted_handle)
  );`;

function main(): void {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = OFF");
  db.exec(SCHEMA);
  const repo = new TrustRepo(db);
  const T = "twin_x";

  // ── 2) Unit: vier Level + fremd-Default ──
  console.log("\n── 2) canAutoRespond pro Level");
  repo.add(T, "@florian", "u1"); // DEFAULT vertraut
  repo.setFamiliarity(T, "@florian", "vertraut");
  assert(repo.canAutoRespond(T, "@florian") === true, "vertraut → true");
  repo.setFamiliarity(T, "@florian", "eng");
  assert(repo.canAutoRespond(T, "@florian") === true, "eng → true");
  repo.setFamiliarity(T, "@florian", "bekannt");
  assert(repo.canAutoRespond(T, "@florian") === false, "bekannt → false (pending)");
  repo.setFamiliarity(T, "@florian", "fremd");
  assert(repo.canAutoRespond(T, "@florian") === false, "fremd → false (pending)");
  assert(repo.canAutoRespond(T, "@niemand") === false, "Partner ohne Row (fremd-Default) → false");

  // ── 3) Regressions-Beleg: konservative Linie = heutiges Verhalten ──
  console.log("\n── 3) Regression: Bestands-Verhalten unverändert");
  // Frisch via add() (= DEFAULT vertraut, wie der 029-Backfill bestehende Rows setzt)
  repo.add(T, "@heiko", "u1");
  assert(repo.canAutoRespond(T, "@heiko") === true, "frischer Trust (vertraut) → autonom wie früher 'trusted'");
  assert(repo.canAutoRespond(T, "@fremder") === false, "untrusted (keine Row) → pending wie früher");

  // ── 4) Graded-Mitte: Level steuert die Weiche ──
  console.log("\n── 4) Level steuert Autonomie-Weiche");
  repo.setFamiliarity(T, "@heiko", "bekannt");
  assert(repo.canAutoRespond(T, "@heiko") === false, "@heiko auf bekannt → NICHT mehr autonom (pending)");
  repo.setFamiliarity(T, "@heiko", "vertraut");
  assert(repo.canAutoRespond(T, "@heiko") === true, "zurück auf vertraut → wieder autonom");

  // ── 5) isTrusted unberührt (zwei Konzepte getrennt) ──
  console.log("\n── 5) isTrusted bleibt row-basiert (Listen-Semantik)");
  repo.setFamiliarity(T, "@heiko", "bekannt");
  assert(repo.isTrusted(T, "@heiko") === true, "@heiko isTrusted=true (Row da) trotz canAutoRespond=false");
  assert(repo.canAutoRespond(T, "@heiko") === false, "…und canAutoRespond=false — sauber getrennt");

  db.close();
  console.log(failures === 0
    ? "\n✅ ALLE CHECKS GRÜN — {vertraut,eng}→autonom, bekannt/fremd→pending, Bestand unverändert, isTrusted getrennt.\n"
    : `\n❌ ${failures} CHECK(S) FEHLGESCHLAGEN.\n`);
  if (failures > 0) process.exit(1);
}
main();
