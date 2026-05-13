import type {
  EmbeddingsRepo,
  EmbeddingTargetType,
  Fts5SearchResult,
  SearchHit,
} from "./embeddings-repo.js";
import type { EmbeddingProvider } from "./providers/index.js";
import { sanitizeForFts5, sanitizedTokenCount } from "./sanitize.js";
import {
  EPISODIC_HYBRID_MIN_VECTOR_SIM,
  EPISODIC_HYBRID_POOL_SIZE,
  EPISODIC_HYBRID_RRF_K,
  EPISODIC_MIN_QUERY_LENGTH,
  EPISODIC_RRF_THRESHOLD,
  EPISODIC_TOP_K,
} from "../config.js";

// ─── MEMORY RETRIEVAL SERVICE (3.4.E + 3.4.I Hybrid) ────────────────────────
//
// Liest-Seite des Episodic-Memory. Im Send-Path vor `runModel` aufgerufen:
//
//   1. User-Message mit E5-Prefix `query: ` embedden
//   2. Parallel: Sanitization → BM25-Search auf `memory_fts`
//   3. Pre-RRF Filter: Vector-Hits unter `EPISODIC_HYBRID_MIN_VECTOR_SIM`
//      kommen gar nicht in den Pool
//   4. Reciprocal Rank Fusion: Score = sum(1/(k+rank)) pro Source
//   5. Post-RRF Filter: Items unter `EPISODIC_RRF_THRESHOLD` weg
//   6. Same-Conv-Filter (laufende Konv + ihre Summary-Segments)
//   7. Top-K, Content aus `memory_fts` hydratisieren, Access tracken
//
// Failure-Pfad: `[]` (geloggt, kein Throw). Send-Path läuft weiter.
//
// Min-Query-Length: sehr kurze Messages ("hi", "ok") triggern keinen
// Retrieval-Call überhaupt (Performance + Relevanz).
// Min-FTS5-Token: bei <2 Tokens nach Sanitization wird FTS5-Pfad
// übersprungen, nur Vector — eine 1-Wort-Query trifft FTS5 zu breit.
//
// Vector-Score-Mapping: bei L2-Distanz auf normalisierten E5-Vektoren gilt
// `cosine_sim = 1 - distance/2`. Im Repo.search-Call lassen wir den
// internen Threshold aus (übergeben 0), weil unser Pre-RRF-Filter den
// Job präziser macht — `EPISODIC_HYBRID_MIN_VECTOR_SIM` ist die echte
// Untergrenze.

export interface RetrievalResult {
  embeddingId: string;
  targetType: EmbeddingTargetType;
  targetId: string;
  content: string;
  /** RRF-Score nach Merge — sortier-relevant für den Caller. */
  rrfScore: number;
  /** Cosine-Sim aus dem Vector-Hit, falls vorhanden (nur Vector-Source). */
  vectorSimilarity?: number;
  /** 1-indexed Vector-Rang im Pre-RRF-Pool, falls vorhanden. */
  vectorRank?: number;
  /** 1-indexed BM25-Rang im Pre-RRF-Pool, falls vorhanden. */
  bm25Rank?: number;
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
   * `summary_segment`-Embeddings aus dem Result raus.
   */
  excludeSummarySegmentIds?: string[];
  /** Optional Override; sonst `EPISODIC_TOP_K` aus ENV / Default 3. */
  topK?: number;
  /** Optional Override; sonst `EPISODIC_RRF_THRESHOLD` aus ENV / 0.015. */
  rrfThreshold?: number;
  /**
   * Optional Override; sonst `EPISODIC_HYBRID_MIN_VECTOR_SIM` aus ENV / 0.5.
   * Vector-Hits unter dieser Cosine-Sim kommen nicht in den RRF-Pool.
   */
  minVectorSimilarity?: number;
}

export interface MemoryRetrievalServiceDeps {
  embeddingsRepo: EmbeddingsRepo;
  /**
   * Lazy-Provider-Resolve. Production: `() => getEmbeddingProvider()`.
   * Tests: Closure auf einen MockEmbeddingProvider.
   */
  getProvider: () => EmbeddingProvider;
}

interface MergedHit {
  embeddingId: string;
  targetType: EmbeddingTargetType;
  targetId: string;
  rrfScore: number;
  vectorRank?: number;
  vectorSimilarity?: number;
  bm25Rank?: number;
}

export class MemoryRetrievalService {
  constructor(private deps: MemoryRetrievalServiceDeps) {}

  async retrieve(args: RetrieveArgs): Promise<RetrievalResult[]> {
    const topK = args.topK ?? EPISODIC_TOP_K;
    const rrfThreshold = args.rrfThreshold ?? EPISODIC_RRF_THRESHOLD;
    const minVectorSim =
      args.minVectorSimilarity ?? EPISODIC_HYBRID_MIN_VECTOR_SIM;
    const poolSize = EPISODIC_HYBRID_POOL_SIZE;
    const rrfK = EPISODIC_HYBRID_RRF_K;

    const trimmed = args.userMessage.trim();
    if (trimmed.length < EPISODIC_MIN_QUERY_LENGTH) {
      // Trivial-Input: kein Retrieval, kein Log-Spam.
      return [];
    }

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

      // Parallel-Searches. Beide sind synchron-SQL, der Provider-Call ist
      // schon erledigt — Promise.all spart konzeptionell, kein I/O-Gewinn.
      const sanitized = sanitizeForFts5(trimmed);
      const tokenCount = sanitizedTokenCount(trimmed);
      const fts5Enabled = tokenCount >= 2;

      const [vectorHitsRaw, fts5Hits] = await Promise.all([
        Promise.resolve(
          this.deps.embeddingsRepo.search(args.twinId, queryVector, {
            topK: poolSize,
            // Pre-RRF-Filter erledigt das Threshold-Geschäft präziser.
            similarityThreshold: 0,
            embeddingModel: provider.modelName,
          }),
        ),
        Promise.resolve(
          fts5Enabled
            ? this.deps.embeddingsRepo.searchFts5(args.twinId, sanitized, {
                topK: poolSize,
                embeddingModel: provider.modelName,
              })
            : ([] as Fts5SearchResult[]),
        ),
      ]);

      // Pre-RRF: Vector-Hits unter Min-Sim raus, Rang im gefilterten
      // Pool vergeben (1-indexed).
      const vectorRanked = filterVectorHits(vectorHitsRaw, minVectorSim);

      const merged = rrfMerge(vectorRanked, fts5Hits, rrfK);

      // Post-RRF Threshold + Same-Conv-Filter
      const excludeSegmentIds = new Set(args.excludeSummarySegmentIds ?? []);
      const excludeConvId = args.currentConversationId ?? null;
      const candidates = merged.filter((m) => {
        if (m.rrfScore < rrfThreshold) return false;
        if (
          m.targetType === "conversation" &&
          excludeConvId &&
          m.targetId === excludeConvId
        ) {
          return false;
        }
        if (
          m.targetType === "summary_segment" &&
          excludeSegmentIds.has(m.targetId)
        ) {
          return false;
        }
        return true;
      });

      const results: RetrievalResult[] = [];
      for (const item of candidates) {
        if (results.length >= topK) break;
        const content = this.deps.embeddingsRepo.getFtsContent(
          args.twinId,
          item.targetType,
          item.targetId,
        );
        if (!content || !content.trim()) {
          // Embedding ohne FTS-Eintrag (Test-Daten, alter Bestand vor
          // 3.4.D-FTS-Pflicht). Ohne Klartext kein Prompt-Block.
          continue;
        }
        results.push({
          embeddingId: item.embeddingId,
          targetType: item.targetType,
          targetId: item.targetId,
          content,
          rrfScore: item.rrfScore,
          vectorSimilarity: item.vectorSimilarity,
          vectorRank: item.vectorRank,
          bm25Rank: item.bm25Rank,
        });
        this.deps.embeddingsRepo.incrementAccess(item.embeddingId);
      }

      if (results.length > 0) {
        const top = results[0]!;
        console.log(
          `[memory-retrieval] twin=${args.twinId} returned ${results.length} hit(s), ` +
            `top-rrf=${top.rrfScore.toFixed(4)} ` +
            `(vec-rank=${top.vectorRank ?? "—"} vec-sim=${top.vectorSimilarity?.toFixed(3) ?? "—"} ` +
            `bm25-rank=${top.bm25Rank ?? "—"}) ` +
            `fts5=${fts5Enabled ? "on" : "skip"}`,
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

// ─── intern: Pre-RRF Vector-Filter ────────────────────────────────────────

function filterVectorHits(
  hits: SearchHit[],
  minSim: number,
): Array<{
  embeddingId: string;
  targetType: EmbeddingTargetType;
  targetId: string;
  similarity: number;
  rank: number;
}> {
  const ranked: Array<{
    embeddingId: string;
    targetType: EmbeddingTargetType;
    targetId: string;
    similarity: number;
    rank: number;
  }> = [];
  let rank = 1;
  for (const hit of hits) {
    if (hit.similarity < minSim) continue;
    ranked.push({
      embeddingId: hit.record.id,
      targetType: hit.record.targetType,
      targetId: hit.record.targetId,
      similarity: hit.similarity,
      rank: rank++,
    });
  }
  return ranked;
}

// ─── intern: Reciprocal Rank Fusion ──────────────────────────────────────
//
// Items, die in beiden Sources auftauchen, bekommen den Score aus beiden
// addiert — implicit-Boost gegen Halluzinations-Risiko (Token-Overlap-Hits
// ohne semantischen Match bleiben Single-Source und werden niedriger
// gerankt). Items in nur einer Source kriegen für die fehlende Source
// Score-Beitrag 0 — Verworfen wurde "strict mode" (nur beide), weil das
// semantische Fall-A-Hits kosten würde.

export function rrfMerge(
  vector: Array<{
    embeddingId: string;
    targetType: EmbeddingTargetType;
    targetId: string;
    similarity: number;
    rank: number;
  }>,
  fts5: Fts5SearchResult[],
  k: number,
): MergedHit[] {
  const merged = new Map<string, MergedHit>();
  for (const v of vector) {
    merged.set(v.embeddingId, {
      embeddingId: v.embeddingId,
      targetType: v.targetType,
      targetId: v.targetId,
      rrfScore: 1 / (k + v.rank),
      vectorRank: v.rank,
      vectorSimilarity: v.similarity,
    });
  }
  for (const f of fts5) {
    const contrib = 1 / (k + f.rank);
    const existing = merged.get(f.embeddingId);
    if (existing) {
      existing.rrfScore += contrib;
      existing.bm25Rank = f.rank;
    } else {
      merged.set(f.embeddingId, {
        embeddingId: f.embeddingId,
        targetType: f.targetType,
        targetId: f.targetId,
        rrfScore: contrib,
        bm25Rank: f.rank,
      });
    }
  }
  return Array.from(merged.values()).sort((a, b) => b.rrfScore - a.rrfScore);
}
