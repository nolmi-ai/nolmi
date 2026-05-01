import type Database from "better-sqlite3";
import { TwinProfilesRepo, type TwinProfile } from "./twin-profiles-repo.js";

// ─── ACTIVE TWIN PROFILE LOADER ──────────────────────────────────────────────
//
// Eine kleine Boot-Hilfe: lädt den aktiven Twin per Handle aus
// `twin_profiles`. Wirft `TwinProfileNotAvailableError`, wenn der Eintrag
// fehlt oder soft-deleted ist (`is_active = 0`). Der Index-Boot fängt diesen
// Error ab und exit-1't mit Hinweis aufs Bootstrap-Script.

export class TwinProfileNotAvailableError extends Error {
  constructor(
    public readonly handle: string,
    public readonly reason: "not_found" | "inactive",
  ) {
    const detail = reason === "not_found" ? "nicht gefunden" : "inaktiv (soft-deleted)";
    super(
      `Twin '${handle}' ${detail} in DB.\n` +
        `Hinweis: Hast du 'pnpm --filter @twin-lab/runtime twin:bootstrap' ausgeführt? ` +
        `Das Script schreibt @markus aus docs/ + .env in die twin_profiles-Tabelle.`,
    );
    this.name = "TwinProfileNotAvailableError";
  }
}

export function loadActiveTwinProfile(
  db: Database.Database,
  handle: string,
): TwinProfile {
  const repo = new TwinProfilesRepo(db);
  const profile = repo.findByHandle(handle);
  if (!profile) {
    throw new TwinProfileNotAvailableError(handle, "not_found");
  }
  if (!profile.isActive) {
    throw new TwinProfileNotAvailableError(handle, "inactive");
  }
  return profile;
}
