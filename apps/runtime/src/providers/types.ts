import type { ChatMessage } from "@twin-lab/shared";

// ─── PROVIDER INTERFACE ──────────────────────────────────────────────────────
//
// Jeder Provider muss diese Schnittstelle implementieren.
// Phase 1: OpenAI. Phase 1.5: Anthropic. Später: lokale Modelle, eigene.
//
// Die Schnittstelle ist absichtlich klein — sie wächst nur, wenn wir wirklich
// mehr brauchen. Streaming kommt später; jetzt nur Request/Response.

export interface ModelProvider {
  /** Eindeutiger Name, z.B. "openai", "anthropic", "local". */
  readonly name: string;

  /**
   * Sendet eine Reihe von Messages an das Modell und gibt die Antwort zurück.
   * Die Persona wird vom Aufrufer als erste system-Message übergeben.
   */
  complete(input: ProviderCompleteInput): Promise<ProviderCompleteOutput>;
}

export interface ProviderCompleteInput {
  messages: ChatMessage[];
  /** Modell-Name (provider-spezifisch). Default kommt aus ENV. */
  model?: string;
  /** 0..1, Default 0.7. */
  temperature?: number;
}

export interface ProviderCompleteOutput {
  content: string;
  /** Provider-spezifische Metadaten — Token-Counts, Modell, etc. */
  metadata: Record<string, unknown>;
}
