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
import { TwinServiceRegistry } from "../twin-service-registry.js";

// ─── twin:facts-review (CLI) — Facts-Kohärenz-Review MANUELL auslösen ────────
//
// #94 neu, SS3: löst den Review-Pfad (review → reviewAndCreatePending) für einen
// Twin aus — der Inhalts-Test VOR dem Loop-Wiring. Zeigt erst, WAS der echte
// Opus an Widersprüchen/Veraltetem findet (generate-only), dann was nach den
// Wiederholungs-Guards (Dedup + Rejected-Gedächtnis) als Pending in der Inbox
// landet.
//
// LEITPLANKE (Vision-Grenze Z.147): approveFactCoherenceFix wird hier NIE
// gerufen. Der bestehende Fact bleibt unberührt; das Pending wartet auf Markus'
// Approve in der Inbox. Kein Telegram-Push (anders als reflect-nudge) — der
// Kohärenz-Review ist ein Inbox-Vorschlag.
//
// Bootstrap wie reflect-nudge: registry.loadAll (Per-Twin-Decrypt + LLM-Wiring),
// dann die schon verdrahtete twin.factsCoherenceEngine über getByHandle. KEINE
// telegramBotRegistry nötig.
//
//   pnpm --filter @nolmi/runtime twin:facts-review @markus

const USAGE = "Nutzung:\n  pnpm --filter @nolmi/runtime twin:facts-review <handle>";

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
  const logger = makeConsoleLogger("[facts-review]");

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

  let exitCode = 0;
  try {
    const twin =
      registry.getByHandle(rawHandle) ??
      registry.getByHandle(rawHandle.startsWith("@") ? rawHandle.slice(1) : `@${rawHandle}`);
    if (!twin) {
      const loaded = registry.list().map((t) => t.handle).join(", ") || "(keine)";
      console.error(`[facts-review] Twin '${rawHandle}' nicht geladen. Verfügbar: ${loaded}`);
      exitCode = 1;
      return;
    }

    console.log(`[facts-review] Twin: ${rawHandle} — Kohärenz-Review über die approved Facts …\n`);

    // 1. generate-only: erst SEHEN, was der Opus findet (ein LLM-Call).
    const proposals = await twin.factsCoherenceEngine.review();

    console.log("── Gefundene Vorschläge (review, generate-only) ──────────");
    if (proposals.length === 0) {
      console.log("  (keine) — die Faktensammlung wirkt kohärent + aktuell.");
    } else {
      proposals.forEach((p, i) => {
        console.log(`  ${i + 1}. [${p.issueType}] ${p.factKey} → ${p.proposedAction}`);
        if (p.proposedAction === "update") console.log(`       newValue: "${p.newValue ?? ""}"`);
        if (p.relatedFactKeys?.length) console.log(`       betrifft auch: ${p.relatedFactKeys.join(", ")}`);
        console.log(`       Begründung: ${p.reasoning}`);
      });
    }
    console.log("──────────────────────────────────────────────────────────\n");

    // 2. Pending-Pfad (über die schon geholten Proposals → KEIN zweiter LLM-Call):
    //    Guards filtern, dann pro Vorschlag ein fact-coherence-fix-Pending.
    const result = await twin.factsCoherenceEngine.reviewAndCreatePending(proposals);

    console.log("── Pending-Anlage (nach Wiederholungs-Guards) ────────────");
    console.log(`  ${result.pendingAuditIds.length} Pending(s) angelegt (Inbox, warten auf Approve).`);
    if (result.skipped.length > 0) {
      console.log(`  ${result.skipped.length} übersprungen:`);
      for (const s of result.skipped) {
        const why = s.reason === "open-pending" ? "schon offenes Pending" : "jüngst rejected (Gedächtnis)";
        console.log(`     - ${s.factKey}: ${why}`);
      }
    }
    console.log("──────────────────────────────────────────────────────────");
    console.log("\n[facts-review] Fertig. approveFactCoherenceFix NICHT gerufen — Facts unberührt bis Markus' Approve (Vision-Grenze).");
  } catch (err) {
    console.error("[facts-review] Fehler:", err instanceof Error ? err.message : err);
    exitCode = 1;
  } finally {
    await registry.shutdown();
    await registry.disposeAll();
    db.close();
  }

  process.exit(exitCode);
}

main().catch((err) => {
  console.error("[facts-review] Fehler:", err instanceof Error ? err.message : err);
  process.exit(1);
});
