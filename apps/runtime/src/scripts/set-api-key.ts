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

// ─── Stdin-Secret-Prompt ─────────────────────────────────────────────────────
//
// Liest eine Zeile von Stdin OHNE die Eingabe ins Terminal zu echo'en.
// TTY-Fall: setRawMode + manuelles Char-Handling. Non-TTY (z.B. Pipe): nimm
// die erste Zeile wie sie kommt.
//
// Backspace und Ctrl-C werden behandelt; sonstige Steuerzeichen werden als
// Teil des Inputs angenommen, was bei Copy-Paste mit Carriage-Return-fremden
// Quellen mal zu Problemen führen kann — `apiKey.trim()` im Caller fängt das.
async function readSecret(prompt: string): Promise<string> {
  process.stdout.write(prompt);
  const stdin = process.stdin;

  if (!stdin.isTTY) {
    return new Promise<string>((resolve, reject) => {
      let buf = "";
      stdin.setEncoding("utf8");
      const onData = (chunk: string) => {
        buf += chunk;
        const i = buf.indexOf("\n");
        if (i >= 0) {
          stdin.pause();
          stdin.removeListener("data", onData);
          stdin.removeListener("error", onErr);
          resolve(buf.slice(0, i));
        }
      };
      const onErr = (err: Error) => {
        stdin.removeListener("data", onData);
        reject(err);
      };
      stdin.on("data", onData);
      stdin.on("error", onErr);
      stdin.resume();
    });
  }

  return new Promise<string>((resolve, reject) => {
    stdin.setRawMode(true);
    stdin.setEncoding("utf8");
    let buf = "";
    const cleanup = () => {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.removeListener("data", handler);
    };
    const handler = (chunk: string) => {
      for (const ch of chunk) {
        if (ch === "\u0003") {
          // Ctrl-C
          cleanup();
          process.stdout.write("\n");
          reject(new Error("Abbruch (Ctrl-C)"));
          return;
        }
        if (ch === "\r" || ch === "\n") {
          cleanup();
          process.stdout.write("\n");
          resolve(buf);
          return;
        }
        if (ch === "\u007f" || ch === "\b") {
          if (buf.length > 0) buf = buf.slice(0, -1);
          continue;
        }
        buf += ch;
      }
    };
    stdin.on("data", handler);
    stdin.resume();
  });
}

main().catch((err) => {
  console.error(
    "[twin:set-api-key] Fehler:",
    err instanceof Error ? err.message : err,
  );
  process.exit(1);
});
