import "dotenv/config";

import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import { watch } from "node:fs";
import { stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { loadMasterKey } from "../crypto-utils.js";
import {
  CODEX_AUTH_PATH,
  CodexAuthFileError,
  loadCodexToken,
  type CodexToken,
} from "../oauth/codex-auth-file.js";
import { OAuthTokensRepo } from "../oauth/oauth-tokens-repo.js";
import { createSqliteRepository } from "../repository/index.js";
import { TwinProfilesRepo } from "../twin-profiles-repo.js";

// ─── #131 PHASE 4.1 — PRODUCTION-CLI FÜR OAUTH-LOGIN ─────────────────────────
//
// Wrapper um `codex login` (Subprocess). Liest danach `~/.codex/auth.json`,
// persistiert Token AES-256-GCM in `oauth_tokens` und schaltet den Twin auf
// `authMode='oauth'`.
//
// Strategy + Setzungen: docs/131-OAUTH-STRATEGY.md §t (insbesondere §t.10).
//
// Aufruf:
//   pnpm twin:oauth-login @markus       (mit @ — case-insensitive)
//   pnpm twin:oauth-login markus        (ohne @ — case-insensitive)
//
// ENV:
//   CODEX_BIN  Override für codex-Binary-Pfad (Linux/CI). Default: macOS-
//              App-Bundle `/Applications/Codex.app/Contents/Resources/codex`.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WORKSPACE_ROOT = path.resolve(__dirname, "../../../..");
const DB_PATH =
  process.env.TWIN_DATABASE_PATH ??
  path.resolve(WORKSPACE_ROOT, "data/twin.db");

const MACOS_CODEX_DEFAULT =
  "/Applications/Codex.app/Contents/Resources/codex";
const SUBPROCESS_TIMEOUT_MS = 90_000;
const TOKEN_EXPIRY_OFFSET_MS = 50 * 60 * 1000;
const POLL_INTERVAL_MS = 500;
const POST_MTIME_SETTLE_MS = 200;

// ─── Sub-Phase A: Args-Parsing ──────────────────────────────────────────────

function parseHandle(argv: string[]): string {
  const raw = argv[2];
  if (!raw) {
    throw new Error(
      "Usage: pnpm twin:oauth-login <@handle>\n" +
        "  Beispiel: pnpm twin:oauth-login @markus",
    );
  }
  const stripped = raw.startsWith("@") ? raw.slice(1) : raw;
  const normalized = stripped.trim().toLowerCase();
  if (!/^[a-z][a-z0-9_-]*$/.test(normalized)) {
    throw new Error(
      `Ungültiger Handle '${raw}'. Erlaubt: Kleinbuchstaben, Ziffern, _, -.`,
    );
  }
  return normalized;
}

// ─── Sub-Phase B: Codex-Binary-Resolution ───────────────────────────────────

function locateCodexBinary(): string {
  const envOverride = process.env.CODEX_BIN?.trim();
  const candidate =
    envOverride && envOverride.length > 0
      ? envOverride
      : process.platform === "darwin"
        ? MACOS_CODEX_DEFAULT
        : null;

  if (!candidate) {
    throw new Error(
      "codex-Binary nicht auffindbar.\n" +
        "  - macOS: Installiere Codex Desktop App (https://chatgpt.com/codex)\n" +
        "  - Linux/CI: Setze CODEX_BIN-Env auf den Binary-Pfad",
    );
  }

  if (!fs.existsSync(candidate)) {
    throw new Error(
      `codex-Binary nicht gefunden: ${candidate}\n` +
        "  - Pfad korrekt? CODEX_BIN-Env überschreibt Default.",
    );
  }

  return candidate;
}

// ─── Sub-Phase C: Hybrid-Subprocess-Detection ───────────────────────────────

type LoginDoneReason =
  | { kind: "child-exit"; code: number }
  | { kind: "mtime-update" };

async function getMtimeMs(filePath: string): Promise<number | null> {
  try {
    const s = await stat(filePath);
    return s.mtimeMs;
  } catch {
    return null;
  }
}

/**
 * Race über drei Signale (§t.10 Setzung 5):
 *   (a) child.on('close', code) — codex login terminierte
 *   (b) fs.watch + Polling auf auth.json mtime — Token geschrieben
 *   (c) 90s-Timeout — Hänger-Diagnose-Pfad
 *
 * Was zuerst feuert, gewinnt. Watcher + Polling MÜSSEN vor Subprocess-Spawn
 * laufen, damit keine mtime-Updates verloren gehen — Caller initialisiert
 * `baselineMtime` und ruft diese Funktion direkt nach `spawn()`.
 */
async function waitForLoginCompletion(
  child: ChildProcess,
  baselineMtime: number | null,
  timeoutMs: number,
): Promise<LoginDoneReason> {
  return new Promise<LoginDoneReason>((resolve, reject) => {
    let settled = false;
    const cleanups: Array<() => void> = [];

    const finish = (action: () => void): void => {
      if (settled) return;
      settled = true;
      for (const fn of cleanups) {
        try {
          fn();
        } catch {
          /* cleanup darf nicht throwen */
        }
      }
      action();
    };

    const checkAuthFile = async (): Promise<void> => {
      const mtime = await getMtimeMs(CODEX_AUTH_PATH);
      if (mtime === null) return;
      if (baselineMtime === null || mtime > baselineMtime) {
        finish(() => resolve({ kind: "mtime-update" }));
      }
    };

    const onClose = (code: number | null): void => {
      finish(() => {
        if (code === 0) {
          resolve({ kind: "child-exit", code: 0 });
        } else {
          reject(
            new Error(
              `codex login Subprocess endete mit Exit-Code ${code ?? "null"}.`,
            ),
          );
        }
      });
    };

    const onError = (err: Error): void => {
      finish(() =>
        reject(new Error(`codex login Spawn-Error: ${err.message}`)),
      );
    };

    child.once("close", onClose);
    child.once("error", onError);
    cleanups.push(() => child.off("close", onClose));
    cleanups.push(() => child.off("error", onError));

    try {
      const dir = path.dirname(CODEX_AUTH_PATH);
      const watcher = watch(dir, (_event, filename) => {
        if (filename === path.basename(CODEX_AUTH_PATH)) {
          void checkAuthFile();
        }
      });
      watcher.on("error", () => {
        /* fs.watch ist auf macOS quirky — Polling ist Backup */
      });
      cleanups.push(() => watcher.close());
    } catch {
      /* fs.watch nicht verfügbar — Polling reicht */
    }

    const pollHandle = setInterval(() => void checkAuthFile(), POLL_INTERVAL_MS);
    cleanups.push(() => clearInterval(pollHandle));

    const timeoutHandle = setTimeout(() => {
      finish(() =>
        reject(
          new Error(
            `codex login Timeout nach ${Math.round(timeoutMs / 1000)}s. ` +
              `Browser-Tab noch offen? Manuell prüfen mit '${MACOS_CODEX_DEFAULT} login status'.`,
          ),
        ),
      );
    }, timeoutMs);
    cleanups.push(() => clearTimeout(timeoutHandle));
  });
}

// ─── Sub-Phase D: Token-Read mit Retry + DB-Persist ─────────────────────────

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Token-Read mit einem Retry. Bei mtime-Trigger kann codex login mitten im
 * Write sein — JSON.parse wirft dann. Kurz warten, nochmal versuchen.
 */
async function loadCodexTokenWithRetry(): Promise<CodexToken> {
  try {
    return loadCodexToken();
  } catch (err) {
    if (!(err instanceof CodexAuthFileError)) throw err;
    await sleep(POST_MTIME_SETTLE_MS);
    return loadCodexToken();
  }
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const handle = parseHandle(process.argv);
  console.log(`🔐 OAuth-Login für Twin @${handle} ...\n`);

  // DB + Repos
  const masterKey = loadMasterKey();
  const repo = createSqliteRepository(DB_PATH);
  const profilesRepo = new TwinProfilesRepo(repo.db);
  const tokensRepo = new OAuthTokensRepo(repo.db, masterKey);

  // Twin-Resolution
  const twin = profilesRepo.findByHandle(handle);
  if (!twin) {
    const verfuegbar = profilesRepo
      .list({ activeOnly: true })
      .map((p) => `@${p.handle}`)
      .join(", ");
    throw new Error(
      `Twin @${handle} nicht gefunden.\n` +
        `  Verfügbare aktive Twins: ${verfuegbar || "(keine)"}`,
    );
  }
  console.log(
    `✅ Twin: @${twin.handle} (twinId=${twin.twinId}, ` +
      `aktueller authMode=${twin.authMode})`,
  );

  if (twin.authMode === "oauth") {
    console.log(
      `⚠️  Twin @${twin.handle} ist bereits im OAuth-Mode — ` +
        `Re-Login schreibt Token neu.\n`,
    );
  }

  // Codex-Binary
  const codexBin = locateCodexBinary();
  console.log(`✅ codex-Binary: ${codexBin}\n`);

  // Baseline-mtime VOR Subprocess-Spawn festhalten (sonst Race)
  const baselineMtime = await getMtimeMs(CODEX_AUTH_PATH);

  // Subprocess starten
  console.log(`🌐 Starte 'codex login' (Browser öffnet sich) ...\n`);
  const child = spawn(codexBin, ["login"], { stdio: "inherit" });

  // Hybrid-Detection
  const reason = await waitForLoginCompletion(
    child,
    baselineMtime,
    SUBPROCESS_TIMEOUT_MS,
  );
  console.log(
    `\n✅ Login-Detection: ${
      reason.kind === "child-exit"
        ? `Subprocess-Exit (code=${reason.code})`
        : "auth.json mtime-Update"
    }`,
  );

  // Token lesen (mit Retry bei partial-write)
  const token = await loadCodexTokenWithRetry();
  console.log(`✅ Token geladen (account=${token.accountId ?? "?"})`);

  // Persist
  const expiresAt = new Date(Date.now() + TOKEN_EXPIRY_OFFSET_MS).toISOString();
  tokensRepo.upsert({
    twinId: twin.twinId,
    provider: "openai",
    accessToken: token.accessToken,
    refreshToken: token.refreshToken,
    expiresAt,
    accountId: token.accountId,
  });
  profilesRepo.setAuthMode(twin.twinId, "oauth");

  console.log(
    `✅ Token persistiert (AES-256-GCM, expires ${expiresAt})\n` +
      `✅ Twin @${twin.handle} ist jetzt im OAuth-Mode.\n\n` +
      `🎉 Login erfolgreich.`,
  );
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`\n❌ ${message}`);
  if (process.env.DEBUG && err instanceof Error && err.stack) {
    console.error(err.stack);
  }
  process.exit(1);
});
