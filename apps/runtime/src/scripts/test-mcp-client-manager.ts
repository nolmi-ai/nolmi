import "dotenv/config";
import Database from "better-sqlite3";
import { loadRuntimeConfig } from "../config.js";
import { TwinProfilesRepo } from "../twin-profiles-repo.js";
import { loadMasterKey } from "../crypto-utils.js";
import { McpServersRepo } from "../mcp/repo.js";
import {
  McpClientManager,
  McpServerInactiveError,
  McpServerSpawnError,
} from "../mcp/client-manager.js";
import type {
  McpClientFactory,
  McpClientLike,
} from "../mcp/client-factory.js";

// Idle-Timeout fürs Idle-Timeout-Test-Step deterministisch klein halten —
// per Constructor-Option, statt MCP_IDLE_TIMEOUT_MS-ENV zu mutieren (ESM
// hoisted Imports vor Body-Code; ENV-Mutation am Skript-Anfang käme zu spät).
const TEST_IDLE_MS = 100;

// ─── TEST: MCP-CLIENT-MANAGER (Phase 3.2.B) ─────────────────────────────────
//
// Komplett mock-basiert — wir spawnen keinen echten Subprocess. Test-Server
// in der DB ist nur dazu da, Repo-Lookups (findById, getDecryptedEnv) zu
// triggern. Die Mock-Factory liefert Clients, die das McpClientLike-Interface
// erfüllen, und wir kontrollieren, was connect/listTools/callTool/disconnect
// zurückgeben oder werfen.
//
// Idle-Timeout-Test setzt MCP_IDLE_TIMEOUT_MS=100ms ganz am Anfang (vor dem
// Modul-Import), damit der Test in <1s durchläuft statt 5 Minuten zu warten.
//
// Voraussetzung: pnpm db:init lief, NOLMI_ENCRYPTION_KEY gesetzt,
// Test-Twin (default @markus) existiert.
//
// Aufruf:
//   pnpm --filter @nolmi/runtime tsx src/scripts/test-mcp-client-manager.ts

const TWIN_HANDLE_DEFAULT = "@markus";
const TEST_SERVER_NAME = "_test-mcp-manager";

// ─── Mock-Client-Factory ────────────────────────────────────────────────────
//
// Erfüllt McpClientLike. Tracking-Felder zeigen den Test-Steps, was passiert
// ist (connectCalls, listToolsCalls, etc.). Verhalten lässt sich pro Test
// per setBehavior konfigurieren.

interface MockBehavior {
  connectMs?: number;
  connectThrows?: Error;
  listToolsResult?: Array<{
    name: string;
    description?: string;
    inputSchema: unknown;
  }>;
  callToolResult?: {
    content: Array<{ type: string; text?: string; [key: string]: unknown }>;
    isError?: boolean;
  };
  disconnectMs?: number;
}

class MockMcpClient implements McpClientLike {
  public connectCalls = 0;
  public listToolsCalls = 0;
  public callToolCalls: Array<{ name: string; args: Record<string, unknown> }> =
    [];
  public disconnectCalls = 0;
  private connected = false;
  private behavior: MockBehavior = {
    listToolsResult: [{ name: "echo", inputSchema: {} }],
    callToolResult: { content: [{ type: "text", text: "ok" }] },
    connectMs: 50,
    disconnectMs: 10,
  };

  constructor(
    public readonly serverName: string,
    public readonly twinId: string,
  ) {}

  setBehavior(b: Partial<MockBehavior>) {
    this.behavior = { ...this.behavior, ...b };
  }

  async connect(): Promise<void> {
    this.connectCalls += 1;
    if (this.behavior.connectMs) await sleep(this.behavior.connectMs);
    if (this.behavior.connectThrows) throw this.behavior.connectThrows;
    this.connected = true;
  }
  async listTools() {
    this.listToolsCalls += 1;
    return this.behavior.listToolsResult ?? [];
  }
  async callTool(name: string, args: Record<string, unknown>) {
    this.callToolCalls.push({ name, args });
    return (
      this.behavior.callToolResult ?? {
        content: [{ type: "text", text: "ok" }],
      }
    );
  }
  async disconnect(): Promise<void> {
    this.disconnectCalls += 1;
    if (this.behavior.disconnectMs) await sleep(this.behavior.disconnectMs);
    this.connected = false;
  }
  isConnected(): boolean {
    return this.connected;
  }
}

class MockFactory implements McpClientFactory {
  public created: MockMcpClient[] = [];
  // Optionaler Override pro Server-Name (für gezielte Behaviors).
  public preset = new Map<string, Partial<MockBehavior>>();

  create(serverName: string, twinId: string): McpClientLike {
    const c = new MockMcpClient(serverName, twinId);
    const preset = this.preset.get(serverName);
    if (preset) c.setBehavior(preset);
    this.created.push(c);
    return c;
  }
  reset() {
    this.created = [];
  }
}

async function main() {
  const masterKey = loadMasterKey();
  const config = loadRuntimeConfig();
  const db = new Database(config.dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  const profilesRepo = new TwinProfilesRepo(db);
  const repo = new McpServersRepo(db, masterKey);

  const profile = profilesRepo.findByHandle(TWIN_HANDLE_DEFAULT);
  if (!profile) {
    throw new Error(`Twin '${TWIN_HANDLE_DEFAULT}' nicht in DB.`);
  }
  log(`Test-Twin: ${profile.handle} (${profile.twinId})`);

  // Reset von Voraufläufen.
  cleanup(db, profile.twinId);

  // Test-Server anlegen — wird vom Manager via repo.findById gelookupt.
  const server = repo.add({
    twinId: profile.twinId,
    name: TEST_SERVER_NAME,
    transport: "stdio",
    command: "fake-command-not-actually-spawned",
    args: ["--test"],
  });
  log(`Test-Server: ${server.id} (${server.name})`);

  let issues = 0;

  // ─── STEP 1: Lazy-Spawn beim ersten listTools ─────────────────────────────
  banner("STEP 1 — Lazy-Spawn beim ersten listTools()");
  {
    const factory = new MockFactory();
    const manager = new McpClientManager(profile.twinId, repo, factory, {
      idleTimeoutMs: TEST_IDLE_MS,
    });
    const tools = await manager.listTools(server.id);
    log(`  factory.created.length: ${factory.created.length}`);
    log(`  client.connectCalls:    ${factory.created[0]?.connectCalls}`);
    log(`  tools:                  ${tools.map((t) => t.name).join(",")}`);
    if (factory.created.length !== 1) {
      issues += 1;
      log(`  ⚠ erwartet 1 Client, gefunden ${factory.created.length}`);
    }
    if (factory.created[0]?.connectCalls !== 1) {
      issues += 1;
      log(`  ⚠ connect() wurde nicht genau 1× gerufen`);
    }
    if (tools.length !== 1 || tools[0]?.name !== "echo") {
      issues += 1;
      log(`  ⚠ tools nicht korrekt durchgereicht`);
    }
    await manager.dispose();
  }

  // ─── STEP 2: Reuse beim zweiten Call ──────────────────────────────────────
  banner("STEP 2 — Reuse: zweiter Call spawnt nicht erneut");
  {
    const factory = new MockFactory();
    const manager = new McpClientManager(profile.twinId, repo, factory, {
      idleTimeoutMs: TEST_IDLE_MS,
    });
    await manager.listTools(server.id);
    const result = await manager.callTool(server.id, "echo", { msg: "hi" });
    log(`  factory.created.length: ${factory.created.length}`);
    log(`  connectCalls (Client0): ${factory.created[0]?.connectCalls}`);
    log(`  callToolCalls:          ${factory.created[0]?.callToolCalls.length}`);
    log(`  result.content[0]:      ${JSON.stringify(result.content[0])}`);
    if (factory.created.length !== 1) {
      issues += 1;
      log(`  ⚠ erwartet 1 Client (Reuse), gefunden ${factory.created.length}`);
    }
    if (factory.created[0]?.connectCalls !== 1) {
      issues += 1;
      log(`  ⚠ connect() sollte nur 1× gerufen werden`);
    }
    await manager.dispose();
  }

  // ─── STEP 3: Idle-Timeout disconnected automatisch ────────────────────────
  banner("STEP 3 — Idle-Timeout disconnected automatisch");
  {
    const factory = new MockFactory();
    const manager = new McpClientManager(profile.twinId, repo, factory, {
      idleTimeoutMs: TEST_IDLE_MS,
    });
    await manager.listTools(server.id);
    log(`  warte 200ms (idle-timeout=100ms)...`);
    await sleep(200);
    const client0 = factory.created[0];
    log(`  disconnectCalls (Client0): ${client0?.disconnectCalls}`);
    if (client0?.disconnectCalls !== 1) {
      issues += 1;
      log(`  ⚠ erwartet 1 disconnect-Call, gefunden ${client0?.disconnectCalls}`);
    }
    // Zweiter Call → neuer Spawn (alter Client wurde idle-disconnected)
    await manager.listTools(server.id);
    log(`  factory.created.length nach 2. Call: ${factory.created.length}`);
    if (factory.created.length !== 2) {
      issues += 1;
      log(`  ⚠ erwartet 2 Clients (re-spawn), gefunden ${factory.created.length}`);
    }
    await manager.dispose();
  }

  // ─── STEP 4: Race — parallele Calls spawnen nur einmal ────────────────────
  banner("STEP 4 — Race: parallele listTools() spawnen einmal");
  {
    const factory = new MockFactory();
    factory.preset.set(TEST_SERVER_NAME, { connectMs: 100 });
    const manager = new McpClientManager(profile.twinId, repo, factory, {
      idleTimeoutMs: TEST_IDLE_MS,
    });
    const [a, b] = await Promise.all([
      manager.listTools(server.id),
      manager.listTools(server.id),
    ]);
    log(`  factory.created.length: ${factory.created.length}`);
    log(`  a.length=${a.length}, b.length=${b.length}`);
    if (factory.created.length !== 1) {
      issues += 1;
      log(`  ⚠ Race-Mutex hat versagt: ${factory.created.length} Spawns statt 1`);
    }
    if (factory.created[0]?.connectCalls !== 1) {
      issues += 1;
      log(`  ⚠ connect() doppelt gerufen trotz Mutex`);
    }
    await manager.dispose();
  }

  // ─── STEP 5: Dispose — alle Clients getrennt ──────────────────────────────
  banner("STEP 5 — dispose() trennt alle Clients");
  {
    const factory = new MockFactory();
    const manager = new McpClientManager(profile.twinId, repo, factory, {
      idleTimeoutMs: TEST_IDLE_MS,
    });
    await manager.listTools(server.id);
    await manager.dispose();
    const client0 = factory.created[0];
    log(`  disconnectCalls: ${client0?.disconnectCalls}`);
    if (client0?.disconnectCalls !== 1) {
      issues += 1;
      log(`  ⚠ disconnect nicht aufgerufen`);
    }
    // Nach dispose() wirft jeder Tool-Call.
    let threwOnDisposed = false;
    try {
      await manager.listTools(server.id);
    } catch (err) {
      if (
        err instanceof Error &&
        err.message.includes("disposed")
      ) {
        threwOnDisposed = true;
      }
    }
    if (!threwOnDisposed) {
      issues += 1;
      log(`  ⚠ Tool-Call nach dispose() hätte werfen müssen`);
    } else {
      log(`  ✓ Tool-Call nach dispose() wirft`);
    }
  }

  // ─── STEP 6: Inactive-Server → wirft McpServerInactiveError ───────────────
  banner("STEP 6 — Inactive-Server wirft");
  {
    repo.setActive(server.id, false);
    const factory = new MockFactory();
    const manager = new McpClientManager(profile.twinId, repo, factory, {
      idleTimeoutMs: TEST_IDLE_MS,
    });
    let thrown: unknown = null;
    try {
      await manager.listTools(server.id);
    } catch (err) {
      thrown = err;
    }
    if (!(thrown instanceof McpServerInactiveError)) {
      issues += 1;
      log(
        `  ⚠ erwartet McpServerInactiveError, gefunden: ${thrown instanceof Error ? thrown.name : String(thrown)}`,
      );
    } else {
      log(`  ✓ McpServerInactiveError geworfen.`);
    }
    if (factory.created.length !== 0) {
      issues += 1;
      log(`  ⚠ Inactive sollte gar keinen Client erzeugen`);
    }
    repo.setActive(server.id, true);
    await manager.dispose();
  }

  // ─── STEP 7: Spawn-Failure → McpServerSpawnError mit cause ────────────────
  banner("STEP 7 — Spawn-Failure wirft McpServerSpawnError");
  {
    const factory = new MockFactory();
    const cause = new Error("simulated connect failure");
    factory.preset.set(TEST_SERVER_NAME, { connectThrows: cause });
    const manager = new McpClientManager(profile.twinId, repo, factory, {
      idleTimeoutMs: TEST_IDLE_MS,
    });
    let thrown: unknown = null;
    try {
      await manager.listTools(server.id);
    } catch (err) {
      thrown = err;
    }
    if (!(thrown instanceof McpServerSpawnError)) {
      issues += 1;
      log(
        `  ⚠ erwartet McpServerSpawnError, gefunden: ${thrown instanceof Error ? thrown.name : String(thrown)}`,
      );
    } else if (thrown.cause !== cause) {
      issues += 1;
      log(`  ⚠ .cause stimmt nicht überein`);
    } else {
      log(`  ✓ McpServerSpawnError geworfen mit cause.`);
    }
    // Nach Spawn-Failure ist der Manager wieder neu nutzbar — pendingSpawns
    // ist gecleared, also würde ein erneuter Call neu spawnen.
    factory.preset.delete(TEST_SERVER_NAME);
    const tools = await manager.listTools(server.id);
    log(`  Recovery-Spawn: ${tools.length} Tool(s) gefunden`);
    await manager.dispose();
  }

  // ─── STEP 8: Cleanup ──────────────────────────────────────────────────────
  banner("STEP 8 — Cleanup");
  cleanup(db, profile.twinId);
  log(`  Test-Server entfernt.`);

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
function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
function cleanup(db: Database.Database, twinId: string) {
  db.prepare(
    "DELETE FROM mcp_servers WHERE twin_id = ? AND name LIKE '_test-mcp%'",
  ).run(twinId);
}

main().catch((err) => {
  console.error(
    "\n[mcp-manager:test] Fehler:",
    err instanceof Error ? err.message : err,
  );
  process.exit(1);
});
