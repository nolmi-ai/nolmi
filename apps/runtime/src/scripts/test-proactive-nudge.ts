import Database from "better-sqlite3";
import type { AuditEntry } from "@nolmi/shared";
import type { AuditRepository } from "../repository/types.js";
import type { EventBus } from "../events/bus.js";
import { AuditService } from "../audit/service.js";
import { FocusSnapshotsRepo } from "../focus/focus-snapshots-repo.js";
import {
  ProactiveNudgeService,
  PROACTIVE_NUDGE_CAPABILITY,
  type NudgeOutput,
} from "../focus/proactive-nudge-service.js";

// ─── TEST: Proaktiver Fokus-Nudge Stufe 1 ───────────────────────────────────
//
// Self-contained gegen :memory: (027-Schema). KEIN echter LLM — generate ist
// gemockt. Beweist: Detektion (≥3 stabile Themen), Negativfälle, Guards, Pending.
//   pnpm --filter @nolmi/runtime exec tsx src/scripts/test-proactive-nudge.ts

let failures = 0;
function assert(cond: boolean, label: string): void {
  if (cond) console.log(`  ✓ ${label}`);
  else { console.error(`  ✗ FAIL: ${label}`); failures += 1; }
}

const SCHEMA = `
  CREATE TABLE focus_snapshots (
    id TEXT PRIMARY KEY NOT NULL, twin_id TEXT NOT NULL,
    focus_text TEXT NOT NULL, themes_json TEXT, basis_summary TEXT,
    derived_at TEXT NOT NULL, superseded_at TEXT
  );`;

const T = "twin_x";

/** Seedet einen Snapshot mit explizitem derived_at (zeitliche Reihenfolge). */
function seed(
  db: Database.Database,
  id: string,
  themes: string[],
  derivedAt: string,
  supersededAt: string | null,
): void {
  db.prepare(
    `INSERT INTO focus_snapshots
       (id, twin_id, focus_text, themes_json, basis_summary, derived_at, superseded_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id, T, `Fokus zu ${themes.join("/")}`,
    themes.length ? JSON.stringify(themes) : null,
    "test", derivedAt, supersededAt,
  );
}

/** Minimaler In-Memory-AuditRepo — nur was nudge() braucht (list/append/get). */
function makeAudit(): AuditService {
  const rows: AuditEntry[] = [];
  const repo = {
    async append(e: AuditEntry) { rows.push(e); },
    async get(id: string) { return rows.find((r) => r.id === id) ?? null; },
    async list({ limit }: { twinId?: string; limit?: number }) {
      // DESC nach timestamp (wie das echte Repo).
      return [...rows]
        .sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1))
        .slice(0, limit ?? 200);
    },
  } as unknown as AuditRepository;
  const bus = { emit() {} } as unknown as EventBus;
  return new AuditService(repo, bus, T);
}

function makeService(
  db: Database.Database,
  audit: AuditService,
  generate: (p: { system: string; prompt: string }) => Promise<NudgeOutput>,
): ProactiveNudgeService {
  return new ProactiveNudgeService({
    db, auditService: audit,
    focusRepo: new FocusSnapshotsRepo(db),
    twinId: T, twinName: "Twin", ownerName: "Markus",
    generate,
  });
}

const okGen = async (): Promise<NudgeOutput> => ({
  shouldNudge: true,
  message: "Du bist seit Tagen am Beziehungs-Modell dran — brauchst du einen Sparring-Partner?",
  reasoning: "stabiles Thema über 3 Snapshots",
});

async function main(): Promise<void> {
  // ── 1) Detektion: 3× stabiles Thema → isStuck=true, thema, tageStabil=3 ──
  console.log("\n── 1) Festhängen erkannt (3 stabile Snapshots)");
  {
    const db = new Database(":memory:"); db.exec(SCHEMA);
    seed(db, "f1", ["Beziehungs-Modell"], "2026-06-01T10:00:00Z", "2026-06-02T10:00:00Z");
    seed(db, "f2", ["Beziehungs-Modell"], "2026-06-02T10:00:00Z", "2026-06-03T10:00:00Z");
    seed(db, "f3", ["Beziehungs-Modell"], "2026-06-03T10:00:00Z", null);
    const svc = makeService(db, makeAudit(), okGen);
    const d = svc.detectStuck(T);
    assert(d.isStuck === true, "isStuck=true bei 3× gleichem Thema");
    assert(d.thema === "Beziehungs-Modell", `thema korrekt (got ${d.thema})`);
    assert(d.tageStabil === 3, `tageStabil=3 (got ${d.tageStabil})`);
  }

  // ── 2) Themen-ÜBERLAPPUNG (nicht exakt): stabiles Top-Thema + wechselnde Begleiter ──
  console.log("\n── 2) Überlappung statt String-Gleichheit");
  {
    const db = new Database(":memory:"); db.exec(SCHEMA);
    seed(db, "f1", ["Beziehungs-Modell", "Autonomie"], "2026-06-01T10:00:00Z", "2026-06-02T10:00:00Z");
    seed(db, "f2", ["Beziehungs-Modell", "Trust"], "2026-06-02T10:00:00Z", "2026-06-03T10:00:00Z");
    seed(db, "f3", ["Beziehungs-Modell", "Vertrautheit"], "2026-06-03T10:00:00Z", null);
    const d = makeService(db, makeAudit(), okGen).detectStuck(T);
    assert(d.isStuck === true && d.thema === "Beziehungs-Modell",
      `stabiles Top-Thema trotz wechselnder Begleit-Themen (got ${d.thema})`);
  }

  // ── 3) Negativfall: wechselnde Themen → isStuck=false ──
  console.log("\n── 3) Wechselnde Themen → nicht festgehangen");
  {
    const db = new Database(":memory:"); db.exec(SCHEMA);
    seed(db, "f1", ["OAuth"], "2026-06-01T10:00:00Z", "2026-06-02T10:00:00Z");
    seed(db, "f2", ["Telegram"], "2026-06-02T10:00:00Z", "2026-06-03T10:00:00Z");
    seed(db, "f3", ["Fokus-Loop"], "2026-06-03T10:00:00Z", null);
    assert(makeService(db, makeAudit(), okGen).detectStuck(T).isStuck === false,
      "isStuck=false bei 3 verschiedenen Themen");
  }

  // ── 4) Guard: <3 Snapshots → isStuck=false (heutiger Normalfall) ──
  console.log("\n── 4) <3 Snapshots → still");
  {
    const db = new Database(":memory:"); db.exec(SCHEMA);
    seed(db, "f1", ["Beziehungs-Modell"], "2026-06-02T10:00:00Z", "2026-06-03T10:00:00Z");
    seed(db, "f2", ["Beziehungs-Modell"], "2026-06-03T10:00:00Z", null);
    assert(makeService(db, makeAudit(), okGen).detectStuck(T).isStuck === false,
      "2 Snapshots → isStuck=false");
    const empty = new Database(":memory:"); empty.exec(SCHEMA);
    assert(makeService(empty, makeAudit(), okGen).detectStuck(T).isStuck === false,
      "0 Snapshots (leerer Normalfall) → isStuck=false, kein Fehler");
  }

  // ── 5) nudge(): stuck + shouldNudge → Pending erzeugt ──
  console.log("\n── 5) nudge() erzeugt Pending");
  const dbStuck = new Database(":memory:"); dbStuck.exec(SCHEMA);
  seed(dbStuck, "f1", ["Beziehungs-Modell"], "2026-06-01T10:00:00Z", "2026-06-02T10:00:00Z");
  seed(dbStuck, "f2", ["Beziehungs-Modell"], "2026-06-02T10:00:00Z", "2026-06-03T10:00:00Z");
  seed(dbStuck, "f3", ["Beziehungs-Modell"], "2026-06-03T10:00:00Z", null);
  const audit = makeAudit();
  const svc = makeService(dbStuck, audit, okGen);
  const r1 = await svc.nudge();
  assert(r1.created === true, "Pending erzeugt (created=true)");
  assert(typeof r1.message === "string" && r1.message.length > 0, "message vorhanden");
  const pendings = (await audit.repo.list({ twinId: T, limit: 200 }))
    .filter((a) => a.capability === PROACTIVE_NUDGE_CAPABILITY && a.status === "pending");
  assert(pendings.length === 1, `genau 1 proactive-nudge-Pending (got ${pendings.length})`);
  assert((pendings[0]?.input as { anlass?: string }).anlass === "fokus", "anlass='fokus' im Payload");

  // ── 6) Dedup-Guard: zweiter nudge() bei offenem Pending → kein zweites ──
  console.log("\n── 6) Dedup-Guard");
  const r2 = await svc.nudge();
  assert(r2.created === false && r2.reason === "open-pending", "zweiter Nudge → open-pending, kein Pending");

  // ── 7) Zweite Bremse: shouldNudge=false → kein Pending ──
  console.log("\n── 7) Twin lehnt ab (shouldNudge=false)");
  {
    const db = new Database(":memory:"); db.exec(SCHEMA);
    seed(db, "f1", ["Refactoring"], "2026-06-01T10:00:00Z", "2026-06-02T10:00:00Z");
    seed(db, "f2", ["Refactoring"], "2026-06-02T10:00:00Z", "2026-06-03T10:00:00Z");
    seed(db, "f3", ["Refactoring"], "2026-06-03T10:00:00Z", null);
    const declineGen = async (): Promise<NudgeOutput> =>
      ({ shouldNudge: false, message: "", reasoning: "harmlos, produktiv" });
    const r = await makeService(db, makeAudit(), declineGen).nudge();
    assert(r.created === false && r.reason === "twin-declined", "shouldNudge=false → twin-declined, kein Pending");
  }

  console.log(failures === 0
    ? "\n✅ ALLE CHECKS GRÜN — Detektion (≥3 stabil), Überlappung, Negativfälle, Guards, Pending.\n"
    : `\n❌ ${failures} FEHLER\n`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => { console.error(err); process.exit(1); });
