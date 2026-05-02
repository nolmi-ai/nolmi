import { generateText } from "ai";
import { createLlmClient } from "../llm-client.js";
import type { LlmProvider } from "../llm-config.js";

// ─── API-KEY VALIDATOR ───────────────────────────────────────────────────────
//
// Macht einen 1-Token-Test-Call gegen den Provider. Schnell, billig,
// Provider-typisch unter $0.001. Wirft kein, returned strukturiertes Result.
//
// Timeout: 10 Sekunden. Wenn der Provider länger braucht, melden wir
// "nicht erreichbar" — User soll dann später nochmal probieren.

export type ValidateResult =
  | { valid: true }
  | { valid: false; reason: string };

const TIMEOUT_MS = 10_000;

export async function validateApiKey(
  provider: LlmProvider,
  apiKey: string,
  model: string,
): Promise<ValidateResult> {
  // Defensive trim — Copy-Paste fängt sich gerne ein \n oder Leerzeichen ein,
  // und Anthropic gibt dann "invalid x-api-key" zurück, obwohl der Key
  // grundsätzlich richtig ist.
  const trimmedKey = apiKey.trim();
  if (!trimmedKey) {
    return { valid: false, reason: "API-Key ist leer" };
  }

  const llm = createLlmClient({ provider, model, apiKey: trimmedKey });

  // AbortController für Timeout — generateText hört auf das Signal.
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);

  try {
    await generateText({
      model: llm,
      prompt: "ping",
      maxOutputTokens: 1,
      abortSignal: ctrl.signal,
    });
    return { valid: true };
  } catch (err) {
    return classifyError(err);
  } finally {
    clearTimeout(timer);
  }
}

function classifyError(err: unknown): ValidateResult {
  const msg = err instanceof Error ? err.message : String(err);
  const lower = msg.toLowerCase();

  // Diagnose-Log: in der Server-Konsole sehen wir IMMER den Original-Error,
  // unabhängig davon, in welche Branch wir gleich klassifizieren. Hilft beim
  // Tunen der Wortlaut-Patterns. Wenn der Validator stabil läuft, kann das
  // wieder raus.
  console.error("[validateApiKey] Provider-Error:", msg, err);

  // Auth-Failures: alle Provider geben 401/403, oft mit Wortlaut-Variationen.
  //   OpenAI:    "Incorrect API key provided" / "invalid_api_key"
  //   Anthropic: "invalid x-api-key" / "x-api-key" / "authentication_error"
  //   Google:    "API key not valid"
  //   Groq:      "invalid api key"
  // Großzügig matchen — falsch-positiv ist hier weniger schlimm als
  // falsch-negativ ("Provider nicht erreichbar" wenn der Key einfach falsch ist).
  if (
    lower.includes("401") ||
    lower.includes("403") ||
    lower.includes("unauthor") ||
    lower.includes("invalid api key") ||
    lower.includes("invalid_api_key") ||
    lower.includes("incorrect api key") ||
    lower.includes("invalid x-api-key") ||
    lower.includes("x-api-key") ||
    lower.includes("api key not valid") ||
    lower.includes("authentication")
  ) {
    return { valid: false, reason: "Key ungültig oder abgelaufen" };
  }

  // Abort = Timeout
  if (lower.includes("abort") || lower.includes("timeout")) {
    return {
      valid: false,
      reason: "Provider hat nicht in 10s geantwortet — versuche es später",
    };
  }

  // Sonst: Network/Provider-Down. Original-Error ist schon oben geloggt;
  // hier reichen wir ihn auch nochmal an den Caller, damit die UI etwas
  // Aussagekräftiges zeigen kann.
  return {
    valid: false,
    reason: `Provider nicht erreichbar — ${msg}`,
  };
}
