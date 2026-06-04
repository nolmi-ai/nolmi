import type { FocusSnapshot } from "./focus-snapshots-repo.js";

// ─── FOCUS PROMPT-BLOCK (Aufmerksamkeit/Fokus Stufe 1 — Schritt 2) ──────────
//
// Macht den gespeicherten „aktuellen Fokus" (jüngster focus_snapshot)
// prompt-wirksam. Wird vom TwinService im Owner-Send-Pfad an
// `composeOwnerSystemPrompt` durchgereicht — analog zu buildEpisodicBlock,
// aber NUR im Owner-Pfad (A2A-/Fremd-Prompts bekommen den Fokus nicht: woran
// Markus gerade arbeitet, ist Owner-Kontext, kein Wissen für fremde Twins).
//
// Position im Prompt: direkt nach Persona+Facts (hohe Attention) — der aktuelle
// Fokus ist konstitutiver Gegenwarts-Kontext, kein „passt vielleicht"-Memory.
//
// 🔴 DEFENSIV: kein Snapshot / leerer focusText → null. Der Caller filtert das
// via `.filter(Boolean)` raus — KEIN leerer „## Aktueller Fokus"-Header im
// Prompt (exakt wie buildEpisodicBlock bei leerem Input).
//
// Anti-Halluzinations-Tenor (leicht, wie beim Episodic-Block): als Kontext
// nutzen, nicht erzwingen — der Fokus ist eine Ableitung, kein Faktum.

export function buildFocusBlock(
  snapshot: FocusSnapshot | null,
  ownerName: string,
): string | null {
  if (!snapshot) return null;
  const focusText = snapshot.focusText.trim();
  if (focusText === "") return null;

  const lines: string[] = [
    "## Aktueller Fokus",
    "",
    `Woran ${ownerName} gerade arbeitet (aus jüngsten Gesprächen abgeleitet — als Kontext nutzen, nicht erzwingen):`,
    "",
    focusText,
  ];

  const themes = snapshot.themes.filter((t) => t.trim() !== "");
  if (themes.length > 0) {
    lines.push("", `Themen: ${themes.join(", ")}`);
  }

  return lines.join("\n").trimEnd();
}
