import type Database from "better-sqlite3";
import type { EmbeddingsRepo } from "../episodic/embeddings-repo.js";

// ─── DELETE-TWIN-SERVICE (#744 Schritt 2) ────────────────────────────────────
//
// Gegenstück zu createTwin: räumt einen Twin lokal restlos ab. Die SICHERHEIT
// ist die LÖSCH-REIHENFOLGE, nicht foreign_keys=OFF — foreign_keys bleibt ON.
//
// Warum überhaupt manuelle Reihenfolge statt „DB regelt per Cascade":
//   - audit.twin_id hat GAR KEINE FK auf twin_profiles → Cascade fasst es nicht
//     an → Waisen. Muss explizit weg.
//   - trust_relationships.twin_id ist NO ACTION (kein CASCADE) → ein DELETE des
//     Twins würde sonst HART am FK-Constraint scheitern. Muss VORHER weg.
//   - conversation_summaries referenziert audit (segment_*_audit_id) als
//     NO ACTION → das audit-DELETE scheitert, solange summaries auf diese
//     audit-Rows zeigen. Darum summaries (über conversations) ZUERST.
//   - embeddings hängt zwar per CASCADE, aber die vec0/FTS5-Shadow-Tabellen
//     NICHT → eigene Repo-Methode (deleteByTwin) räumt alle drei zusammen.
//
// Die übrigen 10 Cascade-Tabellen (skills, mcp_servers, conversations, facts,
// twin_diary, telegram_configs, telegram_messages, oauth_tokens, embeddings,
// conversation_summaries-Rest) räumt der finale twin_profiles-DELETE ab.
//
// Alles in EINER better-sqlite3-Transaction (synchron): wirft ein Schritt →
// Rollback, kein Teil-Löschen. Das ist gewollt. Der async Bridge-Deregister
// läuft AUSSERHALB + VOR dieser Tx (best-effort, im Route-Handler).

export interface DeleteTwinLocalDeps {
  db: Database.Database;
  embeddingsRepo: EmbeddingsRepo;
}

export interface DeleteTwinResult {
  /** Pro Tabelle die Anzahl direkt gelöschter Rows (Cascade-Rows zählen nicht
   *  einzeln — die deckt der twin_profiles-Count als „1" ab). Für den Smoke. */
  deletedTables: Record<string, number>;
}

/**
 * Löscht einen Twin lokal. `twinId` muss vom Caller bereits aus dem Handle
 * aufgelöst sein (der Route-Handler hat ihn aus `entry.profile.twinId`).
 */
export function deleteTwinLocal(
  twinId: string,
  deps: DeleteTwinLocalDeps,
): DeleteTwinResult {
  const { db } = deps;
  const deletedTables: Record<string, number> = {};

  const tx = db.transaction(() => {
    // 1. conversation_summaries — über die conversations des Twins. Entsperrt
    //    das audit-DELETE (summaries→audit ist NO ACTION).
    deletedTables.conversation_summaries = db
      .prepare(
        `DELETE FROM conversation_summaries
           WHERE conversation_id IN (
             SELECT id FROM conversations WHERE twin_id = ?
           )`,
      )
      .run(twinId).changes;

    // 2. audit — keine FK auf twin_profiles, würde sonst verwaisen.
    deletedTables.audit = db
      .prepare(`DELETE FROM audit WHERE twin_id = ?`)
      .run(twinId).changes;

    // 3. trust_relationships — NO ACTION, blockt sonst den twin_profiles-DELETE.
    deletedTables.trust_relationships = db
      .prepare(`DELETE FROM trust_relationships WHERE twin_id = ?`)
      .run(twinId).changes;

    // 4. embeddings inkl. vec0/FTS5-Shadows — bestehende Repo-Logik, nicht
    //    von Hand neu geschrieben (sonst driftet die Shadow-Behandlung).
    deletedTables.embeddings = deps.embeddingsRepo.deleteByTwin(twinId);

    // 5. twin_profiles — Cascade räumt die übrigen Tabellen ab.
    deletedTables.twin_profiles = db
      .prepare(`DELETE FROM twin_profiles WHERE twin_id = ?`)
      .run(twinId).changes;
  });

  tx();

  return { deletedTables };
}
