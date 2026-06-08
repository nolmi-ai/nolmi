import type Database from "better-sqlite3";
import { nanoid } from "nanoid";
import type {
  Conversation,
  ConversationEmbeddingStatus,
  ConversationStartInput,
  ConversationStatus,
} from "@nolmi/shared";
import type { EmbeddingsRepo } from "../episodic/embeddings-repo.js";
import type { ConversationSummariesRepo } from "./summaries-repo.js";

/** #53 SS1: Abhängigkeiten für den Konv-Lösch-Cascade (wie delete-twin.ts). */
export interface DeleteConversationDeps {
  embeddingsRepo: Pick<EmbeddingsRepo, "deleteByTarget">;
  summariesRepo: Pick<ConversationSummariesRepo, "listByConversation">;
}

/** #53 SS1: Ergebnis eines Konv-Löschvorgangs (Logging + Test-Verifikation). */
export interface DeleteConversationResult {
  /** false = Konv existierte nicht oder gehört nicht zu twinId (No-op). */
  deleted: boolean;
  /** Entfernte Audit-Turns dieser Konv. */
  audits: number;
  /** Entfernte conversation_summaries-Rows. */
  summaries: number;
  /** Entfernte embeddings (conversation + summary_segment, inkl. vec0/fts). */
  embeddings: number;
}

// ─── CONVERSATIONS REPOSITORY ───────────────────────────────────────────────
//
// Eine Row pro Direct-Chat- oder (später) Bridge-Chat-Konversation. Die
// „nur eine aktive pro (owner, partner, twin)"-Invariante wird in start()
// per Transaktion erzwungen: vor dem Insert werden alle aktiven Konversationen
// für das Tripel auf 'ended' gesetzt. Ohne Transaktion gäbe es ein Zeitfenster
// in dem zwei aktive Konversationen sichtbar wären.
//
// findActive() ist Hot-Path: bei jedem Chat-Call gefragt, um die aktuelle
// Konversation zur Audit-Verknüpfung zu finden. Composite-Index
// idx_conversations_active deckt das Lookup ab.
//
// end() ist idempotent: ended_at wird nur gesetzt wenn die Konversation noch
// active ist. Erneutes end() auf eine bereits ended Konversation ist No-Op.

interface ConversationRow {
  id: string;
  owner_user_id: string;
  partner_handle: string;
  twin_id: string;
  status: ConversationStatus;
  started_at: string;
  ended_at: string | null;
  last_reset_at: string | null;
  embedding_status: ConversationEmbeddingStatus;
}

// Re-Export für Konsumenten im Runtime, die den Status-Typ erwarten — der
// kanonische Typ lebt seit #118 in @nolmi/shared.
export type { ConversationEmbeddingStatus };

export class ConversationNotFoundError extends Error {
  constructor(id: string) {
    super(`Konversation '${id}' nicht gefunden`);
    this.name = "ConversationNotFoundError";
  }
}

export class ConversationsRepo {
  constructor(private db: Database.Database) {}

  /**
   * Startet eine neue Konversation. Wenn schon eine aktive für das Tripel
   * (owner, partner, twin) existiert, wird sie zuerst auf 'ended' gesetzt —
   * alles in einer Transaktion, damit nie zwei aktive gleichzeitig sichtbar
   * sind.
   */
  start(input: ConversationStartInput): Conversation {
    const now = new Date().toISOString();
    const conv: Conversation = {
      id: `conv_${nanoid(16)}`,
      ownerUserId: input.ownerUserId,
      partnerHandle: input.partnerHandle,
      twinId: input.twinId,
      status: "active",
      startedAt: now,
      endedAt: null,
      lastResetAt: input.lastResetAt ?? null,
      embeddingStatus: "pending",
    };

    // Log beim Start, nicht bei jedem getOrStart() — sonst spammt jede
     // Direct-Chat-Nachricht den Output. Pattern analog zum Skill-Loading:
     // nur bei DB-Mutation, nicht bei Lookup.
     console.log(
       `[conversations] neue Konversation gestartet: ${conv.id} ` +
         `(owner=${input.ownerUserId}, partner=${input.partnerHandle}, twin=${input.twinId})`,
     );

    const tx = this.db.transaction(() => {
      // Bestehende aktive für das Tripel auf 'ended' setzen. Mehrere wären
      // ein Bug — der UPDATE setzt sie alle gleichzeitig.
      this.db
        .prepare(
          `UPDATE conversations
             SET status = 'ended', ended_at = @now
           WHERE owner_user_id = @owner_user_id
             AND partner_handle = @partner_handle
             AND twin_id = @twin_id
             AND status = 'active'`,
        )
        .run({
          now,
          owner_user_id: input.ownerUserId,
          partner_handle: input.partnerHandle,
          twin_id: input.twinId,
        });

      this.db
        .prepare(
          `INSERT INTO conversations
             (id, owner_user_id, partner_handle, twin_id, status, started_at, ended_at, last_reset_at)
           VALUES
             (@id, @owner_user_id, @partner_handle, @twin_id, @status, @started_at, @ended_at, @last_reset_at)`,
        )
        .run({
          id: conv.id,
          owner_user_id: conv.ownerUserId,
          partner_handle: conv.partnerHandle,
          twin_id: conv.twinId,
          status: conv.status,
          started_at: conv.startedAt,
          ended_at: conv.endedAt,
          last_reset_at: conv.lastResetAt,
        });
    });
    tx();
    return conv;
  }

  /**
   * Convenience: gibt die aktive Konversation zurück oder startet eine neue.
   * Hot-Path-tauglich, weil bei vorhandener aktiver Konversation nur ein
   * Index-Lookup passiert; nur beim ersten Send pro Konversation kommt der
   * Insert-Pfad zum Tragen.
   */
  getOrStart(
    ownerUserId: string,
    partnerHandle: string,
    twinId: string,
  ): Conversation {
    const existing = this.findActive(ownerUserId, partnerHandle, twinId);
    if (existing) return existing;
    return this.start({ ownerUserId, partnerHandle, twinId });
  }

  /**
   * Hot-Path: findet die aktive Konversation für das Tripel oder null.
   * Composite-Index idx_conversations_active liefert in O(log n) auch bei
   * tausenden Einträgen.
   */
  findActive(
    ownerUserId: string,
    partnerHandle: string,
    twinId: string,
  ): Conversation | null {
    const row = this.db
      .prepare(
        `SELECT * FROM conversations
           WHERE owner_user_id = ?
             AND partner_handle = ?
             AND twin_id = ?
             AND status = 'active'
           LIMIT 1`,
      )
      .get(ownerUserId, partnerHandle, twinId) as ConversationRow | undefined;
    return row ? rowToConversation(row) : null;
  }

  findById(id: string): Conversation {
    const row = this.db
      .prepare("SELECT * FROM conversations WHERE id = ?")
      .get(id) as ConversationRow | undefined;
    if (!row) throw new ConversationNotFoundError(id);
    return rowToConversation(row);
  }

  /**
   * Listet alle Konversationen für das Tripel, neueste zuerst (started_at
   * absteigend). Für die UI-Konversations-Historie.
   */
  list(
    ownerUserId: string,
    partnerHandle: string,
    twinId: string,
  ): Conversation[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM conversations
           WHERE owner_user_id = ?
             AND partner_handle = ?
             AND twin_id = ?
           ORDER BY started_at DESC`,
      )
      .all(ownerUserId, partnerHandle, twinId) as ConversationRow[];
    return rows.map(rowToConversation);
  }

  /**
   * Beendet eine Konversation. Idempotent: bei bereits ended-Konversation
   * No-Op (kein Re-Stempeln des ended_at). Wirft, wenn die ID gar nicht
   * existiert — sonst würde ein Tippfehler still durchgehen.
   */
  end(id: string): void {
    const result = this.db
      .prepare(
        `UPDATE conversations
           SET status = 'ended', ended_at = ?
         WHERE id = ? AND status = 'active'`,
      )
      .run(new Date().toISOString(), id);

    if (result.changes === 0) {
      // Entweder nicht da, oder schon ended — `findById` für klare Diagnose.
      // Wirft ConversationNotFoundError wenn die ID gar nicht existiert.
      this.findById(id);
      // Existiert, aber war schon ended → idempotent durchwinken.
    }
  }

  /**
   * G2 (Telegram-Lifecycle): aktive Konversationen eines Twins, deren letzte
   * Aktivität älter als `cutoffIso` ist (= idle). „Letzte Aktivität" = jüngster
   * Audit-Turn der Konversation (Owner-Direct/Telegram-Audits tragen
   * conversation_id); fehlt der (gerade gestartete Konv ohne Turn), zählt
   * `started_at` als Fallback — so wird eine eben begonnene Konv NIE fälschlich
   * als idle markiert. Rein lesend; das Beenden+Verdichten macht der Caller über
   * `resetConversation`. KEINE Migration nötig — leitet idle aus vorhandenen
   * Timestamps ab. ISO-Text ist lexikographisch vergleichbar.
   */
  listIdleActive(twinId: string, cutoffIso: string): Conversation[] {
    const rows = this.db
      .prepare(
        `SELECT c.* FROM conversations c
           WHERE c.twin_id = ?
             AND c.status = 'active'
             AND COALESCE(
                   (SELECT MAX(a.timestamp) FROM audit a
                      WHERE a.conversation_id = c.id),
                   c.started_at
                 ) < ?
           ORDER BY c.started_at ASC`,
      )
      .all(twinId, cutoffIso) as ConversationRow[];
    return rows.map(rowToConversation);
  }

  /**
   * #105: Listet alle aktiven Konversationen eines Owners pro Twin. Wird
   * vom List-Endpoint (GET /twins/:handle/conversations) genutzt, um lokale
   * start-only-Konversationen (#105) sichtbar zu machen, die noch keine
   * Bridge-Messages haben. Sort DESC nach `started_at` — neueste zuerst,
   * Caller kann das beim Merge ins Bridge-Aggregat verwenden.
   */
  listActiveByOwnerAndTwin(
    ownerUserId: string,
    twinId: string,
  ): Conversation[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM conversations
           WHERE owner_user_id = ?
             AND twin_id = ?
             AND status = 'active'
           ORDER BY started_at DESC`,
      )
      .all(ownerUserId, twinId) as ConversationRow[];
    return rows.map(rowToConversation);
  }

  /**
   * 3.4.G: Listet alle beendeten Konversationen eines Twins (älteste zuerst).
   * Aktive Konversationen werden ausgelassen — die sind noch in Bearbeitung
   * und das Reset wird sie selbst embedden. Wird vom Maintenance-CLI mit
   * --force genutzt.
   */
  listEndedByTwin(twinId: string): Conversation[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM conversations
           WHERE twin_id = ? AND status = 'ended'
           ORDER BY ended_at ASC NULLS LAST, started_at ASC`,
      )
      .all(twinId) as ConversationRow[];
    return rows.map(rowToConversation);
  }

  /**
   * 3.4.G: Wie listEndedByTwin, aber nur Konversationen, deren
   * embedding_status nicht 'done' ist. Default-Pfad des Maintenance-CLI.
   */
  listPendingByTwin(twinId: string): Conversation[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM conversations
           WHERE twin_id = ?
             AND status = 'ended'
             AND embedding_status != 'done'
           ORDER BY ended_at ASC NULLS LAST, started_at ASC`,
      )
      .all(twinId) as ConversationRow[];
    return rows.map(rowToConversation);
  }

  /**
   * 3.4.D: Setzt das embedding_status-Flag nach Reset-Embedding-Versuch.
   * 'done' nach erfolgreichem Insert in `embeddings`, 'failed' bei Provider-
   * oder DB-Failure. Wirft nicht — Caller (Memory-Embedding-Service) macht
   * Best-Effort und loggt selbst.
   */
  updateEmbeddingStatus(id: string, status: ConversationEmbeddingStatus): boolean {
    const result = this.db
      .prepare(`UPDATE conversations SET embedding_status = ? WHERE id = ?`)
      .run(status, id);
    return result.changes > 0;
  }

  /**
   * #53 SS1: Löscht eine Konversation ENDGÜLTIG — Row + Audit-Turns + Summaries
   * + Embeddings (conversation + summary_segment, inkl. vec0/fts). Eine
   * Transaktion (foreign_keys bleibt ON, wie delete-twin.ts). Die REIHENFOLGE
   * ist load-bearing:
   *   1. Summary-IDs ZUERST holen — die CASCADE (conversation_summaries→conv)
   *      würde sie sonst mit den Summary-Rows entfernen, bevor wir ihre
   *      Embeddings selektiv löschen können.
   *   2. Embeddings je Summary-Segment + die Konv-Embedding via deleteByTarget
   *      (atomar embeddings+vec+fts — NICHT FK-gekoppelt, müssen explizit weg,
   *      sonst verwaiste Vektoren).
   *   3. conversation_summaries manuell VOR audit — segment_*_audit_id→audit ist
   *      NO ACTION, blockt sonst den audit-DELETE.
   *   4. Audit-Turns hart — die FK audit.conversation_id ist SET NULL (nicht
   *      CASCADE) → würde sonst nur verwaisen statt zu löschen. VOR der conv-Row,
   *      weil ein conv-DELETE die conversation_id per SET NULL kappen würde.
   *   5. Die conversations-Row, an id UND twin_id gebunden.
   *
   * 🔴 Twin-Scope: bricht ohne Löschung ab (deleted:false), wenn convId nicht zu
   * twinId gehört — KEIN Cross-Twin-Delete. ALLE DELETEs sind an conversation_id
   * (+ twin_id) gebunden, nie breiter. Schlägt ein Schritt fehl → Rollback (tx),
   * keine halb-gelöschte Konv.
   */
  deleteConversation(
    twinId: string,
    convId: string,
    deps: DeleteConversationDeps,
  ): DeleteConversationResult {
    // Scope-Guard VOR der Transaktion: existiert die Konv + gehört sie diesem
    // Twin? Sonst No-op — niemals eine fremde Konv anfassen.
    const row = this.db
      .prepare("SELECT twin_id FROM conversations WHERE id = ?")
      .get(convId) as { twin_id: string } | undefined;
    if (!row || row.twin_id !== twinId) {
      return { deleted: false, audits: 0, summaries: 0, embeddings: 0 };
    }

    let embeddings = 0;
    let summaries = 0;
    let audits = 0;

    const tx = this.db.transaction(() => {
      // 1. Summary-IDs ZUERST (vor jedem Löschen — sonst CASCADE-Verlust).
      const summaryRows = deps.summariesRepo.listByConversation(convId);

      // 2. Embeddings: pro Summary-Segment + die Konv-Embedding (atomar vec+fts).
      for (const s of summaryRows) {
        embeddings += deps.embeddingsRepo.deleteByTarget(
          twinId,
          "summary_segment",
          s.id,
        );
      }
      embeddings += deps.embeddingsRepo.deleteByTarget(
        twinId,
        "conversation",
        convId,
      );

      // 3. conversation_summaries manuell VOR audit (NO-ACTION-FK entsperren).
      summaries = this.db
        .prepare(`DELETE FROM conversation_summaries WHERE conversation_id = ?`)
        .run(convId).changes;

      // 4. Audit-Turns hart (FK ist SET NULL) — VOR der conv-Row.
      audits = this.db
        .prepare(`DELETE FROM audit WHERE conversation_id = ?`)
        .run(convId).changes;

      // 5. Die conversations-Row, an id UND twin_id gebunden (defensiv).
      this.db
        .prepare(`DELETE FROM conversations WHERE id = ? AND twin_id = ?`)
        .run(convId, twinId);
    });
    tx();

    console.log(
      `[conversations] gelöscht: ${convId} (twin=${twinId}) — ` +
        `${audits} Audit-Turns, ${summaries} Summaries, ${embeddings} Embeddings`,
    );

    return { deleted: true, audits, summaries, embeddings };
  }
}

function rowToConversation(row: ConversationRow): Conversation {
  return {
    id: row.id,
    ownerUserId: row.owner_user_id,
    partnerHandle: row.partner_handle,
    twinId: row.twin_id,
    status: row.status,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    lastResetAt: row.last_reset_at,
    embeddingStatus: row.embedding_status,
  };
}
