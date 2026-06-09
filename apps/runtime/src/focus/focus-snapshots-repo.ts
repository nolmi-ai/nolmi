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
  /**
   * Theme-Similarity SS1: die ≤5 Theme-Embeddings als EIN konkateniertes
   * Float32-BLOB (themes.length × dim × 4 Bytes, Reihenfolge = `themes`).
   * null = bei der Erzeugung kein Embedding (leere Themen / Provider-Fehler)
   * oder Alt-Snapshot vor Backfill (SS3). detectStuck (SS2) entpackt das via
   * bufferToF32 und rechnet paarweise Cosine; NULL → norm-Fallback.
   */
  themeEmbeddingsBlob: Buffer | null;
}

interface FocusSnapshotRow {
  id: string;
  twin_id: string;
  focus_text: string;
  themes_json: string | null;
  basis_summary: string | null;
  derived_at: string;
  superseded_at: string | null;
  theme_embeddings_blob: Buffer | null;
}

export interface CreateFocusSnapshotInput {
  twinId: string;
  focusText: string;
  themes?: string[];
  basisSummary?: string | null;
  /**
   * Theme-Similarity SS1: vorberechnetes Theme-Embedding-BLOB (siehe
   * FocusSnapshot.themeEmbeddingsBlob). Optional — fehlt es / ist es null,
   * wird die Spalte NULL gesetzt (Alt-Verhalten unverändert).
   */
  themeEmbeddingsBlob?: Buffer | null;
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
      themeEmbeddingsBlob: input.themeEmbeddingsBlob ?? null,
    };

    this.db
      .prepare(
        `INSERT INTO focus_snapshots
           (id, twin_id, focus_text, themes_json, basis_summary,
            derived_at, superseded_at, theme_embeddings_blob)
         VALUES
           (@id, @twin_id, @focus_text, @themes_json, @basis_summary,
            @derived_at, NULL, @theme_embeddings_blob)`,
      )
      .run({
        id: snapshot.id,
        twin_id: snapshot.twinId,
        focus_text: snapshot.focusText,
        themes_json:
          snapshot.themes.length > 0 ? JSON.stringify(snapshot.themes) : null,
        basis_summary: snapshot.basisSummary,
        derived_at: snapshot.derivedAt,
        theme_embeddings_blob: snapshot.themeEmbeddingsBlob,
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

  /**
   * Proaktiver Fokus-Nudge: die jüngsten Snapshots eines Twins — AKTIV UND
   * SUPERSEDED (die ganze Fokus-Historie), absteigend nach derived_at. Die
   * Festhäng-Detektion (ProactiveNudgeService) vergleicht die Themen über die
   * jüngsten N Snapshots; anders als getCurrent braucht sie die supersedierten
   * Vorgänger mit. Indiziert über (twin_id, derived_at).
   */
  listRecent(twinId: string, limit: number): FocusSnapshot[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM focus_snapshots
           WHERE twin_id = ?
           ORDER BY derived_at DESC
           LIMIT ?`,
      )
      .all(twinId, limit) as FocusSnapshotRow[];
    return rows.map(rowToSnapshot);
  }

  /**
   * Schritt 3 (Leitplanke): setzt den aktuell aktiven Snapshot auf superseded
   * (Owner-Reset). NON-DESTRUKTIV — UPDATE statt DELETE, die Row bleibt für die
   * History erhalten. Idempotent: kein aktiver Snapshot → no-op (kein Fehler).
   * Gibt true zurück, wenn eine Row supersedet wurde.
   */
  /**
   * Theme-Similarity SS3 (Backfill): alle Snapshots — über ALLE Twins —, die
   * noch KEIN Theme-Embedding haben (theme_embeddings_blob IS NULL), aber
   * Themen tragen (themes_json gesetzt). Genau die Kandidaten, die das
   * Backfill-CLI nachembeddet. Snapshots ohne Themen (themes_json NULL) haben
   * nichts zu embedden → ausgeschlossen. Aktive UND superseded (die ganze
   * Historie zählt für detectStuck/SS2).
   */
  listMissingThemeEmbeddings(): FocusSnapshot[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM focus_snapshots
           WHERE theme_embeddings_blob IS NULL
             AND themes_json IS NOT NULL
           ORDER BY derived_at ASC`,
      )
      .all() as FocusSnapshotRow[];
    return rows.map(rowToSnapshot);
  }

  /**
   * Theme-Similarity SS3 (Backfill): setzt das vorberechnete Theme-Embedding-
   * BLOB für genau einen Snapshot. Gibt true zurück, wenn eine Row getroffen
   * wurde. Nur das BLOB-Feld wird angefasst — themes_json/focus_text bleiben.
   */
  setThemeEmbeddingsBlob(id: string, blob: Buffer): boolean {
    const result = this.db
      .prepare(
        `UPDATE focus_snapshots SET theme_embeddings_blob = ? WHERE id = ?`,
      )
      .run(blob, id);
    return result.changes > 0;
  }

  supersede(twinId: string): boolean {
    const result = this.db
      .prepare(
        `UPDATE focus_snapshots
           SET superseded_at = ?
         WHERE id = (
           SELECT id FROM focus_snapshots
             WHERE twin_id = ? AND superseded_at IS NULL
             ORDER BY derived_at DESC
             LIMIT 1
         )`,
      )
      .run(new Date().toISOString(), twinId);
    return result.changes > 0;
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
    // SS1: BLOB roh durchreichen (Buffer | null). listRecent — von detectStuck
    // (SS2) genutzt — liefert ihn so mit; das Entpacken/Cosine kommt in SS2.
    themeEmbeddingsBlob: row.theme_embeddings_blob ?? null,
  };
}
