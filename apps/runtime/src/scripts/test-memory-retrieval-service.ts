import "dotenv/config";
import Database from "better-sqlite3";
import * as sqliteVec from "sqlite-vec";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { nanoid } from "nanoid";
import { loadRuntimeConfig } from "../config.js";
import { EmbeddingsRepo } from "../episodic/embeddings-repo.js";
import { MemoryRetrievalService } from "../episodic/memory-retrieval-service.js";
import { buildEpisodicBlock } from "../episodic/prompt-builder.js";
import type {
  EmbeddingProvider,
  EmbedOptions,
} from "../episodic/providers/index.js";

// ─── TEST: MEMORY-RETRIEVAL-SERVICE (Phase 3.4 Sub-Schritt E) ───────────────
//
// Mock-Provider gibt für eine "Anker"-Phrase einen festen Vektor zurück;
// Embeddings werden mit "ähnlichen" Vektoren (geringe Perturbation) oder
// "unähnlichen" (random) gespeichert. So sind Search-Hits deterministisch.
//
// Echtes E5-Modell wird optional via NOLMI_RUN_LOCAL_RETRIEVAL_TEST=1
// gegen ein paar deutsche Passages geprüft — das ist der qualitative
// Test, der bestätigt dass die Pipeline auf realer Embedding-Topologie
// funktioniert.

const EMBEDDING_DIM = 1024;
const MOCK_MODEL = "mock-retrieval";

class DeterministicMockProvider implements EmbeddingProvider {
  readonly modelName = MOCK_MODEL;
  readonly dimensions = EMBEDDING_DIM;
  callCount = 0;
  lastInputType: EmbedOptions["inputType"] | null = null;
  shouldFail = false;
  /**
   * Phrase → Anker-Vektor. Inputs, die diese Phrase enthalten, bekommen
   * exakt diesen Vektor — Items im Index, die mit demselben Anker plus
   * leichter Perturbation embedded wurden, ranken dann hoch.
   */
  private anchors: Array<{ marker: string; vec: Float32Array }> = [];

  registerAnchor(marker: string, vec: Float32Array) {
    this.anchors.push({ marker, vec });
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
  const twinA = createTwinProfile(db, userId, "@_test-retrieval-a");
  const twinB = createTwinProfile(db, userId, "@_test-retrieval-b");
  log(`Fixtures: twinA=${twinA} twinB=${twinB}`);

  const embeddingsRepo = new EmbeddingsRepo(db);
  const provider = new DeterministicMockProvider();
  const service = new MemoryRetrievalService({
    embeddingsRepo,
    getProvider: () => provider,
  });

  let issues = 0;
  issues += await runHappyPathTest(embeddingsRepo, service, provider, twinA);
  issues += await runThresholdTest(embeddingsRepo, service, provider, twinA);
  issues += await runMultiTenantTest(
    embeddingsRepo,
    service,
    provider,
    twinA,
    twinB,
  );
  issues += await runFailureTest(service, provider, twinA);
  issues += await runAccessTrackingTest(
    embeddingsRepo,
    service,
    provider,
    twinA,
  );
  issues += await runMinTokenTest(service, provider, twinA);
  issues += await runModelFilterTest(
    embeddingsRepo,
    service,
    provider,
    twinA,
  );
  issues += await runSameConvFilterTest(
    embeddingsRepo,
    service,
    provider,
    twinA,
  );
  issues += runEpisodicBlockTest();

  if (process.env.NOLMI_RUN_LOCAL_RETRIEVAL_TEST === "1") {
    issues += await runLocalProviderTest(embeddingsRepo, twinA);
  } else {
    log(
      "\n⊘ Live-LocalProvider-Test übersprungen (NOLMI_RUN_LOCAL_RETRIEVAL_TEST!=1)",
    );
  }

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

// ─── TEST 1: Happy Path ─────────────────────────────────────────────────────

async function runHappyPathTest(
  repo: EmbeddingsRepo,
  service: MemoryRetrievalService,
  provider: DeterministicMockProvider,
  twinId: string,
): Promise<number> {
  banner("TEST 1.1 — Happy Path: nahester Hit zuerst");
  let issues = 0;

  // Anker-Vektor für die Query. Drei Embeddings: zwei nahe, eins orthogonal.
  const anchor = makeNormalizedVector(EMBEDDING_DIM);
  provider.registerAnchor("WORKSHOP_QUERY", anchor);

  const closeVec = makeSimilarVector(anchor, 0.01);
  const mediumVec = makeSimilarVector(anchor, 0.3);
  const orthogonalVec = makeNormalizedVector(EMBEDDING_DIM);

  // Ein Diary-Eintrag-Stub damit der FTS-Insert FK-Probleme vermeidet
  // (FTS5 hat keine FKs, aber memory_fts-Content muss da sein).
  const insertWithFts = (targetId: string, vec: Float32Array, content: string) => {
    repo.insert(
      {
        twinId,
        targetType: "diary_entry",
        targetId,
        embeddingModel: MOCK_MODEL,
        embedding: vec,
      },
      { ftsContent: content },
    );
  };
  insertWithFts("close", closeVec, "Notiz über den Workshop-Termin im September.");
  insertWithFts("medium", mediumVec, "Markus hat letzte Woche viel gelesen.");
  insertWithFts(
    "orth",
    orthogonalVec,
    "Anna mag den Bayerischen Wald im Frühling.",
  );

  const callsBefore = provider.callCount;
  const results = await service.retrieve({
    twinId,
    userMessage: "Frage zum WORKSHOP_QUERY — was war nochmal mit dem Termin?",
    minVectorSimilarity: 0.5,
    topK: 3,
  });

  if (provider.callCount !== callsBefore + 1) {
    issues += 1;
    log("  ⚠ Provider nicht aufgerufen.");
  }
  if (provider.lastInputType !== "query") {
    issues += 1;
    log(`  ⚠ inputType='${provider.lastInputType}', erwartet 'query'`);
  }
  if (results.length === 0) {
    issues += 1;
    log("  ⚠ Keine Hits zurückgegeben.");
    return issues;
  }
  results.forEach((r, i) =>
    log(
      `   ${i + 1}. target=${r.targetId} rrf=${r.rrfScore.toFixed(4)} vec-sim=${(r.vectorSimilarity ?? 0).toFixed(4)}`,
    ),
  );
  if (results[0]?.targetId !== "close") {
    issues += 1;
    log(`  ⚠ Top-1 sollte "close" sein, war "${results[0]?.targetId}"`);
  } else {
    log(`  Top-1 = close, rrf=${results[0].rrfScore.toFixed(4)} vec-sim=${(results[0].vectorSimilarity ?? 0).toFixed(4)} ✓`);
  }
  if (!results[0]?.content.includes("Workshop")) {
    issues += 1;
    log("  ⚠ FTS-Content fehlt im Result.");
  }
  return issues;
}

// ─── TEST 2: Threshold filtert weg ─────────────────────────────────────────

async function runThresholdTest(
  repo: EmbeddingsRepo,
  service: MemoryRetrievalService,
  provider: DeterministicMockProvider,
  twinId: string,
): Promise<number> {
  banner("TEST 2 — minVectorSimilarity Pre-RRF-Filter cuttet weg");
  let issues = 0;
  // Anker für Query — kein Item passt dazu (alle bestehenden Items sind orthogonal).
  const farAnchor = makeNormalizedVector(EMBEDDING_DIM);
  provider.registerAnchor("DEEP_QUERY_NICHTS_PASST", farAnchor);

  const results = await service.retrieve({
    twinId,
    userMessage: "Tiefer DEEP_QUERY_NICHTS_PASST kontextlos",
    minVectorSimilarity: 0.99,
    topK: 3,
  });
  if (results.length !== 0) {
    issues += 1;
    log(`  ⚠ Erwartet 0 Hits über sehr hohem Threshold, got ${results.length}`);
    results.forEach((r) =>
      log(`     target=${r.targetId} rrf=${r.rrfScore.toFixed(4)} vec-sim=${(r.vectorSimilarity ?? 0).toFixed(4)}`),
    );
  } else {
    log("  Threshold 0.99 → 0 Hits ✓");
  }
  void repo;
  return issues;
}

// ─── TEST 3: Multi-Tenant ──────────────────────────────────────────────────

async function runMultiTenantTest(
  repo: EmbeddingsRepo,
  service: MemoryRetrievalService,
  provider: DeterministicMockProvider,
  twinA: string,
  twinB: string,
): Promise<number> {
  banner("TEST 3 — Multi-Tenant-Isolation");
  let issues = 0;
  const anchor = makeNormalizedVector(EMBEDDING_DIM);
  provider.registerAnchor("CROSS_TENANT_QUERY", anchor);
  const closeForB = makeSimilarVector(anchor, 0.005);
  repo.insert(
    {
      twinId: twinB,
      targetType: "diary_entry",
      targetId: "leak-check",
      embeddingModel: MOCK_MODEL,
      embedding: closeForB,
    },
    { ftsContent: "TwinB-Geheimnis — sollte twinA nicht erreichen" },
  );

  const results = await service.retrieve({
    twinId: twinA,
    userMessage: "Suche mit CROSS_TENANT_QUERY",
    rrfThreshold: 0, minVectorSimilarity: 0,
    topK: 5,
  });

  if (results.some((r) => r.targetId === "leak-check")) {
    issues += 1;
    log("  ⚠ Multi-Tenant-Isolation gebrochen — twinB-Row in twinA-Result.");
  } else {
    log("  Isolation ✓ (twinB-Row nicht in twinA-Result)");
  }
  return issues;
}

// ─── TEST 4: Failure-Handling ──────────────────────────────────────────────

async function runFailureTest(
  service: MemoryRetrievalService,
  provider: DeterministicMockProvider,
  twinId: string,
): Promise<number> {
  banner("TEST 4 — Provider-Failure → [] (kein Throw)");
  let issues = 0;
  provider.shouldFail = true;
  let threw = false;
  let results: Awaited<ReturnType<MemoryRetrievalService["retrieve"]>> = [];
  try {
    results = await service.retrieve({
      twinId,
      userMessage: "Egal welche Query — Provider wirft jetzt",
      rrfThreshold: 0, minVectorSimilarity: 0,
    });
  } catch {
    threw = true;
  }
  provider.shouldFail = false;

  if (threw) {
    issues += 1;
    log("  ⚠ retrieve() hat Failure hochgeworfen — sollte schlucken.");
  } else if (results.length !== 0) {
    issues += 1;
    log(`  ⚠ Bei Failure erwartet 0 Hits, got ${results.length}`);
  } else {
    log("  Failure schluckt + [] ✓");
  }
  return issues;
}

// ─── TEST 5: Access-Tracking ───────────────────────────────────────────────

async function runAccessTrackingTest(
  repo: EmbeddingsRepo,
  service: MemoryRetrievalService,
  provider: DeterministicMockProvider,
  twinId: string,
): Promise<number> {
  banner("TEST 5 — access_count++ + last_accessed_at gesetzt");
  let issues = 0;
  const anchor = makeNormalizedVector(EMBEDDING_DIM);
  provider.registerAnchor("ACCESS_TRACKING_QUERY", anchor);
  repo.insert(
    {
      twinId,
      targetType: "diary_entry",
      targetId: "track-me",
      embeddingModel: MOCK_MODEL,
      embedding: makeSimilarVector(anchor, 0.001),
    },
    { ftsContent: "Eine Notiz zum Tracken." },
  );

  const before = repo
    .listByTwin(twinId, "diary_entry")
    .find((r) => r.targetId === "track-me");
  if (!before) {
    issues += 1;
    log("  ⚠ track-me-Embedding nicht da.");
    return issues;
  }
  await service.retrieve({
    twinId,
    userMessage: "Frage mit ACCESS_TRACKING_QUERY drin",
    rrfThreshold: 0, minVectorSimilarity: 0,
    topK: 1,
  });
  const after = repo.getById(before.id);
  if (!after) {
    issues += 1;
    log("  ⚠ Embedding verschwunden.");
  } else if (after.accessCount !== before.accessCount + 1) {
    issues += 1;
    log(
      `  ⚠ access_count nicht inkrementiert (${before.accessCount} → ${after.accessCount}).`,
    );
  } else if (!after.lastAccessedAt) {
    issues += 1;
    log("  ⚠ last_accessed_at nicht gesetzt.");
  } else {
    log(`  count ${before.accessCount} → ${after.accessCount} + ts gesetzt ✓`);
  }
  return issues;
}

// ─── TEST 6: Min-Query-Length ──────────────────────────────────────────────

async function runMinTokenTest(
  service: MemoryRetrievalService,
  provider: DeterministicMockProvider,
  twinId: string,
): Promise<number> {
  banner("TEST 6 — Min-Query-Length: 'hi' → kein Provider-Call");
  let issues = 0;
  const callsBefore = provider.callCount;
  const results = await service.retrieve({
    twinId,
    userMessage: "hi",
    rrfThreshold: 0, minVectorSimilarity: 0,
  });
  if (provider.callCount !== callsBefore) {
    issues += 1;
    log(`  ⚠ Provider trotz Trivial-Input aufgerufen (${provider.callCount} vs ${callsBefore}).`);
  }
  if (results.length !== 0) {
    issues += 1;
    log(`  ⚠ Trivial-Input liefert ${results.length} Hits, erwartet 0.`);
  } else {
    log("  short-circuit ✓");
  }
  return issues;
}

// ─── TEST 7: Embedding-Model-Filter ────────────────────────────────────────

async function runModelFilterTest(
  repo: EmbeddingsRepo,
  service: MemoryRetrievalService,
  provider: DeterministicMockProvider,
  twinId: string,
): Promise<number> {
  banner("TEST 7 — search filtert auf provider.modelName");
  let issues = 0;
  const anchor = makeNormalizedVector(EMBEDDING_DIM);
  provider.registerAnchor("MODEL_FILTER_QUERY", anchor);
  // Item mit ANDEREM Modell — würde theoretisch matchen aber muss
  // gefiltert werden.
  repo.insert(
    {
      twinId,
      targetType: "diary_entry",
      targetId: "wrong-model-leak",
      embeddingModel: "some-other-model",
      embedding: makeSimilarVector(anchor, 0.001),
    },
    { ftsContent: "Mit falschem Modell embedded — darf nicht zurückkommen." },
  );
  const results = await service.retrieve({
    twinId,
    userMessage: "Mit MODEL_FILTER_QUERY",
    rrfThreshold: 0, minVectorSimilarity: 0,
    topK: 10,
  });
  if (results.some((r) => r.targetId === "wrong-model-leak")) {
    issues += 1;
    log("  ⚠ Item mit fremdem Modell durchgerutscht.");
  } else {
    log("  Modell-Filter ✓");
  }
  return issues;
}

// ─── TEST 8: Same-Conv-Filter ──────────────────────────────────────────────

async function runSameConvFilterTest(
  repo: EmbeddingsRepo,
  service: MemoryRetrievalService,
  provider: DeterministicMockProvider,
  twinId: string,
): Promise<number> {
  banner("TEST 8 — currentConversationId + summarySegmentIds gefiltert");
  let issues = 0;
  const anchor = makeNormalizedVector(EMBEDDING_DIM);
  provider.registerAnchor("SAME_CONV_QUERY", anchor);

  const currentConvId = `conv_current_${nanoid(8)}`;
  const otherConvId = `conv_other_${nanoid(8)}`;
  repo.insert(
    {
      twinId,
      targetType: "conversation",
      targetId: currentConvId,
      embeddingModel: MOCK_MODEL,
      embedding: makeSimilarVector(anchor, 0.005),
    },
    { ftsContent: "Aktuelle Konv — sollte gefiltert werden." },
  );
  repo.insert(
    {
      twinId,
      targetType: "conversation",
      targetId: otherConvId,
      embeddingModel: MOCK_MODEL,
      embedding: makeSimilarVector(anchor, 0.01),
    },
    { ftsContent: "Andere alte Konv — darf durch." },
  );
  const summarySegId = `summary_current_${nanoid(8)}`;
  const otherSegId = `summary_other_${nanoid(8)}`;
  repo.insert(
    {
      twinId,
      targetType: "summary_segment",
      targetId: summarySegId,
      embeddingModel: MOCK_MODEL,
      embedding: makeSimilarVector(anchor, 0.008),
    },
    { ftsContent: "Segment der aktuellen Konv — sollte gefiltert werden." },
  );
  repo.insert(
    {
      twinId,
      targetType: "summary_segment",
      targetId: otherSegId,
      embeddingModel: MOCK_MODEL,
      embedding: makeSimilarVector(anchor, 0.012),
    },
    { ftsContent: "Segment einer alten Konv — darf durch." },
  );

  const results = await service.retrieve({
    twinId,
    userMessage: "Etwas mit SAME_CONV_QUERY",
    rrfThreshold: 0, minVectorSimilarity: 0,
    topK: 10,
    currentConversationId: currentConvId,
    excludeSummarySegmentIds: [summarySegId],
  });
  const ids = results.map((r) => r.targetId);
  if (ids.includes(currentConvId)) {
    issues += 1;
    log("  ⚠ Aktuelle Konv durchgerutscht.");
  }
  if (ids.includes(summarySegId)) {
    issues += 1;
    log("  ⚠ Aktuelles Segment durchgerutscht.");
  }
  if (!ids.includes(otherConvId)) {
    issues += 1;
    log("  ⚠ Alte Konv nicht im Result.");
  }
  if (!ids.includes(otherSegId)) {
    issues += 1;
    log("  ⚠ Altes Segment nicht im Result.");
  }
  if (issues === 0) {
    log(`  Filter ✓ (returned: ${ids.join(", ")})`);
  }
  return issues;
}

// ─── TEST 9: buildEpisodicBlock ────────────────────────────────────────────

function runEpisodicBlockTest(): number {
  banner("TEST 9 — buildEpisodicBlock Markdown + leerer Input");
  let issues = 0;
  // Fixes „jetzt" für die Recency-Annotation (Zeit-Erleben Stufe 1).
  const now = new Date("2026-05-26T09:00:00.000Z");
  const empty = buildEpisodicBlock([], now);
  if (empty !== null) {
    issues += 1;
    log("  ⚠ Leerer Input sollte null liefern.");
  }
  const block = buildEpisodicBlock([
    {
      embeddingId: "e1",
      targetType: "conversation",
      targetId: "c1",
      content: "Markus erzählte von Maria's Workshop in Bayreuth.",
      createdAt: "2026-05-10T08:00:00.000Z",
      rrfScore: 0.032,
      vectorSimilarity: 0.9,
      vectorRank: 1,
      bm25Rank: 1,
    },
    {
      embeddingId: "e2",
      targetType: "diary_entry",
      targetId: "d1",
      content: "Notiz über den Workshop-Vertrag.",
      createdAt: "2026-05-12T09:00:00.000Z",
      rrfScore: 0.025,
      vectorSimilarity: 0.85,
      vectorRank: 2,
    },
  ], now);
  if (!block) {
    issues += 1;
    log("  ⚠ Block fehlt bei nicht-leerem Input.");
    return issues;
  }
  if (!block.startsWith("## Mögliche Erinnerungen")) {
    issues += 1;
    log("  ⚠ Header fehlt/falsch.");
  }
  if (!block.includes("Vergangenes Gespräch")) {
    issues += 1;
    log("  ⚠ Label 'Vergangenes Gespräch' fehlt.");
  }
  if (!block.includes("Eigene Notiz")) {
    issues += 1;
    log("  ⚠ Label 'Eigene Notiz' fehlt.");
  }
  if (!block.includes("Maria's Workshop")) {
    issues += 1;
    log("  ⚠ Content fehlt im Block.");
  }
  // Zeit-Erleben Stufe 1: Recency-Annotation in der Überschrift. Beide Memories
  // (2026-05-10/-12) sind gegen now=2026-05-26 ~2 Wochen alt.
  if (!block.includes("(vor 2 Wochen)")) {
    issues += 1;
    log("  ⚠ Recency-Annotation '(vor 2 Wochen)' fehlt im Block.");
  }
  if (issues === 0) log("  Block ✓");
  return issues;
}

// ─── TEST 10: Optionaler Live-LocalProvider-Test ──────────────────────────

async function runLocalProviderTest(
  repo: EmbeddingsRepo,
  twinId: string,
): Promise<number> {
  banner("TEST 10 — Live-LocalProvider (qualitativ, deutsch)");
  let issues = 0;
  const { LocalEmbeddingProvider } = await import(
    "../episodic/providers/index.js"
  );
  const provider = new LocalEmbeddingProvider({ dtype: "q8" });
  log("  → lädt q8-Modell beim ersten Call …");

  const passages = [
    "Markus arbeitet bei HARWAY Experience.",
    "Florian ist Markus' Geschäftspartner.",
    "Anna ist Markus' Frau.",
    "Wir planen einen Toskana-Urlaub im Juli 2026.",
  ];
  // Direkt über Repo speichern (umgeht den 3.4.D-Service in diesem Test).
  for (let i = 0; i < passages.length; i++) {
    const [vec] = await provider.embed(passages[i]!, { inputType: "passage" });
    if (!vec) continue;
    repo.insert(
      {
        twinId,
        targetType: "diary_entry",
        targetId: `live-${i}`,
        embeddingModel: provider.modelName,
        embedding: vec,
      },
      { ftsContent: passages[i] },
    );
  }

  const liveService = new MemoryRetrievalService({
    embeddingsRepo: repo,
    getProvider: () => provider,
  });
  const results = await liveService.retrieve({
    twinId,
    userMessage: "Wer ist Markus' Frau?",
    minVectorSimilarity: 0.5,
    topK: 3,
  });
  results.forEach((r) =>
    log(`   rrf=${r.rrfScore.toFixed(4)} vec-sim=${(r.vectorSimilarity ?? 0).toFixed(4)} | ${r.content}`),
  );
  if (!results[0]?.content.includes("Anna")) {
    issues += 1;
    log("  ⚠ Top-Result enthält 'Anna' nicht (qualitative E5-Test).");
  } else {
    log("  Top-Result enthält 'Anna' ✓ (E5-Retrieval funktioniert)");
  }
  return issues;
}

// ─── Helpers / Fixtures ─────────────────────────────────────────────────────

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
    const bv = base.at(i) ?? 0;
    v.set([bv + (Math.random() - 0.5) * perturbation], i);
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
    "\n[memory-retrieval:test] Fehler:",
    err instanceof Error ? err.stack ?? err.message : err,
  );
  process.exit(1);
});
