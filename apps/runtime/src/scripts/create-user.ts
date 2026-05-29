import "dotenv/config";
import Database from "better-sqlite3";
import { parseArgs } from "node:util";
import { loadRuntimeConfig } from "../config.js";
import { UserAlreadyExistsError, UsersRepo } from "../auth/users-repo.js";
import { TwinProfilesRepo } from "../twin-profiles-repo.js";

// ─── CREATE USER (CLI) ───────────────────────────────────────────────────────
//
// Legt einen User an, optional verknüpft mit einem bestehenden Twin via
// `--assign-twin @<handle>`. Gedacht für die einmalige Migration der drei
// Phase-2-Twins (markus/florian/heiko) zu echten User-Accounts.
//
// Aufruf:
//   pnpm --filter @nolmi/runtime user:create \
//     --email markus.baier@harway.de \
//     --password "<...>" \
//     --display-name "Markus Johannes Baier" \
//     --assign-twin @markus
//
// Caveat: Passwort als CLI-Arg landet in der Shell-History. Akzeptabel
// für das einmalige Setup, perspektivisch besser interaktive Prompts
// (Backlog).

async function main() {
  const { values } = parseArgs({
    options: {
      email: { type: "string" },
      password: { type: "string" },
      "display-name": { type: "string" },
      "assign-twin": { type: "string" },
    },
    strict: true,
  });

  const email = values.email?.trim();
  const password = values.password;
  const displayName = values["display-name"]?.trim();
  const assignTwin = values["assign-twin"]?.trim();

  if (!email || !password) {
    throw new Error(
      "Pflicht-Args fehlen. Nutzung:\n" +
        "  pnpm user:create --email <x@y.z> --password <pw> [--display-name '<Name>'] [--assign-twin @<handle>]",
    );
  }
  if (password.length < 8) {
    throw new Error("Passwort muss mind. 8 Zeichen haben");
  }

  const config = loadRuntimeConfig();
  const db = new Database(config.dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  const usersRepo = new UsersRepo(db);
  let user;
  try {
    user = usersRepo.create(email, password, displayName);
  } catch (err) {
    db.close();
    if (err instanceof UserAlreadyExistsError) {
      throw err;
    }
    throw err;
  }

  let assignedHandle: string | null = null;
  if (assignTwin) {
    const profilesRepo = new TwinProfilesRepo(db);
    const profile = profilesRepo.findByHandle(assignTwin);
    if (!profile) {
      db.close();
      throw new Error(
        `Twin '${assignTwin}' nicht in twin_profiles gefunden — User wurde erstellt, aber nicht verknüpft`,
      );
    }
    profilesRepo.update(profile.twinId, { ownerUserId: user.userId });
    assignedHandle = profile.handle;
  }

  db.close();

  console.log(`[user:create] User angelegt`);
  console.log(`              ID:    ${user.userId}`);
  console.log(`              Email: ${user.email}`);
  if (user.displayName) {
    console.log(`              Name:  ${user.displayName}`);
  }
  if (assignedHandle) {
    console.log(`              → verknüpft mit Twin ${assignedHandle}`);
  }
}

main().catch((err) => {
  console.error("[user:create] Fehler:", err instanceof Error ? err.message : err);
  process.exit(1);
});
