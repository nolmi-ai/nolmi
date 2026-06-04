import type { FastifyBaseLogger } from "fastify";
import type Database from "better-sqlite3";
import type { Persona } from "@nolmi/shared";
import { TwinProfilesRepo, type TwinProfile } from "./twin-profiles-repo.js";
import { TwinService } from "./twin-service.js";
import { AuditService } from "./audit/service.js";
import { EventBus } from "./events/bus.js";
import { BridgeClient } from "./bridge/client.js";
import { BridgeStream } from "./bridge/stream.js";
import { createLlmClient } from "./llm-client.js";
import {
  formatLlmLabel,
  type ApiKeySource,
  type TwinLlmConfig,
} from "./llm-config.js";
import { resolveClassifierConfig } from "./skills/classifier-map.js";
import {
  decrypt,
  EncryptionDecryptError,
  maskApiKey,
} from "./crypto-utils.js";
import type { AuditRepository } from "./repository/types.js";
import type { BridgeConfig } from "./bridge/types.js";
import type { TrustRepo } from "./trust/trust-repo.js";
import type { SkillRepo } from "./skills/repo.js";
import type { ConversationsRepo } from "./conversations/repo.js";
import { ConversationSummariesRepo } from "./conversations/summaries-repo.js";
import type { McpServersRepo } from "./mcp/repo.js";
import { FactsRepo } from "./facts/repo.js";
import { FactsHistoryRepo } from "./facts/facts-history-repo.js";
import {
  defaultMcpClientFactory,
  type McpClientFactory,
} from "./mcp/client-factory.js";
import { EmbeddingsRepo } from "./episodic/embeddings-repo.js";
import { TwinDiaryRepo } from "./episodic/twin-diary-repo.js";
import { MemoryEmbeddingService } from "./episodic/memory-embedding-service.js";
import { MemoryRetrievalService } from "./episodic/memory-retrieval-service.js";
import { TwinDiaryService } from "./episodic/twin-diary-service.js";
import { getEmbeddingProvider } from "./episodic/providers/index.js";
import type { OAuthRefreshService } from "./oauth/refresh-service.js";

// ─── TWIN SERVICE REGISTRY ──────────────────────────────────────────────────
//
// Hält pro aktivem Twin:
//   - eine eigene EventBus-Instanz (kein Cross-Talk zwischen Twins im /stream)
//   - eine eigene AuditService-Instanz (stempelt twin_id auf jeden Eintrag)
//   - eine TwinService-Instanz (mit Persona + Mandates + LLM aus dem Profil)
//   - einen BridgeClient + BridgeStream (eigene SSE-Connection pro Twin)
//
// Boot lädt alle is_active=true Twins parallel; Shutdown disconnected alle
// Bridge-Streams parallel. Server-Routes routen über `getByHandle(handle)`.

export interface RegistryEntry {
  twinId: string;
  handle: string;
  displayName: string;
  /** Volles Profil — gecached beim Boot, für Read-only-Endpoints. */
  profile: TwinProfile;
  /**
   * Beim Boot einmal entschlüsselt + gecached. Plaintext-API-Key bleibt
   * NICHT hier liegen (steckt im LanguageModel-Closure). Hier nur das, was
   * Server für die UI ausgeben darf.
   */
  llmDisplay: {
    label: string; // "anthropic/claude-opus-4-7"
    apiKeyMasked: string; // "sk-an…xyz1"
    apiKeySource: ApiKeySource;
  };
  service: TwinService;
  bus: EventBus;
  /**
   * Distribution Etappe 1: NULL für Solo-Twins (twin_profiles.bridge_url NULL).
   * Boot konstruiert Client/Stream nur bei vorhandener Bridge-Konfig — alle
   * Bridge-Pfade (Inbox-Sync, Stream-Connect, A2A-Send) prüfen auf null.
   */
  bridgeClient: BridgeClient | null;
  bridgeStream: BridgeStream | null;
}

export interface TwinSummary {
  twinId: string;
  handle: string;
  displayName: string;
}

/**
 * #744: Minimaler Strukturvertrag für den Telegram-Bot-Teardown beim Twin-
 * Löschen. Strukturell statt Import von `TelegramBotRegistry`, damit die
 * Registry nicht ans Telegram-Modul gekoppelt wird (das `message-router`
 * wiederum auf die Registry zeigt — Zyklus-Vermeidung).
 */
export interface TelegramBotTeardown {
  unregisterWebhook(twinId: string): Promise<void>;
  stopBotForTwin(twinId: string): void;
}

interface RegistryDeps {
  db: Database.Database;
  auditRepo: AuditRepository;
  logger: FastifyBaseLogger;
  masterKey: Buffer;
  trustRepo: TrustRepo;
  skillRepo: SkillRepo;
  conversationsRepo: ConversationsRepo;
  mcpServersRepo: McpServersRepo;
  /**
   * Default ist {@link defaultMcpClientFactory} (echte Subprocess-Spawns).
   * Optional, weil Production immer den Default will und Boot-Code so kein
   * unnötiges Boilerplate braucht. Tests injecten eine Mock-Factory.
   */
  mcpClientFactory?: McpClientFactory;
  /**
   * #131 Phase 3.0: Refresh-Service-Singleton aus dem Boot-Pfad. Wird im
   * Send-Path bei `authMode === 'oauth'` via `ensureFresh(twinId)` vor jedem
   * Codex-Call konsultiert (Lazy-Refresh + Mutex). Optional, weil Bootstrap-
   * Smokes ohne OAuth-Twins existieren können — Tests setzen das Feld nicht.
   */
  oauthRefreshService?: OAuthRefreshService;
}

export class TwinServiceRegistry {
  private readonly entries = new Map<string, RegistryEntry>();
  /**
   * Wird in {@link loadAll} gesetzt. {@link addTwin} braucht dieselben Deps,
   * um Hot-Loads zur Laufzeit aufzubauen.
   */
  private deps: RegistryDeps | null = null;
  /**
   * Mutex pro twinId für parallele {@link addTwin}-Aufrufe. Verhindert,
   * dass derselbe Twin bei zwei zeitgleichen Adds zwei Mal gebuildet wird
   * (zwei BridgeStreams = doppelte Inbox-Empfänger).
   */
  private readonly pendingAdds = new Map<string, Promise<void>>();

  /**
   * Lädt alle aktiven Twins aus `twin_profiles`. Pro Twin wird die volle
   * Service-Stack (EventBus + Audit + TwinService + Bridge) konstruiert.
   * Inbox-Sync und Stream-Connect passieren danach in {@link startBridges}.
   * Speichert die Deps für spätere {@link addTwin}-Aufrufe (Hot-Reload).
   */
  loadAll(opts: RegistryDeps): void {
    this.deps = opts;
    const profilesRepo = new TwinProfilesRepo(opts.db);
    const profiles = profilesRepo.list({ activeOnly: true });

    for (const profile of profiles) {
      const entry = this.buildEntry(
        profile,
        opts.auditRepo,
        opts.logger,
        opts.masterKey,
        opts.trustRepo,
        opts.skillRepo,
        opts.conversationsRepo,
        opts.mcpServersRepo,
        opts.mcpClientFactory ?? defaultMcpClientFactory,
      );
      this.entries.set(profile.handle, entry);
    }
  }

  /**
   * Lädt einen einzelnen Twin zur Laufzeit nach (Onboarding-Submit). Erwartet,
   * dass das Profil bereits in `twin_profiles` steht. Idempotent: ist der
   * Twin bereits in der Registry, no-op. Atomisch: parallele Aufrufe für
   * dieselbe twinId teilen sich die in-flight Promise.
   *
   * Bei Erfolg: Inbox-Sync + Bridge-Stream sind verbunden, Twin ist über
   * {@link getByHandle} verfügbar. Bei Fehler: keine Mutation der entries-Map.
   */
  async addTwin(twinId: string): Promise<void> {
    if (!this.deps) {
      throw new Error(
        "[registry] addTwin: Registry nicht initialisiert — loadAll() muss vorher gelaufen sein",
      );
    }

    // Idempotenz — Twin schon in Map? entries ist nach handle indiziert,
    // also über alle iterieren. Bei aktuellen Größenordnungen (3 Twins)
    // ist das null Aufwand; bei 100+ wäre ein twinId-Index sinnvoll.
    for (const entry of this.entries.values()) {
      if (entry.twinId === twinId) {
        this.deps.logger.debug(
          { twinId, handle: entry.handle },
          "[registry] addTwin: Twin ist bereits geladen — no-op",
        );
        return;
      }
    }

    // Mutex — schon ein Add für diese twinId in flight?
    const inflight = this.pendingAdds.get(twinId);
    if (inflight) return inflight;

    const promise = this.doAddTwin(twinId);
    this.pendingAdds.set(twinId, promise);
    try {
      await promise;
    } finally {
      this.pendingAdds.delete(twinId);
    }
  }

  private async doAddTwin(twinId: string): Promise<void> {
    const deps = this.deps!;
    const profilesRepo = new TwinProfilesRepo(deps.db);
    const profile = profilesRepo.findById(twinId);
    if (!profile) {
      throw new Error(`[registry] addTwin: Twin-Profil ${twinId} nicht in DB`);
    }

    const entry = this.buildEntry(
      profile,
      deps.auditRepo,
      deps.logger,
      deps.masterKey,
      deps.trustRepo,
      deps.skillRepo,
      deps.conversationsRepo,
      deps.mcpServersRepo,
      deps.mcpClientFactory ?? defaultMcpClientFactory,
    );

    // Distribution Etappe 1: Solo-Twin (keine Bridge) → kein Inbox-Sync/Connect.
    if (entry.bridgeClient && entry.bridgeStream) {
      // Inbox-Sync analog zu {@link startBridges} — Sync-Fehler sind nicht
      // tödlich, der Stream übernimmt Catch-up.
      let synced = 0;
      try {
        const inbox = await entry.bridgeClient.getInbox();
        for (const msg of inbox) {
          await entry.service.receiveBridgeMessage(msg);
          synced++;
        }
        deps.logger.info(
          { handle: entry.handle, synced },
          "[registry] Inbox-Sync nach Hot-Load",
        );
      } catch (err) {
        deps.logger.error(
          { err, handle: entry.handle },
          "[registry] Inbox-Sync nach Hot-Load fehlgeschlagen — Stream übernimmt Catch-up",
        );
      }
      entry.bridgeStream.connect();
    }

    // Erst nach erfolgreichem buildEntry (+ ggf. Stream-Connect) in Map
    // eintragen, damit Konsumenten keinen halb-aufgebauten Twin sehen.
    this.entries.set(profile.handle, entry);
    deps.logger.info(
      { handle: profile.handle, twinId },
      `[registry] Twin ${profile.handle} hot-loaded`,
    );
    deps.logger.info(
      { handle: profile.handle, bridge: !!entry.bridgeClient },
      entry.bridgeClient
        ? `[registry] Bridge-Connection für ${profile.handle} aktiv`
        : `[registry] ${profile.handle} im Solo-Modus (keine Bridge)`,
    );
  }

  /**
   * Pro Twin: Bridge-Inbox sync + Stream connect. Sequentiell, damit Logs
   * lesbar bleiben. Sync-Fehler kippen nicht den Boot — Stream übernimmt
   * Catch-up.
   */
  async startBridges(logger: FastifyBaseLogger): Promise<void> {
    for (const entry of this.entries.values()) {
      // Distribution Etappe 1: Solo-Twin ohne Bridge — kein Inbox-Sync, kein
      // Stream-Connect, kein Reconnect-Loop. Eine klare Boot-Zeile statt
      // stillem Überspringen.
      if (!entry.bridgeClient || !entry.bridgeStream) {
        console.log(`[boot] ${entry.handle}: Solo-Modus (keine Bridge)`);
        continue;
      }
      let synced = 0;
      try {
        const inbox = await entry.bridgeClient.getInbox();
        for (const msg of inbox) {
          await entry.service.receiveBridgeMessage(msg);
          synced++;
        }
        console.log(
          `[boot] ${entry.handle} Inbox-Sync: ${synced} Nachricht(en) als Pending erfasst`,
        );
      } catch (err) {
        logger.error(
          { err, handle: entry.handle },
          "[boot] Inbox-Sync fehlgeschlagen — Stream übernimmt Catch-up",
        );
      }
      entry.bridgeStream.connect();
    }
  }

  /**
   * #744: Gegenstück zu {@link addTwin} — entfernt die Live-Instanz eines
   * Twins aus der Registry, damit ein gelöschter Twin nicht bis zum nächsten
   * Restart im Prozess weiterlebt. Reine In-Memory-/Netzwerk-Teardown-Operation;
   * die DB-Löschung passiert separat (deleteTwinLocal) VOR diesem Aufruf.
   *
   * Reihenfolge analog zum Shutdown: erst Inbound stoppen (Telegram-Bot +
   * Bridge-Stream), dann MCP-Subprocesses disposen, zuletzt aus der Map.
   * Alle Teardown-Schritte sind best-effort — ein Fehler beim Bot-Stop oder
   * MCP-Dispose darf den Entfernungs-Vorgang nicht kippen (der Twin ist in der
   * DB ja schon weg). No-op, wenn der Handle nicht (mehr) geführt wird.
   *
   * `telegramBotTeardown`: optional injiziert vom Route-Handler
   * (`deps.telegramBotRegistry`). Der Bot lebt als Telegraf-Instanz in einer
   * `Map<twin_id, Telegraf>` der BotRegistry und muss separat gestoppt werden
   * (im Webhook-Mode zusätzlich `deleteWebhook` bei Telegram) — sonst bliebe
   * ein Zombie-Bot zurück. Die Map arbeitet rein in-memory, also funktioniert
   * der Teardown auch nach dem DB-Cascade-Delete der telegram_configs-Row.
   */
  async removeTwin(
    handle: string,
    opts?: { telegramBotTeardown?: TelegramBotTeardown },
  ): Promise<void> {
    const entry = this.entries.get(handle);
    if (!entry) {
      this.deps?.logger.debug(
        { handle },
        "[registry] removeTwin: Twin nicht in der Registry — no-op",
      );
      return;
    }
    const logger = this.deps?.logger;

    // 1. Telegram-Bot stoppen (best-effort). unregisterWebhook ist ein
    //    Netzwerk-Call (deleteWebhook bei Telegram) → eigener try/catch, damit
    //    ein Telegram-Outage den Teardown nicht blockt.
    if (opts?.telegramBotTeardown) {
      try {
        await opts.telegramBotTeardown.unregisterWebhook(entry.twinId);
      } catch (err) {
        logger?.error(
          { err, handle, twinId: entry.twinId },
          "[registry] removeTwin: Telegram unregisterWebhook fehlgeschlagen — fahre fort",
        );
      }
      try {
        opts.telegramBotTeardown.stopBotForTwin(entry.twinId);
      } catch (err) {
        logger?.error(
          { err, handle, twinId: entry.twinId },
          "[registry] removeTwin: Telegram stopBotForTwin fehlgeschlagen — fahre fort",
        );
      }
    }

    // 2. Bridge-Stream trennen (Solo-Twin: kein Stream).
    try {
      entry.bridgeStream?.disconnect();
    } catch (err) {
      logger?.error(
        { err, handle },
        "[registry] removeTwin: Bridge-Stream disconnect fehlgeschlagen — fahre fort",
      );
    }

    // 3. MCP-Subprocesses disposen (sonst verwaiste Child-Prozesse).
    try {
      await entry.service.dispose();
    } catch (err) {
      logger?.error(
        { err, handle },
        "[registry] removeTwin: MCP dispose fehlgeschlagen — fahre fort",
      );
    }

    // 4. Aus der Map nehmen — ab jetzt liefert getByHandle null.
    this.entries.delete(handle);
    logger?.info(
      { handle, twinId: entry.twinId },
      `[registry] Twin ${handle} aus der Registry entfernt (hot-unload)`,
    );
  }

  getByHandle(handle: string): TwinService | null {
    return this.entries.get(handle)?.service ?? null;
  }

  getEntry(handle: string): RegistryEntry | null {
    return this.entries.get(handle) ?? null;
  }

  list(): TwinSummary[] {
    return [...this.entries.values()].map((e) => ({
      twinId: e.twinId,
      handle: e.handle,
      displayName: e.displayName,
    }));
  }

  /** Schließt alle Bridge-Streams parallel. */
  async shutdown(): Promise<void> {
    await Promise.all(
      [...this.entries.values()].map(async (entry) => {
        try {
          entry.bridgeStream?.disconnect(); // Solo-Twin: kein Stream
        } catch (err) {
          console.error(`[shutdown] ${entry.handle} disconnect:`, err);
        }
      }),
    );
  }

  /**
   * Beendet alle MCP-Subprocesses aller Twins parallel. Wird vom Container-
   * Shutdown vor app.close() aufgerufen, damit keine verwaisten Child-
   * Prozesse zurückbleiben. Bridge-Stream-Disconnect läuft separat in
   * {@link shutdown} — beide Pfade dürfen sich nicht blockieren.
   */
  async disposeAll(): Promise<void> {
    await Promise.all(
      [...this.entries.values()].map(async (entry) => {
        try {
          await entry.service.dispose();
        } catch (err) {
          console.error(`[shutdown] ${entry.handle} mcp.dispose:`, err);
        }
      }),
    );
  }

  // ─── intern ───────────────────────────────────────────────────────────────

  private buildEntry(
    profile: TwinProfile,
    auditRepo: AuditRepository,
    logger: FastifyBaseLogger,
    masterKey: Buffer,
    trustRepo: TrustRepo,
    skillRepo: SkillRepo,
    conversationsRepo: ConversationsRepo,
    mcpServersRepo: McpServersRepo,
    mcpClientFactory: McpClientFactory,
  ): RegistryEntry {
    const bus = new EventBus();
    const audit = new AuditService(auditRepo, bus, profile.twinId);

    const persona: Persona = {
      name: profile.displayName,
      handle: profile.handle.replace(/^@/, ""),
      systemPrompt: profile.personaMd,
      metadata: {},
    };

    // API-Key entschlüsseln. Tampering / falscher Master-Key wirft hier mit
    // klarer Diagnose; index.ts fängt das und exit-1't mit Twin-Handle.
    if (!profile.llmConfig.apiKeyEncrypted) {
      throw new Error(
        `Twin '${profile.handle}' hat keinen apiKeyEncrypted im Profil. ` +
          `Re-Bootstrap nötig: 'pnpm --filter @nolmi/runtime twin:bootstrap ${profile.handle.replace(/^@/, "")}'`,
      );
    }
    let apiKey: string;
    try {
      apiKey = decrypt(profile.llmConfig.apiKeyEncrypted, masterKey);
    } catch (err) {
      if (err instanceof EncryptionDecryptError) {
        throw new Error(
          `Twin '${profile.handle}': API-Key konnte nicht entschlüsselt werden — ${err.message}. ` +
            `Master-Key falsch oder Profil korrupt? Re-Bootstrap mit korrektem NOLMI_ENCRYPTION_KEY.`,
        );
      }
      throw err;
    }

    const runtimeLlmConfig: TwinLlmConfig = {
      provider: profile.llmConfig.provider,
      model: profile.llmConfig.model,
      apiKey,
      baseUrl: profile.llmConfig.baseUrl,
    };
    const model = createLlmClient(runtimeLlmConfig);
    const modelLabel = formatLlmLabel(runtimeLlmConfig);

    // #107: Pre-Pass-Classifier-Modell pro Twin eager konstruieren. createLlmClient
    // ist reine Construction (kein Netzwerk-Call, siehe llm-client.ts), also
    // kostet das beim Boot quasi nichts und vermeidet Lazy-Init-State im
    // Send-Path. Aktivierung des Pre-Pass selbst läuft im Send-Path
    // conditional (nur wenn aktive forced-Skills da sind).
    const classifierLlmConfig = resolveClassifierConfig(runtimeLlmConfig);
    const classifierModel = createLlmClient(classifierLlmConfig);
    const classifierModelLabel = formatLlmLabel(classifierLlmConfig);

    // Distribution Etappe 1: Solo-Twin (bridge_url/token NULL) → kein Client,
    // kein Stream. Beide nur konstruieren, wenn die Bridge-Konfig vollständig
    // ist. Der Send-Path + alle Bridge-Endpunkte prüfen auf null.
    const hasBridge = !!(profile.bridgeUrl && profile.bridgeToken);
    const bridgeConfig: BridgeConfig | null = hasBridge
      ? {
          url: profile.bridgeUrl!,
          handle: profile.handle,
          token: profile.bridgeToken!,
        }
      : null;
    const bridgeClient: BridgeClient | null = bridgeConfig
      ? new BridgeClient(bridgeConfig, logger)
      : null;

    // 3.3.B/E + 3.4.D: Repos pro Twin ad-hoc auf der geteilten db-Connection
    // bauen. Alle zustandslos, also kein Pool-Effekt zwischen Twins — wir
    // vermeiden nur, sie durch die RegistryDeps-Plumbing zu schleifen.
    const db = this.deps!.db;
    const conversationSummaries = new ConversationSummariesRepo(db);
    const facts = new FactsRepo(db, new FactsHistoryRepo(db));
    const embeddingsRepo = new EmbeddingsRepo(db);
    const twinDiaryRepo = new TwinDiaryRepo(db);

    // 3.4.D: Memory-Embedding-Service mit Lazy-Provider-Resolve. Der
    // `getEmbeddingProvider()`-Call selbst ist billig (Factory-Lookup); das
    // teure Modell-Loading passiert erst beim ersten echten Embed im
    // Send-Path. Provider-Singleton ist global, also identisch über alle Twins.
    const memoryEmbeddingService = new MemoryEmbeddingService({
      embeddingsRepo,
      conversationSummariesRepo: conversationSummaries,
      conversationsRepo,
      twinDiaryRepo,
      getProvider: () => getEmbeddingProvider(),
    });
    // 3.4.E: Liest-Seite — Vector-Search im Send-Path. Eigene Service-
    // Instanz pro Twin (zustandslos, derselbe Provider-Singleton).
    const memoryRetrievalService = new MemoryRetrievalService({
      embeddingsRepo,
      getProvider: () => getEmbeddingProvider(),
    });
    const twinDiaryService = new TwinDiaryService(
      twinDiaryRepo,
      memoryEmbeddingService,
    );

    const service = new TwinService({
      twinId: profile.twinId,
      ownerUserId: profile.ownerUserId,
      model,
      modelLabel,
      classifierModel,
      classifierModelLabel,
      audit,
      bus,
      persona,
      mandates: profile.mandates,
      bridgeClient,
      trustRepo,
      skills: skillRepo,
      conversations: conversationsRepo,
      mcpServersRepo,
      mcpClientFactory,
      db,
      conversationSummaries,
      facts,
      memoryEmbeddingService,
      memoryRetrievalService,
      twinDiaryService,
      // #131 Phase 3.0: optional, Send-Path liest deps.oauthRefreshService NUR
      // bei authMode === 'oauth'. Existing api_key-Twins sind nicht betroffen.
      oauthRefreshService: this.deps!.oauthRefreshService,
    });

    const bridgeStream: BridgeStream | null = bridgeConfig
      ? new BridgeStream(
          bridgeConfig,
          (msg) => {
            service.receiveBridgeMessage(msg).catch((err) => {
              logger.error(
                { err, messageId: msg.id, handle: profile.handle },
                "[bridge:stream] receive fehlgeschlagen",
              );
            });
          },
          logger,
        )
      : null;

    return {
      twinId: profile.twinId,
      handle: profile.handle,
      displayName: profile.displayName,
      profile,
      llmDisplay: {
        label: modelLabel,
        apiKeyMasked: maskApiKey(apiKey),
        apiKeySource: profile.llmConfig.apiKeySource,
      },
      service,
      bus,
      bridgeClient,
      bridgeStream,
    };
  }
}
