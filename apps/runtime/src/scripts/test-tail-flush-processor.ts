import "dotenv/config";
import Database from "better-sqlite3";
import * as sqliteVec from "sqlite-vec";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { nanoid } from "nanoid";
import { loadRuntimeConfig } from "../config.js";
import { ConversationsRepo } from "../conversations/repo.js";
import { ConversationSummariesRepo } from "../conversations/summaries-repo.js";
import { SummaryEngine } from "../conversations/summary-engine.js";
import { flushConversationTail, type TailFlushCallback } from "../conversations/tail-flush.js";
import { EmbeddingsRepo } from "../episodic/embeddings-repo.js";
import { TwinDiaryRepo } from "../episodic/twin-diary-repo.js";
import { MemoryEmbeddingService } from "../episodic/memory-embedding-service.js";
import { MemoryMaintenanceService } from "../episodic/memory-maintenance-service.js";
import { SqliteAuditRepository } from "../repository/sqlite.js";

// ─── TEST: pending-Tail-Flush-Verarbeiter (Sub-Step 4/6) ────────────────────
//
// MemoryMaintenanceService.embedAll greift beendete pending-Konv MIT Segment+Tail
// auf und flusht den Tail (statt segCount-Skip), respektiert Batch-Limit + Gate.
// Echtes Schema, Mock-summarize + Mock-Provider.
//   pnpm --filter @nolmi/runtime exec tsx src/scripts/test-tail-flush-processor.ts

const DIM = 1024;
const CONTEXT = { twinName: "Twin", partnerHandle: "@markus" };
let failures = 0;
function assert(cond: boolean, label: string): void {
  if (cond) console.log(`  ✓ ${label}`);
  else { console.error(`  ✗ FAIL: ${label}`); failures += 1; }
}

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
  db.prepare(`INSERT INTO twin_profiles (twin_id, handle, display_name, persona_md, mandates_json, llm_config, bridge_url, bridge_token, owner_user_id, is_active, created_at, updated_at) VALUES (?, ?, 'T', '# P', '[]', ?, NULL, NULL, ?, 1, ?, ?)`)
    .run(twinId, `@t-${nanoid(4)}`, JSON.stringify({ provider: "openai", model: "x", apiKeyEncrypted: "x", apiKeySource: "user" }), userId, Date.now(), Date.now());
  return { twinId, userId };
}

const BASE_MS = Date.parse("2026-01-01T00:00:00Z");
/** Beendete pending-Konv mit 53 Turns + Segment 1..40 (Tail 41..53). `order` steuert ended_at. */
function seedEndedConvWithTail(db: Database.Database, summariesRepo: ConversationSummariesRepo, twinId: string, userId: string, order: number): string {
  const convId = `conv_${nanoid(12)}`;
  const startedAt = new Date(BASE_MS + order * 3_600_000).toISOString();
  db.prepare(`INSERT INTO conversations (id, owner_user_id, partner_handle, twin_id, status, started_at, ended_at) VALUES (?, ?, '@markus', ?, 'ended', ?, ?)`)
    .run(convId, userId, twinId, startedAt, new Date(BASE_MS + order * 3_600_000 + 60_000).toISOString());
  const auditIds: string[] = [];
  for (let i = 1; i <= 53; i++) {
    const id = `aud_${nanoid(10)}`;
    const ts = new Date(BASE_MS + order * 3_600_000 + i * 1_000).toISOString();
    const data = JSON.stringify({ id, twinId, timestamp: ts, capability: "owner-direct", mandateId: null, status: "executed", input: { lastMessage: `f ${i}` }, output: { reply: `a ${i}` }, reason: null });
    db.prepare(`INSERT INTO audit (id, twin_id, timestamp, capability, mandate_id, status, conversation_id, data) VALUES (?, ?, ?, 'owner-direct', NULL, 'executed', ?, ?)`)
      .run(id, twinId, ts, convId, data);
    auditIds.push(id);
  }
  summariesRepo.insert({ conversationId: convId, segmentStartAuditId: auditIds[0]!, segmentEndAuditId: auditIds[39]!, segmentMessageCount: 40, summaryMd: "Segment 1..40" });
  return convId;
}

function makeMaintenance(db: Database.Database, twinId: string) {
  const auditRepo = new SqliteAuditRepository(db);
  const conversationsRepo = new ConversationsRepo(db);
  const conversationSummariesRepo = new ConversationSummariesRepo(db);
  const embeddingsRepo = new EmbeddingsRepo(db);
  const twinDiaryRepo = new TwinDiaryRepo(db);
  const summaryEngine = new SummaryEngine({
    db, summariesRepo: conversationSummariesRepo,
    summarize: async () => ({ text: "MOCK-SUMMARY Tail." }),
  });
  const memoryEmbeddingService = new MemoryEmbeddingService({
    embeddingsRepo, conversationSummariesRepo, conversationsRepo, twinDiaryRepo,
    getProvider: () => mockProvider() as never,
  });
  const tailFlush: TailFlushCallback = (conversationId, trigger) =>
    flushConversationTail(
      { summaryEngine, memoryEmbeddingService, conversationsRepo, conversationSummariesRepo, twinId },
      conversationId, CONTEXT, trigger,
    );
  const maintenance = new MemoryMaintenanceService({
    db, audit: auditRepo, embeddingsRepo, conversationsRepo,
    conversationSummariesRepo, twinDiaryRepo, memoryEmbeddingService, tailFlush,
  });
  return { maintenance };
}

const doneCount = (db: Database.Database, twinId: string) =>
  (db.prepare("SELECT COUNT(*) n FROM conversations WHERE twin_id=? AND status='ended' AND embedding_status='done'").get(twinId) as { n: number }).n;
const pendingCount = (db: Database.Database, twinId: string) =>
  (db.prepare("SELECT COUNT(*) n FROM conversations WHERE twin_id=? AND status='ended' AND embedding_status!='done'").get(twinId) as { n: number }).n;

async function main(): Promise<void> {
  // ── 10a) Batch-Limit: 3 pending-Tails, limit 2 → 2 geflusht, 1 bleibt; 2. Lauf flusht den Rest ──
  console.log("\n── 10a) Verarbeiter + Batch-Limit (manual)");
  {
    delete process.env.TAIL_FLUSH_AUTONOMOUS_ENABLED;
    const db = new Database(":memory:"); migrate(db);
    const { twinId, userId } = seedTwin(db);
    const summariesRepo = new ConversationSummariesRepo(db);
    for (let i = 1; i <= 3; i++) seedEndedConvWithTail(db, summariesRepo, twinId, userId, i);
    const { maintenance } = makeMaintenance(db, twinId);

    assert(pendingCount(db, twinId) === 3, "3 pending-Konv vor dem Lauf");
    const r1 = await maintenance.embedAll({ twinId, type: "conversation", trigger: "manual", tailFlushLimit: 2 });
    assert(r1.tailFlushed === 2, `Lauf 1: tailFlushed=2 (Batch-Limit) (got ${r1.tailFlushed})`);
    assert(doneCount(db, twinId) === 2 && pendingCount(db, twinId) === 1, `Lauf 1: 2 done / 1 pending (got ${doneCount(db, twinId)}/${pendingCount(db, twinId)})`);

    const r2 = await maintenance.embedAll({ twinId, type: "conversation", trigger: "manual", tailFlushLimit: 2 });
    assert(r2.tailFlushed === 1, `Lauf 2: tailFlushed=1 (Rest) (got ${r2.tailFlushed})`);
    assert(doneCount(db, twinId) === 3 && pendingCount(db, twinId) === 0, "Lauf 2: alle 3 done, 0 pending");

    const r3 = await maintenance.embedAll({ twinId, type: "conversation", trigger: "manual", tailFlushLimit: 2 });
    assert(r3.tailFlushed === 0, "Lauf 3: nichts mehr offen (Idempotenz)");
    db.close();
  }

  // ── 10b) Gate im Verarbeiter: autonomous + Flag AUS → nichts geflusht, alle bleiben pending ──
  console.log("\n── 10b) Verarbeiter autonomous + Flag AUS → gated");
  {
    delete process.env.TAIL_FLUSH_AUTONOMOUS_ENABLED;
    const db = new Database(":memory:"); migrate(db);
    const { twinId, userId } = seedTwin(db);
    const summariesRepo = new ConversationSummariesRepo(db);
    for (let i = 1; i <= 2; i++) seedEndedConvWithTail(db, summariesRepo, twinId, userId, i);
    const { maintenance } = makeMaintenance(db, twinId);

    const r = await maintenance.embedAll({ twinId, type: "conversation", trigger: "autonomous", tailFlushLimit: 5 });
    assert(r.tailFlushed === 0, `autonomous+AUS → 0 geflusht (got ${r.tailFlushed})`);
    assert(pendingCount(db, twinId) === 2, "autonomous+AUS → beide bleiben pending (warten auf Scharfschalten)");

    // mit Flag AN → flusht
    process.env.TAIL_FLUSH_AUTONOMOUS_ENABLED = "true";
    const r2 = await maintenance.embedAll({ twinId, type: "conversation", trigger: "autonomous", tailFlushLimit: 5 });
    assert(r2.tailFlushed === 2, `autonomous+AN → 2 geflusht (got ${r2.tailFlushed})`);
    assert(doneCount(db, twinId) === 2, "autonomous+AN → beide done");
    delete process.env.TAIL_FLUSH_AUTONOMOUS_ENABLED;
    db.close();
  }

  console.log(failures === 0
    ? "\n✅ ALLE CHECKS GRÜN — pending-Verarbeiter (Batch-Limit, Idempotenz, autonomous-Gate).\n"
    : `\n❌ ${failures} FEHLER\n`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => { console.error(err); process.exit(1); });
