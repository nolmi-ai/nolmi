import "dotenv/config";

// Helper-Skript schreibt nur in die DB — keine eigenen Telegram-API-Calls.
// Polling-Default umgeht die RUNTIME_PUBLIC_URL-Pflicht (config.ts Cross-
// Validation), ohne dass das Helper-Skript selbst pollen würde.
if (!process.env.TELEGRAM_USE_POLLING) {
  process.env.TELEGRAM_USE_POLLING = "true";
}

import Database from "better-sqlite3";
import { loadRuntimeConfig } from "../config.js";
import { TwinProfilesRepo } from "../twin-profiles-repo.js";
import {
  EncryptionKeyMissingError,
  loadMasterKey,
} from "../crypto-utils.js";
import { TelegramConfigsRepo } from "../telegram/configs-repo.js";
import { PairingService } from "../telegram/pairing-service.js";

// ─── MANUAL SMOKE HELPER (#130 Phase 2) ──────────────────────────────────────
//
// Setzt eine Telegram-Bot-Config für einen existierenden Twin auf, erzeugt
// einen Pairing-Code und gibt Anweisungen für den End-to-End-Test über
// Telegram aus. Phase 2 hat noch keine Settings-UI, dieser Helper schließt
// die Lücke bis Phase 4.
//
// Workflow:
//   1. BotFather-Token besorgen (auf Telegram an @BotFather: /newbot, ...)
//   2. Diesen Helper aufrufen — fügt Config ein, generiert Pairing-Code
//   3. Runtime in Polling-Mode starten (oder neu starten, falls schon laufend):
//        TELEGRAM_USE_POLLING=true pnpm --filter @nolmi/runtime dev
//   4. Auf Telegram an den Bot senden: /start <code>
//   5. Bot antwortet ✓ Paired — Owner-Telegram-User-ID wird persistiert
//   6. Nachfolgende Texte: Bot antwortet mit Phase-2-Stub
//
// Aufruf:
//   pnpm --filter @nolmi/runtime exec tsx \
//     src/scripts/setup-telegram-manual-smoke.ts \
//     --token 1234:AABBCC... --username my_test_bot [--twin @markus]
//
// Cleanup nach dem Test:
//   pnpm --filter @nolmi/runtime exec tsx \
//     src/scripts/setup-telegram-manual-smoke.ts --cleanup [--twin @markus]

interface ParsedArgs {
  cleanup: boolean;
  token: string | null;
  username: string | null;
  twin: string;
}

function parseArgs(argv: string[]): ParsedArgs {
  const args: ParsedArgs = {
    cleanup: false,
    token: null,
    username: null,
    twin: "@markus",
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--cleanup") args.cleanup = true;
    else if (a === "--token") args.token = argv[++i] ?? null;
    else if (a === "--username") args.username = argv[++i] ?? null;
    else if (a === "--twin") args.twin = argv[++i] ?? args.twin;
    else if (a === "--help" || a === "-h") {
      printUsage();
      process.exit(0);
    }
  }
  return args;
}

function printUsage(): void {
  console.log(`
#130 Manual-Smoke-Helper — Telegram-Bot-Setup für einen Twin.

USAGE
  Setup:
    pnpm --filter @nolmi/runtime exec tsx \\
      src/scripts/setup-telegram-manual-smoke.ts \\
      --token <BOT_TOKEN> --username <BOT_USERNAME> [--twin @<handle>]

  Cleanup (config + messages weg):
    pnpm --filter @nolmi/runtime exec tsx \\
      src/scripts/setup-telegram-manual-smoke.ts --cleanup [--twin @<handle>]

FLAGS
  --token      Bot-Token von @BotFather (Pflicht beim Setup)
  --username   Bot-Username (z.B. "my_test_bot", Pflicht beim Setup)
  --twin       Twin-Handle (default "@markus")
  --cleanup    Config + Messages für den Twin löschen
`);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const twinHandle = args.twin.toLowerCase();

  let masterKey: Buffer;
  try {
    masterKey = loadMasterKey();
  } catch (err) {
    if (err instanceof EncryptionKeyMissingError) {
      throw new Error(err.message);
    }
    throw err;
  }

  const runtimeConfig = loadRuntimeConfig();
  const db = new Database(runtimeConfig.dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  const profilesRepo = new TwinProfilesRepo(db);
  const configsRepo = new TelegramConfigsRepo(db, masterKey);
  const pairingService = new PairingService(configsRepo);

  const profile = profilesRepo.findByHandle(twinHandle);
  if (!profile) {
    throw new Error(`Twin '${twinHandle}' nicht in DB. Existiert das Onboarding?`);
  }

  // ─── CLEANUP-Mode ───────────────────────────────────────────────────────
  if (args.cleanup) {
    db.prepare(`DELETE FROM telegram_messages WHERE twin_id = ?`).run(
      profile.twinId,
    );
    configsRepo.deleteByTwinId(profile.twinId);
    console.log(
      `✓ Telegram-Config + Messages für ${profile.handle} entfernt.\n` +
        `  Hinweis: Falls die Runtime grade läuft, jetzt neu starten — der\n` +
        `  Bot bleibt sonst noch im In-Memory-Registry-Map.`,
    );
    db.close();
    return;
  }

  // ─── SETUP-Mode ─────────────────────────────────────────────────────────
  if (!args.token || !args.username) {
    printUsage();
    throw new Error(
      "--token und --username sind Pflicht (oder --cleanup für Cleanup).",
    );
  }

  // Idempotenz: existing Config? → updateToken statt create.
  const existing = configsRepo.findByTwinId(profile.twinId);
  if (existing) {
    configsRepo.updateToken(profile.twinId, args.token, args.username);
    console.log(
      `✓ Existing Config für ${profile.handle} aktualisiert ` +
        `(Token + Webhook-Secret rotiert).`,
    );
  } else {
    configsRepo.create({
      twin_id: profile.twinId,
      bot_token: args.token,
      bot_username: args.username,
    });
    console.log(`✓ Neue Config für ${profile.handle} angelegt.`);
  }

  const code = pairingService.generatePairingCode(profile.twinId);

  console.log(`
──────────────────────────────────────────────────────────────────────
  PAIRING-CODE: ${code}
──────────────────────────────────────────────────────────────────────

Nächste Schritte:

  1. Runtime in Polling-Mode starten (oder neu starten, falls schon
     laufend — eagerLoadAllBots läuft nur beim Boot):

       TELEGRAM_USE_POLLING=true pnpm --filter @nolmi/runtime dev

     Im Boot-Log sollte erscheinen:
       [bot-registry] eager-load: 1/1 Bot(s) registriert (Mode: polling)
       [bot-registry] polling-mode: 1 Bot(s) im Long-Poll gestartet

  2. Auf Telegram an deinen Bot @${args.username} senden:

       /start ${code}

     Erwartete Antwort:
       ✓ Paired successfully. I'm now linked to your twin @${args.username}.

  3. Anschließend Text-Stub testen — irgendein Text vom selben Account:

       hallo

     Erwartete Antwort:
       (Phase 2 stub — LLM integration in Phase 3)

  4. Reject-Pfad testen — Text von einem fremden Telegram-Account:

       Erwartete Antwort:
       This bot is paired with a different Telegram account. ...

Code läuft 10 Minuten. Bei Ablauf den Helper noch mal aufrufen (überschreibt
den Code idempotent).

Cleanup nach dem Test:

  pnpm --filter @nolmi/runtime exec tsx \\
    src/scripts/setup-telegram-manual-smoke.ts --cleanup --twin ${profile.handle}
`);

  db.close();
}

main().catch((err) => {
  console.error("✗", err instanceof Error ? err.message : String(err));
  process.exit(1);
});
