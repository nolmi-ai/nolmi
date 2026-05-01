import type { Message } from "./messages-repo.js";

// ─── DELIVERY HUB ────────────────────────────────────────────────────────────
//
// In-Memory Map: handle → SSE-Send-Funktion. Eine Connection pro Twin reicht
// für Phase 2 (ein Runtime pro Twin). Wenn ein Twin mehrfach connected, gewinnt
// der jüngste Subscriber, der vorherige bekommt einen `replaced`-Event und
// wird abgemeldet.
//
// Push ist Best-Effort: das tatsächliche `delivered_at` wird erst durch einen
// expliziten `/messages/:id/ack` vom Empfänger gesetzt. So behält der
// Empfänger-Twin die Kontrolle, wann er bestätigt.

export type DeliveryEvent =
  | { type: "message"; payload: Message }
  | { type: "heartbeat"; payload: { timestamp: string } }
  | { type: "replaced"; payload: { reason: string } };

export type Sender = (event: DeliveryEvent) => void;

interface Subscription {
  send: Sender;
}

export class DeliveryHub {
  private subscribers = new Map<string, Subscription>();

  register(handle: string, send: Sender): () => void {
    const previous = this.subscribers.get(handle);
    if (previous) {
      try {
        previous.send({
          type: "replaced",
          payload: { reason: "Neue Connection für diesen Handle" },
        });
      } catch {
        // Vorherige Connection ist eh hin — egal.
      }
    }
    const sub: Subscription = { send };
    this.subscribers.set(handle, sub);

    return () => {
      // Nur abmelden, wenn wir noch der aktive Subscriber sind. Sonst hat
      // schon eine neuere Connection übernommen und sich selbst eingetragen.
      if (this.subscribers.get(handle) === sub) {
        this.subscribers.delete(handle);
      }
    };
  }

  isOnline(handle: string): boolean {
    return this.subscribers.has(handle);
  }

  // Push an einen einzelnen Empfänger. Liefert `true` zurück, wenn jemand
  // zugehört hat. Listener-Fehler werden geschluckt — die Bridge soll wegen
  // einer abgebrochenen SSE-Connection nicht crashen.
  push(handle: string, event: DeliveryEvent): boolean {
    const sub = this.subscribers.get(handle);
    if (!sub) return false;
    try {
      sub.send(event);
      return true;
    } catch (err) {
      console.error(`[delivery] push an ${handle} fehlgeschlagen:`, err);
      this.subscribers.delete(handle);
      return false;
    }
  }

  onlineHandles(): string[] {
    return [...this.subscribers.keys()];
  }

  size(): number {
    return this.subscribers.size;
  }
}
