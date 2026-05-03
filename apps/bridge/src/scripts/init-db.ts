import "dotenv/config";
import { readdirSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdir } from "node:fs/promises";
import { openDatabase } from "../db.js";

// ─── DB INIT ─────────────────────────────────────────────────────────────────
//
// Führt SQL-Migrationen aus apps/bridge/migrations in lexikographischer
// Reihenfolge aus. Filename-Konvention `NNN_name.sql` mit zero-padded
// Präfix — gleiche Logik wie Runtime, damit ALTER TABLE-Statements (z.B.
// 002_message_type) nur einmal laufen.
//
// schema_migrations(id, applied_at) trackt pro Filename, ob die Migration
// schon durchgelaufen ist. Eine Transaktion pro Migration: Rollback bei
// Fehler, sodass beim nächsten Run derselbe Versuch nochmal startet.

async function main() {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);
  const packageRoot = resolve(__dirname, "../..");
  const dbPath = process.env.BRIDGE_DATABASE_PATH ?? resolve(packageRoot, "data/bridge.db");
  const migrationsDir = resolve(packageRoot, "migrations");

  await mkdir(resolve(dbPath, ".."), { recursive: true });

  const db = openDatabase(dbPath);

  // Tracker-Tabelle anlegen (chicken-and-egg: kann nicht selbst Migration sein)
  db.exec(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
       id TEXT PRIMARY KEY NOT NULL,
       applied_at INTEGER NOT NULL
     )`,
  );

  // Backward-Compat: existierende Bridge-DBs haben 001 schon angewendet (vor
  // Tracker-Einführung). Wir markieren 001 als applied, wenn die `messages`-
  // Tabelle existiert aber noch kein Tracker-Eintrag da ist — sonst würde der
  // CREATE TABLE in 001 zwar mit IF NOT EXISTS überlebt, aber der Tracker
  // wäre für 001 leer und sähe fälschlich neu aus.
  const messagesExists = db
    .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='messages'")
    .get();
  if (messagesExists) {
    db.prepare(
      "INSERT OR IGNORE INTO schema_migrations (id, applied_at) VALUES (?, ?)",
    ).run("001_init.sql", Date.now());
  }

  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  if (files.length === 0) {
    console.warn(`[db:init] Keine .sql-Files in ${migrationsDir}`);
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
    const path = resolve(migrationsDir, file);
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
    `[db:init] Schema initialisiert in ${dbPath} (${appliedCount} neu, ${skippedCount} skipped)`,
  );
  db.close();
}

main().catch((err) => {
  console.error("[db:init] Fehler:", err);
  process.exit(1);
});
