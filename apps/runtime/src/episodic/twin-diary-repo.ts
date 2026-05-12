import type Database from "better-sqlite3";
import { nanoid } from "nanoid";

// ─── TWIN DIARY REPOSITORY (3.4.A) ──────────────────────────────────────────
//
// Daten-Foundation für das Selbst-Reflexions-Pattern (TWIN-VISION.md).
// Pure CRUD — Auto-Generierung von Einträgen (Twin schreibt aktiv über sich)
// kommt mit der späteren Pattern-Phase. Hier nur Schema + Basis-Repo plus
// Status-Updates für die Embedding-Pipeline (3.4.D/G).
//
// triggered_by-Werte (Spalten-Typ TEXT, Repo-seitig nicht enforced):
//   - 'scheduled'    automatisch via Background-Job (Pattern-Phase)
//   - 'manual'       User-CLI twin:diary-add (3.4.F)
//   - 'post_extract' nach Fact-Extraction-Reflexion (Pattern-Phase)
//
// embedding_status analog zu conversations/conversation_summaries:
//   - 'pending' (Default für neue Rows)
//   - 'done'
//   - 'failed'

export type DiaryTrigger = "scheduled" | "manual" | "post_extract";
export type DiaryEmbeddingStatus = "pending" | "done" | "failed";

export interface DiaryEntry {
  id: string;
  twinId: string;
  content: string;
  triggeredBy: DiaryTrigger;
  createdAt: string;
  embeddingStatus: DiaryEmbeddingStatus;
}

interface DiaryRow {
  id: string;
  twin_id: string;
  content: string;
  triggered_by: DiaryTrigger;
  created_at: string;
  embedding_status: DiaryEmbeddingStatus;
}

export interface CreateDiaryInput {
  twinId: string;
  content: string;
  triggeredBy: DiaryTrigger;
}

export interface ListDiaryOptions {
  limit?: number;
  offset?: number;
}

export class TwinDiaryRepo {
  constructor(private db: Database.Database) {}

  /**
   * Erzeugt einen neuen Eintrag mit Default-Status `pending`. Caller (Auto-
   * Generierung in Pattern-Phase, oder CLI in 3.4.F) muss den Embedding-
   * Pfad separat anstoßen (über EmbeddingsRepo.insert), danach
   * updateEmbeddingStatus auf 'done'.
   */
  insert(input: CreateDiaryInput): DiaryEntry {
    const entry: DiaryEntry = {
      id: `diary_${nanoid(16)}`,
      twinId: input.twinId,
      content: input.content,
      triggeredBy: input.triggeredBy,
      createdAt: new Date().toISOString(),
      embeddingStatus: "pending",
    };
    this.db
      .prepare(
        `INSERT INTO twin_diary
           (id, twin_id, content, triggered_by, created_at, embedding_status)
         VALUES
           (@id, @twin_id, @content, @triggered_by, @created_at, @embedding_status)`,
      )
      .run({
        id: entry.id,
        twin_id: entry.twinId,
        content: entry.content,
        triggered_by: entry.triggeredBy,
        created_at: entry.createdAt,
        embedding_status: entry.embeddingStatus,
      });
    return entry;
  }

  getById(id: string): DiaryEntry | null {
    const row = this.db
      .prepare(`SELECT * FROM twin_diary WHERE id = ?`)
      .get(id) as DiaryRow | undefined;
    return row ? rowToEntry(row) : null;
  }

  /**
   * Listet Diary-Einträge eines Twins, neueste zuerst. Default-Limit 100
   * begrenzt CLI-Output (3.4.F twin:diary-list). Offset für Pagination.
   */
  listByTwin(twinId: string, options: ListDiaryOptions = {}): DiaryEntry[] {
    const limit = options.limit ?? 100;
    const offset = options.offset ?? 0;
    const rows = this.db
      .prepare(
        `SELECT * FROM twin_diary
           WHERE twin_id = ?
           ORDER BY created_at DESC
           LIMIT ? OFFSET ?`,
      )
      .all(twinId, limit, offset) as DiaryRow[];
    return rows.map(rowToEntry);
  }

  /**
   * Pending-Items für den Maintenance-CLI (3.4.G). Älteste zuerst, damit
   * sequenzielles Abarbeiten chronologisch ist.
   */
  listPending(twinId: string): DiaryEntry[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM twin_diary
           WHERE twin_id = ? AND embedding_status = 'pending'
           ORDER BY created_at ASC`,
      )
      .all(twinId) as DiaryRow[];
    return rows.map(rowToEntry);
  }

  /**
   * Setzt das Status-Flag nach Embedding-Versuch in 3.4.D. Bei 'failed'
   * kann der Maintenance-CLI später retry'en.
   */
  updateEmbeddingStatus(id: string, status: DiaryEmbeddingStatus): boolean {
    const result = this.db
      .prepare(`UPDATE twin_diary SET embedding_status = ? WHERE id = ?`)
      .run(status, id);
    return result.changes > 0;
  }

  count(twinId: string): number {
    const row = this.db
      .prepare(`SELECT COUNT(*) AS c FROM twin_diary WHERE twin_id = ?`)
      .get(twinId) as { c: number };
    return row.c;
  }
}

function rowToEntry(row: DiaryRow): DiaryEntry {
  return {
    id: row.id,
    twinId: row.twin_id,
    content: row.content,
    triggeredBy: row.triggered_by,
    createdAt: row.created_at,
    embeddingStatus: row.embedding_status,
  };
}
