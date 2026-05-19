import type Database from "better-sqlite3";
import { nanoid } from "nanoid";
import type {
  Conversation,
  ConversationStartInput,
  ConversationStatus,
} from "@twin-lab/shared";

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
}

export type ConversationEmbeddingStatus = "pending" | "done" | "failed";

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
  };
}
