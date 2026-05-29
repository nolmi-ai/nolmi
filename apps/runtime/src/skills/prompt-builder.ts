import type { Skill } from "@nolmi/shared";

// ─── SKILLS PROMPT BUILDER ──────────────────────────────────────────────────
//
// Strategie B (Phase 3.1.B): aktive Skills mit source='manual' landen permanent
// als System-Prompt-Block. Kein Klassifikator, kein on-demand-Loading. Reicht
// für die ersten ~10-20 Skills pro Twin; bei wachsendem Volumen Wechsel auf C
// (Hybrid Core/On-demand).
//
// MCP-Skills werden NICHT im Skills-Block referenziert — sie kommen über das
// AI-SDK-Tool-Schema (apps/runtime/src/mcp/tool-bridge.ts). Wenn MCP-Tools
// parallel im System-Prompt UND im tools-Parameter wären, missverstünde der
// LLM den Skill-Block-Eintrag als „Wissen über das Tool" und würde den Tool-
// Output simulieren statt das Tool tatsächlich aufzurufen. Phase 3.2.D-Lesson.
//
// Markdown-Header (#, ##) sind absichtlich roh — LLMs verarbeiten das gut, und
// es ist visuell vom Persona-Markdown getrennt. Trenner `---` zwischen Skills.
//
// Wichtig: "ohne sie explizit zu erwähnen oder zu zitieren" — der Twin soll
// Skill-Wissen natürlich nutzen, statt zu sagen "ich habe einen Skill zu X
// geladen". Sonst verwischt die Persona.

export function buildSkillsBlock(skills: Skill[]): string {
  // MCP-Skills filtern — siehe Header-Kommentar.
  const promptableSkills = skills.filter((skill) => skill.source !== "mcp");

  if (promptableSkills.length === 0) return "";

  const sections = promptableSkills.map((skill) => {
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
