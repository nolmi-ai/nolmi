import "dotenv/config";
import Database from "better-sqlite3";
import { loadRuntimeConfig } from "../config.js";
import { TwinProfilesRepo } from "../twin-profiles-repo.js";
import {
  EncryptionKeyMissingError,
  loadMasterKey,
} from "../crypto-utils.js";
import {
  McpServerAlreadyExistsError,
  McpServerNotFoundError,
  McpServerValidationError,
  McpServersRepo,
} from "../mcp/repo.js";

// ─── TEST: MCP-SERVERS-REPO (Phase 3.2 Sub-Schritt A) ───────────────────────
//
// Schema-Test gegen die lokale DB. Nimmt einen existierenden Twin (default
// @markus, override per CLI-Arg). Erzeugt zwei Test-Server, beide mit einem
// Test-Präfix damit echte Server (sobald welche existieren) nicht angefasst
// werden. Cleanup am Ende per remove() — kein Soft-Delete.
//
// Voraussetzung: pnpm db:init lief (Migration 011 angewendet),
// NOLMI_ENCRYPTION_KEY ist gesetzt, der Ziel-Twin existiert in
// twin_profiles.
//
// Aufruf:
//   pnpm --filter @nolmi/runtime tsx src/scripts/test-mcp-servers-repo.ts
//   pnpm --filter @nolmi/runtime tsx src/scripts/test-mcp-servers-repo.ts @markus

const TWIN_HANDLE_DEFAULT = "@markus";
const SERVER_NAME_NO_ENV = "_test-mcp-everything";
const SERVER_NAME_WITH_ENV = "_test-mcp-with-env";

async function main() {
  const handle = (process.argv[2] ?? TWIN_HANDLE_DEFAULT).toLowerCase();

  // 1. Master-Key zuerst — wenn die ENV nicht passt, brauchen wir gar nicht
  // erst die DB anzufassen.
  let masterKey: Buffer;
  try {
    masterKey = loadMasterKey();
  } catch (err) {
    if (err instanceof EncryptionKeyMissingError) {
      throw new Error(err.message);
    }
    throw err;
  }

  const config = loadRuntimeConfig();
  const db = new Database(config.dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  const profilesRepo = new TwinProfilesRepo(db);
  const repo = new McpServersRepo(db, masterKey);

  const profile = profilesRepo.findByHandle(handle);
  if (!profile) {
    throw new Error(`Twin '${handle}' nicht in DB.`);
  }
  log(`Test-Twin: ${profile.handle} (${profile.twinId})`);

  // Reset: falls ein Vor-Lauf hängengebliebene Test-Rows hinterlassen hat.
  cleanup(db, profile.twinId);

  let issues = 0;

  // ─── STEP 1: add() stdio-Server ohne env ──────────────────────────────────
  banner("STEP 1 — add() stdio ohne env");
  const noEnv = repo.add({
    twinId: profile.twinId,
    name: SERVER_NAME_NO_ENV,
    transport: "stdio",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-everything"],
    defaultRequiresApproval: true,
  });
  log(`  id:                       ${noEnv.id}`);
  log(`  transport:                ${noEnv.transport}`);
  log(`  command:                  ${noEnv.command}`);
  log(`  args:                     ${JSON.stringify(noEnv.args)}`);
  log(`  hasEnv:                   ${noEnv.hasEnv}`);
  log(`  defaultRequiresApproval:  ${noEnv.defaultRequiresApproval}`);
  if (!noEnv.id.startsWith("mcp_")) {
    issues += 1;
    log(`  ⚠ id-Präfix unerwartet.`);
  }
  if (noEnv.hasEnv !== false) {
    issues += 1;
    log(`  ⚠ hasEnv sollte false sein.`);
  }
  if (noEnv.url !== null) {
    issues += 1;
    log(`  ⚠ url sollte null sein bei stdio.`);
  }

  // ─── STEP 2: add() stdio-Server MIT env ───────────────────────────────────
  banner("STEP 2 — add() stdio mit env");
  const withEnv = repo.add({
    twinId: profile.twinId,
    name: SERVER_NAME_WITH_ENV,
    transport: "stdio",
    command: "node",
    args: ["./demo-server.js"],
    env: { API_KEY: "test-secret", TIMEOUT_MS: "5000" },
  });
  log(`  id:        ${withEnv.id}`);
  log(`  hasEnv:    ${withEnv.hasEnv}`);
  log(`  default…:  ${withEnv.defaultRequiresApproval}  (default true)`);
  if (withEnv.hasEnv !== true) {
    issues += 1;
    log(`  ⚠ hasEnv sollte true sein.`);
  }
  if (withEnv.defaultRequiresApproval !== true) {
    issues += 1;
    log(`  ⚠ defaultRequiresApproval-Default sollte true sein.`);
  }

  // ─── STEP 3: Duplikat-Name → McpServerAlreadyExistsError ──────────────────
  banner("STEP 3 — Duplikat-Name (UNIQUE)");
  let threwUnique = false;
  try {
    repo.add({
      twinId: profile.twinId,
      name: SERVER_NAME_NO_ENV,
      transport: "stdio",
      command: "npx",
      args: [],
    });
  } catch (err) {
    if (err instanceof McpServerAlreadyExistsError) {
      threwUnique = true;
      log(`  ✓ McpServerAlreadyExistsError geworfen.`);
    } else {
      log(`  ⚠ falscher Error-Typ: ${err instanceof Error ? err.name : String(err)}`);
    }
  }
  if (!threwUnique) {
    issues += 1;
    log(`  ⚠ Duplikat-Insert hätte werfen müssen.`);
  }

  // ─── STEP 4: Validation — stdio ohne command ──────────────────────────────
  banner("STEP 4 — Validation (stdio ohne command)");
  let threwValidation = false;
  try {
    repo.add({
      twinId: profile.twinId,
      name: "_test-mcp-invalid",
      transport: "stdio",
      // command absichtlich nicht gesetzt
    });
  } catch (err) {
    if (err instanceof McpServerValidationError) {
      threwValidation = true;
      log(`  ✓ McpServerValidationError geworfen: ${err.message}`);
    } else {
      log(`  ⚠ falscher Error-Typ: ${err instanceof Error ? err.name : String(err)}`);
    }
  }
  if (!threwValidation) {
    issues += 1;
    log(`  ⚠ stdio ohne command hätte werfen müssen.`);
  }

  // ─── STEP 5: findByName() findet ersten Server ────────────────────────────
  banner("STEP 5 — findByName()");
  const byName = repo.findByName(profile.twinId, SERVER_NAME_NO_ENV);
  if (byName.id !== noEnv.id) {
    issues += 1;
    log(`  ⚠ findByName liefert nicht den erwarteten Server.`);
  } else {
    log(`  gefunden: ${byName.id} (${byName.name})`);
  }

  // ─── STEP 6: getDecryptedEnv() für Server #2 ──────────────────────────────
  banner("STEP 6 — getDecryptedEnv() (mit env)");
  const decryptedEnv = repo.getDecryptedEnv(withEnv.id);
  log(`  env: ${JSON.stringify(decryptedEnv)}`);
  if (
    !decryptedEnv ||
    decryptedEnv.API_KEY !== "test-secret" ||
    decryptedEnv.TIMEOUT_MS !== "5000"
  ) {
    issues += 1;
    log(`  ⚠ Decrypt-Roundtrip fehlgeschlagen.`);
  } else {
    log(`  ✓ Decrypt-Roundtrip OK.`);
  }

  // ─── STEP 7: getDecryptedEnv() für Server #1 (kein env) ───────────────────
  banner("STEP 7 — getDecryptedEnv() (ohne env)");
  const noDecryptedEnv = repo.getDecryptedEnv(noEnv.id);
  log(`  env: ${JSON.stringify(noDecryptedEnv)}`);
  if (noDecryptedEnv !== null) {
    issues += 1;
    log(`  ⚠ getDecryptedEnv sollte null liefern.`);
  }

  // ─── STEP 8: list() → 2 Einträge ──────────────────────────────────────────
  banner("STEP 8 — list()");
  const all = repo.list(profile.twinId);
  log(`  count: ${all.length}`);
  log(`  reihenfolge: ${all.map((s) => s.name).join(", ")}`);
  if (all.length !== 2) {
    issues += 1;
    log(`  ⚠ erwartet 2, gefunden ${all.length}.`);
  }

  // ─── STEP 9: update() defaultRequiresApproval: false ──────────────────────
  banner("STEP 9 — update()");
  // Kleiner Sleep, damit updated_at sich vom created_at unterscheidet
  // (ISO-String, Sekunden-Auflösung kann zu eng sein).
  await sleep(10);
  const updated = repo.update(noEnv.id, { defaultRequiresApproval: false });
  log(`  defaultRequiresApproval: ${updated.defaultRequiresApproval}`);
  log(`  updated_at: ${updated.updatedAt}  (vorher: ${noEnv.updatedAt})`);
  if (updated.defaultRequiresApproval !== false) {
    issues += 1;
    log(`  ⚠ defaultRequiresApproval nicht aktualisiert.`);
  }
  if (updated.updatedAt <= noEnv.updatedAt) {
    issues += 1;
    log(`  ⚠ updated_at hat sich nicht bewegt.`);
  }

  // ─── STEP 10: setActive(false) ────────────────────────────────────────────
  banner("STEP 10 — setActive(false)");
  repo.setActive(noEnv.id, false);
  const reloaded = repo.findById(noEnv.id);
  log(`  isActive nach setActive(false): ${reloaded.isActive}`);
  if (reloaded.isActive !== false) {
    issues += 1;
    log(`  ⚠ isActive nicht auf false gesetzt.`);
  }

  // ─── STEP 11: remove() → findById wirft ──────────────────────────────────
  banner("STEP 11 — remove() + findById wirft");
  repo.remove(noEnv.id);
  let threwNotFound = false;
  try {
    repo.findById(noEnv.id);
  } catch (err) {
    if (err instanceof McpServerNotFoundError) {
      threwNotFound = true;
      log(`  ✓ findById nach remove() wirft McpServerNotFoundError.`);
    } else {
      log(`  ⚠ falscher Error-Typ: ${err instanceof Error ? err.name : String(err)}`);
    }
  }
  if (!threwNotFound) {
    issues += 1;
    log(`  ⚠ findById nach remove() hätte werfen müssen.`);
  }

  // Zusatz: zweites remove() auf gelöschten Server wirft auch.
  let threwRemoveTwice = false;
  try {
    repo.remove(noEnv.id);
  } catch (err) {
    if (err instanceof McpServerNotFoundError) threwRemoveTwice = true;
  }
  if (!threwRemoveTwice) {
    issues += 1;
    log(`  ⚠ remove() auf gelöschte ID hätte werfen müssen.`);
  }

  // ─── STEP 12: Cleanup zweiter Server ──────────────────────────────────────
  banner("STEP 12 — Cleanup");
  repo.remove(withEnv.id);
  const after = repo.list(profile.twinId).filter((s) =>
    s.name.startsWith("_test-mcp"),
  );
  log(`  nach Cleanup: ${after.length} Test-Einträge (erwartet 0)`);
  if (after.length !== 0) {
    issues += 1;
  }

  banner("ZUSAMMENFASSUNG");
  if (issues === 0) {
    log("✓ alle Tests grün");
  } else {
    log(`✗ ${issues} Issue(s) — Details oben.`);
  }

  db.close();
  if (issues > 0) process.exit(2);
}

function banner(title: string) {
  const line = "─".repeat(72);
  console.log(`\n${line}\n  ${title}\n${line}`);
}

function log(msg: string) {
  console.log(msg);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function cleanup(db: Database.Database, twinId: string) {
  db.prepare(
    `DELETE FROM mcp_servers
       WHERE twin_id = ?
         AND name LIKE '_test-mcp%'`,
  ).run(twinId);
}

main().catch((err) => {
  console.error(
    "\n[mcp-servers:test] Fehler:",
    err instanceof Error ? err.message : err,
  );
  process.exit(1);
});
