import type { PersonaInput } from "@twin-lab/shared";

// ─── PERSONA-MARKDOWN BUILDER ────────────────────────────────────────────────
//
// Onboarding-Wizard sammelt strukturierten Input. Hier wird daraus ein
// Markdown-Block geformt, der dasselbe Format hat wie die handgeschriebenen
// docs/persona*.md — wird unverändert ins twin_profiles.persona_md gespeichert
// und beim Boot als Persona-System-Prompt geladen. Seit #110 Phase 2B
// Commit 11 wird das `PersonaInput`-Object zusätzlich strukturiert in
// `twin_profiles.persona_input_json` persistiert für späteren Edit-Pre-Fill.
//
// Sektionen-Reihenfolge: Identität → Stil → Themen → Beziehungen (optional).

const TONE_LINES: Record<PersonaInput["tone"][number], string> = {
  direct: "Direkt, auf den Punkt",
  polite: "Höflich",
  casual: "Locker, casual",
  formal: "Formell",
};

const PRONOUN_LINES: Record<PersonaInput["pronoun"], string> = {
  du: "Du-Form",
  sie: "Sie-Form",
  "context-dependent": "Du oder Sie je nach Kontext",
};

const PREFERENCE_LINES: Record<PersonaInput["preferences"][number], string> = {
  "no-emojis": "Keine Emojis",
  "no-platitudes": "Keine Floskeln",
  "short-answers": "Knappe Antworten bevorzugt",
};

export function buildPersonaMarkdown(input: PersonaInput): string {
  const lines: string[] = [];

  lines.push(`# ${input.fullName.trim()}`);
  lines.push("");

  // Identität — Role + ggf. ergänzende Sätze später
  lines.push("## Identität");
  lines.push("");
  lines.push(input.role.trim() + (input.role.trim().endsWith(".") ? "" : "."));
  lines.push("");

  // Stil — kombinierte Bullets aus Tone + Pronoun + Preferences
  lines.push("## Stil");
  lines.push("");
  for (const t of input.tone) lines.push(`- ${TONE_LINES[t]}`);
  lines.push(`- ${PRONOUN_LINES[input.pronoun]}`);
  for (const p of input.preferences) lines.push(`- ${PREFERENCE_LINES[p]}`);
  lines.push("");

  // Themen
  lines.push("## Themen");
  lines.push("");
  for (const topic of input.topics) lines.push(`- ${topic.trim()}`);
  lines.push("");

  // Beziehungen — optional, nur wenn welche da
  if (input.relationships.length > 0) {
    lines.push("## Beziehungen");
    lines.push("");
    for (const r of input.relationships) {
      lines.push(`- ${r.name.trim()} — ${r.description.trim()}`);
    }
    lines.push("");
  }

  // Trim trailing newlines, file endet mit genau einem "\n"
  return lines.join("\n").replace(/\n+$/, "") + "\n";
}
