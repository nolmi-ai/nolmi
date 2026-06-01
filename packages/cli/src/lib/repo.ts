import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** Single-Host-Compose-Datei (relativ zu docker/nolmi/). */
export const COMPOSE_FILE = "docker-compose.single-host.yml";

/** cwd/dir ist das Repo-Root, wenn package.json name=nolmi UND Single-Host-Compose da ist. */
export function isNolmiRepoRoot(dir: string): boolean {
  const pkgPath = join(dir, "package.json");
  if (!existsSync(pkgPath)) return false;
  if (!existsSync(join(dir, "docker", "nolmi", COMPOSE_FILE))) return false;
  try {
    return JSON.parse(readFileSync(pkgPath, "utf8")).name === "nolmi";
  } catch {
    return false;
  }
}

/**
 * Findet ein **vorhandenes** Nolmi-Setup, ohne zu klonen (für reconfigure-host):
 * erst cwd-im-Repo, dann ein Clone im Zielverzeichnis. null = nichts gefunden.
 */
export function locateExistingRepo(dir: string): string | null {
  const cwd = process.cwd();
  if (isNolmiRepoRoot(cwd)) return cwd;
  if (existsSync(join(dir, ".git")) && existsSync(join(dir, "docker", "nolmi", COMPOSE_FILE))) {
    return dir;
  }
  return null;
}
