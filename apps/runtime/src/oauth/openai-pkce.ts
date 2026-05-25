import crypto from "node:crypto";

// ─── OPENAI-OAUTH PKCE-CLIENT (#131 PHASE 1) ────────────────────────────────
//
// Stateless PKCE-Flow-Helpers für OpenAI Codex OAuth (Subscription-Auth).
// Reverse-engineered aus OpenAI Codex Auth-Doku (developers.openai.com/codex/auth)
// + OpenCode/RooCode Public-Implementations.
//
// Constants sind hardcoded (Recherche Tag 27): Client-ID gehört OpenAI's
// Codex-Public-Client, Redirect-URI ist serverseitig hardcoded auf
// `http://localhost:1455/auth/callback` — kein Custom-Redirect möglich,
// daher SSH-Tunnel-Pattern für VPS-Setups (siehe Strategy §a).
//
// Spec: docs/131-OAUTH-STRATEGY.md (Recherche-Findings + Architektur)

export const OPENAI_OAUTH_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
export const OPENAI_OAUTH_AUTHORIZE_URL = "https://auth.openai.com/oauth/authorize";
export const OPENAI_OAUTH_TOKEN_URL = "https://auth.openai.com/oauth/token";
export const OPENAI_OAUTH_REDIRECT_URI = "http://localhost:1455/auth/callback";
export const OPENAI_OAUTH_SCOPE = "openid profile email offline_access";

export interface PKCECodes {
  codeVerifier: string;
  codeChallenge: string;
}

export interface OAuthTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  token_type: string;
  account_id?: string;
}

/**
 * PKCE-Codes-Generator (RFC 7636 S256).
 * codeVerifier: 32 zufällige Bytes base64url-encoded.
 * codeChallenge: SHA256(codeVerifier) base64url-encoded.
 */
export function generatePKCECodes(): PKCECodes {
  const verifierBytes = crypto.randomBytes(32);
  const codeVerifier = base64UrlEncode(verifierBytes);
  const challengeBytes = crypto
    .createHash("sha256")
    .update(codeVerifier)
    .digest();
  const codeChallenge = base64UrlEncode(challengeBytes);
  return { codeVerifier, codeChallenge };
}

/** State-Parameter für CSRF-Protection (16 Random Bytes, base64url). */
export function generateState(): string {
  return base64UrlEncode(crypto.randomBytes(16));
}

/**
 * Auth-URL für Browser-Redirect zu OpenAI.
 *
 * Manuelle Query-String-Construction nötig: OpenAI's Auth-Server erwartet
 * `+` für Spaces (URLSearchParams encoded zu `%20`, was Auth-API-Failure
 * verursacht). Quelle: OpenCode/RooCode Implementation-Issues.
 */
export function buildAuthUrl(codeChallenge: string, state: string): string {
  const params = [
    `response_type=code`,
    `client_id=${OPENAI_OAUTH_CLIENT_ID}`,
    `redirect_uri=${encodeURIComponent(OPENAI_OAUTH_REDIRECT_URI)}`,
    `scope=${OPENAI_OAUTH_SCOPE.replace(/ /g, "+")}`,
    `code_challenge=${codeChallenge}`,
    `code_challenge_method=S256`,
    `state=${state}`,
    `id_token_add_organizations=true`,
    `codex_cli_simplified_flow=true`,
  ];
  return `${OPENAI_OAUTH_AUTHORIZE_URL}?${params.join("&")}`;
}

/** Auth-Code + Verifier → Access/Refresh-Token. Wirft bei non-2xx. */
export async function exchangeCodeForToken(
  code: string,
  codeVerifier: string,
): Promise<OAuthTokenResponse> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: OPENAI_OAUTH_CLIENT_ID,
    code,
    code_verifier: codeVerifier,
    redirect_uri: OPENAI_OAUTH_REDIRECT_URI,
  });

  const res = await fetch(OPENAI_OAUTH_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(
      `OAuth-Token-Exchange-Failure: ${res.status} ${errText}`,
    );
  }

  return (await res.json()) as OAuthTokenResponse;
}

/** Refresh-Token → neuer Access-Token. Wirft bei non-2xx. */
export async function refreshAccessToken(
  refreshToken: string,
): Promise<OAuthTokenResponse> {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    client_id: OPENAI_OAUTH_CLIENT_ID,
    refresh_token: refreshToken,
  });

  const res = await fetch(OPENAI_OAUTH_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`OAuth-Refresh-Failure: ${res.status} ${errText}`);
  }

  return (await res.json()) as OAuthTokenResponse;
}

function base64UrlEncode(buffer: Buffer): string {
  return buffer
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
}
