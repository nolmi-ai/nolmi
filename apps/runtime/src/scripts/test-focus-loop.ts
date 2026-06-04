import Database from "better-sqlite3";
import { FocusLoopService } from "../focus/focus-loop-service.js";
import { FocusEngine, type FocusOutput } from "../focus/focus-engine.js";
import { FocusSnapshotsRepo } from "../focus/focus-snapshots-repo.js";
import { ConversationSummariesRepo } from "../conversations/summaries-repo.js";
import { SqliteAuditRepository } from "../repository/sqlite.js";
import { AuditService } from "../audit/service.js";
import { EventBus } from "../events/bus.js";

// ─── TEST: FOCUS LOOP (Schritt 4/4 — opt-in, default aus) ───────────────────
//
// Loop NICHT scharf geschaltet — runTick/focusForTwin direkt gerufen (Stub-
// Registry + Spy + reale Guard-Queries), wie der ReflectionLoop getestet wurde.
//
// Voraussetzung: TWIN_DATABASE_PATH = migrierte Wegwerf-DB.
//   TWIN_DATABASE_PATH=/tmp/x.db pnpm --filter @nolmi/runtime exec tsx \
//     src/scripts/test-focus-loop.ts

let failures = 0;
function assert(cond: boolean, label: string): void {
  if (cond) console.log(`  ✓ ${label}`);
  else {
    console.error(`  ✗ FAIL: ${label}`);
    failures += 1;
  }
}

// Capturing-Logger (nur die im Loop genutzten Level).
function makeLogger() {
  const msgs: string[] = [];
  const rec = (_o: unknown, m?: string) => {
    msgs.push(typeof _o === "string" ? _o : (m ?? ""));
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const logger = { info: rec, warn: rec, error: rec } as any;
  return { logger, msgs };
}

function stubRegistry(twins: { twinId: string; handle: string }[]) {
  return {
    list: () => twins.map((t) => ({ ...t, displayName: t.handle })),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    getByHandle: () => null,
  } as any;
}

async function main(): Promise<void> {
  const dbPath = process.env.TWIN_DATABASE_PATH;
  if (!dbPath) {
    console.error("TWIN_DATABASE_PATH nicht gesetzt.");
    process.exit(1);
  }
  const db = new Database(dbPath);
  db.pragma("foreign_keys = OFF");
  const focusRepo = new FocusSnapshotsRepo(db);

  // ── a) ENV-Gate + e) idempotent ──
  console.log("\n── a/e) ENV-Gate + start/stop idempotent");
  {
    delete process.env.FOCUS_LOOP_ENABLED;
    const off = makeLogger();
    const loopOff = new FocusLoopService({ db, registry: stubRegistry([]) });
    loopOff.start(off.logger);
    assert(off.msgs.some((m) => m.includes("disabled")), "unset → disabled-Log, kein Interval");
    loopOff.stop(); // no-op

    process.env.FOCUS_LOOP_ENABLED = "true";
    const on = makeLogger();
    const loopOn = new FocusLoopService({ db, registry: stubRegistry([]), intervalHours: 24 });
    loopOn.start(on.logger);
    assert(on.msgs.some((m) => m.includes("started")), "true → started-Log");
    loopOn.start(on.logger); // zweiter start
    assert(on.msgs.some((m) => m.includes("ignored")), "Doppel-start → ignored (idempotent)");
    loopOn.stop();
    assert(on.msgs.some((m) => m.includes("stopped")), "stop → stopped-Log");
    loopOn.stop(); // idempotent, kein Fehler
    delete process.env.FOCUS_LOOP_ENABLED;
  }

  // ── b) KERN: Substanz-Guard (Token-Bremse) ──
  console.log("\n── b) KERN: Substanz-Guard");
  {
    const twinA = "twin_guard_A";
    // Aktiver Snapshot mit derived_at in der Vergangenheit.
    db.prepare(
      `INSERT INTO focus_snapshots (id, twin_id, focus_text, themes_json, basis_summary, derived_at, superseded_at)
       VALUES ('f_a', ?, 'alt', NULL, NULL, '2026-06-01T00:00:00.000Z', NULL)`,
    ).run(twinA);

    let triggerCalls = 0;
    const loop = new FocusLoopService({
      db,
      registry: stubRegistry([{ twinId: twinA, handle: "@a" }]),
      triggerFocus: async () => {
        triggerCalls += 1;
        return { created: true, snapshot: { id: "new", focusText: "x", themes: [], twinId: twinA, basisSummary: null, derivedAt: "2026-06-10T00:00:00.000Z", supersededAt: null } };
      },
    });

    // Keine neue Substanz seit 2026-06-01 → Guard greift, KEIN Trigger.
    const out1 = await loop.focusForTwin({ twinId: twinA, handle: "@a", displayName: "@a" });
    assert(triggerCalls === 0, "ohne neue Substanz → deriveFocus NICHT gerufen (0 Token)");
    assert(out1.skipped && out1.reason === "no-new-substance", "Outcome: skipped/no-new-substance");

    // Neue Substanz: Audit-Turn nach dem Snapshot.
    const auditService = new AuditService(new SqliteAuditRepository(db), new EventBus(), twinA);
    const e = await auditService.start({ capability: "owner-direct", mandateId: null, initialStatus: "approved", input: { lastMessage: "neu" } });
    await auditService.complete(e.id, { reply: "ok" });
    const out2 = await loop.focusForTwin({ twinId: twinA, handle: "@a", displayName: "@a" });
    assert(triggerCalls === 1, "mit neuer Substanz → deriveFocus gerufen");
    assert(out2.created === true, "Outcome: created");
  }

  // ── c) KERN: direkt-schreiben + genau-ein-aktiver + kein Pending ──
  console.log("\n── c) KERN: deriveFocus supersediert alt, genau 1 aktiv, kein Pending");
  {
    const twinC = "twin_lifecycle_C";
    const auditService = new AuditService(new SqliteAuditRepository(db), new EventBus(), twinC);
    const summariesRepo = new ConversationSummariesRepo(db);
    let n = 0;
    const engine = new FocusEngine({
      auditService,
      summariesRepo,
      focusRepo,
      twinId: twinC,
      twinName: "Markus",
      ownerName: "Markus",
      derive: async (): Promise<FocusOutput> => {
        n += 1;
        return { hasEnoughSubstance: true, focusText: `Fokus v${n}`, themes: [] };
      },
    });

    const auditBefore = (db.prepare(`SELECT COUNT(*) AS c FROM audit WHERE twin_id = ?`).get(twinC) as { c: number }).c;
    await engine.deriveFocus(); // erster
    await engine.deriveFocus(); // zweiter → supersediert den ersten

    const active = (db.prepare(`SELECT COUNT(*) AS c FROM focus_snapshots WHERE twin_id = ? AND superseded_at IS NULL`).get(twinC) as { c: number }).c;
    const superseded = (db.prepare(`SELECT COUNT(*) AS c FROM focus_snapshots WHERE twin_id = ? AND superseded_at IS NOT NULL`).get(twinC) as { c: number }).c;
    const total = (db.prepare(`SELECT COUNT(*) AS c FROM focus_snapshots WHERE twin_id = ?`).get(twinC) as { c: number }).c;
    assert(active === 1, "genau 1 aktiver Snapshot (Invariante)");
    assert(superseded === 1 && total === 2, "alter supersedet, History bleibt (2 total)");
    assert(focusRepo.getCurrent(twinC)?.focusText === "Fokus v2", "getCurrent = jüngster");
    const auditAfter = (db.prepare(`SELECT COUNT(*) AS c FROM audit WHERE twin_id = ?`).get(twinC) as { c: number }).c;
    assert(auditAfter === auditBefore, "KEIN Pending/Audit erzeugt (direkt-schreiben, gate-frei)");
  }

  // ── d) runTick robust: ein Twin wirft → andere laufen weiter ──
  console.log("\n── d) runTick robust (per-Twin try/catch)");
  {
    const seen: string[] = [];
    const loop = new FocusLoopService({
      db,
      registry: stubRegistry([
        { twinId: "twin_err", handle: "@err" },
        { twinId: "twin_ok", handle: "@ok" },
      ]),
      triggerFocus: async (handle) => {
        seen.push(handle);
        if (handle === "@err") throw new Error("Twin-Fehler (gemockt)");
        return { created: true, snapshot: { id: "s", focusText: "x", themes: [], twinId: "twin_ok", basisSummary: null, derivedAt: "2026-06-10T00:00:00.000Z", supersededAt: null } };
      },
    });
    // beide Twins ohne Snapshot → lastFocusDerivedAt null → Guard passiert → Trigger
    await loop.runTick(); // darf NICHT werfen
    assert(seen.includes("@err") && seen.includes("@ok"), "beide Twins berührt — @err-Fehler killt @ok nicht");
  }

  db.close();
  console.log(
    failures === 0
      ? "\n✅ ALLE CHECKS GRÜN — opt-in default-aus, Substanz-Guard bremst, direkt-schreiben + genau-1-aktiv, kein Pending, robust.\n"
      : `\n❌ ${failures} CHECK(S) FEHLGESCHLAGEN.\n`,
  );
  if (failures > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
