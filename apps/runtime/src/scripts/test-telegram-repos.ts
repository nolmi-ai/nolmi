import "dotenv/config";
import Database from "better-sqlite3";
import { loadRuntimeConfig } from "../config.js";
import { TwinProfilesRepo } from "../twin-profiles-repo.js";
import {
  EncryptionKeyMissingError,
  loadMasterKey,
} from "../crypto-utils.js";
import {
  TelegramConfigAlreadyExistsError,
  TelegramConfigsRepo,
} from "../telegram/configs-repo.js";
import { TelegramMessagesRepo } from "../telegram/messages-repo.js";

// ─── TEST: TELEGRAM-REPOS (#130 Phase 1) ─────────────────────────────────────
//
// Schema-Smoke gegen die lokale DB. Nimmt einen existierenden Twin (default
// @markus, override per CLI-Arg). Erzeugt eine Test-Bot-Config + Test-
// Messages mit Test-Präfix; Cleanup am Ende per delete.
//
// Voraussetzung: pnpm db:init lief (Migration 024 angewendet),
// NOLMI_ENCRYPTION_KEY ist gesetzt, der Ziel-Twin existiert in
// twin_profiles.
//
// Aufruf:
//   pnpm --filter @nolmi/runtime tsx src/scripts/test-telegram-repos.ts
//   pnpm --filter @nolmi/runtime tsx src/scripts/test-telegram-repos.ts @markus

const TWIN_HANDLE_DEFAULT = "@markus";
const TEST_BOT_TOKEN = "0000000000:AAAA-TEST-TOKEN-DO-NOT-USE-AT-TELEGRAM";
const TEST_BOT_USERNAME = "_test_twin_lab_bot";

function log(msg: string): void {
  console.log(msg);
}

function banner(msg: string): void {
  console.log(`\n── ${msg} ${"─".repeat(Math.max(0, 70 - msg.length))}`);
}

function cleanup(db: Database.Database, twinId: string): void {
  db.prepare(`DELETE FROM telegram_messages WHERE twin_id = ?`).run(twinId);
  db.prepare(`DELETE FROM telegram_configs WHERE twin_id = ?`).run(twinId);
}

async function main(): Promise<void> {
  const handle = (process.argv[2] ?? TWIN_HANDLE_DEFAULT).toLowerCase();

  let masterKey: Buffer;
  try {
    masterKey = loadMasterKey();
  } catch (err) {
    if (err instanceof EncryptionKeyMissingError) {
      throw new Error(err.message);
    }
    throw err;
  }

  const config = loadRuntimeConfig();
  const db = new Database(config.dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  const profilesRepo = new TwinProfilesRepo(db);
  const configsRepo = new TelegramConfigsRepo(db, masterKey);
  const messagesRepo = new TelegramMessagesRepo(db);

  const profile = profilesRepo.findByHandle(handle);
  if (!profile) {
    throw new Error(`Twin '${handle}' nicht in DB.`);
  }
  log(`Test-Twin: ${profile.handle} (${profile.twinId})`);

  cleanup(db, profile.twinId);

  let issues = 0;

  // ─── STEP 1: create() — Token wird encrypted, Webhook-Secret generiert ──
  banner("STEP 1 — create()");
  const created = configsRepo.create({
    twin_id: profile.twinId,
    bot_token: TEST_BOT_TOKEN,
    bot_username: TEST_BOT_USERNAME,
  });
  log(`  id:                  ${created.id}`);
  log(`  bot_username:        ${created.bot_username}`);
  log(`  token-encrypted-len: ${created.bot_token_encrypted.length}`);
  log(`  webhook-secret-len:  ${created.webhook_secret.length}`);
  log(`  isPaired:            ${created.paired_owner_telegram_user_id !== null}`);
  if (!created.id.startsWith("tg_cfg_")) {
    issues++;
    log(`  ⚠ id-Präfix unerwartet`);
  }
  if (created.bot_token_encrypted === TEST_BOT_TOKEN) {
    issues++;
    log(`  ⚠ Token wurde nicht encrypted (Plain im Storage!)`);
  }
  if (!created.bot_token_encrypted.includes(":")) {
    issues++;
    log(`  ⚠ Encrypted-Format unerwartet (Pattern iv:tag:ciphertext fehlt)`);
  }
  if (created.webhook_secret.length !== 64) {
    issues++;
    log(`  ⚠ Webhook-Secret nicht 64 hex chars (32 bytes)`);
  }

  // ─── STEP 2: decryptToken() — Roundtrip ─────────────────────────────────
  banner("STEP 2 — decryptToken() Roundtrip");
  const decrypted = configsRepo.decryptToken(created);
  log(`  decrypted matched:   ${decrypted === TEST_BOT_TOKEN}`);
  if (decrypted !== TEST_BOT_TOKEN) {
    issues++;
    log(`  ⚠ Decrypt-Roundtrip mismatch`);
  }

  // ─── STEP 3: toPublic() — Strippt Secrets ───────────────────────────────
  banner("STEP 3 — toPublic()");
  const publicRow = configsRepo.toPublic(created);
  log(`  hasToken:            ${publicRow.hasToken}`);
  log(`  isPaired:            ${publicRow.isPaired}`);
  log(`  keys:                ${Object.keys(publicRow).join(", ")}`);
  if ("bot_token_encrypted" in publicRow) {
    issues++;
    log(`  ⚠ bot_token_encrypted ist in Public-Type!`);
  }
  if ("webhook_secret" in publicRow) {
    issues++;
    log(`  ⚠ webhook_secret ist in Public-Type!`);
  }
  if (publicRow.hasToken !== true) {
    issues++;
    log(`  ⚠ hasToken sollte true sein`);
  }
  if (publicRow.isPaired !== false) {
    issues++;
    log(`  ⚠ isPaired sollte false sein (noch nicht gepairt)`);
  }

  // ─── STEP 4: Duplikat → TelegramConfigAlreadyExistsError ────────────────
  banner("STEP 4 — Duplikat (UNIQUE twin_id)");
  let threwUnique = false;
  try {
    configsRepo.create({
      twin_id: profile.twinId,
      bot_token: "another-token",
      bot_username: "_test_other_bot",
    });
  } catch (err) {
    if (err instanceof TelegramConfigAlreadyExistsError) {
      threwUnique = true;
      log(`  ✓ TelegramConfigAlreadyExistsError geworfen`);
    } else {
      log(`  ⚠ falscher Error-Typ: ${err instanceof Error ? err.name : String(err)}`);
    }
  }
  if (!threwUnique) {
    issues++;
    log(`  ⚠ Duplikat-Insert hätte werfen müssen`);
  }

  // ─── STEP 5: Pairing-Code-Lifecycle ─────────────────────────────────────
  banner("STEP 5 — Pairing-Code set → consume");
  configsRepo.setPairingCode(profile.twinId, "123456", 600);
  const afterSet = configsRepo.findByTwinId(profile.twinId)!;
  log(`  pairing_code:        ${afterSet.pairing_code}`);
  log(`  expires_at:          ${afterSet.pairing_code_expires_at}`);
  if (afterSet.pairing_code !== "123456") {
    issues++;
    log(`  ⚠ Pairing-Code nicht gespeichert`);
  }

  const consumed = configsRepo.consumePairingCode(
    profile.twinId,
    "123456",
    9999999,
  );
  log(`  consumed:            ${consumed !== null}`);
  log(`  paired_user_id:      ${consumed?.paired_owner_telegram_user_id ?? "null"}`);
  log(`  pairing_code-after:  ${consumed?.pairing_code ?? "null"}`);
  if (consumed?.paired_owner_telegram_user_id !== 9999999) {
    issues++;
    log(`  ⚠ paired_owner_telegram_user_id nicht gesetzt`);
  }
  if (consumed?.pairing_code !== null) {
    issues++;
    log(`  ⚠ pairing_code nicht gelöscht nach Consume`);
  }

  // ─── STEP 6: Pairing-Code-Mismatch → null ───────────────────────────────
  banner("STEP 6 — Pairing-Code-Mismatch");
  configsRepo.setPairingCode(profile.twinId, "654321", 600);
  const noMatch = configsRepo.consumePairingCode(
    profile.twinId,
    "WRONG",
    1111,
  );
  log(`  result for wrong code: ${noMatch === null ? "null ✓" : "row (unerwartet)"}`);
  if (noMatch !== null) {
    issues++;
    log(`  ⚠ Wrong-Code hätte null geben müssen`);
  }
  configsRepo.clearPairingCode(profile.twinId);

  // ─── STEP 7: findByPairedUserId() ───────────────────────────────────────
  banner("STEP 7 — findByPairedUserId()");
  const byUser = configsRepo.findByPairedUserId(9999999);
  log(`  found:               ${byUser !== null}`);
  log(`  twin_id matched:     ${byUser?.twin_id === profile.twinId}`);
  if (byUser?.twin_id !== profile.twinId) {
    issues++;
    log(`  ⚠ findByPairedUserId Mismatch`);
  }

  // ─── STEP 8: unpair() ───────────────────────────────────────────────────
  banner("STEP 8 — unpair()");
  configsRepo.unpair(profile.twinId);
  const afterUnpair = configsRepo.findByTwinId(profile.twinId)!;
  log(`  paired_user_id:      ${afterUnpair.paired_owner_telegram_user_id ?? "null"}`);
  if (afterUnpair.paired_owner_telegram_user_id !== null) {
    issues++;
    log(`  ⚠ Unpair hat User-ID nicht gelöscht`);
  }

  // ─── STEP 9: Messages — insert inbound + outbound ───────────────────────
  banner("STEP 9 — Messages insert + find");
  const inbound = messagesRepo.insert({
    twin_id: profile.twinId,
    telegram_chat_id: 12345,
    telegram_message_id: 1,
    direction: "inbound",
    text: "Hello from test",
  });
  const outbound = messagesRepo.insert({
    twin_id: profile.twinId,
    telegram_chat_id: 12345,
    telegram_message_id: 2,
    direction: "outbound",
    text: "Hello back from test",
  });
  log(`  inbound.id:          ${inbound.id}`);
  log(`  outbound.id:         ${outbound.id}`);
  log(`  inbound.conv_id:     ${inbound.conversation_id ?? "null"}`);
  if (!inbound.id.startsWith("tg_msg_")) {
    issues++;
    log(`  ⚠ id-Präfix unerwartet`);
  }

  const list = messagesRepo.findByTwinId(profile.twinId);
  log(`  findByTwinId count:  ${list.length}`);
  if (list.length !== 2) {
    issues++;
    log(`  ⚠ Expected 2 messages, got ${list.length}`);
  }

  // ─── STEP 10: Duplicate (UNIQUE chat_id+msg_id) ─────────────────────────
  banner("STEP 10 — Messages UNIQUE constraint");
  let threwDup = false;
  try {
    messagesRepo.insert({
      twin_id: profile.twinId,
      telegram_chat_id: 12345,
      telegram_message_id: 1, // same as inbound above
      direction: "inbound",
      text: "Duplicate retry",
    });
  } catch (err) {
    if (
      err instanceof Error &&
      err.message.includes("UNIQUE constraint failed")
    ) {
      threwDup = true;
      log(`  ✓ UNIQUE-Constraint geworfen (Telegram-Retry-Schutz)`);
    } else {
      log(`  ⚠ falscher Error-Typ: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  if (!threwDup) {
    issues++;
    log(`  ⚠ Duplikat-Insert hätte werfen müssen`);
  }

  // ─── Cleanup ────────────────────────────────────────────────────────────
  // Hinweis: deleteByTwinId entfernt NUR die telegram_configs-Row. Messages
  // bleiben als Audit-Trail erhalten — FK von telegram_messages.twin_id zeigt
  // auf twin_profiles(twin_id), nicht auf telegram_configs. CASCADE feuert
  // nur wenn der Twin selbst aus twin_profiles gelöscht wird (siehe
  // 130-TELEGRAM-STRATEGY §Anmerkungen, „Cascade-Delete-Verhalten").
  banner("Cleanup");
  configsRepo.deleteByTwinId(profile.twinId);
  const afterDelete = configsRepo.findByTwinId(profile.twinId);
  log(`  config nach delete:  ${afterDelete === null ? "null ✓" : "noch da (unerwartet)"}`);
  const msgsAfter = messagesRepo.findByTwinId(profile.twinId);
  log(`  messages nach delete: ${msgsAfter.length} (Audit-Trail bleibt)`);
  if (msgsAfter.length !== 2) {
    issues++;
    log(`  ⚠ Erwartung: 2 Messages bleiben erhalten (kein CASCADE)`);
  }

  // Manuelles Cleanup der Test-Messages, damit nachfolgende Test-Runs
  // sauber starten:
  db.prepare(`DELETE FROM telegram_messages WHERE twin_id = ?`).run(profile.twinId);

  banner("Ergebnis");
  if (issues === 0) {
    log(`✓ Alle Smoke-Tests grün`);
  } else {
    log(`⚠ ${issues} Issue(s) — bitte Output prüfen`);
    process.exit(1);
  }

  db.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
