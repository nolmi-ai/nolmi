import bcrypt from "bcryptjs";
import { readLine, readSecret } from "./_prompt-helpers.js";

// ─── GEN-HTPASSWD (CLI) — Distribution Schritt 3b, Traefik-BasicAuth ──────────
//
// Erzeugt eine htpasswd-Zeile `user:$2a$...` für die Traefik-BasicAuth-
// Middleware am Nolmi-Web (B2-Befund 1: die Datei liegt am Traefik-Stack).
//
// WARUM Node/bcryptjs statt `htpasswd -nbB`: die Runtime hängt ohnehin an
// `bcryptjs` (User-Passwörter, cost 12) → kein `apache2-utils` beim Self-Hoster
// nötig, analog zu `node:crypto`/`openssl` für die übrigen Secrets. bcryptjs
// erzeugt `$2a$`-Hashes; Traefiks Go-BasicAuth akzeptiert `$2a$/$2b$/$2y$`.
//
// Aufruf (vom install-tls.sh aus dem GEBAUTEN Runtime-Image, bcryptjs ist drin):
//   docker run --rm -e HTPASSWD_USER -e HTPASSWD_PASSWORD --entrypoint node \
//     nolmi-runtime:latest dist/scripts/gen-htpasswd.js
//
// Eingaben (in dieser Reihenfolge, jeweils mit Fallback):
//   User:     $HTPASSWD_USER     ODER argv[2]  ODER interaktiver Prompt
//   Passwort: $HTPASSWD_PASSWORD ODER (TTY) versteckter Prompt
// Passwort NIE über argv (würde in der Prozessliste sichtbar) — nur ENV/Prompt.
//
// Ausgabe: GENAU eine Zeile `user:hash` auf stdout (sonst nichts → direkt in die
// htpasswd-Datei umleitbar). Diagnostik geht auf stderr.

const BCRYPT_COST = 12; // identisch zu auth/users-repo.ts

function fail(msg: string): never {
  process.stderr.write(`[gen-htpasswd] Fehler: ${msg}\n`);
  process.exit(1);
}

async function main() {
  const user = (process.env.HTPASSWD_USER ?? process.argv[2] ?? "").trim();
  const resolvedUser = user || (await readLine("BasicAuth-User: ")).trim();
  if (!resolvedUser) fail("Kein User angegeben (HTPASSWD_USER / argv / Prompt leer).");
  if (resolvedUser.includes(":")) fail("User darf keinen Doppelpunkt enthalten.");

  let password = process.env.HTPASSWD_PASSWORD ?? "";
  if (!password) {
    if (!process.stdin.isTTY) {
      fail("Kein Passwort: HTPASSWD_PASSWORD setzen oder interaktiv (TTY) ausführen.");
    }
    password = await readSecret("BasicAuth-Passwort: ");
    const confirm = await readSecret("Passwort wiederholen: ");
    if (password !== confirm) fail("Passwörter stimmen nicht überein.");
  }
  if (!password) fail("Leeres Passwort.");

  const hash = bcrypt.hashSync(password, BCRYPT_COST);
  // GENAU eine Zeile auf stdout, kein Trailing-Log.
  process.stdout.write(`${resolvedUser}:${hash}\n`);
}

main().catch((err) => fail(err instanceof Error ? err.message : String(err)));
