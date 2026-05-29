"use client";

import { useEffect, useMemo, useState } from "react";
import type {
  McpServerCreateRequest,
  McpServerUiPayload,
} from "@nolmi/shared";
import { ModalWrapper } from "./ModalWrapper";
import { toast } from "../lib/toast";

// ─── McpServerAddModal (#87) ─────────────────────────────────────────────────
//
// Add-Only-Modal für MCP-Server. Edit ist Anti-Goal (zu komplex: Re-
// Encryption + Skill-Resync), Toggle und Delete leben in der Liste.
//
// Linear-Flow:
//   1. User pastet JSON-Spec ins Textarea (analog CLI mcp-servers/<name>.json)
//   2. On-Blur: JSON parsen + Schema-Check, env-Marker "?" extrahieren
//   3. Falls Marker da: Inline-ENV-Form klappt unter dem Textarea auf
//      (password-Inputs, einer pro Marker-Key)
//   4. Submit: aufgelöste env-Werte einsetzen → POST → Toast mit Skill-Count
//
// Sicherheit:
//   - env-Werte sind type="password" (UI verdeckt, Backend AES-256-GCM)
//   - Master-Key bleibt server-only — Frontend sieht nie etwas Encryptedes
//   - Backend lehnt "?"-Werte ab (Refinement in Shared-Schema)

const RUNTIME_URL =
  process.env.NEXT_PUBLIC_RUNTIME_URL ?? "http://localhost:4000";

const SPEC_PLACEHOLDER = `{
  "name": "calendar-mcp",
  "transport": "stdio",
  "command": "npx",
  "args": ["-y", "@modelcontextprotocol/server-calendar"],
  "env": {
    "GOOGLE_API_KEY": "?"
  },
  "defaultRequiresApproval": true
}`;

export interface McpServerAddModalProps {
  open: boolean;
  twinHandle: string;
  onClose: () => void;
  /** Wird mit dem persistierten Server + Sync-Counts aufgerufen. */
  onSuccess: (
    server: McpServerUiPayload & {
      syncedSkills: number;
      skippedSkills: number;
    },
  ) => void;
}

interface ParsedSpec {
  parsed: McpServerCreateRequest;
  envMarkers: string[];
}

export function McpServerAddModal({
  open,
  twinHandle,
  onClose,
  onSuccess,
}: McpServerAddModalProps) {
  const [specText, setSpecText] = useState(SPEC_PLACEHOLDER);
  const [parsedSpec, setParsedSpec] = useState<ParsedSpec | null>(null);
  const [specError, setSpecError] = useState<string | null>(null);
  const [envValues, setEnvValues] = useState<Record<string, string>>({});
  const [envErrors, setEnvErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  // Reset beim Open.
  useEffect(() => {
    if (!open) return;
    setSpecText(SPEC_PLACEHOLDER);
    setParsedSpec(null);
    setSpecError(null);
    setEnvValues({});
    setEnvErrors({});
    setBusy(false);
  }, [open]);

  function parseSpec(text: string): ParsedSpec | null {
    if (text.trim().length === 0) {
      setSpecError("Spec darf nicht leer sein");
      return null;
    }
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch (err) {
      setSpecError(
        `Ungültiges JSON: ${err instanceof Error ? err.message : "Parse-Fehler"}`,
      );
      return null;
    }
    if (!raw || typeof raw !== "object") {
      setSpecError("Spec muss ein JSON-Objekt sein");
      return null;
    }
    const obj = raw as Partial<McpServerCreateRequest>;
    if (typeof obj.name !== "string" || obj.name.length === 0) {
      setSpecError('Spec braucht ein "name" (String)');
      return null;
    }
    if (obj.transport !== "stdio" && obj.transport !== "http") {
      setSpecError('Spec braucht "transport" ("stdio" oder "http")');
      return null;
    }
    if (obj.transport === "stdio" && typeof obj.command !== "string") {
      setSpecError('stdio-Transport braucht "command" (String)');
      return null;
    }
    if (obj.transport === "http" && typeof obj.url !== "string") {
      setSpecError('http-Transport braucht "url" (String)');
      return null;
    }
    // env-Marker extrahieren — Frontend muss "?" durch User-Input ersetzen,
    // Backend lehnt sonst ab (Shared-Schema-Refinement).
    const envMarkers: string[] = [];
    if (obj.env && typeof obj.env === "object") {
      for (const [key, value] of Object.entries(obj.env)) {
        if (value === "?") envMarkers.push(key);
      }
    }
    setSpecError(null);
    return {
      parsed: obj as McpServerCreateRequest,
      envMarkers,
    };
  }

  function handleSpecBlur() {
    const result = parseSpec(specText);
    if (result) {
      setParsedSpec(result);
      // Nur Werte für Marker resetten, die wirklich neu sind.
      setEnvValues((curr) => {
        const next: Record<string, string> = {};
        for (const key of result.envMarkers) {
          next[key] = curr[key] ?? "";
        }
        return next;
      });
      setEnvErrors({});
    } else {
      setParsedSpec(null);
    }
  }

  const resolvedEnv = useMemo<Record<string, string> | null>(() => {
    if (!parsedSpec) return null;
    if (!parsedSpec.parsed.env) return null;
    const out: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsedSpec.parsed.env)) {
      out[key] = value === "?" ? (envValues[key] ?? "") : value;
    }
    return out;
  }, [parsedSpec, envValues]);

  const canSubmit =
    parsedSpec !== null &&
    specError === null &&
    parsedSpec.envMarkers.every((k) => (envValues[k] ?? "").length > 0);

  async function handleSubmit() {
    if (busy) return;
    // On-Submit nochmal parsen — falls User direkt aus dem Textarea ohne Blur
    // submitted.
    const result = parseSpec(specText);
    if (!result) {
      setParsedSpec(null);
      return;
    }
    setParsedSpec(result);

    // ENV-Required-Check inline anzeigen statt Toast (konsistent zu #86).
    const missing: Record<string, string> = {};
    for (const key of result.envMarkers) {
      if ((envValues[key] ?? "").length === 0) {
        missing[key] = "Wert erforderlich";
      }
    }
    if (Object.keys(missing).length > 0) {
      setEnvErrors(missing);
      return;
    }
    setEnvErrors({});

    setBusy(true);
    try {
      // env wieder zusammensetzen: User-Werte für Marker, Original-Werte
      // für non-Marker-Keys.
      const finalEnv = result.parsed.env
        ? Object.fromEntries(
            Object.entries(result.parsed.env).map(([k, v]) => [
              k,
              v === "?" ? (envValues[k] ?? "") : v,
            ]),
          )
        : null;

      const res = await fetch(
        `${RUNTIME_URL}/twins/${twinHandle}/mcp-servers`,
        {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...result.parsed,
            env: finalEnv,
          }),
        },
      );

      if (res.status === 409) {
        setSpecError(`Name "${result.parsed.name}" bereits vergeben`);
        setBusy(false);
        return;
      }
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          error?: string;
          detail?: string;
        };
        if (body.error === "mcp_server_spawn_failed") {
          toast.error(
            `Spawn fehlgeschlagen: ${body.detail ?? "unbekannter Fehler"}`,
          );
        } else {
          toast.error(body.error ?? `Fehler ${res.status}`);
        }
        setBusy(false);
        return;
      }
      const server = (await res.json()) as McpServerUiPayload & {
        syncedSkills: number;
        skippedSkills: number;
      };
      toast.success(
        `MCP-Server hinzugefügt — ${server.syncedSkills} Skills synchronisiert`,
      );
      onSuccess(server);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Add fehlgeschlagen",
      );
      setBusy(false);
    }
  }

  function safeClose() {
    if (busy) return;
    onClose();
  }

  if (!open) return null;

  return (
    <ModalWrapper onClose={safeClose} maxWidthClass="max-w-2xl">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="mcp-add-title"
        className="p-6 space-y-5"
      >
        <h2 id="mcp-add-title" className="text-lg font-semibold text-text">
          MCP-Server hinzufügen
        </h2>

        <div className="space-y-1">
          <label
            htmlFor="mcp-spec"
            className="text-xs uppercase tracking-wider text-muted"
          >
            JSON-Spezifikation
          </label>
          <textarea
            id="mcp-spec"
            value={specText}
            onChange={(e) => {
              setSpecText(e.target.value);
              if (specError) setSpecError(null);
            }}
            onBlur={handleSpecBlur}
            disabled={busy}
            rows={14}
            spellCheck={false}
            className={`w-full px-3 py-2 bg-bg border rounded text-xs font-mono text-text focus:outline-none disabled:opacity-50 ${
              specError ? "border-warn" : "border-border focus:border-accent"
            }`}
          />
          {specError && (
            <div className="text-xs text-warn">{specError}</div>
          )}
          <div className="text-[10px] text-muted">
            Spec wird beim Klick außerhalb des Felds geparst. Geheime Werte
            mit dem Marker <code>&quot;?&quot;</code> versehen — sie werden
            unten verdeckt abgefragt.
          </div>
        </div>

        {parsedSpec && parsedSpec.envMarkers.length > 0 && (
          <div className="space-y-3 border-t border-border pt-4">
            <div className="text-xs uppercase tracking-wider text-muted">
              Geheime Werte für diesen Server
            </div>
            {parsedSpec.envMarkers.map((key) => {
              const error = envErrors[key];
              return (
                <div key={key} className="space-y-1">
                  <label
                    htmlFor={`mcp-env-${key}`}
                    className="text-xs font-mono text-text"
                  >
                    {key}
                  </label>
                  <input
                    id={`mcp-env-${key}`}
                    type="password"
                    value={envValues[key] ?? ""}
                    onChange={(e) => {
                      setEnvValues((curr) => ({
                        ...curr,
                        [key]: e.target.value,
                      }));
                      if (envErrors[key]) {
                        setEnvErrors((curr) => {
                          const next = { ...curr };
                          delete next[key];
                          return next;
                        });
                      }
                    }}
                    disabled={busy}
                    autoComplete="off"
                    placeholder="••••••••"
                    className={`w-full px-3 py-2 bg-bg border rounded text-sm font-mono text-text focus:outline-none disabled:opacity-50 ${
                      error ? "border-warn" : "border-border focus:border-accent"
                    }`}
                  />
                  {error && (
                    <div className="text-xs text-warn">{error}</div>
                  )}
                </div>
              );
            })}
            <div className="text-[10px] text-muted">
              Werte werden serverseitig mit dem Master-Key verschlüsselt und
              nie im Klartext zurückgegeben.
            </div>
          </div>
        )}

        <div className="flex items-center justify-end gap-2 pt-2 border-t border-border">
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
            disabled={busy || !canSubmit}
            className="px-4 py-2 text-sm border border-accent text-accent rounded hover:bg-accent hover:text-bg disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            {busy ? "Spawne + synchronisiere…" : "Hinzufügen"}
          </button>
        </div>
      </div>
    </ModalWrapper>
  );
}
