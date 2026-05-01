import type Database from "better-sqlite3";
import type { AuditEntry } from "@twin-lab/shared";

// ─── REPOSITORY-PATTERN ──────────────────────────────────────────────────────
//
// Phase 2.5: Persona/Mandate-Repos sind raus — beides kommt aus
// `twin_profiles` und wird beim Boot in den TwinService injiziert. Bleibt
// nur das Audit-Repo als per-Action-Sink.
//
// Der `RepositoryBundle` exponiert zusätzlich die rohe `db`-Connection,
// damit andere Repos (TwinProfilesRepo, später Multi-Twin-Lookups) sich an
// dieselbe Connection hängen können — kein zweites Open auf dieselbe Datei.

export interface AuditListOpts {
  limit: number;
  offset?: number;
  /** Wenn gesetzt: nur Audits dieses Twins. */
  twinId?: string;
}

export interface AuditRepository {
  append(entry: AuditEntry): Promise<void>;
  update(id: string, patch: Partial<AuditEntry>): Promise<void>;
  list(opts: AuditListOpts): Promise<AuditEntry[]>;
  get(id: string): Promise<AuditEntry | null>;
  /**
   * Sucht den ersten Eintrag, dessen `input.<field>` exakt `value` ist —
   * optional gefiltert auf einen Twin. Genutzt für Idempotenz bei eingehenden
   * Bridge-Nachrichten (field = "bridgeMessageId"). Bridge-IDs sind global
   * unique, aber der Twin-Filter macht es robust gegen ID-Kollisionen.
   * `field` muss ein simpler Identifier sein.
   */
  findByInputField(
    field: string,
    value: string,
    opts?: { twinId?: string },
  ): Promise<AuditEntry | null>;
}

export interface RepositoryBundle {
  audit: AuditRepository;
  /** Gemeinsame DB-Connection für ad-hoc Repos (z.B. TwinProfilesRepo). */
  db: Database.Database;
}
