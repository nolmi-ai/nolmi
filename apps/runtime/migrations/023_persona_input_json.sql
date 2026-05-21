-- ─── #110 PHASE 2B Commit 11: PERSONA-INPUT-JSON ─────────────────────────────
-- Strukturierte Persona-Form als zweites Speicher-Format neben `persona_md`.
-- `persona_md` bleibt der System-Prompt (das, was als Twin-Persona ins LLM
-- gefüttert wird); `persona_input_json` ist die strukturierte Form, die der
-- Onboarding-Wizard sammelt (PersonaInputSchema aus @twin-lab/shared) und
-- die Settings-Page zur Pre-Fill der Edit-Felder braucht.
--
-- Nullable, weil Legacy-Twins (bootstrap-CLI, vor 2.5.3) das Feld nicht
-- haben. Settings-Layer fällt für NULL-Rows auf einen "Persona via CLI
-- angelegt"-Hint zurück — kein automatischer Markdown-Parser, weil das
-- bei freier Editierung des MD brüchig würde.
--
-- Aufruf im Onboarding-Submit + zukünftige PATCH /twins/:handle/full-config
-- schreiben das Feld parallel zu persona_md, sodass beide Repräsentationen
-- konsistent bleiben.

ALTER TABLE twin_profiles ADD COLUMN persona_input_json TEXT;
