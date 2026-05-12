import type { DiaryEntry, TwinDiaryRepo, DiaryTrigger } from "./twin-diary-repo.js";
import type { MemoryEmbeddingService } from "./memory-embedding-service.js";

// ─── TWIN DIARY SERVICE (3.4.D) ─────────────────────────────────────────────
//
// Wrapper über TwinDiaryRepo + MemoryEmbeddingService. Pattern wie bei
// SummaryEngine → TwinService: Repo bleibt zustandslos und ohne externe
// Dependencies, Service-Layer orchestriert.
//
// 3.4.F-CLI (twin:diary-add) nutzt diesen Service, ebenso die spätere
// Pattern-Phase Self-Reflection für Auto-Generierung. Embedding-Failure
// unterbricht den Diary-Insert NICHT — Memory-Embedding-Service schluckt
// den Fehler intern.

export interface AddDiaryEntryArgs {
  twinId: string;
  content: string;
  triggeredBy: DiaryTrigger;
}

export class TwinDiaryService {
  constructor(
    private diaryRepo: TwinDiaryRepo,
    private memoryEmbeddingService: MemoryEmbeddingService,
  ) {}

  /**
   * Legt einen Diary-Eintrag an und triggert das Embedding synchron. Returns
   * den fertigen Eintrag (Embedding-Status kann 'done' oder 'failed' sein,
   * je nach Provider-Verfügbarkeit — Caller fragt repo.getById() ab, falls
   * er den finalen Status braucht).
   */
  async addEntry(args: AddDiaryEntryArgs): Promise<DiaryEntry> {
    const entry = this.diaryRepo.insert({
      twinId: args.twinId,
      content: args.content,
      triggeredBy: args.triggeredBy,
    });

    await this.memoryEmbeddingService.embedDiaryEntry({
      twinId: args.twinId,
      diaryEntryId: entry.id,
      content: args.content,
    });

    return entry;
  }
}
