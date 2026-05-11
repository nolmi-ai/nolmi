import {
  loadFactsCliContext,
  printFactsTable,
} from "./_facts-cli-helpers.js";

// ─── twin:facts-list (CLI) ──────────────────────────────────────────────────
//
// Listet alle Facts eines Twins. Pretty-Print fürs Auge, --json fürs
// Scripting (z.B. Pipe in jq, Snapshot in Files).
//
// Aufruf:
//   pnpm twin:facts-list @markus
//   pnpm twin:facts-list @markus --json

const USAGE = "Nutzung:\n  pnpm twin:facts-list <handle> [--json]";

async function main() {
  const args = process.argv.slice(2);
  const json = args.includes("--json");
  const positional = args.filter((a) => !a.startsWith("--"));
  const rawHandle = positional[0];
  if (!rawHandle) {
    console.error(USAGE);
    process.exit(1);
  }

  const ctx = await loadFactsCliContext(rawHandle);
  try {
    // listByTwin liefert bereits alphabetisch nach factKey (Default-Sortierung
    // im Repo aus 3.3.A).
    const facts = ctx.factsRepo.listByTwin(ctx.twin.twinId);

    if (json) {
      console.log(JSON.stringify({ facts }, null, 2));
      return;
    }

    printFactsTable(ctx.twin.handle, facts);
  } finally {
    await ctx.cleanup();
  }
}

main().catch((err) => {
  console.error(
    "[facts-list] Fehler:",
    err instanceof Error ? err.message : err,
  );
  process.exit(1);
});
