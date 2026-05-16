"use client";

import {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
} from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { AuditEntry, FactItem, TwinEvent } from "@twin-lab/shared";
import { ModalWrapper } from "../../components/ModalWrapper";

const RUNTIME_URL = process.env.NEXT_PUBLIC_RUNTIME_URL ?? "http://localhost:4000";

// ─── FACTS-PAGE (3.3.G2) ─────────────────────────────────────────────────────
//
// Verwaltungs-View für Semantic-Memory pro Twin. Pattern aus /inbox: Twin-
// Selector im Query-Param, SSE für Live-Updates, useEffect-Fetch-Loop. Drei
// Sektionen nach Confidence: Approved / Pending / Rejected. Leere Sektionen
// werden ausgeblendet, damit die Page nicht mit leeren Boxen wirkt.
//
// Approve/Reject für Pending läuft über die generischen Audit-Routes aus
// 3.2.F (/audit/:id/approve|reject) — die Page mappt factKey→auditId via
// paralleler Pending-Audit-Liste.

interface TwinSummary {
  twinId: string;
  handle: string;
  displayName: string;
}

/** Fact + (optional) zugehörige pending-Audit-ID für Approve/Reject. */
interface FactWithAudit extends FactItem {
  pendingAuditId?: string;
}

export default function FactsPage() {
  return (
    <Suspense fallback={<div className="text-sm text-muted">Lade Facts…</div>}>
      <FactsInner />
    </Suspense>
  );
}

function FactsInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const requestedHandle = searchParams.get("twin");

  const [twins, setTwins] = useState<TwinSummary[]>([]);
  const [facts, setFacts] = useState<FactWithAudit[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [editing, setEditing] = useState<FactWithAudit | null>(null);

  const selectedHandle = useMemo(
    () => requestedHandle ?? twins[0]?.handle ?? null,
    [requestedHandle, twins],
  );

  // Twin-Liste laden + URL-Param ergänzen wenn fehlt (gleiches Pattern wie
  // /inbox — beim ersten Open ohne Param: ersten eigenen Twin in URL setzen).
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
          router.replace(`/facts?${params.toString()}`);
        }
      })
      .catch((err) => {
        if (!cancelled)
          setError(err instanceof Error ? err.message : "Twins laden fehlgeschlagen");
      });
    return () => {
      cancelled = true;
    };
  }, [requestedHandle, router, searchParams]);

  // Facts + Pending-Audits parallel laden, dann mergen.
  const loadFacts = useCallback(async (handle: string) => {
    try {
      const [factsRes, pendingRes] = await Promise.all([
        fetch(`${RUNTIME_URL}/twins/${handle}/facts`, {
          credentials: "include",
        }),
        fetch(`${RUNTIME_URL}/twins/${handle}/audit/pending`, {
          credentials: "include",
        }),
      ]);
      if (!factsRes.ok) throw new Error(`Facts HTTP ${factsRes.status}`);
      if (!pendingRes.ok) throw new Error(`Pending HTTP ${pendingRes.status}`);
      const factsData = (await factsRes.json()) as { facts: FactItem[] };
      const pendingData = (await pendingRes.json()) as {
        entries: AuditEntry[];
      };

      // Pending-Audits → Map factKey → auditId. Wir filtern auf
      // semantic-fact-write — andere Pending-Capabilities sind in der Inbox-
      // View; hier ist nur die Fact-Subset relevant.
      const auditByFactKey = new Map<string, string>();
      for (const audit of pendingData.entries) {
        if (audit.capability !== "semantic-fact-write") continue;
        const input = audit.input as { factKey?: string };
        if (input.factKey) auditByFactKey.set(input.factKey, audit.id);
      }

      const merged: FactWithAudit[] = factsData.facts.map((f) => ({
        ...f,
        pendingAuditId:
          f.confidence === "pending" ? auditByFactKey.get(f.factKey) : undefined,
      }));
      setFacts(merged);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Facts konnten nicht geladen werden");
    } finally {
      setLoading(false);
    }
  }, []);

  // Auto-Reload beim Twin-Wechsel + SSE-Live-Update bei audit-Mutationen
  // (Approve/Reject in der Inbox ändert auch hier sichtbar den Status).
  useEffect(() => {
    if (!selectedHandle) return;
    setLoading(true);
    setFacts([]);
    void loadFacts(selectedHandle);

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
          void loadFacts(selectedHandle);
        }
      } catch {
        // ignore unparsable
      }
    };
    return () => {
      es.close();
    };
  }, [selectedHandle, loadFacts]);

  // ─── Action-Handlers ──────────────────────────────────────────────────────

  const handleDelete = async (fact: FactWithAudit) => {
    if (!selectedHandle) return;
    // FIXME (UX.1.A.1 / nach #94): window.confirm() — destruktiv, braucht
    // eigenen AlertDialog statt Toast. Eigenes Backlog-Item für später.
    if (!window.confirm(`Fact "${fact.factKey}" wirklich löschen?`)) return;
    setBusy((b) => ({ ...b, [fact.id]: true }));
    try {
      const res = await fetch(
        `${RUNTIME_URL}/twins/${selectedHandle}/facts/${encodeURIComponent(fact.factKey)}`,
        { method: "DELETE", credentials: "include" },
      );
      if (!res.ok && res.status !== 204) {
        const body = await res.json().catch(() => ({ error: "Unknown error" }));
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      await loadFacts(selectedHandle);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Löschen fehlgeschlagen");
    } finally {
      setBusy((b) => ({ ...b, [fact.id]: false }));
    }
  };

  const handleApprove = async (fact: FactWithAudit) => {
    if (!selectedHandle || !fact.pendingAuditId) return;
    setBusy((b) => ({ ...b, [fact.id]: true }));
    try {
      const res = await fetch(
        `${RUNTIME_URL}/twins/${selectedHandle}/audit/${fact.pendingAuditId}/approve`,
        { method: "POST", credentials: "include" },
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: "Unknown error" }));
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      await loadFacts(selectedHandle);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Approve fehlgeschlagen");
    } finally {
      setBusy((b) => ({ ...b, [fact.id]: false }));
    }
  };

  const handleReject = async (fact: FactWithAudit) => {
    if (!selectedHandle || !fact.pendingAuditId) return;
    const reason = window.prompt("Grund für Ablehnung (optional):", "");
    if (reason === null) return;
    setBusy((b) => ({ ...b, [fact.id]: true }));
    try {
      const res = await fetch(
        `${RUNTIME_URL}/twins/${selectedHandle}/audit/${fact.pendingAuditId}/reject`,
        {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reason: reason.trim() || "Nicht freigegeben" }),
        },
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: "Unknown error" }));
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      await loadFacts(selectedHandle);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Reject fehlgeschlagen");
    } finally {
      setBusy((b) => ({ ...b, [fact.id]: false }));
    }
  };

  // Reactivate: PATCH mit existing factValue + confidence='approved'. Der
  // Repo.setConfidence-Pfad (3.3.F) wird hier indirekt über `upsert` getrof-
  // fen — Backend-PATCH erlaubt confidence-Override, source bleibt unverändert.
  const handleReactivate = async (fact: FactWithAudit) => {
    if (!selectedHandle) return;
    setBusy((b) => ({ ...b, [fact.id]: true }));
    try {
      const res = await fetch(
        `${RUNTIME_URL}/twins/${selectedHandle}/facts/${encodeURIComponent(fact.factKey)}`,
        {
          method: "PATCH",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            factValue: fact.factValue,
            confidence: "approved",
          }),
        },
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: "Unknown error" }));
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      await loadFacts(selectedHandle);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Reaktivieren fehlgeschlagen");
    } finally {
      setBusy((b) => ({ ...b, [fact.id]: false }));
    }
  };

  // ─── Gruppierung nach Status ──────────────────────────────────────────────
  const approved = facts.filter((f) => f.confidence === "approved");
  const pending = facts.filter((f) => f.confidence === "pending");
  const rejected = facts.filter((f) => f.confidence === "rejected");
  const autoFacts = facts.filter((f) => f.confidence === "auto");

  return (
    <div className="max-w-3xl mx-auto px-6 py-6 space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-lg text-text">Facts</h1>
          <div className="text-xs text-muted">
            Semantic-Memory · {selectedHandle ?? "—"}
          </div>
        </div>
        <button
          onClick={() => setAddOpen(true)}
          disabled={!selectedHandle}
          className="px-3 py-1.5 text-xs border border-accent text-accent rounded hover:bg-accent hover:text-bg disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
        >
          + Add Fact
        </button>
      </div>

      {error && (
        <div className="text-xs text-warn border border-warn rounded px-3 py-2">
          {error}
        </div>
      )}

      {loading && (
        <div className="text-sm text-muted">Lade Facts…</div>
      )}

      {!loading && facts.length === 0 && (
        <div className="text-sm text-muted border border-border rounded p-4">
          Noch keine Facts hinterlegt. Mit „+ Add Fact" anlegen oder via{" "}
          <code className="font-mono">pnpm twin:facts-extract</code> vom Twin
          vorschlagen lassen.
        </div>
      )}

      <FactSection
        title="Pending"
        count={pending.length}
        facts={pending}
        busy={busy}
        onApprove={handleApprove}
        onReject={handleReject}
        onDelete={handleDelete}
      />
      <FactSection
        title="Approved"
        count={approved.length}
        facts={approved}
        busy={busy}
        onEdit={setEditing}
        onDelete={handleDelete}
      />
      <FactSection
        title="Rejected"
        count={rejected.length}
        facts={rejected}
        busy={busy}
        onReactivate={handleReactivate}
        onDelete={handleDelete}
      />
      {/* `auto` ist 3.3.A-Reserve — falls Einträge auftauchen, zeigen wir
          sie pragmatisch in einer eigenen Sektion mit Delete-Aktion. */}
      <FactSection
        title="Auto"
        count={autoFacts.length}
        facts={autoFacts}
        busy={busy}
        onDelete={handleDelete}
      />

      {addOpen && selectedHandle && (
        <AddFactModal
          twinHandle={selectedHandle}
          onClose={() => setAddOpen(false)}
          onSuccess={() => {
            setAddOpen(false);
            void loadFacts(selectedHandle);
          }}
        />
      )}
      {editing && selectedHandle && (
        <EditFactModal
          twinHandle={selectedHandle}
          fact={editing}
          onClose={() => setEditing(null)}
          onSuccess={() => {
            setEditing(null);
            void loadFacts(selectedHandle);
          }}
        />
      )}
    </div>
  );
}

// ─── Sektion + Row ──────────────────────────────────────────────────────────

interface FactSectionProps {
  title: string;
  count: number;
  facts: FactWithAudit[];
  busy: Record<string, boolean>;
  onApprove?: (fact: FactWithAudit) => void;
  onReject?: (fact: FactWithAudit) => void;
  onReactivate?: (fact: FactWithAudit) => void;
  onEdit?: (fact: FactWithAudit) => void;
  onDelete?: (fact: FactWithAudit) => void;
}

function FactSection(props: FactSectionProps) {
  if (props.count === 0) return null;
  return (
    <section className="space-y-2">
      <h2 className="text-xs text-muted uppercase tracking-wider">
        {props.title} ({props.count})
      </h2>
      <ul className="space-y-2">
        {props.facts.map((fact) => (
          <FactRow
            key={fact.id}
            fact={fact}
            busy={props.busy[fact.id] ?? false}
            onApprove={props.onApprove}
            onReject={props.onReject}
            onReactivate={props.onReactivate}
            onEdit={props.onEdit}
            onDelete={props.onDelete}
          />
        ))}
      </ul>
    </section>
  );
}

function statusMarker(confidence: FactItem["confidence"]): {
  symbol: string;
  className: string;
  label: string;
} {
  switch (confidence) {
    case "approved":
      return { symbol: "✓", className: "text-accent", label: "approved" };
    case "pending":
      return { symbol: "⏳", className: "text-warn", label: "pending" };
    case "rejected":
      return { symbol: "✗", className: "text-warn", label: "rejected" };
    default:
      return { symbol: "?", className: "text-muted", label: "auto" };
  }
}

interface FactRowProps {
  fact: FactWithAudit;
  busy: boolean;
  onApprove?: (fact: FactWithAudit) => void;
  onReject?: (fact: FactWithAudit) => void;
  onReactivate?: (fact: FactWithAudit) => void;
  onEdit?: (fact: FactWithAudit) => void;
  onDelete?: (fact: FactWithAudit) => void;
}

function FactRow({
  fact,
  busy,
  onApprove,
  onReject,
  onReactivate,
  onEdit,
  onDelete,
}: FactRowProps) {
  const marker = statusMarker(fact.confidence);
  return (
    <li className="border border-border rounded p-3 space-y-2">
      <div className="flex items-start gap-3">
        <span className={`${marker.className} text-sm leading-tight pt-0.5`}>
          {marker.symbol}
        </span>
        <div className="flex-1 min-w-0 space-y-1">
          <div className="text-sm flex flex-wrap items-baseline gap-2">
            <code className="font-mono text-text bg-bg border border-border rounded px-1.5 py-0.5">
              {fact.factKey}
            </code>
            <span className="text-muted">→</span>
            <span className="text-text whitespace-pre-wrap break-words">
              {fact.factValue}
            </span>
          </div>
          <div className="text-[10px] text-muted uppercase tracking-wider">
            source: {fact.source} · updated: {formatDate(fact.updatedAt)}
          </div>
        </div>
        <div className="flex gap-2 flex-shrink-0">
          {onApprove && (
            <button
              onClick={() => onApprove(fact)}
              disabled={busy || !fact.pendingAuditId}
              title={!fact.pendingAuditId ? "Pending-Audit fehlt" : undefined}
              className="px-2.5 py-1 text-[11px] border border-accent text-accent rounded hover:bg-accent hover:text-bg disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              {busy ? "..." : "approve"}
            </button>
          )}
          {onReject && (
            <button
              onClick={() => onReject(fact)}
              disabled={busy || !fact.pendingAuditId}
              className="px-2.5 py-1 text-[11px] border border-warn text-warn rounded hover:bg-warn hover:text-bg disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              reject
            </button>
          )}
          {onReactivate && (
            <button
              onClick={() => onReactivate(fact)}
              disabled={busy}
              className="px-2.5 py-1 text-[11px] border border-accent text-accent rounded hover:bg-accent hover:text-bg disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              {busy ? "..." : "reactivate"}
            </button>
          )}
          {onEdit && (
            <button
              onClick={() => onEdit(fact)}
              disabled={busy}
              className="px-2.5 py-1 text-[11px] border border-border text-muted rounded hover:text-text hover:border-text transition-colors"
            >
              edit
            </button>
          )}
          {onDelete && (
            <button
              onClick={() => onDelete(fact)}
              disabled={busy}
              className="px-2.5 py-1 text-[11px] border border-border text-muted rounded hover:text-warn hover:border-warn transition-colors"
            >
              delete
            </button>
          )}
        </div>
      </div>
    </li>
  );
}

// ─── Add/Edit-Modals (ModalWrapper aus components/) ─────────────────────────

function AddFactModal({
  twinHandle,
  onClose,
  onSuccess,
}: {
  twinHandle: string;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [factKey, setFactKey] = useState("");
  const [factValue, setFactValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmedKey = factKey.trim();
    const trimmedValue = factValue.trim();
    if (!trimmedKey || !trimmedValue) {
      setError("Key und Value sind Pflichtfelder");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`${RUNTIME_URL}/twins/${twinHandle}/facts`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          factKey: trimmedKey,
          factValue: trimmedValue,
        }),
      });
      if (res.status === 409) {
        setError("Fact mit diesem Key existiert bereits.");
        return;
      }
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: "Unknown error" }));
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Anlegen fehlgeschlagen");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <ModalWrapper onClose={onClose}>
      <form onSubmit={handleSubmit} className="p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm text-text font-medium">Neuen Fact anlegen</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-muted hover:text-text text-sm"
            aria-label="Schließen"
          >
            ✕
          </button>
        </div>
        <label className="block space-y-1">
          <span className="text-xs text-muted">
            Key (snake_case — z.B. <code className="font-mono">wife_name</code>)
          </span>
          <input
            value={factKey}
            onChange={(e) => setFactKey(e.target.value)}
            autoFocus
            placeholder="favorite_color"
            className="w-full bg-bg border border-border rounded px-2 py-1.5 text-sm text-text font-mono focus:outline-none focus:border-accent"
          />
        </label>
        <label className="block space-y-1">
          <span className="text-xs text-muted">Value</span>
          <textarea
            value={factValue}
            onChange={(e) => setFactValue(e.target.value)}
            rows={3}
            placeholder="blau"
            className="w-full bg-bg border border-border rounded px-2 py-1.5 text-sm text-text resize-y focus:outline-none focus:border-accent"
          />
        </label>
        {error && <div className="text-xs text-warn">{error}</div>}
        <div className="flex items-center justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="px-3 py-1.5 text-xs border border-border text-muted rounded hover:text-text hover:border-text transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          >
            Abbrechen
          </button>
          <button
            type="submit"
            disabled={submitting}
            className="px-4 py-1.5 text-xs border border-accent text-accent rounded hover:bg-accent hover:text-bg disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            {submitting ? "Speichere…" : "Anlegen"}
          </button>
        </div>
      </form>
    </ModalWrapper>
  );
}

function EditFactModal({
  twinHandle,
  fact,
  onClose,
  onSuccess,
}: {
  twinHandle: string;
  fact: FactWithAudit;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [factValue, setFactValue] = useState(fact.factValue);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = factValue.trim();
    if (!trimmed) {
      setError("Value darf nicht leer sein");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(
        `${RUNTIME_URL}/twins/${twinHandle}/facts/${encodeURIComponent(fact.factKey)}`,
        {
          method: "PATCH",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ factValue: trimmed }),
        },
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: "Unknown error" }));
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Speichern fehlgeschlagen");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <ModalWrapper onClose={onClose}>
      <form onSubmit={handleSubmit} className="p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm text-text font-medium">Fact bearbeiten</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-muted hover:text-text text-sm"
            aria-label="Schließen"
          >
            ✕
          </button>
        </div>
        <label className="block space-y-1">
          <span className="text-xs text-muted">Key (nicht editierbar)</span>
          <input
            value={fact.factKey}
            disabled
            className="w-full bg-bg border border-border rounded px-2 py-1.5 text-sm text-muted font-mono opacity-70"
          />
        </label>
        <label className="block space-y-1">
          <span className="text-xs text-muted">Value</span>
          <textarea
            value={factValue}
            onChange={(e) => setFactValue(e.target.value)}
            rows={3}
            autoFocus
            className="w-full bg-bg border border-border rounded px-2 py-1.5 text-sm text-text resize-y focus:outline-none focus:border-accent"
          />
        </label>
        {error && <div className="text-xs text-warn">{error}</div>}
        <div className="flex items-center justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="px-3 py-1.5 text-xs border border-border text-muted rounded hover:text-text hover:border-text transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          >
            Abbrechen
          </button>
          <button
            type="submit"
            disabled={submitting}
            className="px-4 py-1.5 text-xs border border-accent text-accent rounded hover:bg-accent hover:text-bg disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            {submitting ? "Speichere…" : "Speichern"}
          </button>
        </div>
      </form>
    </ModalWrapper>
  );
}

// ─── helpers ────────────────────────────────────────────────────────────────

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString();
}
