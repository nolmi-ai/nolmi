import Database from "better-sqlite3";
import Fastify from "fastify";
import { SqliteAuditRepository } from "../repository/sqlite.js";
import { AuditService } from "../audit/service.js";
import { EventBus } from "../events/bus.js";
import { ConversationSummariesRepo } from "../conversations/summaries-repo.js";
import { FocusSnapshotsRepo } from "../focus/focus-snapshots-repo.js";
import { FocusEngine, type FocusOutput } from "../focus/focus-engine.js";
import { registerFactRoutes } from "../server.js";

// ─── TEST: FOCUS ENGINE + REPO + ROUTE (Aufmerksamkeit/Fokus Schritt 1) ──────
//
// Service-Level gegen eine MIGRIERTE Wegwerf-DB (alle Tabellen real, inkl.
// focus_snapshots aus 027) + Route-Contract via Fastify-Inject. LLM ist ein
// deterministischer Mock (kein Provider-Aufruf) — wir prüfen Verdrahtung,
// Direkt-Schreiben (kein Pending) und den Leer-Fall, NICHT LLM-Textqualität.
//
// Voraussetzung: TWIN_DATABASE_PATH zeigt auf eine bereits per db:init
// migrierte DB (der Orchestrierungs-Aufruf erledigt das davor).
//
// Aufruf (siehe Bau-Verifikation):
//   TWIN_DATABASE_PATH=/tmp/x.db pnpm --filter @nolmi/runtime exec tsx \
//     src/scripts/test-focus-engine.ts

const TWIN_ID = "twin_focus_test";
const TWIN_NAME = "Markus";
const HANDLE = "@markus";

let failures = 0;
function assert(cond: boolean, label: string): void {
  if (cond) console.log(`  ✓ ${label}`);
  else {
    console.error(`  ✗ FAIL: ${label}`);
    failures += 1;
  }
}

function seedData(db: Database.Database): void {
  // foreign_keys OFF: wir seeden nur, was die Queries LESEN — kein voller
  // user/twin_profiles-Graph nötig (FK-Korrektheit ist via db:init bewiesen).
  db.pragma("foreign_keys = OFF");
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO conversations
       (id, owner_user_id, partner_handle, twin_id, status, started_at)
     VALUES (?, ?, ?, ?, 'active', ?)`,
  ).run("conv_focus_1", "user_x", "@markus", TWIN_ID, now);
}

async function seedTurns(auditService: AuditService): Promise<void> {
  // Zwei ausgeführte owner-direct-Turns → renderAuditTurn liefert verwertbare
  // Zeilen, damit der basis_summary-Count (Turns) > 0 ist.
  for (const [u, r] of [
    ["Ich baue gerade das Fokus-Pattern für meinen Twin.", "Verstanden — Schema + Generator zuerst."],
    ["Migration 027 läuft.", "Gut, dann der Generator."],
  ]) {
    const entry = await auditService.start({
      capability: "owner-direct",
      mandateId: null,
      initialStatus: "approved",
      input: { lastMessage: u },
    });
    await auditService.complete(entry.id, { reply: r });
  }
}

async function main(): Promise<void> {
  const dbPath = process.env.TWIN_DATABASE_PATH;
  if (!dbPath) {
    console.error("TWIN_DATABASE_PATH nicht gesetzt (migrierte Wegwerf-DB erwartet).");
    process.exit(1);
  }
  const db = new Database(dbPath);
  const bus = new EventBus();
  const auditService = new AuditService(new SqliteAuditRepository(db), bus, TWIN_ID);
  const summariesRepo = new ConversationSummariesRepo(db);
  const focusRepo = new FocusSnapshotsRepo(db);

  seedData(db);
  await seedTurns(auditService);
  summariesRepo.insert({
    conversationId: "conv_focus_1",
    segmentStartAuditId: "x",
    segmentEndAuditId: "y",
    segmentMessageCount: 4,
    summaryMd: "Markus arbeitet am Fokus-Pattern: Migration, Generator, Route.",
  });

  function buildEngine(out: FocusOutput): FocusEngine {
    return new FocusEngine({
      auditService,
      summariesRepo,
      focusRepo,
      twinId: TWIN_ID,
      twinName: TWIN_NAME,
      ownerName: TWIN_NAME,
      derive: async () => out, // deterministischer Mock — kein Provider-Call
    });
  }

  const auditCountBefore = (
    db.prepare(`SELECT COUNT(*) AS c FROM audit WHERE twin_id = ?`).get(TWIN_ID) as { c: number }
  ).c;

  // ── b) Happy-Path: plausibler Fokus → genau 1 Snapshot, getCurrent liefert ihn ──
  console.log("\n── b) deriveFocus mit Substanz → 1 Snapshot");
  {
    const engine = buildEngine({
      hasEnoughSubstance: true,
      focusText: "Baut das Aufmerksamkeit/Fokus-Pattern (Schema, Generator, Route).",
      themes: ["Fokus-Pattern", "Migration"],
    });
    const result = await engine.deriveFocus();
    assert(result.created === true, "created=true");
    assert(!!result.snapshot && result.snapshot.focusText.includes("Fokus"), "Snapshot mit focusText zurück");
    assert((result.snapshot?.themes.length ?? 0) === 2, "Themen übernommen (2)");
    assert(
      (result.snapshot?.basisSummary ?? "").includes("Summaries") &&
        (result.snapshot?.basisSummary ?? "").includes("Turns"),
      "basis_summary dokumentiert Input-Counts",
    );
    const rows = db
      .prepare(`SELECT COUNT(*) AS c FROM focus_snapshots WHERE twin_id = ? AND superseded_at IS NULL`)
      .get(TWIN_ID) as { c: number };
    assert(rows.c === 1, "genau 1 aktuelle Row in focus_snapshots");
    const current = focusRepo.getCurrent(TWIN_ID);
    assert(current?.id === result.snapshot?.id, "getCurrent liefert genau diesen Snapshot");
  }

  // ── c) KERN: Leer-/Substanz-Fall → kein Snapshot, keine Erfindung ──
  console.log("\n── c) KERN: zu wenig Substanz → kein Snapshot");
  {
    const before = (
      db.prepare(`SELECT COUNT(*) AS c FROM focus_snapshots WHERE twin_id = ?`).get(TWIN_ID) as { c: number }
    ).c;
    const engine = buildEngine({ hasEnoughSubstance: false, focusText: "", themes: [] });
    const result = await engine.deriveFocus();
    assert(result.created === false, "created=false");
    assert(result.skipped === true && !!result.reason, "skipped=true + reason (keine Erfindung)");
    const after = (
      db.prepare(`SELECT COUNT(*) AS c FROM focus_snapshots WHERE twin_id = ?`).get(TWIN_ID) as { c: number }
    ).c;
    assert(after === before, "KEINE neue Row geschrieben");
  }

  // ── e) Abgrenzung: KEIN Pending-Audit erzeugt (Fokus ist gate-frei) ──
  console.log("\n── e) Kein Pending — Fokus schreibt direkt, nicht via Audit");
  {
    const auditCountAfter = (
      db.prepare(`SELECT COUNT(*) AS c FROM audit WHERE twin_id = ?`).get(TWIN_ID) as { c: number }
    ).c;
    assert(
      auditCountAfter === auditCountBefore,
      "Audit-Zeilen unverändert seit Seed (deriveFocus erzeugt KEIN Audit/Pending)",
    );
    const pending = (
      db.prepare(`SELECT COUNT(*) AS c FROM audit WHERE status = 'pending'`).get() as { c: number }
    ).c;
    assert(pending === 0, "kein pending-Audit irgendeiner Art");
  }
  db.close();

  // ── d) Route-Contract: Owner → 200 + Ergebnis; Nicht-Owner → 403 ──
  console.log("\n── d) Route POST /twins/:handle/focus/refresh");
  {
    const spy = { calls: 0 };
    const focusEngineStub = {
      deriveFocus: async () => {
        spy.calls += 1;
        return { created: true, snapshot: { id: "focus_1", focusText: "…", themes: [] } };
      },
    };
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
          entry: { twinId: TWIN_ID, handle: HANDLE, service: { focusEngine: focusEngineStub } } as any,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          user: { userId: "user_x" } as any,
        };
      },
    );
    await app.ready();

    const ownerRes = await app.inject({ method: "POST", url: `/twins/${encodeURIComponent(HANDLE)}/focus/refresh` });
    assert(ownerRes.statusCode === 200, "Owner → 200");
    assert(spy.calls === 1, "deriveFocus() 1× gerufen");
    assert(ownerRes.json().created === true, "Ergebnis durchgereicht (created)");

    const otherRes = await app.inject({ method: "POST", url: `/twins/@fremder/focus/refresh` });
    assert(otherRes.statusCode === 403, "Nicht-Owner → 403");
    assert(spy.calls === 1, "deriveFocus NICHT erneut gerufen (Owner-Gate)");
    await app.close();
  }

  console.log(
    failures === 0
      ? "\n✅ ALLE CHECKS GRÜN — Fokus wird direkt geschrieben (kein Pending), Leer-Fall sauber, Route owner-gated.\n"
      : `\n❌ ${failures} CHECK(S) FEHLGESCHLAGEN.\n`,
  );
  if (failures > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
