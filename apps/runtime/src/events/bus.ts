import type { TwinEvent } from "@nolmi/shared";

// ─── EVENT BUS ───────────────────────────────────────────────────────────────
//
// Einfacher in-process Pub/Sub. Reicht für Phase 1 (single-process).
// Wenn der Runtime später skaliert oder dezentral wird, ersetzen wir das durch
// Redis-Pub/Sub oder einen externen Event-Bus.

type Listener = (event: TwinEvent) => void;

export class EventBus {
  private listeners = new Set<Listener>();

  emit(event: TwinEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (err) {
        // Listener-Fehler dürfen den Bus nicht zum Stehen bringen
        console.error("[EventBus] listener error:", err);
      }
    }
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  size(): number {
    return this.listeners.size;
  }
}
