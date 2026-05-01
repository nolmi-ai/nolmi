import "dotenv/config";
import Database from "better-sqlite3";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { mkdir } from "node:fs/promises";
import { loadRuntimeConfig } from "../config.js";

// ─── DB INIT ─────────────────────────────────────────────────────────────────
//
// Führt alle SQL-Migrationen aus `apps/runtime/migrations/` in numerischer
// Reihenfolge aus. Konvention: Filenamen `NNN_name.sql` mit zero-padded
// Präfix (001, 002, …) — lexikographische Sortierung deckt sich dann mit
// numerischer.
//
// Idempotent: jede Migration nutzt `CREATE TABLE IF NOT EXISTS` etc., damit
// das Script mehrfach laufen darf. Jede Datei läuft in einer eigenen
// Transaktion — partielle Fehler reißen die DB nicht in einen Halbzustand.
//
// Liest Pfade über `loadRuntimeConfig()` — gleiche Source of Truth wie der
// Runtime-Boot. So landet `pnpm db:init` in genau der DB, die der Runtime
// später öffnet, auch wenn `TWIN_DATABASE_PATH` gesetzt ist.

async function main() {
  const config = loadRuntimeConfig();
  await mkdir(dirname(config.dbPath), { recursive: true });

  const db = new Database(config.dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  const files = readdirSync(config.migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  if (files.length === 0) {
    console.warn(`[db:init] Keine .sql-Files in ${config.migrationsDir}`);
  }

  for (const file of files) {
    const path = resolve(config.migrationsDir, file);
    const sql = readFileSync(path, "utf-8");
    db.exec("BEGIN");
    try {
      db.exec(sql);
      db.exec("COMMIT");
      console.log(`[db:init] ${file} angewendet`);
    } catch (err) {
      db.exec("ROLLBACK");
      throw new Error(`Migration ${file} fehlgeschlagen: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  console.log(`[db:init] Schema initialisiert in ${config.dbPath}`);
  db.close();
}

main().catch((err) => {
  console.error("[db:init] Fehler:", err);
  process.exit(1);
});
