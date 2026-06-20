import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { resolve, sep } from "node:path";
import { nanoid } from "nanoid";
import { resolveWorkspacePath } from "../config.js";

// ─── ATTACHMENT-STORE (Multimodal SS2a — Filesystem-Store, twinId-isoliert) ──
//
// Filesystem-Store für Chat-Anhänge (Bilder). Layout: <STORE_DIR>/<twinId>/<id>.
// 🔴 HARTE ISOLATION (Weg B): geladen wird NUR aus dem Ordner des anfragenden
// Twins. `twinId` ist server-kontrolliert (this.deps.twinId in runModel), NIE
// client-gewählt → ein Owner kommt nicht an die Anhänge eines fremden Twins,
// selbst wenn er einen fremden `ref` in seinen Chat injiziert (sucht unter
// SEINEM twinId-Ordner → ENOENT).
//
// 🔴 Bytes leben NUR hier; die Message/Audit hält bloß die `ref` (Schema-
// Befund C). Der `mediaType` kommt aus dem Schema-Feld (Attachment.mimeType),
// nicht aus der Datei. Sync (readFileSync/writeFileSync) ist die SS3a-
// Entscheidung — lokales Volume, kleine Files, hält toModelMessages synchron.

// STORE_DIR analog `dbPath` (config.ts). Prod: ATTACHMENT_STORE_DIR=/data/
// attachments (im persistenten nolmi-runtime-data-Volume); lokal Default
// <repo>/data/attachments. Der <twinId>-Unterordner entsteht bei saveAttachment.
const STORE_DIR = resolveWorkspacePath(
  process.env.ATTACHMENT_STORE_DIR,
  "data/attachments",
);

/** Store-Wurzel — für Tests/Diagnose. */
export function getAttachmentStoreDir(): string {
  return STORE_DIR;
}

export interface SavedAttachment {
  id: string;
  ref: string;
  mimeType: string;
  sizeBytes: number;
}

/**
 * Legt Bytes im Store des Twins ab und gibt eine server-generierte Referenz
 * zurück. `id`/`ref` sind identisch (unrätbarer nanoid, traversal-frei).
 * Wird in SS2b vom Upload-Endpoint genutzt; hier schon gebaut + getestet.
 */
export function saveAttachment(
  twinId: string,
  bytes: Buffer,
  mimeType: string,
): SavedAttachment {
  const id = `att_${nanoid(16)}`;
  const ref = id;
  const dir = resolve(STORE_DIR, twinId);
  mkdirSync(dir, { recursive: true });
  const p = resolve(dir, ref);
  // Defensiv: ref ist server-generiert (kein /..), Guard schadet nicht.
  if (p !== dir + sep + ref) {
    throw new Error("ungültige Attachment-Referenz beim Speichern");
  }
  writeFileSync(p, bytes);
  return { id, ref, mimeType, sizeBytes: bytes.length };
}

/**
 * Lädt die Roh-Bytes eines Attachments aus dem Ordner DIESES Twins.
 *
 * 🔴 Harte Isolation: `ref` muss im <twinId>-Ordner liegen. Pfad-Traversal
 * (`../`) wird vom Prefix-Guard geworfen; ein fremder `ref` (anderer Twin)
 * existiert hier nicht → readFileSync wirft ENOENT. Sync (SS3a-Entscheidung).
 */
export function loadAttachmentBytes(twinId: string, ref: string): Buffer {
  const dir = resolve(STORE_DIR, twinId);
  const p = resolve(dir, ref);
  if (!p.startsWith(dir + sep)) {
    throw new Error(`ungültige Attachment-Referenz: ${ref}`);
  }
  return readFileSync(p);
}
