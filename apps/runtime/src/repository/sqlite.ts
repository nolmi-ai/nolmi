import Database from "better-sqlite3";
import type { AuditListOpts, AuditRepository, RepositoryBundle } from "./types.js";
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
        `INSERT INTO audit (id, twin_id, timestamp, capability, mandate_id, status, data)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        entry.id,
        entry.twinId,
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

  async list(opts: AuditListOpts): Promise<AuditEntry[]> {
    const where = opts.twinId ? "WHERE twin_id = ?" : "";
    const sql = `SELECT data FROM audit ${where} ORDER BY timestamp DESC LIMIT ? OFFSET ?`;
    const params: unknown[] = [];
    if (opts.twinId) params.push(opts.twinId);
    params.push(opts.limit, opts.offset ?? 0);
    const rows = this.db.prepare(sql).all(...params) as { data: string }[];
    return rows.map((r) => JSON.parse(r.data) as AuditEntry);
  }

  async get(id: string): Promise<AuditEntry | null> {
    const row = this.db.prepare("SELECT data FROM audit WHERE id = ?").get(id) as
      | { data: string }
      | undefined;
    return row ? (JSON.parse(row.data) as AuditEntry) : null;
  }

  async findByInputField(
    field: string,
    value: string,
    opts: { twinId?: string } = {},
  ): Promise<AuditEntry | null> {
    // Pfad-Injection-Schutz: nur einfache Identifier zulassen, weil wir den
    // json_extract-Pfad als String konkatenieren müssen (SQLite akzeptiert
    // keinen Bind-Parameter im Pfad).
    if (!/^[a-zA-Z0-9_]+$/.test(field)) {
      throw new Error(`Invalid field name for findByInputField: ${field}`);
    }
    const where = opts.twinId
      ? `json_extract(data, '$.input.${field}') = ? AND twin_id = ?`
      : `json_extract(data, '$.input.${field}') = ?`;
    const sql = `SELECT data FROM audit WHERE ${where} LIMIT 1`;
    const params: unknown[] = opts.twinId ? [value, opts.twinId] : [value];
    const row = this.db.prepare(sql).get(...params) as { data: string } | undefined;
    return row ? (JSON.parse(row.data) as AuditEntry) : null;
  }
}
