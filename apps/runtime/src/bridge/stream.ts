import EventSource from "eventsource";
import type { FastifyBaseLogger } from "fastify";
import { BRIDGE_MESSAGE_TYPES, type BridgeConfig, type BridgeMessage } from "./types.js";

// ─── BRIDGE SSE STREAM ───────────────────────────────────────────────────────
//
// Hält eine SSE-Connection zur Bridge offen. Bridge schickt drei Event-Typen
// als JSON über `data: ...`-Lines:
//   - { type: "message",   payload: BridgeMessage }
//   - { type: "heartbeat", payload: { timestamp } }       → ignorieren
//   - { type: "replaced",  payload: { reason } }          → Konflikt, nicht retryen
//
// Reconnect: exponential backoff 1s, 2s, 4s, 8s, …, max 30s. Unbegrenzte
// Retries (außer bei "replaced" — da hat sich jemand anderes als wir mit dem
// gleichen Handle eingeloggt; weiterzumachen wäre falsch).

const INITIAL_BACKOFF_MS = 1_000;
const MAX_BACKOFF_MS = 30_000;

type StreamEvent =
  | { type: "message"; payload: BridgeMessage }
  | { type: "heartbeat"; payload: { timestamp: string } }
  | { type: "replaced"; payload: { reason: string } };

export class BridgeStream {
  private es: EventSource | null = null;
  private backoffMs = INITIAL_BACKOFF_MS;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private stopped = false;

  constructor(
    private readonly config: BridgeConfig,
    private readonly onMessage: (msg: BridgeMessage) => void,
    private readonly logger?: FastifyBaseLogger,
  ) {}

  connect(): void {
    if (this.stopped) {
      this.logger?.warn("[bridge:stream] connect() nach disconnect() — ignoriere");
      return;
    }
    if (this.es) return;

    const url = `${this.config.url}/stream`;
    this.logger?.info({ url }, "[bridge:stream] verbinde");

    const es = new EventSource(url, {
      headers: { Authorization: `Bearer ${this.config.token}` },
    });
    this.es = es;

    es.onopen = () => {
      this.backoffMs = INITIAL_BACKOFF_MS;
      this.logger?.info("[bridge:stream] verbunden");
    };

    es.onmessage = (event) => {
      try {
        const parsed = JSON.parse(event.data) as StreamEvent;
        this.handleEvent(parsed);
      } catch (err) {
        this.logger?.error({ err, raw: event.data }, "[bridge:stream] unparsbares Event");
      }
    };

    es.onerror = () => {
      // EventSource feuert error sowohl bei initialem Connect-Fail als auch bei
      // späterem Disconnect. In beiden Fällen: bestehende Connection abbauen,
      // selbst nach Backoff neu öffnen. Wir setzen reconnect aber nicht doppelt
      // an, falls onerror mehrfach feuert.
      if (this.stopped) return;
      this.logger?.warn(
        { backoffMs: this.backoffMs },
        "[bridge:stream] Verbindung verloren — Reconnect geplant",
      );
      this.teardownEs();
      this.scheduleReconnect();
    };
  }

  disconnect(): void {
    this.stopped = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.teardownEs();
    this.logger?.info("[bridge:stream] disconnected");
  }

  // ─── intern ──────────────────────────────────────────────────────────────

  private handleEvent(event: StreamEvent): void {
    switch (event.type) {
      case "message":
        if (event.payload?.id) {
          // Defensive Normalisierung — alte Bridge-Versionen ohne 002-Migration
          // schicken messageType evtl. gar nicht. Gleiche Logik wie in
          // getInbox(); nur whitelisted Werte durchlassen, alles andere fällt
          // auf "twin" zurück. Receiver normalisiert "twin" → "twin-initiated".
          const normalized = {
            ...event.payload,
            messageType: BRIDGE_MESSAGE_TYPES.includes(event.payload.messageType)
              ? event.payload.messageType
              : "twin",
          };
          this.onMessage(normalized);
        } else {
          this.logger?.warn({ event }, "[bridge:stream] message ohne payload.id");
        }
        return;
      case "heartbeat":
        return;
      case "replaced":
        this.logger?.warn(
          { reason: event.payload?.reason },
          "[bridge:stream] Connection von anderer Instanz übernommen — Konflikt, kein Reconnect",
        );
        this.disconnect();
        return;
      default:
        this.logger?.warn({ event }, "[bridge:stream] unbekannter Event-Typ");
    }
  }

  private teardownEs(): void {
    if (!this.es) return;
    try {
      this.es.close();
    } catch {
      // close() darf nicht crashen
    }
    this.es = null;
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer || this.stopped) return;
    const delay = this.backoffMs;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.backoffMs = Math.min(this.backoffMs * 2, MAX_BACKOFF_MS);
      this.logger?.info({ delay }, "[bridge:stream] Reconnect-Versuch");
      this.connect();
    }, delay);
  }
}
