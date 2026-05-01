"use client";

import { useCallback, useEffect, useState } from "react";
import type { AuditEntry, ChatMessage } from "@twin-lab/shared";

const RUNTIME_URL = process.env.NEXT_PUBLIC_RUNTIME_URL ?? "http://127.0.0.1:4000";

export default function SettingsPage() {
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [pending, setPending] = useState<AuditEntry[]>([]);
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);

  const loadAudit = useCallback(async () => {
    try {
      const res = await fetch(`${RUNTIME_URL}/audit?limit=50`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { entries: AuditEntry[] };
      setAudit(data.entries);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load audit");
    }
  }, []);

  const loadPending = useCallback(async () => {
    try {
      const res = await fetch(`${RUNTIME_URL}/audit/pending`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { entries: AuditEntry[] };
      setPending(data.entries);
    } catch (err) {
      console.error("loadPending failed:", err);
    }
  }, []);

  useEffect(() => {
    loadAudit();
    loadPending();
    const interval = setInterval(() => {
      loadPending();
      loadAudit();
    }, 3000);
    return () => clearInterval(interval);
  }, [loadAudit, loadPending]);

  async function approve(id: string) {
    setBusy((b) => ({ ...b, [id]: true }));
    setError(null);
    try {
      const res = await fetch(`${RUNTIME_URL}/audit/${id}/approve`, {
        method: "POST",
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: "Unknown error" }));
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      await loadPending();
      await loadAudit();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Approve failed");
    } finally {
      setBusy((b) => ({ ...b, [id]: false }));
    }
  }

  async function reject(id: string) {
    setBusy((b) => ({ ...b, [id]: true }));
    setError(null);
    try {
      const reason = window.prompt("Grund fuer Ablehnung?", "Nicht freigegeben");
      if (reason === null) {
        setBusy((b) => ({ ...b, [id]: false }));
        return;
      }
      const res = await fetch(`${RUNTIME_URL}/audit/${id}/reject`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: "Unknown error" }));
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      await loadPending();
      await loadAudit();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Reject failed");
    } finally {
      setBusy((b) => ({ ...b, [id]: false }));
    }
  }

  const recentApprovals = audit
    .filter((e) => e.status === "executed" && hasReply(e))
    .slice(0, 3);

  return (
    <div className="space-y-8">
      <h1 className="text-xl font-semibold text-text">Settings</h1>

      {error && (
        <div className="text-xs text-warn border border-warn rounded px-3 py-2">
          {error}
        </div>
      )}

      <Section title={`Pending (${pending.length})`}>
        {pending.length === 0 ? (
          <div className="text-sm text-muted">
            Keine wartenden Aktionen. Wenn der Twin etwas in Markus' Namen produzieren soll, landet es hier zur Freigabe.
          </div>
        ) : (
          <ul className="space-y-3">
            {pending.map((entry) => {
              const lastMessage = extractLastMessage(entry);
              const isBusy = busy[entry.id] ?? false;
              return (
                <li key={entry.id} className="border border-border rounded p-4 space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="text-xs text-accent uppercase tracking-wider mb-1">
                        {entry.capability}
                      </div>
                      <div className="text-xs text-muted">
                        {new Date(entry.timestamp).toLocaleString()}
                      </div>
                      <div className="text-sm text-text mt-2 whitespace-pre-wrap">
                        {lastMessage}
                      </div>
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
                        onClick={() => reject(entry.id)}
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
            Noch keine approved Aktionen mit Inhalt. Sobald du in Pending etwas approvest, erscheint hier der generierte Draft.
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
                        {entry.capability}
                      </div>
                      <div className="text-xs text-muted">
                        {new Date(entry.timestamp).toLocaleString()}
                      </div>
                      <div className="text-sm text-muted mt-2 italic">
                        Anfrage: {lastMessage}
                      </div>
                    </div>
                  </div>
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
                </li>
              );
            })}
          </ul>
        )}
      </Section>

      <Section title="Persona und Mandates">
        <p className="text-sm text-muted leading-relaxed">
          Persona und Mandates werden in Phase 1 aus den Files in <code className="text-accent">/docs</code> geladen, nicht aus der UI. So bleibt der Stand versionierbar im Repo. Bearbeitung in der UI kommt in Phase 2.
        </p>
        <ul className="mt-3 text-sm text-muted space-y-1">
          <li>- <code className="text-accent">docs/persona.md</code> Stil, Themen, Tonalitaet</li>
          <li>- <code className="text-accent">docs/persona-meta.yaml</code> Name, Handle</li>
          <li>- <code className="text-accent">docs/mandates.yaml</code> was der Twin darf</li>
        </ul>
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
                  <td className="py-2 pr-3 text-text">{entry.capability}</td>
                  <td
                    className={
                      entry.status === "executed"
                        ? "py-2 pr-3 text-accent"
                        : entry.status === "blocked" || entry.status === "failed" || entry.status === "rejected"
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
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="bg-surface border border-border rounded p-5">
      <h2 className="text-sm font-semibold text-text mb-3 tracking-tight">
        {title}
      </h2>
      {children}
    </section>
  );
}

function extractLastMessage(entry: AuditEntry): string {
  const input = entry.input as {
    lastMessage?: string;
    messages?: ChatMessage[];
  };
  if (typeof input.lastMessage === "string") return input.lastMessage;
  if (Array.isArray(input.messages)) {
    const last = input.messages[input.messages.length - 1];
    if (last?.content) return last.content;
  }
  return "(keine Eingabe gefunden)";
}

function hasReply(entry: AuditEntry): boolean {
  const output = entry.output as { reply?: string } | null;
  return typeof output?.reply === "string" && output.reply.length > 0;
}

function extractReply(entry: AuditEntry): string {
  const output = entry.output as { reply?: string } | null;
  return output?.reply ?? "";
}
