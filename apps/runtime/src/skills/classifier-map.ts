import type { LlmProvider, TwinLlmConfig } from "../llm-config.js";

// ─── PRE-PASS CLASSIFIER MODEL MAP (#107) ────────────────────────────────────
//
// Wenn ein Twin mindestens einen aktiven Skill mit triggerMode='forced' hat,
// macht der Send-Path vor `generateText` einen kleinen Classifier-Call: gegen
// die User-Message + alle triggerConditions wird via generateObject ein
// einzelner Skill-Name (oder 'none') zurückgegeben. Bei Match erzwingen wir
// im Haupt-LLM-Call den `toolChoice` auf das erste requiresTools-Element.
//
// Diese Map definiert das Classifier-Modell pro Provider. Wir nehmen die
// kleinsten/günstigsten Stufen jedes Anbieters — der Call ist ein einzelner
// Boolean-artiger Output ohne Tool-Use; die Twin-Persona oder das große
// Modell sind hier nicht nötig. Provider-Reuse hält den API-Key-Pfad gleich
// (selber Schlüssel, anderes Modell — kein zweiter Auth-Pfad).
//
// `TWIN_DEFAULT` ist ein Sentinel für lokale Ollama-Setups: hier gibt es
// kein universelles "kleines Modell", also fällt der Classifier auf das
// Twin-eigene Modell zurück. Cloud-Provider haben fixierte Classifier-Modelle.

type ClassifierMapEntry = {
  model: string | "TWIN_DEFAULT";
};

const PROVIDER_CLASSIFIER_MAP: Record<LlmProvider, ClassifierMapEntry> = {
  anthropic: { model: "claude-haiku-4-5-20251001" },
  openai: { model: "gpt-4o-mini" },
  google: { model: "gemini-3-flash" },
  groq: { model: "llama-3.3-70b-versatile" },
  ollama: { model: "TWIN_DEFAULT" },
};

/**
 * Liefert eine vollständige `TwinLlmConfig` für den Classifier-Call eines
 * Twins. Provider, API-Key und Base-URL kommen aus der Twin-Config (selber
 * Auth-Pfad); nur das `model` wird per Map ersetzt. Bei 'TWIN_DEFAULT'
 * (heute nur Ollama) fällt der Classifier auf das Twin-Modell zurück —
 * der Boot-Pfad konstruiert dann effektiv einen zweiten LanguageModel mit
 * identischer Config.
 *
 * Wird beim Boot in `twin-service-registry.ts` einmal pro Twin aufgerufen
 * und als `deps.classifierModel` ins TwinService gereicht. Kein on-the-fly-
 * Resolve im Send-Path (Layer-Trennung — Send-Layer sieht keinen API-Key).
 */
export function resolveClassifierConfig(
  twinConfig: TwinLlmConfig,
): TwinLlmConfig {
  const entry = PROVIDER_CLASSIFIER_MAP[twinConfig.provider];
  const model =
    entry.model === "TWIN_DEFAULT" ? twinConfig.model : entry.model;
  return {
    provider: twinConfig.provider,
    model,
    apiKey: twinConfig.apiKey,
    baseUrl: twinConfig.baseUrl,
  };
}
