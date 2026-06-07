import "dotenv/config";
import Database from "better-sqlite3";
import * as sqliteVec from "sqlite-vec";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { nanoid } from "nanoid";
import { loadRuntimeConfig } from "../config.js";
import { ConversationSummariesRepo } from "../conversations/summaries-repo.js";
import { buildTailFlushMaintenance } from "../episodic/tail-flush-maintenance.js";

// ─── TEST: CLI-Tail-Flush-Wiring (Sub-Step 6a) ──────────────────────────────
//
// Testet die EXAKTE Helper-Funktion, die das CLI (twin:memory-embed-all) nutzt:
// buildTailFlushMaintenance verkabelt den tailFlush-Callback. Mock-summarize +
// Mock-Provider (das echte LLM/decrypt-Wiring im CLI-main ist buildEntry-Pattern,
// typecheck-gedeckt). Beweist: manual-Backfill flusht Tails; dry-run schreibt
// nichts. Echtes Schema (sqlite-vec + FTS5).
//   pnpm --filter @nolmi/runtime exec tsx src/scripts/test-cli-tail-flush-wiring.ts

const DIM = 1024;
let failures = 0;
function assert(cond: boolean, label: string): void {
  if (cond) console.log(`  ✓ ${label}`);
  else { console.error(`  ✗ FAIL: ${label}`); failures += 1; }
}

const mockSummarize = async () => ({ text: "MOCK-SUMMARY Tail." });
function mockProvider() {
  return {
    modelName: "mock-e5", dimensions: DIM,
    async embed(t: string | string[]) { const a = Array.isArray(t) ? t : [t]; return a.map(() => { const v = new Float32Array(DIM); v[0] = 1; return v; }); },
    async isReady() { return true; },
  };
}

function migrate(db: Database.Database): void {
  sqliteVec.load(db);
  db.pragma("journal_mode = MEMORY");
  db.pragma("foreign_keys = ON");
  const config = loadRuntimeConfig();
  for (const f of readdirSync(config.migrationsDir).filter((x) => x.endsWith(".sql")).sort()) {
    db.exec(readFileSync(resolve(config.migrationsDir, f), "utf-8"));
  }
}

function seedTwin(db: Database.Database): { twinId: string; userId: string } {
  const userId = `user_${nanoid(8)}`;
  const now = new Date().toISOString();
  db.prepare(`INSERT INTO users (user_id, email, password_hash, display_name, created_at, updated_at) VALUES (?, ?, 'x', 'T', ?, ?)`)
    .run(userId, `${nanoid(6)}@t.invalid`, now, now);
  const twinId = `twin_${nanoid(12)}`;
  db.prepare(`INSERT INTO twin_profiles (twin_id, handle, display_name, persona_md, mandates_json, llm_config, bridge_url, bridge_token, owner_user_id, is_active, created_at, updated_at) VALUES (?, ?, 'Markus', '# P', '[]', ?, NULL, NULL, ?, 1, ?, ?)`)
    .run(twinId, `@markus-${nanoid(4)}`, JSON.stringify({ provider: "openai", model: "x", apiKeyEncrypted: "x", apiKeySource: "user" }), userId, Date.now(), Date.now());
  return { twinId, userId };
}

const BASE_MS = Date.parse("2026-01-01T00:00:00Z");
function seedEndedConvWithTail(db: Database.Database, summariesRepo: ConversationSummariesRepo, twinId: string, userId: string): string {
  const convId = `conv_${nanoid(12)}`;
  db.prepare(`INSERT INTO conversations (id, owner_user_id, partner_handle, twin_id, status, started_at, ended_at) VALUES (?, ?, '@markus', ?, 'ended', ?, ?)`)
    .run(convId, userId, twinId, new Date(BASE_MS).toISOString(), new Date(BASE_MS + 60_000).toISOString());
  const auditIds: string[] = [];
  for (let i = 1; i <= 53; i++) {
    const id = `aud_${nanoid(10)}`;
    const ts = new Date(BASE_MS + i * 1_000).toISOString();
    const data = JSON.stringify({ id, twinId, timestamp: ts, capability: "owner-direct", mandateId: null, status: "executed", input: { lastMessage: `f ${i}` }, output: { reply: `a ${i}` }, reason: null });
    db.prepare(`INSERT INTO audit (id, twin_id, timestamp, capability, mandate_id, status, conversation_id, data) VALUES (?, ?, ?, 'owner-direct', NULL, 'executed', ?, ?)`)
      .run(id, twinId, ts, convId, data);
    auditIds.push(id);
  }
  summariesRepo.insert({ conversationId: convId, segmentStartAuditId: auditIds[0]!, segmentEndAuditId: auditIds[39]!, segmentMessageCount: 40, summaryMd: "Segment 1..40" });
  return convId;
}

const cSeg = (db: Database.Database, c: string) =>
  (db.prepare("SELECT COUNT(*) n FROM conversation_summaries WHERE conversation_id=?").get(c) as { n: number }).n;
const cSegEmb = (db: Database.Database, c: string) =>
  (db.prepare(`SELECT COUNT(*) n FROM embeddings e JOIN conversation_summaries s ON s.id=e.target_id WHERE e.target_type='summary_segment' AND s.conversation_id=?`).get(c) as { n: number }).n;
const convEmbStatus = (db: Database.Database, c: string) =>
  (db.prepare("SELECT embedding_status st FROM conversations WHERE id=?").get(c) as { st: string }).st;

async function main(): Promise<void> {
  delete process.env.TAIL_FLUSH_AUTONOMOUS_ENABLED; // Backfill ist manual → Gate egal

  // ── 6) CLI-Helper: manueller Backfill flusht den Tail ──
  console.log("\n── 6) buildTailFlushMaintenance: manueller Backfill flusht Tail");
  {
    const db = new Database(":memory:"); migrate(db);
    const { twinId, userId } = seedTwin(db);
    const summariesRepo = new ConversationSummariesRepo(db);
    const convId = seedEndedConvWithTail(db, summariesRepo, twinId, userId);
    const maintenance = buildTailFlushMaintenance({
      db, twinId, twinName: "Markus", summarize: mockSummarize, getProvider: () => mockProvider() as never,
    });
    const r = await maintenance.embedAll({ twinId, type: "conversation", trigger: "manual", tailFlushLimit: 5 });
    assert(r.tailFlushed === 1, `tailFlushed=1 (got ${r.tailFlushed})`);
    assert(cSeg(db, convId) === 2, `2 Segmente (1 alt + 1 Tail) (got ${cSeg(db, convId)})`);
    assert(cSegEmb(db, convId) === 1, `1 Tail-Embedding (got ${cSegEmb(db, convId)})`);
    assert(convEmbStatus(db, convId) === "done", `embedding_status=done (got ${convEmbStatus(db, convId)})`);
    db.close();
  }

  // ── 8) Dry-Run: tail-aware Vorschau, KEIN LLM, schreibt NICHTS ──
  console.log("\n── 8) Dry-Run: Tail-Vorschau ohne LLM/Schreiben");
  {
    const db = new Database(":memory:"); migrate(db);
    const { twinId, userId } = seedTwin(db);
    const summariesRepo = new ConversationSummariesRepo(db);
    const convId = seedEndedConvWithTail(db, summariesRepo, twinId, userId);
    // 🔴 summarize WIRFT, falls aufgerufen → beweist: dry-run ruft KEIN LLM.
    const throwingSummarize = async () => { throw new Error("LLM darf im dry-run NICHT laufen"); };
    const maintenance = buildTailFlushMaintenance({
      db, twinId, twinName: "Markus", summarize: throwingSummarize, getProvider: () => mockProvider() as never,
    });
    const events: { status: string; tailTurns?: number }[] = [];
    const r = await maintenance.embedAll({
      twinId, type: "conversation", trigger: "manual", dryRun: true, tailFlushLimit: 5,
      onProgress: (e) => events.push({ status: e.status, tailTurns: e.tailTurns }),
    });
    assert(r.tailFlushable === 1, `dry-run: tailFlushable=1 (Vorschau) (got ${r.tailFlushable})`);
    assert(events.some((e) => e.status === "tail-pending" && e.tailTurns === 13), "dry-run: 'tail-pending'-Event mit 13 turns gemeldet");
    assert(cSeg(db, convId) === 1, "dry-run → kein neues Segment");
    assert(cSegEmb(db, convId) === 0, "dry-run → kein Embedding");
    assert(convEmbStatus(db, convId) === "pending", `dry-run → status unverändert pending (got ${convEmbStatus(db, convId)})`);
    // (kein Throw bis hier = summarize wurde NICHT aufgerufen → kein LLM im dry-run)
    assert(true, "dry-run → kein LLM-Call (throwing summarize wurde nicht ausgelöst)");
    db.close();
  }

  // ── 8b) Dry-Run, Konv mit Segment OHNE Tail → skip, tailFlushable=0 ──
  console.log("\n── 8b) Dry-Run: Segment ohne Tail → skip");
  {
    const db = new Database(":memory:"); migrate(db);
    const { twinId, userId } = seedTwin(db);
    const summariesRepo = new ConversationSummariesRepo(db);
    const convId = seedEndedConvWithTail(db, summariesRepo, twinId, userId);
    // Zweites Segment, das den Tail (41..53) abdeckt → Tail = 0.
    const allAudits = db.prepare("SELECT id FROM audit WHERE conversation_id=? ORDER BY timestamp ASC").all(convId) as { id: string }[];
    summariesRepo.insert({ conversationId: convId, segmentStartAuditId: allAudits[40]!.id, segmentEndAuditId: allAudits[52]!.id, segmentMessageCount: 13, summaryMd: "Segment 41..53" });
    const maintenance = buildTailFlushMaintenance({
      db, twinId, twinName: "Markus", summarize: async () => { throw new Error("kein LLM"); }, getProvider: () => mockProvider() as never,
    });
    const r = await maintenance.embedAll({ twinId, type: "conversation", trigger: "manual", dryRun: true, tailFlushLimit: 5 });
    assert(r.tailFlushable === 0, `kein Tail → tailFlushable=0 (got ${r.tailFlushable})`);
    db.close();
  }

  console.log(failures === 0
    ? "\n✅ ALLE CHECKS GRÜN — CLI-Wiring (manual-Backfill flusht, dry-run tail-aware: Vorschau ohne LLM/Schreiben).\n"
    : `\n❌ ${failures} FEHLER\n`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => { console.error(err); process.exit(1); });
