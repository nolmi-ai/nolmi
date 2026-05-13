import { loadDiaryCliContext } from "./_diary-cli-helpers.js";
import type { DiaryTrigger } from "../episodic/twin-diary-repo.js";

// ─── twin:diary-add (CLI) ───────────────────────────────────────────────────
//
// Manueller Diary-Eintrag plus Auto-Embedding (via TwinDiaryService aus
// 3.4.D). Foundation-CLI für die Selbst-Reflexions-Pattern-Phase — heute
// nur manuell, Auto-Generierung kommt mit dem Pattern selbst.
//
// Aufruf:
//   pnpm twin:diary-add <handle> "<content>" [--triggered-by manual|scheduled|post_extract]
//
// Default --triggered-by: manual. Die zwei anderen Werte sind Reserve für
// die spätere Pattern-Phase; CLI akzeptiert sie schon jetzt, damit Tests
// und manuelle Smoke-Szenarien das volle Spektrum durchgehen können.

const USAGE =
  'Nutzung:\n  pnpm twin:diary-add <handle> "<content>" [--triggered-by manual|scheduled|post_extract]';

const VALID_TRIGGERS: DiaryTrigger[] = ["manual", "scheduled", "post_extract"];

function parseTriggeredBy(args: string[]): DiaryTrigger {
  const idx = args.indexOf("--triggered-by");
  if (idx === -1) return "manual";
  const value = args[idx + 1];
  if (!value || !VALID_TRIGGERS.includes(value as DiaryTrigger)) {
    throw new Error(
      `--triggered-by muss eines von ${VALID_TRIGGERS.join("|")} sein (got: ${value ?? "<nichts>"})`,
    );
  }
  return value as DiaryTrigger;
}

async function main() {
  const args = process.argv.slice(2);
  const positional = args.filter((a, i) => {
    // --triggered-by frisst den nächsten Wert; den auch raus.
    if (a.startsWith("--")) return false;
    const prev = args[i - 1];
    if (prev === "--triggered-by") return false;
    return true;
  });

  const rawHandle = positional[0];
  const content = positional[1];
  if (!rawHandle || !content) {
    console.error(USAGE);
    process.exit(1);
  }
  if (content.trim().length === 0) {
    console.error("[diary-add] content darf nicht leer sein");
    process.exit(1);
  }

  const triggeredBy = parseTriggeredBy(args);

  const ctx = await loadDiaryCliContext(rawHandle);
  try {
    console.log(
      `[diary-add] erzeuge Eintrag (twin=${ctx.twin.handle}, chars=${content.length}, triggered_by=${triggeredBy}) …`,
    );
    console.log(
      `[diary-add] Embedding läuft synchron — beim ersten Local-Provider-Aufruf dauert der Modell-Load 20-50s.`,
    );
    const entry = await ctx.diaryService.addEntry({
      twinId: ctx.twin.twinId,
      content,
      triggeredBy,
    });

    // Status nach addEntry frisch aus dem Repo holen — addEntry awaitet das
    // Embedding bereits intern, der Status ist also 'done' oder 'failed'.
    const fresh = ctx.diaryRepo.getById(entry.id);
    const status = fresh?.embeddingStatus ?? entry.embeddingStatus;

    console.log("");
    console.log(`✓ Diary-Eintrag erstellt`);
    console.log(`  id:                ${entry.id}`);
    console.log(`  twin:              ${ctx.twin.handle}`);
    console.log(`  triggered_by:      ${entry.triggeredBy}`);
    console.log(`  created_at:        ${entry.createdAt}`);
    console.log(`  embedding_status:  ${status}`);
    if (status === "failed") {
      console.log("");
      console.log(
        "  ⚠ Embedding-Versuch ist fehlgeschlagen — der Eintrag liegt in twin_diary, aber",
      );
      console.log(
        "    Vector-Search findet ihn nicht. Mit `pnpm twin:memory-embed-all` (3.4.G) retry'en,",
      );
      console.log(
        "    sobald der Maintenance-CLI verfügbar ist.",
      );
    }
  } finally {
    await ctx.cleanup();
  }
}

main().catch((err) => {
  console.error(
    "[diary-add] Fehler:",
    err instanceof Error ? err.message : err,
  );
  process.exit(1);
});
