import { generateObject } from "ai";
import { loadFactsCliContext } from "./_facts-cli-helpers.js";
import { loadMasterKey } from "../crypto-utils.js";
import { decrypt } from "../crypto-utils.js";
import { createLlmClient } from "../llm-client.js";
import type { TwinLlmConfig } from "../llm-config.js";
import { SqliteAuditRepository } from "../repository/sqlite.js";
import { AuditService } from "../audit/service.js";
import { EventBus } from "../events/bus.js";
import { ConversationsRepo } from "../conversations/repo.js";
import { ConversationSummariesRepo } from "../conversations/summaries-repo.js";
import {
  ExtractionEngine,
  ExtractionResultSchema,
  type ExtractionResult,
} from "../facts/extraction-engine.js";

// ─── twin:facts-extract (CLI) ───────────────────────────────────────────────
//
// Triggert die ExtractionEngine für eine Konversation. Default: aktive
// Direct-Chat-Konversation des Twins (findActive über
// ConversationsRepo). Override via `--conversation <id>` für spezifische
// Konversation (z.B. eine ältere oder eine Bridge-Conversation).
//
// LLM-Setup minimal: echte Provider-Verbindung über den im Profil
// hinterlegten API-Key. Kein Bridge, kein Tool-Use — ExtractionEngine
// ruft nur einen `generateObject`-Call.
//
// Aufruf:
//   pnpm twin:facts-extract @markus
//   pnpm twin:facts-extract @markus --conversation conv_xyz

const USAGE =
  "Nutzung:\n  pnpm twin:facts-extract <handle> [--conversation <id>]";

async function main() {
  const args = process.argv.slice(2);
  let conversationOverride: string | undefined;
  const positional: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === "--conversation") {
      conversationOverride = args[++i];
    } else if (a.startsWith("--conversation=")) {
      conversationOverride = a.slice("--conversation=".length);
    } else if (a.startsWith("--")) {
      console.error(`Unbekannter Flag: ${a}`);
      console.error(USAGE);
      process.exit(1);
    } else {
      positional.push(a);
    }
  }
  const rawHandle = positional[0];
  if (!rawHandle) {
    console.error(USAGE);
    process.exit(1);
  }

  const masterKey = loadMasterKey();
  const ctx = await loadFactsCliContext(rawHandle);
  try {
    // Konversation bestimmen: explizit oder aktive Direct-Chat.
    const conversationsRepo = new ConversationsRepo(ctx.db);
    let conversationId: string;
    if (conversationOverride) {
      conversationId = conversationOverride;
    } else {
      if (!ctx.twin.ownerUserId) {
        console.error(
          `[facts-extract] Twin '${ctx.twin.handle}' hat keinen Owner — Konversation kann nicht auto-bestimmt werden.`,
        );
        process.exit(1);
      }
      const ownPartner = ctx.twin.handle.startsWith("@")
        ? ctx.twin.handle
        : `@${ctx.twin.handle}`;
      const active = conversationsRepo.findActive(
        ctx.twin.ownerUserId,
        ownPartner,
        ctx.twin.twinId,
      );
      if (!active) {
        console.error(
          `[facts-extract] keine aktive Direct-Chat-Konversation gefunden — entweder Chat starten oder --conversation übergeben.`,
        );
        process.exit(1);
      }
      conversationId = active.id;
    }

    // LLM-Komponenten zusammenstellen — wie in der Registry, aber ohne
    // Bridge/Tools.
    if (!ctx.twin.llmConfig.apiKeyEncrypted) {
      console.error(
        `[facts-extract] Twin '${ctx.twin.handle}' hat keinen API-Key im Profil.`,
      );
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

    const engine = new ExtractionEngine({
      facts: ctx.factsRepo,
      conversationSummaries,
      auditService,
      twinId: ctx.twin.twinId,
      twinName: ctx.twin.displayName,
      extract: async ({ system, prompt }) => {
        const result = await generateObject({
          model,
          schema: ExtractionResultSchema,
          system,
          prompt,
        });
        return result.object as ExtractionResult;
      },
    });

    console.log(
      `[facts-extract] Twin: ${ctx.twin.handle}, conversation: ${conversationId}`,
    );
    console.log(`[facts-extract] LLM: ${llmConfig.provider}/${llmConfig.model}`);

    const result = await engine.extractFromConversation(conversationId);
    if (result.extracted === 0) {
      console.log("[facts-extract] Keine neuen Facts extrahiert.");
      console.log(
        "[facts-extract] (LLM hat nichts vorgeschlagen ODER alle Vorschläge waren bereits aktiv/abgelehnt.)",
      );
      return;
    }

    console.log(
      `[facts-extract] ✓ ${result.extracted} pending Fact${result.extracted === 1 ? "" : "s"} extrahiert.`,
    );
    // Pretty-Print der vorgeschlagenen Facts — wir lesen sie nochmal aus der
    // DB, damit auch reasoning-Text aus den Audits angezeigt werden kann.
    for (const factId of result.pendingFactIds) {
      const fact = ctx.factsRepo
        .listByTwin(ctx.twin.twinId)
        .find((f) => f.id === factId);
      if (!fact) continue;
      console.log(`  - ${fact.factKey} → ${fact.factValue}`);
    }
    console.log(
      `\n[facts-extract] Review: pnpm twin:facts-list ${ctx.twin.handle}`,
    );
    console.log(
      `[facts-extract] Approve/Reject läuft über die Inbox (UI in 3.3.G).`,
    );
  } finally {
    await ctx.cleanup();
  }
}

main().catch((err) => {
  console.error(
    "[facts-extract] Fehler:",
    err instanceof Error ? err.message : err,
  );
  process.exit(1);
});
