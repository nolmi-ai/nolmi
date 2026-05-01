import "dotenv/config";
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import type { Persona } from "@twin-lab/shared";
import { createSqliteRepository } from "./repository/index.js";
import { createLlmClient } from "./llm-client.js";
import { formatLlmLabel } from "./llm-config.js";
import { EventBus } from "./events/bus.js";
import { AuditService } from "./audit/service.js";
import { TwinService } from "./twin-service.js";
import { createServer } from "./server.js";
import { BridgeClient } from "./bridge/client.js";
import { BridgeStream } from "./bridge/stream.js";
import type { BridgeConfig } from "./bridge/types.js";
import { loadRuntimeConfig } from "./config.js";
import {
  loadActiveTwinProfile,
  TwinProfileNotAvailableError,
} from "./twin-profile-loader.js";

// ─── BOOTSTRAP ───────────────────────────────────────────────────────────────
//
// Phase 2.5: Persona/Mandates/LLM-Config kommen jetzt aus `twin_profiles`,
// nicht mehr aus Files+ENV. Welcher Twin geladen wird, bestimmt
// `TWIN_HANDLE` (Default `@markus`).
//
// Bridge-URL/Token kommen ebenfalls aus dem Profil. Die alten
// BRIDGE_URL/BRIDGE_TWIN_TOKEN/BRIDGE_TWIN_HANDLE-ENVs werden hier nicht
// mehr gelesen (das Bootstrap-Script liest sie noch, um initial in die DB
// zu schreiben).
//
// Boot-Sequenz:
//   1. Config + DB
//   2. Twin-Profil laden (oder Fail-Exit mit Bootstrap-Hinweis)
//   3. Persona, LLM-Client, Bridge-Config aus Profil ableiten
//   4. Services + Server starten
//   5. Bridge-Client + Stream nach Server-Start (Logger verfügbar)
//   6. Shutdown-Hooks

async function main() {
  const config = loadRuntimeConfig();
  await mkdir(dirname(config.dbPath), { recursive: true });

  // 1. DB
  const repo = createSqliteRepository(config.dbPath);
  console.log(`[boot] DB: ${config.dbPath}`);

  // 2. Twin-Profil
  const profile = (() => {
    try {
      return loadActiveTwinProfile(repo.db, config.twinHandle);
    } catch (err) {
      if (err instanceof TwinProfileNotAvailableError) {
        console.error(`[boot] ${err.message}`);
        process.exit(1);
      }
      throw err;
    }
  })();
  console.log(`[boot] Twin-Profil geladen aus DB: ${profile.handle} (${profile.twinId})`);
  console.log(`[boot] Persona: ${profile.displayName}`);
  console.log(`[boot] ${profile.mandates.length} Mandates aktiv`);

  // 3a. LLM aus Profil
  const model = createLlmClient(profile.llmConfig);
  const modelLabel = formatLlmLabel(profile.llmConfig);
  console.log(`[boot] LLM: ${modelLabel}`);

  // 3b. Bridge-Config aus Profil (immer aktiv — Schema garantiert die Felder)
  const bridgeConfig: BridgeConfig = {
    url: profile.bridgeUrl,
    handle: profile.handle,
    token: profile.bridgeToken,
  };
  console.log(`[boot] Bridge: ${profile.handle} → ${profile.bridgeUrl}`);

  // 3c. Persona-Objekt für TwinService bauen
  const persona: Persona = {
    name: profile.displayName,
    handle: profile.handle.replace(/^@/, ""),
    systemPrompt: profile.personaMd,
    metadata: {},
  };

  // 4. Services
  const bus = new EventBus();
  const audit = new AuditService(repo.audit, bus);
  const twin = new TwinService({
    model,
    modelLabel,
    persona,
    mandates: profile.mandates,
    audit,
    bus,
    bridgeClient: null, // wird gleich gesetzt
  });

  // 5. Server
  const app = await createServer({ twin, audit: repo.audit, bus });
  await app.listen({ port: config.port, host: config.host });
  console.log(`[boot] Runtime hört auf http://${config.host}:${config.port}`);

  // 6. Bridge Client + Stream
  const bridgeClient = new BridgeClient(bridgeConfig, app.log);
  twin.setBridgeClient(bridgeClient);

  let syncedCount = 0;
  try {
    const inbox = await bridgeClient.getInbox();
    for (const msg of inbox) {
      await twin.receiveBridgeMessage(msg);
      syncedCount++;
    }
    console.log(
      `[boot] Inbox-Sync: ${syncedCount} Nachricht(en) als Pending-Audits erfasst`,
    );
  } catch (err) {
    app.log.error(
      { err },
      "[boot] Inbox-Sync fehlgeschlagen — Stream übernimmt Catch-up",
    );
  }

  const bridgeStream = new BridgeStream(
    bridgeConfig,
    (msg) => {
      twin.receiveBridgeMessage(msg).catch((err) => {
        app.log.error(
          { err, messageId: msg.id },
          "[bridge:stream] receive fehlgeschlagen",
        );
      });
    },
    app.log,
  );
  bridgeStream.connect();

  // 7. Graceful Shutdown
  const shutdown = async (signal: string) => {
    console.log(`[shutdown] ${signal} empfangen — fahre runter`);
    bridgeStream.disconnect();
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
