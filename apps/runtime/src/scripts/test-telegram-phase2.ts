import "dotenv/config";

// Smoke ist Service-Layer-Test ohne echte Telegram-Calls. Polling-Default
// umgeht die RUNTIME_PUBLIC_URL-Pflicht im Webhook-Mode, ohne dass das
// Script Telegram tatsächlich pollt (bot.launch() wird hier nie gerufen).
if (!process.env.TELEGRAM_USE_POLLING) {
  process.env.TELEGRAM_USE_POLLING = "true";
}

import Database from "better-sqlite3";
import { loadRuntimeConfig } from "../config.js";
import { TwinProfilesRepo } from "../twin-profiles-repo.js";
import {
  EncryptionKeyMissingError,
  loadMasterKey,
} from "../crypto-utils.js";
import { TelegramConfigsRepo } from "../telegram/configs-repo.js";
import { TelegramMessagesRepo } from "../telegram/messages-repo.js";
import { PairingService } from "../telegram/pairing-service.js";
import { TelegramBotRegistry } from "../telegram/bot-registry.js";
import { TelegramMessageRouter } from "../telegram/message-router.js";
import { ConversationsRepo } from "../conversations/repo.js";
import { TwinServiceRegistry } from "../twin-service-registry.js";

// ─── TEST: TELEGRAM PHASE 2 (PairingService + BotRegistry) ───────────────────
//
// Service-Layer-Smoke gegen die lokale DB. Nimmt einen existierenden Twin
// (default @markus, override per CLI-Arg) und einen synthetischen Test-Bot-
// Token. Telegraf-Instanzen werden zwar real instantiiert (Constructor macht
// kein Netzwerk), aber bot.launch() / bot.handleUpdate() werden hier nie
// gerufen — sonst würde Telegram-API echte Calls erwarten.
//
// Voraussetzung: pnpm db:init lief, NOLMI_ENCRYPTION_KEY ist gesetzt,
// der Ziel-Twin existiert in twin_profiles.
//
// Aufruf:
//   pnpm --filter @nolmi/runtime tsx src/scripts/test-telegram-phase2.ts
//   pnpm --filter @nolmi/runtime tsx src/scripts/test-telegram-phase2.ts @markus

const TWIN_HANDLE_DEFAULT = "@markus";
const TEST_BOT_TOKEN = "0000000000:AAAA-TEST-TOKEN-DO-NOT-USE-AT-TELEGRAM";
const TEST_BOT_USERNAME = "_test_twin_lab_bot_phase2";
const TEST_TELEGRAM_USER_ID = 1234567890;
const OTHER_TELEGRAM_USER_ID = 9876543210;

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
  const pairingService = new PairingService(configsRepo);

  const profile = profilesRepo.findByHandle(handle);
  if (!profile) {
    throw new Error(`Twin '${handle}' nicht in DB.`);
  }
  log(`Test-Twin: ${profile.handle} (${profile.twinId})`);

  cleanup(db, profile.twinId);

  // Test-Config anlegen, damit PairingService darauf operieren kann.
  configsRepo.create({
    twin_id: profile.twinId,
    bot_token: TEST_BOT_TOKEN,
    bot_username: TEST_BOT_USERNAME,
  });

  let issues = 0;

  // ─── STEP 1: generatePairingCode ────────────────────────────────────────
  banner("STEP 1 — generatePairingCode");
  const code = pairingService.generatePairingCode(profile.twinId);
  log(`  Code: ${code}`);
  if (!/^\d{6}$/.test(code)) {
    issues++;
    log(`  ⚠ erwartet 6-stelliger numerischer Code`);
  }
  const afterGen = configsRepo.findByTwinId(profile.twinId);
  if (afterGen?.pairing_code !== code) {
    issues++;
    log(`  ⚠ pairing_code in DB stimmt nicht überein: ${afterGen?.pairing_code}`);
  } else {
    log(`  ✓ pairing_code in DB persistiert`);
  }
  if (!afterGen?.pairing_code_expires_at) {
    issues++;
    log(`  ⚠ pairing_code_expires_at nicht gesetzt`);
  } else {
    log(`  ✓ Expiry: ${afterGen.pairing_code_expires_at}`);
  }

  // ─── STEP 2: consumePairingCode — Success ───────────────────────────────
  banner("STEP 2 — consumePairingCode (success)");
  const paired = pairingService.consumePairingCode(
    profile.twinId,
    code,
    TEST_TELEGRAM_USER_ID,
  );
  if (!paired) {
    issues++;
    log(`  ⚠ erwartet Row, bekam null`);
  } else if (paired.paired_owner_telegram_user_id !== TEST_TELEGRAM_USER_ID) {
    issues++;
    log(
      `  ⚠ User-ID falsch: ${paired.paired_owner_telegram_user_id} vs ${TEST_TELEGRAM_USER_ID}`,
    );
  } else if (paired.pairing_code !== null) {
    issues++;
    log(`  ⚠ pairing_code nach Consume noch da: ${paired.pairing_code}`);
  } else {
    log(`  ✓ User gepaired, Code gecleart`);
  }

  // ─── STEP 3: consumePairingCode — Wrong Code ────────────────────────────
  banner("STEP 3 — consumePairingCode (wrong code)");
  // Frischen Code für Negativ-Test setzen, damit pairing_code-Spalte gefüllt ist.
  const code3 = pairingService.generatePairingCode(profile.twinId);
  log(`  Frischer Code: ${code3}`);
  const wrongResult = pairingService.consumePairingCode(
    profile.twinId,
    "000000",
    TEST_TELEGRAM_USER_ID,
  );
  if (wrongResult !== null) {
    issues++;
    log(`  ⚠ erwartet null, bekam Row`);
  } else {
    log(`  ✓ Wrong-Code abgewiesen`);
  }
  const stillSet = configsRepo.findByTwinId(profile.twinId);
  if (stillSet?.pairing_code !== code3) {
    issues++;
    log(`  ⚠ pairing_code wurde fälschlicherweise gelöscht`);
  } else {
    log(`  ✓ Gültiger Code unverändert in DB`);
  }

  // ─── STEP 4: consumePairingCode — Expired ───────────────────────────────
  banner("STEP 4 — consumePairingCode (expired)");
  // Künstlich expiriert: Expiry-Spalte rückwirkend setzen (5 Min in der
  // Vergangenheit). Wir umgehen den Repo, weil setPairingCode nur Zukunfts-
  // Expiries setzt. Test prüft die SQL-Filter-Logik in consumePairingCode.
  const past = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  db.prepare(
    `UPDATE telegram_configs
       SET pairing_code = '111111',
           pairing_code_expires_at = ?
     WHERE twin_id = ?`,
  ).run(past, profile.twinId);

  const expiredResult = pairingService.consumePairingCode(
    profile.twinId,
    "111111",
    TEST_TELEGRAM_USER_ID,
  );
  if (expiredResult !== null) {
    issues++;
    log(`  ⚠ erwartet null (abgelaufen), bekam Row`);
  } else {
    log(`  ✓ Abgelaufener Code abgewiesen`);
  }

  // ─── STEP 5: resolveTwinByPairedUser ────────────────────────────────────
  banner("STEP 5 — resolveTwinByPairedUser");
  // Re-pair für diesen Test, weil expired-Step nur Code-Spalte gefälscht hat
  // (paired_owner_telegram_user_id ist seit STEP 2 noch gesetzt).
  const stillPaired = configsRepo.findByTwinId(profile.twinId);
  if (stillPaired?.paired_owner_telegram_user_id !== TEST_TELEGRAM_USER_ID) {
    issues++;
    log(`  ⚠ Pre-Condition: User sollte noch gepaired sein`);
  }
  const resolved = pairingService.resolveTwinByPairedUser(TEST_TELEGRAM_USER_ID);
  if (resolved?.twin_id !== profile.twinId) {
    issues++;
    log(`  ⚠ resolve fand falschen Twin: ${resolved?.twin_id}`);
  } else {
    log(`  ✓ resolve fand korrekten Twin`);
  }
  const resolvedOther = pairingService.resolveTwinByPairedUser(
    OTHER_TELEGRAM_USER_ID,
  );
  if (resolvedOther !== null) {
    issues++;
    log(`  ⚠ resolve fand ungepairten User-ID, erwartet null`);
  } else {
    log(`  ✓ ungepairte User-ID → null`);
  }

  // ─── STEP 6: unpair ─────────────────────────────────────────────────────
  banner("STEP 6 — unpair");
  pairingService.unpair(profile.twinId);
  const afterUnpair = configsRepo.findByTwinId(profile.twinId);
  if (afterUnpair?.paired_owner_telegram_user_id !== null) {
    issues++;
    log(
      `  ⚠ paired_owner_telegram_user_id nach unpair: ${afterUnpair?.paired_owner_telegram_user_id}`,
    );
  } else {
    log(`  ✓ User-ID gecleart`);
  }
  const afterUnpairResolve = pairingService.resolveTwinByPairedUser(
    TEST_TELEGRAM_USER_ID,
  );
  if (afterUnpairResolve !== null) {
    issues++;
    log(`  ⚠ resolve nach unpair lieferte noch Row`);
  } else {
    log(`  ✓ resolve nach unpair → null`);
  }

  // ─── STEP 7: ConfigsRepo.findByTwinHandle (Webhook-Routing) ─────────────
  banner("STEP 7 — findByTwinHandle (Webhook-Routing-Lookup)");
  const byHandle = configsRepo.findByTwinHandle(profile.handle);
  if (byHandle?.twin_id !== profile.twinId) {
    issues++;
    log(`  ⚠ findByTwinHandle('${profile.handle}') fehlgeschlagen`);
  } else {
    log(`  ✓ JOIN auf twin_profiles korrekt`);
  }
  const byHandleNotFound = configsRepo.findByTwinHandle("@nonexistent-handle");
  if (byHandleNotFound !== null) {
    issues++;
    log(`  ⚠ unbekannter Handle hätte null geben müssen`);
  } else {
    log(`  ✓ unbekannter Handle → null`);
  }

  // ─── STEP 8: TelegramBotRegistry.eagerLoadAllBots (Mock-Telegraf) ───────
  // Bot-Liveness hängt am Token, nicht am Pairing — beide States
  // (paired + unpaired) müssen vom Eager-Load erfasst werden, sonst kann
  // der First-Pairing-Flow (`/start <code>`) nicht ankommen.
  banner("STEP 8 — TelegramBotRegistry.eagerLoadAllBots");

  // (a) State: gepaart — Bot muss im Map sein
  db.prepare(
    `UPDATE telegram_configs
       SET paired_owner_telegram_user_id = ?
     WHERE twin_id = ?`,
  ).run(TEST_TELEGRAM_USER_ID, profile.twinId);

  // Webhook-Mode: start() ist No-Op, kein Network-Call. Wichtig für Smoke.
  // Phase-3-Constructor braucht messageRouter + profilesRepo + publicBaseUrl;
  // wir bauen schlanke Real-Instanzen (statt Mocks), weil keine davon im
  // STEP-8-Pfad aktiv aufgerufen wird.
  const phase3MessagesRepo = new TelegramMessagesRepo(db);
  const phase3ConversationsRepo = new ConversationsRepo(db);
  const phase3RegistryDummy = new TwinServiceRegistry();
  const phase3MessageRouter = new TelegramMessageRouter(
    configsRepo,
    phase3MessagesRepo,
    phase3ConversationsRepo,
    phase3RegistryDummy,
  );
  const registry = new TelegramBotRegistry(
    configsRepo,
    pairingService,
    phase3MessageRouter,
    profilesRepo,
    false,
    null,
  );
  registry.eagerLoadAllBots();
  const activeIds = registry.listActiveTwinIds();
  if (!activeIds.includes(profile.twinId)) {
    issues++;
    log(`  ⚠ Gepaarter Bot nicht im Registry-Map`);
  } else {
    log(`  ✓ Gepaarter Bot registriert (${activeIds.length} aktiv)`);
  }
  registry.shutdown();

  // (b) State: ungepaart — Bot MUSS trotzdem im Map sein (sonst Chicken-and-
  // Egg beim First-Pairing). Das ist der semantische Kern der Korrektur ggü
  // dem ursprünglichen eagerLoadPairedBots-Filter.
  pairingService.unpair(profile.twinId);
  const registry2 = new TelegramBotRegistry(
    configsRepo,
    pairingService,
    phase3MessageRouter,
    profilesRepo,
    false,
    null,
  );
  registry2.eagerLoadAllBots();
  const activeIds2 = registry2.listActiveTwinIds();
  if (!activeIds2.includes(profile.twinId)) {
    issues++;
    log(`  ⚠ Ungepaarter Bot NICHT geladen — First-Pairing wäre unerreichbar`);
  } else {
    log(`  ✓ Ungepaarter Bot trotzdem registriert (${activeIds2.length} aktiv)`);
  }
  registry2.shutdown();

  // ─── Cleanup ────────────────────────────────────────────────────────────
  banner("Cleanup");
  cleanup(db, profile.twinId);
  log(`  ✓ Test-Config + Messages entfernt`);

  banner("Ergebnis");
  if (issues === 0) {
    log(`✓ Alle Phase-2-Smoke-Tests grün`);
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
