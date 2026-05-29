import { LocalEmbeddingProvider } from "./local-provider.js";
import { OpenAIEmbeddingProvider } from "./openai-provider.js";
import { VoyageEmbeddingProvider } from "./voyage-provider.js";
import type { EmbeddingProvider } from "./types.js";
import { getEnv } from "@nolmi/shared/env";

// ─── EMBEDDING PROVIDER FACTORY (3.4.B) ─────────────────────────────────────
//
// Auswahl per ENV:
//   NOLMI_EMBEDDING_PROVIDER = local | openai | voyage   (default: local)
//   NOLMI_EMBEDDING_MODEL    = optional Modell-Override
//   NOLMI_EMBEDDING_DTYPE    = q8 | fp32   (nur local; default: q8)
//   NOLMI_EMBEDDING_API_KEY  = generischer Key (Vorrang)
//   OPENAI_API_KEY           = Fallback für openai
//   VOYAGE_API_KEY           = Fallback für voyage
//
// Aliasing (Tag 31): die alten `TWIN_LAB_EMBEDDING_*`-Namen werden via
// getEnv noch als Fallback gelesen (6–12 Monate, dann Hart-Cut).
//
// Singleton-pro-Process: das Modell zu laden (besonders local) kostet
// Sekunden bis Minuten. Wir cachen die Instanz; `_resetEmbeddingProvider()`
// ist nur als Test-Hilfe da, damit `test-embedding-providers.ts` zwischen
// ENV-Konfigurationen umschalten kann.

export type EmbeddingProviderType = "local" | "openai" | "voyage";

let singletonProvider: EmbeddingProvider | null = null;

export function getEmbeddingProvider(): EmbeddingProvider {
  if (singletonProvider) return singletonProvider;

  const raw = (
    getEnv("NOLMI_EMBEDDING_PROVIDER", "TWIN_LAB_EMBEDDING_PROVIDER") ?? "local"
  ).trim();
  const providerType = raw as EmbeddingProviderType;

  const modelOverride =
    getEnv("NOLMI_EMBEDDING_MODEL", "TWIN_LAB_EMBEDDING_MODEL")?.trim() ||
    undefined;

  switch (providerType) {
    case "local": {
      const dtypeRaw = getEnv(
        "NOLMI_EMBEDDING_DTYPE",
        "TWIN_LAB_EMBEDDING_DTYPE",
      )?.trim();
      const dtype =
        dtypeRaw === "fp32" ? "fp32" : dtypeRaw === "q8" ? "q8" : undefined;
      singletonProvider = new LocalEmbeddingProvider({
        modelId: modelOverride,
        dtype,
      });
      break;
    }

    case "openai": {
      const apiKey =
        getEnv("NOLMI_EMBEDDING_API_KEY", "TWIN_LAB_EMBEDDING_API_KEY")?.trim() ||
        process.env.OPENAI_API_KEY?.trim();
      if (!apiKey) {
        throw new Error(
          "EmbeddingProvider 'openai': NOLMI_EMBEDDING_API_KEY (oder deprecated TWIN_LAB_EMBEDDING_API_KEY) oder OPENAI_API_KEY muss gesetzt sein",
        );
      }
      singletonProvider = new OpenAIEmbeddingProvider({
        apiKey,
        modelId: modelOverride,
      });
      break;
    }

    case "voyage": {
      const apiKey =
        getEnv("NOLMI_EMBEDDING_API_KEY", "TWIN_LAB_EMBEDDING_API_KEY")?.trim() ||
        process.env.VOYAGE_API_KEY?.trim();
      if (!apiKey) {
        throw new Error(
          "EmbeddingProvider 'voyage': NOLMI_EMBEDDING_API_KEY (oder deprecated TWIN_LAB_EMBEDDING_API_KEY) oder VOYAGE_API_KEY muss gesetzt sein",
        );
      }
      singletonProvider = new VoyageEmbeddingProvider({
        apiKey,
        modelId: modelOverride,
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
