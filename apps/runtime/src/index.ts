import "dotenv/config";
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { createSqliteRepository } from "./repository/index.js";
import { createServer } from "./server.js";
import { loadRuntimeConfig } from "./config.js";
import { TwinServiceRegistry } from "./twin-service-registry.js";
import { TwinProfilesRepo } from "./twin-profiles-repo.js";
import { TrustRepo } from "./trust/trust-repo.js";
import { SkillRepo } from "./skills/repo.js";
import { ConversationsRepo } from "./conversations/repo.js";
import { McpServersRepo } from "./mcp/repo.js";
import { FactsRepo } from "./facts/repo.js";
import { EmbeddingsRepo } from "./episodic/embeddings-repo.js";
import { TwinMaturityService } from "./twin-maturity/twin-maturity-service.js";
import { EncryptionKeyMissingError, loadMasterKey } from "./crypto-utils.js";
import { TelegramConfigsRepo } from "./telegram/configs-repo.js";
import { TelegramMessagesRepo } from "./telegram/messages-repo.js";
import { PairingService } from "./telegram/pairing-service.js";
import { TelegramBotRegistry } from "./telegram/bot-registry.js";
import { TelegramMessageRouter } from "./telegram/message-router.js";
import { OAuthTokensRepo } from "./oauth/oauth-tokens-repo.js";
import { OAuthRefreshService } from "./oauth/refresh-service.js";

// ─── BOOTSTRAP ───────────────────────────────────────────────────────────────
//
// Phase 2.5d: Multi-Twin pro Runtime. Alle aktiven Profile werden parallel
// als TwinService + BridgeClient + BridgeStream geladen. Routing nach Handle
// macht der Server.
//
// Boot-Sequenz:
//   1. Config + DB öffnen
//   2. Server starten (für app.log — Bridges hängen sich daran)
//   3. Registry: alle aktiven Twins laden (TwinService + Bridge pro Twin)
//   4. Bridge-Inbox-Sync + Stream-Connect pro Twin
//   5. Shutdown-Hooks für graceful disconnect

async function main() {
  const config = loadRuntimeConfig();
  await mkdir(dirname(config.dbPath), { recursive: true });

  // 1. Master-Key — Runtime weigert sich zu starten ohne. Vor DB, weil ein
  // fehlender Key sofort Exit ist, ohne dass wir andere Ressourcen anfassen.
  let masterKey: Buffer;
  try {
    masterKey = loadMasterKey();
  } catch (err) {
    if (err instanceof EncryptionKeyMissingError) {
      console.error(`[boot] ${err.message}`);
      process.exit(1);
    }
    throw err;
  }

  // 2. DB
  const repo = createSqliteRepository(config.dbPath);
  console.log(`[boot] DB: ${config.dbPath}`);

  // 3. Aktive Profile zählen — leere DB ist seit Hot-Reload (#37) kein Crash
  // mehr, sondern Onboarding-only-Modus: Server hört, Registry bleibt leer
  // bis zum ersten erfolgreichen /onboarding/submit.
  const profilesRepo = new TwinProfilesRepo(repo.db);
  const activeProfiles = profilesRepo.list({ activeOnly: true });
  if (activeProfiles.length === 0) {
    console.warn(
      "[boot] Server läuft im Onboarding-only-Modus. Erster Twin via /onboarding.",
    );
  }

  // 4. Server (mit Logger). profilesRepo + masterKey gehen an die
  // Onboarding-Routes; Registry kennt den Server für Twin-Lookup pro Request.
  // trustRepo wird sowohl von Server-Routes (/twins/:handle/trust) als auch
  // vom TwinService (Trust-Bypass-Check) genutzt — eine Instanz, geteilt.
  const registry = new TwinServiceRegistry();
  const trustRepo = new TrustRepo(repo.db);
  const skillRepo = new SkillRepo(repo.db);
  const conversationsRepo = new ConversationsRepo(repo.db);
  const mcpServersRepo = new McpServersRepo(repo.db, masterKey);
  const factsRepo = new FactsRepo(repo.db);
  // #101: TwinMaturityService — server-weite Instanz auf der geteilten
  // db-Connection. Stateless, daher kein Per-Twin-Setup nötig wie in der
  // Registry (Embeddings/Facts werden per twinId-Filter in den Queries
  // skopiert).
  const embeddingsRepoForMaturity = new EmbeddingsRepo(repo.db);
  const twinMaturityService = new TwinMaturityService({
    db: repo.db,
    embeddingsRepo: embeddingsRepoForMaturity,
    factsRepo,
  });

  // #130 Phase 2 + 3 — Telegram-Adapter-Services. Configs/Messages-Repo +
  // PairingService + MessageRouter sind dünn (kein Network). BotRegistry
  // hält die Telegraf-Instanzen, MessageRouter routet Inbound-Owner-Texts
  // an TwinService.chat() (Owner-Bypass für cross-channel Memory).
  const telegramConfigsRepo = new TelegramConfigsRepo(repo.db, masterKey);
  const telegramMessagesRepo = new TelegramMessagesRepo(repo.db);
  const pairingService = new PairingService(telegramConfigsRepo);
  const telegramMessageRouter = new TelegramMessageRouter(
    telegramConfigsRepo,
    telegramMessagesRepo,
    conversationsRepo,
    registry,
  );
  const telegramBotRegistry = new TelegramBotRegistry(
    telegramConfigsRepo,
    pairingService,
    telegramMessageRouter,
    profilesRepo,
    config.telegramUsePolling,
    config.runtimePublicUrl,
  );

  // #131 Phase 2 — OAuth-Refresh-Service. Singleton, hält Background-Poll-
  // Loop + Mutex-Map für Lazy-Refresh. Construction hier, start() unten
  // nach app.listen (analog telegramBotRegistry). Phase 3 wired den
  // Service in den Provider-Layer (Lazy-Refresh vor jedem LLM-Call).
  const oauthTokensRepo = new OAuthTokensRepo(repo.db, masterKey);
  const oauthRefreshService = new OAuthRefreshService(
    oauthTokensRepo,
    repo.audit,
  );

  const app = await createServer({
    audit: repo.audit,
    registry,
    profilesRepo,
    masterKey,
    db: repo.db,
    trustRepo,
    skillRepo,
    conversationsRepo,
    mcpServersRepo,
    factsRepo,
    twinMaturityService,
    examplesDir: config.examplesDir,
    telegramConfigsRepo,
    telegramBotRegistry,
    telegramPairingService: pairingService,
  });

  // #130 Phase 2 — Eager-Load aller konfigurierten Bots (gepaart wie
  // ungepaart). Synchron, populiert nur die Bot-Map; Polling-Launch passiert
  // nach app.listen analog zu startBridges. Pairing-State gated nur das
  // Text-Antwortverhalten, nicht die Bot-Liveness.
  telegramBotRegistry.eagerLoadAllBots();

  // 5. Registry mit allen aktiven Twins füllen — entschlüsselt API-Keys.
  // Decrypt-Fehler (falscher Master-Key, korrupter Eintrag) werfen mit klarer
  // Diagnose pro Twin; main()-Catch macht exit-1.
  registry.loadAll({
    db: repo.db,
    auditRepo: repo.audit,
    logger: app.log,
    masterKey,
    trustRepo,
    skillRepo,
    conversationsRepo,
    mcpServersRepo,
  });
  const summaries = registry.list();

  console.log(`[boot] ${summaries.length} Twin(s) aktiv:`);
  for (const t of summaries) {
    console.log(`  - ${t.handle} (${t.twinId})`);
  }

  // 6. Per-Twin LLM + Bridge-Konfig loggen (API-Key maskiert), dann Bridges
  for (const t of summaries) {
    const entry = registry.getEntry(t.handle)!;
    console.log(
      `[boot] ${t.handle}: LLM=${entry.llmDisplay.label}, ` +
        `API-Key=${entry.llmDisplay.apiKeyMasked}, ` +
        `Bridge=${entry.profile.bridgeUrl}`,
    );
  }

  // 7. Listen
  await app.listen({ port: config.port, host: config.host });
  console.log(`[boot] Runtime hört auf http://${config.host}:${config.port}`);

  // 8. Bridges starten (nach Server-Listen, damit Logger via app.log läuft)
  await registry.startBridges(app.log);

  // #130 Phase 2 — Polling-Launches starten (Webhook-Mode: No-Op). Logger
  // verfügbar erst nach app.listen; analog startBridges-Reihenfolge.
  telegramBotRegistry.start(app.log);

  // #131 Phase 2 — OAuth-Refresh-Background-Loop starten. Pollt alle 60s
  // expiring Tokens und refresht sie proaktiv. Lazy-Refresh-API ist sofort
  // verfügbar (kein Boot-Wait), aber Background-Tick erst ab jetzt.
  oauthRefreshService.start(app.log);

  // 9. Graceful Shutdown
  const shutdown = async (signal: string) => {
    console.log(`[shutdown] ${signal} empfangen — fahre runter`);
    // Reihenfolge: erst Bridge-Streams + Telegram-Bots + OAuth-Polling
    // (kein neuer Inbound + kein neuer Refresh-Tick), dann MCP-Subprocesses
    // disposen (kein neuer Outbound an Tools), dann Fastify schließen.
    await registry.shutdown();
    telegramBotRegistry.shutdown();
    oauthRefreshService.stop();
    await registry.disposeAll();
    try {
      await app.close();
    } catch (err) {
      console.error("[shutdown] app.close() Fehler:", err);
    }
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((err) => {
  console.error("[boot] Fataler Fehler:", err);
  process.exit(1);
});
