"use client";

import { useCallback, useEffect, useState } from "react";
import type { TwinToolListItem } from "@nolmi/shared";

const RUNTIME_URL = process.env.NEXT_PUBLIC_RUNTIME_URL ?? "http://localhost:4000";

// ─── TOOL PICKER (3.2.H) ─────────────────────────────────────────────────────
//
// Plus-Button im Chat-Input öffnet ein zwei-stufiges Modal:
//   Stage 1: Liste aller aktiven MCP-Tools des Twins.
//   Stage 2: Auto-generated Args-Form (typisierte Inputs aus dem JSON-Schema)
//            und Senden-Button.
//
// Senden ruft `onSend(toolName, args)`. Der Caller (DirectChat) baut daraus
// die User-Message + forcedToolChoice und schiebt sie durch /chat. Backend
// erzwingt damit den Tool-Call (kein LLM-Ermessen mehr) — strukturelle
// Lösung für Item #89.
//
// Was bewusst NICHT hier passiert: Approval-Workflow, Tool-Result-Render,
// Auto-Detection von Tool-Use-Pattern. Picker ist nur die UI-Brücke;
// Approval-Pfad greift transparent über den existierenden Marker-Mechanismus
// aus 3.2.F/G.

interface ToolPickerProps {
  handle: string;
  /** SS4b-1: controlled — der eigene +-Trigger entfällt; ComposerMenu öffnet das
   *  Modal über `open`/`onOpenChange`. Modal-Stages (Stage1/Stage2) unverändert. */
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSend: (toolName: string, args: Record<string, unknown>) => void | Promise<void>;
}

export function ToolPicker({ handle, open, onOpenChange, onSend }: ToolPickerProps) {
  const [tools, setTools] = useState<TwinToolListItem[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<TwinToolListItem | null>(null);

  const loadTools = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${RUNTIME_URL}/twins/${handle}/tools`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as { tools: TwinToolListItem[] };
      setTools(body.tools);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Tools konnten nicht geladen werden");
    } finally {
      setLoading(false);
    }
  }, [handle]);

  // Lazy-Load beim ersten Open. Spätere Re-Opens nutzen den Cache — neue
  // MCP-Tools tauchen nach `pnpm twin:mcp-refresh` + Modal-Reset auf, ein
  // Auto-Refresh hier wäre Polish-Item (Briefing: bewusst nicht).
  useEffect(() => {
    if (!open || tools !== null || loading) return;
    void loadTools();
  }, [open, tools, loading, loadTools]);

  function close() {
    onOpenChange(false);
    setSelected(null);
  }

  async function handleSubmit(args: Record<string, unknown>) {
    if (!selected) return;
    // Modal sofort schließen — der Send-Loading-State lebt im Parent (busy
    // + optimisticUser); ein noch sichtbares Modal würde überlappen.
    close();
    await onSend(selected.toolName, args);
  }

  // SS4b-1: kein eigener Trigger mehr — nur das Modal (controlled via `open`).
  if (!open) return null;

  return (
    <>
      {open && (
        <div
          // Backdrop schließt das Modal — Standard-Konvention.
          onClick={close}
          className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="bg-surface border border-border rounded shadow-xl max-w-lg w-full max-h-[80vh] flex flex-col"
          >
            {selected ? (
              <ToolArgsStage
                tool={selected}
                onBack={() => setSelected(null)}
                onSubmit={handleSubmit}
                onCancel={close}
              />
            ) : (
              <ToolListStage
                tools={tools}
                loading={loading}
                error={error}
                onSelect={setSelected}
                onClose={close}
                onReload={loadTools}
              />
            )}
          </div>
        </div>
      )}
    </>
  );
}

// ─── Stage 1: Tool-Liste ────────────────────────────────────────────────────

function ToolListStage({
  tools,
  loading,
  error,
  onSelect,
  onClose,
  onReload,
}: {
  tools: TwinToolListItem[] | null;
  loading: boolean;
  error: string | null;
  onSelect: (tool: TwinToolListItem) => void;
  onClose: () => void;
  onReload: () => void;
}) {
  return (
    <>
      <div className="px-4 py-3 border-b border-border flex items-center justify-between flex-shrink-0">
        <div className="text-sm text-text font-medium">Tool aufrufen</div>
        <button
          onClick={onClose}
          className="text-muted hover:text-text text-sm"
          aria-label="Schließen"
        >
          ✕
        </button>
      </div>
      <div className="flex-1 overflow-y-auto px-4 py-3">
        {loading && <div className="text-xs text-muted">lade Tools…</div>}
        {error && (
          <div className="text-xs text-warn space-y-2">
            <div>{error}</div>
            <button
              onClick={onReload}
              className="px-2 py-1 border border-warn text-warn rounded hover:bg-warn hover:text-bg transition-colors"
            >
              erneut versuchen
            </button>
          </div>
        )}
        {!loading && !error && tools !== null && tools.length === 0 && (
          <div className="text-xs text-muted">
            Keine aktiven MCP-Tools für diesen Twin. MCP-Server hinzufügen über{" "}
            <code className="font-mono">pnpm twin:mcp-add</code>.
          </div>
        )}
        {!loading && !error && tools !== null && tools.length > 0 && (
          <ToolSections tools={tools} onSelect={onSelect} />
        )}
      </div>
    </>
  );
}

// ─── Tool-Sections (gruppiert nach serverName) ───────────────────────────────
//
// Jeder Server bekommt eine eigene Section mit Header (Server-Name +
// Tool-Count + ggf. Approval-Badge) und der Tool-Liste darunter. Macht beim
// Pilot-Setup mit zwei everything-Servern sofort sichtbar, welcher Approval
// braucht und welcher nicht — ohne dass der User pro Tool den 🔒-Marker
// einzeln scannen muss. Backend liefert die Tools schon stabil sortiert
// (server-Name, dann skill-Name); Reduce mit Insertion-Order erhält die
// Sortierung.
function ToolSections({
  tools,
  onSelect,
}: {
  tools: TwinToolListItem[];
  onSelect: (tool: TwinToolListItem) => void;
}) {
  const grouped = new Map<string, TwinToolListItem[]>();
  for (const t of tools) {
    const list = grouped.get(t.serverName);
    if (list) list.push(t);
    else grouped.set(t.serverName, [t]);
  }

  const sections = Array.from(grouped.entries());

  return (
    <div className="space-y-4">
      {sections.map(([serverName, serverTools], idx) => {
        const allApproval = serverTools.every((t) => t.requiresApproval);
        return (
          <section
            key={serverName}
            // Border-Top nur ab der zweiten Section — visuelle Trennung
            // zwischen Server-Gruppen ohne Doppellinie oben am Container.
            className={idx > 0 ? "pt-3 border-t border-border" : undefined}
          >
            <div className="flex items-center gap-2 pb-2">
              <span className="text-xs font-medium text-muted uppercase tracking-wider">
                {serverName}
              </span>
              {allApproval && (
                <span
                  className="text-[10px] px-1.5 py-0.5 rounded border border-warn/40 text-warn uppercase tracking-wider"
                  title="Alle Tools dieses Servers brauchen Approval"
                >
                  🔒 Approval
                </span>
              )}
              <span className="ml-auto text-[10px] text-muted normal-case tracking-normal">
                {serverTools.length} Tool{serverTools.length === 1 ? "" : "s"}
              </span>
            </div>
            <ul className="space-y-1">
              {serverTools.map((tool) => (
                <li key={tool.skillId}>
                  <button
                    onClick={() => onSelect(tool)}
                    className="w-full text-left px-3 py-2 border border-border rounded hover:border-accent hover:bg-bg transition-colors"
                  >
                    <div className="flex items-start gap-2">
                      <div className="flex-1 space-y-0.5 min-w-0">
                        <div className="text-sm font-mono text-text truncate">
                          {/* mcp:server:tool → server:tool für Lesbarkeit. */}
                          {tool.skillName.replace(/^mcp:/, "")}
                        </div>
                        {tool.description && (
                          <div className="text-xs text-muted line-clamp-2">
                            {tool.description}
                          </div>
                        )}
                      </div>
                      {tool.requiresApproval && (
                        <span
                          className="text-warn text-sm flex-shrink-0 mt-0.5"
                          title="Approval erforderlich"
                          aria-label="Approval erforderlich"
                        >
                          🔒
                        </span>
                      )}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

// ─── Stage 2: Args-Form ─────────────────────────────────────────────────────

interface JsonSchemaProperty {
  type?: string | string[];
  description?: string;
  default?: unknown;
  enum?: unknown[];
}

interface JsonSchemaObject {
  type?: string;
  properties?: Record<string, JsonSchemaProperty>;
  required?: string[];
}

function ToolArgsStage({
  tool,
  onBack,
  onSubmit,
  onCancel,
}: {
  tool: TwinToolListItem;
  onBack: () => void;
  onSubmit: (args: Record<string, unknown>) => void | Promise<void>;
  onCancel: () => void;
}) {
  const schema = (tool.inputSchema ?? {}) as JsonSchemaObject;
  const properties = schema.properties ?? {};
  const required = new Set(schema.required ?? []);
  const propertyNames = Object.keys(properties);

  // String-State pro Field — wir parsen erst beim Submit. Zahl-Felder werden
  // dann geparsed, JSON-Fallback-Felder via JSON.parse validiert.
  const [values, setValues] = useState<Record<string, string>>({});
  const [bools, setBools] = useState<Record<string, boolean>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);

  const updateString = (name: string, v: string) =>
    setValues((prev) => ({ ...prev, [name]: v }));
  const updateBool = (name: string, v: boolean) =>
    setBools((prev) => ({ ...prev, [name]: v }));

  async function handleSubmit() {
    const newErrors: Record<string, string> = {};
    const args: Record<string, unknown> = {};

    for (const [name, prop] of Object.entries(properties)) {
      const type = normalizeType(prop.type);
      const isRequired = required.has(name);
      if (type === "boolean") {
        // Boolean: immer mitgeben (Checkbox = explizit true/false). Kein
        // Required-Concept für Booleans, weil "fehlt" hier kein Konzept ist.
        args[name] = bools[name] ?? false;
        continue;
      }
      const raw = values[name] ?? "";
      if (raw === "") {
        if (isRequired) {
          newErrors[name] = "Pflichtfeld";
        }
        continue;
      }
      if (type === "number" || type === "integer") {
        const num = type === "integer" ? parseInt(raw, 10) : parseFloat(raw);
        if (Number.isNaN(num)) {
          newErrors[name] = "Bitte eine Zahl eingeben";
          continue;
        }
        args[name] = num;
        continue;
      }
      if (type === "string") {
        args[name] = raw;
        continue;
      }
      // Fallback: object/array/unknown → JSON-Parse.
      try {
        args[name] = JSON.parse(raw);
      } catch {
        newErrors[name] = "Ungültiges JSON";
      }
    }

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }
    setErrors({});
    setSubmitting(true);
    try {
      await onSubmit(args);
    } finally {
      // Modal schließt sich aus dem Parent, aber falls onSubmit synchron
      // returnt ohne zu schließen, geben wir den State frei.
      setSubmitting(false);
    }
  }

  return (
    <>
      <div className="px-4 py-3 border-b border-border flex items-center justify-between flex-shrink-0">
        <div className="text-sm text-text font-medium">
          {tool.skillName.replace(/^mcp:/, "")}
        </div>
        <button
          onClick={onCancel}
          className="text-muted hover:text-text text-sm"
          aria-label="Schließen"
        >
          ✕
        </button>
      </div>
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
        {tool.description && (
          <div className="text-xs text-muted">{tool.description}</div>
        )}
        {tool.requiresApproval && (
          <div className="text-[10px] uppercase tracking-wider text-warn">
            Approval erforderlich — Tool-Call landet als Pending in der Inbox
          </div>
        )}
        {propertyNames.length === 0 ? (
          <div className="text-xs text-muted italic">
            Dieses Tool benötigt keine Argumente.
          </div>
        ) : (
          propertyNames.map((name) => {
            const prop = properties[name];
            if (!prop) return null;
            const type = normalizeType(prop.type);
            const isRequired = required.has(name);
            const fieldError = errors[name];
            return (
              <div key={name} className="space-y-1">
                <label className="text-xs text-text flex items-center gap-1">
                  <span className="font-mono">{name}</span>
                  {isRequired && <span className="text-warn">*</span>}
                  <span className="text-muted normal-case">({type})</span>
                </label>
                {prop.description && (
                  <div className="text-[10px] text-muted">{prop.description}</div>
                )}
                {renderField({
                  type,
                  prop,
                  stringValue: values[name] ?? "",
                  boolValue: bools[name] ?? false,
                  onString: (v) => updateString(name, v),
                  onBool: (v) => updateBool(name, v),
                })}
                {fieldError && (
                  <div className="text-[10px] text-warn">{fieldError}</div>
                )}
              </div>
            );
          })
        )}
      </div>
      <div className="px-4 py-3 border-t border-border flex items-center justify-between flex-shrink-0 gap-2">
        <button
          onClick={onBack}
          disabled={submitting}
          className="px-3 py-1.5 text-xs border border-border text-muted rounded hover:text-text hover:border-text disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
        >
          ← Zurück
        </button>
        <button
          onClick={handleSubmit}
          disabled={submitting}
          className="px-4 py-1.5 text-xs border border-accent text-accent rounded hover:bg-accent hover:text-bg disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
        >
          Senden
        </button>
      </div>
    </>
  );
}

function renderField({
  type,
  prop,
  stringValue,
  boolValue,
  onString,
  onBool,
}: {
  type: string;
  prop: JsonSchemaProperty;
  stringValue: string;
  boolValue: boolean;
  onString: (v: string) => void;
  onBool: (v: boolean) => void;
}) {
  const baseInput =
    "w-full bg-bg border border-border rounded px-2 py-1.5 text-sm text-text font-mono focus:outline-none focus:border-accent";

  if (type === "boolean") {
    return (
      <label className="flex items-center gap-2 text-sm text-text cursor-pointer">
        <input
          type="checkbox"
          checked={boolValue}
          onChange={(e) => onBool(e.target.checked)}
          className="cursor-pointer"
        />
        <span>{boolValue ? "true" : "false"}</span>
      </label>
    );
  }
  if (type === "integer") {
    return (
      <input
        type="number"
        step={1}
        value={stringValue}
        onChange={(e) => onString(e.target.value)}
        placeholder={defaultPlaceholder(prop)}
        className={baseInput}
      />
    );
  }
  if (type === "number") {
    return (
      <input
        type="number"
        step="any"
        value={stringValue}
        onChange={(e) => onString(e.target.value)}
        placeholder={defaultPlaceholder(prop)}
        className={baseInput}
      />
    );
  }
  if (type === "string") {
    return (
      <input
        type="text"
        value={stringValue}
        onChange={(e) => onString(e.target.value)}
        placeholder={defaultPlaceholder(prop)}
        className={baseInput}
      />
    );
  }
  // Fallback für object/array/unknown — Briefing: JSON-Editor mit Validation
  // beim Submit. Pilot-Tools haben flat Schemas, aber wir wollen nicht
  // crashen, wenn ein neues Tool nested kommt.
  return (
    <textarea
      value={stringValue}
      onChange={(e) => onString(e.target.value)}
      placeholder={`JSON value (${type})`}
      rows={3}
      className={`${baseInput} resize-y`}
    />
  );
}

function normalizeType(rawType: string | string[] | undefined): string {
  if (!rawType) return "string";
  if (Array.isArray(rawType)) {
    // JSON-Schema lässt Type-Arrays zu (z.B. ["string", "null"]). Wir nehmen
    // den ersten Nicht-null-Type — reicht für Pilot-Tools.
    return rawType.find((t) => t !== "null") ?? "string";
  }
  return rawType;
}

function defaultPlaceholder(prop: JsonSchemaProperty): string {
  if (prop.default !== undefined) return `Standard: ${String(prop.default)}`;
  if (prop.enum && prop.enum.length > 0) {
    return `eines von: ${prop.enum.map((e) => String(e)).join(", ")}`;
  }
  return "";
}
