"use client";

import {
  Fragment,
  use,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import Link from "next/link";
import type { AuditEntry, ChatMessage, TwinEvent } from "@twin-lab/shared";
import { ToolPicker } from "./ToolPicker";
import { ModalWrapper } from "../../../components/ModalWrapper";
import { RejectReasonModal } from "../../../components/RejectReasonModal";
import { toast } from "../../../lib/toast";

const RUNTIME_URL = process.env.NEXT_PUBLIC_RUNTIME_URL ?? "http://localhost:4000";

// Audit-Capabilities, die im Direct-Chat-Verlauf erscheinen sollen.
// "respond_to_chat" = Standard-Pfad, "owner-direct" = Owner-Bypass — beide
// haben dasselbe Audit-Input-/Output-Schema (lastMessage + reply).
// "mcp-tool-use" (3.2.G): Tool-Approval-Audits — ein Audit pro User-Send,
// rendert User-Bubble + Pending-Reply-Bubble + Tool-Call-Box (+ ggf. finale
// Reply-Bubble).
const DIRECT_CHAT_CAPABILITIES = new Set([
  "respond_to_chat",
  "owner-direct",
  "mcp-tool-use",
]);

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

// Chat-Page nutzt KEIN PageContainer (UX.1.A.2.C.1, 16. Mai 2026):
// zwei-spaltiges Layout mit eigener Breitenlogik (Konversations-Sidebar +
// Chat-Content, Full-Viewport-Höhe). Innere Lese-Breite begrenzt der
// `max-w-3xl`-Wrapper im Verlauf-Bereich (siehe ChatLayout / DirectChat /
// A2AChat). PageContainer würde diese Doppel-Constraint-Logik nur stören.
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
  // #84/#85: Counter, der nach jedem erfolgreichen Direct-Chat-Reset hochzählt.
  // DirectChat leitet daraus eine synthetische Local-Konversations-ID ab und
  // taggt damit live gesendete Messages — so erscheint der Trenner zwischen
  // letztem Server-Audit und neuer Live-Message ohne Page-Reload. Nach Reload
  // hat der Server die echten conversation_ids und übersteuert die Local-IDs.
  const [directChatResetSeq, setDirectChatResetSeq] = useState(0);
  // 3.3.G3: aktive Direct-Chat-Conversation-ID, geliftet aus DirectChat.
  // Wird vom Conversation-Header für Extract-Calls gebraucht (POST
  // /facts/extract verlangt eine echte conversationId). null wenn frisch
  // gemountet ohne bisherige Audits — Extract-Button bleibt dann disabled.
  const [directChatConvId, setDirectChatConvId] = useState<string | null>(null);

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
          directChatConvId={directChatConvId}
          onDirectChatReset={() => setDirectChatResetSeq((s) => s + 1)}
        />
        {selection.kind === "direct" ? (
          <DirectChat
            handle={handle}
            resetSeq={directChatResetSeq}
            onConvIdChange={setDirectChatConvId}
          />
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
  directChatConvId,
  onDirectChatReset,
}: {
  handle: string;
  selection: Selection;
  partnerDisplayName: string | null;
  partnerIsTrusted: boolean;
  /** 3.3.G3: aktive Direct-Chat-Conv-ID für Extract-Aufrufe. */
  directChatConvId?: string | null;
  onDirectChatReset?: () => void;
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
        <DirectChatActions
          handle={handle}
          conversationId={directChatConvId ?? null}
          onResetSuccess={onDirectChatReset}
        />
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

// #85: Trenner-Marker zwischen zwei Konversationen im Chat-Verlauf. Dezent
// gestaltet — eine horizontale Linie mit zentriertem Label. Daten-getrieben:
// erscheint dort, wo zwei aufeinanderfolgende Messages unterschiedliche
// conversationId haben.

function ConversationDivider() {
  return (
    <div className="flex items-center gap-3 my-4 text-[10px] uppercase tracking-wider text-muted">
      <div className="flex-1 h-px bg-border" />
      <span>Neue Konversation</span>
      <div className="flex-1 h-px bg-border" />
    </div>
  );
}

// ─── Direct-Chat-Actions (3.3.G3) ───────────────────────────────────────────
//
// Beendet die aktive Direct-Chat-Konversation des Owners mit seinem eigenen
// Twin (Pattern aus #71b/#80) und triggert auf Wunsch die Twin-Fact-
// Extraction (3.3.F) vor dem Reset.
//
// Drei UI-Flows:
//   1. „Reflektieren"-Button (allein) → POST /facts/extract, Toast mit Resultat
//   2. „Neu starten" → Modal mit drei Buttons:
//        - Abbrechen (Modal zu, nichts passiert)
//        - Nur beenden (Reset ohne Extract)
//        - Reflektieren + Beenden (Extract, dann Reset; bei Extract-Failure
//          trotzdem Reset, weil User-Intention "beenden" war)
//
// Toast-Feedback: zentrale Toast-API in `apps/web/lib/toast.ts` (sonner-
// basiert, UX.1.A.1 / Item #94). Modal-Komponente kommt aus
// `apps/web/components/ModalWrapper`.
//
// 3.3.G3 ersetzt den vorherigen #84-Inline-Confirm-Button durch das Modal-
// Pattern — drei Optionen passen nicht mehr in den zwei-Knopf-Inline-Modus.
//
// Wir leeren `messages[]` im DirectChat NICHT — der visuelle Verlauf bleibt
// scrollbar. Nur der Backend-Loader (filtert nach conversation_id) sieht die
// alten Messages beim nächsten Send nicht mehr. `onResetSuccess` reicht den
// Reset an die Page-Ebene weiter, damit DirectChat seine Live-Messages mit
// einer neuen Local-Conv-ID taggt — Trenner-Marker (#85) erscheint dann
// nach dem nächsten Send ohne Page-Reload.

function DirectChatActions({
  handle,
  conversationId,
  onResetSuccess,
}: {
  handle: string;
  conversationId: string | null;
  onResetSuccess?: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);

  const hasConversation = conversationId !== null;

  // UX.1.A.1 (#94): showToast → toast.success/.error/.info pro Call-Site.
  // Der lokale Wrapper wurde mit der Toast-Migration entfernt; siehe
  // `apps/web/lib/toast.ts` für die zentrale API.

  async function performExtract(): Promise<{
    extracted: number;
    error?: string;
  }> {
    if (!conversationId) {
      return { extracted: 0, error: "Keine aktive Konversation." };
    }
    try {
      const res = await fetch(
        `${RUNTIME_URL}/twins/${handle}/facts/extract`,
        {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ conversationId }),
        },
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: "Unknown error" }));
        return { extracted: 0, error: body.error ?? `HTTP ${res.status}` };
      }
      const data = (await res.json()) as { extracted: number };
      return { extracted: data.extracted ?? 0 };
    } catch (err) {
      return {
        extracted: 0,
        error: err instanceof Error ? err.message : "Reflexion fehlgeschlagen",
      };
    }
  }

  async function performReset() {
    try {
      await fetch(`${RUNTIME_URL}/twins/${handle}/conversations/reset`, {
        method: "POST",
        credentials: "include",
      });
      // Backend liefert {reset:false} wenn keine aktive Konversation existiert
      // — silent durchwinken. onResetSuccess immer feuern, damit der Trenner
      // auch in dem Fall nach dem nächsten Send greift (semantisch ist die
      // Konversation jetzt jedenfalls leer).
      onResetSuccess?.();
    } catch {
      // Silent: Bridge-Down oder Server-Hiccup — beim nächsten Send legt
      // das Backend ohnehin lazy eine neue Konversation an.
    }
  }

  async function handleReflectOnly() {
    if (busy || extracting || !hasConversation) return;
    setExtracting(true);
    setBusy(true);
    try {
      const result = await performExtract();
      if (result.error) {
        toast.error(`Reflexion fehlgeschlagen: ${result.error}`);
      } else if (result.extracted === 0) {
        toast.info("Keine neuen Facts extrahiert.");
      } else {
        toast.success(
          `${result.extracted} neue Fact${result.extracted === 1 ? "" : "s"} extrahiert. Review in /facts.`,
        );
      }
    } finally {
      setExtracting(false);
      setBusy(false);
    }
  }

  async function handleResetOnly() {
    if (busy) return;
    setBusy(true);
    try {
      await performReset();
      setModalOpen(false);
    } finally {
      setBusy(false);
    }
  }

  async function handleReflectAndReset() {
    if (busy || extracting) return;
    setExtracting(true);
    setBusy(true);
    try {
      const result = await performExtract();
      // Briefing-Entscheidung: bei Extract-Failure trotzdem Reset — User
      // wollte beenden, Extract war Nebenziel. Toast informiert über Lücke.
      if (result.error) {
        toast.error(
          `Reflexion fehlgeschlagen: ${result.error}\nKonversation wird trotzdem beendet.`,
        );
      } else if (result.extracted > 0) {
        toast.success(
          `${result.extracted} neue Fact${result.extracted === 1 ? "" : "s"} extrahiert. Review in /facts.`,
        );
      }
      await performReset();
      setModalOpen(false);
    } finally {
      setExtracting(false);
      setBusy(false);
    }
  }

  // Modal-Close-Guard: während Extract/Reset läuft, kein Schließen via
  // Backdrop oder ESC — sonst landet der User in einem inkonsistenten Zustand.
  const modalClose = () => {
    if (extracting || busy) return;
    setModalOpen(false);
  };

  return (
    <>
      <button
        onClick={handleReflectOnly}
        disabled={busy || extracting || !hasConversation}
        title={
          !hasConversation
            ? "Noch keine Konversation aktiv"
            : "Twin reflektiert und schlägt neue Facts vor"
        }
        className="text-xs text-muted border border-border rounded px-2 py-1 hover:border-accent hover:text-accent disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
      >
        {extracting ? "Reflektiere…" : "Reflektieren"}
      </button>
      <button
        onClick={() => setModalOpen(true)}
        disabled={busy}
        title="Konversation beenden — Twin startet beim nächsten Send ohne Erinnerung"
        className="text-xs text-muted border border-border rounded px-2 py-1 hover:border-accent hover:text-accent disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
      >
        ↻ Neu starten
      </button>

      {modalOpen && (
        <ModalWrapper onClose={modalClose}>
          <div className="p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm text-text font-medium">
                Konversation beenden
              </h2>
              <button
                type="button"
                onClick={modalClose}
                disabled={extracting || busy}
                className="text-muted hover:text-text text-sm disabled:opacity-30 disabled:cursor-not-allowed"
                aria-label="Schließen"
              >
                ✕
              </button>
            </div>
            <p className="text-sm text-muted leading-relaxed">
              Soll der Twin noch über die Konversation reflektieren? Er kann
              dabei neue Facts vorschlagen, die du in{" "}
              <Link
                href={`/facts?twin=${encodeURIComponent(handle)}`}
                className="text-accent hover:underline"
              >
                /facts
              </Link>{" "}
              reviewen kannst.
            </p>
            {extracting && (
              <div className="text-xs text-accent italic">
                Twin reflektiert… bitte warten.
              </div>
            )}
            {!hasConversation && (
              <div className="text-xs text-muted">
                (Reflektieren ist nicht verfügbar, weil noch keine Konversation
                aktiv ist.)
              </div>
            )}
            <div className="flex items-center justify-end gap-2 pt-1 flex-wrap">
              <button
                type="button"
                onClick={modalClose}
                disabled={extracting || busy}
                className="px-3 py-1.5 text-xs border border-border text-muted rounded hover:text-text hover:border-text transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
              >
                Abbrechen
              </button>
              <button
                type="button"
                onClick={handleResetOnly}
                disabled={extracting || busy}
                className="px-3 py-1.5 text-xs border border-warn text-warn rounded hover:bg-warn hover:text-bg transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
              >
                Nur beenden
              </button>
              <button
                type="button"
                onClick={handleReflectAndReset}
                disabled={extracting || busy || !hasConversation}
                className="px-3 py-1.5 text-xs border border-accent text-accent rounded hover:bg-accent hover:text-bg transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
              >
                {extracting ? "Reflektiere…" : "Reflektieren + Beenden"}
              </button>
            </div>
          </div>
        </ModalWrapper>
      )}
    </>
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

// #85: ChatMessage-Erweiterung um conversationId. Audit-Mapping reicht das
// Field aus AuditEntry.conversationId durch (Backend liefert es seit
// 3.2.G: ChatBlock — atomares Render-Item im Direct-Chat-Verlauf. Aus dem
// Audit-Stream rekonstruiert; Live-Sends tragen optimistic einen `user`-Block
// bei, der beim nächsten Audit-Refresh durch den Server-Eintrag ersetzt wird.
//
//   - user/assistant: klassische Bubbles (owner-direct + Pending-Reply +
//     finale Reply nach Approve)
//   - mcp-tool-call: separate Box mit Tool-Name/Args/Result, status-spezifisch
//     gerendert (pending → Approve/Reject-Buttons; executed/rejected →
//     Status-Marker + Result-Preview)
//
// `auditId` auf den Bubbles ist der Audit, aus dem sie stammen — bei mcp-
// tool-use teilen sich User-Bubble, Pending-Reply, Tool-Call-Box und finale
// Reply dieselbe ID.
type ChatBlock =
  | {
      kind: "user";
      content: string;
      conversationId: string | null;
      auditId: string | null;
    }
  | {
      kind: "assistant";
      content: string;
      conversationId: string | null;
      auditId: string | null;
    }
  | {
      kind: "mcp-tool-call";
      auditId: string;
      conversationId: string | null;
      toolName: string;
      args: Record<string, unknown>;
      status: "pending" | "executed" | "rejected";
      toolResult?: unknown;
      rejectReason?: string | null;
    };

interface AuditMcpToolUseShape {
  lastMessage?: string;
  pendingReply?: string;
  toolCall?: {
    mcpServerId: string;
    mcpToolName: string;
    args: Record<string, unknown>;
  };
}

interface AuditOwnerDirectShape {
  lastMessage?: string;
}

interface AuditExecutedOutputShape {
  reply?: string;
  toolResult?: unknown;
  rejected?: boolean;
  rejectReason?: string;
}

/**
 * 3.2.G: Audit-Liste (DESC vom Server) → ChatBlocks (ASC für Render).
 * Pro Audit-Eintrag entstehen 1-4 Blöcke je nach Capability + Status:
 *   - owner-direct/executed → user + assistant
 *   - mcp-tool-use/pending → user + assistant(pendingReply) + tool-call(pending)
 *   - mcp-tool-use/executed → user + assistant(pendingReply) + tool-call(executed) + assistant(finalReply)
 *   - mcp-tool-use/rejected → user + assistant(pendingReply) + tool-call(rejected) + assistant(rejectReply)
 * Ungültige/unvollständige Einträge werden geskippt.
 */
function buildChatBlocksFromAudits(entries: AuditEntry[]): {
  blocks: ChatBlock[];
  newestConvId: string | null;
} {
  const blocks: ChatBlock[] = [];
  let newestConvId: string | null = null;
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i];
    if (!entry) continue;
    if (!DIRECT_CHAT_CAPABILITIES.has(entry.capability)) continue;
    const cid = entry.conversationId ?? null;

    if (entry.capability === "mcp-tool-use") {
      if (entry.status === "failed" || entry.status === "blocked") continue;
      const input = entry.input as AuditMcpToolUseShape;
      const tc = input.toolCall;
      if (!tc) continue;
      const userText = typeof input.lastMessage === "string" ? input.lastMessage : null;
      const pendingReply =
        typeof input.pendingReply === "string" ? input.pendingReply : null;
      if (!userText || !pendingReply) continue;
      blocks.push({ kind: "user", content: userText, conversationId: cid, auditId: entry.id });
      blocks.push({
        kind: "assistant",
        content: pendingReply,
        conversationId: cid,
        auditId: entry.id,
      });
      const status: "pending" | "executed" | "rejected" =
        entry.status === "executed"
          ? "executed"
          : entry.status === "rejected"
            ? "rejected"
            : "pending";
      const output = (entry.output ?? null) as AuditExecutedOutputShape | null;
      blocks.push({
        kind: "mcp-tool-call",
        auditId: entry.id,
        conversationId: cid,
        toolName: tc.mcpToolName,
        args: tc.args,
        status,
        toolResult: output?.toolResult,
        rejectReason: output?.rejectReason ?? null,
      });
      if ((entry.status === "executed" || entry.status === "rejected") && output?.reply) {
        blocks.push({
          kind: "assistant",
          content: output.reply,
          conversationId: cid,
          auditId: entry.id,
        });
      }
      newestConvId = cid;
      continue;
    }

    // owner-direct + respond_to_chat: nur ausgeführte Turns rendern.
    if (entry.status !== "executed") continue;
    const input = entry.input as AuditOwnerDirectShape;
    const output = (entry.output ?? null) as AuditExecutedOutputShape | null;
    const userText = typeof input.lastMessage === "string" ? input.lastMessage : null;
    const replyText = output && typeof output.reply === "string" ? output.reply : null;
    if (!userText || !replyText) continue;
    blocks.push({ kind: "user", content: userText, conversationId: cid, auditId: entry.id });
    blocks.push({
      kind: "assistant",
      content: replyText,
      conversationId: cid,
      auditId: entry.id,
    });
    newestConvId = cid;
  }
  return { blocks, newestConvId };
}

function DirectChat({
  handle,
  resetSeq,
  onConvIdChange,
}: {
  handle: string;
  resetSeq: number;
  /** 3.3.G3: liftet die jüngste Conv-ID nach oben, damit der Conversation-
   *  Header sie für Extract-Calls nutzen kann. */
  onConvIdChange?: (id: string | null) => void;
}) {
  const [auditEntries, setAuditEntries] = useState<AuditEntry[]>([]);
  // 3.2.G Optimistic-Pfad: User-Text wird sofort als pseudo-Bubble angehängt,
  // beim nächsten erfolgreichen loadAudits() ersetzt der Server-Audit ihn.
  // null = nichts in flight.
  const [optimisticUser, setOptimisticUser] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 3.2.G: Loading-State pro Audit für Approve/Reject — Tool-Call braucht
  // 5-10s (Spawn + LLM-Resume), Buttons werden in der Zeit disabled.
  const [loadingAuditId, setLoadingAuditId] = useState<string | null>(null);
  // UX.1.A.1 (#91): Reject-Reason-Modal-State statt window.prompt().
  const [rejectModal, setRejectModal] = useState<{
    open: boolean;
    auditId?: string;
    subject?: string;
  }>({ open: false });
  // #85: Conv-ID, mit der neue Live-Messages getagged werden. Initial null;
  // nach Audit-Load auf die newest convId gesetzt — so erweitern Live-Sends
  // die laufende Konversation, ohne falschen Trenner. Nach Reset bumped der
  // Parent `resetSeq`, und wir setzen activeConvId auf eine synthetische
  // Local-ID — damit erscheint nach dem nächsten Send ein Trenner zwischen
  // letzter Server-Message und der neuen Live-Pärchen.
  const [activeConvId, setActiveConvId] = useState<string | null>(null);

  const { blocks: serverBlocks, newestConvId } = useMemo(
    () => buildChatBlocksFromAudits(auditEntries),
    [auditEntries],
  );

  const chatBlocks = useMemo<ChatBlock[]>(() => {
    if (!optimisticUser) return serverBlocks;
    return [
      ...serverBlocks,
      {
        kind: "user" as const,
        content: optimisticUser,
        conversationId: activeConvId,
        auditId: null,
      },
    ];
  }, [serverBlocks, optimisticUser, activeConvId]);

  const { containerRef, bottomRef, onScroll } = useAutoScroll(
    chatBlocks.length,
    `direct:${handle}`,
  );

  const loadAudits = useCallback(async () => {
    try {
      const res = await fetch(`${RUNTIME_URL}/twins/${handle}/audit?limit=50`, {
        credentials: "include",
      });
      if (!res.ok) return;
      const data = (await res.json()) as { entries: AuditEntry[] };
      setAuditEntries(data.entries);
    } catch {
      // Silent fail — UI bleibt mit dem letzten Stand.
    }
  }, [handle]);

  // History aus dem Audit-Log nachladen — sonst geht der Verlauf bei jedem
  // Tab-Switch verloren, weil DirectChat dann frisch gemountet wird (#71).
  // Plus 3.2.G: Polling alle 5s für mcp-tool-use-Status-Updates (gleiche
  // Frequenz wie /inbox-Polling). Nach Approve/Reject manueller Trigger,
  // Polling ist nur das Sicherheitsnetz.
  useEffect(() => {
    let cancelled = false;
    void loadAudits();
    const interval = setInterval(() => {
      if (!cancelled) void loadAudits();
    }, 5000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [loadAudits]);

  // newestConvId aus Audit-Stream synchen — Live-Sends erweitern die
  // laufende Konversation, ohne falschen Trenner.
  useEffect(() => {
    setActiveConvId(newestConvId);
  }, [newestConvId]);

  // 3.3.G3: aktive Conv-ID nach oben lifften, damit der Conversation-Header
  // sie für Extract-Calls nutzen kann. Wir geben nur ECHTE Server-IDs raus
  // (newestConvId), nicht die synthetischen local-after-reset-IDs aus
  // resetSeq — Backend-Extract braucht eine persistierte conversationId.
  useEffect(() => {
    onConvIdChange?.(newestConvId);
  }, [newestConvId, onConvIdChange]);

  // #85: Reset-Bump aus dem Parent. Synthetische Local-ID mit `resetSeq` —
  // bei jedem Increment einzigartig. activeConvId weicht damit von der
  // bisherigen Conv ab → Trenner-Marker erscheint zwischen letzter Server-
  // Message und der nächsten Live-Pärchen. Die ID ist nur lokal valide; nach
  // Page-Reload übernimmt der Server die echten conversation_ids und das
  // Marker-Position wird daten-getrieben rekonstruiert.
  // resetSeq=0 ist der Initialwert (kein Reset bislang) → kein Override.
  useEffect(() => {
    if (resetSeq <= 0) return;
    setActiveConvId(`local-after-reset-${handle}-${resetSeq}`);
  }, [resetSeq, handle]);

  async function send() {
    if (!input.trim() || busy) return;
    const userText = input;
    setInput("");
    await sendChat(userText);
  }

  async function sendChat(
    userText: string,
    forcedToolChoice?: { type: "tool"; toolName: string },
  ) {
    setOptimisticUser(userText);
    setBusy(true);
    setError(null);

    try {
      const res = await fetch(`${RUNTIME_URL}/twins/${handle}/chat`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        // Backend rekonstruiert die LLM-History server-seitig aus der aktiven
        // Konversation (#71b/#80 Sub-Schritt C); wir schicken minimal die
        // letzte User-Message mit, damit das alte Schema kompatibel bleibt.
        // 3.2.H: forcedToolChoice nur bei Picker-Submit gesetzt — für normale
        // Texteingaben bleibt es undefined → Default-Auto im Backend.
        body: JSON.stringify({
          messages: [{ role: "user", content: userText }],
          ...(forcedToolChoice ? { forcedToolChoice } : {}),
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: "Unknown error" }));
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      // 3.2.G: in beiden Fällen (pending oder direct reply) reload — der
      // Audit-Stream ist Single-Source-of-Truth fürs Rendering.
      await loadAudits();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    } finally {
      setOptimisticUser(null);
      setBusy(false);
    }
  }

  // 3.2.H: Tool-Picker-Submit. Baut die User-Message als '[Tool-Aufruf]' +
  // Args-JSON, sendet mit forcedToolChoice. Backend zwingt LLM zum Tool-Call,
  // Tool-Result wird vom LLM interpretiert und als finale Antwort
  // zurückgegeben. Approval-Pfad bleibt transparent.
  async function sendToolFromPicker(
    toolName: string,
    args: Record<string, unknown>,
  ) {
    const userText = `[Tool-Aufruf] ${toolName} mit Args ${JSON.stringify(args)}`;
    await sendChat(userText, { type: "tool", toolName });
  }

  async function handleApprove(auditId: string) {
    setLoadingAuditId(auditId);
    setError(null);
    try {
      const res = await fetch(
        `${RUNTIME_URL}/twins/${handle}/audit/${auditId}/approve`,
        { method: "POST", credentials: "include" },
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: "Unknown error" }));
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      await loadAudits();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Approve fehlgeschlagen");
    } finally {
      setLoadingAuditId(null);
    }
  }

  function handleReject(auditId: string, subject?: string) {
    // UX.1.A.1 (#91): Modal-State setzen statt blocking prompt(). Daten-
    // Fetch passiert in confirmRejectFromModal nach Submit.
    setRejectModal({ open: true, auditId, subject });
  }

  async function confirmRejectFromModal(reason: string) {
    if (!rejectModal.auditId) return;
    const auditId = rejectModal.auditId;
    const reasonOrDefault = reason.trim() || "Nicht freigegeben";
    setLoadingAuditId(auditId);
    setError(null);
    try {
      const res = await fetch(
        `${RUNTIME_URL}/twins/${handle}/audit/${auditId}/reject`,
        {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reason: reasonOrDefault }),
        },
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: "Unknown error" }));
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      await loadAudits();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Reject fehlgeschlagen");
      throw err; // Re-throw für Modal-Error-Toast.
    } finally {
      setLoadingAuditId(null);
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
          {chatBlocks.length === 0 ? (
            <div className="text-muted text-sm">
              Noch keine Nachrichten. Schreib unten eine Frage.
            </div>
          ) : (
            // #85: Trenner zwischen aufeinanderfolgenden Blöcken mit
            // unterschiedlicher conversationId. Erster Block (i===0) bekommt
            // nie einen Trenner davor. Daten-getrieben — überlebt
            // Page-Reload, weil aus dem geladenen Audit-Stream abgeleitet.
            chatBlocks.map((block, i) => {
              const prev = i > 0 ? chatBlocks[i - 1] : undefined;
              const showDivider =
                prev !== undefined && prev.conversationId !== block.conversationId;
              return (
                <Fragment key={i}>
                  {showDivider && <ConversationDivider />}
                  {block.kind === "mcp-tool-call" ? (
                    <McpToolCallBox
                      toolName={block.toolName}
                      args={block.args}
                      status={block.status}
                      toolResult={block.toolResult}
                      rejectReason={block.rejectReason}
                      busy={loadingAuditId === block.auditId}
                      onApprove={() => handleApprove(block.auditId)}
                      onReject={() => handleReject(block.auditId, block.toolName)}
                    />
                  ) : (
                    <Bubble role={block.kind} content={block.content} />
                  )}
                </Fragment>
              );
            })
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
        {/* 3.2.H: Tool-Picker zwischen Input und Send. Klick öffnet Modal mit
            aktiven MCP-Tools, Submit zwingt den Tool-Call. */}
        <ToolPicker handle={handle} disabled={busy} onSend={sendToolFromPicker} />
        <button
          onClick={send}
          disabled={busy || !input.trim()}
          className="px-4 py-2 border border-accent text-accent text-sm rounded disabled:opacity-30 disabled:cursor-not-allowed hover:bg-accent hover:text-bg transition-colors"
        >
          send
        </button>
      </div>
      <RejectReasonModal
        open={rejectModal.open}
        subject={rejectModal.subject}
        onConfirm={confirmRejectFromModal}
        onCancel={() => setRejectModal({ open: false })}
      />
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

// 3.2.G: Strukturierter Block für mcp-tool-use-Audits. Drei States:
//   - pending: Tool-Name + Args + Approve/Reject-Buttons (mit Loading)
//   - executed: ✓ approved, Result-Preview
//   - rejected: ✗ rejected, optional Begründung
// Box ist 100% breit (anders als Bubbles 70%) — visuell als „strukturierter
// Action-Slot" abgesetzt von Konversations-Inhalt.
function McpToolCallBox({
  toolName,
  args,
  status,
  toolResult,
  rejectReason,
  busy,
  onApprove,
  onReject,
}: {
  toolName: string;
  args: Record<string, unknown>;
  status: "pending" | "executed" | "rejected";
  toolResult?: unknown;
  rejectReason?: string | null;
  busy: boolean;
  onApprove: () => void;
  onReject: () => void;
}) {
  let statusLabel: string;
  let statusClass: string;
  if (status === "executed") {
    statusLabel = "✓ approved";
    statusClass = "text-accent";
  } else if (status === "rejected") {
    statusLabel = "✗ rejected";
    statusClass = "text-warn";
  } else {
    statusLabel = "wartet auf Freigabe";
    statusClass = "text-warn";
  }

  let argsPreview: string;
  try {
    argsPreview = JSON.stringify(args);
  } catch {
    argsPreview = "(args nicht serialisierbar)";
  }

  let resultPreview: string | null = null;
  if (status === "executed" && toolResult !== undefined && toolResult !== null) {
    if (Array.isArray(toolResult)) {
      const texts = toolResult
        .map((p: unknown) => {
          if (
            p &&
            typeof p === "object" &&
            "text" in p &&
            typeof (p as { text?: unknown }).text === "string"
          ) {
            return (p as { text: string }).text;
          }
          try {
            return JSON.stringify(p);
          } catch {
            return String(p);
          }
        })
        .join(" ");
      resultPreview = texts.trim() || null;
    } else {
      try {
        resultPreview = JSON.stringify(toolResult);
      } catch {
        resultPreview = String(toolResult);
      }
    }
  }

  return (
    <div className="bg-surface border border-border rounded p-3 space-y-2">
      <div className="flex items-center gap-2 text-[10px] uppercase tracking-wider">
        <span className="text-muted">Tool-Call</span>
        <span className={statusClass}>{statusLabel}</span>
      </div>
      <div className="text-xs space-y-1">
        <div>
          <span className="text-muted">Tool: </span>
          <span className="font-mono text-text">{toolName}</span>
        </div>
        <div>
          <span className="text-muted">Args: </span>
          <span className="font-mono text-text break-all">{argsPreview}</span>
        </div>
        {resultPreview && (
          <div>
            <span className="text-muted">Result: </span>
            <span className="font-mono text-text break-all whitespace-pre-wrap">
              {resultPreview}
            </span>
          </div>
        )}
        {status === "rejected" && rejectReason && (
          <div>
            <span className="text-muted">Begründung: </span>
            <span className="text-text">{rejectReason}</span>
          </div>
        )}
      </div>
      {status === "pending" && (
        <div className="flex gap-2 pt-1">
          {busy ? (
            <div className="text-xs text-accent italic">
              Tool läuft… (kann ein paar Sekunden dauern)
            </div>
          ) : (
            <>
              <button
                onClick={onApprove}
                className="px-3 py-1.5 text-xs border border-accent text-accent rounded hover:bg-accent hover:text-bg transition-colors"
              >
                approve
              </button>
              <button
                onClick={onReject}
                className="px-3 py-1.5 text-xs border border-warn text-warn rounded hover:bg-warn hover:text-bg transition-colors"
              >
                reject
              </button>
            </>
          )}
        </div>
      )}
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
