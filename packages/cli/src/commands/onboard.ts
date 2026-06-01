import { existsSync, writeFileSync, chmodSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { step, ok, warn, plain, dim, die } from "../lib/log.js";
import { silentOk, runInherit } from "../lib/proc.js";
import { encryptionKey, hex32 } from "../lib/secrets.js";
import { buildEnvFile } from "../lib/env-template.js";
import { waitForPort } from "../lib/readiness.js";
import { resolveHost, readHostFromEnv } from "../lib/host.js";
import { COMPOSE_FILE, isNolmiRepoRoot } from "../lib/repo.js";

const RUNTIME_SERVICE = "nolmi-runtime";
const RUNTIME_PORT = 4000;
const ONBOARD_CMD = "node dist/scripts/onboard.js"; // WORKDIR im Container: /app/apps/runtime

export interface OnboardOptions {
  /**
   * Browser-Adresse zum Server. **undefined** = interaktiv auflösen (Prompt +
   * Auto-Vorschlag der erkannten IP). Gesetzt nur bei explizitem
   * `--host` / `NOLMI_HOST` (dann ohne Prompt).
   */
  host: string | undefined;
  /** Ziel-Clone-Verzeichnis. install.sh: NOLMI_DIR (Default $HOME/nolmi). */
  dir: string;
  /** Repo-URL. install.sh: NOLMI_REPO_URL. */
  repoUrl: string;
  /** Branch. install.sh: NOLMI_BRANCH. */
  branch: string;
  /** false = Single-Process-Modus (Phase A) — reserviert, noch nicht gebaut. */
  useDocker: boolean;
}

/**
 * `nolmi onboard` — Node-Port der bewiesenen install/install.sh (7 Schritte),
 * mit den drei vorgesehenen Abweichungen: öffentliches Repo klonen (kein
 * git-archive/PAT), node:crypto statt openssl, TTY-Passthrough fürs onboard.
 */
export async function runOnboard(opts: OnboardOptions): Promise<void> {
  if (!opts.useDocker) {
    // Geschwister-Modus-Groove: Flag ist reserviert, A (Single-Process ohne
    // Docker) ist bewusst NICHT Teil dieser Phase.
    die(
      "Single-Process-Modus (--no-docker, Phase A) ist noch nicht implementiert.\n" +
        "       Aktuell nur der Docker-Modus (B). Lass --no-docker weg.",
    );
  }

  // ── 1/7  Vorbedingungen ────────────────────────────────────────────────────
  step("1/7  Voraussetzungen prüfen");
  const platform = process.platform;
  if (platform !== "linux" && platform !== "darwin") {
    die(`Nicht unterstütztes OS '${platform}' — nur Linux/macOS.`);
  }
  ok(`OS: ${platform}`);
  if (!silentOk("git", ["--version"])) {
    die("git fehlt — bitte installieren und erneut ausführen.");
  }
  ok("git vorhanden");
  // openssl wird NICHT gebraucht (node:crypto). Das ist Abweichung #2.

  // ── 2/7  Docker + Compose v2 ───────────────────────────────────────────────
  step("2/7  Docker prüfen");
  if (!silentOk("docker", ["--version"])) {
    die(
      "Docker fehlt.\n" +
        "       Linux:  curl -fsSL https://get.docker.com | sh\n" +
        "       macOS:  Docker Desktop installieren (https://www.docker.com/products/docker-desktop) + starten.",
    );
  }
  if (!silentOk("docker", ["compose", "version"])) {
    die("Docker-Compose-v2-Plugin fehlt (brauche 'docker compose', nicht das alte 'docker-compose').");
  }
  if (!silentOk("docker", ["info"])) {
    die(
      "Docker-Daemon nicht erreichbar / keine Rechte.\n" +
        "       Linux: 'sudo usermod -aG docker $USER' + neu einloggen, oder mit sudo ausführen.\n" +
        "       macOS: Docker Desktop starten.",
    );
  }
  ok("Docker + Compose v2 verfügbar");

  // ── 3/7  Repo bereitstellen ────────────────────────────────────────────────
  step("3/7  Repo bereitstellen");
  const repoRoot = await provideRepo(opts);

  const envDir = join(repoRoot, "docker", "nolmi");
  const composePath = join(envDir, COMPOSE_FILE);
  const envFile = join(envDir, ".env");
  if (!existsSync(composePath)) {
    die(`Compose-Datei fehlt: ${composePath}`);
  }

  // ── 4/7  Secrets + .env (node:crypto, idempotent) ──────────────────────────
  step("4/7  Secrets + .env");
  let resolvedHost: string;
  if (existsSync(envFile)) {
    warn(`.env existiert bereits (${envFile}) — Secrets werden NICHT neu erzeugt (idempotent).`);
    // Host für die Schluss-URLs aus der bestehenden .env lesen (kein Prompt).
    resolvedHost = readHostFromEnv(envFile) ?? "localhost";
    dim(`Browser-Adresse aus bestehender .env: ${resolvedHost}`);
    warn("Falsche Adresse in der .env? → 'nolmi reconfigure-host' (rebaut nur das web-Image).");
  } else {
    // Host VOR dem Build auflösen — dieser Wert wird build-time ins Web-Bundle
    // gebacken (NEXT_PUBLIC_RUNTIME_URL). Falscher Wert = Remote-Login bricht.
    resolvedHost = await resolveHost(opts.host);
    const content = buildEnvFile(resolvedHost, {
      encryptionKey: encryptionKey(),
      sessionSecret: hex32(),
      bridgeToken: hex32(),
    });
    // mode 0o600 beim Schreiben + explizites chmod (writeFile-mode wird von der
    // umask maskiert; chmod erzwingt 0600 hart — entspricht `umask 077` in install.sh).
    writeFileSync(envFile, content, { mode: 0o600 });
    chmodSync(envFile, 0o600);
    ok(`.env erzeugt (${envFile}) — Secrets wurden NICHT ausgegeben.`);
    warn(`Sichere ${envFile} (v.a. NOLMI_ENCRYPTION_KEY) an einem sicheren Ort.`);
  }

  // ── 5/7  Stack bauen + starten ─────────────────────────────────────────────
  step("5/7  Stack bauen + starten (erster Build dauert ein paar Minuten)");
  // cwd = docker/nolmi → Compose lädt ./.env automatisch, Build-Kontext ../.. = Repo-Root.
  await runInherit("docker", ["compose", "-f", COMPOSE_FILE, "up", "--build", "-d"], { cwd: envDir });
  ok("Container gestartet");

  // ── 6/7  DB-Init ───────────────────────────────────────────────────────────
  step("6/7  DB-Init");
  ok("Migrationen laufen idempotent im Container-CMD beim Boot (init-db.js) — kein manueller Schritt.");

  // ── 7/7  Onboarding-Übergabe + Abschluss ───────────────────────────────────
  step("7/7  Ersten Account anlegen");
  await handoffOnboard(envDir);

  printFinish(resolvedHost, envDir);
}

/** Schritt 3 — Repo-Bereitstellung, Logik 1:1 aus install.sh (in-repo / pull / clone). */
async function provideRepo(opts: OnboardOptions): Promise<string> {
  // a) Im Repo ausgeführt? (cwd-package.json name=nolmi + Single-Host-Compose da)
  const cwd = process.cwd();
  if (isNolmiRepoRoot(cwd)) {
    ok(`Im Repo ausgeführt — nutze ${cwd}`);
    return cwd;
  }

  // b) Bestehender Clone im Zielverzeichnis → ff-only pull
  if (existsSync(join(opts.dir, ".git"))) {
    if (silentOk("git", ["-C", opts.dir, "pull", "--ff-only"])) {
      ok(`Bestehendes Repo aktualisiert: ${opts.dir}`);
    } else {
      warn("git pull übersprungen (lokale Änderungen?) — nutze Bestand.");
    }
    return opts.dir;
  }

  // c) Zielverzeichnis existiert, ist aber KEIN Nolmi-Clone → nicht blind klonen
  if (existsSync(opts.dir) && !isEmptyDirSafe(opts.dir)) {
    die(
      `Zielverzeichnis existiert und ist kein Nolmi-Clone: ${opts.dir}\n` +
        "       Wähle einen anderen Pfad (NOLMI_DIR=… oder --dir <pfad>) oder entferne es.",
    );
  }

  // d) Frischer Clone des ÖFFENTLICHEN Repos (kein PAT nötig)
  await runInherit("git", ["clone", "--branch", opts.branch, "--depth", "1", opts.repoUrl, opts.dir]);
  ok(`Repo geklont: ${opts.dir}`);
  return opts.dir;
}

/** Schritt 7 — interaktive Onboard-Übergabe mit TTY-Passthrough (Abweichung #3). */
async function handoffOnboard(envDir: string): Promise<void> {
  const manual = `cd "${envDir}" && docker compose -f ${COMPOSE_FILE} exec -it ${RUNTIME_SERVICE} ${ONBOARD_CMD}`;

  // Onboard greift direkt auf die migrierte DB im Container zu → erst warten,
  // bis der Runtime lauscht (= Migration durch).
  plain("");
  dim("Warte, bis der Runtime bereit ist (Boot + Migrationen) …");
  const ready = await waitForPort(RUNTIME_PORT, 180_000, (s) => {
    if (s > 0 && s % 20 === 0) dim(`… noch am Warten (${s}s)`);
  });
  if (!ready) {
    warn("Runtime war nach 180s nicht erreichbar — überspringe das automatische Onboarding.");
    printManualOnboard(manual);
    return;
  }
  ok("Runtime bereit.");

  // `docker compose exec -it` braucht ein echtes TTY. In nicht-interaktiven
  // Kontexten (CI, Pipe) würde `-t` mit „input device is not a TTY" brechen →
  // dann den Befehl nur ausgeben statt ausführen.
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    warn("Kein interaktives Terminal (TTY) — überspringe das automatische Onboarding.");
    printManualOnboard(manual);
    return;
  }

  plain("");
  plain("  Jetzt den ersten Account anlegen (interaktiv — E-Mail + Passwort):");
  plain("");
  try {
    await runInherit(
      "docker",
      ["compose", "-f", COMPOSE_FILE, "exec", "-it", RUNTIME_SERVICE, "node", "dist/scripts/onboard.js"],
      { cwd: envDir },
    );
    ok("Onboarding abgeschlossen.");
  } catch (err) {
    warn(`Onboarding nicht abgeschlossen (${(err as Error).message}).`);
    printManualOnboard(manual);
  }
}

function printManualOnboard(manual: string): void {
  plain("");
  plain("  Account später manuell anlegen:");
  plain(`    ${manual}`);
}

/** Abschluss-Banner (URLs + Hinweise), Port von install.sh-Schritt 7. */
function printFinish(host: string, envDir: string): void {
  step("Fertig");
  plain("");
  plain("  Nolmi läuft (Single-Host, ohne TLS):");
  plain(`    Web:     http://${host}:3000`);
  plain(`    Runtime: http://${host}:4000`);
  plain("    Bridge:  intern (nolmi-bridge:5100, Host-Port 5100)");
  plain("");
  plain("  Nächste Schritte:");
  plain(`    Browser öffnen:  http://${host}:3000`);
  plain("    Als angelegter User einloggen — der Wizard führt durch die Twin-Anlage");
  plain("    (Persona + LLM-Key + optionale Presets).");
  plain("");
  plain("  Hinweise:");
  plain("    • TLS/Domain (HTTPS, app.<deine-domain>) ist der spätere Schritt 3b (Traefik).");
  plain("    • Auf einem öffentlichen VPS sind :3000/:4000/:5100 ungeschützt offen —");
  plain("      ohne Reverse-Proxy/Firewall nur für vertrauenswürdige Netze geeignet.");
  plain(`    • Secret-Backup: ${join(envDir, ".env")} sichern (NOLMI_ENCRYPTION_KEY!).`);
  plain("");
}

/** Leeres Verzeichnis? (Fehler beim Lesen → als „nicht leer" behandeln, defensiv.) */
function isEmptyDirSafe(dir: string): boolean {
  try {
    return readdirSync(dir).length === 0;
  } catch {
    return false;
  }
}
