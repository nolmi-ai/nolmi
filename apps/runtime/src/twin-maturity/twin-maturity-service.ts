import type Database from "better-sqlite3";
import {
  MATURITY_LEVEL_LABELS,
  type DimensionLevels,
  type MaturityLevel,
  type MaturityResult,
  type MissingDimension,
  type ProgressToNext,
  type TwinStats,
} from "@twin-lab/shared";
import type { EmbeddingsRepo } from "../episodic/embeddings-repo.js";
import type { FactsRepo } from "../facts/repo.js";

// ─── TWIN-REIFE-SERVICE (#101) ───────────────────────────────────────────────
//
// Vier-Dimensionen-Heuristik. Die Schwellen sind hier hartkodiert — eine
// User-Pro-Twin-Kalibrierung wäre eigenes Item (Anti-Goal). Greedy-Cosine-
// Bucketing für Themen-Vielfalt: O(n²) im Worst Case, bei > MAX_TOPIC_EMBEDDINGS
// nehmen wir nur die jüngsten N Embeddings (chronologische Slice nach unten
// im Repo-Output).
//
// On-Demand-Berechnung: kein Cache, kein Background-Job. `computeMaturity()`
// läuft bei jedem API-Call; bei vielen Embeddings dominiert das Clustering die
// Latenz — falls das schmerzt, später Cache-Layer mit (twinId → MaturityResult)
// und Invalidierung beim Insert in `embeddings`/`facts`/`conversations`.

// Cosine-Similarity-Threshold für Topic-Cluster-Analyse.
// Conversation-Embeddings sind semantisch sehr dicht (gemeinsamer Twin-
// Domain-Kontext, viele Konvs sind Variationen desselben Themas).
// 0.85 empirisch kalibriert mit Pilot-Daten (@markus, 39 Konvs Tag 18):
//   - 0.7  → 1 Cluster (zu lax)
//   - 0.8  → 2 Cluster (zu lax)
//   - 0.85 → erwartet 4-6 Cluster
// Spätere Re-Kalibrierung mit Diversität-Daten von Phase-B-Usern.
const COSINE_THRESHOLD = 0.85;
const MAX_TOPIC_EMBEDDINGS = 500;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Pro Dimension: [stufe1Min, stufe2Min, stufe3Min].
 *
 * Topics-Schwellen [2, 5, 12] kalibriert mit Pilot-Daten Tag 18: aktive
 * Pilot-Twins haben weniger distinkte Topics als initial geschätzt — viele
 * Konvs sind Variationen desselben Themas. Vorherige [3, 8, 20] waren ohne
 * Daten-Grundlage gesetzt. Re-Kalibrierung mit Phase-B-Usern später.
 */
const THRESHOLDS = {
  conversation: [10, 50, 200] as const,
  facts: [5, 15, 50] as const,
  topics: [2, 5, 12] as const,
  span: [7, 30, 180] as const,
} satisfies Record<"conversation" | "facts" | "topics" | "span", readonly [number, number, number]>;

const DIMENSION_NOUN: Record<keyof typeof THRESHOLDS, string> = {
  conversation: "Konversationen",
  facts: "Facts",
  topics: "verschiedene Themen",
  span: "Tage",
};

export interface TwinMaturityDeps {
  db: Database.Database;
  embeddingsRepo: EmbeddingsRepo;
  factsRepo: FactsRepo;
}

export class TwinMaturityService {
  constructor(private deps: TwinMaturityDeps) {}

  async computeMaturity(twinId: string): Promise<MaturityResult> {
    const stats = await this.computeStats(twinId);
    const dimensionLevels = computeDimensionLevels(stats);
    const currentLevel = computeCurrentLevel(dimensionLevels);
    const progressToNext = computeProgress(currentLevel, stats);
    return {
      currentLevel,
      currentLabel: MATURITY_LEVEL_LABELS[currentLevel],
      stats,
      dimensionLevels,
      progressToNext,
    };
  }

  private async computeStats(twinId: string): Promise<TwinStats> {
    const conversationCount = this.countConversations(twinId);
    const factsCount = this.deps.factsRepo
      .listByTwin(twinId, { onlyApproved: true })
      .length;
    const firstConvAt = this.firstConvAt(twinId);
    const daysSinceFirst = firstConvAt
      ? Math.max(0, Math.floor((Date.now() - new Date(firstConvAt).getTime()) / MS_PER_DAY))
      : 0;
    const topicCount = this.computeTopicCount(twinId);
    return {
      conversationCount,
      factsCount,
      topicCount,
      firstConvAt,
      daysSinceFirst,
    };
  }

  private countConversations(twinId: string): number {
    const row = this.deps.db
      .prepare("SELECT COUNT(*) AS c FROM conversations WHERE twin_id = ?")
      .get(twinId) as { c: number } | undefined;
    return row?.c ?? 0;
  }

  /**
   * Ältestes Chat-Audit (respond_to_chat | owner-direct). Bridge-Replies oder
   * System-Capabilities zählen nicht — Twin-Reife misst, wie lange der Owner
   * mit seinem Twin gesprochen hat, nicht jeden Tool-Use.
   */
  private firstConvAt(twinId: string): string | null {
    const row = this.deps.db
      .prepare(
        `SELECT MIN(timestamp) AS first FROM audit
           WHERE twin_id = ?
             AND capability IN ('respond_to_chat', 'owner-direct')`,
      )
      .get(twinId) as { first: string | null } | undefined;
    return row?.first ?? null;
  }

  /**
   * Greedy Cosine-Bucketing über conversation-Embeddings. Erstes Embedding
   * jedes Clusters fungiert als Centroid (Repräsentant). Reihenfolge der
   * Iteration ist chronologisch (älteste zuerst, via `listByTwin`-ORDER BY),
   * was bei n > MAX_TOPIC_EMBEDDINGS auf die jüngsten Embeddings beschränkt
   * wird — neuere Themen sollen frühere Drift-Themen nicht überstimmen.
   *
   * Wir clustern conversation-Embeddings (nicht summary_segment):
   * - jede beendete Konversation wird seit 3.4.D als Ganzes embedded
   * - summary_segments entstehen erst bei Konvs > CONVERSATION_SUMMARY_THRESHOLD
   *   Messages (Default 50), in der Pilot-Phase fast nie
   * - eine Konversation entspricht semantisch meist einem Thema, ähnliche
   *   Konvs landen im selben Cluster
   * - Future: sobald Long-Form-Konvs häufig sind, `listByTwin(twinId)` ohne
   *   targetType-Filter + auf {conversation, summary_segment} clustern, um
   *   die feinere Segment-Auflösung mitzunehmen.
   */
  private computeTopicCount(twinId: string): number {
    const all = this.deps.embeddingsRepo.listByTwin(twinId, "conversation");
    if (all.length === 0) return 0;
    const embeddings =
      all.length > MAX_TOPIC_EMBEDDINGS
        ? all.slice(all.length - MAX_TOPIC_EMBEDDINGS)
        : all;

    const centroids: Float32Array[] = [];
    for (const emb of embeddings) {
      let assigned = false;
      for (const centroid of centroids) {
        if (cosineSimilarity(emb.embedding, centroid) >= COSINE_THRESHOLD) {
          assigned = true;
          break;
        }
      }
      if (!assigned) centroids.push(emb.embedding);
    }
    return centroids.length;
  }
}

// ─── REINE BERECHNUNGS-HELPER ────────────────────────────────────────────────

function levelFromThresholds(
  value: number,
  thresholds: readonly [number, number, number],
): MaturityLevel {
  if (value >= thresholds[2]) return 3;
  if (value >= thresholds[1]) return 2;
  if (value >= thresholds[0]) return 1;
  return 0;
}

function computeDimensionLevels(stats: TwinStats): DimensionLevels {
  return {
    conversation: levelFromThresholds(stats.conversationCount, THRESHOLDS.conversation),
    facts: levelFromThresholds(stats.factsCount, THRESHOLDS.facts),
    topics: levelFromThresholds(stats.topicCount, THRESHOLDS.topics),
    span: levelFromThresholds(stats.daysSinceFirst, THRESHOLDS.span),
  };
}

function computeCurrentLevel(dimensions: DimensionLevels): MaturityLevel {
  const values = [
    dimensions.conversation,
    dimensions.facts,
    dimensions.topics,
    dimensions.span,
  ];
  // 3-von-4-Regel: höchste Stufe, auf der drei oder mehr Dimensionen liegen.
  for (let target = 3; target >= 0; target--) {
    const count = values.filter((d) => d >= target).length;
    if (count >= 3) return target as MaturityLevel;
  }
  return 0;
}

function computeProgress(
  currentLevel: MaturityLevel,
  stats: TwinStats,
): ProgressToNext | null {
  if (currentLevel === 3) return null;
  const targetLevel = (currentLevel + 1) as MaturityLevel;
  const targetLabel = MATURITY_LEVEL_LABELS[targetLevel];

  const targetThresholds = {
    conversation: THRESHOLDS.conversation[currentLevel],
    facts: THRESHOLDS.facts[currentLevel],
    topics: THRESHOLDS.topics[currentLevel],
    span: THRESHOLDS.span[currentLevel],
  } as const;

  const currentValues = {
    conversation: stats.conversationCount,
    facts: stats.factsCount,
    topics: stats.topicCount,
    span: stats.daysSinceFirst,
  } as const;

  const missing: MissingDimension[] = [];
  for (const dim of ["conversation", "facts", "topics", "span"] as const) {
    const current = currentValues[dim];
    const needed = targetThresholds[dim];
    if (current < needed) {
      const delta = needed - current;
      missing.push({
        dimension: dim,
        current,
        needed,
        label: `Noch ${delta} ${DIMENSION_NOUN[dim]} für ${targetLabel}`,
      });
    }
  }

  // Pro Dimension den Fortschritt zur Target-Schwelle berechnen (gedeckelt
  // bei 100). Mittelwert ergibt den Aggregate-Progress — bewusst nicht
  // gewichtet, weil die 3-von-4-Regel die Differenzierung schon trägt.
  const percentPerDim = [
    capPercent(stats.conversationCount, targetThresholds.conversation),
    capPercent(stats.factsCount, targetThresholds.facts),
    capPercent(stats.topicCount, targetThresholds.topics),
    capPercent(stats.daysSinceFirst, targetThresholds.span),
  ];
  const percent = Math.round(
    percentPerDim.reduce((a, b) => a + b, 0) / percentPerDim.length,
  );

  return {
    targetLevel,
    targetLabel,
    percent,
    missingDimensions: missing,
  };
}

function capPercent(current: number, target: number): number {
  if (target <= 0) return 100;
  return Math.min(100, (current / target) * 100);
}

function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    // i ist strikt < a.length und a.length === b.length, daher safe.
    const av = a[i]!;
    const bv = b[i]!;
    dot += av * bv;
    normA += av * av;
    normB += bv * bv;
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  if (denom === 0) return 0;
  return dot / denom;
}
