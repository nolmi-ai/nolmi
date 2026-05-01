import "dotenv/config";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdir } from "node:fs/promises";
import { createSqliteRepository } from "./repository/index.js";
import { createProvider } from "./providers/index.js";
import { EventBus } from "./events/bus.js";
import { AuditService } from "./audit/service.js";
import { TwinService } from "./twin-service.js";
import { createServer } from "./server.js";
import { loadPersonaFromDocs } from "./persona/loader.js";
import { loadMandatesFromYaml, syncMandates } from "./mandates/service.js";
import { BridgeClient } from "./bridge/client.js";
import { BridgeStream } from "./bridge/stream.js";
import type { BridgeConfig } from "./bridge/types.js";

// ─── BOOTSTRAP ───────────────────────────────────────────────────────────────
//
// Bootet den Runtime in dieser Reihenfolge:
//   1. ENV laden, DB-File sicherstellen, Repository erzeugen
//   2. Persona aus docs/persona.md laden, ins Repository schreiben
//   3. Mandates aus docs/mandates.yaml laden, mit Repository syncen
//   4. Provider erzeugen (OpenAI oder Anthropic je nach ENV)
//   5. Bridge-Modus prüfen → Client + Stream falls aktiv
//   6. Services verkabeln
//   7. HTTP-Server starten
//   8. SIGINT/SIGTERM für graceful shutdown registrieren

async function main() {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);
  // Vom Runtime-src-Verzeichnis hoch zum Repo-Root, dann zu docs/
  const repoRoot = resolve(__dirname, "../../..");
  const dbPath = process.env.DATABASE_PATH ?? resolve(repoRoot, "data/twin.db");
  const docsDir = resolve(repoRoot, "docs");

  await mkdir(resolve(dbPath, ".."), { recursive: true });

  // 1. Repository
  const repo = createSqliteRepository(dbPath);

  // 2. Persona laden + speichern
  const persona = await loadPersonaFromDocs(docsDir);
  await repo.persona.save(persona);
  console.log(`[boot] Persona geladen: ${persona.name} (@${persona.handle})`);

  // 3. Mandates syncen
  const mandates = await loadMandatesFromYaml(resolve(docsDir, "mandates.yaml"));
  await syncMandates(repo.mandates, mandates);
  console.log(`[boot] ${mandates.length} Mandates synchronisiert`);

  // 4. Provider
  const provider = createProvider();
  console.log(`[boot] Provider aktiv: ${provider.name}`);

  // 5. Bridge-Modus
  const bridgeConfig = readBridgeConfig();
  let bridgeClient: BridgeClient | null = null;
  let bridgeStream: BridgeStream | null = null;

  // 6. Services
  const bus = new EventBus();
  const audit = new AuditService(repo.audit, bus);
  const twin = new TwinService({
    provider,
    audit,
    bus,
    personaRepo: repo.persona,
    mandateRepo: repo.mandates,
    bridgeClient: null, // wird gleich gesetzt, falls Bridge aktiv
  });

  // 7. Server
  const app = await createServer({ twin, audit: repo.audit, bus });
  const port = Number(process.env.RUNTIME_PORT ?? 4000);
  const host = process.env.RUNTIME_HOST ?? "127.0.0.1";

  await app.listen({ port, host });
  console.log(`[boot] Runtime hört auf http://${host}:${port}`);

  // 8. Bridge nach dem Server-Start hochziehen — dann ist auch der Logger
  // verfügbar und das Inbox-Sync passiert in Ruhe.
  if (bridgeConfig) {
    bridgeClient = new BridgeClient(bridgeConfig, app.log);
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
      app.log.error({ err }, "[boot] Inbox-Sync fehlgeschlagen — Stream übernimmt Catch-up");
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

  // 9. Graceful Shutdown
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
