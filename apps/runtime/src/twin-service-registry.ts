import type { FastifyBaseLogger } from "fastify";
import type Database from "better-sqlite3";
import type { Persona } from "@twin-lab/shared";
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
import {
  decrypt,
  EncryptionDecryptError,
  maskApiKey,
} from "./crypto-utils.js";
import type { AuditRepository } from "./repository/types.js";
import type { BridgeConfig } from "./bridge/types.js";
import type { TrustRepo } from "./trust/trust-repo.js";

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
  bridgeClient: BridgeClient;
  bridgeStream: BridgeStream;
}

export interface TwinSummary {
  twinId: string;
  handle: string;
  displayName: string;
}

interface RegistryDeps {
  db: Database.Database;
  auditRepo: AuditRepository;
  logger: FastifyBaseLogger;
  masterKey: Buffer;
  trustRepo: TrustRepo;
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
    );

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

    // Erst nach erfolgreichem buildEntry + Stream-Connect in Map eintragen,
    // damit Konsumenten keinen halb-aufgebauten Twin sehen.
    this.entries.set(profile.handle, entry);
    deps.logger.info(
      { handle: profile.handle, twinId },
      `[registry] Twin ${profile.handle} hot-loaded`,
    );
    deps.logger.info(
      { handle: profile.handle },
      `[registry] Bridge-Connection für ${profile.handle} aktiv`,
    );
  }

  /**
   * Pro Twin: Bridge-Inbox sync + Stream connect. Sequentiell, damit Logs
   * lesbar bleiben. Sync-Fehler kippen nicht den Boot — Stream übernimmt
   * Catch-up.
   */
  async startBridges(logger: FastifyBaseLogger): Promise<void> {
    for (const entry of this.entries.values()) {
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
          entry.bridgeStream.disconnect();
        } catch (err) {
          console.error(`[shutdown] ${entry.handle} disconnect:`, err);
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
          `Re-Bootstrap nötig: 'pnpm --filter @twin-lab/runtime twin:bootstrap ${profile.handle.replace(/^@/, "")}'`,
      );
    }
    let apiKey: string;
    try {
      apiKey = decrypt(profile.llmConfig.apiKeyEncrypted, masterKey);
    } catch (err) {
      if (err instanceof EncryptionDecryptError) {
        throw new Error(
          `Twin '${profile.handle}': API-Key konnte nicht entschlüsselt werden — ${err.message}. ` +
            `Master-Key falsch oder Profil korrupt? Re-Bootstrap mit korrektem TWIN_LAB_ENCRYPTION_KEY.`,
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

    const bridgeConfig: BridgeConfig = {
      url: profile.bridgeUrl,
      handle: profile.handle,
      token: profile.bridgeToken,
    };
    const bridgeClient = new BridgeClient(bridgeConfig, logger);

    const service = new TwinService({
      twinId: profile.twinId,
      ownerUserId: profile.ownerUserId,
      model,
      modelLabel,
      audit,
      bus,
      persona,
      mandates: profile.mandates,
      bridgeClient,
      trustRepo,
    });

    const bridgeStream = new BridgeStream(
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
    );

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
