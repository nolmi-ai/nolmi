import type Database from "better-sqlite3";
import { nanoid } from "nanoid";
import type { FactConfidence, FactSource } from "@nolmi/shared";

// ─── FACTS-HISTORY REPOSITORY (#97 Schritt 1/4) ─────────────────────────────
//
// Append-/Read-Store für abgelöste Fact-Zustände (Schema:
// migrations/028_facts_history.sql). Hält pro `(twin_id, fact_key)` MEHRERE
// historische Rows — jede Ablösung (Wert-Änderung oder Delete) eine Row mit dem
// SNAPSHOT DES ALTEN ZUSTANDS vor der Ablösung.
//
// 🔴 Bewusst ein DUMMER Store: `record()` schreibt nur, `getTimeline`/`getAsOf`
// lesen. Die Capture-Logik („alten Zustand VOR dem Overwrite sichern, in einer
// Transaktion mit dem upsert/delete") gehört in FactsRepo.upsert/delete und ist
// SCHRITT 2 — dieses Repo kennt sie nicht. Stand Schritt 1: konstruiert, aber
// von niemandem aufgerufen.

export type FactChangeType = "value_change" | "delete";

export interface FactsHistoryRow {
  id: string;
  twinId: string;
  factKey: string;
  /** Alter fact_value vor Ablösung (nullable). */
  oldValue: string | null;
  oldSource: FactSource;
  oldConfidence: FactConfidence;
  changeType: FactChangeType;
  recordedAt: string;
}

interface FactsHistoryDbRow {
  id: string;
  twin_id: string;
  fact_key: string;
  old_value: string | null;
  old_source: FactSource;
  old_confidence: FactConfidence;
  change_type: FactChangeType;
  recorded_at: string;
}

export interface RecordHistoryInput {
  twinId: string;
  factKey: string;
  oldValue: string | null;
  oldSource: FactSource;
  oldConfidence: FactConfidence;
  changeType: FactChangeType;
  /** ISO-8601-Zeitpunkt der Ablösung. Caller setzt ihn (in Schritt 2 = der
   *  updated_at/Delete-Zeitpunkt der auslösenden Mutation). */
  recordedAt: string;
}

export class FactsHistoryRepo {
  constructor(private db: Database.Database) {}

  /**
   * Append-only: schreibt EINE History-Row. ID Repo-seitig. Schreibt NUR —
   * keine Transaktions-/Capture-Logik hier (das „alten Zustand vor Overwrite
   * sichern" ist Schritt-2-Sache in FactsRepo.upsert/delete).
   */
  record(input: RecordHistoryInput): void {
    this.db
      .prepare(
        `INSERT INTO facts_history
           (id, twin_id, fact_key, old_value, old_source, old_confidence,
            change_type, recorded_at)
         VALUES
           (@id, @twin_id, @fact_key, @old_value, @old_source, @old_confidence,
            @change_type, @recorded_at)`,
      )
      .run({
        id: `facthist_${nanoid(16)}`,
        twin_id: input.twinId,
        fact_key: input.factKey,
        old_value: input.oldValue,
        old_source: input.oldSource,
        old_confidence: input.oldConfidence,
        change_type: input.changeType,
        recorded_at: input.recordedAt,
      });
  }

  /**
   * Alle History-Rows zu einem Key, chronologisch (älteste Ablösung zuerst).
   * Nutzt idx_facts_history_twin_key.
   */
  getTimeline(twinId: string, factKey: string): FactsHistoryRow[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM facts_history
           WHERE twin_id = ? AND fact_key = ?
           ORDER BY recorded_at ASC`,
      )
      .all(twinId, factKey) as FactsHistoryDbRow[];
    return rows.map(rowToHistory);
  }

  /**
   * Welcher fact_value galt zum Zeitpunkt `isoDate`?
   *
   * Modell: eine History-Row hält den Wert, der GALT, bis er zum `recorded_at`
   * abgelöst wurde. Gesucht ist also die ERSTE Ablösung NACH (oder genau zu)
   * `isoDate` — deren `old_value` ist der Wert, der zu `isoDate` aktiv war.
   * Gibt es keine solche Ablösung (alle Änderungen liegen VOR isoDate, oder es
   * gab nie eine), dann galt zu isoDate bereits der heutige Zustand → Rückgabe
   * `null` als Signal „nimm den aktuellen Wert aus `facts`" (der Caller in
   * Schritt 3/4 entscheidet, ob er den Current-Wert einsetzt).
   */
  getAsOf(twinId: string, factKey: string, isoDate: string): string | null {
    const row = this.db
      .prepare(
        `SELECT old_value FROM facts_history
           WHERE twin_id = ? AND fact_key = ? AND recorded_at >= ?
           ORDER BY recorded_at ASC
           LIMIT 1`,
      )
      .get(twinId, factKey, isoDate) as { old_value: string | null } | undefined;
    return row ? row.old_value : null;
  }
}

function rowToHistory(row: FactsHistoryDbRow): FactsHistoryRow {
  return {
    id: row.id,
    twinId: row.twin_id,
    factKey: row.fact_key,
    oldValue: row.old_value,
    oldSource: row.old_source,
    oldConfidence: row.old_confidence,
    changeType: row.change_type,
    recordedAt: row.recorded_at,
  };
}
