"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { McpServerUiPayload, SkillDetailPayload } from "@twin-lab/shared";
import { PageContainer } from "../../components/PageContainer";
import { MaturityDetail } from "../../components/MaturityDetail";
import { SkillEditorModal } from "../../components/SkillEditorModal";
import { McpServerAddModal } from "../../components/McpServerAddModal";
import { toast } from "../../lib/toast";

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
  // #86: Editor-Modal — `editingSkill` ist der voll geladene Detail-Payload
  // für Edit-Mode, `createOpen` ist der Add-Mode-Flag. Edit-Click lädt
  // erst den Detail per GET (Listings enthalten kein Manifest/Markdown).
  const [editingSkill, setEditingSkill] = useState<SkillDetailPayload | null>(
    null,
  );
  const [createOpen, setCreateOpen] = useState(false);
  const [editLoadingId, setEditLoadingId] = useState<string | null>(null);
  // #87: MCP-Configurator
  const [mcpServers, setMcpServers] = useState<McpServerUiPayload[]>([]);
  const [mcpAddOpen, setMcpAddOpen] = useState(false);
  const [mcpBusyIds, setMcpBusyIds] = useState<Set<string>>(new Set());
  const [mcpDeleteConfirmId, setMcpDeleteConfirmId] = useState<string | null>(
    null,
  );

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

  const loadMcpServers = useCallback(async (handle: string) => {
    try {
      const res = await fetch(`${RUNTIME_URL}/twins/${handle}/mcp-servers`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { servers: McpServerUiPayload[] };
      setMcpServers(data.servers);
    } catch (err) {
      console.error("loadMcpServers failed:", err);
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
    setMcpServers([]);
    setMcpDeleteConfirmId(null);
    loadProfile(selectedHandle);
    loadTrusts(selectedHandle);
    loadSkills(selectedHandle);
    loadMcpServers(selectedHandle);
  }, [selectedHandle, loadProfile, loadTrusts, loadSkills, loadMcpServers]);

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

  // #87: MCP-Server toggle is_active. Optimistic-Update + Revert bei Fehler,
  // analog zu toggleSkill.
  async function toggleMcpServer(server: McpServerUiPayload) {
    if (!selectedHandle) return;
    const next = !server.isActive;
    setMcpServers((curr) =>
      curr.map((s) =>
        s.serverId === server.serverId ? { ...s, isActive: next } : s,
      ),
    );
    setMcpBusyIds((curr) => new Set(curr).add(server.serverId));
    try {
      const res = await fetch(
        `${RUNTIME_URL}/twins/${selectedHandle}/mcp-servers/${server.serverId}/active`,
        {
          method: "PATCH",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ isActive: next }),
        },
      );
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const updated = (await res.json()) as McpServerUiPayload;
      setMcpServers((curr) =>
        curr.map((s) => (s.serverId === updated.serverId ? updated : s)),
      );
    } catch (err) {
      // Revert.
      setMcpServers((curr) =>
        curr.map((s) =>
          s.serverId === server.serverId
            ? { ...s, isActive: server.isActive }
            : s,
        ),
      );
      toast.error(
        err instanceof Error ? err.message : "Toggle fehlgeschlagen",
      );
    } finally {
      setMcpBusyIds((curr) => {
        const next = new Set(curr);
        next.delete(server.serverId);
        return next;
      });
    }
  }

  // #87: Delete mit Cascade-Skill-Count im Toast. Confirm-Stage triggert der
  // Caller (inline in der Row), dieser Handler ist die zweite Klick-Stage.
  async function deleteMcpServer(server: McpServerUiPayload) {
    if (!selectedHandle) return;
    setMcpBusyIds((curr) => new Set(curr).add(server.serverId));
    try {
      const res = await fetch(
        `${RUNTIME_URL}/twins/${selectedHandle}/mcp-servers/${server.serverId}`,
        { method: "DELETE", credentials: "include" },
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      const data = (await res.json()) as {
        ok: boolean;
        deletedSkills: number;
      };
      toast.success(
        `MCP-Server gelöscht — ${data.deletedSkills} Skills entfernt`,
      );
      setMcpDeleteConfirmId(null);
      void loadMcpServers(selectedHandle);
      // Skills haben sich verändert (Cascade): Liste neu laden.
      void loadSkills(selectedHandle);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Löschen fehlgeschlagen",
      );
    } finally {
      setMcpBusyIds((curr) => {
        const next = new Set(curr);
        next.delete(server.serverId);
        return next;
      });
    }
  }

  // #86: Edit-Click lädt den Detail-Payload und öffnet das Modal. GET
  // ist nötig, weil das Listing kein Manifest/instructionsMd enthält.
  async function openEditFor(skill: Skill) {
    if (!selectedHandle || editLoadingId) return;
    setEditLoadingId(skill.skillId);
    try {
      const res = await fetch(
        `${RUNTIME_URL}/twins/${selectedHandle}/skills/${skill.skillId}`,
        { credentials: "include" },
      );
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const detail = (await res.json()) as SkillDetailPayload;
      setEditingSkill(detail);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Skill konnte nicht geladen werden",
      );
    } finally {
      setEditLoadingId(null);
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

      <Section id="twin-reife" title="Twin-Reife">
        {selectedHandle ? (
          <MaturityDetail twinHandle={selectedHandle} />
        ) : (
          <div className="text-sm text-muted">Kein Twin ausgewählt.</div>
        )}
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

      <Section title={`MCP-Server (${mcpServers.length})`}>
        <div className="flex items-start justify-between gap-3 mb-4">
          <p className="text-sm text-muted leading-relaxed flex-1">
            MCP-Server geben dem Twin externe Werkzeuge (Web-Browsing,
            Datenbanken, Custom-Integrationen). Jeder Server wird über eine
            JSON-Spezifikation hinzugefügt und synchronisiert seine Tools
            automatisch als Skills.
          </p>
          <button
            type="button"
            onClick={() => setMcpAddOpen(true)}
            disabled={!selectedHandle}
            className="px-3 py-2 text-xs border border-accent text-accent rounded hover:bg-accent hover:text-bg disabled:opacity-30 disabled:cursor-not-allowed transition-colors flex-shrink-0 font-mono"
          >
            + MCP-Server hinzufügen
          </button>
        </div>
        {mcpServers.length === 0 ? (
          <div className="text-sm text-muted">
            Keine MCP-Server für diesen Twin — klick „+ MCP-Server
            hinzufügen", um den ersten zu verbinden.
          </div>
        ) : (
          <ul className="space-y-2">
            {mcpServers.map((server) => {
              const busy = mcpBusyIds.has(server.serverId);
              const showConfirm = mcpDeleteConfirmId === server.serverId;
              return (
                <li
                  key={server.serverId}
                  className="border border-border rounded px-3 py-2"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-mono text-text">
                        {server.name}
                      </div>
                      <div className="text-[10px] mt-1 flex flex-wrap items-center gap-2">
                        <span className="font-mono px-2 py-0.5 border border-border rounded text-muted">
                          {server.transport}
                        </span>
                        <span className="font-mono px-2 py-0.5 border border-border rounded text-muted">
                          {server.skillCount} Skill
                          {server.skillCount === 1 ? "" : "s"}
                        </span>
                        {server.defaultRequiresApproval && (
                          <span className="font-mono px-2 py-0.5 border border-border rounded text-muted">
                            approval-required
                          </span>
                        )}
                      </div>
                    </div>
                    <label className="flex items-center gap-2 shrink-0 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={server.isActive}
                        onChange={() => void toggleMcpServer(server)}
                        disabled={busy}
                        className="h-4 w-4 cursor-pointer disabled:cursor-not-allowed"
                      />
                      <span className="text-xs text-muted">
                        {server.isActive ? "aktiv" : "inaktiv"}
                      </span>
                    </label>
                  </div>
                  {showConfirm ? (
                    <div className="mt-3 border-t border-warn pt-2 space-y-2">
                      <div className="text-xs text-warn">
                        <span aria-hidden="true">⚠ </span>
                        MCP-Server „{server.name}" wirklich löschen? Dies
                        löscht auch {server.skillCount} zugehörige Skill
                        {server.skillCount === 1 ? "" : "s"}.
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => void deleteMcpServer(server)}
                          disabled={busy}
                          className="px-3 py-1.5 text-xs border border-warn bg-warn text-bg rounded hover:opacity-80 disabled:opacity-30 disabled:cursor-not-allowed transition-opacity font-mono"
                        >
                          {busy ? "Lösche…" : "Endgültig löschen"}
                        </button>
                        <button
                          type="button"
                          onClick={() => setMcpDeleteConfirmId(null)}
                          disabled={busy}
                          className="px-3 py-1.5 text-xs text-muted hover:text-text transition-colors"
                        >
                          Abbrechen
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="mt-2 flex justify-end">
                      <button
                        type="button"
                        onClick={() => setMcpDeleteConfirmId(server.serverId)}
                        disabled={busy}
                        className="text-[10px] font-mono uppercase tracking-wider text-warn hover:underline disabled:opacity-30 disabled:cursor-not-allowed"
                      >
                        Löschen
                      </button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Section>

      <Section title={`Skills (${skills.length})`}>
        <div className="flex items-start justify-between gap-3 mb-4">
          <p className="text-sm text-muted leading-relaxed flex-1">
            Skills geben dem Twin zusätzliches Wissen oder Fähigkeiten. Manuelle Skills hier anlegen und bearbeiten; MCP-Skills werden via <code className="font-mono text-accent">mcp-add</code> synchronisiert. Aktive Skills landen automatisch im System-Prompt.
          </p>
          <button
            type="button"
            onClick={() => setCreateOpen(true)}
            disabled={!selectedHandle}
            className="px-3 py-2 text-xs border border-accent text-accent rounded hover:bg-accent hover:text-bg disabled:opacity-30 disabled:cursor-not-allowed transition-colors flex-shrink-0 font-mono"
          >
            + Skill anlegen
          </button>
        </div>
        {skills.length === 0 ? (
          <div className="text-sm text-muted">
            Keine Skills für diesen Twin — klick „+ Skill anlegen", um den ersten Skill zu schreiben.
          </div>
        ) : (
          <ul className="space-y-2">
            {skills.map((skill) => {
              const busy = skillBusyIds.has(skill.skillId);
              const editLoading = editLoadingId === skill.skillId;
              const isMcp = skill.source === "mcp";
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
                        isMcp
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
                    <span className="ml-auto">
                      {isMcp ? (
                        <span className="text-muted italic">
                          Via MCP-Server verwaltet
                        </span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => void openEditFor(skill)}
                          disabled={editLoading || busy}
                          className="text-accent hover:underline disabled:opacity-30 disabled:cursor-not-allowed font-mono uppercase tracking-wider"
                        >
                          {editLoading ? "Lade…" : "Bearbeiten"}
                        </button>
                      )}
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

      {selectedHandle && (
        <>
          <SkillEditorModal
            open={createOpen}
            mode="create"
            twinHandle={selectedHandle}
            onClose={() => setCreateOpen(false)}
            onSuccess={() => {
              setCreateOpen(false);
              void loadSkills(selectedHandle);
            }}
          />
          <SkillEditorModal
            open={editingSkill !== null}
            mode="edit"
            twinHandle={selectedHandle}
            skill={editingSkill ?? undefined}
            onClose={() => setEditingSkill(null)}
            onSuccess={() => {
              setEditingSkill(null);
              void loadSkills(selectedHandle);
            }}
            onDelete={() => {
              setEditingSkill(null);
              void loadSkills(selectedHandle);
            }}
          />
          <McpServerAddModal
            open={mcpAddOpen}
            twinHandle={selectedHandle}
            onClose={() => setMcpAddOpen(false)}
            onSuccess={() => {
              setMcpAddOpen(false);
              // Add hat Skills synct — beide Listen refetchen.
              void loadMcpServers(selectedHandle);
              void loadSkills(selectedHandle);
            }}
          />
        </>
      )}
    </PageContainer>
  );
}

function Section({
  title,
  id,
  children,
}: {
  title: string;
  id?: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="bg-surface border border-border rounded p-5 scroll-mt-20">
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
