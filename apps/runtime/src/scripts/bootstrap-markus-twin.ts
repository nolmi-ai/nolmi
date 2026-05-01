import "dotenv/config";
import Database from "better-sqlite3";
import { readFile } from "node:fs/promises";
import { nanoid } from "nanoid";
import { loadRuntimeConfig } from "../config.js";
import { loadPersona } from "../persona/loader.js";
import { loadMandatesFromYaml } from "../mandates/service.js";
import { loadTwinLlmConfig, formatLlmLabel } from "../llm-config.js";
import { TwinProfilesRepo, type TwinProfile } from "../twin-profiles-repo.js";

// ─── BOOTSTRAP MARKUS TWIN ───────────────────────────────────────────────────
//
// Schreibt den Markus-Twin aus Files (docs/persona.md, docs/persona-meta.yaml,
// docs/mandates.yaml) und ENV (LLM- + Bridge-Konfig) in die `twin_profiles`-
// Tabelle.
//
// Idempotent: wenn ein Twin mit dem gleichen Handle (Default `@markus`)
// existiert, werden alle Felder mit dem aktuellen Stand überschrieben (außer
// twin_id, created_at und owner_user_id — letzteres wird in Schritt 4
// gesetzt). Sonst wird ein neuer Eintrag mit frischer twin_id angelegt.
//
// In 2b liest der Runtime selbst noch aus den Files; die DB-Row ist eine
// parallele Kopie. Cutover passiert in 2c.

async function main() {
  const config = loadRuntimeConfig();

  // 1. Persona laden (Markdown + Meta-YAML)
  const personaMd = (await readFile(config.personaPath, "utf-8")).trim();
  const personaMeta = await loadPersona({
    promptPath: config.personaPath,
    metaPath: config.personaMetaPath,
  });

  // 2. Mandates aus YAML
  const mandates = await loadMandatesFromYaml(config.mandatesPath);

  // 3. LLM-Konfig aus ENV (TWIN_LLM_* mit Backward-Compat-Fallbacks)
  const llmConfig = loadTwinLlmConfig();

  // 4. Bridge-Konfig aus ENV — Pflicht für Bootstrap
  const bridgeUrl = process.env.BRIDGE_URL?.trim();
  const bridgeToken = process.env.BRIDGE_TWIN_TOKEN?.trim();
  const handle = process.env.BRIDGE_TWIN_HANDLE?.trim() || `@${personaMeta.handle}`;
  if (!bridgeUrl || !bridgeToken) {
    throw new Error(
      "BRIDGE_URL und BRIDGE_TWIN_TOKEN müssen gesetzt sein (siehe .env)",
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
