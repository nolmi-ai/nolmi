import "dotenv/config";
import Database from "better-sqlite3";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { nanoid } from "nanoid";
import { loadRuntimeConfig } from "../config.js";
import { ConversationSummariesRepo } from "../conversations/summaries-repo.js";
import {
  auditsToOwnerDirectMessagesChronological,
  buildSummaryBlock,
  loadConversationHistory,
} from "../conversations/history-loader.js";
import type { AuditRepository } from "../repository/types.js";
import { SqliteAuditRepository } from "../repository/sqlite.js";

// ─── TEST: HISTORY-LOADER MIT SUMMARIES (Phase 3.3 Sub-Schritt C) ───────────
//
// In-Memory-DB + frische Migrations, manuelle Fixtures, direkter Test der
// reinen Helper aus conversations/history-loader.ts. Kein TwinService-Mock
// nötig, weil die Helper pure Funktionen sind.
//
// Aufruf: pnpm --filter @nolmi/runtime test-history-with-summary

const FALLBACK_LIMIT = 20; // entspricht HISTORY_AUDIT_LIMIT im TwinService
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
  log(`Fixtures: twin=${fx.twinId}`);

  const summariesRepo = new ConversationSummariesRepo(db);
  const auditRepo: AuditRepository = new SqliteAuditRepository(db);

  let issues = 0;

  // ─── TEST 1: Keine Summaries → Fallback Hard-Cap ────────────────────────
  banner("TEST 1 — keine Summaries → Hard-Cap-Fallback");
  {
    const conv = makeConversation(db, fx);
    insertCountingAudits(db, { ...fx, conversationId: conv }, 5);
    const loaded = await loadConversationHistory(
      { summariesRepo, auditRepo, fallbackLimit: FALLBACK_LIMIT },
      conv,
    );
    if (loaded.summaries.length !== 0) {
      issues += 1;
      log(`  ⚠ summaries: erwartet 0, got ${loaded.summaries.length}.`);
    }
    if (loaded.liveAuditsAsc.length !== 5) {
      issues += 1;
      log(`  ⚠ liveAuditsAsc: erwartet 5, got ${loaded.liveAuditsAsc.length}.`);
    } else {
      log("  Hard-Cap-Fallback liefert 5 Audits ✓");
    }
    // ASC-Order verifizieren — älteste Timestamp zuerst
    const tsList = loaded.liveAuditsAsc.map((a) => a.timestamp);
    const sorted = [...tsList].sort();
    if (JSON.stringify(tsList) !== JSON.stringify(sorted)) {
      issues += 1;
      log("  ⚠ liveAuditsAsc nicht chronologisch sortiert.");
    } else {
      log("  ASC-Sortierung ✓");
    }
  }

  // ─── TEST 2: Eine Summary, Live-Window direkt danach leer ───────────────
  banner("TEST 2 — Eine Summary, kein Live-Window danach");
  {
    const conv = makeConversation(db, fx);
    const audits = insertCountingAudits(db, { ...fx, conversationId: conv }, 5);
    summariesRepo.insert({
      conversationId: conv,
      segmentStartAuditId: audits[0]!,
      segmentEndAuditId: audits[audits.length - 1]!,
      segmentMessageCount: 5,
      summaryMd: "## Summary X\nVerdichteter Inhalt.",
    });
    const loaded = await loadConversationHistory(
      { summariesRepo, auditRepo, fallbackLimit: FALLBACK_LIMIT },
      conv,
    );
    if (loaded.summaries.length !== 1) {
      issues += 1;
      log(`  ⚠ summaries: erwartet 1, got ${loaded.summaries.length}.`);
    } else {
      log("  summaries.length=1 ✓");
    }
    if (loaded.liveAuditsAsc.length !== 0) {
      issues += 1;
      log(
        `  ⚠ liveAuditsAsc: erwartet 0 (alles summarized), got ${loaded.liveAuditsAsc.length}.`,
      );
    } else {
      log("  Live-Window leer ✓");
    }
  }

  // ─── TEST 3: Eine Summary, mehrere neue Audits danach ───────────────────
  banner("TEST 3 — Eine Summary + neue Audits danach");
  {
    const conv = makeConversation(db, fx);
    const summarized = insertCountingAudits(
      db,
      { ...fx, conversationId: conv },
      5,
    );
    summariesRepo.insert({
      conversationId: conv,
      segmentStartAuditId: summarized[0]!,
      segmentEndAuditId: summarized[summarized.length - 1]!,
      segmentMessageCount: 5,
      summaryMd: "## Summary Y",
    });
    // Drei neue Audits NACH dem letzten summarized
    const fresh = insertCountingAudits(db, { ...fx, conversationId: conv }, 3);
    const loaded = await loadConversationHistory(
      { summariesRepo, auditRepo, fallbackLimit: FALLBACK_LIMIT },
      conv,
    );
    if (loaded.liveAuditsAsc.length !== 3) {
      issues += 1;
      log(`  ⚠ liveAuditsAsc: erwartet 3, got ${loaded.liveAuditsAsc.length}.`);
    } else {
      log("  Cursor zieht: 3 frische Audits ✓");
    }
    // Reihenfolge: erste frische = ältester Live-Audit
    if (loaded.liveAuditsAsc[0]?.id !== fresh[0]) {
      issues += 1;
      log(
        `  ⚠ Sortierung: erwartet ${fresh[0]} an Position 0, got ${loaded.liveAuditsAsc[0]?.id}.`,
      );
    } else {
      log("  ASC-Sortierung der Live-Audits ✓");
    }
  }

  // ─── TEST 4: Zwei Summaries chronologisch ────────────────────────────────
  banner("TEST 4 — Zwei Summaries: beide geladen, chronologisch sortiert");
  {
    const conv = makeConversation(db, fx);
    const seg1 = insertCountingAudits(db, { ...fx, conversationId: conv }, 4);
    const s1 = summariesRepo.insert({
      conversationId: conv,
      segmentStartAuditId: seg1[0]!,
      segmentEndAuditId: seg1[seg1.length - 1]!,
      segmentMessageCount: 4,
      summaryMd: "Segment 1 Inhalt",
    });
    const seg2 = insertCountingAudits(db, { ...fx, conversationId: conv }, 4);
    const s2 = summariesRepo.insert({
      conversationId: conv,
      segmentStartAuditId: seg2[0]!,
      segmentEndAuditId: seg2[seg2.length - 1]!,
      segmentMessageCount: 4,
      summaryMd: "Segment 2 Inhalt",
    });
    insertCountingAudits(db, { ...fx, conversationId: conv }, 2);
    const loaded = await loadConversationHistory(
      { summariesRepo, auditRepo, fallbackLimit: FALLBACK_LIMIT },
      conv,
    );
    if (loaded.summaries.length !== 2) {
      issues += 1;
      log(`  ⚠ erwartet 2 Summaries, got ${loaded.summaries.length}.`);
    }
    if (
      loaded.summaries[0]?.id !== s1.id ||
      loaded.summaries[1]?.id !== s2.id
    ) {
      issues += 1;
      log("  ⚠ Summary-Reihenfolge falsch — älteste Summary sollte zuerst kommen.");
    } else {
      log("  Summaries chronologisch sortiert ✓");
    }
    if (loaded.liveAuditsAsc.length !== 2) {
      issues += 1;
      log(
        `  ⚠ Live-Window nach 2. Summary: erwartet 2, got ${loaded.liveAuditsAsc.length}.`,
      );
    } else {
      log("  Live-Window-Cursor folgt der jüngsten Summary ✓");
    }
  }

  // ─── TEST 5: buildSummaryBlock-Formatierung ──────────────────────────────
  banner("TEST 5 — buildSummaryBlock: 0/1/2 Summaries");
  {
    const empty = buildSummaryBlock([]);
    if (empty !== null) {
      issues += 1;
      log(`  ⚠ buildSummaryBlock([]) sollte null sein, got: ${empty}`);
    } else {
      log("  [] → null ✓");
    }

    const one = buildSummaryBlock([
      makeSummaryStub("conv_x", "Erster Block."),
    ]);
    if (one === null || !one.includes("Erster Block.")) {
      issues += 1;
      log(`  ⚠ Ein Summary nicht enthalten: ${one}`);
    } else if (!one.includes("Segment 1")) {
      issues += 1;
      log("  ⚠ Header 'Segment 1' fehlt.");
    } else if (one.includes("---")) {
      issues += 1;
      log("  ⚠ Trenner sollte bei nur einer Summary nicht vorkommen.");
    } else {
      log("  Ein Summary: Header + Inhalt ✓");
    }

    const two = buildSummaryBlock([
      makeSummaryStub("conv_x", "A-Inhalt"),
      makeSummaryStub("conv_x", "B-Inhalt"),
    ]);
    if (
      two === null ||
      !two.includes("Segment 1") ||
      !two.includes("Segment 2") ||
      !two.includes("---") ||
      !two.includes("A-Inhalt") ||
      !two.includes("B-Inhalt")
    ) {
      issues += 1;
      log(`  ⚠ Zwei-Summary-Block formatiert falsch: ${two}`);
    } else {
      log("  Zwei Summaries: 2 Header + Trenner ✓");
    }

    // Leere summaryMd-Einträge werden gefiltert
    const oneEmpty = buildSummaryBlock([
      makeSummaryStub("conv_x", "   "),
      makeSummaryStub("conv_x", "echter Inhalt"),
    ]);
    if (oneEmpty === null || oneEmpty.includes("Segment 2")) {
      issues += 1;
      log("  ⚠ leere Summary-Einträge nicht gefiltert.");
    } else {
      log("  Leere summaryMd-Einträge übersprungen ✓");
    }
  }

  // ─── TEST 6: Defensive Fallback bei DB-Exception ─────────────────────────
  banner("TEST 6 — Defensive Fallback bei Repo-Failure");
  {
    const conv = makeConversation(db, fx);
    insertCountingAudits(db, { ...fx, conversationId: conv }, 4);
    // Mock-AuditRepo: explizite Method-Forwarding (Object-Spread auf Class-
    // Instanzen kopiert keine Prototype-Methoden). listByConversationAfter
    // wirft, die andern delegieren ans Original.
    const throwingRepo: AuditRepository = {
      append: (e) => auditRepo.append(e),
      update: (id, patch) => auditRepo.update(id, patch),
      list: (opts) => auditRepo.list(opts),
      get: (id) => auditRepo.get(id),
      findByInputField: (f, v, o) => auditRepo.findByInputField(f, v, o),
      markRead: (id) => auditRepo.markRead(id),
      listByConversation: (id, limit) => auditRepo.listByConversation(id, limit),
      listByConversationAfter: async () => {
        throw new Error("simulated DB failure");
      },
    };
    // Stub-SummariesRepo: signalisiert "es gibt eine Summary", damit der
    // Cursor-Pfad greift. Wir brauchen nur listByConversation hier — der
    // Loader ruft sonst nichts auf der Repo-Instanz auf.
    const fakeSummary = makeSummaryStub(conv, "Faked");
    const stubSummariesRepo = {
      listByConversation: () => [fakeSummary],
    } as unknown as ConversationSummariesRepo;

    const loaded = await loadConversationHistory(
      {
        summariesRepo: stubSummariesRepo,
        auditRepo: throwingRepo,
        fallbackLimit: FALLBACK_LIMIT,
      },
      conv,
    );
    if (loaded.summaries.length !== 0) {
      issues += 1;
      log(
        `  ⚠ Failure-Pfad sollte leere Summaries liefern, got ${loaded.summaries.length}.`,
      );
    } else {
      log("  Fallback: summaries leer ✓");
    }
    if (loaded.liveAuditsAsc.length !== 4) {
      issues += 1;
      log(
        `  ⚠ Fallback-Hard-Cap sollte 4 Audits liefern, got ${loaded.liveAuditsAsc.length}.`,
      );
    } else {
      log("  Fallback-Hard-Cap greift ✓");
    }
  }

  // ─── TEST 7: Tool-Use-Audits im Live-Window ──────────────────────────────
  banner("TEST 7 — Tool-Use-Audits zwischen zählenden Audits, Live-Window");
  {
    const conv = makeConversation(db, fx);
    const summarized = insertCountingAudits(
      db,
      { ...fx, conversationId: conv },
      3,
    );
    summariesRepo.insert({
      conversationId: conv,
      segmentStartAuditId: summarized[0]!,
      segmentEndAuditId: summarized[summarized.length - 1]!,
      segmentMessageCount: 3,
      summaryMd: "Summary mit Tool-Use später",
    });
    // Mische 2 zählende + 1 Tool-Use NACH der Summary
    insertCountingAudits(db, { ...fx, conversationId: conv }, 1);
    insertToolUseAudit(db, { ...fx, conversationId: conv });
    insertCountingAudits(db, { ...fx, conversationId: conv }, 1);

    const loaded = await loadConversationHistory(
      { summariesRepo, auditRepo, fallbackLimit: FALLBACK_LIMIT },
      conv,
    );
    if (loaded.liveAuditsAsc.length !== 3) {
      issues += 1;
      log(
        `  ⚠ Live-Window: erwartet 3 (2 zählend + 1 tool-use), got ${loaded.liveAuditsAsc.length}.`,
      );
    } else {
      log("  Tool-Use-Audit kommt im Live-Window mit ✓");
    }
    // ChatMessage-Konvertierung skippt Tool-Use (keine lastMessage/reply)
    const chat = auditsToOwnerDirectMessagesChronological(loaded.liveAuditsAsc);
    // 2 zählende → user+assistant pro Audit = 4 Messages
    if (chat.length !== 4) {
      issues += 1;
      log(
        `  ⚠ ChatMessages: erwartet 4 (2 user + 2 assistant), got ${chat.length}.`,
      );
    } else {
      log("  ChatMessage-Konvertierung filtert Tool-Use sauber raus ✓");
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

// ─── Fixtures + Helpers ─────────────────────────────────────────────────────

interface Fixtures {
  userId: string;
  twinId: string;
}

function createFixtures(db: Database.Database): Fixtures {
  const now = new Date().toISOString();
  const nowMs = Date.now();
  const userId = `user_${nanoid(16)}`;
  const twinId = `twin_${nanoid(16)}`;

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
  return { userId, twinId };
}

function makeConversation(db: Database.Database, fx: Fixtures): string {
  const conv = `conv_${nanoid(16)}`;
  db.prepare(
    `INSERT INTO conversations (id, owner_user_id, partner_handle, twin_id, status, started_at, ended_at)
     VALUES (?, ?, ?, ?, 'active', ?, NULL)`,
  ).run(conv, fx.userId, PARTNER_HANDLE, fx.twinId, new Date().toISOString());
  return conv;
}

// Deterministischer Timestamp-Counter (kollisionsfrei für SQL `>`-Filter).
let timestampCounter = 0;
function nextTimestamp(): string {
  timestampCounter += 1;
  const base = new Date("2026-01-01T00:00:00.000Z").getTime();
  return new Date(base + timestampCounter).toISOString();
}

function insertCountingAudits(
  db: Database.Database,
  fx: Pick<Fixtures, "twinId"> & { conversationId: string },
  count: number,
): string[] {
  const ids: string[] = [];
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
    ids.push(id);
  }
  return ids;
}

function insertToolUseAudit(
  db: Database.Database,
  fx: Pick<Fixtures, "twinId"> & { conversationId: string },
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
      toolCall: { mcpServerId: "x", mcpToolName: "y", args: {} },
    },
    output: { toolResult: 42 },
    reason: null,
  });
  db.prepare(
    `INSERT INTO audit (id, timestamp, capability, mandate_id, status, data, twin_id, conversation_id)
     VALUES (?, ?, 'mcp-tool-use', NULL, 'executed', ?, ?, ?)`,
  ).run(id, ts, data, fx.twinId, fx.conversationId);
}

function makeSummaryStub(conversationId: string, summaryMd: string) {
  return {
    id: `summary_${nanoid(12)}`,
    conversationId,
    segmentStartAuditId: "audit_dummy_start",
    segmentEndAuditId: "audit_dummy_end",
    segmentMessageCount: 0,
    summaryMd,
    createdAt: new Date().toISOString(),
  };
}

function banner(title: string) {
  const line = "─".repeat(72);
  console.log(`\n${line}\n  ${title}\n${line}`);
}

function log(msg: string) {
  console.log(msg);
}

// Suppress unused — TWIN_NAME bleibt für eventuelle künftige Erweiterung.
void TWIN_NAME;

main().catch((err) => {
  console.error(
    "\n[history-with-summary:test] Fehler:",
    err instanceof Error ? err.message : err,
  );
  process.exit(1);
});
