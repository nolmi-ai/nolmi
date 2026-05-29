import "dotenv/config";
import Database from "better-sqlite3";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { nanoid } from "nanoid";
import { loadRuntimeConfig } from "../config.js";
import { FactsRepo } from "../facts/repo.js";
import {
  ExtractionEngine,
  type ExtractedFact,
  type ExtractionGenerator,
} from "../facts/extraction-engine.js";
import { ConversationSummariesRepo } from "../conversations/summaries-repo.js";
import { SqliteAuditRepository } from "../repository/sqlite.js";
import { AuditService } from "../audit/service.js";
import { EventBus } from "../events/bus.js";

// ─── TEST: EXTRACTION ENGINE (Phase 3.3 Sub-Schritt F) ──────────────────────
//
// :memory:-DB + frische Migrations + Fixtures + Mock-Generator. Tests
// verifizieren: Skip-Logic für existierende und rejected Facts, Failure-
// Fallback, leere Ergebnisse, Prompt-Content, Pending-Audit-Erstellung.
//
// Aufruf: pnpm --filter @nolmi/runtime test-extraction-engine

const TWIN_NAME = "Markus Test";

async function main() {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");

  const config = loadRuntimeConfig();
  const files = readdirSync(config.migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  for (const file of files) {
    db.exec(readFileSync(resolve(config.migrationsDir, file), "utf-8"));
  }
  log(`Migrations geladen: ${files.length}`);

  const fx = createFixtures(db);
  log(`Fixtures: twin=${fx.twinId} conv=${fx.conversationId}`);

  const factsRepo = new FactsRepo(db);
  const summariesRepo = new ConversationSummariesRepo(db);
  const auditRepoImpl = new SqliteAuditRepository(db);

  let issues = 0;

  // ─── TEST 1: Leere Konversation → extracted=0 ───────────────────────────
  banner("TEST 1 — leere Konversation: Mock returnt facts:[] → extracted=0");
  {
    const conv = makeConversation(db, fx);
    const captured = { system: "", prompt: "" };
    const engine = makeEngine({
      facts: factsRepo,
      summariesRepo,
      auditRepo: auditRepoImpl,
      twinId: fx.twinId,
      generator: captureWrapper(captured, async () => ({ facts: [] })),
    });
    const result = await engine.extractFromConversation(conv);
    if (result.extracted !== 0 || result.pendingFactIds.length !== 0) {
      issues += 1;
      log(`  ⚠ erwartet 0/0, got ${result.extracted}/${result.pendingFactIds.length}`);
    } else {
      log("  empty result → 0/0 ✓");
    }
  }

  // ─── TEST 2: Successful extraction — 2 Facts werden persistiert ─────────
  banner("TEST 2 — 2 Facts, beide persistiert + 2 Pending-Audits");
  {
    const conv = makeConversation(db, fx);
    insertOwnerDirectAudits(db, { ...fx, conversationId: conv }, 3);
    const captured = { system: "", prompt: "" };
    const engine = makeEngine({
      facts: factsRepo,
      summariesRepo,
      auditRepo: auditRepoImpl,
      twinId: fx.twinId,
      generator: captureWrapper(captured, async () => ({
        facts: [
          {
            factKey: "wife_name",
            factValue: "Anna",
            reasoning: "Mehrfach erwähnt im Gespräch",
          },
          {
            factKey: "vacation_2026",
            factValue: "Toskana",
            reasoning: "Geplanter Urlaub im Juli",
          },
        ],
      })),
    });
    const result = await engine.extractFromConversation(conv);
    if (result.extracted !== 2 || result.pendingFactIds.length !== 2) {
      issues += 1;
      log(`  ⚠ erwartet 2/2, got ${result.extracted}/${result.pendingFactIds.length}`);
    } else {
      log("  2 Pending-Facts angelegt ✓");
    }
    const allFacts = factsRepo.listByTwin(fx.twinId);
    const pending = allFacts.filter((f) => f.confidence === "pending");
    if (pending.length !== 2) {
      issues += 1;
      log(`  ⚠ DB: erwartet 2 pending, got ${pending.length}`);
    }
    if (pending.some((f) => f.source !== "twin")) {
      issues += 1;
      log("  ⚠ Pending-Facts müssen source='twin' haben");
    }
    // Audit-Trail
    const audits = await auditRepoImpl.listByConversation(conv, 100);
    const factAudits = audits.filter(
      (a) => a.capability === "semantic-fact-write",
    );
    if (factAudits.length !== 2) {
      issues += 1;
      log(`  ⚠ erwartet 2 semantic-fact-write Audits, got ${factAudits.length}`);
    } else if (factAudits.some((a) => a.status !== "pending")) {
      issues += 1;
      log("  ⚠ alle Audits sollten status='pending' haben");
    } else {
      log("  2 Pending-Audits mit korrekter capability ✓");
    }
    // Cleanup für Folgetests
    factsRepo.delete(fx.twinId, "wife_name");
    factsRepo.delete(fx.twinId, "vacation_2026");
  }

  // ─── TEST 3: Skip existing approved ─────────────────────────────────────
  banner("TEST 3 — existing approved Fact → Skip");
  {
    const conv = makeConversation(db, fx);
    factsRepo.upsert({
      twinId: fx.twinId,
      factKey: "wife_name",
      factValue: "Anna",
      source: "user",
      confidence: "approved",
    });
    const engine = makeEngine({
      facts: factsRepo,
      summariesRepo,
      auditRepo: auditRepoImpl,
      twinId: fx.twinId,
      generator: async () => ({
        facts: [
          { factKey: "wife_name", factValue: "Annette", reasoning: "Test" },
        ],
      }),
    });
    const result = await engine.extractFromConversation(conv);
    if (result.extracted !== 0) {
      issues += 1;
      log(`  ⚠ Skip nicht griffen: extracted=${result.extracted}`);
    } else {
      log("  Approved wird nicht überschrieben ✓");
    }
    const fact = factsRepo.get(fx.twinId, "wife_name");
    if (fact?.factValue !== "Anna") {
      issues += 1;
      log(`  ⚠ Wert wurde überschrieben: ${fact?.factValue}`);
    }
    factsRepo.delete(fx.twinId, "wife_name");
  }

  // ─── TEST 4: Skip existing pending ──────────────────────────────────────
  banner("TEST 4 — existing pending Fact → Skip");
  {
    const conv = makeConversation(db, fx);
    factsRepo.upsert({
      twinId: fx.twinId,
      factKey: "city",
      factValue: "Roding",
      source: "twin",
      confidence: "pending",
    });
    const engine = makeEngine({
      facts: factsRepo,
      summariesRepo,
      auditRepo: auditRepoImpl,
      twinId: fx.twinId,
      generator: async () => ({
        facts: [{ factKey: "city", factValue: "Regensburg", reasoning: "x" }],
      }),
    });
    const result = await engine.extractFromConversation(conv);
    if (result.extracted !== 0) {
      issues += 1;
      log(`  ⚠ Pending wurde überschrieben: extracted=${result.extracted}`);
    } else {
      log("  Pending wird nicht erneut vorgeschlagen ✓");
    }
    factsRepo.delete(fx.twinId, "city");
  }

  // ─── TEST 5: NICHT-Skip rejected (Briefing-Verhalten) ───────────────────
  banner("TEST 5 — existing rejected Fact → re-Insert als pending erlaubt");
  {
    const conv = makeConversation(db, fx);
    factsRepo.upsert({
      twinId: fx.twinId,
      factKey: "favorite_color",
      factValue: "blau",
      source: "twin",
      confidence: "rejected",
    });
    const engine = makeEngine({
      facts: factsRepo,
      summariesRepo,
      auditRepo: auditRepoImpl,
      twinId: fx.twinId,
      generator: async () => ({
        facts: [
          { factKey: "favorite_color", factValue: "grün", reasoning: "neu" },
        ],
      }),
    });
    const result = await engine.extractFromConversation(conv);
    if (result.extracted !== 1) {
      issues += 1;
      log(`  ⚠ Rejected sollte erneut vorgeschlagen werden: ${result.extracted}`);
    } else {
      log("  Rejected → erneut pending möglich ✓");
    }
    const fact = factsRepo.get(fx.twinId, "favorite_color");
    if (fact?.confidence !== "pending" || fact.factValue !== "grün") {
      issues += 1;
      log(`  ⚠ Wert: ${fact?.factValue}, confidence: ${fact?.confidence}`);
    }
    factsRepo.delete(fx.twinId, "favorite_color");
  }

  // ─── TEST 6: LLM-Throw → extracted=0, kein DB-Insert ────────────────────
  banner("TEST 6 — LLM-Throw → extracted=0, kein Insert");
  {
    const conv = makeConversation(db, fx);
    const beforeCount = factsRepo.count(fx.twinId);
    const engine = makeEngine({
      facts: factsRepo,
      summariesRepo,
      auditRepo: auditRepoImpl,
      twinId: fx.twinId,
      generator: async () => {
        throw new Error("simulated provider failure");
      },
    });
    const result = await engine.extractFromConversation(conv);
    if (result.extracted !== 0) {
      issues += 1;
      log(`  ⚠ erwartet 0 nach Throw, got ${result.extracted}`);
    } else {
      log("  Throw → 0 ✓");
    }
    if (factsRepo.count(fx.twinId) !== beforeCount) {
      issues += 1;
      log("  ⚠ DB hat sich nach Throw geändert");
    }
  }

  // ─── TEST 7: Empty result ───────────────────────────────────────────────
  banner("TEST 7 — Mock returnt { facts: [] } → 0/0");
  {
    const conv = makeConversation(db, fx);
    const engine = makeEngine({
      facts: factsRepo,
      summariesRepo,
      auditRepo: auditRepoImpl,
      twinId: fx.twinId,
      generator: async () => ({ facts: [] }),
    });
    const result = await engine.extractFromConversation(conv);
    if (result.extracted !== 0) {
      issues += 1;
      log(`  ⚠ leeres Ergebnis sollte 0 sein, got ${result.extracted}`);
    } else {
      log("  empty facts → 0 ✓");
    }
  }

  // ─── TEST 8: System-Prompt enthält existing + rejected ──────────────────
  banner("TEST 8 — System-Prompt erwähnt aktive + rejected Facts");
  {
    const conv = makeConversation(db, fx);
    factsRepo.upsert({
      twinId: fx.twinId,
      factKey: "active_one",
      factValue: "ACT_VAL",
      source: "user",
      confidence: "approved",
    });
    factsRepo.upsert({
      twinId: fx.twinId,
      factKey: "rejected_one",
      factValue: "REJ_VAL",
      source: "twin",
      confidence: "rejected",
    });
    const captured = { system: "", prompt: "" };
    const engine = makeEngine({
      facts: factsRepo,
      summariesRepo,
      auditRepo: auditRepoImpl,
      twinId: fx.twinId,
      generator: captureWrapper(captured, async () => ({ facts: [] })),
    });
    await engine.extractFromConversation(conv);
    if (!captured.system.includes("active_one") || !captured.system.includes("ACT_VAL")) {
      issues += 1;
      log("  ⚠ existierender aktiver Fact fehlt im System-Prompt");
    } else {
      log("  Aktive Facts im System-Prompt ✓");
    }
    if (!captured.system.includes("rejected_one") || !captured.system.includes("REJ_VAL")) {
      issues += 1;
      log("  ⚠ rejected Fact fehlt im System-Prompt");
    } else {
      log("  Rejected Facts im System-Prompt ✓");
    }
    factsRepo.delete(fx.twinId, "active_one");
    factsRepo.delete(fx.twinId, "rejected_one");
  }

  banner("ZUSAMMENFASSUNG");
  if (issues === 0) {
    log("✓ alle Tests grün");
  } else {
    log(`✗ ${issues} Issue(s) — Details oben.`);
  }
  db.close();
  if (issues > 0) process.exit(2);
}

// ─── Fixtures + Helpers ─────────────────────────────────────────────────────

interface Fixtures {
  userId: string;
  twinId: string;
  conversationId: string;
}

function createFixtures(db: Database.Database): Fixtures {
  const now = new Date().toISOString();
  const nowMs = Date.now();
  const userId = `user_${nanoid(16)}`;
  const twinId = `twin_${nanoid(16)}`;
  const conversationId = `conv_${nanoid(16)}`;

  db.prepare(
    `INSERT INTO users (user_id, email, password_hash, display_name, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(userId, `${nanoid(8)}@test.invalid`, "x", "Tester", now, now);

  db.prepare(
    `INSERT INTO twin_profiles (
       twin_id, handle, display_name, persona_md, mandates_json,
       llm_config, bridge_url, bridge_token,
       owner_user_id, is_active, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
  ).run(
    twinId,
    `@_test-${nanoid(6)}`,
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
    userId,
    nowMs,
    nowMs,
  );

  db.prepare(
    `INSERT INTO conversations (id, owner_user_id, partner_handle, twin_id, status, started_at, ended_at)
     VALUES (?, ?, ?, ?, 'active', ?, NULL)`,
  ).run(conversationId, userId, `@markus`, twinId, now);

  return { userId, twinId, conversationId };
}

function makeConversation(db: Database.Database, fx: Fixtures): string {
  const conv = `conv_${nanoid(16)}`;
  db.prepare(
    `INSERT INTO conversations (id, owner_user_id, partner_handle, twin_id, status, started_at, ended_at)
     VALUES (?, ?, ?, ?, 'active', ?, NULL)`,
  ).run(conv, fx.userId, "@markus", fx.twinId, new Date().toISOString());
  return conv;
}

// Counter für deterministische Timestamps — wie in den anderen Test-Skripten.
let timestampCounter = 0;
function nextTimestamp(): string {
  timestampCounter += 1;
  const base = new Date("2026-01-01T00:00:00.000Z").getTime();
  return new Date(base + timestampCounter).toISOString();
}

function insertOwnerDirectAudits(
  db: Database.Database,
  fx: Pick<Fixtures, "twinId"> & { conversationId: string },
  count: number,
): void {
  for (let i = 0; i < count; i++) {
    const id = `audit_${nanoid(12)}`;
    const ts = nextTimestamp();
    const data = JSON.stringify({
      id,
      twinId: fx.twinId,
      timestamp: ts,
      capability: "owner-direct",
      mandateId: null,
      status: "executed",
      input: { lastMessage: `User message ${i}` },
      output: { reply: `Twin reply ${i}` },
      reason: null,
    });
    db.prepare(
      `INSERT INTO audit (id, timestamp, capability, mandate_id, status, data, twin_id, conversation_id)
       VALUES (?, ?, 'owner-direct', NULL, 'executed', ?, ?, ?)`,
    ).run(id, ts, data, fx.twinId, fx.conversationId);
  }
}

function makeEngine(opts: {
  facts: FactsRepo;
  summariesRepo: ConversationSummariesRepo;
  auditRepo: SqliteAuditRepository;
  twinId: string;
  generator: ExtractionGenerator;
}): ExtractionEngine {
  const bus = new EventBus();
  const auditService = new AuditService(opts.auditRepo, bus, opts.twinId);
  return new ExtractionEngine({
    facts: opts.facts,
    conversationSummaries: opts.summariesRepo,
    auditService,
    twinId: opts.twinId,
    twinName: TWIN_NAME,
    extract: opts.generator,
  });
}

/** Wrappt einen Generator und legt System+Prompt-String in `captured` ab. */
function captureWrapper(
  captured: { system: string; prompt: string },
  inner: ExtractionGenerator,
): ExtractionGenerator {
  return async (params) => {
    captured.system = params.system;
    captured.prompt = params.prompt;
    return inner(params);
  };
}

// Suppress unused — ExtractedFact wird via Engine-Schema verwendet.
void (null as unknown as ExtractedFact);

function banner(title: string) {
  const line = "─".repeat(72);
  console.log(`\n${line}\n  ${title}\n${line}`);
}

function log(msg: string) {
  console.log(msg);
}

main().catch((err) => {
  console.error(
    "\n[extraction-engine:test] Fehler:",
    err instanceof Error ? err.message : err,
  );
  process.exit(1);
});
