import { generateObject, type LanguageModel } from "ai";
import { z } from "zod";
import type { ForcedToolChoice, Skill } from "@nolmi/shared";

// ─── SKILL PRE-PASS CLASSIFIER (#107) ────────────────────────────────────────
//
// Vor dem eigentlichen `generateText`-Call im Send-Path fragt diese Funktion
// ein kleines Classifier-Modell, ob die User-Message zu einer der
// triggerCondition-Beschreibungen passt. Bei Match erzwingen wir im
// Haupt-LLM-Call den `toolChoice` auf das erste requiresTools-Element des
// Match-Skills — sonst halluziniert Claude Opus 4.7 bei autonomen Tool-Use-
// Entscheidungen (Tag-19-Diagnose).
//
// Conditional: wird im Send-Path nur gerufen wenn (a) mindestens ein aktiver
// Skill mit triggerMode='forced' geladen ist UND (b) der Caller nicht schon
// einen User-Picker-forcedToolChoice durchgereicht hat. User-Picker hat
// Vorrang vor dem Classifier (3.2.H bleibt der härtere Override).
//
// Output-Form: `generateObject` mit Zod-Enum `[...skillNames, 'none']` —
// deterministische Form, kein String-Trim/Lowercase. Pattern reused von
// `ExtractionEngine` (facts/extraction-engine.ts).
//
// Timeout: 3s harter Cutoff via AbortController. Bei Timeout / Error /
// 'none' fällt der Send-Path lautlos auf toolChoice='auto' zurück — der
// User merkt höchstens, dass der Twin nicht recherchiert hat.

const PRE_PASS_TIMEOUT_MS = 3000;

export interface PrePassInput {
  /** Letzte User-Message als Klartext (lastMessage aus runOwnerDirect). */
  userMessage: string;
  /**
   * Aktive Skills des Twins. Pre-Pass filtert intern auf
   * `triggerMode='forced' && triggerCondition && requiresTools[0]`.
   */
  skills: Skill[];
  /**
   * Tool-Set-Keys aus `buildMcpToolsFromSkills` (AI-SDK-Format mit `_`-
   * Separator). Pre-Pass validiert vor dem Return, dass der resolved
   * toolKey im aktuellen Tool-Set existiert — sonst Fallback auf null.
   * Spiegelt die Defense-in-Depth aus runModel (3.2.H).
   */
  availableToolKeys: ReadonlySet<string>;
  /** Vercel-AI-SDK-LanguageModel aus `deps.classifierModel`. */
  classifierModel: LanguageModel;
  /** Twin-ID für strukturiertes Logging. */
  twinId: string;
}

export interface PrePassMatch {
  /** AI-SDK-konformer toolKey (mit `_`-Separator), bereit für toolChoice. */
  forcedToolChoice: ForcedToolChoice;
  /** Skill-Name für Audit-Trail und Logging. */
  skillName: string;
}

/**
 * Filtert die übergebenen Skills auf die Pre-Pass-relevanten Kandidaten.
 * Exportiert, damit der Caller im Send-Path die Condition (`length > 0`)
 * billig vorab prüfen kann, bevor er den Classifier-Call überhaupt
 * vorbereitet (Logging, Prompt-Bau).
 */
export function selectForcedCandidates(skills: Skill[]): Skill[] {
  return skills.filter((skill) => {
    if (!skill.isActive) return false;
    if (skill.manifestJson.triggerMode !== "forced") return false;
    if (!skill.manifestJson.triggerCondition) return false;
    const tool = skill.manifestJson.requiresTools?.[0];
    if (!tool) return false;
    return true;
  });
}

/**
 * Klassifiziert die User-Message gegen die triggerConditions der
 * forced-Skills. Returns `null` bei 'none', Timeout, Error oder wenn der
 * resolved toolKey nicht im aktiven Tool-Set existiert.
 *
 * Caller-Contract: Aufrufer ruft diese Funktion *nur* wenn
 * `selectForcedCandidates(skills).length > 0` UND wenn der Caller selbst
 * keinen `forcedToolChoice` schon gesetzt hat (User-Picker-Priorität).
 */
export async function classifyForcedTool(
  input: PrePassInput,
): Promise<PrePassMatch | null> {
  const candidates = selectForcedCandidates(input.skills);
  if (candidates.length === 0) {
    return null;
  }

  // Zod-Enum braucht mindestens ein Element — 'none' ist sowieso immer
  // dabei, also Tuple-Cast mit 'none' als Pflicht-Erstwert. Skill-Namen
  // kommen als Rest hinten dran (kann auch leer sein, ist aber durch den
  // candidates.length-Check oben ausgeschlossen).
  const skillNames = candidates.map((s) => s.name);
  const enumValues = ["none", ...skillNames] as [string, ...string[]];
  const Schema = z.object({
    skill: z.enum(enumValues),
  });

  const conditionsBlock = candidates
    .map((s) => `- ${s.name}: ${s.manifestJson.triggerCondition}`)
    .join("\n");

  const system =
    "Du klassifizierst eine User-Nachricht gegen eine Liste von Skill-" +
    "Triggern. Antworte mit dem Skill-Namen, der am besten passt, oder " +
    "'none' wenn keiner passt. Keine Erklärung, nur der Name.";
  const prompt = `Skills mit Trigger-Bedingungen:\n${conditionsBlock}\n\nUser-Nachricht: "${input.userMessage}"\n\nWelcher Skill passt?`;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), PRE_PASS_TIMEOUT_MS);

  let pickedSkillName: string;
  try {
    const result = await generateObject({
      model: input.classifierModel,
      schema: Schema,
      system,
      prompt,
      abortSignal: ctrl.signal,
    });
    pickedSkillName = result.object.skill;
  } catch (err) {
    const reason =
      err instanceof Error && err.name === "AbortError" ? "timeout" : "error";
    console.warn(
      `[skill:pre-pass] ${reason}, continuing without forced tool (twin=${input.twinId}):`,
      err instanceof Error ? err.message : err,
    );
    return null;
  } finally {
    clearTimeout(timer);
  }

  if (pickedSkillName === "none") {
    console.log(`[skill:pre-pass] no match (twin=${input.twinId})`);
    return null;
  }

  const matched = candidates.find((s) => s.name === pickedSkillName);
  if (!matched) {
    // Sollte durch Zod-Enum unmöglich sein, aber Defense-in-Depth.
    console.warn(
      `[skill:pre-pass] classifier returned unknown skill='${pickedSkillName}' (twin=${input.twinId})`,
    );
    return null;
  }

  // requiresTools[0] ist im Skill-Namen-Format (z.B. 'mcp:server:tool').
  // tool-bridge baut den AI-SDK-toolKey via `.replaceAll(":", "_")` (siehe
  // mcp/tool-bridge.ts:98). Wir spiegeln die Transformation, damit der
  // toolChoice exakt das Tool aus dem aktiven mcpTools-Set trifft.
  // selectForcedCandidates filtert leere Arrays raus, aber TypeScript
  // erkennt das über die Funktionsgrenze nicht — defensiver Check.
  const skillNameForTool = matched.manifestJson.requiresTools?.[0];
  if (!skillNameForTool) {
    return null;
  }
  const toolKey = skillNameForTool.replaceAll(":", "_");

  if (!input.availableToolKeys.has(toolKey)) {
    console.warn(
      `[skill:pre-pass] matched skill='${matched.name}' but tool='${toolKey}' ` +
        `not in active tool-set — fallback to auto (twin=${input.twinId})`,
    );
    return null;
  }

  console.log(
    `[skill:pre-pass] matched skill=${matched.name} tool=${toolKey} (twin=${input.twinId})`,
  );
  return {
    forcedToolChoice: { type: "tool", toolName: toolKey },
    skillName: matched.name,
  };
}
