import type { Persona } from "@nolmi/shared";
import { buildFocusBlock } from "../focus/prompt-builder.js";
import type { FocusSnapshot } from "../focus/focus-snapshots-repo.js";
import { composeOwnerSystemPrompt } from "../twin-service.js";

// ─── TEST: FOCUS PROMPT-INTEGRATION (Aufmerksamkeit/Fokus Schritt 2) ─────────
//
// Reine Komposition (kein DB, kein LLM): buildFocusBlock-Verhalten +
// Position/Defensiv-Verhalten in composeOwnerSystemPrompt.
//
//   pnpm --filter @nolmi/runtime exec tsx src/scripts/test-focus-prompt.ts

let failures = 0;
function assert(cond: boolean, label: string): void {
  if (cond) console.log(`  ✓ ${label}`);
  else {
    console.error(`  ✗ FAIL: ${label}`);
    failures += 1;
  }
}

const OWNER = "Markus";

function snapshot(focusText: string, themes: string[] = []): FocusSnapshot {
  return {
    id: "focus_1",
    twinId: "twin_x",
    focusText,
    themes,
    basisSummary: "aus 1 Summaries + 2 Turns",
    derivedAt: "2026-06-04T10:00:00.000Z",
    supersededAt: null,
    themeEmbeddingsBlob: null,
  };
}

// Minimaler Persona-Stub (nur die im Helper genutzten Felder).
const persona = {
  name: OWNER,
  handle: "@markus",
  systemPrompt: "PERSONA_PROMPT_MARKER",
} as unknown as Persona;

function main(): void {
  // ── buildFocusBlock: Inhalt + Defensiv ──
  console.log("\n── buildFocusBlock");
  {
    const b = buildFocusBlock(snapshot("Baut das Fokus-Pattern.", ["Fokus", "Migration"]), OWNER);
    assert(b !== null && b.includes("## Aktueller Fokus"), "Header vorhanden");
    assert(!!b && b.includes("Baut das Fokus-Pattern."), "focusText enthalten");
    assert(!!b && b.includes(OWNER), "Owner-Name im Framing");
    assert(!!b && b.includes("Themen: Fokus, Migration"), "Themen-Zeile bei vorhandenen Themen");

    const noThemes = buildFocusBlock(snapshot("Nur Text."), OWNER);
    assert(!!noThemes && !noThemes.includes("Themen:"), "keine Themen-Zeile wenn leer");

    assert(buildFocusBlock(null, OWNER) === null, "null-Snapshot → null");
    assert(buildFocusBlock(snapshot("   "), OWNER) === null, "leerer focusText → null");
  }

  // ── a) composeOwnerSystemPrompt MIT focusBlock: Position nach Persona+Facts ──
  console.log("\n── a) Prompt MIT focusBlock — Position");
  {
    const focusBlock = buildFocusBlock(snapshot("Aktueller Aufbau."), OWNER);
    const system = composeOwnerSystemPrompt({
      persona,
      extraSystem: null,
      factsBlock: "FACTS_MARKER",
      focusBlock,
      skillsBlock: "SKILLS_MARKER",
      toolUseDirective: null,
      summaryBlock: "SUMMARY_MARKER",
      episodicBlock: "EPISODIC_MARKER",
    });
    assert(system.includes("## Aktueller Fokus"), "Fokus-Block im Prompt");
    const iPersona = system.indexOf("PERSONA_PROMPT_MARKER");
    const iFacts = system.indexOf("FACTS_MARKER");
    const iFocus = system.indexOf("## Aktueller Fokus");
    const iSkills = system.indexOf("SKILLS_MARKER");
    const iSummary = system.indexOf("SUMMARY_MARKER");
    const iEpisodic = system.indexOf("EPISODIC_MARKER");
    assert(iFacts < iFocus, "Fokus NACH Facts (Persona+Facts zuerst)");
    assert(iFocus < iSkills, "Fokus VOR Skills");
    assert(iFocus < iSummary && iFocus < iEpisodic, "Fokus VOR summary/episodic (hohe Attention)");
    assert(iPersona < iFocus, "Persona vor Fokus");
  }

  // ── b) KERN: OHNE focusBlock (null) → kein Header, kein Throw ──
  console.log("\n── b) KERN: Prompt OHNE focusBlock — defensiv");
  {
    const system = composeOwnerSystemPrompt({
      persona,
      extraSystem: null,
      factsBlock: "FACTS_MARKER",
      focusBlock: null,
      skillsBlock: "SKILLS_MARKER",
      toolUseDirective: null,
      summaryBlock: "SUMMARY_MARKER",
      episodicBlock: "EPISODIC_MARKER",
    });
    assert(!system.includes("## Aktueller Fokus"), "KEIN Fokus-Header ohne Snapshot");
    assert(system.includes("PERSONA_PROMPT_MARKER") && system.includes("EPISODIC_MARKER"), "übrige Schichten unverändert da");
  }

  console.log(
    failures === 0
      ? "\n✅ ALLE CHECKS GRÜN — Fokus-Block korrekt positioniert, defensiv ohne Snapshot.\n"
      : `\n❌ ${failures} CHECK(S) FEHLGESCHLAGEN.\n`,
  );
  if (failures > 0) process.exit(1);
}

main();
