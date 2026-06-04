import Database from "better-sqlite3";
import { FactsRepo } from "../facts/repo.js";
import { FactsHistoryRepo } from "../facts/facts-history-repo.js";

// ─── TEST: FACTS CAPTURE-LOGIK (#97 Schritt 2/4) ────────────────────────────
//
// Beweist Wert-Drift-/Delete-Capture in FactsRepo.upsert/delete + ATOMARITÄT.
// Voraussetzung: TWIN_DATABASE_PATH = per db:init migrierte Wegwerf-DB.
//
//   TWIN_DATABASE_PATH=/tmp/x.db pnpm --filter @nolmi/runtime exec tsx \
//     src/scripts/test-facts-capture.ts

let failures = 0;
function assert(cond: boolean, label: string): void {
  if (cond) console.log(`  ✓ ${label}`);
  else {
    console.error(`  ✗ FAIL: ${label}`);
    failures += 1;
  }
}

function histCount(db: Database.Database, twinId: string, key: string): number {
  return (
    db
      .prepare(`SELECT COUNT(*) AS c FROM facts_history WHERE twin_id = ? AND fact_key = ?`)
      .get(twinId, key) as { c: number }
  ).c;
}

function main(): void {
  const dbPath = process.env.TWIN_DATABASE_PATH;
  if (!dbPath) {
    console.error("TWIN_DATABASE_PATH nicht gesetzt.");
    process.exit(1);
  }
  const db = new Database(dbPath);
  db.pragma("foreign_keys = OFF"); // nur facts + facts_history nötig
  const history = new FactsHistoryRepo(db);
  const repo = new FactsRepo(db, history);
  const T = "twin_capture_test";

  // ── a) Wert-Drift ──
  console.log("\n── a) Wert-Drift Anna → Sabine");
  repo.upsert({ twinId: T, factKey: "wife_name", factValue: "Anna", source: "user", confidence: "approved" });
  repo.upsert({ twinId: T, factKey: "wife_name", factValue: "Sabine", source: "user", confidence: "approved" });
  assert(repo.get(T, "wife_name")?.factValue === "Sabine", "facts current = Sabine");
  assert(histCount(db, T, "wife_name") === 1, "facts_history: genau 1 Row");
  const drift = history.getTimeline(T, "wife_name")[0];
  assert(drift?.oldValue === "Anna" && drift?.changeType === "value_change", "Row: old_value=Anna, value_change");

  // ── b) No-op (gleicher Wert) ──
  console.log("\n── b) No-op: gleicher Wert nochmal");
  repo.upsert({ twinId: T, factKey: "wife_name", factValue: "Sabine", source: "user", confidence: "approved" });
  assert(histCount(db, T, "wife_name") === 1, "facts_history UNVERÄNDERT (immer noch 1)");

  // ── c) Erst-Anlage (kein abgelöster Zustand) ──
  console.log("\n── c) Erst-Anlage neuer Key");
  repo.upsert({ twinId: T, factKey: "city", factValue: "Roding", source: "user", confidence: "approved" });
  assert(repo.get(T, "city")?.factValue === "Roding", "facts hat city");
  assert(histCount(db, T, "city") === 0, "facts_history: KEINE Row (Erst-Anlage)");

  // ── d) Delete erfasst gelöschten Zustand ──
  console.log("\n── d) Delete wife_name");
  repo.delete(T, "wife_name");
  assert(repo.get(T, "wife_name") === null, "facts: wife_name weg");
  assert(histCount(db, T, "wife_name") === 2, "facts_history: 2. Row (delete)");
  const tl = history.getTimeline(T, "wife_name");
  assert(tl[1]?.oldValue === "Sabine" && tl[1]?.changeType === "delete", "Row2: old_value=Sabine, delete");

  // ── f) Timeline chronologisch ──
  console.log("\n── f) getTimeline chronologisch");
  assert(tl.length === 2 && tl[0]?.changeType === "value_change" && tl[1]?.changeType === "delete", "2 Rows: value_change → delete");

  // ── e) KERN: Atomarität — record() wirft → Overwrite rollt zurück ──
  console.log("\n── e) KERN: Atomarität (record wirft → kein Overwrite)");
  repo.upsert({ twinId: T, factKey: "atom", factValue: "V1", source: "user", confidence: "approved" });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const throwingHistory = { record: () => { throw new Error("boom-capture"); } } as unknown as FactsHistoryRepo;
  const failRepo = new FactsRepo(db, throwingHistory);
  let threw = false;
  try {
    failRepo.upsert({ twinId: T, factKey: "atom", factValue: "V2", source: "user", confidence: "approved" });
  } catch {
    threw = true;
  }
  assert(threw, "upsert warf (record-Fehler propagiert)");
  assert(repo.get(T, "atom")?.factValue === "V1", "facts.atom UNVERÄNDERT = V1 (Transaktion rollte zurück)");
  assert(histCount(db, T, "atom") === 0, "keine halbe History-Row geschrieben");

  // ── h) Read-Pfad: listByTwin liefert NUR current (kein History-Leak) ──
  console.log("\n── h) listByTwin = nur current facts");
  const current = repo.listByTwin(T).map((f) => f.factValue);
  assert(!current.includes("Anna"), "alter Wert 'Anna' NICHT im current-Read (kein History-Leak)");
  assert(current.includes("Roding") && current.includes("V1"), "current-Werte da (Roding, V1)");
  assert(!current.some((v) => v === undefined), "listByTwin liest facts-Tabelle (unverändert)");

  // Cleanup
  db.prepare("DELETE FROM facts WHERE twin_id = ?").run(T);
  db.prepare("DELETE FROM facts_history WHERE twin_id = ?").run(T);
  db.close();

  console.log(
    failures === 0
      ? "\n✅ ALLE CHECKS GRÜN — Capture nur bei echter Drift, atomar (Rollback bewiesen), kein History-Leak in Read-Pfad.\n"
      : `\n❌ ${failures} CHECK(S) FEHLGESCHLAGEN.\n`,
  );
  if (failures > 0) process.exit(1);
}

main();
