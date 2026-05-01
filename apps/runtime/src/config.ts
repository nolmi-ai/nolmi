import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// ─── RUNTIME CONFIG ──────────────────────────────────────────────────────────
//
// Eine Quelle der Wahrheit für alle pfad- und port-bezogenen Settings. ENV
// hat Vorrang, Defaults liegen im Workspace-Root. Wer mehrere Twin-Instanzen
// parallel starten will (Markus + Florian lokal, später VPS), überschreibt
// hier per ENV — keine zwei Code-Pfade.

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
// src/ → apps/runtime → apps → twin-lab (Workspace-Root)
export const WORKSPACE_ROOT = resolve(__dirname, "../../..");

/**
 * Löst einen Pfad gegen den Workspace-Root auf.
 *   - Leerer/undefined ENV-Wert → relativer Default vom Workspace-Root
 *   - Absoluter ENV-Wert        → unverändert durchgereicht
 *   - Relativer ENV-Wert        → relativ zum Workspace-Root, NICHT zu cwd
 *
 * Letzteres ist wichtig, weil pnpm Scripte in unterschiedlichen cwds startet
 * (Root vs. Workspace-Dir). Workspace-relative Defaults sind stabil.
 */
export function resolveWorkspacePath(
  envValue: string | undefined,
  defaultRelative: string,
): string {
  const value = envValue?.trim();
  if (!value) return resolve(WORKSPACE_ROOT, defaultRelative);
  return isAbsolute(value) ? value : resolve(WORKSPACE_ROOT, value);
}

export interface RuntimeConfig {
  dbPath: string;
  personaPath: string;
  personaMetaPath: string;
  mandatesPath: string;
  /** Verzeichnis mit allen SQL-Migrationen (`NNN_name.sql`, numerisch sortiert). */
  migrationsDir: string;
  port: number;
  host: string;
  /**
   * Welcher Twin aus `twin_profiles` beim Boot geladen wird. Default `@markus`
   * matched die existierende Bootstrap-Row. Phase 2.5 = ein Twin pro Prozess;
   * Multi-Twin pro Runtime kommt später.
   */
  twinHandle: string;
}

export function loadRuntimeConfig(): RuntimeConfig {
  return {
    dbPath: resolveWorkspacePath(process.env.TWIN_DATABASE_PATH, "data/twin.db"),
    personaPath: resolveWorkspacePath(process.env.PERSONA_PATH, "docs/persona.md"),
    personaMetaPath: resolveWorkspacePath(
      process.env.PERSONA_META_PATH,
      "docs/persona-meta.yaml",
    ),
    mandatesPath: resolveWorkspacePath(process.env.MANDATES_PATH, "docs/mandates.yaml"),
    migrationsDir: resolve(WORKSPACE_ROOT, "apps/runtime/migrations"),
    port: parsePort(process.env.RUNTIME_PORT, 4000),
    host: process.env.RUNTIME_HOST?.trim() || "127.0.0.1",
    twinHandle: process.env.TWIN_HANDLE?.trim() || "@markus",
  };
}

function parsePort(raw: string | undefined, fallback: number): number {
  const trimmed = raw?.trim();
  if (!trimmed) return fallback;
  const parsed = Number(trimmed);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    throw new Error(
      `RUNTIME_PORT muss eine Integer-Portnummer zwischen 1 und 65535 sein (got: "${raw}")`,
    );
  }
  return parsed;
}
