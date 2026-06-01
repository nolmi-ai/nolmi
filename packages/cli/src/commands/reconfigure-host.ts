import { existsSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import { join } from "node:path";
import { step, ok, warn, plain, dim, die } from "../lib/log.js";
import { runInherit } from "../lib/proc.js";
import { resolveHost, readHostFromEnv } from "../lib/host.js";
import { COMPOSE_FILE, locateExistingRepo } from "../lib/repo.js";

export interface ReconfigureHostOptions {
  /** Explizite Adresse (--host / NOLMI_HOST) oder undefined → auflösen (Prompt/Detect). */
  host: string | undefined;
  /** Zielverzeichnis des bestehenden Clones (Default: ~/nolmi). */
  dir: string;
}

/**
 * `nolmi reconfigure-host` — Repair-Pfad für den Remote-URL-Fall: löst die
 * Browser-Adresse neu auf (gleicher Prompt/Detect wie onboard), ersetzt in der
 * bestehenden .env **ausschließlich** die NEXT_PUBLIC_RUNTIME_URL-Zeile und baut
 * das web-Image mit dem neuen Build-Arg neu.
 *
 * ⚠ DATENVERLUST-SCHUTZ: Es wird NIE NOLMI_ENCRYPTION_KEY / Session-Secret /
 * Bridge-Token angefasst oder neu generiert. Würde der Encryption-Key sich
 * ändern, wären die verschlüsselten LLM-Keys/OAuth-Tokens in der DB
 * unentschlüsselbar. Siehe `replaceRuntimeUrlLine` (zeilenweiser Durchlauf,
 * nur Match-Zeilen werden ersetzt, alles andere verbatim).
 */
export async function runReconfigureHost(opts: ReconfigureHostOptions): Promise<void> {
  step("Browser-Adresse neu setzen (reconfigure-host)");

  // 1) Vorhandenes Setup finden — NICHT klonen.
  const repoRoot = locateExistingRepo(opts.dir);
  if (!repoRoot) {
    die(
      `Kein vorhandenes Nolmi-Setup gefunden (weder hier noch in ${opts.dir}).\n` +
        "       Erst 'nolmi onboard' ausführen, oder mit --dir <pfad> auf den Clone zeigen.",
    );
  }
  const envDir = join(repoRoot, "docker", "nolmi");
  const envFile = join(envDir, ".env");
  if (!existsSync(envFile)) {
    die(`Keine .env gefunden: ${envFile}\n       Erst 'nolmi onboard' ausführen.`);
  }

  // 2) Aktuellen Host zeigen, neuen auflösen (gleicher Mechanismus wie onboard).
  const current = readHostFromEnv(envFile);
  if (current) dim(`Aktuelle Browser-Adresse in .env: ${current}`);
  const newHost = await resolveHost(opts.host);

  // 3) Idempotenz: gleicher Host → no-op (kein .env-Schreiben, kein Rebuild).
  if (current && current === newHost) {
    ok(`Adresse unverändert (${newHost}) — nichts zu tun (kein .env-Schreiben, kein Rebuild).`);
    return;
  }

  // 4) NUR die NEXT_PUBLIC_RUNTIME_URL-Zeile ersetzen — Secrets UNANGETASTET.
  const before = readFileSync(envFile, "utf8");
  const after = replaceRuntimeUrlLine(before, newHost);
  writeFileSync(envFile, after, { mode: 0o600 });
  chmodSync(envFile, 0o600);
  ok(`.env aktualisiert — nur NEXT_PUBLIC_RUNTIME_URL → http://${newHost}:4000 (Secrets unverändert).`);

  // 5) web-Image mit neuem Build-Arg neu bauen + Stack hochziehen.
  step("Stack neu bauen (web-Image mit neuer Adresse)");
  await runInherit("docker", ["compose", "-f", COMPOSE_FILE, "up", "-d", "--build"], { cwd: envDir });
  ok("Stack neu gebaut + gestartet.");

  plain("");
  plain(`  Fertig. Browser öffnen:  http://${newHost}:3000`);
  plain("");
}

/**
 * Ersetzt AUSSCHLIESSLICH `NEXT_PUBLIC_RUNTIME_URL=`-Zeilen — zeilenweise.
 * Jede andere Zeile (inkl. NOLMI_ENCRYPTION_KEY / NOLMI_SESSION_SECRET /
 * BRIDGE_REGISTER_TOKEN) wird **verbatim** durchgereicht. So kann kein Secret
 * je angefasst oder neu generiert werden (Datenverlust-Schutz). Wirft, wenn die
 * Zeile fehlt (dann bleibt die .env unverändert).
 */
function replaceRuntimeUrlLine(content: string, host: string): string {
  const lines = content.split("\n");
  let replaced = 0;
  const out = lines.map((line) => {
    if (/^NEXT_PUBLIC_RUNTIME_URL=/.test(line)) {
      replaced++;
      return `NEXT_PUBLIC_RUNTIME_URL=http://${host}:4000`;
    }
    return line;
  });
  if (replaced === 0) {
    die("NEXT_PUBLIC_RUNTIME_URL-Zeile nicht in .env gefunden — .env NICHT verändert.");
  }
  return out.join("\n");
}
