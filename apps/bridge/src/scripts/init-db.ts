import "dotenv/config";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdir } from "node:fs/promises";
import { openDatabase } from "../db.js";

// ─── DB INIT ─────────────────────────────────────────────────────────────────
//
// Führt die SQL-Migrationen aus apps/bridge/migrations aus.
// Idempotent: kann mehrfach laufen, alle Statements sind CREATE … IF NOT EXISTS.
//
// Wird per `pnpm --filter @twin-lab/bridge db:init` aufgerufen.

async function main() {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);
  const packageRoot = resolve(__dirname, "../..");
  const dbPath = process.env.BRIDGE_DATABASE_PATH ?? resolve(packageRoot, "data/bridge.db");
  const migrationPath = resolve(packageRoot, "migrations/001_init.sql");

  await mkdir(resolve(dbPath, ".."), { recursive: true });

  const db = openDatabase(dbPath);
  const sql = readFileSync(migrationPath, "utf-8");
  db.exec(sql);

  console.log(`[db:init] Schema initialisiert in ${dbPath}`);
  db.close();
}

main().catch((err) => {
  console.error("[db:init] Fehler:", err);
  process.exit(1);
});
