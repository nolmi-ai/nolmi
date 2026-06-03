import { loadFactsCliContext } from "./_facts-cli-helpers.js";
import { SqliteAuditRepository } from "../repository/sqlite.js";
import { AuditService } from "../audit/service.js";
import { EventBus } from "../events/bus.js";
import { SocialSuggestionService } from "../social/social-suggestion-service.js";

// ─── twin:social-nudge (CLI) — Soziale Proaktivität Stufe 1 ──────────────────
//
// MANUELLER Trigger: der Mensch lässt den Twin Beziehungs-Vorschläge bilden.
// Rein datengetrieben (KEIN LLM): A2A-Partner, deren letzter Kontakt älter als
// die Schwelle ist, werden als PENDING-Vorschlag vorgelegt. Markus entscheidet
// (Approve/Reject in der Inbox). Approve = no-op — KEIN autonomer Send.
//
// Schwelle: SOCIAL_NUDGE_THRESHOLD_DAYS (Default 21).
//
// Aufruf:
//   pnpm twin:social-nudge @markus

const USAGE = "Nutzung:\n  pnpm twin:social-nudge <handle>";

async function main() {
  const rawHandle = process.argv.slice(2).find((a) => !a.startsWith("--"));
  if (!rawHandle) {
    console.error(USAGE);
    process.exit(1);
  }

  const thresholdDays = Number(process.env.SOCIAL_NUDGE_THRESHOLD_DAYS) || 21;
  const ctx = await loadFactsCliContext(rawHandle);
  try {
    const bus = new EventBus();
    const auditService = new AuditService(new SqliteAuditRepository(ctx.db), bus, ctx.twin.twinId);
    const service = new SocialSuggestionService({
      db: ctx.db,
      auditService,
      twinId: ctx.twin.twinId,
      ownHandle: ctx.twin.handle,
      thresholdDays,
    });

    console.log(`[social-nudge] Twin: ${ctx.twin.handle}, Schwelle: ${thresholdDays} Tage`);
    const result = await service.nudge(new Date());

    if (result.created.length === 0 && result.skippedExistingPending.length === 0) {
      console.log("[social-nudge] Keine Partner über der Schwelle — nichts vorzuschlagen.");
      console.log("[social-nudge] (Bei dünnem A2A-Graph der Normalfall — kein Pending angelegt.)");
      return;
    }

    if (result.created.length > 0) {
      console.log(`\n[social-nudge] ✓ ${result.created.length} Vorschlag/Vorschläge als PENDING erzeugt (NICHT wirksam bis Approve, KEIN Send):`);
      for (const c of result.created) {
        console.log(`  - ${c.partnerHandle}: "${c.suggestionText}"  (Audit ${c.auditId})`);
      }
    }
    if (result.skippedExistingPending.length > 0) {
      console.log(`\n[social-nudge] übersprungen (schon offenes Pending pro Partner): ${result.skippedExistingPending.join(", ")}`);
    }
    console.log(`\n[social-nudge] Approve/Reject über die Inbox (UI).`);
  } finally {
    await ctx.cleanup();
  }
}

main().catch((err) => {
  console.error("[social-nudge] Fehler:", err instanceof Error ? err.message : err);
  process.exit(1);
});
