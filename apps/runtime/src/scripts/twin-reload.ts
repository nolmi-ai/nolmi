import "dotenv/config";
import Database from "better-sqlite3";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { loadRuntimeConfig } from "../config.js";
import { loadPersona } from "../persona/loader.js";
import { loadMandatesFromYaml } from "../mandates/service.js";
import { TwinProfilesRepo } from "../twin-profiles-repo.js";
import { resolveTwinSourcePaths } from "./_twin-source-paths.js";

// ─── TWIN RELOAD (CLI) ───────────────────────────────────────────────────────
//
// Synchronisiert die zum Twin gehörenden Source-Files (persona.md, persona-
// meta.yaml, mandates.yaml) in `twin_profiles`. Nach `twin:bootstrap` ist die
// DB-Spalte die Source-of-Truth — Edits an den Files greifen erst nach
// `twin:reload`.
//
// Aufruf:
//   pnpm --filter @nolmi/runtime twin:reload <handle>
//   pnpm --filter @nolmi/runtime twin:reload <handle> --force
//
// Beispiele:
//   pnpm --filter @nolmi/runtime twin:reload @markus
//   pnpm --filter @nolmi/runtime twin:reload markus --force
//   pnpm --filter @nolmi/runtime twin:reload @florian --force
//
// Restart-Pflicht: Persona und Mandates werden nur beim Twin-Service-Boot
// gelesen (anders als Skills, die per Chat-Call frisch aus der DB kommen).
// Nach `twin:reload` muss die Runtime neu gestartet werden, sonst wirken die
// neuen Inhalte nicht.

const USAGE =
  "Nutzung:\n" +
  "  pnpm --filter @nolmi/runtime twin:reload <handle> [--force]";

async function main() {
  const args = process.argv.slice(2);
  const force = args.includes("--force");
  const positional = args.filter((a) => !a.startsWith("--"));
  const rawHandle = positional[0]?.trim();

  if (!rawHandle) {
    throw new Error(`Handle fehlt.\n${USAGE}`);
  }
  const handle = rawHandle.startsWith("@") ? rawHandle : `@${rawHandle}`;
  const twinName = handle.replace(/^@/, "").toLowerCase();

  const config = loadRuntimeConfig();
  const paths = resolveTwinSourcePaths(twinName, config);

  // 1. File-Existenz vor Parse — klare Fehlermeldung pro Pfad statt
  // generic "ENOENT". Mandates ist global, fehlt aber auch genauso.
  for (const [label, path] of [
    ["persona.md", paths.personaMd],
    ["persona-meta.yaml", paths.personaMeta],
    ["mandates.yaml", paths.mandates],
  ] as const) {
    if (!existsSync(path)) {
      throw new Error(`${label} fehlt unter ${path}`);
    }
  }

  // 2. Files lesen + parsen
  const personaMd = (await readFile(paths.personaMd, "utf-8")).trim();
  const personaMeta = await loadPersona({
    promptPath: paths.personaMd,
    metaPath: paths.personaMeta,
  });
  const mandates = await loadMandatesFromYaml(paths.mandates);

  // 3. DB öffnen + Twin-Lookup
  const db = new Database(config.dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  try {
    const repo = new TwinProfilesRepo(db);
    const existing = repo.findByHandle(handle);
    if (!existing) {
      throw new Error(
        `Twin '${handle}' nicht in twin_profiles gefunden — Handle prüfen oder zuerst 'pnpm twin:bootstrap ${twinName}' laufen lassen.`,
      );
    }

    console.log(
      `[twin:reload] Twin: ${existing.handle} (${existing.displayName})`,
    );
    console.log(`[twin:reload] Source-Files:`);
    console.log(`              - ${paths.personaMd} ✓ (${personaMd.length} chars)`);
    console.log(
      `              - ${paths.personaMeta} ✓ (handle=${personaMeta.handle}, name=${personaMeta.name})`,
    );
    console.log(
      `              - ${paths.mandates} ✓ (${mandates.length} mandates)`,
    );

    // 4. Diff-Summary
    const personaDelta = personaMd.length - existing.personaMd.length;
    const personaDeltaLabel =
      personaDelta === 0
        ? "(unverändert)"
        : `(${personaDelta > 0 ? "+" : ""}${personaDelta})`;
    const displayNameUnchanged = existing.displayName === personaMeta.name;
    const mandatesUnchanged = existing.mandates.length === mandates.length;

    console.log(`[twin:reload] DB-Diff:`);
    console.log(
      `              - persona_md:    ${existing.personaMd.length} → ${personaMd.length} chars ${personaDeltaLabel}`,
    );
    console.log(
      `              - display_name:  ${existing.displayName} → ${personaMeta.name}` +
        (displayNameUnchanged ? " (unverändert)" : ""),
    );
    console.log(
      `              - mandates:      ${existing.mandates.length} → ${mandates.length} mandates` +
        (mandatesUnchanged ? " (unverändert)" : ""),
    );

    // 5. Confirm — bei --force überspringen
    if (!force) {
      const answer = (await prompt("[twin:reload] Übernehmen? [y/N]: ")).trim().toLowerCase();
      if (answer !== "y" && answer !== "yes" && answer !== "j" && answer !== "ja") {
        console.log("[twin:reload] Abgebrochen — keine Änderung an der DB.");
        return;
      }
    }

    // 6. DB-Update — TwinProfilesRepo.update() macht den Schreibvorgang in
    // einem Statement (Repo legt den UPDATE so aus, dass entweder alles oder
    // nichts persistiert wird).
    repo.update(existing.twinId, {
      personaMd,
      displayName: personaMeta.name,
      mandates,
    });

    console.log("[twin:reload] DB-Update committed.");
    console.log("");
    console.log(
      "[twin:reload] WICHTIG: Runtime-Restart nötig, damit der Twin die neue Persona/Mandates beim Boot lädt.",
    );
  } finally {
    db.close();
  }
}

async function prompt(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return await rl.question(question);
  } finally {
    rl.close();
  }
}

main().catch((err) => {
  console.error(
    "[twin:reload] Fehler:",
    err instanceof Error ? err.message : err,
  );
  process.exit(1);
});
