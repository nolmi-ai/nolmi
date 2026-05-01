import Database from "better-sqlite3";

// ─── DB SETUP ────────────────────────────────────────────────────────────────
//
// Eine einzige SQLite-Instanz pro Bridge-Prozess, geteilt zwischen den Repos.
// WAL-Mode für nebenläufige Reads (SSE-Connections) parallel zu Writes (POST
// /messages). foreign_keys für die Twin-Referenzen in `messages`.

export type Db = Database.Database;

export function openDatabase(dbPath: string): Db {
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  return db;
}
