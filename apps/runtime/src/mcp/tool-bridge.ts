import { tool, jsonSchema, type Tool } from "ai";
import { nanoid } from "nanoid";
import type { Skill } from "@twin-lab/shared";
import type { McpClientManager } from "./client-manager.js";
import type { EventBus } from "../events/bus.js";

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
  /**
   * #107: optionaler EventBus für Live-Progress-Events während Auto-Approve-
   * Tool-Calls. Wenn gesetzt, emittiert execute() vor und nach jedem MCP-Call
   * `tool.call.start` / `tool.call.complete` (ephemer via SSE, kein DB-Persist).
   * Marker-Pfad (requiresApproval=true) emittiert NICHT — kein echter Call,
   * Frontend kennt den Pending-Status schon via mcp-tool-use-Audit.
   */
  bus?: EventBus;
}

// #107: Tool-Args truncieren für Live-Display. Hyperbrowser-Args (query, url)
// sind kurz, aber andere Tools könnten lange Prompts/Texts mitsenden — defensive
// String-Truncation pro Feld auf 500 chars, Non-Strings unverändert.
const ARG_DISPLAY_MAX_CHARS = 500;
function truncateArgsForDisplay(
  args: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(args)) {
    if (typeof v === "string" && v.length > ARG_DISPLAY_MAX_CHARS) {
      out[k] = v.slice(0, ARG_DISPLAY_MAX_CHARS) + "…";
    } else {
      out[k] = v;
    }
  }
  return out;
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
      // #131 Phase 3.4.3.1 Big-Bang: needsApproval ersetzt das Marker-Pattern
      // aus 3.2.F. Vercel-SDK pausiert pre-execute bei needsApproval=true und
      // emittiert tool-approval-request als Content-Part. execute() wird erst
      // gerufen, nachdem der Caller eine tool-approval-response{approved:true}
      // in die History injiziert hat (siehe TwinService.approveMcpToolUse).
      needsApproval: requiresApproval,
      execute: async (args) => {
        const argRecord = args as Record<string, unknown>;
        // #107: Live-Progress-Events für Auto-Approve-Pfad. Bus ist optional —
        // Tests ohne Bus laufen normal weiter. Failure-Pfad emittet die
        // Complete-Event mit status='failed' BEVOR wir den Error nach oben
        // re-throwen, sonst sieht das Frontend den fehlgeschlagenen Call nie.
        const callId = nanoid(12);
        const startedAt = new Date().toISOString();
        const startedAtMs = Date.now();
        if (input.bus) {
          input.bus.emit({
            type: "tool.call.start",
            payload: {
              callId,
              toolName: skill.name,
              mcpServerId: serverId,
              args: truncateArgsForDisplay(argRecord),
              startedAt,
            },
          });
        }
        try {
          const result = await input.mcpManager.callTool(
            serverId,
            toolName,
            argRecord,
          );
          if (input.bus) {
            input.bus.emit({
              type: "tool.call.complete",
              payload: {
                callId,
                status: "executed",
                completedAt: new Date().toISOString(),
                durationMs: Date.now() - startedAtMs,
              },
            });
          }
          // Result als JSON-serialisierbares Object an den LLM zurück. AI SDK
          // packt das in den tool-result Content-Block.
          return {
            content: result.content,
            isError: result.isError ?? false,
          };
        } catch (err) {
          if (input.bus) {
            input.bus.emit({
              type: "tool.call.complete",
              payload: {
                callId,
                status: "failed",
                error: err instanceof Error ? err.message : String(err),
                completedAt: new Date().toISOString(),
                durationMs: Date.now() - startedAtMs,
              },
            });
          }
          throw err;
        }
      },
    });
  }

  return { tools, skillByToolKey };
}
