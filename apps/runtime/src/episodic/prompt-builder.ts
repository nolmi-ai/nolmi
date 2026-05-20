import type { RetrievalResult } from "./memory-retrieval-service.js";

// ─── EPISODIC PROMPT-BLOCK (3.4.E + 3.4.I #99) ──────────────────────────────
//
// Siebte System-Prompt-Schicht. Wird vom TwinService nach `buildSummaryBlock`
// an `runModel` durchgereicht (unmittelbar vor dem Live-Window in der
// History).
//
// 3.4.I (#99): Wording schärfer. Der 3.4-Smoke hat gezeigt, dass das alte
// "könnten passen, nicht erzwingen"-Wording dem LLM erlaubt hat, aus
// Token-Overlap-Hits detaillierte Halluzinationen zu rekonstruieren
// (siehe `docs/archive/3.4-SMOKE.md` "Bayreuth-Halluzinations-Szenario"). Neuer
// Tenor: kritisch prüfen, im Zweifel weglassen, keine Konstruktion aus
// Memory-Fragmenten.
//
// Hits kommen jetzt aus Hybrid-Search (Vector + FTS5 + RRF), nicht mehr
// reiner Vector-Threshold-Filter — daher Header-Wording "Mögliche
// Erinnerungen" statt "Erinnerungen". Wenn die Heuristik einen Hit
// produziert, ist das ein Vorschlag, kein Faktum.
//
// Bei leerem Input: null zurück. Der Caller filtert das via `.filter(Boolean)`
// raus — kein leerer "## Mögliche Erinnerungen"-Header im Prompt.

export function buildEpisodicBlock(
  memories: RetrievalResult[],
): string | null {
  if (memories.length === 0) return null;

  const lines: string[] = [
    "## Mögliche Erinnerungen",
    "",
    "Diese Memories wurden via Hybrid-Search (Semantik + Keywords) gefunden. Prüfe **kritisch**, ob sie wirklich zur aktuellen Anfrage passen.",
    "",
    "- Bei Zweifel: nicht nutzen.",
    "- Wenn keine wirklich relevant ist: das offen sagen (\"darüber habe ich keine Erinnerung\").",
    "- **Nicht aus Memory-Fragmenten Inhalte konstruieren**, die so nicht stattgefunden haben.",
    "",
  ];

  for (const memory of memories) {
    lines.push(`### Mögliche Erinnerung — ${labelForTarget(memory.targetType)}`);
    lines.push(memory.content.trim());
    lines.push("");
  }

  return lines.join("\n").trimEnd();
}

function labelForTarget(targetType: RetrievalResult["targetType"]): string {
  switch (targetType) {
    case "conversation":
      return "Vergangenes Gespräch";
    case "summary_segment":
      return "Auszug aus einem längeren Gespräch";
    case "diary_entry":
      return "Eigene Notiz";
    default:
      return "Erinnerung";
  }
}
