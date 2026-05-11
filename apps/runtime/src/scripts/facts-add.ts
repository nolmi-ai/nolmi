import {
  confirm,
  loadFactsCliContext,
  parseSourceFlag,
  validateFactInput,
} from "./_facts-cli-helpers.js";

// ─── twin:facts-add (CLI) ───────────────────────────────────────────────────
//
// Fügt einen Fact hinzu (oder überschreibt mit --force). Defaults:
//   - source = user
//   - confidence = approved
//
// Flags:
//   --pending             confidence = pending (statt approved)
//   --source <s>          user | twin | import (Default: user)
//   --force               überschreibt vorhandenen Key ohne Confirm-Prompt
//
// Aufruf:
//   pnpm twin:facts-add @markus wife_name Anna
//   pnpm twin:facts-add @markus city "Roding" --pending
//   pnpm twin:facts-add @markus company "Harway Experience" --source twin --force

const USAGE =
  "Nutzung:\n  pnpm twin:facts-add <handle> <key> <value> [--pending] [--source user|twin|import] [--force]";

async function main() {
  const args = process.argv.slice(2);

  // Flag-Parsing: --source verbraucht den nächsten positionalen Wert.
  let pending = false;
  let force = false;
  let sourceRaw: string | undefined;
  const positional: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === "--pending") {
      pending = true;
    } else if (a === "--force") {
      force = true;
    } else if (a === "--source") {
      sourceRaw = args[++i];
    } else if (a.startsWith("--source=")) {
      sourceRaw = a.slice("--source=".length);
    } else if (a.startsWith("--")) {
      console.error(`Unbekannter Flag: ${a}`);
      console.error(USAGE);
      process.exit(1);
    } else {
      positional.push(a);
    }
  }

  const rawHandle = positional[0];
  const factKey = positional[1];
  // Value-Argumente an Index 2..* zusammenkleben — damit unquoted Mehrwort-
  // Werte trotzdem als ein Value durchgehen (CLI-Convenience).
  const factValue = positional.slice(2).join(" ");
  if (!rawHandle || !factKey || !factValue) {
    console.error(USAGE);
    process.exit(1);
  }

  validateFactInput(factKey, factValue);
  const source = parseSourceFlag(sourceRaw);
  const confidence = pending ? "pending" : "approved";

  const ctx = await loadFactsCliContext(rawHandle);
  try {
    const existing = ctx.factsRepo.get(ctx.twin.twinId, factKey);
    if (existing && !force) {
      console.log(
        `[facts-add] Fact '${factKey}' existiert bereits (Wert: '${existing.factValue}').`,
      );
      const proceed = await confirm("[facts-add] Überschreiben? [y/N]: ");
      if (!proceed) {
        console.log("[facts-add] Abgebrochen — keine Änderung an der DB.");
        return;
      }
    }

    const fact = ctx.factsRepo.upsert({
      twinId: ctx.twin.twinId,
      factKey,
      factValue,
      source,
      confidence,
    });

    const verb = existing ? "aktualisiert" : "angelegt";
    console.log(
      `[facts-add] ✓ Fact ${verb}: ${fact.factKey} → ${fact.factValue} ` +
        `(source=${fact.source}, confidence=${fact.confidence})`,
    );
  } finally {
    await ctx.cleanup();
  }
}

main().catch((err) => {
  console.error(
    "[facts-add] Fehler:",
    err instanceof Error ? err.message : err,
  );
  process.exit(1);
});
