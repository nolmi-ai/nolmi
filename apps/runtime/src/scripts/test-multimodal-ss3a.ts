import "dotenv/config";
import { generateText } from "ai";
import type { ChatMessage } from "@nolmi/shared";
import { toModelMessages } from "../twin-service.js";
import { loadTwinLlmConfig } from "../llm-config.js";
import { createLlmClient } from "../llm-client.js";

// ─── MULTIMODAL SS3a — VERIFIKATION (Anthropic-Pfad) ─────────────────────────
//
// Prüft den ECHTEN toModelMessages-Pfad (nicht standalone): eine User-Message
// mit attachments → Content-Array mit Image-Part → @ai-sdk/anthropic. Braucht
// einen lokalen Anthropic-Key (TWIN_LLM_*/LLM_*). Das Test-Bild kommt aus dem
// SS3a-Stub (loadAttachmentBytes ignoriert ref → roter Kreis).

function dumpShape(label: string, msgs: ChatMessage[]) {
  const model = toModelMessages(msgs);
  // Bytes nicht voll dumpen — nur Form zeigen.
  const shape = JSON.stringify(model, (k, v) => {
    if (k === "image" && v && typeof v === "object") {
      return `<Buffer ${(v as Buffer).length ?? "?"}B>`;
    }
    return v;
  });
  console.log(`  ${label}: ${shape}`);
}

async function main() {
  console.log("=== 1) Form-Check (kein Netz nötig) ===");
  // Regression: reiner Text → ein String-content (unverändert).
  dumpShape("text-only", [{ role: "user", content: "hallo" }]);
  // SS3a: mit Attachment → Content-Array [text, image].
  dumpShape("with-image", [
    {
      role: "user",
      content: "Was siehst du?",
      attachments: [
        {
          id: "att_test",
          type: "image",
          mimeType: "image/png",
          ref: "test",
          filename: "kreis.png",
        },
      ],
    },
  ]);

  const cfg = loadTwinLlmConfig();
  if (!cfg.apiKey) {
    console.log("\nÜBERSPRUNGEN (Live-Calls) — kein LLM-API-Key in der Env.");
    return;
  }
  if (cfg.provider !== "anthropic") {
    console.log(
      `\n🔴 HINWEIS: provider='${cfg.provider}', nicht 'anthropic'. SS3a testet den ` +
        "Anthropic-Pfad; setze LLM_PROVIDER=anthropic + einen vision-fähigen LLM_MODEL.",
    );
  }
  const model = createLlmClient(cfg);
  console.log(`\n   provider=${cfg.provider} model=${cfg.model}`);

  // ── 2) Live MIT Bild über den echten toModelMessages-Pfad ──────────────────
  console.log("\n=== 2) Live — Message MIT Test-Bild (echter toModelMessages-Pfad) ===");
  const withImage: ChatMessage[] = [
    {
      role: "user",
      content:
        "Was siehst du auf diesem Bild? Beschreibe Form und Farbe in einem Satz. " +
        "Wenn du kein Bild siehst, sag das klar.",
      attachments: [
        { id: "att_test", type: "image", mimeType: "image/png", ref: "test" },
      ],
    },
  ];
  const a = await generateText({
    model,
    system: "Du bist ein knapper, ehrlicher Test-Assistent. Erfinde nichts.",
    messages: toModelMessages(withImage),
  });
  const aText = a.text.replace(/\s+/g, " ").trim();
  console.log(`  Antwort: ${aText || "(leer)"}`);
  const sawCircle = /kreis|circle|rund|round|punkt|scheibe|rot|red/i.test(aText);
  console.log(`  → beschreibt roten Kreis: ${sawCircle ? "✅" : "❌"}`);

  // ── 3) Regression: reiner Text ─────────────────────────────────────────────
  console.log("\n=== 3) Regression — reiner Text 'hallo' (ohne attachments) ===");
  const b = await generateText({
    model,
    system: "Du bist ein knapper Test-Assistent.",
    messages: toModelMessages([{ role: "user", content: "Sag nur: hallo zurück." }]),
  });
  console.log(`  Antwort: ${b.text.replace(/\s+/g, " ").trim() || "(leer)"}`);
  console.log("  → Text-Pfad unverändert (kein Fehler beim Bau): ✅");

  console.log("\n=== BEFUND ===");
  console.log(
    sawCircle
      ? "✅ SS3a GRÜN: Anthropic sieht das Test-Bild über den echten toModelMessages-Pfad; Text-Regression ok."
      : "🟡 Anthropic-Antwort manuell prüfen (Heuristik nicht getroffen).",
  );
}

main().catch((err) => {
  console.error("[ss3a] Fehler:", err instanceof Error ? err.message : err);
  process.exit(1);
});
