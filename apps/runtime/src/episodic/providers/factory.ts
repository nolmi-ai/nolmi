import { LocalEmbeddingProvider } from "./local-provider.js";
import { OpenAIEmbeddingProvider } from "./openai-provider.js";
import { VoyageEmbeddingProvider } from "./voyage-provider.js";
import type { EmbeddingProvider } from "./types.js";

// ─── EMBEDDING PROVIDER FACTORY (3.4.B) ─────────────────────────────────────
//
// Auswahl per ENV:
//   TWIN_LAB_EMBEDDING_PROVIDER = local | openai | voyage   (default: local)
//   TWIN_LAB_EMBEDDING_MODEL    = optional Modell-Override
//   TWIN_LAB_EMBEDDING_DTYPE    = q8 | fp32   (nur local; default: q8)
//   TWIN_LAB_EMBEDDING_API_KEY  = generischer Key (Vorrang)
//   OPENAI_API_KEY              = Fallback für openai
//   VOYAGE_API_KEY              = Fallback für voyage
//
// Singleton-pro-Process: das Modell zu laden (besonders local) kostet
// Sekunden bis Minuten. Wir cachen die Instanz; `_resetEmbeddingProvider()`
// ist nur als Test-Hilfe da, damit `test-embedding-providers.ts` zwischen
// ENV-Konfigurationen umschalten kann.

export type EmbeddingProviderType = "local" | "openai" | "voyage";

let singletonProvider: EmbeddingProvider | null = null;

export function getEmbeddingProvider(): EmbeddingProvider {
  if (singletonProvider) return singletonProvider;

  const raw = (process.env.TWIN_LAB_EMBEDDING_PROVIDER ?? "local").trim();
  const providerType = raw as EmbeddingProviderType;

  switch (providerType) {
    case "local": {
      const dtypeRaw = process.env.TWIN_LAB_EMBEDDING_DTYPE?.trim();
      const dtype =
        dtypeRaw === "fp32" ? "fp32" : dtypeRaw === "q8" ? "q8" : undefined;
      singletonProvider = new LocalEmbeddingProvider({
        modelId: process.env.TWIN_LAB_EMBEDDING_MODEL?.trim() || undefined,
        dtype,
      });
      break;
    }

    case "openai": {
      const apiKey =
        process.env.TWIN_LAB_EMBEDDING_API_KEY?.trim() ||
        process.env.OPENAI_API_KEY?.trim();
      if (!apiKey) {
        throw new Error(
          "EmbeddingProvider 'openai': TWIN_LAB_EMBEDDING_API_KEY oder OPENAI_API_KEY muss gesetzt sein",
        );
      }
      singletonProvider = new OpenAIEmbeddingProvider({
        apiKey,
        modelId: process.env.TWIN_LAB_EMBEDDING_MODEL?.trim() || undefined,
      });
      break;
    }

    case "voyage": {
      const apiKey =
        process.env.TWIN_LAB_EMBEDDING_API_KEY?.trim() ||
        process.env.VOYAGE_API_KEY?.trim();
      if (!apiKey) {
        throw new Error(
          "EmbeddingProvider 'voyage': TWIN_LAB_EMBEDDING_API_KEY oder VOYAGE_API_KEY muss gesetzt sein",
        );
      }
      singletonProvider = new VoyageEmbeddingProvider({
        apiKey,
        modelId: process.env.TWIN_LAB_EMBEDDING_MODEL?.trim() || undefined,
      });
      break;
    }

    default:
      throw new Error(
        `EmbeddingProvider unbekannt: '${raw}'. Erlaubt: local | openai | voyage.`,
      );
  }

  return singletonProvider;
}

/**
 * Nur für Tests: Singleton zurücksetzen, damit der nächste
 * `getEmbeddingProvider()`-Call die ENV neu auswertet. In Production niemals
 * aufrufen — sonst wird das Lokal-Modell erneut geladen.
 */
export function _resetEmbeddingProvider(): void {
  singletonProvider = null;
}
