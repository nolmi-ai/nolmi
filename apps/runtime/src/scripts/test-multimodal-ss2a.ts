import "dotenv/config";
import { rmSync } from "node:fs";
import { resolve } from "node:path";
import {
  saveAttachment,
  loadAttachmentBytes,
  getAttachmentStoreDir,
} from "../multimodal/attachment-store.js";
import { makeRedCirclePng } from "./red-circle-png.js";

// ─── MULTIMODAL SS2a — STORE-VERIFIKATION (kein Netz) ────────────────────────
// Beweist: Roundtrip (save→load), 🔴 harte twinId-Isolation (Weg B) und
// Pfad-Traversal-Guard. Deterministisch, ohne LLM.

const TWIN_A = "ss2a-twin-A";
const TWIN_B = "ss2a-twin-B";
let failed = 0;

function ok(label: string, cond: boolean) {
  if (!cond) failed++;
  console.log(`  ${cond ? "✅" : "❌"} ${label}`);
}

function main() {
  const png = makeRedCirclePng(64);
  try {
    // ── 1) Roundtrip ───────────────────────────────────────────────────────────
    console.log("=== 1) Save → Load Roundtrip (twin A) ===");
    const saved = saveAttachment(TWIN_A, png, "image/png");
    ok("ref ist server-generiert (att_…)", /^att_[\w-]{16}$/.test(saved.ref));
    ok("sizeBytes == PNG-Länge", saved.sizeBytes === png.length);
    ok("mimeType durchgereicht", saved.mimeType === "image/png");
    const loaded = loadAttachmentBytes(TWIN_A, saved.ref);
    ok("geladene Bytes == gespeicherte Bytes", Buffer.compare(loaded, png) === 0);

    // ── 2) 🔴 Harte Isolation: fremder twinId darf NICHT laden ───────────────────
    console.log("\n=== 2) 🔴 Isolation (Weg B) — fremder twinId wirft ===");
    let threwCross = false;
    try {
      loadAttachmentBytes(TWIN_B, saved.ref); // ref von A, aber twin B fragt
    } catch {
      threwCross = true;
    }
    ok("loadAttachmentBytes(twin-B, ref-von-A) wirft (kein Cross-Twin-Read)", threwCross);

    // ── 3) Pfad-Traversal-Guard ──────────────────────────────────────────────────
    console.log("\n=== 3) Pfad-Traversal wirft ===");
    let threwTraversal = false;
    try {
      loadAttachmentBytes(TWIN_A, `../${TWIN_B}/${saved.ref}`);
    } catch {
      threwTraversal = true;
    }
    ok("loadAttachmentBytes(twin-A, '../twin-B/ref') wirft (Prefix-Guard)", threwTraversal);

    let threwAbs = false;
    try {
      loadAttachmentBytes(TWIN_A, "/etc/passwd");
    } catch {
      threwAbs = true;
    }
    ok("absoluter ref '/etc/passwd' wirft", threwAbs);

    console.log(`\n=== BEFUND: ${failed === 0 ? "✅ ALLE GRÜN — Store + harte Isolation belegt" : `❌ ${failed} FEHLGESCHLAGEN`} ===`);
    if (failed > 0) process.exitCode = 1;
  } finally {
    const dir = getAttachmentStoreDir();
    rmSync(resolve(dir, TWIN_A), { recursive: true, force: true });
    rmSync(resolve(dir, TWIN_B), { recursive: true, force: true });
  }
}

main();
