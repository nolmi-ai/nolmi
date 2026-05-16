import "dotenv/config";
import type { Skill } from "@twin-lab/shared";
import {
  collectAllToolCalls,
  collectAllToolResults,
  detectPendingToolCall,
} from "../twin-service.js";
import { MCP_PENDING_APPROVAL_MARKER } from "../mcp/tool-bridge.js";

// ─── REGRESSION-GUARD 3.5.E.D — #89 STEP-WALK ──────────────────────────────
//
// Hält den Wurzel-Bug von #89 (Tag 17 Spike) fest. AI SDK 6 legt Tool-Calls
// aus früheren Multi-Step-Iterationen in `result.steps[i].toolCalls` —
// top-level `result.toolCalls` zeigt nur den letzten Step. Vorheriger
// Twin-Service-Code las top-level → Marker wurde bei Multi-Step nicht
// gesehen → kein Pending-Audit, `audit.output.toolCalls` leer, User sah
// halluzinierten Text aus dem Marker-Result.
//
// Patch (3.5.E.B, Commit d0954a6) hat `collectAllToolCalls`/`-ToolResults`
// eingeführt, die `result.steps` flachen und defensiv auf top-level fallen
// lassen. `detectPendingToolCall` und der Audit-Builder lesen jetzt über
// die Helper.
//
// Dieser Guard prüft mit Mock-Result-Objekten (kein echter LLM- oder
// MCP-Call):
//   - Multi-Step + Marker: Helper finden den Call, detect findet das Pending
//   - Negativ-Fall: keine Tool-Calls → nichts detected, Audit-Map leer
//   - Single-Step-Fallback: `steps` fehlt → Helper liest top-level
//   - Non-Marker-Tool-Call: detect liefert kein Pending
//
// Selbst-Verifikation: nach erfolgreichem Lauf eine Helper-Zeile in
// `twin-service.ts` von `result.steps?.flatMap(...)` zurück auf
// `result.toolCalls` umstellen — TEST 1 muss rot werden. Das ist der
// Beweis dass der Guard wirklich greift.
//
// Aufruf:
//   pnpm --filter @twin-lab/runtime test-regression-89-step-walk

// Lose MockResult-Shape — wir typen nur die Felder, die die Helper
// tatsächlich lesen. `as unknown as GenerateTextOutcome` beim Aufruf
// macht die TS-Pille mundgerecht, ohne dass wir den vollen AI-SDK-Typ
// (mit allen optionalen Sub-Feldern) nachbauen müssen.
type MockToolCall = {
  toolCallId: string;
  toolName: string;
  input: unknown;
};
type MockToolResult = { toolCallId: string; output: unknown };
type MockStep = {
  toolCalls?: MockToolCall[];
  toolResults?: MockToolResult[];
};
type MockResult = {
  text: string;
  finishReason: string;
  steps?: MockStep[];
  toolCalls?: MockToolCall[];
  toolResults?: MockToolResult[];
};

const MARKER_OUTPUT = {
  content: [{ type: "text", text: MCP_PENDING_APPROVAL_MARKER }],
  isError: false,
};

const REGULAR_OUTPUT = {
  content: [{ type: "text", text: "scraped: hello" }],
  isError: false,
};

// Skill-Mock — wir füllen nur die Felder, die `detectPendingToolCall`
// liest (mcpServerId, mcpToolName). Partial-Cast spart uns das vollständige
// Schema-Mock pro Test.
const sampleSkill = {
  mcpServerId: "mcp_srv_test",
  mcpToolName: "scrape_webpage",
} as unknown as Skill;

const skillMap = new Map<string, Skill>([
  ["mcp_hyperbrowser-approval_scrape_webpage", sampleSkill],
]);

function main() {
  let issues = 0;

  // ─── TEST 1 ─────────────────────────────────────────────────────────────
  banner("TEST 1 — Multi-Step + Marker: detect findet Pending, Audit-Map non-empty");
  // step[0]: assistant ruft das Approval-Tool, execute() returnt den
  // Marker. step[1]: LLM würde Synthese-Text aus dem Marker-Result bauen
  // (vor dem Patch der „halluzinierte" User-sichtbare Output). Top-level
  // `toolCalls` enthält nur step[1] — also []. Hier liegt der Bug.
  const multiStepMarker: MockResult = {
    text: "Liegt zur Genehmigung — der Scrape-Call ist in der Approval-Queue.",
    finishReason: "stop",
    steps: [
      {
        toolCalls: [
          {
            toolCallId: "call_1",
            toolName: "mcp_hyperbrowser-approval_scrape_webpage",
            input: {
              url: "https://www.anthropic.com",
              outputFormat: ["markdown"],
            },
          },
        ],
        toolResults: [{ toolCallId: "call_1", output: MARKER_OUTPUT }],
      },
      { toolCalls: [], toolResults: [] },
    ],
    toolCalls: [],
    toolResults: [],
  };

  const allCalls = collectAllToolCalls(
    multiStepMarker as unknown as Parameters<typeof collectAllToolCalls>[0],
  );
  if (allCalls.length !== 1) {
    issues += 1;
    log(`  ⚠ collectAllToolCalls erwartet 1, got ${allCalls.length} (Wurzel-Bug zurück?)`);
  } else {
    log("  collectAllToolCalls(multi-step) = 1 ✓");
  }

  const allResults = collectAllToolResults(
    multiStepMarker as unknown as Parameters<typeof collectAllToolResults>[0],
  );
  if (allResults.length !== 1) {
    issues += 1;
    log(`  ⚠ collectAllToolResults erwartet 1, got ${allResults.length}`);
  } else {
    log("  collectAllToolResults(multi-step) = 1 ✓");
  }

  const pending = detectPendingToolCall(
    multiStepMarker as unknown as Parameters<typeof detectPendingToolCall>[0],
    skillMap,
  );
  if (!pending) {
    issues += 1;
    log("  ⚠ detectPendingToolCall liefert null — Wurzel-Bug-Regression!");
  } else if (pending.mcpToolName !== "scrape_webpage") {
    issues += 1;
    log(`  ⚠ Pending hat falschen Tool-Name: ${pending.mcpToolName}`);
  } else {
    log(`  detectPendingToolCall ✓ (server=${pending.mcpServerId}, tool=${pending.mcpToolName})`);
  }

  // Audit-Builder-Pfad inline repliziert (1:1 dieselbe .map-Logik wie in
  // twin-service.ts) — die Aussage: wenn collectAllToolCalls > 0 liefert,
  // ist auch der Audit-Trail non-empty. Vorher (top-level): immer 0.
  const auditEntries = allCalls.map((tc) => {
    const matching = allResults.find((tr) => tr.toolCallId === tc.toolCallId);
    return {
      toolName: tc.toolName,
      input: tc.input,
      output: matching ? matching.output : null,
    };
  });
  if (auditEntries.length !== 1) {
    issues += 1;
    log(`  ⚠ Audit-Builder-Pfad: erwartet 1 Eintrag, got ${auditEntries.length}`);
  } else {
    log("  Audit-Builder ⇒ 1 Eintrag ✓ (vor Patch: 0)");
  }

  // ─── TEST 2 ─────────────────────────────────────────────────────────────
  banner("TEST 2 — Negativ-Fall: nur Text, kein Tool-Call");
  const textOnly: MockResult = {
    text: "Hi! Schön von dir zu hören.",
    finishReason: "stop",
    steps: [{ toolCalls: [], toolResults: [] }],
    toolCalls: [],
    toolResults: [],
  };
  const emptyCalls = collectAllToolCalls(
    textOnly as unknown as Parameters<typeof collectAllToolCalls>[0],
  );
  if (emptyCalls.length !== 0) {
    issues += 1;
    log(`  ⚠ collectAllToolCalls(text-only) erwartet 0, got ${emptyCalls.length}`);
  } else {
    log("  collectAllToolCalls(text-only) = 0 ✓");
  }
  const noPending = detectPendingToolCall(
    textOnly as unknown as Parameters<typeof detectPendingToolCall>[0],
    skillMap,
  );
  if (noPending !== null) {
    issues += 1;
    log("  ⚠ detectPendingToolCall(text-only) sollte null sein");
  } else {
    log("  detectPendingToolCall(text-only) = null ✓");
  }

  // ─── TEST 3 ─────────────────────────────────────────────────────────────
  banner("TEST 3 — Single-Step-Fallback: steps fehlt, top-level gefüllt");
  // Defensive: ältere SDK-Version oder partielle Mocks ohne steps-Array.
  // Helper muss auf top-level zurückgreifen. Das ist der `?? result.toolCalls`-
  // Pfad im Helper — Single-Step-Verhalten bleibt funktional.
  const singleStep: MockResult = {
    text: "",
    finishReason: "tool-calls",
    // steps: bewusst nicht gesetzt
    toolCalls: [
      {
        toolCallId: "call_2",
        toolName: "mcp_hyperbrowser-approval_scrape_webpage",
        input: { url: "https://x.example", outputFormat: ["markdown"] },
      },
    ],
    toolResults: [{ toolCallId: "call_2", output: MARKER_OUTPUT }],
  };
  const singleCalls = collectAllToolCalls(
    singleStep as unknown as Parameters<typeof collectAllToolCalls>[0],
  );
  if (singleCalls.length !== 1) {
    issues += 1;
    log(
      `  ⚠ Single-Step-Fallback: collectAllToolCalls erwartet 1, got ${singleCalls.length}`,
    );
  } else {
    log("  collectAllToolCalls(single-step) = 1 ✓ (Top-Level-Fallback greift)");
  }
  const singlePending = detectPendingToolCall(
    singleStep as unknown as Parameters<typeof detectPendingToolCall>[0],
    skillMap,
  );
  if (!singlePending) {
    issues += 1;
    log("  ⚠ Single-Step-Fallback: kein Pending detected");
  } else {
    log("  detectPendingToolCall(single-step) ✓");
  }

  // ─── TEST 4 ─────────────────────────────────────────────────────────────
  banner("TEST 4 — Non-Marker-Tool-Call: kein Pending, aber Audit-Map non-empty");
  // Tool wurde gerufen, lieferte aber kein Marker-Result (z.B. ein nicht-
  // approval-pflichtiges Tool, oder ein approved-Resume-Call). Pending darf
  // NICHT detected werden — sonst hätten wir einen False-Positive-Pfad.
  // Aber der Audit-Trail soll den Call trotzdem zeigen.
  const nonMarker: MockResult = {
    text: "Hier die wichtigsten drei Sätze: …",
    finishReason: "stop",
    steps: [
      {
        toolCalls: [
          {
            toolCallId: "call_3",
            toolName: "mcp_hyperbrowser-approval_scrape_webpage",
            input: { url: "https://x.example", outputFormat: ["markdown"] },
          },
        ],
        toolResults: [{ toolCallId: "call_3", output: REGULAR_OUTPUT }],
      },
      { toolCalls: [], toolResults: [] },
    ],
    toolCalls: [],
    toolResults: [],
  };
  const nmPending = detectPendingToolCall(
    nonMarker as unknown as Parameters<typeof detectPendingToolCall>[0],
    skillMap,
  );
  if (nmPending !== null) {
    issues += 1;
    log("  ⚠ Tool-Call ohne Marker wurde fälschlich als Pending detected (False Positive)");
  } else {
    log("  Non-Marker-Tool-Result → kein Pending ✓");
  }
  const nmCalls = collectAllToolCalls(
    nonMarker as unknown as Parameters<typeof collectAllToolCalls>[0],
  );
  if (nmCalls.length !== 1) {
    issues += 1;
    log(`  ⚠ Non-Marker-Audit-Map: erwartet 1 Eintrag, got ${nmCalls.length}`);
  } else {
    log("  Audit-Map zeigt den Tool-Call ✓ (auch ohne Marker)");
  }

  banner("ZUSAMMENFASSUNG");
  if (issues === 0) {
    log("✓ alle Tests grün — Step-Walk-Guard greift");
    log("");
    log("Mutation-Verifikation (lokal verifiziert beim Patch-Bau):");
    log("  collectAllToolCalls auf `return result.toolCalls ?? []` umbauen →");
    log("  TEST 1 (multi-step) + TEST 4 (audit-map bei non-marker) werden rot,");
    log("  TEST 3 (single-step) bleibt grün (top-level IST hier gewünscht).");
    log("  Beweist dass der Guard den Wurzel-Bug echt fängt.");
  } else {
    log(`✗ ${issues} Issue(s) — Details oben.`);
    process.exit(2);
  }
}

function banner(title: string) {
  const line = "─".repeat(72);
  console.log(`\n${line}\n  ${title}\n${line}`);
}
function log(msg: string) {
  console.log(msg);
}

try {
  main();
} catch (err) {
  console.error(
    "\n[regression-89-step-walk] Fehler:",
    err instanceof Error ? err.stack ?? err.message : err,
  );
  process.exit(1);
}
