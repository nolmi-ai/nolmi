import "dotenv/config";
import Database from "better-sqlite3";
import { MockLanguageModelV3 } from "ai/test";
import { loadRuntimeConfig } from "../config.js";
import { TwinProfilesRepo } from "../twin-profiles-repo.js";
import { TrustRepo } from "../trust/trust-repo.js";
import { SkillRepo } from "../skills/repo.js";
import { ConversationsRepo } from "../conversations/repo.js";
import { ConversationSummariesRepo } from "../conversations/summaries-repo.js";
import { FactsRepo } from "../facts/repo.js";
import { TwinService } from "../twin-service.js";
import { AuditService } from "../audit/service.js";
import { EventBus } from "../events/bus.js";
import { createSqliteRepository } from "../repository/index.js";
import { McpServersRepo } from "../mcp/repo.js";
import { defaultMcpClientFactory } from "../mcp/client-factory.js";
import { loadMasterKey } from "../crypto-utils.js";
import { EmbeddingsRepo } from "../episodic/embeddings-repo.js";
import { TwinDiaryRepo } from "../episodic/twin-diary-repo.js";
import { MemoryEmbeddingService } from "../episodic/memory-embedding-service.js";
import { TwinDiaryService } from "../episodic/twin-diary-service.js";

// ─── TEST: SKILL-ENGINE (Phase 3.1.B) ───────────────────────────────────────
//
// Verifiziert, dass aktive Skills bei jedem Modell-Call in den System-Prompt
// gelangen. Statt einen echten LLM-Call zu machen, hängt das Skript einen
// MockLanguageModelV3 ein und liest aus dem `prompt`-Array die system-Message
// raus — so können wir präzise behaupten, dass der Skill-Block dort steht.
//
// Pragmatisch: kein vollständiger Mock-Stack. Wir bauen eine TwinService-
// Instanz minimal selbst, mit echter SQLite-DB (für Skill- und Audit-Persistenz)
// und Mock-Model (kein API-Call, keine Costs, keine Anthropic/OpenAI-Latenz).
//
// Voraussetzung: pnpm db:init lief, der Ziel-Twin (default @markus) existiert
// in twin_profiles. Der Twin muss einen ownerUserId haben, weil wir den
// Owner-Bypass-Pfad triggern (kein Mandate-Check, kein Pending).
//
// Aufruf:
//   pnpm --filter @twin-lab/runtime tsx src/scripts/test-skill-engine.ts
//   pnpm --filter @twin-lab/runtime tsx src/scripts/test-skill-engine.ts @florian

const TWIN_HANDLE_DEFAULT = "@markus";
const SKILL_NAME = "engine-test-workshop-context";

async function main() {
  const handle = (process.argv[2] ?? TWIN_HANDLE_DEFAULT).toLowerCase();

  const config = loadRuntimeConfig();
  const db = new Database(config.dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  const profilesRepo = new TwinProfilesRepo(db);
  const skillRepo = new SkillRepo(db);
  const trustRepo = new TrustRepo(db);
  const conversationsRepo = new ConversationsRepo(db);
  const conversationSummariesRepo = new ConversationSummariesRepo(db);
  const factsRepo = new FactsRepo(db);
  const masterKey = loadMasterKey();
  const mcpServersRepo = new McpServersRepo(db, masterKey);
  const repo = createSqliteRepository(config.dbPath);

  const profile = profilesRepo.findByHandle(handle);
  if (!profile) {
    throw new Error(`Twin '${handle}' nicht in DB.`);
  }
  if (!profile.ownerUserId) {
    throw new Error(
      `Twin '${handle}' hat keinen ownerUserId — Owner-Bypass-Pfad ist nicht testbar.`,
    );
  }

  log(`Test-Twin: ${profile.handle} (${profile.twinId})`);
  log(`Owner:     ${profile.ownerUserId}`);

  // Reset: falls ein Vor-Lauf den Skill liegen gelassen hat.
  removeSkillQuiet(skillRepo, profile.twinId, SKILL_NAME);

  let issues = 0;

  // ─── STEP 1: Mock-Skill anlegen ───────────────────────────────────────────
  banner("STEP 1 — Skill anlegen");
  const skillContent =
    "Workshop 1 ist Online, 7. Mai, 149€ Early Bird.\n\nDer Workshop richtet sich an Designer:innen.";
  const skill = skillRepo.add({
    twinId: profile.twinId,
    name: SKILL_NAME,
    description: "Test-Skill: Workshop-Kontext für Engine-Sanity.",
    manifestJson: {
      name: SKILL_NAME,
      description: "Test-Skill: Workshop-Kontext für Engine-Sanity.",
      capability: "respond_to_chat",
      requiresApproval: false,
    },
    instructionsMd: skillContent,
  });
  log(`  skillId:   ${skill.skillId}`);
  log(`  isActive:  ${skill.isActive}`);

  // ─── STEP 2: TwinService mit Mock-Model bauen ─────────────────────────────
  banner("STEP 2 — TwinService mit Mock-Model");
  // Holder-Object damit TS die Mutation aus der async-Closure heraus nicht
  // wegnarrowt; capturedSystem als plain `let` würde post-await zu `never`
  // werden. Explizit string|null typen, sonst zieht TS den Initializer als
  // 'null'-Literal.
  const captured = { system: null as string | null };
  // doGenerate-Signatur ist sehr breit getypt (V3-Spec). Wir geben eine
  // minimale, schema-konforme Antwort zurück; Cast über `any` hält das Skript
  // robust gegen kleinere Schema-Drifts in zukünftigen ai-SDK-Versionen.
  const mockModel = new MockLanguageModelV3({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    doGenerate: async (options: any) => {
      const sysMsg = options.prompt.find((m: { role: string }) => m.role === "system");
      captured.system =
        sysMsg && typeof sysMsg.content === "string" ? sysMsg.content : null;
      return {
        content: [
          {
            type: "text",
            text: "Mock-Antwort — Inhalt egal, wir prüfen den eingehenden System-Prompt.",
          },
        ],
        finishReason: "stop",
        usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
        warnings: [],
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any;
    },
  });

  const bus = new EventBus();
  const audit = new AuditService(repo.audit, bus, profile.twinId);

  // 3.4.D: Episodic-Stack — TwinService verlangt jetzt
  // memoryEmbeddingService + twinDiaryService. Hier minimal verkabelt mit
  // einem Mock-Provider, der nie aufgerufen wird (Skill-Test triggert keine
  // Summary-Generation, kein Reset).
  const embeddingsRepo = new EmbeddingsRepo(db);
  const twinDiaryRepo = new TwinDiaryRepo(db);
  const memoryEmbeddingService = new MemoryEmbeddingService({
    embeddingsRepo,
    conversationSummariesRepo,
    conversationsRepo,
    twinDiaryRepo,
    getProvider: () => {
      throw new Error("Skill-Test sollte keinen Embedding-Provider triggern");
    },
  });
  const twinDiaryService = new TwinDiaryService(
    twinDiaryRepo,
    memoryEmbeddingService,
  );

  const service = new TwinService({
    twinId: profile.twinId,
    ownerUserId: profile.ownerUserId,
    model: mockModel,
    modelLabel: "mock/test",
    audit,
    bus,
    persona: {
      name: profile.displayName,
      handle: profile.handle.replace(/^@/, ""),
      systemPrompt: profile.personaMd,
      metadata: {},
    },
    mandates: profile.mandates,
    bridgeClient: null,
    trustRepo,
    skills: skillRepo,
    conversations: conversationsRepo,
    mcpServersRepo,
    mcpClientFactory: defaultMcpClientFactory,
    db,
    conversationSummaries: conversationSummariesRepo,
    facts: factsRepo,
    memoryEmbeddingService,
    twinDiaryService,
  });

  // ─── STEP 3: chat() durch Owner-Bypass ────────────────────────────────────
  banner("STEP 3 — chat() (Owner-Bypass)");
  // Console-Spy, um zu prüfen dass das [skills]-Log geschrieben wurde.
  const skillLogs: string[] = [];
  const origLog = console.log;
  console.log = (...args: unknown[]) => {
    const line = args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" ");
    if (line.startsWith("[skills]")) skillLogs.push(line);
    origLog(...args);
  };

  try {
    const result = await service.chat(
      [{ role: "user", content: "Wann ist der nächste Workshop?" }],
      { requesterUserId: profile.ownerUserId },
    );
    log(`  reply: ${result.message?.content ?? "(none)"}`);
    log(`  auditId: ${result.auditId}`);
  } finally {
    console.log = origLog;
  }

  // ─── STEP 4: Assertions ───────────────────────────────────────────────────
  banner("STEP 4 — Assertions");
  const sys = readCaptured(captured);
  if (sys === null) {
    issues += 1;
    log("  ⚠ keine system-Message am Mock-Model angekommen.");
  } else {
    const hasSkillsHeader = sys.includes("# Verfügbare Skills");
    const hasSkillName = sys.includes(`## ${SKILL_NAME}`);
    const hasSkillContent = sys.includes("7. Mai") && sys.includes("149");
    const hasPersona = sys.includes(profile.personaMd.slice(0, 40));
    const hasLanguageDirective = sys.includes("## Sprache");

    log(`  enthält "# Verfügbare Skills":   ${hasSkillsHeader}`);
    log(`  enthält Skill-Header (## name): ${hasSkillName}`);
    log(`  enthält Skill-Content (Datum+Preis): ${hasSkillContent}`);
    log(`  enthält Persona-Anfang:         ${hasPersona}`);
    log(`  enthält LANGUAGE_DIRECTIVE:     ${hasLanguageDirective}`);

    if (!hasSkillsHeader) issues += 1;
    if (!hasSkillName) issues += 1;
    if (!hasSkillContent) issues += 1;
    if (!hasPersona) issues += 1;
    if (!hasLanguageDirective) issues += 1;

    // Reihenfolge: Persona vor Skills, Skills vor LANGUAGE_DIRECTIVE.
    const idxPersona = sys.indexOf(profile.personaMd.slice(0, 40));
    const idxSkills = sys.indexOf("# Verfügbare Skills");
    const idxLang = sys.indexOf("## Sprache");
    if (idxPersona >= 0 && idxSkills >= 0 && idxLang >= 0) {
      const orderOk = idxPersona < idxSkills && idxSkills < idxLang;
      log(`  Reihenfolge Persona < Skills < Direktive: ${orderOk}`);
      if (!orderOk) issues += 1;
    }
  }

  log(`  [skills]-Log-Zeilen: ${skillLogs.length} (erwartet ≥ 1)`);
  for (const line of skillLogs) log(`    ${line}`);
  if (skillLogs.length === 0) issues += 1;

  // ─── STEP 5: aktivierter Skill bei nochmaligem Call ───────────────────────
  banner("STEP 5 — setActive(false) → kein Skills-Block");
  skillRepo.setActive(skill.skillId, false);
  captured.system = null;
  await service.chat(
    [{ role: "user", content: "Egal was — Hauptsache ein zweiter Call." }],
    { requesterUserId: profile.ownerUserId },
  );
  const sys2 = readCaptured(captured);
  if (sys2 === null) {
    issues += 1;
    log("  ⚠ zweiter Call: keine system-Message am Model.");
  } else {
    const stillHasSkills = sys2.includes("# Verfügbare Skills");
    log(`  noch enthält Skills-Block: ${stillHasSkills} (erwartet false)`);
    if (stillHasSkills) issues += 1;
  }

  // ─── STEP 6: Cleanup ──────────────────────────────────────────────────────
  banner("STEP 6 — Cleanup");
  skillRepo.remove(skill.skillId);
  log(`  Skill ${skill.skillId} entfernt.`);

  banner("ZUSAMMENFASSUNG");
  if (issues === 0) {
    log("✓ alle Assertions grün");
  } else {
    log(`✗ ${issues} Issue(s) — Details oben.`);
  }

  db.close();
  if (issues > 0) process.exit(2);
}

function banner(title: string) {
  const line = "─".repeat(72);
  console.log(`\n${line}\n  ${title}\n${line}`);
}

function log(msg: string) {
  console.log(msg);
}

/**
 * TS-Workaround: bei direktem `const x = captured.system` wendet TS Control-
 * Flow-Narrowing der zuletzt geschriebenen Literal-Werte an, sodass `x` in
 * der `else`-Branche zu `never` wird. Indirekter Read über eine Funktion
 * bricht das Narrowing.
 */
function readCaptured(c: { system: string | null }): string | null {
  return c.system;
}

function removeSkillQuiet(repo: SkillRepo, twinId: string, name: string) {
  const existing = repo.findByName(twinId, name);
  if (existing) {
    try {
      repo.remove(existing.skillId);
    } catch {
      // egal — Reset darf scheitern
    }
  }
}

main().catch((err) => {
  console.error("\n[skill:engine] Fehler:", err instanceof Error ? err.message : err);
  process.exit(1);
});
