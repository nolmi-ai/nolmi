import "dotenv/config";
import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { mkdir } from "node:fs/promises";

// ─── DB INIT ─────────────────────────────────────────────────────────────────
//
// Führt die SQL-Migrations aus infra/migrations aus.
// Idempotent: kann mehrfach aufgerufen werden, CREATE TABLE IF NOT EXISTS.

async function main() {
  const dbPath = process.env.DATABASE_PATH ?? "./data/twin.db";
  await mkdir(resolve(dbPath, ".."), { recursive: true });

  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  const migrationPath = resolve(process.cwd(), "../../infra/migrations/001_init.sql");
  const sql = readFileSync(migrationPath, "utf-8");
  db.exec(sql);

  console.log(`[db:init] Schema initialisiert in ${dbPath}`);
  db.close();
}

main().catch((err) => {
  console.error("[db:init] Fehler:", err);
  process.exit(1);
});
