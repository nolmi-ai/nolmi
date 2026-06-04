"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type {
  McpServerUiPayload,
  PersonaInput,
  Preset,
  SettingsDataResponse,
  SkillDetailPayload,
} from "@nolmi/shared";
import { PageContainer } from "../../components/PageContainer";
import { MaturityDetail } from "../../components/MaturityDetail";
import { SkillEditorModal } from "../../components/SkillEditorModal";
import { McpServerAddModal } from "../../components/McpServerAddModal";
import { OAuthActivationModal } from "../../components/OAuthActivationModal";
import { ConfirmDeleteTwinModal } from "../../components/ConfirmDeleteTwinModal";
import { Tabs, TabList, Tab, TabPanel } from "../../components/Tabs";
import { TelegramChannelTab } from "../../components/TelegramChannelTab";
import { FocusTab } from "../../components/FocusTab";
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

  // #131 Phase 5.2: OAuth-Activation-Modal. Öffnet sich aus der Auth-Row
  // in der Profile-Übersicht, zeigt den Phase-4-CLI-Befehl mit Copy-Button.
  const [oauthModalOpen, setOauthModalOpen] = useState(false);

  // #744 Schritt 3: Twin-Löschen-Modal (Danger-Zone in der Profil-Section).
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);

  // #110 Phase 2B Commit 11B: Settings-Edit-Sections (Persona / LLM / Presets).
  // `settingsData` ist die Server-Snapshot, `personaForm` / `llmForm` /
  // `presetsSelected` halten den Edit-Stand. Dirty-Tracking via Snapshot-
  // Vergleich beim Save (kein deep-equal-Library nötig — JSON.stringify
  // reicht für unsere flachen Form-Objects).
  const [settingsData, setSettingsData] = useState<SettingsDataResponse | null>(
    null,
  );
  const [personaForm, setPersonaForm] = useState<PersonaInput | null>(null);
  const [llmForm, setLlmForm] = useState<{
    provider: "anthropic" | "openai";
    model: string;
  }>({ provider: "anthropic", model: "" });
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [apiKeyMode, setApiKeyMode] = useState<
    "masked" | "editing" | "validated"
  >("masked");
  const [apiKeyTesting, setApiKeyTesting] = useState(false);
  const [apiKeyError, setApiKeyError] = useState<string | null>(null);
  const [presetsAvailable, setPresetsAvailable] = useState<Preset[]>([]);
  const [presetsSelected, setPresetsSelected] = useState<string[]>([]);
  const [savingFullConfig, setSavingFullConfig] = useState(false);

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

  // #110 Phase 2B Commit 11B: Settings-Data + Preset-Katalog laden.
  // #131 Phase 5.2 Bug-Fix: cache='no-store' — sonst liefert der Browser
  // beim Modal-Close-Refresh den stale Cached-Response und der OAuth-
  // Status springt nicht ohne manuellen Page-Reload.
  const loadSettingsData = useCallback(async (handle: string) => {
    try {
      const res = await fetch(`${RUNTIME_URL}/twins/${handle}/settings-data`, {
        credentials: "include",
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as SettingsDataResponse;
      setSettingsData(data);
      setPersonaForm(data.persona); // null bei legacy_markdown
      setLlmForm({
        provider:
          data.llmConfig.provider === "anthropic" ||
          data.llmConfig.provider === "openai"
            ? data.llmConfig.provider
            : "anthropic",
        model: data.llmConfig.model,
      });
      setPresetsSelected(data.activePresets);
      setApiKeyMode("masked");
      setApiKeyInput("");
      setApiKeyError(null);
    } catch (err) {
      console.error("loadSettingsData failed:", err);
    }
  }, []);

  const loadPresetsAvailable = useCallback(async () => {
    try {
      const res = await fetch(`${RUNTIME_URL}/examples/presets`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { presets: Preset[] };
      setPresetsAvailable(data.presets);
    } catch (err) {
      console.error("loadPresetsAvailable failed:", err);
    }
  }, []);

  async function testApiKey() {
    if (!apiKeyInput.trim()) return;
    setApiKeyTesting(true);
    setApiKeyError(null);
    try {
      const res = await fetch(`${RUNTIME_URL}/onboarding/validate-api-key`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: llmForm.provider,
          model: llmForm.model,
          apiKey: apiKeyInput,
        }),
      });
      const body = (await res.json()) as
        | { valid: true }
        | { valid: false; reason: string };
      if (!res.ok) {
        throw new Error(
          "error" in body
            ? (body as { error: string }).error
            : `HTTP ${res.status}`,
        );
      }
      if (body.valid) {
        setApiKeyMode("validated");
        setApiKeyError(null);
      } else {
        setApiKeyError(body.reason);
      }
    } catch (err) {
      setApiKeyError(err instanceof Error ? err.message : "Test fehlgeschlagen");
    } finally {
      setApiKeyTesting(false);
    }
  }

  // Dirty-Check: vergleicht aktuellen Form-Stand mit Server-Snapshot.
  // JSON.stringify ist OK für unsere flachen Form-Objects; bei Edge-Cases
  // mit unbestimmter Key-Reihenfolge wäre normalize-and-compare besser.
  const isDirty = useMemo(() => {
    if (!settingsData) return false;
    const personaDirty =
      JSON.stringify(personaForm) !== JSON.stringify(settingsData.persona);
    const llmDirty =
      llmForm.provider !== settingsData.llmConfig.provider ||
      llmForm.model !== settingsData.llmConfig.model;
    const apiKeyDirty = apiKeyMode === "validated";
    const presetsDirty =
      JSON.stringify([...presetsSelected].sort()) !==
      JSON.stringify([...settingsData.activePresets].sort());
    return personaDirty || llmDirty || apiKeyDirty || presetsDirty;
  }, [settingsData, personaForm, llmForm, apiKeyMode, presetsSelected]);

  async function saveFullConfig() {
    if (!selectedHandle || !settingsData) return;
    setSavingFullConfig(true);
    try {
      const body: Record<string, unknown> = {};
      // Persona: nur senden, wenn geändert oder zum ersten Mal strukturiert
      // (Legacy-Twin füllt Form aus → personaForm wird zu structured).
      if (
        personaForm &&
        JSON.stringify(personaForm) !== JSON.stringify(settingsData.persona)
      ) {
        body.persona = personaForm;
      }
      const llmChanged =
        llmForm.provider !== settingsData.llmConfig.provider ||
        llmForm.model !== settingsData.llmConfig.model ||
        apiKeyMode === "validated";
      if (llmChanged) {
        body.llmConfig = {
          provider: llmForm.provider,
          model: llmForm.model,
          apiKey: apiKeyMode === "validated" ? apiKeyInput : null,
        };
      }
      if (
        JSON.stringify([...presetsSelected].sort()) !==
        JSON.stringify([...settingsData.activePresets].sort())
      ) {
        body.presets = presetsSelected;
      }

      const res = await fetch(
        `${RUNTIME_URL}/twins/${selectedHandle}/full-config`,
        {
          method: "PATCH",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
      );
      const result = await res.json();
      if (!res.ok) {
        toast.error(result.error ?? "Speichern fehlgeschlagen");
        return;
      }
      const refreshed = result as SettingsDataResponse & {
        requiresRestart?: boolean;
      };
      setSettingsData(refreshed);
      setPersonaForm(refreshed.persona);
      setLlmForm({
        provider:
          refreshed.llmConfig.provider === "anthropic" ||
          refreshed.llmConfig.provider === "openai"
            ? refreshed.llmConfig.provider
            : "anthropic",
        model: refreshed.llmConfig.model,
      });
      setPresetsSelected(refreshed.activePresets);
      setApiKeyMode("masked");
      setApiKeyInput("");
      setApiKeyError(null);
      // Profile re-laden, damit Twin-Profil-Section neue Werte zeigt
      // (Provider/Model/API-Key-Maske).
      void loadProfile(selectedHandle);
      toast.success(
        refreshed.requiresRestart
          ? "Gespeichert — Änderungen aktiv nach nächstem Twin-Restart"
          : "Gespeichert",
      );
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Netzwerk-Fehler beim Speichern",
      );
    } finally {
      setSavingFullConfig(false);
    }
  }

  // #744 Schritt 3: Nach erfolgreichem Löschen. Twin-Liste frisch holen
  // (autoritativ: der gelöschte Twin ist aus GET /twins raus) und auf einen
  // verbleibenden Twin navigieren — oder in den Onboarding-Flow, wenn keiner
  // mehr da ist. Soft-Navigation; der TwinSwitcher refetcht bei Routenwechsel,
  // damit kein Geist im Dropdown bleibt. Keine tote ?twin=<gelöscht>-URL.
  const handleTwinDeleted = useCallback(async () => {
    setDeleteModalOpen(false);
    toast.success("Twin gelöscht");
    let remaining: TwinSummary[] = [];
    try {
      const res = await fetch(`${RUNTIME_URL}/twins`, { credentials: "include" });
      if (res.ok) {
        const data = (await res.json()) as { twins: TwinSummary[] };
        remaining = data.twins.filter((t) => t.handle !== selectedHandle);
      }
    } catch {
      // Netzwerk-Hänger beim Refetch — konservativ in den Onboarding-Flow.
    }
    if (remaining[0]) {
      router.push(`/settings?twin=${remaining[0].handle}`);
    } else {
      router.push("/onboarding");
    }
  }, [router, selectedHandle]);

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
    // #110 Phase 2B Commit 11B: Settings-Edit-State auch bei Twin-Wechsel
    // zurücksetzen, damit kein State aus dem alten Twin in den neuen leakt.
    setSettingsData(null);
    setPersonaForm(null);
    setApiKeyMode("masked");
    setApiKeyInput("");
    setApiKeyError(null);
    setPresetsSelected([]);
    loadProfile(selectedHandle);
    loadTrusts(selectedHandle);
    loadSkills(selectedHandle);
    loadMcpServers(selectedHandle);
    loadSettingsData(selectedHandle);
  }, [
    selectedHandle,
    loadProfile,
    loadTrusts,
    loadSkills,
    loadMcpServers,
    loadSettingsData,
  ]);

  // Preset-Katalog ist twin-unabhängig — einmalig laden.
  useEffect(() => {
    void loadPresetsAvailable();
  }, [loadPresetsAvailable]);

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

  // #130 Phase 4.3: Bookmark-Backward-Compat für #twin-reife-Anchor.
  // Vor 4.3 verlinkte MaturityBadge auf `/settings?twin=…#twin-reife`,
  // der ScrollMargin im Section-Wrapper machte das funktional. Mit
  // Tab-Sidebar ist der Anchor visuell tot — wir migrieren beim Mount
  // zu `?tab=reife`. Nur greifen, wenn `tab` nicht explicit gesetzt
  // ist (User-Intent „direkt zu Tab X" gewinnt).
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.location.hash !== "#twin-reife") return;
    if (searchParams.get("tab")) return;
    const params = new URLSearchParams(searchParams.toString());
    params.set("tab", "reife");
    router.replace(`/settings?${params.toString()}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <PageContainer>
      <div className="flex items-baseline gap-3 mb-6">
        <h1 className="text-xl font-semibold text-text">Settings</h1>
        {selectedHandle && (
          <span className="text-xs text-muted font-mono">{selectedHandle}</span>
        )}
      </div>

      {error && (
        <div className="text-xs text-warn border border-warn rounded px-3 py-2 mb-6">
          {error}
        </div>
      )}

      {/* #130 Phase 4.3: Tab-Sidebar-Layout statt long-scroll Section-Stack.
          State-Management bleibt zentral in SettingsInner — Tabs sind nur
          Visual-Layer für die existing Bereiche. Konfig-Tab aggregiert
          Persona+LLM+Presets mit atomic-Submit (Per-Tab-Submit-Refactor
          als #134 Backlog). */}
      <Tabs defaultTab="profil" persistInUrl paramName="tab">
        <TabList>
          <Tab id="profil">Profil</Tab>
          <Tab id="reife">Reife</Tab>
          <Tab id="vertraute">Vertraute</Tab>
          <Tab id="mcp-servers">MCP-Server</Tab>
          <Tab id="skills">Skills</Tab>
          <Tab id="fokus">Fokus</Tab>
          <Tab id="konfiguration">Konfiguration</Tab>
          <Tab id="channels">Channels</Tab>
        </TabList>

        <TabPanel id="profil">
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
          <ProfileBody
            profile={profile}
            auth={settingsData?.auth ?? null}
            onActivateOAuth={() => setOauthModalOpen(true)}
          />
        ) : null}
      </Section>

      {/* #744 Schritt 3: Danger-Zone — visuell abgesetzt (roter Rahmen). Der
          Button ist nur für den aktuell geladenen Twin aktiv; GET /twins ist
          server-seitig owner-gescoped (nur eigene Twins), also wird der Button
          ohnehin nur für eigene Twins angeboten. requireOwner gated zusätzlich
          serverseitig; ein 403 fängt das Modal als Fehlertext ab. */}
      {profile && selectedHandle && (
        <section className="mt-6 bg-surface border border-warn rounded p-5">
          <h2 className="text-sm font-semibold text-warn mb-2 tracking-tight">
            Danger Zone
          </h2>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-muted leading-relaxed flex-1">
              Diesen Twin unwiderruflich löschen — inklusive aller Daten
              (Konversationen, Facts, Memory, Skills, Telegram, OAuth) und
              Deregistrierung von der Bridge.
            </p>
            <button
              type="button"
              onClick={() => setDeleteModalOpen(true)}
              className="px-4 py-2 text-sm border border-warn text-warn rounded hover:bg-warn hover:text-bg disabled:opacity-30 disabled:cursor-not-allowed transition-colors flex-shrink-0 font-mono"
            >
              Diesen Twin löschen
            </button>
          </div>
        </section>
      )}
        </TabPanel>

        <TabPanel id="reife">
      <Section id="twin-reife" title="Twin-Reife">
        {selectedHandle ? (
          <MaturityDetail twinHandle={selectedHandle} />
        ) : (
          <div className="text-sm text-muted">Kein Twin ausgewählt.</div>
        )}
      </Section>
        </TabPanel>

        <TabPanel id="vertraute">
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
        </TabPanel>

        <TabPanel id="mcp-servers">
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
        </TabPanel>

        <TabPanel id="skills">
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
        </TabPanel>

        <TabPanel id="fokus">
          {selectedHandle ? (
            <FocusTab twinHandle={selectedHandle} />
          ) : (
            <div className="bg-surface border border-border rounded p-5">
              <p className="text-sm text-muted">Kein Twin ausgewählt.</p>
            </div>
          )}
        </TabPanel>

        <TabPanel id="konfiguration">
      {/* #110 Phase 2B Commit 11B: Persona / LLM / Presets als Edit-Sections.
       * Daten kommen aus GET /twins/:handle/settings-data, Submit geht
       * atomar an PATCH /twins/:handle/full-config (alle drei Blocks in
       * einem Call). Form-Code self-contained (β-Approach) — Wizard-
       * Components leben in /onboarding/page.tsx, hier nicht importiert,
       * Re-Use ist als #124 Phase-2C-Kandidat im Backlog.
       *
       * #130 Phase 4.3: gemeinsam in TabPanel id="konfiguration", atomic-
       * Submit unverändert. Per-Tab-Submit-Refactor als #134 Backlog. */}
      <PersonaEditSection
        settingsData={settingsData}
        personaForm={personaForm}
        setPersonaForm={setPersonaForm}
        selectedHandle={selectedHandle}
      />

      <LlmEditSection
        settingsData={settingsData}
        llmForm={llmForm}
        setLlmForm={setLlmForm}
        apiKeyInput={apiKeyInput}
        setApiKeyInput={setApiKeyInput}
        apiKeyMode={apiKeyMode}
        setApiKeyMode={setApiKeyMode}
        apiKeyTesting={apiKeyTesting}
        apiKeyError={apiKeyError}
        setApiKeyError={setApiKeyError}
        onTestApiKey={testApiKey}
      />

      <PresetsEditSection
        available={presetsAvailable}
        selected={presetsSelected}
        onToggle={(id) =>
          setPresetsSelected((curr) =>
            curr.includes(id) ? curr.filter((x) => x !== id) : [...curr, id],
          )
        }
      />

      {settingsData && (
        <div className="flex items-center justify-end gap-3 pt-2">
          {isDirty && !savingFullConfig && (
            <span className="text-xs text-muted italic">
              Ungespeicherte Änderungen
            </span>
          )}
          <button
            onClick={saveFullConfig}
            disabled={!isDirty || savingFullConfig}
            className="px-4 py-2 border border-accent text-accent text-sm rounded disabled:opacity-30 disabled:cursor-not-allowed hover:bg-accent hover:text-bg transition-colors"
          >
            {savingFullConfig ? "Speichert…" : "Speichern"}
          </button>
        </div>
      )}
        </TabPanel>

        <TabPanel id="channels">
          {/* #130 Phase 4.3: Channels-Sub-Tab-Skelett. Phase 4.4 füllt
              den Telegram-Sub-Tab mit echtem Bot-Config-UI (Empty/
              Configured-Unpaired/Paired-State-Modi). WhatsApp + Discord
              bleiben disabled bis ROADMAP Phase 4.2 / 4.3. */}
          <Tabs defaultTab="telegram" persistInUrl paramName="channel">
            <TabList>
              <Tab id="telegram">Telegram</Tab>
              <Tab id="whatsapp" disabled>WhatsApp (folgt)</Tab>
              <Tab id="discord" disabled>Discord (folgt)</Tab>
            </TabList>

            <TabPanel id="telegram">
              {selectedHandle ? (
                <TelegramChannelTab twinHandle={selectedHandle} />
              ) : (
                <div className="bg-surface border border-border rounded p-5">
                  <p className="text-sm text-muted">
                    Kein Twin ausgewählt.
                  </p>
                </div>
              )}
            </TabPanel>

            <TabPanel id="whatsapp">
              <Section title="WhatsApp">
                <p className="text-muted text-sm">Coming soon.</p>
              </Section>
            </TabPanel>

            <TabPanel id="discord">
              <Section title="Discord">
                <p className="text-muted text-sm">Coming soon.</p>
              </Section>
            </TabPanel>
          </Tabs>
        </TabPanel>
      </Tabs>

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
          {oauthModalOpen && (
            <OAuthActivationModal
              handle={selectedHandle}
              onRefresh={() => loadSettingsData(selectedHandle)}
              onClose={() => setOauthModalOpen(false)}
            />
          )}
          {deleteModalOpen && (
            <ConfirmDeleteTwinModal
              handle={selectedHandle}
              onClose={() => setDeleteModalOpen(false)}
              onDeleted={() => void handleTwinDeleted()}
            />
          )}
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

function ProfileBody({
  profile,
  auth,
  onActivateOAuth,
}: {
  profile: TwinProfileResponse;
  /**
   * #131 Phase 5.2: Auth-Status aus settings-data. `null` solange Settings-
   * Data noch nicht geladen ist (Profile-Endpoint ist parallel, kann früher
   * fertig sein) — Row rendert dann Loading-State.
   */
  auth: SettingsDataResponse["auth"] | null;
  onActivateOAuth: () => void;
}) {
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

      <Row label="Auth">
        {auth === null ? (
          <span className="text-xs text-muted italic">lädt …</span>
        ) : (
          <AuthRowContent auth={auth} onActivate={onActivateOAuth} />
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

// ─── #131 Phase 5.2: Auth-Row-Content ────────────────────────────────────────

function AuthRowContent({
  auth,
  onActivate,
}: {
  auth: SettingsDataResponse["auth"];
  onActivate: () => void;
}) {
  if (auth.mode === "api_key") {
    // D2 (Distribution Etappe 2.4a): kein Self-Service-OAuth. Bei api_key zeigt
    // die UI nur den Status, KEINEN Aktivieren-Pfad — OAuth ist Allowlist-only
    // (Admin via `twin:auth-mode`). Der CLI-Login lehnt api_key-Twins ohnehin
    // ab, das hier ist das UI-Gate (beide Ebenen, weil UI-only umgehbar wäre).
    return (
      <div className="flex items-center gap-3">
        <span className="text-text">API-Key</span>
      </div>
    );
  }

  // mode === "oauth"
  if (!auth.oauth) {
    // Inkonsistenter DB-Stand: Mode='oauth' aber keine Token-Row.
    // UI fällt auf Aktivieren-Button zurück mit Hinweis.
    return (
      <div className="flex items-center gap-3">
        <span className="text-warn">OAuth (kein Token!)</span>
        <button
          type="button"
          onClick={onActivate}
          className="text-xs text-accent hover:underline"
        >
          Neu loggen
        </button>
      </div>
    );
  }

  const oauth = auth.oauth;
  // #131 Phase 5.2 Polish: expires_at + isExpired/isExpiringSoon-Badges
  // raus — Token-Refresh ist Implementation-Detail. buttonLabel-Differenz
  // (Re-Login vs Neu loggen) bleibt: bei isExpired signalisiert das Wort
  // den Re-Login-Bedarf ohne dass ein Datum vor Augen geführt werden muss.
  const buttonLabel = oauth.isExpired ? "Neu loggen" : "Re-Login";

  return (
    <div className="space-y-0.5">
      <div className="text-text">OAuth (ChatGPT)</div>
      <div className="text-xs text-muted font-mono">
        account: {oauth.accountId ? maskAccountId(oauth.accountId) : "(unbekannt)"}
      </div>
      <div className="pt-1">
        <button
          type="button"
          onClick={onActivate}
          className="text-xs text-accent hover:underline"
        >
          {buttonLabel}
        </button>
      </div>
    </div>
  );
}

// #131 Phase 5.2 Polish: Account-ID-Maske analog API-Key-Pattern
// (ersten 4 + Ellipsis + letzten 4). Defensiv: wenn ID kürzer als 9
// Chars, ungekürzt anzeigen — Mask wäre länger als Original.
function maskAccountId(id: string): string {
  if (id.length <= 8) return id;
  return `${id.slice(0, 4)}…${id.slice(-4)}`;
}

// ─── #110 Phase 2B Commit 11B: Settings-Edit-Sections ────────────────────────
//
// Form-Code self-contained (β-Approach): ~250 Z aus Wizard-Components in
// /onboarding/page.tsx hierher kopiert mit Settings-spezifischen Anpassungen
// (Handle read-only, API-Key-Edit-Mode, kein Handle-Live-Check). Shared-
// Extract zu apps/web/components/* ist als Backlog #124 für Phase 2C
// vorgesehen.

const EMPTY_PERSONA: PersonaInput = {
  fullName: "",
  handle: "",
  role: "",
  tone: [],
  pronoun: "du",
  preferences: [],
  topics: [],
  relationships: [],
};

const TONE_OPTIONS = [
  { id: "direct" as const, label: "Direkt" },
  { id: "polite" as const, label: "Höflich" },
  { id: "casual" as const, label: "Locker" },
  { id: "formal" as const, label: "Formell" },
];
const PRONOUN_OPTIONS = [
  { id: "du" as const, label: "Du" },
  { id: "sie" as const, label: "Sie" },
  { id: "context-dependent" as const, label: "Je nach Kontext" },
];
const PREFERENCE_OPTIONS = [
  { id: "no-emojis" as const, label: "Keine Emojis" },
  { id: "no-platitudes" as const, label: "Keine Floskeln" },
  { id: "short-answers" as const, label: "Knappe Antworten" },
];

function PersonaEditSection({
  settingsData,
  personaForm,
  setPersonaForm,
  selectedHandle,
}: {
  settingsData: SettingsDataResponse | null;
  personaForm: PersonaInput | null;
  setPersonaForm: (p: PersonaInput) => void;
  selectedHandle: string | null;
}) {
  if (!settingsData) {
    return (
      <Section title="Persona">
        <div className="text-sm text-muted">Lade Persona…</div>
      </Section>
    );
  }

  const isLegacy = settingsData.personaSource === "legacy_markdown";
  // Bei Legacy-Twin: leere Form aufmachen, sobald User klickt. Bis dahin
  // nur Hint zeigen.
  const persona = personaForm ?? EMPTY_PERSONA;
  const updatePersona = (patch: Partial<PersonaInput>) => {
    setPersonaForm({ ...persona, ...patch, handle: persona.handle });
  };

  return (
    <Section title="Persona">
      {isLegacy && !personaForm && (
        <div className="space-y-3">
          <p className="text-sm text-muted leading-relaxed">
            Persona dieses Twins wurde mit einer älteren Version oder via
            Bootstrap-CLI angelegt. Für strukturierte Bearbeitung muss sie
            einmalig in die neue Form übertragen werden.
          </p>
          <button
            type="button"
            onClick={() =>
              setPersonaForm({
                ...EMPTY_PERSONA,
                handle: selectedHandle ?? "",
              })
            }
            className="px-3 py-1.5 text-xs border border-accent text-accent rounded hover:bg-accent hover:text-bg transition-colors"
          >
            Persona neu strukturieren
          </button>
        </div>
      )}

      {(!isLegacy || personaForm) && (
        <div className="space-y-5">
          <div>
            <label className="block text-xs uppercase tracking-wider text-muted mb-1">
              Voller Name
            </label>
            <input
              type="text"
              value={persona.fullName}
              onChange={(e) => updatePersona({ fullName: e.target.value })}
              className="w-full bg-bg border border-border rounded px-3 py-2 text-sm text-text focus:outline-none focus:border-accent"
            />
          </div>

          <div>
            <label className="block text-xs uppercase tracking-wider text-muted mb-1">
              Handle
            </label>
            <input
              type="text"
              value={persona.handle}
              disabled
              className="w-full bg-bg border border-border rounded px-3 py-2 text-sm text-muted font-mono opacity-60 cursor-not-allowed"
            />
            <div className="text-xs text-muted mt-1">
              Handle-Änderung ist heute noch nicht implementiert (Backlog #123).
            </div>
          </div>

          <div>
            <label className="block text-xs uppercase tracking-wider text-muted mb-1">
              Rolle
            </label>
            <input
              type="text"
              value={persona.role}
              onChange={(e) => updatePersona({ role: e.target.value })}
              className="w-full bg-bg border border-border rounded px-3 py-2 text-sm text-text focus:outline-none focus:border-accent"
            />
          </div>

          <div>
            <div className="text-xs uppercase tracking-wider text-muted mb-2">
              Tonfall (mind. 1)
            </div>
            <div className="flex flex-wrap gap-2">
              {TONE_OPTIONS.map((opt) => (
                <SettingsPill
                  key={opt.id}
                  label={opt.label}
                  active={persona.tone.includes(opt.id)}
                  onClick={() =>
                    updatePersona({
                      tone: persona.tone.includes(opt.id)
                        ? persona.tone.filter((x) => x !== opt.id)
                        : [...persona.tone, opt.id],
                    })
                  }
                />
              ))}
            </div>
          </div>

          <div>
            <div className="text-xs uppercase tracking-wider text-muted mb-2">
              Pronomen
            </div>
            <div className="flex flex-wrap gap-2">
              {PRONOUN_OPTIONS.map((opt) => (
                <SettingsPill
                  key={opt.id}
                  label={opt.label}
                  active={persona.pronoun === opt.id}
                  onClick={() => updatePersona({ pronoun: opt.id })}
                />
              ))}
            </div>
          </div>

          <div>
            <div className="text-xs uppercase tracking-wider text-muted mb-2">
              Sonderwünsche (optional)
            </div>
            <div className="flex flex-wrap gap-2">
              {PREFERENCE_OPTIONS.map((opt) => (
                <SettingsPill
                  key={opt.id}
                  label={opt.label}
                  active={persona.preferences.includes(opt.id)}
                  onClick={() =>
                    updatePersona({
                      preferences: persona.preferences.includes(opt.id)
                        ? persona.preferences.filter((x) => x !== opt.id)
                        : [...persona.preferences, opt.id],
                    })
                  }
                />
              ))}
            </div>
          </div>

          <TopicsEditor persona={persona} updatePersona={updatePersona} />
          <RelationshipsEditor persona={persona} updatePersona={updatePersona} />
        </div>
      )}
    </Section>
  );
}

function TopicsEditor({
  persona,
  updatePersona,
}: {
  persona: PersonaInput;
  updatePersona: (patch: Partial<PersonaInput>) => void;
}) {
  const [input, setInput] = useState("");
  const add = () => {
    const t = input.trim();
    if (!t) return;
    updatePersona({ topics: [...persona.topics, t] });
    setInput("");
  };
  return (
    <div>
      <div className="text-xs uppercase tracking-wider text-muted mb-2">
        Themen (mind. 1)
      </div>
      <div className="flex gap-2">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), add())}
          className="flex-1 bg-bg border border-border rounded px-3 py-2 text-sm text-text focus:outline-none focus:border-accent"
          placeholder="z.B. Design Systems"
        />
        <button
          onClick={add}
          className="px-3 py-2 border border-accent text-accent text-sm rounded hover:bg-accent hover:text-bg transition-colors"
        >
          +
        </button>
      </div>
      {persona.topics.length > 0 && (
        <div className="flex flex-wrap gap-2 mt-3">
          {persona.topics.map((t, i) => (
            <span
              key={i}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs border border-border rounded text-text"
            >
              {t}
              <button
                onClick={() =>
                  updatePersona({
                    topics: persona.topics.filter((_, idx) => idx !== i),
                  })
                }
                className="text-muted hover:text-warn"
                aria-label="Entfernen"
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function RelationshipsEditor({
  persona,
  updatePersona,
}: {
  persona: PersonaInput;
  updatePersona: (patch: Partial<PersonaInput>) => void;
}) {
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const add = () => {
    const n = name.trim();
    const d = desc.trim();
    if (!n || !d) return;
    updatePersona({
      relationships: [...persona.relationships, { name: n, description: d }],
    });
    setName("");
    setDesc("");
  };
  return (
    <div>
      <div className="text-xs uppercase tracking-wider text-muted mb-2">
        Beziehungen (optional)
      </div>
      <div className="flex gap-2">
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="w-1/2 bg-bg border border-border rounded px-3 py-2 text-sm text-text focus:outline-none focus:border-accent"
          placeholder="Anna Beispiel"
        />
        <input
          type="text"
          value={desc}
          onChange={(e) => setDesc(e.target.value)}
          className="flex-1 bg-bg border border-border rounded px-3 py-2 text-sm text-text focus:outline-none focus:border-accent"
          placeholder="Designerin im Team"
        />
        <button
          onClick={add}
          className="px-3 py-2 border border-accent text-accent text-sm rounded hover:bg-accent hover:text-bg transition-colors"
        >
          +
        </button>
      </div>
      {persona.relationships.length > 0 && (
        <ul className="mt-3 space-y-1">
          {persona.relationships.map((r, i) => (
            <li
              key={i}
              className="flex items-start justify-between text-sm text-text border-b border-border py-1.5"
            >
              <span>
                <span className="text-text">{r.name}</span>
                <span className="text-muted"> — {r.description}</span>
              </span>
              <button
                onClick={() =>
                  updatePersona({
                    relationships: persona.relationships.filter(
                      (_, idx) => idx !== i,
                    ),
                  })
                }
                className="text-muted hover:text-warn text-xs"
              >
                entfernen
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function SettingsPill({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1.5 text-xs border rounded transition-colors ${
        active
          ? "border-accent text-accent bg-surface"
          : "border-border text-muted hover:border-accent hover:text-text"
      }`}
    >
      {label}
    </button>
  );
}

function LlmEditSection({
  settingsData,
  llmForm,
  setLlmForm,
  apiKeyInput,
  setApiKeyInput,
  apiKeyMode,
  setApiKeyMode,
  apiKeyTesting,
  apiKeyError,
  setApiKeyError,
  onTestApiKey,
}: {
  settingsData: SettingsDataResponse | null;
  llmForm: { provider: "anthropic" | "openai"; model: string };
  setLlmForm: (next: { provider: "anthropic" | "openai"; model: string }) => void;
  apiKeyInput: string;
  setApiKeyInput: (v: string) => void;
  apiKeyMode: "masked" | "editing" | "validated";
  setApiKeyMode: (m: "masked" | "editing" | "validated") => void;
  apiKeyTesting: boolean;
  apiKeyError: string | null;
  setApiKeyError: (err: string | null) => void;
  onTestApiKey: () => void;
}) {
  if (!settingsData) {
    return (
      <Section title="LLM + API-Key">
        <div className="text-sm text-muted">Lade LLM-Config…</div>
      </Section>
    );
  }
  return (
    <Section title="LLM + API-Key">
      <div className="space-y-5">
        <div>
          <div className="text-xs uppercase tracking-wider text-muted mb-2">
            Provider
          </div>
          <div className="grid sm:grid-cols-2 gap-3">
            <button
              onClick={() => {
                setLlmForm({
                  provider: "anthropic",
                  model:
                    llmForm.provider !== "anthropic"
                      ? "claude-opus-4-7"
                      : llmForm.model,
                });
                setApiKeyMode("masked");
              }}
              className={`text-left p-4 rounded border transition-colors ${
                llmForm.provider === "anthropic"
                  ? "border-accent bg-surface"
                  : "border-border bg-surface hover:border-accent"
              }`}
            >
              <div className="text-sm text-text font-mono">
                anthropic / claude-opus-4-7
              </div>
              <div className="text-xs text-muted mt-1">~$0,015 / Antwort</div>
            </button>
            <button
              onClick={() => {
                setLlmForm({
                  provider: "openai",
                  model:
                    llmForm.provider !== "openai" ? "gpt-5.5" : llmForm.model,
                });
                setApiKeyMode("masked");
              }}
              className={`text-left p-4 rounded border transition-colors ${
                llmForm.provider === "openai"
                  ? "border-accent bg-surface"
                  : "border-border bg-surface hover:border-accent"
              }`}
            >
              <div className="text-sm text-text font-mono">openai / gpt-5.5</div>
              <div className="text-xs text-muted mt-1">~$0,008 / Antwort</div>
            </button>
          </div>
        </div>

        <div>
          <label className="block text-xs uppercase tracking-wider text-muted mb-1">
            Model
          </label>
          <input
            type="text"
            value={llmForm.model}
            onChange={(e) => setLlmForm({ ...llmForm, model: e.target.value })}
            className="w-full bg-bg border border-border rounded px-3 py-2 text-sm text-text font-mono focus:outline-none focus:border-accent"
          />
        </div>

        <div>
          <label className="block text-xs uppercase tracking-wider text-muted mb-1">
            API-Key
          </label>
          {apiKeyMode === "masked" ? (
            <div className="flex items-center gap-3">
              <span className="font-mono text-sm text-muted">
                {settingsData.llmConfig.apiKeyMasked}
              </span>
              <button
                type="button"
                onClick={() => {
                  setApiKeyMode("editing");
                  setApiKeyInput("");
                }}
                className="text-xs text-accent hover:underline"
              >
                Ändern
              </button>
            </div>
          ) : (
            <div className="space-y-2">
              <input
                type="password"
                value={apiKeyInput}
                onChange={(e) => {
                  setApiKeyInput(e.target.value);
                  if (apiKeyMode === "validated") setApiKeyMode("editing");
                }}
                placeholder={
                  llmForm.provider === "anthropic" ? "sk-ant-…" : "sk-…"
                }
                className="w-full bg-bg border border-border rounded px-3 py-2 text-sm text-text font-mono focus:outline-none focus:border-accent"
              />
              {apiKeyError && (
                <div className="text-xs text-warn">✗ {apiKeyError}</div>
              )}
              {apiKeyMode === "validated" && (
                <div className="text-xs text-accent">
                  ✓ Key funktioniert — beim Speichern wird er übernommen.
                </div>
              )}
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={onTestApiKey}
                  disabled={apiKeyTesting || !apiKeyInput.trim()}
                  className="px-3 py-1.5 border border-accent text-accent text-xs rounded disabled:opacity-30 disabled:cursor-not-allowed hover:bg-accent hover:text-bg transition-colors"
                >
                  {apiKeyTesting ? "Teste…" : "Testen"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setApiKeyMode("masked");
                    setApiKeyInput("");
                    setApiKeyError(null);
                  }}
                  className="text-xs text-muted hover:text-text"
                >
                  Abbrechen
                </button>
              </div>
              <div className="text-xs text-muted">
                Ohne Testen + Speichern bleibt der bisherige Key aktiv.
              </div>
            </div>
          )}
        </div>
      </div>
    </Section>
  );
}

function PresetsEditSection({
  available,
  selected,
  onToggle,
}: {
  available: Preset[];
  selected: string[];
  onToggle: (id: string) => void;
}) {
  if (available.length === 0) {
    return (
      <Section title="Presets">
        <div className="text-sm text-muted">
          Keine Presets verfügbar. Self-Hoster: lege Templates in{" "}
          <span className="font-mono">examples/skills/&lt;name&gt;/</span> ab.
        </div>
      </Section>
    );
  }
  return (
    <Section title="Presets">
      <p className="text-sm text-muted leading-relaxed mb-4">
        Pattern-Skills aktivieren oder deaktivieren. Speichern oben sendet die
        Auswahl als Soll-Zustand — neue Picks werden importiert, abgewählte
        gelöscht.
      </p>
      <div className="space-y-3">
        {available.map((preset) => {
          const active = selected.includes(preset.id);
          return (
            <button
              key={preset.id}
              type="button"
              onClick={() => onToggle(preset.id)}
              className={`w-full text-left p-4 rounded border transition-colors ${
                active
                  ? "border-accent bg-surface"
                  : "border-border bg-surface hover:border-accent"
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold text-text">
                    {preset.name}
                  </div>
                  <div className="text-xs text-muted mt-1">
                    {preset.description}
                  </div>
                  {preset.requiresMcpServers.length > 0 && (
                    <div className="text-xs text-muted italic mt-2">
                      ⚠ Erfordert MCP-Server:{" "}
                      <span className="font-mono not-italic">
                        {preset.requiresMcpServers.join(", ")}
                      </span>
                      . MCP-Setup über die Section weiter oben.
                    </div>
                  )}
                </div>
                <div
                  className={`shrink-0 mt-0.5 text-xs uppercase tracking-wider ${
                    active ? "text-accent" : "text-muted"
                  }`}
                >
                  {active ? "✓ Aktiv" : "Inaktiv"}
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </Section>
  );
}
