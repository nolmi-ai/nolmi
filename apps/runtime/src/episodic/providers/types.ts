// ─── EMBEDDING PROVIDER INTERFACE (3.4.B) ───────────────────────────────────
//
// Swappable Provider-Abstraktion. Drei Implementierungen liegen in den
// Schwester-Files (local / openai / voyage), die Factory wählt anhand
// `TWIN_LAB_EMBEDDING_PROVIDER` aus.
//
// inputType ist Pflicht im Interface — E5-Modelle brauchen einen anderen
// Text-Prefix für Query vs. Passage, Voyage hat einen separaten API-Param,
// OpenAI ignoriert es. Wir verschieben die Entscheidung NICHT in den
// Provider ("er weiß schon"), weil der Caller weiß ob er gerade die User-
// Message oder einen Summary-Segment embeddet. Implizites Raten würde nur
// Bugs verstecken.
//
// embed() ist immer Array-in/Array-out — der Caller wickelt Single-Inputs in
// `[text]` und nimmt `[embedding]` heraus, wenn er nur einen Vektor braucht.
// Das spart eine Overload-Definition und macht die Provider-Code-Pfade
// uniform (jeder schickt Batches an die Pipeline/API).
//
// modelName ist als Stringfeld im Interface, damit das `embedding_model`
// in der embeddings-Tabelle (3.4.A) konsistent vom Provider kommt — Caller
// muss keinen separaten Mapping-Code pflegen.

export type EmbeddingInputType = "query" | "passage";

export interface EmbedOptions {
  inputType: EmbeddingInputType;
}

export interface EmbeddingProvider {
  /** Eindeutiger Name für `embedding_model` (z.B. "local-multilingual-e5-large-q8"). */
  readonly modelName: string;
  /** Dimension der erzeugten Vektoren (muss zu embeddings_vec-Schema passen). */
  readonly dimensions: number;
  /**
   * Embeddet einen oder mehrere Texte. Single-Input wird intern als 1-Batch
   * verarbeitet — der Caller darf string oder string[] reingeben, bekommt
   * immer Float32Array[] zurück.
   *
   * Vektoren sind normalisiert (L2-Norm ≈ 1), damit Cosine-Similarity via
   * Dot-Product im EmbeddingsRepo funktioniert.
   */
  embed(
    texts: string | string[],
    options: EmbedOptions,
  ): Promise<Float32Array[]>;
  /**
   * True wenn der Provider Embeddings ohne weiteren Init-Aufwand liefern
   * kann. LocalProvider braucht einen kalten Pipeline-Load; External-
   * Provider sind sofort einsatzfähig (gehen aber bei Net-Issue über HTTP-
   * Fehler hoch im embed-Call selbst).
   */
  isReady(): Promise<boolean>;
}
