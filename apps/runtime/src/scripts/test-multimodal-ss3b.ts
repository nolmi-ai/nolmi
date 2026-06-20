import type { LanguageModelV3Prompt } from "@ai-sdk/provider";
import { mapV3PromptToCodex } from "../oauth/codex-vercel-provider.js";

// ─── MULTIMODAL SS3b — FORM-CHECK (Codex-Mapper, kein Netz) ──────────────────
//
// Der echte Codex-Live-Beweis geht NUR auf Prod (lokal @markus=Anthropic) —
// kommt beim Prod-Smoke (wie der Spike d5e757e, aber über den Produktiv-Adapter).
// Lokal: 🔴 Text-Regression (KRITISCH) + input_image-Form + Mischfall.

let failed = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  const ok = a === e;
  if (!ok) failed++;
  console.log(`  ${ok ? "✅" : "❌"} ${label}`);
  if (!ok) {
    console.log(`      erwartet: ${e}`);
    console.log(`      bekommen: ${a}`);
  }
}

// 4 Bytes Testdaten → deterministische base64 (AQIDBA==).
const BYTES = new Uint8Array([1, 2, 3, 4]);
const B64 = Buffer.from(BYTES).toString("base64");

function main() {
  // ── 1) 🔴 TEXT-REGRESSION: reiner Text muss byte-identisch zu heute sein ───
  console.log("=== 1) Text-Regression (KRITISCH — @markus Prod-Chat-Pfad) ===");
  const textOnly: LanguageModelV3Prompt = [
    { role: "system", content: "Du bist X." },
    { role: "user", content: [{ type: "text", text: "hallo" }] },
  ];
  const r1 = mapV3PromptToCodex(textOnly);
  check("instructions unverändert", r1.instructions, "Du bist X.");
  check("user → genau EIN input_text 'hallo'", r1.input, [
    { type: "message", role: "user", content: [{ type: "input_text", text: "hallo" }] },
  ]);

  // Mehrere text-Parts (theoretisch) → wie heute zu EINEM input_text gejoint.
  const multiText: LanguageModelV3Prompt = [
    {
      role: "user",
      content: [
        { type: "text", text: "a" },
        { type: "text", text: "b" },
      ],
    },
  ];
  check("mehrere text-Parts → ein gejointes input_text 'a\\nb'", mapV3PromptToCodex(multiText).input, [
    { type: "message", role: "user", content: [{ type: "input_text", text: "a\nb" }] },
  ]);

  // ── 2) input_image-Form gegen das Spike-bewiesene Format ────────────────────
  console.log("\n=== 2) input_image-Form (gegen Spike d5e757e) ===");
  const imageOnly: LanguageModelV3Prompt = [
    {
      role: "user",
      content: [{ type: "file", mediaType: "image/png", data: BYTES }],
    },
  ];
  check("image-only → genau EIN input_image (data-URI, detail:auto)", mapV3PromptToCodex(imageOnly).input, [
    {
      type: "message",
      role: "user",
      content: [
        { type: "input_image", image_url: `data:image/png;base64,${B64}`, detail: "auto" },
      ],
    },
  ]);

  // ── 3) Mischfall text + image: Reihenfolge input_text, dann input_image ─────
  console.log("\n=== 3) Mischfall text + image ===");
  const mixed: LanguageModelV3Prompt = [
    {
      role: "user",
      content: [
        { type: "text", text: "Was siehst du?" },
        { type: "file", mediaType: "image/png", data: BYTES },
      ],
    },
  ];
  check("text+image → [input_text, input_image] in Reihenfolge", mapV3PromptToCodex(mixed).input, [
    {
      type: "message",
      role: "user",
      content: [
        { type: "input_text", text: "Was siehst du?" },
        { type: "input_image", image_url: `data:image/png;base64,${B64}`, detail: "auto" },
      ],
    },
  ]);

  // ── 4) data-URI-Passthrough (bereits fertige URL bleibt unverändert) ────────
  console.log("\n=== 4) data-URI-/URL-Passthrough ===");
  const preBuilt: LanguageModelV3Prompt = [
    {
      role: "user",
      content: [{ type: "file", mediaType: "image/png", data: "data:image/png;base64,XXXX" }],
    },
  ];
  check("fertige data-URI wird nicht doppelt gewrappt", mapV3PromptToCodex(preBuilt).input, [
    {
      type: "message",
      role: "user",
      content: [{ type: "input_image", image_url: "data:image/png;base64,XXXX", detail: "auto" }],
    },
  ]);

  console.log(`\n=== BEFUND: ${failed === 0 ? "✅ ALLE GRÜN" : `❌ ${failed} FEHLGESCHLAGEN`} ===`);
  if (failed > 0) process.exit(1);
}

main();
