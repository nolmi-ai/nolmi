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

export class TwinServiceRegistry {
  private readonly entries = new Map<string, RegistryEntry>();

  /**
   * Lädt alle aktiven Twins aus `twin_profiles`. Pro Twin wird die volle
   * Service-Stack (EventBus + Audit + TwinService + Bridge) konstruiert.
   * Inbox-Sync und Stream-Connect passieren danach in {@link startBridges}.
   */
  loadAll(opts: {
    db: Database.Database;
    auditRepo: AuditRepository;
    logger: FastifyBaseLogger;
    masterKey: Buffer;
    trustRepo: TrustRepo;
  }): void {
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
