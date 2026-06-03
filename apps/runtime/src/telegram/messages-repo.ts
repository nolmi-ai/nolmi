import type Database from "better-sqlite3";
import { nanoid } from "nanoid";

// ─── TELEGRAM-MESSAGES REPOSITORY (#130 Phase 1) ─────────────────────────────
//
// Persistenz von Inbound + Outbound Telegram-Messages, FK auf existing
// `conversations`-Tabelle für Cross-Channel-Threading. Eine Conversation kann
// Telegram-Messages und Web-Messages gleichzeitig halten — Cross-Channel-Demo-
// Story aus 130-TELEGRAM-STRATEGY §g.
//
// Threading-Logik (Phase 3, Message-Routing) macht Conversation-Resolution
// per Owner+Twin+Partner und setzt `conversation_id` beim Insert oder
// nachträglich via `linkToConversation`. Phase 1 ist reine Persistenz —
// Caller-Responsibility.

export interface TelegramMessageRow {
  id: string;
  twin_id: string;
  telegram_chat_id: number;
  telegram_message_id: number;
  conversation_id: string | null;
  direction: "inbound" | "outbound";
  text: string;
  sent_at: string;
}

export interface TelegramMessageInsert {
  twin_id: string;
  telegram_chat_id: number;
  telegram_message_id: number;
  conversation_id?: string | null;
  direction: "inbound" | "outbound";
  text: string;
}

export interface TelegramMessageListOptions {
  /** Max rows. Default: 50. */
  limit?: number;
  /** Cursor: `sent_at`-ISO-String, returns rows strictly before. */
  before?: string;
}

export class TelegramMessageNotFoundError extends Error {
  constructor(identifier: string) {
    super(`Telegram-Message '${identifier}' nicht gefunden`);
    this.name = "TelegramMessageNotFoundError";
  }
}

export class TelegramMessagesRepo {
  constructor(private db: Database.Database) {}

  /**
   * Insert einer Inbound- oder Outbound-Message. ID und `sent_at` werden
   * Repo-seitig gesetzt. UNIQUE(twin_id, telegram_chat_id, telegram_message_id)
   * verhindert Duplikate bei Telegram-Webhook-Retries (Telegram retried bei
   * non-200 und liefert Updates ausdrücklich „best effort, may deliver more
   * than once").
   *
   * Idempotent via `ON CONFLICT(twin_id, telegram_chat_id, telegram_message_id)
   * DO NOTHING`: eine doppelt zugestellte Message wirft NICHT mehr, sondern
   * wird übersprungen. Erst- und Wiederzustellung verhalten sich identisch —
   * beide geben die (jetzt oder früher) gespeicherte Row zurück. Bei
   * Konflikt (changes === 0) liefert die generierte `id` keine Row; wir holen
   * dann die existierende Row über das UNIQUE-Tripel statt blind auf `id` zu
   * suchen (sonst wäre der UNIQUE-Throw nur zu einem NotFound-Throw verschoben).
   */
  insert(input: TelegramMessageInsert): TelegramMessageRow {
    const id = `tg_msg_${nanoid(16)}`;
    const sent_at = new Date().toISOString();

    const result = this.db
      .prepare(
        `INSERT INTO telegram_messages
           (id, twin_id, telegram_chat_id, telegram_message_id,
            conversation_id, direction, text, sent_at)
         VALUES
           (@id, @twin_id, @telegram_chat_id, @telegram_message_id,
            @conversation_id, @direction, @text, @sent_at)
         ON CONFLICT(twin_id, telegram_chat_id, telegram_message_id)
           DO NOTHING`,
      )
      .run({
        id,
        twin_id: input.twin_id,
        telegram_chat_id: input.telegram_chat_id,
        telegram_message_id: input.telegram_message_id,
        conversation_id: input.conversation_id ?? null,
        direction: input.direction,
        text: input.text,
        sent_at,
      });

    // changes === 0 → Konflikt griff (Telegram-Redelivery): die existierende
    // Row über das UNIQUE-Tripel zurückgeben, nicht über die nie-geschriebene id.
    if (result.changes === 0) {
      return this.findByUniqueTripleOrThrow(
        input.twin_id,
        input.telegram_chat_id,
        input.telegram_message_id,
      );
    }

    return this.findByIdOrThrow(id);
  }

  findById(id: string): TelegramMessageRow | null {
    const row = this.db
      .prepare(`SELECT * FROM telegram_messages WHERE id = ?`)
      .get(id) as TelegramMessageRow | undefined;
    return row ?? null;
  }

  /**
   * Listet Messages für einen Twin (alle Chats), neueste zuerst. Mit
   * `before`-Cursor für Pagination — Caller paginiert über `sent_at`.
   */
  findByTwinId(
    twin_id: string,
    options: TelegramMessageListOptions = {},
  ): TelegramMessageRow[] {
    const limit = options.limit ?? 50;
    if (options.before) {
      return this.db
        .prepare(
          `SELECT * FROM telegram_messages
           WHERE twin_id = ? AND sent_at < ?
           ORDER BY sent_at DESC
           LIMIT ?`,
        )
        .all(twin_id, options.before, limit) as TelegramMessageRow[];
    }
    return this.db
      .prepare(
        `SELECT * FROM telegram_messages
         WHERE twin_id = ?
         ORDER BY sent_at DESC
         LIMIT ?`,
      )
      .all(twin_id, limit) as TelegramMessageRow[];
  }

  /**
   * Listet alle Messages einer Conversation, in Sende-Reihenfolge (älteste
   * zuerst). Pendant zum existing Conversation-View — Phase 4 UI rendert
   * Telegram + Web in einer chronologisch sortierten Liste.
   */
  findByConversationId(conversation_id: string): TelegramMessageRow[] {
    return this.db
      .prepare(
        `SELECT * FROM telegram_messages
         WHERE conversation_id = ?
         ORDER BY sent_at ASC`,
      )
      .all(conversation_id) as TelegramMessageRow[];
  }

  /**
   * Verknüpft eine Telegram-Message nachträglich mit einer Conversation.
   * Use-Case: Conversation-Resolution in Phase 3 entscheidet erst nach
   * Insert, welche Conversation passt (z.B. existing aktive vs. neu starten).
   */
  linkToConversation(message_id: string, conversation_id: string): void {
    const result = this.db
      .prepare(
        `UPDATE telegram_messages
           SET conversation_id = ?
         WHERE id = ?`,
      )
      .run(conversation_id, message_id);

    if (result.changes === 0) {
      throw new TelegramMessageNotFoundError(message_id);
    }
  }

  private findByIdOrThrow(id: string): TelegramMessageRow {
    const row = this.findById(id);
    if (!row) throw new TelegramMessageNotFoundError(id);
    return row;
  }

  /**
   * Holt die Row über das UNIQUE-Tripel — der changes===0-Pfad in `insert()`,
   * wenn `ON CONFLICT DO NOTHING` gegriffen hat. Die Row MUSS existieren (der
   * Konflikt beweist es), deshalb Throw als Sanity-Guard statt null.
   */
  private findByUniqueTripleOrThrow(
    twin_id: string,
    telegram_chat_id: number,
    telegram_message_id: number,
  ): TelegramMessageRow {
    const row = this.db
      .prepare(
        `SELECT * FROM telegram_messages
         WHERE twin_id = ?
           AND telegram_chat_id = ?
           AND telegram_message_id = ?`,
      )
      .get(twin_id, telegram_chat_id, telegram_message_id) as
      | TelegramMessageRow
      | undefined;
    if (!row) {
      throw new TelegramMessageNotFoundError(
        `${twin_id}/${telegram_chat_id}/${telegram_message_id}`,
      );
    }
    return row;
  }
}
