import Database from "better-sqlite3";
import { TrustRepo, type FamiliarityLevel } from "../trust/trust-repo.js";
import { buildFamiliarityBlock } from "../trust/prompt-builder.js";

// ─── TEST: familiarity-Ton-Block (Phase 4.3 Schritt 2/5) ────────────────────
//
// 1) buildFamiliarityBlock-Unit: alle vier Level → erwarteter Ton-Leitsatz +
//    Partner eingesetzt; leerer Partner → null.
// 2) Kette getFamiliarity → buildFamiliarityBlock gegen das 029-Schema: eine
//    'vertraut'-Row liefert den vertraut-Leitsatz; Partner ohne Row → 'fremd'-Ton.
//
//   pnpm --filter @nolmi/runtime exec tsx src/scripts/test-familiarity-block.ts

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

// Erwartete Leitsatz-Marker pro Level (Substanz, nicht Wortlaut-Volltext).
const MARK: Record<FamiliarityLevel, string> = {
  fremd: "kaum",
  bekannt: "etwas",
  vertraut: "gut",
  eng: "steht dir nahe",
};

function main(): void {
  // ── 1) Unit: alle vier Level ──
  console.log("\n── 1) buildFamiliarityBlock — vier Stufen");
  (["fremd", "bekannt", "vertraut", "eng"] as FamiliarityLevel[]).forEach((lvl) => {
    const block = buildFamiliarityBlock(lvl, "@florian");
    assert(block !== null && block.includes("## Beziehung zu @florian"), `${lvl}: Header + Partner`);
    assert(!!block && block.includes(MARK[lvl]), `${lvl}: Ton-Leitsatz-Marker "${MARK[lvl]}"`);
    assert(!!block && block.includes("@florian"), `${lvl}: Partner eingesetzt`);
  });
  // Substanz-Konstanz-Marker (zwei der vier nennen ihn explizit)
  assert((buildFamiliarityBlock("fremd", "@x") ?? "").includes("Substanz"), "fremd nennt Substanz-Konstanz");
  // Defensive: leerer Partner → null
  assert(buildFamiliarityBlock("vertraut", "   ") === null, "leerer Partner → null");

  // ── 2) Kette getFamiliarity → buildFamiliarityBlock (029-Schema) ──
  console.log("\n── 2) Kette getFamiliarity → Ton-Block");
  const db = new Database(":memory:");
  db.pragma("foreign_keys = OFF");
  db.exec(SCHEMA);
  const repo = new TrustRepo(db);
  repo.add("twin_x", "@florian", "u1"); // DEFAULT → vertraut
  repo.setFamiliarity("twin_x", "@florian", "vertraut");

  const lvlF = repo.getFamiliarity("twin_x", "@florian");
  const blockF = buildFamiliarityBlock(lvlF, "@florian");
  assert(lvlF === "vertraut", "getFamiliarity(@florian) = 'vertraut'");
  assert(!!blockF && blockF.includes("gut"), "vertraut-Row → vertraut-Leitsatz im Block");

  // Partner ohne Row → fremd-Default → fremd-Ton
  const lvlN = repo.getFamiliarity("twin_x", "@niemand");
  const blockN = buildFamiliarityBlock(lvlN, "@niemand");
  assert(lvlN === "fremd", "getFamiliarity(@niemand, keine Row) = 'fremd'");
  assert(!!blockN && blockN.includes("kaum"), "fremd-Default → fremd-Leitsatz (erzeugt Block, nicht null)");

  // eng-Pfad
  repo.setFamiliarity("twin_x", "@florian", "eng");
  assert((buildFamiliarityBlock(repo.getFamiliarity("twin_x", "@florian"), "@florian") ?? "").includes("steht dir nahe"), "nach setFamiliarity('eng') → eng-Leitsatz");

  db.close();
  console.log(failures === 0
    ? "\n✅ ALLE CHECKS GRÜN — vier Ton-Stufen, fremd erzeugt Block, Kette getFamiliarity→Block korrekt.\n"
    : `\n❌ ${failures} CHECK(S) FEHLGESCHLAGEN.\n`);
  if (failures > 0) process.exit(1);
}
main();
