import type { ModelProvider } from "./types.js";
import { OpenAIProvider } from "./openai.js";
import { AnthropicProvider } from "./anthropic.js";

export function createProvider(): ModelProvider {
  const active = process.env.ACTIVE_PROVIDER ?? "openai";

  switch (active) {
    case "openai": {
      const apiKey = process.env.OPENAI_API_KEY;
      if (!apiKey) throw new Error("OPENAI_API_KEY is not set");
      return new OpenAIProvider({
        apiKey,
        defaultModel: process.env.OPENAI_MODEL ?? "gpt-5.5",
      });
    }
    case "anthropic": {
      const apiKey = process.env.ANTHROPIC_API_KEY;
      if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set");
      return new AnthropicProvider({
        apiKey,
        defaultModel: process.env.ANTHROPIC_MODEL ?? "claude-opus-4-7",
      });
    }
    default:
      throw new Error(`Unknown provider: ${active}`);
  }
}

export type { ModelProvider, ProviderCompleteInput, ProviderCompleteOutput } from "./types.js";
