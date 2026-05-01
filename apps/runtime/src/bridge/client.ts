import type { FastifyBaseLogger } from "fastify";
import type { BridgeConfig, BridgeMessage } from "./types.js";

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
    inReplyTo?: string | null;
  }): Promise<{ messageId: string }> {
    const endpoint = "/messages";
    this.logger?.info(
      { to: opts.to, inReplyTo: opts.inReplyTo ?? null },
      "[bridge] sendMessage",
    );
    const res = await fetch(`${this.config.url}${endpoint}`, {
      method: "POST",
      headers: this.headers({ json: true }),
      body: JSON.stringify({
        to: opts.to,
        content: opts.content,
        inReplyTo: opts.inReplyTo ?? null,
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
    return body.messages;
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
