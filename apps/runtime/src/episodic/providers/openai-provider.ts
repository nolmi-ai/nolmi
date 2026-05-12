import type { EmbedOptions, EmbeddingProvider } from "./types.js";

// ─── OPENAI EMBEDDING PROVIDER (3.4.B) ──────────────────────────────────────
//
// Direkter HTTP-Call gegen die OpenAI-Embeddings-API. Keine SDK-Dependency
// notwendig — `fetch` reicht für das simple Request/Response-Muster.
//
// OpenAI ignoriert query/passage-Unterschiede; das Modell wurde so trainiert,
// dass die Bidirektionalität implizit ist. Wir nehmen `inputType` im
// Interface trotzdem entgegen (kein Wegoptimieren — Provider müssen austausch-
// bar bleiben), aber verwenden es hier nicht.
//
// Response: `data: [{ embedding: number[], index: number }, ...]`. OpenAI
// garantiert die Reihenfolge nicht; wir sortieren defensiv nach `index`
// bevor wir das Array zusammenstellen.

const DEFAULT_MODEL_ID = "text-embedding-3-small";
const DEFAULT_DIMENSIONS = 1536;
const API_URL = "https://api.openai.com/v1/embeddings";

export interface OpenAIProviderConfig {
  apiKey: string;
  modelId?: string;
  dimensions?: number;
}

interface OpenAIEmbeddingResponse {
  data: Array<{
    embedding: number[];
    index: number;
  }>;
}

export class OpenAIEmbeddingProvider implements EmbeddingProvider {
  readonly modelName: string;
  readonly dimensions: number;
  private readonly apiKey: string;
  private readonly modelId: string;

  constructor(config: OpenAIProviderConfig) {
    if (!config.apiKey || config.apiKey.trim() === "") {
      throw new Error("OpenAIEmbeddingProvider: apiKey ist Pflicht");
    }
    this.apiKey = config.apiKey;
    this.modelId = config.modelId ?? DEFAULT_MODEL_ID;
    this.dimensions = config.dimensions ?? DEFAULT_DIMENSIONS;
    this.modelName = `openai-${this.modelId}`;
  }

  async embed(
    texts: string | string[],
    _options: EmbedOptions,
  ): Promise<Float32Array[]> {
    const arr = Array.isArray(texts) ? texts : [texts];
    if (arr.length === 0) return [];

    const response = await fetch(API_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        input: arr,
        model: this.modelId,
      }),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(
        `OpenAI embedding failed: ${response.status} ${response.statusText}${
          text ? ` — ${text.slice(0, 500)}` : ""
        }`,
      );
    }

    const json = (await response.json()) as OpenAIEmbeddingResponse;
    if (!Array.isArray(json.data) || json.data.length !== arr.length) {
      throw new Error(
        `OpenAI embedding: erwartet ${arr.length} Embeddings, got ${json.data?.length}`,
      );
    }

    // Defensiv nach index sortieren — Response-Reihenfolge ist nicht garantiert.
    const sorted = [...json.data].sort((a, b) => a.index - b.index);
    return sorted.map((d) => new Float32Array(d.embedding));
  }

  async isReady(): Promise<boolean> {
    // Pragmatisch: HTTP-API ist immer "ready". Netz-/Key-Probleme fallen
    // beim ersten echten embed-Call durch (klare Fehler-Message). Ein Ping-
    // Call wäre Aufwand ohne Mehrwert in der Phase-1-Pipeline.
    return true;
  }
}
