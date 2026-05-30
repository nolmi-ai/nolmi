import "dotenv/config";
import Database from "better-sqlite3";
import * as sqliteVec from "sqlite-vec";
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
  // 3.4.A: sqlite-vec laden bevor irgendeine Migration läuft, sonst wirft
  // 017_embeddings_and_fts.sql beim `CREATE VIRTUAL TABLE ... USING vec0(...)`
  // mit "no such module: vec0".
  sqliteVec.load(db);
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

    // Sonderfall — Table-Rebuilds an Tabellen mit EINGEHENDEN FK (z.B.
    // twin_profiles ← 11× ON DELETE CASCADE): ein `DROP TABLE` unter
    // foreign_keys=ON würde via impliziten Parent-DELETE alle Kind-Zeilen
    // kaskadiert löschen. Die offizielle SQLite-Prozedur verlangt deshalb
    // foreign_keys=OFF VOR der Transaktion (in offener Tx ist das Pragma ein
    // No-op). Eine Migration opt-in't dazu via Magic-Comment in Zeile 1.
    // Verifiziert: an dieser Stelle ist keine Transaktion offen (das einzige
    // BEGIN ist per-Migration weiter unten), also greift das OFF-Pragma.
    // Ohne Marker: der bestehende Pfad unten läuft byte-identisch wie zuvor.
    const needsFkOff = /^\s*--\s*nolmi:foreign_keys_off\b/m.test(sql);
    if (needsFkOff) {
      db.pragma("foreign_keys = OFF"); // außerhalb Tx → greift
      db.exec("BEGIN");
      try {
        db.exec(sql); // 12-Schritt-Rebuild im Migrations-SQL
        // foreign_key_check INNERHALB der Tx, VOR COMMIT — der Kern-Schutz:
        // beweist, dass der Rebuild keine verwaisten FK in den 11 Kind-
        // Tabellen hinterlassen hat. Verletzung → ROLLBACK, kein Commit.
        const violations = db.pragma("foreign_key_check") as unknown[];
        if (Array.isArray(violations) && violations.length > 0) {
          throw new Error(
            `foreign_key_check fand ${violations.length} Verletzung(en) — Rebuild abgebrochen`,
          );
        }
        markApplied.run(file, Date.now());
        db.exec("COMMIT");
        db.pragma("foreign_keys = ON"); // nach COMMIT wiederherstellen
        console.log(`[db:init] ${file} angewendet (foreign_keys_off-Modus)`);
        appliedCount++;
      } catch (err) {
        db.exec("ROLLBACK");
        db.pragma("foreign_keys = ON"); // auch im Fehlerfall zurücksetzen
        throw new Error(
          `Migration ${file} fehlgeschlagen: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
      continue;
    }

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

  // Ergänzung 2 (Gürtel + Hosenträger): unbedingt FK wieder auf ON, falls ein
  // foreign_keys_off-Lauf den Prozess in einem Zustand verließe, in dem das
  // Pragma nicht zurückgesetzt wurde. Im Normalfall ist es bereits ON.
  db.pragma("foreign_keys = ON");

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
