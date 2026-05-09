import {
  confirm,
  loadMcpCliContext,
  resolveServer,
} from "./_mcp-cli-helpers.js";

// ─── twin:mcp-remove (CLI) ──────────────────────────────────────────────────
//
// Cascade-Delete eines MCP-Servers. Skills mit FK auf den Server fliegen
// dank ON DELETE CASCADE automatisch raus (Migration 012). Wir prompten
// vor dem Remove, wenn aktive Skills dranhängen — `--yes` skippt das für
// Scripting.
//
// Aufruf:
//   pnpm twin:mcp-remove <handle> <server-name-or-id> [--yes]

const USAGE =
  "Nutzung:\n  pnpm twin:mcp-remove <handle> <server-name-or-id> [--yes]";

async function main() {
  const args = process.argv.slice(2);
  const yes = args.includes("--yes") || args.includes("-y");
  const positional = args.filter((a) => !a.startsWith("--") && a !== "-y");
  const rawHandle = positional[0];
  const nameOrId = positional[1];
  if (!rawHandle || !nameOrId) {
    console.error(USAGE);
    process.exit(1);
  }

  const ctx = await loadMcpCliContext(rawHandle);
  try {
    const server = resolveServer(ctx, nameOrId);
    const skills = ctx.skillRepo.listByMcpServer(server.id);
    const skillCount = skills.length;

    console.log(
      `[mcp-remove] Twin: ${ctx.twin.handle}, Server: ${server.name} (${server.id})`,
    );
    console.log(`[mcp-remove] Verknüpfte Skills: ${skillCount}`);

    if (!yes && skillCount > 0) {
      const proceed = await confirm(
        `[mcp-remove] ${skillCount} Skill(s) werden via Cascade-Delete entfernt. Fortfahren? [y/N]: `,
      );
      if (!proceed) {
        console.log("[mcp-remove] Abgebrochen — keine Änderung an der DB.");
        return;
      }
    }

    ctx.mcpRepo.remove(server.id);
    console.log(
      `[mcp-remove] ✓ Server '${server.name}' entfernt (${skillCount} Skills via Cascade)`,
    );
  } finally {
    await ctx.cleanup();
  }
}

main().catch((err) => {
  console.error(
    "[mcp-remove] Fehler:",
    err instanceof Error ? err.message : err,
  );
  process.exit(1);
});
