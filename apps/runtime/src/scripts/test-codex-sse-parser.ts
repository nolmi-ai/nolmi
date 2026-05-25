import { strict as assert } from "node:assert";

import {
  CodexSSEParser,
  CodexStreamParseError,
} from "../oauth/codex-sse-parser.js";

// ─── SMOKE: #131 PHASE 3.1.1 — CODEX-SSE-PARSER ─────────────────────────────
//
// Standalone-Smoke für den Codex-SSE-Parser. Folgt dem etablierten Twin-Lab-
// Pattern (analog test-memory-repos.ts, test-episodic-repos.ts):
// kein Vitest/Jest, sondern direkt tsx mit node:assert + Counter.
//
// Acht Cases:
//   1. happy-path (text-deltas + responseId + status)
//   2. chunked-reads über Buffer-Grenze
//   3. response.failed wirft CodexStreamParseError
//   4. [DONE]-Termination-Signal wird sauber ignoriert
//   5. malformed JSON crasht nicht
//   6. unknown Event-Types landen in unknownEventTypes
//   7. null body wirft mit klarer Diagnose
//   8. leere SSE-Event-Blöcke werden geskipped
//
// Aufruf:
//   pnpm test-codex-sse-parser

interface TestStats {
  passed: number;
  failed: number;
}

const stats: TestStats = { passed: 0, failed: 0 };

async function test(name: string, fn: () => Promise<void> | void): Promise<void> {
  try {
    await fn();
    stats.passed++;
    console.log(`  ✅ ${name}`);
  } catch (err) {
    stats.failed++;
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`  ❌ ${name}\n     ${msg}`);
    if (err instanceof Error && err.stack) {
      console.error(
        err.stack
          .split("\n")
          .slice(1, 4)
          .map((line) => `     ${line.trim()}`)
          .join("\n"),
      );
    }
  }
}

/**
 * Baut einen ReadableStream<Uint8Array> aus String-Chunks. Simuliert die
 * Chunk-Granularität, die `fetch().body.getReader()` in echt liefert.
 */
function makeStream(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let i = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (i >= chunks.length) {
        controller.close();
        return;
      }
      controller.enqueue(encoder.encode(chunks[i]!));
      i++;
    },
  });
}

async function main(): Promise<void> {
  console.log("=== #131 Phase 3.1.1 — CodexSSEParser Smoke ===\n");

  await test("happy-path: text-deltas + responseId + status", async () => {
    const stream = makeStream([
      `data: {"type":"response.created","response":{"id":"resp_abc","status":"in_progress"}}\n\n`,
      `data: {"type":"response.output_text.delta","delta":"Hello"}\n\n`,
      `data: {"type":"response.output_text.delta","delta":" world"}\n\n`,
      `data: {"type":"response.completed","response":{"id":"resp_abc","status":"completed"}}\n\n`,
    ]);
    const result = await new CodexSSEParser().parse(stream);
    assert.equal(result.text, "Hello world");
    assert.equal(result.responseId, "resp_abc");
    assert.equal(result.status, "completed");
    assert.deepEqual(result.unknownEventTypes, []);
  });

  await test("chunked reads: SSE-Event über Buffer-Grenze hinweg", async () => {
    const stream = makeStream([
      `data: {"type":"response.output_text.del`,
      `ta","delta":"chunked"}\n\ndata: {"type":"response.completed","response":{"status":"completed"}}\n\n`,
    ]);
    const result = await new CodexSSEParser().parse(stream);
    assert.equal(result.text, "chunked");
    assert.equal(result.status, "completed");
  });

  await test("response.failed wirft CodexStreamParseError mit Message + Code", async () => {
    const stream = makeStream([
      `data: {"type":"response.created","response":{"id":"r1","status":"in_progress"}}\n\n`,
      `data: {"type":"response.failed","error":{"message":"rate_limit_exceeded","code":"rate_limit"}}\n\n`,
    ]);
    await assert.rejects(
      () => new CodexSSEParser().parse(stream),
      (err: unknown) => {
        assert.ok(err instanceof CodexStreamParseError);
        assert.equal(err.message, "rate_limit_exceeded");
        assert.equal(err.code, "rate_limit");
        assert.equal(err.eventType, "response.failed");
        return true;
      },
    );
  });

  await test("[DONE]-Termination-Signal wird ignoriert (kein Crash)", async () => {
    const stream = makeStream([
      `data: {"type":"response.output_text.delta","delta":"text"}\n\n`,
      `data: [DONE]\n\n`,
    ]);
    const result = await new CodexSSEParser().parse(stream);
    assert.equal(result.text, "text");
  });

  await test("malformed JSON: kein Crash, Stream wird normal weiter geparst", async () => {
    const stream = makeStream([
      `data: not-valid-json\n\n`,
      `data: {"type":"response.output_text.delta","delta":"recovered"}\n\n`,
    ]);
    const result = await new CodexSSEParser().parse(stream);
    assert.equal(result.text, "recovered");
  });

  await test("unknown Event-Types landen in unknownEventTypes (Hybrid-Fallback)", async () => {
    const stream = makeStream([
      `data: {"type":"response.unknown_new_event","data":{"some":"value"}}\n\n`,
      `data: {"type":"response.future_field_x","data":42}\n\n`,
      `data: {"type":"response.output_text.delta","delta":"text"}\n\n`,
    ]);
    const result = await new CodexSSEParser().parse(stream);
    assert.equal(result.text, "text");
    assert.deepEqual(result.unknownEventTypes.sort(), [
      "response.future_field_x",
      "response.unknown_new_event",
    ]);
  });

  await test("null body wirft CodexStreamParseError mit klarer Diagnose", async () => {
    await assert.rejects(
      () => new CodexSSEParser().parse(null),
      (err: unknown) => {
        assert.ok(err instanceof CodexStreamParseError);
        assert.ok(err.message.includes("response.body ist null"));
        return true;
      },
    );
  });

  await test("leere SSE-Event-Blöcke werden geskipped", async () => {
    const stream = makeStream([
      `\n\n`,
      `data: {"type":"response.output_text.delta","delta":"x"}\n\n`,
      `\n\n`,
      `   \n\n`,
    ]);
    const result = await new CodexSSEParser().parse(stream);
    assert.equal(result.text, "x");
  });

  console.log(
    `\n=== Result: ${stats.passed} passed, ${stats.failed} failed ===`,
  );
  if (stats.failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(
    "\n[codex-sse-parser:test] Fataler Fehler:",
    err instanceof Error ? err.message : err,
  );
  process.exit(1);
});
