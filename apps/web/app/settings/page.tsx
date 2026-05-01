"use client";

import { useCallback, useEffect, useState } from "react";
import type { AuditEntry, ChatMessage } from "@twin-lab/shared";

const RUNTIME_URL = process.env.NEXT_PUBLIC_RUNTIME_URL ?? "http://127.0.0.1:4000";

// Spiegelt das `/twin-profile`-Response-Schema vom Runtime. Bewusst nur
// hier definiert, weil read-only und keine Validierung wie bei AuditEntry
// nötig ist — fetch + render, fertig.
interface TwinProfileResponse {
  twinId: string;
  handle: string;
  displayName: string;
  llmConfig: {
    provider: string;
    model: string;
    baseUrl: string | null;
  };
  bridge: {
    url: string;
    tokenMasked: string;
  };
  mandatesCount: number;
  isActive: boolean;
  createdAt: number;
  updatedAt: number;
}

export default function SettingsPage() {
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [pending, setPending] = useState<AuditEntry[]>([]);
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);
  const [profile, setProfile] = useState<TwinProfileResponse | null>(null);
  const [profileLoading, setProfileLoading] = useState(true);
  const [profileError, setProfileError] = useState<string | null>(null);

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

  // Twin-Profil ist read-only und ändert sich im laufenden Prozess nicht
  // (Bootstrap schreibt in die DB, Runtime cached beim Boot). Einmal laden
  // beim Mount reicht; manueller Retry über den Error-State-Button.
  const loadProfile = useCallback(async () => {
    setProfileLoading(true);
    setProfileError(null);
    try {
      const res = await fetch(`${RUNTIME_URL}/twin-profile`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as TwinProfileResponse;
      setProfile(data);
    } catch (err) {
      setProfileError(err instanceof Error ? err.message : "Twin-Profil konnte nicht geladen werden");
    } finally {
      setProfileLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAudit();
    loadPending();
    loadProfile();
    const interval = setInterval(() => {
      loadPending();
      loadAudit();
    }, 3000);
    return () => clearInterval(interval);
  }, [loadAudit, loadPending, loadProfile]);

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

      <Section title="Twin-Profil">
        {profileLoading ? (
          <div className="text-sm text-muted">Lade Twin-Profil…</div>
        ) : profileError ? (
          <div className="space-y-2">
            <div className="text-sm text-warn">
              Twin-Profil konnte nicht geladen werden: {profileError}
            </div>
            <button
              onClick={loadProfile}
              className="text-xs text-accent hover:underline"
            >
              Erneut versuchen
            </button>
          </div>
        ) : profile ? (
          <ProfileBody profile={profile} />
        ) : null}
      </Section>

      <Section title={`Pending (${pending.length})`}>
        {pending.length === 0 ? (
          <div className="text-sm text-muted">
            Keine wartenden Aktionen. Wenn der Twin etwas in Markus' Namen produzieren soll, landet es hier zur Freigabe.
          </div>
        ) : (
          <ul className="space-y-3">
            {pending.map((entry) => {
              const lastMessage = extractLastMessage(entry);
              const header = formatPendingHeader(entry);
              const isBusy = busy[entry.id] ?? false;
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

// Cascade über die bekannten Input-Shapes:
//   - lastMessage / messages[]            → Chat-getriebene Capabilities
//                                           (respond_to_chat, send_to_twin, …)
//   - content                             → Bridge-eingehende Nachrichten
//                                           (respond_to_twin_message)
// So bleibt der Helper Capability-agnostisch und kommt mit neuen Capabilities
// klar, solange sie eines dieser Felder befüllen.
function extractLastMessage(entry: AuditEntry): string {
  const input = entry.input as {
    lastMessage?: string;
    messages?: ChatMessage[];
    content?: string;
  };
  if (typeof input.lastMessage === "string") return input.lastMessage;
  if (Array.isArray(input.messages)) {
    const last = input.messages[input.messages.length - 1];
    if (last?.content) return last.content;
  }
  if (typeof input.content === "string") return input.content;
  return "(keine Eingabe gefunden)";
}

function formatPendingHeader(entry: AuditEntry): string {
  const input = entry.input as { fromHandle?: string; targetHandle?: string };
  if (entry.capability === "respond_to_twin_message" && input.fromHandle) {
    return `Eingehend von ${input.fromHandle}`;
  }
  if (entry.capability === "send_to_twin" && input.targetHandle) {
    return `An ${input.targetHandle} senden`;
  }
  return entry.capability;
}

function hasReply(entry: AuditEntry): boolean {
  const output = entry.output as { reply?: string } | null;
  return typeof output?.reply === "string" && output.reply.length > 0;
}

function extractReply(entry: AuditEntry): string {
  const output = entry.output as { reply?: string } | null;
  return output?.reply ?? "";
}

// ─── TWIN-PROFIL SUB-COMPONENT ──────────────────────────────────────────────

function ProfileBody({ profile }: { profile: TwinProfileResponse }) {
  return (
    <dl className="space-y-4 text-sm">
      <Row label="Twin-ID">
        <span className="font-mono text-xs italic text-muted">{profile.twinId}</span>
      </Row>

      <Row label="Persona">
        <div className="space-y-0.5">
          <div className="text-base text-text">{profile.displayName}</div>
          <div className="text-xs text-muted font-mono">{profile.handle}</div>
        </div>
      </Row>

      <Row label="LLM">
        <span className="inline-flex items-center text-xs font-mono px-2 py-1 border border-border rounded text-text">
          {profile.llmConfig.provider} / {profile.llmConfig.model}
        </span>
        {profile.llmConfig.baseUrl && (
          <div className="mt-1 text-xs text-muted font-mono">
            {profile.llmConfig.baseUrl}
          </div>
        )}
      </Row>

      <Row label="Bridge">
        <div className="space-y-0.5">
          <div className="text-text font-mono text-xs">{profile.bridge.url}</div>
          <div className="text-xs text-muted">
            Token: <span className="font-mono">{profile.bridge.tokenMasked}</span>
          </div>
        </div>
      </Row>

      <Row label="Mandates">
        <span className="text-text">{profile.mandatesCount} Mandates aktiv</span>
      </Row>

      <Row label="Status">
        <span className="inline-flex items-center gap-2 text-text">
          <span
            className={`inline-block w-2 h-2 rounded-full ${
              profile.isActive ? "bg-accent" : "bg-muted"
            }`}
            aria-hidden="true"
          />
          {profile.isActive ? "Aktiv" : "Inaktiv"}
        </span>
      </Row>

      <Row label="Erstellt">
        <span className="text-xs text-muted">{formatGermanDate(profile.createdAt)}</span>
      </Row>

      <Row label="Aktualisiert">
        <span className="text-xs text-muted">{formatGermanDate(profile.updatedAt)}</span>
      </Row>
    </dl>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1 sm:flex-row sm:gap-4">
      <dt className="text-xs uppercase tracking-wider text-muted sm:w-28 sm:flex-shrink-0 sm:pt-0.5">
        {label}
      </dt>
      <dd className="flex-1 min-w-0">{children}</dd>
    </div>
  );
}

function formatGermanDate(unixMs: number): string {
  return new Date(unixMs).toLocaleString("de-DE", {
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
