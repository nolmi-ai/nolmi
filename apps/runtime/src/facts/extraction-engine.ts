import { z } from "zod";
import type { AuditEntry } from "@twin-lab/shared";
import type { FactsRepo, Fact } from "./repo.js";
import type {
  ConversationSummariesRepo,
  ConversationSummary,
} from "../conversations/summaries-repo.js";
import type { AuditService } from "../audit/service.js";

// ─── EXTRACTION ENGINE (Phase 3.3 Sub-Schritt F) ─────────────────────────────
//
// Twin-getriebene Fact-Extraction. Der Twin reflektiert über die Konversation
// und schlägt neue Facts vor; jeder Vorschlag landet als
// `confidence='pending'`-Eintrag in `facts` plus einem Pending-Audit mit
// `capability='semantic-fact-write'`. Der User approved oder rejected pro
// Fact über den existierenden Audit-Approval-Pfad (3.2.F-Pattern).
//
// LLM-Call ist strukturierter Output via `generateObject` plus Zod-Schema —
// kein Free-Text-Parsing, deterministische Form. Die echte SDK-Integration
// passiert in der injizierten `extract`-Funktion, sodass Tests einen Mock
// ohne echten Provider-Aufruf verwenden können.
//
// Skip-Logic: existierende Facts mit `confidence ∈ {approved, pending, auto}`
// werden nicht erneut vorgeschlagen — nur rejected Facts dürfen via Update
// erneut pending werden, falls der Twin sehr überzeugt ist. Im LLM-Prompt
// werden beide Listen (aktiv und rejected) als „nicht vorschlagen"-Hinweis
// mitgegeben, damit der Loop selten greift.
//
// Failure-Verhalten: bei Throw im `extract`-Hook oder leerem Ergebnis →
// `{ extracted: 0 }` plus Log; Caller fährt unverändert weiter.

// ─── Zod-Schemas für strukturierten Output ─────────────────────────────────

const ExtractedFactSchema = z.object({
  factKey: z.string().min(1).max(200),
  factValue: z.string().min(1).max(10000),
  reasoning: z.string().min(1).max(500),
});

export const ExtractionResultSchema = z.object({
  facts: z.array(ExtractedFactSchema),
});

export type ExtractedFact = z.infer<typeof ExtractedFactSchema>;
export type ExtractionResult = z.infer<typeof ExtractionResultSchema>;

// ─── Function-Injection für LLM ────────────────────────────────────────────

export interface ExtractionGenerator {
  (params: { system: string; prompt: string }): Promise<ExtractionResult>;
}

// ─── Deps + Engine ─────────────────────────────────────────────────────────

export interface ExtractionEngineDeps {
  facts: FactsRepo;
  conversationSummaries: ConversationSummariesRepo;
  auditService: AuditService;
  twinId: string;
  twinName: string;
  extract: ExtractionGenerator;
}

export interface ExtractionResultPayload {
  extracted: number;
  pendingFactIds: string[];
}

export class ExtractionEngine {
  constructor(private deps: ExtractionEngineDeps) {}

  /**
   * Triggert Fact-Extraction für die angegebene Konversation. Lädt
   * existierende Facts (alle Confidences) plus Summaries plus die jüngsten
   * 40 Audits der Konversation als LLM-Kontext, baut Prompt, ruft
   * `extract` und persistiert pro neuem Fact einen pending-Eintrag + Audit.
   */
  async extractFromConversation(
    conversationId: string,
  ): Promise<ExtractionResultPayload> {
    // 1. Kontext laden
    const existing = this.deps.facts.listByTwin(this.deps.twinId);
    const activeFacts = existing.filter((f) => f.confidence !== "rejected");
    const rejectedFacts = existing.filter((f) => f.confidence === "rejected");
    const summaries =
      this.deps.conversationSummaries.listByConversation(conversationId);
    // 40 reicht — Summary-Trigger deckelt ohnehin auf wenige hundert Audits
    // pro Konversation, und ExtractionEngine soll vor allem auf die jüngsten
    // Live-Turns schauen.
    const liveAudits = await this.deps.auditService.repo.listByConversation(
      conversationId,
      40,
    );

    // 2. Prompt + LLM-Call
    const system = buildSystemPrompt({
      twinName: this.deps.twinName,
      activeFacts,
      rejectedFacts,
    });
    const prompt = buildUserPrompt({
      twinName: this.deps.twinName,
      summaries,
      liveAudits,
    });

    let result: ExtractionResult;
    try {
      result = await this.deps.extract({ system, prompt });
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      console.warn(
        `[extraction] generation failed for conversation=${conversationId}: ${reason}`,
      );
      return { extracted: 0, pendingFactIds: [] };
    }
    if (!result.facts || result.facts.length === 0) {
      console.log(
        `[extraction] no facts extracted for conversation=${conversationId}`,
      );
      return { extracted: 0, pendingFactIds: [] };
    }

    // 3. Persistenz: pro Fact pending + Audit
    const pendingFactIds: string[] = [];
    for (const fact of result.facts) {
      const conflict = this.deps.facts.get(this.deps.twinId, fact.factKey);
      if (conflict && conflict.confidence !== "rejected") {
        // Twin wollte einen existierenden aktiven Fact erneut setzen — Skip,
        // damit wir nicht User-bestätigte Werte überschreiben.
        console.log(
          `[extraction] skipping ${fact.factKey} — already exists with confidence=${conflict.confidence}`,
        );
        continue;
      }

      const saved = this.deps.facts.upsert({
        twinId: this.deps.twinId,
        factKey: fact.factKey,
        factValue: fact.factValue,
        source: "twin",
        confidence: "pending",
      });
      pendingFactIds.push(saved.id);

      // Audit mit capability='semantic-fact-write'. Input: Kontext-Daten;
      // Output bleibt null bis zum Approve (3.2.F-Konvention). Der vorge-
      // schlagene Fact-Inhalt landet im Input, damit der UI-Render-Code
      // alles aus einer Quelle ziehen kann.
      await this.deps.auditService.start({
        capability: "semantic-fact-write",
        mandateId: null,
        input: {
          conversationId,
          factId: saved.id,
          factKey: fact.factKey,
          factValue: fact.factValue,
          reasoning: fact.reasoning,
        },
        initialStatus: "pending",
        conversationId,
      });
    }

    console.log(
      `[extraction] extracted ${pendingFactIds.length} pending facts from conversation=${conversationId}`,
    );
    return {
      extracted: pendingFactIds.length,
      pendingFactIds,
    };
  }
}

// ─── Prompt-Builder (modul-lokal, pure functions) ───────────────────────────

interface SystemPromptInput {
  twinName: string;
  activeFacts: Fact[];
  rejectedFacts: Fact[];
}

function buildSystemPrompt(input: SystemPromptInput): string {
  const active =
    input.activeFacts.length === 0
      ? "(keine)"
      : input.activeFacts
          .map((f) => `- ${f.factKey}: ${f.factValue}`)
          .join("\n");
  const rejected =
    input.rejectedFacts.length === 0
      ? "(keine)"
      : input.rejectedFacts
          .map((f) => `- ${f.factKey}: ${f.factValue}`)
          .join("\n");

  return `Du bist ${input.twinName} und reflektierst über deine Konversation. Extrahiere semantische Fakten, die für dich langfristig wichtig sind.

GUTE FACTS:
- Stabile Eigenschaften ("wife_name: Anna")
- Wichtige Beziehungen ("business_partner: Florian Ristig")
- Konkrete Daten ("birthday: 1985-03-14")
- Wichtige Vereinbarungen ("workshop_pricing: 2500 EUR/Tag")

VERMEIDE:
- Triviale Informationen ("hat 'Hallo' gesagt")
- Vorübergehende Stimmungen ("war heute schlecht gelaunt")
- Existierende Facts (siehe unten — NICHT erneut vorschlagen)
- Vom User abgelehnte Facts (siehe unten — NICHT erneut vorschlagen)

EXISTIERENDE FACTS (NICHT erneut vorschlagen):
${active}

ABGELEHNTE FACTS (NICHT erneut vorschlagen):
${rejected}

factKey-Konvention: lowercase, Underscore-separiert. Beispiele: wife_name, business_partner, workshop_pricing.

Wenn keine extrahierbaren Facts in der Konversation sind: leeres Array zurückgeben.`;
}

interface UserPromptInput {
  twinName: string;
  summaries: ConversationSummary[];
  /** Repo gibt DESC — wir reversen im Render. */
  liveAudits: AuditEntry[];
}

function buildUserPrompt(input: UserPromptInput): string {
  const parts: string[] = [];

  if (input.summaries.length > 0) {
    parts.push("**Frühere Konversations-Summaries:**", "");
    input.summaries.forEach((s, i) => {
      parts.push(`Segment ${i + 1}:`, s.summaryMd, "");
    });
  }

  parts.push("**Aktuelle Live-Konversation (chronologisch):**", "");
  // listByConversation kommt DESC zurück — chronologisch reversen.
  const chronological = [...input.liveAudits].reverse();
  for (const a of chronological) {
    const rendered = renderAuditForExtraction(a, input.twinName);
    if (rendered) parts.push(rendered);
  }
  return parts.join("\n").trimEnd();
}

function renderAuditForExtraction(
  audit: AuditEntry,
  twinName: string,
): string | null {
  if (audit.status !== "executed") return null;
  if (
    audit.capability !== "respond_to_chat" &&
    audit.capability !== "owner-direct" &&
    audit.capability !== "mcp-tool-use"
  ) {
    return null;
  }
  const input = audit.input as { lastMessage?: string };
  const output = (audit.output ?? null) as { reply?: string } | null;
  const userText = typeof input.lastMessage === "string" ? input.lastMessage : "";
  const reply = output?.reply ?? "";
  const lines: string[] = [];
  if (userText) lines.push(`[User] ${userText}`);
  if (reply) lines.push(`[${twinName}] ${reply}`);
  return lines.length > 0 ? lines.join("\n") : null;
}
