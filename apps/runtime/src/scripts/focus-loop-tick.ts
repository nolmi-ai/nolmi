import "dotenv/config";
import type { FastifyBaseLogger } from "fastify";
import type Database from "better-sqlite3";
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
import { FocusLoopService } from "../focus/focus-loop-service.js";

// ─── twin:focus-tick (CLI, manueller Loop-Tick-Trigger) ─────────────────────
//
// Führt EINEN vollständigen FocusLoopService.runTick() aus — bitgenau der
// autonome Tick: G2 (idle Konv beenden+embedden) → Tail-Flush → Fokus →
// Nudge Anlass 1 → Anlass 3, über alle aktiven Twins. Sinn: in der Bauphase
// tickt der 24h-Loop nie autonom (jeder Container-Recreate setzt den Timer
// zurück) — dieser Trigger macht den autonomen Pfad sofort prüfbar.
//
// 🔴 KEIN dry-run: der Tick mutiert echten State (neue focus_snapshots direkt,
//    Pending-Nudges in der Inbox, G2 beendet+embedded idle Konv, Tail-Flush
//    verdichtet — Letzteres nur bei TAIL_FLUSH_AUTONOMOUS_ENABLED). Macht echte
//    LLM-Calls. Das ist GEWOLLT (genau das wollen wir beobachten).
//
// 🔴 Gates GELTEN (nicht umgangen): läuft mit der echten .env, trigger=
//    'autonomous'. runTick() selbst ist NICHT durch FOCUS_LOOP_ENABLED gegated
//    (das gated nur den Timer in start()) → der direkte Aufruf läuft. KEINE
//    botRegistry übergeben → Autosend hat keinen Sender → Nudges bleiben
//    Pendings (kein Telegram-Push), unabhängig von den Autosend-Flags.
//
// Aufruf:
//   pnpm --filter @nolmi/runtime twin:focus-tick

/** Console-Logger im FastifyBaseLogger-Gewand (Subset reicht, vgl. test-oauth-phase2). */
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

interface Metrics {
  focusSnapshots: number;
  focusNewestDerivedAt: string | null;
  nudgesByAnlassStatus: Record<string, number>; // "anlass/status" → count
  embeddingsTotal: number;
  embeddingsByType: Record<string, number>;
  conversationsByStatus: Record<string, number>;
}

/** Read-only Momentaufnahme der relevanten Kennzahlen (alle Twins, global). */
function measure(db: Database.Database): Metrics {
  const fs = db
    .prepare(
      "SELECT COUNT(*) AS c, MAX(derived_at) AS m FROM focus_snapshots",
    )
    .get() as { c: number; m: string | null };

  const nudgeRows = db
    .prepare(
      `SELECT json_extract(data, '$.input.anlass') AS anlass, status, COUNT(*) AS c
         FROM audit
        WHERE capability = 'proactive-nudge'
        GROUP BY anlass, status`,
    )
    .all() as { anlass: string | null; status: string; c: number }[];
  const nudgesByAnlassStatus: Record<string, number> = {};
  for (const r of nudgeRows) {
    nudgesByAnlassStatus[`${r.anlass ?? "?"}/${r.status}`] = r.c;
  }

  const embRows = db
    .prepare("SELECT target_type, COUNT(*) AS c FROM embeddings GROUP BY target_type")
    .all() as { target_type: string; c: number }[];
  const embeddingsByType: Record<string, number> = {};
  let embeddingsTotal = 0;
  for (const r of embRows) {
    embeddingsByType[r.target_type] = r.c;
    embeddingsTotal += r.c;
  }

  const convRows = db
    .prepare("SELECT status, COUNT(*) AS c FROM conversations GROUP BY status")
    .all() as { status: string; c: number }[];
  const conversationsByStatus: Record<string, number> = {};
  for (const r of convRows) conversationsByStatus[r.status] = r.c;

  return {
    focusSnapshots: fs.c,
    focusNewestDerivedAt: fs.m,
    nudgesByAnlassStatus,
    embeddingsTotal,
    embeddingsByType,
    conversationsByStatus,
  };
}

function fmtMap(m: Record<string, number>): string {
  const keys = Object.keys(m).sort();
  if (keys.length === 0) return "{}";
  return keys.map((k) => `${k}=${m[k]}`).join(", ");
}

function line(label: string, before: string, after: string) {
  const changed = before !== after ? "  ⟵ Δ" : "";
  console.log(`  ${label.padEnd(22)} ${before}  →  ${after}${changed}`);
}

function printDelta(before: Metrics, after: Metrics) {
  console.log("\n── DB-Delta (VORHER → NACHHER) ───────────────────────────");
  line(
    "focus_snapshots",
    String(before.focusSnapshots),
    String(after.focusSnapshots),
  );
  line(
    "  jüngster derived_at",
    before.focusNewestDerivedAt ?? "—",
    after.focusNewestDerivedAt ?? "—",
  );
  line(
    "proactive-nudge",
    fmtMap(before.nudgesByAnlassStatus),
    fmtMap(after.nudgesByAnlassStatus),
  );
  line(
    "embeddings total",
    String(before.embeddingsTotal),
    String(after.embeddingsTotal),
  );
  line(
    "  by target_type",
    fmtMap(before.embeddingsByType),
    fmtMap(after.embeddingsByType),
  );
  line(
    "conversations",
    fmtMap(before.conversationsByStatus),
    fmtMap(after.conversationsByStatus),
  );
  console.log("──────────────────────────────────────────────────────────");
}

async function main() {
  const config = loadRuntimeConfig();
  // createSqliteRepository lädt sqlite-vec (für embeddings/G2) + setzt PRAGMAs.
  const bundle = createSqliteRepository(config.dbPath);
  const db = bundle.db;
  const masterKey = loadMasterKey();
  const logger = makeConsoleLogger("[focus-tick]");

  // Repos ad-hoc auf der geteilten Connection — exakt der Boot-Satz aus
  // index.ts, den registry.loadAll erwartet (loadAll macht Per-Twin-Decrypt +
  // LLM-Wiring selbst, kein decrypt/createLlmClient-Sonderweg hier).
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

  const twins = registry.list();
  console.log(
    `[focus-tick] ${twins.length} Twin(s) geladen: ${
      twins.map((t) => t.handle).join(", ") || "(keine)"
    }`,
  );
  console.log(
    "[focus-tick] Tick mit echter .env (Gates gelten, trigger='autonomous', keine botRegistry → Nudges=Pending).\n",
  );

  const before = measure(db);

  // KEINE botRegistry → Nudges bleiben Pendings (kein Push).
  const loop = new FocusLoopService({ db, registry });
  let tickError: unknown = null;
  try {
    console.log("── Tick-Logs ─────────────────────────────────────────────");
    await loop.runTick(logger);
  } catch (err) {
    // runTick fängt eigentlich per-Twin selbst; defensiv trotzdem.
    tickError = err;
    console.error(
      "[focus-tick] runTick warf (unerwartet):",
      err instanceof Error ? err.message : err,
    );
  }

  const after = measure(db);
  printDelta(before, after);

  // Cleanup analog index.ts-Shutdown: Streams trennen (keine offen), MCP-
  // Subprocesses disposen, dann Connection schließen.
  await registry.shutdown();
  await registry.disposeAll();
  db.close();

  if (tickError) process.exit(2);
}

main().catch((err) => {
  console.error(
    "[focus-tick] Fehler:",
    err instanceof Error ? err.message : err,
  );
  process.exit(1);
});
