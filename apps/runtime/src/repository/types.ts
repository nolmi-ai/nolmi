import type { AuditEntry, Mandate, Persona } from "@twin-lab/shared";

// ─── REPOSITORY-PATTERN ──────────────────────────────────────────────────────
//
// Alle DB-Zugriffe gehen über diese Interfaces.
// Phase 1: SQLite-Implementierung. Später: Postgres, Supabase, was auch immer.
// Wer Twin self-hosted, kann eigenes Repository einklinken.

export interface PersonaRepository {
  get(): Promise<Persona | null>;
  save(persona: Persona): Promise<void>;
}

export interface MandateRepository {
  list(): Promise<Mandate[]>;
  findByCapability(capability: string): Promise<Mandate | null>;
  upsert(mandate: Mandate): Promise<void>;
  delete(id: string): Promise<void>;
}

export interface AuditRepository {
  append(entry: AuditEntry): Promise<void>;
  update(id: string, patch: Partial<AuditEntry>): Promise<void>;
  list(opts: { limit: number; offset?: number }): Promise<AuditEntry[]>;
  get(id: string): Promise<AuditEntry | null>;
}

export interface RepositoryBundle {
  persona: PersonaRepository;
  mandates: MandateRepository;
  audit: AuditRepository;
}
