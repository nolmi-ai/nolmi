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
//   pnpm twin:oauth-login @markus                   (lokal mit @)
//   pnpm twin:oauth-login markus                    (lokal ohne @)
//   ... @markus --auth-json=/tmp/auth.json          (Production/VPS-Mode)
//
// Flags:
//   --auth-json=<path>  Skip Subprocess + Hybrid-Detection. Liest Token aus
//                       der angegebenen auth.json. Workflow für VPS/Production
//                       wo codex-Binary fehlt:
//                         1. Mac-lokal: codex login → ~/.codex/auth.json
//                         2. scp ~/.codex/auth.json root@vps:/tmp/auth.json
//                         3. docker cp /tmp/auth.json container:/tmp/auth.json
//                         4. docker exec container npx tsx <script> @handle \
//                              --auth-json=/tmp/auth.json
//
// ENV:
//   CODEX_BIN  Override für codex-Binary-Pfad (Linux/CI). Default: macOS-
//              App-Bundle `/Applications/Codex.app/Contents/Resources/codex`.
//              Wird im --auth-json-Modus nicht konsultiert.

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

interface ParsedArgs {
  /** Normalisiertes Handle in DB-Storage-Form `@<lowercase>`. */
  handle: string;
  /** Pfad zu einer alternativen auth.json (--auth-json-Modus). `null` =
   *  Default-Flow mit Subprocess-Spawn + `~/.codex/auth.json`. */
  authJsonPath: string | null;
}

const USAGE =
  "Usage: pnpm twin:oauth-login <@handle> [--auth-json=<path>]\n" +
  "  Beispiel (lokal):       pnpm twin:oauth-login @markus\n" +
  "  Beispiel (Production):  npx tsx .../cli-oauth-login.ts @markus --auth-json=/tmp/auth.json";

/**
 * Parst CLI-Args:
 *   - Position 2 (argv[2]): Handle (positional, required)
 *   - Optional: `--auth-json=<path>` als beliebiges weiteres Arg
 *
 * Handle-Normalisierung zu DB-Storage-Form `@<lowercase>`:
 *   - "@markus"  → "@markus"
 *   - "markus"   → "@markus"
 *   - "@MARKUS"  → "@markus"
 *   - "@@markus" → "@markus" (führende @s werden gestrippt, dann ein-prefix)
 *   - "mark.us"  → Error (regex-Validation)
 */
function parseArgs(argv: string[]): ParsedArgs {
  const raw = argv[2];
  if (!raw || raw.startsWith("--")) {
    throw new Error(USAGE);
  }
  const stripped = raw.replace(/^@+/, "").trim().toLowerCase();
  if (!/^[a-z][a-z0-9_-]*$/.test(stripped)) {
    throw new Error(
      `Ungültiger Handle '${raw}'. Erlaubt: Kleinbuchstaben, Ziffern, _, -.`,
    );
  }
  const handle = `@${stripped}`;

  let authJsonPath: string | null = null;
  for (const arg of argv.slice(3)) {
    if (arg.startsWith("--auth-json=")) {
      const value = arg.slice("--auth-json=".length).trim();
      if (value.length === 0) {
        throw new Error(
          `--auth-json=<path> braucht einen Wert.\n${USAGE}`,
        );
      }
      authJsonPath = value;
      continue;
    }
    if (arg === "--auth-json") {
      throw new Error(
        `--auth-json benötigt einen Wert via '=', z.B. --auth-json=/tmp/auth.json.\n${USAGE}`,
      );
    }
    // Unbekanntes Flag — strict-fail statt silent-ignore
    throw new Error(`Unbekanntes Argument '${arg}'.\n${USAGE}`);
  }

  return { handle, authJsonPath };
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
 * Im --auth-json-Modus übergibt der Caller den expliziten Pfad; Default
 * (Subprocess-Modus) bleibt `~/.codex/auth.json`.
 */
async function loadCodexTokenWithRetry(
  filePath?: string,
): Promise<CodexToken> {
  try {
    return loadCodexToken(filePath);
  } catch (err) {
    if (!(err instanceof CodexAuthFileError)) throw err;
    await sleep(POST_MTIME_SETTLE_MS);
    return loadCodexToken(filePath);
  }
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const { handle, authJsonPath } = parseArgs(process.argv);
  console.log(`🔐 OAuth-Login für Twin ${handle} ...\n`);

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
      .map((p) => p.handle)
      .join(", ");
    throw new Error(
      `Twin ${handle} nicht gefunden.\n` +
        `  Verfügbare aktive Twins: ${verfuegbar || "(keine)"}`,
    );
  }
  console.log(
    `✅ Twin: ${twin.handle} (twinId=${twin.twinId}, ` +
      `aktueller authMode=${twin.authMode})`,
  );

  if (twin.authMode === "oauth") {
    console.log(
      `⚠️  Twin ${twin.handle} ist bereits im OAuth-Mode — ` +
        `Re-Login schreibt Token neu.\n`,
    );
  }

  let token: CodexToken;
  if (authJsonPath !== null) {
    // --auth-json-Modus: Subprocess + Hybrid-Detection komplett skippen,
    // Token direkt aus dem angegebenen Pfad lesen. Workflow für VPS/Production
    // wo codex-Binary fehlt und auth.json per scp + docker cp eingeschleust wird.
    console.log(
      `📄 Lese Token aus ${authJsonPath} (--auth-json-Modus, kein Subprocess)\n`,
    );
    token = await loadCodexTokenWithRetry(authJsonPath);
  } else {
    // Default-Flow: codex login Subprocess + Hybrid-Detection + ~/.codex/auth.json.
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
    token = await loadCodexTokenWithRetry();
  }
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
      `✅ Twin ${twin.handle} ist jetzt im OAuth-Mode.\n\n` +
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
