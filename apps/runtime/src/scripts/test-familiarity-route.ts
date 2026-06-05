import Database from "better-sqlite3";
import Fastify from "fastify";
import { TrustRepo } from "../trust/trust-repo.js";
import { registerTrustRoutes } from "../server.js";

// ─── TEST: familiarity GET-Durchreichung + POST-Setzen (Phase 4.3 Schritt 3) ─
//
// Route-Contract via Fastify-Inject, echtes TrustRepo gegen migrierte Wegwerf-DB,
// gemockter requireOwner. TWIN_DATABASE_PATH = per db:init migrierte DB.
//   TWIN_DATABASE_PATH=/tmp/x.db pnpm --filter @nolmi/runtime exec tsx \
//     src/scripts/test-familiarity-route.ts

const HANDLE = "@markus";
const TWIN = "twin_fam_route";

let failures = 0;
function assert(cond: boolean, label: string): void {
  if (cond) console.log(`  ✓ ${label}`);
  else { console.error(`  ✗ FAIL: ${label}`); failures += 1; }
}

async function main(): Promise<void> {
  const dbPath = process.env.TWIN_DATABASE_PATH;
  if (!dbPath) { console.error("TWIN_DATABASE_PATH nicht gesetzt."); process.exit(1); }
  const db = new Database(dbPath);
  db.pragma("foreign_keys = OFF");
  const trustRepo = new TrustRepo(db);
  const trust = trustRepo.add(TWIN, "@florian", "u1"); // DEFAULT → vertraut

  const app = Fastify({ logger: false });
  registerTrustRoutes(
    app,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    { trustRepo, audit: { append: async () => {} } } as any,
    async (_req, reply, handle) => {
      if (handle.toLowerCase() !== HANDLE.toLowerCase()) {
        reply.status(403).send({ error: "Mock: not owner" });
        return null;
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return { entry: { twinId: TWIN, handle: HANDLE } as any, user: { userId: "u1" } as any };
    },
  );
  await app.ready();
  const base = `/twins/${encodeURIComponent(HANDLE)}/trust`;

  // ── A) GET trägt familiarityLevel ──
  console.log("\n── A) GET /trust trägt familiarityLevel");
  const getRes = await app.inject({ method: "GET", url: base });
  const getBody = getRes.json();
  assert(getRes.statusCode === 200, "GET 200");
  assert(getBody.trusts?.[0]?.familiarityLevel === "vertraut", "familiarityLevel='vertraut' (DEFAULT) durchgereicht");

  // ── B) POST setzt Level ──
  console.log("\n── B) POST .../familiarity setzt Level");
  const setRes = await app.inject({ method: "POST", url: `${base}/${trust.trustId}/familiarity`, payload: { level: "eng" } });
  assert(setRes.statusCode === 200, "POST 200");
  assert(setRes.json().familiarityLevel === "eng", "Response: familiarityLevel='eng'");
  assert(trustRepo.getFamiliarity(TWIN, "@florian") === "eng", "DB/getFamiliarity → 'eng' (persistiert)");

  // ── C) Validierung ──
  console.log("\n── C) Validierung");
  const bogus = await app.inject({ method: "POST", url: `${base}/${trust.trustId}/familiarity`, payload: { level: "bestie" } });
  assert(bogus.statusCode === 400, "bogus level → 400");
  const unknownId = await app.inject({ method: "POST", url: `${base}/trust_gibtsnicht/familiarity`, payload: { level: "eng" } });
  assert(unknownId.statusCode === 404, "unbekannte trustId → 404");

  // ── D) Owner-Gate ──
  console.log("\n── D) Owner-Gate");
  const nonOwner = await app.inject({ method: "POST", url: `/twins/@fremder/trust/${trust.trustId}/familiarity`, payload: { level: "fremd" } });
  assert(nonOwner.statusCode === 403, "Nicht-Owner → 403");
  assert(trustRepo.getFamiliarity(TWIN, "@florian") === "eng", "Level unverändert nach Nicht-Owner-Versuch");

  db.prepare("DELETE FROM trust_relationships WHERE twin_id = ?").run(TWIN);
  await app.close();
  db.close();
  console.log(failures === 0
    ? "\n✅ ALLE CHECKS GRÜN — GET trägt Level, POST setzt owner-gegated, Validierung greift.\n"
    : `\n❌ ${failures} CHECK(S) FEHLGESCHLAGEN.\n`);
  if (failures > 0) process.exit(1);
}
main().catch((e) => { console.error(e); process.exit(1); });
