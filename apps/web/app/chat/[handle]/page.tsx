"use client";

import { use, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ChatMessage, TwinEvent } from "@twin-lab/shared";

const RUNTIME_URL = process.env.NEXT_PUBLIC_RUNTIME_URL ?? "http://localhost:4000";

// Threshold in px: User gilt als "unten", wenn er weniger als so viel vom
// Bottom-Rand entfernt ist. Liegt etwas oberhalb der typischen Bubble-Höhe,
// damit der "war-unten"-State auch greift, wenn gerade eine neue Nachricht
// das Layout ein paar Pixel verschoben hat.
const SCROLL_BOTTOM_THRESHOLD_PX = 100;

/**
 * Hält das Scrollverhalten des Chat-Viewports konsistent:
 *   - Beim Wechsel von `switchKey` (z.B. neue Conversation): hartes Scroll
 *     auf Bottom, damit der User immer bei der aktuellsten Nachricht startet.
 *   - Bei jeder neuen Nachricht: sanftes Scroll auf Bottom — aber nur, wenn
 *     der User zuvor schon (nahe) am Bottom war. Wer hochgescrollt liest,
 *     soll nicht beim Reinkommen einer neuen Reply weggerissen werden.
 *
 * Genutzt von DirectChat und A2AChat. Liefert die Refs + onScroll-Handler,
 * die der Caller an Container und Bottom-Sentinel hängt.
 */
function useAutoScroll(messageCount: number, switchKey: string) {
  const containerRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const wasAtBottomRef = useRef(true);
  const switchedRef = useRef(true);
  const lastSwitchKeyRef = useRef(switchKey);

  // Switch-Key-Änderung markieren — nächster Render scrollt hart.
  if (lastSwitchKeyRef.current !== switchKey) {
    lastSwitchKeyRef.current = switchKey;
    switchedRef.current = true;
    wasAtBottomRef.current = true;
  }

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    if (switchedRef.current) {
      // Hart auf Bottom — kein animiertes Scrollen, weil das beim
      // Conversation-Open ablenkend wirkt.
      el.scrollTop = el.scrollHeight;
      switchedRef.current = false;
      wasAtBottomRef.current = true;
      return;
    }
    if (wasAtBottomRef.current && bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: "smooth", block: "end" });
    }
  }, [messageCount, switchKey]);

  const onScroll = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    wasAtBottomRef.current = distance < SCROLL_BOTTOM_THRESHOLD_PX;
  }, []);

  return { containerRef, bottomRef, onScroll };
}

// ─── CHAT-PAGE (2.5.4.5) ─────────────────────────────────────────────────────
//
// Full-Viewport-Layout mit permanent angedockter Sidebar links und Conversation
// rechts. Sidebar scrollt intern bei vielen Konversationen, Conversation-Header
// und Input bleiben fix — Verlauf ist der einzige scrollbare Bereich.
//
//   ┌────────────┬──────────────────────────────────────┐
//   │ Sidebar    │ Conversation-Header (fix)            │
//   │ (w-72)     ├──────────────────────────────────────┤
//   │            │ Verlauf (scrollbar, flex-1)          │
//   │            ├──────────────────────────────────────┤
//   │            │ Input (fix unten)                    │
//   └────────────┴──────────────────────────────────────┘
//
// Trust-Status pro Partner kommt aus /twins/:handle/trust und wird in den
// Conversation-Header gereicht (Indikator "vertraut").

interface ConversationItem {
  partnerHandle: string;
  partnerDisplayName: string | null;
  lastMessageAt: string;
  unreadCount: number;
}

interface TrustEntry {
  trustedHandle: string;
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
  return <ChatLayout handle={handle} />;
}

function ChatLayout({ handle }: { handle: string }) {
  const [conversations, setConversations] = useState<ConversationItem[]>([]);
  const [trustedSet, setTrustedSet] = useState<Set<string>>(new Set());
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

  // Trust-Liste einmal pro Twin-Wechsel — ändert sich nur durch User-Aktion,
  // kein Polling nötig.
  const loadTrusts = useCallback(async () => {
    try {
      const res = await fetch(`${RUNTIME_URL}/twins/${handle}/trust`, {
        credentials: "include",
      });
      if (!res.ok) return;
      const body = (await res.json()) as { trusts: TrustEntry[] };
      setTrustedSet(
        new Set(body.trusts.map((t) => t.trustedHandle.toLowerCase())),
      );
    } catch {
      // Trust-Fetch ist nice-to-have für den Indikator — kein Blocker.
    }
  }, [handle]);

  useEffect(() => {
    loadConversations();
    loadTrusts();
  }, [loadConversations, loadTrusts]);

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

  const activePartnerInfo =
    selection.kind === "a2a"
      ? conversations.find(
          (c) => c.partnerHandle.toLowerCase() === selection.partner.toLowerCase(),
        )
      : null;
  const partnerDisplayName = activePartnerInfo?.partnerDisplayName ?? null;
  const partnerIsTrusted =
    selection.kind === "a2a" &&
    trustedSet.has(selection.partner.toLowerCase());

  return (
    // Fixe Höhe = Viewport minus AppHeader (~65px). overflow-hidden klemmt
    // alle internen Bereiche sauber ein — die Page selbst scrollt nie, nur
    // Sidebar-Liste und Conversation-Verlauf. AppFooter ist auf /chat-Routes
    // ausgeblendet, sonst würde er die Höhen-Rechnung kippen.
    <div className="h-[calc(100vh-65px)] flex flex-row overflow-hidden">
      <Sidebar
        handle={handle}
        conversations={conversations}
        selection={selection}
        onSelect={setSelection}
        onNew={() => setShowNewModal(true)}
        sidebarError={error}
      />

      <section className="flex-1 flex flex-col min-w-0 min-h-0">
        <ConversationHeader
          handle={handle}
          selection={selection}
          partnerDisplayName={partnerDisplayName}
          partnerIsTrusted={partnerIsTrusted}
        />
        {selection.kind === "direct" ? (
          <DirectChat handle={handle} />
        ) : (
          <A2AChat
            handle={handle}
            partner={selection.partner}
            partnerDisplayName={partnerDisplayName}
            onMessageSent={loadConversations}
            onMarkedRead={loadConversations}
          />
        )}
      </section>

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

// ─── Conversation-Header (fix oben über dem Verlauf) ────────────────────────

function ConversationHeader({
  handle,
  selection,
  partnerDisplayName,
  partnerIsTrusted,
}: {
  handle: string;
  selection: Selection;
  partnerDisplayName: string | null;
  partnerIsTrusted: boolean;
}) {
  if (selection.kind === "direct") {
    return (
      <div className="h-16 px-6 border-b border-border bg-surface flex items-center gap-3 flex-shrink-0">
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold text-text truncate">
            Mit deinem Twin
          </div>
          <div className="text-xs text-muted font-mono truncate">{handle}</div>
        </div>
        <span className="text-[10px] uppercase tracking-wider text-muted border border-border rounded px-2 py-0.5">
          direct chat
        </span>
      </div>
    );
  }
  const label = partnerDisplayName ?? selection.partner;
  return (
    <div className="px-6 py-3 border-b border-border bg-surface flex items-center gap-3">
      <div className="flex-1 min-w-0">
        <div className="text-sm font-semibold text-text truncate">{label}</div>
        <div className="text-xs text-muted font-mono truncate">
          {selection.partner}
        </div>
      </div>
      {partnerIsTrusted && (
        <span
          className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wider text-accent border border-accent/40 rounded px-2 py-0.5"
          title="Dieser Twin ist in deiner Vertrauten-Liste"
        >
          <span aria-hidden="true">✓</span>
          vertraut
        </span>
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
  sidebarError,
}: {
  handle: string;
  conversations: ConversationItem[];
  selection: Selection;
  onSelect: (s: Selection) => void;
  onNew: () => void;
  sidebarError: string | null;
}) {
  return (
    // Drei vertikale Slots — Höhen exakt parallel zum Conversation-Bereich:
    //   h-16  Header     (matched mit ConversationHeader rechts)
    //   flex-1 Liste     (scrollt intern bei vielen Konversationen)
    //   h-20  Footer-Slot (matched mit Conversation-Input rechts)
    // min-h-0 + overflow-hidden auf der Liste sind nötig, damit der innere
    // Scroll greift statt die Sidebar zu vergrößern.
    <aside className="w-72 flex-shrink-0 border-r border-border bg-surface flex flex-col">
      <div className="h-16 px-4 border-b border-border flex items-center flex-shrink-0">
        <div className="text-xs uppercase tracking-wider text-muted">
          Konversationen
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto p-2 space-y-1">
        <button
          onClick={() => onSelect({ kind: "direct" })}
          className={`w-full text-left px-3 py-2 rounded border transition-colors ${
            selection.kind === "direct"
              ? "border-accent bg-bg"
              : "border-transparent hover:border-accent/40 hover:bg-bg/40"
          }`}
        >
          <div className="text-sm text-text">Mit meinem Twin</div>
          <div className="text-xs text-muted">Direct-Chat ({handle})</div>
        </button>

        {conversations.length === 0 ? (
          <div className="text-xs text-muted px-3 py-3">
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
                    : "border-transparent hover:border-accent/40 hover:bg-bg/40"
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

        {sidebarError && (
          <div className="text-xs text-warn border border-warn/40 rounded px-3 py-2 mt-2">
            {sidebarError}
          </div>
        )}
      </div>

      <div className="h-20 px-3 border-t border-border flex items-center flex-shrink-0">
        <button
          onClick={onNew}
          className="w-full px-3 py-2 text-sm border border-accent text-accent rounded hover:bg-accent hover:text-bg transition-colors"
        >
          + Neue Konversation
        </button>
      </div>
    </aside>
  );
}

// ─── Direct-Chat (Owner → eigener Twin, LLM) ────────────────────────────────

function DirectChat({ handle }: { handle: string }) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { containerRef, bottomRef, onScroll } = useAutoScroll(
    messages.length,
    `direct:${handle}`,
  );

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
    // Verlauf: flex-1 + min-h-0 + overflow-y-auto — nur dieser Bereich scrollt.
    // Innerer max-w-3xl-Wrapper begrenzt die Lese-Breite, sonst werden Messages
    // über den ganzen Conversation-Bereich gestreckt (>1500px sind unlesbar).
    // Input: h-20 fix — match zum Sidebar-Footer für visuelle Konsistenz.
    <>
      <div
        ref={containerRef}
        onScroll={onScroll}
        className="flex-1 min-h-0 overflow-y-auto px-6 py-4"
      >
        <div className="max-w-3xl mx-auto space-y-4">
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
          <div ref={bottomRef} />
        </div>
      </div>
      <div className="h-20 border-t border-border bg-surface px-6 py-3 flex items-center gap-2 flex-shrink-0">
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
          className="flex-1 h-full bg-bg border border-border rounded px-3 py-2 text-sm text-text resize-none focus:outline-none focus:border-accent"
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
    </>
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
  /** Wird in den Bubble-Headings als Sender-Label genutzt (z.B. "FLORIAN"). */
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
  const { containerRef, bottomRef, onScroll } = useAutoScroll(
    messages.length,
    `a2a:${partner}`,
  );

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
    // Aufbau identisch zu DirectChat: scroll-Verlauf mit max-w-3xl-Wrapper,
    // h-20 Input — gleiche Höhen wie Sidebar-Slots.
    <>
      <div
        ref={containerRef}
        onScroll={onScroll}
        className="flex-1 min-h-0 overflow-y-auto px-6 py-4"
      >
        <div className="max-w-3xl mx-auto space-y-3">
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
          <div ref={bottomRef} />
        </div>
      </div>
      <div className="h-20 border-t border-border bg-surface px-6 py-3 flex items-center gap-2 flex-shrink-0">
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
          className="flex-1 h-full bg-bg border border-border rounded px-3 py-2 text-sm text-text resize-none focus:outline-none focus:border-accent"
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
    </>
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
  // ml-auto / mr-auto positioniert die Bubble innerhalb des max-w-3xl-
  // Wrappers — User rechts, Twin-Antwort links. max-w-[70%] verhindert,
  // dass eine kurze Message die volle Wrapper-Breite einnimmt.
  return (
    <div
      className={`max-w-[70%] px-3 py-2 rounded text-sm leading-relaxed whitespace-pre-wrap ${
        isUser
          ? "ml-auto bg-bg border border-border text-text"
          : "mr-auto bg-surface border border-accent/40 text-text"
      }`}
    >
      <div className="text-[10px] text-muted uppercase tracking-wider mb-1">
        {isUser ? "du" : "twin"}
      </div>
      {content}
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
      <div className="max-w-[70%] mx-auto px-3 py-2 text-xs text-muted italic opacity-70 text-center whitespace-pre-wrap">
        <div className="text-[10px] uppercase tracking-wider mb-1 not-italic opacity-80">
          System
        </div>
        {message.content}
      </div>
    );
  }

  const isSent = message.direction === "sent";
  // Bewusst kontrastierende Bubbles: sent in akzentfarbener Border, received
  // mit dezenter Standard-Border — visuell klar, wer geschrieben hat. Plus
  // ml-auto/mr-auto innerhalb des max-w-3xl-Wrappers oben.
  const sideClass = isSent ? "ml-auto" : "mr-auto";
  const bubbleClasses = isSent
    ? "bg-bg border border-accent/60 text-text"
    : "bg-surface border border-border text-text";
  const heading = isSent ? "DU" : partnerLabel;
  const isReply = message.inReplyTo !== null;
  // Pending-Hinweis bei eingehender, noch nicht freigegebener Anfrage.
  const isPending = !isSent && message.auditStatus === "pending";

  return (
    <div
      className={`max-w-[70%] px-3 py-2 rounded text-sm leading-relaxed whitespace-pre-wrap ${sideClass} ${bubbleClasses}`}
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
