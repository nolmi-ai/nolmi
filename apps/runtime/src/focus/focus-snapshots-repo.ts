import type Database from "better-sqlite3";
import { nanoid } from "nanoid";

// ─── FOCUS SNAPSHOTS REPOSITORY (Aufmerksamkeit/Fokus Stufe 1) ──────────────
//
// Persistiert die vom FocusEngine abgeleiteten „aktueller Fokus"-Snapshots.
// Append-only mit Soft-Supersede: „Aktueller Fokus" = jüngste Row mit
// superseded_at IS NULL. Schema: migrations/027_focus_snapshots.sql.

export interface FocusSnapshot {
  id: string;
  twinId: string;
  focusText: string;
  /** Themen-Liste; leeres Array wenn keine. */
  themes: string[];
  /** Audit-Trail: woraus abgeleitet (z.B. „aus 8 Summaries + 12 Turns"). */
  basisSummary: string | null;
  derivedAt: string;
  /** null = aktueller Snapshot; gesetzt = abgelöst/zurückgesetzt. */
  supersededAt: string | null;
}

interface FocusSnapshotRow {
  id: string;
  twin_id: string;
  focus_text: string;
  themes_json: string | null;
  basis_summary: string | null;
  derived_at: string;
  superseded_at: string | null;
}

export interface CreateFocusSnapshotInput {
  twinId: string;
  focusText: string;
  themes?: string[];
  basisSummary?: string | null;
}

export class FocusSnapshotsRepo {
  constructor(private db: Database.Database) {}

  /**
   * Hängt einen neuen Snapshot an. ID + derived_at werden Repo-seitig gesetzt;
   * superseded_at startet NULL (= aktuell). Themen werden als JSON-Array
   * persistiert (null wenn leer/nicht gesetzt).
   */
  insert(input: CreateFocusSnapshotInput): FocusSnapshot {
    const snapshot: FocusSnapshot = {
      id: `focus_${nanoid(16)}`,
      twinId: input.twinId,
      focusText: input.focusText,
      themes: input.themes ?? [],
      basisSummary: input.basisSummary ?? null,
      derivedAt: new Date().toISOString(),
      supersededAt: null,
    };

    this.db
      .prepare(
        `INSERT INTO focus_snapshots
           (id, twin_id, focus_text, themes_json, basis_summary,
            derived_at, superseded_at)
         VALUES
           (@id, @twin_id, @focus_text, @themes_json, @basis_summary,
            @derived_at, NULL)`,
      )
      .run({
        id: snapshot.id,
        twin_id: snapshot.twinId,
        focus_text: snapshot.focusText,
        themes_json:
          snapshot.themes.length > 0 ? JSON.stringify(snapshot.themes) : null,
        basis_summary: snapshot.basisSummary,
        derived_at: snapshot.derivedAt,
      });

    return snapshot;
  }

  /**
   * Aktueller Fokus eines Twins: jüngste Row mit superseded_at IS NULL, oder
   * null wenn noch nie abgeleitet (bzw. alles zurückgesetzt). Indiziert über
   * (twin_id, derived_at).
   */
  getCurrent(twinId: string): FocusSnapshot | null {
    const row = this.db
      .prepare(
        `SELECT * FROM focus_snapshots
           WHERE twin_id = ? AND superseded_at IS NULL
           ORDER BY derived_at DESC
           LIMIT 1`,
      )
      .get(twinId) as FocusSnapshotRow | undefined;
    return row ? rowToSnapshot(row) : null;
  }
}

function rowToSnapshot(row: FocusSnapshotRow): FocusSnapshot {
  let themes: string[] = [];
  if (row.themes_json) {
    try {
      const parsed = JSON.parse(row.themes_json);
      if (Array.isArray(parsed)) themes = parsed.filter((t): t is string => typeof t === "string");
    } catch {
      // Defekte JSON → leere Themen, focus_text bleibt nutzbar.
      themes = [];
    }
  }
  return {
    id: row.id,
    twinId: row.twin_id,
    focusText: row.focus_text,
    themes,
    basisSummary: row.basis_summary,
    derivedAt: row.derived_at,
    supersededAt: row.superseded_at,
  };
}
