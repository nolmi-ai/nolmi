import type { AuditEntry } from "@nolmi/shared";
import type { BridgeMessageType } from "../bridge/types.js";
import type { BridgeMessage } from "../bridge/types.js";

// ─── CONVERSATION MERGE (2.5.4.3) ────────────────────────────────────────────
//
// Bridge-Messages sind Source-of-Truth für den symmetrischen Conversation-
// Verlauf — beide Seiten sehen dieselbe Sequenz. Audit-Einträge des LOKALEN
// Twins reichern jede Message mit lokalem Wissen an: welche Capability hat
// die Aktion ausgelöst, welcher Status, ob bereits gelesen.
//
// Match-Logic:
//   - Sender-Pfad → audit.output.sentMessageId === message.id
//     (wir haben die Message rausgeschickt, der Audit hält die Bridge-ID)
//   - Receiver-Pfad → audit.input.bridgeMessageId === message.id
//     (wir haben die Message empfangen, der Audit hält die Bridge-ID)
//
// Reichern an: capability, status, readAt, auditId.

export interface MergedMessage {
  bridgeMessageId: string;
  direction: "sent" | "received";
  content: string;
  createdAt: string;
  inReplyTo: string | null;
  messageType: BridgeMessageType;
  auditCapability: string | null;
  auditStatus: AuditEntry["status"] | null;
  readAt: string | null;
  /** Audit-ID, falls gefunden — Frontend nutzt das für mark-read. */
  auditId: string | null;
}

/**
 * Merged Bridge-Messages (chronologisch ASC) mit den passenden Audits des
 * lokalen Twins. `ownHandle` bestimmt die Direction: from=us → "sent".
 *
 * Performance-Hinweis: Die Index-Maps werden einmal pro Aufruf aufgebaut,
 * danach jeweils O(1)-Lookup pro Message. Bei wachsendem Audit-Volumen
 * sollte man die Audit-Liste direkt im Caller per indizierter Query
 * einschränken statt hier zu filtern.
 */
export function mergeAuditIntoBridgeMessages(
  messages: BridgeMessage[],
  audits: AuditEntry[],
  ownHandle: string,
): MergedMessage[] {
  const ownLower = ownHandle.toLowerCase();

  // Index aufbauen: bridgeMessageId → Audit. Bevorzuge per Match-Pfad,
  // damit ein doppelter Sender-Audit nicht versehentlich einen Empfänger-
  // Audit überschreibt — wir tracken Sender und Receiver separat.
  const sentIndex = new Map<string, AuditEntry>();
  const receivedIndex = new Map<string, AuditEntry>();

  for (const a of audits) {
    const out = a.output as { sentMessageId?: string } | null;
    const inp = a.input as { bridgeMessageId?: string };
    if (out?.sentMessageId) {
      // Bei mehreren Audits zur selben Bridge-ID gewinnt der jüngste
      // (executed nach pending). Vorgeordnet ist das Repo bereits DESC.
      if (!sentIndex.has(out.sentMessageId)) sentIndex.set(out.sentMessageId, a);
    }
    if (inp?.bridgeMessageId) {
      if (!receivedIndex.has(inp.bridgeMessageId))
        receivedIndex.set(inp.bridgeMessageId, a);
    }
  }

  return messages.map((m) => {
    const fromUs = m.fromHandle.toLowerCase() === ownLower;
    const direction: "sent" | "received" = fromUs ? "sent" : "received";
    const audit = fromUs ? sentIndex.get(m.id) : receivedIndex.get(m.id);
    return {
      bridgeMessageId: m.id,
      direction,
      content: m.content,
      createdAt: m.createdAt,
      inReplyTo: m.inReplyTo,
      messageType: m.messageType,
      auditCapability: audit?.capability ?? null,
      auditStatus: audit?.status ?? null,
      readAt: audit?.readAt ?? null,
      auditId: audit?.id ?? null,
    };
  });
}
