import "dotenv/config";
import Database from "better-sqlite3";
import { readFile } from "node:fs/promises";
import { nanoid } from "nanoid";
import { loadRuntimeConfig } from "../config.js";
import { loadPersona } from "../persona/loader.js";
import { loadMandatesFromYaml } from "../mandates/service.js";
import {
  loadTwinLlmConfig,
  formatLlmLabel,
  type StoredLlmConfig,
} from "../llm-config.js";
import { encrypt, loadMasterKey, maskApiKey } from "../crypto-utils.js";
import { TwinProfilesRepo, type TwinProfile } from "../twin-profiles-repo.js";
import { resolveTwinSourcePaths } from "./_twin-source-paths.js";

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
//   - LLM-Config        per-Twin: <NAME>_LLM_PROVIDER/MODEL/API_KEY/BASE_URL,
//                       Fallback auf TWIN_LLM_*; API-Key wird AES-256-GCM
//                       verschlüsselt mit NOLMI_ENCRYPTION_KEY in DB
//                       gespeichert (Plaintext nie in DB).
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
  const paths = resolveTwinSourcePaths(name, config);

  // 1. Persona laden
  const personaMd = (await readFile(paths.personaMd, "utf-8")).trim();
  const personaMeta = await loadPersona({
    promptPath: paths.personaMd,
    metaPath: paths.personaMeta,
  });

  // 2. Mandates aus YAML (gleiche Datei für alle Twins in 2.5)
  const mandates = await loadMandatesFromYaml(paths.mandates);

  // 3. LLM-Konfig aus ENV — per-Twin Override mit Fallback auf TWIN_LLM_*
  const llmConfig = loadTwinLlmConfig(name);
  if (!llmConfig.apiKey) {
    const upperName = name.toUpperCase();
    throw new Error(
      `Kein API-Key für Twin '${name}' gefunden. ` +
        `Setze ${upperName}_LLM_API_KEY (per-Twin) oder TWIN_LLM_API_KEY (global) in .env.`,
    );
  }

  // 4. Master-Key laden, API-Key verschlüsseln — wirft bei fehlendem
  // Master-Key mit klarer Bootstrap-Hinweis.
  const masterKey = loadMasterKey();
  const storedLlmConfig: StoredLlmConfig = {
    provider: llmConfig.provider,
    model: llmConfig.model,
    apiKeyEncrypted: encrypt(llmConfig.apiKey, masterKey),
    apiKeySource: "user",
    baseUrl: llmConfig.baseUrl,
  };

  // 5. Bridge-Konfig aus name-spezifischen ENVs
  const bridgeHandleVar =
    name === "markus" ? "BRIDGE_TWIN_HANDLE" : `BRIDGE_${name.toUpperCase()}_HANDLE`;
  const bridgeTokenVar =
    name === "markus" ? "BRIDGE_TWIN_TOKEN" : `BRIDGE_${name.toUpperCase()}_TOKEN`;
  // Distribution Etappe 1: Bridge ist optional. Ohne BRIDGE_URL legt bootstrap
  // einen SOLO-TWIN an (bridge_url/token NULL, keine A2A-Registrierung) —
  // Handle dann aus dem Twin-Namen (@<name>). Mit BRIDGE_URL: voller A2A-Twin
  // wie bisher (Handle + Token aus den Bridge-ENVs Pflicht).
  const bridgeUrlEnv = process.env.BRIDGE_URL?.trim();
  let handle: string;
  let bridgeUrl: string | null;
  let bridgeToken: string | null;
  if (bridgeUrlEnv) {
    const envHandle = process.env[bridgeHandleVar]?.trim();
    const envToken = process.env[bridgeTokenVar]?.trim();
    if (!envHandle) {
      throw new Error(
        `${bridgeHandleVar} ist nicht gesetzt — Bridge-Handle für '${name}' fehlt in .env`,
      );
    }
    if (!envToken) {
      throw new Error(
        `${bridgeTokenVar} ist nicht gesetzt — Bridge-Token für '${name}' fehlt in .env ` +
          `(registriere via /twins/register an der Bridge)`,
      );
    }
    handle = envHandle;
    bridgeUrl = bridgeUrlEnv;
    bridgeToken = envToken;
  } else {
    handle = `@${name}`;
    bridgeUrl = null;
    bridgeToken = null;
    console.log(
      `[bootstrap] BRIDGE_URL nicht gesetzt — Solo-Twin ${handle} (keine Bridge, keine A2A-Registrierung)`,
    );
  }

  // 6. DB öffnen + Repo
  const db = new Database(config.dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  const repo = new TwinProfilesRepo(db);

  // 7. Upsert
  const existing = repo.findByHandle(handle);
  let result: TwinProfile;
  let action: "INSERT" | "UPDATE";

  if (existing) {
    action = "UPDATE";
    result = repo.update(existing.twinId, {
      displayName: personaMeta.name,
      personaMd,
      mandates,
      llmConfig: storedLlmConfig,
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
      llmConfig: storedLlmConfig,
      bridgeUrl,
      bridgeToken,
      ownerUserId: null,
      isActive: true,
    });
  }

  db.close();

  console.log(
    `[bootstrap] ${action} Twin ${handle}\n` +
      `              ID:       ${result.twinId}\n` +
      `              Mandates: ${mandates.length}\n` +
      `              Provider: ${formatLlmLabel(llmConfig)}\n` +
      `              API-Key:  ${maskApiKey(llmConfig.apiKey)} (verschlüsselt)\n` +
      `              Bridge:   ${bridgeUrl ?? "Solo-Modus (keine Bridge)"}`,
  );
}

main().catch((err) => {
  console.error("[bootstrap] Fehler:", err);
  process.exit(1);
});
