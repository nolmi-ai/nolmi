import "dotenv/config";
import Database from "better-sqlite3";
import { loadRuntimeConfig } from "../config.js";
import { TwinProfilesRepo } from "../twin-profiles-repo.js";
import {
  EncryptionKeyMissingError,
  encrypt,
  loadMasterKey,
  maskApiKey,
} from "../crypto-utils.js";
import { validateApiKey } from "../onboarding/api-key-validator.js";
import type { StoredLlmConfig } from "../llm-config.js";
import { readSecret } from "./_prompt-helpers.js";

// ─── SET API KEY (CLI) ───────────────────────────────────────────────────────
//
// Rotiert den verschlüsselten LLM-API-Key eines bestehenden Twins. Fragt den
// neuen Key per Stdin-Prompt ab (kein CLI-Argument → kein Eintrag in der
// Shell-History), validiert ihn 1× gegen den Provider, verschlüsselt mit dem
// Master-Key und schreibt ihn in `twin_profiles.llm_config`.
//
// Aufruf:
//   pnpm --filter @nolmi/runtime twin:set-api-key markus
//   pnpm --filter @nolmi/runtime twin:set-api-key @markus
//
// Settings-UI nach Update reloaden — sie zeigt dann den neuen maskierten Key.
// Runtime sieht den neuen Key erst nach Restart (beim Boot wird llm_config
// gelesen und entschlüsselt).

async function main() {
  const positional = process.argv.slice(2);
  const rawHandle = positional[0]?.trim();
  if (!rawHandle) {
    throw new Error(
      "Handle fehlt. Nutzung:\n" +
        "  pnpm --filter @nolmi/runtime twin:set-api-key <handle>",
    );
  }
  const handle = rawHandle.startsWith("@") ? rawHandle : `@${rawHandle}`;

  // 1. Master-Key zuerst — wenn die ENV nicht passt, brauchen wir gar nicht
  // erst die DB anzufassen oder den User nach einem Key zu fragen.
  let masterKey: Buffer;
  try {
    masterKey = loadMasterKey();
  } catch (err) {
    if (err instanceof EncryptionKeyMissingError) {
      throw new Error(err.message);
    }
    throw err;
  }

  // 2. DB öffnen + Twin suchen
  const config = loadRuntimeConfig();
  const db = new Database(config.dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  try {
    const repo = new TwinProfilesRepo(db);
    const profile = repo.findByHandle(handle);
    if (!profile) {
      throw new Error(
        `Twin '${handle}' nicht in twin_profiles gefunden — Handle prüfen.`,
      );
    }
    const { provider, model } = profile.llmConfig;
    if (!provider || !model) {
      throw new Error(
        `Twin '${handle}' hat keine vollständige llm_config (provider/model fehlen).`,
      );
    }

    console.log(`[twin:set-api-key] Twin: ${profile.handle} (${profile.displayName})`);
    console.log(`                  LLM:  ${provider} / ${model}`);

    // 3. Key per Stdin lesen (masked, nicht ge-echo't)
    const apiKey = (await readSecret("API-Key (wird nicht angezeigt): ")).trim();
    if (!apiKey) {
      throw new Error("Kein Key eingegeben — Abbruch.");
    }

    // 4. Validate gegen Provider
    process.stdout.write(`[twin:set-api-key] Validiere gegen ${provider} … `);
    const result = await validateApiKey(provider, apiKey, model);
    if (!result.valid) {
      process.stdout.write("FEHLER\n");
      throw new Error(`Key-Validation fehlgeschlagen: ${result.reason}`);
    }
    process.stdout.write("OK\n");

    // 5. Verschlüsseln + DB-Update via TwinProfilesRepo.update — der Repo
    //    setzt updated_at automatisch.
    const updatedLlmConfig: StoredLlmConfig = {
      ...profile.llmConfig,
      apiKeyEncrypted: encrypt(apiKey, masterKey),
      apiKeySource: "user",
    };
    repo.update(profile.twinId, { llmConfig: updatedLlmConfig });

    console.log(
      `[twin:set-api-key] ${profile.handle} aktualisiert — neuer Key: ${maskApiKey(apiKey)}`,
    );
    console.log(
      "[twin:set-api-key] Hinweis: Runtime neu starten, damit der neue Key beim Boot eingelesen wird.",
    );
  } finally {
    db.close();
  }
}

main().catch((err) => {
  console.error(
    "[twin:set-api-key] Fehler:",
    err instanceof Error ? err.message : err,
  );
  process.exit(1);
});
