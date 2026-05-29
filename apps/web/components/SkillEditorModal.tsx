"use client";

import { useEffect, useState } from "react";
import type { SkillDetailPayload, SkillManifest } from "@nolmi/shared";
import { ModalWrapper } from "./ModalWrapper";
import { toast } from "../lib/toast";

// ─── SkillEditorModal (#86) ──────────────────────────────────────────────────
//
// Multi-Field-Form für manuelle Skills (Add + Edit). MCP-Skills sind read-
// only und kommen nie in dieses Modal — die Settings-Page rendert für sie
// einen "Via MCP-Server verwaltet"-Hinweis statt Edit-Button.
//
// Design-Disziplin (Anti-Goals aus Briefing):
//   - Manifest ist ein freier JSON-Textarea, kein Form-Builder
//   - Markdown-Anweisungen als Textarea, keine Live-Preview
//   - Name nicht änderbar via Edit (auch wenn Backend erlauben würde)
//   - Delete-Confirm als zweite Stage im selben Modal, nicht als zweites Modal
//
// Submit-Verhalten:
//   - Create: POST /twins/:handle/skills → 201 → onSuccess(detail)
//   - Edit:   PATCH /twins/:handle/skills/:skillId → 200 → onSuccess(detail)
//   - Delete: DELETE /twins/:handle/skills/:skillId → 204 → onDelete()

const RUNTIME_URL =
  process.env.NEXT_PUBLIC_RUNTIME_URL ?? "http://localhost:4000";

const DEFAULT_MANIFEST_TEMPLATE = `{
  "capability": "respond_to_chat",
  "requiresApproval": false
}`;

type Mode = "create" | "edit";

export interface SkillEditorModalProps {
  open: boolean;
  mode: Mode;
  twinHandle: string;
  /** Bei mode='edit' erforderlich; bei mode='create' ignoriert. */
  skill?: SkillDetailPayload;
  onClose: () => void;
  /** Wird bei erfolgreichem Create/Update aufgerufen. */
  onSuccess: (skill: SkillDetailPayload) => void;
  /** Wird bei erfolgreichem Delete aufgerufen (nur Edit-Mode). */
  onDelete?: (skillId: string) => void;
}

export function SkillEditorModal({
  open,
  mode,
  twinHandle,
  skill,
  onClose,
  onSuccess,
  onDelete,
}: SkillEditorModalProps) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [manifestText, setManifestText] = useState(DEFAULT_MANIFEST_TEMPLATE);
  const [instructionsMd, setInstructionsMd] = useState("");
  const [scriptTs, setScriptTs] = useState("");

  const [manifestError, setManifestError] = useState<string | null>(null);
  const [nameError, setNameError] = useState<string | null>(null);
  const [descriptionError, setDescriptionError] = useState<string | null>(null);
  const [instructionsError, setInstructionsError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [deleteStage, setDeleteStage] = useState(false);

  // Reset state beim Open — bei Edit-Mode aus dem mitgegebenen Skill prefillen,
  // bei Create-Mode mit Defaults. Reset auch deleteStage, damit ein vorher
  // angefangener Lösch-Flow nicht in einem anderen Modal-Open weiterläuft.
  useEffect(() => {
    if (!open) return;
    setDeleteStage(false);
    setManifestError(null);
    setNameError(null);
    setDescriptionError(null);
    setInstructionsError(null);
    setBusy(false);
    if (mode === "edit" && skill) {
      setName(skill.name);
      setDescription(skill.description);
      // Manifest ohne name/description (die werden Top-Level gepflegt und
      // serverseitig in das Manifest gespiegelt). User soll die nicht
      // doppelt sehen.
      const { name: _n, description: _d, ...rest } = skill.manifestJson;
      setManifestText(JSON.stringify(rest, null, 2));
      setInstructionsMd(skill.instructionsMd);
      setScriptTs(skill.scriptTs ?? "");
    } else {
      setName("");
      setDescription("");
      setManifestText(DEFAULT_MANIFEST_TEMPLATE);
      setInstructionsMd("");
      setScriptTs("");
    }
  }, [open, mode, skill]);

  if (!open) return null;

  function handleNameChange(value: string) {
    setName(value);
    setNameError(null);
  }

  function validateManifestOnBlur(): SkillManifest | null {
    if (manifestText.trim().length === 0) {
      setManifestError("Manifest darf nicht leer sein");
      return null;
    }
    try {
      const parsed = JSON.parse(manifestText) as Partial<SkillManifest>;
      // Pflichtfelder grob prüfen — die echte Validation passiert serverseitig
      // via SkillManifestSchema. Hier nur die häufigsten Fehler abfangen.
      if (typeof parsed.capability !== "string") {
        setManifestError('Manifest braucht ein "capability" (String)');
        return null;
      }
      if (typeof parsed.requiresApproval !== "boolean") {
        setManifestError('Manifest braucht "requiresApproval" (true/false)');
        return null;
      }
      setManifestError(null);
      return parsed as SkillManifest;
    } catch (err) {
      setManifestError(
        `Ungültiges JSON: ${err instanceof Error ? err.message : "Parse-Fehler"}`,
      );
      return null;
    }
  }

  function buildManifestForSubmit(): SkillManifest | null {
    // Beim Submit nochmal sauber parsen — User könnte direkt aus dem Feld
    // submitten ohne Blur-Trigger.
    const parsed = validateManifestOnBlur();
    if (!parsed) return null;
    return {
      ...parsed,
      name,
      description,
    };
  }

  async function handleSubmit() {
    if (busy) return;
    const trimmedName = name.trim();
    // Required-Field-Checks aggregieren — alle Felder gleichzeitig markieren,
    // damit der User nicht in einer Endlosschleife pro Klick einen Fehler
    // nach dem anderen behebt. Inline statt Toast, konsistent zu Name- und
    // Manifest-Validation.
    let hasError = false;
    if (mode === "create") {
      if (trimmedName.length === 0) {
        setNameError("Name ist erforderlich");
        hasError = true;
      } else if (/\s/.test(trimmedName)) {
        setNameError("Name darf keinen Whitespace enthalten");
        hasError = true;
      }
    }
    if (description.trim().length === 0) {
      setDescriptionError("Beschreibung darf nicht leer sein");
      hasError = true;
    }
    if (instructionsMd.trim().length === 0) {
      setInstructionsError("Anweisungen dürfen nicht leer sein");
      hasError = true;
    }
    const manifest = buildManifestForSubmit();
    if (!manifest) hasError = true;
    if (hasError || !manifest) return;

    setBusy(true);
    try {
      if (mode === "create") {
        const res = await fetch(`${RUNTIME_URL}/twins/${twinHandle}/skills`, {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: trimmedName,
            description: description.trim(),
            manifestJson: manifest,
            instructionsMd,
            scriptTs: scriptTs.trim().length > 0 ? scriptTs : null,
          }),
        });
        if (res.status === 409) {
          setNameError("Name bereits vergeben");
          setBusy(false);
          return;
        }
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as {
            error?: string;
          };
          toast.error(body.error ?? `Fehler ${res.status}`);
          setBusy(false);
          return;
        }
        const created = (await res.json()) as SkillDetailPayload;
        toast.success("Skill gespeichert");
        onSuccess(created);
      } else if (skill) {
        const res = await fetch(
          `${RUNTIME_URL}/twins/${twinHandle}/skills/${skill.skillId}`,
          {
            method: "PATCH",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              description: description.trim(),
              manifestJson: manifest,
              instructionsMd,
              scriptTs: scriptTs.trim().length > 0 ? scriptTs : null,
            }),
          },
        );
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as {
            error?: string;
          };
          toast.error(body.error ?? `Fehler ${res.status}`);
          setBusy(false);
          return;
        }
        const updated = (await res.json()) as SkillDetailPayload;
        toast.success("Skill gespeichert");
        onSuccess(updated);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Speichern fehlgeschlagen");
      setBusy(false);
    }
  }

  async function handleDelete() {
    if (busy || !skill) return;
    setBusy(true);
    try {
      const res = await fetch(
        `${RUNTIME_URL}/twins/${twinHandle}/skills/${skill.skillId}`,
        { method: "DELETE", credentials: "include" },
      );
      if (!res.ok && res.status !== 204) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        toast.error(body.error ?? `Fehler ${res.status}`);
        setBusy(false);
        return;
      }
      toast.success("Skill gelöscht");
      onDelete?.(skill.skillId);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Löschen fehlgeschlagen");
      setBusy(false);
    }
  }

  function safeClose() {
    if (busy) return;
    onClose();
  }

  const title = mode === "create" ? "Skill anlegen" : "Skill bearbeiten";
  const submitLabel = mode === "create" ? "Anlegen" : "Speichern";

  return (
    <ModalWrapper onClose={safeClose} maxWidthClass="max-w-2xl">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="skill-modal-title"
        className="p-6 space-y-5"
      >
        <h2 id="skill-modal-title" className="text-lg font-semibold text-text">
          {title}
        </h2>

        <div className="space-y-1">
          <label
            htmlFor="skill-name"
            className="text-xs uppercase tracking-wider text-muted"
          >
            Name {mode === "edit" && <span className="ml-1">(nicht änderbar)</span>}
          </label>
          <input
            id="skill-name"
            type="text"
            value={name}
            onChange={(e) => handleNameChange(e.target.value)}
            disabled={mode === "edit" || busy}
            placeholder="z.B. bayreuth-booking"
            className={`w-full px-3 py-2 bg-bg border rounded text-sm font-mono text-text focus:outline-none disabled:opacity-50 ${
              nameError ? "border-warn" : "border-border focus:border-accent"
            }`}
          />
          {nameError && (
            <div className="text-xs text-warn">{nameError}</div>
          )}
        </div>

        <div className="space-y-1">
          <label
            htmlFor="skill-desc"
            className="text-xs uppercase tracking-wider text-muted"
          >
            Beschreibung
          </label>
          <input
            id="skill-desc"
            type="text"
            value={description}
            onChange={(e) => {
              setDescription(e.target.value);
              if (descriptionError) setDescriptionError(null);
            }}
            disabled={busy}
            placeholder="Kurze Zusammenfassung des Skills"
            className={`w-full px-3 py-2 bg-bg border rounded text-sm text-text focus:outline-none disabled:opacity-50 ${
              descriptionError ? "border-warn" : "border-border focus:border-accent"
            }`}
          />
          {descriptionError && (
            <div className="text-xs text-warn">{descriptionError}</div>
          )}
        </div>

        <div className="space-y-1">
          <label
            htmlFor="skill-manifest"
            className="text-xs uppercase tracking-wider text-muted"
          >
            Manifest (JSON)
          </label>
          <textarea
            id="skill-manifest"
            value={manifestText}
            onChange={(e) => setManifestText(e.target.value)}
            onBlur={() => validateManifestOnBlur()}
            disabled={busy}
            rows={8}
            spellCheck={false}
            className={`w-full px-3 py-2 bg-bg border rounded text-xs font-mono text-text focus:outline-none disabled:opacity-50 ${
              manifestError ? "border-warn" : "border-border focus:border-accent"
            }`}
          />
          {manifestError && (
            <div className="text-xs text-warn">{manifestError}</div>
          )}
          <div className="text-[10px] text-muted">
            Mindestens: <code>capability</code> + <code>requiresApproval</code>.
            Name und Beschreibung werden serverseitig aus den Feldern oben
            gespiegelt.
          </div>
        </div>

        <div className="space-y-1">
          <label
            htmlFor="skill-instr"
            className="text-xs uppercase tracking-wider text-muted"
          >
            Anweisungen (Markdown)
          </label>
          <textarea
            id="skill-instr"
            value={instructionsMd}
            onChange={(e) => {
              setInstructionsMd(e.target.value);
              if (instructionsError) setInstructionsError(null);
            }}
            disabled={busy}
            rows={12}
            spellCheck={false}
            placeholder={"# Skill-Name\n\nKontext + Anweisungen…"}
            className={`w-full px-3 py-2 bg-bg border rounded text-xs font-mono text-text focus:outline-none disabled:opacity-50 ${
              instructionsError ? "border-warn" : "border-border focus:border-accent"
            }`}
          />
          {instructionsError && (
            <div className="text-xs text-warn">{instructionsError}</div>
          )}
        </div>

        <div className="space-y-1">
          <label
            htmlFor="skill-script"
            className="text-xs uppercase tracking-wider text-muted"
          >
            Script (TypeScript, optional)
          </label>
          <textarea
            id="skill-script"
            value={scriptTs}
            onChange={(e) => setScriptTs(e.target.value)}
            disabled={busy}
            rows={6}
            spellCheck={false}
            placeholder="// optional, wird aktuell nicht ausgeführt"
            className="w-full px-3 py-2 bg-bg border border-border rounded text-xs font-mono text-text focus:outline-none focus:border-accent disabled:opacity-50"
          />
          <div className="text-[10px] text-muted">
            Wird aktuell nicht ausgeführt — Reserve für späteres Skill-Engine-
            Update.
          </div>
        </div>

        <div className="flex items-center justify-between gap-2 pt-2 border-t border-border">
          <div className="flex items-center gap-2">
            {mode === "edit" && !deleteStage && (
              <button
                type="button"
                onClick={() => setDeleteStage(true)}
                disabled={busy}
                className="px-3 py-2 text-xs border border-warn text-warn rounded hover:bg-warn hover:text-bg disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              >
                Löschen
              </button>
            )}
            {mode === "edit" && deleteStage && (
              <>
                <button
                  type="button"
                  onClick={() => void handleDelete()}
                  disabled={busy}
                  className="px-3 py-2 text-xs border border-warn bg-warn text-bg rounded hover:opacity-80 disabled:opacity-30 disabled:cursor-not-allowed transition-opacity"
                >
                  {busy ? "Lösche…" : "Endgültig löschen"}
                </button>
                <button
                  type="button"
                  onClick={() => setDeleteStage(false)}
                  disabled={busy}
                  className="px-3 py-2 text-xs text-muted hover:text-text transition-colors"
                >
                  Abbrechen
                </button>
              </>
            )}
          </div>
          {!deleteStage && (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={safeClose}
                disabled={busy}
                className="px-4 py-2 text-sm rounded border border-border text-muted hover:bg-surface hover:text-text disabled:opacity-50 transition-colors"
              >
                Abbrechen
              </button>
              <button
                type="button"
                onClick={() => void handleSubmit()}
                disabled={busy || manifestError !== null}
                className="px-4 py-2 text-sm border border-accent text-accent rounded hover:bg-accent hover:text-bg disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              >
                {busy ? "Speichere…" : submitLabel}
              </button>
            </div>
          )}
        </div>
      </div>
    </ModalWrapper>
  );
}
