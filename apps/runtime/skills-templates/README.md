# Skill-Templates

Lokales Verzeichnis für Skill-Definitionen, die via `twin:skill-create` in die DB importiert werden.

## Format pro Skill

Jeder Skill ist ein Unterverzeichnis mit:

- `manifest.yaml` (Pflicht): Skill-Manifest, validiert gegen `SkillManifestSchema`
- `SKILL.md` (Pflicht): Instruktionen für das LLM (landet 1:1 im System-Prompt)
- `script.ts` (optional): Code für Action-Skills (Storage-only, Execution kommt mit 3.2)

## Import

```bash
pnpm --filter @twin-lab/runtime twin:skill-create @<handle> <skill-dir>
pnpm --filter @twin-lab/runtime twin:skill-create @<handle> <skill-dir> --force
```

`--force` überschreibt einen existierenden Skill (gleicher `name` für gleichen Twin).

## Was hier nicht versioniert ist

Dieses Verzeichnis ist gitignored — Skills sind User-Daten, gehören nicht ins Repo. Ausnahme: `_test-skill/` ist whitelisted, damit das Repo ein Beispiel für das Tool-Pattern enthält. Public-Skills, die mit dem Repo geteilt werden sollen, kommen später in `apps/runtime/skills-public/`.
