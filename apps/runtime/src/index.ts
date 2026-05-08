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
import { EncryptionKeyMissingError, loadMasterKey } from "./crypto-utils.js";

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
  const app = await createServer({
    audit: repo.audit,
    registry,
    profilesRepo,
    masterKey,
    db: repo.db,
    trustRepo,
    skillRepo,
  });

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

  // 9. Graceful Shutdown
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
