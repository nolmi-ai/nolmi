# Production-Skill-Templates

Skills in diesem Verzeichnis sind die **offiziell ausgelieferten** Twin-Capabilities. Self-Hosting-User können sie nach `pnpm db:init` per CLI in ihren Twin importieren:

```bash
pnpm --filter @twin-lab/runtime twin:skill-create @<handle> examples/skills/<name>
```

Jeder Skill ist ein Unterverzeichnis mit:

- `manifest.yaml` (Pflicht) — Skill-Manifest, validiert gegen `SkillManifestSchema` aus `@twin-lab/shared`
- `SKILL.md` (Pflicht) — Instruktionen für das LLM (landet 1:1 im System-Prompt)
- `script.ts` (optional) — Code für Action-Skills (Storage-only, Execution-Wiring kommt später)

## Verfügbare Skills

- `recherche-workflow/` — Web-Recherche via `search_with_bing` + `scrape_webpage` (Hyperbrowser-MCP). Beta — Latenz 30-90s, Single-Step. Setzt `trigger_mode: forced` + Pre-Pass-Classifier (#107).

## Abgrenzung zu `apps/runtime/skills-templates/`

`apps/runtime/skills-templates/` ist gitignored (per Whitelist-`.gitignore`) und dient ausschließlich lokalen Experiments. Skills, die offiziell mit dem Repo ausgeliefert werden, leben hier in `examples/skills/`.
