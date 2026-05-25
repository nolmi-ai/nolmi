import type { Skill } from "@twin-lab/shared";

// ─── CODEX TOOL MAPPER (#131 PHASE 3.3.1.1) ──────────────────────────────────
//
// Mappt Twin-Lab `Skill[]` auf das Codex-API `tools`-Field-Format (OpenAI
// Responses API function-schema). Parallel zu `buildMcpToolsFromSkills`
// (apps/runtime/src/mcp/tool-bridge.ts), das AI-SDK-`Tool`-Objects für den
// Vercel-SDK-Pfad baut.
//
// Filter-Logic 1:1 wie tool-bridge.ts:112-114 — nur aktive MCP-Skills mit
// vollständigem mcpServerId/mcpToolName landen im Tool-Set. Manual-Skills
// fließen via Markdown im System-Prompt (existing 3.1-Pattern), nicht als
// Codex-Tool.
//
// Tool-Key-Convention: `skill.name.replaceAll(":", "_")` matched
// buildMcpToolsFromSkills (z.B. `mcp:everything-approval:get-sum` →
// `mcp_everything-approval_get-sum`) — Reverse-Lookup über die existing
// Skill-Name-Convention bleibt portabel zwischen Providern.
//
// Schema-Quelle: §l in docs/131-OAUTH-STRATEGY.md (Phase 3.3.2 Spike-
// Verifikation). Codex ergänzt `strict: true` automatisch, wir setzen es
// nicht explizit (würde nur Schema-Validation server-side strikter machen).

/**
 * Codex-Tool-Definition. Matched OpenAI Responses API function-schema,
 * verifiziert via Phase-3.3.0+3.3.2-Spikes (siehe §k/§l).
 */
export interface CodexToolDefinition {
  type: "function";
  name: string;
  description: string;
  parameters: object;
}

/**
 * Result-Shape von `mapSkillsToCodexTools`. Reverse-Map (`skillByCodexName`)
 * matched buildMcpToolsFromSkills.skillByToolKey (tool-bridge.ts:97) und
 * ist substantiell wegen Edge-Case: existing Skills wie
 * `mcp:hyperbrowser-approval:scrape_webpage` enthalten `_` im
 * mcpToolName-Teil. Codex-Tool-Name `mcp_hyperbrowser-approval_scrape_webpage`
 * lässt sich NICHT eindeutig per naivem `replaceAll("_", ":")` zurückmappen
 * (würde 5 Segmente liefern statt 3). Die Map ist die einzige robuste
 * Lookup-Strategie — Phase 3.3.1.2 runModelViaCodex nutzt sie für
 * Tool-Execution-Dispatching.
 */
export interface MapSkillsToCodexToolsResult {
  tools: CodexToolDefinition[];
  skillByCodexName: Map<string, Skill>;
}

/** Fallback für Skills ohne `mcpInputSchema` (analog `EMPTY_INPUT_SCHEMA`
 *  in tool-bridge.ts:100-103). Codex akzeptiert parameterlose Tools. */
const EMPTY_PARAMETERS = {
  type: "object",
  properties: {},
} as const;

/**
 * Mappt Twin-Lab Skills auf Codex-API `tools`-Field-Items + baut Reverse-
 * Lookup-Map für Tool-Execution-Dispatching.
 *
 * Filter (identisch zu tool-bridge.ts:112-114):
 *   - `source === "mcp"` (Manual-Skills sind System-Prompt-Markdown, keine
 *     Tools)
 *   - `isActive === true` (UI-Toggle muss Codex-Zugriff abschneiden)
 *   - `mcpServerId` + `mcpToolName` beide present (defensive — sollte bei
 *     source='mcp' immer der Fall sein, aber Schema lässt `nullable` zu)
 *
 * Field-Mapping (aus `skill.manifestJson`, NICHT direkt von skill):
 *   - `name`: `skill.name.replaceAll(":", "_")` (Tool-Key-Convention)
 *   - `description`: `manifestJson.description` (immer present im
 *     SkillManifestSchema)
 *   - `parameters`: `manifestJson.mcpInputSchema` als JSON-Schema-Object;
 *     fehlt das Feld (Manual-Skill ohne MCP-Hintergrund), fällt der Mapper
 *     auf `EMPTY_PARAMETERS` zurück
 *
 * Single-Pass: Tools-Array + Map werden im selben Loop gebaut (Single-
 * Source-of-Truth für Filter-Logic).
 */
export function mapSkillsToCodexTools(
  skills: Skill[],
): MapSkillsToCodexToolsResult {
  const tools: CodexToolDefinition[] = [];
  const skillByCodexName = new Map<string, Skill>();
  for (const skill of skills) {
    if (skill.source !== "mcp") continue;
    if (!skill.isActive) continue;
    if (!skill.mcpServerId || !skill.mcpToolName) continue;

    const rawSchema = skill.manifestJson.mcpInputSchema;
    const parameters: object =
      rawSchema && typeof rawSchema === "object"
        ? (rawSchema as object)
        : EMPTY_PARAMETERS;

    const codexName = skill.name.replaceAll(":", "_");
    tools.push({
      type: "function",
      name: codexName,
      description: skill.manifestJson.description,
      parameters,
    });
    skillByCodexName.set(codexName, skill);
  }
  return { tools, skillByCodexName };
}
