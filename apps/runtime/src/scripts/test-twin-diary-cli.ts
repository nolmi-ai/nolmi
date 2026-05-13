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
import {
  TwinDiaryRepo,
  type DiaryTrigger,
} from "../episodic/twin-diary-repo.js";
import { MemoryEmbeddingService } from "../episodic/memory-embedding-service.js";
import { TwinDiaryService } from "../episodic/twin-diary-service.js";
import type {
  EmbeddingProvider,
  EmbedOptions,
} from "../episodic/providers/index.js";

// ─── TEST: TWIN-DIARY-CLI (Phase 3.4 Sub-Schritt F) ─────────────────────────
//
// Tests gegen die Service-Schicht, nicht das CLI-Shell-Skript. Das CLI ist
// dünn (Args-Parsing + addEntry/listByTwin), das eigentliche Verhalten
// kommt aus TwinDiaryService + Repos. Die hier liegen schon in 3.4.A/D-
// Tests gedeckt — hier verifizieren wir das CLI-Fluss-Pattern:
// addEntry mit unterschiedlichen triggered-by-Werten, Multi-Tenant-Listing,
// Limit, sowie der Embedding-Round-Trip ins memory_fts (so dass 3.4.E die
// Einträge findet).

const EMBEDDING_DIM = 1024;
const MOCK_MODEL = "mock-diary-cli";

class MockProvider implements EmbeddingProvider {
  readonly modelName = MOCK_MODEL;
  readonly dimensions = EMBEDDING_DIM;
  callCount = 0;
  async embed(
    texts: string | string[],
    _opts: EmbedOptions,
  ): Promise<Float32Array[]> {
    this.callCount += 1;
    const arr = Array.isArray(texts) ? texts : [texts];
    return arr.map(() => {
      const v = new Float32Array(EMBEDDING_DIM);
      for (let i = 0; i < EMBEDDING_DIM; i++) v.set([Math.random() - 0.5], i);
      let n = 0;
      for (let i = 0; i < EMBEDDING_DIM; i++) {
        const x = v.at(i) ?? 0;
        n += x * x;
      }
      n = Math.sqrt(n);
      for (let i = 0; i < EMBEDDING_DIM; i++) {
        const x = v.at(i) ?? 0;
        v.set([x / n], i);
      }
      return v;
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
  for (const file of readdirSync(config.migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort()) {
    db.exec(readFileSync(resolve(config.migrationsDir, file), "utf-8"));
  }

  const userId = createUser(db);
  const twinA = createTwinProfile(db, userId, "@_diary-a");
  const twinB = createTwinProfile(db, userId, "@_diary-b");
  log(`Fixtures: twinA=${twinA} twinB=${twinB}`);

  const diaryRepo = new TwinDiaryRepo(db);
  const embeddingsRepo = new EmbeddingsRepo(db);
  const provider = new MockProvider();
  const embeddingService = new MemoryEmbeddingService({
    embeddingsRepo,
    conversationSummariesRepo: new ConversationSummariesRepo(db),
    conversationsRepo: new ConversationsRepo(db),
    twinDiaryRepo: diaryRepo,
    getProvider: () => provider,
  });
  const service = new TwinDiaryService(diaryRepo, embeddingService);

  let issues = 0;

  banner("TEST 1 — addEntry mit Default-Trigger=manual");
  const e1 = await service.addEntry({
    twinId: twinA,
    content: "Reflexion über den Workshop-Vertrag.",
    triggeredBy: "manual",
  });
  if (e1.triggeredBy !== "manual") {
    issues += 1;
    log(`  ⚠ triggered_by='${e1.triggeredBy}', erwartet 'manual'`);
  } else {
    log(`  triggered_by=manual ✓`);
  }
  // Status nach addEntry frisch lesen (Service updatet ihn nach Embedding).
  const e1Fresh = diaryRepo.getById(e1.id);
  if (e1Fresh?.embeddingStatus !== "done") {
    issues += 1;
    log(`  ⚠ embedding_status='${e1Fresh?.embeddingStatus}', erwartet 'done'`);
  } else {
    log("  embedding_status=done ✓");
  }

  banner("TEST 2 — Embedding + FTS-Eintrag landen in den Episodic-Tabellen");
  const embRow = embeddingsRepo.getByTarget(
    twinA,
    "diary_entry",
    e1.id,
    MOCK_MODEL,
  );
  if (!embRow) {
    issues += 1;
    log("  ⚠ Embedding-Row fehlt für Diary-Entry");
  }
  const ftsRow = db
    .prepare(
      "SELECT target_id FROM memory_fts WHERE content MATCH ? AND twin_id = ? AND target_type = 'diary_entry'",
    )
    .get("Workshop", twinA) as { target_id: string } | undefined;
  if (ftsRow?.target_id !== e1.id) {
    issues += 1;
    log(`  ⚠ FTS-Match: ${JSON.stringify(ftsRow)} (erwartet target_id=${e1.id})`);
  } else {
    log("  memory_fts + embeddings ✓");
  }

  banner("TEST 3 — addEntry mit triggered_by=scheduled und post_extract");
  const triggers: DiaryTrigger[] = ["scheduled", "post_extract"];
  for (const t of triggers) {
    const e = await service.addEntry({
      twinId: twinA,
      content: `Auto-Eintrag (trigger=${t}).`,
      triggeredBy: t,
    });
    if (e.triggeredBy !== t) {
      issues += 1;
      log(`  ⚠ triggered_by='${e.triggeredBy}', erwartet '${t}'`);
    }
  }
  log("  scheduled + post_extract ✓");

  banner("TEST 4 — listByTwin mit Limit + DESC-Reihenfolge");
  // Mehrere Einträge mit zeitlichem Abstand.
  for (let i = 0; i < 5; i++) {
    await service.addEntry({
      twinId: twinA,
      content: `Bulk-Eintrag #${i}.`,
      triggeredBy: "manual",
    });
    await sleep(2);
  }
  const limited = diaryRepo.listByTwin(twinA, { limit: 3 });
  if (limited.length !== 3) {
    issues += 1;
    log(`  ⚠ Limit nicht respektiert: got ${limited.length}, erwartet 3`);
  }
  // DESC: erstes Item hat jüngsten Timestamp
  const firstTs = limited[0]?.createdAt;
  const lastTs = limited[limited.length - 1]?.createdAt;
  if (firstTs && lastTs && firstTs < lastTs) {
    issues += 1;
    log("  ⚠ Reihenfolge nicht DESC");
  } else {
    log(`  limit=3, DESC-Order ✓ (head=${firstTs?.slice(11, 19)})`);
  }

  banner("TEST 5 — Multi-Tenant-Isolation");
  await service.addEntry({
    twinId: twinB,
    content: "TwinB-Eintrag, twinA darf den nie sehen.",
    triggeredBy: "manual",
  });
  const listB = diaryRepo.listByTwin(twinB);
  const listA = diaryRepo.listByTwin(twinA);
  if (listB.length !== 1) {
    issues += 1;
    log(`  ⚠ twinB sollte 1 Eintrag haben, got ${listB.length}`);
  }
  if (listA.some((e) => e.content.includes("TwinB-Eintrag"))) {
    issues += 1;
    log("  ⚠ twinB-Content in twinA-Liste");
  } else {
    log(`  Isolation ✓ (A=${listA.length}, B=${listB.length})`);
  }

  banner("TEST 6 — invalid triggered-by (CLI-Validation-Snapshot)");
  // CLI-Skript wirft bei unbekanntem Wert. Wir simulieren das via Repo —
  // das Repo selbst hat keinen CHECK-Constraint (Migration 019), CLI ist
  // die Validation-Schicht. Damit testen wir hier nur, dass valide Werte
  // unverändert durchlaufen — die Negativ-Prüfung lebt im CLI-Code selbst.
  for (const valid of ["manual", "scheduled", "post_extract"] as const) {
    const e = diaryRepo.insert({
      twinId: twinA,
      content: `trigger-check ${valid}`,
      triggeredBy: valid,
    });
    if (e.triggeredBy !== valid) {
      issues += 1;
      log(`  ⚠ Repo hat triggered_by verändert: ${valid} → ${e.triggeredBy}`);
    }
  }
  log("  manuelle Trigger-Werte ✓");

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

function sleep(ms: number): Promise<void> {
  return new Promise((done) => setTimeout(done, ms));
}

main().catch((err) => {
  console.error(
    "\n[diary-cli:test] Fehler:",
    err instanceof Error ? err.stack ?? err.message : err,
  );
  process.exit(1);
});
