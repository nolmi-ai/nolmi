import "dotenv/config";
import Database from "better-sqlite3";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { nanoid } from "nanoid";
import { loadRuntimeConfig } from "../config.js";
import { ConversationSummariesRepo } from "../conversations/summaries-repo.js";
import {
  SummaryEngine,
  type SummaryGenerator,
} from "../conversations/summary-engine.js";

// ─── TEST: SUMMARY-ENGINE (Phase 3.3 Sub-Schritt B) ─────────────────────────
//
// In-Memory-DB + frische Migrations, manuelle Fixtures, Mock-summarize-
// Funktion. Audits werden direkt per SQL eingefügt mit gestaffelten
// Timestamps, damit das Cursor-Verhalten deterministisch ist.
//
// Aufruf: pnpm --filter @nolmi/runtime test-summary-engine

const THRESHOLD = 50; // muss zur Default-Tunable übereinstimmen
const BATCH_SIZE = 40; // dito
const TWIN_NAME = "Markus Test";
const PARTNER_HANDLE = "@markus";

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

  const summariesRepo = new ConversationSummariesRepo(db);

  let issues = 0;

  // ─── TEST 1: shouldSummarize-Edge-Cases ──────────────────────────────────
  banner("TEST 1 — shouldSummarize: null + leer + unter/über Threshold");
  {
    const engine = makeEngine(db, summariesRepo, okSummarize("Mock summary 1"));
    if ((await engine.shouldSummarize(null)) !== false) {
      issues += 1;
      log("  ⚠ shouldSummarize(null) sollte false sein.");
    } else {
      log("  shouldSummarize(null) → false ✓");
    }
    if ((await engine.shouldSummarize(fx.conversationId)) !== false) {
      issues += 1;
      log("  ⚠ shouldSummarize bei leerer Konversation sollte false sein.");
    } else {
      log("  shouldSummarize(leer) → false ✓");
    }
    // 49 zählende Messages — knapp unter Threshold
    insertCountingAudits(db, fx, 49);
    if ((await engine.shouldSummarize(fx.conversationId)) !== false) {
      issues += 1;
      log(`  ⚠ shouldSummarize bei 49 zählenden Audits sollte false sein.`);
    } else {
      log("  49 zählende → false ✓");
    }
    // Eine mehr → 50 — Threshold ist >50, also noch false
    insertCountingAudits(db, fx, 1);
    if ((await engine.shouldSummarize(fx.conversationId)) !== false) {
      issues += 1;
      log("  ⚠ shouldSummarize bei exakt 50 sollte false sein (Threshold >50).");
    } else {
      log("  50 zählende → false ✓");
    }
    // Eine mehr → 51 — über Threshold
    insertCountingAudits(db, fx, 1);
    if ((await engine.shouldSummarize(fx.conversationId)) !== true) {
      issues += 1;
      log("  ⚠ shouldSummarize bei 51 sollte true sein.");
    } else {
      log("  51 zählende → true ✓");
    }
  }

  // ─── TEST 2: generateSummary erstellt Eintrag, Cursor zieht ──────────────
  banner("TEST 2 — generateSummary: Insert, Range, Cursor-Effekt");
  {
    const engine = makeEngine(db, summariesRepo, okSummarize("## Summary A\n..."));
    const result = await engine.generateSummary(fx.conversationId, {
      twinName: TWIN_NAME,
      partnerHandle: PARTNER_HANDLE,
    });
    if (!result) {
      issues += 1;
      log("  ⚠ generateSummary returnte null obwohl Mock OK ist.");
    } else {
      log(`  summaryId: ${result.summaryId}`);
      log(`  range:     ${result.segmentStartAuditId} → ${result.segmentEndAuditId}`);
      log(`  count:     ${result.segmentMessageCount} (erwartet ${BATCH_SIZE})`);
      if (result.segmentMessageCount !== BATCH_SIZE) {
        issues += 1;
        log(`  ⚠ segment_message_count: erwartet ${BATCH_SIZE}, got ${result.segmentMessageCount}.`);
      }
      const rows = summariesRepo.listByConversation(fx.conversationId);
      if (rows.length !== 1) {
        issues += 1;
        log(`  ⚠ Repo-State: erwartet 1 Summary, gefunden ${rows.length}.`);
      }
    }
    // Nach Summary: 51-40=11 zählende noch übrig — unter Threshold
    if ((await engine.shouldSummarize(fx.conversationId)) !== false) {
      issues += 1;
      log("  ⚠ shouldSummarize nach Summary sollte false sein (11 < 50).");
    } else {
      log("  shouldSummarize nach erster Summary → false ✓");
    }
  }

  // ─── TEST 3: Range deckt Tool-Use-Audits ab ──────────────────────────────
  banner("TEST 3 — Range markiert um Tool-Use-Audits herum");
  {
    // Neue Konversation für klare Trennung
    const conv2 = makeConversation(db, fx);
    insertCountingAudits(db, { ...fx, conversationId: conv2 }, 5);
    insertToolUseAudit(db, { ...fx, conversationId: conv2 });
    insertCountingAudits(db, { ...fx, conversationId: conv2 }, 55); // total 60 zählend + 1 tool

    const engine = makeEngine(db, summariesRepo, okSummarize("Summary mit Tool-Use"));
    if (!(await engine.shouldSummarize(conv2))) {
      issues += 1;
      log("  ⚠ Setup: 60 zählende Audits sollten Threshold knacken.");
    }
    const result = await engine.generateSummary(conv2, {
      twinName: TWIN_NAME,
      partnerHandle: PARTNER_HANDLE,
    });
    if (!result) {
      issues += 1;
      log("  ⚠ generateSummary returnte null.");
    } else {
      // Verifikation: zählender Audit-Range-Filter im Prompt SOLLTE den
      // Tool-Use mit-erfassen. Wir prüfen das über das, was die summarize-
      // Funktion gesehen hat (capture).
      const capturedTool = lastCaptured.user.includes("[tool-use]");
      if (!capturedTool) {
        issues += 1;
        log("  ⚠ Prompt enthält keinen Tool-Use-Eintrag — Range-Bug.");
      } else {
        log("  Tool-Use im Prompt enthalten ✓");
      }
    }
  }

  // ─── TEST 4: Multi-Summary nach zweitem Trigger ──────────────────────────
  banner("TEST 4 — Multi-Summary: zweite Trigger-Runde → 2 Summaries");
  {
    const conv3 = makeConversation(db, fx);
    insertCountingAudits(db, { ...fx, conversationId: conv3 }, 51);
    const engine = makeEngine(db, summariesRepo, okSummarize("first"));
    const r1 = await engine.generateSummary(conv3, {
      twinName: TWIN_NAME,
      partnerHandle: PARTNER_HANDLE,
    });
    if (!r1) {
      issues += 1;
      log("  ⚠ erste Summary fehlgeschlagen.");
    }
    // Jetzt 51 mehr — Cursor zieht, neue 51 zählend + 11 alte (already-
    // summarized werden via segment_end_audit-Cursor subtrahiert) → 51 > 50
    insertCountingAudits(db, { ...fx, conversationId: conv3 }, 51);
    if (!(await engine.shouldSummarize(conv3))) {
      issues += 1;
      log("  ⚠ zweiter Threshold nicht erkannt.");
    }
    const r2 = await engine.generateSummary(conv3, {
      twinName: TWIN_NAME,
      partnerHandle: PARTNER_HANDLE,
    });
    if (!r2) {
      issues += 1;
      log("  ⚠ zweite Summary fehlgeschlagen.");
    }
    const rows = summariesRepo.listByConversation(conv3);
    if (rows.length !== 2) {
      issues += 1;
      log(`  ⚠ erwartet 2 Summaries, gefunden ${rows.length}.`);
    } else {
      log(`  2 Summary-Segmente persistiert ✓ (${rows[0]?.id}, ${rows[1]?.id})`);
    }
    // Die zweite Summary muss nach der ersten beginnen (chronologisch).
    if (
      rows.length === 2 &&
      rows[0]!.segmentEndAuditId === rows[1]!.segmentStartAuditId
    ) {
      issues += 1;
      log("  ⚠ Range-Überlappung: zweite Summary beginnt am ENDE der ersten — Cursor-Bug.");
    }
  }

  // ─── TEST 5: Failure-Pfad ────────────────────────────────────────────────
  banner("TEST 5 — generateSummary mit Throw → returns null, kein Insert");
  {
    const conv4 = makeConversation(db, fx);
    insertCountingAudits(db, { ...fx, conversationId: conv4 }, 51);
    const beforeCount = summariesRepo.count(conv4);
    const engine = makeEngine(db, summariesRepo, async () => {
      throw new Error("simulated provider failure");
    });
    const result = await engine.generateSummary(conv4, {
      twinName: TWIN_NAME,
      partnerHandle: PARTNER_HANDLE,
    });
    if (result !== null) {
      issues += 1;
      log("  ⚠ generateSummary sollte null zurückgeben bei Throw.");
    } else {
      log("  Throw → null ✓");
    }
    const afterCount = summariesRepo.count(conv4);
    if (afterCount !== beforeCount) {
      issues += 1;
      log(`  ⚠ Failure-Pfad hat trotzdem geschrieben (before=${beforeCount}, after=${afterCount}).`);
    } else {
      log("  Kein Insert bei Failure ✓");
    }
  }

  // ─── TEST 6: Empty-Text-Pfad (Garbage-Output) ────────────────────────────
  banner("TEST 6 — generateSummary mit leerer LLM-Antwort → null");
  {
    const conv5 = makeConversation(db, fx);
    insertCountingAudits(db, { ...fx, conversationId: conv5 }, 51);
    const engine = makeEngine(db, summariesRepo, okSummarize("   "));
    const result = await engine.generateSummary(conv5, {
      twinName: TWIN_NAME,
      partnerHandle: PARTNER_HANDLE,
    });
    if (result !== null) {
      issues += 1;
      log("  ⚠ leerer LLM-Output sollte null returnen.");
    } else {
      log("  empty text → null ✓");
    }
    if (summariesRepo.count(conv5) !== 0) {
      issues += 1;
      log("  ⚠ leerer Output hat trotzdem geschrieben.");
    }
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

// ─── Helpers ────────────────────────────────────────────────────────────────

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
  ).run(conversationId, userId, PARTNER_HANDLE, twinId, now);

  return { userId, twinId, conversationId };
}

function makeConversation(db: Database.Database, fx: Fixtures): string {
  const conv = `conv_${nanoid(16)}`;
  db.prepare(
    `INSERT INTO conversations (id, owner_user_id, partner_handle, twin_id, status, started_at, ended_at)
     VALUES (?, ?, ?, ?, 'active', ?, NULL)`,
  ).run(conv, fx.userId, PARTNER_HANDLE, fx.twinId, new Date().toISOString());
  return conv;
}

// Globaler Counter, damit Timestamps deterministisch aufsteigend sind und
// SQL-Filter (>) zuverlässig greifen. ISO-Strings mit ms-Granularität allein
// reichen nicht, weil bei schneller Folge zwei Audits denselben Wert haben
// können.
let timestampCounter = 0;
function nextTimestamp(): string {
  timestampCounter += 1;
  // Base: 2026-01-01, +counter ms — bleibt deterministisch und kollisionsfrei.
  const base = new Date("2026-01-01T00:00:00.000Z").getTime();
  return new Date(base + timestampCounter).toISOString();
}

function insertCountingAudits(
  db: Database.Database,
  fx: Pick<Fixtures, "twinId" | "conversationId">,
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

function insertToolUseAudit(
  db: Database.Database,
  fx: Pick<Fixtures, "twinId" | "conversationId">,
): void {
  const id = `audit_${nanoid(12)}`;
  const ts = nextTimestamp();
  const data = JSON.stringify({
    id,
    twinId: fx.twinId,
    timestamp: ts,
    capability: "mcp-tool-use",
    mandateId: null,
    status: "executed",
    input: {
      toolCall: {
        mcpServerId: "mcp_x",
        mcpToolName: "everything_get-sum",
        args: { a: 1, b: 2 },
      },
    },
    output: { toolResult: 3 },
    reason: null,
  });
  db.prepare(
    `INSERT INTO audit (id, timestamp, capability, mandate_id, status, data, twin_id, conversation_id)
     VALUES (?, ?, 'mcp-tool-use', NULL, 'executed', ?, ?, ?)`,
  ).run(id, ts, data, fx.twinId, fx.conversationId);
}

// Capture: bei jedem summarize-Call wird der zuletzt gesehene System/User-
// Prompt hier abgelegt, damit Tests Inhalt prüfen können (z.B. Tool-Use im
// Range-Check).
const lastCaptured = { system: "", user: "" };

function okSummarize(text: string): SummaryGenerator {
  return async (system, user) => {
    lastCaptured.system = system;
    lastCaptured.user = user;
    return { text };
  };
}

function makeEngine(
  db: Database.Database,
  summariesRepo: ConversationSummariesRepo,
  summarize: SummaryGenerator,
): SummaryEngine {
  return new SummaryEngine({ db, summariesRepo, summarize });
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
    "\n[summary-engine:test] Fehler:",
    err instanceof Error ? err.message : err,
  );
  process.exit(1);
});
