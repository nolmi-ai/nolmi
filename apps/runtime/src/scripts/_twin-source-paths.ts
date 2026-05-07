import { resolve } from "node:path";
import { WORKSPACE_ROOT, type RuntimeConfig } from "../config.js";

// ─── TWIN SOURCE-PATHS ──────────────────────────────────────────────────────
//
// Konvention pro Twin-Name `<n>` (Handle ohne `@`-Prefix):
//   - Persona-MD:   n='markus' → docs/persona.md
//                   sonst       → docs/persona-<n>.md
//   - Persona-Meta: n='markus' → docs/persona-meta.yaml
//                   sonst       → docs/persona-<n>-meta.yaml
//   - Mandates:     immer global docs/mandates.yaml (gleiche Datei für alle
//                   Twins seit Phase 2.5; per-Twin-Mandates kommen später)
//
// Markus-Sonderfall ist historisch: Phase 1 hatte nur einen Twin, die Files
// hießen `persona.md` / `persona-meta.yaml`. Multi-Twin (Phase 2.5d) hängt
// einen `-<name>`-Suffix an, ohne den ersten Twin umzubenennen. Wenn der
// Markus-Default-Twin irgendwann mit `--no-default`-Bootstrap angelegt wird,
// kann der Sonderfall raus.
//
// `personaPath`/`personaMetaPath` aus `RuntimeConfig` sind die Markus-Default-
// Pfade (per ENV überschreibbar); für andere Twins werden die Pfade aus
// `WORKSPACE_ROOT/docs/...` zusammengesetzt.

export interface TwinSourcePaths {
  personaMd: string;
  personaMeta: string;
  mandates: string;
}

export function resolveTwinSourcePaths(
  twinName: string,
  config: RuntimeConfig,
): TwinSourcePaths {
  const docsDir = resolve(WORKSPACE_ROOT, "docs");
  const isMarkus = twinName === "markus";
  return {
    personaMd: isMarkus
      ? config.personaPath
      : resolve(docsDir, `persona-${twinName}.md`),
    personaMeta: isMarkus
      ? config.personaMetaPath
      : resolve(docsDir, `persona-${twinName}-meta.yaml`),
    mandates: config.mandatesPath,
  };
}
