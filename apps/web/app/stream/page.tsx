"use client";

import { useEffect, useState } from "react";
import type { TwinEvent } from "@twin-lab/shared";

const RUNTIME_URL = process.env.NEXT_PUBLIC_RUNTIME_URL ?? "http://127.0.0.1:4000";

interface StreamItem {
  id: string;
  timestamp: string;
  label: string;
  detail: string;
  status: "info" | "active" | "ok" | "warn";
}

export default function StreamPage() {
  const [items, setItems] = useState<StreamItem[]>([]);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    const source = new EventSource(`${RUNTIME_URL}/stream`);
    source.onopen = () => setConnected(true);
    source.onerror = () => setConnected(false);
    source.onmessage = (event) => {
      try {
        const parsed = JSON.parse(event.data) as TwinEvent;
        const item = mapEventToItem(parsed);
        if (item) {
          setItems((current) => [item, ...current].slice(0, 100));
        }
      } catch {
        // ignore malformed events
      }
    };

    return () => source.close();
  }, []);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-text">Stream</h1>
        <div
          className={`text-xs px-2 py-0.5 rounded border ${
            connected
              ? "border-accent text-accent"
              : "border-warn text-warn"
          }`}
        >
          {connected ? "● live" : "○ disconnected"}
        </div>
      </div>

      <div className="bg-surface border border-border rounded">
        {items.length === 0 ? (
          <div className="p-6 text-sm text-muted">
            Wartet auf Twin-Aktivität. Schick eine Nachricht im Chat-Tab, dann
            siehst du hier den Verlauf.
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {items.map((item) => (
              <li key={item.id} className="p-3 flex gap-3">
                <span
                  className={`mt-1 w-2 h-2 rounded-full flex-shrink-0 ${
                    item.status === "active"
                      ? "bg-accent animate-pulse"
                      : item.status === "ok"
                      ? "bg-accent"
                      : item.status === "warn"
                      ? "bg-warn"
                      : "bg-muted"
                  }`}
                />
                <div className="flex-1 min-w-0">
                  <div className="text-xs text-muted">
                    {new Date(item.timestamp).toLocaleTimeString()}
                  </div>
                  <div className="text-sm text-text mt-0.5">{item.label}</div>
                  {item.detail && (
                    <div className="text-xs text-muted mt-1 truncate">
                      {item.detail}
                    </div>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function mapEventToItem(event: TwinEvent): StreamItem | null {
  const id = `${event.type}_${Date.now()}_${Math.random()}`;
  const timestamp = new Date().toISOString();

  switch (event.type) {
    case "audit.created":
      return {
        id,
        timestamp: event.payload.timestamp,
        label: `Aktion gestartet: ${event.payload.capability}`,
        detail: event.payload.status,
        status:
          event.payload.status === "blocked"
            ? "warn"
            : event.payload.status === "pending"
            ? "active"
            : "info",
      };
    case "audit.updated":
      return {
        id,
        timestamp: event.payload.timestamp,
        label: `Aktion ${event.payload.status}: ${event.payload.capability}`,
        detail: event.payload.reason ?? "",
        status:
          event.payload.status === "executed"
            ? "ok"
            : event.payload.status === "failed"
            ? "warn"
            : "info",
      };
    case "twin.thinking":
      return {
        id,
        timestamp,
        label: `Twin denkt nach: ${event.payload.capability}`,
        detail: "",
        status: "active",
      };
    case "twin.idle":
      return null; // zu rauschig
    case "heartbeat":
      return null; // intern
    default:
      return null;
  }
}
