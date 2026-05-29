import type Database from "better-sqlite3";
import type { AuditEntry } from "@nolmi/shared";

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
  /**
   * Setzt read_at = now für einen Audit-Eintrag. Idempotent: wenn bereits
   * gelesen, wird der Timestamp NICHT überschrieben (erste-Lesung gewinnt).
   */
  markRead(id: string): Promise<void>;
  /**
   * #71b/#80: Audits einer Konversation für den LLM-History-Loader. Strict
   * gefiltert auf `conversation_id`; Pre-Migration-Audits ohne ID kommen
   * nicht zurück. Sortierung DESC (neueste zuerst), damit das `LIMIT` immer
   * das jüngste Sliding-Window liefert. Caller sortiert für die LLM-Eingabe
   * chronologisch um.
   */
  listByConversation(conversationId: string, limit: number): Promise<AuditEntry[]>;
  /**
   * 3.3.C: Audits einer Konversation, deren Timestamp echt nach dem Cursor-
   * Audit liegt — gedacht für das Sliding-Window über bereits summarized
   * Segmente hinaus. Cursor wird über die ID des letzten summarized Audits
   * angegeben; SQL resolvt selbst den Timestamp dazu. Sortierung ASC
   * (älteste zuerst), damit der Caller direkt chronologisch in den LLM-
   * Kontext schiebt — kein zusätzlicher Reverse nötig.
   *
   * Kein Limit: das Live-Window ist durch den Summary-Trigger
   * (CONVERSATION_SUMMARY_THRESHOLD) ohnehin gedeckelt. Bei Cursor-ID, die
   * nicht in der DB existiert, liefert die Sub-Query NULL → Filter `> NULL`
   * matched nichts → leere Liste. Defensiv, kein Crash.
   */
  listByConversationAfter(
    conversationId: string,
    cursorAuditId: string,
  ): Promise<AuditEntry[]>;
}

export interface RepositoryBundle {
  audit: AuditRepository;
  /** Gemeinsame DB-Connection für ad-hoc Repos (z.B. TwinProfilesRepo). */
  db: Database.Database;
}
