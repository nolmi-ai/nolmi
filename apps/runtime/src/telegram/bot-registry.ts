import type { Telegraf } from "telegraf";
import type { FastifyBaseLogger } from "fastify";
import type { TelegramConfigsRepo } from "./configs-repo.js";
import type { PairingService } from "./pairing-service.js";
import type { TelegramMessageRouter } from "./message-router.js";
import type { TwinProfilesRepo } from "../twin-profiles-repo.js";
import { createTelegrafBot } from "./telegraf-setup.js";

// ─── TELEGRAM BOT REGISTRY (#130 Phase 2) ───────────────────────────────────
//
// Multi-Tenant-Lifecycle für die Telegraf-Bot-Instanzen. Ein Bot pro Twin,
// gehalten in `Map<twin_id, Telegraf>`. Eager-Load aller konfigurierten
// Bots beim Boot, Lazy via startBotForTwin nach Config-Insert oder Token-
// Rotation.
//
// Wichtig: Bot-Liveness (= Telegraf-Verbindung zu Telegram) hängt am
// Token, nicht am Owner-Pairing-State. Ein konfigurierter aber noch nicht
// gepairter Bot muss live sein, sonst kann er das initiale `/start <code>`
// nicht empfangen. Owner-Pairing-State wird auf Message-Handler-Ebene
// geprüft (Text-Handler in telegraf-setup), nicht auf Lifecycle-Ebene.
//
// Bi-Modal: usePolling=true ruft bot.launch() für jeden Bot auf (Long-Polling
// im Hintergrund — Dev-Default), usePolling=false delegiert ans Fastify-
// Webhook-Routing per handleWebhookUpdate(). Die Bot-Map ist in beiden Modi
// nötig, weil Webhook-Dispatch ohne registriertes Bot-Object Telegraf nicht
// das Update zustellen kann.
//
// setWebhook wird hier bewusst NICHT aufgerufen — das passiert beim Pairing-
// Abschluss (PairingService) bzw. bei Token-Rotation (updateToken-Caller).
// Webhook-Registrierungen sind bei Telegram persistent und überleben Container-
// Restarts; Eager-Load muss sie nicht refreshen.

export class TelegramBotRegistry {
  private bots = new Map<string, Telegraf>();
  private logger: FastifyBaseLogger | null = null;

  constructor(
    private configsRepo: TelegramConfigsRepo,
    private pairingService: PairingService,
    private messageRouter: TelegramMessageRouter,
    private profilesRepo: TwinProfilesRepo,
    private usePolling: boolean,
    /**
     * Public runtime URL ohne Trailing-Slash (z.B. `https://runtime.example.com`).
     * Pflicht im Webhook-Mode, nur dort genutzt — Polling-Mode ignoriert.
     */
    private publicBaseUrl: string | null,
  ) {}

  /**
   * Boot-Step (vor `app.listen`): lädt alle konfigurierten Bots, unabhängig
   * vom Owner-Pairing-State. Erzeugt Telegraf-Instanzen, registriert sie im
   * Bot-Map. Im Webhook-Mode reicht das — der Bot ist „bereit" sobald er im
   * Map ist. Im Polling-Mode startet `start(logger)` danach die long-poll-
   * Loops.
   *
   * Bot-Liveness hängt am Token, nicht am Pairing: ein neu konfigurierter,
   * noch ungepaarter Bot muss live sein, damit der Owner via `/start <code>`
   * erstmalig pairen kann. Wäre Eager-Load auf paired-only beschränkt, wäre
   * die First-Pairing-Flow unerreichbar (Chicken-and-Egg).
   *
   * Fehler-Resilienz: ein einzelner Decrypt- oder Telegraf-Init-Fehler darf
   * den Boot nicht killen. Wir loggen den Fehler pro Twin und machen weiter.
   */
  eagerLoadAllBots(): void {
    const configs = this.configsRepo.findAll();

    for (const config of configs) {
      try {
        this.createAndRegisterBot(config);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(
          `[bot-registry] eager-load failed for twin ${config.twin_id}: ${msg}`,
        );
      }
    }

    console.log(
      `[bot-registry] eager-load: ${this.bots.size}/${configs.length} ` +
        `Bot(s) registriert ` +
        `(Mode: ${this.usePolling ? "polling" : "webhook"})`,
    );
  }

  /**
   * Boot-Step (nach `app.listen`, analog `registry.startBridges`): im
   * Polling-Mode startet hier der Long-Polling-Loop pro Bot. Im Webhook-Mode
   * No-Op — Updates kommen via Fastify-Route.
   *
   * bot.launch() ist explizit fire-and-forget: der Promise resolved erst,
   * wenn bot.stop() aufgerufen wird, also blockt ein `await` für immer.
   * Der `.catch` fängt Crash-Fälle (Token ungültig, Telegram-Outage etc.)
   * ohne den ganzen Prozess zu killen.
   */
  start(logger: FastifyBaseLogger): void {
    this.logger = logger;
    if (!this.usePolling) {
      logger.info(
        `[bot-registry] webhook-mode: ${this.bots.size} Bot(s) bereit für /webhooks/telegram/:handle`,
      );
      return;
    }

    for (const [twin_id, bot] of this.bots) {
      bot
        .launch()
        .catch((err) => {
          const msg = err instanceof Error ? err.message : String(err);
          logger.error(
            { twin_id, err: msg },
            "[bot-registry] polling-launch failed",
          );
        });
    }
    logger.info(
      `[bot-registry] polling-mode: ${this.bots.size} Bot(s) im Long-Poll gestartet`,
    );
  }

  /**
   * Lazy-Load: nach einem Config-Insert (Settings-UI), erfolgreichem Pairing
   * oder einem Token-Update aufrufen. Idempotent — wenn der Bot schon im Map
   * ist, wird er erst sauber gestoppt (alte Token-Bindung freigeben), dann
   * neu instanziiert.
   *
   * Kein Gate auf Pairing-State: ein frisch konfigurierter Bot ohne Owner-
   * Pairing muss starten, damit `/start <code>` empfangen werden kann.
   *
   * Für Polling-Mode-Lifecycle hier ebenfalls `bot.launch()` fire-and-forget.
   */
  startBotForTwin(twin_id: string): void {
    const config = this.configsRepo.findByTwinId(twin_id);
    if (!config) {
      throw new Error(
        `[bot-registry] startBotForTwin: keine Config für twin ${twin_id}`,
      );
    }

    if (this.bots.has(twin_id)) {
      this.stopBotForTwin(twin_id);
    }

    const bot = this.createAndRegisterBot(config);

    if (this.usePolling) {
      bot
        .launch()
        .catch((err) => {
          const msg = err instanceof Error ? err.message : String(err);
          (this.logger ?? console).error(
            `[bot-registry] polling-launch failed for ${twin_id}: ${msg}`,
          );
        });
    }
  }

  /**
   * Stoppt den Bot und entfernt ihn aus dem Map. Aufrufer: Unpair-Flow,
   * Token-Rotation (vor startBotForTwin), oder Webhook-Disable.
   *
   * Note (Phase 3+): Twin-delete-lifecycle ist noch nicht integriert. Wenn
   * TwinServiceRegistry einen Twin-Delete-Hook bekommt, muss diese Methode
   * von dort gerufen werden, um Bots sauber zu stoppen und ggf. das Webhook
   * bei Telegram zu deaktivieren.
   */
  stopBotForTwin(twin_id: string): void {
    const bot = this.bots.get(twin_id);
    if (!bot) return;
    // bot.stop() funktioniert nur, wenn launch() vorher lief. Im Webhook-Mode
    // (und bei nie gelaunchten Polling-Bots) wirft Telegraf „Bot is not
    // running!" — das ist hier kein Fehler, sondern der erwartete Pfad.
    if (this.usePolling) {
      try {
        bot.stop("manual-stop");
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (!msg.includes("not running")) {
          (this.logger ?? console).error(
            `[bot-registry] stop failed for ${twin_id}: ${msg}`,
          );
        }
      }
    }
    this.bots.delete(twin_id);
  }

  /**
   * Webhook-Dispatch: das Fastify-Route-Handler hat schon Handle→Config
   * resolved und Secret verifiziert. Hier nur noch das Update an die richtige
   * Bot-Instanz weiterreichen.
   *
   * Cold-Start-Fall: wenn der Bot zwischenzeitlich aus dem Map gefallen ist
   * (z.B. Eager-Load übersehen, weil zwischen DB-Read und Webhook-Hit gepairt),
   * versucht der Registry-Wrapper einmal Lazy-Init.
   */
  async handleWebhookUpdate(twin_id: string, update: unknown): Promise<boolean> {
    let bot = this.bots.get(twin_id);
    if (!bot) {
      try {
        this.startBotForTwin(twin_id);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        (this.logger ?? console).error(
          `[bot-registry] cold-start failed for ${twin_id}: ${msg}`,
        );
        return false;
      }
      bot = this.bots.get(twin_id);
      if (!bot) return false;
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await bot.handleUpdate(update as any);
    return true;
  }

  /** Graceful Shutdown — vom Boot-SIGTERM-Hook aufgerufen. */
  shutdown(): void {
    for (const twin_id of [...this.bots.keys()]) {
      this.stopBotForTwin(twin_id);
    }
  }

  /** Test-Helper für Smoke-Script: aktive Bot-Twins (ohne Token-Leak). */
  listActiveTwinIds(): string[] {
    return [...this.bots.keys()];
  }

  private createAndRegisterBot(
    config: Parameters<TelegramConfigsRepo["decryptToken"]>[0],
  ): Telegraf {
    const token = this.configsRepo.decryptToken(config);
    const bot = createTelegrafBot(
      config,
      token,
      this.pairingService,
      this.configsRepo,
      this.messageRouter,
      this.profilesRepo,
      this.logger ?? undefined,
    );
    this.bots.set(config.twin_id, bot);
    return bot;
  }

  /**
   * setWebhook bei Telegram registrieren — wird von den API-Routes nach
   * Config-Create + Token-Rotation aufgerufen. Bot muss vorher schon im
   * Map sein (startBotForTwin). Im Polling-Mode No-Op.
   *
   * Handle wird aus twin_profiles geholt, damit die URL sprechend
   * (`/webhooks/telegram/@markus`) statt twin_id-Hash bleibt.
   */
  async registerWebhook(twin_id: string): Promise<void> {
    if (this.usePolling) return;
    if (!this.publicBaseUrl) {
      throw new Error(
        "[bot-registry] registerWebhook: publicBaseUrl ist null — Webhook-Mode ohne RUNTIME_PUBLIC_URL?",
      );
    }
    const bot = this.bots.get(twin_id);
    const config = this.configsRepo.findByTwinId(twin_id);
    const profile = this.profilesRepo.findById(twin_id);
    if (!bot || !config || !profile) {
      throw new Error(
        `[bot-registry] registerWebhook: fehlende Voraussetzung für ${twin_id} ` +
          `(bot=${!!bot}, config=${!!config}, profile=${!!profile})`,
      );
    }
    const handle = profile.handle;
    const url = `${this.publicBaseUrl.replace(/\/+$/, "")}/webhooks/telegram/${encodeURIComponent(handle)}`;
    await bot.telegram.setWebhook(url, {
      secret_token: config.webhook_secret,
    });
  }

  /**
   * Alias für `registerWebhook`, der den §h-Token-Rotation-Flow im Caller-
   * Code explicit macht. Nach `configsRepo.updateToken` (das einen neuen
   * `webhook_secret` generiert) refresht ein `rotateWebhook`-Call die
   * Registrierung bei Telegram mit dem neuen Secret. `paired_owner_*`
   * bleibt unangetastet — Pairing-State gehört nicht zur Token-Rotation.
   *
   * Siehe `docs/130-TELEGRAM-STRATEGY.md` §h.
   */
  async rotateWebhook(twin_id: string): Promise<void> {
    return this.registerWebhook(twin_id);
  }

  /**
   * deleteWebhook bei Telegram aufrufen — von der DELETE-API-Route VOR
   * stopBotForTwin gerufen, damit Telegram keine Updates mehr ans Backend
   * schickt, das gleich verschwindet. Idempotent: wenn kein Bot im Map ist
   * (z.B. nach Stale-State), still durchwinken.
   */
  async unregisterWebhook(twin_id: string): Promise<void> {
    if (this.usePolling) return;
    const bot = this.bots.get(twin_id);
    if (!bot) return;
    await bot.telegram.deleteWebhook();
  }
}
