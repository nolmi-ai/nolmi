import { existsSync, statSync, readFileSync } from "node:fs";
import { resolve, basename } from "node:path";
import { parse as parseYaml } from "yaml";
import {
  SkillManifestSchema,
  type Skill,
  type SkillManifest,
  type SkillSource,
} from "@nolmi/shared";
import type { SkillRepo } from "./repo.js";

// ─── SKILL-IMPORT AUS VERZEICHNIS ────────────────────────────────────────────
//
// File-IO + YAML-Parse + Schema-Validation + Repo-Insert/Update für Skill-
// Verzeichnisse mit `manifest.yaml` + `SKILL.md` (+ optional `script.ts`).
//
// Wird sowohl vom `twin:skill-create`-CLI als auch vom POST
// /twins/:handle/skills/import-Endpoint (#110) gerufen. Vorher lebte die
// Logik nur im CLI-Script — Endpoint-Bau ohne Extract hätte ~80 Zeilen
// File-IO + camelCase-Mapping dupliziert.
//
// Verantwortung dieser Funktion:
//   - Verzeichnis- und Datei-Existenz prüfen
//   - manifest.yaml parsen + snake_case → camelCase mappen + Zod-validieren
//   - SKILL.md + optional script.ts lesen
//   - Conflict-Resolution per `force` (existing + !force → throw; sonst update)
//   - INSERT/UPDATE im SkillRepo, source bleibt 'manual'
//
// Was die Funktion bewusst NICHT macht:
//   - Twin-Lookup (Caller bringt `twinId` mit)
//   - Console-Output, Logging (CLI macht das eigene, Endpoint returnt struct)
//   - Path-Whitelist (Caller validiert Pfad-Sicherheit selbst)

export interface ImportSkillFromDirOptions {
  skillRepo: SkillRepo;
  twinId: string;
  /** Absoluter Pfad zum Skill-Verzeichnis. */
  skillDir: string;
  /**
   * `false` (default): existierender Skill → wirft `SkillExistsError`.
   * `true`: existierender Skill → wird überschrieben (UPDATE).
   */
  force?: boolean;
  /**
   * Tracking-Information für die `skills.source`-Spalte. Default `'manual'`
   * (CLI-Backward-Compat). Endpoint-Pfad (#110) setzt explizit `'example'`,
   * damit später Re-Import bei Template-Updates möglich wird und die UI
   * Production-Templates von hand-getippten Skills unterscheiden kann.
   * `'mcp'` ist hier nicht erlaubt (würde mcpServerId/Name verlangen, die
   * dieser File-Import-Pfad nicht hat) — `Exclude<SkillSource, "mcp">`.
   */
  source?: Exclude<SkillSource, "mcp">;
}

export interface ImportSkillFromDirResult {
  skill: Skill;
  status: "created" | "updated";
  /**
   * Hinweis falls Verzeichnis-Name vom Manifest-Name abweicht — Caller kann
   * loggen oder warnen. DB nutzt immer `manifest.name`.
   */
  dirNameMismatch: { dirName: string; manifestName: string } | null;
}

export class SkillImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SkillImportError";
  }
}

export class SkillExistsError extends Error {
  constructor(
    public readonly name: string,
    public readonly existingSkillId: string,
  ) {
    super(
      `Skill '${name}' existiert bereits (${existingSkillId}). Nutze force=true zum Überschreiben.`,
    );
    this.name = "SkillExistsError";
  }
}

export function importSkillFromDir(
  opts: ImportSkillFromDirOptions,
): ImportSkillFromDirResult {
  const { skillRepo, twinId, skillDir, force = false, source = "manual" } = opts;

  // 1. Verzeichnis-Sanity
  if (!existsSync(skillDir)) {
    throw new SkillImportError(`Skill-Verzeichnis '${skillDir}' existiert nicht.`);
  }
  if (!statSync(skillDir).isDirectory()) {
    throw new SkillImportError(`'${skillDir}' ist kein Verzeichnis.`);
  }

  const manifestPath = resolve(skillDir, "manifest.yaml");
  const skillMdPath = resolve(skillDir, "SKILL.md");
  const scriptPath = resolve(skillDir, "script.ts");

  if (!existsSync(manifestPath)) {
    throw new SkillImportError(`'${manifestPath}' fehlt — manifest.yaml ist Pflicht.`);
  }
  if (!existsSync(skillMdPath)) {
    throw new SkillImportError(`'${skillMdPath}' fehlt — SKILL.md ist Pflicht.`);
  }

  // 2. Manifest parsen + validieren
  let manifestRaw: unknown;
  try {
    manifestRaw = parseYaml(readFileSync(manifestPath, "utf-8"));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new SkillImportError(`manifest.yaml konnte nicht geparst werden: ${msg}`);
  }
  if (typeof manifestRaw !== "object" || manifestRaw === null) {
    throw new SkillImportError("manifest.yaml: Top-Level muss ein Mapping sein.");
  }
  const manifestCamel = mapSnakeToCamel(manifestRaw as Record<string, unknown>);
  const parsed = SkillManifestSchema.safeParse(manifestCamel);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("\n");
    throw new SkillImportError(`manifest.yaml verletzt SkillManifestSchema:\n${issues}`);
  }
  const manifest: SkillManifest = parsed.data;

  // 3. SKILL.md lesen
  const instructionsMd = readFileSync(skillMdPath, "utf-8");

  // 4. Optional script.ts lesen
  const scriptTs: string | null = existsSync(scriptPath)
    ? readFileSync(scriptPath, "utf-8")
    : null;

  // 5. Verzeichnis-Name-Mismatch als Hinweis-Payload (Caller entscheidet, ob
  // er loggt — CLI warnt, Endpoint kann ignorieren).
  const dirName = basename(skillDir);
  const dirNameMismatch =
    dirName !== manifest.name
      ? { dirName, manifestName: manifest.name }
      : null;

  // 6. Conflict-Check + Insert/Update
  const existing = skillRepo.findByName(twinId, manifest.name);
  if (existing && !force) {
    throw new SkillExistsError(manifest.name, existing.skillId);
  }

  if (existing) {
    // Update flippt source-Wert auch dann, wenn ein zuvor via CLI als 'manual'
    // angelegter Skill via Endpoint reimportiert wird — gewünscht, damit der
    // semantische Status („Production-Template") nach Re-Import korrekt ist.
    const updated = skillRepo.update(existing.skillId, {
      name: manifest.name,
      description: manifest.description,
      manifestJson: manifest,
      instructionsMd,
      scriptTs,
      source,
    });
    return { skill: updated, status: "updated", dirNameMismatch };
  }

  const created = skillRepo.add({
    twinId,
    name: manifest.name,
    description: manifest.description,
    manifestJson: manifest,
    instructionsMd,
    scriptTs,
    source,
  });
  return { skill: created, status: "created", dirNameMismatch };
}

/**
 * YAML-Manifest in camelCase übersetzen, damit das Zod-Schema
 * (`requiresApproval`, `triggerMode`, …) greift. Nur Top-Level — `inputs`
 * und `outputs` haben heute keine snake_case-Felder, die ein Mapping bräuchten.
 *
 * Bewusst dupliziert mit `skill-create.ts` zum Zeitpunkt des Extracts; nach
 * #110 Phase-1-Commit zieht der CLI auf diese Stelle um.
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
