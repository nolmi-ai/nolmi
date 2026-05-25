import { strict as assert } from "node:assert";

import {
  CodexSSEParser,
  CodexStreamParseError,
} from "../oauth/codex-sse-parser.js";
import { mapSkillsToCodexTools } from "../oauth/codex-tool-mapper.js";
import type { Skill } from "@twin-lab/shared";

// ─── SMOKE: #131 PHASE 3.1.1 + 3.3.1.1 — CODEX-SSE-PARSER + TOOL-MAPPER ─────
//
// Standalone-Smoke für den Codex-SSE-Parser plus den `mapSkillsToCodexTools`-
// Helper. Folgt dem etablierten Twin-Lab-Pattern (analog test-memory-repos.ts,
// test-episodic-repos.ts): kein Vitest/Jest, sondern direkt tsx mit
// node:assert + Counter.
//
// Phase 3.1.1 (existing 8 Cases):
//   1. happy-path (text-deltas + responseId + status)
//   2. chunked-reads über Buffer-Grenze
//   3. response.failed wirft CodexStreamParseError
//   4. [DONE]-Termination-Signal wird sauber ignoriert
//   5. malformed JSON crasht nicht
//   6. unknown Event-Types landen in unknownEventTypes
//   7. null body wirft mit klarer Diagnose
//   8. leere SSE-Event-Blöcke werden geskipped
//
// Phase 3.3.1.1 Parser-Erweiterung (4 neue Cases, §k + §l verifiziert):
//   9. function_call captured aus output_item.added + arguments.delta/done
//  10. multiple parallel tool calls (Map-keyed by item.id)
//  11. reasoning landet in reasoningTraces (nicht in text/toolCalls)
//  12. signal events (in_progress, content_part, output_text.done) explicit
//      handled — keine unknownEventTypes-Einträge
//
// Phase 3.3.1.1 Helper (3 Cases):
//  13. mapSkillsToCodexTools: einzelner MCP-Skill konvertiert korrekt
//  14. mapSkillsToCodexTools: filter (inactive + manual + missing-mcp-fields
//      werden raus-gefiltert)
//  15. mapSkillsToCodexTools: EMPTY-Schema-Fallback bei fehlendem
//      mcpInputSchema
//
// Phase 3.3.1.2 Helper (1 Case — Reverse-Map):
//  16. mapSkillsToCodexTools: skillByCodexName-Map löst Edge-Case mit
//      Underscore-im-toolName eindeutig (mcp:hyperbrowser-approval:scrape_webpage)
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

  // ── Phase 3.3.1.1 Parser-Erweiterung ─────────────────────────────────────

  await test(
    "function_call captured aus output_item.added + arguments.delta/done",
    async () => {
      // Format aus §k (Phase 3.3.0 Spike-Discovery)
      const stream = makeStream([
        `data: {"type":"response.created","response":{"id":"r1","status":"in_progress"}}\n\n`,
        `data: {"type":"response.output_item.added","item":{"type":"function_call","id":"fc_abc","call_id":"call_xyz","name":"get_current_time","arguments":""}}\n\n`,
        `data: {"type":"response.function_call_arguments.delta","item_id":"fc_abc","delta":"{\\"timezone"}\n\n`,
        `data: {"type":"response.function_call_arguments.delta","item_id":"fc_abc","delta":"\\":\\"Europe/Berlin\\"}"}\n\n`,
        `data: {"type":"response.function_call_arguments.done","item_id":"fc_abc","arguments":"{\\"timezone\\":\\"Europe/Berlin\\"}"}\n\n`,
        `data: {"type":"response.output_item.done","item":{"type":"function_call","id":"fc_abc","call_id":"call_xyz","name":"get_current_time","arguments":"{\\"timezone\\":\\"Europe/Berlin\\"}"}}\n\n`,
        `data: {"type":"response.completed","response":{"id":"r1","status":"completed"}}\n\n`,
      ]);
      const result = await new CodexSSEParser().parse(stream);
      assert.equal(result.toolCalls.length, 1);
      assert.equal(result.toolCalls[0]!.itemId, "fc_abc");
      assert.equal(result.toolCalls[0]!.callId, "call_xyz");
      assert.equal(result.toolCalls[0]!.name, "get_current_time");
      assert.equal(
        result.toolCalls[0]!.arguments,
        `{"timezone":"Europe/Berlin"}`,
      );
      assert.equal(result.text, ""); // Tool-Call ohne Text-Delta
      assert.equal(result.status, "completed");
      assert.equal(result.unknownEventTypes.length, 0);
    },
  );

  await test("multiple parallel tool calls", async () => {
    // Codex liefert mehrere function_call-Items mit unterschiedlichen
    // item.id; Map-State im Parser keyed sie korrekt.
    const stream = makeStream([
      `data: {"type":"response.output_item.added","item":{"type":"function_call","id":"fc1","call_id":"call1","name":"tool_a","arguments":""}}\n\n`,
      `data: {"type":"response.function_call_arguments.done","item_id":"fc1","arguments":"{}"}\n\n`,
      `data: {"type":"response.output_item.added","item":{"type":"function_call","id":"fc2","call_id":"call2","name":"tool_b","arguments":""}}\n\n`,
      `data: {"type":"response.function_call_arguments.done","item_id":"fc2","arguments":"{\\"x\\":1}"}\n\n`,
      `data: {"type":"response.completed","response":{"id":"r1","status":"completed"}}\n\n`,
    ]);
    const result = await new CodexSSEParser().parse(stream);
    assert.equal(result.toolCalls.length, 2);
    const byCall = new Map(result.toolCalls.map((c) => [c.callId, c]));
    assert.equal(byCall.get("call1")!.name, "tool_a");
    assert.equal(byCall.get("call1")!.arguments, "{}");
    assert.equal(byCall.get("call2")!.name, "tool_b");
    assert.equal(byCall.get("call2")!.arguments, `{"x":1}`);
  });

  await test("reasoning landet in reasoningTraces, nicht in text/toolCalls", async () => {
    // Phase 3.3.0/3.3.2 haben kein reasoning gesehen (reasoning_tokens=0).
    // Test arbeitet mit hypothetischem Format basierend auf OpenAI Responses
    // API Doku — wenn Codex anderes Format schickt, fängt der generic
    // fallback es ab (siehe Test "unknown Event-Types").
    const stream = makeStream([
      `data: {"type":"response.output_item.added","item":{"type":"reasoning","id":"rs_abc","content":[{"step":"thinking"}]}}\n\n`,
      `data: {"type":"response.output_text.delta","delta":"final text"}\n\n`,
      `data: {"type":"response.completed","response":{"id":"r1","status":"completed"}}\n\n`,
    ]);
    const result = await new CodexSSEParser().parse(stream);
    assert.equal(result.text, "final text");
    assert.equal(result.toolCalls.length, 0);
    assert.equal(result.reasoningTraces.length, 1);
    // Reasoning-Trace ist das komplette item-Object (inkl. type/id/content)
    const trace = result.reasoningTraces[0] as Record<string, unknown>;
    assert.equal(trace.type, "reasoning");
    assert.equal(trace.id, "rs_abc");
  });

  await test(
    "signal events (in_progress, content_part, output_text.done) ohne unknownEventTypes-Eintrag",
    async () => {
      // §l hat alle 5 Bonus-Discovery-Events zugeordnet; sie müssen explicit
      // gehandhabt sein, sonst füllt der Hybrid-Fallback unknownEventTypes
      // mit Noise bei jedem Text-Response.
      const stream = makeStream([
        `data: {"type":"response.in_progress","response":{}}\n\n`,
        `data: {"type":"response.output_item.added","item":{"type":"message","id":"msg_1","role":"assistant","content":[]}}\n\n`,
        `data: {"type":"response.content_part.added","part":{"type":"output_text","text":""}}\n\n`,
        `data: {"type":"response.output_text.delta","delta":"Hello"}\n\n`,
        `data: {"type":"response.output_text.done","text":"Hello"}\n\n`,
        `data: {"type":"response.content_part.done","part":{"type":"output_text","text":"Hello"}}\n\n`,
        `data: {"type":"response.output_item.done","item":{"type":"message","id":"msg_1","status":"completed"}}\n\n`,
        `data: {"type":"response.completed","response":{"id":"r1","status":"completed"}}\n\n`,
      ]);
      const result = await new CodexSSEParser().parse(stream);
      assert.equal(result.text, "Hello");
      assert.equal(result.toolCalls.length, 0);
      assert.equal(result.unknownEventTypes.length, 0);
    },
  );

  // ── Phase 3.3.1.1 Helper: mapSkillsToCodexTools ──────────────────────────

  await test("mapSkillsToCodexTools: single MCP-Skill konvertiert korrekt", () => {
    const skill: Skill = {
      skillId: "skill_1",
      twinId: "twin_1",
      name: "mcp:everything-approval:get-sum",
      description: "Get sum of two numbers",
      manifestJson: {
        name: "get-sum",
        description: "Get sum of two numbers",
        capability: "mcp_tool",
        requiresApproval: false,
        mcpServerId: "mcp_everything-approval",
        mcpToolName: "get-sum",
        mcpInputSchema: {
          type: "object",
          properties: {
            a: { type: "number" },
            b: { type: "number" },
          },
          required: ["a", "b"],
        },
      },
      instructionsMd: "",
      scriptTs: null,
      source: "mcp",
      sourceMetadata: null,
      mcpServerId: "mcp_everything-approval",
      mcpToolName: "get-sum",
      isActive: true,
      createdAt: 0,
      updatedAt: 0,
    };
    const { tools, skillByCodexName } = mapSkillsToCodexTools([skill]);
    assert.equal(tools.length, 1);
    assert.equal(tools[0]!.type, "function");
    // `:` → `_` Tool-Key-Convention matched buildMcpToolsFromSkills
    assert.equal(tools[0]!.name, "mcp_everything-approval_get-sum");
    assert.equal(tools[0]!.description, "Get sum of two numbers");
    assert.deepEqual(tools[0]!.parameters, skill.manifestJson.mcpInputSchema);
    // Reverse-Map: Codex-Name liefert dasselbe Skill-Object
    assert.equal(skillByCodexName.size, 1);
    assert.strictEqual(
      skillByCodexName.get("mcp_everything-approval_get-sum"),
      skill,
    );
  });

  await test(
    "mapSkillsToCodexTools: filter (inactive + manual + missing-mcp-fields raus)",
    () => {
      const baseManifest = {
        name: "tool",
        description: "desc",
        capability: "mcp_tool",
        requiresApproval: false,
        mcpInputSchema: { type: "object" as const, properties: {} },
      };
      const skills: Skill[] = [
        // valid MCP — bleibt
        {
          skillId: "s1",
          twinId: "t1",
          name: "mcp:srv:active-tool",
          description: "d",
          manifestJson: { ...baseManifest, mcpServerId: "srv", mcpToolName: "active-tool" },
          instructionsMd: "",
          scriptTs: null,
          source: "mcp",
          sourceMetadata: null,
          mcpServerId: "srv",
          mcpToolName: "active-tool",
          isActive: true,
          createdAt: 0,
          updatedAt: 0,
        },
        // inactive — raus
        {
          skillId: "s2",
          twinId: "t1",
          name: "mcp:srv:inactive-tool",
          description: "d",
          manifestJson: { ...baseManifest, mcpServerId: "srv", mcpToolName: "inactive-tool" },
          instructionsMd: "",
          scriptTs: null,
          source: "mcp",
          sourceMetadata: null,
          mcpServerId: "srv",
          mcpToolName: "inactive-tool",
          isActive: false,
          createdAt: 0,
          updatedAt: 0,
        },
        // manual — raus
        {
          skillId: "s3",
          twinId: "t1",
          name: "manual-skill",
          description: "d",
          manifestJson: baseManifest,
          instructionsMd: "instructions",
          scriptTs: null,
          source: "manual",
          sourceMetadata: null,
          mcpServerId: null,
          mcpToolName: null,
          isActive: true,
          createdAt: 0,
          updatedAt: 0,
        },
        // mcp ohne mcpServerId — raus (defensive, sollte Schema-invalide sein)
        {
          skillId: "s4",
          twinId: "t1",
          name: "mcp:srv:no-server-id",
          description: "d",
          manifestJson: baseManifest,
          instructionsMd: "",
          scriptTs: null,
          source: "mcp",
          sourceMetadata: null,
          mcpServerId: null,
          mcpToolName: "tool",
          isActive: true,
          createdAt: 0,
          updatedAt: 0,
        },
      ];
      const { tools, skillByCodexName } = mapSkillsToCodexTools(skills);
      assert.equal(tools.length, 1);
      assert.equal(tools[0]!.name, "mcp_srv_active-tool");
      // Map matched Tools-Array exakt
      assert.equal(skillByCodexName.size, 1);
      assert.equal(
        skillByCodexName.get("mcp_srv_active-tool")?.skillId,
        "s1",
      );
    },
  );

  await test(
    "mapSkillsToCodexTools: EMPTY-Schema-Fallback bei fehlendem mcpInputSchema",
    () => {
      const skill: Skill = {
        skillId: "s1",
        twinId: "t1",
        name: "mcp:srv:no-schema",
        description: "d",
        manifestJson: {
          name: "no-schema",
          description: "tool without input schema",
          capability: "mcp_tool",
          requiresApproval: false,
          mcpServerId: "srv",
          mcpToolName: "no-schema",
          // mcpInputSchema bewusst weggelassen — optional im Schema
        },
        instructionsMd: "",
        scriptTs: null,
        source: "mcp",
        sourceMetadata: null,
        mcpServerId: "srv",
        mcpToolName: "no-schema",
        isActive: true,
        createdAt: 0,
        updatedAt: 0,
      };
      const { tools, skillByCodexName } = mapSkillsToCodexTools([skill]);
      assert.equal(tools.length, 1);
      assert.deepEqual(tools[0]!.parameters, {
        type: "object",
        properties: {},
      });
      assert.strictEqual(
        skillByCodexName.get("mcp_srv_no-schema"),
        skill,
      );
    },
  );

  await test(
    "mapSkillsToCodexTools: skillByCodexName resolved Underscore-Edge-Case eindeutig",
    () => {
      // Existing Skill in DB: mcp:hyperbrowser-approval:scrape_webpage —
      // mcpToolName "scrape_webpage" enthält Underscore. Codex-Tool-Name
      // wird mcp_hyperbrowser-approval_scrape_webpage (3 Segmente). Naive
      // String-Replace `_` → `:` würde 5 Segmente liefern und damit den
      // Reverse-Lookup zerstören. Die Map ist eindeutig.
      const skill: Skill = {
        skillId: "s_hb_scrape",
        twinId: "t1",
        name: "mcp:hyperbrowser-approval:scrape_webpage",
        description: "Scrape a webpage",
        manifestJson: {
          name: "scrape_webpage",
          description: "Scrape a webpage with hyperbrowser",
          capability: "mcp_tool",
          requiresApproval: true,
          mcpServerId: "mcp_hyperbrowser-approval",
          mcpToolName: "scrape_webpage",
          mcpInputSchema: {
            type: "object",
            properties: { url: { type: "string" } },
            required: ["url"],
          },
        },
        instructionsMd: "",
        scriptTs: null,
        source: "mcp",
        sourceMetadata: null,
        mcpServerId: "mcp_hyperbrowser-approval",
        mcpToolName: "scrape_webpage",
        isActive: true,
        createdAt: 0,
        updatedAt: 0,
      };
      const { tools, skillByCodexName } = mapSkillsToCodexTools([skill]);
      assert.equal(tools.length, 1);
      // Codex-Name hat 4 Underscores total (2 vom `:` + 2 vom existing `_`)
      assert.equal(
        tools[0]!.name,
        "mcp_hyperbrowser-approval_scrape_webpage",
      );
      // Map liefert exakt diesen Skill zurück — KEIN Splitting nötig
      assert.strictEqual(
        skillByCodexName.get("mcp_hyperbrowser-approval_scrape_webpage"),
        skill,
      );
      // Sanity-Check: naive String-Replace würde anders mappen
      const naive =
        "mcp_hyperbrowser-approval_scrape_webpage".replaceAll("_", ":");
      assert.equal(naive, "mcp:hyperbrowser-approval:scrape:webpage");
      assert.notEqual(naive, skill.name); // genau der Edge-Case
    },
  );

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
