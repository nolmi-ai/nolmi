import "dotenv/config";
import Database from "better-sqlite3";
import { loadRuntimeConfig } from "../config.js";
import { TwinProfilesRepo } from "../twin-profiles-repo.js";
import { ConversationsRepo } from "../conversations/repo.js";
import { AuditService } from "../audit/service.js";
import { EventBus } from "../events/bus.js";
import { createSqliteRepository } from "../repository/index.js";

// ─── TEST: CONVERSATION-FLOW (#71b + #80 Sub-Schritt B) ─────────────────────
//
// Verifiziert die Verknüpfung Audit ↔ Konversation am Repo-Layer. Kein
// Twin-Service, kein LLM — wir simulieren „Sends" als reinen
// `getOrStart() + audit.start({conversationId})`-Pfad. End-to-End mit echtem
// Send läuft im Browser-Smoke-Test (siehe Briefing Punkt 7).
//
// Synthetischer Test-Partner verhindert Kollision mit echten Konversationen.
// Cleanup am Ende löscht beide Tabellen-Hinterlassenschaften per harten DELETE.

const TWIN_HANDLE_DEFAULT = "@markus";
const TEST_PARTNER = "@_test-conversation-flow-partner";

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
  if (!profile) {
    throw new Error(`Twin '${handle}' nicht in DB.`);
  }
  if (!profile.ownerUserId) {
    throw new Error(
      `Twin '${handle}' hat keinen ownerUserId — bitte zuerst onboarden.`,
    );
  }

  log(`Test-Twin:  ${profile.handle} (${profile.twinId})`);
  log(`Owner-User: ${profile.ownerUserId}`);
  log(`Partner:    ${TEST_PARTNER}`);

  // Reset: hängengebliebene Test-Rows aus Vor-Lauf.
  cleanup(db, profile.ownerUserId, TEST_PARTNER, profile.twinId);

  let issues = 0;
  // Lokale Kopien — sonst verliert TS die Null-Narrowing über den
  // Closure-Hop in simulateSend hinweg.
  const ownerUserId = profile.ownerUserId;
  const twinId = profile.twinId;
  const auditService = new AuditService(repo.audit, new EventBus(), twinId);
  const createdAuditIds: string[] = [];

  async function simulateSend(label: string) {
    const conv = convRepo.getOrStart(ownerUserId, TEST_PARTNER, twinId);
    const audit = await auditService.start({
      capability: "owner-direct",
      mandateId: null,
      input: { messages: [{ role: "user", content: label }], lastMessage: label },
      initialStatus: "executed",
      conversationId: conv.id,
    });
    createdAuditIds.push(audit.id);
    return { conv, audit };
  }

  // ─── STEP 1: erster Send → neue Konversation ──────────────────────────────
  banner("STEP 1 — Send 1 (lazy-start)");
  const send1 = await simulateSend("Hallo eins");
  log(`  conv:  ${send1.conv.id}`);
  log(`  audit: ${send1.audit.id}`);
  const reloaded1 = await repo.audit.get(send1.audit.id);
  log(`  audit.conversationId (DB): ${reloaded1?.conversationId ?? "NULL"}`);
  if (reloaded1?.conversationId !== send1.conv.id) {
    issues += 1;
    log(`  ⚠ conversation_id wurde nicht persistiert.`);
  }

  // ─── STEP 2: zweiter Send → gleiche Konversation ──────────────────────────
  banner("STEP 2 — Send 2 (gleiche aktive Konversation)");
  const send2 = await simulateSend("Hallo zwei");
  log(`  conv:  ${send2.conv.id}`);
  if (send2.conv.id !== send1.conv.id) {
    issues += 1;
    log(`  ⚠ Send 2 hat eine neue Konversation gestartet.`);
  } else {
    log(`  ✓ gleiche Konversation wie Send 1`);
  }
  const reloaded2 = await repo.audit.get(send2.audit.id);
  if (reloaded2?.conversationId !== send1.conv.id) {
    issues += 1;
    log(`  ⚠ audit.conversation_id passt nicht.`);
  }

  // ─── STEP 3: end() der aktiven, dann dritter Send ─────────────────────────
  banner("STEP 3 — end() + Send 3 (neue Konversation)");
  convRepo.end(send1.conv.id);
  const noActive = convRepo.findActive(ownerUserId, TEST_PARTNER, twinId);
  if (noActive !== null) {
    issues += 1;
    log(`  ⚠ findActive sollte nach end() null liefern.`);
  }
  const send3 = await simulateSend("Hallo drei");
  log(`  conv:  ${send3.conv.id}`);
  if (send3.conv.id === send1.conv.id) {
    issues += 1;
    log(`  ⚠ Send 3 sollte eine neue Konversation starten.`);
  } else {
    log(`  ✓ neue Konversation`);
  }
  const reloaded3 = await repo.audit.get(send3.audit.id);
  if (reloaded3?.conversationId !== send3.conv.id) {
    issues += 1;
    log(`  ⚠ audit.conversation_id passt nicht.`);
  }

  // ─── STEP 4: Cleanup ──────────────────────────────────────────────────────
  banner("STEP 4 — Cleanup");
  // Audits zuerst (FK ON DELETE SET NULL würde sie behalten, aber wir wollen
  // keine Test-Rückstände). Dann Konversationen.
  const auditDeleteStmt = db.prepare("DELETE FROM audit WHERE id = ?");
  for (const id of createdAuditIds) auditDeleteStmt.run(id);
  cleanup(db, ownerUserId, TEST_PARTNER, twinId);
  log(`  ${createdAuditIds.length} Audit-Rows entfernt.`);
  const remaining = convRepo.list(ownerUserId, TEST_PARTNER, twinId);
  log(`  Konversationen für Test-Tripel: ${remaining.length} (erwartet 0)`);
  if (remaining.length !== 0) issues += 1;

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

function cleanup(
  db: Database.Database,
  ownerUserId: string,
  partnerHandle: string,
  twinId: string,
) {
  db.prepare(
    `DELETE FROM conversations
       WHERE owner_user_id = ?
         AND partner_handle = ?
         AND twin_id = ?`,
  ).run(ownerUserId, partnerHandle, twinId);
}

main().catch((err) => {
  console.error(
    "\n[conversation-flow:test] Fehler:",
    err instanceof Error ? err.message : err,
  );
  process.exit(1);
});
