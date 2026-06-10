import { z } from "zod";
import type { Fact, FactsRepo } from "./repo.js";
import { FACT_COHERENCE_FIX_CAPABILITY } from "./repo.js";
import type {
  ConversationSummariesRepo,
  ConversationSummary,
} from "../conversations/summaries-repo.js";
import type { AuditService } from "../audit/service.js";

// ─── FACTS-KOHÄRENZ-REVIEW (#94 neu, SS2 — Generator) ───────────────────────
//
// Liest den APPROVED-facts-Store eines Twins, findet (a) Widersprüche zwischen
// Facts und (b) Veraltetes, und schlägt pro Befund eine Korrektur (update) oder
// Löschung (delete) vor. Der Generator SCHLÄGT NUR VOR — er fasst keinen Fact an.
//
// ── BEWUSSTE TRENNUNG von reflection-engine ──
// reflection-engine ist subject-zentriert (owner/self → Beobachtungen, Diary).
// Der Kohärenz-Review ist ein anderer Concern (Bestand aufräumen → Fact-Diff,
// apply-on-approve aus SS1), darum eine eigene Engine im facts-Domain.
//
// ── ABGRENZUNG (Strategie C5) ──
// NUR approved Facts (listByTwin onlyApproved). pending Facts gehören der
// Extraction — der Review fasst sie nicht an (keine Lebensphasen-Kollision).
//
// LLM via injizierte `generate`-Funktion (generateObject + Zod), damit Tests
// einen Mock ohne Provider-Aufruf nutzen können (wie reflection-/extraction-engine).
//
// Leeres proposals-Array ist erlaubt + erwünscht: sauberer Store → keine
// Vorschläge. Lieber kein Vorschlag als ein falscher (Prompt-Leitplanke).

/** Wie viele jüngste Summaries als Aktualitäts-Kontext in den Prompt. */
const SUMMARY_CONTEXT_LIMIT = 8;

export const FactCoherenceProposalSchema = z.object({
  /** Der betroffene Fact-Key (muss im approved-Store existieren). */
  factKey: z.string(),
  issueType: z.enum(["contradiction", "outdated"]),
  proposedAction: z.enum(["update", "delete"]),
  /** Nur bei 'update': der korrigierte Wert. */
  newValue: z.string().optional(),
  /** Bei 'contradiction': der/die widersprechende(n) Gegenpart-Key(s). */
  relatedFactKeys: z.array(z.string()).optional(),
  reasoning: z.string(),
});
export type FactCoherenceProposal = z.infer<typeof FactCoherenceProposalSchema>;

export const FactCoherenceOutputSchema = z.object({
  proposals: z.array(FactCoherenceProposalSchema),
});
export type FactCoherenceOutput = z.infer<typeof FactCoherenceOutputSchema>;

export interface CoherenceGenerator {
  (params: { system: string; prompt: string }): Promise<FactCoherenceOutput>;
}

export interface FactsCoherenceEngineDeps {
  facts: FactsRepo;
  conversationSummaries: ConversationSummariesRepo;
  auditService: AuditService;
  twinId: string;
  twinName: string;
  ownerName: string;
  generate: CoherenceGenerator;
}

/** SS3: ein durch einen Wiederholungs-Guard übersprungener Vorschlag. */
export interface SkippedProposal {
  factKey: string;
  reason: "open-pending" | "rejected-before";
}

export interface CoherenceReviewResult {
  proposals: FactCoherenceProposal[];
  /** Die angelegten fact-coherence-fix-Pending-Audit-IDs (Pending-Pfad). */
  pendingAuditIds: string[];
  /** SS3: Vorschläge, die ein Guard übersprungen hat (Dedup / Rejected-Gedächtnis). */
  skipped: SkippedProposal[];
}

export class FactsCoherenceEngine {
  constructor(private deps: FactsCoherenceEngineDeps) {}

  /**
   * generate-only: liest approved Facts (+ jüngste Summaries als Aktualitäts-
   * Kontext), lässt das LLM Widersprüche/Veraltetes finden, gibt die VALIDIERTEN
   * Vorschläge ZURÜCK — KEIN Pending, KEIN Fact-Write. Kern-Pfad; der Pending-
   * Pfad (reviewAndCreatePending) baut darauf auf (kein Duplikat).
   */
  async review(): Promise<FactCoherenceProposal[]> {
    const facts = this.deps.facts.listByTwin(this.deps.twinId, {
      onlyApproved: true,
    });
    if (facts.length === 0) return [];

    const summaries = this.deps.conversationSummaries
      .listByTwin(this.deps.twinId)
      .slice(-SUMMARY_CONTEXT_LIMIT);

    const system = buildCoherenceSystemPrompt();
    const prompt = buildCoherenceUserPrompt({ facts, summaries });

    let out: FactCoherenceOutput;
    try {
      out = await this.deps.generate({ system, prompt });
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      console.warn(`[coherence] review failed for twin=${this.deps.twinId}: ${reason}`);
      return [];
    }

    // Defensiv: nur Vorschläge zu Keys, die wirklich (approved) existieren;
    // 'update' braucht einen nicht-leeren newValue. So entstehen keine
    // garbage-Pendings (SS1-Approve würde sie zwar abfangen, aber lieber gar
    // nicht erst anlegen). Der Twin „erfindet keine neuen Facts" (Prompt).
    const approvedKeys = new Set(facts.map((f) => f.factKey));
    return (out.proposals ?? []).filter((p) =>
      isValidProposal(p, approvedKeys),
    );
  }

  /**
   * Pending-Pfad: pro Vorschlag ein fact-coherence-fix-Pending (über die SS1-
   * Mechanik) — hinter den SS3-Wiederholungs-Guards. RUFT NIE approveFact-
   * CoherenceFix; der Approve ist Markus' Sache, der Fact bleibt bis dahin
   * unberührt.
   *
   * `precomputed`: optional die schon aus review() geholten Vorschläge —
   * vermeidet einen zweiten (teuren) LLM-Call, wenn der Caller (CLI) sie erst
   * ausgibt und DANN pending macht. Ohne Arg wird intern review() gerufen.
   *
   * Guards (vor dem Anlegen je factKey, JS-Filter wie loadNudges):
   *  - Dedup: existiert schon ein OFFENES (pending) fact-coherence-fix für den
   *    factKey → überspringen (kein Doppel-Pending).
   *  - Rejected-Gedächtnis (v1: schon-mal, kein Zeitfenster): wurde ein Fix für
   *    den factKey jemals REJECTED → nicht erneut vorschlagen (nicht nerven).
   */
  async reviewAndCreatePending(
    precomputed?: FactCoherenceProposal[],
  ): Promise<CoherenceReviewResult> {
    const proposals = precomputed ?? (await this.review());

    // Einmal die bisherigen fact-coherence-fix-Audits laden, dann je factKey
    // filtern (AuditListOpts kann nicht nach capability/status filtern). Limit
    // großzügig fürs Rejected-Gedächtnis (Rückblick); bei sehr großem Audit-
    // Volumen wäre eine indizierte capability-Query der Upgrade-Pfad.
    const prior = (
      await this.deps.auditService.repo.list({
        twinId: this.deps.twinId,
        limit: 1000,
      })
    ).filter((a) => a.capability === FACT_COHERENCE_FIX_CAPABILITY);
    const openPendingKeys = new Set(
      prior.filter((a) => a.status === "pending").map(factKeyOf),
    );
    const rejectedKeys = new Set(
      prior.filter((a) => a.status === "rejected").map(factKeyOf),
    );

    const pendingAuditIds: string[] = [];
    const skipped: SkippedProposal[] = [];
    for (const p of proposals) {
      if (openPendingKeys.has(p.factKey)) {
        skipped.push({ factKey: p.factKey, reason: "open-pending" });
        continue;
      }
      if (rejectedKeys.has(p.factKey)) {
        skipped.push({ factKey: p.factKey, reason: "rejected-before" });
        continue;
      }
      const audit = await this.deps.auditService.start({
        capability: FACT_COHERENCE_FIX_CAPABILITY,
        mandateId: null,
        initialStatus: "pending",
        input: {
          factKey: p.factKey,
          issueType: p.issueType,
          proposedAction: p.proposedAction,
          newValue: p.newValue ?? null,
          relatedFactKeys: p.relatedFactKeys ?? [],
          reasoning: p.reasoning,
        },
      });
      pendingAuditIds.push(audit.id);
      // Innerhalb DESSELBEN Laufs nicht zweimal denselben Key anlegen.
      openPendingKeys.add(p.factKey);
    }
    if (pendingAuditIds.length > 0 || skipped.length > 0) {
      console.log(
        `[coherence] twin=${this.deps.twinId}: ${pendingAuditIds.length} Pending(s), ${skipped.length} übersprungen (Guards)`,
      );
    }
    return { proposals, pendingAuditIds, skipped };
  }
}

/** factKey aus dem Proposal-Input eines fact-coherence-fix-Audits. */
function factKeyOf(audit: { input: unknown }): string {
  return String((audit.input as { factKey?: string }).factKey ?? "");
}

/** Vorschlag plausibel? Key existiert (approved) + update hat newValue. */
function isValidProposal(
  p: FactCoherenceProposal,
  approvedKeys: Set<string>,
): boolean {
  if (!approvedKeys.has(p.factKey)) return false;
  if (p.proposedAction === "update" && !p.newValue?.trim()) return false;
  return true;
}

// ─── Prompt-Builder (modul-lokal, pure) ──────────────────────────────────────

/**
 * System-Prompt — RAW WORTLAUT aus der Strategie (FACTS-KOHAERENZ-REVIEW-
 * STRATEGY.md, B4), bewusst NICHT paraphrasiert.
 */
function buildCoherenceSystemPrompt(): string {
  return `Du erhältst die vollständige Faktensammlung über den Owner. Prüfe sie auf zwei Probleme: (1) WIDERSPRÜCHE — zwei oder mehr Facts, die sich logisch widersprechen (z.B. ein Fact sagt 'verheiratet mit X', ein anderer 'aktuell keine Partnerin'). (2) VERALTETES — Facts, die durch einen neueren Fact oder den jüngsten Gesprächsstand klar überholt sind (z.B. ein alter Produktname, der laut neuerem Fact verworfen wurde; ein 'morgen mache ich X', dessen Zeitpunkt lange vorbei ist). Für jeden Befund schlage GENAU EINE Aktion vor: 'update' (der Fact soll einen korrigierten Wert bekommen — gib newValue an) ODER 'delete' (der Fact ist überholt und soll weg). Sei KONSERVATIV: schlage nur vor, was ein aufmerksamer Mensch eindeutig als Widerspruch oder veraltet erkennen würde. Bei Unsicherheit, ob ein Fact noch gilt: NICHTS vorschlagen. Erfinde keine neuen Facts — du räumst nur auf, was schon da ist. Im Zweifel lieber kein Vorschlag als ein falscher.`;
}

function buildCoherenceUserPrompt(input: {
  facts: Fact[];
  summaries: ConversationSummary[];
}): string {
  const parts: string[] = [];
  parts.push("**Faktensammlung (factKey: Wert — zuletzt geändert):**", "");
  // Alter mitgeben, damit das Modell „neuer vs. älter" für outdated beurteilen kann.
  for (const f of input.facts) {
    const ageDays = factAgeDays(f.updatedAt);
    const age = ageDays === null ? "" : ` [Alter: ${ageDays}d]`;
    parts.push(`- ${f.factKey}: ${f.factValue} (zuletzt: ${f.updatedAt})${age}`);
  }

  if (input.summaries.length > 0) {
    parts.push(
      "",
      "**Jüngster Gesprächsstand (Summaries, neueste zuletzt) — als Aktualitäts-Kontext:**",
      "",
    );
    input.summaries.forEach((s, i) => {
      parts.push(`Segment ${i + 1}: ${s.summaryMd}`);
    });
  }

  parts.push(
    "",
    "Gib deine Vorschläge als `proposals`-Liste zurück (leer, wenn die Sammlung kohärent + aktuell ist).",
  );
  return parts.join("\n").trimEnd();
}

/** Ganzzahliges Alter in Tagen seit updatedAt; null bei unparsbarem Timestamp. */
function factAgeDays(updatedAt: string): number | null {
  const ms = Date.parse(updatedAt);
  if (!Number.isFinite(ms)) return null;
  return Math.floor((Date.now() - ms) / 86_400_000);
}
