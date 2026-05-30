import "dotenv/config";
import Database from "better-sqlite3";
import { parseArgs } from "node:util";
import { loadRuntimeConfig } from "../config.js";
import { TwinProfilesRepo } from "../twin-profiles-repo.js";
import {
  BridgeRegisterError,
  registerHandleOnBridge,
} from "../onboarding/bridge-register.js";
import { readSecret } from "./_prompt-helpers.js";

// ─── BIND BRIDGE (CLI) — Distribution Etappe 2.4b, D3 Stufe 1→2 ─────────────
//
// Bindet einen SOLO-Twin (bridge_url/bridge_token NULL) nachträglich an eine
// Bridge, deren URL + Register-Token der Owner kennt — also die EIGENE Bridge.
//
// SCOPE-GRENZE (D3): nur eigene Bridge. Fremde Bridge / offene Föderation mit
// Fremd-Vertrauen ist Produkt-Phase 4, NICHT hier. Auch kein Umbinden eines
// bereits gebundenen Twins (eigener Fall) — 4b ist solo→bound.
//
// Ablauf: an der Bridge via POST /twins/register registrieren (vorhandener
// Mechanismus `registerHandleOnBridge`), bei Erfolg bridge_url + den frischen
// bridge_token in die DB schreiben. Schlägt die Registrierung fehl (Bridge
// nicht erreichbar / Token falsch / Handle schon registriert), bleibt die DB
// unberührt (kein halber Zustand) — die DB wird ERST nach erfolgreichem
// Register angefasst.
//
// Live greift das NICHT: der Boot-Guard baut den BridgeClient/Stream nur beim
// Twin-Load (loadAll/buildEntry). Nach dem Re-Bind ist also ein Runtime-
// Neustart nötig, damit der Twin die Bridge-Verbindung aufbaut.
//
// auth_mode wird NICHT berührt (Bridge-Anbindung und OAuth-Allowlist sind
// orthogonal) — das Repo-update patcht nur bridge_url/bridge_token.
//
// Aufruf:
//   pnpm --filter @nolmi/runtime twin:bind-bridge <@handle> --bridge-url <url>
//   # Register-Token via --register-token <token> ODER ENV BRIDGE_REGISTER_TOKEN
//   # ODER interaktiver readSecret-Prompt (kein Echo).

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      "bridge-url": { type: "string" },
      "register-token": { type: "string" },
    },
    strict: true,
  });

  const rawHandle = positionals[0]?.trim();
  if (!rawHandle) {
    throw new Error(
      "Handle fehlt. Nutzung:\n" +
        "  pnpm --filter @nolmi/runtime twin:bind-bridge <@handle> --bridge-url <url> [--register-token <token>]",
    );
  }
  const handle = rawHandle.startsWith("@") ? rawHandle : `@${rawHandle}`;

  const bridgeUrl = values["bridge-url"]?.trim();
  if (!bridgeUrl) {
    throw new Error(
      "--bridge-url fehlt — URL der eigenen Bridge angeben (z.B. http://127.0.0.1:5100).",
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

    // Nur solo→bound. Ein bereits gebundener Twin wird NICHT umgebunden (4b-Scope).
    if (profile.bridgeUrl || profile.bridgeToken) {
      throw new Error(
        `Twin ${handle} ist bereits an eine Bridge gebunden (${profile.bridgeUrl ?? "?"}).\n` +
          "  Umbinden ist nicht Teil von 2.4b (eigener Fall). Abbruch.",
      );
    }

    // Register-Token: Arg > ENV > interaktiver Prompt (kein Echo).
    let registerToken =
      values["register-token"]?.trim() ||
      process.env.BRIDGE_REGISTER_TOKEN?.trim() ||
      "";
    if (!registerToken) {
      registerToken = (
        await readSecret(`Register-Token für ${bridgeUrl} (kein Echo): `)
      ).trim();
    }
    if (!registerToken) {
      throw new Error(
        "Kein Register-Token — die eigene Bridge verlangt seit #60 ein Token. Abbruch.",
      );
    }

    console.log(
      `[twin:bind-bridge] Registriere ${handle} (${profile.displayName}) an ${bridgeUrl} …`,
    );

    // Register ZUERST — DB wird erst nach Erfolg angefasst (atomar gegen
    // halben Zustand). Fehlerfälle landen im catch und lassen bridge_url NULL.
    let token: string;
    try {
      const result = await registerHandleOnBridge({
        bridgeUrl,
        handle,
        displayName: profile.displayName,
        registerToken,
      });
      token = result.token;
    } catch (err) {
      if (err instanceof BridgeRegisterError) {
        const hint =
          err.status === 409
            ? " (Handle ist an dieser Bridge schon vergeben)"
            : err.status === 401
              ? " (Register-Token falsch oder fehlt)"
              : "";
        throw new Error(
          `Bridge-Registrierung fehlgeschlagen${hint}: ${err.message}\n` +
            `  → bridge_url bleibt NULL, ${handle} ist weiter Solo. Nichts geändert.`,
        );
      }
      // Netzwerkfehler (Bridge nicht erreichbar, ECONNREFUSED) o.ä.
      throw new Error(
        `Bridge nicht erreichbar oder Register-Call fehlgeschlagen: ${
          err instanceof Error ? err.message : String(err)
        }\n  → bridge_url bleibt NULL, ${handle} ist weiter Solo. Nichts geändert.`,
      );
    }

    // Erst jetzt — nach erfolgreichem Register — die DB setzen.
    repo.update(profile.twinId, { bridgeUrl, bridgeToken: token });

    console.log(
      `[twin:bind-bridge] ✓ ${handle} an Bridge gebunden.\n` +
        `              Bridge:   ${bridgeUrl}\n` +
        `              Token:    ${token.slice(0, 6)}… (in DB gespeichert)\n` +
        `              auth_mode: ${profile.authMode} (unverändert)\n\n` +
        "  Runtime-Neustart nötig, damit der Twin die Bridge-Verbindung aufbaut\n" +
        "  (Boot-Guard baut den BridgeClient/Stream erst beim Twin-Load). Danach:\n" +
        `  [bridge:stream] verbunden statt Solo-Modus, A2A-Send geht regulär.`,
    );
  } finally {
    db.close();
  }
}

main().catch((err) => {
  console.error(
    "[twin:bind-bridge] Fehler:",
    err instanceof Error ? err.message : err,
  );
  process.exit(1);
});
