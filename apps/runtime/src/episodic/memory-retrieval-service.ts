import type {
  EmbeddingsRepo,
  EmbeddingTargetType,
} from "./embeddings-repo.js";
import type { EmbeddingProvider } from "./providers/index.js";
import {
  EPISODIC_MIN_QUERY_LENGTH,
  EPISODIC_SIMILARITY_THRESHOLD,
  EPISODIC_TOP_K,
} from "../config.js";

// ─── MEMORY RETRIEVAL SERVICE (3.4.E) ───────────────────────────────────────
//
// Liest-Seite des Episodic-Memory. Wird im Send-Path vor `runModel`
// aufgerufen: User-Message wird mit E5-Prefix `query: ` embedded, dann KNN
// gegen `embeddings_vec`, dann Threshold-Filter, dann Content aus
// `memory_fts` geholt. Bei Failure → leeres Array (geloggt, kein Throw),
// damit der Send-Path normal weiterläuft.
//
// Filter-Logik (Briefing 3.4.E "Same-Conversation-Filter"):
//   - Embeddings der aktuell laufenden Konversation werden ausgefiltert.
//     Die Live-Window-Audits + Summary-Block decken sie bereits ab; ein
//     erneutes Anbieten als "Erinnerung" wäre Redundanz und würde Twin
//     verwirren.
//   - Konkret: target_type='conversation' mit target_id === currentConvId
//     plus target_type='summary_segment' mit target_id ∈ aktuelle
//     Summary-Segment-IDs.
//
// Pool-Vergrößerung: wir holen `topK + 3` Hits aus dem Repo, weil der
// Same-Conv-Filter im worst case mehrere Items wegfiltern könnte. Dann auf
// `topK` slicen. Konsistent mit dem `topK * 3`-Pool im EmbeddingsRepo
// selbst (der filtert auf twin_id + embedding_model).
//
// Min-Query-Length: sehr kurze Messages ("hi", "ok") sind semantisch
// unterspezifiziert — ein Embedding davon trifft beliebige Themen. Wir
// skippen Retrieval für Inputs unter `EPISODIC_MIN_QUERY_LENGTH` Zeichen
// (Default 10). Spart einen Provider-Call pro Trivial-Send und vermeidet
// irrelevante "Erinnerungen".

export interface RetrievalResult {
  embeddingId: string;
  targetType: EmbeddingTargetType;
  targetId: string;
  content: string;
  distance: number;
  similarity: number;
}

export interface RetrieveArgs {
  twinId: string;
  userMessage: string;
  /**
   * Aktuelle Konversation — wird im Same-Conv-Filter ausgeschlossen. Bei
   * `null` (z.B. Bridge-Pfad ohne aktive Direct-Konversation) findet kein
   * Filter statt.
   */
  currentConversationId?: string | null;
  /**
   * Summary-Segment-IDs der aktuellen Konversation. Schließt die zugehörigen
   * `summary_segment`-Embeddings aus dem Result raus. Leer/undefined wenn
   * die Konversation noch keine Segments hat.
   */
  excludeSummarySegmentIds?: string[];
  /** Optional Override; sonst aus ENV / Default 3. */
  topK?: number;
  /** Optional Override; sonst aus ENV / Default 0.7. */
  similarityThreshold?: number;
}

export interface MemoryRetrievalServiceDeps {
  embeddingsRepo: EmbeddingsRepo;
  /**
   * Lazy-Provider-Resolve. Production: `() => getEmbeddingProvider()`.
   * Tests: Closure auf einen MockEmbeddingProvider. Spiegelbild des
   * Patterns aus MemoryEmbeddingService.
   */
  getProvider: () => EmbeddingProvider;
}

export class MemoryRetrievalService {
  constructor(private deps: MemoryRetrievalServiceDeps) {}

  async retrieve(args: RetrieveArgs): Promise<RetrievalResult[]> {
    const topK = args.topK ?? EPISODIC_TOP_K;
    const threshold = args.similarityThreshold ?? EPISODIC_SIMILARITY_THRESHOLD;
    const trimmed = args.userMessage.trim();

    if (trimmed.length < EPISODIC_MIN_QUERY_LENGTH) {
      // Kein Throw, kein Log-Spam — der frühe Return ist ein Erfolgs-Pfad
      // (Trivial-Inputs sollen explizit kein Retrieval triggern).
      return [];
    }

    const excludeSegmentIds = new Set(args.excludeSummarySegmentIds ?? []);
    const excludeConvId = args.currentConversationId ?? null;

    try {
      const provider = this.deps.getProvider();
      const [queryVector] = await provider.embed(trimmed, {
        inputType: "query",
      });
      if (!queryVector) {
        console.warn(
          `[memory-retrieval] provider returned empty embedding for twin=${args.twinId}`,
        );
        return [];
      }

      // Pool-Vergrößerung um die Same-Conv-Filter-Verluste auszugleichen.
      const poolSize = topK + 3;
      const searchResults = this.deps.embeddingsRepo.search(
        args.twinId,
        queryVector,
        {
          topK: poolSize,
          similarityThreshold: threshold,
          embeddingModel: provider.modelName,
        },
      );

      const results: RetrievalResult[] = [];
      for (const hit of searchResults) {
        if (results.length >= topK) break;

        // Same-Conv-Filter
        if (
          hit.record.targetType === "conversation" &&
          excludeConvId &&
          hit.record.targetId === excludeConvId
        ) {
          continue;
        }
        if (
          hit.record.targetType === "summary_segment" &&
          excludeSegmentIds.has(hit.record.targetId)
        ) {
          continue;
        }

        const content = this.deps.embeddingsRepo.getFtsContent(
          args.twinId,
          hit.record.targetType,
          hit.record.targetId,
        );
        if (!content || !content.trim()) {
          // Embedding ohne FTS-Eintrag (z.B. 3.4.A-Test-Daten oder ein
          // alter Bestand vor FTS5-Pflicht). Wir können keinen Prompt-Block
          // bauen ohne den Klartext, also überspringen.
          continue;
        }

        results.push({
          embeddingId: hit.record.id,
          targetType: hit.record.targetType,
          targetId: hit.record.targetId,
          content,
          distance: hit.distance,
          similarity: hit.similarity,
        });

        // Access-Tracking erst NACH Filter — wenn wir ein Item ausgefiltert
        // haben (Same-Conv), wäre ein Inkrement irreführend.
        this.deps.embeddingsRepo.incrementAccess(hit.record.id);
      }

      if (results.length > 0) {
        console.log(
          `[memory-retrieval] twin=${args.twinId} returned ${results.length} hit(s), ` +
            `top-sim=${results[0]?.similarity.toFixed(3)}`,
        );
      }
      return results;
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      console.error(
        `[memory-retrieval] failed for twin=${args.twinId}: ${reason}`,
      );
      return [];
    }
  }
}
