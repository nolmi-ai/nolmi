import type { EmbedOptions, EmbeddingProvider } from "./types.js";

// ─── VOYAGE EMBEDDING PROVIDER (3.4.B) ──────────────────────────────────────
//
// Voyage AI ist Anthropic-nahe, RAG-optimiert. Default-Modell `voyage-3`
// (1024 dim, multilingual). Voyage hat das Query/Passage-Pattern nicht als
// Text-Prefix wie E5, sondern als API-Parameter `input_type`:
//   - "query"     → für Such-Anfragen
//   - "document"  → für gespeicherte Inhalte (Voyage nennt das nicht "passage")
//   - weglassen   → "generischer" Modus
// Wir mappen unser einheitliches `inputType: 'query' | 'passage'` auf
// `query` resp. `document`.
//
// Response-Format ist OpenAI-kompatibel (`data: [{ embedding, index }]`),
// inkl. nicht garantierter Reihenfolge.

const DEFAULT_MODEL_ID = "voyage-3";
const DEFAULT_DIMENSIONS = 1024;
const API_URL = "https://api.voyageai.com/v1/embeddings";

export interface VoyageProviderConfig {
  apiKey: string;
  modelId?: string;
  dimensions?: number;
}

interface VoyageEmbeddingResponse {
  data: Array<{
    embedding: number[];
    index: number;
  }>;
}

export class VoyageEmbeddingProvider implements EmbeddingProvider {
  readonly modelName: string;
  readonly dimensions: number;
  private readonly apiKey: string;
  private readonly modelId: string;

  constructor(config: VoyageProviderConfig) {
    if (!config.apiKey || config.apiKey.trim() === "") {
      throw new Error("VoyageEmbeddingProvider: apiKey ist Pflicht");
    }
    this.apiKey = config.apiKey;
    this.modelId = config.modelId ?? DEFAULT_MODEL_ID;
    this.dimensions = config.dimensions ?? DEFAULT_DIMENSIONS;
    this.modelName = `voyage-${this.modelId}`;
  }

  async embed(
    texts: string | string[],
    options: EmbedOptions,
  ): Promise<Float32Array[]> {
    const arr = Array.isArray(texts) ? texts : [texts];
    if (arr.length === 0) return [];

    const voyageInputType =
      options.inputType === "query" ? "query" : "document";

    const response = await fetch(API_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        input: arr,
        model: this.modelId,
        input_type: voyageInputType,
      }),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(
        `Voyage embedding failed: ${response.status} ${response.statusText}${
          text ? ` — ${text.slice(0, 500)}` : ""
        }`,
      );
    }

    const json = (await response.json()) as VoyageEmbeddingResponse;
    if (!Array.isArray(json.data) || json.data.length !== arr.length) {
      throw new Error(
        `Voyage embedding: erwartet ${arr.length} Embeddings, got ${json.data?.length}`,
      );
    }

    const sorted = [...json.data].sort((a, b) => a.index - b.index);
    return sorted.map((d) => new Float32Array(d.embedding));
  }

  async isReady(): Promise<boolean> {
    return true;
  }
}
