import "dotenv/config";
import Database from "better-sqlite3";
import * as sqliteVec from "sqlite-vec";
import { loadRuntimeConfig } from "../config.js";
import { TwinProfilesRepo, type TwinProfile } from "../twin-profiles-repo.js";
import { ConversationsRepo } from "../conversations/repo.js";
import { ConversationSummariesRepo } from "../conversations/summaries-repo.js";
import { EmbeddingsRepo } from "../episodic/embeddings-repo.js";
import { TwinDiaryRepo } from "../episodic/twin-diary-repo.js";
import { MemoryEmbeddingService } from "../episodic/memory-embedding-service.js";
import { TwinDiaryService } from "../episodic/twin-diary-service.js";
import { getEmbeddingProvider } from "../episodic/providers/index.js";

// ─── DIARY CLI HELPERS (Phase 3.4 Sub-Schritt F) ────────────────────────────
//
// Gemeinsames Setup für die zwei Diary-CLI-Skripte (twin:diary-add,
// twin:diary-list). Pattern wie `_facts-cli-helpers.ts`: kurzlebige CLI ohne
// Registry/Bridge — wir öffnen die DB direkt, laden sqlite-vec für die
// vec0-Virtual-Table (sonst wirft jeder Embedding-Insert in 3.4.D den
// "no such module: vec0"-Fehler), und verdrahten Repos + Services.
//
// Provider-Lookup geht über `getEmbeddingProvider()`-Singleton aus 3.4.B —
// dieselbe Instanz, die die Runtime nutzt. Bei `local`-Default lädt das
// Modell beim ersten addEntry-Call (CLI-Latenz: 20-50s kalt). Akzeptabel
// für eine manuelle CLI-Operation.

export interface DiaryCliContext {
  twin: TwinProfile;
  db: Database.Database;
  diaryRepo: TwinDiaryRepo;
  diaryService: TwinDiaryService;
  cleanup: () => Promise<void>;
}

export async function loadDiaryCliContext(
  rawHandle: string,
): Promise<DiaryCliContext> {
  const handle = rawHandle.startsWith("@") ? rawHandle : `@${rawHandle}`;

  const config = loadRuntimeConfig();
  const db = new Database(config.dbPath);
  // sqlite-vec laden, damit 3.4.D-Embedding-Insert (vec0) sauber durchläuft.
  sqliteVec.load(db);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  const profilesRepo = new TwinProfilesRepo(db);
  const twin = profilesRepo.findByHandle(handle);
  if (!twin) {
    db.close();
    throw new Error(
      `Twin '${handle}' nicht in twin_profiles gefunden. Handle prüfen oder zuerst onboarden.`,
    );
  }

  const diaryRepo = new TwinDiaryRepo(db);
  const embeddingsRepo = new EmbeddingsRepo(db);
  const conversationsRepo = new ConversationsRepo(db);
  const conversationSummariesRepo = new ConversationSummariesRepo(db);

  const embeddingService = new MemoryEmbeddingService({
    embeddingsRepo,
    conversationSummariesRepo,
    conversationsRepo,
    twinDiaryRepo: diaryRepo,
    getProvider: () => getEmbeddingProvider(),
  });
  const diaryService = new TwinDiaryService(diaryRepo, embeddingService);

  const cleanup = async () => {
    db.close();
  };

  return { twin, db, diaryRepo, diaryService, cleanup };
}
