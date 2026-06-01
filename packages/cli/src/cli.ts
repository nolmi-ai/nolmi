#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { runOnboard, type OnboardOptions } from "./commands/onboard.js";
import { runReconfigureHost, type ReconfigureHostOptions } from "./commands/reconfigure-host.js";
import { CliError, printError, plain } from "./lib/log.js";

// install.sh-Defaults gespiegelt (gleiche ENV-Namen + Werte = eine Wahrheit).
// host bewusst KEIN localhost-Default mehr: undefined → onboard löst interaktiv
// auf (Prompt + Auto-Vorschlag). NOLMI_HOST gesetzt = explizit (kein Prompt).
const NOLMI_HOST_ENV = process.env.NOLMI_HOST?.trim() || undefined;
const DEFAULTS = {
  dir: process.env.NOLMI_DIR ?? join(homedir(), "nolmi"),
  repoUrl: process.env.NOLMI_REPO_URL ?? "https://github.com/nolmi-ai/nolmi.git",
  branch: process.env.NOLMI_BRANCH ?? "main",
};

interface ParsedArgs {
  command: string | undefined;
  /** undefined = nicht explizit gesetzt → interaktiv auflösen. */
  host: string | undefined;
  dir: string;
  repoUrl: string;
  branch: string;
  useDocker: boolean;
  help: boolean;
  version: boolean;
}

function parseArgs(argv: string[]): ParsedArgs {
  const out: ParsedArgs = {
    command: undefined,
    host: NOLMI_HOST_ENV,
    dir: DEFAULTS.dir,
    repoUrl: DEFAULTS.repoUrl,
    branch: DEFAULTS.branch,
    useDocker: true,
    help: false,
    version: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case "-h":
      case "--help":
        out.help = true;
        break;
      case "-V":
      case "--version":
        out.version = true;
        break;
      case "--host":
        out.host = requireValue(argv, ++i, "--host");
        break;
      case "--dir":
        out.dir = requireValue(argv, ++i, "--dir");
        break;
      case "--repo":
        out.repoUrl = requireValue(argv, ++i, "--repo");
        break;
      case "--branch":
        out.branch = requireValue(argv, ++i, "--branch");
        break;
      case "--no-docker":
        // Reserviert für Phase A (Single-Process, ohne Docker) — Geschwister-
        // Modus-Groove. onboard meldet sauber „noch nicht implementiert".
        out.useDocker = false;
        break;
      default:
        if (a !== undefined && a.startsWith("-")) {
          throw new CliError(`Unbekannte Option: ${a}  (\`nolmi --help\`)`);
        }
        if (out.command === undefined) out.command = a;
        else throw new CliError(`Unerwartetes Argument: ${a}  (\`nolmi --help\`)`);
    }
  }
  return out;
}

function requireValue(argv: string[], i: number, flag: string): string {
  const v = argv[i];
  if (v === undefined || v.startsWith("-")) {
    throw new CliError(`${flag} braucht einen Wert.`);
  }
  return v;
}

function readVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
    return typeof pkg.version === "string" ? pkg.version : "0.0.0";
  } catch {
    return "0.0.0";
  }
}

function printHelp(): void {
  plain(`nolmi — Self-hosted AI-Twins, in einem Befehl aufgesetzt.

Verwendung:
  nolmi onboard [Optionen]           Docker-Stack aus dem öffentlichen Repo
                                     aufsetzen und den ersten Account anlegen.
  nolmi reconfigure-host [Optionen]  Browser-Adresse nachträglich ändern
                                     (rebaut nur das web-Image; Secrets bleiben).

Optionen:
  --host <adresse>   Browser-Adresse zum Server (IP oder Domain, ohne http://
                     und ohne Port). Wenn gesetzt: kein Prompt. Wenn NICHT
                     gesetzt: onboard schlägt die erkannte IP vor und fragt
                     nach (Enter bestätigt). Diese Adresse wird build-time ins
                     Web-Bundle gebacken — für Remote-Zugriff (VPS + Browser vom
                     Laptop) MUSS sie die Server-IP/Domain sein, nicht localhost.
  --dir <pfad>       Ziel-Clone-Verzeichnis (Default: ~/nolmi).
  --branch <name>    Git-Branch (Default: main).
  --repo <url>       Repo-URL (Default: github.com/nolmi-ai/nolmi).
  -h, --help         Diese Hilfe.
  -V, --version      Version.

Auch als ENV setzbar: NOLMI_HOST, NOLMI_DIR, NOLMI_BRANCH, NOLMI_REPO_URL.
(NOLMI_HOST gesetzt = explizit, kein Prompt — wie --host.)

Was onboard tut (Node-Port des bewiesenen install/install.sh):
  Vorbedingungen prüfen → öffentliches Repo klonen → Browser-Adresse auflösen
  (Auto-Vorschlag) → Secrets via node:crypto + .env (idempotent) → Docker-Stack
  bauen+starten → interaktiv ersten Account anlegen → URLs ausgeben.

reconfigure-host: löst die Adresse neu auf, ersetzt NUR die
  NEXT_PUBLIC_RUNTIME_URL-Zeile in der .env (Secrets unangetastet) und baut das
  web-Image neu. Für den Fall „onboard hat localhost gebacken, Zugriff ist remote".

Voraussetzungen: git, Docker + Docker-Compose-v2-Plugin, laufender Docker-Daemon.`);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (args.version) {
    plain(readVersion());
    return;
  }
  if (args.help || args.command === undefined || args.command === "help") {
    printHelp();
    return;
  }

  switch (args.command) {
    case "onboard": {
      const opts: OnboardOptions = {
        host: args.host,
        dir: args.dir,
        repoUrl: args.repoUrl,
        branch: args.branch,
        useDocker: args.useDocker,
      };
      await runOnboard(opts);
      return;
    }
    case "reconfigure-host": {
      const opts: ReconfigureHostOptions = {
        host: args.host,
        dir: args.dir,
      };
      await runReconfigureHost(opts);
      return;
    }
    default:
      throw new CliError(`Unbekannter Befehl: ${args.command}  (\`nolmi --help\`)`);
  }
}

main().catch((err: unknown) => {
  if (err instanceof CliError) {
    printError(err.message);
  } else {
    printError(`Unerwarteter Fehler: ${(err as Error)?.message ?? String(err)}`);
  }
  process.exitCode = 1;
});
