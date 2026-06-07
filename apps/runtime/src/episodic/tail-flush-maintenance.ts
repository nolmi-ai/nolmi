import type Database from "better-sqlite3";
import { ConversationsRepo } from "../conversations/repo.js";
import { ConversationSummariesRepo } from "../conversations/summaries-repo.js";
import {
  SummaryEngine,
  type SummaryGenerator,
} from "../conversations/summary-engine.js";
import {
  flushConversationTail,
  type TailFlushCallback,
} from "../conversations/tail-flush.js";
import { EmbeddingsRepo } from "./embeddings-repo.js";
import { TwinDiaryRepo } from "./twin-diary-repo.js";
import { MemoryEmbeddingService } from "./memory-embedding-service.js";
import { MemoryMaintenanceService } from "./memory-maintenance-service.js";
import type { EmbeddingProvider } from "./providers/types.js";
import { SqliteAuditRepository } from "../repository/sqlite.js";

// ─── TAIL-FLUSH-WIRING (Sub-Step 6a) ────────────────────────────────────────
//
// Baut einen MemoryMaintenanceService MIT verkabeltem tailFlush-Callback. Damit
// flusht der Verarbeiter den unsummarisierten Tail von Konv mit Segmenten
// (statt segCount-Skip). `summarize` (Summary-LLM) + `getProvider` (Embedding-
// Provider) sind injizierbar — das CLI gibt die echten rein (wie der Live-Pfad),
// Tests einen Mock. Eigenes Modul (kein CLI-main-Side-Effect) → CLI UND Test
// importieren denselben Aufbau.

export function buildTailFlushMaintenance(opts: {
  db: Database.Database;
  twinId: string;
  twinName: string;
  summarize: SummaryGenerator;
  getProvider: () => EmbeddingProvider;
}): MemoryMaintenanceService {
  const { db, twinId, twinName, summarize, getProvider } = opts;
  const conversationsRepo = new ConversationsRepo(db);
  const conversationSummariesRepo = new ConversationSummariesRepo(db);
  const embeddingsRepo = new EmbeddingsRepo(db);
  const twinDiaryRepo = new TwinDiaryRepo(db);
  const summaryEngine = new SummaryEngine({
    db,
    summariesRepo: conversationSummariesRepo,
    summarize,
  });
  const memoryEmbeddingService = new MemoryEmbeddingService({
    embeddingsRepo,
    conversationSummariesRepo,
    conversationsRepo,
    twinDiaryRepo,
    getProvider,
  });
  const tailFlush: TailFlushCallback = (conversationId, trigger) => {
    // partnerHandle pro Konv (für die Summary-Prompt-Personalisierung).
    const conv = conversationsRepo.findById(conversationId);
    return flushConversationTail(
      {
        summaryEngine,
        memoryEmbeddingService,
        conversationsRepo,
        conversationSummariesRepo,
        twinId,
      },
      conversationId,
      { twinName, partnerHandle: conv.partnerHandle },
      trigger,
    );
  };
  return new MemoryMaintenanceService({
    db,
    audit: new SqliteAuditRepository(db),
    embeddingsRepo,
    conversationsRepo,
    conversationSummariesRepo,
    twinDiaryRepo,
    memoryEmbeddingService,
    tailFlush,
    // Sub-Step 6a-fix: reiner Tail-Leser für die dry-run-Vorschau (kein LLM).
    tailPending: (conversationId) =>
      summaryEngine.countPendingTurns(conversationId),
  });
}
