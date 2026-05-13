import "dotenv/config";
import Database from "better-sqlite3";
import * as sqliteVec from "sqlite-vec";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { nanoid } from "nanoid";
import { loadRuntimeConfig } from "../config.js";
import { EmbeddingsRepo } from "../episodic/embeddings-repo.js";
import {
  MemoryRetrievalService,
  rrfMerge,
} from "../episodic/memory-retrieval-service.js";
import {
  sanitizeForFts5,
  sanitizedTokenCount,
} from "../episodic/sanitize.js";
import type {
  EmbeddingProvider,
  EmbedOptions,
} from "../episodic/providers/index.js";

// ─── TEST: HYBRID-RETRIEVAL (Phase 3.4 Sub-Schritt I) ───────────────────────
//
// Mock-Tests für Sanitization, FTS5-Search, RRF-Merge plus die Hybrid-
// Retrieval-Pipeline (Pre-RRF Filter, Post-RRF Threshold, FTS5-Skip).
// Live-E5-Vergleich am Ende (TWIN_LAB_RUN_LOCAL_RETRIEVAL_TEST=1) misst
// das Anna-Beispiel aus 3.4.E gegen den Hybrid-Pfad.

const EMBEDDING_DIM = 1024;
const MOCK_MODEL = "mock-hybrid";

class DeterministicMockProvider implements EmbeddingProvider {
  readonly modelName = MOCK_MODEL;
  readonly dimensions = EMBEDDING_DIM;
  private anchors: Array<{ marker: string; vec: Float32Array }> = [];
  registerAnchor(marker: string, vec: Float32Array) {
    this.anchors.push({ marker, vec });
  }
  async embed(
    texts: string | string[],
    _opts: EmbedOptions,
  ): Promise<Float32Array[]> {
    const arr = Array.isArray(texts) ? texts : [texts];
    return arr.map((t) => {
      for (const a of this.anchors) {
        if (t.includes(a.marker)) return a.vec;
      }
      return makeNormalizedVector(EMBEDDING_DIM);
    });
  }
  async isReady() {
    return true;
  }
}

async function main() {
  let issues = 0;

  // Phase 1 — pure Helper-Tests, kein DB-Bedarf
  issues += runSanitizationTests();
  issues += runRrfUnitTests();

  // Phase 2 — DB-basierte Tests gegen :memory:
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
  const twinA = createTwinProfile(db, userId, "@_hybrid-a");
  log(`Fixtures: twin=${twinA}`);

  const embeddingsRepo = new EmbeddingsRepo(db);
  const provider = new DeterministicMockProvider();
  const service = new MemoryRetrievalService({
    embeddingsRepo,
    getProvider: () => provider,
  });

  issues += runFts5SearchTest(embeddingsRepo, twinA);
  issues += await runHybridHappyPathTest(
    embeddingsRepo,
    service,
    provider,
    twinA,
  );
  issues += await runPostRrfThresholdTest(
    embeddingsRepo,
    service,
    provider,
    twinA,
  );
  issues += await runFts5SkipShortQueryTest(
    embeddingsRepo,
    service,
    provider,
    twinA,
  );
  issues += await runBayreuthAnalogueTest(
    embeddingsRepo,
    service,
    provider,
    twinA,
  );

  db.close();

  // Phase 3 — Live-E5-Vergleich (optional)
  if (process.env.TWIN_LAB_RUN_LOCAL_RETRIEVAL_TEST === "1") {
    issues += await runLiveAnnaTest();
  } else {
    log(
      "\n⊘ Live-Anna-Test übersprungen (TWIN_LAB_RUN_LOCAL_RETRIEVAL_TEST!=1)",
    );
  }

  banner("ZUSAMMENFASSUNG");
  if (issues === 0) {
    log("✓ alle Tests grün");
  } else {
    log(`✗ ${issues} Issue(s) — siehe oben`);
    process.exit(2);
  }
}

// ─── TEST 1: Sanitization-Helper ────────────────────────────────────────────

function runSanitizationTests(): number {
  banner("TEST 1 — sanitizeForFts5 + sanitizedTokenCount");
  let issues = 0;
  const cases: Array<[string, string]> = [
    ["Workshop-Vertrag", "Workshop Vertrag"],
    ["Markus' Bayreuth-Reise?", "Markus Bayreuth Reise"],
    ["@florian, was meinst du?", "florian was meinst du"],
    ['Sie sagte: "Anna ist meine Frau".', "Sie sagte Anna ist meine Frau"],
    ["", ""],
    ["   ", ""],
    ["-?!*", ""],
    ["Hallo", "Hallo"],
  ];
  for (const [input, expected] of cases) {
    const got = sanitizeForFts5(input);
    if (got !== expected) {
      issues += 1;
      log(`  ⚠ ${JSON.stringify(input)} → ${JSON.stringify(got)} (erwartet ${JSON.stringify(expected)})`);
    }
  }
  if (sanitizedTokenCount("") !== 0) {
    issues += 1;
    log("  ⚠ tokenCount('') sollte 0 sein");
  }
  if (sanitizedTokenCount("-?!*") !== 0) {
    issues += 1;
    log("  ⚠ tokenCount('-?!*') sollte 0 sein nach Sanitization");
  }
  if (sanitizedTokenCount("Hallo") !== 1) {
    issues += 1;
    log("  ⚠ tokenCount('Hallo') sollte 1 sein");
  }
  if (sanitizedTokenCount("Workshop-Vertrag") !== 2) {
    issues += 1;
    log("  ⚠ tokenCount('Workshop-Vertrag') sollte 2 sein");
  }
  if (issues === 0) log("  sanitization ✓ (8 Strings + 4 Token-Counts)");
  return issues;
}

// ─── TEST 2: RRF-Merge Unit-Tests ───────────────────────────────────────────

function runRrfUnitTests(): number {
  banner("TEST 2 — rrfMerge Score-Berechnung + Edge-Cases");
  let issues = 0;
  const k = 60;

  // Szenario A: Item in beiden Sources → höchster Score
  // Szenario B: Item nur in Vector → kleinerer Score
  // Szenario C: Item nur in FTS5 → kleinerer Score
  const vector = [
    {
      embeddingId: "both",
      targetType: "conversation" as const,
      targetId: "t-both",
      similarity: 0.9,
      rank: 1,
    },
    {
      embeddingId: "vec-only",
      targetType: "conversation" as const,
      targetId: "t-vec",
      similarity: 0.8,
      rank: 2,
    },
  ];
  const fts5 = [
    {
      embeddingId: "both",
      targetType: "conversation" as const,
      targetId: "t-both",
      bm25Score: -2.1,
      rank: 1,
    },
    {
      embeddingId: "fts-only",
      targetType: "diary_entry" as const,
      targetId: "t-fts",
      bm25Score: -1.5,
      rank: 2,
    },
  ];
  const merged = rrfMerge(vector, fts5, k);
  if (merged.length !== 3) {
    issues += 1;
    log(`  ⚠ merge.length=${merged.length}, erwartet 3`);
  }
  // Top sollte "both" sein
  if (merged[0]?.embeddingId !== "both") {
    issues += 1;
    log(`  ⚠ Top sollte "both" sein, war "${merged[0]?.embeddingId}"`);
  }
  // Score von "both" = 1/61 + 1/61 ≈ 0.0328
  const bothExpected = 1 / (k + 1) + 1 / (k + 1);
  if (Math.abs((merged[0]?.rrfScore ?? 0) - bothExpected) > 1e-6) {
    issues += 1;
    log(
      `  ⚠ "both"-Score: ${merged[0]?.rrfScore}, erwartet ${bothExpected.toFixed(6)}`,
    );
  }
  // Vector-only und FTS5-only haben jeweils ~1/62 ≈ 0.0161
  const vecOnly = merged.find((m) => m.embeddingId === "vec-only");
  const ftsOnly = merged.find((m) => m.embeddingId === "fts-only");
  if (!vecOnly || !vecOnly.bm25Rank === undefined) {
    /* vec-only sollte keinen bm25Rank haben — Map-default */
  }
  if (vecOnly?.bm25Rank !== undefined) {
    issues += 1;
    log("  ⚠ vec-only sollte bm25Rank=undefined haben");
  }
  if (ftsOnly?.vectorRank !== undefined) {
    issues += 1;
    log("  ⚠ fts-only sollte vectorRank=undefined haben");
  }

  // Edge-Case: beide Sources leer → []
  if (rrfMerge([], [], k).length !== 0) {
    issues += 1;
    log("  ⚠ leerer Merge sollte [] liefern");
  }

  // Edge-Case: nur Vector
  const onlyVec = rrfMerge(vector, [], k);
  if (onlyVec.length !== 2 || onlyVec[0]?.embeddingId !== "both") {
    issues += 1;
    log("  ⚠ Vector-only-Merge unerwartet");
  }

  if (issues === 0) log("  RRF-Merge ✓ (both > single, Edge-Cases sauber)");
  return issues;
}

// ─── TEST 3: searchFts5 direkt ──────────────────────────────────────────────

function runFts5SearchTest(repo: EmbeddingsRepo, twinId: string): number {
  banner("TEST 3 — searchFts5 BM25-Rank + Multi-Tenant- und Modell-Filter");
  let issues = 0;
  // Drei Einträge mit unterschiedlicher Token-Dichte
  repo.insert(
    {
      twinId,
      targetType: "diary_entry",
      targetId: "fts-high",
      embeddingModel: MOCK_MODEL,
      embedding: makeNormalizedVector(EMBEDDING_DIM),
    },
    { ftsContent: "Workshop Workshop Workshop Vertrag Vertrag in München" },
  );
  repo.insert(
    {
      twinId,
      targetType: "diary_entry",
      targetId: "fts-mid",
      embeddingModel: MOCK_MODEL,
      embedding: makeNormalizedVector(EMBEDDING_DIM),
    },
    { ftsContent: "Workshop Vertrag in München" },
  );
  repo.insert(
    {
      twinId,
      targetType: "diary_entry",
      targetId: "fts-low",
      embeddingModel: MOCK_MODEL,
      embedding: makeNormalizedVector(EMBEDDING_DIM),
    },
    { ftsContent: "Eine andere Notiz ohne Treffer-Tokens." },
  );

  const hits = repo.searchFts5(twinId, "Workshop Vertrag", {
    topK: 5,
    embeddingModel: MOCK_MODEL,
  });
  if (hits.length < 2) {
    issues += 1;
    log(`  ⚠ Erwartet ≥2 Hits, got ${hits.length}`);
  }
  // BM25 negativ — kleiner = besser. Sortierung ASC.
  if (
    hits.length >= 2 &&
    hits[0] &&
    hits[1] &&
    hits[0].bm25Score > hits[1].bm25Score
  ) {
    issues += 1;
    log("  ⚠ BM25-Sortierung gebrochen (top sollte kleinster Score sein)");
  }
  // Erstes Item sollte mehr Tokens-Hits haben → besser ranked
  if (hits[0]?.targetId !== "fts-high") {
    issues += 1;
    log(`  ⚠ Top-1 sollte fts-high sein, war ${hits[0]?.targetId}`);
  }
  // Modell-Filter: andere Modell-Hit darf nicht reinkommen
  repo.insert(
    {
      twinId,
      targetType: "diary_entry",
      targetId: "fts-other-model",
      embeddingModel: "other-model",
      embedding: makeNormalizedVector(EMBEDDING_DIM),
    },
    { ftsContent: "Workshop Workshop Workshop noch mehr Workshop Vertrag" },
  );
  const hitsFiltered = repo.searchFts5(twinId, "Workshop Vertrag", {
    topK: 10,
    embeddingModel: MOCK_MODEL,
  });
  if (hitsFiltered.some((h) => h.targetId === "fts-other-model")) {
    issues += 1;
    log("  ⚠ Fremd-Modell-Hit kam durch");
  }
  // Empty-Query → []
  if (repo.searchFts5(twinId, "", { topK: 5, embeddingModel: MOCK_MODEL }).length !== 0) {
    issues += 1;
    log("  ⚠ Empty-Query sollte [] liefern");
  }
  if (issues === 0) {
    log(
      `  Search ✓ (${hits.length} hits, Top-1=${hits[0]?.targetId}, BM25=${hits[0]?.bm25Score.toFixed(3)})`,
    );
  }
  return issues;
}

// ─── TEST 4: Hybrid Happy-Path mit beiden Sources ──────────────────────────

async function runHybridHappyPathTest(
  repo: EmbeddingsRepo,
  service: MemoryRetrievalService,
  provider: DeterministicMockProvider,
  twinId: string,
): Promise<number> {
  banner("TEST 4 — Hybrid Happy-Path: Vector+FTS5 boostet gemeinsamen Hit");
  let issues = 0;
  const anchor = makeNormalizedVector(EMBEDDING_DIM);
  provider.registerAnchor("HYBRID_ANCHOR_QUERY", anchor);

  // "both": semantisch nah UND Token-Match. Content muss alle Query-Tokens
  // enthalten — FTS5-MATCH ist implizit AND.
  repo.insert(
    {
      twinId,
      targetType: "diary_entry",
      targetId: "hyb-both",
      embeddingModel: MOCK_MODEL,
      embedding: makeSimilarVector(anchor, 0.005),
    },
    { ftsContent: "HYBRID_ANCHOR_QUERY Workshop Notiz" },
  );
  // "vec-only": nur semantisch
  repo.insert(
    {
      twinId,
      targetType: "diary_entry",
      targetId: "hyb-vec",
      embeddingModel: MOCK_MODEL,
      embedding: makeSimilarVector(anchor, 0.01),
    },
    { ftsContent: "Komplett andere Tokens ohne Anker." },
  );

  // Query kurz und token-kompatibel. Sanitization wandelt Underscore in Space,
  // unicode61-Tokenizer split den Content ebenfalls am Underscore — beide
  // Seiten sehen die gleichen 3 Tokens.
  const results = await service.retrieve({
    twinId,
    userMessage: "HYBRID_ANCHOR_QUERY Workshop",
    rrfThreshold: 0,
    minVectorSimilarity: 0,
    topK: 5,
  });
  if (results.length < 1) {
    issues += 1;
    log("  ⚠ keine Hits");
    return issues;
  }
  if (results[0]?.embeddingId !== getEmbId(repo, twinId, "hyb-both")) {
    issues += 1;
    log(`  ⚠ Top sollte hyb-both sein, war ${results[0]?.targetId}`);
  }
  // hyb-both muss bm25Rank UND vectorRank haben (beide Sources)
  if (results[0]?.bm25Rank === undefined || results[0]?.vectorRank === undefined) {
    issues += 1;
    log(
      `  ⚠ Top-Hit sollte beide Ranks haben, vec=${results[0]?.vectorRank} bm25=${results[0]?.bm25Rank}`,
    );
  } else {
    log(
      `  Top-Hit "both" hat vec-rank=${results[0].vectorRank} bm25-rank=${results[0].bm25Rank} rrf=${results[0].rrfScore.toFixed(4)} ✓`,
    );
  }
  return issues;
}

// ─── TEST 5: Post-RRF-Threshold filtert weg ────────────────────────────────

async function runPostRrfThresholdTest(
  repo: EmbeddingsRepo,
  service: MemoryRetrievalService,
  provider: DeterministicMockProvider,
  twinId: string,
): Promise<number> {
  banner("TEST 5 — Post-RRF-Threshold cuttet Single-Source-Low-Rank-Hits");
  let issues = 0;
  const anchor = makeNormalizedVector(EMBEDDING_DIM);
  provider.registerAnchor("POST_RRF_QUERY", anchor);
  repo.insert(
    {
      twinId,
      targetType: "diary_entry",
      targetId: "post-rrf-vec-only",
      embeddingModel: MOCK_MODEL,
      embedding: makeSimilarVector(anchor, 0.01),
    },
    { ftsContent: "Token-Mismatch-Inhalt." },
  );
  // Threshold höher als jeder Single-Source-Score (max ~1/61 = 0.0164)
  const results = await service.retrieve({
    twinId,
    userMessage: "Frage mit POST_RRF_QUERY drin",
    rrfThreshold: 0.02,
    minVectorSimilarity: 0,
    topK: 5,
  });
  if (results.length !== 0) {
    issues += 1;
    log(`  ⚠ Erwartet 0 Hits über Threshold 0.02, got ${results.length}`);
    results.forEach((r) =>
      log(`     ${r.targetId} rrf=${r.rrfScore.toFixed(4)}`),
    );
  } else {
    log("  Threshold 0.02 → 0 Single-Source-Hits ✓");
  }
  return issues;
}

// ─── TEST 6: FTS5-Skip bei sehr kurzer Query ───────────────────────────────

async function runFts5SkipShortQueryTest(
  repo: EmbeddingsRepo,
  service: MemoryRetrievalService,
  provider: DeterministicMockProvider,
  twinId: string,
): Promise<number> {
  banner("TEST 6 — FTS5-Skip bei <2 sanitierten Tokens (nur Vector)");
  let issues = 0;
  const anchor = makeNormalizedVector(EMBEDDING_DIM);
  provider.registerAnchor("EinWort", anchor);
  repo.insert(
    {
      twinId,
      targetType: "diary_entry",
      targetId: "short-q",
      embeddingModel: MOCK_MODEL,
      embedding: makeSimilarVector(anchor, 0.005),
    },
    { ftsContent: "Inhalt mit EinWort drin als FTS-Treffer." },
  );
  // 1-Wort-Query nach Sanitization → FTS5 wird übersprungen.
  // Aber die Query muss mind. EPISODIC_MIN_QUERY_LENGTH (10) Zeichen lang sein,
  // sonst greift schon der Min-Query-Length-Filter VOR der Sanitization-
  // Logik. Wir nehmen ein lange 1-Wort-Form.
  const results = await service.retrieve({
    twinId,
    userMessage: "EinWort____________",
    rrfThreshold: 0,
    minVectorSimilarity: 0,
    topK: 3,
  });
  if (results.length < 1) {
    issues += 1;
    log("  ⚠ Vector-Pfad sollte trotz FTS5-Skip Hits liefern");
  } else {
    // Vector-Only-Hits dürfen keine bm25Rank haben
    if (results[0]?.bm25Rank !== undefined) {
      issues += 1;
      log(
        `  ⚠ Vector-Only-Hit sollte bm25Rank=undefined haben, war ${results[0].bm25Rank}`,
      );
    } else {
      log(`  Vector-only ✓ (vec-rank=${results[0]?.vectorRank ?? "—"})`);
    }
  }
  return issues;
}

// ─── TEST 7: Bayreuth-Analogon — Single-Source-Vector ohne FTS5-Match ─────

async function runBayreuthAnalogueTest(
  repo: EmbeddingsRepo,
  service: MemoryRetrievalService,
  provider: DeterministicMockProvider,
  twinId: string,
): Promise<number> {
  banner("TEST 7 — Bayreuth-Analogon: Single-Source-Vector fällt unter 0.015");
  let issues = 0;
  // Drei Items mit moderater Vector-Sim, aber NULL Token-Overlap zur Query
  const anchor = makeNormalizedVector(EMBEDDING_DIM);
  provider.registerAnchor("BAYREUTH_FAKE_QUERY", anchor);
  for (let i = 0; i < 3; i++) {
    repo.insert(
      {
        twinId,
        targetType: "conversation",
        targetId: `fake-bay-${i}`,
        embeddingModel: MOCK_MODEL,
        embedding: makeSimilarVector(anchor, 0.3), // moderat ähnlich (~0.7-0.8)
      },
      { ftsContent: `Notiz Nummer ${i} über Markus' Workshop.` },
    );
  }
  // Default-Threshold 0.015 — Vector-only-Hits mit Rang 1 haben Score 1/61 ≈ 0.0164,
  // Rang 2 = 1/62 ≈ 0.0161, Rang 3 = 1/63 ≈ 0.0159 — alle KNAPP über 0.015.
  // Mit Threshold 0.017 cutten wir alle Single-Source-Hits ab.
  const results = await service.retrieve({
    twinId,
    userMessage: "Frage zum BAYREUTH_FAKE_QUERY — was war da?",
    rrfThreshold: 0.017,
    minVectorSimilarity: 0,
    topK: 3,
  });
  if (results.length !== 0) {
    issues += 1;
    log(
      `  ⚠ Erwartet 0 Hits — alle Single-Source ranken zu niedrig. Got ${results.length}.`,
    );
    results.forEach((r) =>
      log(`     ${r.targetId} rrf=${r.rrfScore.toFixed(4)} vec-rank=${r.vectorRank}`),
    );
  } else {
    log(
      "  Bayreuth-Analogon ✓ — Vector-only mit Token-Mismatch → leere Episodic-Schicht",
    );
  }
  return issues;
}

// ─── TEST 8: Live-E5 Anna-Vergleich ─────────────────────────────────────────

async function runLiveAnnaTest(): Promise<number> {
  banner("TEST 8 — Live-E5 Anna-Vergleich (Hybrid vs. Pure Vector)");
  let issues = 0;
  const { LocalEmbeddingProvider } = await import(
    "../episodic/providers/index.js"
  );
  const localProvider = new LocalEmbeddingProvider({ dtype: "q8" });

  // Frische :memory:-DB für die Live-Daten
  const db = new Database(":memory:");
  sqliteVec.load(db);
  const config = loadRuntimeConfig();
  for (const file of readdirSync(config.migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort()) {
    db.exec(readFileSync(resolve(config.migrationsDir, file), "utf-8"));
  }
  const userId = createUser(db);
  const twinId = createTwinProfile(db, userId, "@_live-anna");
  const repo = new EmbeddingsRepo(db);

  log("  → lädt q8-Modell beim ersten Call …");
  const passages = [
    "Markus arbeitet bei HARWAY Experience.",
    "Florian ist Markus' Geschäftspartner.",
    "Anna ist Markus' Frau.",
    "Wir planen einen Toskana-Urlaub im Juli 2026.",
  ];
  for (let i = 0; i < passages.length; i++) {
    const [vec] = await localProvider.embed(passages[i]!, {
      inputType: "passage",
    });
    if (!vec) continue;
    repo.insert(
      {
        twinId,
        targetType: "diary_entry",
        targetId: `live-${i}`,
        embeddingModel: localProvider.modelName,
        embedding: vec,
      },
      { ftsContent: passages[i] },
    );
  }
  const liveService = new MemoryRetrievalService({
    embeddingsRepo: repo,
    getProvider: () => localProvider,
  });
  const results = await liveService.retrieve({
    twinId,
    userMessage: "Wer ist Markus' Frau?",
    rrfThreshold: 0,
    minVectorSimilarity: 0,
    topK: 4,
  });
  results.forEach((r) =>
    log(
      `   rrf=${r.rrfScore.toFixed(4)} vec-sim=${(r.vectorSimilarity ?? 0).toFixed(4)} vec-rank=${r.vectorRank ?? "—"} bm25-rank=${r.bm25Rank ?? "—"} | ${r.content}`,
    ),
  );
  if (results[0] && !results[0].content.includes("Anna")) {
    issues += 1;
    log("  ⚠ Top-Hit enthält 'Anna' nicht");
  } else if (results[0]) {
    // Erwartung: "Anna" sollte in beiden Sources (Vector + FTS5 via "Frau"
    // bzw. ggf. "Markus"-Token) ranken, also vectorRank UND bm25Rank gesetzt
    // — oder mindestens deutlich höheren RRF-Score als die anderen.
    log("  Top-Hit enthält 'Anna' ✓ (E5-Hybrid funktioniert)");
    const top = results[0].rrfScore;
    const second = results[1]?.rrfScore ?? 0;
    const gap = top - second;
    log(`  RRF-Gap top→second: ${gap.toFixed(4)} (höher = Hybrid trennt klarer)`);
  }
  db.close();
  return issues;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function getEmbId(
  repo: EmbeddingsRepo,
  twinId: string,
  targetId: string,
): string | undefined {
  const all = repo.listByTwin(twinId);
  return all.find((r) => r.targetId === targetId)?.id;
}

function makeNormalizedVector(dim: number): Float32Array {
  const v = new Float32Array(dim);
  for (let i = 0; i < dim; i++) v.set([Math.random() - 0.5], i);
  return normalize(v);
}

function makeSimilarVector(
  base: Float32Array,
  perturbation: number,
): Float32Array {
  const v = new Float32Array(base.length);
  for (let i = 0; i < base.length; i++) {
    const b = base.at(i) ?? 0;
    v.set([b + (Math.random() - 0.5) * perturbation], i);
  }
  return normalize(v);
}

function normalize(v: Float32Array): Float32Array {
  let n = 0;
  for (let i = 0; i < v.length; i++) {
    const x = v.at(i) ?? 0;
    n += x * x;
  }
  n = Math.sqrt(n);
  if (n > 0) {
    for (let i = 0; i < v.length; i++) {
      const x = v.at(i) ?? 0;
      v.set([x / n], i);
    }
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
    "\n[hybrid:test] Fehler:",
    err instanceof Error ? err.stack ?? err.message : err,
  );
  process.exit(1);
});
