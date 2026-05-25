// ─── CODEX SSE PARSER (#131 PHASE 3.1.1 + 3.3.1.1) ──────────────────────────
//
// Stateful Server-Sent-Events-Parser für die OpenAI Codex-Response-API
// (`chatgpt.com/backend-api/codex/responses`).
//
// Hybrid-Approach:
//   - Explicit handle für bekannte Event-Types (Discriminated-Union, type-safe
//     Akkumulation in `text`/`responseId`/`status`/`toolCalls`).
//   - Generic fallback für wirklich unbekannte Event-Types: Name wird in
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
// Phase 3.1.2 nutzt `parseChunk()` für Resume-after-Disconnect (analog
// `BridgeStream`-Exponential-Backoff-Pattern aus
// `apps/runtime/src/bridge/stream.ts`).
//
// Phase 3.3.1.1 erweitert um Tool-Call-Event-Extraction (verifiziertes
// Format aus §k Spike + §l Multi-Step-Spike):
//   - `response.output_item.added`/`.done` mit `item.type`-Discrimination
//     (function_call → toolCalls, reasoning → reasoningTraces, message → No-op)
//   - `response.function_call_arguments.delta`/`.done` zum Aggregieren der
//     Tool-Call-Argumente (kommen als Streaming-JSON-Chunks)
//   - 5 Signal-Events explicit handled statt unknownEventTypes
//     (response.in_progress, content_part.added/done, output_text.done)
//
// Reasoning-Trace-Capture ist Phase-3.3-No-Op-Persistenz für künftige
// Sub-Phase 3.3.3 (Audit-Display) — Parser sammelt, Caller nutzt nicht.
//
// Out of Scope (Phase 3.3.1.2 + 3.4):
//   - Multi-Step-Loop-Orchestration (Phase 3.3.1.2 baut die in TwinService)
//   - SSE-Streaming bis zum Web-Client (heute collect-to-string)
//   - Multimodal-Output (Audio, Bilder)
//
// Quellen: Reverse-Engineering Simon Willison Nov 2025, HuggingFace
// codex-proxy. Spec: docs/131-OAUTH-STRATEGY.md §g + §i + §k + §l.

/** Codex-Output-Item-Discrimination basierend auf §k/§l-Findings.
 *  Phase 3.3 nutzt `function_call` (→ toolCalls) + `reasoning` (→
 *  reasoningTraces); `message`-Items sind heute No-Op weil Text-Akkumulation
 *  via `output_text.delta` läuft. */
export type CodexOutputItem =
  | {
      type: "message";
      id?: string;
      role?: string;
      content?: unknown[];
    }
  | {
      type: "function_call";
      id?: string;
      call_id?: string;
      name?: string;
      arguments?: string;
    }
  | {
      type: "reasoning";
      id?: string;
      content?: unknown;
    }
  | {
      type: string;
      [k: string]: unknown;
    };

/** Discriminated-Union der bekannten Codex-Events. Generic-Form fängt
 *  alles auf, was Codex neuerdings schickt — ohne den Parser zu brechen. */
export type CodexStreamEvent =
  | { type: "response.created"; response: { id?: string; status?: string } }
  | { type: "response.in_progress"; response?: unknown }
  | { type: "response.output_item.added"; item: CodexOutputItem }
  | { type: "response.output_item.done"; item: CodexOutputItem }
  | { type: "response.content_part.added"; part?: unknown }
  | { type: "response.content_part.done"; part?: unknown }
  | { type: "response.output_text.delta"; delta: string }
  | { type: "response.output_text.done"; text?: string }
  | { type: "response.function_call_arguments.delta"; item_id: string; delta: string }
  | { type: "response.function_call_arguments.done"; item_id: string; arguments: string }
  | { type: "response.completed"; response: { id?: string; status?: string } }
  | { type: "response.failed"; error: { message: string; code?: string } }
  | { type: "response.error"; error: { message: string; code?: string } }
  | { type: string; data: unknown };

/** Ein akkumulierter Tool-Call aus dem Codex-Stream. `call_id` ist die
 *  Cross-Reference zu `function_call_output`-Items beim Multi-Step-Resume
 *  (§l). `itemId` ist Codex-internes Tracking (z.B. für Streaming-Delta-
 *  Akkumulation). */
export interface CodexToolCall {
  itemId: string;
  callId: string;
  name: string;
  /** JSON-String — Caller muss `JSON.parse()` machen, weil Codex die
   *  Args als String streamt (§k, §l). */
  arguments: string;
}

export interface CodexParseResult {
  /** Akkumulierter Klartext aus allen `response.output_text.delta`-Events. */
  text: string;
  /** Response-ID aus `response.created` (falls geschickt). */
  responseId?: string;
  /** Status aus `response.completed` (typisch `"completed"`). */
  status?: string;
  /** Tool-Calls aus `function_call`-Items, mit akkumulierten Arguments.
   *  Phase 3.3 nutzt das im TwinService-Branch (Phase 3.3.1.2). */
  toolCalls: CodexToolCall[];
  /** Reasoning-Items captured. Phase 3.3.3.0-Spike hat verifiziert:
   *  `{id, type: "reasoning", summary: []}` — `summary` ist leer (Codex
   *  Anti-Distillation), Item ist Metadata-only. Phase 3.3.3.1 reicht das
   *  trotzdem durch für Audit-Trail-Vollständigkeit. */
  reasoningTraces: unknown[];
  /** #131 Phase 3.3.3.1: `usage.output_tokens_details.reasoning_tokens` aus
   *  `response.completed`. Optional weil Codex das Feld weglässt wenn kein
   *  Reasoning getriggert wurde (0 Tokens = häufig bei Tool-Call-Pfaden mit
   *  effort=medium). Phase-3.3.3.0-Spike mit effort=high + Math-Trigger:
   *  276 von 894 Tokens (30.9%). Phase-B könnte `totalTokens` analog
   *  miterfassen — heute Out of Scope. */
  reasoningTokens?: number;
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
  /** Tool-Calls in Akkumulation, keyed by `item.id` (Codex-internes
   *  Tracking — `function_call_arguments.delta/done` referenziert via
   *  `item_id`). */
  private readonly toolCallsByItemId = new Map<string, CodexToolCall>();
  /** Reasoning-Items captured aus `output_item.added`. Phase 3.3.3.1 reicht
   *  sie ans Audit weiter, auch wenn `summary: []` heißt der Content ist
   *  leer (Codex Anti-Distillation, siehe §p). */
  private readonly reasoningTraces: unknown[] = [];
  /** #131 Phase 3.3.3.1: aus `response.completed`-Event-`usage.output_tokens_details`. */
  private reasoningTokens: number | undefined = undefined;

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
      toolCalls: [...this.toolCallsByItemId.values()],
      reasoningTraces: this.reasoningTraces,
      ...(this.reasoningTokens !== undefined
        ? { reasoningTokens: this.reasoningTokens }
        : {}),
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

      case "response.output_item.added":
      case "response.output_item.done": {
        // Item-Type-Discrimination (§k/§l): function_call → toolCalls,
        // reasoning → reasoningTraces, message → No-op (Text wird via
        // output_text.delta akkumuliert). `.added` und `.done` werden
        // beide hier behandelt — `.done` ist defensive (sollte das gleiche
        // item liefern mit `status: completed`).
        if (!isObject(event.item)) return;
        const item = event.item as Record<string, unknown>;
        const itemType = item.type;
        if (itemType === "function_call") {
          const itemId = typeof item.id === "string" ? item.id : "";
          if (!itemId) return;
          const callId =
            typeof item.call_id === "string" ? item.call_id : "";
          const name = typeof item.name === "string" ? item.name : "";
          const args =
            typeof item.arguments === "string" ? item.arguments : "";
          const existing = this.toolCallsByItemId.get(itemId);
          if (existing) {
            // `.done` aktualisiert defensive Fields, falls sie sich
            // gegenüber `.added` verändert haben (Codex könnte z.B.
            // call_id erst beim Done-Event setzen — unwahrscheinlich,
            // aber günstig).
            if (callId) existing.callId = callId;
            if (name) existing.name = name;
            if (args) existing.arguments = args;
          } else {
            this.toolCallsByItemId.set(itemId, {
              itemId,
              callId,
              name,
              arguments: args,
            });
          }
        } else if (itemType === "reasoning") {
          // Capture-only, Phase 3.3 unused. `.done`-Variante wird nicht
          // doppelt erfasst (heuristic: reasoning kommt typischerweise nur
          // einmal pro item.id, in den Smokes 3.3.0/3.3.2 garnicht).
          if (type === "response.output_item.added") {
            this.reasoningTraces.push(item);
          }
        }
        // message-Items: No-Op (Text via output_text.delta), ebenso unbekannte
        // item-Types → ignoriert ohne unknownEventTypes-Eintrag, weil das
        // wrapping-Event explicit handled ist.
        return;
      }

      case "response.function_call_arguments.delta": {
        // Streaming-Akkumulation der Tool-Call-Args (§k: kommt als
        // JSON-String-Chunks zwischen .added und .done). `item_id`
        // referenziert das function_call-Item.
        const itemId =
          typeof event.item_id === "string" ? event.item_id : "";
        const delta = typeof event.delta === "string" ? event.delta : "";
        if (!itemId || !delta) return;
        const existing = this.toolCallsByItemId.get(itemId);
        if (existing) existing.arguments += delta;
        return;
      }

      case "response.function_call_arguments.done": {
        // Final-Args sind vollständig. Überschreibt akkumulierte Variante
        // als Sicherheit (Buffer-Boundary-Issue, fehlende Delta-Events) —
        // §l-Beobachtung: `.done` liefert immer den kompletten arguments-
        // String, nicht nur den letzten Chunk.
        const itemId =
          typeof event.item_id === "string" ? event.item_id : "";
        const args =
          typeof event.arguments === "string" ? event.arguments : "";
        if (!itemId) return;
        const existing = this.toolCallsByItemId.get(itemId);
        if (existing && args) existing.arguments = args;
        return;
      }

      case "response.output_text.delta": {
        if (typeof event.delta === "string") {
          this.text += event.delta;
        }
        return;
      }

      case "response.in_progress":
      case "response.content_part.added":
      case "response.content_part.done":
      case "response.output_text.done": {
        // Signal-Events ohne State-Mutation (§l-Verifikation): markieren
        // Lifecycle-Phasen, die wir heute nicht abbilden. Explicit case
        // verhindert, dass sie als `unknownEventTypes` getrackt werden —
        // sonst füllt der Hybrid-Fallback das Audit-Meta mit Noise.
        return;
      }

      case "response.completed": {
        const response = event.response;
        if (isObject(response) && typeof response.status === "string") {
          this.status = response.status;
        }
        // #131 Phase 3.3.3.1: usage.output_tokens_details.reasoning_tokens
        // extrahieren. Defensive Type-Guards weil alle 3 Ebenen optional sein
        // können (Codex liefert das Feld nur wenn Reasoning getriggert wurde).
        const usage = isObject(response) ? response.usage : undefined;
        const details = isObject(usage)
          ? usage.output_tokens_details
          : undefined;
        const tokens = isObject(details) ? details.reasoning_tokens : undefined;
        if (typeof tokens === "number") {
          this.reasoningTokens = tokens;
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
