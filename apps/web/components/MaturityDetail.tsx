"use client";

import { useEffect, useState } from "react";
import type { MaturityResult } from "@nolmi/shared";

// ─── MaturityDetail (#101 Phase 3) ───────────────────────────────────────────
//
// Detail-View für die Twin-Reife in Settings. Komplementär zum Header-Badge
// (#101 Phase 2): das Badge ist Dauer-Status, hier sind die Stats + der
// "Was fehlt"-Hook, der den Owner motivieren soll, weiter mit dem Twin zu
// arbeiten. Fetchet eigenständig — Settings-Page reicht nur den Handle durch,
// damit ein Twin-Wechsel den Detail-Block neu lädt.

const RUNTIME_URL =
  process.env.NEXT_PUBLIC_RUNTIME_URL ?? "http://localhost:4000";

interface Props {
  twinHandle: string;
}

export function MaturityDetail({ twinHandle }: Props) {
  const [data, setData] = useState<MaturityResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setData(null);
    setError(null);
    fetch(`${RUNTIME_URL}/twins/${twinHandle}/maturity`, {
      credentials: "include",
    })
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json() as Promise<MaturityResult>;
      })
      .then((d) => {
        if (!cancelled) setData(d);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Konnte Twin-Reife nicht laden");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [twinHandle]);

  if (error) {
    return (
      <div className="text-sm text-warn border border-warn rounded px-3 py-2">
        Twin-Reife konnte nicht geladen werden: {error}
      </div>
    );
  }
  if (!data) {
    return <div className="text-sm text-muted">Lade Twin-Reife…</div>;
  }

  const { currentLabel, stats, progressToNext } = data;
  const spanLabel = formatSpan(stats.daysSinceFirst, stats.firstConvAt);

  return (
    <div className="space-y-5 text-sm">
      <div className="space-y-2">
        <div className="flex items-baseline justify-between gap-3">
          <div className="text-text">
            Stufe:{" "}
            <span className="font-mono text-base text-accent">{currentLabel}</span>
          </div>
          {progressToNext && (
            <div className="text-xs text-muted font-mono">
              {progressToNext.percent}% bis {progressToNext.targetLabel}
            </div>
          )}
        </div>
        {progressToNext && <ProgressBar percent={progressToNext.percent} />}
      </div>

      <div>
        <div className="text-xs uppercase tracking-wider text-muted mb-2">
          Statistiken
        </div>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm font-mono">
          <StatRow label="Konversationen" value={String(stats.conversationCount)} />
          <StatRow label="Facts" value={String(stats.factsCount)} />
          <StatRow label="Themen" value={String(stats.topicCount)} />
          <StatRow label="Aktiv seit" value={spanLabel} />
        </dl>
      </div>

      {progressToNext ? (
        <div>
          <div className="text-xs uppercase tracking-wider text-muted mb-2">
            Was fehlt zur nächsten Stufe ({progressToNext.targetLabel})
          </div>
          {progressToNext.missingDimensions.length === 0 ? (
            <div className="text-sm text-muted">
              Alle Dimensionen erreicht — die Stufe wird mit dem nächsten
              Datenpunkt fällig.
            </div>
          ) : (
            <ul className="space-y-1 text-sm text-muted">
              {progressToNext.missingDimensions.map((m) => (
                <li key={m.dimension} className="flex items-baseline gap-2">
                  <span aria-hidden="true" className="text-muted">·</span>
                  <span>{m.label}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        <div className="text-sm text-muted leading-relaxed">
          Du hast die höchste Stufe erreicht. Der Twin entwickelt sich
          kontinuierlich weiter — neue Konversationen, Facts und Themen werden
          weiter integriert, aber es gibt keine weitere Stufe.
        </div>
      )}
    </div>
  );
}

function StatRow({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt className="text-muted">{label}</dt>
      <dd className="text-text text-right">{value}</dd>
    </>
  );
}

function ProgressBar({ percent }: { percent: number }) {
  // 0-100 clipping defensiv, falls Backend mal aus dem Frame fällt.
  const clamped = Math.max(0, Math.min(100, percent));
  return (
    <div
      className="h-1.5 bg-border rounded overflow-hidden"
      role="progressbar"
      aria-valuenow={clamped}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div
        className="h-full bg-accent transition-[width] duration-300"
        style={{ width: `${clamped}%` }}
      />
    </div>
  );
}

function formatSpan(daysSinceFirst: number, firstConvAt: string | null): string {
  if (!firstConvAt) return "—";
  if (daysSinceFirst < 1) return "heute";
  if (daysSinceFirst === 1) return "1 Tag";
  if (daysSinceFirst < 30) return `${daysSinceFirst} Tagen`;
  if (daysSinceFirst < 60) return "1 Monat";
  if (daysSinceFirst < 365) {
    const months = Math.floor(daysSinceFirst / 30);
    return `${months} Monaten`;
  }
  const years = Math.floor(daysSinceFirst / 365);
  return years === 1 ? "1 Jahr" : `${years} Jahren`;
}
