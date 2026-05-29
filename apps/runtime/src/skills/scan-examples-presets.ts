import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import {
  SkillManifestSchema,
  type Preset,
  type SkillManifest,
} from "@nolmi/shared";

// ─── SCAN EXAMPLES-PRESETS ───────────────────────────────────────────────────
//
// File-System-Scan auf `examples/skills/`: jeder Subordner mit gültigem
// `manifest.yaml` wird ein Preset für den Wizard. Ungültige Manifests werden
// geskippt mit Warn-Log (nicht fatal).
//
// Wird vom GET /examples/presets-Endpoint genutzt (öffentlich, kein Auth)
// und im Submit-Handler als Whitelist-Source für die Preset-Activation —
// statt einer hardcoded Enum-Liste in shared. Single-Source-of-Truth: das
// File-System.
//
// Für die Card-Hint-Anzeige im Wizard (#122-Kontext) wird zusätzlich aus
// `manifest.requires_tools` die Liste der MCP-Server extrahiert — eine
// Tool-Referenz wie `mcp:hyperbrowser-approval:search_with_bing` ergibt
// den MCP-Server `hyperbrowser-approval`.

interface ScannerLogger {
  warn?: (msg: string, meta?: Record<string, unknown>) => void;
}

export function scanExamplesPresets(
  examplesDir: string,
  logger: ScannerLogger = {},
): Preset[] {
  if (!existsSync(examplesDir) || !statSync(examplesDir).isDirectory()) {
    return [];
  }

  const entries = readdirSync(examplesDir, { withFileTypes: true });
  const presets: Preset[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const subDir = resolve(examplesDir, entry.name);
    const manifestPath = resolve(subDir, "manifest.yaml");
    if (!existsSync(manifestPath)) {
      logger.warn?.(
        `[examples-presets] ${entry.name}: manifest.yaml fehlt — skip`,
        { dir: subDir },
      );
      continue;
    }

    let raw: unknown;
    try {
      raw = parseYaml(readFileSync(manifestPath, "utf-8"));
    } catch (err) {
      logger.warn?.(
        `[examples-presets] ${entry.name}: manifest.yaml unparseable — skip`,
        { err: err instanceof Error ? err.message : String(err) },
      );
      continue;
    }
    if (typeof raw !== "object" || raw === null) {
      logger.warn?.(
        `[examples-presets] ${entry.name}: manifest top-level kein Mapping — skip`,
      );
      continue;
    }

    const camel = mapSnakeToCamel(raw as Record<string, unknown>);
    const parsed = SkillManifestSchema.safeParse(camel);
    if (!parsed.success) {
      logger.warn?.(
        `[examples-presets] ${entry.name}: SkillManifestSchema-Verletzung — skip`,
        { issues: parsed.error.issues.map((i) => i.message) },
      );
      continue;
    }

    presets.push({
      id: entry.name,
      name: parsed.data.name,
      description: parsed.data.description,
      requiresMcpServers: extractMcpServersFromRequiresTools(parsed.data),
    });
  }

  // Stabile Reihenfolge für deterministische UI.
  presets.sort((a, b) => a.id.localeCompare(b.id));
  return presets;
}

/**
 * Extrahiert die einzigartigen MCP-Server-Namen aus `manifest.requires_tools`.
 * Tool-Referenz-Format: `mcp:<server-name>:<tool-name>` (siehe #107). Andere
 * Formate (z.B. Plain-Skill-Namen ohne `mcp:`-Prefix) werden ignoriert —
 * Card-Hint zeigt nur MCP-relevante Abhängigkeiten.
 */
export function extractMcpServersFromRequiresTools(
  manifest: SkillManifest,
): string[] {
  const tools = manifest.requiresTools ?? [];
  const servers = new Set<string>();
  for (const tool of tools) {
    if (!tool.startsWith("mcp:")) continue;
    const parts = tool.split(":");
    if (parts.length < 3) continue;
    const serverName = parts[1]?.trim();
    if (serverName) servers.add(serverName);
  }
  return Array.from(servers).sort();
}

/**
 * snake_case → camelCase. Bewusst dupliziert mit `import-from-dir.ts` —
 * beide Scanner-Pfade müssen unabhängig sein, damit Refactor an einer Stelle
 * den anderen nicht stört. Bei drittem Aufruf-Punkt wandert das in ein
 * gemeinsames `manifest-yaml-loader.ts`.
 */
function mapSnakeToCamel(input: Record<string, unknown>): Record<string, unknown> {
  const KEY_MAP: Record<string, string> = {
    requires_approval: "requiresApproval",
    trigger_mode: "triggerMode",
    trigger_condition: "triggerCondition",
    requires_tools: "requiresTools",
  };
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input)) {
    out[KEY_MAP[k] ?? k] = v;
  }
  return out;
}
