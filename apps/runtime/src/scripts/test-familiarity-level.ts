import Database from "better-sqlite3";
import { TrustRepo } from "../trust/trust-repo.js";

// ─── TEST: familiarity_level Schema + Repo (Phase 4.3 Schritt 1/5) ──────────
//
// Self-contained gegen eine raw temp-DB (foreign_keys OFF — wir testen nur die
// Trust-Schicht, kein twin_profiles/users-Graph). Zwei Teile:
//   1) Backfill-Mechanik: 006-Schema-Row → ALTER 029 → wird 'vertraut'
//      (genau was auf der echten Dev-DB mit den 2 Bestands-Rows passiert).
//   2) Repo getFamiliarity/setFamiliarity + DEFAULT + CHECK.
//
//   pnpm --filter @nolmi/runtime exec tsx src/scripts/test-familiarity-level.ts

let failures = 0;
function assert(cond: boolean, label: string): void {
  if (cond) console.log(`  ✓ ${label}`);
  else { console.error(`  ✗ FAIL: ${label}`); failures += 1; }
}

const CREATE_006 = `
  CREATE TABLE trust_relationships (
    trust_id TEXT PRIMARY KEY NOT NULL, twin_id TEXT NOT NULL,
    trusted_handle TEXT NOT NULL, note TEXT, created_at TEXT NOT NULL,
    created_by_user_id TEXT NOT NULL, UNIQUE (twin_id, trusted_handle)
  );`;
const ALTER_029 = `
  ALTER TABLE trust_relationships
    ADD COLUMN familiarity_level TEXT NOT NULL DEFAULT 'vertraut'
    CHECK (familiarity_level IN ('fremd','bekannt','vertraut','eng'));`;

function main(): void {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = OFF");
  db.exec(CREATE_006);

  // ── 1) Backfill-Mechanik ──
  console.log("\n── 1) Backfill: Bestands-Row (006) → ALTER 029 → 'vertraut'");
  db.prepare(
    `INSERT INTO trust_relationships (trust_id, twin_id, trusted_handle, note, created_at, created_by_user_id)
     VALUES ('t_old','twin_x','@florian',NULL,'2026-05-01','u1')`,
  ).run();
  db.exec(ALTER_029);
  const backfilled = db.prepare("SELECT familiarity_level FROM trust_relationships WHERE trust_id='t_old'").get() as { familiarity_level: string };
  assert(backfilled.familiarity_level === "vertraut", "Bestands-Row backfilled → 'vertraut'");
  const cnt = (db.prepare("SELECT COUNT(*) c FROM trust_relationships").get() as { c: number }).c;
  assert(cnt === 1, "keine neue Row durch ALTER");

  // ── 2) Schema-Guard (CHECK) ──
  console.log("\n── 2) CHECK greift");
  let checkThrew = false;
  try {
    db.prepare(`INSERT INTO trust_relationships (trust_id,twin_id,trusted_handle,created_at,created_by_user_id,familiarity_level) VALUES ('bog','twin_x','@bogus','2026','u1','BOGUS')`).run();
  } catch { checkThrew = true; }
  assert(checkThrew, "Insert mit bogus level → rejected");

  // ── 3) Repo: DEFAULT via add() (unverändert) + getFamiliarity ──
  console.log("\n── 3) add() unverändert → DEFAULT 'vertraut'; getFamiliarity");
  const repo = new TrustRepo(db);
  repo.add("twin_x", "@heiko", "u1");
  assert(repo.getFamiliarity("twin_x", "@heiko") === "vertraut", "neuer add() → 'vertraut' (DEFAULT, add() ungeändert)");
  assert(repo.isTrusted("twin_x", "@heiko") === true, "isTrusted weiter row-basiert (unverändert)");

  // getFamiliarity: bekannt vs. fremd-Default
  assert(repo.getFamiliarity("twin_x", "@florian") === "vertraut", "bekannter Partner @florian → 'vertraut'");
  assert(repo.getFamiliarity("twin_x", "@niemand") === "fremd", "unbekannter Partner → 'fremd' (Lese-Default, keine Row)");

  // ── 4) setFamiliarity: bestehende Row + Fehler bei fehlender Row ──
  console.log("\n── 4) setFamiliarity");
  repo.setFamiliarity("twin_x", "@florian", "eng");
  assert(repo.getFamiliarity("twin_x", "@florian") === "eng", "setFamiliarity @florian → 'eng'");
  let setThrew = false;
  try { repo.setFamiliarity("twin_x", "@niemand", "eng"); } catch { setThrew = true; }
  assert(setThrew, "setFamiliarity auf Partner OHNE Row → wirft (kein Auto-Insert)");
  assert(repo.isTrusted("twin_x", "@niemand") === false, "@niemand weiterhin nicht getrustet (keine Row angelegt)");

  db.close();
  console.log(failures === 0
    ? "\n✅ ALLE CHECKS GRÜN — additiv, Backfill→vertraut, fremd=Lese-Default, kein Auto-Insert, Dispatch unberührt.\n"
    : `\n❌ ${failures} CHECK(S) FEHLGESCHLAGEN.\n`);
  if (failures > 0) process.exit(1);
}
main();
