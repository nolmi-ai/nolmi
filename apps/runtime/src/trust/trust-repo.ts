import type Database from "better-sqlite3";
import { nanoid } from "nanoid";

// ─── TRUST REPOSITORY ───────────────────────────────────────────────────────
//
// Eine Row pro Trust-Beziehung (twin_id, trusted_handle). Trust ist
// einseitig: dass A B vertraut, sagt nichts über B → A.
//
// `isTrusted()` ist die kritische Hot-Path-Funktion — wird bei jedem
// eingehenden Bridge-Call ausgeführt, bevor der Mandate-Check anspringt.
// Implementierung als simpler EXISTS-Lookup über den Composite-Index
// (twin_id, trusted_handle) → unter 1ms auch bei tausenden Einträgen.

/**
 * Phase 4.3 Schritt 1: graded Vertrautheits-Level pro Partner. 'fremd' ist der
 * LESE-DEFAULT bei fehlender Row (kein gespeicherter Wert für untrusted
 * Partner); Rows tragen 'bekannt'/'vertraut'/'eng' (bzw. 'fremd', wenn ein
 * bestehender Partner bewusst herabgestuft wird — Schritt 3). Schema-Guard:
 * CHECK in migrations/029_familiarity_level.sql.
 */
export type FamiliarityLevel = "fremd" | "bekannt" | "vertraut" | "eng";

export interface TrustRelationship {
  trustId: string;
  twinId: string;
  trustedHandle: string;
  note: string | null;
  createdAt: string;
  createdByUserId: string;
}

interface TrustRow {
  trust_id: string;
  twin_id: string;
  trusted_handle: string;
  note: string | null;
  created_at: string;
  created_by_user_id: string;
}

export class TrustAlreadyExistsError extends Error {
  constructor(twinId: string, trustedHandle: string) {
    super(`Trust für '${trustedHandle}' existiert bereits für Twin ${twinId}`);
    this.name = "TrustAlreadyExistsError";
  }
}

export class TrustNotFoundError extends Error {
  constructor(identifier: string) {
    super(`Trust-Eintrag '${identifier}' nicht gefunden`);
    this.name = "TrustNotFoundError";
  }
}

export class TrustRepo {
  constructor(private db: Database.Database) {}

  add(
    twinId: string,
    trustedHandle: string,
    userId: string,
    note?: string,
  ): TrustRelationship {
    const trust: TrustRelationship = {
      trustId: `trust_${nanoid(16)}`,
      twinId,
      trustedHandle,
      note: note?.trim() || null,
      createdAt: new Date().toISOString(),
      createdByUserId: userId,
    };
    try {
      this.db
        .prepare(
          `INSERT INTO trust_relationships
             (trust_id, twin_id, trusted_handle, note, created_at, created_by_user_id)
           VALUES
             (@trust_id, @twin_id, @trusted_handle, @note, @created_at, @created_by_user_id)`,
        )
        .run({
          trust_id: trust.trustId,
          twin_id: trust.twinId,
          trusted_handle: trust.trustedHandle,
          note: trust.note,
          created_at: trust.createdAt,
          created_by_user_id: trust.createdByUserId,
        });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // SQLite UNIQUE-Violation → eigener Fehler-Typ, damit der Server-Layer
      // 409 statt 500 zurückgeben kann.
      if (msg.includes("UNIQUE constraint failed")) {
        throw new TrustAlreadyExistsError(twinId, trustedHandle);
      }
      throw err;
    }
    return trust;
  }

  /**
   * Zwei Overloads: per trustId (UI nach DELETE-Click) oder per (twinId,
   * trustedHandle) (Test-Skripte, Convenience). Gleiche Tabelle, unterschiedliche
   * WHERE-Clause.
   */
  remove(trustId: string): void;
  remove(twinId: string, trustedHandle: string): void;
  remove(arg1: string, arg2?: string): void {
    let result: Database.RunResult;
    if (arg2 === undefined) {
      result = this.db
        .prepare("DELETE FROM trust_relationships WHERE trust_id = ?")
        .run(arg1);
    } else {
      result = this.db
        .prepare(
          "DELETE FROM trust_relationships WHERE twin_id = ? AND trusted_handle = ?",
        )
        .run(arg1, arg2);
    }
    if (result.changes === 0) {
      throw new TrustNotFoundError(arg2 ? `${arg1}/${arg2}` : arg1);
    }
  }

  list(twinId: string): TrustRelationship[] {
    const rows = this.db
      .prepare(
        "SELECT * FROM trust_relationships WHERE twin_id = ? ORDER BY created_at ASC",
      )
      .all(twinId) as TrustRow[];
    return rows.map(rowToTrust);
  }

  findById(trustId: string): TrustRelationship | null {
    const row = this.db
      .prepare("SELECT * FROM trust_relationships WHERE trust_id = ?")
      .get(trustId) as TrustRow | undefined;
    return row ? rowToTrust(row) : null;
  }

  /**
   * Hot-Path. Bei jedem eingehenden Bridge-Call aufgerufen, bevor der
   * Mandate-Check anspringt. SELECT EXISTS über den Composite-Index
   * (twin_id, trusted_handle) — unter 1ms.
   */
  isTrusted(twinId: string, trustedHandle: string): boolean {
    const row = this.db
      .prepare(
        "SELECT 1 FROM trust_relationships WHERE twin_id = ? AND trusted_handle = ? LIMIT 1",
      )
      .get(twinId, trustedHandle) as { 1: number } | undefined;
    return row !== undefined;
  }

  /**
   * Phase 4.3 Schritt 1: Vertrautheits-Level eines Partners. Existiert eine
   * Trust-Row → deren familiarity_level. Existiert KEINE Row (kein Trust-
   * Verhältnis) → 'fremd' als Lese-Default (D7-Semantik: fremd ist kein
   * gespeicherter Wert, sondern die Abwesenheit einer Beziehung).
   *
   * 🔴 Schritt 1 ist reine Datenschicht — diese Funktion hat KEINE Dispatch-
   * Wirkung. `isTrusted` (oben) bleibt unverändert row-basiert; die Reconci-
   * liation isTrusted-vs-level ist Schritt 5.
   */
  getFamiliarity(twinId: string, partnerHandle: string): FamiliarityLevel {
    const row = this.db
      .prepare(
        "SELECT familiarity_level FROM trust_relationships WHERE twin_id = ? AND trusted_handle = ? LIMIT 1",
      )
      .get(twinId, partnerHandle) as { familiarity_level: FamiliarityLevel } | undefined;
    return row?.familiarity_level ?? "fremd";
  }

  /**
   * Setzt das Level einer BESTEHENDEN Trust-Row. 🔴 KISS für Schritt 1: kein
   * Auto-Insert bei fehlender Row — eine Row anzulegen hieße „trusten" (Row-
   * Existenz = trusted im heutigen Dispatch), das wäre eine Wirkung, die
   * Schritt 1 nicht haben darf. Wer ein Level für einen fremden Partner setzen
   * will, muss ihn erst über add() trusten; die saubere Auflösung dieser
   * Kollision (Level ohne Trust) ist Schritt 3/5. Wirft TrustNotFoundError,
   * wenn keine Row existiert.
   */
  setFamiliarity(
    twinId: string,
    partnerHandle: string,
    level: FamiliarityLevel,
  ): void {
    const result = this.db
      .prepare(
        "UPDATE trust_relationships SET familiarity_level = ? WHERE twin_id = ? AND trusted_handle = ?",
      )
      .run(level, twinId, partnerHandle);
    if (result.changes === 0) {
      throw new TrustNotFoundError(`${twinId}/${partnerHandle}`);
    }
  }
}

function rowToTrust(row: TrustRow): TrustRelationship {
  return {
    trustId: row.trust_id,
    twinId: row.twin_id,
    trustedHandle: row.trusted_handle,
    note: row.note,
    createdAt: row.created_at,
    createdByUserId: row.created_by_user_id,
  };
}
