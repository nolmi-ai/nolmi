import "dotenv/config";
import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import { dirname } from "node:path";
import { mkdir } from "node:fs/promises";
import { loadRuntimeConfig } from "../config.js";

// ─── DB INIT ─────────────────────────────────────────────────────────────────
//
// Führt die SQL-Migrations aus infra/migrations aus.
// Idempotent: kann mehrfach aufgerufen werden, CREATE TABLE IF NOT EXISTS.
//
// Liest Pfade über die zentrale RuntimeConfig — dadurch landet `pnpm db:init`
// in genau der DB, die der Runtime später öffnet, auch wenn TWIN_DATABASE_PATH
// gesetzt ist (z.B. für eine zweite Twin-Instanz wie Florian).

async function main() {
  const config = loadRuntimeConfig();
  await mkdir(dirname(config.dbPath), { recursive: true });

  const db = new Database(config.dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  const sql = readFileSync(config.migrationPath, "utf-8");
  db.exec(sql);

  console.log(`[db:init] Migration aus ${config.migrationPath}`);
  console.log(`[db:init] Schema initialisiert in ${config.dbPath}`);
  db.close();
}

main().catch((err) => {
  console.error("[db:init] Fehler:", err);
  process.exit(1);
});
