import type Database from "better-sqlite3";
import { nanoid } from "nanoid";

// ─── EMBEDDINGS REPOSITORY (3.4.A) ──────────────────────────────────────────
//
// Foundation für Episodic-Memory. Drei verschränkte Tabellen werden hier
// gekapselt — Caller sehen sie als eine logische Einheit:
//
//   embeddings        Stamm-Tabelle (Metadaten + BLOB als Snapshot der Vektoren)
//   embeddings_vec    sqlite-vec Virtual-Table (KNN-Search via vec0)
//   memory_fts        FTS5 Virtual-Table (Hybrid-Search-Foundation, in 3.4.A
//                     populated, in 3.4.E noch nicht abgefragt)
//
// Die rowid in `embeddings` (impliziter SQLite-Auto-Integer) ist die
// Verbindungs-ID zu `embeddings_vec`. vec0 kann keine TEXT-PK speichern;
// stattdessen mappt das Repo intern den TEXT-`id`-Wert von embeddings auf
// den passenden rowid und nutzt diesen für vec0.
//
// ── Pre-Check-Befunde (docs/archive/3.4-STRATEGY.md "Implementation-Hinweise") ─
//
// 1. BigInt für rowid bei vec0-Inserts:
//    Auch wenn die rowid in JS als normale Zahl/String vorliegt, akzeptiert
//    sqlite-vec sie beim INSERT nur als BigInt. Sonst:
//      "SqliteError: Only integers are allowed for primary key values on
//       embeddings_vec"
//    Helper: BigInt(rowid) beim Insert.
//
// 2. Node-Buffer statt ArrayBuffer für Vector-Binding:
//    Float32Array.buffer ist ein ArrayBuffer; better-sqlite3 verlangt aber
//    Node-Buffer. Helper `f32ToBuffer()` wrappt das.
//    Sonst: "TypeError: SQLite3 can only bind numbers, strings, bigints,
//    buffers, and null"
//
// 3. CTE-Pattern für KNN+JOIN:
//    LIMIT muss DIREKT auf der vec0-MATCH-Query liegen, nicht nach dem JOIN.
//    Sonst: "A LIMIT or 'k = ?' constraint is required on vec0 knn queries"
//    → `search()` verwendet eine CTE, die das KNN isoliert und erst danach
//    auf `embeddings` JOIN'd plus Filter applied.
//
// ── Multi-Tenancy ─────────────────────────────────────────────────────────
//
// Alle Methoden nehmen twin_id explizit; Search filtert nach JOIN auf
// e.twin_id. Pool-Vergrößerung (topK * 3) damit nach Filter noch genug
// Kandidaten bleiben — bei sehr großen Datenmengen wäre vec0-partition_by
// die saubere Lösung, für jetzt pragmatisch okay (siehe docs/archive/3.4-STRATEGY.md
// "Open Questions").
//
// ── Pattern-Vorbereitungs-Helpers ─────────────────────────────────────────
//
// `incrementAccess()` setzt last_accessed_at + access_count++. Wird in 3.4.E
// bei jedem Search-Hit aufgerufen. Datenschicht für Zeit-Erleben-Pattern
// (TWIN-VISION.md). Logic-Erweiterungen wie "wann war zuletzt was über X"
// kommen mit Pattern-Phase, nicht hier.

export type EmbeddingTargetType =
  | "summary_segment"
  | "conversation"
  | "diary_entry";

export interface EmbeddingRecord {
  id: string;
  twinId: string;
  targetType: EmbeddingTargetType;
  targetId: string;
  embeddingModel: string;
  embedding: Float32Array;
  topicTags: string[] | null;
  narrativeThreadId: string | null;
  lastAccessedAt: string | null;
  accessCount: number;
  createdAt: string;
}

interface EmbeddingRow {
  id: string;
  twin_id: string;
  target_type: EmbeddingTargetType;
  target_id: string;
  embedding_model: string;
  embedding: Buffer;
  topic_tags: string | null;
  narrative_thread_id: string | null;
  last_accessed_at: string | null;
  access_count: number;
  created_at: string;
}

export interface CreateEmbeddingInput {
  twinId: string;
  targetType: EmbeddingTargetType;
  targetId: string;
  embeddingModel: string;
  embedding: Float32Array;
  topicTags?: string[] | null;
  narrativeThreadId?: string | null;
}

export interface InsertOptions {
  /**
   * Wenn gesetzt, wird der Text parallel in `memory_fts` indexiert. Atomar
   * in derselben Transaction wie die embeddings-INSERTs. Pure-Vector-Inserts
   * ohne FTS-Begleitung sind erlaubt (Test-Fixtures, später Migrations).
   */
  ftsContent?: string;
}

export interface SearchOptions {
  /** Default 3 — sechste Schicht im System-Prompt nimmt drei Treffer. */
  topK?: number;
  /**
   * Cosine-Similarity-Schwelle (0..1). Default 0.7. Bei L2-Distanz auf
   * normalisierten Vektoren gilt: similarity = 1 - distance / 2.
   * Treffer unter dem Threshold werden gefiltert.
   */
  similarityThreshold?: number;
  /**
   * Wenn gesetzt: KNN-Pool nur über Embeddings dieses Modells. Default ist
   * der Filter aus — Search funktioniert nur sinnvoll innerhalb eines
   * Modells (gleiche Vektor-Topologie), aber das ist Caller-Verantwortung.
   */
  embeddingModel?: string;
  /**
   * Reverse-Memory-Query (Zeitraum-Rückschau): optionaler Zeitfenster-Filter
   * auf `created_at` (ISO-Strings). `since` inklusive untere Grenze, `until`
   * inklusive obere. Default beide aus → kein Zeitfilter (bestehende Aufrufer
   * wie runOwnerDirect unverändert). KEINE Migration — `created_at` existiert.
   */
  since?: string;
  until?: string;
}

export interface SearchHit {
  record: EmbeddingRecord;
  /** Roh-Distance aus vec0 (L2). Caller bekommt sie zum Inspizieren. */
  distance: number;
  /** Cosine-Similarity 0..1, abgeleitet aus Distance. */
  similarity: number;
}

/**
 * 3.4.I: Result-Shape für `searchFts5`. Schlanker als `SearchHit`, weil
 * der RRF-Merge im Service nur Embedding-ID + Rang braucht — Content
 * wird erst nach dem Merge per `getFtsContent` für die Final-Top-K geholt.
 */
export interface Fts5SearchResult {
  embeddingId: string;
  targetType: EmbeddingTargetType;
  targetId: string;
  /** BM25-Score aus SQLite — negativ, kleiner = relevanter. */
  bm25Score: number;
  /** 1-indexed Position in der nach BM25 sortierten Liste. */
  rank: number;
}

/** Float32Array → Node-Buffer (Vector-Binding-Pattern aus Pre-Check). */
export function f32ToBuffer(f32: Float32Array): Buffer {
  return Buffer.from(f32.buffer, f32.byteOffset, f32.byteLength);
}

/** Node-Buffer → Float32Array (Read-Pfad, Spiegelbild von f32ToBuffer). */
export function bufferToF32(buf: Buffer): Float32Array {
  // Kopie, damit der zurückgegebene Float32Array nicht an den DB-internen
  // Buffer gebunden ist (sqlite-vec/better-sqlite3 recycelt Buffer-Slabs).
  const copy = new ArrayBuffer(buf.byteLength);
  new Uint8Array(copy).set(buf);
  return new Float32Array(copy);
}

export class EmbeddingsRepo {
  private insertEmbeddingStmt: Database.Statement;
  private insertVecStmt: Database.Statement;
  private insertFtsStmt: Database.Statement;
  private selectByTargetStmt: Database.Statement;
  private selectByIdStmt: Database.Statement;
  private selectRowidStmt: Database.Statement;
  private selectFtsStmt: Database.Statement;
  private incrementAccessStmt: Database.Statement;

  constructor(private db: Database.Database) {
    this.insertEmbeddingStmt = db.prepare(
      `INSERT INTO embeddings
         (id, twin_id, target_type, target_id, embedding_model,
          embedding, topic_tags, narrative_thread_id,
          last_accessed_at, access_count, created_at)
       VALUES
         (@id, @twin_id, @target_type, @target_id, @embedding_model,
          @embedding, @topic_tags, @narrative_thread_id,
          NULL, 0, @created_at)`,
    );
    this.insertVecStmt = db.prepare(
      `INSERT INTO embeddings_vec(rowid, embedding) VALUES (?, ?)`,
    );
    this.insertFtsStmt = db.prepare(
      `INSERT INTO memory_fts(content, target_type, target_id, twin_id)
       VALUES (@content, @target_type, @target_id, @twin_id)`,
    );
    this.selectByTargetStmt = db.prepare(
      `SELECT * FROM embeddings
         WHERE twin_id = ? AND target_type = ? AND target_id = ?
           AND embedding_model = ?`,
    );
    this.selectByIdStmt = db.prepare(`SELECT * FROM embeddings WHERE id = ?`);
    this.selectRowidStmt = db.prepare(
      `SELECT rowid FROM embeddings WHERE id = ?`,
    );
    this.selectFtsStmt = db.prepare(
      `SELECT content FROM memory_fts
         WHERE twin_id = ? AND target_type = ? AND target_id = ?
         LIMIT 1`,
    );
    this.incrementAccessStmt = db.prepare(
      `UPDATE embeddings
         SET access_count = access_count + 1,
             last_accessed_at = ?
         WHERE id = ?`,
    );
  }

  /**
   * Insert atomar in alle drei Tabellen (embeddings, embeddings_vec,
   * optional memory_fts). Bricht eine Sub-Query ab, ROLLBACK auf alle.
   * Returns den frischen Record (inkl. der serverseitig gesetzten Defaults
   * wie access_count = 0).
   */
  insert(input: CreateEmbeddingInput, options: InsertOptions = {}): EmbeddingRecord {
    const id = `emb_${nanoid(16)}`;
    const createdAt = new Date().toISOString();
    const embeddingBuf = f32ToBuffer(input.embedding);

    const tx = this.db.transaction(() => {
      // 1. Stamm-Eintrag in embeddings → erzeugt rowid für vec0-Mapping
      this.insertEmbeddingStmt.run({
        id,
        twin_id: input.twinId,
        target_type: input.targetType,
        target_id: input.targetId,
        embedding_model: input.embeddingModel,
        embedding: embeddingBuf,
        topic_tags: input.topicTags ? JSON.stringify(input.topicTags) : null,
        narrative_thread_id: input.narrativeThreadId ?? null,
        created_at: createdAt,
      });

      // 2. rowid abgreifen für vec0-Insert (Pre-Check: BigInt-Wrap Pflicht)
      const rowidRow = this.selectRowidStmt.get(id) as { rowid: number };
      this.insertVecStmt.run(BigInt(rowidRow.rowid), embeddingBuf);

      // 3. FTS5-Pflege, wenn Caller den Klartext mitliefert
      if (options.ftsContent) {
        this.insertFtsStmt.run({
          content: options.ftsContent,
          target_type: input.targetType,
          target_id: input.targetId,
          twin_id: input.twinId,
        });
      }
    });
    tx();

    const row = this.selectByIdStmt.get(id) as EmbeddingRow | undefined;
    if (!row) {
      throw new Error(`EmbeddingsRepo.insert: Embedding ${id} nicht auffindbar nach Insert`);
    }
    return rowToRecord(row);
  }

  /**
   * Lookup über die fachliche UNIQUE-Constraint
   * (twin_id, target_type, target_id, embedding_model). Genutzt um zu
   * prüfen ob ein Quell-Objekt schon embedded ist (Idempotenz-Check vor
   * Re-Embedding in 3.4.D/G).
   */
  getByTarget(
    twinId: string,
    targetType: EmbeddingTargetType,
    targetId: string,
    embeddingModel: string,
  ): EmbeddingRecord | null {
    const row = this.selectByTargetStmt.get(
      twinId,
      targetType,
      targetId,
      embeddingModel,
    ) as EmbeddingRow | undefined;
    return row ? rowToRecord(row) : null;
  }

  /**
   * Vector-Search via CTE-Pattern aus Pre-Check. KNN-Phase isoliert mit
   * LIMIT (vec0-Pflicht), JOIN + Filter danach. Multi-Tenant via
   * e.twin_id-Filter im äußeren SELECT.
   *
   * Pool-Vergrößerung (topK * 3) damit Multi-Tenant- und Model-Filter
   * nach KNN noch genug Kandidaten lassen. Pragmatisch bis dahin, wo
   * Datenmengen vec0-partition_by rechtfertigen.
   */
  search(
    twinId: string,
    queryEmbedding: Float32Array,
    options: SearchOptions = {},
  ): SearchHit[] {
    const topK = options.topK ?? 3;
    const threshold = options.similarityThreshold ?? 0.7;
    const knnLimit = topK * 3;
    const queryBuf = f32ToBuffer(queryEmbedding);

    const modelFilter = options.embeddingModel
      ? "AND e.embedding_model = @embedding_model"
      : "";
    // Zeitfenster-Filter (Reverse-Query Typ a). Default leer → kein Filter.
    const sinceFilter = options.since ? "AND e.created_at >= @since" : "";
    const untilFilter = options.until ? "AND e.created_at <= @until" : "";

    const sql = `
      WITH knn AS (
        SELECT rowid, distance
        FROM embeddings_vec
        WHERE embedding MATCH @query
        ORDER BY distance
        LIMIT @knn_limit
      )
      SELECT e.*, knn.distance AS knn_distance
      FROM knn
      JOIN embeddings e ON e.rowid = knn.rowid
      WHERE e.twin_id = @twin_id
        ${modelFilter}
        ${sinceFilter}
        ${untilFilter}
      ORDER BY knn.distance ASC
    `;

    const params: Record<string, unknown> = {
      query: queryBuf,
      knn_limit: knnLimit,
      twin_id: twinId,
    };
    if (options.embeddingModel) {
      params.embedding_model = options.embeddingModel;
    }
    if (options.since) params.since = options.since;
    if (options.until) params.until = options.until;

    const rows = this.db.prepare(sql).all(params) as Array<
      EmbeddingRow & { knn_distance: number }
    >;

    const hits: SearchHit[] = [];
    for (const row of rows) {
      // Bei normalisierten Vektoren: cosine_sim = 1 - L2² / 2.
      // sqlite-vec liefert L2-Distanz; embedding-Provider in 3.4.B/C
      // produziert normalisierte Vektoren (E5-Pattern mit normalize:true).
      const similarity = 1 - row.knn_distance / 2;
      if (similarity < threshold) continue;
      hits.push({
        record: rowToRecord(row),
        distance: row.knn_distance,
        similarity,
      });
      if (hits.length >= topK) break;
    }
    return hits;
  }

  /**
   * 3.4.E ruft das bei jedem Search-Hit auf. Datenschicht für das spätere
   * Zeit-Erleben-Pattern (TWIN-VISION.md). access_count++ und
   * last_accessed_at = jetzt.
   */
  incrementAccess(id: string): void {
    this.incrementAccessStmt.run(new Date().toISOString(), id);
  }

  /**
   * 3.4.I: BM25-basierte Keyword-Search in `memory_fts`. Zweite Source der
   * Hybrid-Search-Pipeline (siehe MemoryRetrievalService.retrieve, RRF-
   * Merge mit Vector-Search). Caller liefert die bereits sanitierte Query —
   * Sanitization passiert im Service, weil dieselbe Query parallel an
   * Vector-Search geht (unsanitized) und FTS5 (sanitized).
   *
   * JOIN auf `embeddings` ist notwendig, weil:
   *   - `memory_fts.target_type/target_id` matchen zwar 1:1 mit
   *     `embeddings`, aber wir brauchen die `embeddings.id` als
   *     Result-Key (für `getFtsContent`, `incrementAccess`, RRF-Merge
   *     mit Vector-Hits).
   *   - Multi-Tenant- und Provider-Filter (`embedding_model`) leben auf
   *     der Stamm-Tabelle, memory_fts hat sie nur als UNINDEXED-Schatten
   *     für die Twin-Filterung.
   *
   * BM25-Score-Semantik in SQLite: negativ, kleiner = relevanter. `ORDER
   * BY bm25(memory_fts) ASC` liefert die besten zuerst. Caller arbeitet
   * mit dem Rang (1..N) statt mit dem Score selbst — der RRF-Merge ist
   * rang-basiert.
   *
   * Defensiv: wenn FTS5 doch auf einen Operator-Edge-Case trifft (z.B.
   * Sanitization-Lücke), gibt `try/catch` ein leeres Array zurück statt
   * den Send-Path zu killen.
   */
  searchFts5(
    twinId: string,
    sanitizedQuery: string,
    options: { topK: number; embeddingModel: string; since?: string; until?: string },
  ): Fts5SearchResult[] {
    if (sanitizedQuery.length === 0) return [];
    try {
      // Positions-Parameter in fester Reihenfolge aufbauen — die optionalen
      // Zeitfenster-Conditions (Reverse-Query Typ a) werden auf dem JOIN-
      // Partner `e.created_at` gefiltert, vor LIMIT. Default: kein Filter.
      const conditions: string[] = [
        "memory_fts MATCH ?",
        "memory_fts.twin_id = ?",
        "e.embedding_model = ?",
      ];
      const params: unknown[] = [sanitizedQuery, twinId, options.embeddingModel];
      if (options.since) {
        conditions.push("e.created_at >= ?");
        params.push(options.since);
      }
      if (options.until) {
        conditions.push("e.created_at <= ?");
        params.push(options.until);
      }
      params.push(options.topK);

      const rows = this.db
        .prepare(
          `SELECT
             e.id           AS embedding_id,
             e.target_type  AS target_type,
             e.target_id    AS target_id,
             bm25(memory_fts) AS bm25_score
           FROM memory_fts
           JOIN embeddings e
             ON e.twin_id = memory_fts.twin_id
            AND e.target_type = memory_fts.target_type
            AND e.target_id = memory_fts.target_id
           WHERE ${conditions.join("\n             AND ")}
           ORDER BY bm25_score ASC
           LIMIT ?`,
        )
        .all(...params) as Array<{
          embedding_id: string;
          target_type: EmbeddingTargetType;
          target_id: string;
          bm25_score: number;
        }>;
      return rows.map((row, idx) => ({
        embeddingId: row.embedding_id,
        targetType: row.target_type,
        targetId: row.target_id,
        bm25Score: row.bm25_score,
        rank: idx + 1,
      }));
    } catch (err) {
      // Sanitization sollte alle Operator-Edge-Cases abdecken. Wenn
      // hier doch was wirft, ist's Defense-in-Depth — Caller darf
      // weiterlaufen ohne Hybrid-Hits.
      console.warn(
        `[embeddings-repo] searchFts5 failed for query="${sanitizedQuery.slice(0, 80)}": ${err instanceof Error ? err.message : String(err)}`,
      );
      return [];
    }
  }

  /**
   * 3.4.E: Holt den originalen Klartext aus `memory_fts` für ein
   * Embedding-Target. Wird vom MemoryRetrievalService nach Vector-Search
   * genutzt, um den eigentlichen Content (Summary, Konversations-Aggregat,
   * Diary-Text) für den System-Prompt zu rendern.
   *
   * Returnt null, wenn kein FTS-Eintrag existiert — z.B. bei Bestands-
   * Embeddings aus 3.4.A-Tests oder wenn 3.4.D-Insert ohne `ftsContent`
   * gerufen wurde. Caller muss damit umgehen.
   */
  getFtsContent(
    twinId: string,
    targetType: EmbeddingTargetType,
    targetId: string,
  ): string | null {
    const row = this.selectFtsStmt.get(twinId, targetType, targetId) as
      | { content: string }
      | undefined;
    return row?.content ?? null;
  }

  /**
   * Maintenance-Helper für 3.4.G — listet alle Embeddings, deren Quelle
   * (z.B. conversation_summaries) noch nicht embedded ist. In 3.4.A wird
   * das via JOIN auf die Quell-Tabelle aufgelöst; hier nur der Pfad für
   * Embedding-IDs einer Target-Type-Gruppe. Caller (3.4.G CLI) joint
   * gegen die Quell-Tabelle.
   *
   * Aktuell als simple Filter-by-twin_id-Variante; bei realer Maintenance-
   * Implementierung in 3.4.G wird das vermutlich erweitert (separater Repo-
   * Helper oder direkt SQL im CLI).
   */
  listByTwin(twinId: string, targetType?: EmbeddingTargetType): EmbeddingRecord[] {
    const sql = targetType
      ? `SELECT * FROM embeddings WHERE twin_id = ? AND target_type = ? ORDER BY created_at ASC`
      : `SELECT * FROM embeddings WHERE twin_id = ? ORDER BY created_at ASC`;
    const rows = targetType
      ? (this.db.prepare(sql).all(twinId, targetType) as EmbeddingRow[])
      : (this.db.prepare(sql).all(twinId) as EmbeddingRow[]);
    return rows.map(rowToRecord);
  }

  /**
   * Gibt den gespeicherten Vektor zurück. Hauptsächlich Test-Hilfe und
   * Debug — Production-Pfade re-embedden bei Bedarf, statt den BLOB aus
   * der Stamm-Tabelle zu lesen.
   */
  getById(id: string): EmbeddingRecord | null {
    const row = this.selectByIdStmt.get(id) as EmbeddingRow | undefined;
    return row ? rowToRecord(row) : null;
  }

  count(twinId: string): number {
    const row = this.db
      .prepare("SELECT COUNT(*) AS c FROM embeddings WHERE twin_id = ?")
      .get(twinId) as { c: number };
    return row.c;
  }

  /**
   * 3.4.G: Löscht ALLE Embeddings (über alle Modelle) eines Target-Tripels
   * plus den zugehörigen vec0-Eintrag und den FTS5-Eintrag. Wird vom
   * Maintenance-CLI vor dem Re-Embedding mit --force aufgerufen — sonst
   * kollidiert der nachfolgende Insert mit UNIQUE(twin_id, target_type,
   * target_id, embedding_model).
   *
   * Bewusst über alle embedding_model-Werte: ein Provider-Wechsel hinterlässt
   * Bestände mit altem Modell, die nicht mehr zu Search-Pfad passen — die
   * dürfen weg.
   *
   * Atomar in einer Transaction: drei Tabellen, alle oder keine. FTS5-Insert
   * ist in 3.4.A optional ('ftsContent' beim insert), daher kann der DELETE
   * dort einfach 0 Rows treffen — kein Fehler.
   */
  deleteByTarget(
    twinId: string,
    targetType: EmbeddingTargetType,
    targetId: string,
  ): number {
    let removed = 0;
    const tx = this.db.transaction(() => {
      const rowidRows = this.db
        .prepare(
          `SELECT rowid FROM embeddings
             WHERE twin_id = ? AND target_type = ? AND target_id = ?`,
        )
        .all(twinId, targetType, targetId) as Array<{ rowid: number }>;
      for (const r of rowidRows) {
        this.db
          .prepare(`DELETE FROM embeddings_vec WHERE rowid = ?`)
          .run(BigInt(r.rowid));
      }
      const result = this.db
        .prepare(
          `DELETE FROM embeddings
             WHERE twin_id = ? AND target_type = ? AND target_id = ?`,
        )
        .run(twinId, targetType, targetId);
      removed = result.changes;
      this.db
        .prepare(
          `DELETE FROM memory_fts
             WHERE twin_id = ? AND target_type = ? AND target_id = ?`,
        )
        .run(twinId, targetType, targetId);
    });
    tx();
    return removed;
  }

  /**
   * #744: Löscht ALLE Embeddings eines Twins plus die zugehörigen vec0- und
   * FTS5-Shadow-Einträge. Gerufen vom Twin-Lösch-Service (deleteTwinLocal).
   *
   * Spiegelt die Shadow-Logik von {@link deleteByTarget} exakt, nur auf
   * twin_id skopiert — die Stamm-Tabelle `embeddings` hängt zwar per FK
   * ON DELETE CASCADE am twin_profiles-DELETE, aber `embeddings_vec` (vec0)
   * und `memory_fts` (FTS5) sind virtuelle Tabellen OHNE FK und würden sonst
   * verwaisen. Darum müssen alle drei hier von Hand zusammen weg.
   *
   * Atomar in einer Transaction; als Savepoint sicher schachtelbar in der
   * äußeren deleteTwinLocal-Transaction.
   */
  deleteByTwin(twinId: string): number {
    let removed = 0;
    const tx = this.db.transaction(() => {
      const rowidRows = this.db
        .prepare(`SELECT rowid FROM embeddings WHERE twin_id = ?`)
        .all(twinId) as Array<{ rowid: number }>;
      for (const r of rowidRows) {
        this.db
          .prepare(`DELETE FROM embeddings_vec WHERE rowid = ?`)
          .run(BigInt(r.rowid));
      }
      const result = this.db
        .prepare(`DELETE FROM embeddings WHERE twin_id = ?`)
        .run(twinId);
      removed = result.changes;
      this.db
        .prepare(`DELETE FROM memory_fts WHERE twin_id = ?`)
        .run(twinId);
    });
    tx();
    return removed;
  }
}

function rowToRecord(row: EmbeddingRow): EmbeddingRecord {
  return {
    id: row.id,
    twinId: row.twin_id,
    targetType: row.target_type,
    targetId: row.target_id,
    embeddingModel: row.embedding_model,
    embedding: bufferToF32(row.embedding),
    topicTags: row.topic_tags ? (JSON.parse(row.topic_tags) as string[]) : null,
    narrativeThreadId: row.narrative_thread_id,
    lastAccessedAt: row.last_accessed_at,
    accessCount: row.access_count,
    createdAt: row.created_at,
  };
}
