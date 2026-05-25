import { CodexHttpError } from "./codex-http-error.js";
import { CodexStreamParseError } from "./codex-sse-parser.js";

// ─── CODEX RETRY (#131 PHASE 3.1.2) ─────────────────────────────────────────
//
// Promise-basierter Retry-Wrapper für Codex-Calls. Adaptiert das
// BridgeStream-Pattern (apps/runtime/src/bridge/stream.ts), aber mit:
//
//   - Promise-Loop statt EventSource + setTimeout-Reconnect (fetch hat
//     keine Stream-Event-Listener, also `for ... await sleep` als Schleife)
//   - Max-Retries-Cap (3) statt unbegrenzt — Server-App-Request läuft
//     synchron im User-Send-Pfad, lieber sauber failen als ewig hängen
//   - Klassifizierungs-Helper `isRetryableError`, der explicit zwei
//     no-retry-Klassen kennt: CodexStreamParseError (Codex hat Error-Event
//     geschickt, User-Action nötig) und CodexHttpError mit 4xx-Status
//     (Auth/Quota/Validation).
//
// Phase 3.3 Tool-Call-Handling kann denselben Wrapper reusen — deshalb
// `withRetry` generisch typisiert.

/** Default-Backoff-Sequenz analog BridgeStream-INITIAL_BACKOFF_MS-Doubling,
 *  aber explizit als Array für Test-Override und Capped bei 3 Attempts. */
const DEFAULT_BACKOFFS_MS = [1_000, 2_000, 4_000];
const DEFAULT_MAX_RETRIES = 3;

export interface RetryOptions {
  /** Maximal-Anzahl der Retries NACH dem initialen Versuch. Default 3. */
  maxRetries?: number;
  /** Backoff-Sequenz in ms. `backoffsMs[attempt]` ist die Wartezeit VOR
   *  dem `attempt+1`-ten Retry. Wenn das Array kürzer als maxRetries ist,
   *  wird der letzte Wert wiederholt. */
  backoffsMs?: number[];
  /** Optionaler AbortSignal — bricht die sleep-Phase ab. Cancel während
   *  `fn()`-Aufruf ist Sache des Callers. */
  signal?: AbortSignal;
  /** Wird VOR jedem Retry-Versuch gerufen (nicht nach dem letzten Fail).
   *  `attempt` ist 1-basiert. Default-Caller in CodexAdapter loggt warn. */
  onRetry?: (attempt: number, err: unknown) => void;
}

/**
 * Klassifiziert, ob ein Error per Retry behebbar ist.
 *
 * Nicht retry-würdig (propagiert sofort):
 * - {@link CodexStreamParseError} — Codex hat `response.failed`/`response.error`
 *   geschickt, das ist server-side endgültig
 * - {@link CodexHttpError} mit 4xx-Status — Auth, Quota, Validation
 * - `AbortError` — User hat gecancelt
 *
 * Retry-würdig:
 * - {@link CodexHttpError} mit 5xx-Status — transient server-side
 * - Network-Errors aus Node-fetch (undici): `fetch failed`, `ECONNRESET`,
 *   `ETIMEDOUT`, `ENOTFOUND`, `socket hang up`
 * - Unbekannte Non-Error-Throws — defensive, lieber retry'n als verschlucken
 */
export function isRetryableError(err: unknown): boolean {
  if (err instanceof CodexStreamParseError) return false;
  if (err instanceof CodexHttpError) {
    return err.status >= 500 && err.status < 600;
  }
  if (!(err instanceof Error)) return true;

  if (err.name === "AbortError") return false;

  const msg = err.message;
  // Node-fetch/undici-typische Network-Failures
  if (msg.includes("fetch failed")) return true;
  if (msg.includes("ECONNRESET")) return true;
  if (msg.includes("ETIMEDOUT")) return true;
  if (msg.includes("ENOTFOUND")) return true;
  if (msg.includes("socket hang up")) return true;

  // Default conservative: nicht retryen, was wir nicht kennen — sonst maskieren
  // wir Bugs durch stille Wiederholung.
  return false;
}

/**
 * Promise-basierter Retry-Wrapper mit exponentieller Backoff-Sequenz.
 *
 * Loop:
 *   attempt=0 (initialer Versuch) → bei Erfolg return, bei Fail klassifizieren
 *   non-retryable → sofort throw
 *   retryable && attempt < maxRetries → sleep(backoffsMs[attempt]), retry
 *   retryable && attempt === maxRetries → throw (letzter Fehler)
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
  const backoffsMs = options.backoffsMs ?? DEFAULT_BACKOFFS_MS;

  let attempt = 0;
  while (true) {
    try {
      return await fn();
    } catch (err) {
      if (!isRetryableError(err)) throw err;
      if (attempt >= maxRetries) throw err;

      const backoff =
        backoffsMs[attempt] ?? backoffsMs[backoffsMs.length - 1] ?? 1_000;
      options.onRetry?.(attempt + 1, err);
      await sleep(backoff, options.signal);
      attempt++;
    }
  }
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error("Aborted"));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new Error("Aborted"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
