import { Telegraf } from "telegraf";
import type { FastifyBaseLogger } from "fastify";
import type { TelegramConfigRow, TelegramConfigsRepo } from "./configs-repo.js";
import type { PairingService } from "./pairing-service.js";
import type { TelegramMessageRouter } from "./message-router.js";
import type { TwinProfilesRepo } from "../twin-profiles-repo.js";

// ─── TELEGRAF BOT INSTANCE BUILDER (#130 Phase 2) ───────────────────────────
//
// Erzeugt eine Telegraf-Instanz mit den Phase-2-Handlern: /start <code> für
// Pairing, ein Text-Stub als Placeholder bis Phase 3 die LLM-Integration
// bringt, plus globaler Error-Catch. Bewusst dünn — jegliche Business-Logik
// (Code-Validation, Conversation-Resolution, LLM-Calls) lebt außerhalb.
//
// Gemeinsam genutzt von Polling-Mode (bot.launch() in TelegramBotRegistry)
// und Webhook-Mode (bot.handleUpdate(update) im webhook-routes-Handler).

const CONFIG_GONE_REPLY =
  "This bot is no longer configured. Please contact the owner.";

const UNPAIRED_REPLY =
  "This bot isn't paired yet. The owner should send /start <code> using " +
  "a pairing code generated from the Twin-Lab settings.";

const PAIRED_BUT_DIFFERENT_USER_REPLY =
  "This bot is paired with a different Telegram account. If you believe " +
  "this is an error, contact the owner.";

const PAIRING_HELP_REPLY =
  "To pair this bot with your Twin-Lab account, use: /start <code>\n" +
  "Generate a code in your twin's Settings UI.";

const PAIRING_FAIL_REPLY =
  "Pairing failed. The code is invalid or expired. " +
  "Generate a new one in Settings.";

const TWIN_PROFILE_GONE_REPLY =
  "This bot's twin is no longer available. Please contact the owner.";

export function createTelegrafBot(
  config: TelegramConfigRow,
  decryptedToken: string,
  pairingService: PairingService,
  configsRepo: TelegramConfigsRepo,
  messageRouter: TelegramMessageRouter,
  profilesRepo: TwinProfilesRepo,
  logger?: FastifyBaseLogger,
): Telegraf {
  const bot = new Telegraf(decryptedToken);

  // ─── /start <code> — Owner-Pairing ──────────────────────────────────────
  // Phase 2: kein Multi-User-Pairing. Erst der erste erfolgreiche /start-Call
  // mit gültigem Code „adoptiert" den Telegram-User als Owner. Stufe 2
  // (Phase B) wird das auf eine Pre-Approval-Liste erweitern.
  bot.command("start", async (ctx) => {
    const parts = ctx.message.text.split(/\s+/).slice(1);
    const code = parts[0]?.trim();

    if (!code) {
      await ctx.reply(PAIRING_HELP_REPLY);
      return;
    }

    const paired = pairingService.consumePairingCode(
      config.twin_id,
      code,
      ctx.from.id,
    );

    if (paired) {
      await ctx.reply(
        `✓ Paired successfully. I'm now linked to your twin ` +
          `@${config.bot_username}.`,
      );
    } else {
      await ctx.reply(PAIRING_FAIL_REPLY);
    }
  });

  // ─── Text-Stub für Phase 3 ──────────────────────────────────────────────
  // Phase 2 antwortet mit Placeholder, persistiert KEINE Message (Phase 3
  // baut Conversation-Resolution + LLM-Integration und damit auch das
  // Persistence-Verhalten). Drei States für Authorization:
  //
  //   1) Config existiert nicht mehr (Hot-Delete während Bot live war)
  //   2) Config existiert, aber noch ungepaart (frischer Bot, kein /start
  //      <code> noch durchgegangen)
  //   3) Config existiert, gepaart, aber fremder Telegram-User
  //   → sonst: Owner, Phase-2-Stub-Antwort
  //
  // Re-Fetch der Config pro Update, weil sich Pairing-State zwischen
  // Bot-Start und Message ändern kann (z.B. Owner pairt grade via /start
  // in einem anderen Update, oder unpair via Settings-UI).
  bot.on("text", async (ctx) => {
    // Ignoriere Commands, die hier durchrutschen (z.B. unbekannte /xyz).
    if (ctx.message.text.startsWith("/")) return;

    const currentConfig = configsRepo.findByTwinId(config.twin_id);

    if (!currentConfig) {
      await ctx.reply(CONFIG_GONE_REPLY);
      return;
    }

    if (currentConfig.paired_owner_telegram_user_id === null) {
      await ctx.reply(UNPAIRED_REPLY);
      return;
    }

    if (currentConfig.paired_owner_telegram_user_id !== ctx.from.id) {
      await ctx.reply(PAIRED_BUT_DIFFERENT_USER_REPLY);
      return;
    }

    // State 4: Paired owner — route to LLM via TwinService.chat() Owner-
    // Bypass. Twin-Profile-Lookup für Handle + Owner-User-ID, weil der
    // MessageRouter beides für die Conversation-Tripel-Resolution braucht.
    const profile = profilesRepo.findById(currentConfig.twin_id);
    if (!profile || !profile.ownerUserId) {
      await ctx.reply(TWIN_PROFILE_GONE_REPLY);
      return;
    }

    await messageRouter.handleInboundOwnerMessage({
      config: currentConfig,
      twinHandle: profile.handle,
      ownerUserId: profile.ownerUserId,
      chatId: ctx.chat.id,
      telegramMessageId: ctx.message.message_id,
      text: ctx.message.text,
      ctx,
      logger,
    });
  });

  // ─── Globaler Error-Catch ───────────────────────────────────────────────
  // Telegraf re-wirft sonst, was im Polling-Mode den Bot abreißt und im
  // Webhook-Mode 500er an Telegram zurückgibt. Log + swallow ist hier
  // robuster — einzelne Update-Failures sollen den Bot-Lifecycle nicht killen.
  bot.catch((err, ctx) => {
    const userId = ctx.from?.id ?? "unknown";
    const updateType = ctx.updateType ?? "unknown";
    const message =
      err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    if (logger) {
      logger.error(
        { twin_id: config.twin_id, user_id: userId, update_type: updateType, err: message },
        "[telegram-bot] handler-error",
      );
    } else {
      console.error(
        `[telegram-bot ${config.twin_id}] handler error (user=${userId}, update=${updateType}): ${message}`,
      );
    }
  });

  return bot;
}
