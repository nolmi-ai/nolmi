import Database from "better-sqlite3";
import type { AuditRepository, RepositoryBundle } from "./types.js";
import type { AuditEntry } from "@twin-lab/shared";

// ─── SQLITE BUNDLE ───────────────────────────────────────────────────────────
//
// Eine DB-Connection pro Runtime, mit WAL + foreign_keys. Die `db` ist im
// Bundle exposed, damit andere Repos (TwinProfilesRepo etc.) dieselbe
// Connection wiederverwenden können statt eine zweite auf dieselbe Datei zu
// öffnen.

export function createSqliteRepository(dbPath: string): RepositoryBundle {
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  return {
    audit: new SqliteAuditRepository(db),
    db,
  };
}

// ─── AUDIT ───────────────────────────────────────────────────────────────────

class SqliteAuditRepository implements AuditRepository {
  constructor(private db: Database.Database) {}

  async append(entry: AuditEntry): Promise<void> {
    this.db
      .prepare(
        `INSERT INTO audit (id, timestamp, capability, mandate_id, status, data)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        entry.id,
        entry.timestamp,
        entry.capability,
        entry.mandateId,
        entry.status,
        JSON.stringify(entry),
      );
  }

  async update(id: string, patch: Partial<AuditEntry>): Promise<void> {
    const existing = await this.get(id);
    if (!existing) throw new Error(`Audit entry ${id} not found`);
    const updated: AuditEntry = { ...existing, ...patch, id };
    this.db
      .prepare(
        `UPDATE audit SET status = ?, data = ?, timestamp = ?
         WHERE id = ?`,
      )
      .run(updated.status, JSON.stringify(updated), updated.timestamp, id);
  }

  async list(opts: { limit: number; offset?: number }): Promise<AuditEntry[]> {
    const rows = this.db
      .prepare("SELECT data FROM audit ORDER BY timestamp DESC LIMIT ? OFFSET ?")
      .all(opts.limit, opts.offset ?? 0) as { data: string }[];
    return rows.map((r) => JSON.parse(r.data) as AuditEntry);
  }

  async get(id: string): Promise<AuditEntry | null> {
    const row = this.db.prepare("SELECT data FROM audit WHERE id = ?").get(id) as
      | { data: string }
      | undefined;
    return row ? (JSON.parse(row.data) as AuditEntry) : null;
  }

  async findByInputField(field: string, value: string): Promise<AuditEntry | null> {
    // Pfad-Injection-Schutz: nur einfache Identifier zulassen, weil wir den
    // json_extract-Pfad als String konkatenieren müssen (SQLite akzeptiert
    // keinen Bind-Parameter im Pfad).
    if (!/^[a-zA-Z0-9_]+$/.test(field)) {
      throw new Error(`Invalid field name for findByInputField: ${field}`);
    }
    const row = this.db
      .prepare(
        `SELECT data FROM audit WHERE json_extract(data, '$.input.${field}') = ? LIMIT 1`,
      )
      .get(value) as { data: string } | undefined;
    return row ? (JSON.parse(row.data) as AuditEntry) : null;
  }
}
