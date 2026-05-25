import type Database from "better-sqlite3";
import { nanoid } from "nanoid";
import { decrypt, encrypt } from "../crypto-utils.js";

// ─── OAUTH-TOKENS REPOSITORY (#131 PHASE 1) ─────────────────────────────────
//
// Eine Row pro (twin_id, provider). Access- und Refresh-Token AES-256-GCM-
// encrypted via crypto-utils (Pattern analog TelegramConfigsRepo + McpServersRepo).
// Klartext kommt ausschließlich über die mapRow()-Decryption-Schicht raus,
// damit Tokens nie versehentlich in API-Responses oder Logs landen.
//
// Phase 1: nur Provider 'openai'. CHECK-Constraint in der Migration hält
// die Discriminator-Disziplin für Phase B (z.B. zusätzlich 'anthropic').
//
// Spec: docs/131-OAUTH-STRATEGY.md §c (Storage) + §b (Exklusiver Auth-Mode).

export type OAuthProvider = "openai";

export interface OAuthTokenRow {
  id: string;
  twin_id: string;
  provider: OAuthProvider;
  access_token_encrypted: string;
  refresh_token_encrypted: string;
  expires_at: string;
  account_id: string | null;
  created_at: string;
  updated_at: string;
}

/** Decrypted Sicht für interne Konsumenten (Provider-Layer, Refresh-Service). */
export interface OAuthTokenDecrypted {
  id: string;
  twinId: string;
  provider: OAuthProvider;
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
  accountId: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Owner-Safe-View ohne Token-Klartext. Für Settings-UI + Status-APIs. */
export interface OAuthTokenPublic {
  twinId: string;
  provider: OAuthProvider;
  expiresAt: string;
  accountId: string | null;
  isExpired: boolean;
  isExpiringSoon: boolean; // < 5 Min remaining
  createdAt: string;
  updatedAt: string;
}

export interface OAuthTokenUpsertInput {
  twinId: string;
  provider: OAuthProvider;
  accessToken: string;
  refreshToken: string;
  expiresAt: string; // ISO 8601
  accountId: string | null;
}

export class OAuthTokenNotFoundError extends Error {
  constructor(identifier: string) {
    super(`OAuth-Token '${identifier}' nicht gefunden`);
    this.name = "OAuthTokenNotFoundError";
  }
}

const EXPIRES_SOON_THRESHOLD_MS = 5 * 60 * 1000;

export class OAuthTokensRepo {
  constructor(
    private db: Database.Database,
    private masterKey: Buffer,
  ) {}

  /**
   * Upsert: ersetzt existing Token-Row für (twin_id, provider) komplett.
   * Re-Login soll alten Token überschreiben, kein Fehler werfen. created_at
   * bleibt vom ersten Insert erhalten.
   */
  upsert(input: OAuthTokenUpsertInput): OAuthTokenDecrypted {
    const existing = this.findRowByTwinAndProvider(input.twinId, input.provider);
    const id = existing?.id ?? `oauth_tok_${nanoid(16)}`;
    const now = new Date().toISOString();
    const createdAt = existing?.created_at ?? now;

    const accessTokenEncrypted = encrypt(input.accessToken, this.masterKey);
    const refreshTokenEncrypted = encrypt(input.refreshToken, this.masterKey);

    this.db
      .prepare(
        `INSERT INTO oauth_tokens
           (id, twin_id, provider, access_token_encrypted, refresh_token_encrypted,
            expires_at, account_id, created_at, updated_at)
         VALUES
           (@id, @twin_id, @provider, @access_token_encrypted, @refresh_token_encrypted,
            @expires_at, @account_id, @created_at, @updated_at)
         ON CONFLICT(twin_id, provider) DO UPDATE SET
           access_token_encrypted  = excluded.access_token_encrypted,
           refresh_token_encrypted = excluded.refresh_token_encrypted,
           expires_at              = excluded.expires_at,
           account_id              = excluded.account_id,
           updated_at              = excluded.updated_at`,
      )
      .run({
        id,
        twin_id: input.twinId,
        provider: input.provider,
        access_token_encrypted: accessTokenEncrypted,
        refresh_token_encrypted: refreshTokenEncrypted,
        expires_at: input.expiresAt,
        account_id: input.accountId,
        created_at: createdAt,
        updated_at: now,
      });

    return this.findDecryptedByTwinAndProviderOrThrow(input.twinId, input.provider);
  }

  /** Decrypted Lookup; null wenn keine Row existiert. */
  findDecryptedByTwinAndProvider(
    twinId: string,
    provider: OAuthProvider,
  ): OAuthTokenDecrypted | null {
    const row = this.findRowByTwinAndProvider(twinId, provider);
    return row ? this.decryptRow(row) : null;
  }

  /** Decrypted Lookup mit Throw — für Code-Pfade die wissen dass die Row existiert. */
  findDecryptedByTwinAndProviderOrThrow(
    twinId: string,
    provider: OAuthProvider,
  ): OAuthTokenDecrypted {
    const result = this.findDecryptedByTwinAndProvider(twinId, provider);
    if (!result) {
      throw new OAuthTokenNotFoundError(`${twinId}/${provider}`);
    }
    return result;
  }

  delete(twinId: string, provider: OAuthProvider): void {
    this.db
      .prepare(
        `DELETE FROM oauth_tokens WHERE twin_id = ? AND provider = ?`,
      )
      .run(twinId, provider);
  }

  /**
   * Background-Scan für RefreshService: liefert twin_ids deren Token
   * innerhalb `thresholdMinutes` expired oder bereits expired ist.
   * Bewusst thin (kein Decrypt) — der Loop iteriert nur und ruft
   * `ensureFresh(twinId)`, der intern das Decrypt macht.
   */
  findTwinIdsExpiringSoon(thresholdMinutes: number): string[] {
    const cutoff = new Date(
      Date.now() + thresholdMinutes * 60 * 1000,
    ).toISOString();
    const rows = this.db
      .prepare(
        `SELECT twin_id FROM oauth_tokens
         WHERE provider = 'openai' AND expires_at < ?
         ORDER BY expires_at ASC`,
      )
      .all(cutoff) as Array<{ twin_id: string }>;
    return rows.map((r) => r.twin_id);
  }

  /** Owner-Safe-Projection ohne Token-Klartext. Sicher für API-Responses. */
  toPublic(row: OAuthTokenDecrypted): OAuthTokenPublic {
    const expiresAtMs = new Date(row.expiresAt).getTime();
    const nowMs = Date.now();
    const millisRemaining = expiresAtMs - nowMs;
    return {
      twinId: row.twinId,
      provider: row.provider,
      expiresAt: row.expiresAt,
      accountId: row.accountId,
      isExpired: millisRemaining <= 0,
      isExpiringSoon:
        millisRemaining > 0 && millisRemaining < EXPIRES_SOON_THRESHOLD_MS,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  private findRowByTwinAndProvider(
    twinId: string,
    provider: OAuthProvider,
  ): OAuthTokenRow | null {
    const row = this.db
      .prepare(
        `SELECT * FROM oauth_tokens WHERE twin_id = ? AND provider = ?`,
      )
      .get(twinId, provider) as OAuthTokenRow | undefined;
    return row ?? null;
  }

  private decryptRow(row: OAuthTokenRow): OAuthTokenDecrypted {
    return {
      id: row.id,
      twinId: row.twin_id,
      provider: row.provider,
      accessToken: decrypt(row.access_token_encrypted, this.masterKey),
      refreshToken: decrypt(row.refresh_token_encrypted, this.masterKey),
      expiresAt: row.expires_at,
      accountId: row.account_id,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}
