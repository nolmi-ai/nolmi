import { randomBytes } from "node:crypto";

// Secret-Erzeugung via node:crypto statt openssl (eine der drei bewussten
// Abweichungen vom install.sh-Original — kein openssl-Zwang beim Self-Hoster).
// Die Formate sind byte-genau identisch zu install.sh:
//   openssl rand -base64 32  ≡  randomBytes(32).toString("base64")
//   openssl rand -hex 32     ≡  randomBytes(32).toString("hex")

/**
 * NOLMI_ENCRYPTION_KEY: 32 Byte, base64-kodiert. Format ist byte-genau das,
 * was `loadMasterKey` der Runtime erwartet (= `key:generate` / `openssl rand
 * -base64 32`). Verschlüsselt API-Keys + OAuth-Tokens in der DB.
 */
export function encryptionKey(): string {
  return randomBytes(32).toString("base64");
}

/** 32 Byte hex — für Session-Secret und Bridge-Register-Token. */
export function hex32(): string {
  return randomBytes(32).toString("hex");
}
