import "dotenv/config";
import Database from "better-sqlite3";
import { loadRuntimeConfig } from "../config.js";
import { UserAlreadyExistsError, UsersRepo } from "../auth/users-repo.js";
import { readLine, readSecret } from "./_prompt-helpers.js";

// ─── TWIN ONBOARD (CLI) — Distribution Etappe 2.2, Weg A / Opt 3 ─────────────
//
// Die zweite Tür neben dem Web-Wizard (#110). Das CLI deckt genau die eine
// Lücke ab, die der Browser nicht kann: den ERSTEN User anlegen. Ohne
// existierenden Login kommt ein frischer Self-Hoster nicht an den Web-Wizard
// (es gibt keine öffentliche Signup-Seite, nur /login).
//
// Bewusst NICHT im CLI: Twin-Anlage, Persona, LLM-Key, Bridge. Das macht der
// Web-Wizard im 0-owned-Twins-Flow (Persona + LLM-Key + Presets im UI, owner
// wird dort korrekt auf den eingeloggten User gesetzt — server.ts:791). So
// entsteht kein Doppel-Twin und kein 409 (der Wizard kann keinen vorhandenen
// Twin aufgreifen — genau deshalb legt das CLI hier keinen an).
//
// Weg B (durchgehendes Terminal-Onboarding inkl. Persona/Key) kommt später und
// baut auf diesem User-Bootstrap auf, ohne dass Opt 3 ihm im Weg steht.
//
// Aufruf:
//   pnpm --filter @nolmi/runtime twin:onboard
//
// Passwort wird per readSecret() ohne Echo gelesen (kein CLI-Arg → kein
// Eintrag in der Shell-History).

const WEB_URL = process.env.NOLMI_WEB_URL?.trim() || "http://localhost:3000";

async function main() {
  console.log("┌─ Nolmi CLI-Onboarding ─────────────────────────────────────");
  console.log("│ Schritt 1: Account anlegen. Den Twin baust du danach im");
  console.log("│ Browser-Wizard (Persona, LLM-Key, Presets).");
  console.log("└────────────────────────────────────────────────────────────");

  // 1. E-Mail (sichtbar)
  const email = (await readLine("E-Mail: ")).trim().toLowerCase();
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    throw new Error("Keine gültige E-Mail-Adresse — Abbruch.");
  }

  const config = loadRuntimeConfig();
  const db = new Database(config.dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  try {
    const usersRepo = new UsersRepo(db);

    // 2. Idempotenz: existiert der User schon, nicht doppelt anlegen.
    const existing = usersRepo.findByEmail(email);
    if (existing) {
      console.log("");
      console.log(`[twin:onboard] Es gibt bereits einen Account für '${email}'.`);
      console.log(
        `[twin:onboard] → Logge dich auf ${WEB_URL} ein. Falls du noch keinen`,
      );
      console.log(
        "[twin:onboard]   Twin hast, führt dich der Wizard direkt durch die Anlage.",
      );
      return;
    }

    // 3. Passwort (ohne Echo), Bestätigung gegen Tippfehler.
    const password = await readSecret("Passwort (min. 8 Zeichen, kein Echo): ");
    if (password.length < 8) {
      throw new Error("Passwort muss mind. 8 Zeichen haben — Abbruch.");
    }
    const confirm = await readSecret("Passwort wiederholen: ");
    if (password !== confirm) {
      throw new Error("Passwörter stimmen nicht überein — Abbruch.");
    }

    // 4. Optional: Anzeigename (sichtbar, leer = keiner).
    const displayNameRaw = (await readLine("Anzeigename (optional): ")).trim();
    const displayName = displayNameRaw || undefined;

    // 5. User anlegen. UserAlreadyExistsError kann durch eine Race zwischen
    //    Schritt 2 und hier theoretisch noch auftreten — sauber abfangen.
    let user;
    try {
      user = usersRepo.create(email, password, displayName);
    } catch (err) {
      if (err instanceof UserAlreadyExistsError) {
        throw new Error(
          `Account für '${email}' wurde zwischenzeitlich angelegt — logge dich auf ${WEB_URL} ein.`,
        );
      }
      throw err;
    }

    // 6. Übergabe an Tür 2 (Web-Wizard).
    console.log("");
    console.log(`[twin:onboard] ✓ Account '${user.email}' angelegt.`);
    if (user.displayName) {
      console.log(`[twin:onboard]   Name: ${user.displayName}`);
    }
    console.log("");
    console.log("  Nächster Schritt — dein Twin:");
    console.log(`  1. Öffne ${WEB_URL}`);
    console.log(`  2. Logge dich als ${user.email} ein.`);
    console.log(
      "  3. Da du noch keinen Twin hast, führt dich der Wizard automatisch",
    );
    console.log(
      "     durch die Twin-Anlage (Persona + LLM-Key + optionale Presets).",
    );
    console.log("");
  } finally {
    db.close();
  }
}

main().catch((err) => {
  console.error(
    "[twin:onboard] Fehler:",
    err instanceof Error ? err.message : err,
  );
  process.exit(1);
});
