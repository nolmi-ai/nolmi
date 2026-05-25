// ─── CODEX SSE PARSER (#131 PHASE 3.1.1) ────────────────────────────────────
//
// Stateful Server-Sent-Events-Parser für die OpenAI Codex-Response-API
// (`chatgpt.com/backend-api/codex/responses`).
//
// Hybrid-Approach:
//   - Explicit handle für bekannte Event-Types (Discriminated-Union, type-safe
//     Akkumulation in `text`/`responseId`/`status`).
//   - Generic fallback für unbekannte Event-Types: Name wird in
//     `unknownEventTypes` gesammelt, damit der Adapter beim Debug-Log
//     sehen kann, was Codex neuerdings schickt.
//   - Error-Events (`response.failed` + `response.error`) werden via
//     {@link CodexStreamParseError} GEWORFEN — Spike-Phase-3.0 hat sie
//     stillschweigend übersprungen, das Phase-3.1-Refactor macht den
//     Fehler explizit.
//
// Stateful weil SSE-Events durch Reader-Chunks zerschnitten kommen können:
// der `buffer` hält den letzten unvollständigen Event-Block zwischen
// `read()`-Aufrufen.
//
// Phase 3.1.2 wird `parseChunk()` für Resume-after-Disconnect nutzen
// (analog `BridgeStream`-Exponential-Backoff-Pattern aus
// `apps/runtime/src/bridge/stream.ts`).
//
// Out of Scope (Phase 3.3):
//   - Tool-Call-Event-Extraction (`response.output_item.added` mit
//     Tool-Call-Items)
//   - Reasoning-Traces
//   - Multimodal-Output (Audio, Bilder)
//
// Quellen: Reverse-Engineering Simon Willison Nov 2025, HuggingFace
// codex-proxy. Spec: docs/131-OAUTH-STRATEGY.md §g + §i.

/** Discriminated-Union der bekannten Codex-Events. Generic-Form fängt
 *  alles auf, was Codex neuerdings schickt — ohne den Parser zu brechen. */
export type CodexStreamEvent =
  | { type: "response.created"; response: { id?: string; status?: string } }
  | { type: "response.output_item.added"; item: unknown }
  | { type: "response.output_text.delta"; delta: string }
  | { type: "response.completed"; response: { id?: string; status?: string } }
  | { type: "response.failed"; error: { message: string; code?: string } }
  | { type: "response.error"; error: { message: string; code?: string } }
  | { type: string; data: unknown };

export interface CodexParseResult {
  /** Akkumulierter Klartext aus allen `response.output_text.delta`-Events. */
  text: string;
  /** Response-ID aus `response.created` (falls geschickt). */
  responseId?: string;
  /** Status aus `response.completed` (typisch `"completed"`). */
  status?: string;
  /** Event-Type-Strings, die NICHT im Explicit-Set waren. Für Debug-Logging. */
  unknownEventTypes: string[];
}

export class CodexStreamParseError extends Error {
  constructor(
    message: string,
    public readonly code?: string,
    public readonly eventType?: string,
  ) {
    super(message);
    this.name = "CodexStreamParseError";
  }
}

/**
 * Stateful Codex-SSE-Parser. Lebt für die Dauer einer Codex-Response,
 * akkumuliert Text + Metadata, hält Buffer für chunked-Reads.
 *
 * Usage Phase 3.1.2:
 * ```ts
 * const parser = new CodexSSEParser();
 * const result = await parser.parse(res.body);
 * console.log(result.text, result.responseId);
 * ```
 *
 * Für Retry-after-Disconnect kann der Caller alternativ wiederholt
 * `parseChunk(chunk)` aufrufen und am Ende `finalize()` für das Result.
 */
export class CodexSSEParser {
  private buffer = "";
  private text = "";
  private responseId: string | undefined = undefined;
  private status: string | undefined = undefined;
  private readonly unknownTypes = new Set<string>();

  /**
   * Liest einen ReadableStream<Uint8Array> komplett aus und gibt das
   * Akkumulations-Resultat zurück. Wirft, wenn der Body null ist oder ein
   * Error-Event im Stream auftaucht.
   */
  async parse(body: ReadableStream<Uint8Array> | null): Promise<CodexParseResult> {
    if (!body) {
      throw new CodexStreamParseError(
        "[codex-sse-parser] response.body ist null — kein Stream zum Parsen",
      );
    }

    const reader = body.getReader();
    const decoder = new TextDecoder();

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          this.flushBuffer();
          break;
        }
        this.buffer += decoder.decode(value, { stream: true });
        this.processBuffer();
      }
    } finally {
      reader.releaseLock();
    }

    return this.finalize();
  }

  /**
   * Phase-3.1.2-Hook: füttert einen String-Chunk in den Parser. Caller
   * baut den Stream selbst (z.B. nach Retry-Reconnect) und ruft am Ende
   * {@link finalize}. Wirft synchron bei Error-Events im Chunk.
   */
  parseChunk(chunk: string): void {
    this.buffer += chunk;
    this.processBuffer();
  }

  /**
   * Schließt die Akkumulation ab: flushed Rest-Buffer als potentielles
   * letztes Event und gibt das Result zurück. Idempotent — nach finalize
   * darf parseChunk weiter befüllt werden, wenn der Caller das wirklich
   * will (Phase 3.1.2 ruft finalize nur einmal pro Stream).
   */
  finalize(): CodexParseResult {
    this.flushBuffer();
    return {
      text: this.text,
      responseId: this.responseId,
      status: this.status,
      unknownEventTypes: [...this.unknownTypes],
    };
  }

  // ─── intern ───────────────────────────────────────────────────────────────

  /**
   * Splittet den Buffer am SSE-Event-Trenner (`\n\n`), parsed alle vollen
   * Events, und behält den letzten (möglicherweise unvollständigen) Teil
   * im Buffer für den nächsten Chunk.
   */
  private processBuffer(): void {
    const events = this.buffer.split("\n\n");
    this.buffer = events.pop() ?? "";
    for (const event of events) {
      if (!event.trim()) continue;
      this.handleEvent(event);
    }
  }

  /**
   * Wird am Stream-Ende aufgerufen: wenn der finale Chunk kein abschließendes
   * `\n\n` hatte, könnte ein vollständiges Event im Buffer hängen. Wir
   * verarbeiten es defensiv. Wenn es unvollständig ist, scheitert JSON.parse
   * stillschweigend (siehe {@link handleEvent}).
   */
  private flushBuffer(): void {
    if (this.buffer.trim()) {
      this.handleEvent(this.buffer);
      this.buffer = "";
    }
  }

  /**
   * Parsed ein einzelnes SSE-Event (Multi-Line-String aus `event:`-/
   * `data:`-Zeilen). Wir interessieren uns nur für die `data:`-Zeile mit
   * JSON-Payload — Codex schickt das `event:`-Field redundant zur
   * `type`-Property im JSON.
   */
  private handleEvent(rawEvent: string): void {
    const dataLine = rawEvent
      .split("\n")
      .find((line) => line.startsWith("data: "));
    if (!dataLine) return;

    const dataStr = dataLine.slice(6).trim();
    if (dataStr === "[DONE]") return; // SSE-Termination-Signal

    let parsed: Record<string, unknown>;
    try {
      const json = JSON.parse(dataStr);
      if (typeof json !== "object" || json === null) return;
      parsed = json as Record<string, unknown>;
    } catch {
      // Malformed JSON: still resilient — könnte ein unvollständiger Chunk
      // sein, der in flushBuffer landet. Phase 3.1.2 wird das ggf. loggen.
      return;
    }

    this.dispatchEvent(parsed);
  }

  /**
   * Explicit-Branch für bekannte Event-Types, Generic-Fallback sonst.
   * Error-Events werfen — die Caller-Codepath behandelt das im fetch-
   * try/catch.
   */
  private dispatchEvent(event: Record<string, unknown>): void {
    const type = event.type;
    if (typeof type !== "string") return;

    switch (type) {
      case "response.created": {
        const response = event.response;
        if (isObject(response)) {
          if (typeof response.id === "string") this.responseId = response.id;
        }
        return;
      }

      case "response.output_item.added": {
        // Spike-Phase 3.1.1: No-op. Phase 3.3 wird Tool-Calls hier extrahieren
        // (Item-Type `function_call`, `tool_call`, …).
        return;
      }

      case "response.output_text.delta": {
        if (typeof event.delta === "string") {
          this.text += event.delta;
        }
        return;
      }

      case "response.completed": {
        const response = event.response;
        if (isObject(response) && typeof response.status === "string") {
          this.status = response.status;
        }
        return;
      }

      case "response.failed":
      case "response.error": {
        const errObj = isObject(event.error) ? event.error : {};
        const message =
          typeof errObj.message === "string"
            ? errObj.message
            : `Codex-Stream-Error (${type})`;
        const code = typeof errObj.code === "string" ? errObj.code : undefined;
        throw new CodexStreamParseError(message, code, type);
      }

      default: {
        // Generic fallback: tracken, nicht blocken. Phase 3.1.2 kann das im
        // Adapter loggen, sobald `result.unknownEventTypes.length > 0`.
        this.unknownTypes.add(type);
        return;
      }
    }
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
