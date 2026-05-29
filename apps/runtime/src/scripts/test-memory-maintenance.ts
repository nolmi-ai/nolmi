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
import { MemoryEmbeddingService } from "../episodic/memory-embedding-service.js";
import { MemoryMaintenanceService } from "../episodic/memory-maintenance-service.js";
import type {
  EmbeddingProvider,
  EmbedOptions,
} from "../episodic/providers/index.js";
import { SqliteAuditRepository } from "../repository/sqlite.js";

// ─── TEST: MEMORY-MAINTENANCE (Phase 3.4 Sub-Schritt G) ─────────────────────
//
// MockProvider mit umschaltbarer `modelName` (für den Provider-Wechsel-
// Smoke) plus optionaler Failure-Modus. Tests laufen direkt gegen den
// Service — CLI ist dünn (Args-Parsing).

const EMBEDDING_DIM = 1024;

class SwappableMockProvider implements EmbeddingProvider {
  modelName: string;
  readonly dimensions = EMBEDDING_DIM;
  shouldFail = false;
  callCount = 0;
  constructor(modelName: string) {
    this.modelName = modelName;
  }
  async embed(
    texts: string | string[],
    _opts: EmbedOptions,
  ): Promise<Float32Array[]> {
    this.callCount += 1;
    if (this.shouldFail) throw new Error("Mock provider failure");
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
  for (const file of readdirSync(config.migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort()) {
    db.exec(readFileSync(resolve(config.migrationsDir, file), "utf-8"));
  }

  const userId = createUser(db);
  const twinA = createTwinProfile(db, userId, "@_main-a");
  const twinB = createTwinProfile(db, userId, "@_main-b");
  log(`Fixtures: twinA=${twinA} twinB=${twinB}`);

  const conversationsRepo = new ConversationsRepo(db);
  const conversationSummariesRepo = new ConversationSummariesRepo(db);
  const embeddingsRepo = new EmbeddingsRepo(db);
  const twinDiaryRepo = new TwinDiaryRepo(db);
  const auditRepo = new SqliteAuditRepository(db);

  const provider = new SwappableMockProvider("provider-A");
  const memoryEmbeddingService = new MemoryEmbeddingService({
    embeddingsRepo,
    conversationSummariesRepo,
    conversationsRepo,
    twinDiaryRepo,
    getProvider: () => provider,
  });
  const maintenance = new MemoryMaintenanceService({
    db,
    audit: auditRepo,
    embeddingsRepo,
    conversationsRepo,
    conversationSummariesRepo,
    twinDiaryRepo,
    memoryEmbeddingService,
  });

  let issues = 0;

  issues += await runPendingTest(
    db,
    maintenance,
    conversationsRepo,
    twinDiaryRepo,
    embeddingsRepo,
    userId,
    twinA,
  );
  issues += await runSkipSegmentsTest(
    db,
    maintenance,
    conversationsRepo,
    conversationSummariesRepo,
    embeddingsRepo,
    userId,
    twinA,
  );
  issues += await runForceTest(
    maintenance,
    twinDiaryRepo,
    embeddingsRepo,
    provider,
    twinA,
  );
  issues += await runDryRunTest(
    maintenance,
    twinDiaryRepo,
    embeddingsRepo,
    twinA,
  );
  issues += await runTypeFilterTest(
    db,
    maintenance,
    conversationsRepo,
    twinDiaryRepo,
    userId,
    twinA,
  );
  issues += await runMultiTenantTest(
    maintenance,
    twinDiaryRepo,
    embeddingsRepo,
    twinA,
    twinB,
  );
  issues += await runFailureTest(
    maintenance,
    twinDiaryRepo,
    embeddingsRepo,
    provider,
    twinA,
  );

  banner("ZUSAMMENFASSUNG");
  if (issues === 0) {
    log("✓ alle Tests grün");
  } else {
    log(`✗ ${issues} Issue(s) — siehe oben`);
    db.close();
    process.exit(2);
  }
  db.close();
}

// ─── TEST 1: Pending-Items ─────────────────────────────────────────────────

async function runPendingTest(
  db: Database.Database,
  maintenance: MemoryMaintenanceService,
  conversationsRepo: ConversationsRepo,
  twinDiaryRepo: TwinDiaryRepo,
  embeddingsRepo: EmbeddingsRepo,
  userId: string,
  twinId: string,
): Promise<number> {
  banner("TEST 1 — pending Items werden embedded");
  let issues = 0;

  // 2 ended Konversationen (status='pending' per Default) + ein Audit pro Konv.
  const conv1 = endedConversation(db, userId, twinId);
  insertOwnerDirectAudit(db, twinId, conv1, "Frage zu Workshop", "Antwort 1");
  const conv2 = endedConversation(db, userId, twinId);
  insertOwnerDirectAudit(db, twinId, conv2, "Frage zu Toskana", "Antwort 2");

  // 1 Diary (status='pending')
  twinDiaryRepo.insert({
    twinId,
    content: "Diary-Reflexion über die Woche.",
    triggeredBy: "manual",
  });

  const result = await maintenance.embedAll({ twinId });
  log(
    `  processed=${result.processed} succeeded=${result.succeeded} failed=${result.failed} skipped=${result.skipped}`,
  );
  if (result.succeeded !== 3) {
    issues += 1;
    log(`  ⚠ erwartet 3 succeeded, got ${result.succeeded}`);
  }
  // embedding-Tabelle sollte 3 neue Rows haben
  const embCount = embeddingsRepo.count(twinId);
  if (embCount < 3) {
    issues += 1;
    log(`  ⚠ embeddings.count=${embCount}, erwartet ≥3`);
  } else {
    log(`  embeddings.count=${embCount} ✓`);
  }
  // Konv-Status auf 'done' (Spalte nicht im Conversation-Type, daher SQL)
  const c1Status = embeddingStatusOf(db, "conversations", conv1);
  if (c1Status !== "done") {
    issues += 1;
    log(`  ⚠ conv1 status='${c1Status}', erwartet 'done'`);
  }
  void conversationsRepo;
  return issues;
}

// ─── TEST 2: Skip-Logic bei Segments ───────────────────────────────────────

async function runSkipSegmentsTest(
  db: Database.Database,
  maintenance: MemoryMaintenanceService,
  conversationsRepo: ConversationsRepo,
  summariesRepo: ConversationSummariesRepo,
  embeddingsRepo: EmbeddingsRepo,
  userId: string,
  twinId: string,
): Promise<number> {
  banner("TEST 2 — Konv mit Segments wird übersprungen, Segment embedded");
  let issues = 0;

  const conv = endedConversation(db, userId, twinId);
  // Embedding-Status der Konv auf 'pending' lassen (Default).
  const auditId = insertOwnerDirectAudit(
    db,
    twinId,
    conv,
    "Frage",
    "Antwort",
  );
  // Summary-Segment einfügen (status='pending').
  summariesRepo.insert({
    conversationId: conv,
    segmentStartAuditId: auditId,
    segmentEndAuditId: auditId,
    segmentMessageCount: 1,
    summaryMd: "Summary-Segment für die Konv.",
  });

  const result = await maintenance.embedAll({ twinId });
  log(
    `  processed=${result.processed} succeeded=${result.succeeded} skipped=${result.skipped}`,
  );

  // Segment muss embedded sein, Konv selbst übersprungen.
  const segEmb = embeddingsRepo.listByTwin(twinId, "summary_segment");
  if (segEmb.length < 1) {
    issues += 1;
    log("  ⚠ Segment nicht embedded");
  }
  const convEmb = embeddingsRepo
    .listByTwin(twinId, "conversation")
    .find((e) => e.targetId === conv);
  if (convEmb) {
    issues += 1;
    log("  ⚠ Konv mit Segments wurde irrtümlich als conversation embedded");
  }
  // Konv-Status sollte 'done' sein (Service zieht ihn auf done beim Skip).
  const convStatus = embeddingStatusOf(db, "conversations", conv);
  if (convStatus !== "done") {
    issues += 1;
    log(`  ⚠ Konv-Status='${convStatus}', erwartet 'done'`);
  } else {
    log("  Skip ✓ (Segment embedded, Konv übersprungen)");
  }
  void conversationsRepo;
  return issues;
}

// ─── TEST 3: --force re-embedded und tauscht embedding_model ───────────────

async function runForceTest(
  maintenance: MemoryMaintenanceService,
  twinDiaryRepo: TwinDiaryRepo,
  embeddingsRepo: EmbeddingsRepo,
  provider: SwappableMockProvider,
  twinId: string,
): Promise<number> {
  banner("TEST 3 — --force löscht alte Embeddings + tauscht Modell");
  let issues = 0;

  // Diary mit provider-A embedded
  const entry = twinDiaryRepo.insert({
    twinId,
    content: "Force-Test-Inhalt.",
    triggeredBy: "manual",
  });
  await maintenance.embedAll({ twinId, type: "diary_entry" });
  const oldEmbRows = embeddingsRepo.listByTwin(twinId, "diary_entry");
  const beforeRow = oldEmbRows.find((r) => r.targetId === entry.id);
  if (!beforeRow) {
    issues += 1;
    log("  ⚠ Pre-Force-Embedding fehlt.");
    return issues;
  }
  if (beforeRow.embeddingModel !== "provider-A") {
    issues += 1;
    log(`  ⚠ Pre-Force-Model='${beforeRow.embeddingModel}', erwartet 'provider-A'`);
  }

  // Provider wechseln und --force durchziehen
  provider.modelName = "provider-B";
  const result = await maintenance.embedAll({
    twinId,
    type: "diary_entry",
    force: true,
  });
  log(`  processed=${result.processed} succeeded=${result.succeeded}`);

  const afterRows = embeddingsRepo
    .listByTwin(twinId, "diary_entry")
    .filter((r) => r.targetId === entry.id);
  if (afterRows.length !== 1) {
    issues += 1;
    log(`  ⚠ Post-Force: erwartet 1 Embedding für ${entry.id}, got ${afterRows.length}`);
  } else if (afterRows[0]!.embeddingModel !== "provider-B") {
    issues += 1;
    log(
      `  ⚠ Post-Force-Model='${afterRows[0]!.embeddingModel}', erwartet 'provider-B'`,
    );
  } else {
    log("  Modell-Swap via --force ✓");
  }

  // Provider zurück auf A für nachfolgende Tests
  provider.modelName = "provider-A";
  return issues;
}

// ─── TEST 4: --dry-run ─────────────────────────────────────────────────────

async function runDryRunTest(
  maintenance: MemoryMaintenanceService,
  twinDiaryRepo: TwinDiaryRepo,
  embeddingsRepo: EmbeddingsRepo,
  twinId: string,
): Promise<number> {
  banner("TEST 4 — --dry-run zählt aber persistiert nicht");
  let issues = 0;
  const entry = twinDiaryRepo.insert({
    twinId,
    content: "Dry-Run-Kandidat.",
    triggeredBy: "manual",
  });
  const embsBefore = embeddingsRepo.count(twinId);
  const result = await maintenance.embedAll({
    twinId,
    type: "diary_entry",
    dryRun: true,
  });
  const embsAfter = embeddingsRepo.count(twinId);
  if (result.processed < 1) {
    issues += 1;
    log(`  ⚠ erwartet processed≥1, got ${result.processed}`);
  }
  if (embsAfter !== embsBefore) {
    issues += 1;
    log(`  ⚠ Embeddings-Count hat sich verändert (${embsBefore} → ${embsAfter})`);
  }
  // Status soll noch 'pending' sein
  const reloaded = twinDiaryRepo.getById(entry.id);
  if (reloaded?.embeddingStatus !== "pending") {
    issues += 1;
    log(
      `  ⚠ dry-run hat embedding_status auf '${reloaded?.embeddingStatus}' geändert`,
    );
  } else {
    log("  dry-run ✓ (kein Insert, kein Status-Update)");
  }
  return issues;
}

// ─── TEST 5: --type-Filter ─────────────────────────────────────────────────

async function runTypeFilterTest(
  db: Database.Database,
  maintenance: MemoryMaintenanceService,
  conversationsRepo: ConversationsRepo,
  twinDiaryRepo: TwinDiaryRepo,
  userId: string,
  twinId: string,
): Promise<number> {
  banner("TEST 5 — --type diary_entry embedded nur Diary");
  let issues = 0;
  const conv = endedConversation(db, userId, twinId);
  insertOwnerDirectAudit(db, twinId, conv, "frage", "antwort");
  const entry = twinDiaryRepo.insert({
    twinId,
    content: "TypeFilter-Diary.",
    triggeredBy: "manual",
  });
  await maintenance.embedAll({ twinId, type: "diary_entry" });
  // Konv darf noch nicht 'done' sein
  const cvStatus = embeddingStatusOf(db, "conversations", conv);
  if (cvStatus === "done") {
    issues += 1;
    log("  ⚠ Konv wurde embedded obwohl type=diary_entry");
  }
  void conversationsRepo;
  const d = twinDiaryRepo.getById(entry.id);
  if (d?.embeddingStatus !== "done") {
    issues += 1;
    log(`  ⚠ Diary-Status='${d?.embeddingStatus}', erwartet 'done'`);
  } else {
    log("  Type-Filter ✓");
  }
  return issues;
}

// ─── TEST 6: Multi-Tenant ─────────────────────────────────────────────────

async function runMultiTenantTest(
  maintenance: MemoryMaintenanceService,
  twinDiaryRepo: TwinDiaryRepo,
  embeddingsRepo: EmbeddingsRepo,
  twinA: string,
  twinB: string,
): Promise<number> {
  banner("TEST 6 — Multi-Tenant-Isolation");
  let issues = 0;
  const bEntry = twinDiaryRepo.insert({
    twinId: twinB,
    content: "TwinB-only.",
    triggeredBy: "manual",
  });
  // Run für twinA — sollte twinB-Eintrag NICHT anfassen.
  await maintenance.embedAll({ twinId: twinA });
  const bRow = twinDiaryRepo.getById(bEntry.id);
  if (bRow?.embeddingStatus !== "pending") {
    issues += 1;
    log(
      `  ⚠ twinB-Eintrag wurde durch twinA-Run angefasst: status='${bRow?.embeddingStatus}'`,
    );
  } else {
    log("  Isolation ✓");
  }
  void embeddingsRepo;
  return issues;
}

// ─── TEST 7: Failure-Path ─────────────────────────────────────────────────

async function runFailureTest(
  maintenance: MemoryMaintenanceService,
  twinDiaryRepo: TwinDiaryRepo,
  embeddingsRepo: EmbeddingsRepo,
  provider: SwappableMockProvider,
  twinId: string,
): Promise<number> {
  banner("TEST 7 — Provider-Failure → result.failed, kein Embedding");
  let issues = 0;
  const entry = twinDiaryRepo.insert({
    twinId,
    content: "Failure-Kandidat.",
    triggeredBy: "manual",
  });
  provider.shouldFail = true;
  const result = await maintenance.embedAll({
    twinId,
    type: "diary_entry",
  });
  provider.shouldFail = false;

  if (result.failed < 1) {
    issues += 1;
    log(`  ⚠ erwartet failed≥1, got ${result.failed}`);
  }
  const post = twinDiaryRepo.getById(entry.id);
  if (post?.embeddingStatus !== "failed") {
    issues += 1;
    log(`  ⚠ Status='${post?.embeddingStatus}', erwartet 'failed'`);
  }
  const emb = embeddingsRepo
    .listByTwin(twinId, "diary_entry")
    .find((r) => r.targetId === entry.id);
  if (emb) {
    issues += 1;
    log("  ⚠ Embedding-Eintrag trotz Failure angelegt");
  } else {
    log("  Failure-Pfad ✓ (kein Embedding, status='failed')");
  }
  return issues;
}

// ─── Fixtures ───────────────────────────────────────────────────────────────

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

function endedConversation(
  db: Database.Database,
  ownerUserId: string,
  twinId: string,
): string {
  const id = `conv_${nanoid(16)}`;
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO conversations (id, owner_user_id, partner_handle, twin_id, status, started_at, ended_at)
     VALUES (?, ?, ?, ?, 'ended', ?, ?)`,
  ).run(id, ownerUserId, `@_partner-${nanoid(4)}`, twinId, now, now);
  return id;
}

/**
 * Liest embedding_status direkt aus der Tabelle. Conversations/Summary-Type
 * in @nolmi/shared kennt das Feld nicht — es ist eine Datenschicht-
 * Erweiterung aus Migration 018. Tests nutzen daher SQL.
 */
function embeddingStatusOf(
  db: Database.Database,
  table: "conversations" | "conversation_summaries" | "twin_diary",
  id: string,
): string | null {
  const row = db
    .prepare(`SELECT embedding_status FROM ${table} WHERE id = ?`)
    .get(id) as { embedding_status: string } | undefined;
  return row?.embedding_status ?? null;
}

function insertOwnerDirectAudit(
  db: Database.Database,
  twinId: string,
  conversationId: string,
  userMessage: string,
  reply: string,
): string {
  const id = `audit_${nanoid(16)}`;
  const ts = new Date().toISOString();
  const data = JSON.stringify({
    id,
    twinId,
    timestamp: ts,
    capability: "owner-direct",
    mandateId: null,
    status: "executed",
    input: { lastMessage: userMessage },
    output: { reply },
  });
  db.prepare(
    `INSERT INTO audit (id, twin_id, timestamp, capability, mandate_id, status, conversation_id, data)
     VALUES (?, ?, ?, 'owner-direct', NULL, 'executed', ?, ?)`,
  ).run(id, twinId, ts, conversationId, data);
  return id;
}

function makeNormalizedVector(dim: number): Float32Array {
  const v = new Float32Array(dim);
  for (let i = 0; i < dim; i++) v.set([Math.random() - 0.5], i);
  let n = 0;
  for (let i = 0; i < dim; i++) {
    const x = v.at(i) ?? 0;
    n += x * x;
  }
  n = Math.sqrt(n);
  if (n > 0) {
    for (let i = 0; i < dim; i++) {
      const x = v.at(i) ?? 0;
      v.set([x / n], i);
    }
  }
  return v;
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
    "\n[memory-maintenance:test] Fehler:",
    err instanceof Error ? err.stack ?? err.message : err,
  );
  process.exit(1);
});
