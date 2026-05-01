import "dotenv/config";
import Database from "better-sqlite3";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { mkdir } from "node:fs/promises";
import { loadRuntimeConfig } from "../config.js";

// ─── DB INIT ─────────────────────────────────────────────────────────────────
//
// Führt SQL-Migrationen aus `apps/runtime/migrations/` in numerischer
// Reihenfolge aus. Filename-Konvention `NNN_name.sql` mit zero-padded
// Präfix (lexikographische Sortierung = numerische Sortierung).
//
// Tracking: `schema_migrations(id, applied_at)` merkt sich pro Filename, ob
// die Migration schon gelaufen ist. Damit darf eine Migration auch
// non-idempotente Statements wie `ALTER TABLE ADD COLUMN` enthalten — sie
// läuft genau einmal und wird danach übersprungen.
//
// Pro Migration eine Transaktion: SQL-Body + Tracking-INSERT atomar. Bricht
// das SQL ab, gibt's ROLLBACK und keinen Tracking-Eintrag — beim nächsten
// Run wird die Migration erneut versucht.
//
// Pfade über `loadRuntimeConfig()`, gleiche Source of Truth wie der
// Runtime-Boot.

async function main() {
  const config = loadRuntimeConfig();
  await mkdir(dirname(config.dbPath), { recursive: true });

  const db = new Database(config.dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  // Tracker-Tabelle anlegen (chicken-and-egg: kann nicht selbst Migration sein)
  db.exec(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
       id TEXT PRIMARY KEY NOT NULL,
       applied_at INTEGER NOT NULL
     )`,
  );

  const files = readdirSync(config.migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  if (files.length === 0) {
    console.warn(`[db:init] Keine .sql-Files in ${config.migrationsDir}`);
  }

  const isApplied = db.prepare("SELECT 1 FROM schema_migrations WHERE id = ?");
  const markApplied = db.prepare(
    "INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)",
  );

  let appliedCount = 0;
  let skippedCount = 0;

  for (const file of files) {
    if (isApplied.get(file)) {
      skippedCount++;
      continue;
    }

    const path = resolve(config.migrationsDir, file);
    const sql = readFileSync(path, "utf-8");
    db.exec("BEGIN");
    try {
      db.exec(sql);
      markApplied.run(file, Date.now());
      db.exec("COMMIT");
      console.log(`[db:init] ${file} angewendet`);
      appliedCount++;
    } catch (err) {
      db.exec("ROLLBACK");
      throw new Error(
        `Migration ${file} fehlgeschlagen: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  if (skippedCount > 0) {
    console.log(`[db:init] ${skippedCount} Migration(en) bereits angewendet (skipped)`);
  }
  console.log(
    `[db:init] Schema initialisiert in ${config.dbPath} (${appliedCount} neu, ${skippedCount} skipped)`,
  );
  db.close();
}

main().catch((err) => {
  console.error("[db:init] Fehler:", err);
  process.exit(1);
});
