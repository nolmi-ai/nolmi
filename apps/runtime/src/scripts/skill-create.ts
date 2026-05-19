import "dotenv/config";
import Database from "better-sqlite3";
import { existsSync, statSync, readFileSync } from "node:fs";
import { resolve, basename } from "node:path";
import { parse as parseYaml } from "yaml";
import { SkillManifestSchema, type SkillManifest } from "@twin-lab/shared";
import { loadRuntimeConfig } from "../config.js";
import { TwinProfilesRepo } from "../twin-profiles-repo.js";
import { SkillRepo } from "../skills/repo.js";

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

  // 1. Verzeichnis-Sanity
  if (!existsSync(skillDir)) {
    throw new Error(`Skill-Verzeichnis '${skillDir}' existiert nicht.`);
  }
  if (!statSync(skillDir).isDirectory()) {
    throw new Error(`'${skillDir}' ist keine Verzeichnis.`);
  }

  const manifestPath = resolve(skillDir, "manifest.yaml");
  const skillMdPath = resolve(skillDir, "SKILL.md");
  const scriptPath = resolve(skillDir, "script.ts");

  if (!existsSync(manifestPath)) {
    throw new Error(`'${manifestPath}' fehlt — manifest.yaml ist Pflicht.`);
  }
  if (!existsSync(skillMdPath)) {
    throw new Error(`'${skillMdPath}' fehlt — SKILL.md ist Pflicht.`);
  }

  // 2. Manifest parsen + validieren
  let manifestRaw: unknown;
  try {
    manifestRaw = parseYaml(readFileSync(manifestPath, "utf-8"));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`manifest.yaml konnte nicht geparst werden: ${msg}`);
  }
  if (typeof manifestRaw !== "object" || manifestRaw === null) {
    throw new Error("manifest.yaml: Top-Level muss ein Mapping sein.");
  }
  // YAML-idiomatisch: snake_case. Schema (Zod) ist camelCase. Wir mappen die
  // bekannten Felder vor dem Parse — alles andere bleibt unverändert.
  const manifestCamel = mapSnakeToCamel(manifestRaw as Record<string, unknown>);
  const parsed = SkillManifestSchema.safeParse(manifestCamel);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("\n");
    throw new Error(`manifest.yaml verletzt SkillManifestSchema:\n${issues}`);
  }
  const manifest: SkillManifest = parsed.data;

  // 3. SKILL.md lesen
  const instructionsMd = readFileSync(skillMdPath, "utf-8");

  // 4. Optional script.ts lesen
  let scriptTs: string | null = null;
  let scriptInfo = "(existiert nicht, übersprungen)";
  if (existsSync(scriptPath)) {
    scriptTs = readFileSync(scriptPath, "utf-8");
    scriptInfo = `${scriptTs.length} chars`;
  }

  // 5. DB öffnen + Twin lookup
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

    console.log(
      `[twin:skill-create] Twin: ${profile.handle} (${profile.displayName})`,
    );
    console.log(
      `[twin:skill-create] Skill: ${manifest.name} (${manifest.description})`,
    );
    console.log(`[twin:skill-create] Manifest: ${manifestPath} ✓`);
    console.log(
      `[twin:skill-create] SKILL.md: ${skillMdPath} ✓ (${instructionsMd.length} chars)`,
    );
    console.log(`[twin:skill-create] Script: ${scriptPath} ✓ ${scriptInfo}`);

    // Skill-Name aus Manifest = DB-Name. Verzeichnisname ist nur Konvention,
    // muss nicht matchen — wir warnen aber, falls er abweicht, weil das
    // schnell zu Verwirrung führt ("welcher Skill ist das jetzt?").
    const dirName = basename(skillDir);
    if (dirName !== manifest.name) {
      console.warn(
        `[twin:skill-create] Hinweis: Verzeichnisname '${dirName}' weicht von ` +
          `manifest.name '${manifest.name}' ab — DB nutzt manifest.name.`,
      );
    }

    // 6. Conflict-Check
    const skillRepo = new SkillRepo(db);
    const existing = skillRepo.findByName(profile.twinId, manifest.name);

    let action: "created" | "updated";
    let skillId: string;

    if (existing) {
      if (!force) {
        throw new Error(
          `Skill '${manifest.name}' existiert bereits für ${profile.handle} ` +
            `(${existing.skillId}). Nutze --force zum Überschreiben.`,
        );
      }
      const updated = skillRepo.update(existing.skillId, {
        name: manifest.name,
        description: manifest.description,
        manifestJson: manifest,
        instructionsMd,
        scriptTs,
        // source bleibt 'manual' — sourceMetadata in 3.2 für MCP-Imports.
      });
      action = "updated";
      skillId = updated.skillId;
    } else {
      const created = skillRepo.add({
        twinId: profile.twinId,
        name: manifest.name,
        description: manifest.description,
        manifestJson: manifest,
        instructionsMd,
        scriptTs,
        source: "manual",
      });
      action = "created";
      skillId = created.skillId;
    }

    console.log(`[twin:skill-create] Importiert: ${skillId} (${action})`);
    console.log(
      "[twin:skill-create] Hinweis: Skills werden bei jedem Chat frisch aus der DB gelesen — kein Runtime-Restart nötig.",
    );
  } finally {
    db.close();
  }
}

/**
 * YAML-Manifest in camelCase übersetzen, damit das Zod-Schema
 * (`requiresApproval`, `sourceMetadata` …) greift. Nur Top-Level — `inputs`
 * und `outputs` haben heute keine snake_case-Felder, die ein Mapping bräuchten.
 */
function mapSnakeToCamel(input: Record<string, unknown>): Record<string, unknown> {
  const KEY_MAP: Record<string, string> = {
    requires_approval: "requiresApproval",
    // #107: Pre-Pass-Classifier-Felder im YAML als snake_case, im Schema
    // als camelCase. requires_tools führt die Tool-Skill-Namen, die der
    // Pre-Pass beim Match in toolChoice umwandelt.
    trigger_mode: "triggerMode",
    trigger_condition: "triggerCondition",
    requires_tools: "requiresTools",
  };
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input)) {
    out[KEY_MAP[k] ?? k] = v;
  }
  return out;
}

main().catch((err) => {
  console.error(
    "[twin:skill-create] Fehler:",
    err instanceof Error ? err.message : err,
  );
  process.exit(1);
});
