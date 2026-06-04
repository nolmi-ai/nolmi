import type {
  FastifyInstance,
  FastifyReply,
  FastifyRequest,
} from "fastify";
import { z } from "zod";
import { Telegraf } from "telegraf";
import type { RegistryEntry } from "../twin-service-registry.js";
import type { User } from "../auth/users-repo.js";
import {
  TelegramConfigAlreadyExistsError,
  TelegramConfigNotFoundError,
  type TelegramConfigsRepo,
} from "./configs-repo.js";
import type { PairingService } from "./pairing-service.js";
import type { TelegramBotRegistry } from "./bot-registry.js";

// ─── TELEGRAM API ROUTES (#130 Phase 3) ──────────────────────────────────────
//
// Owner-gated CRUD für die Bot-Konfiguration eines Twins plus Pairing-Code-
// Generation. Pfad-Pattern matched die übrigen 6 register*Routes-Module:
// `/twins/:handle/telegram/...`, Auth via requireOwner.
//
// Lifecycle-Trigger:
//
//   POST   /config         → Token validieren (getMe), persistieren,
//                            startBotForTwin, im Webhook-Mode setWebhook
//   GET    /config         → toPublic() — niemals Token im Klartext raus
//   PUT    /config         → Token rotieren, Bot neu starten (idempotent
//                            stop+restart), im Webhook-Mode setWebhook mit
//                            neuem Secret
//   DELETE /config         → im Webhook-Mode deleteWebhook, stopBotForTwin,
//                            configsRepo.deleteByTwinId (Messages bleiben
//                            als Audit-Trail — Cascade auf telegram_messages
//                            greift nur bei Twin-Delete, nicht Config-Delete)
//   POST   /pairing-code   → PairingService.generatePairingCode

export interface TelegramApiRoutesDeps {
  configsRepo: TelegramConfigsRepo;
  pairingService: PairingService;
  botRegistry: TelegramBotRegistry;
}

// .strict() = Defense-in-depth gegen §h Persistent-Pairing-Verletzungen.
// Extra-Felder im Body (z.B. ein versehentlich mitgesendetes
// `paired_owner_telegram_user_id`) werden als 400 abgelehnt, statt still
// ignoriert zu werden. Schützt vor UI-Bugs, die das Pairing-State
// modifizieren wollen — Pairing-Lifecycle gehört ausschließlich
// PairingService + POST /unpair, nicht der Config-PUT-Pfad.
const TelegramConfigBodySchema = z
  .object({
    bot_token: z.string().min(20, "bot_token zu kurz"),
    bot_username: z
      .string()
      .min(3, "bot_username zu kurz")
      .max(64, "bot_username zu lang"),
  })
  .strict();

/**
 * Verifiziert dass der Token bei Telegram gültig ist und liefert das Bot-
 * User-Object zurück (incl. Bot-Username). Wir testen so, dass kaputte
 * Tokens nie in die DB landen — wäre sonst eine Stolperfalle für Self-
 * Hoster, die einen Tippfehler im Token machen.
 */
async function validateBotToken(token: string): Promise<{
  ok: true;
  username: string | undefined;
} | {
  ok: false;
  reason: string;
}> {
  try {
    const probe = new Telegraf(token);
    const me = await probe.telegram.getMe();
    return { ok: true, username: me.username };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    return { ok: false, reason };
  }
}

export function registerTelegramApiRoutes(
  app: FastifyInstance,
  deps: TelegramApiRoutesDeps,
  requireOwner: (
    request: FastifyRequest,
    reply: FastifyReply,
    handle: string,
  ) => Promise<{ entry: RegistryEntry; user: User } | null>,
): void {
  // ─── GET /config ────────────────────────────────────────────────────────
  app.get<{ Params: { handle: string } }>(
    "/twins/:handle/telegram/config",
    async (request, reply) => {
      const ctx = await requireOwner(request, reply, request.params.handle);
      if (!ctx) return;

      const row = deps.configsRepo.findByTwinId(ctx.entry.twinId);
      if (!row) {
        return reply.status(404).send({ error: "Kein Telegram-Bot konfiguriert" });
      }
      return deps.configsRepo.toPublic(row);
    },
  );

  // ─── POST /config — Initial-Setup ───────────────────────────────────────
  app.post<{ Params: { handle: string } }>(
    "/twins/:handle/telegram/config",
    async (request, reply) => {
      const ctx = await requireOwner(request, reply, request.params.handle);
      if (!ctx) return;

      const parsed = TelegramConfigBodySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: parsed.error.message });
      }
      const { bot_token, bot_username } = parsed.data;

      // Pre-Check: Token vor Persistence gegen Telegram-API probieren.
      // Spart einen sonst stundenlangen Self-Hoster-Stolperer bei Tippfehler.
      const validation = await validateBotToken(bot_token);
      if (!validation.ok) {
        return reply.status(400).send({
          error: `Bot-Token von Telegram abgelehnt: ${validation.reason}`,
        });
      }

      try {
        deps.configsRepo.create({
          twin_id: ctx.entry.twinId,
          bot_token,
          bot_username,
        });
      } catch (err) {
        if (err instanceof TelegramConfigAlreadyExistsError) {
          return reply.status(409).send({
            error:
              "Telegram-Bot für diesen Twin existiert bereits. PUT /config zum Rotieren.",
          });
        }
        throw err;
      }

      // Lazy-Load (auch im Webhook-Mode populiert das den Bot-Map).
      try {
        deps.botRegistry.startBotForTwin(ctx.entry.twinId);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        request.log.error(
          { twin_id: ctx.entry.twinId, err: msg },
          "[telegram-api] startBotForTwin nach create fehlgeschlagen",
        );
      }

      // Webhook-Mode: setWebhook bei Telegram registrieren — der Bot
      // empfängt erst nach diesem Call Updates über unsere Public-URL.
      try {
        await deps.botRegistry.registerWebhook(ctx.entry.twinId);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        request.log.error(
          { twin_id: ctx.entry.twinId, err: msg },
          "[telegram-api] registerWebhook nach create fehlgeschlagen",
        );
        // Wir bleiben aber bei 201 — der Bot ist in DB, im Polling-Mode
        // läuft alles, Webhook kann via PUT nachgezogen werden.
      }

      const row = deps.configsRepo.findByTwinId(ctx.entry.twinId);
      if (!row) {
        // Sollte nach Create unmöglich sein; defensive.
        return reply.status(500).send({ error: "Config nach Create nicht auffindbar" });
      }
      return reply.status(201).send(deps.configsRepo.toPublic(row));
    },
  );

  // ─── PUT /config — Token-Rotation ───────────────────────────────────────
  app.put<{ Params: { handle: string } }>(
    "/twins/:handle/telegram/config",
    async (request, reply) => {
      const ctx = await requireOwner(request, reply, request.params.handle);
      if (!ctx) return;

      const parsed = TelegramConfigBodySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: parsed.error.message });
      }
      const { bot_token, bot_username } = parsed.data;

      const validation = await validateBotToken(bot_token);
      if (!validation.ok) {
        return reply.status(400).send({
          error: `Bot-Token von Telegram abgelehnt: ${validation.reason}`,
        });
      }

      try {
        deps.configsRepo.updateToken(ctx.entry.twinId, bot_token, bot_username);
      } catch (err) {
        if (err instanceof TelegramConfigNotFoundError) {
          return reply.status(404).send({
            error: "Kein Telegram-Bot konfiguriert — erst POST /config",
          });
        }
        throw err;
      }

      // Idempotent: stop + restart mit neuem Token. Pairing-State bleibt
      // erhalten (updateToken rotiert nur Token + Secret).
      try {
        deps.botRegistry.startBotForTwin(ctx.entry.twinId);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        request.log.error(
          { twin_id: ctx.entry.twinId, err: msg },
          "[telegram-api] startBotForTwin nach update fehlgeschlagen",
        );
      }

      // Neues webhook_secret → setWebhook neu, sonst weist Telegram die
      // nächsten Updates wegen Secret-Mismatch ab.
      try {
        await deps.botRegistry.registerWebhook(ctx.entry.twinId);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        request.log.error(
          { twin_id: ctx.entry.twinId, err: msg },
          "[telegram-api] registerWebhook nach update fehlgeschlagen",
        );
      }

      const row = deps.configsRepo.findByTwinId(ctx.entry.twinId);
      if (!row) {
        return reply.status(500).send({ error: "Config nach Update nicht auffindbar" });
      }
      return deps.configsRepo.toPublic(row);
    },
  );

  // ─── DELETE /config ─────────────────────────────────────────────────────
  app.delete<{ Params: { handle: string } }>(
    "/twins/:handle/telegram/config",
    async (request, reply) => {
      const ctx = await requireOwner(request, reply, request.params.handle);
      if (!ctx) return;

      const row = deps.configsRepo.findByTwinId(ctx.entry.twinId);
      if (!row) {
        return reply.status(404).send({ error: "Kein Telegram-Bot konfiguriert" });
      }

      // Webhook-Mode: erst deleteWebhook bei Telegram (sonst kommen weiter
      // Updates an einen Endpoint, der gleich nichts mehr hat).
      try {
        await deps.botRegistry.unregisterWebhook(ctx.entry.twinId);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        request.log.warn(
          { twin_id: ctx.entry.twinId, err: msg },
          "[telegram-api] unregisterWebhook fehlgeschlagen — fahre fort",
        );
      }

      deps.botRegistry.stopBotForTwin(ctx.entry.twinId);

      // Messages bleiben als Audit-Trail (Cascade auf telegram_messages
      // greift nur bei Twin-Delete in twin_profiles). deleteByTwinId
      // entfernt nur die telegram_configs-Row.
      deps.configsRepo.deleteByTwinId(ctx.entry.twinId);

      return reply.status(204).send();
    },
  );

  // ─── POST /unpair — Persistent-Pairing-Prinzip §h (Phase 4) ─────────────
  //
  // Setzt `paired_owner_telegram_user_id` auf NULL, behält Bot-Config +
  // Webhook + Pairing-Code-Generation-Capability. Use-Case: Owner verliert
  // Zugang zu seinem Telegram-Account und will Pairing zurücksetzen ohne
  // Bot-Token + Webhook-Setup neu zu machen.
  //
  // Im Gegensatz zu DELETE /config: keine Webhook-Deregistrierung, keine
  // Bot-Stop — der Bot bleibt empfangsbereit für einen frischen `/start
  // <code>` (eagerLoadAllBots ist channel-, nicht pair-state-gated).
  app.post<{ Params: { handle: string } }>(
    "/twins/:handle/telegram/unpair",
    async (request, reply) => {
      const ctx = await requireOwner(request, reply, request.params.handle);
      if (!ctx) return;

      const row = deps.configsRepo.findByTwinId(ctx.entry.twinId);
      if (!row) {
        return reply.status(404).send({ error: "Kein Telegram-Bot konfiguriert" });
      }
      if (row.paired_owner_telegram_user_id === null) {
        // Idempotent: schon ungepaired → 204 (kein 409, weil das Ziel-State
        // erreicht ist). Vereinfacht die UI-Logik (Unpair-Button bleibt
        // klickbar auch wenn er versehentlich doppelt gedrückt wird).
        return reply.status(204).send();
      }

      try {
        deps.configsRepo.unpair(ctx.entry.twinId);
      } catch (err) {
        if (err instanceof TelegramConfigNotFoundError) {
          return reply.status(404).send({
            error: "Kein Telegram-Bot konfiguriert",
          });
        }
        throw err;
      }

      return reply.status(204).send();
    },
  );

  // ─── POST /pairing-code ─────────────────────────────────────────────────
  app.post<{ Params: { handle: string } }>(
    "/twins/:handle/telegram/pairing-code",
    async (request, reply) => {
      const ctx = await requireOwner(request, reply, request.params.handle);
      if (!ctx) return;

      const row = deps.configsRepo.findByTwinId(ctx.entry.twinId);
      if (!row) {
        return reply.status(404).send({
          error: "Kein Telegram-Bot konfiguriert — erst POST /config",
        });
      }

      // Self-Healing-Re-Connect: vor der Code-Ausgabe den Webhook (neu)
      // setzen. Chicken-and-Egg — `/start <code>` kommt selbst über den
      // Webhook rein, also muss der Empfangskanal stehen, BEVOR der Owner den
      // Code in Telegram schickt. Ein Twin mit bestehender Config, dessen
      // Webhook bei Telegram verloren/stale ist (Domain-Wechsel, Drift), hatte
      // sonst nur den manuellen „Token ändern"-Workaround (PUT /config).
      //
      // startBotForTwin ist idempotent (stop+restart) und sichert den Bot im
      // Map — registerWebhook wirft sonst, wenn der Bot fehlt. registerWebhook
      // liest config.webhook_secret FRISCH aus der DB und rotiert es NICHT
      // (nur updateToken/PUT rotiert); bestehende Verbindungen brechen also
      // nicht. Telegram-setWebhook ist idempotent. Fehler hier dürfen die
      // Code-Ausgabe NICHT killen — Code-Erfolg hängt nicht am Webhook.
      try {
        deps.botRegistry.startBotForTwin(ctx.entry.twinId);
        await deps.botRegistry.registerWebhook(ctx.entry.twinId);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        request.log.error(
          { twin_id: ctx.entry.twinId, err: msg },
          "[telegram-api] pairing-code: webhook-register fehlgeschlagen — Code wird trotzdem ausgegeben",
        );
      }

      const code = deps.pairingService.generatePairingCode(ctx.entry.twinId);
      const refreshed = deps.configsRepo.findByTwinId(ctx.entry.twinId);
      return {
        code,
        expires_at: refreshed?.pairing_code_expires_at ?? null,
      };
    },
  );
}
