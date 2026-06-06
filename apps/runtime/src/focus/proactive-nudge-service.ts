import { z } from "zod";
import type Database from "better-sqlite3";
import type { AuditEntry } from "@nolmi/shared";
import type { AuditService } from "../audit/service.js";
import type { FactsRepo } from "../facts/repo.js";
import type { ConversationSummariesRepo } from "../conversations/summaries-repo.js";
import { OPEN_QUESTION_MAX_AGE_HOURS } from "../config.js";
import type { FocusSnapshot, FocusSnapshotsRepo } from "./focus-snapshots-repo.js";

// ─── PROACTIVE NUDGE SERVICE (Proaktiver Fokus-Anstoß Stufe 1) ──────────────
//
// Anlass 1 (Fokus): Der Twin meldet sich proaktiv, wenn der Owner LANG am
// selben Thema festhängt. Stufe 1 = DETEKTIEREN + TEXTEN + als PENDING ablegen.
// KEIN autonomer Versand, KEIN Telegram — der Owner liest den Vorschlag in der
// Inbox und gibt frei. Der echte Push (Telegram) ist die spätere Stufe.
//
// ── DREI BEWUSSTE GRENZEN (load-bearing) ──
//  1. PENDING, nie direkt-wirksam: `nudge()` erzeugt NUR einen Pending-Audit
//     (`capability='proactive-nudge'`). Approve = acknowledge (twin-service),
//     KEIN Send Richtung Owner. Wie Reflexions-/Social-Suggestion-Muster.
//  2. NICHT separat opt-in-gated: hängt am Fokus-Loop, der schon
//     FOCUS_LOOP_ENABLED-gated ist. Läuft nur, wenn der Fokus-Loop läuft.
//  3. „Still, bis Historie da ist": <3 Snapshots → detectStuck=false, 0 Token.
//     Heutiger Normalfall (dünne/leere focus_snapshots) feuert nicht.
//
// ── TOKEN-BREMSEN (LLM-Call NUR wenn alle Guards passieren) ──
//   detectStuck (reine SQL+JS, 0 Token) → Dedup (kein offenes Pending) →
//   Episode-Cooldown (nicht zweimal fürs selbe Thema) → ERST DANN der Generator.

export const PROACTIVE_NUDGE_CAPABILITY = "proactive-nudge";

/**
 * anlass-Werte im Audit-Payload. Dedup („max 1 offenes Pending") + Episode-
 * Cooldown sind anlass-BEWUSST: ein offenes Anlass-1-Pending blockiert KEIN
 * Anlass-3-Pending und umgekehrt (sie teilen nur die Capability).
 */
export const ANLASS_FOKUS = "fokus";
export const ANLASS_OFFENE_FRAGE = "offene_frage";

/** „Festhängen" = dasselbe Thema in ≥ so vielen aufeinanderfolgenden Snapshots. */
const STUCK_MIN_SNAPSHOTS = 3;
/** Fenster: so viele jüngste Snapshots zieht die Detektion heran. */
const STUCK_WINDOW = 8;

/** Chat-Capabilities, die einen Owner↔Twin-Turn tragen (conversation_id gesetzt). */
const CHAT_CAPABILITIES = new Set(["owner-direct", "respond_to_chat"]);
/** Wie viele jüngste Audits die Offene-Frage-Detektion (Anlass 3) scannt. */
const OPEN_QUESTION_AUDIT_SCAN_LIMIT = 300;

/** LLM-Output des Nudge-Generators (zweite Bremse: shouldNudge). */
export const NudgeOutputSchema = z.object({
  /** false = der Twin hält den Anstoß nicht für der Mühe wert → kein Pending. */
  shouldNudge: z.boolean(),
  /** Die Nachricht, die der Twin dem Owner schreiben würde (leer, wenn nicht). */
  message: z.string().max(1500),
  /** Kurze Begründung für den Audit/Transparenz. */
  reasoning: z.string().max(800),
});
export type NudgeOutput = z.infer<typeof NudgeOutputSchema>;

export interface NudgeGenerator {
  (params: { system: string; prompt: string }): Promise<NudgeOutput>;
}

/** Ergebnis der Festhäng-Detektion (rein lesend, kein LLM). */
export interface StuckDetection {
  isStuck: boolean;
  /** Das stabile Thema (Original-Schreibweise des jüngsten Snapshots). */
  thema?: string;
  /** Anzahl aufeinanderfolgender stabiler Snapshots (bei 24h-Loop ≈ Tage). */
  tageStabil?: number;
  /** Die Snapshots der Festhäng-Kette (jüngste zuerst). */
  snapshots?: FocusSnapshot[];
}

export interface ProactiveNudgeResult {
  created: boolean;
  auditId?: string;
  thema?: string;
  message?: string;
  /** 2b: true = autonom per Telegram gepusht (Status 'sent'); false = Pending. */
  pushed?: boolean;
  /** Grund, wenn nichts erzeugt wurde (für Loop-Log/Tests). */
  reason?:
    | "not-stuck"
    | "no-open-question"
    | "open-pending"
    | "already-nudged-this-episode"
    | "twin-declined"
    | "llm-error";
}

/** Ergebnis der Offene-Frage-Detektion (Anlass 3, rein lesend, kein LLM). */
export interface OpenQuestionDetection {
  isOpen: boolean;
  /** Konversation mit der offenen Frage (Episode-Cooldown-Key). */
  conversationId?: string;
  /** Der Twin-Reply, der als Frage offen blieb. */
  question?: string;
  /** Zeitpunkt der Frage (= timestamp des jüngsten Audits der Konv). */
  askedAt?: string;
}

/**
 * 2b: Aktiver Owner-Push (BotRegistry.sendToOwner), per-Call injiziert vom
 * Fokus-Loop. Per-Call statt Konstruktor-Dep, weil der ProactiveNudgeService im
 * TwinService gebaut wird, BEVOR die BotRegistry existiert (Boot-Reihenfolge);
 * der Loop kennt beide und reicht den Sender beim Tick durch. KEIN Singleton.
 */
export type NudgeSender = (
  twinId: string,
  text: string,
) => Promise<{ sent: boolean; reason?: string }>;

/** Minimaler Bool-ENV-Parse (analog focus-/reflection-loop, dort modul-lokal). */
function envEnabled(raw: string | undefined): boolean {
  const v = raw?.trim().toLowerCase();
  return v === "true" || v === "1" || v === "yes";
}

export interface ProactiveNudgeDeps {
  db: Database.Database;
  auditService: AuditService;
  focusRepo: FocusSnapshotsRepo;
  twinId: string;
  twinName: string;
  ownerName: string;
  generate: NudgeGenerator;
  /**
   * Anlass 3: aktueller Kontext für den shouldNudge-Generator (Facts +
   * Summaries), damit er erkennt, wenn die offene Frage inzwischen — auch
   * Cross-Konv — erledigt ist. Optional: ohne sie läuft Anlass 3 mit leerem
   * Kontext (und Anlass-1-Tests müssen sie nicht stellen).
   */
  factsRepo?: FactsRepo;
  summariesRepo?: ConversationSummariesRepo;
  /** Anlass-3-Recency-Cutoff in Stunden. Default `OPEN_QUESTION_MAX_AGE_HOURS`. */
  openQuestionMaxAgeHours?: number;
}

/** Themen-Normalisierung: trimmt + lowercased, damit leicht variierende
 *  Formulierungen aus deriveFocus trotzdem als „dasselbe Thema" matchen. */
function norm(theme: string): string {
  return theme.trim().toLowerCase();
}

export class ProactiveNudgeService {
  private readonly openQuestionMaxAgeHours: number;

  constructor(private deps: ProactiveNudgeDeps) {
    this.openQuestionMaxAgeHours =
      deps.openQuestionMaxAgeHours ?? OPEN_QUESTION_MAX_AGE_HOURS;
  }

  /**
   * Festhäng-Detektion (rein lesend, 0 Token). „Festhängen" = die ≥3 JÜNGSTEN
   * Snapshots (aktiv + superseded) teilen ein gemeinsames Thema — robust über
   * Themen-ÜBERLAPPUNG (Schnittmenge), nicht exakte String-Gleichheit, weil
   * deriveFocus leicht variierende Formulierungen liefert.
   *
   * Algorithmus: von der jüngsten Row aus die Kette verlängern, solange die
   * laufende Themen-Schnittmenge nicht-leer bleibt. Kette ≥ STUCK_MIN_SNAPSHOTS
   * und Schnittmenge nicht-leer → festgehangen. <3 Snapshots / leere Themen
   * (kein gemeinsames Thema) → nicht festgehangen (konservativ).
   */
  detectStuck(twinId: string): StuckDetection {
    const recent = this.deps.focusRepo.listRecent(twinId, STUCK_WINDOW);
    const newest = recent[0];
    if (recent.length < STUCK_MIN_SNAPSHOTS || !newest) {
      return { isStuck: false };
    }

    // Schnittmenge mit dem jüngsten Snapshot seeden, dann die Kette verlängern.
    let common = new Set(newest.themes.map(norm));
    let chain = 1;
    for (let i = 1; i < recent.length; i++) {
      const snap = recent[i];
      if (!snap) break;
      const next = new Set(snap.themes.map(norm));
      const inter = [...common].filter((t) => next.has(t));
      if (inter.length === 0) break; // Thema gewechselt → Kette endet hier
      common = new Set(inter);
      chain++;
    }

    if (chain < STUCK_MIN_SNAPSHOTS || common.size === 0) {
      return { isStuck: false };
    }

    // Thema in Original-Schreibweise: das erste Thema des jüngsten Snapshots,
    // das in der stabilen Schnittmenge liegt.
    const thema =
      newest.themes.find((t) => common.has(norm(t))) ?? [...common][0];

    return {
      isStuck: true,
      thema,
      tageStabil: chain,
      snapshots: recent.slice(0, chain),
    };
  }

  /**
   * Voller Durchlauf: detektieren → Guards → texten (LLM) → Pending ODER Push.
   * Wird vom Fokus-Loop pro Tick aufgerufen. Erzeugt höchstens EINEN Audit-
   * Eintrag.
   *
   * 2b — ENV-Gate `PROACTIVE_NUDGE_AUTOSEND_ENABLED` (Default AUS):
   *   - AUS → Pending in der Inbox (Verhalten wie Stufe 1, unverändert).
   *   - AN + `sendToOwner` da → Push-Versuch:
   *       erfolgreich → Audit-Status 'sent' (stille Spur, KEIN offenes To-do).
   *       fehlgeschlagen → FALLBACK auf Pending (der Nudge geht nie verloren).
   *   - AN ohne `sendToOwner` → defensiv ebenfalls Pending.
   */
  async nudge(sendToOwner?: NudgeSender): Promise<ProactiveNudgeResult> {
    // 1. Detektion (Token-Bremse Stufe 1: reine SQL+JS).
    const detection = this.detectStuck(this.deps.twinId);
    if (!detection.isStuck || !detection.thema) {
      return { created: false, reason: "not-stuck" };
    }

    // 2. Guards über bestehende Anlass-1-Audits (anlass-bewusst: Anlass-3-
    //    Pendings blockieren Anlass 1 NICHT). repo.list kommt DESC.
    const nudges = await this.loadNudges(ANLASS_FOKUS);
    //   (b) Dedup: max 1 offenes Pending — kein neues, solange das letzte offen ist.
    if (nudges.some((a) => a.status === "pending")) {
      return { created: false, reason: "open-pending" };
    }
    //   (c) Episode-Cooldown: der jüngste Nudge war schon übers selbe Thema →
    //       nicht bei jedem Tick aufs Neue nerven. Erst wenn das Thema wechselt
    //       (Episode endet) und später wiederkehrt, gibt es wieder einen Nudge.
    const latest = nudges[0];
    if (latest && norm(String((latest.input as { thema?: string }).thema ?? "")) === norm(detection.thema)) {
      return { created: false, reason: "already-nudged-this-episode" };
    }

    // 3. Texten (Token-Bremse Stufe 2: der Twin entscheidet selbst via shouldNudge).
    const system = buildSystemPrompt(this.deps.twinName, this.deps.ownerName);
    const prompt = buildUserPrompt({
      ownerName: this.deps.ownerName,
      thema: detection.thema,
      tageStabil: detection.tageStabil ?? 0,
      snapshots: detection.snapshots ?? [],
    });

    let out: NudgeOutput;
    try {
      out = await this.deps.generate({ system, prompt });
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      console.warn(`[nudge] generation failed for twin=${this.deps.twinId}: ${reason}`);
      return { created: false, reason: "llm-error" };
    }

    const message = out.message?.trim() ?? "";
    if (!out.shouldNudge || message === "") {
      console.log(
        `[nudge] kein Anstoß für twin=${this.deps.twinId} (thema="${detection.thema}") — Twin hält es nicht für nötig`,
      );
      return { created: false, reason: "twin-declined" };
    }

    // 4. Effekt — Pending ODER Push (Anlass 1 nutzt PROACTIVE_NUDGE_AUTOSEND_ENABLED).
    const input = {
      anlass: ANLASS_FOKUS,
      thema: detection.thema,
      tageStabil: detection.tageStabil ?? 0,
      message,
      reasoning: out.reasoning?.trim() ?? "",
    };
    const autosend = envEnabled(process.env.PROACTIVE_NUDGE_AUTOSEND_ENABLED);
    return this.emitNudge({
      input,
      message,
      thema: detection.thema,
      autosend,
      sendToOwner,
    });
  }

  /**
   * Anlass 3: Proaktiv-Nudge bei unbeantworteter, RELEVANTER Twin-Frage. Erbt
   * die Generator→Pending/Push-Kette von Anlass 1 (emitNudge); neu sind nur die
   * Detektion (detectOpenQuestion) + der scharfe Generator-Prompt. Der Detektor
   * findet BREIT (alle offenen Fragen), der shouldNudge-Generator FILTERT
   * (rhetorisch/beiläufig → false). Eigenes Autosend-Gate
   * `PROACTIVE_NUDGE_ANLASS3_AUTOSEND_ENABLED` (Default AUS) — Anlass 3 landet
   * nach Deploy zunächst nur als Pending, bis die Relevanz-Qualität überzeugt.
   */
  async nudgeOpenQuestion(sendToOwner?: NudgeSender): Promise<ProactiveNudgeResult> {
    // 1. Detektion (Token-Bremse Stufe 1: reine SQL+JS).
    const detection = await this.detectOpenQuestion(this.deps.twinId);
    if (!detection.isOpen || !detection.question || !detection.conversationId) {
      return { created: false, reason: "no-open-question" };
    }

    // 2. Guards — anlass-bewusst (Anlass-1-Pendings blockieren Anlass 3 NICHT).
    const nudges = await this.loadNudges(ANLASS_OFFENE_FRAGE);
    //   (b) Dedup: max 1 offenes Anlass-3-Pending.
    if (nudges.some((a) => a.status === "pending")) {
      return { created: false, reason: "open-pending" };
    }
    //   (c) Episode-Cooldown pro Konversation: nicht zweimal für dieselbe
    //       offene Frage anstoßen (analog Themen-Cooldown bei Anlass 1).
    const latest = nudges[0];
    if (
      latest &&
      String((latest.input as { conversationId?: string }).conversationId ?? "") ===
        detection.conversationId
    ) {
      return { created: false, reason: "already-nudged-this-episode" };
    }

    // 3. Texten — mit aktuellem Kontext (Facts + Summaries), damit der Generator
    //    erkennt, wenn die Frage inzwischen (auch Cross-Konv) erledigt ist.
    const system = buildOpenQuestionSystemPrompt(
      this.deps.twinName,
      this.deps.ownerName,
    );
    const prompt = buildOpenQuestionUserPrompt({
      ownerName: this.deps.ownerName,
      question: detection.question,
      askedAt: detection.askedAt ?? "",
      facts: this.recentFacts(),
      summaries: this.recentSummaries(),
    });

    let out: NudgeOutput;
    try {
      out = await this.deps.generate({ system, prompt });
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      console.warn(
        `[nudge:offene-frage] generation failed for twin=${this.deps.twinId}: ${reason}`,
      );
      return { created: false, reason: "llm-error" };
    }

    const message = out.message?.trim() ?? "";
    if (!out.shouldNudge || message === "") {
      console.log(
        `[nudge:offene-frage] kein Anstoß für twin=${this.deps.twinId} (conv=${detection.conversationId}) — nicht relevant genug`,
      );
      return { created: false, reason: "twin-declined" };
    }

    // 4. Effekt — eigenes Gate (Default AUS): PROACTIVE_NUDGE_ANLASS3_AUTOSEND_ENABLED.
    const input = {
      anlass: ANLASS_OFFENE_FRAGE,
      conversationId: detection.conversationId,
      question: detection.question,
      askedAt: detection.askedAt ?? "",
      message,
      reasoning: out.reasoning?.trim() ?? "",
    };
    const autosend = envEnabled(
      process.env.PROACTIVE_NUDGE_ANLASS3_AUTOSEND_ENABLED,
    );
    return this.emitNudge({ input, message, autosend, sendToOwner });
  }

  // ─── Geteilte Bausteine (Anlass 1 + Anlass 3) ────────────────────────────

  /** anlass-bewusst: nur proactive-nudge-Audits dieses Anlasses (DESC). */
  private async loadNudges(anlass: string): Promise<AuditEntry[]> {
    const recent = await this.deps.auditService.repo.list({
      twinId: this.deps.twinId,
      limit: 200,
    });
    return recent.filter(
      (a) =>
        a.capability === PROACTIVE_NUDGE_CAPABILITY &&
        (a.input as { anlass?: string }).anlass === anlass,
    );
  }

  /**
   * Gemeinsamer Effekt: Pending ODER autonomer Push, je nach `autosend`-Flag.
   * Bei Push-Erfolg Audit-Status 'sent' (kein offenes To-do); bei Push-Fehler
   * FALLBACK auf Pending (der Nudge geht nie verloren). Der Caller bestimmt das
   * Gate (Anlass 1 + Anlass 3 haben getrennte ENV-Flags) und den Payload.
   */
  private async emitNudge(args: {
    input: Record<string, unknown>;
    message: string;
    thema?: string;
    autosend: boolean;
    sendToOwner?: NudgeSender;
  }): Promise<ProactiveNudgeResult> {
    const { input, message, thema, autosend, sendToOwner } = args;
    const anlass = String((input as { anlass?: string }).anlass ?? "");

    // AUTOSEND (Flag AN + Sender da): Push versuchen.
    if (autosend && sendToOwner) {
      let res: { sent: boolean; reason?: string };
      try {
        res = await sendToOwner(this.deps.twinId, message);
      } catch (err) {
        // sendToOwner ist eigentlich graceful (kein Throw) — defensiv trotzdem.
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`[nudge] sendToOwner warf für twin=${this.deps.twinId}: ${msg}`);
        res = { sent: false, reason: "send-failed" };
      }
      if (res.sent) {
        // Stille Audit-Spur: Status 'sent' (NICHT pending) → kein offenes To-do
        //   in der Inbox, aber nachvollziehbar was/wann gepusht wurde.
        const audit = await this.deps.auditService.start({
          capability: PROACTIVE_NUDGE_CAPABILITY,
          mandateId: null,
          initialStatus: "sent",
          input,
        });
        console.log(
          `[nudge] autonom an Owner gepusht für twin=${this.deps.twinId}, audit=${audit.id} (anlass="${anlass}", Status 'sent')`,
        );
        return { created: true, pushed: true, auditId: audit.id, thema, message };
      }
      // 🔴 FALLBACK: Push fehlgeschlagen → Pending, der Nudge geht nicht verloren.
      console.warn(
        `[nudge] autosend fehlgeschlagen (${res.reason}) für twin=${this.deps.twinId} → Fallback auf Pending`,
      );
    }

    // PENDING — Flag AUS, oder Push-Fallback. Output null bis Approve
    //   (wie social-suggestion / self-reflection-write).
    const audit = await this.deps.auditService.start({
      capability: PROACTIVE_NUDGE_CAPABILITY,
      mandateId: null,
      initialStatus: "pending",
      input,
    });
    console.log(
      `[nudge] pending proaktiver Anstoß erzeugt für twin=${this.deps.twinId}, audit=${audit.id} (anlass="${anlass}")`,
    );
    return { created: true, pushed: false, auditId: audit.id, thema, message };
  }

  /**
   * Anlass 3 — Offene-Frage-Detektion (rein lesend, 0 Token). Jeder Owner↔Twin-
   * Audit trägt einen kompletten Turn (input.lastMessage + output.reply); die
   * JÜNGSTE Audit-Row pro Konversation ist damit das letzte Wort. War dessen
   * reply eine Frage (endet auf '?'), blieb sie offen — denn eine Owner-Antwort
   * wäre eine NEUERE Audit-Row (gibt es nicht → „kein späterer user-Turn"). Deckt
   * aktive UND (G2-)beendete Konv ab — die Audits bleiben. Recency-Cutoff
   * (openQuestionMaxAgeHours): ältere Fragen gelten als erledigt/gegenstandslos.
   * Gibt höchstens den JÜNGSTEN Kandidaten zurück (1 Nudge/Tick, keine Flut).
   * Bewusst SIMPEL — die Relevanz (rhetorisch vs. echt) filtert der Generator.
   */
  async detectOpenQuestion(twinId: string): Promise<OpenQuestionDetection> {
    const cutoffMs = Date.now() - this.openQuestionMaxAgeHours * 60 * 60 * 1000;
    const audits = await this.deps.auditService.repo.list({
      twinId,
      limit: OPEN_QUESTION_AUDIT_SCAN_LIMIT,
    });

    // audits DESC → die erste Row pro conversation_id ist der jüngste Turn.
    const latestPerConv = new Map<string, AuditEntry>();
    for (const a of audits) {
      if (!CHAT_CAPABILITIES.has(a.capability)) continue;
      if (a.status !== "executed") continue;
      const convId = a.conversationId;
      if (!convId || latestPerConv.has(convId)) continue;
      latestPerConv.set(convId, a);
    }

    let best: OpenQuestionDetection | null = null;
    for (const a of latestPerConv.values()) {
      const reply = (a.output as { reply?: string } | null)?.reply?.trim();
      if (!reply || !reply.endsWith("?")) continue; // letzter Twin-Turn keine Frage
      const askedMs = Date.parse(a.timestamp);
      if (!Number.isFinite(askedMs) || askedMs < cutoffMs) continue; // Recency
      if (!best || a.timestamp > (best.askedAt ?? "")) {
        best = {
          isOpen: true,
          conversationId: a.conversationId ?? undefined,
          question: reply,
          askedAt: a.timestamp,
        };
      }
    }
    return best ?? { isOpen: false };
  }

  /** Anlass-3-Kontext: bekannte (approved) Facts als „key: value"-Zeilen. */
  private recentFacts(): string[] {
    if (!this.deps.factsRepo) return [];
    return this.deps.factsRepo
      .listByTwin(this.deps.twinId, { onlyApproved: true })
      .map((f) => `${f.factKey}: ${f.factValue}`);
  }

  /** Anlass-3-Kontext: die jüngsten Konversations-Summaries (ASC → letzte N). */
  private recentSummaries(limit = 5): string[] {
    if (!this.deps.summariesRepo) return [];
    return this.deps.summariesRepo
      .listByTwin(this.deps.twinId)
      .slice(-limit)
      .map((s) => s.summaryMd);
  }
}

// ─── Prompt-Builder (modul-lokal, pure) ──────────────────────────────────────

function buildSystemPrompt(twinName: string, ownerName: string): string {
  return `Du bist ${twinName}, der digitale Twin von ${ownerName}. ${ownerName} beschäftigt sich seit mehreren Fokus-Erhebungen in Folge mit DEMSELBEN Thema — er hängt möglicherweise daran fest. Entscheide, ob ein kurzer, proaktiver Anstoß von dir gerade HILFREICH wäre, und formuliere ihn in DEINER Twin-Stimme.

WICHTIG — Leitplanken (hart):
- Du entscheidest selbst (shouldNudge): Festhängen ist nicht per se schlecht. Nur wenn ein Anstoß ECHTEN Mehrwert hätte (eine Frage, ein Perspektivwechsel, ein „brauchst du dabei Hilfe?"), setze shouldNudge=true. Wenn das Verharren harmlos/produktiv wirkt: shouldNudge=false, leere message. Lieber kein Anstoß als ein mechanischer.
- Die message ist die Nachricht, die DU ${ownerName} schreiben würdest — direkt an ihn („du"), kurz (1–3 Sätze), konkret aufs Thema bezogen, in deiner Stimme. Kein Floskel-Coaching, kein Schwall.
- Stütze dich AUSSCHLIESSLICH auf die unten gezeigten Fokus-Snapshots. Erfinde nichts dazu.
- Du gibst dich NIEMALS als ${ownerName} aus — du sprichst ALS sein Twin ZU ihm.

Ausgabe-Felder:
- shouldNudge: wäre ein proaktiver Anstoß jetzt hilfreich?
- message: die Nachricht an ${ownerName} (leer, wenn shouldNudge=false).
- reasoning: kurze Begründung, warum (oder warum nicht) — für die Audit-Transparenz.`;
}

function buildUserPrompt(input: {
  ownerName: string;
  thema: string;
  tageStabil: number;
  snapshots: FocusSnapshot[];
}): string {
  const parts: string[] = [];
  parts.push(
    `Beobachtung: ${input.ownerName} hängt seit ${input.tageStabil} aufeinanderfolgenden Fokus-Erhebungen am Thema „${input.thema}".`,
    "",
    "**Die Fokus-Snapshots dieser Festhäng-Phase (jüngste zuerst):**",
    "",
  );
  // Chronologisch (älteste zuerst) lesbarer für den Verlauf.
  const chronological = [...input.snapshots].reverse();
  chronological.forEach((s, i) => {
    const themes = s.themes.length > 0 ? ` [Themen: ${s.themes.join(", ")}]` : "";
    parts.push(`Snapshot ${i + 1} (${s.derivedAt}):${themes}`, s.focusText, "");
  });
  parts.push(
    `Entscheide: Wäre jetzt ein kurzer proaktiver Anstoß von dir an ${input.ownerName} hilfreich? Wenn ja, formuliere ihn.`,
  );
  return parts.join("\n").trimEnd();
}

// ─── Anlass 3: Prompt-Builder (offene Frage) ─────────────────────────────────

function buildOpenQuestionSystemPrompt(
  twinName: string,
  ownerName: string,
): string {
  return `Du bist ${twinName}, der digitale Twin von ${ownerName}. In einer früheren Konversation hast DU ${ownerName} eine Frage gestellt, die er nie beantwortet hat. Entscheide, ob du ihn jetzt PROAKTIV daran erinnern solltest, und formuliere ggf. den Anstoß in DEINER Twin-Stimme.

WICHTIG — Leitplanken (hart):
- Stoße NUR an, wenn die unbeantwortete Frage eine echte, für den Owner wichtige offene Entscheidung oder Klärung betraf. Bei rhetorischen, beiläufigen oder Höflichkeits-Fragen: shouldNudge=false.
- Prüfe den aktuellen Kontext (Facts + jüngste Summaries unten): wirkt die Frage inzwischen ERLEDIGT oder gegenstandslos (auch wenn sie in einer anderen Konversation geklärt wurde)? Dann shouldNudge=false.
- Die message ist die Nachricht, die DU ${ownerName} schreiben würdest — direkt an ihn („du"), kurz (1–3 Sätze), konkret auf die offene Frage bezogen, in deiner Stimme. Kein Floskel-Coaching, kein Schwall.
- Du gibst dich NIEMALS als ${ownerName} aus — du sprichst ALS sein Twin ZU ihm. Erfinde nichts dazu.

Ausgabe-Felder:
- shouldNudge: wäre eine proaktive Erinnerung an diese offene Frage jetzt hilfreich?
- message: die Nachricht an ${ownerName} (leer, wenn shouldNudge=false).
- reasoning: kurze Begründung, warum (oder warum nicht) — für die Audit-Transparenz.`;
}

function buildOpenQuestionUserPrompt(input: {
  ownerName: string;
  question: string;
  askedAt: string;
  facts: string[];
  summaries: string[];
}): string {
  const parts: string[] = [];
  parts.push(
    `Deine unbeantwortete Frage an ${input.ownerName} (gestellt am ${input.askedAt}):`,
    `„${input.question}"`,
    "",
  );
  if (input.facts.length > 0) {
    parts.push(
      "**Aktuell bekannte Facts (Kontext — ist die Frage evtl. längst erledigt?):**",
      ...input.facts.map((f) => `- ${f}`),
      "",
    );
  }
  if (input.summaries.length > 0) {
    parts.push(
      "**Jüngste Konversations-Summaries (Kontext):**",
      ...input.summaries.map((s, i) => `Summary ${i + 1}: ${s}`),
      "",
    );
  }
  parts.push(
    `Entscheide: Wäre jetzt ein kurzer proaktiver Anstoß zu dieser offenen Frage hilfreich? Wenn ja, formuliere ihn.`,
  );
  return parts.join("\n").trimEnd();
}
