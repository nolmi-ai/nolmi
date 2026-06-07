import type Database from "better-sqlite3";
import type { AuditRepository } from "../repository/types.js";
import type { ConversationSummariesRepo } from "../conversations/summaries-repo.js";
import type { ConversationsRepo } from "../conversations/repo.js";
import type { EmbeddingsRepo, EmbeddingTargetType } from "./embeddings-repo.js";
import type { TwinDiaryRepo } from "./twin-diary-repo.js";
import {
  aggregateConversationForEmbedding,
  type MemoryEmbeddingService,
} from "./memory-embedding-service.js";
import type {
  TailFlushCallback,
  TailFlushTrigger,
} from "../conversations/tail-flush.js";
import { TAIL_FLUSH_BATCH_LIMIT } from "../config.js";

// ─── MEMORY MAINTENANCE SERVICE (3.4.G) ─────────────────────────────────────
//
// Bulk-Embedding-Operationen, die der twin:memory-embed-all-CLI ausführt.
// Deckt drei Use-Cases ab:
//
//   1. Initial-Migration: Bestandsdaten aus 3.3 sind `embedding_status='pending'`
//      (Default seit Migration 018). Nach 3.4-Deploy kann der Owner sie hier
//      nachträglich embedden.
//
//   2. Failure-Retry: 3.4.D setzt bei Provider-/DB-Failure status='failed'.
//      Default-Run findet die und versucht's nochmal.
//
//   3. Provider-Wechsel via --force: alte Embeddings (mit anderem embedding_model)
//      werden komplett gelöscht und mit dem aktiven Provider neu erzeugt.
//      Sonst kollidiert der Insert mit UNIQUE(twin_id, target_type, target_id,
//      embedding_model).
//
// Skip-Logik (analog 3.4.D-Reset-Pfad): wenn eine Konversation Summary-
// Segments hat, wird die Konversation als Ganzes NICHT embedded — die
// Segments decken den Inhalt schon ab, ein Konversations-Embedding wäre
// Duplikat-Content. Counter `skipped` separat reporten.

export type MaintenanceTargetFilter =
  | "all"
  | EmbeddingTargetType;

export interface ProgressEvent {
  current: number;
  total: number;
  targetType: EmbeddingTargetType;
  targetId: string;
  /** 'tail-pending' = dry-run-Vorschau: diese Konv würde im echten Lauf geflusht. */
  status: "embedding" | "succeeded" | "failed" | "skipped" | "tail-pending";
  error?: Error;
  /** Bei 'tail-pending': Anzahl unsummarisierter Tail-Turns (dry-run). */
  tailTurns?: number;
}

export interface EmbedAllArgs {
  twinId: string;
  /** Re-embedded auch already-done Items. Default false. */
  force?: boolean;
  /** Eingrenzen auf einen Eintragstyp. Default "all". */
  type?: MaintenanceTargetFilter;
  /** Zeigt was getan würde, ohne tatsächlich zu embedden. */
  dryRun?: boolean;
  /**
   * Sub-Step 4: Auslöser-Kontext für den Tail-Flush von Konv MIT Segmenten.
   * 'manual' (Default, CLI) = immer. 'autonomous' (Loop, Sub-Step 5) = nur bei
   * TAIL_FLUSH_AUTONOMOUS_ENABLED (das Gate liegt in flushConversationTail).
   */
  trigger?: TailFlushTrigger;
  /** Max. echte Tail-Flushes pro Lauf. Default TAIL_FLUSH_BATCH_LIMIT. */
  tailFlushLimit?: number;
  onProgress?: (event: ProgressEvent) => void;
}

export interface EmbedAllResult {
  processed: number;
  succeeded: number;
  failed: number;
  skipped: number;
  /** Sub-Step 4: Anzahl tatsächlich geflushter Tails (Konv mit Segment + Tail). */
  tailFlushed: number;
  /** Sub-Step 6a-fix: im dry-run die Anzahl Konv, die der echte Lauf flushen würde. */
  tailFlushable: number;
  durationMs: number;
}

interface WorkItem {
  type: EmbeddingTargetType;
  id: string;
  content: string;
}

export interface MaintenanceDeps {
  db: Database.Database;
  audit: AuditRepository;
  embeddingsRepo: EmbeddingsRepo;
  conversationsRepo: ConversationsRepo;
  conversationSummariesRepo: ConversationSummariesRepo;
  twinDiaryRepo: TwinDiaryRepo;
  memoryEmbeddingService: MemoryEmbeddingService;
  /**
   * Sub-Step 4: optionaler Tail-Flush-Callback (Konv mit Segment + Tail). Wenn
   * gesetzt, ersetzt er den alten segCount-Skip durch echte Tail-Verdichtung;
   * fehlt er (Back-Compat-Aufrufer ohne LLM), bleibt das alte Skip+done-Verhalten.
   * Der Caller (CLI/Loop) verkabelt ihn mit flushConversationTail + SummaryEngine.
   */
  tailFlush?: TailFlushCallback;
  /**
   * Sub-Step 6a-fix: reiner Tail-Leser (summaryEngine.countPendingTurns) — KEIN
   * LLM, kein Schreiben. Nur für die dry-run-Vorschau: zeigt, welche Konv der
   * echte Lauf flushen würde, ohne irgendetwas auszuführen.
   */
  tailPending?: (conversationId: string) => number;
}

export class MemoryMaintenanceService {
  constructor(private deps: MaintenanceDeps) {}

  async embedAll(args: EmbedAllArgs): Promise<EmbedAllResult> {
    const start = Date.now();
    const type: MaintenanceTargetFilter = args.type ?? "all";
    const includes = (t: EmbeddingTargetType) => type === "all" || type === t;
    let skipped = 0;
    // Sub-Step 4: Tail-Flush-Kontext + Batch-Limit.
    const trigger: TailFlushTrigger = args.trigger ?? "manual";
    const tailFlushLimit = args.tailFlushLimit ?? TAIL_FLUSH_BATCH_LIMIT;
    let tailFlushed = 0;
    let tailFlushable = 0;

    // ─── Sammeln ──────────────────────────────────────────────────────────
    const items: WorkItem[] = [];

    if (includes("summary_segment")) {
      const segments = args.force
        ? this.deps.conversationSummariesRepo.listByTwin(args.twinId)
        : this.deps.conversationSummariesRepo.listPendingByTwin(args.twinId);
      for (const s of segments) {
        if (!s.summaryMd.trim()) {
          skipped += 1;
          continue;
        }
        items.push({
          type: "summary_segment",
          id: s.id,
          content: s.summaryMd,
        });
      }
    }

    if (includes("conversation")) {
      const convs = args.force
        ? this.deps.conversationsRepo.listEndedByTwin(args.twinId)
        : this.deps.conversationsRepo.listPendingByTwin(args.twinId);
      for (const conv of convs) {
        const segCount = this.deps.conversationSummariesRepo.count(conv.id);
        if (segCount > 0) {
          // Sub-Step 4/6a-fix: Konv MIT Segment(en) hat oft einen unsummarisierten
          // Tail (L3). Wenn ein tailFlush-Callback verkabelt ist → Tail verdichten
          // (echter Lauf) bzw. nur VORHERSAGEN (dry-run, kein LLM/Schreiben).
          if (this.deps.tailFlush) {
            if (args.dryRun) {
              // dry-run: reiner Tail-Leser (countPendingTurns) — KEIN LLM, KEIN
              // Schreiben. Zeigt, was der echte Lauf flushen würde.
              const tail = this.deps.tailPending
                ? this.deps.tailPending(conv.id)
                : 0;
              if (tail > 0) {
                tailFlushable += 1;
                args.onProgress?.({
                  current: 0, total: 0, targetType: "conversation",
                  targetId: conv.id, status: "tail-pending", tailTurns: tail,
                });
              } else {
                // Kein Tail → im echten Lauf No-op→done; hier nur skip-Anzeige.
                skipped += 1;
                args.onProgress?.({
                  current: 0, total: 0, targetType: "conversation",
                  targetId: conv.id, status: "skipped",
                });
              }
              continue;
            }
            // Echter Lauf:
            if (tailFlushed >= tailFlushLimit) {
              // Batch-Limit erreicht — Konv bleibt pending für den nächsten Lauf
              // (NICHT done), damit der Bestand über mehrere Läufe abgebaut wird.
              skipped += 1;
              args.onProgress?.({
                current: 0, total: 0, targetType: "conversation",
                targetId: conv.id, status: "skipped",
              });
              continue;
            }
            // flushConversationTail setzt den Konv-Status selbst (done / noop→done /
            // gated→bleibt-pending / failed). Nur echte Flushes zählen gegens Limit.
            const res = await this.deps.tailFlush(conv.id, trigger);
            if (res.status === "done") tailFlushed += 1;
            skipped += 1;
            args.onProgress?.({
              current: 0, total: 0, targetType: "conversation",
              targetId: conv.id, status: "skipped",
            });
            continue;
          }
          // Back-Compat: kein tailFlush-Callback → altes Verhalten.
          // Segmente decken den Hauptteil ab; Status auf 'done' (Pending-Konvergenz).
          if (!args.dryRun) {
            this.deps.conversationsRepo.updateEmbeddingStatus(conv.id, "done");
          }
          skipped += 1;
          args.onProgress?.({
            current: 0,
            total: 0,
            targetType: "conversation",
            targetId: conv.id,
            status: "skipped",
          });
          continue;
        }
        const content = await this.aggregateConversationContent(conv.id);
        if (!content.trim()) {
          // Leere Konv (Pre-Migration-Audits o.ä.) — als 'done' markieren,
          // damit die Pending-Liste konvergiert.
          if (!args.dryRun) {
            this.deps.conversationsRepo.updateEmbeddingStatus(conv.id, "done");
          }
          skipped += 1;
          args.onProgress?.({
            current: 0,
            total: 0,
            targetType: "conversation",
            targetId: conv.id,
            status: "skipped",
          });
          continue;
        }
        items.push({ type: "conversation", id: conv.id, content });
      }
    }

    if (includes("diary_entry")) {
      const entries = args.force
        ? this.deps.twinDiaryRepo.listByTwin(args.twinId, { limit: 100_000 })
        : this.deps.twinDiaryRepo.listPending(args.twinId);
      for (const e of entries) {
        if (!e.content.trim()) {
          skipped += 1;
          continue;
        }
        items.push({ type: "diary_entry", id: e.id, content: e.content });
      }
    }

    // ─── --force: alte Embeddings vorher löschen ─────────────────────────
    if (args.force && !args.dryRun) {
      for (const item of items) {
        this.deps.embeddingsRepo.deleteByTarget(args.twinId, item.type, item.id);
      }
    }

    // ─── Dry-Run: nur reporten ────────────────────────────────────────────
    if (args.dryRun) {
      for (let i = 0; i < items.length; i++) {
        const item = items[i]!;
        args.onProgress?.({
          current: i + 1,
          total: items.length,
          targetType: item.type,
          targetId: item.id,
          status: "skipped",
        });
      }
      return {
        processed: items.length,
        succeeded: 0,
        failed: 0,
        skipped: skipped + items.length,
        tailFlushed,
        tailFlushable,
        durationMs: Date.now() - start,
      };
    }

    // ─── Embedden — sequenziell ───────────────────────────────────────────
    let succeeded = 0;
    let failed = 0;
    for (let i = 0; i < items.length; i++) {
      const item = items[i]!;
      args.onProgress?.({
        current: i + 1,
        total: items.length,
        targetType: item.type,
        targetId: item.id,
        status: "embedding",
      });
      try {
        await this.runEmbed(args.twinId, item);
        const status = this.readStatus(item);
        if (status === "done") {
          succeeded += 1;
          args.onProgress?.({
            current: i + 1,
            total: items.length,
            targetType: item.type,
            targetId: item.id,
            status: "succeeded",
          });
        } else {
          failed += 1;
          args.onProgress?.({
            current: i + 1,
            total: items.length,
            targetType: item.type,
            targetId: item.id,
            status: "failed",
          });
        }
      } catch (err) {
        // MemoryEmbeddingService schluckt seine eigenen Provider-Fehler;
        // wenn hier doch was geworfen wird, ist es vermutlich ein DB-/
        // Repo-Problem. Trotzdem: nicht hochwerfen, sondern als 'failed'
        // zählen, damit der Bulk-Lauf nicht beim ersten Crash kippt.
        failed += 1;
        const error = err instanceof Error ? err : new Error(String(err));
        args.onProgress?.({
          current: i + 1,
          total: items.length,
          targetType: item.type,
          targetId: item.id,
          status: "failed",
          error,
        });
      }
    }

    return {
      processed: items.length,
      succeeded,
      failed,
      skipped,
      tailFlushed,
      tailFlushable,
      durationMs: Date.now() - start,
    };
  }

  // ─── intern ────────────────────────────────────────────────────────────

  private async runEmbed(twinId: string, item: WorkItem): Promise<void> {
    switch (item.type) {
      case "summary_segment":
        await this.deps.memoryEmbeddingService.embedSummarySegment({
          twinId,
          segmentId: item.id,
          content: item.content,
        });
        return;
      case "conversation":
        await this.deps.memoryEmbeddingService.embedConversation({
          twinId,
          conversationId: item.id,
          content: item.content,
        });
        return;
      case "diary_entry":
        await this.deps.memoryEmbeddingService.embedDiaryEntry({
          twinId,
          diaryEntryId: item.id,
          content: item.content,
        });
        return;
    }
  }

  /**
   * Status nach Embed-Versuch aus der Quell-Tabelle lesen. MemoryEmbedding-
   * Service hat ihn bei Success auf 'done' und bei Failure auf 'failed'
   * gesetzt — wir entscheiden anhand dieses Felds, ob der Versuch zählt
   * oder nicht.
   */
  private readStatus(item: WorkItem): "done" | "failed" | "pending" {
    let table: string;
    switch (item.type) {
      case "summary_segment":
        table = "conversation_summaries";
        break;
      case "conversation":
        table = "conversations";
        break;
      case "diary_entry":
        table = "twin_diary";
        break;
    }
    const row = this.deps.db
      .prepare(`SELECT embedding_status FROM ${table} WHERE id = ?`)
      .get(item.id) as { embedding_status: string } | undefined;
    const s = row?.embedding_status;
    if (s === "done" || s === "failed" || s === "pending") return s;
    return "pending";
  }

  /**
   * Konversations-Aggregation analog 3.4.D-Reset-Pfad: Audits ASC laden,
   * mit `aggregateConversationForEmbedding` zu `[user]/[assistant]`-Text
   * verdichten. Limit 10_000 ist praktisch unbegrenzt für 3.4-Use-Cases
   * (Konversationen mit Reset-Embedding sind per Definition kurz).
   */
  private async aggregateConversationContent(
    conversationId: string,
  ): Promise<string> {
    const auditsDesc = await this.deps.audit.listByConversation(
      conversationId,
      10_000,
    );
    const auditsAsc = [...auditsDesc].reverse();
    return aggregateConversationForEmbedding(auditsAsc);
  }
}
