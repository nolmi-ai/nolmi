import { z } from "zod";
import type { AuditEntry } from "@nolmi/shared";
import type { FactsRepo, Fact } from "../facts/repo.js";
import type {
  ConversationSummariesRepo,
  ConversationSummary,
} from "../conversations/summaries-repo.js";
import type { AuditService } from "../audit/service.js";

// ─── REFLECTION ENGINE (Selbst-Reflexion Stufe 1 — über Markus) ──────────────
//
// Twin-getriebene Inferenz/Beobachtung ÜBER MARKUS. Struktur 1:1 an die
// ExtractionEngine (facts/extraction-engine.ts) angelehnt — bewusst NICHT
// memory-retrieval (query-gebunden, untauglich für eine unprompted Reflexion).
//
// ── LEITPLANKE (TWIN-VISION.md:145-150), load-bearing ──
// Die Reflexion wird NIE autonom wirksam. Der EINZIGE Effekt von
// `reflectAboutOwner()` ist ein PENDING-Audit (`capability='self-reflection-
// write'`, Output null). Erst ein expliziter Approve schreibt den Text in den
// Diary (TwinService.approveSelfReflectionWrite). KEIN Diary-/State-Write hier.
// „Twin darf nicht autonom eigene Meinungen über Markus speichern."
//
// LLM via injizierte `reflect`-Funktion (generateObject + Zod), damit Tests
// einen Mock ohne Provider-Aufruf nutzen können (wie ExtractionEngine).
//
// Leeres Ergebnis ist erlaubt + erwünscht: zu wenig Substanz → KEIN Pending,
// klare Meldung. Lieber keine Reflexion als eine halluzinierte.

export const REFLECTION_CAPABILITY = "self-reflection-write";

// Anders als semantic-fact-write: KEINE facts-Row. Der Inhalt lebt
// ausschließlich im Audit-input bis zum Approve.
export const ReflectionOutputSchema = z.object({
  /** false = zu wenig belastbare Evidenz → keine Reflexion erzeugen. */
  hasEnoughSubstance: z.boolean(),
  /** Fließtext-VORSCHLAG ("Mir fällt auf, dass …"); leer, wenn keine Substanz. */
  reflection: z.string().max(2000),
  /** Worauf sich die Reflexion stützt (Evidenz aus den vorliegenden Daten). */
  evidence: z.string().max(1000),
});
export type ReflectionOutput = z.infer<typeof ReflectionOutputSchema>;

export interface ReflectionGenerator {
  (params: { system: string; prompt: string }): Promise<ReflectionOutput>;
}

export interface ReflectionEngineDeps {
  facts: FactsRepo;
  conversationSummaries: ConversationSummariesRepo;
  auditService: AuditService;
  twinId: string;
  twinName: string;
  ownerName: string;
  reflect: ReflectionGenerator;
}

export interface ReflectionResult {
  /** true → ein Pending-Audit wurde erzeugt. false → nichts erzeugt. */
  created: boolean;
  auditId?: string;
  reflectionText?: string;
  reasoning?: string;
  /** Grund, wenn nichts erzeugt wurde (zu wenig Substanz / LLM-Fehler). */
  skippedReason?: string;
}

export class ReflectionEngine {
  constructor(private deps: ReflectionEngineDeps) {}

  /**
   * Bildet EINE Reflexion über den Owner und legt sie als PENDING-Audit ab.
   * Einziger Effekt: der Pending-Audit. Kein Diary-Write (das macht erst der
   * Approve). Bei zu wenig Substanz / LLM-Fehler: `{ created: false }` + Grund.
   */
  async reflectAboutOwner(): Promise<ReflectionResult> {
    // 1. Kontext laden — gleiche Quellen wie ExtractionEngine, aber twin-weit
    //    (Reflexion ist nicht an EINE Konversation gebunden): approved Facts +
    //    jüngste Summaries + jüngste Konversations-Turns.
    const approvedFacts = this.deps.facts
      .listByTwin(this.deps.twinId)
      .filter((f) => f.confidence === "approved");
    const summaries = this.deps.conversationSummaries
      .listByTwin(this.deps.twinId)
      .slice(0, 8);
    const recentAudits = await this.deps.auditService.repo.list({
      twinId: this.deps.twinId,
      limit: 40,
    });

    // 2. Prompt + LLM-Call
    const system = buildSystemPrompt({
      twinName: this.deps.twinName,
      ownerName: this.deps.ownerName,
    });
    const prompt = buildUserPrompt({
      twinName: this.deps.twinName,
      approvedFacts,
      summaries,
      recentAudits,
    });

    let out: ReflectionOutput;
    try {
      out = await this.deps.reflect({ system, prompt });
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      console.warn(`[reflection] generation failed for twin=${this.deps.twinId}: ${reason}`);
      return { created: false, skippedReason: `LLM-Fehler: ${reason}` };
    }

    const text = out.reflection?.trim() ?? "";
    if (!out.hasEnoughSubstance || text === "") {
      console.log(`[reflection] no reflection for twin=${this.deps.twinId} — zu wenig Substanz`);
      return {
        created: false,
        skippedReason: "zu wenig Substanz — keine Reflexion erzeugt (leeres Ergebnis ist erlaubt)",
      };
    }

    const reasoning = out.evidence?.trim() ?? "";

    // 3. EINZIGER Effekt: Pending-Audit. Kein Diary-Write. Output null bis Approve
    //    (3.2.F-Konvention, wie semantic-fact-write). Kein facts-Row.
    const audit = await this.deps.auditService.start({
      capability: REFLECTION_CAPABILITY,
      mandateId: null,
      initialStatus: "pending",
      input: { reflectionText: text, reasoning },
    });

    console.log(`[reflection] pending reflection erzeugt für twin=${this.deps.twinId}, audit=${audit.id}`);
    return { created: true, auditId: audit.id, reflectionText: text, reasoning };
  }
}

// ─── Prompt-Builder (modul-lokal, pure) ──────────────────────────────────────

function buildSystemPrompt(input: { twinName: string; ownerName: string }): string {
  return `Du bist ${input.twinName}, der digitale Twin von ${input.ownerName}. Du reflektierst über deinen Owner ${input.ownerName} — du bildest EINE Inferenz oder Beobachtung über ihn auf Basis der vorliegenden Daten.

WICHTIG — Leitplanken (hart):
- Formuliere die Reflexion als VORSCHLAG, nicht als feststehende Wahrheit. Beginne sinngemäß mit "Mir fällt auf, dass …" / "Es scheint, dass …". ${input.ownerName} prüft den Vorschlag und nimmt ihn an oder verwirft ihn.
- Du gibst dich NIEMALS als ${input.ownerName} aus. Du bist sein Twin, nicht er selbst.
- Stütze dich AUSSCHLIESSLICH auf die vorliegende Daten-Evidenz (Facts, Summaries, Konversations-Verlauf unten). Erfinde NICHTS dazu. Behaupte keine Tatsachen, die die Daten nicht hergeben.
- Wenn die Daten zu dünn sind für eine belastbare Beobachtung: setze hasEnoughSubstance=false und gib eine leere reflection zurück. Eine fehlende Reflexion ist BESSER als eine halluzinierte.
- GENAU EINE Reflexion. Knapp. Kein Schwall, keine Liste.

GUTE Reflexionen (Muster):
- Muster über die Zeit ("Mir fällt auf, dass ${input.ownerName} in letzter Zeit verstärkt über X spricht.")
- Prioritäten-Verschiebungen, wiederkehrende Themen, Arbeitsweise.

VERMEIDE:
- Sensible Spekulation über mentale/emotionale Zustände als Tatsache.
- Pauschale Charakter-Urteile ohne Evidenz.
- Mehrere Beobachtungen auf einmal.

Ausgabe-Felder:
- hasEnoughSubstance: ist genug belastbare Evidenz da?
- reflection: der Vorschlags-Text (leer, wenn hasEnoughSubstance=false).
- evidence: worauf du dich konkret stützt (welche Facts/Verläufe).`;
}

function buildUserPrompt(input: {
  twinName: string;
  approvedFacts: Fact[];
  summaries: ConversationSummary[];
  recentAudits: AuditEntry[];
}): string {
  const parts: string[] = [];

  parts.push("**Bestätigte Facts über den Owner:**", "");
  if (input.approvedFacts.length === 0) {
    parts.push("(keine)");
  } else {
    for (const f of input.approvedFacts) {
      parts.push(`- ${f.factKey}: ${f.factValue}`);
    }
  }
  parts.push("");

  if (input.summaries.length > 0) {
    parts.push("**Verdichtete Vorgeschichte (Konversations-Summaries):**", "");
    input.summaries.forEach((s, i) => {
      parts.push(`Segment ${i + 1}: ${s.summaryMd}`, "");
    });
  }

  parts.push("**Jüngste Konversations-Turns (neueste zuletzt):**", "");
  // repo.list kommt DESC zurück — chronologisch reversen.
  const chronological = [...input.recentAudits].reverse();
  let rendered = 0;
  for (const a of chronological) {
    const line = renderAuditTurn(a, input.twinName);
    if (line) {
      parts.push(line);
      rendered++;
    }
  }
  if (rendered === 0) parts.push("(keine verwertbaren Turns)");

  return parts.join("\n").trimEnd();
}

function renderAuditTurn(audit: AuditEntry, twinName: string): string | null {
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
  if (userText) lines.push(`[Owner] ${userText}`);
  if (reply) lines.push(`[${twinName}] ${reply}`);
  return lines.length > 0 ? lines.join("\n") : null;
}
