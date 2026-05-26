import type { FastifyBaseLogger } from "fastify";
import {
  BRIDGE_MESSAGE_TYPES,
  type BridgeConfig,
  type BridgeMessage,
  type BridgeMessageType,
} from "./types.js";

// ─── BRIDGE HTTP CLIENT ──────────────────────────────────────────────────────
//
// Schmaler Wrapper um die HTTP-Endpoints der Bridge. SSE ist separat in
// `stream.ts`. Logging läuft über den gleichen pino-Logger wie der Rest des
// Runtime — wird vom Aufrufer reingereicht (Fastify-Logger).

export class BridgeError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly endpoint: string,
  ) {
    super(message);
    this.name = "BridgeError";
  }
}

export class BridgeClient {
  constructor(
    private readonly config: BridgeConfig,
    private readonly logger?: FastifyBaseLogger,
  ) {}

  get handle(): string {
    return this.config.handle;
  }

  get url(): string {
    return this.config.url;
  }

  async sendMessage(opts: {
    to: string;
    content: string;
    /** Reserviert für künftiges Quote-Reply-Feature. Empfänger-Verhalten wird
     *  seit Tag-28-Block-16 über `messageType` ausgewertet, nicht mehr über
     *  `inReplyTo`-Heuristik mit Bridge-Lookup. */
    inReplyTo?: string | null;
    /** Default "twin-initiated". "owner-direct" für UI-Sends durch Owner,
     *  "twin-reply" für Antworten auf eingehende Twin-Messages, "system"
     *  für Wartemeldung/Reject. Vier Werte sind Single-Source-of-Truth für
     *  das Empfänger-Verhalten (Tag-28-Block-16-Refactor). */
    messageType?: BridgeMessageType;
  }): Promise<{ messageId: string }> {
    const endpoint = "/messages";
    const messageType = opts.messageType ?? "twin-initiated";
    this.logger?.info(
      { to: opts.to, inReplyTo: opts.inReplyTo ?? null, messageType },
      "[bridge] sendMessage",
    );
    const res = await fetch(`${this.config.url}${endpoint}`, {
      method: "POST",
      headers: this.headers({ json: true }),
      body: JSON.stringify({
        to: opts.to,
        content: opts.content,
        inReplyTo: opts.inReplyTo ?? null,
        messageType,
      }),
    });
    if (!res.ok) throw await this.toError(res, endpoint);
    const body = (await res.json()) as { ok: boolean; messageId: string };
    return { messageId: body.messageId };
  }

  async getInbox(since?: string): Promise<BridgeMessage[]> {
    const endpoint = since
      ? `/messages/inbox?since=${encodeURIComponent(since)}`
      : "/messages/inbox";
    this.logger?.info({ since: since ?? null }, "[bridge] getInbox");
    const res = await fetch(`${this.config.url}${endpoint}`, {
      method: "GET",
      headers: this.headers(),
    });
    if (!res.ok) throw await this.toError(res, endpoint);
    const body = (await res.json()) as { messages: BridgeMessage[] };
    // Defensive: alte Bridge-Versionen liefern messageType evtl. nicht.
    // Default-Mapping auf "twin" damit Type-Property garantiert existiert.
    // Defensive: nur whitelisted Werte durchlassen, alles andere
    // (alte Bridges ohne Tag-28-Block-16-Update) fällt auf "twin" zurück.
    // Receiver normalisiert "twin" zu "twin-initiated".
    return body.messages.map((m) => ({
      ...m,
      messageType: BRIDGE_MESSAGE_TYPES.includes(m.messageType)
        ? m.messageType
        : "twin",
    }));
  }

  /**
   * @deprecated Tag-28-Block-16: Empfänger-Verhalten wird jetzt über
   * `messageType` ausgewertet (vier Werte: owner-direct, twin-initiated,
   * twin-reply, system), nicht mehr über `inReplyTo`-Lookup gegen die Bridge.
   * Diese Methode bleibt definiert für ein künftiges Quote-Reply-Feature
   * (Cross-Ref: BACKLOG-Item bei Aktivierung). Aktuell keine Production-
   * Caller — receiveBridgeMessage's alter Reply-Detection-Branch ist raus.
   *
   * Holt zu einer messageId den ursprünglichen Absender (Bridge-Lookup).
   * Returns null bei 404. Network-Errors werfen.
   */
  async lookupSender(
    messageId: string,
  ): Promise<{ fromHandle: string; toHandle: string; createdAt: string } | null> {
    const endpoint = `/messages/${messageId}/sender`;
    const res = await fetch(`${this.config.url}${endpoint}`, {
      method: "GET",
      headers: this.headers(),
    });
    if (res.status === 404) return null;
    if (!res.ok) throw await this.toError(res, endpoint);
    const body = (await res.json()) as {
      id: string;
      fromHandle: string;
      toHandle: string;
      createdAt: string;
    };
    return {
      fromHandle: body.fromHandle,
      toHandle: body.toHandle,
      createdAt: body.createdAt,
    };
  }

  /**
   * Holt den vollen Bridge-Verlauf zwischen uns und `partner`. Beide
   * Richtungen, chronologisch ASC. Genutzt von 2.5.4.3 für symmetrische
   * Conversation-View, sodass beide Seiten dieselben Messages sehen.
   *
   * Auth über unseren Twin-Token — die Bridge gibt nur Conversations zurück,
   * an denen wir selbst Teilnehmer sind.
   */
  async getConversationMessages(partner: string): Promise<BridgeMessage[]> {
    const endpoint = `/messages/conversation?with=${encodeURIComponent(partner)}`;
    this.logger?.info({ partner }, "[bridge] getConversationMessages");
    const res = await fetch(`${this.config.url}${endpoint}`, {
      method: "GET",
      headers: this.headers(),
    });
    if (!res.ok) throw await this.toError(res, endpoint);
    const body = (await res.json()) as { messages: BridgeMessage[] };
    // Defensive: nur whitelisted Werte durchlassen, alles andere
    // (alte Bridges ohne Tag-28-Block-16-Update) fällt auf "twin" zurück.
    // Receiver normalisiert "twin" zu "twin-initiated".
    return body.messages.map((m) => ({
      ...m,
      messageType: BRIDGE_MESSAGE_TYPES.includes(m.messageType)
        ? m.messageType
        : "twin",
    }));
  }

  async acknowledge(messageId: string): Promise<void> {
    const endpoint = `/messages/${messageId}/ack`;
    this.logger?.info({ messageId }, "[bridge] acknowledge");
    const res = await fetch(`${this.config.url}${endpoint}`, {
      method: "POST",
      headers: this.headers(),
    });
    if (!res.ok) throw await this.toError(res, endpoint);
  }

  // ─── intern ──────────────────────────────────────────────────────────────

  private headers(opts: { json?: boolean } = {}): Record<string, string> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.config.token}`,
    };
    if (opts.json) headers["Content-Type"] = "application/json";
    return headers;
  }

  private async toError(res: Response, endpoint: string): Promise<BridgeError> {
    let detail = "";
    try {
      const body = (await res.json()) as { error?: string };
      detail = body.error ?? "";
    } catch {
      try {
        detail = await res.text();
      } catch {
        detail = "";
      }
    }
    const message = detail
      ? `Bridge ${endpoint} → HTTP ${res.status}: ${detail}`
      : `Bridge ${endpoint} → HTTP ${res.status}`;
    this.logger?.error({ status: res.status, endpoint, detail }, "[bridge] HTTP-Fehler");
    return new BridgeError(message, res.status, endpoint);
  }
}
