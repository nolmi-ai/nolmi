import { generateObject } from "ai";
import { loadFactsCliContext } from "./_facts-cli-helpers.js";
import { loadMasterKey, decrypt } from "../crypto-utils.js";
import { createLlmClient } from "../llm-client.js";
import type { TwinLlmConfig } from "../llm-config.js";
import { SqliteAuditRepository } from "../repository/sqlite.js";
import { AuditService } from "../audit/service.js";
import { EventBus } from "../events/bus.js";
import { ConversationSummariesRepo } from "../conversations/summaries-repo.js";
import {
  ReflectionEngine,
  ReflectionOutputSchema,
  type ReflectionOutput,
} from "../reflection/reflection-engine.js";

// ─── twin:reflect (CLI) — Selbst-Reflexion Stufe 1 (über Markus) ─────────────
//
// MANUELLER Trigger: der Mensch löst eine Reflexion über den Owner aus. Der
// Twin bildet EINE Inferenz/Beobachtung → landet als PENDING-Audit
// (`capability='self-reflection-write'`). Approve/Reject läuft über die Inbox.
//
// LEITPLANKE: Dieser Trigger schreibt NICHTS Wirksames. Sein einziger Effekt
// ist der Pending-Audit. Erst ein Approve schreibt die Reflexion in den Diary.
// KEIN Background-Loop ('scheduled' bleibt Stufe-2-reserviert).
//
// Aufruf:
//   pnpm twin:reflect @markus

const USAGE = "Nutzung:\n  pnpm twin:reflect <handle>";

async function main() {
  const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  const rawHandle = args[0];
  if (!rawHandle) {
    console.error(USAGE);
    process.exit(1);
  }

  const masterKey = loadMasterKey();
  const ctx = await loadFactsCliContext(rawHandle);
  try {
    if (!ctx.twin.llmConfig.apiKeyEncrypted) {
      console.error(`[reflect] Twin '${ctx.twin.handle}' hat keinen API-Key im Profil.`);
      process.exit(1);
    }
    const apiKey = decrypt(ctx.twin.llmConfig.apiKeyEncrypted, masterKey);
    const llmConfig: TwinLlmConfig = {
      provider: ctx.twin.llmConfig.provider,
      model: ctx.twin.llmConfig.model,
      apiKey,
      baseUrl: ctx.twin.llmConfig.baseUrl,
    };
    const model = createLlmClient(llmConfig);

    const bus = new EventBus();
    const auditRepo = new SqliteAuditRepository(ctx.db);
    const auditService = new AuditService(auditRepo, bus, ctx.twin.twinId);
    const conversationSummaries = new ConversationSummariesRepo(ctx.db);

    const engine = new ReflectionEngine({
      facts: ctx.factsRepo,
      conversationSummaries,
      auditService,
      twinId: ctx.twin.twinId,
      twinName: ctx.twin.displayName,
      ownerName: ctx.twin.displayName,
      reflect: async ({ system, prompt }) => {
        const result = await generateObject({
          model,
          schema: ReflectionOutputSchema,
          system,
          prompt,
        });
        return result.object as ReflectionOutput;
      },
    });

    console.log(`[reflect] Twin: ${ctx.twin.handle}, LLM: ${llmConfig.provider}/${llmConfig.model}`);
    console.log(`[reflect] Bilde eine Reflexion über den Owner …`);

    const result = await engine.reflectAboutOwner();

    if (!result.created) {
      console.log(`[reflect] Keine Reflexion erzeugt: ${result.skippedReason ?? "unbekannt"}`);
      console.log(`[reflect] (Kein Pending angelegt, nichts geschrieben.)`);
      return;
    }

    console.log("");
    console.log(`[reflect] ✓ Reflexion als PENDING erzeugt (NICHT wirksam bis Approve):`);
    console.log(`  "${result.reflectionText}"`);
    if (result.reasoning) console.log(`  Evidenz: ${result.reasoning}`);
    console.log("");
    console.log(`  Audit-ID: ${result.auditId} — status=pending, kein Diary-Eintrag bis Approve.`);
    console.log(`  Approve/Reject über die Inbox (UI) bzw. POST /twins/${ctx.twin.handle}/audit/${result.auditId}/approve.`);
  } finally {
    await ctx.cleanup();
  }
}

main().catch((err) => {
  console.error("[reflect] Fehler:", err instanceof Error ? err.message : err);
  process.exit(1);
});
