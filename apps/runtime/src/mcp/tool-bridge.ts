import { tool, jsonSchema, type Tool } from "ai";
import type { Skill } from "@twin-lab/shared";
import type { McpClientManager } from "./client-manager.js";

// ─── PENDING-APPROVAL-MARKER (Phase 3.2.F) ──────────────────────────────────
//
// AI SDK 6 schluckt `execute()`-Throws und reicht sie als output:null tool-
// result an den LLM weiter — der Throw-Pfad würde nie nach oben propagieren
// (Smoke-Test Tag-10 hat das verifiziert). Stattdessen returnt `execute()`
// ein eindeutiges Marker-Result; Twin-Service erkennt den Marker beim Loop
// durch `result.toolCalls` und triggert den Pending-Audit-Pfad.
//
// Throw-Pfad bleibt parallel als Defense-in-Depth: `McpToolApprovalRequired-
// Error` + Catch in TwinService greifen, falls jemals ein direkter Throw
// aus interner Logik (oder zukünftiger AI-SDK-Update) propagiert.
//
// Der String ist bewusst kollisionssicher (Underscore-Präfix/Suffix), damit
// reguläre Tool-Outputs ihn nicht versehentlich produzieren können.
export const MCP_PENDING_APPROVAL_MARKER = "__MCP_PENDING_APPROVAL__";

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
// 3.2.F: requires_approval aus dem Manifest wird Pre-Call enforced. Wenn
// gesetzt, wirft execute() `McpToolApprovalRequiredError` mit Server-/Tool-/
// Args-Daten. TwinService catcht den Throw auf der `generateText`-Ebene und
// baut einen Pending-Audit. Approve geht über die existierenden
// /audit/:id/approve-Routes, die im TwinService den mcp-tool-use-Resume-
// Branch fahren.

export interface BuildMcpToolsInput {
  skills: Skill[];
  mcpManager: McpClientManager;
}

export type McpToolSet = Record<string, Tool>;

export interface BuildMcpToolsResult {
  tools: McpToolSet;
  /**
   * Reverse-Mapping vom AI-SDK-konformen `toolKey` (z.B.
   * `mcp_everything-approval_get-sum`) zum Skill-Eintrag. Twin-Service nutzt
   * das beim Marker-Detect, um aus dem Tool-Namen die `mcpServerId` und den
   * originalen `mcpToolName` zu rekonstruieren — beides muss in den Pending-
   * Audit, ohne dass wir den Skill-Repo erneut anfragen.
   */
  skillByToolKey: Map<string, Skill>;
}

const EMPTY_INPUT_SCHEMA = {
  type: "object",
  properties: {},
} as unknown as JsonSchemaInput;

export function buildMcpToolsFromSkills(
  input: BuildMcpToolsInput,
): BuildMcpToolsResult {
  const tools: McpToolSet = {};
  const skillByToolKey = new Map<string, Skill>();

  for (const skill of input.skills) {
    if (skill.source !== "mcp") continue;
    if (!skill.isActive) continue;
    if (!skill.mcpServerId || !skill.mcpToolName) continue;

    const rawSchema = skill.manifestJson.mcpInputSchema;
    const schemaJson: JsonSchemaInput =
      rawSchema && typeof rawSchema === "object"
        ? (rawSchema as JsonSchemaInput)
        : EMPTY_INPUT_SCHEMA;

    const serverId = skill.mcpServerId;
    const toolName = skill.mcpToolName;
    const requiresApproval = skill.manifestJson.requiresApproval ?? false;

    const toolKey = skill.name.replaceAll(":", "_");
    skillByToolKey.set(toolKey, skill);
    tools[toolKey] = tool({
      description:
        skill.manifestJson.description ?? `MCP tool: ${toolName}`,
      inputSchema: jsonSchema<Record<string, unknown>>(schemaJson),
      execute: async (args) => {
        const argRecord = args as Record<string, unknown>;
        if (requiresApproval) {
          // Marker-Pattern (3.2.F): kein Tool-Aufruf jetzt. AI SDK 6 schluckt
          // execute()-Throws — wir kommunizieren stattdessen via
          // strukturiertem Marker-Result. TwinService erkennt den Marker im
          // result.toolCalls-Loop, wirft `McpToolApprovalRequiredError` (für
          // den existierenden Catch-Pfad) und baut den Pending-Audit.
          return {
            content: [
              {
                type: "text" as const,
                text: MCP_PENDING_APPROVAL_MARKER,
              },
            ],
            isError: false,
          };
        }
        const result = await input.mcpManager.callTool(
          serverId,
          toolName,
          argRecord,
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

  return { tools, skillByToolKey };
}
