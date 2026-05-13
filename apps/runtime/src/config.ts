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

// ─── CONVERSATION-MEMORY TUNABLES (Phase 3.3) ────────────────────────────────
//
// Drei Schwellwerte für die Sliding-Window-Auto-Summary-Engine. Defaults sind
// das Ergebnis der Strategie-Session: Trigger bei >50 Messages, Summary der
// ältesten 40, Live-Window von 10. ENV-Überschreibung pro Twin-Instanz für
// Tuning ohne Code-Change. In 3.3.A nur registriert — die Werte werden in
// 3.3.B (Summary-Engine) und 3.3.C (History-Loader) genutzt.

/**
 * Trigger-Schwelle für Auto-Summary: wenn eine Konversation mehr Messages
 * als diesen Wert akkumuliert, fasst der Twin das ältere Segment zusammen.
 * Default 50 entspricht ~25 User-Twin-Turns.
 */
export const CONVERSATION_SUMMARY_THRESHOLD = parseIntEnv(
  process.env.CONVERSATION_SUMMARY_THRESHOLD,
  50,
  "CONVERSATION_SUMMARY_THRESHOLD",
);

/**
 * Wie viele der ältesten Messages werden in einer Summary verdichtet. Bei
 * 100 Messages und Default-40 entstehen 2 Summaries + verbleibende 20 als
 * Live-Window (10 davon nach Default-LIVE_WINDOW, 10 als Buffer).
 */
export const CONVERSATION_SUMMARY_BATCH_SIZE = parseIntEnv(
  process.env.CONVERSATION_SUMMARY_BATCH_SIZE,
  40,
  "CONVERSATION_SUMMARY_BATCH_SIZE",
);

/**
 * Anzahl der jüngsten Messages, die verbatim am Ende des LLM-Kontexts
 * bleiben (kein Summary-Replacement). Garantiert, dass der unmittelbare
 * Gesprächs-Kontext nie verdichtet wird.
 */
export const CONVERSATION_LIVE_WINDOW = parseIntEnv(
  process.env.CONVERSATION_LIVE_WINDOW,
  10,
  "CONVERSATION_LIVE_WINDOW",
);

// ─── EPISODIC-MEMORY TUNABLES (Phase 3.4) ────────────────────────────────────
//
// Drei Schwellwerte für den Vector-Search-Layer im Send-Path. Defaults aus
// 3.4-STRATEGY.md "Entscheidung 3 — Retrieval-Strategie": Top-3 Hits über
// Similarity 0.7. Min-Query-Length filtert Trivial-Sends ("hi") bevor wir
// den Provider bemühen.

/**
 * Anzahl der Top-Hits, die als "Erinnerungen"-Schicht in den System-Prompt
 * fließen. Default 3 — schmal genug, dass die Aufmerksamkeit beim aktuellen
 * Gespräch bleibt.
 */
export const EPISODIC_TOP_K = parseIntEnv(
  process.env.EPISODIC_TOP_K,
  3,
  "EPISODIC_TOP_K",
);

/**
 * Cosine-Similarity-Schwelle (0..1). Treffer darunter werden gefiltert. Bei
 * L2-Distanz auf normalisierten Vektoren: similarity = 1 - distance/2.
 * 0.7 ist ein konservativer Default — bei zu geringer Trefferquote in der
 * Realität herunterschrauben.
 */
export const EPISODIC_SIMILARITY_THRESHOLD = parseFloatEnv(
  process.env.EPISODIC_SIMILARITY_THRESHOLD,
  0.7,
  "EPISODIC_SIMILARITY_THRESHOLD",
);

/**
 * Minimale User-Message-Länge (Zeichen, getrimmt), damit Retrieval ausgelöst
 * wird. "hi", "ok", "ja" landen unter dem Schwellwert und sparen einen
 * Embedding-Call. Default 10.
 */
export const EPISODIC_MIN_QUERY_LENGTH = parseIntEnv(
  process.env.EPISODIC_MIN_QUERY_LENGTH,
  10,
  "EPISODIC_MIN_QUERY_LENGTH",
);

/**
 * Parser für nicht-negative Integer-ENVs. Gleiche Fehlerstrenge wie
 * parsePort: ungültige Werte wirfen, keine stille Default-Verwendung — sonst
 * läuft Production mit falscher Konfiguration und niemand merkt's.
 */
function parseIntEnv(raw: string | undefined, fallback: number, name: string): number {
  const trimmed = raw?.trim();
  if (!trimmed) return fallback;
  const parsed = Number(trimmed);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(
      `${name} muss eine positive Integer-Zahl sein (got: "${raw}")`,
    );
  }
  return parsed;
}

/**
 * Analog parseIntEnv für Float-ENVs (z.B. Similarity-Threshold). Wirft bei
 * NaN oder negativen Werten.
 */
function parseFloatEnv(
  raw: string | undefined,
  fallback: number,
  name: string,
): number {
  const trimmed = raw?.trim();
  if (!trimmed) return fallback;
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(
      `${name} muss eine nicht-negative Zahl sein (got: "${raw}")`,
    );
  }
  return parsed;
}
