import { McpClient } from "./client.js";

// ─── MCP CLIENT FACTORY (Phase 3.2 Sub-Schritt B) ───────────────────────────
//
// Reine Indirektion zwischen Manager und McpClient-Konstruktor. Existiert
// damit Tests einen Mock-Client injizieren können, ohne den Manager
// monkey-patchen zu müssen. Production nutzt defaultMcpClientFactory; Tests
// bauen ein Objekt das das gleiche Interface erfüllt.

export interface McpClientLike {
  readonly serverName: string;
  readonly twinId: string;
  connect(config: {
    command: string;
    args: string[];
    env?: Record<string, string>;
  }): Promise<void>;
  listTools(): Promise<
    Array<{ name: string; description?: string; inputSchema: unknown }>
  >;
  callTool(
    name: string,
    args: Record<string, unknown>,
  ): Promise<{
    content: Array<{ type: string; text?: string; [key: string]: unknown }>;
    isError?: boolean;
  }>;
  disconnect(): Promise<void>;
  isConnected(): boolean;
}

export interface McpClientFactory {
  create(serverName: string, twinId: string): McpClientLike;
}

export const defaultMcpClientFactory: McpClientFactory = {
  create(serverName, twinId) {
    return new McpClient(serverName, twinId);
  },
};
