import "dotenv/config";
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { createSqliteRepository } from "./repository/index.js";
import { createServer } from "./server.js";
import { loadRuntimeConfig } from "./config.js";
import { TwinServiceRegistry } from "./twin-service-registry.js";
import { formatLlmLabel } from "./llm-config.js";
import { TwinProfilesRepo } from "./twin-profiles-repo.js";

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

  // 1. DB
  const repo = createSqliteRepository(config.dbPath);
  console.log(`[boot] DB: ${config.dbPath}`);

  // 2. Aktive Profile zuerst zählen — wenn null, exit-1 mit Bootstrap-Hinweis
  const profilesRepo = new TwinProfilesRepo(repo.db);
  const activeProfiles = profilesRepo.list({ activeOnly: true });
  if (activeProfiles.length === 0) {
    console.error(
      "[boot] Keine aktiven Twins in DB.\n" +
        "Hinweis: Hast du 'pnpm --filter @twin-lab/runtime twin:bootstrap markus' ausgeführt?",
    );
    process.exit(1);
  }

  // 3. Server (mit Logger)
  const registry = new TwinServiceRegistry();
  const app = await createServer({
    audit: repo.audit,
    registry,
  });

  // 4. Registry mit allen aktiven Twins füllen
  registry.loadAll({ db: repo.db, auditRepo: repo.audit, logger: app.log });
  const summaries = registry.list();

  console.log(`[boot] ${summaries.length} Twin(s) aktiv:`);
  for (const t of summaries) {
    console.log(`  - ${t.handle} (${t.twinId})`);
  }

  // 5. Per-Twin LLM + Bridge-Konfig loggen, dann Bridges connecten
  for (const t of summaries) {
    const profile = activeProfiles.find((p) => p.handle === t.handle)!;
    console.log(
      `[boot] ${t.handle}: LLM=${formatLlmLabel(profile.llmConfig)}, Bridge=${profile.bridgeUrl}`,
    );
  }

  // 6. Listen
  await app.listen({ port: config.port, host: config.host });
  console.log(`[boot] Runtime hört auf http://${config.host}:${config.port}`);

  // 7. Bridges starten (nach Server-Listen, damit Logger via app.log läuft)
  await registry.startBridges(app.log);

  // 8. Graceful Shutdown
  const shutdown = async (signal: string) => {
    console.log(`[shutdown] ${signal} empfangen — fahre runter`);
    await registry.shutdown();
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
