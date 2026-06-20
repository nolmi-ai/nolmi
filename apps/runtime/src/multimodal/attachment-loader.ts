import { deflateSync } from "node:zlib";

// ─── ATTACHMENT-LOADER (Multimodal SS3a — Storage-Naht) ──────────────────────
//
// Klare Schnittstelle zwischen Message-Bau (SS3) und Storage (SS2). `toModel-
// Messages` ruft NUR `loadAttachmentBytes(ref)` — woher die Bytes kommen, ist
// hier gekapselt. 🔴 Bytes werden NIE in der Message/Audit persistiert (Schema
// hält nur die `ref`, Diagnose-Befund C); sie werden erst hier, zur Call-Zeit,
// geladen.
//
// 🔴 SS3a-STAND: TEST-STUB. `loadAttachmentBytes` ignoriert `ref` und liefert
// immer ein fest verdrahtetes Test-PNG (roter Kreis auf weiß, wie im Codex-
// Spike d5e757e). Das beweist den Message-Bau-Pfad Ende-zu-Ende, OHNE dass der
// /data-Store schon existiert.
//   TODO SS2: ref = Pfad/ID im /data-Store → echtes Laden, z.B.
//     return readFileSync(resolve(ATTACHMENT_STORE_DIR, ref));
//   plus Guards (Pfad-Traversal, Größe, MIME-Whitelist) — analog web_fetch.

/**
 * Lädt die Roh-Bytes eines Attachments anhand seiner Store-Referenz.
 *
 * 🔴 SS3a: TEST-Implementierung — gibt immer das Test-PNG zurück, `ref` wird
 * (noch) ignoriert. SS2 ersetzt den Body durch echten /data-Store-Zugriff;
 * die Signatur (`ref` → `Buffer`) bleibt stabil.
 */
export function loadAttachmentBytes(ref: string): Buffer {
  // SS3a: ref bewusst ungenutzt — markiert die Naht, die SS2 füllt.
  void ref;
  return makeRedCirclePng(64);
}

// ─── TEST-PNG-Encoder (RGBA, color type 6, dep-frei) — NUR SS3a-Stub ─────────
// Identisch zum Spike (d5e757e): roter, gefüllter Kreis auf weißem Grund.
// 🔴 Wird mit SS2 (echter Store) überflüssig und entfernt.

const CRC_TABLE: number[] = (() => {
  const table: number[] = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    const byte = buf[i] ?? 0;
    c = (CRC_TABLE[(c ^ byte) & 0xff] ?? 0) ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, "ascii");
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

/** Erzeugt ein erkennbares Test-PNG: roter Kreis auf weißem Grund. */
export function makeRedCirclePng(size = 64): Buffer {
  const r = size / 2 - 4;
  const cx = size / 2;
  const cy = size / 2;
  const raw = Buffer.alloc(size * (1 + size * 4));
  let p = 0;
  for (let y = 0; y < size; y++) {
    raw[p++] = 0; // Filter: None
    for (let x = 0; x < size; x++) {
      const dx = x + 0.5 - cx;
      const dy = y + 0.5 - cy;
      const inside = dx * dx + dy * dy <= r * r;
      if (inside) {
        raw[p++] = 220;
        raw[p++] = 30;
        raw[p++] = 30;
        raw[p++] = 255;
      } else {
        raw[p++] = 255;
        raw[p++] = 255;
        raw[p++] = 255;
        raw[p++] = 255;
      }
    }
  }

  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const idat = deflateSync(raw);
  return Buffer.concat([
    sig,
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", idat),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}
