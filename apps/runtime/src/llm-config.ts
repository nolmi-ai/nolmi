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

/**
 * Storage-Form des LLM-Configs in `twin_profiles.llm_config`. Unterscheidet
 * sich von `TwinLlmConfig` an einer Stelle: statt Klartext-`apiKey` steht hier
 * `apiKeyEncrypted` (Format aus crypto-utils: iv:tag:ct base64). Decrypt
 * passiert im Boot-Pfad über `decryptLlmConfig`.
 */
export type ApiKeySource = "user" | "system";

export interface StoredLlmConfig {
  provider: LlmProvider;
  model: string;
  apiKeyEncrypted?: string;
  apiKeySource: ApiKeySource;
  baseUrl?: string;
}

/**
 * Liest LlmConfig aus ENV. Wenn `twinName` gesetzt: per-Twin Override über
 * `<NAME>_LLM_PROVIDER`/`_MODEL`/`_API_KEY`/`_BASE_URL`, mit Fallback auf
 * die globalen `TWIN_LLM_*`-Variablen. Wird vom Bootstrap genutzt — der
 * Runtime-Boot liest stattdessen aus `twin_profiles.llm_config`.
 */
export function loadTwinLlmConfig(twinName?: string): TwinLlmConfig {
  const provider = parseProvider(envWithTwinFallback("LLM_PROVIDER", twinName));
  const model =
    envWithTwinFallback("LLM_MODEL", twinName) || defaultModelFor(provider);
  const apiKey = pickApiKey(provider, twinName);
  const baseUrl = envWithTwinFallback("LLM_BASE_URL", twinName) || undefined;
  return { provider, model, apiKey, baseUrl };
}

function envWithTwinFallback(suffix: string, twinName?: string): string | undefined {
  if (twinName) {
    const explicit = process.env[`${twinName.toUpperCase()}_${suffix}`]?.trim();
    if (explicit) return explicit;
  }
  return process.env[`TWIN_${suffix}`]?.trim() || undefined;
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

function pickApiKey(provider: LlmProvider, twinName?: string): string | undefined {
  // Per-Twin Override hat Priorität, dann TWIN_LLM_API_KEY, dann
  // provider-spezifische Legacy-Vars (Backward-Compat).
  const explicit = envWithTwinFallback("LLM_API_KEY", twinName);
  if (explicit) return explicit;
  if (provider === "openai") return process.env.OPENAI_API_KEY?.trim() || undefined;
  if (provider === "anthropic") return process.env.ANTHROPIC_API_KEY?.trim() || undefined;
  return undefined;
}

export function defaultModelFor(provider: LlmProvider): string {
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
