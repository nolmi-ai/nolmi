import type { Fact } from "./repo.js";

// ─── FACTS PROMPT-BUILDER (Phase 3.3 Sub-Schritt E) ─────────────────────────
//
// Wandelt die in `facts` persistierten Schlüssel-Werte in einen System-
// Prompt-Block um, der direkt nach der Persona in den LLM-Kontext fließt.
//
// Pragmatischer Mittelweg: Key wird via `humanizeFactKey` ins Lesbare
// transformiert (snake_case → Sentence case), Value bleibt verbatim. Kein
// LLM-Naturalisierungs-Schritt für den Block — bei kurzen Pilot-Facts ist
// das Overkill, plus eine Twin-Description pro Fact (Spalte `description`)
// können wir später ergänzen, wenn die UX das fordert.
//
// Reihenfolge: alphabetisch nach factKey, damit der gleiche Twin bei
// identischen Facts immer denselben Block bekommt — Konsistenz im
// LLM-Kontext.
//
// Filter macht der Caller (TwinService) via `factsRepo.listByTwin({
// onlyApproved: true })`. `buildFactsBlock` selbst nimmt die Liste 1:1.
// Returnt `null` bei leerer Liste, sodass der Caller im `.filter(Boolean)`-
// Step der System-Prompt-Konkatenation rausfällt.

/**
 * snake_case-Key → Sentence case. Deterministisch, kein LLM-Aufruf.
 *
 *   "wife_name"       → "Wife name"
 *   "company"         → "Company"
 *   "FAVORITE_COLOR"  → "Favorite color"
 *   "a_b_c_d"         → "A b c d"
 *   ""                → "" (Defensive: leerer String bleibt leer, kein Crash)
 */
export function humanizeFactKey(key: string): string {
  if (key.length === 0) return "";
  const spaced = key.replace(/_/g, " ").toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/**
 * Rendert die Fact-Liste als Markdown-Bullet-Block mit Header. Bei leerer
 * Liste `null` — Caller filtert via `.filter(Boolean)` aus der System-Prompt-
 * Schichten-Konkat raus.
 *
 * Caller-Verantwortung: nur `confidence='approved'`-Facts übergeben. Pending-
 * und Auto-Facts sollen NICHT in den Twin-Kontext — Pending sind Twin-eigene
 * Vorschläge (würden sich selbst zurückspiegeln), Auto ist Reserve.
 */
export function buildFactsBlock(facts: Fact[]): string | null {
  if (facts.length === 0) return null;
  const sorted = [...facts].sort((a, b) =>
    a.factKey.localeCompare(b.factKey),
  );
  const lines = sorted.map(
    (f) => `- ${humanizeFactKey(f.factKey)}: ${f.factValue}`,
  );
  return `**Was du weißt:**\n${lines.join("\n")}`;
}
