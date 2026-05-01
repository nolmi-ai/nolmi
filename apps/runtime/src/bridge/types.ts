// ─── BRIDGE TYPES ────────────────────────────────────────────────────────────
//
// Shape der Bridge-API aus Sicht des Runtime. Bewusst eng: nur die Felder, die
// der Twin tatsächlich braucht — kein 1:1-Spiegelbild der Bridge-Tabellen.

export interface BridgeMessage {
  id: string;             // msg_<nanoid>
  fromHandle: string;     // z.B. "@florian"
  toHandle: string;       // z.B. "@markus"
  content: string;
  inReplyTo: string | null;
  createdAt: string;      // ISO timestamp
}

export interface BridgeConfig {
  url: string;            // BRIDGE_URL, z.B. http://127.0.0.1:5100
  handle: string;         // BRIDGE_TWIN_HANDLE, z.B. @markus
  token: string;          // BRIDGE_TWIN_TOKEN
}
