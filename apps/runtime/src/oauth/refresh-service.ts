import { nanoid } from "nanoid";
import type { FastifyBaseLogger } from "fastify";
import type { AuditEntry } from "@twin-lab/shared";
import type { AuditRepository } from "../repository/types.js";
import { refreshAccessToken } from "./openai-pkce.js";
import type {
  OAuthTokenDecrypted,
  OAuthTokensRepo,
} from "./oauth-tokens-repo.js";

// ─── OAUTH REFRESH SERVICE (#131 PHASE 2) ───────────────────────────────────
//
// Belt+Suspenders Token-Refresh für OAuth-OAuth-Subscription:
//
//   1. Background-Polling alle 60s — scant alle expiring/expired Tokens und
//      refresht sie proaktiv, damit der nächste Request keine Latenz spürt.
//   2. Lazy-Refresh via `ensureFresh(twinId)` bei Request-Time — Provider-
//      Wrapper (Phase 3) ruft das vor jedem LLM-Call, holt im worst case
//      synchron einen frischen Token wenn Polling zu langsam war.
//
// In-Memory-Mutex via Map<twinId, Promise> coalesced parallele Refresh-Calls
// fürs gleiche Twin: zweiter ensureFresh-Call während laufendem Refresh
// returnt das gleiche In-Flight-Promise. Single-Container-Annahme (Strategy
// §b) — kein File-Lock, keine SQLite-Coordination.
//
// Lifecycle analog TelegramBotRegistry: konstruieren → `start(logger)` nach
// `app.listen` → `stop()` im Shutdown-Hook.
//
// Spec: docs/131-OAUTH-STRATEGY.md §d (Refresh-Service mit Lazy-Fallback).

export interface OAuthRefreshServiceOptions {
  /** Background-Poll-Intervall in ms. Default 60_000 (60s). */
  pollIntervalMs?: number;
  /** Token gilt als „expiring soon" wenn < dieses Schwelle remaining. Default 5min. */
  refreshThresholdMinutes?: number;
}

const DEFAULT_POLL_INTERVAL_MS = 60_000;
const DEFAULT_REFRESH_THRESHOLD_MIN = 5;

export class OAuthRefreshService {
  private intervalId: NodeJS.Timeout | null = null;
  private logger: FastifyBaseLogger | null = null;
  private inFlight = new Map<string, Promise<OAuthTokenDecrypted>>();
  private readonly pollIntervalMs: number;
  private readonly refreshThresholdMinutes: number;

  constructor(
    private repo: OAuthTokensRepo,
    private auditRepo: AuditRepository,
    options: OAuthRefreshServiceOptions = {},
  ) {
    this.pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    this.refreshThresholdMinutes =
      options.refreshThresholdMinutes ?? DEFAULT_REFRESH_THRESHOLD_MIN;
  }

  /**
   * Boot-Step (nach `app.listen`): startet Background-Polling. Idempotent —
   * zweiter Call ist No-Op. Fehler im Poll-Loop killen den Loop nicht
   * (try/catch im Tick).
   */
  start(logger: FastifyBaseLogger): void {
    this.logger = logger;
    if (this.intervalId) {
      logger.warn("[oauth-refresh] start() während laufendem Loop — ignored");
      return;
    }
    this.intervalId = setInterval(() => {
      this.pollAllTokens().catch((err) => {
        const msg = err instanceof Error ? err.message : String(err);
        logger.error({ err: msg }, "[oauth-refresh] poll tick failed");
      });
    }, this.pollIntervalMs);
    logger.info(
      `[oauth-refresh] started, poll interval ${this.pollIntervalMs}ms, ` +
        `threshold ${this.refreshThresholdMinutes}min`,
    );
  }

  /** Shutdown-Step: cleart Interval. Idempotent. */
  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
      this.logger?.info("[oauth-refresh] stopped");
    }
  }

  /**
   * Lazy-Refresh-API: stellt sicher dass Token nicht expired ist.
   * Returnt entweder den existing frischen Token oder einen frisch geholten.
   *
   * Mutex-Coalescing: zweiter Call für gleichen twinId während laufendem
   * Refresh returnt das gleiche In-Flight-Promise. Verhindert dass zwei
   * parallele Chats gegen die OpenAI-Auth-API rennen.
   *
   * Bewusst NICHT `async`: ein `async`-Wrapper würde den returned Promise
   * neu wrappen, Identity ginge verloren — die Coalescing-Garantie hängt
   * an der gemeinsamen Promise-Referenz im inFlight-Map.
   */
  ensureFresh(twinId: string): Promise<OAuthTokenDecrypted> {
    const existing = this.inFlight.get(twinId);
    if (existing) return existing;

    const promise = this.doRefreshIfNeeded(twinId).finally(() => {
      this.inFlight.delete(twinId);
    });
    this.inFlight.set(twinId, promise);
    return promise;
  }

  /**
   * Background-Pfad: scannt alle Tokens deren Expiry innerhalb der Schwelle
   * liegt und refresht sie via ensureFresh (nutzt Mutex). Fehler werden pro
   * Twin behandelt — ein 401 für Twin A killt nicht den Loop für Twin B.
   */
  private async pollAllTokens(): Promise<void> {
    const twinIds = this.repo.findTwinIdsExpiringSoon(
      this.refreshThresholdMinutes,
    );
    if (twinIds.length === 0) return;

    this.logger?.info(
      `[oauth-refresh] polling: ${twinIds.length} token(s) expiring soon`,
    );

    for (const twinId of twinIds) {
      try {
        await this.ensureFresh(twinId);
      } catch (err) {
        // doRefreshIfNeeded hat bereits Audit-Entry geschrieben.
        // Hier nur Log, damit Loop weiter läuft.
        const msg = err instanceof Error ? err.message : String(err);
        this.logger?.error(
          { twinId, err: msg },
          "[oauth-refresh] poll-refresh failed for twin",
        );
      }
    }
  }

  /**
   * Kernlogik: holt aktuellen Token, prüft Expiry, refresht falls nötig.
   * Wirft bei Refresh-Failure UND schreibt einen Audit-Entry vorher.
   */
  private async doRefreshIfNeeded(
    twinId: string,
  ): Promise<OAuthTokenDecrypted> {
    const token = this.repo.findDecryptedByTwinAndProvider(twinId, "openai");
    if (!token) {
      throw new Error(`[oauth-refresh] no token for twin ${twinId}`);
    }

    const expiresAtMs = new Date(token.expiresAt).getTime();
    const thresholdMs = this.refreshThresholdMinutes * 60 * 1000;
    const millisRemaining = expiresAtMs - Date.now();

    if (millisRemaining > thresholdMs) {
      return token; // noch frisch, kein Refresh
    }

    try {
      const response = await refreshAccessToken(token.refreshToken);
      const newExpiresAt = new Date(
        Date.now() + response.expires_in * 1000,
      ).toISOString();

      const updated = this.repo.upsert({
        twinId,
        provider: "openai",
        accessToken: response.access_token,
        refreshToken: response.refresh_token,
        expiresAt: newExpiresAt,
        accountId: response.account_id ?? token.accountId,
      });

      this.logger?.info(
        { twinId, expiresAt: newExpiresAt },
        "[oauth-refresh] refreshed token",
      );
      return updated;
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      await this.recordFailure(twinId, reason);
      throw err;
    }
  }

  /**
   * Schreibt einen one-shot Audit-Entry für ein Refresh-Failure. Bewusst
   * direkt auf AuditRepository statt via AuditService — kein Pending→Executed-
   * Lifecycle, keine EventBus-Emission (Phase 3 zieht Web-UI-Streaming nach
   * wenn nötig). Capability `oauth-refresh-failure` ist der Discriminator
   * für Phase-3-Provider-User-Facing-Error-Branch.
   */
  private async recordFailure(twinId: string, reason: string): Promise<void> {
    const entry: AuditEntry = {
      id: `audit_${nanoid(12)}`,
      twinId,
      timestamp: new Date().toISOString(),
      capability: "oauth-refresh-failure",
      mandateId: null,
      status: "failed",
      input: { provider: "openai" },
      output: null,
      reason,
      conversationId: null,
    };
    try {
      await this.auditRepo.append(entry);
    } catch (auditErr) {
      // Audit-Schreib-Fehler darf nicht den ursprünglichen Refresh-Error
      // verschlucken — nur loggen.
      const msg =
        auditErr instanceof Error ? auditErr.message : String(auditErr);
      this.logger?.error(
        { twinId, auditErr: msg },
        "[oauth-refresh] audit append failed",
      );
    }
  }
}
