import "dotenv/config";
import Database from "better-sqlite3";
import { loadRuntimeConfig } from "../config.js";
import { TwinProfilesRepo } from "../twin-profiles-repo.js";
import { loadMasterKey } from "../crypto-utils.js";
import { McpServersRepo } from "../mcp/repo.js";
import { McpClientManager } from "../mcp/client-manager.js";
import { SkillRepo } from "../skills/repo.js";
import { buildMcpToolsFromSkills } from "../mcp/tool-bridge.js";
import type {
  McpClientFactory,
  McpClientLike,
} from "../mcp/client-factory.js";

// ─── TEST: MCP-TOOL-EXECUTION (Phase 3.2 Sub-Schritt D) ─────────────────────
//
// Verifiziert die Bridge zwischen MCP-Skills und AI-SDK-Tools, ohne einen
// echten LLM-Call zu machen:
//
//   - buildMcpToolsFromSkills filtert manual + inactive korrekt
//   - tool.execute() reicht durch zum McpClientManager (Mock-Manager mit
//     deterministischem callTool-Result)
//
// Der vollständige LLM-Tool-Use-Loop wird im manuellen Smoke-Test gegen
// echten Anthropic + everything-Server abgedeckt — ein AI-SDK-Mock wäre hier
// mehr Aufwand als Erkenntnis.
//
// Voraussetzung: pnpm db:init lief, TWIN_LAB_ENCRYPTION_KEY gesetzt,
// Test-Twin (default @markus) existiert.
//
// Aufruf:
//   pnpm --filter @twin-lab/runtime tsx src/scripts/test-mcp-tool-execution.ts

const TWIN_HANDLE_DEFAULT = "@markus";
const TEST_SERVER_NAME = "_test-mcp-exec";

// ─── Mock-McpClient mit deterministischer callTool-Antwort ──────────────────

class MockMcpClient implements McpClientLike {
  public callToolCalls: Array<{
    name: string;
    args: Record<string, unknown>;
  }> = [];
  private connected = false;
  constructor(
    public readonly serverName: string,
    public readonly twinId: string,
  ) {}
  async connect(): Promise<void> {
    this.connected = true;
  }
  async listTools() {
    return [
      { name: "echo", description: "Echoes input", inputSchema: { type: "object" } },
    ];
  }
  async callTool(
    name: string,
    args: Record<string, unknown>,
  ): Promise<{
    content: Array<{ type: string; text?: string; [key: string]: unknown }>;
    isError?: boolean;
  }> {
    this.callToolCalls.push({ name, args });
    return {
      content: [{ type: "text", text: `mocked echo: ${JSON.stringify(args)}` }],
      isError: false,
    };
  }
  async disconnect(): Promise<void> {
    this.connected = false;
  }
  isConnected(): boolean {
    return this.connected;
  }
}

class MockFactory implements McpClientFactory {
  public created: MockMcpClient[] = [];
  create(serverName: string, twinId: string): McpClientLike {
    const c = new MockMcpClient(serverName, twinId);
    this.created.push(c);
    return c;
  }
}

async function main() {
  const masterKey = loadMasterKey();
  const config = loadRuntimeConfig();
  const db = new Database(config.dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  const profilesRepo = new TwinProfilesRepo(db);
  const mcpRepo = new McpServersRepo(db, masterKey);
  const skillRepo = new SkillRepo(db);

  const profile = profilesRepo.findByHandle(TWIN_HANDLE_DEFAULT);
  if (!profile) {
    throw new Error(`Twin '${TWIN_HANDLE_DEFAULT}' nicht in DB.`);
  }
  log(`Test-Twin: ${profile.handle} (${profile.twinId})`);

  cleanup(db, profile.twinId);

  let issues = 0;

  // ─── STEP 1: Setup ────────────────────────────────────────────────────────
  banner("STEP 1 — Setup: Server + Skills");
  const server = mcpRepo.add({
    twinId: profile.twinId,
    name: TEST_SERVER_NAME,
    transport: "stdio",
    command: "fake-command",
    args: ["--test"],
    defaultRequiresApproval: false,
  });

  const mcpSkillName = `mcp:${TEST_SERVER_NAME}:echo`;
  const mcpSkill = skillRepo.add({
    twinId: profile.twinId,
    name: mcpSkillName,
    description: "Test MCP-Tool",
    manifestJson: {
      name: mcpSkillName,
      description: "Echoes input",
      capability: "mcp_tool",
      requiresApproval: false,
      version: "auto-generated",
      mcpServerId: server.id,
      mcpToolName: "echo",
      mcpInputSchema: {
        type: "object",
        properties: { message: { type: "string" } },
        required: ["message"],
      },
    },
    instructionsMd: "MCP-Tool Stub",
    source: "mcp",
    mcpServerId: server.id,
    mcpToolName: "echo",
  });

  // Manual-Skill als Negativ-Kontrolle: muss von der Bridge gefiltert werden.
  const manualSkillName = "_test-manual-skill";
  const manualSkill = skillRepo.add({
    twinId: profile.twinId,
    name: manualSkillName,
    description: "Manual-Skill für Filter-Test",
    manifestJson: {
      name: manualSkillName,
      description: "Manual-Skill für Filter-Test",
      capability: "respond_to_chat",
      requiresApproval: false,
    },
    instructionsMd: "Markdown-Wissen",
    source: "manual",
  });

  log(`  server.id:     ${server.id}`);
  log(`  mcpSkill.id:   ${mcpSkill.skillId}`);
  log(`  manualSkill:   ${manualSkill.skillId}`);

  // ─── STEP 2: Bridge baut 1 Tool, ignoriert Manual ─────────────────────────
  banner("STEP 2 — buildMcpToolsFromSkills filtert manual aus");
  const factory = new MockFactory();
  const manager = new McpClientManager(profile.twinId, mcpRepo, factory);
  const allSkills = skillRepo.list(profile.twinId, { activeOnly: true });
  // Tool-Naming: ":" wird durch "_" ersetzt (AI-SDK-Provider verbieten ":"
  // in Tool-Namen). Der Test referenziert den Key über diese Konvention.
  const expectedToolKey = mcpSkillName.replaceAll(":", "_");
  const manualToolKey = manualSkillName.replaceAll(":", "_");
  const built = buildMcpToolsFromSkills({ skills: allSkills, mcpManager: manager });
  const toolKeys = Object.keys(built.tools);
  log(`  toolKeys: ${toolKeys.join(", ")}`);
  if (toolKeys.length !== 1) {
    issues += 1;
    log(`  ⚠ erwartet genau 1 Tool, gefunden ${toolKeys.length}`);
  }
  if (!toolKeys.includes(expectedToolKey)) {
    issues += 1;
    log(`  ⚠ MCP-Tool fehlt in Tool-Map (erwartet ${expectedToolKey})`);
  }
  if (toolKeys.includes(manualToolKey)) {
    issues += 1;
    log(`  ⚠ Manual-Skill ist fälschlich als Tool enthalten`);
  }
  // skillByToolKey-Map muss den Reverse-Lookup zum DB-Skill liefern (3.2.F).
  const reverseSkill = built.skillByToolKey.get(expectedToolKey);
  if (!reverseSkill || reverseSkill.skillId !== mcpSkill.skillId) {
    issues += 1;
    log(`  ⚠ skillByToolKey liefert nicht den erwarteten Skill`);
  }

  // ─── STEP 3: Inactive-Filter ──────────────────────────────────────────────
  banner("STEP 3 — Inactive-Filter");
  skillRepo.setActive(mcpSkill.skillId, false);
  const allActive = skillRepo.list(profile.twinId, { activeOnly: true });
  const builtAfter = buildMcpToolsFromSkills({
    skills: allActive,
    mcpManager: manager,
  });
  log(
    `  toolKeys nach Deaktivierung: ${Object.keys(builtAfter.tools).join(", ") || "(leer)"}`,
  );
  if (Object.keys(builtAfter.tools).length !== 0) {
    issues += 1;
    log(`  ⚠ deaktivierter Skill darf nicht mehr in Tool-Map sein`);
  }
  // Reaktivieren für die nächsten Steps.
  skillRepo.setActive(mcpSkill.skillId, true);

  // ─── STEP 4: tool.execute() reicht zu manager.callTool durch ──────────────
  banner("STEP 4 — execute() Roundtrip via Mock-Manager");
  const skillsAgain = skillRepo.list(profile.twinId, { activeOnly: true });
  const builtLive = buildMcpToolsFromSkills({
    skills: skillsAgain,
    mcpManager: manager,
  });
  const echoTool = builtLive.tools[expectedToolKey];
  if (!echoTool || !echoTool.execute) {
    issues += 1;
    log(`  ⚠ echo-Tool oder .execute() fehlt`);
  } else {
    // AI-SDK execute-Signatur ist (input, options); options sind hier
    // nicht relevant, also stub.
    const execResult = await echoTool.execute(
      { message: "hi" },
      {
        toolCallId: "test-call-id",
        messages: [],
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any,
    );
    log(`  exec result: ${JSON.stringify(execResult)}`);

    // Mock-Manager lazy-spawnt beim ersten callTool — also gibt's jetzt
    // 1 erstellten Mock-Client.
    if (factory.created.length !== 1) {
      issues += 1;
      log(
        `  ⚠ erwartet 1 Mock-Client gespawnt, gefunden ${factory.created.length}`,
      );
    }
    const mockClient = factory.created[0];
    if (!mockClient || mockClient.callToolCalls.length !== 1) {
      issues += 1;
      log(`  ⚠ callTool wurde nicht oder mehrfach gerufen`);
    } else {
      const recorded = mockClient.callToolCalls[0]!;
      if (
        recorded.name !== "echo" ||
        recorded.args.message !== "hi"
      ) {
        issues += 1;
        log(
          `  ⚠ callTool-Args falsch: name=${recorded.name}, args=${JSON.stringify(recorded.args)}`,
        );
      } else {
        log(`  ✓ Mock-Manager mit (echo, {message:'hi'}) gerufen`);
      }
    }
  }

  // ─── STEP 5: Cleanup ──────────────────────────────────────────────────────
  banner("STEP 5 — Cleanup");
  await manager.dispose();
  cleanup(db, profile.twinId);
  log(`  Test-Reste entfernt.`);

  banner("ZUSAMMENFASSUNG");
  if (issues === 0) {
    log("✓ alle Tests grün");
  } else {
    log(`✗ ${issues} Issue(s) — Details oben.`);
  }
  db.close();
  if (issues > 0) process.exit(2);
}

function banner(title: string) {
  const line = "─".repeat(72);
  console.log(`\n${line}\n  ${title}\n${line}`);
}
function log(msg: string) {
  console.log(msg);
}
function cleanup(db: Database.Database, twinId: string) {
  // mcp_servers cascadet Skills.
  db.prepare(
    "DELETE FROM mcp_servers WHERE twin_id = ? AND name LIKE '_test-mcp%'",
  ).run(twinId);
  db.prepare(
    "DELETE FROM skills WHERE twin_id = ? AND (name LIKE 'mcp:_test-mcp%' OR name LIKE '_test-manual%')",
  ).run(twinId);
}

main().catch((err) => {
  console.error(
    "\n[mcp-tool-execution:test] Fehler:",
    err instanceof Error ? err.message : err,
  );
  process.exit(1);
});
