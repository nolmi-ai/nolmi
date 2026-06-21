import "dotenv/config";
import Database from "better-sqlite3";
import * as sqliteVec from "sqlite-vec";
import { MockLanguageModelV3 } from "ai/test";
import { loadRuntimeConfig } from "../config.js";
import { TwinProfilesRepo } from "../twin-profiles-repo.js";
import { TrustRepo } from "../trust/trust-repo.js";
import { SkillRepo } from "../skills/repo.js";
import { ConversationsRepo } from "../conversations/repo.js";
import { ConversationSummariesRepo } from "../conversations/summaries-repo.js";
import { FactsRepo } from "../facts/repo.js";
import { FactsHistoryRepo } from "../facts/facts-history-repo.js";
import { TwinService } from "../twin-service.js";
import { AuditService } from "../audit/service.js";
import { EventBus } from "../events/bus.js";
import { createSqliteRepository } from "../repository/index.js";
import { McpServersRepo } from "../mcp/repo.js";
import { defaultMcpClientFactory } from "../mcp/client-factory.js";
import { loadMasterKey } from "../crypto-utils.js";
import { EmbeddingsRepo } from "../episodic/embeddings-repo.js";
import { TwinDiaryRepo } from "../episodic/twin-diary-repo.js";
import { MemoryEmbeddingService } from "../episodic/memory-embedding-service.js";
import { MemoryRetrievalService } from "../episodic/memory-retrieval-service.js";
import { TwinDiaryService } from "../episodic/twin-diary-service.js";

// ─── MENTION-INTENT-AUDIT — VERIFIKATION (kein Netz, Mock-Klassifikator) ──────
// Treibt den ECHTEN chat()-Pfad mit einer VERBLOSEN @-Mention → der Klassifikator-
// Block (twin-service.ts:829) feuert → recordMentionIntentAudit schreibt einen
// `mention-intent`-Audit. Danach Query auf die audit-Tabelle. Mock-Modell liefert
// SEND, also kein echter LLM-Call. gate=shadow (ENV nicht gesetzt) — egal fürs Audit.

const TWIN_HANDLE_DEFAULT = "@markus";
const STUB = {
  modelName: "audit-test-stub",
  dimensions: 1024,
  embed: async () => [new Float32Array(1024)],
  isReady: async () => true,
};

async function main() {
  const handle = (process.argv[2] ?? TWIN_HANDLE_DEFAULT).toLowerCase();
  const config = loadRuntimeConfig();
  const db = new Database(config.dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  sqliteVec.load(db); // vec0-Modul für Episodic-Retrieve im chat()-Pfad

  const profilesRepo = new TwinProfilesRepo(db);
  const skillRepo = new SkillRepo(db);
  const trustRepo = new TrustRepo(db);
  const conversationsRepo = new ConversationsRepo(db);
  const conversationSummariesRepo = new ConversationSummariesRepo(db);
  const factsRepo = new FactsRepo(db, new FactsHistoryRepo(db));
  const masterKey = loadMasterKey();
  const mcpServersRepo = new McpServersRepo(db, masterKey);
  const repo = createSqliteRepository(config.dbPath);

  const profile = profilesRepo.findByHandle(handle);
  if (!profile) throw new Error(`Twin '${handle}' nicht in DB.`);
  if (!profile.ownerUserId) {
    throw new Error(`Twin '${handle}' hat keinen ownerUserId — Owner-Bypass nicht testbar.`);
  }
  console.log(`Test-Twin: ${profile.handle} (${profile.twinId}), Owner: ${profile.ownerUserId}`);

  // Mock: liefert für generateObject (Klassifikator) ein schema-konformes
  // { intent:"SEND", reason } als JSON-Text; für generateText (Chat-Reply) ist
  // derselbe Text eine harmlose Antwort.
  const mockModel = new MockLanguageModelV3({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    doGenerate: async () =>
      ({
        content: [
          { type: "text", text: '{"intent":"SEND","reason":"klare Direkt-Adresse (Mock)"}' },
        ],
        finishReason: "stop",
        usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
        warnings: [],
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      }) as any,
  });

  const bus = new EventBus();
  const audit = new AuditService(repo.audit, bus, profile.twinId);
  const embeddingsRepo = new EmbeddingsRepo(db);
  const twinDiaryRepo = new TwinDiaryRepo(db);
  const memoryEmbeddingService = new MemoryEmbeddingService({
    embeddingsRepo,
    conversationSummariesRepo,
    conversationsRepo,
    twinDiaryRepo,
    getProvider: () => STUB,
  });
  const memoryRetrievalService = new MemoryRetrievalService({
    embeddingsRepo,
    getProvider: () => STUB,
  });
  const twinDiaryService = new TwinDiaryService(twinDiaryRepo, memoryEmbeddingService);

  const service = new TwinService({
    twinId: profile.twinId,
    ownerUserId: profile.ownerUserId,
    model: mockModel,
    modelLabel: "mock/test",
    classifierModel: mockModel,
    classifierModelLabel: "mock/haiku-test",
    audit,
    bus,
    persona: {
      name: profile.displayName,
      handle: profile.handle.replace(/^@/, ""),
      systemPrompt: profile.personaMd,
      metadata: {},
    },
    mandates: profile.mandates,
    bridgeClient: null,
    trustRepo,
    skills: skillRepo,
    conversations: conversationsRepo,
    mcpServersRepo,
    mcpClientFactory: defaultMcpClientFactory,
    db,
    conversationSummaries: conversationSummariesRepo,
    facts: factsRepo,
    memoryEmbeddingService,
    memoryRetrievalService,
    getEmbeddingProvider: () => STUB,
    twinDiaryService,
  });

  // 🔴 Verblose @-Mention (fremdes Target, KEIN Sende-Verb) → Klassifikator-Block.
  const text = "@florian das klingt spannend";
  console.log(`\nchat(): "${text}"`);
  await service.chat([{ role: "user", content: text }], {
    requesterUserId: profile.ownerUserId,
  });

  // recordMentionIntentAudit ist fire-and-forget (void) → kurz auf den Flush warten.
  await new Promise((r) => setTimeout(r, 300));

  console.log("\n=== audit WHERE capability='mention-intent' (neueste 3) ===");
  const rows = db
    .prepare(
      "SELECT capability, status, data FROM audit WHERE capability='mention-intent' ORDER BY timestamp DESC LIMIT 3",
    )
    .all() as { capability: string; status: string; data: string }[];
  if (rows.length === 0) {
    console.log("❌ KEIN mention-intent-Audit gefunden.");
    process.exitCode = 1;
  }
  for (const row of rows) {
    const d = JSON.parse(row.data);
    console.log(
      `  capability=${row.capability} status=${row.status}\n` +
        `    input: ${JSON.stringify(d.input)}\n` +
        `    output: ${JSON.stringify(d.output)}`,
    );
  }
  db.close();
}

main().catch((err) => {
  console.error("[test-mention-intent-audit] Fehler:", err instanceof Error ? err.message : err);
  process.exit(1);
});
