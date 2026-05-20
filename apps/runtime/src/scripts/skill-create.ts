import "dotenv/config";
import Database from "better-sqlite3";
import { existsSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { loadRuntimeConfig } from "../config.js";
import { TwinProfilesRepo } from "../twin-profiles-repo.js";
import { SkillRepo } from "../skills/repo.js";
import {
  importSkillFromDir,
  SkillExistsError,
  SkillImportError,
} from "../skills/import-from-dir.js";

// ─── SKILL CREATE (CLI) ──────────────────────────────────────────────────────
//
// Importiert einen Skill aus einem Verzeichnis (manifest.yaml + SKILL.md +
// optional script.ts) in die DB des angegebenen Twins.
//
// Aufruf:
//   pnpm --filter @twin-lab/runtime twin:skill-create <handle> <skill-dir>
//   pnpm --filter @twin-lab/runtime twin:skill-create <handle> <skill-dir> --force
//
// Storage-only: script.ts wird unverändert in `skill_ts` abgelegt — kein
// Compile-Check, keine Linting. Execution kommt mit 3.2 (MCP) oder eigenem
// Sub-Schritt. Engine ignoriert script_ts heute komplett.
//
// Hot-Reload: TwinService liest aktive Skills bei jedem runModel()-Call frisch
// aus der DB (3.1.B). Kein Runtime-Restart nötig.

const USAGE =
  "Nutzung:\n" +
  "  pnpm --filter @twin-lab/runtime twin:skill-create <handle> <skill-dir> [--force]";

async function main() {
  const args = process.argv.slice(2);
  const force = args.includes("--force");
  const positional = args.filter((a) => !a.startsWith("--"));
  const rawHandle = positional[0]?.trim();
  const rawDir = positional[1]?.trim();

  if (!rawHandle) {
    throw new Error(`Handle fehlt.\n${USAGE}`);
  }
  if (!rawDir) {
    throw new Error(`Skill-Verzeichnis fehlt.\n${USAGE}`);
  }
  const handle = rawHandle.startsWith("@") ? rawHandle : `@${rawHandle}`;
  const skillDir = resolve(process.cwd(), rawDir);

  // CLI-eigene Sanity vor DB-Open, damit ein Tippfehler im Pfad nicht erst die
  // DB-Connection eröffnet. importSkillFromDir prüft dasselbe nochmal, aber
  // CLI-User wollen den Fehler vor dem DB-Spinup sehen.
  if (!existsSync(skillDir)) {
    throw new Error(`Skill-Verzeichnis '${skillDir}' existiert nicht.`);
  }
  if (!statSync(skillDir).isDirectory()) {
    throw new Error(`'${skillDir}' ist kein Verzeichnis.`);
  }

  const config = loadRuntimeConfig();
  const db = new Database(config.dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  try {
    const profilesRepo = new TwinProfilesRepo(db);
    const profile = profilesRepo.findByHandle(handle);
    if (!profile) {
      throw new Error(
        `Twin '${handle}' nicht in twin_profiles gefunden — Handle prüfen.`,
      );
    }

    const skillRepo = new SkillRepo(db);
    let result;
    try {
      result = importSkillFromDir({
        skillRepo,
        twinId: profile.twinId,
        skillDir,
        force,
      });
    } catch (err) {
      if (err instanceof SkillExistsError) {
        throw new Error(
          `Skill '${err.name}' existiert bereits für ${profile.handle} ` +
            `(${err.existingSkillId}). Nutze --force zum Überschreiben.`,
        );
      }
      if (err instanceof SkillImportError) {
        throw new Error(err.message);
      }
      throw err;
    }

    const { skill, status, dirNameMismatch } = result;

    console.log(
      `[twin:skill-create] Twin: ${profile.handle} (${profile.displayName})`,
    );
    console.log(
      `[twin:skill-create] Skill: ${skill.name} (${skill.description})`,
    );
    console.log(
      `[twin:skill-create] SKILL.md ✓ (${skill.instructionsMd.length} chars)`,
    );
    console.log(
      `[twin:skill-create] Script: ${skill.scriptTs ? `${skill.scriptTs.length} chars` : "(existiert nicht, übersprungen)"}`,
    );
    if (dirNameMismatch) {
      console.warn(
        `[twin:skill-create] Hinweis: Verzeichnisname '${dirNameMismatch.dirName}' weicht von ` +
          `manifest.name '${dirNameMismatch.manifestName}' ab — DB nutzt manifest.name.`,
      );
    }
    console.log(`[twin:skill-create] Importiert: ${skill.skillId} (${status})`);
    console.log(
      "[twin:skill-create] Hinweis: Skills werden bei jedem Chat frisch aus der DB gelesen — kein Runtime-Restart nötig.",
    );
  } finally {
    db.close();
  }
}

main().catch((err) => {
  console.error(
    "[twin:skill-create] Fehler:",
    err instanceof Error ? err.message : err,
  );
  process.exit(1);
});
