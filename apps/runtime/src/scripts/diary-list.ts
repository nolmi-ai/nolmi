import { loadDiaryCliContext } from "./_diary-cli-helpers.js";
import type { DiaryEntry } from "../episodic/twin-diary-repo.js";

// ─── twin:diary-list (CLI) ──────────────────────────────────────────────────
//
// Listet Diary-Einträge eines Twins, neueste zuerst. Default-Limit 20,
// per --limit überschreibbar. --full zeigt vollen Content, sonst Preview
// auf ~100 Zeichen.
//
// Aufruf:
//   pnpm twin:diary-list <handle> [--limit N] [--full] [--json]

const USAGE =
  "Nutzung:\n  pnpm twin:diary-list <handle> [--limit N] [--full] [--json]";

const DEFAULT_LIMIT = 20;
const PREVIEW_CHARS = 100;

function parseLimit(args: string[]): number {
  const idx = args.indexOf("--limit");
  if (idx === -1) return DEFAULT_LIMIT;
  const raw = args[idx + 1];
  if (!raw) {
    throw new Error("--limit ohne Wert");
  }
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`--limit muss eine positive Ganzzahl sein (got: ${raw})`);
  }
  return parsed;
}

function formatPreview(content: string, showFull: boolean): string {
  if (showFull) return content;
  const trimmed = content.replace(/\s+/g, " ").trim();
  if (trimmed.length <= PREVIEW_CHARS) return trimmed;
  return `${trimmed.slice(0, PREVIEW_CHARS)}…`;
}

function statusMarker(status: DiaryEntry["embeddingStatus"]): string {
  if (status === "done") return "✓";
  if (status === "failed") return "✗";
  return "⏳";
}

function formatCreatedAt(iso: string): string {
  // ISO → "YYYY-MM-DD HH:MM" lokal lesbar, ohne Sekunden/TZ-Klimbim
  return iso.replace("T", " ").slice(0, 16);
}

async function main() {
  const args = process.argv.slice(2);
  const json = args.includes("--json");
  const showFull = args.includes("--full");
  const positional = args.filter((a, i) => {
    if (a.startsWith("--")) return false;
    const prev = args[i - 1];
    if (prev === "--limit") return false;
    return true;
  });
  const rawHandle = positional[0];
  if (!rawHandle) {
    console.error(USAGE);
    process.exit(1);
  }
  const limit = parseLimit(args);

  const ctx = await loadDiaryCliContext(rawHandle);
  try {
    const entries = ctx.diaryRepo.listByTwin(ctx.twin.twinId, { limit });
    if (json) {
      console.log(JSON.stringify({ entries }, null, 2));
      return;
    }
    if (entries.length === 0) {
      console.log(`${ctx.twin.handle} — keine Diary-Einträge`);
      return;
    }
    console.log(
      `${ctx.twin.handle} — ${entries.length} Diary-Eintrag${entries.length === 1 ? "" : "e"} (neueste zuerst, limit=${limit})`,
    );
    console.log("─".repeat(72));
    for (const e of entries) {
      const date = formatCreatedAt(e.createdAt);
      const trigger = e.triggeredBy.padEnd(13);
      const marker = statusMarker(e.embeddingStatus);
      console.log(
        `${date}  ${trigger}  ${marker} ${e.embeddingStatus.padEnd(7)}  ${e.id}`,
      );
      console.log(`  ${formatPreview(e.content, showFull)}`);
      console.log("");
    }
  } finally {
    await ctx.cleanup();
  }
}

main().catch((err) => {
  console.error(
    "[diary-list] Fehler:",
    err instanceof Error ? err.message : err,
  );
  process.exit(1);
});
