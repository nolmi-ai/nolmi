import { tool, jsonSchema, type Tool } from "ai";
import type { Skill } from "@twin-lab/shared";
import type { McpClientManager } from "./client-manager.js";

// `@ai-sdk/provider` re-exportiert `JSONSchema7` aus `json-schema`, ist aber
// nur transitive Dep des AI-SDK. Wir leiten den Schema-Typ direkt aus der
// `jsonSchema()`-Signatur ab — kein zusätzlicher Dependency-Drag und
// trotzdem typesafe. Awaited/erste-Param-Inference ist hier robuster als ein
// hartkodierter `JSONSchema7`-Cast, weil der genaue Typ über AI-SDK-Versionen
// schwankt.
type JsonSchemaInput = Parameters<typeof jsonSchema>[0];

// ─── MCP TOOL BRIDGE (Phase 3.2 Sub-Schritt D) ──────────────────────────────
//
// Konvertiert aktive MCP-Skills in AI-SDK-`tool({...})`-Definitions, deren
// `execute`-Funktion über den McpClientManager den eigentlichen MCP-Tool-Call
// macht. AI SDK 6.x orchestriert den Tool-Use-Loop multi-provider; wir liefern
// nur die Brücke zur Multi-Tenant-Infrastruktur.
//
// Manual-Skills sind explizit ausgeschlossen — die landen via 3.1-Mechanismus
// als Markdown im System-Prompt, sind keine Tools. Inactive-Skills werden
// gefiltert, damit ein UI-Toggle effektiv den LLM-Zugriff abschneidet.
//
// JSON-Schema vom MCP-Server wird via `jsonSchema()` aus dem AI SDK in ein
// Schema-Wrapper-Objekt verpackt — das ist die offizielle Brücke statt
// zod-from-json-schema. Wenn das input_schema fehlt, fällt der Wrapper auf
// ein leeres Object-Schema zurück, sodass parameterlose Tools (selten, aber
// im everything-Server enthalten) noch aufgerufen werden können.
//
// requires_approval aus dem Manifest wird in 3.2.D bewusst NICHT gehonoriert
// — siehe TODO in der execute()-Closure. Pilot-Tools (echo/add) sind
// harmlos. 3.2.F baut den Approval-Workflow ein.

export interface BuildMcpToolsInput {
  skills: Skill[];
  mcpManager: McpClientManager;
}

export type McpToolSet = Record<string, Tool>;

const EMPTY_INPUT_SCHEMA = {
  type: "object",
  properties: {},
} as unknown as JsonSchemaInput;

export function buildMcpToolsFromSkills(input: BuildMcpToolsInput): McpToolSet {
  const tools: McpToolSet = {};

  for (const skill of input.skills) {
    if (skill.source !== "mcp") continue;
    if (!skill.isActive) continue;
    if (!skill.mcpServerId || !skill.mcpToolName) continue;

    // TODO(3.2.F): respect skill.manifestJson.requiresApproval, currently
    // bypassed. Pilot-Tools sind harmlos; ein Approval-Gate würde den
    // synchronen AI-SDK-Loop blockieren — kommt mit eigenem Pending-Pattern.

    const rawSchema = skill.manifestJson.mcpInputSchema;
    const schemaJson: JsonSchemaInput =
      rawSchema && typeof rawSchema === "object"
        ? (rawSchema as JsonSchemaInput)
        : EMPTY_INPUT_SCHEMA;

    const serverId = skill.mcpServerId;
    const toolName = skill.mcpToolName;

    const toolKey = skill.name.replaceAll(":", "_");
    tools[toolKey] = tool({
      description:
        skill.manifestJson.description ?? `MCP tool: ${toolName}`,
      inputSchema: jsonSchema<Record<string, unknown>>(schemaJson),
      execute: async (args) => {
        const result = await input.mcpManager.callTool(
          serverId,
          toolName,
          args as Record<string, unknown>,
        );
        // Result als JSON-serialisierbares Object an den LLM zurück. AI SDK
        // packt das in den tool-result Content-Block.
        return {
          content: result.content,
          isError: result.isError ?? false,
        };
      },
    });
  }

  return tools;
}
