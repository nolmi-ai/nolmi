import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { getEnv } from "@nolmi/shared/env";

// ─── ENCRYPTION UTILS ────────────────────────────────────────────────────────
//
// AES-256-GCM für API-Keys in `twin_profiles.llm_config.apiKeyEncrypted`.
// Master-Key kommt aus `NOLMI_ENCRYPTION_KEY` (Base64-encoded 32 Bytes).
// Aliasing: `TWIN_LAB_ENCRYPTION_KEY` wird via getEnv noch als Fallback
// gelesen (6–12 Monate, dann Hart-Cut).
//
// Storage-Format pro Geheimnis:
//   base64(iv) ":" base64(authTag) ":" base64(ciphertext)
//
// IV: 12 Bytes (GCM-Standard, 96 bit). AuthTag: 16 Bytes (GCM-default).
// AuthTag-Validation greift im decipher.final() — wirft bei Tampering.

const ALGO = "aes-256-gcm";
const IV_BYTES = 12;
const KEY_BYTES = 32;
const SEPARATOR = ":";

export class EncryptionKeyMissingError extends Error {
  constructor(detail: string) {
    super(
      `NOLMI_ENCRYPTION_KEY (oder deprecated TWIN_LAB_ENCRYPTION_KEY) ${detail}.\n` +
        `Hinweis: 'pnpm --filter @nolmi/runtime key:generate' erzeugt einen passenden Key.`,
    );
    this.name = "EncryptionKeyMissingError";
  }
}

export class EncryptionDecryptError extends Error {
  constructor(reason: string) {
    super(`Entschlüsselung fehlgeschlagen: ${reason}`);
    this.name = "EncryptionDecryptError";
  }
}

/**
 * Erzeugt einen frischen 32-Byte-Master-Key, base64-encoded. Nur für das
 * `key:generate`-CLI — zur Laufzeit nicht aufgerufen.
 */
export function generateMasterKey(): string {
  return randomBytes(KEY_BYTES).toString("base64");
}

/**
 * Liest NOLMI_ENCRYPTION_KEY (Fallback: TWIN_LAB_ENCRYPTION_KEY), parsed
 * als Base64, validiert auf 32 Bytes. Wirft `EncryptionKeyMissingError`
 * mit klarer Diagnose, wenn fehlend oder falsche Länge — Boot fängt das
 * und exit-1't.
 */
export function loadMasterKey(): Buffer {
  const raw = getEnv("NOLMI_ENCRYPTION_KEY", "TWIN_LAB_ENCRYPTION_KEY")?.trim();
  if (!raw) {
    throw new EncryptionKeyMissingError("ist nicht in der Umgebung gesetzt");
  }
  let buf: Buffer;
  try {
    buf = Buffer.from(raw, "base64");
  } catch {
    throw new EncryptionKeyMissingError("ist kein gültiges Base64");
  }
  if (buf.length !== KEY_BYTES) {
    throw new EncryptionKeyMissingError(
      `muss 32 Bytes (Base64-encoded) sein, ist aber ${buf.length} Bytes`,
    );
  }
  return buf;
}

export function encrypt(plaintext: string, masterKey: Buffer): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGO, masterKey, iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();
  return [iv, authTag, ciphertext]
    .map((b) => b.toString("base64"))
    .join(SEPARATOR);
}

export function decrypt(encrypted: string, masterKey: Buffer): string {
  const parts = encrypted.split(SEPARATOR);
  if (parts.length !== 3) {
    throw new EncryptionDecryptError(
      `Format-Fehler: erwartet 'iv:tag:ct', got ${parts.length} Teile`,
    );
  }
  const [ivB64, tagB64, ctB64] = parts as [string, string, string];
  let iv: Buffer, authTag: Buffer, ciphertext: Buffer;
  try {
    iv = Buffer.from(ivB64, "base64");
    authTag = Buffer.from(tagB64, "base64");
    ciphertext = Buffer.from(ctB64, "base64");
  } catch (err) {
    throw new EncryptionDecryptError(
      `Base64-Parse fehlgeschlagen: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  if (iv.length !== IV_BYTES) {
    throw new EncryptionDecryptError(
      `IV muss ${IV_BYTES} Bytes haben, ist ${iv.length}`,
    );
  }
  const decipher = createDecipheriv(ALGO, masterKey, iv);
  decipher.setAuthTag(authTag);
  try {
    const plaintext = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]);
    return plaintext.toString("utf8");
  } catch (err) {
    // GCM auth-tag mismatch landet hier — meistens falscher Master-Key oder
    // korrupter Ciphertext.
    throw new EncryptionDecryptError(
      `AuthTag-Mismatch oder korrupter Ciphertext (${err instanceof Error ? err.message : String(err)})`,
    );
  }
}

/**
 * Maskiert einen API-Key für UI/Logs: erste 4 + "…" + letzte 4 Zeichen.
 * Funktioniert für alle gängigen Formate (sk-ant-…, sk-…, AIza…) — der
 * Sinn ist Wiedererkennung, nicht Provider-Identifikation. Bei <9 Zeichen
 * nur "…", weil die "Maske" sonst so viel preisgibt wie der Klartext.
 */
export function maskApiKey(apiKey: string): string {
  if (apiKey.length < 9) return "…";
  return `${apiKey.slice(0, 4)}…${apiKey.slice(-4)}`;
}
