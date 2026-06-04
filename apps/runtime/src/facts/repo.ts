import type Database from "better-sqlite3";
import { nanoid } from "nanoid";
import type { FactConfidence, FactSource } from "@nolmi/shared";
import type { FactsHistoryRepo } from "./facts-history-repo.js";

// ─── FACTS REPOSITORY (3.3.A) ────────────────────────────────────────────────
//
// KV-Store für Semantic-Memory pro Twin. Truth-Source für statische Fakten
// („wife_name → Anna", „company → Harway Experience"), die der Twin
// dauerhaft kennen soll. UNIQUE (twin_id, fact_key) erzwingt Eindeutigkeit
// pro Twin; Re-Writes derselben Combo gehen via ON CONFLICT als UPDATE durch.
//
// Sub-Schritt-A liefert Schema + Repo. API-Endpoints (3.3.D), System-Prompt-
// Integration (3.3.E), LLM-Extraction (3.3.F) und UI (3.3.G) bauen darauf auf.
//
// 3.3.F: FactConfidence/FactSource leben jetzt in @nolmi/shared — die
// Source-of-Truth ist beim Schema, Repo importiert nur den Type.

export type { FactConfidence, FactSource };

export interface Fact {
  id: string;
  twinId: string;
  factKey: string;
  factValue: string;
  source: FactSource;
  confidence: FactConfidence;
  createdAt: string;
  updatedAt: string;
}

interface FactRow {
  id: string;
  twin_id: string;
  fact_key: string;
  fact_value: string;
  source: FactSource;
  confidence: FactConfidence;
  created_at: string;
  updated_at: string;
}

export interface UpsertFactInput {
  twinId: string;
  factKey: string;
  factValue: string;
  source: FactSource;
  confidence: FactConfidence;
}

export interface ListFactsOptions {
  /**
   * Filtert pending raus — Pflicht-Filter für den Always-on-Block im
   * System-Prompt (3.3.E), damit unbestätigte Vorschläge nicht in den Twin-
   * Kontext fließen.
   */
  onlyApproved?: boolean;
}

export class FactsRepo {
  // #97 Schritt 2: FactsHistoryRepo injiziert (gleiche db-Connection), damit
  // Capture + Overwrite in EINER Transaktion laufen. Required — jede
  // Konstruktions-Stelle muss ihn übergeben (Compile-Garantie für Coverage).
  constructor(
    private db: Database.Database,
    private history: FactsHistoryRepo,
  ) {}

  /**
   * Upsert via ON CONFLICT(twin_id, fact_key). Bei Konflikt überschreiben
   * wir fact_value, source, confidence und setzen updated_at neu — created_at
   * und id bleiben. Damit gibt's pro Twin+Key immer genau eine Row; eine
   * Neu-Belegung („wife_name war Anna, jetzt Sabine") ist ein UPDATE, kein
   * neuer Eintrag im facts-Store.
   *
   * #97 Schritt 2 — Wert-Drift-Capture (atomar): Wenn der Upsert einen
   * bestehenden Fact mit ANDEREM fact_value ablöst, wird der alte Zustand
   * VORHER in facts_history geschrieben (change_type='value_change'). Capture
   * + Overwrite laufen in EINER db.transaction — schlägt das Capturen fehl,
   * rollt der Overwrite mit zurück (kein halber State). KEIN Capture bei
   * Erst-Anlage (kein abgelöster Zustand) oder bei gleichem Wert (No-op) oder
   * reiner source/confidence-Änderung — extern verhält sich upsert dann exakt
   * wie zuvor.
   */
  upsert(input: UpsertFactInput): Fact {
    const now = new Date().toISOString();
    const id = `fact_${nanoid(16)}`;

    const stmt = this.db.prepare(
      `INSERT INTO facts
         (id, twin_id, fact_key, fact_value, source, confidence, created_at, updated_at)
       VALUES
         (@id, @twin_id, @fact_key, @fact_value, @source, @confidence, @created_at, @updated_at)
       ON CONFLICT(twin_id, fact_key) DO UPDATE SET
         fact_value = excluded.fact_value,
         source     = excluded.source,
         confidence = excluded.confidence,
         updated_at = excluded.updated_at`,
    );

    // Atomar: erst lesen + (bei echter Wert-Änderung) capturen, DANN überschreiben.
    const tx = this.db.transaction((): void => {
      const existing = this.get(input.twinId, input.factKey);
      if (existing && existing.factValue !== input.factValue) {
        this.history.record({
          twinId: input.twinId,
          factKey: input.factKey,
          oldValue: existing.factValue,
          oldSource: existing.source,
          oldConfidence: existing.confidence,
          changeType: "value_change",
          recordedAt: now,
        });
      }
      stmt.run({
        id,
        twin_id: input.twinId,
        fact_key: input.factKey,
        fact_value: input.factValue,
        source: input.source,
        confidence: input.confidence,
        created_at: now,
        updated_at: now,
      });
    });
    tx();

    // Nach Upsert immer neu laden — bei UPDATE-Pfad liefert excluded.id NICHT
    // die gespeicherte ID zurück, also über get() den autoritativen State holen.
    const fact = this.get(input.twinId, input.factKey);
    if (!fact) {
      throw new Error(
        `FactsRepo.upsert: Fact ${input.twinId}/${input.factKey} nach Insert nicht auffindbar`,
      );
    }
    return fact;
  }

  get(twinId: string, factKey: string): Fact | null {
    const row = this.db
      .prepare("SELECT * FROM facts WHERE twin_id = ? AND fact_key = ?")
      .get(twinId, factKey) as FactRow | undefined;
    return row ? rowToFact(row) : null;
  }

  /**
   * Listet Fakten eines Twins, alphabetisch nach fact_key. onlyApproved
   * filtert pending raus — Default ist false (für UI-Listings), aber der
   * Twin-Prompt-Pfad in 3.3.E muss explizit true setzen.
   */
  listByTwin(twinId: string, opts: ListFactsOptions = {}): Fact[] {
    const where = ["twin_id = @twin_id"];
    const params: Record<string, unknown> = { twin_id: twinId };
    if (opts.onlyApproved) {
      where.push("confidence = 'approved'");
    }
    const sql =
      "SELECT * FROM facts WHERE " +
      where.join(" AND ") +
      " ORDER BY fact_key ASC";
    const rows = this.db.prepare(sql).all(params) as FactRow[];
    return rows.map(rowToFact);
  }

  /**
   * 3.3.F: ändert nur die `confidence`-Spalte. Pattern für den Approval-Flow
   * — User klickt approve auf einen pending Twin-Vorschlag → confidence
   * von 'pending' auf 'approved' (oder 'rejected' bei Reject). Source und
   * Value bleiben unverändert; `upsert` wäre hier ungeeignet, weil das die
   * Provenance (source) überschreiben würde.
   *
   * Returns true bei erfolgreichem Update, false wenn der Fact nicht
   * existiert. updated_at wird neu gesetzt.
   */
  setConfidence(
    twinId: string,
    factKey: string,
    confidence: FactConfidence,
  ): boolean {
    const result = this.db
      .prepare(
        `UPDATE facts SET confidence = ?, updated_at = ?
           WHERE twin_id = ? AND fact_key = ?`,
      )
      .run(confidence, new Date().toISOString(), twinId, factKey);
    return result.changes > 0;
  }

  /**
   * Hartes DELETE. Gibt true zurück, wenn eine Row entfernt wurde, sonst
   * false (Caller weiß damit, ob der Key existierte). Soft-Delete-Pattern
   * (z.B. confidence='archived') haben wir bewusst nicht — Facts sind in
   * ihrer Semantik klein und ersetzbar; ein archiviertes Mini-Stück Wissen
   * wäre Overhead ohne klaren Nutzen.
   */
  delete(twinId: string, factKey: string): boolean {
    const now = new Date().toISOString();
    // #97 Schritt 2 — Delete-Capture (atomar): existierte der Key, wird sein
    // Zustand VORHER in facts_history geschrieben (change_type='delete'), dann
    // gelöscht — beides in EINER Transaktion. delete auf nicht-existenten Key:
    // kein Capture, kein Fehler (changes=0, extern wie zuvor).
    let changed = false;
    const tx = this.db.transaction((): void => {
      const existing = this.get(twinId, factKey);
      if (existing) {
        this.history.record({
          twinId,
          factKey,
          oldValue: existing.factValue,
          oldSource: existing.source,
          oldConfidence: existing.confidence,
          changeType: "delete",
          recordedAt: now,
        });
      }
      const result = this.db
        .prepare("DELETE FROM facts WHERE twin_id = ? AND fact_key = ?")
        .run(twinId, factKey);
      changed = result.changes > 0;
    });
    tx();
    return changed;
  }

  count(twinId: string): number {
    const row = this.db
      .prepare("SELECT COUNT(*) AS c FROM facts WHERE twin_id = ?")
      .get(twinId) as { c: number };
    return row.c;
  }
}

function rowToFact(row: FactRow): Fact {
  return {
    id: row.id,
    twinId: row.twin_id,
    factKey: row.fact_key,
    factValue: row.fact_value,
    source: row.source,
    confidence: row.confidence,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
