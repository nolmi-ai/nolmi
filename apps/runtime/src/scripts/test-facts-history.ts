import Database from "better-sqlite3";
import { FactsHistoryRepo } from "../facts/facts-history-repo.js";

// ─── TEST: FACTS-HISTORY REPO-GERÜST (#97 Schritt 1/4) ──────────────────────
//
// Beweist die Repo-Mechanik (record/getTimeline/getAsOf) gegen die migrierte
// facts_history-Tabelle — OHNE facts anzufassen. Voraussetzung:
// TWIN_DATABASE_PATH = per db:init migrierte Wegwerf-DB.
//
//   TWIN_DATABASE_PATH=/tmp/x.db pnpm --filter @nolmi/runtime exec tsx \
//     src/scripts/test-facts-history.ts

let failures = 0;
function assert(cond: boolean, label: string): void {
  if (cond) console.log(`  ✓ ${label}`);
  else {
    console.error(`  ✗ FAIL: ${label}`);
    failures += 1;
  }
}

function main(): void {
  const dbPath = process.env.TWIN_DATABASE_PATH;
  if (!dbPath) {
    console.error("TWIN_DATABASE_PATH nicht gesetzt.");
    process.exit(1);
  }
  const db = new Database(dbPath);
  db.pragma("foreign_keys = OFF"); // nur facts_history nötig, kein twin_profiles-Graph
  const repo = new FactsHistoryRepo(db);
  const T = "twin_facthist_test";
  const K = "wife_name";

  console.log("\n── record + getTimeline (chronologisch)");
  // Zwei Ablösungen: erst „Anna" abgelöst (2026-05-01), dann „Sabine" (2026-06-01).
  repo.record({ twinId: T, factKey: K, oldValue: "Anna", oldSource: "user", oldConfidence: "approved", changeType: "value_change", recordedAt: "2026-05-01T00:00:00.000Z" });
  repo.record({ twinId: T, factKey: K, oldValue: "Sabine", oldSource: "user", oldConfidence: "approved", changeType: "value_change", recordedAt: "2026-06-01T00:00:00.000Z" });

  const tl = repo.getTimeline(T, K);
  assert(tl.length === 2, "getTimeline liefert 2 Rows");
  assert(tl[0].oldValue === "Anna" && tl[1].oldValue === "Sabine", "chronologisch ASC (Anna vor Sabine)");
  assert(tl[0].changeType === "value_change", "changeType durchgereicht");

  console.log("\n── getAsOf (welcher Wert galt wann?)");
  // Vor der ersten Ablösung: erste Ablösung >= Datum ist die vom 2026-05-01 → old_value 'Anna'.
  assert(repo.getAsOf(T, K, "2026-04-15T00:00:00.000Z") === "Anna", "Mitte April -> galt 'Anna' (vor erster Ablösung)");
  // Zwischen den Ablösungen: nächste Ablösung >= Datum ist die vom 2026-06-01 → old_value 'Sabine'.
  assert(repo.getAsOf(T, K, "2026-05-15T00:00:00.000Z") === "Sabine", "Mitte Mai -> galt 'Sabine' (zwischen Ablösungen)");
  // Nach allen Ablösungen: keine Ablösung >= Datum → null = 'nimm aktuellen Wert aus facts'.
  assert(repo.getAsOf(T, K, "2026-07-01T00:00:00.000Z") === null, "Juli -> null (aktueller Wert galt schon)");

  console.log("\n── delete-changeType + Leer-Fall");
  repo.record({ twinId: T, factKey: "city", oldValue: "Berlin", oldSource: "user", oldConfidence: "approved", changeType: "delete", recordedAt: "2026-06-02T00:00:00.000Z" });
  assert(repo.getTimeline(T, "city")[0].changeType === "delete", "delete-Row gespeichert");
  assert(repo.getTimeline(T, "unbekannt").length === 0, "unbekannter Key → leere Timeline (kein Fehler)");

  // Cleanup (Wegwerf-DB, aber sauber halten falls jemand dieselbe DB nochmal nutzt).
  db.prepare("DELETE FROM facts_history WHERE twin_id = ?").run(T);
  db.close();

  console.log(
    failures === 0
      ? "\n✅ ALLE CHECKS GRÜN — record/getTimeline/getAsOf funktionieren, facts unangetastet.\n"
      : `\n❌ ${failures} CHECK(S) FEHLGESCHLAGEN.\n`,
  );
  if (failures > 0) process.exit(1);
}

main();
