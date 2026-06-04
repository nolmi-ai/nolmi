import Database from "better-sqlite3";
import Fastify from "fastify";
import { FactsRepo } from "../facts/repo.js";
import { FactsHistoryRepo } from "../facts/facts-history-repo.js";
import { registerFactRoutes } from "../server.js";

// ─── TEST: ROUTE GET /twins/:handle/facts/:factKey/history (#97 Schritt 3/4) ─
//
// Route-Contract via Fastify-Inject mit gemocktem requireOwner + echtem
// FactsRepo gegen eine migrierte Wegwerf-DB. Voraussetzung:
// TWIN_DATABASE_PATH = per db:init migrierte DB.
//
//   TWIN_DATABASE_PATH=/tmp/x.db pnpm --filter @nolmi/runtime exec tsx \
//     src/scripts/test-facts-history-route.ts

const HANDLE = "@markus";
const TWIN = "twin_histroute_test";

let failures = 0;
function assert(cond: boolean, label: string): void {
  if (cond) console.log(`  ✓ ${label}`);
  else {
    console.error(`  ✗ FAIL: ${label}`);
    failures += 1;
  }
}

async function main(): Promise<void> {
  const dbPath = process.env.TWIN_DATABASE_PATH;
  if (!dbPath) {
    console.error("TWIN_DATABASE_PATH nicht gesetzt.");
    process.exit(1);
  }
  const db = new Database(dbPath);
  db.pragma("foreign_keys = OFF");
  const factsRepo = new FactsRepo(db, new FactsHistoryRepo(db));

  // Seed: Drift (Anna→Sabine→delete) für wife_name; city nur angelegt (keine History).
  factsRepo.upsert({ twinId: TWIN, factKey: "wife_name", factValue: "Anna", source: "user", confidence: "approved" });
  factsRepo.upsert({ twinId: TWIN, factKey: "wife_name", factValue: "Sabine", source: "user", confidence: "approved" });
  factsRepo.delete(TWIN, "wife_name");
  factsRepo.upsert({ twinId: TWIN, factKey: "city", factValue: "Roding", source: "user", confidence: "approved" });

  const app = Fastify({ logger: false });
  registerFactRoutes(
    app,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    { factsRepo } as any,
    async (_req, reply, handle) => {
      if (handle.toLowerCase() !== HANDLE.toLowerCase()) {
        reply.status(403).send({ error: "Mock: not owner" });
        return null;
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return { entry: { twinId: TWIN, handle: HANDLE } as any, user: { userId: "u" } as any };
    },
  );
  await app.ready();

  const url = (key: string) => `/twins/${encodeURIComponent(HANDLE)}/facts/${encodeURIComponent(key)}/history`;

  // ── a) Key MIT History ──
  console.log("\n── a) wife_name (Drift + Delete)");
  const a = await app.inject({ method: "GET", url: url("wife_name") });
  const aBody = a.json();
  assert(a.statusCode === 200, "HTTP 200");
  assert(Array.isArray(aBody.history) && aBody.history.length === 2, "2 History-Rows");
  assert(aBody.history[0].oldValue === "Anna" && aBody.history[0].changeType === "value_change", "Row1: Anna/value_change");
  assert(aBody.history[1].oldValue === "Sabine" && aBody.history[1].changeType === "delete", "Row2: Sabine/delete");
  assert(typeof aBody.history[0].recordedAt === "string", "recordedAt vorhanden");

  // ── e) KEIN twin_id in der Response ──
  console.log("\n── e) kein twin_id in Response");
  assert(!("twinId" in aBody.history[0]) && !("twin_id" in aBody.history[0]), "Row enthält weder twinId noch twin_id");

  // ── b) Key OHNE History ──
  console.log("\n── b) city (nur angelegt, nie geändert)");
  const b = await app.inject({ method: "GET", url: url("city") });
  assert(b.statusCode === 200, "HTTP 200");
  assert(Array.isArray(b.json().history) && b.json().history.length === 0, "leeres Array");

  // ── c) Nicht-existenter Key ──
  console.log("\n── c) unbekannter Key");
  const c = await app.inject({ method: "GET", url: url("gibt_es_nicht") });
  assert(c.statusCode === 200, "HTTP 200 (kein 404)");
  assert(c.json().history.length === 0, "leeres Array");

  // ── d) Owner-Gating ──
  console.log("\n── d) Nicht-Owner");
  const d = await app.inject({ method: "GET", url: `/twins/@fremder/facts/wife_name/history` });
  assert(d.statusCode === 403, "Nicht-Owner → 403");

  // Cleanup
  db.prepare("DELETE FROM facts WHERE twin_id = ?").run(TWIN);
  db.prepare("DELETE FROM facts_history WHERE twin_id = ?").run(TWIN);
  await app.close();
  db.close();

  console.log(
    failures === 0
      ? "\n✅ ALLE CHECKS GRÜN — History-Route owner-gated, Timeline chronologisch, Leer-Fall=200, kein twin_id.\n"
      : `\n❌ ${failures} CHECK(S) FEHLGESCHLAGEN.\n`,
  );
  if (failures > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
