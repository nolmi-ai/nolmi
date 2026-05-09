import {
  formatPlaintextServer,
  loadMcpCliContext,
} from "./_mcp-cli-helpers.js";

// ─── twin:mcp-list (CLI) ────────────────────────────────────────────────────
//
// Listet alle MCP-Server eines Twins inkl. Skill-Stats. Plaintext-Default
// fürs Auge, --json fürs Scripting.
//
// Aufruf:
//   pnpm twin:mcp-list @markus
//   pnpm twin:mcp-list @markus --json

const USAGE = "Nutzung:\n  pnpm twin:mcp-list <handle> [--json]";

async function main() {
  const args = process.argv.slice(2);
  const json = args.includes("--json");
  const positional = args.filter((a) => !a.startsWith("--"));
  const rawHandle = positional[0];
  if (!rawHandle) {
    console.error(USAGE);
    process.exit(1);
  }

  const ctx = await loadMcpCliContext(rawHandle);
  try {
    const servers = ctx.mcpRepo.list(ctx.twin.twinId);

    type ServerWithStats = {
      server: (typeof servers)[number];
      stats: { active: number; inactive: number };
    };
    const enriched: ServerWithStats[] = servers.map((server) => {
      const skills = ctx.skillRepo.listByMcpServer(server.id);
      return {
        server,
        stats: {
          active: skills.filter((s) => s.isActive).length,
          inactive: skills.filter((s) => !s.isActive).length,
        },
      };
    });

    if (json) {
      const payload = enriched.map(({ server, stats }) => ({
        ...server,
        skills: stats,
      }));
      console.log(JSON.stringify(payload, null, 2));
      return;
    }

    const count = servers.length;
    const headerNoun = count === 1 ? "MCP-Server" : "MCP-Server";
    console.log(`${ctx.twin.handle} — ${count} ${headerNoun}`);
    console.log("─".repeat(60));
    if (count === 0) {
      console.log("(keine Server registriert)");
      return;
    }
    for (const { server, stats } of enriched) {
      console.log(formatPlaintextServer(server, stats));
      console.log("");
    }
  } finally {
    await ctx.cleanup();
  }
}

main().catch((err) => {
  console.error(
    "[mcp-list] Fehler:",
    err instanceof Error ? err.message : err,
  );
  process.exit(1);
});
