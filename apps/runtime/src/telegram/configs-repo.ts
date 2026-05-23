import { randomBytes } from "node:crypto";
import type Database from "better-sqlite3";
import { nanoid } from "nanoid";
import { decrypt, encrypt } from "../crypto-utils.js";

// ─── TELEGRAM-CONFIGS REPOSITORY (#130 Phase 1) ─────────────────────────────
//
// Eine Row pro Twin (UNIQUE(twin_id)). Bot-Token AES-256-GCM-encrypted via
// `encrypt()` aus crypto-utils — selber Pattern wie `mcp_servers.env_json_
// encrypted` und `llm_config.api_key_encrypted`. Klartext kommt ausschließlich
// über `decryptToken()` raus, damit der Token nie versehentlich in API-
// Responses oder Logs landet.
//
// Webhook-Secret wird beim Create generiert (32-Byte random hex), wandert
// in den `setWebhook`-Call an Telegram und prüft eingehende Webhook-Requests
// per `X-Telegram-Bot-Api-Secret-Token`-Header.
//
// Owner-Pairing: zweistufig. `setPairingCode()` setzt einen kurzen Code mit
// TTL, `consumePairingCode()` validiert ihn atomar und schreibt die Telegram-
// User-ID (Pattern aus 130-TELEGRAM-STRATEGY §e). Stufe 1 = ein gepairter User
// pro Twin, Stufe 2 (Phase B) erweitert das auf eine User-Liste.

export interface TelegramConfigRow {
  id: string;
  twin_id: string;
  bot_token_encrypted: string;
  bot_username: string;
  webhook_secret: string;
  paired_owner_telegram_user_id: number | null;
  pairing_code: string | null;
  pairing_code_expires_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface TelegramConfigPublic {
  id: string;
  twin_id: string;
  bot_username: string;
  hasToken: boolean;
  isPaired: boolean;
  pairing_code: string | null;
  pairing_code_expires_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface TelegramConfigCreateInput {
  twin_id: string;
  bot_token: string;
  bot_username: string;
}

export class TelegramConfigNotFoundError extends Error {
  constructor(identifier: string) {
    super(`Telegram-Config '${identifier}' nicht gefunden`);
    this.name = "TelegramConfigNotFoundError";
  }
}

export class TelegramConfigAlreadyExistsError extends Error {
  constructor(twinId: string) {
    super(`Telegram-Config für Twin ${twinId} existiert bereits`);
    this.name = "TelegramConfigAlreadyExistsError";
  }
}

export class TelegramConfigsRepo {
  constructor(
    private db: Database.Database,
    private masterKey: Buffer,
  ) {}

  /**
   * Legt eine neue Telegram-Config an. Bot-Token wird encrypted, Webhook-
   * Secret wird generiert. UNIQUE-Verletzung (zweite Config pro Twin) →
   * TelegramConfigAlreadyExistsError für 409-Mapping in der Server-Schicht.
   */
  create(input: TelegramConfigCreateInput): TelegramConfigRow {
    const now = new Date().toISOString();
    const id = `tg_cfg_${nanoid(16)}`;
    const botTokenEncrypted = encrypt(input.bot_token, this.masterKey);
    const webhookSecret = randomBytes(32).toString("hex");

    try {
      this.db
        .prepare(
          `INSERT INTO telegram_configs
             (id, twin_id, bot_token_encrypted, bot_username, webhook_secret,
              paired_owner_telegram_user_id, pairing_code, pairing_code_expires_at,
              created_at, updated_at)
           VALUES
             (@id, @twin_id, @bot_token_encrypted, @bot_username, @webhook_secret,
              NULL, NULL, NULL,
              @created_at, @updated_at)`,
        )
        .run({
          id,
          twin_id: input.twin_id,
          bot_token_encrypted: botTokenEncrypted,
          bot_username: input.bot_username,
          webhook_secret: webhookSecret,
          created_at: now,
          updated_at: now,
        });
    } catch (err) {
      if (
        err instanceof Error &&
        err.message.includes("UNIQUE constraint failed")
      ) {
        throw new TelegramConfigAlreadyExistsError(input.twin_id);
      }
      throw err;
    }

    return this.findByTwinIdOrThrow(input.twin_id);
  }

  findByTwinId(twin_id: string): TelegramConfigRow | null {
    const row = this.db
      .prepare(`SELECT * FROM telegram_configs WHERE twin_id = ?`)
      .get(twin_id) as TelegramConfigRow | undefined;
    return row ?? null;
  }

  /** Lookup für Webhook-Routing: Inbound-Message → welcher Twin? */
  findByPairedUserId(telegram_user_id: number): TelegramConfigRow | null {
    const row = this.db
      .prepare(
        `SELECT * FROM telegram_configs
         WHERE paired_owner_telegram_user_id = ?`,
      )
      .get(telegram_user_id) as TelegramConfigRow | undefined;
    return row ?? null;
  }

  /**
   * Replace bot token. Also rotates webhook_secret (defense-in-depth).
   *
   * Pairing-State und User-ID bleiben unverändert: Re-Token bei gleichem
   * Bot ist legitim, Re-Pairing separater Call.
   *
   * ⚠️ After calling this, the caller MUST call setWebhook on Telegram API
   * with the new webhook_secret to ensure the bot continues receiving updates.
   * See Phase 2 (TelegramBotRegistry) for the integration.
   */
  updateToken(
    twin_id: string,
    new_bot_token: string,
    new_bot_username: string,
  ): TelegramConfigRow {
    const now = new Date().toISOString();
    const botTokenEncrypted = encrypt(new_bot_token, this.masterKey);
    const newWebhookSecret = randomBytes(32).toString("hex");

    const result = this.db
      .prepare(
        `UPDATE telegram_configs
           SET bot_token_encrypted = @bot_token_encrypted,
               bot_username = @bot_username,
               webhook_secret = @webhook_secret,
               updated_at = @updated_at
         WHERE twin_id = @twin_id`,
      )
      .run({
        twin_id,
        bot_token_encrypted: botTokenEncrypted,
        bot_username: new_bot_username,
        webhook_secret: newWebhookSecret,
        updated_at: now,
      });

    if (result.changes === 0) {
      throw new TelegramConfigNotFoundError(twin_id);
    }
    return this.findByTwinIdOrThrow(twin_id);
  }

  /**
   * Setzt einen frischen Pairing-Code. Überschreibt einen bestehenden
   * (Re-Pairing-Use-Case). TTL in Sekunden ab jetzt; Expiry wird als
   * ISO-String gespeichert und in `consumePairingCode` via SQL-`datetime`
   * verglichen.
   */
  setPairingCode(twin_id: string, code: string, ttl_seconds: number): void {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + ttl_seconds * 1000).toISOString();

    const result = this.db
      .prepare(
        `UPDATE telegram_configs
           SET pairing_code = @pairing_code,
               pairing_code_expires_at = @expires_at,
               updated_at = @updated_at
         WHERE twin_id = @twin_id`,
      )
      .run({
        twin_id,
        pairing_code: code,
        expires_at: expiresAt,
        updated_at: now.toISOString(),
      });

    if (result.changes === 0) {
      throw new TelegramConfigNotFoundError(twin_id);
    }
  }

  /**
   * Atomarer Pairing-Code-Verbrauch: validiert Code + Expiry, setzt User-ID,
   * löscht Code. Bei Mismatch (Code falsch oder abgelaufen) → null. Eine
   * Transaktion, kein Race zwischen SELECT und UPDATE.
   */
  consumePairingCode(
    twin_id: string,
    code: string,
    telegram_user_id: number,
  ): TelegramConfigRow | null {
    const tx = this.db.transaction((): TelegramConfigRow | null => {
      const row = this.db
        .prepare(
          `SELECT * FROM telegram_configs
           WHERE twin_id = ?
             AND pairing_code = ?
             AND pairing_code_expires_at IS NOT NULL
             AND datetime(pairing_code_expires_at) > datetime('now')`,
        )
        .get(twin_id, code) as TelegramConfigRow | undefined;

      if (!row) return null;

      const now = new Date().toISOString();
      this.db
        .prepare(
          `UPDATE telegram_configs
             SET paired_owner_telegram_user_id = @user_id,
                 pairing_code = NULL,
                 pairing_code_expires_at = NULL,
                 updated_at = @updated_at
           WHERE id = @id`,
        )
        .run({ user_id: telegram_user_id, updated_at: now, id: row.id });

      return this.findByTwinIdOrThrow(twin_id);
    });

    return tx();
  }

  clearPairingCode(twin_id: string): void {
    const now = new Date().toISOString();
    const result = this.db
      .prepare(
        `UPDATE telegram_configs
           SET pairing_code = NULL,
               pairing_code_expires_at = NULL,
               updated_at = ?
         WHERE twin_id = ?`,
      )
      .run(now, twin_id);

    if (result.changes === 0) {
      throw new TelegramConfigNotFoundError(twin_id);
    }
  }

  /** Owner entfernt Pairing — Twin verliert den Telegram-User-Bezug. */
  unpair(twin_id: string): void {
    const now = new Date().toISOString();
    const result = this.db
      .prepare(
        `UPDATE telegram_configs
           SET paired_owner_telegram_user_id = NULL,
               updated_at = ?
         WHERE twin_id = ?`,
      )
      .run(now, twin_id);

    if (result.changes === 0) {
      throw new TelegramConfigNotFoundError(twin_id);
    }
  }

  deleteByTwinId(twin_id: string): void {
    this.db
      .prepare(`DELETE FROM telegram_configs WHERE twin_id = ?`)
      .run(twin_id);
  }

  /**
   * Decrypt the Bot-Token for server-side use.
   *
   * ⚠️ SERVER-INTERNAL ONLY — NEVER expose the returned plaintext via API responses,
   * logs, error messages, or any client-facing surface. Use only to initialize
   * Telegraf bot instances or for direct Telegram API calls.
   *
   * @internal
   */
  decryptToken(row: TelegramConfigRow): string {
    return decrypt(row.bot_token_encrypted, this.masterKey);
  }

  /** Strippt encrypted Token + Webhook-Secret, fügt Public-Marker hinzu. */
  toPublic(row: TelegramConfigRow): TelegramConfigPublic {
    return {
      id: row.id,
      twin_id: row.twin_id,
      bot_username: row.bot_username,
      hasToken:
        row.bot_token_encrypted !== null && row.bot_token_encrypted.length > 0,
      isPaired: row.paired_owner_telegram_user_id !== null,
      pairing_code: row.pairing_code,
      pairing_code_expires_at: row.pairing_code_expires_at,
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
  }

  private findByTwinIdOrThrow(twin_id: string): TelegramConfigRow {
    const row = this.findByTwinId(twin_id);
    if (!row) throw new TelegramConfigNotFoundError(twin_id);
    return row;
  }
}
