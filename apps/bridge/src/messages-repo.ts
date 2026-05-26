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

// Vier message_type-Werte für Empfänger-Verhalten (Tag-28-Block-16-Refactor):
//   "owner-direct"    → Owner schickt via UI direkt an fremden Twin → LLM-Reply
//   "twin-initiated"  → Twin schickt autonom Anfrage → LLM-Reply
//   "twin-reply"      → Twin antwortet auf vorherige Anfrage → reply-received-Audit, kein LLM
//   "system"          → Bridge/Runtime-System-Message → system-message-received-Audit, kein LLM
//
// Legacy: "twin" (vor Tag-28-Block-16) ist semantisch äquivalent zu
// "twin-initiated" und wird im Receiver-Code-Branch entsprechend normalisiert.
// Bridge-DB-Schema bleibt unverändert — alte Rows behalten "twin", neue Rows
// werden mit den vier präzisen Werten geschrieben.
export type MessageType =
  | "twin"
  | "system"
  | "owner-direct"
  | "twin-initiated"
  | "twin-reply";

export const MESSAGE_TYPES: readonly MessageType[] = [
  "twin",
  "system",
  "owner-direct",
  "twin-initiated",
  "twin-reply",
] as const;

export interface Message {
  id: string;
  fromHandle: string;
  toHandle: string;
  content: string;
  inReplyTo: string | null;
  messageType: MessageType;
  createdAt: string;
  deliveredAt: string | null;
}

interface MessageRow {
  id: string;
  from_handle: string;
  to_handle: string;
  content: string;
  in_reply_to: string | null;
  message_type: string;
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
    messageType?: MessageType;
  }): Message {
    const message: Message = {
      id: `msg_${nanoid(16)}`,
      fromHandle: opts.fromHandle,
      toHandle: opts.toHandle,
      content: opts.content,
      inReplyTo: opts.inReplyTo,
      messageType: opts.messageType ?? "twin",
      createdAt: new Date().toISOString(),
      deliveredAt: null,
    };
    this.db
      .prepare(
        `INSERT INTO messages
           (id, from_handle, to_handle, content, in_reply_to, message_type, created_at, delivered_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        message.id,
        message.fromHandle,
        message.toHandle,
        message.content,
        message.inReplyTo,
        message.messageType,
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

  // Liefert den vollen Bridge-Verlauf zwischen zwei Handles (beide Richtungen),
  // chronologisch ASC. Genutzt von GET /messages/conversation für die
  // symmetrische Conversation-View — beide Seiten sehen dasselbe.
  listConversation(handleA: string, handleB: string): Message[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM messages
         WHERE (from_handle = ? AND to_handle = ?)
            OR (from_handle = ? AND to_handle = ?)
         ORDER BY created_at ASC`,
      )
      .all(handleA, handleB, handleB, handleA) as MessageRow[];
    return rows.map(rowToMessage);
  }
}

function rowToMessage(row: MessageRow): Message {
  // Defensive: nur die in MESSAGE_TYPES whitelisteten Werte sind valid.
  // Alles andere (auch theoretische Legacy-NULL bei alten ALTER-DEFAULTs)
  // fällt auf "twin" zurück. Receiver normalisiert "twin" zu "twin-initiated".
  const type: MessageType = MESSAGE_TYPES.includes(
    row.message_type as MessageType,
  )
    ? (row.message_type as MessageType)
    : "twin";
  return {
    id: row.id,
    fromHandle: row.from_handle,
    toHandle: row.to_handle,
    content: row.content,
    inReplyTo: row.in_reply_to,
    messageType: type,
    createdAt: row.created_at,
    deliveredAt: row.delivered_at,
  };
}
