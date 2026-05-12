import "dotenv/config";
import Database from "better-sqlite3";
import * as sqliteVec from "sqlite-vec";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { nanoid } from "nanoid";
import { loadRuntimeConfig } from "../config.js";
import {
  EmbeddingsRepo,
  f32ToBuffer,
  type EmbeddingTargetType,
} from "../episodic/embeddings-repo.js";
import { TwinDiaryRepo } from "../episodic/twin-diary-repo.js";

// ─── TEST: EPISODIC-REPOS (Phase 3.4 Sub-Schritt A) ─────────────────────────
//
// Verifiziert EmbeddingsRepo + TwinDiaryRepo gegen eine frische In-Memory-DB
// mit allen 19 Migrationen. sqlite-vec wird vor dem Migration-Loop geladen,
// sonst wirft `CREATE VIRTUAL TABLE ... USING vec0(...)` in Migration 017.
//
// Test-Vektoren sind synthetisch und normalisiert (random + L2-norm = 1) —
// in Production produzieren E5-Provider normalisierte Vektoren ebenso. Damit
// passt die Cosine-Similarity-Formel (1 - distance/2) auf den L2-Default
// von sqlite-vec.
//
// Aufruf:
//   pnpm --filter @twin-lab/runtime test-episodic-repos

const EMBEDDING_DIM = 1024;
const TEST_MODEL = "Xenova/multilingual-e5-large";

async function main() {
  const db = new Database(":memory:");
  // KRITISCH: sqlite-vec laden, bevor Migration 017 läuft.
  sqliteVec.load(db);
  db.pragma("journal_mode = MEMORY");
  db.pragma("foreign_keys = ON");

  // Migrations laden — gleicher Mechanismus wie init-db.ts, ohne Tracking
  // (in :memory: keine Re-Runs nötig).
  const config = loadRuntimeConfig();
  const files = readdirSync(config.migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  for (const file of files) {
    const sql = readFileSync(resolve(config.migrationsDir, file), "utf-8");
    db.exec(sql);
  }
  log(`Migrations geladen: ${files.length} (inkl. 017-019)`);

  // Zwei Twins für Multi-Tenant-Tests
  const userId = createUser(db);
  const twinA = createTwinProfile(db, userId, "@_test-a");
  const twinB = createTwinProfile(db, userId, "@_test-b");
  log(`Fixtures: twinA=${twinA} twinB=${twinB}`);

  let issues = 0;
  issues += runEmbeddingsTests(db, twinA, twinB);
  issues += runDiaryTests(db, twinA, twinB);
  issues += runDefensiveSqlTests(db, twinA);

  banner("ZUSAMMENFASSUNG");
  if (issues === 0) {
    log("✓ alle Tests grün");
  } else {
    log(`✗ ${issues} Issue(s) — Details oben.`);
  }

  db.close();
  if (issues > 0) process.exit(2);
}

// ─── TEST 1: EmbeddingsRepo ─────────────────────────────────────────────────

function runEmbeddingsTests(
  db: Database.Database,
  twinA: string,
  twinB: string,
): number {
  const repo = new EmbeddingsRepo(db);
  let issues = 0;

  banner("TEST 1.1 — insert() + getByTarget()");
  const baseVec = makeRandomVector();
  const rec = repo.insert({
    twinId: twinA,
    targetType: "summary_segment",
    targetId: "summary_xyz",
    embeddingModel: TEST_MODEL,
    embedding: baseVec,
  });
  log(`  id:            ${rec.id}`);
  log(`  twinId:        ${rec.twinId}`);
  log(`  accessCount:   ${rec.accessCount}`);
  log(`  embedding.len: ${rec.embedding.length}`);
  if (!rec.id.startsWith("emb_")) {
    issues += 1;
    log("  ⚠ id-Präfix unerwartet.");
  }
  if (rec.embedding.length !== EMBEDDING_DIM) {
    issues += 1;
    log(`  ⚠ embedding-Länge: erwartet ${EMBEDDING_DIM}, got ${rec.embedding.length}.`);
  }
  if (rec.accessCount !== 0 || rec.lastAccessedAt !== null) {
    issues += 1;
    log("  ⚠ Defaults für accessCount/lastAccessedAt falsch.");
  }
  const fetched = repo.getByTarget(twinA, "summary_segment", "summary_xyz", TEST_MODEL);
  if (!fetched || fetched.id !== rec.id) {
    issues += 1;
    log("  ⚠ getByTarget() liefert nicht den erwarteten Record.");
  } else {
    log("  Round-Trip ✓");
  }

  banner("TEST 1.2 — insert() mit ftsContent → memory_fts populated");
  const ftsVec = makeRandomVector();
  repo.insert(
    {
      twinId: twinA,
      targetType: "summary_segment",
      targetId: "summary_with_fts",
      embeddingModel: TEST_MODEL,
      embedding: ftsVec,
    },
    {
      ftsContent: "Markus arbeitet bei HARWAY Experience in Roding",
    },
  );
  const ftsHits = db
    .prepare(
      `SELECT target_id FROM memory_fts WHERE content MATCH ? AND twin_id = ?`,
    )
    .all("HARWAY", twinA) as Array<{ target_id: string }>;
  if (ftsHits.length !== 1 || ftsHits[0]?.target_id !== "summary_with_fts") {
    issues += 1;
    log(`  ⚠ FTS-Treffer falsch: ${JSON.stringify(ftsHits)}`);
  } else {
    log("  FTS5-Match ✓ (Keyword 'HARWAY' → richtige Row)");
  }

  banner("TEST 1.3 — search() Top-K, sortiert nach Distance");
  // Vier neue Vektoren: einer (target_4) sehr nah am Query, der Rest weiter weg.
  const queryVec = makeRandomVector();
  const close = makeSimilarVector(queryVec, 0.01);
  const medium = makeSimilarVector(queryVec, 0.3);
  const orthogonal1 = makeRandomVector();
  const orthogonal2 = makeRandomVector();

  for (const [tid, vec] of [
    ["target_orth1", orthogonal1],
    ["target_close", close],
    ["target_medium", medium],
    ["target_orth2", orthogonal2],
  ] as Array<[string, Float32Array]>) {
    repo.insert({
      twinId: twinA,
      targetType: "conversation",
      targetId: tid,
      embeddingModel: TEST_MODEL,
      embedding: vec,
    });
  }

  const hits = repo.search(twinA, queryVec, {
    topK: 3,
    similarityThreshold: 0.0,
    embeddingModel: TEST_MODEL,
  });
  log(`  hits: ${hits.length}`);
  hits.forEach((h, i) => {
    log(
      `   ${i + 1}. dist=${h.distance.toFixed(4)} sim=${h.similarity.toFixed(4)} target=${h.record.targetId}`,
    );
  });
  if (hits.length !== 3) {
    issues += 1;
    log(`  ⚠ erwartet 3 Treffer, got ${hits.length}`);
  }
  if (hits[0]?.record.targetId !== "target_close") {
    issues += 1;
    log(`  ⚠ Top-1 sollte target_close sein, war ${hits[0]?.record.targetId}`);
  } else {
    log("  Top-1 = target_close ✓");
  }
  // Distance muss aufsteigend sein.
  for (let i = 1; i < hits.length; i++) {
    const prev = hits[i - 1];
    const curr = hits[i];
    if (prev && curr && curr.distance < prev.distance) {
      issues += 1;
      log("  ⚠ Distance-Sortierung gebrochen.");
      break;
    }
  }

  banner("TEST 1.4 — search() mit similarityThreshold filtert weg");
  // Threshold 0.9: target_close (sim≈0.95 bei perturb=0.01) überlebt,
  // target_medium (sim≈0.44 bei perturb=0.3) wird gefiltert. Exakte
  // Similarity-Werte hängen von der Random-Verteilung ab — der Filter-
  // Effekt bleibt aber deterministisch (close >> medium).
  const filtered = repo.search(twinA, queryVec, {
    topK: 5,
    similarityThreshold: 0.9,
    embeddingModel: TEST_MODEL,
  });
  log(`  filtered hits: ${filtered.length}`);
  filtered.forEach((h) =>
    log(`   target=${h.record.targetId} sim=${h.similarity.toFixed(4)}`),
  );
  if (filtered.some((h) => h.similarity < 0.9)) {
    issues += 1;
    log("  ⚠ Threshold-Filter lässt zu unähnliches durch.");
  }
  if (filtered.length === 0) {
    issues += 1;
    log("  ⚠ Threshold filtert ALLES weg — target_close (perturb=0.01) sollte überleben.");
  }
  if (filtered.some((h) => h.record.targetId === "target_medium")) {
    issues += 1;
    log("  ⚠ target_medium hätte ausgefiltert werden müssen (sim ≈ 0.44 < 0.9).");
  }

  banner("TEST 1.5 — search() Multi-Tenant-Isolation");
  // Insert in twinB mit einem zu queryVec sehr nahen Vektor — twinA-Search
  // darf ihn nicht sehen.
  const intruderVec = makeSimilarVector(queryVec, 0.005);
  repo.insert({
    twinId: twinB,
    targetType: "conversation",
    targetId: "intruder_b",
    embeddingModel: TEST_MODEL,
    embedding: intruderVec,
  });
  const isolatedHits = repo.search(twinA, queryVec, {
    topK: 10,
    similarityThreshold: 0.0,
    embeddingModel: TEST_MODEL,
  });
  if (isolatedHits.some((h) => h.record.targetId === "intruder_b")) {
    issues += 1;
    log("  ⚠ Multi-Tenant-Isolation gebrochen — twinB-Row in twinA-Result.");
  } else {
    log("  Isolation ✓ (twinB-Row nicht in twinA-Result)");
  }

  banner("TEST 1.6 — incrementAccess() setzt last_accessed_at + count");
  const before = repo.getById(rec.id);
  repo.incrementAccess(rec.id);
  const after = repo.getById(rec.id);
  if (!before || !after) {
    issues += 1;
    log("  ⚠ getById() liefert null.");
  } else {
    if (after.accessCount !== before.accessCount + 1) {
      issues += 1;
      log(`  ⚠ access_count nicht inkrementiert (${before.accessCount} → ${after.accessCount}).`);
    }
    if (!after.lastAccessedAt) {
      issues += 1;
      log("  ⚠ last_accessed_at nicht gesetzt.");
    } else {
      log(`  count: ${before.accessCount} → ${after.accessCount}, last_accessed_at gesetzt ✓`);
    }
  }

  banner("TEST 1.7 — UNIQUE-Constraint auf (twin, type, id, model)");
  // Re-Insert desselben Tripels mit demselben Modell muss fehlschlagen.
  let threw = false;
  try {
    repo.insert({
      twinId: twinA,
      targetType: "summary_segment",
      targetId: "summary_xyz",
      embeddingModel: TEST_MODEL,
      embedding: makeRandomVector(),
    });
  } catch {
    threw = true;
  }
  if (!threw) {
    issues += 1;
    log("  ⚠ UNIQUE-Constraint nicht enforced.");
  } else {
    log("  UNIQUE-Constraint greift ✓");
  }

  banner("TEST 1.8 — UNIQUE erlaubt anderes Modell auf gleichem Target");
  // Multi-Provider-Coexistenz ist explizit erlaubt.
  let coexistOk = true;
  try {
    repo.insert({
      twinId: twinA,
      targetType: "summary_segment",
      targetId: "summary_xyz",
      embeddingModel: "openai/text-embedding-3-small",
      embedding: makeRandomVector(),
    });
  } catch (err) {
    coexistOk = false;
    log(`  ⚠ Multi-Modell-Insert geworfen: ${err instanceof Error ? err.message : err}`);
  }
  if (!coexistOk) issues += 1;
  else log("  Multi-Provider-Coexistenz ✓");

  return issues;
}

// ─── TEST 2: TwinDiaryRepo ──────────────────────────────────────────────────

function runDiaryTests(
  db: Database.Database,
  twinA: string,
  twinB: string,
): number {
  const repo = new TwinDiaryRepo(db);
  let issues = 0;

  banner("TEST 2.1 — insert() + getById()");
  const e1 = repo.insert({
    twinId: twinA,
    content: "Heute fühl ich mich klarer als gestern.",
    triggeredBy: "manual",
  });
  if (!e1.id.startsWith("diary_")) {
    issues += 1;
    log("  ⚠ id-Präfix unerwartet.");
  }
  if (e1.embeddingStatus !== "pending") {
    issues += 1;
    log(`  ⚠ Default-Status: erwartet 'pending', got '${e1.embeddingStatus}'.`);
  }
  const fetched = repo.getById(e1.id);
  if (!fetched || fetched.content !== e1.content) {
    issues += 1;
    log("  ⚠ Round-Trip via getById() liefert nicht denselben Eintrag.");
  } else {
    log(`  Round-Trip ✓ (status=${fetched.embeddingStatus})`);
  }

  banner("TEST 2.2 — listByTwin() DESC nach created_at");
  // Wir brauchen messbar unterschiedliche Timestamps. ISO-Strings haben ms-
  // Granularität — kurze Pause genügt.
  void sleep(5);
  const e2 = repo.insert({
    twinId: twinA,
    content: "Zweiter Eintrag.",
    triggeredBy: "scheduled",
  });
  void sleep(5);
  const e3 = repo.insert({
    twinId: twinA,
    content: "Dritter Eintrag.",
    triggeredBy: "post_extract",
  });
  const list = repo.listByTwin(twinA);
  if (list.length !== 3) {
    issues += 1;
    log(`  ⚠ count: erwartet 3, got ${list.length}.`);
  }
  // Wegen ms-Auflösung können Timestamps gleich sein — wir prüfen, dass
  // die drei IDs alle drin sind und der jüngste (e3) ≥ den anderen ist.
  const ids = list.map((e) => e.id);
  if (!ids.includes(e1.id) || !ids.includes(e2.id) || !ids.includes(e3.id)) {
    issues += 1;
    log(`  ⚠ Liste enthält nicht alle Einträge: ${JSON.stringify(ids)}`);
  }
  const first = list[0];
  const last = list[list.length - 1];
  if (first && last && first.createdAt < last.createdAt) {
    issues += 1;
    log("  ⚠ Sortierung nicht DESC.");
  } else {
    log(`  list.length=${list.length}, DESC-Order ✓`);
  }

  banner("TEST 2.3 — updateEmbeddingStatus() done/failed");
  const ok = repo.updateEmbeddingStatus(e1.id, "done");
  if (!ok) {
    issues += 1;
    log("  ⚠ updateEmbeddingStatus() returnt false bei bekanntem Eintrag.");
  }
  const afterDone = repo.getById(e1.id);
  if (afterDone?.embeddingStatus !== "done") {
    issues += 1;
    log(`  ⚠ Status nicht aktualisiert: got '${afterDone?.embeddingStatus}'.`);
  }
  const failOk = repo.updateEmbeddingStatus(e2.id, "failed");
  const e2After = repo.getById(e2.id);
  if (!failOk || e2After?.embeddingStatus !== "failed") {
    issues += 1;
    log("  ⚠ Status-Update auf 'failed' nicht durch.");
  } else {
    log("  Status-Updates done/failed ✓");
  }

  banner("TEST 2.4 — listPending() liefert nur pending");
  const pending = repo.listPending(twinA);
  if (pending.length !== 1 || pending[0]?.id !== e3.id) {
    issues += 1;
    log(`  ⚠ listPending falsch: ${pending.map((e) => e.id).join(", ")}`);
  } else {
    log("  listPending ✓");
  }

  banner("TEST 2.5 — Multi-Tenant: count(twinB) = 0");
  if (repo.count(twinB) !== 0) {
    issues += 1;
    log(`  ⚠ twinB sollte 0 Einträge haben, got ${repo.count(twinB)}.`);
  }
  repo.insert({
    twinId: twinB,
    content: "TwinB-Eintrag.",
    triggeredBy: "manual",
  });
  if (repo.count(twinB) !== 1 || repo.count(twinA) !== 3) {
    issues += 1;
    log(`  ⚠ Counts inkonsistent: A=${repo.count(twinA)} B=${repo.count(twinB)}.`);
  } else {
    log("  Multi-Tenant-Counts ✓");
  }

  return issues;
}

// ─── TEST 3: defensive SQL-Pattern-Checks (Pre-Check-Findings) ──────────────
//
// Diese Tests dokumentieren die Pre-Check-Befunde als ausführbare Regression-
// Guards. Wenn jemand später die Patterns wegrefactort (z.B. CTE entfernt
// oder BigInt-Wrap rauswirft), schlagen sie Alarm.

function runDefensiveSqlTests(db: Database.Database, twinId: string): number {
  let issues = 0;

  banner("TEST 3.1 — vec0-Insert OHNE BigInt-Wrap muss werfen");
  // Direkter SQL-Pfad ohne EmbeddingsRepo. Wenn Number statt BigInt
  // gebunden wird, soll vec0 ablehnen. Falls die Constraint künftig
  // gelockert wird, lernen wir das hier.
  const vec = makeRandomVector();
  let threwOnNumber = false;
  try {
    db.prepare(
      `INSERT INTO embeddings_vec(rowid, embedding) VALUES (?, ?)`,
    ).run(999999 as unknown as number, f32ToBuffer(vec));
  } catch (err) {
    threwOnNumber = true;
    log(`  expected throw: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (!threwOnNumber) {
    issues += 1;
    log("  ⚠ vec0 hat Number als rowid akzeptiert — Pre-Check-Befund verifizieren.");
  } else {
    log("  BigInt-Pflicht bestätigt ✓");
  }

  banner("TEST 3.2 — KNN ohne LIMIT muss werfen (CTE-Pflicht)");
  // Die Repo-search() umgeht das via CTE. Hier prüfen wir: ohne LIMIT
  // direkt am vec0-MATCH wirft die Engine. Wenn das je entfällt, ist die
  // CTE-Schutzschicht im Repo möglicherweise unnötig — aber bis dahin:
  // Pflicht.
  let threwOnNoLimit = false;
  try {
    db.prepare(
      `SELECT rowid, distance FROM embeddings_vec WHERE embedding MATCH ?`,
    ).all(f32ToBuffer(vec));
  } catch (err) {
    threwOnNoLimit = true;
    log(`  expected throw: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (!threwOnNoLimit) {
    issues += 1;
    log("  ⚠ vec0 hat KNN ohne LIMIT akzeptiert — Pre-Check-Befund verifizieren.");
  } else {
    log("  LIMIT-Pflicht auf KNN bestätigt ✓");
  }

  // twinId nur referenziert, damit die Signatur konsistent bleibt; in
  // dieser Test-Gruppe brauchen wir den nicht.
  void twinId;
  return issues;
}

// ─── FIXTURES ──────────────────────────────────────────────────────────────

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
    "Test Twin",
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

// ─── helpers ────────────────────────────────────────────────────────────────

function makeRandomVector(dim: number = EMBEDDING_DIM): Float32Array {
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
    const baseVal = base.at(i) ?? 0;
    v.set([baseVal + (Math.random() - 0.5) * perturbation], i);
  }
  return normalize(v);
}

function normalize(v: Float32Array): Float32Array {
  let norm = 0;
  for (let i = 0; i < v.length; i++) {
    const val = v.at(i) ?? 0;
    norm += val * val;
  }
  norm = Math.sqrt(norm);
  if (norm > 0) {
    for (let i = 0; i < v.length; i++) {
      const val = v.at(i) ?? 0;
      v.set([val / norm], i);
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

function sleep(ms: number): Promise<void> {
  return new Promise((done) => setTimeout(done, ms));
}

main().catch((err) => {
  console.error(
    "\n[episodic-repos:test] Fehler:",
    err instanceof Error ? err.stack ?? err.message : err,
  );
  process.exit(1);
});
