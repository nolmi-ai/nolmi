import "dotenv/config";
import { rmSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import Fastify from "fastify";
import multipart from "@fastify/multipart";
import { generateText } from "ai";
import type { ChatMessage } from "@nolmi/shared";
import { toModelMessages } from "../twin-service.js";
import { getAttachmentStoreDir } from "../multimodal/attachment-store.js";
import {
  sniffImageMime,
  validateAndSaveUpload,
  readUploadedFile,
} from "../multimodal/attachment-upload.js";
import { makeRedCirclePng } from "./red-circle-png.js";
import { loadTwinLlmConfig } from "../llm-config.js";
import { createLlmClient } from "../llm-client.js";

// ─── MULTIMODAL SS2b — VERIFIKATION ──────────────────────────────────────────
// (1) Unit: Magic-Bytes-Sniffer + validateAndSaveUpload-Status-Logik.
// (2) Inject: echter @fastify/multipart-Parse über DIESELBE readUploadedFile +
//     validateAndSaveUpload wie die Produktiv-Route (kein Mirror-Drift) →
//     200/400/413/415 inkl. MIME-Spoofing + Größen-Limit.
// (3) End-to-End: Upload-ref → Chat-Message → toModelMessages → Anthropic.
// requireOwner (403/401) ist der überall genutzte, unveränderte Helper.

const TWIN = "ss2b-test-twin";
const STORE = getAttachmentStoreDir();
let failed = 0;
function ok(label: string, cond: boolean) {
  if (!cond) failed++;
  console.log(`  ${cond ? "✅" : "❌"} ${label}`);
}

function multipartBody(boundary: string, filename: string, contentType: string, bytes: Buffer): Buffer {
  return Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${contentType}\r\n\r\n`),
    bytes,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
}

async function main() {
  const png = makeRedCirclePng(64);
  try {
    // ── 1) Unit: Sniffer ──────────────────────────────────────────────────────
    console.log("=== 1) Magic-Bytes-Sniffer ===");
    ok("PNG erkannt", sniffImageMime(png) === "image/png");
    ok("JPEG erkannt", sniffImageMime(Buffer.from([0xff, 0xd8, 0xff, 0x00])) === "image/jpeg");
    ok("GIF erkannt", sniffImageMime(Buffer.from("GIF89a")) === "image/gif");
    ok("WEBP erkannt", sniffImageMime(Buffer.concat([Buffer.from("RIFF"), Buffer.from([0, 0, 0, 0]), Buffer.from("WEBP")])) === "image/webp");
    ok("Text/Non-Image → null", sniffImageMime(Buffer.from("MZ\x90\x00 nicht ein bild")) === null);

    // ── 1b) Unit: validateAndSaveUpload-Status ────────────────────────────────
    console.log("\n=== 1b) validateAndSaveUpload-Status ===");
    ok("truncated → 413", validateAndSaveUpload({ twinId: TWIN, buffer: png, claimedMimeType: "image/png", truncated: true, maxBytes: 100 }).status === 413);
    ok("kein Buffer → 400", validateAndSaveUpload({ twinId: TWIN, buffer: null, claimedMimeType: "image/png", truncated: false, maxBytes: 100 }).status === 400);
    ok("Non-Image-Bytes → 415", validateAndSaveUpload({ twinId: TWIN, buffer: Buffer.from("nicht bild"), claimedMimeType: "image/png", truncated: false, maxBytes: 100 }).status === 415);
    ok("🔴 Spoof (echt PNG, gemeldet image/gif) → 415", validateAndSaveUpload({ twinId: TWIN, buffer: png, claimedMimeType: "image/gif", truncated: false, maxBytes: 100 }).status === 415);
    ok("Nicht-erlaubter Content-Type → 415", validateAndSaveUpload({ twinId: TWIN, buffer: png, claimedMimeType: "application/pdf", truncated: false, maxBytes: 100 }).status === 415);
    const okRes = validateAndSaveUpload({ twinId: TWIN, buffer: png, claimedMimeType: "image/png", truncated: false, maxBytes: 1_000_000 });
    ok("Valides PNG → 200 + ref", okRes.status === 200 && "ref" in okRes.body);

    // ── 2) Inject: echter multipart-Parse über die Produktiv-Funktionen ───────
    console.log("\n=== 2) Inject (echtes @fastify/multipart, kleine fileSize) ===");
    const app = Fastify();
    const TEST_MAX = 5000; // klein → Oversize-Test triggert
    await app.register(multipart, { limits: { fileSize: TEST_MAX, files: 1 } });
    app.post("/upload", async (request, reply) => {
      let parsed;
      try {
        parsed = await readUploadedFile(request);
      } catch (err) {
        return reply.status(400).send({ error: String(err) });
      }
      const r = validateAndSaveUpload({
        twinId: TWIN,
        buffer: parsed.buffer,
        claimedMimeType: parsed.claimedMimeType,
        truncated: parsed.truncated,
        maxBytes: TEST_MAX,
      });
      return reply.status(r.status).send(r.body);
    });

    const B = "----nolmiss2b";
    // (a) valides PNG → 200 + ref, Datei auf Platte
    const rOk = await app.inject({
      method: "POST", url: "/upload",
      headers: { "content-type": `multipart/form-data; boundary=${B}` },
      payload: multipartBody(B, "kreis.png", "image/png", png),
    });
    const refBody = rOk.json() as { ref?: string };
    ok("valides PNG → 200", rOk.statusCode === 200);
    ok("Antwort enthält ref", typeof refBody.ref === "string");
    ok("Datei liegt im twinId-Ordner", !!refBody.ref && existsSync(resolve(STORE, TWIN, refBody.ref)));

    // (b) 🔴 MIME-Spoofing: Text-Bytes, Content-Type image/png → 415
    const rSpoof = await app.inject({
      method: "POST", url: "/upload",
      headers: { "content-type": `multipart/form-data; boundary=${B}` },
      payload: multipartBody(B, "evil.png", "image/png", Buffer.from("MZ das ist keine PNG-Datei")),
    });
    ok("🔴 Spoofing (Text als image/png) → 415", rSpoof.statusCode === 415);

    // (c) Größen-Limit: > TEST_MAX → 413
    const big = Buffer.concat([png, Buffer.alloc(TEST_MAX, 0x41)]);
    const rBig = await app.inject({
      method: "POST", url: "/upload",
      headers: { "content-type": `multipart/form-data; boundary=${B}` },
      payload: multipartBody(B, "big.png", "image/png", big),
    });
    ok("zu groß → 413 (kein Crash)", rBig.statusCode === 413);

    // (d) kein File → 400
    const rEmpty = await app.inject({
      method: "POST", url: "/upload",
      headers: { "content-type": `multipart/form-data; boundary=${B}` },
      payload: `--${B}--\r\n`,
    });
    ok("kein File → 400", rEmpty.statusCode === 400);
    await app.close();

    console.log(`\n  Zwischenstand: ${failed === 0 ? "✅ Endpoint-Logik grün" : `❌ ${failed} fehlgeschlagen`}`);

    // ── 3) End-to-End: Upload-ref → Chat → Modell ─────────────────────────────
    console.log("\n=== 3) End-to-End (Upload→Store→Chat→Modell) ===");
    const cfg = loadTwinLlmConfig();
    if (!cfg.apiKey) {
      console.log("  ÜBERSPRUNGEN (Live) — kein LLM-API-Key in der Env.");
    } else if (!refBody.ref) {
      console.log("  ÜBERSPRUNGEN — kein ref aus dem Upload.");
    } else {
      const model = createLlmClient(cfg);
      const msg: ChatMessage = {
        role: "user",
        content: "Was siehst du auf diesem Bild? Form und Farbe, ein Satz.",
        attachments: [{ id: refBody.ref, type: "image", mimeType: "image/png", ref: refBody.ref }],
      };
      const res = await generateText({
        model,
        system: "Du bist ein knapper, ehrlicher Test-Assistent. Erfinde nichts.",
        messages: toModelMessages([msg], TWIN),
      });
      const t = res.text.replace(/\s+/g, " ").trim();
      console.log(`  provider=${cfg.provider} Antwort: ${t}`);
      ok("Modell beschreibt roten Kreis (Upload→Modell)", /kreis|circle|rund|rot|red/i.test(t));
    }

    console.log(`\n=== BEFUND: ${failed === 0 ? "✅ ALLE GRÜN" : `❌ ${failed} FEHLGESCHLAGEN`} ===`);
    if (failed > 0) process.exitCode = 1;
  } finally {
    rmSync(resolve(STORE, TWIN), { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error("[ss2b] Fehler:", err instanceof Error ? err.message : err);
  process.exit(1);
});
