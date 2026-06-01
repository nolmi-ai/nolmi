// Konsolen-Ausgabe — direkter Port der log()/ok()/warn()/die()-Helfer aus
// install/install.sh (gleiche Symbole + Farben, damit der Wrapper sich wie das
// bewiesene Skript anfühlt).

const C = {
  cyan: "\x1b[1;36m",
  green: "\x1b[1;32m",
  yellow: "\x1b[1;33m",
  red: "\x1b[1;31m",
  dim: "\x1b[2m",
  reset: "\x1b[0m",
} as const;

/** Phasen-Überschrift (install.sh: `log()` → `▶`). */
export function step(msg: string): void {
  process.stdout.write(`\n${C.cyan}▶ ${msg}${C.reset}\n`);
}

/** Erfolg (install.sh: `ok()` → `✓`). */
export function ok(msg: string): void {
  process.stdout.write(`  ${C.green}✓${C.reset} ${msg}\n`);
}

/** Warnung, kein Abbruch (install.sh: `warn()` → `!`). */
export function warn(msg: string): void {
  process.stdout.write(`  ${C.yellow}!${C.reset} ${msg}\n`);
}

/** Neutrale Zeile (Mehrzeilen-Blöcke, URLs). */
export function plain(msg = ""): void {
  process.stdout.write(`${msg}\n`);
}

/** Gedimmte Zusatz-Info. */
export function dim(msg: string): void {
  process.stdout.write(`  ${C.dim}${msg}${C.reset}\n`);
}

/**
 * Erwarteter, benutzer-verständlicher Abbruch (install.sh: `die()`). Wird in
 * cli.ts gefangen und als rotes `✗` mit Exit 1 ausgegeben — getrennt von
 * unerwarteten Fehlern (Stacktrace).
 */
export class CliError extends Error {}

export function die(msg: string): never {
  throw new CliError(msg);
}

/** Rotes Fehler-Banner (von cli.ts beim Fangen genutzt). */
export function printError(msg: string): void {
  process.stderr.write(`\n${C.red}✗ ${msg}${C.reset}\n`);
}
