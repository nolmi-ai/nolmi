import "dotenv/config";
import Database from "better-sqlite3";
import * as sqliteVec from "sqlite-vec";
import { MockLanguageModelV3 } from "ai/test";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { nanoid } from "nanoid";
import { loadRuntimeConfig } from "../config.js";
import { ConversationsRepo } from "../conversations/repo.js";
import { ConversationSummariesRepo } from "../conversations/summaries-repo.js";
import { FactsRepo } from "../facts/repo.js";
import { FactsHistoryRepo } from "../facts/facts-history-repo.js";
import { TrustRepo } from "../trust/trust-repo.js";
import { SkillRepo } from "../skills/repo.js";
import { McpServersRepo } from "../mcp/repo.js";
import { defaultMcpClientFactory } from "../mcp/client-factory.js";
import { SqliteAuditRepository } from "../repository/sqlite.js";
import { AuditService } from "../audit/service.js";
import { EventBus } from "../events/bus.js";
import { EmbeddingsRepo } from "../episodic/embeddings-repo.js";
import { TwinDiaryRepo } from "../episodic/twin-diary-repo.js";
import { MemoryEmbeddingService } from "../episodic/memory-embedding-service.js";
import { MemoryRetrievalService } from "../episodic/memory-retrieval-service.js";
import { TwinDiaryService } from "../episodic/twin-diary-service.js";
import { TwinService } from "../twin-service.js";

// ─── TEST: Tail-Flush in resetConversation (Sub-Step 3/6) ───────────────────
//
// Echte resetConversation gegen eine echte (Mock-Model) TwinService-Instanz +
// :memory:-Schema. MockLanguageModelV3 für generateSummary, Mock-Provider für
// Embeddings (kein LLM/Modell-Download). Beweist:
//   - lange Konv (Segment + Tail) → Tail geflusht (neues Segment + Embedding) + ended
//   - kurze Konv (kein Segment) → Whole-Conv-Embed wie bisher (Regression) + ended
//   - Konv mit Segment ohne Tail → Flush No-op + ended
//   pnpm --filter @nolmi/runtime exec tsx src/scripts/test-reset-tail-flush.ts

const DIM = 1024;
let failures = 0;
function assert(cond: boolean, label: string): void {
  if (cond) console.log(`  ✓ ${label}`);
  else { console.error(`  ✗ FAIL: ${label}`); failures += 1; }
}

function mockProvider() {
  return {
    modelName: "mock-e5",
    dimensions: DIM,
    async embed(texts: string | string[]) {
      const arr = Array.isArray(texts) ? texts : [texts];
      return arr.map(() => { const v = new Float32Array(DIM); v[0] = 1; return v; });
    },
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
  db.prepare(
    `INSERT INTO users (user_id, email, password_hash, display_name, created_at, updated_at)
     VALUES (?, ?, 'x', 'T', ?, ?)`,
  ).run(userId, `${nanoid(6)}@t.invalid`, now, now);
  const twinId = `twin_${nanoid(12)}`;
  db.prepare(
    `INSERT INTO twin_profiles (twin_id, handle, display_name, persona_md, mandates_json,
       llm_config, bridge_url, bridge_token, owner_user_id, is_active, created_at, updated_at)
     VALUES (?, '@markus', 'Markus', '# P', '[]', ?, NULL, NULL, ?, 1, ?, ?)`,
  ).run(twinId,
    JSON.stringify({ provider: "openai", model: "x", apiKeyEncrypted: "x", apiKeySource: "user" }),
    userId, Date.now(), Date.now());
  return { twinId, userId };
}

const BASE_MS = Date.parse("2026-01-01T00:00:00Z");
function seedConv(db: Database.Database, twinId: string, userId: string, n: number): { convId: string; auditIds: string[] } {
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

function seedSegment(repo: ConversationSummariesRepo, convId: string, auditIds: string[], upto: number): void {
  repo.insert({
    conversationId: convId,
    segmentStartAuditId: auditIds[0]!,
    segmentEndAuditId: auditIds[upto - 1]!,
    segmentMessageCount: upto,
    summaryMd: `bestehendes Segment 1..${upto}`,
  });
}

const cSeg = (db: Database.Database, c: string) =>
  (db.prepare("SELECT COUNT(*) n FROM conversation_summaries WHERE conversation_id=?").get(c) as { n: number }).n;
const cSegEmb = (db: Database.Database, c: string) =>
  (db.prepare(`SELECT COUNT(*) n FROM embeddings e JOIN conversation_summaries s ON s.id=e.target_id
     WHERE e.target_type='summary_segment' AND s.conversation_id=?`).get(c) as { n: number }).n;
const cConvEmb = (db: Database.Database, c: string) =>
  (db.prepare("SELECT COUNT(*) n FROM embeddings WHERE target_type='conversation' AND target_id=?").get(c) as { n: number }).n;
const status = (db: Database.Database, c: string) =>
  (db.prepare("SELECT status FROM conversations WHERE id=?").get(c) as { status: string }).status;

function buildService(db: Database.Database, twinId: string, userId: string): TwinService {
  const mockModel = new MockLanguageModelV3({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    doGenerate: async () => ({
      content: [{ type: "text", text: "MOCK-SUMMARY des Tail-Segments." }],
      finishReason: "stop",
      usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      warnings: [],
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    }) as any,
  });
  const bus = new EventBus();
  const auditRepo = new SqliteAuditRepository(db);
  const audit = new AuditService(auditRepo, bus, twinId);
  const conversationsRepo = new ConversationsRepo(db);
  const conversationSummariesRepo = new ConversationSummariesRepo(db);
  const embeddingsRepo = new EmbeddingsRepo(db);
  const twinDiaryRepo = new TwinDiaryRepo(db);
  const memoryEmbeddingService = new MemoryEmbeddingService({
    embeddingsRepo, conversationSummariesRepo, conversationsRepo, twinDiaryRepo,
    getProvider: () => mockProvider() as never,
  });
  const memoryRetrievalService = new MemoryRetrievalService({
    embeddingsRepo, getProvider: () => mockProvider() as never,
  });
  return new TwinService({
    twinId, ownerUserId: userId,
    model: mockModel, modelLabel: "mock/test",
    classifierModel: mockModel, classifierModelLabel: "mock/test",
    audit, bus,
    persona: { name: "Markus", handle: "markus", systemPrompt: "# P", metadata: {} },
    mandates: [],
    bridgeClient: null,
    trustRepo: new TrustRepo(db),
    skills: new SkillRepo(db),
    conversations: conversationsRepo,
    mcpServersRepo: new McpServersRepo(db, Buffer.alloc(32)),
    mcpClientFactory: defaultMcpClientFactory,
    db,
    conversationSummaries: conversationSummariesRepo,
    facts: new FactsRepo(db, new FactsHistoryRepo(db)),
    memoryEmbeddingService,
    memoryRetrievalService,
    twinDiaryService: new TwinDiaryService(twinDiaryRepo, memoryEmbeddingService),
  });
}

async function main(): Promise<void> {
  const db = new Database(":memory:");
  migrate(db);
  const { twinId, userId } = seedTwin(db);
  const summariesRepo = new ConversationSummariesRepo(db);
  const service = buildService(db, twinId, userId);

  // ── 5) Lange Konv (Segment 1–40 + Tail 41–53) → resetConversation flusht Tail ──
  console.log("\n── 5) resetConversation flusht den Tail (lange Konv)");
  {
    const { convId, auditIds } = seedConv(db, twinId, userId, 53);
    seedSegment(summariesRepo, convId, auditIds, 40);
    await service.resetConversation(convId);
    assert(cSeg(db, convId) === 2, `2 Segmente (1 alt + 1 Tail) (got ${cSeg(db, convId)})`);
    assert(cSegEmb(db, convId) === 1, `1 Tail-Embedding (got ${cSegEmb(db, convId)})`);
    assert(cConvEmb(db, convId) === 0, "KEIN Whole-Conv-Embed (Segment-Pfad)");
    assert(status(db, convId) === "ended", `conv ended (got ${status(db, convId)})`);
  }

  // ── 6) Regression: kurze Konv (kein Segment) → Whole-Conv-Embed wie bisher ──
  console.log("\n── 6) Regression: kurze Konv → Whole-Conv-Embed (unverändert)");
  {
    const { convId } = seedConv(db, twinId, userId, 5);
    await service.resetConversation(convId);
    assert(cSeg(db, convId) === 0, "kein Segment erzeugt (summaries===0-Pfad)");
    assert(cConvEmb(db, convId) === 1, `1 Whole-Conv-Embed (got ${cConvEmb(db, convId)})`);
    assert(status(db, convId) === "ended", `conv ended (got ${status(db, convId)})`);
  }

  // ── 7) Konv mit Segment ohne Tail → Flush No-op, trotzdem ended ──
  console.log("\n── 7) Segment ohne Tail → Flush No-op, ended");
  {
    const { convId, auditIds } = seedConv(db, twinId, userId, 30);
    seedSegment(summariesRepo, convId, auditIds, 30); // Segment deckt alle 30 → Tail 0
    await service.resetConversation(convId);
    assert(cSeg(db, convId) === 1, "kein zusätzliches Segment (No-op)");
    assert(cSegEmb(db, convId) === 0, "kein neues Embedding (No-op)");
    assert(status(db, convId) === "ended", `conv ended (got ${status(db, convId)})`);
  }

  // ── 8) G2-autonomous-Trigger: gegated (Flag AUS → kein Flush, Flag AN → Flush) ──
  console.log("\n── 8) resetConversation('autonomous') ist gegated");
  {
    // 8a) Flag AUS → Tail bleibt liegen, Konv trotzdem ended
    delete process.env.TAIL_FLUSH_AUTONOMOUS_ENABLED;
    const { convId, auditIds } = seedConv(db, twinId, userId, 53);
    seedSegment(summariesRepo, convId, auditIds, 40);
    await service.resetConversation(convId, "autonomous");
    assert(cSeg(db, convId) === 1, "autonomous+AUS → kein Tail-Segment (gated)");
    assert(cSegEmb(db, convId) === 0, "autonomous+AUS → kein Tail-Embedding");
    assert(status(db, convId) === "ended", "autonomous+AUS → conv trotzdem ended");

    // 8b) Flag AN → Tail wird geflusht
    process.env.TAIL_FLUSH_AUTONOMOUS_ENABLED = "true";
    const c2 = seedConv(db, twinId, userId, 53);
    seedSegment(summariesRepo, c2.convId, c2.auditIds, 40);
    await service.resetConversation(c2.convId, "autonomous");
    assert(cSeg(db, c2.convId) === 2, "autonomous+AN → Tail-Segment erzeugt");
    assert(cSegEmb(db, c2.convId) === 1, "autonomous+AN → Tail-Embedding");
    assert(status(db, c2.convId) === "ended", "autonomous+AN → ended");
    delete process.env.TAIL_FLUSH_AUTONOMOUS_ENABLED;
  }

  db.close();
  console.log(failures === 0
    ? "\n✅ ALLE CHECKS GRÜN — resetConversation-Tail-Flush (lange Konv flusht, kurze unverändert, No-Tail No-op, autonomous-Gate, alle ended).\n"
    : `\n❌ ${failures} FEHLER\n`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => { console.error(err); process.exit(1); });
