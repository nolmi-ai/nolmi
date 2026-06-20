import type { FastifyRequest } from "fastify";
import "@fastify/multipart"; // Typ-Augmentation für request.file()
import { saveAttachment, type SavedAttachment } from "./attachment-store.js";

// ─── ATTACHMENT-UPLOAD (Multimodal SS2b — HTTP-Validierung + Save) ───────────
//
// 🔴 Upload = Angriffsfläche. Zwei-Ebenen-MIME-Prüfung: gemeldeter Content-Type
// MUSS in der Allowlist sein UND mit den echten Magic-Bytes übereinstimmen
// (verhindert „.exe als image/png getarnt"). Größen-Limit greift schon im
// @fastify/multipart-Plugin (limits.fileSize); hier wird das `truncated`-Flag
// sauber zu 413 (kein Crash). Die reine Logik (post-parse) ist von der Fastify-
// Route getrennt → unit-testbar ohne HTTP.

/** Erlaubte Bild-MIME-Typen (kanonisch). */
export const ALLOWED_IMAGE_MIME = new Set<string>([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
]);

/**
 * Erkennt das echte Bildformat anhand der Magic-Bytes (nicht des behaupteten
 * Content-Type). Gibt den kanonischen MIME zurück oder null, wenn kein
 * erlaubtes Bildformat erkannt wird.
 */
export function sniffImageMime(buf: Buffer): string | null {
  if (buf.length >= 8 &&
    buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47 &&
    buf[4] === 0x0d && buf[5] === 0x0a && buf[6] === 0x1a && buf[7] === 0x0a) {
    return "image/png";
  }
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return "image/jpeg";
  }
  // GIF87a / GIF89a → "GIF8"
  if (buf.length >= 4 &&
    buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x38) {
    return "image/gif";
  }
  // WEBP: "RIFF" (0..3) + "WEBP" (8..11)
  if (buf.length >= 12 &&
    buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 &&
    buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50) {
    return "image/webp";
  }
  return null;
}

/**
 * Liest die EINE Upload-Datei aus dem multipart-Request. Kapselt die
 * @fastify/multipart-Mechanik (request.file → toBuffer) inkl. Größen-
 * Überschreitung (FST_REQ_FILE_TOO_LARGE / file.truncated → `truncated:true`).
 * Von der Route UND dem Test genutzt → kein Mirror-Drift. Wirft nur bei echten
 * Parse-Fehlern (kein multipart-Body); der Caller mappt das auf 400.
 */
export async function readUploadedFile(request: FastifyRequest): Promise<{
  buffer: Buffer | null;
  truncated: boolean;
  claimedMimeType: string | undefined;
}> {
  let buffer: Buffer | null = null;
  let truncated = false;
  let claimedMimeType: string | undefined;
  const data = await request.file();
  if (data) {
    claimedMimeType = data.mimetype;
    try {
      buffer = await data.toBuffer();
    } catch (err) {
      if ((err as { code?: string })?.code === "FST_REQ_FILE_TOO_LARGE") {
        truncated = true;
      } else {
        throw err;
      }
    }
    truncated = truncated || data.file.truncated;
  }
  return { buffer, truncated, claimedMimeType };
}

export type UploadResult =
  | { status: 200; body: SavedAttachment }
  | { status: 400 | 413 | 415; body: { error: string } };

/**
 * Validiert eine bereits geparste Upload-Datei und legt sie (bei Erfolg) im
 * twinId-isolierten Store ab. Reine Funktion → unit-testbar ohne Fastify.
 *
 * Reihenfolge: truncated(413) → leer/kein File(400) → Magic-Bytes(415) →
 * Allowlist(415) → Übereinstimmung gemeldet==echt(415) → save(200).
 */
export function validateAndSaveUpload(opts: {
  twinId: string;
  buffer: Buffer | null;
  claimedMimeType: string | undefined;
  truncated: boolean;
  maxBytes: number;
}): UploadResult {
  if (opts.truncated) {
    return { status: 413, body: { error: `Datei zu groß (max ${opts.maxBytes} Bytes)` } };
  }
  if (!opts.buffer || opts.buffer.length === 0) {
    return { status: 400, body: { error: "Keine Datei im Upload (Feld 'file' fehlt oder leer)" } };
  }
  const sniffed = sniffImageMime(opts.buffer);
  if (!sniffed) {
    return { status: 415, body: { error: "Kein erkanntes Bildformat (nur png/jpeg/webp/gif)" } };
  }
  const claimed = opts.claimedMimeType;
  if (!claimed || !ALLOWED_IMAGE_MIME.has(claimed)) {
    return { status: 415, body: { error: `Content-Type nicht erlaubt: ${claimed ?? "(keiner)"}` } };
  }
  // 🔴 Anti-Spoofing: gemeldeter Typ muss zu den echten Bytes passen.
  if (claimed !== sniffed) {
    return {
      status: 415,
      body: { error: `Content-Type (${claimed}) stimmt nicht mit echten Bytes (${sniffed}) überein` },
    };
  }
  const saved = saveAttachment(opts.twinId, opts.buffer, sniffed);
  return { status: 200, body: saved };
}
