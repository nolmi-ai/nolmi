import "dotenv/config";
import Database from "better-sqlite3";
import { nanoid } from "nanoid";
import type { AuditEntry } from "@nolmi/shared";
import { loadRuntimeConfig } from "../config.js";
import { TwinProfilesRepo } from "../twin-profiles-repo.js";
import { ConversationsRepo } from "../conversations/repo.js";
import { createSqliteRepository } from "../repository/index.js";

// ─── TEST: CONVERSATION-HISTORY-LOADER (#71b + #80 Sub-Schritt C) ───────────
//
// Verifiziert listByConversation am Repo-Layer:
//   - Strict-Filter auf conversation_id
//   - Sliding-Window-Cap (LIMIT)
//   - Pre-Migration-Audits (conversation_id=NULL) werden ignoriert
//
// Wir legen direkt in der DB Test-Audits an (kein TwinService-Pfad), weil wir
// nur den Filter prüfen wollen. Cleanup hart per DELETE am Ende.

const TWIN_HANDLE_DEFAULT = "@markus";
const TEST_PARTNER_A = "@_test-history-partner-a";
const TEST_PARTNER_B = "@_test-history-partner-b";

async function main() {
  const handle = (process.argv[2] ?? TWIN_HANDLE_DEFAULT).toLowerCase();

  const config = loadRuntimeConfig();
  const db = new Database(config.dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  const profilesRepo = new TwinProfilesRepo(db);
  const convRepo = new ConversationsRepo(db);
  const repo = createSqliteRepository(config.dbPath);

  const profile = profilesRepo.findByHandle(handle);
  if (!profile) throw new Error(`Twin '${handle}' nicht in DB.`);
  if (!profile.ownerUserId) {
    throw new Error(`Twin '${handle}' hat keinen ownerUserId.`);
  }
  const ownerUserId = profile.ownerUserId;
  const twinId = profile.twinId;

  log(`Test-Twin: ${profile.handle} (${twinId})`);
  log(`Owner:     ${ownerUserId}`);

  // Reset
  cleanup(db, ownerUserId, [TEST_PARTNER_A, TEST_PARTNER_B], twinId);
  const orphanIds: string[] = [];

  let issues = 0;

  // ─── SETUP: zwei Konversationen + NULL-Audits ──────────────────────────────
  banner("SETUP — Konversationen + Audits");
  const convA = convRepo.start({
    ownerUserId,
    partnerHandle: TEST_PARTNER_A,
    twinId,
  });
  const convB = convRepo.start({
    ownerUserId,
    partnerHandle: TEST_PARTNER_B,
    twinId,
  });
  log(`  convA: ${convA.id}`);
  log(`  convB: ${convB.id}`);

  // 5 Audits in convA mit aufsteigendem Timestamp.
  const baseMs = Date.now() - 1_000_000;
  for (let i = 0; i < 5; i++) {
    insertAudit(db, twinId, convA.id, baseMs + i * 1000, `convA #${i + 1}`);
  }
  // 3 Audits in convB.
  for (let i = 0; i < 3; i++) {
    insertAudit(db, twinId, convB.id, baseMs + 100_000 + i * 1000, `convB #${i + 1}`);
  }
  // 2 NULL-Konversations-Audits (Pre-Migration-Simulation). IDs merken, damit
  // das Cleanup sie wieder findet.
  for (let i = 0; i < 2; i++) {
    const id = insertAudit(
      db,
      twinId,
      null,
      baseMs + 200_000 + i * 1000,
      `orphan #${i + 1}`,
    );
    orphanIds.push(id);
  }

  // ─── STEP 1: listByConversation(convA, 40) → 5 Einträge ────────────────────
  banner("STEP 1 — convA voll laden (limit > count)");
  const allA = await repo.audit.listByConversation(convA.id, 40);
  log(`  count: ${allA.length} (erwartet 5)`);
  if (allA.length !== 5) issues += 1;
  if (!allA.every((e) => e.conversationId === convA.id)) {
    issues += 1;
    log(`  ⚠ nicht alle Einträge haben convA-ID.`);
  }

  // ─── STEP 2: listByConversation(convA, 3) → 3 jüngste ──────────────────────
  banner("STEP 2 — Cap-Test (limit < count)");
  const cappedA = await repo.audit.listByConversation(convA.id, 3);
  log(`  count: ${cappedA.length} (erwartet 3)`);
  if (cappedA.length !== 3) issues += 1;
  // DESC: jüngste zuerst. Erwartet "convA #5", "convA #4", "convA #3".
  const labelsCap = cappedA.map(label).join(", ");
  log(`  labels: ${labelsCap}`);
  if (
    label(cappedA[0]) !== "convA #5" ||
    label(cappedA[1]) !== "convA #4" ||
    label(cappedA[2]) !== "convA #3"
  ) {
    issues += 1;
    log(`  ⚠ Sortierung passt nicht — DESC by timestamp erwartet.`);
  }

  // ─── STEP 3: listByConversation(convB, 40) → 3 ─────────────────────────────
  banner("STEP 3 — convB voll laden");
  const allB = await repo.audit.listByConversation(convB.id, 40);
  log(`  count: ${allB.length} (erwartet 3)`);
  if (allB.length !== 3) issues += 1;
  if (!allB.every((e) => e.conversationId === convB.id)) {
    issues += 1;
    log(`  ⚠ nicht alle Einträge haben convB-ID.`);
  }

  // ─── STEP 4: NULL-Audits werden gefiltert ─────────────────────────────────
  banner("STEP 4 — NULL-Audits werden ignoriert");
  // Doppelt sicher: weder convA noch convB liefern den Orphan-Label.
  const seenOrphan =
    [...allA, ...allB, ...cappedA].some((e) => label(e).startsWith("orphan"));
  if (seenOrphan) {
    issues += 1;
    log(`  ⚠ Orphan-Audit mit conversation_id=NULL wurde geliefert.`);
  } else {
    log(`  ✓ keine Orphans in den Konversations-Listen.`);
  }
  // Orphans existieren aber in der DB:
  const orphanCount = db
    .prepare(
      `SELECT COUNT(*) AS c FROM audit WHERE twin_id = ? AND conversation_id IS NULL AND id IN (?, ?)`,
    )
    .get(twinId, orphanIds[0], orphanIds[1]) as { c: number };
  log(`  orphans in DB: ${orphanCount.c} (erwartet 2)`);
  if (orphanCount.c !== 2) issues += 1;

  // ─── STEP 5: Cleanup ──────────────────────────────────────────────────────
  banner("STEP 5 — Cleanup");
  // Audits zuerst (sonst FK SET NULL wäre folgenlos, aber wir wollen die
  // Test-Rows ganz weghaben).
  const deleteAudit = db.prepare("DELETE FROM audit WHERE id = ?");
  for (const e of [...allA, ...allB]) deleteAudit.run(e.id);
  for (const id of orphanIds) deleteAudit.run(id);
  cleanup(db, ownerUserId, [TEST_PARTNER_A, TEST_PARTNER_B], twinId);
  const stillThere = await repo.audit.listByConversation(convA.id, 40);
  log(`  convA nach Cleanup: ${stillThere.length} (erwartet 0)`);
  if (stillThere.length !== 0) issues += 1;

  banner("ZUSAMMENFASSUNG");
  if (issues === 0) {
    log("✓ alle Tests grün");
  } else {
    log(`✗ ${issues} Issue(s) — Details oben.`);
  }

  db.close();
  if (issues > 0) process.exit(2);
}

function banner(title: string) {
  const line = "─".repeat(72);
  console.log(`\n${line}\n  ${title}\n${line}`);
}

function log(msg: string) {
  console.log(msg);
}

function label(entry: AuditEntry | undefined): string {
  if (!entry) return "(missing)";
  const v = entry.input.lastMessage;
  return typeof v === "string" ? v : "(no label)";
}

/**
 * Direkt SQL — wir wollen den unkonventionellen `conversation_id=NULL`-Fall
 * testen, den die normale append()-API in B sauber befüllt. Schreibt sowohl
 * die indizierten Spalten als auch den `data`-JSON-Blob, damit der Read-Pfad
 * (mergeColumns) die Felder konsistent rekonstruiert.
 */
function insertAudit(
  db: Database.Database,
  twinId: string,
  conversationId: string | null,
  timestampMs: number,
  labelText: string,
): string {
  const id = `audit_${nanoid(12)}`;
  const ts = new Date(timestampMs).toISOString();
  const entry: AuditEntry = {
    id,
    twinId,
    timestamp: ts,
    capability: "owner-direct",
    mandateId: null,
    status: "executed",
    input: { lastMessage: labelText },
    output: { reply: `reply: ${labelText}` },
    reason: null,
    conversationId,
  };
  db.prepare(
    `INSERT INTO audit
       (id, twin_id, timestamp, capability, mandate_id, status, conversation_id, data)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    twinId,
    ts,
    "owner-direct",
    null,
    "executed",
    conversationId,
    JSON.stringify(entry),
  );
  return id;
}

function cleanup(
  db: Database.Database,
  ownerUserId: string,
  partnerHandles: string[],
  twinId: string,
) {
  const stmt = db.prepare(
    `DELETE FROM conversations
       WHERE owner_user_id = ?
         AND partner_handle = ?
         AND twin_id = ?`,
  );
  for (const partner of partnerHandles) stmt.run(ownerUserId, partner, twinId);
}

main().catch((err) => {
  console.error(
    "\n[conversation-history:test] Fehler:",
    err instanceof Error ? err.message : err,
  );
  process.exit(1);
});
