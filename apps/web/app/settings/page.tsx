"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { AuditEntry, ChatMessage } from "@twin-lab/shared";

const RUNTIME_URL = process.env.NEXT_PUBLIC_RUNTIME_URL ?? "http://127.0.0.1:4000";

// Spiegelt das `/twins/:handle/profile`-Response-Schema vom Runtime.
interface TwinProfileResponse {
  twinId: string;
  handle: string;
  displayName: string;
  llmConfig: {
    provider: string;
    model: string;
    baseUrl: string | null;
    apiKeyMasked: string;
    apiKeySource: "user" | "system";
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

interface TwinSummary {
  twinId: string;
  handle: string;
  displayName: string;
}

// Outer-Wrapper für die Suspense-Boundary, die useSearchParams verlangt.
export default function SettingsPage() {
  return (
    <Suspense fallback={<div className="text-sm text-muted">Lade Settings…</div>}>
      <SettingsInner />
    </Suspense>
  );
}

function SettingsInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const requestedHandle = searchParams.get("twin");

  const [twins, setTwins] = useState<TwinSummary[]>([]);
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [pending, setPending] = useState<AuditEntry[]>([]);
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);
  const [profile, setProfile] = useState<TwinProfileResponse | null>(null);
  const [profileLoading, setProfileLoading] = useState(true);
  const [profileError, setProfileError] = useState<string | null>(null);

  // Effektiv ausgewählter Twin: ?twin= aus URL ODER Default = erster Twin.
  const selectedHandle = useMemo(
    () => requestedHandle ?? twins[0]?.handle ?? null,
    [requestedHandle, twins],
  );

  // Twin-Liste einmalig laden, dann ggf. URL um ?twin= ergänzen, damit der
  // Switcher den richtigen Wert zeigt.
  useEffect(() => {
    let cancelled = false;
    fetch(`${RUNTIME_URL}/twins`)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json() as Promise<{ twins: TwinSummary[] }>;
      })
      .then((data) => {
        if (cancelled) return;
        setTwins(data.twins);
        if (!requestedHandle && data.twins[0]) {
          const params = new URLSearchParams(searchParams.toString());
          params.set("twin", data.twins[0].handle);
          router.replace(`/settings?${params.toString()}`);
        }
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load twins");
      });
    return () => {
      cancelled = true;
    };
  }, [requestedHandle, router, searchParams]);

  const loadAudit = useCallback(async (handle: string) => {
    try {
      const res = await fetch(`${RUNTIME_URL}/twins/${handle}/audit?limit=50`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { entries: AuditEntry[] };
      setAudit(data.entries);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load audit");
    }
  }, []);

  const loadPending = useCallback(async (handle: string) => {
    try {
      const res = await fetch(`${RUNTIME_URL}/twins/${handle}/audit/pending`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { entries: AuditEntry[] };
      setPending(data.entries);
    } catch (err) {
      console.error("loadPending failed:", err);
    }
  }, []);

  const loadProfile = useCallback(async (handle: string) => {
    setProfileLoading(true);
    setProfileError(null);
    try {
      const res = await fetch(`${RUNTIME_URL}/twins/${handle}/profile`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as TwinProfileResponse;
      setProfile(data);
    } catch (err) {
      setProfileError(
        err instanceof Error ? err.message : "Twin-Profil konnte nicht geladen werden",
      );
    } finally {
      setProfileLoading(false);
    }
  }, []);

  // Bei Twin-Wechsel: Audit + Pending + Profil neu laden, Polling auf den
  // neuen Handle umhängen.
  useEffect(() => {
    if (!selectedHandle) return;
    setProfile(null);
    setAudit([]);
    setPending([]);
    loadAudit(selectedHandle);
    loadPending(selectedHandle);
    loadProfile(selectedHandle);
    const interval = setInterval(() => {
      loadPending(selectedHandle);
      loadAudit(selectedHandle);
    }, 3000);
    return () => clearInterval(interval);
  }, [selectedHandle, loadAudit, loadPending, loadProfile]);

  async function approve(id: string) {
    if (!selectedHandle) return;
    setBusy((b) => ({ ...b, [id]: true }));
    setError(null);
    try {
      const res = await fetch(
        `${RUNTIME_URL}/twins/${selectedHandle}/audit/${id}/approve`,
        { method: "POST" },
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: "Unknown error" }));
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      await loadPending(selectedHandle);
      await loadAudit(selectedHandle);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Approve failed");
    } finally {
      setBusy((b) => ({ ...b, [id]: false }));
    }
  }

  async function reject(id: string) {
    if (!selectedHandle) return;
    setBusy((b) => ({ ...b, [id]: true }));
    setError(null);
    try {
      const reason = window.prompt("Grund fuer Ablehnung?", "Nicht freigegeben");
      if (reason === null) {
        setBusy((b) => ({ ...b, [id]: false }));
        return;
      }
      const res = await fetch(
        `${RUNTIME_URL}/twins/${selectedHandle}/audit/${id}/reject`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reason }),
        },
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: "Unknown error" }));
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      await loadPending(selectedHandle);
      await loadAudit(selectedHandle);
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
      <div className="flex items-baseline gap-3">
        <h1 className="text-xl font-semibold text-text">Settings</h1>
        {selectedHandle && (
          <span className="text-xs text-muted font-mono">{selectedHandle}</span>
        )}
      </div>

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
              onClick={() => selectedHandle && loadProfile(selectedHandle)}
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
          Persona und Mandates werden aus Files unter <code className="text-accent">/docs</code> in die DB geschrieben. Bearbeitung in der UI kommt in einer späteren Phase.
        </p>
        <ul className="mt-3 text-sm text-muted space-y-1">
          <li>- <code className="text-accent">docs/persona.md</code> Stil, Themen, Tonalitaet</li>
          <li>- <code className="text-accent">docs/persona-meta.yaml</code> Name, Handle</li>
          <li>- <code className="text-accent">docs/mandates.yaml</code> was der Twin darf</li>
          <li>- Bootstrap: <code className="text-accent">pnpm --filter @twin-lab/runtime twin:bootstrap &lt;name&gt;</code></li>
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
//   - content                             → Bridge-eingehende Nachrichten
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

      <Row label="API-Key">
        <div className="space-y-0.5">
          <div className="text-text font-mono text-xs">
            {profile.llmConfig.apiKeyMasked}
          </div>
          <div className="text-xs text-muted">
            Quelle:{" "}
            <span className="text-text">
              {profile.llmConfig.apiKeySource === "user" ? "User" : "System"}
            </span>
            <span className="ml-2 text-[10px] uppercase tracking-wider text-muted">
              verschlüsselt in DB
            </span>
          </div>
        </div>
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
