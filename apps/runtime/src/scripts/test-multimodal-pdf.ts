import "dotenv/config";
import { rmSync } from "node:fs";
import { resolve } from "node:path";
import { generateText } from "ai";
import type { LanguageModelV3Prompt } from "@ai-sdk/provider";
import type { ChatMessage } from "@nolmi/shared";
import { toModelMessages } from "../twin-service.js";
import { mapV3PromptToCodex } from "../oauth/codex-vercel-provider.js";
import {
  saveAttachment,
  getAttachmentStoreDir,
} from "../multimodal/attachment-store.js";
import {
  sniffAttachmentMime,
  ALLOWED_ATTACHMENT_MIME,
  validateAndSaveUpload,
} from "../multimodal/attachment-upload.js";
import { makeRedCirclePng } from "./red-circle-png.js";
import { loadTwinLlmConfig } from "../llm-config.js";
import { createLlmClient } from "../llm-client.js";

// ─── MULTIMODAL PDF — VERIFIKATION ───────────────────────────────────────────
// (1) Form-Check toModelMessages: document → FilePart, image → ImagePart.
// (2) Codex Form-Check: mapV3PromptToCodex document → input_file, image → input_image.
// (3) Live Anthropic: PDF mit Token → @markus nennt das Token.
// (4) Regression: image-Attachment → unverändert.

const TWIN = "pdf-test-twin";
const TOKEN = "NOLMI-PDF-TEST-7392";
let failed = 0;
function ok(label: string, cond: boolean) {
  if (!cond) failed++;
  console.log(`  ${cond ? "✅" : "❌"} ${label}`);
}

// Minimal-valides Token-PDF (wie der PDF-Spike, dep-frei).
function makeTokenPdf(token: string): Buffer {
  const content = `BT /F1 24 Tf 72 700 Td (${token} ist das geheime Token in diesem PDF.) Tj ET`;
  const objects: Record<number, string> = {
    1: "<< /Type /Catalog /Pages 2 0 R >>",
    2: "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    3: "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    4: "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    5: `<< /Length ${Buffer.byteLength(content, "latin1")} >>\nstream\n${content}\nendstream`,
  };
  let body = "%PDF-1.4\n";
  const offsets: Record<number, number> = {};
  for (let i = 1; i <= 5; i++) {
    offsets[i] = Buffer.byteLength(body, "latin1");
    body += `${i} 0 obj\n${objects[i]}\nendobj\n`;
  }
  const xrefStart = Buffer.byteLength(body, "latin1");
  let xref = "xref\n0 6\n0000000000 65535 f \n";
  for (let i = 1; i <= 5; i++) xref += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  const trailer = `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;
  return Buffer.from(body + xref + trailer, "latin1");
}

async function main() {
  const store = getAttachmentStoreDir();
  const pdf = makeTokenPdf(TOKEN);
  const png = makeRedCirclePng(64);
  const savedPdf = saveAttachment(TWIN, pdf, "application/pdf");
  const savedPng = saveAttachment(TWIN, png, "image/png");

  const pdfMsg: ChatMessage = {
    role: "user",
    content: "Welches Token steht in diesem Dokument? Zitiere den genauen Text.",
    attachments: [
      { id: savedPdf.id, type: "document", mimeType: "application/pdf", ref: savedPdf.ref, filename: "test.pdf" },
    ],
  };
  const imgMsg: ChatMessage = {
    role: "user",
    content: "Was siehst du?",
    attachments: [{ id: savedPng.id, type: "image", mimeType: "image/png", ref: savedPng.ref }],
  };

  try {
    // ── 1) toModelMessages-Form ──────────────────────────────────────────────
    console.log("=== 1) toModelMessages: document → FilePart, image → ImagePart ===");
    const pdfParts = (toModelMessages([pdfMsg], TWIN)[0] as { content: Array<Record<string, unknown>> }).content;
    const filePart = pdfParts.find((p) => p.type === "file");
    ok("document → {type:'file', mediaType:'application/pdf'}", !!filePart && filePart.mediaType === "application/pdf" && Buffer.isBuffer(filePart.data));
    ok("document FilePart trägt filename", filePart?.filename === "test.pdf");
    const imgParts = (toModelMessages([imgMsg], TWIN)[0] as { content: Array<Record<string, unknown>> }).content;
    ok("image → {type:'image'} (unverändert)", imgParts.some((p) => p.type === "image") && !imgParts.some((p) => p.type === "file"));

    // ── 2) Codex Form-Check ──────────────────────────────────────────────────
    console.log("\n=== 2) mapV3PromptToCodex: document → input_file, image → input_image ===");
    const b64 = pdf.toString("base64");
    const pdfPrompt: LanguageModelV3Prompt = [
      { role: "user", content: [{ type: "file", mediaType: "application/pdf", data: pdf, filename: "test.pdf" }] },
    ];
    const codexPdf = mapV3PromptToCodex(pdfPrompt).input[0] as { content: Array<Record<string, unknown>> };
    const inputFile = codexPdf.content.find((p) => p.type === "input_file");
    ok("document → input_file mit filename", inputFile?.filename === "test.pdf");
    ok("input_file file_data = data:application/pdf;base64,…", typeof inputFile?.file_data === "string" && (inputFile.file_data as string) === `data:application/pdf;base64,${b64}`);
    const imgPrompt: LanguageModelV3Prompt = [
      { role: "user", content: [{ type: "file", mediaType: "image/png", data: png }] },
    ];
    const codexImg = mapV3PromptToCodex(imgPrompt).input[0] as { content: Array<Record<string, unknown>> };
    ok("image → input_image (unverändert)", codexImg.content.some((p) => p.type === "input_image"));

    // ── 3) Live Anthropic: PDF lesen ─────────────────────────────────────────
    const cfg = loadTwinLlmConfig();
    if (!cfg.apiKey || cfg.provider !== "anthropic") {
      console.log(`\n=== 3) Live ÜBERSPRUNGEN (provider=${cfg.provider}, key=${!!cfg.apiKey}) ===`);
    } else {
      console.log("\n=== 3) Live Anthropic — liest das PDF? ===");
      const model = createLlmClient(cfg);
      const res = await generateText({
        model,
        system: "Du bist ein knapper, ehrlicher Test-Assistent. Zitiere genau.",
        messages: toModelMessages([pdfMsg], TWIN),
      });
      const t = res.text.replace(/\s+/g, " ").trim();
      console.log(`  Antwort: ${t}`);
      ok(`Antwort enthält Token ${TOKEN}`, t.toUpperCase().includes(TOKEN));

      console.log("\n=== 4) Regression — image (Anthropic beschreibt Bild) ===");
      const ri = await generateText({
        model,
        system: "Du bist ein knapper Test-Assistent.",
        messages: toModelMessages([imgMsg], TWIN),
      });
      const ti = ri.text.replace(/\s+/g, " ").trim();
      console.log(`  Antwort: ${ti}`);
      ok("image-Regression: beschreibt roten Kreis", /kreis|circle|rund|rot|red/i.test(ti));
    }

    // ── 5) Upload: PDF-Magic-Bytes (%PDF-) + Anti-Spoofing ───────────────────
    console.log("\n=== 5) Upload: PDF-Allowlist + Magic-Bytes ===");
    ok("sniffAttachmentMime(pdf) = application/pdf", sniffAttachmentMime(pdf) === "application/pdf");
    ok("ALLOWED_ATTACHMENT_MIME hat application/pdf", ALLOWED_ATTACHMENT_MIME.has("application/pdf"));
    ok("ALLOWED_ATTACHMENT_MIME hat weiter image/png", ALLOWED_ATTACHMENT_MIME.has("image/png"));
    const up = validateAndSaveUpload({ twinId: TWIN, buffer: pdf, claimedMimeType: "application/pdf", truncated: false, maxBytes: 20_000_000 });
    ok("PDF-Upload (%PDF-) → 200", up.status === 200);
    const spoof = validateAndSaveUpload({ twinId: TWIN, buffer: Buffer.from("kein pdf"), claimedMimeType: "application/pdf", truncated: false, maxBytes: 20_000_000 });
    ok("🔴 Nicht-PDF als application/pdf → 415", spoof.status === 415);

    console.log(`\n=== BEFUND: ${failed === 0 ? "✅ ALLE GRÜN" : `❌ ${failed} FEHLGESCHLAGEN`} ===`);
    if (failed > 0) process.exitCode = 1;
  } finally {
    rmSync(resolve(store, TWIN), { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error("[test-multimodal-pdf] Fehler:", err instanceof Error ? err.message : err);
  process.exit(1);
});
