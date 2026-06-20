import { generateObject, type LanguageModel } from "ai";
import { z } from "zod";

// ─── @-MENTION INTENT CLASSIFIER (A2A Autosend Weg 2 — SS1, Schatten) ─────────
//
// Kleiner Klassifikator für den Fall, den der Keyword-Detektor (detectCapability)
// heute NICHT abdeckt: eine @-Mention MIT erkanntem Target, aber OHNE Sende-Verb
// aus SEND_TRIGGERS. Heute landet das in respond_to_chat (+ ehrlicher Verb-Hint,
// Commit 7ee9bc9). Weg 2 will unterscheiden, ob der Owner @X tatsächlich
// ADRESSIERT (SEND, soll send_to_twin auslösen) oder nur ÜBER @X redet (CHAT).
//
// 🔴 SICHERHEITSLINIE: Im Zweifel CHAT. Fehler/Timeout/Unklarheit → CHAT. Selbst
// bei SEND bleibt der bestehende send_to_twin-Pfad mandate-gated (always_pending
// → Approval), siehe mandates.yaml — kein Auto-Send ohne Freigabe.
//
// SS1 = NUR diese Funktion + Smoke-Harness; KEINE Verdrahtung in chat() (SS2),
// keine Scharfschaltung (SS3). Muster gespiegelt von classifyForcedTool
// (skills/pre-pass.ts): generateObject + deps.classifierModel + AbortController.

const MENTION_INTENT_TIMEOUT_MS = 3000;

export type MentionIntent = "SEND" | "CHAT";

export interface MentionIntentResult {
  intent: MentionIntent;
  /** Kurzbegründung — für die SS3-Beobachtung (Logging vor Scharfschaltung). */
  reason: string;
}

const MentionIntentSchema = z.object({
  intent: z.enum(["SEND", "CHAT"]),
  reason: z.string(),
});

/**
 * Klassifiziert, ob eine verblose @-Mention an `targetHandle` Sende-Absicht ist.
 * Fail-safe: jeder Fehler/Timeout → CHAT (nie versehentlich SEND).
 */
export async function classifyMentionIntent(
  userMessage: string,
  targetHandle: string,
  classifierModel: LanguageModel,
): Promise<MentionIntentResult> {
  const system =
    `Du entscheidest, ob der Owner mit einer @-Erwähnung eine Nachricht an ` +
    `${targetHandle} WEITERLEITEN will (SEND) oder nur ÜBER bzw. mit Bezug auf ` +
    `${targetHandle} chattet (CHAT).\n\n` +
    `SEND = Der Owner redet ${targetHandle} DIREKT an, um etwas an ihn ` +
    `weiterzuleiten. Beispiele: "${targetHandle} kannst du Freitag?", ` +
    `"${targetHandle} was hältst du von X".\n\n` +
    `CHAT = Der Owner redet ÜBER ${targetHandle} oder überlegt nur. Beispiele: ` +
    `"was hat ${targetHandle} gesagt?", "${targetHandle} meinte gestern…", ` +
    `"ich sollte ${targetHandle} mal fragen ob…", "${targetHandle} könnte das wissen".\n\n` +
    `Sicherheitsregel: Im Zweifel oder bei Unklarheit IMMER CHAT. Nur bei ` +
    `eindeutiger Direkt-Adresse SEND.`;
  const prompt = `Owner-Nachricht: "${userMessage}"\n\nIst das SEND oder CHAT?`;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), MENTION_INTENT_TIMEOUT_MS);
  try {
    const result = await generateObject({
      model: classifierModel,
      schema: MentionIntentSchema,
      system,
      prompt,
      abortSignal: ctrl.signal,
    });
    return result.object;
  } catch (err) {
    const kind =
      err instanceof Error && err.name === "AbortError" ? "timeout" : "error";
    console.warn(
      `[a2a:mention-intent] ${kind} → fail-safe CHAT:`,
      err instanceof Error ? err.message : err,
    );
    return { intent: "CHAT", reason: `fail-safe (${kind})` };
  } finally {
    clearTimeout(timer);
  }
}
