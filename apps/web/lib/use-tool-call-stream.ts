"use client";

import { useEffect, useState } from "react";
import type { TwinEvent } from "@nolmi/shared";

// ─── useToolCallStream (#107 + Token-Streaming) ──────────────────────────────
//
// Hört auf `tool.call.start` / `tool.call.complete` + `twin.token` aus dem
// SSE-Stream des Twins. Liefert:
//   - toolCalls: ephemerer Live-State der laufenden MCP-Tool-Calls
//   - streamingContent: akkumulierter Token-Buffer der laufenden Antwort
//
// twin.thinking → streamingContent zurücksetzen (neue Antwort startet).
// twin.token    → chunk anhängen.
// twin.idle     → Tool-Calls nach 1.5s-Karenz leeren; streamingContent
//                 bleibt bis DirectChat nach loadAudits() busy=false setzt
//                 (damit die Streaming-Bubble bis zum Audit-Eintrag sichtbar
//                 bleibt und dann sauber durch den Audit-Block ersetzt wird).
//
// Diagnose Tag 20: Audit-Stream ist während Auto-Approve-Tool-Calls opak —
// einzelne Calls werden nicht als Audit-Rows persistiert, sondern erscheinen
// erst im finalen owner-direct-Audit am Cycle-Ende. SSE-Events füllen genau
// diese Lücke; bei Tab-Reload ist der Live-State verloren (akzeptiert,
// generic Spinner als Fallback).
//
// Der Hook eröffnet eine ZWEITE EventSource zusätzlich zur existing
// reply-received-Listener (chat/[handle]/page.tsx:215). Browser-Limit von
// 6 simultaneous HTTP/1.1-Connections pro Origin reicht; bei wachsendem
// SSE-Bedarf später Context/Provider-Refactor erwägen.

const RUNTIME_URL =
  process.env.NEXT_PUBLIC_RUNTIME_URL ?? "http://localhost:4000";

const TWIN_IDLE_CLEAR_DELAY_MS = 1500;

export type ToolCallState = {
  callId: string;
  toolName: string;
  mcpServerId: string;
  args: Record<string, unknown>;
  startedAt: string;
  status: "running" | "executed" | "failed";
  error?: string;
  completedAt?: string;
  durationMs?: number;
};

export interface UseToolCallStreamOptions {
  twinHandle: string;
  /**
   * Optionaler mcpServerId-Filter. Wenn gesetzt, werden Tool-Calls von
   * anderen Servern stillschweigend ignoriert. Für die Recherche-Live-View
   * lassen wir den Filter weg und matchen den Server-Prefix in der
   * Component (`mcp:hyperbrowser-approval:`), damit der Hook generisch bleibt.
   */
  serverFilter?: string;
}

export interface UseToolCallStreamResult {
  toolCalls: ToolCallState[];
  /** Akkumulierter Token-Buffer der laufenden Antwort. Leer wenn kein Stream aktiv. */
  streamingContent: string;
}

export function useToolCallStream({
  twinHandle,
  serverFilter,
}: UseToolCallStreamOptions): UseToolCallStreamResult {
  const [toolCalls, setToolCalls] = useState<Map<string, ToolCallState>>(
    new Map(),
  );
  const [streamingContent, setStreamingContent] = useState("");

  useEffect(() => {
    const url = `${RUNTIME_URL}/twins/${twinHandle}/stream`;
    const es = new EventSource(url, { withCredentials: true });
    let idleTimer: ReturnType<typeof setTimeout> | null = null;

    es.onmessage = (event) => {
      try {
        const parsed = JSON.parse(event.data) as TwinEvent;
        if (parsed.type === "twin.thinking") {
          // Neue Antwort beginnt → Token-Buffer zurücksetzen.
          setStreamingContent("");
        } else if (parsed.type === "twin.token") {
          setStreamingContent((prev) => prev + parsed.payload.chunk);
        } else if (parsed.type === "tool.call.start") {
          if (
            serverFilter &&
            parsed.payload.mcpServerId !== serverFilter
          ) {
            return;
          }
          // Neuer Cycle beginnt → falls noch ein idle-Timer läuft, abbrechen,
          // damit der frische Tool-Call nicht versehentlich gleich gelöscht wird.
          if (idleTimer) {
            clearTimeout(idleTimer);
            idleTimer = null;
          }
          setToolCalls((prev) => {
            const next = new Map(prev);
            next.set(parsed.payload.callId, {
              callId: parsed.payload.callId,
              toolName: parsed.payload.toolName,
              mcpServerId: parsed.payload.mcpServerId,
              args: parsed.payload.args,
              startedAt: parsed.payload.startedAt,
              status: "running",
            });
            return next;
          });
        } else if (parsed.type === "tool.call.complete") {
          setToolCalls((prev) => {
            const existing = prev.get(parsed.payload.callId);
            if (!existing) return prev;
            const next = new Map(prev);
            next.set(parsed.payload.callId, {
              ...existing,
              status: parsed.payload.status,
              error: parsed.payload.error,
              completedAt: parsed.payload.completedAt,
              durationMs: parsed.payload.durationMs,
            });
            return next;
          });
        } else if (parsed.type === "twin.idle") {
          // Send-Cycle complete — Tool-Call-Display nach Karenz leeren.
          // streamingContent bleibt: DirectChat zeigt ihn solange busy=true,
          // d.h. bis loadAudits() nach der POST-Response zurückkommt.
          if (idleTimer) clearTimeout(idleTimer);
          idleTimer = setTimeout(() => {
            setToolCalls(new Map());
            idleTimer = null;
          }, TWIN_IDLE_CLEAR_DELAY_MS);
        }
      } catch {
        // Unparsable Frame — ignorieren, EventSource reconnected nicht.
      }
    };

    es.onerror = () => {
      // EventSource reconnected automatisch — kein Cleanup nötig.
    };

    return () => {
      if (idleTimer) clearTimeout(idleTimer);
      es.close();
    };
  }, [twinHandle, serverFilter]);

  // ASC-Sortierung nach startedAt — UI rendert chronologisch (Such-Step
  // zuerst, dann scrape-Steps in der Reihenfolge wie der LLM die URLs lädt).
  return {
    toolCalls: Array.from(toolCalls.values()).sort((a, b) =>
      a.startedAt.localeCompare(b.startedAt),
    ),
    streamingContent,
  };
}
