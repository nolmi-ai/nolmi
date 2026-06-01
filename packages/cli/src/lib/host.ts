import { existsSync, readFileSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { ok, warn, dim, die } from "./log.js";
import { detectPrimaryIPv4 } from "./detect-ip.js";

/**
 * Liest den Host aus einer bestehenden .env (`NEXT_PUBLIC_RUNTIME_URL=http://<host>:4000`).
 * Für die Schluss-URLs / reconfigure-Anzeige. null, wenn nicht gefunden.
 */
export function readHostFromEnv(envFile: string): string | null {
  if (!existsSync(envFile)) return null;
  try {
    const m = readFileSync(envFile, "utf8").match(
      /^NEXT_PUBLIC_RUNTIME_URL=http:\/\/([^:/\s]+):4000\s*$/m,
    );
    return m?.[1] ?? null;
  } catch {
    return null;
  }
}

type NormResult = { ok: true; host: string } | { ok: false; message: string };

/**
 * Normalisiert eine Eingabe zu einem **nackten Host** (IP/Domain), passend zur
 * `http://<host>:4000`-Formel:
 * - `https://…` → **abgelehnt** mit TLS/3b-Hinweis (Phase-1-Wrapper macht http+IP).
 * - `http://…`  → Präfix nachsichtig entfernt.
 * - Port/Slash/Whitespace → abgelehnt mit Hinweis (wir hängen :4000 selbst an).
 */
export function tryNormalizeHost(input: string): NormResult {
  let h = input.trim();
  if (h === "") return { ok: false, message: "Leere Adresse — bitte eine IP oder Domain eingeben." };
  if (/^https:\/\//i.test(h)) {
    return {
      ok: false,
      message:
        "HTTPS/Domain ist der TLS-Pfad (Schritt 3b) — dafür braucht es Secure-Cookie + Traefik.\n" +
        "  Der Phase-1-Wrapper macht nur http+IP. Gib eine IP/Domain OHNE https:// ein\n" +
        "  (der Zugriff läuft dann über http://<adresse>:4000).",
    };
  }
  if (/^http:\/\//i.test(h)) h = h.replace(/^http:\/\//i, "");
  h = h.replace(/\/+$/, "");
  if (h === "") return { ok: false, message: "Leere Adresse — bitte eine IP oder Domain eingeben." };
  if (/\s/.test(h)) return { ok: false, message: "Adresse darf keine Leerzeichen enthalten." };
  if (/:\d+$/.test(h)) {
    return { ok: false, message: "Bitte OHNE Port angeben — der Wrapper hängt :4000 selbst an." };
  }
  return { ok: true, host: h };
}

async function ask(prompt: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return await rl.question(prompt);
  } finally {
    rl.close();
  }
}

/**
 * Löst die browser-erreichbare Adresse auf (Option a + Auto-Vorschlag):
 * - **explizit** (`--host` / `NOLMI_HOST`) → normalisieren + nehmen, KEIN Prompt
 *   (https → sauberer Abbruch mit 3b-Hinweis).
 * - sonst **TTY** → erkannte IPv4 als Vorschlag, Enter bestätigt, Eingabe
 *   überschreibt (ungültig → erneut fragen).
 * - sonst **kein TTY** → erkannte IP nehmen + LAUT loggen (Fallback localhost,
 *   ebenfalls geloggt).
 */
export async function resolveHost(explicit: string | undefined): Promise<string> {
  if (explicit !== undefined && explicit.trim() !== "") {
    const norm = tryNormalizeHost(explicit);
    if (!norm.ok) die(norm.message);
    return norm.host;
  }

  const detected = detectPrimaryIPv4();

  if (process.stdin.isTTY && process.stdout.isTTY) {
    const def = detected ?? "localhost";
    if (detected) dim(`Erkannte IP-Adresse dieses Rechners: ${detected}`);
    else dim("Keine externe IP erkannt — Vorschlag 'localhost' (nur lokaler Zugriff).");
    for (;;) {
      const raw = await ask(
        "  Adresse, unter der dein Browser den Server erreicht?\n" +
          `  (IP oder Domain, ohne http:// und ohne Port) [${def}] `,
      );
      const input = raw.trim() === "" ? def : raw;
      const norm = tryNormalizeHost(input);
      if (norm.ok) {
        ok(`Browser-Adresse: ${norm.host}`);
        return norm.host;
      }
      warn(norm.message);
    }
  }

  // Kein interaktives Terminal → erkannte IP nehmen, LAUT loggen.
  if (detected) {
    warn(`Kein interaktives Terminal — nehme die erkannte IP '${detected}' als Browser-Adresse.`);
    warn("Falsch? Mit '--host <adresse>' / NOLMI_HOST setzen oder später 'nolmi reconfigure-host'.");
    return detected;
  }
  warn("Kein TTY und keine IP erkannt — falle auf 'localhost' zurück.");
  warn("Für Remote-Zugriff: '--host <ip>' / NOLMI_HOST setzen oder 'nolmi reconfigure-host'.");
  return "localhost";
}
