import "dotenv/config";
import type { FastifyBaseLogger } from "fastify";
import { loadRuntimeConfig } from "../config.js";
import { createSqliteRepository } from "../repository/index.js";
import { loadMasterKey } from "../crypto-utils.js";
import { TrustRepo } from "../trust/trust-repo.js";
import { SkillRepo } from "../skills/repo.js";
import { ConversationsRepo } from "../conversations/repo.js";
import { McpServersRepo } from "../mcp/repo.js";
import { OAuthTokensRepo } from "../oauth/oauth-tokens-repo.js";
import { OAuthRefreshService } from "../oauth/refresh-service.js";
import { TwinProfilesRepo } from "../twin-profiles-repo.js";
import { TelegramConfigsRepo } from "../telegram/configs-repo.js";
import { TelegramMessagesRepo } from "../telegram/messages-repo.js";
import { PairingService } from "../telegram/pairing-service.js";
import { TelegramMessageRouter } from "../telegram/message-router.js";
import { TelegramBotRegistry } from "../telegram/bot-registry.js";
import { TwinServiceRegistry } from "../twin-service-registry.js";

// ─── twin:reflect-nudge (CLI) — Reflexions-Einwurf MANUELL auslösen ──────────
//
// Wow-Strang 2: löst den Einwurf-Pfad (reflectGenerateOnly → emitReflectionNudge)
// EINMAL für einen Twin aus — der Inhalts-Test VOR dem Loop-Wiring (SS3). Zeigt
// den echten Opus-Output + das worthNudging-Urteil + die Gate-Entscheidung in
// einem Lauf.
//
// LEITPLANKE (Vision-Grenze): approveSelfReflectionWrite wird NIE gerufen. Der
// generate-only-Pfad (SS1) erzeugt KEIN self-reflection-write-Pending und KEINEN
// Diary-Eintrag. Bei worthNudging=true erzeugt emitReflectionNudge nur den
// reflection-nudge-Audit (Gate AUS → Pending; Gate AN + Pairing → Telegram-Push).
//
// Bootstrap 1:1 wie focus-loop-tick.ts: registry.loadAll (per-Twin-Decrypt +
// LLM-Wiring) + telegramBotRegistry (sendToOwner-Pfad, falls Gate an). Wir
// nutzen die SCHON verdrahteten per-Twin-Engines (twin.reflectionEngine +
// twin.proactiveNudgeService) — kein Neu-Bau von Deps.
//
//   pnpm --filter @nolmi/runtime twin:reflect-nudge @markus

const USAGE = "Nutzung:\n  pnpm --filter @nolmi/runtime twin:reflect-nudge <handle>";

function makeConsoleLogger(prefix: string): FastifyBaseLogger {
  const log = (level: string, obj: unknown, msg?: string) => {
    if (typeof obj === "string") console.log(`${prefix} [${level}] ${obj}`);
    else console.log(`${prefix} [${level}] ${msg ?? ""}`, obj);
  };
  const stub = {
    info: (obj: unknown, msg?: string) => log("INFO", obj, msg),
    warn: (obj: unknown, msg?: string) => log("WARN", obj, msg),
    error: (obj: unknown, msg?: string) => log("ERROR", obj, msg),
    fatal: (obj: unknown, msg?: string) => log("FATAL", obj, msg),
    debug: () => {},
    trace: () => {},
    silent: () => {},
    level: "info",
    child: () => stub,
  };
  return stub as unknown as FastifyBaseLogger;
}

async function main() {
  const rawHandle = process.argv.slice(2).find((a) => !a.startsWith("--"));
  if (!rawHandle) {
    console.error(USAGE);
    process.exit(1);
  }

  const config = loadRuntimeConfig();
  const bundle = createSqliteRepository(config.dbPath);
  const db = bundle.db;
  const masterKey = loadMasterKey();
  const logger = makeConsoleLogger("[reflect-nudge]");

  // Repo-Satz wie index.ts/focus-loop-tick — registry.loadAll macht das
  // Per-Twin-Decrypt + LLM-Wiring selbst.
  const trustRepo = new TrustRepo(db);
  const skillRepo = new SkillRepo(db);
  const conversationsRepo = new ConversationsRepo(db);
  const mcpServersRepo = new McpServersRepo(db, masterKey);
  const oauthTokensRepo = new OAuthTokensRepo(db, masterKey);
  const oauthRefreshService = new OAuthRefreshService(oauthTokensRepo, bundle.audit);

  const registry = new TwinServiceRegistry();
  registry.loadAll({
    db,
    auditRepo: bundle.audit,
    logger,
    masterKey,
    trustRepo,
    skillRepo,
    conversationsRepo,
    mcpServersRepo,
    oauthRefreshService,
  });

  // telegramBotRegistry wie der Live-Loop — der sendToOwner-Pfad funktioniert
  // ohne laufenden Server (eagerLoadAllBots, KEIN launch()). Bei Gate-AUS wird
  // er nicht gebraucht (Pending), aber sauber verdrahtet wie der Loop es täte.
  const profilesRepo = new TwinProfilesRepo(db);
  const telegramConfigsRepo = new TelegramConfigsRepo(db, masterKey);
  const telegramMessagesRepo = new TelegramMessagesRepo(db);
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
  telegramBotRegistry.eagerLoadAllBots();

  let exitCode = 0;
  try {
    // Handle robust auflösen (mit/ohne '@').
    const twin =
      registry.getByHandle(rawHandle) ??
      registry.getByHandle(rawHandle.startsWith("@") ? rawHandle.slice(1) : `@${rawHandle}`);
    if (!twin) {
      const loaded = registry.list().map((t) => t.handle).join(", ") || "(keine)";
      console.error(`[reflect-nudge] Twin '${rawHandle}' nicht geladen. Verfügbar: ${loaded}`);
      exitCode = 1;
      return;
    }

    console.log(`[reflect-nudge] Twin: ${rawHandle} — generate-only Reflexion über den Owner …\n`);

    // SS1: generate-only — Text + Urteile, KEIN Pending, KEIN Diary.
    const draft = await twin.reflectionEngine.reflectGenerateOnly("owner");

    console.log("── reflectGenerateOnly('owner') ──────────────────────────");
    console.log(`  created:            ${draft.created}`);
    if (!draft.created) {
      console.log(`  skippedReason:      ${draft.skippedReason ?? "—"}`);
      console.log("\n[reflect-nudge] Keine Reflexion (zu wenig Substanz / LLM-Fehler) — kein Einwurf.");
      return;
    }
    console.log(`  worthNudging:       ${draft.worthNudging}`);
    console.log(`  reflectionText:`);
    console.log(`    "${draft.reflectionText}"`);
    console.log(`  reasoning (evidence): ${draft.reasoning || "—"}`);
    console.log(`  worthNudgingReasoning: ${draft.worthNudgingReasoning || "—"}`);
    console.log("──────────────────────────────────────────────────────────\n");

    if (!draft.worthNudging) {
      console.log("[reflect-nudge] worthNudging=false → KEIN Einwurf (zu banal/selbstverständlich).");
      return;
    }

    // SS2: emit — respektiert das Gate selbst (REFLECTION_NUDGE_AUTOSEND_ENABLED:
    // AUS → Pending, AN + Pairing → Telegram-Push). sendToOwner wie der Loop.
    const sendToOwner = (twinId: string, text: string) =>
      telegramBotRegistry.sendToOwner(twinId, text);
    const result = await twin.proactiveNudgeService.emitReflectionNudge({
      reflectionText: draft.reflectionText!,
      worthNudgingReasoning: draft.worthNudgingReasoning,
      sendToOwner,
    });

    console.log("── emitReflectionNudge ───────────────────────────────────");
    console.log(`  created:  ${result.created}`);
    console.log(`  pushed:   ${result.pushed} ${result.pushed ? "(Telegram-Push, status=sent)" : "(Pending — Gate aus oder Push-Fallback)"}`);
    console.log(`  auditId:  ${result.auditId ?? "—"} (capability=reflection-nudge)`);
    console.log("──────────────────────────────────────────────────────────");
    console.log("\n[reflect-nudge] Fertig. approveSelfReflectionWrite NICHT gerufen — kein Diary-Eintrag (Vision-Grenze).");
  } catch (err) {
    console.error("[reflect-nudge] Fehler:", err instanceof Error ? err.message : err);
    exitCode = 1;
  } finally {
    await registry.shutdown();
    telegramBotRegistry.shutdown();
    await registry.disposeAll();
    db.close();
  }

  process.exit(exitCode);
}

main().catch((err) => {
  console.error("[reflect-nudge] Fehler:", err instanceof Error ? err.message : err);
  process.exit(1);
});
