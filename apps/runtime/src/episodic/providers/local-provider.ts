import type { EmbedOptions, EmbeddingProvider } from "./types.js";

// ─── LOCAL EMBEDDING PROVIDER (3.4.B) ───────────────────────────────────────
//
// @huggingface/transformers (transformers.js) mit ONNX-Runtime. Default-
// Modell ist `Xenova/multilingual-e5-large` (1024 dim, deutsch-kompatibel),
// Default-Quantisierung q8 (≈560 MB Disk, minimaler Quality-Loss gegenüber
// fp32, Faktor-4 kleiner).
//
// Pipeline-Singleton mit Lazy-Init: pipeline() ist teuer (Modell-Download +
// Tokenizer-Setup, Pre-Check 48s kalt). Den ersten Call zahlt der Caller —
// danach Cache-Hit pro Embed-Anfrage. Wir halten die *Promise*, nicht das
// resolved Extractor-Objekt — so überleben gleichzeitige Erst-Aufrufe sauber
// (keiner triggert einen zweiten Load).
//
// E5-Prefix-Pattern (3.4-STRATEGY.md, "E5-Pattern-Hinweis"):
//   - Query-Inputs (User-Suchanfragen) bekommen "query: " vorangestellt
//   - Passage-Inputs (gespeicherte Memory) bekommen "passage: " vorangestellt
// Das Modell ist auf dieses Format trainiert; Query-Passage-Cosine fällt
// ohne Prefix deutlich schlechter aus. Der Caller (3.4.D/E) entscheidet ob
// query oder passage; der Provider applied den Prefix vor dem Forward-Pass.

const DEFAULT_MODEL_ID = "Xenova/multilingual-e5-large";
const DEFAULT_DTYPE: "q8" | "fp32" = "q8";
const DEFAULT_DIMENSIONS = 1024;

export interface LocalProviderConfig {
  modelId?: string;
  dtype?: "q8" | "fp32";
  dimensions?: number;
}

interface PipelineExtractor {
  (
    input: string | string[],
    options: { pooling: "mean"; normalize: boolean },
  ): Promise<{
    dims: number[];
    data: Float32Array;
  }>;
}

export class LocalEmbeddingProvider implements EmbeddingProvider {
  readonly modelName: string;
  readonly dimensions: number;
  private readonly modelId: string;
  private readonly dtype: "q8" | "fp32";
  private extractorPromise: Promise<PipelineExtractor> | null = null;
  private ready = false;

  constructor(config: LocalProviderConfig = {}) {
    this.modelId = config.modelId ?? DEFAULT_MODEL_ID;
    this.dtype = config.dtype ?? DEFAULT_DTYPE;
    this.dimensions = config.dimensions ?? DEFAULT_DIMENSIONS;
    // "Xenova/multilingual-e5-large" → "multilingual-e5-large"
    const shortName = this.modelId.split("/").pop() ?? this.modelId;
    this.modelName = `local-${shortName}-${this.dtype}`;
  }

  /**
   * Holt den Pipeline-Extractor, lädt das Modell beim ersten Call. Promise-
   * gecacht, damit konkurrente Erst-Aufrufe nicht zwei Loads triggern.
   *
   * `@huggingface/transformers` ist ESM-only — wir importieren dynamisch,
   * damit es nicht bei Boot-Zeit der Runtime evaluiert wird (Modell-Cache-
   * Check etc.). Lazy reicht für Phase-1-Use-Case.
   */
  private getExtractor(): Promise<PipelineExtractor> {
    if (!this.extractorPromise) {
      this.extractorPromise = (async () => {
        const { pipeline } = await import("@huggingface/transformers");
        const extractor = (await pipeline("feature-extraction", this.modelId, {
          dtype: this.dtype,
        })) as unknown as PipelineExtractor;
        this.ready = true;
        return extractor;
      })().catch((err) => {
        // Bei Failure: Promise zurücksetzen, damit nächster Call retry'en kann.
        this.extractorPromise = null;
        this.ready = false;
        throw err;
      });
    }
    return this.extractorPromise;
  }

  async embed(
    texts: string | string[],
    options: EmbedOptions,
  ): Promise<Float32Array[]> {
    const arr = Array.isArray(texts) ? texts : [texts];
    if (arr.length === 0) return [];

    const prefix = options.inputType === "query" ? "query: " : "passage: ";
    const prefixed = arr.map((t) => prefix + t);

    const extractor = await this.getExtractor();
    const result = await extractor(prefixed, {
      pooling: "mean",
      normalize: true,
    });

    // result.dims = [batch, dim]. result.data ist eine flache Float32Array
    // mit batch*dim Werten. Pro Text einen Slice ziehen und kopieren
    // (Float32Array.slice() liefert eine echte Kopie, kein View — damit
    // hängt der Vektor nicht am internen Pipeline-Buffer).
    const out: Float32Array[] = [];
    for (let i = 0; i < arr.length; i++) {
      const start = i * this.dimensions;
      const end = start + this.dimensions;
      out.push(result.data.slice(start, end));
    }
    return out;
  }

  async isReady(): Promise<boolean> {
    if (!this.extractorPromise) return false;
    try {
      await this.extractorPromise;
      return this.ready;
    } catch {
      return false;
    }
  }
}
