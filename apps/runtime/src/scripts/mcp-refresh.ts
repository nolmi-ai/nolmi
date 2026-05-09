import {
  loadMcpCliContext,
  resolveServer,
} from "./_mcp-cli-helpers.js";

// ─── twin:mcp-refresh (CLI) ─────────────────────────────────────────────────
//
// Manueller Tool-Discovery-Refresh: spawnt den Server, listTools, diff't
// gegen die DB. Neue Tools landen als Skills mit isActive=true; entfernte
// Tools werden auf isActive=false gesetzt (kein DELETE — User-Toggle bleibt
// erhalten). Reaktivierung wieder erscheinender Tools auch hier.
//
// Aufruf:
//   pnpm twin:mcp-refresh <handle> <server-name-or-id>

const USAGE =
  "Nutzung:\n  pnpm twin:mcp-refresh <handle> <server-name-or-id>";

async function main() {
  const [, , rawHandle, nameOrId] = process.argv;
  if (!rawHandle || !nameOrId) {
    console.error(USAGE);
    process.exit(1);
  }

  const ctx = await loadMcpCliContext(rawHandle);
  try {
    const server = resolveServer(ctx, nameOrId);
    console.log(
      `[mcp-refresh] Twin: ${ctx.twin.handle}, Server: ${server.name} (${server.id})`,
    );
    console.log(`[mcp-refresh] Spawning + listTools …`);

    const result = await ctx.sync.refresh(server.id);
    console.log(
      `[mcp-refresh] ✓ Tools refreshed: ${result.added} added, ${result.deactivated} deactivated, ${result.unchanged} unchanged`,
    );
  } finally {
    await ctx.cleanup();
  }
}

main().catch((err) => {
  console.error(
    "[mcp-refresh] Fehler:",
    err instanceof Error ? err.message : err,
  );
  process.exit(1);
});
