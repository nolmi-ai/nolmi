import type { McpServer, McpToolDefinition, SkillManifest } from "@twin-lab/shared";
import type { McpServersRepo } from "./repo.js";
import type { McpClientManager } from "./client-manager.js";
import { SkillAlreadyExistsError, type SkillRepo } from "../skills/repo.js";

// ─── MCP SKILL SYNC (Phase 3.2 Sub-Schritt C) ───────────────────────────────
//
// Bridge zwischen MCP-Tool-Discovery (listTools über den Manager) und der
// Skill-Tabelle. Tool-Inhalte landen als Skills mit source='mcp', sodass der
// existierende 3.1-Mechanismus ("alle aktiven Skills permanent in den
// System-Prompt") sie automatisch dem LLM bekannt macht.
//
// Sync-Trigger sind bewusst eng:
//
//   - syncOnAdd: einmaliger Sync direkt nach POST /mcp-servers (Sub-E).
//     Spawnt den Server erstmalig, listet Tools, legt Skills an. Wirft bei
//     Spawn-/listTools-Fehler — partial state ist Caller-Pflicht.
//   - refresh: manueller Refresh durch CLI/UI, wenn der User weiß dass sich
//     Tools auf Server-Seite geändert haben. Diff: neue Tools werden aktiv,
//     entfernte werden auf is_active=false gesetzt (kein DELETE — dann
//     bliebe die User-Toggle-Historie erhalten).
//
// Auto-Sync bei Boot wäre Spawn-Lawine bei vielen Twins; Auto-Sync bei
// Lazy-Spawn wäre UX-Latenz beim ersten Tool-Call. Beides bewusst nicht.
//
// Connection-Lifecycle: nach Sync wird NICHT explizit disconnected. Der
// Manager idle-disconnected nach MCP_IDLE_TIMEOUT_MS — wenn der User direkt
// nach Add testweise einen Tool-Call macht, ist der Server schon warm.

export interface SyncOnAddResult {
  added: number;
  skipped: number;
}

export interface RefreshResult {
  added: number;
  deactivated: number;
  unchanged: number;
}

export class McpSkillSync {
  constructor(
    private readonly mcpServersRepo: McpServersRepo,
    private readonly skillRepo: SkillRepo,
    private readonly mcpManager: McpClientManager,
    private readonly twinId: string,
  ) {}

  /**
   * Initialer Sync direkt nach Server-Add. Wirft, wenn der Spawn fehlschlägt
   * oder listTools nichts liefert — der Caller (CLI-Server-Add-Pfad in
   * Sub-E) entscheidet, ob er die Server-Row dann zurückrollt oder stehen
   * lässt.
   *
   * Conflict-Handling: ein Skill mit demselben Namen, der nicht zu diesem
   * Server gehört (z.B. ein manuell angelegter `mcp:something:echo`), wird
   * mit Warn-Log übersprungen. Kein Fail — Server-Setup soll nicht an einer
   * Naming-Kollision scheitern.
   */
  async syncOnAdd(mcpServerId: string): Promise<SyncOnAddResult> {
    const server = this.mcpServersRepo.findById(mcpServerId);
    const tools = await this.mcpManager.listTools(mcpServerId);

    let added = 0;
    let skipped = 0;
    for (const tool of tools) {
      const skillName = formatSkillName(server.name, tool.name);
      try {
        const { manifest, instructionsMd } = generateSkillFromTool(server, tool);
        this.skillRepo.add({
          twinId: this.twinId,
          name: skillName,
          description: tool.description ?? `MCP-Tool: ${tool.name}`,
          manifestJson: manifest,
          instructionsMd,
          source: "mcp",
          mcpServerId: server.id,
          mcpToolName: tool.name,
        });
        added += 1;
      } catch (err) {
        if (err instanceof SkillAlreadyExistsError) {
          // Naming-Kollision (z.B. mit manual-Skill). Server-Setup nicht
          // abbrechen — User kann den Konflikt manuell auflösen.
          console.warn(
            `[mcp:sync] skill '${skillName}' existiert bereits (twin=${this.twinId}) — übersprungen`,
          );
          skipped += 1;
          continue;
        }
        throw err;
      }
    }

    console.log(
      `[mcp:sync] syncOnAdd: server=${server.name} (${server.id}), added=${added}, skipped=${skipped}, total=${tools.length}`,
    );
    return { added, skipped };
  }

  /**
   * Manueller Refresh: Diff zwischen Server-Tools und DB-State.
   *
   *   - Tool im Server, kein Skill in DB → add
   *   - Skill in DB, kein Tool im Server → setActive(false). Kein DELETE,
   *     weil ein User-Toggle (z.B. „aktiviere mal nicht") sonst zwischen
   *     Refreshes verlorenginge.
   *   - Skill in DB UND Tool im Server → unchanged. Kein Update von
   *     description/requiresApproval o.ä. — User-seitige Edits dürfen nicht
   *     vom Refresh überschrieben werden.
   *
   * Reaktivierung: ein vorher deaktivierter Skill (weil Tool weg war), dessen
   * Tool wieder im Server auftaucht, wird auf is_active=true gesetzt — sonst
   * bliebe der Refresh asymmetrisch. Zählt als 'unchanged' im Result, weil
   * der Skill-Eintrag schon existierte.
   */
  async refresh(mcpServerId: string): Promise<RefreshResult> {
    const server = this.mcpServersRepo.findById(mcpServerId);
    const tools = await this.mcpManager.listTools(mcpServerId);
    const existing = this.skillRepo.listByMcpServer(mcpServerId);

    const serverToolNames = new Set(tools.map((t) => t.name));
    const existingByTool = new Map(
      existing.filter((s) => s.mcpToolName).map((s) => [s.mcpToolName!, s]),
    );

    let added = 0;
    let deactivated = 0;
    let unchanged = 0;

    // 1. Server → DB: Add neue, Reaktiviere existing.
    for (const tool of tools) {
      const dbSkill = existingByTool.get(tool.name);
      if (!dbSkill) {
        const skillName = formatSkillName(server.name, tool.name);
        try {
          const { manifest, instructionsMd } = generateSkillFromTool(server, tool);
          this.skillRepo.add({
            twinId: this.twinId,
            name: skillName,
            description: tool.description ?? `MCP-Tool: ${tool.name}`,
            manifestJson: manifest,
            instructionsMd,
            source: "mcp",
            mcpServerId: server.id,
            mcpToolName: tool.name,
          });
          added += 1;
        } catch (err) {
          if (err instanceof SkillAlreadyExistsError) {
            console.warn(
              `[mcp:sync] refresh: skill '${skillName}' existiert (Konflikt) — übersprungen`,
            );
            // Naming-Konflikt zählt als skipped — wir packen das in
            // 'unchanged', sonst verfälscht es das Diff-Ergebnis nicht.
            unchanged += 1;
            continue;
          }
          throw err;
        }
      } else {
        if (!dbSkill.isActive) {
          // Reaktivieren: Tool ist wieder verfügbar.
          this.skillRepo.setActive(dbSkill.skillId, true);
        }
        unchanged += 1;
      }
    }

    // 2. DB → Server: deaktiviere Skills deren Tool weg ist (nur die noch
    // aktiven; bereits inaktive bleiben so wie sie sind).
    for (const dbSkill of existing) {
      if (!dbSkill.mcpToolName) continue;
      if (serverToolNames.has(dbSkill.mcpToolName)) continue;
      if (!dbSkill.isActive) continue;
      this.skillRepo.setActive(dbSkill.skillId, false);
      deactivated += 1;
    }

    console.log(
      `[mcp:sync] refresh: server=${server.name} (${server.id}), added=${added}, deactivated=${deactivated}, unchanged=${unchanged}`,
    );
    return { added, deactivated, unchanged };
  }
}

// ─── Helpers (modul-lokal) ──────────────────────────────────────────────────

/**
 * Naming-Convention `mcp:<server>:<tool>`. Macht in Listings auf einen Blick
 * sichtbar, was MCP-Tool ist. Doppelpunkt als Separator, weil Server- und
 * Tool-Namen auf MCP-Seite typischerweise keinen enthalten.
 */
function formatSkillName(serverName: string, toolName: string): string {
  return `mcp:${serverName}:${toolName}`;
}

function generateSkillFromTool(
  server: McpServer,
  tool: McpToolDefinition,
): { manifest: SkillManifest; instructionsMd: string } {
  const skillName = formatSkillName(server.name, tool.name);
  const manifest: SkillManifest = {
    name: skillName,
    description: tool.description ?? `MCP-Tool: ${tool.name}`,
    // Capability-Marker für Sub-D: der Tool-Use-Pfad pickt mcp_tool-Skills
    // separat (Mandate-Check / Approval-Routing).
    capability: "mcp_tool",
    requiresApproval: server.defaultRequiresApproval,
    version: "auto-generated",
    mcpServerId: server.id,
    mcpToolName: tool.name,
    mcpInputSchema: tool.inputSchema,
  };
  const instructionsMd = generateMcpToolInstructions(server, tool);
  return { manifest, instructionsMd };
}

function generateMcpToolInstructions(
  server: McpServer,
  tool: McpToolDefinition,
): string {
  // Bewusst auf Englisch — der System-Prompt-Builder von 3.1 hängt diese
  // Blöcke an die deutschsprachige Persona an, aber die Tool-Beschreibungen
  // selbst kommen vom MCP-Server (typischerweise englisch). Konsistente
  // Sprache pro Block hält den Prompt klarer als Halb-Übersetzungen.
  const lines = [
    `# MCP-Tool: ${tool.name} (server: ${server.name})`,
    "",
    `This tool is provided by the MCP server "${server.name}" and can be invoked`,
    `via the MCP-Tool-Use protocol.`,
    "",
  ];
  if (tool.description) {
    lines.push(`**Description:** ${tool.description}`, "");
  }
  lines.push(
    "**Input schema:** see manifest input_schema field",
    "",
    `**Approval required:** ${server.defaultRequiresApproval ? "yes" : "no"}`,
  );
  return lines.join("\n");
}
