// ─── token-cost (#99) ────────────────────────────────────────────────────────
//
// Schätzt Token-Kosten pro LLM-Call für Audit-Render-Templates. Liest beide
// Token-Schema-Varianten, die in `audit.output.providerMetadata.usage`
// auftauchen:
//
//   Anthropic AI-SDK:  { inputTokens, outputTokens, totalTokens }
//   OpenAI raw:        { prompt_tokens, completion_tokens, total_tokens }
//
// Pricing-Tabelle nutzt Claude Opus 4.7 als Default — kalibrierbar später,
// wenn pro Twin/Audit das tatsächliche Modell zuverlässig erkennbar ist.
// Anti-Goal: keine Model-Lookup-Logik aus Persona-Config. OpenAI-Audits
// bekommen damit eine "ungefähre" Cost-Schätzung (Pricing-Differenz Opus vs
// GPT-5.5 nicht reflektiert), aber Token-Counts bleiben korrekt sichtbar.

const PRICING_PER_MILLION_TOKENS_USD = {
  "claude-opus-4-7": { input: 15.0, output: 75.0 },
} as const;

const USD_TO_EUR = 0.92;
const DEFAULT_MODEL: keyof typeof PRICING_PER_MILLION_TOKENS_USD = "claude-opus-4-7";

export interface FormattedTokenCost {
  /** z.B. "~17,0k Tokens" oder "~350 Tokens". */
  tokenLabel: string;
  /** z.B. "~0,28 €" oder "<0,01 €". */
  costLabel: string;
  /** "tokenLabel · costLabel". */
  combined: string;
}

/**
 * Liest die Token-Counts aus einer providerMetadata.usage-Struktur.
 * Returns null wenn weder Anthropic- noch OpenAI-Schema matched oder
 * beide Counts 0 sind.
 */
function readUsage(
  usage: unknown,
): { inputTokens: number; outputTokens: number; totalTokens: number } | null {
  if (!usage || typeof usage !== "object") return null;
  const u = usage as Record<string, unknown>;

  // Anthropic AI-SDK
  if (typeof u.inputTokens === "number" && typeof u.outputTokens === "number") {
    const inputTokens = u.inputTokens;
    const outputTokens = u.outputTokens;
    const totalTokens =
      typeof u.totalTokens === "number" ? u.totalTokens : inputTokens + outputTokens;
    if (totalTokens === 0) return null;
    return { inputTokens, outputTokens, totalTokens };
  }

  // OpenAI raw
  if (
    typeof u.prompt_tokens === "number" &&
    typeof u.completion_tokens === "number"
  ) {
    const inputTokens = u.prompt_tokens;
    const outputTokens = u.completion_tokens;
    const totalTokens =
      typeof u.total_tokens === "number" ? u.total_tokens : inputTokens + outputTokens;
    if (totalTokens === 0) return null;
    return { inputTokens, outputTokens, totalTokens };
  }

  return null;
}

export function formatTokenCost(
  usage: unknown,
  model: string = DEFAULT_MODEL,
): FormattedTokenCost | null {
  const read = readUsage(usage);
  if (!read) return null;

  const pricing =
    PRICING_PER_MILLION_TOKENS_USD[
      model as keyof typeof PRICING_PER_MILLION_TOKENS_USD
    ] ?? PRICING_PER_MILLION_TOKENS_USD[DEFAULT_MODEL];

  const costUsd =
    (read.inputTokens / 1_000_000) * pricing.input +
    (read.outputTokens / 1_000_000) * pricing.output;
  const costEur = costUsd * USD_TO_EUR;

  // Tokens-Format: ab 1000 in "k", sonst raw.
  const tokenLabel =
    read.totalTokens >= 1000
      ? `~${(read.totalTokens / 1000).toLocaleString("de-DE", {
          maximumFractionDigits: 1,
        })}k Tokens`
      : `~${read.totalTokens} Tokens`;

  const costLabel =
    costEur < 0.01
      ? "<0,01 €"
      : `~${costEur.toLocaleString("de-DE", {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        })} €`;

  return {
    tokenLabel,
    costLabel,
    combined: `${tokenLabel} · ${costLabel}`,
  };
}
