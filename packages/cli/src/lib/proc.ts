import { spawn, spawnSync } from "node:child_process";

/**
 * Läuft ein Befehl still durch und meldet nur Erfolg/Fehlschlag — für
 * Vorbedingungs-Checks (`docker info`, `git --version` …). Ersatz für die
 * `command -v … && …`-Muster aus install.sh.
 */
export function silentOk(cmd: string, args: string[]): boolean {
  try {
    return spawnSync(cmd, args, { stdio: "ignore" }).status === 0;
  } catch {
    return false;
  }
}

/**
 * Läuft ein Befehl mit durchgereichten stdio (`inherit`) — der User sieht
 * Build-Output live, und interaktive Prozesse (onboard) bekommen das TTY.
 * Wirft bei Exit ≠ 0. Das ist der TTY-Passthrough, den der onboard-Schritt
 * zwingend braucht (sonst bricht der interaktive Prompt).
 */
export function runInherit(
  cmd: string,
  args: string[],
  opts: { cwd?: string } = {},
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: "inherit", cwd: opts.cwd });
    child.on("error", (err) => reject(err));
    child.on("exit", (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`\`${cmd} ${args.join(" ")}\` → Exit ${code ?? signal}`));
    });
  });
}
