import "dotenv/config";
import { rmSync } from "node:fs";
import { resolve } from "node:path";
import { generateText } from "ai";
import type { ChatMessage } from "@nolmi/shared";
import { toModelMessages } from "../twin-service.js";
import {
  saveAttachment,
  getAttachmentStoreDir,
} from "../multimodal/attachment-store.js";
import { makeRedCirclePng } from "./red-circle-png.js";
import { loadTwinLlmConfig } from "../llm-config.js";
import { createLlmClient } from "../llm-client.js";

// ─── MULTIMODAL SS3a — VERIFIKATION (Anthropic-Pfad, jetzt über echten Store) ─
//
// Prüft den ECHTEN toModelMessages-Pfad: eine User-Message mit attachments →
// Content-Array mit Image-Part → @ai-sdk/anthropic. Seit SS2a kommt das Bild
// aus dem ECHTEN Store (saveAttachment → ref → loadAttachmentBytes(twinId,ref)),
// nicht mehr aus einem Stub. Braucht einen lokalen Anthropic-Key (LLM_*).

const TEST_TWIN = "ss3a-test-twin";

function dumpShape(label: string, msgs: ChatMessage[]) {
  const model = toModelMessages(msgs, TEST_TWIN);
  const shape = JSON.stringify(model, (k, v) => {
    if (k === "image" && v && typeof v === "object") {
      return `<Buffer ${(v as Buffer).length ?? "?"}B>`;
    }
    return v;
  });
  console.log(`  ${label}: ${shape}`);
}

async function main() {
  // Test-Bild in den ECHTEN Store legen → server-generierte ref.
  const png = makeRedCirclePng(64);
  const saved = saveAttachment(TEST_TWIN, png, "image/png");
  console.log(`[ss3a] Bild im Store: twin=${TEST_TWIN} ref=${saved.ref} (${saved.sizeBytes}B)`);

  const imageMsg: ChatMessage = {
    role: "user",
    content: "Was siehst du auf diesem Bild? Beschreibe Form und Farbe in einem Satz.",
    attachments: [
      { id: saved.id, type: "image", mimeType: saved.mimeType, ref: saved.ref },
    ],
  };

  try {
    console.log("\n=== 1) Form-Check (kein Netz nötig) ===");
    dumpShape("text-only", [{ role: "user", content: "hallo" }]);
    dumpShape("with-image", [imageMsg]);

    const cfg = loadTwinLlmConfig();
    if (!cfg.apiKey) {
      console.log("\nÜBERSPRUNGEN (Live-Calls) — kein LLM-API-Key in der Env.");
      return;
    }
    if (cfg.provider !== "anthropic") {
      console.log(
        `\n🔴 HINWEIS: provider='${cfg.provider}', nicht 'anthropic'. Setze ` +
          "LLM_PROVIDER=anthropic + einen vision-fähigen LLM_MODEL.",
      );
    }
    const model = createLlmClient(cfg);
    console.log(`\n   provider=${cfg.provider} model=${cfg.model}`);

    // ── 2) Live MIT Bild über den echten toModelMessages + Store-Pfad ──────────
    console.log("\n=== 2) Live — Message MIT Test-Bild (echter Store) ===");
    const a = await generateText({
      model,
      system: "Du bist ein knapper, ehrlicher Test-Assistent. Erfinde nichts.",
      messages: toModelMessages([imageMsg], TEST_TWIN),
    });
    const aText = a.text.replace(/\s+/g, " ").trim();
    console.log(`  Antwort: ${aText || "(leer)"}`);
    const sawCircle = /kreis|circle|rund|round|punkt|scheibe|rot|red/i.test(aText);
    console.log(`  → beschreibt roten Kreis: ${sawCircle ? "✅" : "❌"}`);

    // ── 3) Regression: reiner Text ──────────────────────────────────────────────
    console.log("\n=== 3) Regression — reiner Text (ohne attachments) ===");
    const b = await generateText({
      model,
      system: "Du bist ein knapper Test-Assistent.",
      messages: toModelMessages(
        [{ role: "user", content: "Sag nur: hallo zurück." }],
        TEST_TWIN,
      ),
    });
    console.log(`  Antwort: ${b.text.replace(/\s+/g, " ").trim() || "(leer)"}`);
    console.log("  → Text-Pfad unverändert (kein Fehler beim Bau): ✅");

    console.log("\n=== BEFUND ===");
    console.log(
      sawCircle
        ? "✅ SS3a GRÜN: Anthropic sieht das Test-Bild über toModelMessages + echten Store; Text-Regression ok."
        : "🟡 Anthropic-Antwort manuell prüfen (Heuristik nicht getroffen).",
    );
  } finally {
    // Test-Store-Ordner aufräumen.
    rmSync(resolve(getAttachmentStoreDir(), TEST_TWIN), {
      recursive: true,
      force: true,
    });
  }
}

main().catch((err) => {
  console.error("[ss3a] Fehler:", err instanceof Error ? err.message : err);
  process.exit(1);
});
