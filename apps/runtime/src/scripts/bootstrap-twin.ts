import "dotenv/config";
import Database from "better-sqlite3";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { nanoid } from "nanoid";
import { loadRuntimeConfig, WORKSPACE_ROOT } from "../config.js";
import { loadPersona } from "../persona/loader.js";
import { loadMandatesFromYaml } from "../mandates/service.js";
import { loadTwinLlmConfig, formatLlmLabel } from "../llm-config.js";
import { TwinProfilesRepo, type TwinProfile } from "../twin-profiles-repo.js";

// ─── BOOTSTRAP TWIN ──────────────────────────────────────────────────────────
//
// Schreibt einen Twin aus Files (docs/persona*.md, docs/persona*-meta.yaml,
// docs/mandates.yaml) und ENV (Bridge-Anbindung) in `twin_profiles`.
//
// Aufruf:
//   pnpm twin:bootstrap            → Default 'markus'
//   pnpm twin:bootstrap markus
//   pnpm twin:bootstrap florian
//
// Konvention pro Twin-Name `<n>`:
//   - Persona-MD:       n='markus' → docs/persona.md
//                       sonst       → docs/persona-<n>.md
//   - Persona-Meta:     n='markus' → docs/persona-meta.yaml
//                       sonst       → docs/persona-<n>-meta.yaml
//   - Bridge-Handle ENV n='markus' → BRIDGE_TWIN_HANDLE
//                       sonst       → BRIDGE_<N_UPPER>_HANDLE
//   - Bridge-Token ENV  analog
//   - LLM-Config        TWIN_LLM_PROVIDER/MODEL/API_KEY/BASE_URL — gleich für
//                       alle Twins in 2.5; pro-Twin-LLM später, wenn nötig
//
// Idempotent: existiert ein Twin mit dem gleichen Handle, werden alle Felder
// überschrieben (außer twin_id, created_at, owner_user_id).

async function main() {
  const name = (process.argv[2] ?? "markus").trim().toLowerCase();
  if (!/^[a-z][a-z0-9_-]*$/.test(name)) {
    throw new Error(
      `Twin-Name '${name}' ist ungültig — nur Kleinbuchstaben, Ziffern, _ und - erlaubt`,
    );
  }

  const config = loadRuntimeConfig();
  const docsDir = resolve(WORKSPACE_ROOT, "docs");

  // Pfade je nach Twin-Name auflösen
  const personaMdPath =
    name === "markus" ? config.personaPath : resolve(docsDir, `persona-${name}.md`);
  const personaMetaPath =
    name === "markus"
      ? config.personaMetaPath
      : resolve(docsDir, `persona-${name}-meta.yaml`);

  // 1. Persona laden
  const personaMd = (await readFile(personaMdPath, "utf-8")).trim();
  const personaMeta = await loadPersona({
    promptPath: personaMdPath,
    metaPath: personaMetaPath,
  });

  // 2. Mandates aus YAML (gleiche Datei für alle Twins in 2.5)
  const mandates = await loadMandatesFromYaml(config.mandatesPath);

  // 3. LLM-Konfig aus ENV — gleich für alle Twins in 2.5
  const llmConfig = loadTwinLlmConfig();

  // 4. Bridge-Konfig aus name-spezifischen ENVs
  const bridgeHandleVar =
    name === "markus" ? "BRIDGE_TWIN_HANDLE" : `BRIDGE_${name.toUpperCase()}_HANDLE`;
  const bridgeTokenVar =
    name === "markus" ? "BRIDGE_TWIN_TOKEN" : `BRIDGE_${name.toUpperCase()}_TOKEN`;
  const bridgeUrl = process.env.BRIDGE_URL?.trim();
  const handle = process.env[bridgeHandleVar]?.trim();
  const bridgeToken = process.env[bridgeTokenVar]?.trim();

  if (!bridgeUrl) {
    throw new Error("BRIDGE_URL ist nicht gesetzt — siehe .env");
  }
  if (!handle) {
    throw new Error(
      `${bridgeHandleVar} ist nicht gesetzt — Bridge-Handle für '${name}' fehlt in .env`,
    );
  }
  if (!bridgeToken) {
    throw new Error(
      `${bridgeTokenVar} ist nicht gesetzt — Bridge-Token für '${name}' fehlt in .env ` +
        `(registriere via /twins/register an der Bridge)`,
    );
  }

  // 5. DB öffnen + Repo
  const db = new Database(config.dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  const repo = new TwinProfilesRepo(db);

  // 6. Upsert
  const existing = repo.findByHandle(handle);
  let result: TwinProfile;
  let action: "INSERT" | "UPDATE";

  if (existing) {
    action = "UPDATE";
    result = repo.update(existing.twinId, {
      displayName: personaMeta.name,
      personaMd,
      mandates,
      llmConfig,
      bridgeUrl,
      bridgeToken,
      isActive: true,
    });
  } else {
    action = "INSERT";
    result = repo.insert({
      twinId: `twin_${nanoid(16)}`,
      handle,
      displayName: personaMeta.name,
      personaMd,
      mandates,
      llmConfig,
      bridgeUrl,
      bridgeToken,
      ownerUserId: null,
      isActive: true,
    });
  }

  db.close();

  console.log(
    `[bootstrap] ${action} Twin ${handle} in DB: ID=${result.twinId}, ` +
      `Mandates=${mandates.length}, Provider=${formatLlmLabel(llmConfig)}, ` +
      `Bridge=${bridgeUrl}`,
  );
}

main().catch((err) => {
  console.error("[bootstrap] Fehler:", err);
  process.exit(1);
});
