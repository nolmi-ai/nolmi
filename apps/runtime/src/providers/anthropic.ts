import Anthropic from "@anthropic-ai/sdk";
import type { ModelProvider, ProviderCompleteInput, ProviderCompleteOutput } from "./types.js";

export class AnthropicProvider implements ModelProvider {
  readonly name = "anthropic";
  private client: Anthropic;
  private defaultModel: string;

  constructor(opts: { apiKey: string; defaultModel: string }) {
    this.client = new Anthropic({ apiKey: opts.apiKey });
    this.defaultModel = opts.defaultModel;
  }

  async complete(input: ProviderCompleteInput): Promise<ProviderCompleteOutput> {
    const model = input.model ?? this.defaultModel;

    // Anthropic trennt system-message und messages — wir splitten.
    const systemMessages = input.messages.filter((m) => m.role === "system");
    const otherMessages = input.messages.filter((m) => m.role !== "system");
    const system = systemMessages.map((m) => m.content).join("\n\n");

    const response = await this.client.messages.create({
      model,
      max_tokens: 4096,
      system: system || undefined,
      messages: otherMessages.map((m) => ({
        role: m.role as "user" | "assistant",
        content: m.content,
      })),
      temperature: input.temperature ?? 0.7,
    });

    const textBlock = response.content.find((b) => b.type === "text");
    if (!textBlock || textBlock.type !== "text") {
      throw new Error("Anthropic returned no text content");
    }

    return {
      content: textBlock.text,
      metadata: {
        model: response.model,
        usage: response.usage,
        stopReason: response.stop_reason,
      },
    };
  }
}
