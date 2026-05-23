import type { FastifyInstance } from "fastify";
import type { TelegramConfigsRepo } from "./configs-repo.js";
import type { TelegramBotRegistry } from "./bot-registry.js";

// ─── TELEGRAM WEBHOOK ROUTES (#130 Phase 2) ─────────────────────────────────
//
// POST /webhooks/telegram/:twin_handle
//
// Telegram POSTet jeden Update an die per setWebhook konfigurierte URL und
// erwartet eine schnelle 200-Antwort (intern Timeout ~20s, sonst Retries
// die Updates verdoppeln). Daher:
//
//   1. Twin-Handle → Config-Lookup (JOIN auf twin_profiles)
//   2. Secret-Token-Verification via X-Telegram-Bot-Api-Secret-Token-Header
//   3. Update-Dispatch an die zuständige Telegraf-Instance via BotRegistry
//   4. 200 zurück
//
// Auth-Modell: kein Owner-Check (anders als alle /twins/:handle/*-Routes).
// Der Webhook-Secret IST die Autorisierung — Telegram sendet ihn pro Update,
// fremde Clients kennen ihn nicht. Storage: `telegram_configs.webhook_secret`
// (32-Byte hex, beim create() generiert, bei updateToken() rotiert).
//
// Domain-Folder-Pattern: dieses File ist der erste Route-Extract außerhalb
// von server.ts. Anlass war die Domain-Kohärenz mit Phase-1
// (telegram/configs-repo.ts, telegram/messages-repo.ts). Künftige WhatsApp/
// Discord-Adapter folgen dem Pattern (eigener Domain-Folder, `register*Routes`-
// Export, Aufruf in server.ts createServer()).

export interface TelegramWebhookRoutesDeps {
  configsRepo: TelegramConfigsRepo;
  botRegistry: TelegramBotRegistry;
}

const TELEGRAM_SECRET_HEADER = "x-telegram-bot-api-secret-token";

interface TwinHandleParams {
  twin_handle: string;
}

export function registerTelegramWebhookRoutes(
  app: FastifyInstance,
  deps: TelegramWebhookRoutesDeps,
): void {
  app.post<{ Params: TwinHandleParams; Body: unknown }>(
    "/webhooks/telegram/:twin_handle",
    async (request, reply) => {
      const { twin_handle } = request.params;

      const config = deps.configsRepo.findByTwinHandle(twin_handle);
      if (!config) {
        // Bewusst 404 (nicht 401) — kein gültiger Bot-Pfad. Telegram retried
        // bei 4xx nicht aggressiv (anders als 5xx), das halten wir auch so.
        return reply.code(404).send({ error: "Unknown bot" });
      }

      const providedSecret = request.headers[TELEGRAM_SECRET_HEADER];
      if (
        typeof providedSecret !== "string" ||
        providedSecret !== config.webhook_secret
      ) {
        // 401 mit minimal-Info — kein Reveal, ob Secret falsch oder fehlt.
        return reply.code(401).send({ error: "Invalid webhook secret" });
      }

      // Update an Bot-Registry weiterleiten. handleWebhookUpdate macht
      // intern Cold-Start, falls der Bot zwischenzeitlich nicht im Map ist
      // (z.B. Race zwischen Pairing-Abschluss und nächstem Telegram-Update
      // bei einem frisch gepairten Bot).
      let handled: boolean;
      try {
        handled = await deps.botRegistry.handleWebhookUpdate(
          config.twin_id,
          request.body,
        );
      } catch (err) {
        // Telegraf-Handler-Errors landen normal im bot.catch(); kommt hier
        // raus, ist es ein Registry-/Dispatch-Fehler. Log + 200, weil ein
        // 500 Telegram zum Retry zwingt und das Problem nicht löst.
        const msg = err instanceof Error ? err.message : String(err);
        request.log.error(
          { twin_id: config.twin_id, err: msg },
          "[telegram-webhook] dispatch error",
        );
        return reply.code(200).send({ ok: false });
      }

      if (!handled) {
        // Bot ist weder im Map noch via Cold-Start ladbar — 200 statt 5xx,
        // damit Telegram nicht endlos retried. Das ist ein lokales Problem
        // (Config-Drift), das Retries nicht heilen.
        request.log.warn(
          { twin_id: config.twin_id, twin_handle },
          "[telegram-webhook] no bot available, dropping update",
        );
        return reply.code(200).send({ ok: false });
      }

      return reply.code(200).send({ ok: true });
    },
  );
}
