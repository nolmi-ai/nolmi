import type { FamiliarityLevel } from "./trust-repo.js";

// ─── FAMILIARITY PROMPT-BLOCK (Phase 4.3 Schritt 2/5) ───────────────────────
//
// Übersetzt das Vertrautheits-Level (Schritt 1) in einen Ton-Hinweis für den
// A2A-Prompt: der Twin passt die VERPACKUNG an die Beziehungstiefe an, die
// Substanz/Werte bleiben gleich (Vision Block 1.3 „Substanz konstant, Verpackung
// passt sich an"). MILDE Wirkung — NUR Stil, KEINE Autonomie/Dispatch (Schritt 5).
//
// Wird NUR aus dem A2A-Pfad gesetzt (bridgeContextHint für eingehende Antworten,
// approveTwinSend für ausgehende Sends) — NIE aus runOwnerDirect (im Owner-Chat
// gibt es keinen A2A-Partner, kein Level). Spiegelbild zu focusBlock (owner-only).
//
// 🔴 Anders als focusBlock: alle vier Level erzeugen einen Block (auch 'fremd' —
// der „zurückhaltend/Klärungsfragen"-Ton IST die gewünschte Wirkung für Fremde,
// nicht Abwesenheit). string|null nur als defensives Muster (leerer Handle → null).

const TONE: Record<FamiliarityLevel, (partner: string) => string> = {
  fremd: (partner) =>
    `Du kennst ${partner} kaum. Bleib höflich und etwas zurückhaltend, stelle eher Klärungsfragen als Urteile zu fällen. Deine Substanz und Werte bleiben gleich — nur vorsichtiger verpackt.`,
  bekannt: (partner) =>
    `Du kennst ${partner} etwas. Sei freundlich und zugänglich, aber noch etwas zurückhaltend mit starken Urteilen. Substanz konstant, Ton offen-freundlich.`,
  vertraut: (partner) =>
    `Du kennst ${partner} gut. Sei direkt, du darfst klar Stellung beziehen und urteilen. Kein übertriebenes Abwägen — sprich, wie man mit einem vertrauten Gegenüber spricht.`,
  eng: (partner) =>
    `${partner} steht dir nahe. Sei sehr direkt, du darfst kritisieren, widersprechen und Klartext reden. Kennt den Kontext, keine Floskeln — wie unter engen Vertrauten.`,
};

export function buildFamiliarityBlock(
  level: FamiliarityLevel,
  partnerHandle: string,
): string | null {
  const partner = partnerHandle.trim();
  if (partner === "") return null; // defensive: ohne Partner kein Ton-Bezug
  return `## Beziehung zu ${partner}\n\n${TONE[level](partner)}`;
}
