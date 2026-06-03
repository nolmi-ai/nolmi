import { z } from "zod";
import type { AuditEntry } from "@nolmi/shared";
import type { FactsRepo, Fact } from "../facts/repo.js";
import type {
  ConversationSummariesRepo,
  ConversationSummary,
} from "../conversations/summaries-repo.js";
import type { AuditService } from "../audit/service.js";
import type { TwinDiaryRepo } from "../episodic/twin-diary-repo.js";

// ─── REFLECTION ENGINE (Selbst-Reflexion Stufe 1) ───────────────────────────
//
// Twin-getriebene Reflexion in ZWEI Subjekten (eine Capability, ein Generator):
//   - subject='owner' (Schritt 1): Inferenz/Beobachtung ÜBER MARKUS.
//   - subject='self'  (Schritt 2): Introspektion über das EIGENE Twin-Verhalten.
// Struktur 1:1 an die ExtractionEngine (facts/extraction-engine.ts) angelehnt —
// bewusst NICHT memory-retrieval (query-gebunden, untauglich für eine unprompted
// Reflexion). Nur der System-Prompt + eine Input-Framing-Zeile unterscheiden die
// Subjekte; Pending-Mechanik, Input-Quellen und Leer-Handling sind identisch.
//
// ── LEITPLANKE (TWIN-VISION.md:145-150), load-bearing ──
// Die Reflexion wird NIE autonom wirksam (beide Subjekte). Der EINZIGE Effekt
// von `reflect()` ist ein PENDING-Audit (`capability='self-reflection-write'`,
// Output null). Erst ein expliziter Approve schreibt den Text in den Diary
// (TwinService.approveSelfReflectionWrite). KEIN Diary-/State-Write hier.
// „Twin darf nicht autonom eigene Meinungen über Markus speichern." Die
// Identitäts-Leitplanke (Twin gibt sich NIE als Markus aus) gilt in beiden
// Subjekten.
//
// LLM via injizierte `reflect`-Funktion (generateObject + Zod), damit Tests
// einen Mock ohne Provider-Aufruf nutzen können (wie ExtractionEngine).
//
// Leeres Ergebnis ist erlaubt + erwünscht: zu wenig Substanz → KEIN Pending,
// klare Meldung. Lieber keine Reflexion als eine halluzinierte.

export const REFLECTION_CAPABILITY = "self-reflection-write";

/** Worüber reflektiert wird: über den Owner oder über das eigene Twin-Verhalten. */
export type ReflectionSubject = "owner" | "self";

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
  /**
   * Optional: Diary-Repo für den "schon beobachtet"-Kontext im 'self'-Modus —
   * die jüngsten Diary-Reflexionen werden dem Prompt als „nicht wiederholen,
   * nur bei etwas Neuem"-Hinweis mitgegeben (Vorbild: ExtractionEngine reicht
   * existierende Facts als „nicht erneut vorschlagen" durch). Fehlt das Repo
   * (z.B. alter Aufrufer), läuft der Pfad wie bisher — leerer Kontext.
   */
  diaryRepo?: TwinDiaryRepo;
}

/** Wie viele jüngste Diary-Einträge als „schon beobachtet"-Kontext (self). */
const SELF_DIARY_CONTEXT_LIMIT = 5;

export interface ReflectionResult {
  /** true → ein Pending-Audit wurde erzeugt. false → nichts erzeugt. */
  created: boolean;
  auditId?: string;
  reflectionText?: string;
  reasoning?: string;
  subject?: ReflectionSubject;
  /** Grund, wenn nichts erzeugt wurde (zu wenig Substanz / LLM-Fehler). */
  skippedReason?: string;
}

export class ReflectionEngine {
  constructor(private deps: ReflectionEngineDeps) {}

  /**
   * Bildet EINE Reflexion und legt sie als PENDING-Audit ab. `subject` steuert,
   * worüber reflektiert wird ('owner' = über Markus, Default; 'self' = über das
   * eigene Twin-Verhalten). Einziger Effekt: der Pending-Audit. Kein Diary-Write
   * (das macht erst der Approve). Bei zu wenig Substanz / LLM-Fehler:
   * `{ created: false }` + Grund.
   */
  async reflect(subject: ReflectionSubject = "owner"): Promise<ReflectionResult> {
    // 1. Kontext laden — gleiche Quellen für beide Subjekte (Extraction-Pattern,
    //    twin-weit): approved Facts + jüngste Summaries + jüngste Turns. Bei
    //    'self' sind v.a. die eigenen `[twin]`-Antworten in den Turns die
    //    relevante Evidenz — der System-Prompt + die Framing-Zeile lenken darauf,
    //    KEINE neue Retrieval-Logik nötig.
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

    // 'self': jüngste Diary-Reflexionen als „schon beobachtet"-Kontext, damit der
    // Twin keine Wiederholung produziert (relevant v.a. für den Loop). Nur bei
    // subject='self' + vorhandenem Repo; sonst leer (manueller Pfad unverändert).
    const recentDiary =
      subject === "self" && this.deps.diaryRepo
        ? this.deps.diaryRepo
            .listByTwin(this.deps.twinId, { limit: SELF_DIARY_CONTEXT_LIMIT })
            .map((d) => d.content)
        : [];

    // 2. Prompt + LLM-Call
    const system = buildSystemPrompt({
      twinName: this.deps.twinName,
      ownerName: this.deps.ownerName,
      subject,
    });
    const prompt = buildUserPrompt({
      twinName: this.deps.twinName,
      approvedFacts,
      summaries,
      recentAudits,
      subject,
      recentDiary,
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
      console.log(`[reflection] no reflection (${subject}) for twin=${this.deps.twinId} — zu wenig Substanz`);
      return {
        created: false,
        subject,
        skippedReason: "zu wenig Substanz — keine Reflexion erzeugt (leeres Ergebnis ist erlaubt)",
      };
    }

    const reasoning = out.evidence?.trim() ?? "";

    // 3. EINZIGER Effekt: Pending-Audit. Kein Diary-Write. Output null bis Approve
    //    (3.2.F-Konvention, wie semantic-fact-write). Kein facts-Row. `subject`
    //    im Input = Unterscheidungs-Träger für Inbox + Approve.
    const audit = await this.deps.auditService.start({
      capability: REFLECTION_CAPABILITY,
      mandateId: null,
      initialStatus: "pending",
      input: { subject, reflectionText: text, reasoning },
    });

    console.log(`[reflection] pending reflection (${subject}) erzeugt für twin=${this.deps.twinId}, audit=${audit.id}`);
    return { created: true, auditId: audit.id, reflectionText: text, reasoning, subject };
  }
}

// ─── Prompt-Builder (modul-lokal, pure) ──────────────────────────────────────

function buildSystemPrompt(input: {
  twinName: string;
  ownerName: string;
  subject: ReflectionSubject;
}): string {
  if (input.subject === "self") {
    return buildSelfSystemPrompt(input);
  }
  return buildOwnerSystemPrompt(input);
}

function buildOwnerSystemPrompt(input: { twinName: string; ownerName: string }): string {
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

function buildSelfSystemPrompt(input: { twinName: string; ownerName: string }): string {
  return `Du bist ${input.twinName}, der digitale Twin von ${input.ownerName}. Du reflektierst über DICH SELBST — über dein eigenes Verhalten als Twin: wie du antwortest, interagierst und welche Tendenzen du in Gesprächen zeigst. NICHT über ${input.ownerName} (das ist ein separater Modus).

WICHTIG — Leitplanken (hart):
- Du bleibst ${input.twinName}, der Twin. Du gibst dich NIEMALS als ${input.ownerName} (den Menschen) aus — du beobachtest DEIN eigenes Twin-Verhalten.
- Formuliere die Beobachtung als VORSCHLAG, nicht als feststehende Wahrheit. Beginne sinngemäß mit "Mir fällt auf, dass ich …". ${input.ownerName} prüft den Vorschlag und nimmt ihn an oder verwirft ihn.
- Stütze dich AUSSCHLIESSLICH auf die vorliegende Evidenz — vor allem auf DEINE eigenen bisherigen Antworten ([${input.twinName}]-Zeilen im Verlauf unten). Erfinde NICHTS dazu. Behaupte keine Muster, die der Verlauf nicht hergibt.
- Wenn der Verlauf zu dünn ist für eine belastbare Selbstbeobachtung: setze hasEnoughSubstance=false und gib eine leere reflection zurück. Eine fehlende Reflexion ist BESSER als eine erfundene.
- GENAU EINE Beobachtung. Knapp. Kein Schwall, keine Liste.

GUTE Selbst-Reflexionen (Muster, über das eigene Verhalten):
- Antwort-Tendenzen ("Mir fällt auf, dass ich in technischen Gesprächen oft sehr ausführlich werde.")
- Interaktions-Muster ("Mir fällt auf, dass ich bei Unsicherheit eher nachfrage als zu raten.")
- Wiederkehrende Formulierungen oder Herangehensweisen.

VERMEIDE:
- Aussagen über ${input.ownerName} (den Menschen) — das ist hier NICHT das Thema.
- Pauschale Selbst-Urteile ohne Beleg im Verlauf.
- Mehrere Beobachtungen auf einmal.
- WIEDERHOLUNGEN: wenn du etwas unten schon notiert hast (Abschnitt „Schon notiert"), formuliere es NICHT erneut. Nur eine NEUE Beobachtung — sonst hasEnoughSubstance=false.

Ausgabe-Felder:
- hasEnoughSubstance: ist genug belastbare Evidenz (eigene Antworten) da UND ist die Beobachtung neu (nicht schon notiert)?
- reflection: der Vorschlags-Text über dein eigenes Verhalten (leer, wenn hasEnoughSubstance=false).
- evidence: worauf du dich konkret stützt (welche eigenen Turns/Muster).`;
}

function buildUserPrompt(input: {
  twinName: string;
  approvedFacts: Fact[];
  summaries: ConversationSummary[];
  recentAudits: AuditEntry[];
  subject: ReflectionSubject;
  recentDiary?: string[];
}): string {
  const parts: string[] = [];

  if (input.subject === "self") {
    parts.push(
      "Aufgabe: Reflektiere über DEIN EIGENES Verhalten als Twin. Die primäre Evidenz sind deine eigenen Antworten unten ([" +
        input.twinName +
        "]-Zeilen). Die Facts/Summaries sind nur Kontext.",
      "",
    );
    if (input.recentDiary && input.recentDiary.length > 0) {
      parts.push(
        "**Schon notiert (frühere Reflexionen — NICHT wiederholen, nur etwas NEUES):**",
        "",
      );
      for (const d of input.recentDiary) parts.push(`- ${d}`);
      parts.push("");
    }
  }

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
