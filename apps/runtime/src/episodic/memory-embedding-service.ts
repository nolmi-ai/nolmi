import type { AuditEntry } from "@nolmi/shared";
import type { ConversationSummariesRepo } from "../conversations/summaries-repo.js";
import type { ConversationsRepo } from "../conversations/repo.js";
import type { EmbeddingsRepo } from "./embeddings-repo.js";
import type { TwinDiaryRepo } from "./twin-diary-repo.js";
import type { EmbeddingProvider } from "./providers/index.js";

// ─── MEMORY EMBEDDING SERVICE (3.4.D) ───────────────────────────────────────
//
// Zentrale Stelle, die EmbeddingProvider + EmbeddingsRepo zusammenführt und
// die `embedding_status`-Flags auf den Quell-Tabellen pflegt. Wird genutzt
// von:
//   - TwinService (Send-Path): nach SummaryEngine.generateSummary
//   - Server-Route /conversations/reset: für kurze Konversationen ohne Segments
//   - TwinDiaryService (3.4.F): nach Diary-Insert
//
// Failure-Policy (docs/archive/3.4-STRATEGY.md "Failure-Handling"):
//   Embedding-Failure unterbricht die Hauptoperation NICHT. Wir loggen den
//   Reason, setzen status='failed' und werfen NICHT. Caller (Send-Path,
//   Reset-Route) merken nichts; der Maintenance-CLI (3.4.G) räumt später auf.
//
// Provider-Lazy-Resolve: wir nehmen `() => EmbeddingProvider` rein, nicht den
// Provider direkt. So passiert der Singleton-Resolve (und ggf. das Modell-
// Laden bei Local) erst beim ersten echten Embed-Versuch, nicht bei
// Service-Konstruktion. Tests können den Callback mit einem Mock ersetzen.
//
// Atomicity: EmbeddingsRepo.insert macht intern eine Transaction über
// embeddings + embeddings_vec + memory_fts. Das nachträgliche
// updateEmbeddingStatus ist eine separate Operation — Crash dazwischen lässt
// einen 'pending'-Status mit existierendem Embedding zurück. Maintenance-CLI
// findet das durch UNIQUE-Constraint-Konflikt beim Retry und skippet.

const QUERY_PREFIX_INPUT_TYPE = "passage" as const;
const TARGET_TYPE_SUMMARY = "summary_segment";
const TARGET_TYPE_CONVERSATION = "conversation";
const TARGET_TYPE_DIARY = "diary_entry";

export interface MemoryEmbeddingServiceDeps {
  embeddingsRepo: EmbeddingsRepo;
  conversationSummariesRepo: ConversationSummariesRepo;
  conversationsRepo: ConversationsRepo;
  twinDiaryRepo: TwinDiaryRepo;
  /**
   * Lazy-Resolve auf den Provider. Production: `() => getEmbeddingProvider()`
   * aus der Factory. Tests: Closure auf einen MockEmbeddingProvider.
   */
  getProvider: () => EmbeddingProvider;
}

export interface EmbedSummarySegmentArgs {
  twinId: string;
  segmentId: string;
  content: string;
}

export interface EmbedConversationArgs {
  twinId: string;
  conversationId: string;
  content: string;
}

export interface EmbedDiaryEntryArgs {
  twinId: string;
  diaryEntryId: string;
  content: string;
}

export class MemoryEmbeddingService {
  constructor(private deps: MemoryEmbeddingServiceDeps) {}

  /**
   * Embeddet ein Summary-Segment plus FTS5-Insert, atomar in der Repo-
   * Transaction. Updatet conversation_summaries.embedding_status. Bei
   * Failure: Status auf 'failed', Error geloggt, kein Re-Throw.
   */
  async embedSummarySegment(args: EmbedSummarySegmentArgs): Promise<void> {
    if (!args.content.trim()) {
      console.warn(
        `[memory-embedding] skip empty summary segment ${args.segmentId}`,
      );
      this.deps.conversationSummariesRepo.updateEmbeddingStatus(
        args.segmentId,
        "failed",
      );
      return;
    }
    try {
      const provider = this.deps.getProvider();
      const [vector] = await provider.embed(args.content, {
        inputType: QUERY_PREFIX_INPUT_TYPE,
      });
      if (!vector) throw new Error("Provider returned empty embedding");

      this.deps.embeddingsRepo.insert(
        {
          twinId: args.twinId,
          targetType: TARGET_TYPE_SUMMARY,
          targetId: args.segmentId,
          embeddingModel: provider.modelName,
          embedding: vector,
        },
        { ftsContent: args.content },
      );

      this.deps.conversationSummariesRepo.updateEmbeddingStatus(
        args.segmentId,
        "done",
      );
      console.log(
        `[memory-embedding] summary segment embedded segment=${args.segmentId} model=${provider.modelName}`,
      );
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      console.error(
        `[memory-embedding] summary segment failed segment=${args.segmentId} twin=${args.twinId}: ${reason}`,
      );
      this.deps.conversationSummariesRepo.updateEmbeddingStatus(
        args.segmentId,
        "failed",
      );
    }
  }

  /**
   * Embeddet eine ganze Konversation (Reset-Pfad, nur wenn keine Segments
   * existieren — der Caller prüft das). Updatet conversations.embedding_status.
   */
  async embedConversation(args: EmbedConversationArgs): Promise<void> {
    if (!args.content.trim()) {
      console.warn(
        `[memory-embedding] skip empty conversation ${args.conversationId}`,
      );
      this.deps.conversationsRepo.updateEmbeddingStatus(
        args.conversationId,
        "failed",
      );
      return;
    }
    try {
      const provider = this.deps.getProvider();
      const [vector] = await provider.embed(args.content, {
        inputType: QUERY_PREFIX_INPUT_TYPE,
      });
      if (!vector) throw new Error("Provider returned empty embedding");

      this.deps.embeddingsRepo.insert(
        {
          twinId: args.twinId,
          targetType: TARGET_TYPE_CONVERSATION,
          targetId: args.conversationId,
          embeddingModel: provider.modelName,
          embedding: vector,
        },
        { ftsContent: args.content },
      );

      this.deps.conversationsRepo.updateEmbeddingStatus(
        args.conversationId,
        "done",
      );
      console.log(
        `[memory-embedding] conversation embedded conv=${args.conversationId} model=${provider.modelName}`,
      );
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      console.error(
        `[memory-embedding] conversation failed conv=${args.conversationId} twin=${args.twinId}: ${reason}`,
      );
      this.deps.conversationsRepo.updateEmbeddingStatus(
        args.conversationId,
        "failed",
      );
    }
  }

  /**
   * Embeddet einen Diary-Eintrag. Updatet twin_diary.embedding_status. Wird
   * vom TwinDiaryService nach jedem Insert aufgerufen.
   */
  async embedDiaryEntry(args: EmbedDiaryEntryArgs): Promise<void> {
    if (!args.content.trim()) {
      console.warn(
        `[memory-embedding] skip empty diary entry ${args.diaryEntryId}`,
      );
      this.deps.twinDiaryRepo.updateEmbeddingStatus(
        args.diaryEntryId,
        "failed",
      );
      return;
    }
    try {
      const provider = this.deps.getProvider();
      const [vector] = await provider.embed(args.content, {
        inputType: QUERY_PREFIX_INPUT_TYPE,
      });
      if (!vector) throw new Error("Provider returned empty embedding");

      this.deps.embeddingsRepo.insert(
        {
          twinId: args.twinId,
          targetType: TARGET_TYPE_DIARY,
          targetId: args.diaryEntryId,
          embeddingModel: provider.modelName,
          embedding: vector,
        },
        { ftsContent: args.content },
      );

      this.deps.twinDiaryRepo.updateEmbeddingStatus(args.diaryEntryId, "done");
      console.log(
        `[memory-embedding] diary embedded entry=${args.diaryEntryId} model=${provider.modelName}`,
      );
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      console.error(
        `[memory-embedding] diary failed entry=${args.diaryEntryId} twin=${args.twinId}: ${reason}`,
      );
      this.deps.twinDiaryRepo.updateEmbeddingStatus(
        args.diaryEntryId,
        "failed",
      );
    }
  }
}

// ─── Helper: Konversation aus Audits zu Text aggregieren ────────────────────
//
// Für den Reset-Pfad ohne Summaries: alle "zählenden" Audits einer
// Konversation in einen einfachen Roh-Text mit [user]/[assistant]-Markern
// konkatenieren. E5-Modelle handhaben das Roh-Format gut.
//
// Token-Limit: multilingual-e5-large hat ~512 Tokens. Bei langen
// Konversationen schneidet die Pipeline hinten ab — ein Reset bei <50
// Messages bleibt aber in den meisten Fällen darunter. Falls Real-Data-Test
// zeigt dass das Truncation-Problem akut wird, ist eine LLM-Verdichtung
// (analog Summary-Generation) der Upgrade-Pfad (docs/archive/3.4-STRATEGY.md
// "Open Questions").

const COUNTING_CAPABILITIES_FOR_AGGREGATION = new Set([
  "respond_to_chat",
  "owner-direct",
]);

export function aggregateConversationForEmbedding(
  audits: AuditEntry[],
): string {
  const lines: string[] = [];
  for (const audit of audits) {
    if (!COUNTING_CAPABILITIES_FOR_AGGREGATION.has(audit.capability)) continue;
    const input = audit.input as { lastMessage?: string };
    const output = audit.output as { reply?: string } | null;
    const userText = input.lastMessage?.trim();
    const replyText = output?.reply?.trim();
    if (userText) lines.push(`[user] ${userText}`);
    if (replyText) lines.push(`[assistant] ${replyText}`);
  }
  return lines.join("\n\n");
}
