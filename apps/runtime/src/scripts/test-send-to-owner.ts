import Database from "better-sqlite3";
import type { ConversationsRepo } from "../conversations/repo.js";
import type { TwinServiceRegistry } from "../twin-service-registry.js";
import { TelegramConfigsRepo } from "../telegram/configs-repo.js";
import { TelegramMessagesRepo } from "../telegram/messages-repo.js";
import { PairingService } from "../telegram/pairing-service.js";
import { TelegramMessageRouter } from "../telegram/message-router.js";
import { TwinProfilesRepo } from "../twin-profiles-repo.js";
import { TelegramBotRegistry } from "../telegram/bot-registry.js";

// ─── TEST: BotRegistry.sendToOwner — graceful Pfade (Proaktiv-Nudge 2a) ─────
//
// Deterministisch gegen :memory:, OHNE Netzwerk: `new Telegraf(token)` baut
// offline (verbindet erst bei launch()), also kann eagerLoadAllBots einen Bot
// in die Map legen, ohne Telegram zu kontaktieren. Geprüft werden die beiden
// graceful Nicht-Sende-Pfade (no-bot, not-paired) — der ECHTE Sende-Pfad
// braucht ein laufendes Telegram-Setup (separater Live-Smoke, Markus).
//   pnpm --filter @nolmi/runtime exec tsx src/scripts/test-send-to-owner.ts

let failures = 0;
function assert(cond: boolean, label: string): void {
  if (cond) console.log(`  ✓ ${label}`);
  else { console.error(`  ✗ FAIL: ${label}`); failures += 1; }
}

const T = "twin_paired_missing"; // konfiguriert, aber NICHT gepairt
const SCHEMA = `
  CREATE TABLE telegram_configs (
    id TEXT PRIMARY KEY NOT NULL, twin_id TEXT NOT NULL,
    bot_token_encrypted TEXT NOT NULL, bot_username TEXT NOT NULL,
    webhook_secret TEXT NOT NULL, paired_owner_telegram_user_id INTEGER,
    pairing_code TEXT, pairing_code_expires_at TEXT,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(twin_id)
  );`;

async function main(): Promise<void> {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = OFF"); // kein twin_profiles-Parent im Test
  db.exec(SCHEMA);

  const masterKey = Buffer.alloc(32, 7); // Test-Key; Roundtrip-konsistent
  const configsRepo = new TelegramConfigsRepo(db, masterKey);
  // Plausibles Telegram-Token-Format (digits:alnum) — Telegraf validiert beim
  // Konstruieren nicht, ein API-Call käme erst bei sendMessage (nie erreicht).
  configsRepo.create({
    twin_id: T,
    bot_token: "123456789:AAEdummyTokenForTestOnlyNotReal0000000000",
    bot_username: "test_bot",
  });
  // Bewusst NICHT pairen → paired_owner_telegram_user_id bleibt NULL.

  const messagesRepo = new TelegramMessagesRepo(db);
  const pairingService = new PairingService(configsRepo);
  const messageRouter = new TelegramMessageRouter(
    configsRepo,
    messagesRepo,
    // conversationsRepo + registry werden NUR im Inbound-Handler benutzt, der
    // in diesem Test nie feuert → Stub-Casts genügen.
    null as unknown as ConversationsRepo,
    null as unknown as TwinServiceRegistry,
  );
  const profilesRepo = new TwinProfilesRepo(db);
  const registry = new TelegramBotRegistry(
    configsRepo,
    pairingService,
    messageRouter,
    profilesRepo,
    false, // webhook-mode (kein launch/Long-Poll)
    null,
  );

  // eager-load: konstruiert die Telegraf-Instanz offline und legt sie in die Map.
  registry.eagerLoadAllBots();

  // ── 1) not-paired: Bot da, aber keine Owner-Chat-ID → graceful, kein Throw ──
  console.log("\n── 1) not-paired (Bot konfiguriert, nicht gepairt)");
  const r1 = await registry.sendToOwner(T, "Test");
  assert(r1.sent === false && r1.reason === "not-paired",
    `{sent:false, reason:'not-paired'} (got sent=${r1.sent}, reason=${r1.reason})`);

  // ── 2) no-bot: Twin ohne Telegram-Config → graceful, kein Throw ──
  console.log("\n── 2) no-bot (Twin ohne Telegram)");
  const r2 = await registry.sendToOwner("twin_ohne_telegram", "Test");
  assert(r2.sent === false && r2.reason === "no-bot",
    `{sent:false, reason:'no-bot'} (got sent=${r2.sent}, reason=${r2.reason})`);

  console.log(failures === 0
    ? "\n✅ ALLE CHECKS GRÜN — sendToOwner graceful (no-bot, not-paired), kein Throw.\n"
    : `\n❌ ${failures} FEHLER\n`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => { console.error(err); process.exit(1); });
