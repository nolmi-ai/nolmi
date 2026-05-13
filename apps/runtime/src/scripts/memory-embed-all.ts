import "dotenv/config";
import Database from "better-sqlite3";
import * as sqliteVec from "sqlite-vec";
import { loadRuntimeConfig } from "../config.js";
import { TwinProfilesRepo } from "../twin-profiles-repo.js";
import { ConversationsRepo } from "../conversations/repo.js";
import { ConversationSummariesRepo } from "../conversations/summaries-repo.js";
import { EmbeddingsRepo } from "../episodic/embeddings-repo.js";
import { TwinDiaryRepo } from "../episodic/twin-diary-repo.js";
import { MemoryEmbeddingService } from "../episodic/memory-embedding-service.js";
import {
  MemoryMaintenanceService,
  type MaintenanceTargetFilter,
} from "../episodic/memory-maintenance-service.js";
import { getEmbeddingProvider } from "../episodic/providers/index.js";
import { createSqliteRepository } from "../repository/index.js";

// ─── twin:memory-embed-all (CLI, 3.4.G) ─────────────────────────────────────
//
// Bulk-Maintenance für das Episodic-Memory. Drei Use-Cases (siehe
// memory-maintenance-service.ts): Initial-Migration für 3.3-Bestandsdaten,
// Failure-Retry, Provider-Wechsel.
//
// Aufruf:
//   pnpm twin:memory-embed-all <handle> [--force]
//                                       [--type conversation|summary_segment|diary_entry|all]
//                                       [--dry-run]

const USAGE =
  "Nutzung:\n" +
  "  pnpm twin:memory-embed-all <handle> [--force] [--type conversation|summary_segment|diary_entry|all] [--dry-run]";

const VALID_TYPES: MaintenanceTargetFilter[] = [
  "all",
  "conversation",
  "summary_segment",
  "diary_entry",
];

function parseType(args: string[]): MaintenanceTargetFilter {
  const idx = args.indexOf("--type");
  if (idx === -1) return "all";
  const raw = args[idx + 1];
  if (!raw || !VALID_TYPES.includes(raw as MaintenanceTargetFilter)) {
    throw new Error(
      `--type muss eines von ${VALID_TYPES.join("|")} sein (got: ${raw ?? "<nichts>"})`,
    );
  }
  return raw as MaintenanceTargetFilter;
}

async function main() {
  const args = process.argv.slice(2);
  const positional = args.filter((a, i) => {
    if (a.startsWith("--")) return false;
    const prev = args[i - 1];
    if (prev === "--type") return false;
    return true;
  });
  const rawHandle = positional[0];
  if (!rawHandle) {
    console.error(USAGE);
    process.exit(1);
  }
  const handle = rawHandle.startsWith("@") ? rawHandle : `@${rawHandle}`;
  const force = args.includes("--force");
  const dryRun = args.includes("--dry-run");
  const type = parseType(args);

  // CLI-Bootstrap: DB + sqlite-vec + Audit-Repo via createSqliteRepository
  // (gibt uns das audit-Interface), plus die anderen Repos ad-hoc auf der
  // gleichen Connection.
  const config = loadRuntimeConfig();
  const bundle = createSqliteRepository(config.dbPath);
  const db = bundle.db;

  // Im Falle einer wartenden WAL-Datei stellt createSqliteRepository PRAGMAs
  // — wir setzen sie hier nicht doppelt.
  void sqliteVec; // Import bleibt für TS-Awareness; load passiert in bundle.

  const profilesRepo = new TwinProfilesRepo(db);
  const twin = profilesRepo.findByHandle(handle);
  if (!twin) {
    console.error(`Twin '${handle}' nicht in twin_profiles gefunden.`);
    db.close();
    process.exit(1);
  }

  const conversationsRepo = new ConversationsRepo(db);
  const conversationSummariesRepo = new ConversationSummariesRepo(db);
  const embeddingsRepo = new EmbeddingsRepo(db);
  const twinDiaryRepo = new TwinDiaryRepo(db);
  const memoryEmbeddingService = new MemoryEmbeddingService({
    embeddingsRepo,
    conversationSummariesRepo,
    conversationsRepo,
    twinDiaryRepo,
    getProvider: () => getEmbeddingProvider(),
  });
  const maintenance = new MemoryMaintenanceService({
    db,
    audit: bundle.audit,
    embeddingsRepo,
    conversationsRepo,
    conversationSummariesRepo,
    twinDiaryRepo,
    memoryEmbeddingService,
  });

  console.log(`twin:memory-embed-all  twin=${handle}`);
  console.log(`  mode:    ${force ? "FORCE (alle Items, re-embed)" : "pending/failed only"}`);
  console.log(`  type:    ${type}`);
  if (dryRun) console.log("  DRY-RUN — keine Embeddings, keine Status-Updates");
  console.log("");

  try {
    const result = await maintenance.embedAll({
      twinId: twin.twinId,
      force,
      type,
      dryRun,
      onProgress: (e) => {
        if (e.status === "skipped" && e.total === 0) {
          // Konversation mit Segments oder leere Konversation — vor dem
          // Embed-Loop reportet.
          console.log(`  ⊘ skip ${e.targetType}/${shortId(e.targetId)}`);
          return;
        }
        const prefix = `  [${e.current}/${e.total}]`;
        const targetLabel = `${e.targetType}/${shortId(e.targetId)}`;
        if (e.status === "embedding") {
          process.stdout.write(`${prefix} ${targetLabel} … `);
        } else if (e.status === "succeeded") {
          process.stdout.write("✓\n");
        } else if (e.status === "failed") {
          const msg = e.error?.message ?? "embedding_status=failed";
          process.stdout.write(`✗  ${msg}\n`);
        } else if (e.status === "skipped") {
          process.stdout.write("⊘  dry-run\n");
        }
      },
    });

    console.log("");
    console.log(`fertig in ${(result.durationMs / 1000).toFixed(1)}s`);
    console.log(`  processed:  ${result.processed}`);
    console.log(`  succeeded:  ${result.succeeded}`);
    console.log(`  failed:     ${result.failed}`);
    console.log(`  skipped:    ${result.skipped}`);

    if (result.failed > 0) {
      console.log("");
      console.log(
        "Failed-Items können später erneut mit `pnpm twin:memory-embed-all` versucht werden.",
      );
      process.exit(2);
    }
  } finally {
    db.close();
  }
}

function shortId(id: string): string {
  return id.length > 20 ? `${id.slice(0, 17)}…` : id;
}

main().catch((err) => {
  console.error(
    "[memory-embed-all] Fehler:",
    err instanceof Error ? err.message : err,
  );
  process.exit(1);
});
