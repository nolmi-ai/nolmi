import Database from "better-sqlite3";
import Fastify from "fastify";
import { FocusSnapshotsRepo } from "../focus/focus-snapshots-repo.js";
import { registerFactRoutes } from "../server.js";

// ─── TEST: FOCUS SICHTBARKEIT + RESET (Schritt 3 — Leitplanke) ──────────────
//
// Repo-Level gegen migrierte Wegwerf-DB (supersede non-destruktiv, idempotent)
// + Route-Contract (GET lesend / POST reset schreibend, beide owner-gegated).
//
// Voraussetzung: TWIN_DATABASE_PATH zeigt auf eine per db:init migrierte DB.
//   TWIN_DATABASE_PATH=/tmp/x.db pnpm --filter @nolmi/runtime exec tsx \
//     src/scripts/test-focus-reset.ts

const TWIN_ID = "twin_reset_test";
const HANDLE = "@markus";

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
    console.error("TWIN_DATABASE_PATH nicht gesetzt (migrierte Wegwerf-DB erwartet).");
    process.exit(1);
  }
  const db = new Database(dbPath);
  db.pragma("foreign_keys = OFF"); // nur focus_snapshots nötig, kein twin_profiles-Graph
  const repo = new FocusSnapshotsRepo(db);

  // ── Repo: getCurrent / supersede non-destruktiv / idempotent ──
  console.log("\n── Repo: insert → getCurrent → supersede");
  {
    repo.insert({ twinId: TWIN_ID, focusText: "Baut Schritt 3.", themes: ["Fokus"], basisSummary: "aus 1 Summaries + 2 Turns" });
    const current = repo.getCurrent(TWIN_ID);
    assert(current?.focusText === "Baut Schritt 3.", "getCurrent liefert aktiven Snapshot");

    // b) supersede → getCurrent null
    const did = repo.supersede(TWIN_ID);
    assert(did === true, "supersede meldet true (eine Row supersedet)");
    assert(repo.getCurrent(TWIN_ID) === null, "getCurrent nach Reset → null");

    // d) non-destruktiv: Row noch da, superseded_at gesetzt
    const total = (db.prepare(`SELECT COUNT(*) AS c FROM focus_snapshots WHERE twin_id = ?`).get(TWIN_ID) as { c: number }).c;
    const supersededCnt = (db.prepare(`SELECT COUNT(*) AS c FROM focus_snapshots WHERE twin_id = ? AND superseded_at IS NOT NULL`).get(TWIN_ID) as { c: number }).c;
    assert(total === 1, "Row NICHT gelöscht (non-destruktiv — History bleibt)");
    assert(supersededCnt === 1, "superseded_at ist gesetzt (nicht NULL)");

    // c) idempotent: zweiter Reset ohne aktiven Snapshot → no-op
    const again = repo.supersede(TWIN_ID);
    assert(again === false, "zweiter supersede → false (no-op, kein Fehler)");
    assert(repo.getCurrent(TWIN_ID) === null, "weiterhin null");
  }

  // ── Route-Contract (GET /focus, POST /focus/reset) ──
  console.log("\n── Route: GET /focus + POST /focus/reset (owner-gated)");
  {
    // Frischer Twin mit aktivem Snapshot für den Route-Test.
    const routeTwin = "twin_route_test";
    repo.insert({ twinId: routeTwin, focusText: "Routen-Fokus.", themes: [], basisSummary: null });

    const app = Fastify({ logger: false });
    registerFactRoutes(
      app,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      {} as any,
      async (_req, reply, handle) => {
        if (handle.toLowerCase() !== HANDLE.toLowerCase()) {
          reply.status(403).send({ error: "Mock: not owner" });
          return null;
        }
        return {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          entry: { twinId: routeTwin, handle: HANDLE, service: { focusRepo: repo } } as any,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          user: { userId: "u" } as any,
        };
      },
    );
    await app.ready();

    // a) GET als Owner mit Snapshot
    const getRes = await app.inject({ method: "GET", url: `/twins/${encodeURIComponent(HANDLE)}/focus` });
    assert(getRes.statusCode === 200, "GET Owner → 200");
    assert(getRes.json().focus?.focusText === "Routen-Fokus.", "GET liefert focus-Objekt");

    // a) GET Nicht-Owner → 403
    const getOther = await app.inject({ method: "GET", url: `/twins/@fremder/focus` });
    assert(getOther.statusCode === 403, "GET Nicht-Owner → 403");

    // b) POST reset Nicht-Owner → 403, nichts supersedet
    const resetOther = await app.inject({ method: "POST", url: `/twins/@fremder/focus/reset` });
    assert(resetOther.statusCode === 403, "POST reset Nicht-Owner → 403");
    assert(repo.getCurrent(routeTwin) !== null, "Fokus nach Nicht-Owner-Versuch unverändert (nicht supersedet)");

    // b) POST reset Owner → supersedes
    const resetRes = await app.inject({ method: "POST", url: `/twins/${encodeURIComponent(HANDLE)}/focus/reset` });
    assert(resetRes.statusCode === 200 && resetRes.json().ok === true, "POST reset Owner → 200 ok");
    assert(repo.getCurrent(routeTwin) === null, "f) getCurrent nach Reset → null → kein Fokus-Block im Prompt (Schritt-2-Kette)");

    // GET nach Reset → focus:null (Empty-State)
    const getAfter = await app.inject({ method: "GET", url: `/twins/${encodeURIComponent(HANDLE)}/focus` });
    assert(getAfter.json().focus === null, "GET nach Reset → focus:null (UI-Empty-State)");
    await app.close();
  }

  db.close();
  console.log(
    failures === 0
      ? "\n✅ ALLE CHECKS GRÜN — Reset owner-gated + non-destruktiv + idempotent, wirkt auf den Prompt.\n"
      : `\n❌ ${failures} CHECK(S) FEHLGESCHLAGEN.\n`,
  );
  if (failures > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
