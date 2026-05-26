import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// ─── CODEX-AUTH-FILE READER (#131 Phase 4.1) ─────────────────────────────────
//
// Liest `~/.codex/auth.json` (single-tenant, geschrieben von codex CLI nach
// `codex login`). Owner-only mode 0600 — wir lesen nur, nie modifizieren.
//
// Format-Doku: docs/131-OAUTH-STRATEGY.md §t.2.
//
// Konsumenten:
//   - apps/runtime/src/scripts/cli-oauth-login.ts (Production-CLI)
//   - apps/runtime/src/scripts/test-oauth-phase3-spike.ts (Diagnose-Spike,
//     vor Phase 4.1 hatte dieses Script eine inline-Kopie)

export const CODEX_AUTH_PATH = path.resolve(os.homedir(), ".codex/auth.json");

interface CodexAuthFile {
  tokens?: {
    access_token?: string;
    refresh_token?: string;
    account_id?: string;
    id_token?: string;
  };
}

export interface CodexToken {
  accessToken: string;
  refreshToken: string;
  accountId: string | null;
}

export class CodexAuthFileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CodexAuthFileError";
  }
}

/**
 * Lädt den Codex-Token synchron aus einer auth.json-Datei.
 *
 * Default-Pfad ist `~/.codex/auth.json` (CODEX_AUTH_PATH). Mit dem optionalen
 * `filePath`-Argument wird ein alternativer Pfad gelesen — Workflow für
 * VPS/Production wo `codex login` nicht direkt im Container läuft, sondern
 * die `auth.json` per `scp` + `docker cp` an einen Pfad wie `/tmp/auth.json`
 * gelegt wird (#131 Phase B `--auth-json`-Flag, siehe `cli-oauth-login.ts`).
 *
 * Wirft `CodexAuthFileError` mit Diagnose-Hinweis falls:
 *   - File nicht existiert (codex login noch nie gelaufen)
 *   - File nicht parseable ist (z.B. unvollständiger Write während mtime-
 *     Update — Caller soll mit kurzem Wait + Retry abfangen)
 *   - `tokens.access_token` fehlt
 */
export function loadCodexToken(filePath: string = CODEX_AUTH_PATH): CodexToken {
  if (!fs.existsSync(filePath)) {
    throw new CodexAuthFileError(
      `Codex-Auth-File nicht gefunden: ${filePath}. ` +
        (filePath === CODEX_AUTH_PATH
          ? `Bitte 'codex login' lokal laufen lassen.`
          : `Pfad korrekt? File muss vor CLI-Aufruf existieren.`),
    );
  }

  const raw = fs.readFileSync(filePath, "utf-8");
  let auth: CodexAuthFile;
  try {
    auth = JSON.parse(raw) as CodexAuthFile;
  } catch (err) {
    throw new CodexAuthFileError(
      `Codex-Auth-File nicht parseable (möglicherweise mitten in Write): ` +
        `${(err as Error).message}`,
    );
  }

  const accessToken = auth.tokens?.access_token;
  if (!accessToken) {
    throw new CodexAuthFileError(
      `Kein access_token in ${filePath}. ` +
        `'codex login --force' für frischen Token.`,
    );
  }

  return {
    accessToken,
    refreshToken: auth.tokens?.refresh_token ?? "",
    accountId: auth.tokens?.account_id ?? null,
  };
}
