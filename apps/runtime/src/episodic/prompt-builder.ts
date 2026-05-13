import type { RetrievalResult } from "./memory-retrieval-service.js";

// ─── EPISODIC PROMPT-BLOCK (3.4.E) ──────────────────────────────────────────
//
// Sechste-plus-eins System-Prompt-Schicht: "Erinnerungen an vergangene
// Gespräche". Wird vom TwinService nach `buildSummaryBlock` an `runModel`
// durchgereicht (also nach den verdichteten Summaries der aktuellen Konv,
// unmittelbar vor dem Live-Window in der History).
//
// Prompt-Wording bewusst zurückhaltend: "könnten passen", "nicht erzwingen".
// Pre-Check hat gezeigt, dass Vector-Search bei Name-Overlap manchmal
// schlecht ranked; ein zu direktiver Prompt ("Diese Erinnerungen sind
// relevant") führt dazu, dass der Twin jede Erinnerung einbauen will.
// Stattdessen: Hinweis, dass die Auswahl mechanisch entstanden ist und
// kontextuell ignoriert werden darf.
//
// Bei leerem Input: null zurück. Der Caller filtert das via `.filter(Boolean)`
// raus — kein leerer "## Erinnerungen"-Header im Prompt (würde Twin verwirren).

export function buildEpisodicBlock(
  memories: RetrievalResult[],
): string | null {
  if (memories.length === 0) return null;

  const lines: string[] = [
    "## Erinnerungen an vergangene Gespräche",
    "",
    "Diese Erinnerungen sind dir aufgefallen, weil sie thematisch zur aktuellen Frage passen könnten. Nutze sie als Kontext, wenn sie wirklich relevant sind — aber zwinge sie nicht ins Gespräch, wenn sie nicht zur Situation passen.",
    "",
  ];

  for (const memory of memories) {
    lines.push(`### ${labelForTarget(memory.targetType)}`);
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
