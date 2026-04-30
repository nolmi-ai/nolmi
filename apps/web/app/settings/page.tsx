"use client";

import { useEffect, useState } from "react";
import type { AuditEntry } from "@twin-lab/shared";

const RUNTIME_URL = process.env.NEXT_PUBLIC_RUNTIME_URL ?? "http://127.0.0.1:4000";

export default function SettingsPage() {
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`${RUNTIME_URL}/audit?limit=50`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((data: { entries: AuditEntry[] }) => setAudit(data.entries))
      .catch((err) => setError(err instanceof Error ? err.message : "Failed"))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="space-y-8">
      <h1 className="text-xl font-semibold text-text">Settings</h1>

      <Section title="Persona &amp; Mandates">
        <p className="text-sm text-muted leading-relaxed">
          Persona und Mandates werden in Phase 1 aus den Files in{" "}
          <code className="text-accent">/docs</code> geladen — nicht aus der UI.
          So bleibt der Stand versionierbar im Repo. Bearbeitung in der UI
          kommt in Phase 2.
        </p>
        <ul className="mt-3 text-sm text-muted space-y-1">
          <li>· <code className="text-accent">docs/persona.md</code> — Stil, Themen, Tonalität</li>
          <li>· <code className="text-accent">docs/persona-meta.yaml</code> — Name, Handle</li>
          <li>· <code className="text-accent">docs/mandates.yaml</code> — was der Twin darf</li>
        </ul>
      </Section>

      <Section title="Audit-Log (letzte 50 Aktionen)">
        {loading ? (
          <div className="text-sm text-muted">lädt…</div>
        ) : error ? (
          <div className="text-sm text-warn">{error}</div>
        ) : audit.length === 0 ? (
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
                <tr key={entry.id} className="border-b border-border/50">
                  <td className="py-2 pr-3 text-muted">
                    {new Date(entry.timestamp).toLocaleString()}
                  </td>
                  <td className="py-2 pr-3 text-text">{entry.capability}</td>
                  <td
                    className={`py-2 pr-3 ${
                      entry.status === "executed"
                        ? "text-accent"
                        : entry.status === "blocked" || entry.status === "failed"
                        ? "text-warn"
                        : "text-muted"
                    }`}
                  >
                    {entry.status}
                  </td>
                  <td className="py-2 text-muted truncate max-w-[200px]">
                    {entry.mandateId ?? "—"}
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
