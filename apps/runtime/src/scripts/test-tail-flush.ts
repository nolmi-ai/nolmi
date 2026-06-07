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
import { EmbeddingsRepo } from "../episodic/embeddings-repo.js";
import { TwinDiaryRepo } from "../episodic/twin-diary-repo.js";
import { MemoryEmbeddingService } from "../episodic/memory-embedding-service.js";
import { flushConversationTail } from "../conversations/tail-flush.js";

// ─── TEST: Tail-Flush-Primitive (Sub-Step 2/6) ──────────────────────────────
//
// Echtes Schema (sqlite-vec + FTS5), aber MOCK summarize + MOCK Embedding-
// Provider (deterministisch, kein LLM/Modell-Download — Repo-Konvention).
// Beweist: Tail-Verdichtung, Schleife (Tail>BATCH → mehrere Segmente),
// Idempotenz (2. Lauf No-op), Kosten-Gate (kein summarize-Call ohne Tail),
// No-Segment-Konv = No-op.
//   pnpm --filter @nolmi/runtime exec tsx src/scripts/test-tail-flush.ts

const EMBEDDING_DIM = 1024;
const TEST_MODEL = "mock-e5";
const CONTEXT = { twinName: "Twin", partnerHandle: "@markus" };

let failures = 0;
function assert(cond: boolean, label: string): void {
  if (cond) console.log(`  ✓ ${label}`);
  else { console.error(`  ✗ FAIL: ${label}`); failures += 1; }
}

/** Mock-Provider: fixer normalisierter 1024-Vektor, kein Modell-Load. */
function mockProvider() {
  return {
    modelName: TEST_MODEL,
    dimensions: EMBEDDING_DIM,
    async embed(texts: string | string[]) {
      const arr = Array.isArray(texts) ? texts : [texts];
      return arr.map(() => { const v = new Float32Array(EMBEDDING_DIM); v[0] = 1; return v; });
    },
    async isReady() { return true; },
  };
}

/** Mock-summarize mit Call-Zähler (für Kosten-Gate-Asserts). */
function mockSummarize() {
  const state = { calls: 0 };
  const fn = async (_system: string, user: string) => {
    state.calls += 1;
    return { text: `MOCK-SUMMARY (${user.length} chars)` };
  };
  return { fn, state };
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
  db.prepare(
    `INSERT INTO users (user_id, email, password_hash, display_name, created_at, updated_at)
     VALUES (?, ?, 'x', 'T', ?, ?)`,
  ).run(userId, `${nanoid(6)}@t.invalid`, now, now);
  const twinId = `twin_${nanoid(12)}`;
  db.prepare(
    `INSERT INTO twin_profiles (twin_id, handle, display_name, persona_md, mandates_json,
       llm_config, bridge_url, bridge_token, owner_user_id, is_active, created_at, updated_at)
     VALUES (?, ?, 'T', '# P', '[]', ?, NULL, NULL, ?, 1, ?, ?)`,
  ).run(twinId, `@t-${nanoid(4)}`,
    JSON.stringify({ provider: "openai", model: "x", apiKeyEncrypted: "x", apiKeySource: "user" }),
    userId, Date.now(), Date.now());
  return { twinId, userId };
}

const BASE_MS = Date.parse("2026-01-01T00:00:00Z");
/** Seedet eine aktive Konv + N owner-direct-Audits (Turn 1..n, ISO aufsteigend). */
function seedConvWithTurns(db: Database.Database, twinId: string, userId: string, n: number): { convId: string; auditIds: string[] } {
  const convId = `conv_${nanoid(12)}`;
  db.prepare(
    `INSERT INTO conversations (id, owner_user_id, partner_handle, twin_id, status, started_at)
     VALUES (?, ?, '@markus', ?, 'active', ?)`,
  ).run(convId, userId, twinId, new Date(BASE_MS).toISOString());
  const auditIds: string[] = [];
  for (let i = 1; i <= n; i++) {
    const id = `aud_${nanoid(10)}`;
    const ts = new Date(BASE_MS + i * 60_000).toISOString();
    const data = JSON.stringify({
      id, twinId, timestamp: ts, capability: "owner-direct", mandateId: null,
      status: "executed", input: { lastMessage: `frage ${i}` }, output: { reply: `antwort ${i}` }, reason: null,
    });
    db.prepare(
      `INSERT INTO audit (id, twin_id, timestamp, capability, mandate_id, status, conversation_id, data)
       VALUES (?, ?, ?, 'owner-direct', NULL, 'executed', ?, ?)`,
    ).run(id, twinId, ts, convId, data);
    auditIds.push(id);
  }
  return { convId, auditIds };
}

/** Legt ein bestehendes Segment an, das Turns [1..upto] abdeckt (Cursor = ts(upto)). */
function seedSegment(repo: ConversationSummariesRepo, convId: string, auditIds: string[], upto: number): void {
  repo.insert({
    conversationId: convId,
    segmentStartAuditId: auditIds[0]!,
    segmentEndAuditId: auditIds[upto - 1]!,
    segmentMessageCount: upto,
    summaryMd: `bestehendes Segment 1..${upto}`,
  });
}

function countSummaries(db: Database.Database, convId: string): number {
  return (db.prepare("SELECT COUNT(*) n FROM conversation_summaries WHERE conversation_id=?").get(convId) as { n: number }).n;
}
function countSegmentEmbeddings(db: Database.Database, convId: string): number {
  return (db.prepare(
    `SELECT COUNT(*) n FROM embeddings e JOIN conversation_summaries s ON s.id=e.target_id
       WHERE e.target_type='summary_segment' AND s.conversation_id=?`,
  ).get(convId) as { n: number }).n;
}
function convStatus(db: Database.Database, convId: string): string {
  return (db.prepare("SELECT embedding_status st FROM conversations WHERE id=?").get(convId) as { st: string }).st;
}

function makeDeps(db: Database.Database, twinId: string, summarizeFn: (s: string, u: string) => Promise<{ text: string }>) {
  const conversationsRepo = new ConversationsRepo(db);
  const conversationSummariesRepo = new ConversationSummariesRepo(db);
  const embeddingsRepo = new EmbeddingsRepo(db);
  const twinDiaryRepo = new TwinDiaryRepo(db);
  const summaryEngine = new SummaryEngine({ db, summariesRepo: conversationSummariesRepo, summarize: summarizeFn });
  const memoryEmbeddingService = new MemoryEmbeddingService({
    embeddingsRepo, conversationSummariesRepo, conversationsRepo, twinDiaryRepo,
    getProvider: () => mockProvider() as never,
  });
  return { summaryEngine, memoryEmbeddingService, conversationsRepo, conversationSummariesRepo, twinId, _summaries: conversationSummariesRepo };
}

async function main(): Promise<void> {
  const db = new Database(":memory:");
  migrate(db);
  const { twinId, userId } = seedTwin(db);

  // ── 4) Tail-Flush: 53 Turns, Segment 1..40 → 1 neues Segment (41..53) ──
  console.log("\n── 4) Tail-Flush erzeugt genau 1 Tail-Segment + Embedding");
  {
    const { convId, auditIds } = seedConvWithTurns(db, twinId, userId, 53);
    const sum = mockSummarize();
    const deps = makeDeps(db, twinId, sum.fn);
    seedSegment(deps._summaries, convId, auditIds, 40);
    assert(deps.summaryEngine.countPendingTurns(convId) === 13, "Tail = 13 Turns (41..53) vor Flush");
    const r = await flushConversationTail(deps, convId, CONTEXT);
    assert(r.status === "done" && r.flushed === 1, `status=done, flushed=1 (got ${r.status}/${r.flushed})`);
    assert(countSummaries(db, convId) === 2, `2 Segmente (1 alt + 1 Tail) (got ${countSummaries(db, convId)})`);
    assert(countSegmentEmbeddings(db, convId) === 1, `1 summary_segment-Embedding (got ${countSegmentEmbeddings(db, convId)})`);
    assert(convStatus(db, convId) === "done", `conv embedding_status=done (got ${convStatus(db, convId)})`);
    assert(deps.summaryEngine.countPendingTurns(convId) === 0, "Tail nach Flush = 0");

    // ── 5) Idempotenz: zweiter Lauf = No-op ──
    console.log("\n── 5) Idempotenz (2. Lauf No-op)");
    const callsBefore = sum.state.calls;
    const r2 = await flushConversationTail(deps, convId, CONTEXT);
    assert(r2.status === "noop" && r2.flushed === 0, `2. Lauf → noop/0 (got ${r2.status}/${r2.flushed})`);
    assert(countSummaries(db, convId) === 2, "kein zusätzliches Segment");
    assert(countSegmentEmbeddings(db, convId) === 1, "kein zusätzliches Embedding");
    assert(sum.state.calls === callsBefore, "kein erneuter summarize-Call (Kosten-Gate)");
  }

  // ── 6) Großer Tail (> BATCH 40) → SCHLEIFE erzeugt mehrere Segmente ──
  console.log("\n── 6) Großer Tail (48) → 2 Tail-Segmente (Schleife)");
  {
    const { convId, auditIds } = seedConvWithTurns(db, twinId, userId, 88);
    const sum = mockSummarize();
    const deps = makeDeps(db, twinId, sum.fn);
    seedSegment(deps._summaries, convId, auditIds, 40); // Tail = 41..88 = 48 > 40
    assert(deps.summaryEngine.countPendingTurns(convId) === 48, "Tail = 48 Turns vor Flush");
    const r = await flushConversationTail(deps, convId, CONTEXT);
    assert(r.status === "done" && r.flushed === 2, `flushed=2 (41..80, 81..88) (got ${r.flushed})`);
    assert(countSummaries(db, convId) === 3, `3 Segmente (1 alt + 2 Tail) (got ${countSummaries(db, convId)})`);
    assert(countSegmentEmbeddings(db, convId) === 2, `2 neue Tail-Embeddings (got ${countSegmentEmbeddings(db, convId)})`);
    assert(deps.summaryEngine.countPendingTurns(convId) === 0, "Tail nach Schleife = 0");
  }

  // ── 7) Leerer Tail (Segment deckt alles) → No-op, kein summarize-Call ──
  console.log("\n── 7) Leerer Tail → No-op");
  {
    const { convId, auditIds } = seedConvWithTurns(db, twinId, userId, 30);
    const sum = mockSummarize();
    const deps = makeDeps(db, twinId, sum.fn);
    seedSegment(deps._summaries, convId, auditIds, 30); // Segment deckt alle 30 → Tail 0
    const r = await flushConversationTail(deps, convId, CONTEXT);
    assert(r.status === "noop" && r.flushed === 0, `noop/0 (got ${r.status}/${r.flushed})`);
    assert(sum.state.calls === 0, "kein summarize-Call (Kosten-Gate bei leerem Tail)");
    assert(countSummaries(db, convId) === 1, "kein neues Segment");
  }

  // ── 8) Konv OHNE Segment → No-op (gehört in Whole-Embed-Pfad) ──
  console.log("\n── 8) Konv ohne Segment → No-op (nicht Gegenstand der Primitive)");
  {
    const { convId } = seedConvWithTurns(db, twinId, userId, 5);
    const sum = mockSummarize();
    const deps = makeDeps(db, twinId, sum.fn);
    const r = await flushConversationTail(deps, convId, CONTEXT);
    assert(r.status === "noop" && r.flushed === 0, `noop/0 (got ${r.status}/${r.flushed})`);
    assert(sum.state.calls === 0, "kein summarize-Call");
    assert(countSummaries(db, convId) === 0, "kein Segment erzeugt (Whole-Embed-Pfad bleibt zuständig)");
  }

  // ── 9) context-Gate: autonomous (env-gated) vs manual (immer) ──
  console.log("\n── 9) Gate: autonomous vs manual");
  {
    // 9a) autonomous + Flag AUS → gated (kein Flush, kein summarize-Call)
    delete process.env.TAIL_FLUSH_AUTONOMOUS_ENABLED;
    const { convId, auditIds } = seedConvWithTurns(db, twinId, userId, 53);
    const sum = mockSummarize();
    const deps = makeDeps(db, twinId, sum.fn);
    seedSegment(deps._summaries, convId, auditIds, 40);
    const rGated = await flushConversationTail(deps, convId, CONTEXT, "autonomous");
    assert(rGated.status === "gated" && rGated.flushed === 0, `autonomous+AUS → gated/0 (got ${rGated.status}/${rGated.flushed})`);
    assert(sum.state.calls === 0, "gated → kein summarize-Call (kein LLM)");
    assert(countSummaries(db, convId) === 1, "gated → kein neues Segment");

    // 9b) dieselbe Konv, autonomous + Flag AN → flusht
    process.env.TAIL_FLUSH_AUTONOMOUS_ENABLED = "true";
    const rOn = await flushConversationTail(deps, convId, CONTEXT, "autonomous");
    assert(rOn.status === "done" && rOn.flushed === 1, `autonomous+AN → done/1 (got ${rOn.status}/${rOn.flushed})`);
    assert(countSummaries(db, convId) === 2, "Flag AN → Tail-Segment erzeugt");
    delete process.env.TAIL_FLUSH_AUTONOMOUS_ENABLED;

    // 9c) frische Konv, manual + Flag AUS → flusht trotzdem (manual ignoriert Gate)
    const c2 = seedConvWithTurns(db, twinId, userId, 53);
    const deps2 = makeDeps(db, twinId, mockSummarize().fn);
    seedSegment(deps2._summaries, c2.convId, c2.auditIds, 40);
    const rMan = await flushConversationTail(deps2, c2.convId, CONTEXT, "manual");
    assert(rMan.status === "done" && rMan.flushed === 1, `manual+AUS → flusht (done/1) (got ${rMan.status}/${rMan.flushed})`);
  }

  db.close();
  console.log(failures === 0
    ? "\n✅ ALLE CHECKS GRÜN — Tail-Flush (1 Segment, Schleife>BATCH, Idempotenz, Kosten-Gate, No-Segment-No-op, context-Gate).\n"
    : `\n❌ ${failures} FEHLER\n`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => { console.error(err); process.exit(1); });
