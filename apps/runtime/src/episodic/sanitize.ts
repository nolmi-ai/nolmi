// ─── FTS5 QUERY SANITIZATION (3.4.I) ────────────────────────────────────────
//
// Schicht zwischen User-Query und `memory_fts MATCH ?`. FTS5 hat eine eigene
// Mini-Sprache mit Operatoren `- AND OR NOT NEAR ^ * " ( )` — in natürlichem
// Deutsch tauchen die zufällig auf:
//
//   "Workshop-Vertrag"        → "-" als NOT-Operator → SqliteError
//   "Markus' Bayreuth-Reise?" → Apostroph + Bindestrich + Fragezeichen
//   "@florian, was meinst du?"→ "@" stört, "," stört
//
// Pre-Check und 3.4.F-Test-Output haben das mehrfach reproduziert. Strategie
// (siehe `docs/3.4.I-STRATEGY.md` "Aggressive Sanitization"): alles außer
// Buchstaben/Zahlen/Whitespace zu Space, dann Whitespace normalisieren.
//
// Der memory_fts-Tokenizer (`unicode61 remove_diacritics 2`) macht Lowercase
// und Diacritics-Strip intern — wir lassen Case und Umlaute bewusst stehen,
// damit Insert-Zeit und Search-Zeit denselben Pre-Processor sehen.
//
// Pure Function, kein State. Wird im MemoryRetrievalService vor dem FTS5-
// Search-Call aufgerufen, plus optional in CLI-Tools, die direkten FTS5-
// Zugriff brauchen.

export function sanitizeForFts5(query: string): string {
  return query
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Zählt Tokens nach Sanitization. Wird vom Retrieval-Service als
 * Min-Token-Filter genutzt: bei < 2 Tokens wird FTS5-Search übersprungen
 * (eine 1-Wort-Query trifft typisch breit + ungenau, plus Vector-Pfad
 * deckt das schon ab).
 *
 * Rückgabe 0, wenn die Query nach Sanitization leer ist.
 */
export function sanitizedTokenCount(query: string): number {
  const sanitized = sanitizeForFts5(query);
  if (sanitized.length === 0) return 0;
  return sanitized.split(" ").length;
}
