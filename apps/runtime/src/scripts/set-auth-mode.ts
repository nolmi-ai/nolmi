import "dotenv/config";
import Database from "better-sqlite3";
import { loadRuntimeConfig } from "../config.js";
import { TwinProfilesRepo, type AuthMode } from "../twin-profiles-repo.js";

// ─── SET AUTH MODE (CLI) — Distribution Etappe 2.4a, D2-Allowlist ────────────
//
// Setzt `twin_profiles.auth_mode` eines Twins auf `oauth` oder `api_key`.
//
// Das ist die **manuelle Allowlist** aus D2: OAuth (ChatGPT-Subscription) ist
// kein Self-Service. Nur wer Shell-Zugang zur Runtime hat (Self-Hoster bzw.
// Admin auf nolmi.ai) kann einen Twin auf `oauth` schalten. `twin:oauth-login`
// lehnt ab, solange ein Twin nicht hier vorab auf `oauth` allowlistet wurde —
// dieser Befehl und der Login sind bewusst getrennt (Allowlisting ≠ Login).
//
// Es gibt KEINE HTTP-Route, die auth_mode ändert (Settings-`/full-config`
// kennt das Feld nicht) — die User-facing UI bietet bei `api_key` keinen
// OAuth-Pfad an. Dieser CLI-Weg ist der einzige Allowlist-Schalter.
//
// Aufruf:
//   pnpm --filter @nolmi/runtime twin:auth-mode <handle> oauth     # allowlisten
//   pnpm --filter @nolmi/runtime twin:auth-mode <handle> api_key   # zurücknehmen
//   pnpm --filter @nolmi/runtime twin:auth-mode <handle>           # nur anzeigen

const VALID_MODES: readonly AuthMode[] = ["api_key", "oauth"];

function isAuthMode(v: string): v is AuthMode {
  return (VALID_MODES as readonly string[]).includes(v);
}

async function main() {
  const positional = process.argv.slice(2);
  const rawHandle = positional[0]?.trim();
  const rawMode = positional[1]?.trim();

  if (!rawHandle) {
    throw new Error(
      "Handle fehlt. Nutzung:\n" +
        "  pnpm --filter @nolmi/runtime twin:auth-mode <handle> [oauth|api_key]",
    );
  }
  const handle = rawHandle.startsWith("@") ? rawHandle : `@${rawHandle}`;

  if (rawMode !== undefined && !isAuthMode(rawMode)) {
    throw new Error(
      `Ungültiger Modus '${rawMode}'. Erlaubt: ${VALID_MODES.join(", ")}.`,
    );
  }

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

    // Reiner Anzeige-Modus, wenn kein Ziel-Modus übergeben wurde.
    if (rawMode === undefined) {
      console.log(
        `[twin:auth-mode] ${profile.handle} (${profile.displayName}): auth_mode='${profile.authMode}'`,
      );
      return;
    }

    const nextMode = rawMode as AuthMode;
    if (profile.authMode === nextMode) {
      console.log(
        `[twin:auth-mode] ${profile.handle} ist bereits auth_mode='${nextMode}' — keine Änderung.`,
      );
      return;
    }

    repo.setAuthMode(profile.twinId, nextMode);
    console.log(
      `[twin:auth-mode] ${profile.handle}: auth_mode '${profile.authMode}' → '${nextMode}'.`,
    );
    if (nextMode === "oauth") {
      console.log(
        `[twin:auth-mode] Allowlistet. Nächster Schritt: 'pnpm twin:oauth-login ${profile.handle}'.`,
      );
    } else {
      console.log(
        "[twin:auth-mode] Hinweis: vorhandene OAuth-Tokens bleiben in der DB; der Send-Path nutzt sie nicht mehr (api_key-Pfad). Runtime-Neustart, damit der Provider-Switch greift.",
      );
    }
  } finally {
    db.close();
  }
}

main().catch((err) => {
  console.error(
    "[twin:auth-mode] Fehler:",
    err instanceof Error ? err.message : err,
  );
  process.exit(1);
});
