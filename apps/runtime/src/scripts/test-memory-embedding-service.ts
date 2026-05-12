import "dotenv/config";
import Database from "better-sqlite3";
import * as sqliteVec from "sqlite-vec";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { nanoid } from "nanoid";
import { loadRuntimeConfig } from "../config.js";
import { ConversationSummariesRepo } from "../conversations/summaries-repo.js";
import { ConversationsRepo } from "../conversations/repo.js";
import { EmbeddingsRepo } from "../episodic/embeddings-repo.js";
import { TwinDiaryRepo } from "../episodic/twin-diary-repo.js";
import {
  MemoryEmbeddingService,
  aggregateConversationForEmbedding,
} from "../episodic/memory-embedding-service.js";
import { TwinDiaryService } from "../episodic/twin-diary-service.js";
import type {
  EmbeddingProvider,
  EmbedOptions,
} from "../episodic/providers/index.js";
import type { AuditEntry } from "@twin-lab/shared";

// ─── TEST: MEMORY-EMBEDDING-SERVICE (Phase 3.4 Sub-Schritt D) ───────────────
//
// Mock-Provider-basiert. Echte E5-Embedding wird in 3.4.B-Test verifiziert;
// hier geht's um die Pipeline: Service ruft Provider, schreibt in
// embeddings + memory_fts, setzt Status-Flag richtig, und schluckt
// Failures statt sie hochzuwerfen.

const EMBEDDING_DIM = 1024;
const TEST_MODEL = "mock-test";

class MockEmbeddingProvider implements EmbeddingProvider {
  readonly modelName = TEST_MODEL;
  readonly dimensions = EMBEDDING_DIM;
  private shouldFail = false;
  callCount = 0;
  lastInputType: EmbedOptions["inputType"] | null = null;

  setFailMode(fail: boolean) {
    this.shouldFail = fail;
  }

  async embed(
    texts: string | string[],
    options: EmbedOptions,
  ): Promise<Float32Array[]> {
    this.callCount += 1;
    this.lastInputType = options.inputType;
    if (this.shouldFail) {
      throw new Error("Mock provider configured to fail");
    }
    const arr = Array.isArray(texts) ? texts : [texts];
    return arr.map(() => makeNormalizedVector(EMBEDDING_DIM));
  }

  async isReady() {
    return true;
  }
}

async function main() {
  const db = new Database(":memory:");
  sqliteVec.load(db);
  db.pragma("journal_mode = MEMORY");
  db.pragma("foreign_keys = ON");

  const config = loadRuntimeConfig();
  const files = readdirSync(config.migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  for (const file of files) {
    const sql = readFileSync(resolve(config.migrationsDir, file), "utf-8");
    db.exec(sql);
  }
  log(`Migrations geladen: ${files.length}`);

  const userId = createUser(db);
  const twinId = createTwinProfile(db, userId, "@_test-emb");
  log(`Fixtures: twin=${twinId}`);

  const conversationSummariesRepo = new ConversationSummariesRepo(db);
  const conversationsRepo = new ConversationsRepo(db);
  const embeddingsRepo = new EmbeddingsRepo(db);
  const twinDiaryRepo = new TwinDiaryRepo(db);

  const provider = new MockEmbeddingProvider();
  const service = new MemoryEmbeddingService({
    embeddingsRepo,
    conversationSummariesRepo,
    conversationsRepo,
    twinDiaryRepo,
    getProvider: () => provider,
  });

  let issues = 0;

  issues += await runSummarySegmentTests(
    db,
    service,
    embeddingsRepo,
    conversationSummariesRepo,
    provider,
    twinId,
    userId,
  );
  issues += await runConversationTests(
    db,
    service,
    embeddingsRepo,
    conversationsRepo,
    provider,
    twinId,
    userId,
  );
  issues += await runDiaryTests(
    db,
    service,
    embeddingsRepo,
    twinDiaryRepo,
    provider,
    twinId,
  );
  issues += runAggregatorTests();
  issues += await runDiaryServiceTest(
    twinDiaryRepo,
    service,
    twinDiaryRepo,
    twinId,
  );

  banner("ZUSAMMENFASSUNG");
  if (issues === 0) {
    log("✓ alle Tests grün");
  } else {
    log(`✗ ${issues} Issue(s) — Details oben.`);
    db.close();
    process.exit(2);
  }
  db.close();
}

// ─── TEST 1: embedSummarySegment ────────────────────────────────────────────

async function runSummarySegmentTests(
  db: Database.Database,
  service: MemoryEmbeddingService,
  embeddingsRepo: EmbeddingsRepo,
  summariesRepo: ConversationSummariesRepo,
  provider: MockEmbeddingProvider,
  twinId: string,
  userId: string,
): Promise<number> {
  let issues = 0;

  // Konversation + Audit-Stub-Rows für die Summary-FK-Erfüllung.
  const conversationId = `conv_${nanoid(16)}`;
  const auditId = `audit_${nanoid(16)}`;
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO conversations (id, owner_user_id, partner_handle, twin_id, status, started_at, ended_at)
     VALUES (?, ?, ?, ?, 'active', ?, NULL)`,
  ).run(conversationId, userId, "@partner", twinId, now);
  db.prepare(
    `INSERT INTO audit (id, twin_id, timestamp, capability, mandate_id, status, conversation_id, data)
     VALUES (?, ?, ?, ?, NULL, 'executed', ?, '{}')`,
  ).run(auditId, twinId, now, "owner-direct", conversationId);

  banner("TEST 1.1 — embedSummarySegment Happy-Path");
  const segment = summariesRepo.insert({
    conversationId,
    segmentStartAuditId: auditId,
    segmentEndAuditId: auditId,
    segmentMessageCount: 2,
    summaryMd: "Markus erzählte von einem Workshop in Bayreuth.",
  });
  provider.setFailMode(false);
  const callsBefore = provider.callCount;
  await service.embedSummarySegment({
    twinId,
    segmentId: segment.id,
    content: segment.summaryMd,
  });

  if (provider.callCount !== callsBefore + 1) {
    issues += 1;
    log(`  ⚠ Provider wurde nicht aufgerufen (${provider.callCount} vs erwartet ${callsBefore + 1}).`);
  }
  if (provider.lastInputType !== "passage") {
    issues += 1;
    log(`  ⚠ Provider mit inputType='${provider.lastInputType}' aufgerufen, erwartet 'passage'.`);
  }
  const stored = embeddingsRepo.getByTarget(
    twinId,
    "summary_segment",
    segment.id,
    TEST_MODEL,
  );
  if (!stored) {
    issues += 1;
    log("  ⚠ Embedding-Row fehlt nach Happy-Path.");
  } else {
    log(`  embedding eingetragen ✓ id=${stored.id}`);
  }
  const statusRow = db
    .prepare(
      `SELECT embedding_status FROM conversation_summaries WHERE id = ?`,
    )
    .get(segment.id) as { embedding_status: string };
  if (statusRow.embedding_status !== "done") {
    issues += 1;
    log(`  ⚠ status='${statusRow.embedding_status}', erwartet 'done'`);
  } else {
    log("  status='done' ✓");
  }
  const ftsHit = db
    .prepare(
      `SELECT target_id FROM memory_fts WHERE content MATCH ? AND twin_id = ?`,
    )
    .get("Workshop", twinId) as { target_id: string } | undefined;
  if (ftsHit?.target_id !== segment.id) {
    issues += 1;
    log(`  ⚠ FTS-Treffer falsch: ${JSON.stringify(ftsHit)}`);
  } else {
    log("  FTS5-Eintrag ✓");
  }

  banner("TEST 1.2 — embedSummarySegment Failure schluckt + status='failed'");
  const segment2 = summariesRepo.insert({
    conversationId,
    segmentStartAuditId: auditId,
    segmentEndAuditId: auditId,
    segmentMessageCount: 2,
    summaryMd: "Anderer Block.",
  });
  provider.setFailMode(true);
  let threw = false;
  try {
    await service.embedSummarySegment({
      twinId,
      segmentId: segment2.id,
      content: segment2.summaryMd,
    });
  } catch {
    threw = true;
  }
  if (threw) {
    issues += 1;
    log("  ⚠ Service hat Failure hochgeworfen — sollte schlucken.");
  } else {
    log("  kein Re-Throw ✓");
  }
  const stored2 = embeddingsRepo.getByTarget(
    twinId,
    "summary_segment",
    segment2.id,
    TEST_MODEL,
  );
  if (stored2) {
    issues += 1;
    log("  ⚠ Embedding-Row trotz Failure angelegt.");
  }
  const status2 = db
    .prepare(
      `SELECT embedding_status FROM conversation_summaries WHERE id = ?`,
    )
    .get(segment2.id) as { embedding_status: string };
  if (status2.embedding_status !== "failed") {
    issues += 1;
    log(`  ⚠ status='${status2.embedding_status}', erwartet 'failed'`);
  } else {
    log("  status='failed' ✓");
  }
  provider.setFailMode(false);

  banner("TEST 1.3 — embedSummarySegment skipped bei leerem Content");
  const segment3 = summariesRepo.insert({
    conversationId,
    segmentStartAuditId: auditId,
    segmentEndAuditId: auditId,
    segmentMessageCount: 1,
    summaryMd: "   ",
  });
  const callsBeforeEmpty = provider.callCount;
  await service.embedSummarySegment({
    twinId,
    segmentId: segment3.id,
    content: "   ",
  });
  if (provider.callCount !== callsBeforeEmpty) {
    issues += 1;
    log("  ⚠ Provider wurde trotz leerem Content aufgerufen.");
  }
  const status3 = db
    .prepare(
      `SELECT embedding_status FROM conversation_summaries WHERE id = ?`,
    )
    .get(segment3.id) as { embedding_status: string };
  if (status3.embedding_status !== "failed") {
    issues += 1;
    log(`  ⚠ status='${status3.embedding_status}', erwartet 'failed' bei leerem Content`);
  } else {
    log("  empty content → status='failed' ✓");
  }

  return issues;
}

// ─── TEST 2: embedConversation ──────────────────────────────────────────────

async function runConversationTests(
  db: Database.Database,
  service: MemoryEmbeddingService,
  embeddingsRepo: EmbeddingsRepo,
  conversationsRepo: ConversationsRepo,
  provider: MockEmbeddingProvider,
  twinId: string,
  userId: string,
): Promise<number> {
  let issues = 0;

  banner("TEST 2.1 — embedConversation Happy-Path");
  const conv = conversationsRepo.start({
    ownerUserId: userId,
    partnerHandle: "@_test-conv",
    twinId,
  });
  await service.embedConversation({
    twinId,
    conversationId: conv.id,
    content:
      "[user] Hallo!\n\n[assistant] Hi, wie kann ich helfen?\n\n[user] Erzähl mir was über HARWAY.",
  });
  const stored = embeddingsRepo.getByTarget(
    twinId,
    "conversation",
    conv.id,
    TEST_MODEL,
  );
  if (!stored) {
    issues += 1;
    log("  ⚠ Embedding-Row fehlt.");
  }
  const statusRow = db
    .prepare(`SELECT embedding_status FROM conversations WHERE id = ?`)
    .get(conv.id) as { embedding_status: string };
  if (statusRow.embedding_status !== "done") {
    issues += 1;
    log(`  ⚠ status='${statusRow.embedding_status}', erwartet 'done'`);
  } else {
    log("  conversation embedded + status='done' ✓");
  }

  banner("TEST 2.2 — embedConversation Failure setzt status='failed'");
  const conv2 = conversationsRepo.start({
    ownerUserId: userId,
    partnerHandle: "@_test-conv2",
    twinId,
  });
  provider.setFailMode(true);
  await service.embedConversation({
    twinId,
    conversationId: conv2.id,
    content: "Inhalt egal.",
  });
  provider.setFailMode(false);
  const status2 = db
    .prepare(`SELECT embedding_status FROM conversations WHERE id = ?`)
    .get(conv2.id) as { embedding_status: string };
  if (status2.embedding_status !== "failed") {
    issues += 1;
    log(`  ⚠ status='${status2.embedding_status}', erwartet 'failed'`);
  } else {
    log("  Failure-Pfad ✓");
  }

  return issues;
}

// ─── TEST 3: embedDiaryEntry + TwinDiaryService ─────────────────────────────

async function runDiaryTests(
  db: Database.Database,
  service: MemoryEmbeddingService,
  embeddingsRepo: EmbeddingsRepo,
  diaryRepo: TwinDiaryRepo,
  provider: MockEmbeddingProvider,
  twinId: string,
): Promise<number> {
  let issues = 0;

  banner("TEST 3.1 — embedDiaryEntry Happy-Path");
  const entry = diaryRepo.insert({
    twinId,
    content: "Heute viel über Markus' Workshop nachgedacht.",
    triggeredBy: "manual",
  });
  await service.embedDiaryEntry({
    twinId,
    diaryEntryId: entry.id,
    content: entry.content,
  });
  const stored = embeddingsRepo.getByTarget(
    twinId,
    "diary_entry",
    entry.id,
    TEST_MODEL,
  );
  if (!stored) {
    issues += 1;
    log("  ⚠ Diary-Embedding fehlt.");
  }
  const status = db
    .prepare(`SELECT embedding_status FROM twin_diary WHERE id = ?`)
    .get(entry.id) as { embedding_status: string };
  if (status.embedding_status !== "done") {
    issues += 1;
    log(`  ⚠ status='${status.embedding_status}', erwartet 'done'`);
  } else {
    log("  diary embedded ✓");
  }

  // provider-Variable referenziert, damit der Param-Inferenz nicht meckert
  void provider;
  return issues;
}

// ─── TEST 4: aggregateConversationForEmbedding ──────────────────────────────

function runAggregatorTests(): number {
  let issues = 0;
  banner("TEST 4.1 — aggregateConversationForEmbedding zählende Audits");

  const audits: AuditEntry[] = [
    {
      id: "a1",
      twinId: "t",
      timestamp: "2026-01-01T00:00:00Z",
      capability: "owner-direct",
      mandateId: null,
      status: "executed",
      input: { lastMessage: "Hallo Twin." },
      output: { reply: "Hi!" },
    } as unknown as AuditEntry,
    {
      id: "a2",
      twinId: "t",
      timestamp: "2026-01-01T00:01:00Z",
      capability: "mcp-tool-use",
      mandateId: null,
      status: "executed",
      input: { toolCall: { mcpToolName: "x", args: {} } },
      output: { toolResult: "ok" },
    } as unknown as AuditEntry,
    {
      id: "a3",
      twinId: "t",
      timestamp: "2026-01-01T00:02:00Z",
      capability: "owner-direct",
      mandateId: null,
      status: "executed",
      input: { lastMessage: "Wie geht's HARWAY?" },
      output: { reply: "Gut." },
    } as unknown as AuditEntry,
  ];

  const text = aggregateConversationForEmbedding(audits);
  if (!text.includes("[user] Hallo Twin.")) {
    issues += 1;
    log("  ⚠ Aggregator hat user-Text 1 nicht aufgenommen.");
  }
  if (!text.includes("[assistant] Hi!")) {
    issues += 1;
    log("  ⚠ Aggregator hat assistant-Text 1 nicht aufgenommen.");
  }
  if (!text.includes("[user] Wie geht's HARWAY?")) {
    issues += 1;
    log("  ⚠ Aggregator hat user-Text 2 nicht aufgenommen.");
  }
  if (text.includes("mcp-tool-use") || text.includes("x")) {
    issues += 1;
    log("  ⚠ Aggregator hat tool-use-Audit aufgenommen — sollte filtern.");
  }
  if (issues === 0) {
    log("  Aggregator ✓ (filtert auf zählende Audits, marker erhalten)");
  }
  return issues;
}

// ─── TEST 5: TwinDiaryService.addEntry End-to-End ──────────────────────────

async function runDiaryServiceTest(
  diaryRepo: TwinDiaryRepo,
  embeddingService: MemoryEmbeddingService,
  _diaryRepoAgain: TwinDiaryRepo,
  twinId: string,
): Promise<number> {
  let issues = 0;
  banner("TEST 5.1 — TwinDiaryService.addEntry insert + embed");

  const service = new TwinDiaryService(diaryRepo, embeddingService);
  const entry = await service.addEntry({
    twinId,
    content: "Reflexion über den Tag.",
    triggeredBy: "manual",
  });

  const reloaded = diaryRepo.getById(entry.id);
  if (!reloaded) {
    issues += 1;
    log("  ⚠ Diary-Eintrag fehlt nach addEntry.");
  } else if (reloaded.embeddingStatus !== "done") {
    issues += 1;
    log(`  ⚠ embeddingStatus='${reloaded.embeddingStatus}', erwartet 'done'`);
  } else {
    log("  insert + embed ✓");
  }
  void _diaryRepoAgain;
  return issues;
}

// ─── helpers ────────────────────────────────────────────────────────────────

function makeNormalizedVector(dim: number): Float32Array {
  const v = new Float32Array(dim);
  for (let i = 0; i < dim; i++) v.set([Math.random() - 0.5], i);
  let n = 0;
  for (let i = 0; i < dim; i++) {
    const x = v.at(i) ?? 0;
    n += x * x;
  }
  n = Math.sqrt(n);
  for (let i = 0; i < dim; i++) {
    const x = v.at(i) ?? 0;
    v.set([x / n], i);
  }
  return v;
}

function createUser(db: Database.Database): string {
  const userId = `user_${nanoid(16)}`;
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO users (user_id, email, password_hash, display_name, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(userId, `${nanoid(8)}@test.invalid`, "x", "Test", now, now);
  return userId;
}

function createTwinProfile(
  db: Database.Database,
  ownerUserId: string,
  handleBase: string,
): string {
  const twinId = `twin_${nanoid(16)}`;
  const nowMs = Date.now();
  db.prepare(
    `INSERT INTO twin_profiles (
       twin_id, handle, display_name, persona_md, mandates_json,
       llm_config, bridge_url, bridge_token,
       owner_user_id, is_active, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
  ).run(
    twinId,
    `${handleBase}-${nanoid(4)}`,
    "Test",
    "# Persona\n",
    "[]",
    JSON.stringify({
      provider: "openai",
      model: "gpt-4o-mini",
      apiKeyEncrypted: "x",
      apiKeySource: "user",
    }),
    "http://127.0.0.1:5100",
    "test-token",
    ownerUserId,
    nowMs,
    nowMs,
  );
  return twinId;
}

function banner(title: string) {
  const line = "─".repeat(72);
  console.log(`\n${line}\n  ${title}\n${line}`);
}

function log(msg: string) {
  console.log(msg);
}

main().catch((err) => {
  console.error(
    "\n[memory-embedding:test] Fehler:",
    err instanceof Error ? err.stack ?? err.message : err,
  );
  process.exit(1);
});
