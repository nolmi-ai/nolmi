// ─── BRIDGE TYPES ────────────────────────────────────────────────────────────
//
// Shape der Bridge-API aus Sicht des Runtime. Bewusst eng: nur die Felder, die
// der Twin tatsächlich braucht — kein 1:1-Spiegelbild der Bridge-Tabellen.

// Vier präzise message_type-Werte für Empfänger-Verhalten
// (Tag-28-Block-16-Refactor, ersetzt inReplyTo-Heuristik mit lookupSender):
//   "owner-direct"    → Owner schickt via UI direkt an fremden Twin → LLM-Reply
//   "twin-initiated"  → Twin schickt autonom Anfrage → LLM-Reply
//   "twin-reply"      → Twin antwortet auf vorherige Anfrage → reply-received-Audit, kein LLM
//   "system"          → Bridge/Runtime-System-Message → kein LLM
//
// Legacy: "twin" (vor Tag-28-Block-16) ist semantisch äquivalent zu
// "twin-initiated" und wird im receiveBridgeMessage-Switch entsprechend
// normalisiert. Bridge-DB behält alte Rows unverändert.
export type BridgeMessageType =
  | "twin"
  | "system"
  | "owner-direct"
  | "twin-initiated"
  | "twin-reply";

export const BRIDGE_MESSAGE_TYPES: readonly BridgeMessageType[] = [
  "twin",
  "system",
  "owner-direct",
  "twin-initiated",
  "twin-reply",
] as const;

export interface BridgeMessage {
  id: string;             // msg_<nanoid>
  fromHandle: string;     // z.B. "@florian"
  toHandle: string;       // z.B. "@markus"
  content: string;
  inReplyTo: string | null;
  /**
   * Bei alten Bridge-Versionen ohne 002-Migration kann das Feld fehlen — der
   * Client mappt das defensiv auf "twin", damit ein Mix von alten und neuen
   * Messages funktional bleibt.
   */
  messageType: BridgeMessageType;
  createdAt: string;      // ISO timestamp
}

export interface BridgeConfig {
  url: string;            // BRIDGE_URL, z.B. http://127.0.0.1:5100
  handle: string;         // BRIDGE_TWIN_HANDLE, z.B. @markus
  token: string;          // BRIDGE_TWIN_TOKEN
}
