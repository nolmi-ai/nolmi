import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type {
  PresetActivationResult,
  PresetSelection,
} from "@nolmi/shared";
import { importSkillFromDir, SkillImportError } from "./import-from-dir.js";
import { scanExamplesPresets } from "./scan-examples-presets.js";
import type { SkillRepo } from "./repo.js";
import {
  McpServerAlreadyExistsError,
  McpServerNotFoundError,
  McpServerValidationError,
  type McpServersRepo,
} from "../mcp/repo.js";
import type { TwinServiceRegistry } from "../twin-service-registry.js";
import { McpServerSpecSchema } from "../scripts/_mcp-cli-helpers.js";

// ─── PRESET-ACTIVATION (#110 Phase 2B + #122) ───────────────────────────────
//
// Aktiviert User-gewählte Presets für einen neu angelegten Twin. Pro Preset:
//   1. Skill-Import via `importSkillFromDir`.
//   2. Auto-Provisioning der `requiresMcpServers` per Template-Substitution
//      (#122): `mcp-servers/<name>.json` lesen, env-Marker `"?"` durch den
//      User-API-Key aus `mcpServerKeys[name]` ersetzen, `mcpServersRepo.add`,
//      dann `mcpSkillSync.syncOnAdd` für Tool-Skill-Discovery. Rollback der
//      Server-Row bei Sync-Failure analog zum Settings-MCP-Add-Pfad.
//
// Whitelist gegen Scan-Output: die User-übergebenen Preset-IDs werden gegen
// `scanExamplesPresets()` validiert. Single-Source-of-Truth ist das
// File-System, kein hardcoded Enum.
//
// Soft-Failure-Pattern: jeder Schritt in try/catch. Skill-Import-Fail
// blockiert nicht MCP-Provisioning, MCP-Fail blockiert keine anderen
// Presets, ein einzelner Server-Add-Fail blockiert keine weiteren Server.
// Result-Array erlaubt UI, pro Preset und pro Server zu zeigen was geklappt
// hat.
//
// Settings-Path (PATCH /full-config) ruft activatePresets mit leeren
// `mcpServerKeys: {}` — MCP-Provisioning fällt dann soft mit Reason
// "API-Key fehlt", Skill bleibt importiert. Onboarding-Wizard sammelt die
// Keys vorab (Soft-Block α) und sendet sie mit.

interface FastifyLikeLogger {
  warn: (obj: Record<string, unknown>, msg?: string) => void;
  info?: (obj: Record<string, unknown>, msg?: string) => void;
}

export interface ActivatePresetsOptions {
  presetSelections: readonly PresetSelection[];
  twinId: string;
  twinHandle: string;
  examplesDir: string;
  mcpServersDir: string;
  skillRepo: SkillRepo;
  mcpServersRepo: McpServersRepo;
  registry: TwinServiceRegistry;
  logger: FastifyLikeLogger;
}

export async function activatePresets(
  opts: ActivatePresetsOptions,
): Promise<PresetActivationResult[]> {
  const {
    presetSelections,
    twinId,
    twinHandle,
    examplesDir,
    mcpServersDir,
    skillRepo,
    mcpServersRepo,
    registry,
    logger,
  } = opts;

  if (presetSelections.length === 0) return [];

  // Whitelist: die zur Submit-Zeit verfügbaren Presets. Scan ist billig
  // (< 100ms für die Handvoll Folders heute).
  const available = scanExamplesPresets(examplesDir, {
    warn: (msg, meta) => logger.warn(meta ?? {}, msg),
  });
  const availableById = new Map(available.map((p) => [p.id, p]));

  const results: PresetActivationResult[] = [];

  for (const selection of presetSelections) {
    const { presetId, mcpServerKeys } = selection;
    const preset = availableById.get(presetId);
    if (!preset) {
      logger.warn(
        { twinId, presetId },
        "[preset-activate] unknown preset-id, skip",
      );
      results.push({ id: presetId, status: "unknown" });
      continue;
    }

    // 1. Skill-Import
    const skillDir = resolve(examplesDir, presetId);
    let skillStatus: "imported" | "failed" = "imported";
    let skillReason: string | undefined;
    try {
      importSkillFromDir({
        skillRepo,
        twinId,
        skillDir,
        force: true,
        source: "example",
      });
    } catch (err) {
      const reason =
        err instanceof SkillImportError
          ? err.message
          : err instanceof Error
            ? err.message
            : String(err);
      logger.warn(
        { twinId, presetId, err: reason },
        "[preset-activate] skill-import failed",
      );
      skillStatus = "failed";
      skillReason = reason;
    }

    // 2. MCP-Server-Provisioning pro requires-Server
    const mcpServerResults: NonNullable<
      PresetActivationResult["mcpServers"]
    > = [];
    for (const serverName of preset.requiresMcpServers) {
      const userKey = mcpServerKeys[serverName]?.trim() ?? "";
      const result = await provisionMcpServer({
        serverName,
        userKey,
        twinId,
        twinHandle,
        mcpServersDir,
        mcpServersRepo,
        registry,
        logger,
      });
      mcpServerResults.push(result);
    }

    const resultItem: PresetActivationResult = {
      id: presetId,
      status: skillStatus,
    };
    if (skillReason) resultItem.reason = skillReason;
    if (mcpServerResults.length > 0) resultItem.mcpServers = mcpServerResults;
    results.push(resultItem);
  }

  return results;
}

/**
 * Provisioniert einen einzelnen MCP-Server für einen Twin via Template-
 * Substitution. Idempotent: existiert der Server schon (Name pro Twin
 * unique), wird `skipped` gemeldet ohne Fehler. Rollback bei Sync-Failure
 * analog zum Settings-Endpoint — Server-Row wird entfernt damit der Twin
 * keinen halben Stand behält.
 */
async function provisionMcpServer(opts: {
  serverName: string;
  userKey: string;
  twinId: string;
  twinHandle: string;
  mcpServersDir: string;
  mcpServersRepo: McpServersRepo;
  registry: TwinServiceRegistry;
  logger: FastifyLikeLogger;
}): Promise<NonNullable<PresetActivationResult["mcpServers"]>[number]> {
  const {
    serverName,
    userKey,
    twinId,
    twinHandle,
    mcpServersDir,
    mcpServersRepo,
    registry,
    logger,
  } = opts;

  // Idempotenz: schon angelegt? findByName wirft NotFound → fallthrough.
  try {
    mcpServersRepo.findByName(twinId, serverName);
    logger.warn(
      { twinId, serverName },
      "[preset-activate] mcp-server existiert schon, skip",
    );
    return { name: serverName, status: "skipped", reason: "existiert bereits" };
  } catch (err) {
    if (!(err instanceof McpServerNotFoundError)) throw err;
    // weiter: Server existiert noch nicht → anlegen
  }

  // Template laden + parsen
  let templateText: string;
  try {
    templateText = readFileSync(
      resolve(mcpServersDir, `${serverName}.json`),
      "utf8",
    );
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    logger.warn(
      { twinId, serverName, err: reason },
      "[preset-activate] mcp-template nicht lesbar",
    );
    return {
      name: serverName,
      status: "failed",
      reason: `Template fehlt: mcp-servers/${serverName}.json`,
    };
  }

  let templateRaw: unknown;
  try {
    templateRaw = JSON.parse(templateText);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    return {
      name: serverName,
      status: "failed",
      reason: `Template-JSON ungültig: ${reason}`,
    };
  }

  const parsed = McpServerSpecSchema.safeParse(templateRaw);
  if (!parsed.success) {
    return {
      name: serverName,
      status: "failed",
      reason: `Template-Schema-Fehler: ${parsed.error.message}`,
    };
  }
  const spec = parsed.data;

  // Env-Substitution: jeder "?"-Wert wird durch den User-Key ersetzt. Wenn
  // ein "?"-Marker vorhanden ist und kein Key da: soft-fail. Templates ohne
  // env-Marker (z.B. everything.json) provisionieren ohne Key.
  const env: Record<string, string> | null = spec.env ?? null;
  const hasMarker =
    env !== null && Object.values(env).some((v) => v === "?");
  if (hasMarker && userKey.length === 0) {
    return {
      name: serverName,
      status: "failed",
      reason: "API-Key fehlt",
    };
  }
  const envResolved: Record<string, string> | null = env
    ? Object.fromEntries(
        Object.entries(env).map(([k, v]) => [k, v === "?" ? userKey : v]),
      )
    : null;

  // Server anlegen
  let serverId: string | null = null;
  let synced = false;
  try {
    const created = mcpServersRepo.add({
      twinId,
      name: spec.name,
      transport: spec.transport,
      command: spec.command ?? null,
      args: spec.args ?? null,
      env: envResolved,
      url: spec.url ?? null,
      defaultRequiresApproval: spec.defaultRequiresApproval ?? true,
    });
    serverId = created.id;

    // Sync läuft über die Twin-eigene mcpSkillSync-Instanz (twin-scoped
    // McpClientManager mit listTools-Spawn). Twin muss in der Registry sein
    // — Onboarding-Pfad ruft activatePresets nach addTwin, Settings-Pfad
    // operiert auf laufenden Twins.
    const entry = registry.getEntry(twinHandle);
    if (!entry) {
      throw new Error(
        `Twin '${twinHandle}' nicht in Registry — kann syncOnAdd nicht ausführen`,
      );
    }
    await entry.service.mcpSkillSync.syncOnAdd(created.id);
    synced = true;
    return { name: serverName, status: "added" };
  } catch (err) {
    const reason =
      err instanceof McpServerAlreadyExistsError
        ? err.message
        : err instanceof McpServerValidationError
          ? err.message
          : err instanceof Error
            ? err.message
            : String(err);
    logger.warn(
      { twinId, serverName, err: reason },
      "[preset-activate] mcp-provision failed",
    );
    return {
      name: serverName,
      status: "failed",
      reason,
    };
  } finally {
    // Rollback bei Sync-Failure analog server.ts:1556-1573. Server-Row weg,
    // damit der Twin keinen halben Stand behält. Skills wurden bei Sync-Fail
    // noch nicht persistiert.
    if (!synced && serverId) {
      try {
        mcpServersRepo.remove(serverId);
      } catch (rollbackErr) {
        logger.warn(
          { twinId, serverId, err: String(rollbackErr) },
          "[preset-activate] rollback nach sync-failure fehlgeschlagen",
        );
      }
    }
  }
}
