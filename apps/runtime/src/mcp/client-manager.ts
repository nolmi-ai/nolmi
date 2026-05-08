import type {
  McpClientFactory,
  McpClientLike,
} from "./client-factory.js";
import type { McpServersRepo } from "./repo.js";
import { MCP_IDLE_TIMEOUT_MS } from "./config.js";

// ─── MCP CLIENT MANAGER (Phase 3.2 Sub-Schritt B) ───────────────────────────
//
// Eine Instanz pro Twin. Hält die Subprocess-Zustände aller Server, die der
// Twin während dieses Runtime-Lebens benutzt hat:
//
//   - Lazy-Spawn: kein listTools/callTool, kein Subprocess. Erste Anfrage
//     spawnt; danach reuse.
//   - Idle-Cleanup: jedes (re-)spawn setzt einen Timer. Activity (call/list)
//     reset'tet ihn. Nach MCP_IDLE_TIMEOUT_MS ohne Activity wird der Server
//     graceful disconnected.
//   - Race-Mutex: zwei parallele callTool/listTool für denselben Server, der
//     noch nicht gespawnt ist, teilen sich die in-flight Spawn-Promise.
//     Pattern aus TwinServiceRegistry.pendingAdds (2.5.6 Phase A.3).
//   - Fail-Fast: Spawn-Errors werfen direkt, kein Retry. Caller (Sub-D)
//     entscheidet, ob das ein Audit-fail oder ein LLM-Antwort-Fallback wird.
//
// disposeAll-Pfad: Manager wird vom TwinService besessen, der wiederum von
// der TwinServiceRegistry. Container-Shutdown (SIGTERM/SIGINT) → Registry.
// disposeAll() → TwinService.dispose() → manager.dispose() → alle Clients
// disconnecten parallel.

interface ManagedClient {
  client: McpClientLike;
  lastActivityAt: number;
  idleTimer: NodeJS.Timeout;
}

export class McpServerInactiveError extends Error {
  constructor(serverId: string) {
    super(`MCP-Server ${serverId} ist deaktiviert (is_active=false)`);
    this.name = "McpServerInactiveError";
  }
}

export class McpServerNotSupportedError extends Error {
  constructor(serverId: string, transport: string) {
    super(
      `MCP-Server ${serverId}: transport='${transport}' wird in 3.2.B noch nicht unterstützt (nur stdio)`,
    );
    this.name = "McpServerNotSupportedError";
  }
}

export class McpServerSpawnError extends Error {
  constructor(serverId: string, reason: string, public readonly cause?: unknown) {
    super(`MCP-Server ${serverId}: Spawn fehlgeschlagen — ${reason}`);
    this.name = "McpServerSpawnError";
  }
}

export interface McpClientManagerOptions {
  /**
   * Override für den Idle-Timeout. Default ist {@link MCP_IDLE_TIMEOUT_MS}
   * (ENV-getunbar). Tests passen kurze Werte (z.B. 100ms) per Constructor
   * direkt rein — das ist deterministischer als ENV-Mutation, weil die
   * ENV-Konstante in `config.ts` zur Import-Zeit resolved.
   */
  idleTimeoutMs?: number;
}

export class McpClientManager {
  private readonly managed = new Map<string, ManagedClient>();
  private readonly pendingSpawns = new Map<string, Promise<McpClientLike>>();
  private readonly idleTimeoutMs: number;
  private disposed = false;

  constructor(
    private readonly twinId: string,
    private readonly repo: McpServersRepo,
    private readonly factory: McpClientFactory,
    options: McpClientManagerOptions = {},
  ) {
    this.idleTimeoutMs = options.idleTimeoutMs ?? MCP_IDLE_TIMEOUT_MS;
  }

  /**
   * Liefert die Tools eines Servers. Spawnt lazy beim ersten Aufruf für eine
   * serverId. Reset'tet den Idle-Timer.
   */
  async listTools(serverId: string): Promise<
    Array<{ name: string; description?: string; inputSchema: unknown }>
  > {
    const client = await this.getOrSpawn(serverId);
    this.touchActivity(serverId);
    return client.listTools();
  }

  /**
   * Ruft ein Tool auf. Spawnt lazy beim ersten Aufruf. Reset'tet den
   * Idle-Timer.
   */
  async callTool(
    serverId: string,
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<{
    content: Array<{ type: string; text?: string; [key: string]: unknown }>;
    isError?: boolean;
  }> {
    const client = await this.getOrSpawn(serverId);
    this.touchActivity(serverId);
    return client.callTool(toolName, args);
  }

  /**
   * Trennt den Server explizit. No-Op, wenn nicht connected. Idempotent —
   * wird auch vom Idle-Timer aufgerufen, daher müssen wir defensiv mit
   * doppelten Aufrufen umgehen.
   */
  async disconnect(serverId: string): Promise<void> {
    const entry = this.managed.get(serverId);
    if (!entry) return;
    this.managed.delete(serverId);
    clearTimeout(entry.idleTimer);
    console.log(
      `[mcp] explicit disconnect: ${entry.client.serverName} (twin=${this.twinId})`,
    );
    try {
      await entry.client.disconnect();
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      console.warn(
        `[mcp] disconnect-Fehler ${entry.client.serverName} (twin=${this.twinId}): ${reason}`,
      );
    }
  }

  /**
   * Beendet alle gehaltenen Subprocesses parallel. Wird von
   * TwinService.dispose() bei Registry.disposeAll() gerufen — Shutdown-Path.
   * Nach dispose() ist der Manager nicht mehr nutzbar (weitere Calls werfen).
   */
  async dispose(): Promise<void> {
    this.disposed = true;
    const ids = [...this.managed.keys()];
    await Promise.all(ids.map((id) => this.disconnect(id)));
  }

  /**
   * Hot-Path: Server-Spawn-or-Reuse. Wenn schon ein ManagedClient existiert,
   * direkt zurück. Wenn ein Spawn in-flight ist (Race), warten. Sonst neu
   * spawnen und die Promise registrieren, damit parallele Caller nicht eigene
   * Subprocesses starten.
   */
  private async getOrSpawn(serverId: string): Promise<McpClientLike> {
    if (this.disposed) {
      throw new Error(
        `McpClientManager (twin=${this.twinId}) ist disposed — keine neuen Tool-Calls möglich`,
      );
    }

    const existing = this.managed.get(serverId);
    if (existing) return existing.client;

    const inflight = this.pendingSpawns.get(serverId);
    if (inflight) return inflight;

    const promise = this.spawn(serverId);
    this.pendingSpawns.set(serverId, promise);
    try {
      return await promise;
    } finally {
      this.pendingSpawns.delete(serverId);
    }
  }

  private async spawn(serverId: string): Promise<McpClientLike> {
    // findById wirft McpServerNotFoundError — propagiert direkt.
    const config = this.repo.findById(serverId);
    if (!config.isActive) {
      throw new McpServerInactiveError(serverId);
    }
    if (config.transport !== "stdio") {
      throw new McpServerNotSupportedError(serverId, config.transport);
    }
    if (!config.command) {
      // Validation im Repo schützt davor, aber defensive Sanity-Prüfung —
      // falls jemand die DB hinten rum verändert, wollen wir keine NPE.
      throw new McpServerSpawnError(
        serverId,
        "command ist nicht gesetzt (DB inkonsistent?)",
      );
    }

    const env = this.repo.getDecryptedEnv(serverId);
    const client = this.factory.create(config.name, this.twinId);

    console.log(
      `[mcp] spawning server: ${config.name} (twin=${this.twinId}, command=${config.command})`,
    );
    const startedAt = Date.now();

    try {
      await client.connect({
        command: config.command,
        args: config.args ?? [],
        env: env ?? undefined,
      });
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      console.warn(
        `[mcp] spawn failed: ${config.name} (twin=${this.twinId}, error=${reason})`,
      );
      throw new McpServerSpawnError(serverId, reason, err);
    }

    // Beim erfolgreichen Spawn loggen wir tools=<n> mit, damit auf einen Blick
    // klar ist, ob der Server überhaupt Tools advertised. Wenn listTools()
    // selbst wirft, lassen wir den Fehler durchschlagen — der Manager ist
    // dann in einem inkonsistenten Zustand (Subprocess läuft, kein Tool-
    // Listing). Also bei Fehler den Client wieder disconnecten.
    let toolCount = 0;
    try {
      const tools = await client.listTools();
      toolCount = tools.length;
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      console.warn(
        `[mcp] post-spawn listTools failed: ${config.name} (twin=${this.twinId}, error=${reason})`,
      );
      try {
        await client.disconnect();
      } catch {
        // ignore — wir sind schon im Fehler-Pfad
      }
      throw new McpServerSpawnError(
        serverId,
        `Server gespawnt, listTools() schlug fehl: ${reason}`,
        err,
      );
    }

    const duration = Date.now() - startedAt;
    console.log(
      `[mcp] spawn complete: ${config.name} (twin=${this.twinId}, duration=${duration}ms, tools=${toolCount})`,
    );

    const idleTimer = setTimeout(() => {
      this.handleIdleTimeout(serverId).catch((err) => {
        console.warn(
          `[mcp] idle-disconnect Fehler für ${serverId}:`,
          err instanceof Error ? err.message : err,
        );
      });
    }, this.idleTimeoutMs);
    // Subprocess hält Event-Loop ohnehin am Leben; der Timer braucht das nicht.
    // Ohne unref() würde der Timer den Runtime-Exit blockieren, falls der
    // Subprocess sauber endet.
    idleTimer.unref();

    this.managed.set(serverId, {
      client,
      lastActivityAt: Date.now(),
      idleTimer,
    });
    return client;
  }

  private touchActivity(serverId: string): void {
    const entry = this.managed.get(serverId);
    if (!entry) return;
    entry.lastActivityAt = Date.now();
    clearTimeout(entry.idleTimer);
    entry.idleTimer = setTimeout(() => {
      this.handleIdleTimeout(serverId).catch((err) => {
        console.warn(
          `[mcp] idle-disconnect Fehler für ${serverId}:`,
          err instanceof Error ? err.message : err,
        );
      });
    }, this.idleTimeoutMs);
    entry.idleTimer.unref();
  }

  private async handleIdleTimeout(serverId: string): Promise<void> {
    const entry = this.managed.get(serverId);
    if (!entry) return;
    const idleMs = Date.now() - entry.lastActivityAt;
    const idleMin = (idleMs / 60000).toFixed(1);
    console.log(
      `[mcp] idle disconnect: ${entry.client.serverName} (twin=${this.twinId}, idle=${idleMin}m)`,
    );
    this.managed.delete(serverId);
    clearTimeout(entry.idleTimer);
    try {
      await entry.client.disconnect();
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      console.warn(
        `[mcp] idle-disconnect Fehler ${entry.client.serverName} (twin=${this.twinId}): ${reason}`,
      );
    }
  }
}
