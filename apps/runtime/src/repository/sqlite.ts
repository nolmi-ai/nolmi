import Database from "better-sqlite3";
import type {
  AuditRepository,
  MandateRepository,
  PersonaRepository,
  RepositoryBundle,
} from "./types.js";
import type { AuditEntry, Mandate, Persona } from "@twin-lab/shared";

// ─── SQLITE BUNDLE ───────────────────────────────────────────────────────────
//
// Eine einzige DB-Instanz pro Runtime, geteilt zwischen den drei Repositories.
// `better-sqlite3` ist synchron — schnell, einfach, perfekt für Single-User.

export function createSqliteRepository(dbPath: string): RepositoryBundle {
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  return {
    persona: new SqlitePersonaRepository(db),
    mandates: new SqliteMandateRepository(db),
    audit: new SqliteAuditRepository(db),
  };
}

// ─── PERSONA ─────────────────────────────────────────────────────────────────

class SqlitePersonaRepository implements PersonaRepository {
  constructor(private db: Database.Database) {}

  async get(): Promise<Persona | null> {
    const row = this.db.prepare("SELECT data FROM persona WHERE id = 1").get() as
      | { data: string }
      | undefined;
    return row ? (JSON.parse(row.data) as Persona) : null;
  }

  async save(persona: Persona): Promise<void> {
    this.db
      .prepare(
        `INSERT INTO persona (id, data) VALUES (1, ?)
         ON CONFLICT(id) DO UPDATE SET data = excluded.data`,
      )
      .run(JSON.stringify(persona));
  }
}

// ─── MANDATES ────────────────────────────────────────────────────────────────

class SqliteMandateRepository implements MandateRepository {
  constructor(private db: Database.Database) {}

  async list(): Promise<Mandate[]> {
    const rows = this.db.prepare("SELECT data FROM mandates").all() as { data: string }[];
    return rows.map((r) => JSON.parse(r.data) as Mandate);
  }

  async findByCapability(capability: string): Promise<Mandate | null> {
    const rows = this.db.prepare("SELECT data FROM mandates").all() as { data: string }[];
    for (const row of rows) {
      const m = JSON.parse(row.data) as Mandate;
      if (m.capability === capability) return m;
    }
    return null;
  }

  async upsert(mandate: Mandate): Promise<void> {
    this.db
      .prepare(
        `INSERT INTO mandates (id, capability, data) VALUES (?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET capability = excluded.capability, data = excluded.data`,
      )
      .run(mandate.id, mandate.capability, JSON.stringify(mandate));
  }

  async delete(id: string): Promise<void> {
    this.db.prepare("DELETE FROM mandates WHERE id = ?").run(id);
  }
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
}
