import "dotenv/config";
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { createSqliteRepository } from "./repository/index.js";
import { createLlmClient } from "./llm-client.js";
import { formatLlmLabel, loadTwinLlmConfig } from "./llm-config.js";
import { EventBus } from "./events/bus.js";
import { AuditService } from "./audit/service.js";
import { TwinService } from "./twin-service.js";
import { createServer } from "./server.js";
import { loadPersona } from "./persona/loader.js";
import { loadMandatesFromYaml, syncMandates } from "./mandates/service.js";
import { BridgeClient } from "./bridge/client.js";
import { BridgeStream } from "./bridge/stream.js";
import type { BridgeConfig } from "./bridge/types.js";
import { loadRuntimeConfig } from "./config.js";

// ─── BOOTSTRAP ───────────────────────────────────────────────────────────────
//
// Bootet den Runtime in dieser Reihenfolge:
//   1. Config aus ENV laden, DB-File sicherstellen, Repository erzeugen
//   2. Persona aus konfiguriertem Pfad laden, ins Repository schreiben
//   3. Mandates aus konfiguriertem Pfad laden, mit Repository syncen
//   4. Provider erzeugen (OpenAI oder Anthropic je nach ENV)
//   5. Services verkabeln
//   6. HTTP-Server starten (Port/Host aus Config)
//   7. Bridge-Modus prüfen → Client + Stream falls aktiv
//   8. SIGINT/SIGTERM für graceful shutdown registrieren

async function main() {
  const config = loadRuntimeConfig();
  await mkdir(dirname(config.dbPath), { recursive: true });

  // 1. Repository
  const repo = createSqliteRepository(config.dbPath);
  console.log(`[boot] DB: ${config.dbPath}`);

  // 2. Persona laden + speichern
  const persona = await loadPersona({
    promptPath: config.personaPath,
    metaPath: config.personaMetaPath,
  });
  await repo.persona.save(persona);
  console.log(`[boot] Persona geladen aus ${config.personaPath}`);
  console.log(`[boot] Persona: ${persona.name} (@${persona.handle})`);

  // 3. Mandates syncen
  const mandates = await loadMandatesFromYaml(config.mandatesPath);
  await syncMandates(repo.mandates, mandates);
  console.log(`[boot] Mandates geladen aus ${config.mandatesPath}`);
  console.log(`[boot] ${mandates.length} Mandates synchronisiert`);

  // 4. LLM (Vercel AI SDK) — der eigentliche Modell-Call läuft über
  // `generateText` im TwinService. Konfiguration kommt aus ENV und kann pro
  // Twin-Instanz frei gesetzt werden (Provider, Modell, API-Key, BaseURL).
  const llmConfig = loadTwinLlmConfig();
  const model = createLlmClient(llmConfig);
  const modelLabel = formatLlmLabel(llmConfig);
  console.log(`[boot] LLM: ${modelLabel}`);

  // 5. Services
  const bus = new EventBus();
  const audit = new AuditService(repo.audit, bus);
  const twin = new TwinService({
    model,
    modelLabel,
    audit,
    bus,
    personaRepo: repo.persona,
    mandateRepo: repo.mandates,
    bridgeClient: null, // wird gesetzt, falls Bridge aktiv
  });

  // 6. Server
  const app = await createServer({ twin, audit: repo.audit, bus });
  await app.listen({ port: config.port, host: config.host });
  console.log(`[boot] Runtime hört auf http://${config.host}:${config.port}`);

  // 7. Bridge nach dem Server-Start hochziehen — dann ist auch der Logger
  // verfügbar und das Inbox-Sync passiert in Ruhe.
  const bridgeConfig = readBridgeConfig();
  let bridgeStream: BridgeStream | null = null;

  if (bridgeConfig) {
    const bridgeClient = new BridgeClient(bridgeConfig, app.log);
    twin.setBridgeClient(bridgeClient);

    console.log(
      `[boot] Bridge-Modus aktiv: ${bridgeConfig.handle} → ${bridgeConfig.url}`,
    );

    // Inbox-Sync: alle noch nicht erfassten Bridge-Nachrichten als Pending
    // anlegen. Idempotenz im TwinService.receiveBridgeMessage fängt Duplikate.
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

    // Stream öffnen — Bridge pusht künftige Nachrichten live.
    bridgeStream = new BridgeStream(
      bridgeConfig,
      (msg) => {
        twin.receiveBridgeMessage(msg).catch((err) => {
          app.log.error({ err, messageId: msg.id }, "[bridge:stream] receive fehlgeschlagen");
        });
      },
      app.log,
    );
    bridgeStream.connect();
  } else {
    console.log("[boot] Bridge-Modus inaktiv (ENV unvollständig)");
  }

  // 8. Graceful Shutdown
  const shutdown = async (signal: string) => {
    console.log(`[shutdown] ${signal} empfangen — fahre runter`);
    if (bridgeStream) bridgeStream.disconnect();
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

function readBridgeConfig(): BridgeConfig | null {
  const url = process.env.BRIDGE_URL?.trim();
  const handle = process.env.BRIDGE_TWIN_HANDLE?.trim();
  const token = process.env.BRIDGE_TWIN_TOKEN?.trim();
  if (!url || !handle || !token) return null;
  return { url, handle, token };
}

main().catch((err) => {
  console.error("[boot] Fataler Fehler:", err);
  process.exit(1);
});
