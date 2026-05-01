import { readFile } from "node:fs/promises";
import { parse as parseYaml } from "yaml";
import type { Persona } from "@twin-lab/shared";

// ─── PERSONA LOADER ──────────────────────────────────────────────────────────
//
// Persona kommt aus zwei Files:
//   - persona.md         → der eigentliche System-Prompt (Stil, Themen, Ton)
//   - persona-meta.yaml  → Name, Handle, Metadaten
//
// Pfade sind nicht mehr hartkodiert; Caller (Boot) übergibt sie aus
// `RuntimeConfig`. Dadurch können mehrere Twin-Instanzen mit eigenen
// Persona-Files laufen.

interface PersonaMeta {
  name: string;
  handle: string;
  metadata?: Record<string, unknown>;
}

export async function loadPersona(opts: {
  promptPath: string;
  metaPath: string;
}): Promise<Persona> {
  const [promptContent, metaContent] = await Promise.all([
    readFile(opts.promptPath, "utf-8"),
    readFile(opts.metaPath, "utf-8"),
  ]);

  const meta = parseYaml(metaContent) as PersonaMeta;

  return {
    name: meta.name,
    handle: meta.handle,
    systemPrompt: promptContent.trim(),
    metadata: meta.metadata ?? {},
  };
}
