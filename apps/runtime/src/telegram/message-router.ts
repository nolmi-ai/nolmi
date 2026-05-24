import type { ChatMessage } from "@twin-lab/shared";
import type { FastifyBaseLogger } from "fastify";
import type {
  TelegramConfigRow,
  TelegramConfigsRepo,
} from "./configs-repo.js";
import type { TelegramMessagesRepo } from "./messages-repo.js";
import type { ConversationsRepo } from "../conversations/repo.js";
import type { TwinServiceRegistry } from "../twin-service-registry.js";
import { markdownToTelegramHtml } from "./markdown-to-telegram-html.js";

// ─── TELEGRAM MESSAGE ROUTER (#130 Phase 3) ─────────────────────────────────
//
// Re-uses TwinService.chat() with the Owner-Bypass path. That single call
// handles Conversation-Resolution, History+Summary-Load, Facts+Episodic-
// Memory-Retrieval, LLM, Audit, and Bus-Events. Telegram-spezifisch sind nur:
//
//   - Inbound + Outbound Persistence in `telegram_messages` (Audit-Trail
//     pro Channel, conversation_id verlinkt mit twin-übergreifender Conv)
//   - persistentChatAction für Typing-Indicator während LLM-Latenz
//   - Message-Splitting auf Telegram's 4096-Char-Limit
//     (wir nutzen 3500 als Sicherheits-Puffer für Emoji-Multi-Byte und
//     leichte Variation)
//   - Error-Fallback: User-facing Reply ohne Throw, sonst killt der Telegraf-
//     bot.catch das Update (Telegram-Webhook braucht schnelles 200)
//
// Cross-Channel-Memory ergibt sich aus dem Owner-Bypass: dieselbe
// Conversation-Tripel wie Web-Chat (owner=ownerUserId, partner=@<twin-handle>,
// twin=twin_id), also fließen Telegram-Messages und Web-Chat-Messages in eine
// gemeinsame Konversation. Memory-Retrieval läuft channel-agnostisch.

const MAX_MESSAGE_CHARS = 3500;
const TYPING_INTERVAL_MS = 4000;

/**
 * Minimal Telegraf-Context-Surface, die der Router braucht. Bewusst klein
 * gehalten, damit das Smoke-Script den Router ohne echte Telegraf-Instanz
 * testen kann.
 *
 * #130 Phase 3 Markdown: `reply` akzeptiert optional `parse_mode: 'HTML'`,
 * damit der Router das marked-konvertierte Telegram-HTML-Subset zustellen
 * kann. Telegraf-`ctx.reply` hat passend dazu eine ExtraReplyMessage-Signatur
 * (siehe node_modules/telegraf/typings/context.d.ts:132).
 */
export interface TelegramReplyContext {
  reply(
    text: string,
    extra?: { parse_mode?: "HTML" },
  ): Promise<{ message_id: number }>;
  persistentChatAction(
    action: "typing",
    callback: () => Promise<void>,
    opts?: { intervalDuration?: number },
  ): Promise<unknown>;
}

const FALLBACK_ERROR_REPLY =
  "Entschuldigung, da ist gerade etwas schief gelaufen. Bitte versuche es " +
  "nochmal.";

const TWIN_NOT_FOUND_REPLY =
  "Twin configuration error. Please contact the owner.";

export class TelegramMessageRouter {
  constructor(
    private configsRepo: TelegramConfigsRepo,
    private messagesRepo: TelegramMessagesRepo,
    private conversationsRepo: ConversationsRepo,
    private registry: TwinServiceRegistry,
  ) {}

  /**
   * Handle an inbound text message from the paired Telegram-Owner. Caller
   * (Telegraf text-handler) hat schon verifiziert:
   *   - currentConfig existiert
   *   - paired_owner_telegram_user_id !== null
   *   - paired_owner_telegram_user_id === ctx.from.id
   *
   * Wir bekommen also den authorisierten Owner-Pfad. Methode wirft nicht —
   * Errors landen in einer User-facing Reply + Logger.
   */
  async handleInboundOwnerMessage(args: {
    config: TelegramConfigRow;
    twinHandle: string;
    ownerUserId: string;
    chatId: number;
    telegramMessageId: number;
    text: string;
    ctx: TelegramReplyContext;
    logger?: FastifyBaseLogger;
  }): Promise<void> {
    const {
      config,
      twinHandle,
      ownerUserId,
      chatId,
      telegramMessageId,
      text,
      ctx,
      logger,
    } = args;

    // 1. Conversation-ID idempotent resolven — same Tripel die
    // TwinService.chat() intern via getOrStart benutzt. Doppel-Lookup ist
    // billig (existing Conv → Index-Hit), gibt uns aber die ID, mit der wir
    // den Inbound persistieren können bevor der LLM-Call läuft.
    const partnerHandle = twinHandle.startsWith("@")
      ? twinHandle
      : `@${twinHandle}`;
    const conversation = this.conversationsRepo.getOrStart(
      ownerUserId,
      partnerHandle,
      config.twin_id,
    );

    // 2. Inbound Persistence
    this.messagesRepo.insert({
      twin_id: config.twin_id,
      telegram_chat_id: chatId,
      telegram_message_id: telegramMessageId,
      conversation_id: conversation.id,
      direction: "inbound",
      text,
    });

    // 3. Twin-Service-Lookup. registry.getEntry kommt mit Handle (matched
    // existing requireOwner-Pattern); falls Cache-Miss (Twin grade entfernt),
    // sagt der Bot Bescheid statt zu hängen.
    const entry = this.registry.getEntry(partnerHandle);
    if (!entry) {
      await this.tryReply(ctx, TWIN_NOT_FOUND_REPLY, logger);
      return;
    }

    try {
      await ctx.persistentChatAction(
        "typing",
        async () => {
          const messages: ChatMessage[] = [{ role: "user", content: text }];
          const result = await entry.service.chat(messages, {
            requesterUserId: ownerUserId,
            // #130 Phase 3: Channel-Marker landet via runOwnerDirect in
            // audit.input.channel. Frontend (Web-UI Direct-Chat) liest das
            // und rendert den „über Telegram"-Badge unter Message-Bubbles.
            channel: "telegram",
          });

          // Owner-Bypass landet zuverlässig in runOwnerDirect, das `message`
          // immer setzt. Defensive Sanity-Prüfung trotzdem — falls eine
          // andere Capability getriggert wurde (z.B. ein vergessener Pending-
          // Pfad), bekommt der Owner statt Silence eine sichtbare Antwort.
          const replyText = result.message?.content;
          if (!replyText) {
            await this.tryReply(
              ctx,
              "Mein Twin-Service hat keine Antwort geliefert. Das ist ein Bug — bitte melden.",
              logger,
            );
            return;
          }

          const chunks = this.splitMessage(replyText, MAX_MESSAGE_CHARS);
          for (const chunk of chunks) {
            // Markdown → Telegram-HTML-Subset, dann mit parse_mode='HTML'
            // schicken. Bei API-Reject (z.B. unbalanced Tag aus Marker-Glitch)
            // fällt der Catch auf Plain-Markdown-Text zurück — User sieht
            // dann Rohtext, aber Message kommt durch. Persistierter Text
            // bleibt in beiden Fällen das Markdown-Original, damit
            // telegram_messages.text channel-agnostisch wird.
            const html = markdownToTelegramHtml(chunk);
            let sent: { message_id: number };
            try {
              sent = await ctx.reply(html, { parse_mode: "HTML" });
            } catch (err) {
              const msg = err instanceof Error ? err.message : String(err);
              if (logger) {
                logger.warn(
                  { twin_id: config.twin_id, err: msg },
                  "[message-router] HTML reply rejected — Plain-Fallback",
                );
              } else {
                console.warn(
                  `[message-router ${config.twin_id}] HTML reply rejected, Plain-Fallback: ${msg}`,
                );
              }
              sent = await ctx.reply(chunk);
            }
            this.messagesRepo.insert({
              twin_id: config.twin_id,
              telegram_chat_id: chatId,
              telegram_message_id: sent.message_id,
              conversation_id: conversation.id,
              direction: "outbound",
              text: chunk,
            });
          }
        },
        { intervalDuration: TYPING_INTERVAL_MS },
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (logger) {
        logger.error(
          { twin_id: config.twin_id, chat_id: chatId, err: msg },
          "[message-router] LLM or send failed",
        );
      } else {
        console.error(
          `[message-router ${config.twin_id}] LLM or send failed:`,
          msg,
        );
      }
      await this.tryReply(ctx, FALLBACK_ERROR_REPLY, logger);
    }
  }

  /**
   * Splittet langen Text auf Telegram-taugliche Chunks. Paragraph-Boundary
   * zuerst (doppelte Newline), bei einzelnen riesigen Paragraphen Hard-Split
   * auf Satz-Ende (`. `) im hinteren Drittel — sonst mitten im Wort.
   *
   * Pure-Function, leicht für Smoke testbar.
   */
  splitMessage(text: string, maxLength: number): string[] {
    if (text.length <= maxLength) return [text];

    const chunks: string[] = [];
    const paragraphs = text.split(/\n\n+/);

    let currentChunk = "";
    for (const paragraph of paragraphs) {
      const candidate = currentChunk
        ? `${currentChunk}\n\n${paragraph}`
        : paragraph;

      if (candidate.length <= maxLength) {
        currentChunk = candidate;
        continue;
      }

      // Candidate würde Limit sprengen. Aktuellen Chunk flushen, neuen
      // beginnen mit dem Paragraph; wenn der Paragraph selbst zu lang ist,
      // Hard-Split auf Satz-Boundary.
      if (currentChunk) {
        chunks.push(currentChunk);
        currentChunk = "";
      }

      let remaining = paragraph;
      while (remaining.length > maxLength) {
        // Such Satz-Ende im hinteren Drittel (>50% des Max), sonst hard-cut
        // bei maxLength — vermeidet sehr kleine Chunks aus zu kurzen Sätzen
        // am Anfang.
        const splitPoint = remaining.lastIndexOf(". ", maxLength);
        const cutAt =
          splitPoint > maxLength * 0.5 ? splitPoint + 1 : maxLength;
        chunks.push(remaining.substring(0, cutAt).trim());
        remaining = remaining.substring(cutAt).trim();
      }
      currentChunk = remaining;
    }

    if (currentChunk) chunks.push(currentChunk);
    return chunks;
  }

  private async tryReply(
    ctx: TelegramReplyContext,
    text: string,
    logger?: FastifyBaseLogger,
  ): Promise<void> {
    try {
      await ctx.reply(text);
    } catch (err) {
      // Sekundär-Failure ignorieren — wir sind schon im Error-Pfad, ein
      // zweites Throw würde den Telegraf-Update-Cycle killen.
      const msg = err instanceof Error ? err.message : String(err);
      if (logger) logger.warn({ err: msg }, "[message-router] tryReply failed");
      else console.warn("[message-router] tryReply failed:", msg);
    }
  }
}
