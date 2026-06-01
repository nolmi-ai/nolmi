export interface EnvSecrets {
  encryptionKey: string;
  sessionSecret: string;
  bridgeToken: string;
}

/**
 * Erzeugt den `docker/nolmi/.env`-Inhalt — BYTE-IDENTISCH zu Schritt 4 von
 * install/install.sh (nur die Generator-Zeile im Kopfkommentar nennt den
 * Wrapper statt das Skript).
 *
 * ⚠ SINGLE SOURCE OF TRUTH bleibt bewusst install.sh: weicht die eine Seite
 * ab (neue Single-Host-Variable, anderer Default), MUSS die andere mitgezogen
 * werden. Driften beide, gibt es zwei Onboarding-Wege mit unterschiedlichem
 * Verhalten. Ein gemeinsamer Extract (z.B. ein von bash + Node gelesenes
 * .env-Template-File) ist als Folge-Item vorgeschlagen, aber hier bewusst
 * nicht gebaut (bash↔TS-Sharing wäre mehr Komplexität als Nutzen in Phase 1).
 *
 * Was NICHT hier steht (und warum): `NEXT_PUBLIC_DEPLOYMENT_LABEL=self-host`
 * und `SESSION_COOKIE_SECURE=false` liefert das Single-Host-Compose selbst
 * (Build-ARG bzw. hartkodiertes `environment:`) — die .env muss sie nicht
 * setzen. `SESSION_COOKIE_SECURE=false` steht hier trotzdem (1:1 install.sh,
 * Klarheit/Redundanz schadet nicht).
 */
export function buildEnvFile(host: string, s: EnvSecrets): string {
  return `# Nolmi Single-Host .env — AUTO-GENERIERT vom npm-Wrapper (nolmi onboard).
# NICHT committen, NICHT teilen.
#
# ⚠ NOLMI_ENCRYPTION_KEY UNBEDINGT SICHERN. Er verschlüsselt alle API-Keys und
#   OAuth-Tokens in der DB — ohne ihn sind diese Daten unwiederbringlich verloren.

NOLMI_ENCRYPTION_KEY=${s.encryptionKey}
NOLMI_SESSION_SECRET=${s.sessionSecret}
BRIDGE_REGISTER_TOKEN=${s.bridgeToken}

# Single-Host (kein TLS/Domain):
SESSION_COOKIE_DOMAIN=
SESSION_COOKIE_SECURE=false
TELEGRAM_USE_POLLING=true
RUNTIME_PUBLIC_URL=
ACTIVE_PROVIDER=anthropic

# Adresse, unter der dein Browser den Server erreicht (localhost ODER http://<server-ip>).
# Steckt im Web-Client-Bundle (#126) — bei Änderung Web neu bauen.
NEXT_PUBLIC_RUNTIME_URL=http://${host}:4000
`;
}
