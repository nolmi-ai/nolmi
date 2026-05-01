// ─── LLM CONFIG ──────────────────────────────────────────────────────────────
//
// Pro Twin-Instanz wählbarer Provider/Model. Der Default in Phase 2.5 ist
// OpenAI gpt-5.5 — das hält den Markus-Twin ohne ENV-Änderung am Laufen.
//
// Backward-Compat: existierende OPENAI_API_KEY / ANTHROPIC_API_KEY /
// OPENAI_MODEL / ANTHROPIC_MODEL werden als Fallback gelesen, solange
// TWIN_LLM_API_KEY / TWIN_LLM_MODEL nicht gesetzt sind. Wenn die alten
// Variablen später deprecated werden, fliegt der Fallback raus.

export const LLM_PROVIDERS = [
  "openai",
  "anthropic",
  "google",
  "groq",
  "ollama",
] as const;

export type LlmProvider = (typeof LLM_PROVIDERS)[number];

export interface TwinLlmConfig {
  provider: LlmProvider;
  model: string;
  apiKey?: string; // bei lokalem Ollama undefined; bei Cloud-Providern Pflicht
  baseUrl?: string; // bei Ollama der API-Endpoint; bei anderen optional
}

export function loadTwinLlmConfig(): TwinLlmConfig {
  const provider = parseProvider(process.env.TWIN_LLM_PROVIDER);
  const model = process.env.TWIN_LLM_MODEL?.trim() || defaultModelFor(provider);
  const apiKey = pickApiKey(provider);
  const baseUrl = process.env.TWIN_LLM_BASE_URL?.trim() || undefined;
  return { provider, model, apiKey, baseUrl };
}

/**
 * Kompaktes Label für Boot-Logs und Audit-Metadata. Format:
 *   "openai/gpt-5.5"
 *   "ollama/llama3.3 @ http://localhost:11434/api"
 */
export function formatLlmLabel(config: TwinLlmConfig): string {
  const head = `${config.provider}/${config.model}`;
  return config.baseUrl ? `${head} @ ${config.baseUrl}` : head;
}

// ─── interne Helpers ─────────────────────────────────────────────────────────

function parseProvider(raw: string | undefined): LlmProvider {
  const value = raw?.trim().toLowerCase();
  if (!value) return "openai";
  if ((LLM_PROVIDERS as readonly string[]).includes(value)) {
    return value as LlmProvider;
  }
  throw new Error(
    `TWIN_LLM_PROVIDER unbekannt: "${raw}". Erlaubt: ${LLM_PROVIDERS.join(", ")}`,
  );
}

function pickApiKey(provider: LlmProvider): string | undefined {
  const explicit = process.env.TWIN_LLM_API_KEY?.trim();
  if (explicit) return explicit;
  // Backward-Compat — provider-spezifische Legacy-Vars
  if (provider === "openai") return process.env.OPENAI_API_KEY?.trim() || undefined;
  if (provider === "anthropic") return process.env.ANTHROPIC_API_KEY?.trim() || undefined;
  return undefined;
}

function defaultModelFor(provider: LlmProvider): string {
  switch (provider) {
    case "openai":
      return process.env.OPENAI_MODEL?.trim() || "gpt-5.5";
    case "anthropic":
      return process.env.ANTHROPIC_MODEL?.trim() || "claude-opus-4-7";
    case "google":
      return "gemini-2.5-pro";
    case "groq":
      return "llama-3.3-70b-versatile";
    case "ollama":
      return "llama3.3";
  }
}
