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
    // 2.5.4.2: read_at als separate SQL-Spalte (nicht in JSON), via SELECT
    // gemerged. Backward-compat: Spalte fehlt vor Migration 007 → null.
    const sql = `SELECT data, read_at FROM audit ${where} ORDER BY timestamp DESC LIMIT ? OFFSET ?`;
    const params: unknown[] = [];
    if (opts.twinId) params.push(opts.twinId);
    params.push(opts.limit, opts.offset ?? 0);
    const rows = this.db.prepare(sql).all(...params) as {
      data: string;
      read_at: string | null;
    }[];
    return rows.map((r) => mergeReadAt(r));
  }

  async get(id: string): Promise<AuditEntry | null> {
    const row = this.db
      .prepare("SELECT data, read_at FROM audit WHERE id = ?")
      .get(id) as { data: string; read_at: string | null } | undefined;
    return row ? mergeReadAt(row) : null;
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
    const sql = `SELECT data, read_at FROM audit WHERE ${where} LIMIT 1`;
    const params: unknown[] = opts.twinId ? [value, opts.twinId] : [value];
    const row = this.db.prepare(sql).get(...params) as
      | { data: string; read_at: string | null }
      | undefined;
    return row ? mergeReadAt(row) : null;
  }

  async markRead(id: string): Promise<void> {
    // Erste-Lesung gewinnt: nur setzen, wenn read_at noch NULL. So ist die
    // Methode safe-to-call, wenn das Frontend die mark-read-Anfrage doppelt
    // sendet (z.B. bei zwei parallelen Tabs).
    this.db
      .prepare(
        "UPDATE audit SET read_at = ? WHERE id = ? AND read_at IS NULL",
      )
      .run(new Date().toISOString(), id);
  }
}

function mergeReadAt(row: { data: string; read_at: string | null }): AuditEntry {
  const entry = JSON.parse(row.data) as AuditEntry;
  return { ...entry, readAt: row.read_at };
}
