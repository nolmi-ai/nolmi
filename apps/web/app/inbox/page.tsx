"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { AuditEntry, ChatMessage, TwinEvent } from "@twin-lab/shared";
import { EmptyState } from "../../components/EmptyState";
import { PageContainer } from "../../components/PageContainer";
import { RejectReasonModal } from "../../components/RejectReasonModal";
import { resolveToolDisplay } from "../../lib/tool-display";

const RUNTIME_URL = process.env.NEXT_PUBLIC_RUNTIME_URL ?? "http://localhost:4000";

// ─── INBOX-PAGE (2.5.4.3) ────────────────────────────────────────────────────
//
// Aktivitäts-Zentrale: pending Approvals, letzte Approvals, Audit-Log. Vorher
// alles in Settings vermischt; mit 2.5.4.3 wandert das hier rüber, Settings
// bleibt reine Konfiguration.
//
// Twin-Auswahl via ?twin=<handle>. Beim ersten Open ohne Param: erster
// eigener Twin gewinnt, URL wird ergänzt (gleiches Pattern wie Settings).

interface TwinSummary {
  twinId: string;
  handle: string;
  displayName: string;
}

export default function InboxPage() {
  return (
    <Suspense fallback={<div className="text-sm text-muted">Lade Inbox…</div>}>
      <InboxInner />
    </Suspense>
  );
}

function InboxInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const requestedHandle = searchParams.get("twin");

  const [twins, setTwins] = useState<TwinSummary[]>([]);
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [pending, setPending] = useState<AuditEntry[]>([]);
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);
  // UX.1.A.1 (#91): Reject-Reason-Modal-State statt window.prompt().
  const [rejectModal, setRejectModal] = useState<{
    open: boolean;
    auditId?: string;
    subject?: string;
  }>({ open: false });

  const selectedHandle = useMemo(
    () => requestedHandle ?? twins[0]?.handle ?? null,
    [requestedHandle, twins],
  );

  // Twin-Liste laden, danach ggf. URL-Param ergänzen.
  useEffect(() => {
    let cancelled = false;
    fetch(`${RUNTIME_URL}/twins`, { credentials: "include" })
      .then((res) => (res.ok ? res.json() : Promise.reject(`HTTP ${res.status}`)))
      .then((data: { twins: TwinSummary[] }) => {
        if (cancelled) return;
        setTwins(data.twins);
        if (!requestedHandle && data.twins[0]) {
          const params = new URLSearchParams(searchParams.toString());
          params.set("twin", data.twins[0].handle);
          router.replace(`/inbox?${params.toString()}`);
        }
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Twins laden fehlgeschlagen");
      });
    return () => {
      cancelled = true;
    };
  }, [requestedHandle, router, searchParams]);

  const loadAudit = useCallback(async (handle: string) => {
    try {
      const res = await fetch(`${RUNTIME_URL}/twins/${handle}/audit?limit=50`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { entries: AuditEntry[] };
      setAudit(data.entries);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Audit konnte nicht geladen werden");
    }
  }, []);

  const loadPending = useCallback(async (handle: string) => {
    try {
      const res = await fetch(`${RUNTIME_URL}/twins/${handle}/audit/pending`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { entries: AuditEntry[] };
      setPending(data.entries);
    } catch (err) {
      console.error("loadPending failed:", err);
    }
  }, []);

  // Beim Twin-Wechsel: zurücksetzen + neu laden + SSE-Subscribe für gezielte
  // Refreshes statt Polling. Polling als Backup-Sicherheitsnetz alle 5s,
  // damit ein verschluckter SSE-Event nicht den Counter dauerhaft falsch lässt.
  useEffect(() => {
    if (!selectedHandle) return;
    setAudit([]);
    setPending([]);
    loadAudit(selectedHandle);
    loadPending(selectedHandle);

    const es = new EventSource(`${RUNTIME_URL}/twins/${selectedHandle}/stream`, {
      withCredentials: true,
    });
    es.onmessage = (event) => {
      try {
        const parsed = JSON.parse(event.data) as TwinEvent;
        if (
          parsed.type === "pending-added" ||
          parsed.type === "pending-resolved" ||
          parsed.type === "audit.updated" ||
          parsed.type === "audit.created"
        ) {
          loadPending(selectedHandle);
          loadAudit(selectedHandle);
        }
      } catch {
        // ignore
      }
    };
    const interval = setInterval(() => {
      loadPending(selectedHandle);
      loadAudit(selectedHandle);
    }, 5000);
    return () => {
      clearInterval(interval);
      es.close();
    };
  }, [selectedHandle, loadAudit, loadPending]);

  async function approve(id: string) {
    if (!selectedHandle) return;
    setBusy((b) => ({ ...b, [id]: true }));
    setError(null);
    try {
      const res = await fetch(
        `${RUNTIME_URL}/twins/${selectedHandle}/audit/${id}/approve`,
        { method: "POST", credentials: "include" },
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: "Unknown error" }));
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      await loadPending(selectedHandle);
      await loadAudit(selectedHandle);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Approve fehlgeschlagen");
    } finally {
      setBusy((b) => ({ ...b, [id]: false }));
    }
  }

  function reject(id: string, subject?: string) {
    if (!selectedHandle) return;
    // UX.1.A.1 (#91): Modal öffnen statt window.prompt() blocken — async
    // Submit + Loading-State + a11y. Daten-Fetch passiert in confirmReject.
    setRejectModal({ open: true, auditId: id, subject });
  }

  async function confirmReject(reason: string) {
    if (!selectedHandle || !rejectModal.auditId) return;
    const id = rejectModal.auditId;
    // Fallback auf alten Default-Reason, damit Audit-Trail nie leer ist.
    const reasonOrDefault = reason.trim() || "Nicht freigegeben";
    setBusy((b) => ({ ...b, [id]: true }));
    setError(null);
    try {
      const res = await fetch(
        `${RUNTIME_URL}/twins/${selectedHandle}/audit/${id}/reject`,
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
      await loadPending(selectedHandle);
      await loadAudit(selectedHandle);
    } catch (err) {
      // Re-throw, damit das Modal den error-Toast zeigen kann.
      setError(err instanceof Error ? err.message : "Reject fehlgeschlagen");
      throw err;
    } finally {
      setBusy((b) => ({ ...b, [id]: false }));
    }
  }

  const recentApprovals = audit
    .filter((e) => (e.status === "executed" || e.status === "rejected") && hasReply(e))
    .slice(0, 5);

  return (
    <PageContainer className="space-y-8">
      <div className="flex items-baseline gap-3">
        <h1 className="text-xl font-semibold text-text">Inbox</h1>
        {selectedHandle && (
          <span className="text-xs text-muted font-mono">{selectedHandle}</span>
        )}
      </div>

      {error && (
        <div className="text-xs text-warn border border-warn rounded px-3 py-2">
          {error}
        </div>
      )}

      <Section title={`Pending (${pending.length})`}>
        {pending.length === 0 ? (
          <EmptyState
            title="Keine wartenden Aktionen"
            description={
              <>
                Wenn dein Twin eine Aktion vorschlägt, die Genehmigung
                braucht — eine Webseite lesen, eine Mail senden, ein Tool
                nutzen — landet sie hier. Du genehmigst per Klick oder
                lehnst ab.
              </>
            }
          />
        ) : (
          <ul className="space-y-3">
            {pending.map((entry) => {
              const header = formatPendingHeader(entry);
              const isBusy = busy[entry.id] ?? false;
              const isFactWrite = entry.capability === "semantic-fact-write";
              return (
                <li key={entry.id} className="border border-border rounded p-4 space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="text-xs text-accent uppercase tracking-wider mb-1">
                        {header}
                      </div>
                      <div className="text-xs text-muted">
                        {new Date(entry.timestamp).toLocaleString()}
                      </div>
                      {/* 3.3.G1: Capability-spezifisches Content-Display.
                          semantic-fact-write zeigt Fact-Pair + Reasoning
                          prominent; alle anderen Capabilities behalten den
                          generischen lastMessage-Pfad. */}
                      {isFactWrite ? (
                        <FactProposalBody entry={entry} />
                      ) : (
                        <div className="text-sm text-text mt-2 whitespace-pre-wrap">
                          {extractLastMessage(entry)}
                        </div>
                      )}
                    </div>
                    <div className="flex gap-2 flex-shrink-0">
                      <button
                        onClick={() => approve(entry.id)}
                        disabled={isBusy}
                        className="px-3 py-1.5 text-xs border border-accent text-accent rounded hover:bg-accent hover:text-bg disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                      >
                        {isBusy ? "..." : "approve"}
                      </button>
                      <button
                        onClick={() => reject(entry.id, header)}
                        disabled={isBusy}
                        className="px-3 py-1.5 text-xs border border-warn text-warn rounded hover:bg-warn hover:text-bg disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                      >
                        reject
                      </button>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Section>

      <Section title={`Letzte Approvals (${recentApprovals.length})`}>
        {recentApprovals.length === 0 ? (
          <div className="text-sm text-muted">
            Noch keine approved Aktionen mit Inhalt.
          </div>
        ) : (
          <ul className="space-y-4">
            {recentApprovals.map((entry) => {
              const lastMessage = extractLastMessage(entry);
              const reply = extractReply(entry);
              return (
                <li key={entry.id} className="border border-border rounded p-4 space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="text-xs text-accent uppercase tracking-wider mb-1">
                        {formatCapability(entry)}
                      </div>
                      <div className="text-xs text-muted">
                        {new Date(entry.timestamp).toLocaleString()} ·{" "}
                        <span
                          className={
                            entry.status === "rejected" ? "text-warn" : "text-accent"
                          }
                        >
                          {entry.status}
                        </span>
                      </div>
                      <div className="text-sm text-muted mt-2 italic">
                        Anfrage: {lastMessage}
                      </div>
                    </div>
                  </div>
                  {reply && (
                    <div className="border-t border-border pt-3">
                      <div className="text-[10px] text-muted uppercase tracking-wider mb-2">
                        Generierter Inhalt
                      </div>
                      <div className="text-sm text-text whitespace-pre-wrap bg-bg border border-border rounded p-3 leading-relaxed">
                        {reply}
                      </div>
                      <button
                        onClick={() => navigator.clipboard.writeText(reply)}
                        className="mt-2 text-xs text-accent hover:underline"
                      >
                        In Zwischenablage kopieren
                      </button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Section>

      <Section title="Audit-Log (letzte 50 Aktionen)">
        {audit.length === 0 ? (
          <div className="text-sm text-muted">Noch keine Aktionen.</div>
        ) : (
          <table className="w-full text-xs">
            <thead className="text-muted border-b border-border">
              <tr>
                <th className="text-left py-2 pr-3">Zeit</th>
                <th className="text-left py-2 pr-3">Capability</th>
                <th className="text-left py-2 pr-3">Status</th>
                <th className="text-left py-2">Mandate</th>
              </tr>
            </thead>
            <tbody>
              {audit.map((entry) => (
                <tr key={entry.id} className="border-b border-border">
                  <td className="py-2 pr-3 text-muted">
                    {new Date(entry.timestamp).toLocaleString()}
                  </td>
                  <td className="py-2 pr-3 text-text">{formatCapability(entry)}</td>
                  <td
                    className={
                      entry.status === "executed"
                        ? "py-2 pr-3 text-accent"
                        : entry.status === "blocked" ||
                            entry.status === "failed" ||
                            entry.status === "rejected"
                          ? "py-2 pr-3 text-warn"
                          : entry.status === "pending"
                            ? "py-2 pr-3 text-accent"
                            : "py-2 pr-3 text-muted"
                    }
                  >
                    {entry.status}
                  </td>
                  <td className="py-2 text-muted truncate max-w-[200px]">
                    {entry.mandateId ?? "-"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>
      <RejectReasonModal
        open={rejectModal.open}
        subject={rejectModal.subject}
        onConfirm={confirmReject}
        onCancel={() => setRejectModal({ open: false })}
      />
    </PageContainer>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="bg-surface border border-border rounded p-5">
      <h2 className="text-sm font-semibold text-text mb-3 tracking-tight">{title}</h2>
      {children}
    </section>
  );
}

// ─── helpers ────────────────────────────────────────────────────────────────

function extractLastMessage(entry: AuditEntry): string {
  const input = entry.input as {
    lastMessage?: string;
    messages?: ChatMessage[];
    content?: string;
    toolCall?: {
      mcpServerId?: string;
      mcpToolName?: string;
      args?: Record<string, unknown>;
    };
  };
  // 3.2.F: mcp-tool-use Pending zeigt Tool-Name + Args statt der LLM-
  // History — der User soll auf einen Blick sehen, was approved werden soll.
  // UX.1.A / #95: Display via resolveToolDisplay — human-readable Label +
  // formatierte Args statt rohem Identifier + JSON-Blob.
  if (entry.capability === "mcp-tool-use" && input.toolCall?.mcpToolName) {
    const display = resolveToolDisplay(
      input.toolCall.mcpToolName,
      input.toolCall.args,
    );
    return `${display.label}\n${display.argsPreview}`;
  }
  if (typeof input.lastMessage === "string") return input.lastMessage;
  if (Array.isArray(input.messages)) {
    const last = input.messages[input.messages.length - 1];
    if (last?.content) return last.content;
  }
  if (typeof input.content === "string") return input.content;
  return "(keine Eingabe gefunden)";
}

function formatPendingHeader(entry: AuditEntry): string {
  const input = entry.input as {
    fromHandle?: string;
    targetHandle?: string;
    toolCall?: {
      mcpServerId?: string;
      mcpToolName?: string;
      args?: Record<string, unknown>;
    };
  };
  if (entry.capability === "respond_to_twin_message" && input.fromHandle) {
    return `Eingehend von ${input.fromHandle}`;
  }
  if (entry.capability === "send_to_twin" && input.targetHandle) {
    return `An ${input.targetHandle} senden`;
  }
  if (entry.capability === "mcp-tool-use" && input.toolCall?.mcpToolName) {
    // UX.1.A / #95: Header bekommt das human-readable Label statt rohem ID.
    const display = resolveToolDisplay(
      input.toolCall.mcpToolName,
      input.toolCall.args,
    );
    return display.label;
  }
  return entry.capability;
}

function formatCapability(entry: AuditEntry): string {
  const input = entry.input as {
    fromHandle?: string;
    trustedHandle?: string;
    reasonCode?: string;
    toHandle?: string;
  };
  switch (entry.capability) {
    case "owner-direct":
      return "Direkter Chat (Owner)";
    case "trusted-bypass":
      return input.fromHandle ? `Trusted: ${input.fromHandle}` : "Trusted-Bypass";
    case "trust-added":
      return input.trustedHandle
        ? `Vertrauen hinzugefügt: ${input.trustedHandle}`
        : "Vertrauen hinzugefügt";
    case "trust-removed":
      return input.trustedHandle
        ? `Vertrauen entfernt: ${input.trustedHandle}`
        : "Vertrauen entfernt";
    case "system-message":
      return input.reasonCode
        ? `System-Antwort: ${input.reasonCode}`
        : "System-Antwort";
    case "system-message-received":
      return input.fromHandle
        ? `System-Nachricht empfangen von ${input.fromHandle}`
        : "System-Nachricht empfangen";
    case "reply-received":
      return input.fromHandle
        ? `Antwort empfangen von ${input.fromHandle}`
        : "Antwort empfangen";
    case "owner-direct-send":
      return input.toHandle
        ? `Direkt gesendet an ${input.toHandle}`
        : "Direkt gesendet";
    case "mcp-tool-use": {
      // UX.1.A / #95: human-readable Label, kein roher Identifier.
      const toolCall = (
        entry.input as {
          toolCall?: { mcpToolName?: string; args?: Record<string, unknown> };
        }
      ).toolCall;
      if (!toolCall?.mcpToolName) return "MCP-Tool";
      const display = resolveToolDisplay(toolCall.mcpToolName, toolCall.args);
      return display.label;
    }
    case "semantic-fact-write": {
      const factInput = entry.input as { factKey?: string };
      return factInput.factKey
        ? `Fakt-Vorschlag: ${factInput.factKey}`
        : "Fakt-Vorschlag";
    }
    default:
      return entry.capability;
  }
}

function hasReply(entry: AuditEntry): boolean {
  const output = entry.output as { reply?: string } | null;
  return typeof output?.reply === "string" && output.reply.length > 0;
}

// ─── FactProposalBody (3.3.G1) ──────────────────────────────────────────────
//
// Render-Card für Pending-Audits mit capability='semantic-fact-write'.
// Zeigt den Twin-Vorschlag prominent: factKey in Mono (für DB-Edit-
// Wiedererkennbarkeit) + factValue + Reasoning. Approve/Reject-Buttons sind
// im Container (Pending-Item) — diese Component liefert nur das Content-
// Display.
//
// Reasoning kann bis 500 Zeichen lang werden (Zod-Constraint aus 3.3.F);
// kein Truncate, white-space: pre-wrap. Lieber ausführlich anzeigen — User
// braucht volle Begründung für informierte Approval.
function FactProposalBody({ entry }: { entry: AuditEntry }) {
  const input = entry.input as {
    factKey?: string;
    factValue?: string;
    reasoning?: string;
  };
  const factKey = input.factKey ?? "(unbekannter Key)";
  const factValue = input.factValue ?? "(unbekannter Wert)";
  const reasoning = input.reasoning ?? "";

  return (
    <div className="mt-2 space-y-3">
      <div>
        <div className="text-[10px] text-muted uppercase tracking-wider mb-1">
          Vorgeschlagener Fakt
        </div>
        <div className="text-sm flex flex-wrap items-baseline gap-2">
          <code className="font-mono text-text bg-bg border border-border rounded px-1.5 py-0.5">
            {factKey}
          </code>
          <span className="text-muted">→</span>
          <span className="text-text whitespace-pre-wrap break-words">
            {factValue}
          </span>
        </div>
      </div>
      {reasoning && (
        <div>
          <div className="text-[10px] text-muted uppercase tracking-wider mb-1">
            Begründung
          </div>
          <div className="text-sm text-muted whitespace-pre-wrap break-words leading-relaxed">
            {reasoning}
          </div>
        </div>
      )}
    </div>
  );
}

function extractReply(entry: AuditEntry): string {
  const output = entry.output as { reply?: string } | null;
  return output?.reply ?? "";
}
