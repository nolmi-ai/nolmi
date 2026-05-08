import "dotenv/config";
import Database from "better-sqlite3";
import { loadRuntimeConfig } from "../config.js";
import { TwinProfilesRepo } from "../twin-profiles-repo.js";
import { loadMasterKey } from "../crypto-utils.js";
import { McpServersRepo } from "../mcp/repo.js";
import { McpClientManager } from "../mcp/client-manager.js";
import { McpSkillSync } from "../mcp/skill-sync.js";
import { SkillRepo } from "../skills/repo.js";
import type {
  McpClientFactory,
  McpClientLike,
} from "../mcp/client-factory.js";

// ─── TEST: MCP-SKILL-SYNC (Phase 3.2 Sub-Schritt C) ─────────────────────────
//
// Verifiziert, dass syncOnAdd die Tools eines MCP-Servers als Skills mit
// source='mcp' registriert, und dass refresh() korrekt diff't (added /
// deactivated / unchanged). Plus: Cascade-Delete und Conflict-Skipping.
//
// Mock-Factory für deterministische Tool-Listings — kein echter Subprocess.
// Die Mock-Factory hält ihre Tool-Liste in einer Variable, die wir zwischen
// Steps verändern, um den Refresh-Diff zu provozieren.
//
// Voraussetzung: pnpm db:init lief (Migration 012 angewendet),
// TWIN_LAB_ENCRYPTION_KEY gesetzt, Test-Twin (default @markus) existiert.
//
// Aufruf:
//   pnpm --filter @twin-lab/runtime tsx src/scripts/test-mcp-skill-sync.ts

const TWIN_HANDLE_DEFAULT = "@markus";
const TEST_SERVER_NAME = "_test-mcp-sync";

// ─── Mock-Factory mit veränderlicher Tool-Liste ─────────────────────────────

interface ToolStub {
  name: string;
  description?: string;
  inputSchema?: unknown;
}

class MockMcpClient implements McpClientLike {
  private connected = false;
  constructor(
    public readonly serverName: string,
    public readonly twinId: string,
    private readonly toolsRef: { current: ToolStub[] },
  ) {}
  async connect(): Promise<void> {
    this.connected = true;
  }
  async listTools() {
    return this.toolsRef.current.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema ?? { type: "object" },
    }));
  }
  async callTool(): Promise<{
    content: Array<{ type: string; text?: string; [key: string]: unknown }>;
    isError?: boolean;
  }> {
    throw new Error("not used in skill-sync test");
  }
  async disconnect(): Promise<void> {
    this.connected = false;
  }
  isConnected(): boolean {
    return this.connected;
  }
}

class MockFactory implements McpClientFactory {
  constructor(private readonly toolsRef: { current: ToolStub[] }) {}
  create(serverName: string, twinId: string): McpClientLike {
    return new MockMcpClient(serverName, twinId, this.toolsRef);
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

  // Reset von Voraufläufen.
  cleanup(db, profile.twinId);

  let issues = 0;

  // ─── STEP 1: Server + Mock-Factory aufsetzen ──────────────────────────────
  banner("STEP 1 — Setup: Server + Mock-Factory");
  const toolsRef: { current: ToolStub[] } = {
    current: [
      { name: "echo", description: "Echoes back the input message" },
      { name: "add", description: "Adds two numbers" },
      {
        name: "longRunningOperation",
        description: "Demonstrates long-running tool",
      },
    ],
  };
  const factory = new MockFactory(toolsRef);
  const server = mcpRepo.add({
    twinId: profile.twinId,
    name: TEST_SERVER_NAME,
    transport: "stdio",
    command: "fake-command",
    args: ["--test"],
    defaultRequiresApproval: true,
  });
  log(`  server.id:   ${server.id}`);
  log(`  tool count:  ${toolsRef.current.length}`);

  const manager = new McpClientManager(profile.twinId, mcpRepo, factory);
  const sync = new McpSkillSync(mcpRepo, skillRepo, manager, profile.twinId);

  // ─── STEP 2: syncOnAdd legt 3 Skills an ───────────────────────────────────
  banner("STEP 2 — syncOnAdd()");
  const addResult = await sync.syncOnAdd(server.id);
  log(`  added=${addResult.added}, skipped=${addResult.skipped}`);
  if (addResult.added !== 3 || addResult.skipped !== 0) {
    issues += 1;
    log(`  ⚠ erwartet added=3 skipped=0`);
  }
  const afterAdd = skillRepo.listByMcpServer(server.id);
  log(`  Skills:`);
  for (const s of afterAdd) {
    log(
      `    - ${s.name}  source=${s.source}  active=${s.isActive}  serverId=${s.mcpServerId}  toolName=${s.mcpToolName}`,
    );
  }
  if (afterAdd.length !== 3) {
    issues += 1;
    log(`  ⚠ erwartet 3 Skills, gefunden ${afterAdd.length}`);
  }
  if (afterAdd.some((s) => s.source !== "mcp")) {
    issues += 1;
    log(`  ⚠ source=mcp ist nicht überall gesetzt`);
  }
  if (afterAdd.some((s) => s.mcpServerId !== server.id)) {
    issues += 1;
    log(`  ⚠ mcpServerId nicht überall korrekt`);
  }
  if (
    !afterAdd.some((s) => s.name === `mcp:${TEST_SERVER_NAME}:echo`) ||
    !afterAdd.some((s) => s.name === `mcp:${TEST_SERVER_NAME}:add`)
  ) {
    issues += 1;
    log(`  ⚠ Naming-Convention 'mcp:<server>:<tool>' nicht eingehalten`);
  }

  // ─── STEP 3: findByMcpTool ────────────────────────────────────────────────
  banner("STEP 3 — findByMcpTool()");
  const echoSkill = skillRepo.findByMcpTool(server.id, "echo");
  if (!echoSkill || echoSkill.name !== `mcp:${TEST_SERVER_NAME}:echo`) {
    issues += 1;
    log(`  ⚠ findByMcpTool('echo') nicht gefunden / falsches Naming`);
  } else {
    log(`  gefunden: ${echoSkill.name} (${echoSkill.skillId})`);
    if (echoSkill.manifestJson.capability !== "mcp_tool") {
      issues += 1;
      log(`  ⚠ manifest.capability sollte 'mcp_tool' sein`);
    }
    if (echoSkill.manifestJson.requiresApproval !== true) {
      issues += 1;
      log(
        `  ⚠ manifest.requiresApproval sollte true sein (Server-Default)`,
      );
    }
  }

  // ─── STEP 4: Refresh — keine Änderungen ───────────────────────────────────
  banner("STEP 4 — refresh() ohne Änderungen");
  const refreshNoOp = await sync.refresh(server.id);
  log(
    `  added=${refreshNoOp.added}, deactivated=${refreshNoOp.deactivated}, unchanged=${refreshNoOp.unchanged}`,
  );
  if (
    refreshNoOp.added !== 0 ||
    refreshNoOp.deactivated !== 0 ||
    refreshNoOp.unchanged !== 3
  ) {
    issues += 1;
    log(`  ⚠ erwartet added=0 deactivated=0 unchanged=3`);
  }

  // ─── STEP 5: Refresh-Diff (longRunning weg, newTool dazu) ─────────────────
  banner("STEP 5 — refresh() mit Diff");
  toolsRef.current = [
    { name: "echo", description: "Echoes back the input message" },
    { name: "add", description: "Adds two numbers" },
    { name: "newTool", description: "A brand-new tool" },
  ];
  const refreshResult = await sync.refresh(server.id);
  log(
    `  added=${refreshResult.added}, deactivated=${refreshResult.deactivated}, unchanged=${refreshResult.unchanged}`,
  );
  if (
    refreshResult.added !== 1 ||
    refreshResult.deactivated !== 1 ||
    refreshResult.unchanged !== 2
  ) {
    issues += 1;
    log(`  ⚠ erwartet added=1 deactivated=1 unchanged=2`);
  }

  // ─── STEP 6: longRunning ist inaktiv, newTool ist aktiv ───────────────────
  banner("STEP 6 — Status nach Refresh");
  const longRun = skillRepo.findByMcpTool(server.id, "longRunningOperation");
  const newTool = skillRepo.findByMcpTool(server.id, "newTool");
  log(`  longRunning.isActive: ${longRun?.isActive}`);
  log(`  newTool.isActive:     ${newTool?.isActive}`);
  if (longRun?.isActive !== false) {
    issues += 1;
    log(`  ⚠ longRunning sollte inactive sein`);
  }
  if (newTool?.isActive !== true) {
    issues += 1;
    log(`  ⚠ newTool sollte active sein`);
  }

  // ─── STEP 7: Reaktivierung — longRunning kommt zurück ─────────────────────
  banner("STEP 7 — Reaktivierung beim erneuten Refresh");
  toolsRef.current = [
    { name: "echo", description: "Echoes back the input message" },
    { name: "add", description: "Adds two numbers" },
    { name: "newTool", description: "A brand-new tool" },
    {
      name: "longRunningOperation",
      description: "Demonstrates long-running tool",
    },
  ];
  const reactivate = await sync.refresh(server.id);
  log(
    `  added=${reactivate.added}, deactivated=${reactivate.deactivated}, unchanged=${reactivate.unchanged}`,
  );
  const longRun2 = skillRepo.findByMcpTool(server.id, "longRunningOperation");
  log(`  longRunning.isActive nach Re-Refresh: ${longRun2?.isActive}`);
  if (longRun2?.isActive !== true) {
    issues += 1;
    log(`  ⚠ longRunning sollte reaktiviert sein`);
  }
  if (reactivate.added !== 0 || reactivate.unchanged !== 4) {
    issues += 1;
    log(`  ⚠ erwartet added=0 unchanged=4 (Reaktivierung zählt als unchanged)`);
  }

  // ─── STEP 8: Conflict — manuelles Skill mit gleichem Namen ────────────────
  banner("STEP 8 — Conflict mit manual-Skill");
  // Server #2 mit Tool das den Name-Slot eines fertigen Skills besetzt.
  const conflictTool = "echo-conflict";
  const conflictName = `mcp:_test-mcp-sync-conflict:${conflictTool}`;
  // Manuellen Skill als Platzhalter anlegen.
  skillRepo.add({
    twinId: profile.twinId,
    name: conflictName,
    description: "Manuell, blockt das Naming",
    manifestJson: {
      name: conflictName,
      description: "Manuell, blockt das Naming",
      capability: "respond_to_chat",
      requiresApproval: false,
    },
    instructionsMd: "manuell",
    source: "manual",
  });
  const conflictServer = mcpRepo.add({
    twinId: profile.twinId,
    name: "_test-mcp-sync-conflict",
    transport: "stdio",
    command: "fake-command",
    args: [],
  });
  toolsRef.current = [{ name: conflictTool, description: "would conflict" }];
  const conflictResult = await sync.syncOnAdd(conflictServer.id);
  log(
    `  added=${conflictResult.added}, skipped=${conflictResult.skipped}`,
  );
  if (conflictResult.added !== 0 || conflictResult.skipped !== 1) {
    issues += 1;
    log(`  ⚠ erwartet added=0 skipped=1 (Conflict-Skipping)`);
  }
  // Keine Skill mit (mcpServer=conflictServer.id) sollte angelegt worden sein.
  const conflictDbSkills = skillRepo.listByMcpServer(conflictServer.id);
  if (conflictDbSkills.length !== 0) {
    issues += 1;
    log(
      `  ⚠ erwartet 0 mcp-Skills für Conflict-Server, gefunden ${conflictDbSkills.length}`,
    );
  }

  // ─── STEP 9: Cascade-Delete — Server.remove löscht alle Skills ────────────
  banner("STEP 9 — Cascade-Delete");
  const beforeCount = skillRepo.listByMcpServer(server.id).length;
  log(`  vor remove: ${beforeCount} Skills`);
  mcpRepo.remove(server.id);
  const afterCount = skillRepo.listByMcpServer(server.id).length;
  log(`  nach remove: ${afterCount} Skills`);
  if (afterCount !== 0) {
    issues += 1;
    log(`  ⚠ Cascade-Delete hat versagt`);
  }

  // Conflict-Skill-Manuell soll noch da sein (ist nicht an conflictServer
  // gebunden — er war ja vor dem Server da).
  const manualStill = skillRepo.findByName(profile.twinId, conflictName);
  if (!manualStill) {
    issues += 1;
    log(`  ⚠ manueller Skill wurde mit-gelöscht`);
  } else {
    log(`  ✓ manueller Skill steht noch (${manualStill.skillId})`);
  }

  // ─── STEP 10: Manager + Conflict-Server cleanup ───────────────────────────
  banner("STEP 10 — Cleanup Conflict-Server");
  mcpRepo.remove(conflictServer.id);
  // Manuellen Skill auch wegräumen — kein Cascade.
  if (manualStill) skillRepo.remove(manualStill.skillId);
  await manager.dispose();

  // ─── STEP 11: Final-Cleanup ───────────────────────────────────────────────
  banner("STEP 11 — Cleanup");
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
  // mcp_servers cascadet skills, daher reicht das Remove der Test-Server.
  db.prepare(
    "DELETE FROM mcp_servers WHERE twin_id = ? AND name LIKE '_test-mcp%'",
  ).run(twinId);
  // Manual-Test-Skills falls Voraufläufe etwas hinterlassen.
  db.prepare(
    "DELETE FROM skills WHERE twin_id = ? AND name LIKE 'mcp:_test-mcp%'",
  ).run(twinId);
}

main().catch((err) => {
  console.error(
    "\n[mcp-skill-sync:test] Fehler:",
    err instanceof Error ? err.message : err,
  );
  process.exit(1);
});
