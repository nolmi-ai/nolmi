import OpenAI from "openai";
import type { ModelProvider, ProviderCompleteInput, ProviderCompleteOutput } from "./types.js";

export class OpenAIProvider implements ModelProvider {
  readonly name = "openai";
  private client: OpenAI;
  private defaultModel: string;

  constructor(opts: { apiKey: string; defaultModel: string }) {
    this.client = new OpenAI({ apiKey: opts.apiKey });
    this.defaultModel = opts.defaultModel;
  }

  async complete(input: ProviderCompleteInput): Promise<ProviderCompleteOutput> {
    const model = input.model ?? this.defaultModel;
    const response = await this.client.chat.completions.create({
        model,
        messages: input.messages,
        // GPT-5-Familie unterstützt nur temperature=1.
        // Wir lassen den Parameter weg, wenn nichts explizit gesetzt ist —
        // dann nimmt OpenAI den Modell-Default.
        ...(input.temperature !== undefined ? { temperature: input.temperature } : {}),
});

    const choice = response.choices[0];
    if (!choice?.message?.content) {
      throw new Error("OpenAI returned no content");
    }

    return {
      content: choice.message.content,
      metadata: {
        model: response.model,
        usage: response.usage,
        finishReason: choice.finish_reason,
      },
    };
  }
}
