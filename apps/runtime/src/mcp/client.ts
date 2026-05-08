import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
// HTTP-Transport (Future-Use, in 3.2.B nicht aktiviert):
//   import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import {
  MCP_DISCONNECT_TIMEOUT_MS,
  MCP_SPAWN_TIMEOUT_MS,
} from "./config.js";

// ─── MCP CLIENT (Phase 3.2 Sub-Schritt B) ───────────────────────────────────
//
// Dünner Wrapper um das offizielle @modelcontextprotocol/sdk. Kein eigenes
// JSON-RPC, kein eigenes stdio-Plumbing — wir bündeln nur:
//
//   - Spawn-Timeout (Promise.race): connect() mit Bremse, damit npm-Downloads
//     oder hängende Prozesse den Tool-Call-Pfad nicht ewig blockieren.
//   - Force-Kill-Fallback: erst client.close() (graceful), dann SIGKILL nach
//     MCP_DISCONNECT_TIMEOUT_MS. SDK closet den Subprocess freiwillig, aber
//     wir wollen die Garantie, dass der Prozess am Ende wirklich weg ist.
//   - Schmales Result-Shape: callTool gibt content[] direkt; wir schlucken
//     keine MCP-Felder weg, sondern markieren sie nur als unknown — Sub-D
//     wird das vollständig parsen.
//
// In B nur stdio. HTTP-Transport ist als Import-Kommentar vorbereitet — der
// switch im connect() würde dort einen StreamableHTTPClientTransport bauen.

export interface McpClientSpawnConfig {
  command: string;
  args: string[];
  env?: Record<string, string>;
}

export interface McpToolDefinition {
  name: string;
  description?: string;
  inputSchema: unknown;
}

export interface McpToolResult {
  content: Array<{ type: string; text?: string; [key: string]: unknown }>;
  isError?: boolean;
}

export class McpClientNotConnectedError extends Error {
  constructor(serverName: string) {
    super(`McpClient '${serverName}' ist nicht verbunden`);
    this.name = "McpClientNotConnectedError";
  }
}

export class McpClient {
  private sdkClient: Client | null = null;
  private transport: StdioClientTransport | null = null;
  private connected = false;

  constructor(
    public readonly serverName: string,
    public readonly twinId: string,
  ) {}

  /**
   * Spawnt den Subprocess (stdio) und macht den initialize-Handshake. Wirft
   * mit klarer Diagnose, wenn Timeout oder Connect-Error eintritt — der
   * Manager fängt das und mappt auf McpServerSpawnError.
   *
   * Bei Fehler werden transport/client zurückgesetzt, damit kein halb-
   * verbundener Zustand zurückbleibt. Nach einem geworfenen connect() ist
   * isConnected() === false und die Instanz darf neu connect()-et werden.
   */
  async connect(config: McpClientSpawnConfig): Promise<void> {
    if (this.connected) {
      throw new Error(
        `McpClient '${this.serverName}' ist bereits verbunden — connect() doppelt gerufen`,
      );
    }

    const transport = new StdioClientTransport({
      command: config.command,
      args: config.args,
      env: config.env,
      // stderr "pipe" wäre hilfreich fürs Debugging, aber default "inherit"
      // schreibt direkt ins Runtime-Log und ist für 3.2.B die einfachere Wahl.
    });
    const client = new Client(
      { name: "twin-lab-runtime", version: "0.1.0" },
      { capabilities: {} },
    );

    let timer: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        client.connect(transport),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () =>
              reject(
                new Error(
                  `Spawn-Timeout (${MCP_SPAWN_TIMEOUT_MS}ms) — Server '${this.serverName}' hat sich nicht initialisiert`,
                ),
              ),
            MCP_SPAWN_TIMEOUT_MS,
          );
        }),
      ]);
    } catch (err) {
      // Cleanup, sonst bleibt der Subprocess hängen wenn z.B. Timeout greift
      // bevor der initialize-Handshake durch ist.
      try {
        await transport.close();
      } catch {
        // ignore — wir sind eh im Fehler-Pfad
      }
      throw err;
    } finally {
      if (timer) clearTimeout(timer);
    }

    this.sdkClient = client;
    this.transport = transport;
    this.connected = true;
  }

  isConnected(): boolean {
    return this.connected;
  }

  /**
   * Gibt die vom Server advertisierten Tools zurück. Schlankes Shape für die
   * Manager-/Skill-Sync-Schicht — das volle ListTools-Result hat noch
   * cursor/nextCursor, das bei Servern mit hunderten Tools relevant wird.
   * Für Phase 3.2 reicht der erste Page; Pagination kommt mit Production-
   * Skalierung.
   */
  async listTools(): Promise<McpToolDefinition[]> {
    if (!this.sdkClient || !this.connected) {
      throw new McpClientNotConnectedError(this.serverName);
    }
    const result = await this.sdkClient.listTools();
    return result.tools.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
    }));
  }

  async callTool(
    name: string,
    args: Record<string, unknown>,
  ): Promise<McpToolResult> {
    if (!this.sdkClient || !this.connected) {
      throw new McpClientNotConnectedError(this.serverName);
    }
    const result = await this.sdkClient.callTool({
      name,
      arguments: args,
    });
    return {
      content: (result.content as McpToolResult["content"]) ?? [],
      isError: result.isError as boolean | undefined,
    };
  }

  /**
   * Zwei-stufiges Disconnect: erst client.close() (SDK-graceful, schickt
   * close-Notify und beendet den Subprocess sauber), dann nach Timeout
   * SIGKILL als Fallback. Ohne SIGKILL würden hängende oder sich weigernde
   * Server-Implementierungen den Runtime-Shutdown blockieren.
   *
   * Idempotent: zweiter Aufruf auf nicht-connected-Client ist No-Op (kein
   * Throw), damit der Manager-Cleanup-Pfad robust bleibt.
   */
  async disconnect(): Promise<void> {
    if (!this.connected) return;
    this.connected = false;

    const client = this.sdkClient;
    const transport = this.transport;
    this.sdkClient = null;
    this.transport = null;

    if (!client || !transport) return;

    // PID vor close() greifen — danach könnte transport.pid null sein.
    const pid = transport.pid;

    let killTimer: NodeJS.Timeout | undefined;
    const killPromise = new Promise<void>((resolve) => {
      killTimer = setTimeout(() => {
        if (pid !== null && pid !== undefined) {
          try {
            process.kill(pid, "SIGKILL");
            console.warn(
              `[mcp] force-kill: ${this.serverName} (twin=${this.twinId}, pid=${pid}) — graceful close hat ${MCP_DISCONNECT_TIMEOUT_MS}ms überzogen`,
            );
          } catch {
            // ESRCH = Prozess ist schon weg → genau das, was wir wollen.
          }
        }
        resolve();
      }, MCP_DISCONNECT_TIMEOUT_MS);
    });

    try {
      await Promise.race([client.close(), killPromise]);
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      console.warn(
        `[mcp] disconnect-Fehler bei ${this.serverName} (twin=${this.twinId}): ${reason}`,
      );
    } finally {
      if (killTimer) clearTimeout(killTimer);
    }
  }
}
