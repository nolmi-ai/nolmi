"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { PageContainer } from "../../components/PageContainer";

const RUNTIME_URL = process.env.NEXT_PUBLIC_RUNTIME_URL ?? "http://localhost:4000";

// ─── SETTINGS-PAGE (2.5.4.3) ─────────────────────────────────────────────────
//
// Reine Konfiguration: Twin-Profil, Vertraute Twins, Persona-Hilfe. Pending,
// Approvals und Audit-Log sind in 2.5.4.3 in eine separate /inbox-Page
// gewandert — Settings soll nicht zwischen "ändern" und "warten" mischen.

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

interface TrustRelationship {
  trustId: string;
  twinId: string;
  trustedHandle: string;
  note: string | null;
  createdAt: string;
  createdByUserId: string;
}

interface Skill {
  skillId: string;
  name: string;
  description: string;
  capability: string;
  requiresApproval: boolean;
  source: "manual" | "mcp";
  isActive: boolean;
  instructionsLength: number;
  hasScript: boolean;
  createdAt: string;
  updatedAt: string;
}

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
  const [error, setError] = useState<string | null>(null);
  const [profile, setProfile] = useState<TwinProfileResponse | null>(null);
  const [profileLoading, setProfileLoading] = useState(true);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [trusts, setTrusts] = useState<TrustRelationship[]>([]);
  const [trustHandle, setTrustHandle] = useState("");
  const [trustNote, setTrustNote] = useState("");
  const [trustError, setTrustError] = useState<string | null>(null);
  const [trustBusy, setTrustBusy] = useState(false);
  const [trustInfo, setTrustInfo] = useState<string | null>(null);
  const [skills, setSkills] = useState<Skill[]>([]);
  const [skillError, setSkillError] = useState<string | null>(null);
  const [skillBusyIds, setSkillBusyIds] = useState<Set<string>>(new Set());

  const selectedHandle = useMemo(
    () => requestedHandle ?? twins[0]?.handle ?? null,
    [requestedHandle, twins],
  );

  // Twin-Liste einmalig laden, dann ggf. URL um ?twin= ergänzen.
  useEffect(() => {
    let cancelled = false;
    fetch(`${RUNTIME_URL}/twins`, { credentials: "include" })
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

  const loadTrusts = useCallback(async (handle: string) => {
    try {
      const res = await fetch(`${RUNTIME_URL}/twins/${handle}/trust`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { trusts: TrustRelationship[] };
      setTrusts(data.trusts);
    } catch (err) {
      console.error("loadTrusts failed:", err);
    }
  }, []);

  const loadSkills = useCallback(async (handle: string) => {
    try {
      const res = await fetch(`${RUNTIME_URL}/twins/${handle}/skills`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { skills: Skill[] };
      setSkills(data.skills);
    } catch (err) {
      console.error("loadSkills failed:", err);
    }
  }, []);

  const loadProfile = useCallback(async (handle: string) => {
    setProfileLoading(true);
    setProfileError(null);
    try {
      const res = await fetch(`${RUNTIME_URL}/twins/${handle}/profile`, {
        credentials: "include",
      });
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

  // Bei Twin-Wechsel: Profil + Trusts + Skills neu. Pollen entfällt — alle
  // drei ändern sich nur über lokale User-Aktionen oder die CLI (Skills).
  useEffect(() => {
    if (!selectedHandle) return;
    setProfile(null);
    setTrusts([]);
    setTrustError(null);
    setTrustInfo(null);
    setSkills([]);
    setSkillError(null);
    loadProfile(selectedHandle);
    loadTrusts(selectedHandle);
    loadSkills(selectedHandle);
  }, [selectedHandle, loadProfile, loadTrusts, loadSkills]);

  async function addTrust() {
    if (!selectedHandle) return;
    setTrustError(null);
    setTrustInfo(null);
    const handle = trustHandle.trim().toLowerCase();
    if (!/^@[a-z0-9_-]+$/.test(handle)) {
      setTrustError("Handle muss '@<name>' sein (Kleinbuchstaben, Ziffern, _ und -).");
      return;
    }
    setTrustBusy(true);
    try {
      const res = await fetch(`${RUNTIME_URL}/twins/${selectedHandle}/trust`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          trustedHandle: handle,
          note: trustNote.trim() || undefined,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setTrustError(
          (body as { error?: string }).error ?? `HTTP ${res.status} — Hinzufügen fehlgeschlagen`,
        );
        return;
      }
      if ((body as { ignored?: boolean }).ignored) {
        setTrustInfo(
          (body as { reason?: string }).reason ?? "Self-Trust hat keinen Effekt.",
        );
      } else {
        setTrustHandle("");
        setTrustNote("");
        await loadTrusts(selectedHandle);
      }
    } catch (err) {
      setTrustError(err instanceof Error ? err.message : "Hinzufügen fehlgeschlagen");
    } finally {
      setTrustBusy(false);
    }
  }

  async function removeTrust(trust: TrustRelationship) {
    if (!selectedHandle) return;
    // FIXME (UX.1.A.1 / nach #94): window.confirm() — destruktiv,
    // braucht eigenen AlertDialog statt Toast (kein generischer Dialog-
    // Component in der Codebase). Eigenes Backlog-Item für später.
    if (!window.confirm(`Wirklich ${trust.trustedHandle} aus Vertrauten entfernen?`)) {
      return;
    }
    setTrustError(null);
    setTrustInfo(null);
    setTrustBusy(true);
    try {
      const res = await fetch(
        `${RUNTIME_URL}/twins/${selectedHandle}/trust/${trust.trustId}`,
        { method: "DELETE", credentials: "include" },
      );
      if (!res.ok && res.status !== 204) {
        const body = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        setTrustError((body as { error?: string }).error ?? `HTTP ${res.status}`);
        return;
      }
      await loadTrusts(selectedHandle);
    } catch (err) {
      setTrustError(err instanceof Error ? err.message : "Entfernen fehlgeschlagen");
    } finally {
      setTrustBusy(false);
    }
  }

  async function toggleSkill(skill: Skill) {
    if (!selectedHandle) return;
    const next = !skill.isActive;

    // Optimistic — UI sofort. Server gibt das aktualisierte Objekt zurück,
    // das wir bei Success ersetzen (für updatedAt-Refresh). Bei Error revert.
    setSkillError(null);
    setSkills((curr) =>
      curr.map((s) => (s.skillId === skill.skillId ? { ...s, isActive: next } : s)),
    );
    setSkillBusyIds((curr) => new Set(curr).add(skill.skillId));

    try {
      const res = await fetch(
        `${RUNTIME_URL}/twins/${selectedHandle}/skills/${skill.skillId}/active`,
        {
          method: "PATCH",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ isActive: next }),
        },
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(
          (body as { error?: string }).error ?? `HTTP ${res.status} — Toggle fehlgeschlagen`,
        );
      }
      const updated = (await res.json()) as Skill;
      setSkills((curr) => curr.map((s) => (s.skillId === updated.skillId ? updated : s)));
    } catch (err) {
      // Revert
      setSkills((curr) =>
        curr.map((s) =>
          s.skillId === skill.skillId ? { ...s, isActive: skill.isActive } : s,
        ),
      );
      setSkillError(err instanceof Error ? err.message : "Toggle fehlgeschlagen");
      setTimeout(() => setSkillError(null), 5000);
    } finally {
      setSkillBusyIds((curr) => {
        const next = new Set(curr);
        next.delete(skill.skillId);
        return next;
      });
    }
  }

  return (
    <PageContainer className="space-y-8">
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

      <Section title={`Vertraute Twins (${trusts.length})`}>
        <p className="text-sm text-muted leading-relaxed mb-4">
          Twins die du in dieser Liste hast können dir direkt anfragen, ohne dass Approval nötig ist. Owner-Direkt-Chats laufen ohnehin ohne Approval.
        </p>
        {trusts.length === 0 ? (
          <div className="text-sm text-muted mb-4">
            Noch keine vertrauten Twins. Trag unten einen Handle ein, um anzufangen.
          </div>
        ) : (
          <ul className="space-y-2 mb-5">
            {trusts.map((trust) => (
              <li
                key={trust.trustId}
                className="flex items-center justify-between gap-3 border border-border rounded px-3 py-2"
              >
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-mono text-text">{trust.trustedHandle}</div>
                  {trust.note && (
                    <div className="text-xs text-muted mt-0.5">{trust.note}</div>
                  )}
                </div>
                <button
                  onClick={() => removeTrust(trust)}
                  disabled={trustBusy}
                  className="px-3 py-1 text-xs border border-warn text-warn rounded hover:bg-warn hover:text-bg disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                >
                  Entfernen
                </button>
              </li>
            ))}
          </ul>
        )}

        <form
          onSubmit={(e) => {
            e.preventDefault();
            void addTrust();
          }}
          className="space-y-3 border-t border-border pt-4"
        >
          <div className="text-xs uppercase tracking-wider text-muted">
            Vertrauten hinzufügen
          </div>
          <div className="flex flex-col sm:flex-row sm:items-end gap-3">
            <div className="flex-1">
              <label className="block text-xs text-muted mb-1">Handle</label>
              <input
                type="text"
                value={trustHandle}
                onChange={(e) => setTrustHandle(e.target.value)}
                placeholder="@florian"
                disabled={trustBusy}
                className="w-full px-3 py-2 bg-bg border border-border rounded text-sm font-mono text-text focus:outline-none focus:border-accent disabled:opacity-50"
              />
            </div>
            <div className="flex-1">
              <label className="block text-xs text-muted mb-1">Notiz (optional)</label>
              <input
                type="text"
                value={trustNote}
                onChange={(e) => setTrustNote(e.target.value)}
                placeholder="Co-Founder seit Tag 1"
                disabled={trustBusy}
                maxLength={500}
                className="w-full px-3 py-2 bg-bg border border-border rounded text-sm text-text focus:outline-none focus:border-accent disabled:opacity-50"
              />
            </div>
            <button
              type="submit"
              disabled={trustBusy || trustHandle.trim().length === 0}
              className="px-4 py-2 text-sm border border-accent text-accent rounded hover:bg-accent hover:text-bg disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              {trustBusy ? "..." : "Hinzufügen"}
            </button>
          </div>
          {trustError && (
            <div className="text-xs text-warn border border-warn rounded px-3 py-2">
              {trustError}
            </div>
          )}
          {trustInfo && (
            <div className="text-xs text-muted border border-border rounded px-3 py-2">
              {trustInfo}
            </div>
          )}
        </form>
      </Section>

      <Section title={`Skills (${skills.length})`}>
        <p className="text-sm text-muted leading-relaxed mb-4">
          Skills geben dem Twin zusätzliches Wissen oder Fähigkeiten. Sie werden via CLI hinzugefügt und können hier individuell aktiviert oder deaktiviert werden. Aktive Skills landen automatisch im System-Prompt.
        </p>
        {skills.length === 0 ? (
          <div className="text-sm text-muted">
            <p className="mb-2">
              Keine Skills für diesen Twin. Skills werden via CLI angelegt:
            </p>
            <pre className="text-xs font-mono bg-bg border border-border rounded px-3 py-2 whitespace-pre-wrap">
              pnpm --filter @twin-lab/runtime twin:skill-create &lt;handle&gt; &lt;skill-dir&gt;
            </pre>
          </div>
        ) : (
          <ul className="space-y-2">
            {skills.map((skill) => {
              const busy = skillBusyIds.has(skill.skillId);
              return (
                <li
                  key={skill.skillId}
                  className="border border-border rounded px-3 py-2"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-mono text-text">{skill.name}</div>
                      <div className="text-xs text-muted mt-0.5 leading-relaxed">
                        {skill.description}
                      </div>
                    </div>
                    <label className="flex items-center gap-2 shrink-0 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={skill.isActive}
                        onChange={() => void toggleSkill(skill)}
                        disabled={busy}
                        className="h-4 w-4 cursor-pointer disabled:cursor-not-allowed"
                      />
                      <span className="text-xs text-muted">
                        {skill.isActive ? "aktiv" : "inaktiv"}
                      </span>
                    </label>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-[10px]">
                    <span className="font-mono px-2 py-0.5 border border-border rounded text-muted">
                      {skill.capability}
                    </span>
                    <span
                      className={`font-mono px-2 py-0.5 rounded ${
                        skill.source === "mcp"
                          ? "border border-accent text-accent"
                          : "border border-border text-muted"
                      }`}
                    >
                      {skill.source}
                    </span>
                    <span className="text-muted">
                      {skill.instructionsLength} chars Instructions
                      {skill.hasScript && " · Script"}
                      {skill.requiresApproval && " · requires approval"}
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        {skillError && (
          <div className="mt-3 text-xs text-warn border border-warn rounded px-3 py-2">
            {skillError}
          </div>
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
    </PageContainer>
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
