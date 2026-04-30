import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import type { Persona } from "@twin-lab/shared";

// ─── PERSONA LOADER ──────────────────────────────────────────────────────────
//
// Phase 1: Persona kommt aus zwei Files in /docs:
//   - persona.md      → der eigentliche System-Prompt (Stil, Themen, Ton)
//   - persona-meta.yaml → Name, Handle, Metadaten
//
// Beide werden beim Start eingelesen und ins persona-Repository geschrieben.

interface PersonaMeta {
  name: string;
  handle: string;
  metadata?: Record<string, unknown>;
}

export async function loadPersonaFromDocs(docsDir: string): Promise<Persona> {
  const promptPath = resolve(docsDir, "persona.md");
  const metaPath = resolve(docsDir, "persona-meta.yaml");

  const [promptContent, metaContent] = await Promise.all([
    readFile(promptPath, "utf-8"),
    readFile(metaPath, "utf-8"),
  ]);

  const meta = parseYaml(metaContent) as PersonaMeta;

  return {
    name: meta.name,
    handle: meta.handle,
    systemPrompt: promptContent.trim(),
    metadata: meta.metadata ?? {},
  };
}
