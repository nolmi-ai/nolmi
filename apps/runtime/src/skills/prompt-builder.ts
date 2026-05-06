import type { Skill } from "@twin-lab/shared";

// ─── SKILLS PROMPT BUILDER ──────────────────────────────────────────────────
//
// Strategie B (Phase 3.1.B): alle aktiven Skills landen permanent als ein
// System-Prompt-Block. Kein Klassifikator, kein on-demand-Loading. Reicht für
// die ersten ~10-20 Skills pro Twin; bei wachsendem Volumen Wechsel auf C
// (Hybrid Core/On-demand) — dazu logged TwinService die Block-Größe in
// Zeichen, damit der Schwellwert sichtbar wird.
//
// Markdown-Header (#, ##) sind absichtlich roh — LLMs verarbeiten das gut, und
// es ist visuell vom Persona-Markdown getrennt. Trenner `---` zwischen Skills
// für Lesbarkeit (sowohl für den Twin als auch für menschliche Reviews der
// Prompt-Struktur).
//
// Wichtig: "ohne sie explizit zu erwähnen oder zu zitieren" — der Twin soll
// Skill-Wissen natürlich nutzen, statt zu sagen "ich habe einen Skill zu X
// geladen". Sonst verwischt die Persona.

export function buildSkillsBlock(skills: Skill[]): string {
  if (skills.length === 0) return "";

  const sections = skills.map((skill) => {
    return `## ${skill.name}\n\n${skill.description}\n\n${skill.instructionsMd}`;
  });

  return [
    "# Verfügbare Skills",
    "",
    "Du hast Zugriff auf folgende Skills, die deine Persona erweitern. Nutze sie, wo passend, ohne sie explizit zu erwähnen oder zu zitieren:",
    "",
    sections.join("\n\n---\n\n"),
  ].join("\n");
}
