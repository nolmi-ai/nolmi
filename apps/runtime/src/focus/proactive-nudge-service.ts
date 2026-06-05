import { z } from "zod";
import type Database from "better-sqlite3";
import type { AuditService } from "../audit/service.js";
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

/** „Festhängen" = dasselbe Thema in ≥ so vielen aufeinanderfolgenden Snapshots. */
const STUCK_MIN_SNAPSHOTS = 3;
/** Fenster: so viele jüngste Snapshots zieht die Detektion heran. */
const STUCK_WINDOW = 8;

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
  /** Grund, wenn nichts erzeugt wurde (für Loop-Log/Tests). */
  reason?:
    | "not-stuck"
    | "open-pending"
    | "already-nudged-this-episode"
    | "twin-declined"
    | "llm-error";
}

export interface ProactiveNudgeDeps {
  db: Database.Database;
  auditService: AuditService;
  focusRepo: FocusSnapshotsRepo;
  twinId: string;
  twinName: string;
  ownerName: string;
  generate: NudgeGenerator;
}

/** Themen-Normalisierung: trimmt + lowercased, damit leicht variierende
 *  Formulierungen aus deriveFocus trotzdem als „dasselbe Thema" matchen. */
function norm(theme: string): string {
  return theme.trim().toLowerCase();
}

export class ProactiveNudgeService {
  constructor(private deps: ProactiveNudgeDeps) {}

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
   * Voller Stufe-1-Durchlauf: detektieren → Guards → texten (LLM) → Pending.
   * Wird vom Fokus-Loop pro Tick aufgerufen. Erzeugt höchstens EINEN Pending-
   * Audit; sendet selbst NIE etwas.
   */
  async nudge(): Promise<ProactiveNudgeResult> {
    // 1. Detektion (Token-Bremse Stufe 1: reine SQL+JS).
    const detection = this.detectStuck(this.deps.twinId);
    if (!detection.isStuck || !detection.thema) {
      return { created: false, reason: "not-stuck" };
    }

    // 2. Guards über bestehende proactive-nudge-Audits (repo.list kommt DESC).
    const recentAudits = await this.deps.auditService.repo.list({
      twinId: this.deps.twinId,
      limit: 200,
    });
    const nudges = recentAudits.filter(
      (a) => a.capability === PROACTIVE_NUDGE_CAPABILITY,
    );
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

    // 4. Pending — EINZIGER Effekt. Kein Send (Stufe-1/2-Grenze). Output null
    //    bis Approve (wie social-suggestion / self-reflection-write).
    const audit = await this.deps.auditService.start({
      capability: PROACTIVE_NUDGE_CAPABILITY,
      mandateId: null,
      initialStatus: "pending",
      input: {
        anlass: "fokus",
        thema: detection.thema,
        tageStabil: detection.tageStabil ?? 0,
        message,
        reasoning: out.reasoning?.trim() ?? "",
      },
    });

    console.log(
      `[nudge] pending proaktiver Anstoß erzeugt für twin=${this.deps.twinId}, audit=${audit.id} (thema="${detection.thema}", ${detection.tageStabil} stabil)`,
    );
    return { created: true, auditId: audit.id, thema: detection.thema, message };
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
