import { resolve } from "node:path";
import type { PresetActivationResult } from "@twin-lab/shared";
import { importSkillFromDir, SkillImportError } from "./import-from-dir.js";
import { scanExamplesPresets } from "./scan-examples-presets.js";
import type { SkillRepo } from "./repo.js";

// ─── PRESET-ACTIVATION (#110 Phase 2B) ───────────────────────────────────────
//
// Aktiviert User-gewählte Presets für einen neu angelegten Twin. Heute nur
// Skill-only: importiert das Pattern-Skill via `importSkillFromDir`. Echtes
// MCP-Server-Provisioning (mit User-API-Keys) ist #122 — Card-Hint im
// Wizard informiert den User dass solche Skills ohne MCP-Server nicht
// Tool-Forcen können.
//
// Soft-Failure-Pattern: pro Preset ein Try/Catch, Failures landen im
// Result-Array, Twin bleibt angelegt. Der Submit-Handler returnt die
// Resultate im 201-Response — Frontend kann pro Preset zeigen ob's
// geklappt hat.
//
// Whitelist gegen Scan-Output: die User-übergebenen Preset-IDs werden
// gegen `scanExamplesPresets()` validiert. Single-Source-of-Truth ist das
// File-System, kein hardcoded Enum. Path-Traversal-Versuche (`..`, `/`)
// scheitern automatisch, weil sie keinen passenden Folder-Namen treffen.

interface FastifyLikeLogger {
  warn: (obj: Record<string, unknown>, msg?: string) => void;
  info?: (obj: Record<string, unknown>, msg?: string) => void;
}

export interface ActivatePresetsOptions {
  presetIds: readonly string[];
  twinId: string;
  examplesDir: string;
  skillRepo: SkillRepo;
  logger: FastifyLikeLogger;
}

export async function activatePresets(
  opts: ActivatePresetsOptions,
): Promise<PresetActivationResult[]> {
  const { presetIds, twinId, examplesDir, skillRepo, logger } = opts;

  if (presetIds.length === 0) return [];

  // Whitelist: die zur Submit-Zeit verfügbaren Presets. Scan ist billig
  // (< 100ms für die Handvoll Folders heute).
  const available = scanExamplesPresets(examplesDir, {
    warn: (msg, meta) => logger.warn(meta ?? {}, msg),
  });
  const availableIds = new Set(available.map((p) => p.id));

  const results: PresetActivationResult[] = [];

  for (const presetId of presetIds) {
    if (!availableIds.has(presetId)) {
      logger.warn(
        { twinId, presetId },
        "[preset-activate] unknown preset-id, skip",
      );
      results.push({ id: presetId, status: "unknown" });
      continue;
    }

    const skillDir = resolve(examplesDir, presetId);
    try {
      importSkillFromDir({
        skillRepo,
        twinId,
        skillDir,
        force: true,
        source: "example",
      });
      results.push({ id: presetId, status: "imported" });
    } catch (err) {
      const reason =
        err instanceof SkillImportError
          ? err.message
          : err instanceof Error
            ? err.message
            : String(err);
      logger.warn(
        { twinId, presetId, err: reason },
        "[preset-activate] failed",
      );
      results.push({ id: presetId, status: "failed", reason });
    }
  }

  return results;
}
