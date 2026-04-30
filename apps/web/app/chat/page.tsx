"use client";

import { useState } from "react";
import type { ChatMessage } from "@twin-lab/shared";

const RUNTIME_URL = process.env.NEXT_PUBLIC_RUNTIME_URL ?? "http://127.0.0.1:4000";

export default function ChatPage() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send() {
    if (!input.trim() || busy) return;
    const userMessage: ChatMessage = { role: "user", content: input };
    const next = [...messages, userMessage];
    setMessages(next);
    setInput("");
    setBusy(true);
    setError(null);

    try {
      const res = await fetch(`${RUNTIME_URL}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: next }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: "Unknown error" }));
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      const data = (await res.json()) as { message: ChatMessage };
      setMessages((current) => [...current, data.message]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold text-text">Chat</h1>

      <div className="bg-surface border border-border rounded min-h-[400px] flex flex-col">
        <div className="flex-1 p-4 space-y-4 overflow-y-auto max-h-[60vh]">
          {messages.length === 0 ? (
            <div className="text-muted text-sm">
              Noch keine Nachrichten. Schreib unten eine Frage.
            </div>
          ) : (
            messages.map((m, i) => (
              <Bubble key={i} role={m.role} content={m.content} />
            ))
          )}
          {busy && <div className="text-xs text-accent">twin denkt nach…</div>}
          {error && (
            <div className="text-xs text-warn border border-warn/40 rounded px-3 py-2">
              {error}
            </div>
          )}
        </div>

        <div className="border-t border-border p-3 flex gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            placeholder="Frage an den Twin… (Enter zum senden, Shift+Enter für Zeilenumbruch)"
            className="flex-1 bg-bg border border-border rounded px-3 py-2 text-sm text-text resize-none focus:outline-none focus:border-accent"
            rows={2}
          />
          <button
            onClick={send}
            disabled={busy || !input.trim()}
            className="px-4 py-2 border border-accent text-accent text-sm rounded disabled:opacity-30 disabled:cursor-not-allowed hover:bg-accent hover:text-bg transition-colors"
          >
            send
          </button>
        </div>
      </div>
    </div>
  );
}

function Bubble({ role, content }: { role: ChatMessage["role"]; content: string }) {
  const isUser = role === "user";
  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[80%] px-3 py-2 rounded text-sm leading-relaxed whitespace-pre-wrap ${
          isUser
            ? "bg-bg border border-border text-text"
            : "bg-surface border border-accent/40 text-text"
        }`}
      >
        <div className="text-[10px] text-muted uppercase tracking-wider mb-1">
          {isUser ? "du" : "twin"}
        </div>
        {content}
      </div>
    </div>
  );
}
