"use client";

import { use, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ChatMessage, TwinEvent } from "@twin-lab/shared";

const RUNTIME_URL = process.env.NEXT_PUBLIC_RUNTIME_URL ?? "http://localhost:4000";

// ─── CHAT-PAGE 2.5.4.3 ─────────────────────────────────────────────────────
//
// Zwei-Spalten-Layout: links Sidebar mit Conversations, rechts entweder
// Direct-Chat (Owner → eigener Twin) oder A2A-Conversation (Owner → ein
// anderer Twin, via Bridge).
//
// 2.5.4.3-Änderungen:
//   - Conversation-View baut auf Bridge-Messages-DB (symmetrisch — beide
//     Seiten sehen denselben Verlauf), angereichert mit lokalem Audit-Wissen.
//   - System-Messages bekommen eigenes Styling (zentriert, italic, transparent).
//   - Sent vs. received deutlich visuell unterscheidbar (Position + Heading).
//   - mark-read mit Verzögerung: Indicator verschwindet erst nach ~700ms im
//     View, danach wird die Conversation-Liste neu geladen → Sidebar-Counter
//     aktualisiert sich konsistent.

interface ConversationItem {
  partnerHandle: string;
  partnerDisplayName: string | null;
  lastMessageAt: string;
  unreadCount: number;
}

// Spiegelt MergedMessage aus apps/runtime/src/audit/conversation-merge.ts
interface ConversationMessage {
  bridgeMessageId: string;
  direction: "sent" | "received";
  content: string;
  createdAt: string;
  inReplyTo: string | null;
  messageType: "twin" | "system";
  auditCapability: string | null;
  auditStatus: "pending" | "approved" | "executed" | "rejected" | "blocked" | "failed" | null;
  readAt: string | null;
  auditId: string | null;
}

type Selection = { kind: "direct" } | { kind: "a2a"; partner: string };

export default function ChatPage({
  params,
}: {
  params: Promise<{ handle: string }>;
}) {
  const raw = use(params).handle;
  const handle = safeDecode(raw);

  return (
    <div className="space-y-4">
      <div className="flex items-baseline gap-3">
        <h1 className="text-xl font-semibold text-text">Chat</h1>
        <span className="text-xs text-muted font-mono">{handle}</span>
      </div>
      <ChatLayout handle={handle} />
    </div>
  );
}

function ChatLayout({ handle }: { handle: string }) {
  const [conversations, setConversations] = useState<ConversationItem[]>([]);
  const [selection, setSelection] = useState<Selection>({ kind: "direct" });
  const [showNewModal, setShowNewModal] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadConversations = useCallback(async () => {
    try {
      const res = await fetch(`${RUNTIME_URL}/twins/${handle}/conversations`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as { conversations: ConversationItem[] };
      setConversations(body.conversations);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Conversations konnten nicht geladen werden");
    }
  }, [handle]);

  useEffect(() => {
    loadConversations();
  }, [loadConversations]);

  // SSE: live updates wenn neue Replies reinkommen.
  useEffect(() => {
    const url = `${RUNTIME_URL}/twins/${handle}/stream`;
    const es = new EventSource(url, { withCredentials: true });
    es.onmessage = (event) => {
      try {
        const parsed = JSON.parse(event.data) as TwinEvent;
        if (parsed.type === "reply-received") {
          loadConversations();
        }
      } catch {
        // ignore unparsable
      }
    };
    es.onerror = () => {
      // EventSource reconnected automatisch — nichts zu tun.
    };
    return () => es.close();
  }, [handle, loadConversations]);

  const handleNewConversation = (partner: string) => {
    setShowNewModal(false);
    loadConversations();
    setSelection({ kind: "a2a", partner });
  };

  return (
    <div className="flex flex-col md:flex-row gap-4 min-h-[600px]">
      <aside className="md:w-[280px] md:flex-shrink-0">
        <Sidebar
          handle={handle}
          conversations={conversations}
          selection={selection}
          onSelect={setSelection}
          onNew={() => setShowNewModal(true)}
        />
        {error && (
          <div className="mt-2 text-xs text-warn border border-warn/40 rounded px-3 py-2">
            {error}
          </div>
        )}
      </aside>

      <main className="flex-1 min-w-0">
        {selection.kind === "direct" ? (
          <DirectChat handle={handle} />
        ) : (
          <A2AChat
            handle={handle}
            partner={selection.partner}
            partnerDisplayName={
              conversations.find(
                (c) => c.partnerHandle.toLowerCase() === selection.partner.toLowerCase(),
              )?.partnerDisplayName ?? null
            }
            onMessageSent={loadConversations}
            onMarkedRead={loadConversations}
          />
        )}
      </main>

      {showNewModal && (
        <NewConversationModal
          handle={handle}
          onClose={() => setShowNewModal(false)}
          onCreated={handleNewConversation}
        />
      )}
    </div>
  );
}

// ─── Sidebar ────────────────────────────────────────────────────────────────

function Sidebar({
  handle,
  conversations,
  selection,
  onSelect,
  onNew,
}: {
  handle: string;
  conversations: ConversationItem[];
  selection: Selection;
  onSelect: (s: Selection) => void;
  onNew: () => void;
}) {
  return (
    <div className="bg-surface border border-border rounded p-3 space-y-2 sticky top-4">
      <div className="text-xs uppercase tracking-wider text-muted px-1 mb-1">
        Konversationen
      </div>

      <button
        onClick={() => onSelect({ kind: "direct" })}
        className={`w-full text-left px-3 py-2 rounded border transition-colors ${
          selection.kind === "direct"
            ? "border-accent bg-bg"
            : "border-border hover:border-accent/40"
        }`}
      >
        <div className="text-sm text-text">Mit meinem Twin</div>
        <div className="text-xs text-muted">Direct-Chat ({handle})</div>
      </button>

      <div className="border-t border-border my-2" />

      {conversations.length === 0 ? (
        <div className="text-xs text-muted px-1 py-2">
          Noch keine A2A-Konversationen.
        </div>
      ) : (
        conversations.map((c) => {
          const isActive =
            selection.kind === "a2a" &&
            selection.partner.toLowerCase() === c.partnerHandle.toLowerCase();
          return (
            <button
              key={c.partnerHandle}
              onClick={() => onSelect({ kind: "a2a", partner: c.partnerHandle })}
              className={`w-full text-left px-3 py-2 rounded border transition-colors ${
                isActive
                  ? "border-accent bg-bg"
                  : "border-border hover:border-accent/40"
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="text-sm text-text truncate">
                  {c.partnerDisplayName ?? c.partnerHandle}
                </div>
                {c.unreadCount > 0 && (
                  <span
                    className="inline-block w-2 h-2 rounded-full bg-warn flex-shrink-0"
                    title={`${c.unreadCount} ungelesen`}
                    aria-label={`${c.unreadCount} ungelesene Antworten`}
                  />
                )}
              </div>
              <div className="text-xs text-muted font-mono truncate">
                {c.partnerHandle}
              </div>
              <div className="text-[11px] text-muted mt-0.5">
                {formatRelative(c.lastMessageAt)}
              </div>
            </button>
          );
        })
      )}

      <div className="border-t border-border my-2" />

      <button
        onClick={onNew}
        className="w-full px-3 py-2 text-sm border border-accent text-accent rounded hover:bg-accent hover:text-bg transition-colors"
      >
        + Neue Konversation
      </button>
    </div>
  );
}

// ─── Direct-Chat (Owner → eigener Twin, LLM) ────────────────────────────────

function DirectChat({ handle }: { handle: string }) {
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
      const res = await fetch(`${RUNTIME_URL}/twins/${handle}/chat`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: next }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: "Unknown error" }));
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      const data = (await res.json()) as {
        message: ChatMessage | null;
        auditId: string;
        pending: boolean;
      };
      if (data.pending) {
        setMessages((current) => [
          ...current,
          {
            role: "assistant",
            content:
              "Diese Anfrage habe ich an den Owner zur Freigabe weitergeleitet. Sobald approved, läuft sie. Status in der Inbox.",
          },
        ]);
      } else if (data.message) {
        setMessages((current) => [...current, data.message!]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="bg-surface border border-border rounded h-full min-h-[400px] flex flex-col">
      <div className="px-4 py-3 border-b border-border">
        <div className="text-sm text-text">Direct-Chat mit deinem Twin</div>
        <div className="text-xs text-muted font-mono">{handle}</div>
      </div>
      <div className="flex-1 p-4 space-y-4 overflow-y-auto max-h-[60vh]">
        {messages.length === 0 ? (
          <div className="text-muted text-sm">
            Noch keine Nachrichten. Schreib unten eine Frage.
          </div>
        ) : (
          messages.map((m, i) => <Bubble key={i} role={m.role} content={m.content} />)
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
  );
}

// ─── A2A-Conversation (Owner → externer Twin, via Bridge) ───────────────────

// Verzögerung vor mark-read: erst wenn der User die Conversation für gut
// 700ms aktiv vor sich hat. Verhindert das "Indicator-Aufblitzen" — der rote
// Punkt war früher weg, bevor das Auge ihn registrieren konnte.
const MARK_READ_DELAY_MS = 700;

function A2AChat({
  handle,
  partner,
  partnerDisplayName,
  onMessageSent,
  onMarkedRead,
}: {
  handle: string;
  partner: string;
  partnerDisplayName: string | null;
  onMessageSent: () => void;
  /** Triggert Sidebar-Reload nach mark-read, damit der unread-Counter sinkt. */
  onMarkedRead: () => void;
}) {
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const markedRef = useRef<Set<string>>(new Set());

  const load = useCallback(async () => {
    try {
      const res = await fetch(
        `${RUNTIME_URL}/twins/${handle}/conversations/${encodeURIComponent(partner)}`,
        { credentials: "include" },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as { messages: ConversationMessage[] };
      setMessages(body.messages);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Conversation konnte nicht geladen werden");
    }
  }, [handle, partner]);

  useEffect(() => {
    setMessages([]);
    setError(null);
    markedRef.current = new Set();
    load();
    // SSE-getriebenes Refresh läuft eine Ebene höher (ChatLayout). Wir
    // pollen hier zusätzlich alle 5s — niedrige Frequenz, weil jeder Reload
    // einen Bridge-Roundtrip kostet.
    const interval = setInterval(load, 5000);
    return () => clearInterval(interval);
  }, [load]);

  // Mark-Read mit Verzögerung: Conversation muss MARK_READ_DELAY_MS sichtbar
  // gewesen sein, bevor wir read=true setzen. Räumt auf, wenn sich messages
  // ändert (z.B. neue Reply reinkommt während des Wartens).
  useEffect(() => {
    const unread = messages.filter(
      (m) =>
        m.direction === "received" &&
        m.auditCapability === "reply-received" &&
        m.readAt === null &&
        m.auditId !== null &&
        !markedRef.current.has(m.auditId),
    );
    if (unread.length === 0) return;

    const timer = setTimeout(async () => {
      let didMark = false;
      for (const m of unread) {
        if (!m.auditId) continue;
        markedRef.current.add(m.auditId);
        try {
          await fetch(
            `${RUNTIME_URL}/twins/${handle}/audit/${m.auditId}/mark-read`,
            { method: "POST", credentials: "include" },
          );
          didMark = true;
        } catch {
          // Nicht kritisch — Indicator bleibt halt. Beim nächsten Open neuer
          // Versuch.
        }
      }
      if (didMark) {
        // Sidebar-Counter triggert auch über onMarkedRead → loadConversations.
        // Plus lokal die Conversation neu, damit readAt updated.
        await load();
        onMarkedRead();
      }
    }, MARK_READ_DELAY_MS);

    return () => clearTimeout(timer);
  }, [messages, handle, load, onMarkedRead]);

  // Letzte empfangene Bridge-Message — für inReplyTo beim Senden, damit der
  // Empfänger Reply-Detection greift und kein neuer Pending entsteht. Wir
  // ignorieren System-Messages bewusst, sonst antworten wir auf eine Warte-
  // meldung statt auf den eigentlichen Inhalt.
  const lastReceivedBridgeId = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      if (m && m.direction === "received" && m.messageType !== "system") {
        return m.bridgeMessageId;
      }
    }
    return null;
  }, [messages]);

  async function send() {
    if (!input.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(
        `${RUNTIME_URL}/twins/${handle}/conversations/${encodeURIComponent(partner)}/send`,
        {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            content: input.trim(),
            inReplyTo: lastReceivedBridgeId,
          }),
        },
      );
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
      }
      setInput("");
      await load();
      onMessageSent();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Senden fehlgeschlagen");
    } finally {
      setBusy(false);
    }
  }

  const partnerLabel = (partnerDisplayName ?? partner).toUpperCase();

  return (
    <div className="bg-surface border border-border rounded h-full min-h-[400px] flex flex-col">
      <div className="px-4 py-3 border-b border-border">
        <div className="text-sm text-text">{partnerDisplayName ?? partner}</div>
        <div className="text-xs text-muted font-mono">{partner}</div>
      </div>
      <div className="flex-1 p-4 space-y-3 overflow-y-auto max-h-[60vh]">
        {messages.length === 0 ? (
          <div className="text-muted text-sm">
            Noch keine Nachrichten in dieser Konversation.
          </div>
        ) : (
          messages.map((m) => (
            <ConversationBubble
              key={m.bridgeMessageId}
              message={m}
              partnerLabel={partnerLabel}
            />
          ))
        )}
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
          placeholder={`Nachricht an ${partner}…`}
          className="flex-1 bg-bg border border-border rounded px-3 py-2 text-sm text-text resize-none focus:outline-none focus:border-accent"
          rows={2}
        />
        <button
          onClick={send}
          disabled={busy || !input.trim()}
          className="px-4 py-2 border border-accent text-accent text-sm rounded disabled:opacity-30 disabled:cursor-not-allowed hover:bg-accent hover:text-bg transition-colors"
        >
          {busy ? "..." : "send"}
        </button>
      </div>
    </div>
  );
}

// ─── Modal: Neue A2A-Conversation ──────────────────────────────────────────

function NewConversationModal({
  handle,
  onClose,
  onCreated,
}: {
  handle: string;
  onClose: () => void;
  onCreated: (partner: string) => void;
}) {
  const [partner, setPartner] = useState("");
  const [content, setContent] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setError(null);
    const target = partner.trim().toLowerCase();
    if (!/^@[a-z0-9_-]+$/.test(target)) {
      setError("Handle muss '@<name>' sein (Kleinbuchstaben, Ziffern, _ und -).");
      return;
    }
    if (!content.trim()) {
      setError("Eine erste Nachricht ist Pflicht.");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(
        `${RUNTIME_URL}/twins/${handle}/conversations/${encodeURIComponent(target)}/send`,
        {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content: content.trim() }),
        },
      );
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
      }
      onCreated(target);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Senden fehlgeschlagen");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
      onClick={onClose}
    >
      <div
        className="bg-surface border border-border rounded-lg p-5 w-full max-w-md mx-4 space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-sm font-semibold text-text">Neue Konversation</h2>
        <div className="space-y-3">
          <div>
            <label className="block text-xs text-muted mb-1">Handle</label>
            <input
              type="text"
              value={partner}
              onChange={(e) => setPartner(e.target.value)}
              placeholder="@florian"
              disabled={busy}
              className="w-full px-3 py-2 bg-bg border border-border rounded text-sm font-mono text-text focus:outline-none focus:border-accent disabled:opacity-50"
            />
          </div>
          <div>
            <label className="block text-xs text-muted mb-1">Erste Nachricht</label>
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="Hallo Florian, …"
              disabled={busy}
              rows={3}
              className="w-full px-3 py-2 bg-bg border border-border rounded text-sm text-text resize-none focus:outline-none focus:border-accent disabled:opacity-50"
            />
          </div>
          {error && (
            <div className="text-xs text-warn border border-warn rounded px-3 py-2">
              {error}
            </div>
          )}
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <button
            onClick={onClose}
            disabled={busy}
            className="px-3 py-1.5 text-xs border border-border text-muted rounded hover:border-warn hover:text-warn disabled:opacity-30"
          >
            Abbrechen
          </button>
          <button
            onClick={submit}
            disabled={busy || !partner.trim() || !content.trim()}
            className="px-4 py-1.5 text-xs border border-accent text-accent rounded hover:bg-accent hover:text-bg disabled:opacity-30 disabled:cursor-not-allowed"
          >
            {busy ? "..." : "Senden"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Bubbles ────────────────────────────────────────────────────────────────

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

function ConversationBubble({
  message,
  partnerLabel,
}: {
  message: ConversationMessage;
  partnerLabel: string;
}) {
  // System-Messages: zentriert, italic, transparent — klar als Wartemeldung
  // o.ä. erkennbar, nicht als Konversations-Inhalt.
  if (message.messageType === "system") {
    return (
      <div className="flex justify-center">
        <div className="max-w-[80%] px-3 py-2 text-xs text-muted italic opacity-70 text-center whitespace-pre-wrap">
          <div className="text-[10px] uppercase tracking-wider mb-1 not-italic opacity-80">
            System
          </div>
          {message.content}
        </div>
      </div>
    );
  }

  const isSent = message.direction === "sent";
  // Bewusst kontrastierende Bubbles: sent in akzentfarbener Border, received
  // mit dezenter Standard-Border — visuell klar, wer geschrieben hat.
  const bubbleClasses = isSent
    ? "bg-bg border border-accent/60 text-text"
    : "bg-surface border border-border text-text";
  const heading = isSent ? "DU" : partnerLabel;
  const isReply = message.inReplyTo !== null;
  // Pending-Hinweis bei eingehender, noch nicht freigegebener Anfrage.
  const isPending =
    !isSent && message.auditStatus === "pending";

  return (
    <div className={`flex ${isSent ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[80%] px-3 py-2 rounded text-sm leading-relaxed whitespace-pre-wrap ${bubbleClasses}`}
      >
        <div className="text-[10px] text-muted uppercase tracking-wider mb-1 flex items-center gap-2">
          <span className={isSent ? "text-accent" : "text-text"}>{heading}</span>
          {isReply && (
            <span className="text-muted normal-case" title="Antwort auf vorherige Nachricht">
              ↩ reply
            </span>
          )}
          {isPending && (
            <span className="text-warn normal-case">wartet auf Freigabe</span>
          )}
          <span className="ml-auto normal-case text-muted">
            {formatTime(message.createdAt)}
          </span>
        </div>
        {message.content}
      </div>
    </div>
  );
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function safeDecode(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

function formatRelative(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return iso;
  const diff = Date.now() - then;
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return "gerade eben";
  const min = Math.floor(sec / 60);
  if (min < 60) return `vor ${min} Min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `vor ${h} Std`;
  const d = Math.floor(h / 24);
  if (d < 7) return `vor ${d} Tag${d === 1 ? "" : "en"}`;
  return new Date(iso).toLocaleDateString("de-DE");
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
}
