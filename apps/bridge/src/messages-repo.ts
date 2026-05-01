import { nanoid } from "nanoid";
import type { Db } from "./db.js";

// ─── MESSAGES REPO ───────────────────────────────────────────────────────────
//
// Inbox-Persistenz für die Bridge. Jede Nachricht wird sofort beim Senden
// geschrieben — auch wenn der Empfänger gerade offline ist. `delivered_at`
// bleibt NULL bis der Empfänger via POST /messages/:id/ack bestätigt.
//
// Liefer-Semantik bewusst empfänger-getrieben: SSE-Push ist nur Best-Effort,
// die Wahrheit über Zustellung steht in der Tabelle.

export interface Message {
  id: string;
  fromHandle: string;
  toHandle: string;
  content: string;
  inReplyTo: string | null;
  createdAt: string;
  deliveredAt: string | null;
}

interface MessageRow {
  id: string;
  from_handle: string;
  to_handle: string;
  content: string;
  in_reply_to: string | null;
  created_at: string;
  delivered_at: string | null;
}

export class MessagesRepo {
  constructor(private db: Db) {}

  create(opts: {
    fromHandle: string;
    toHandle: string;
    content: string;
    inReplyTo: string | null;
  }): Message {
    const message: Message = {
      id: `msg_${nanoid(16)}`,
      fromHandle: opts.fromHandle,
      toHandle: opts.toHandle,
      content: opts.content,
      inReplyTo: opts.inReplyTo,
      createdAt: new Date().toISOString(),
      deliveredAt: null,
    };
    this.db
      .prepare(
        `INSERT INTO messages
           (id, from_handle, to_handle, content, in_reply_to, created_at, delivered_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        message.id,
        message.fromHandle,
        message.toHandle,
        message.content,
        message.inReplyTo,
        message.createdAt,
        message.deliveredAt,
      );
    return message;
  }

  get(id: string): Message | null {
    const row = this.db
      .prepare("SELECT * FROM messages WHERE id = ?")
      .get(id) as MessageRow | undefined;
    return row ? rowToMessage(row) : null;
  }

  // Liefert alle noch nicht zugestellten Nachrichten für einen Empfänger.
  // `since` ist optional und filtert zusätzlich auf created_at >= since
  // (für Catch-up nach Reconnect, falls der Empfänger schon einen Zeitstempel
  // kennt aber den Ack noch nicht abgesetzt hat).
  listForRecipient(toHandle: string, since?: string): Message[] {
    const rows = since
      ? (this.db
          .prepare(
            `SELECT * FROM messages
             WHERE to_handle = ? AND delivered_at IS NULL AND created_at >= ?
             ORDER BY created_at ASC`,
          )
          .all(toHandle, since) as MessageRow[])
      : (this.db
          .prepare(
            `SELECT * FROM messages
             WHERE to_handle = ? AND delivered_at IS NULL
             ORDER BY created_at ASC`,
          )
          .all(toHandle) as MessageRow[]);
    return rows.map(rowToMessage);
  }

  markDelivered(id: string): boolean {
    const result = this.db
      .prepare("UPDATE messages SET delivered_at = ? WHERE id = ? AND delivered_at IS NULL")
      .run(new Date().toISOString(), id);
    return result.changes > 0;
  }
}

function rowToMessage(row: MessageRow): Message {
  return {
    id: row.id,
    fromHandle: row.from_handle,
    toHandle: row.to_handle,
    content: row.content,
    inReplyTo: row.in_reply_to,
    createdAt: row.created_at,
    deliveredAt: row.delivered_at,
  };
}
