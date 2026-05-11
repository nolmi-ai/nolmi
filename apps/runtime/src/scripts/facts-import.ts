import { readFileSync } from "node:fs";
import {
  loadFactsCliContext,
  resolveRepoPath,
  validateFactInput,
} from "./_facts-cli-helpers.js";

// ─── twin:facts-import (CLI) ────────────────────────────────────────────────
//
// Bulk-Import aus Flat-JSON-Object: { "key": "value", ... }. Alle Facts
// werden mit source='import', confidence='approved' angelegt. Bei
// existierendem Key → UPDATE (FactsRepo.upsert greift ON CONFLICT).
//
// Bulk-Pattern: kein BEGIN/COMMIT-Wrapper. better-sqlite3 macht prepared-
// statement-Caching transparent; bei ein paar hundert Facts kein
// Performance-Problem. Falls Datasets in 1000er-Bereich kommen, einen
// Transaktion drumherum legen.
//
// Aufruf:
//   pnpm twin:facts-import @markus facts.json
//   pnpm twin:facts-import @markus /tmp/my-facts.json

const USAGE = "Nutzung:\n  pnpm twin:facts-import <handle> <file.json>";

interface ImportStats {
  added: number;
  updated: number;
  failed: Array<{ key: string; reason: string }>;
}

async function main() {
  const args = process.argv.slice(2);
  const positional = args.filter((a) => !a.startsWith("--"));
  const rawHandle = positional[0];
  const fileArg = positional[1];
  if (!rawHandle || !fileArg) {
    console.error(USAGE);
    process.exit(1);
  }

  // File einlesen + JSON parsen. Pfad gegen Repo-Root resolven, damit
  // `facts.json` aus dem Repo-Root gefunden wird (pnpm-cwd ist apps/runtime).
  const filePath = resolveRepoPath(fileArg);
  let raw: string;
  try {
    raw = readFileSync(filePath, "utf-8");
  } catch (err) {
    console.error(
      `[facts-import] Datei '${filePath}' nicht lesbar: ` +
        (err instanceof Error ? err.message : String(err)),
    );
    process.exit(1);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    console.error(
      `[facts-import] JSON-Parse fehlgeschlagen: ` +
        (err instanceof Error ? err.message : String(err)),
    );
    process.exit(1);
  }

  // Format-Check: muss ein flaches Object sein (kein Array, kein primitive,
  // keine nested objects).
  if (!isFlatStringObject(parsed)) {
    console.error(
      "[facts-import] JSON muss ein flaches Object sein: { key: 'value', ... } " +
        "(keine Arrays, keine nested Objects, alle Values müssen Strings sein).",
    );
    process.exit(1);
  }

  const ctx = await loadFactsCliContext(rawHandle);
  try {
    const stats: ImportStats = { added: 0, updated: 0, failed: [] };
    for (const [key, value] of Object.entries(parsed)) {
      try {
        validateFactInput(key, value);
        const existing = ctx.factsRepo.get(ctx.twin.twinId, key);
        ctx.factsRepo.upsert({
          twinId: ctx.twin.twinId,
          factKey: key,
          factValue: value,
          source: "import",
          confidence: "approved",
        });
        if (existing) stats.updated += 1;
        else stats.added += 1;
      } catch (err) {
        stats.failed.push({
          key,
          reason: err instanceof Error ? err.message : String(err),
        });
      }
    }

    const total = stats.added + stats.updated;
    console.log(
      `[facts-import] Importiert: ${total} Fact${total === 1 ? "" : "s"} ` +
        `(${stats.added} neu, ${stats.updated} aktualisiert)`,
    );
    if (stats.failed.length > 0) {
      console.log(`[facts-import] Gescheitert: ${stats.failed.length}`);
      for (const f of stats.failed) {
        console.log(`  - ${f.key}: ${f.reason}`);
      }
      // Exit-Code 2: partial success — Caller-Script kann das unterscheiden
      // von komplettem Fail (1) oder Erfolg (0).
      process.exit(2);
    }
  } finally {
    await ctx.cleanup();
  }
}

function isFlatStringObject(v: unknown): v is Record<string, string> {
  if (v === null || typeof v !== "object" || Array.isArray(v)) return false;
  for (const value of Object.values(v as Record<string, unknown>)) {
    if (typeof value !== "string") return false;
  }
  return true;
}

main().catch((err) => {
  console.error(
    "[facts-import] Fehler:",
    err instanceof Error ? err.message : err,
  );
  process.exit(1);
});
