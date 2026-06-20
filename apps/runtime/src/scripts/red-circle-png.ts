import { deflateSync } from "node:zlib";

// ─── TEST-PNG-Encoder (RGBA, color type 6, dep-frei) — NUR für Tests ─────────
// Erzeugt ein erkennbares Test-Bild: roter, gefüllter Kreis auf weißem Grund.
// Aus dem SS3a-Loader-Stub (4da9152) hierher verschoben, als der echte Store
// (attachment-store.ts) den Stub ersetzt hat. Identisch zum Codex-Spike
// (d5e757e). KEIN Produktiv-Code — nur Test-/Spike-Fixture.

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
