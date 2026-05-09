import { readFile } from "node:fs/promises";
import { resolve as resolvePath } from "node:path";
import {
  loadMcpCliContext,
  McpServerSpecSchema,
  promptForEnvValue,
  resolveRepoPath,
} from "./_mcp-cli-helpers.js";

// ─── twin:mcp-add (CLI) ─────────────────────────────────────────────────────
//
// JSON-File-driven Server-Add. Lädt eine Spec aus `mcp-servers/<name>.json`,
// fragt verdeckte ENV-Werte (Marker `"?"`) ab und legt den Server plus
// Tool-zu-Skill-Sync an.
//
// Rollback bei Sync-Failure: wenn der Server gespawnt werden kann (oder
// listTools wirft), entfernen wir den frisch angelegten DB-Eintrag wieder
// — sonst hat der User einen halb-konfigurierten Server stehen.
//
// Aufruf:
//   pnpm twin:mcp-add @markus mcp-servers/everything.json

const USAGE =
  "Nutzung:\n  pnpm twin:mcp-add <handle> <spec-file>";

async function main() {
  const [, , rawHandle, specFile] = process.argv;
  if (!rawHandle || !specFile) {
    console.error(USAGE);
    process.exit(1);
  }

  // 1. Spec-File parsen + validieren — vor dem DB-Open, damit ein
  // Tippfehler nicht erst die DB-Connection eröffnet.
  const fullPath = resolveRepoPath(specFile);
  const specRaw = await readFile(fullPath, "utf-8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(specRaw);
  } catch (err) {
    throw new Error(
      `Spec-File ist kein gültiges JSON (${fullPath}): ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  const spec = McpServerSpecSchema.parse(parsed);

  // 2. ENV-Werte mit Marker "?" verdeckt abfragen, bevor wir die DB öffnen.
  const resolvedEnv: Record<string, string> | null = spec.env
    ? await collectEnvValues(spec.env)
    : null;

  // 3. CLI-Kontext (Twin + Repos + Manager + Sync) laden.
  const ctx = await loadMcpCliContext(rawHandle);

  console.log(`[mcp-add] Twin: ${ctx.twin.handle}`);
  console.log(`[mcp-add] Spec: ${fullPath}`);
  console.log(
    `[mcp-add] Server: name=${spec.name}, transport=${spec.transport}, command=${spec.command ?? "(none)"}`,
  );

  let serverId: string | null = null;
  let synced = false;
  try {
    const created = ctx.mcpRepo.add({
      twinId: ctx.twin.twinId,
      name: spec.name,
      transport: spec.transport,
      command: spec.command ?? null,
      args: spec.args ?? null,
      env: resolvedEnv,
      url: spec.url ?? null,
      defaultRequiresApproval: spec.defaultRequiresApproval,
    });
    serverId = created.id;
    console.log(`[mcp-add] Server angelegt: ${created.id}`);

    console.log(`[mcp-add] Spawning + listTools für initial Sync …`);
    const result = await ctx.sync.syncOnAdd(created.id);
    synced = true;
    console.log(
      `[mcp-add] ✓ Server '${spec.name}' angelegt — ${result.added} Tools synchronisiert (${result.skipped} skipped)`,
    );
  } finally {
    if (!synced && serverId) {
      console.error(
        `[mcp-add] ✗ Sync fehlgeschlagen — Server-Eintrag ${serverId} wird zurückgerollt.`,
      );
      try {
        ctx.mcpRepo.remove(serverId);
      } catch (rollbackErr) {
        console.error(
          `[mcp-add] Rollback fehlgeschlagen:`,
          rollbackErr instanceof Error ? rollbackErr.message : rollbackErr,
        );
      }
    }
    await ctx.cleanup();
  }
}

async function collectEnvValues(
  rawEnv: Record<string, string>,
): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(rawEnv)) {
    if (value === "?") {
      out[key] = await promptForEnvValue(key);
    } else {
      out[key] = value;
    }
  }
  return out;
}

main().catch((err) => {
  console.error(
    "[mcp-add] Fehler:",
    err instanceof Error ? err.message : err,
  );
  process.exit(1);
});
