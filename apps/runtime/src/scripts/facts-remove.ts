import {
  confirm,
  loadFactsCliContext,
} from "./_facts-cli-helpers.js";

// ─── twin:facts-remove (CLI) ────────────────────────────────────────────────
//
// Hartes DELETE eines Facts. Mit --yes / -y wird der Confirm-Prompt
// übersprungen (für Scripting).
//
// Aufruf:
//   pnpm twin:facts-remove @markus wife_name
//   pnpm twin:facts-remove @markus city --yes

const USAGE =
  "Nutzung:\n  pnpm twin:facts-remove <handle> <key> [--yes]";

async function main() {
  const args = process.argv.slice(2);
  const yes = args.includes("--yes") || args.includes("-y");
  const positional = args.filter(
    (a) => !a.startsWith("--") && a !== "-y",
  );
  const rawHandle = positional[0];
  const factKey = positional[1];
  if (!rawHandle || !factKey) {
    console.error(USAGE);
    process.exit(1);
  }

  const ctx = await loadFactsCliContext(rawHandle);
  try {
    const existing = ctx.factsRepo.get(ctx.twin.twinId, factKey);
    if (!existing) {
      console.error(
        `[facts-remove] Fact '${factKey}' für Twin ${ctx.twin.handle} nicht gefunden.`,
      );
      process.exit(1);
    }

    console.log(
      `[facts-remove] Fact: ${existing.factKey} → ${existing.factValue} ` +
        `(source=${existing.source}, confidence=${existing.confidence})`,
    );

    if (!yes) {
      const proceed = await confirm(
        "[facts-remove] Wirklich löschen? [y/N]: ",
      );
      if (!proceed) {
        console.log("[facts-remove] Abgebrochen — keine Änderung an der DB.");
        return;
      }
    }

    const removed = ctx.factsRepo.delete(ctx.twin.twinId, factKey);
    if (!removed) {
      // Race: Fact wurde zwischen get() und delete() entfernt — extrem
      // unwahrscheinlich, aber dann sagen wir's ehrlich.
      console.error(
        "[facts-remove] Fact war zum Lösch-Zeitpunkt schon weg — kein DELETE.",
      );
      process.exit(1);
    }
    console.log(`[facts-remove] ✗ Fact gelöscht: ${factKey}`);
  } finally {
    await ctx.cleanup();
  }
}

main().catch((err) => {
  console.error(
    "[facts-remove] Fehler:",
    err instanceof Error ? err.message : err,
  );
  process.exit(1);
});
