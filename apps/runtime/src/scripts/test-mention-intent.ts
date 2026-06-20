import "dotenv/config";
import type { LanguageModel } from "ai";
import {
  classifyMentionIntent,
  type MentionIntent,
} from "../a2a/mention-intent-classifier.js";
import { loadTwinLlmConfig } from "../llm-config.js";
import { createLlmClient } from "../llm-client.js";
import { resolveClassifierConfig } from "../skills/classifier-map.js";

// ─── SMOKE-HARNESS: @-Mention-Intent-Klassifikator (Weg 2 SS1) ───────────────
//
// Zwei Teile:
//   1. Fail-safe (KEINE Keys nötig): bogus model → generateObject wirft →
//      classifyMentionIntent MUSS "CHAT" liefern.
//   2. Echter Modell-Lauf (braucht TWIN_LLM_*-Key in der .env): die kuratierten
//      Fälle gegen das classifierModel, Tabelle intent/reason + Soll/Ist.
//
// Aufruf:  pnpm --filter @nolmi/runtime exec tsx src/scripts/test-mention-intent.ts
// Ohne Key läuft nur Teil 1.

const TARGET = "@florian";

interface Case {
  text: string;
  expected: MentionIntent;
  note?: string;
}

// Kuratierter Grenzfall-Satz: ≥5 SEND, ≥5 CHAT + die 3 harten deferred-Fälle.
const CASES: Case[] = [
  // — SEND: Owner adressiert @florian direkt —
  { text: "@florian kannst du Freitag?", expected: "SEND" },
  { text: "@florian was hältst du von dem neuen Pricing?", expected: "SEND" },
  { text: "@florian kurzer Test, ignorier das einfach", expected: "SEND" },
  { text: "@florian hast du die Slides schon gesehen?", expected: "SEND" },
  { text: "@florian lass uns Montag telefonieren", expected: "SEND" },
  // — CHAT: Owner redet ÜBER @florian / fragt den eigenen Twin —
  { text: "was hat @florian gesagt?", expected: "CHAT" },
  { text: "@florian meinte gestern, das Quartal wird eng", expected: "CHAT" },
  { text: "@florian könnte das eigentlich wissen", expected: "CHAT" },
  { text: "wann hat @florian zuletzt geschrieben?", expected: "CHAT" },
  { text: "ich find @florian macht das richtig gut", expected: "CHAT" },
  // — 🔴 harte deferred-Fälle: MÜSSEN CHAT sein —
  { text: "ich sollte @florian mal fragen ob er Zeit hat", expected: "CHAT", note: "deferred" },
  { text: "vielleicht frag ich @florian später dazu", expected: "CHAT", note: "deferred" },
  { text: "müsste @florian eigentlich auch mal kontaktieren", expected: "CHAT", note: "deferred" },
];

async function runFailsafe(): Promise<boolean> {
  console.log("=== Teil 1: Fail-safe (bogus model → CHAT) ===");
  // Bewusst ungültiges Modell → generateObject wirft → fail-safe greift.
  const bogus = {} as unknown as LanguageModel;
  const r = await classifyMentionIntent("@florian kurzer Test", TARGET, bogus);
  const ok = r.intent === "CHAT";
  console.log(
    `  bogus-model → intent=${r.intent} reason="${r.reason}"  ${ok ? "✅ CHAT (fail-safe)" : "❌ ERWARTET CHAT"}`,
  );
  return ok;
}

async function runReal(): Promise<void> {
  const cfg = loadTwinLlmConfig();
  if (!cfg.apiKey) {
    console.log(
      "\n=== Teil 2: ÜBERSPRUNGEN — kein TWIN_LLM_API_KEY in der .env ===\n" +
        "    (Markus mit Key: pnpm --filter @nolmi/runtime exec tsx src/scripts/test-mention-intent.ts)",
    );
    return;
  }
  const classifierCfg = resolveClassifierConfig(cfg);
  const model = createLlmClient(classifierCfg);
  console.log(
    `\n=== Teil 2: Echter Lauf — classifier=${classifierCfg.provider}/${classifierCfg.model} ===`,
  );

  let pass = 0;
  let deferredOk = true;
  for (const c of CASES) {
    const r = await classifyMentionIntent(c.text, TARGET, model);
    const ok = r.intent === c.expected;
    if (ok) pass++;
    if (c.note === "deferred" && r.intent !== "CHAT") deferredOk = false;
    console.log(
      `  [${ok ? "✅" : "❌"}] soll=${c.expected.padEnd(4)} ist=${r.intent.padEnd(4)}` +
        `${c.note ? " (" + c.note + ")" : ""}  "${c.text}"\n        reason: ${r.reason}`,
    );
  }
  console.log(`\n  Ergebnis: ${pass}/${CASES.length} korrekt.`);
  console.log(
    `  🔴 deferred-Fälle alle CHAT: ${deferredOk ? "✅ JA" : "❌ NEIN — Prompt nachschärfen"}`,
  );
}

async function main(): Promise<void> {
  const failsafeOk = await runFailsafe();
  if (!failsafeOk) {
    console.error("❌ Fail-safe verletzt — Abbruch.");
    process.exit(1);
  }
  await runReal();
}

void main();
