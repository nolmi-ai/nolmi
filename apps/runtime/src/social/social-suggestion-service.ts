import type Database from "better-sqlite3";
import type { AuditService } from "../audit/service.js";
import { relativeTime } from "../episodic/relative-time.js";

// ─── SOCIAL SUGGESTION SERVICE (Soziale Proaktivität Stufe 1) ────────────────
//
// Rein DATENGETRIEBENER Beziehungs-Vorschlag — KEIN LLM, keine Token-Kosten.
// „Du hast seit <Zeit> nichts von @<partner> gehört, willst du dich melden?"
//
// ── ZWEI PHASE-4-GRENZEN (load-bearing) ──
//  1. BINÄR + RECENCY, KEIN graded Vertrautheits-Level: Partner = wer in
//     conversations.partner_handle steht (= mit wem der Twin schon A2A-Kontakt
//     hatte; Owner-Direct nutzt den EIGENEN Handle und wird ausgeschlossen).
//     Es wird NIRGENDS ein Beziehungs-/Vertrautheits-Level gelesen/geschrieben.
//  2. Output bleibt PENDING bis Approve. Approve = no-op/acknowledge, KEIN
//     autonomer Send an den Partner (das wäre Stufe 2). Dieser Service erzeugt
//     NUR Pending-Audits — er sendet selbst nie etwas.
//
// Recency-Quelle: pro A2A-Konversation des Partners GREATEST aus den
// Konversations-Timestamps (started_at/ended_at/last_reset_at) UND
// MAX(audit.timestamp WHERE conversation_id) — letzteres ist die genauere
// Per-Message-Recency, ist heute aber für A2A-Audits oft NULL (die tragen kein
// conversation_id), daher der COALESCE auf die immer gefüllten Konversations-
// Timestamps. Beides indiziert (idx_audit_conversation / conversations.twin_id).

export const SOCIAL_SUGGESTION_CAPABILITY = "social-suggestion";

const DEFAULT_THRESHOLD_DAYS = 21;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

export interface SuggestionCandidate {
  partnerHandle: string;
  /** ISO-Timestamp des letzten Kontakts. */
  lastContact: string;
  /** Tage seit letztem Kontakt (gerundet). */
  daysSince: number;
  relativeText: string;
  suggestionText: string;
}

export interface SocialNudgeResult {
  created: Array<{ partnerHandle: string; auditId: string; suggestionText: string }>;
  /** Kandidaten über der Schwelle, aber mit offenem Pending → übersprungen. */
  skippedExistingPending: string[];
  /** Anzahl A2A-Partner insgesamt geprüft (für die CLI-Meldung). */
  partnersChecked: number;
}

export interface SocialSuggestionDeps {
  db: Database.Database;
  auditService: AuditService;
  twinId: string;
  /** Eigener Handle des Twins — Owner-Direct-Konversationen werden so erkannt
   *  und ausgeschlossen (Owner-Direct nutzt partner_handle = eigener Handle). */
  ownHandle: string;
  /** Mindest-Abstand in Tagen; nur ältere Kontakte werden vorgeschlagen. */
  thresholdDays?: number;
}

interface ConvRow {
  id: string;
  partner_handle: string;
  started_at: string;
  ended_at: string | null;
  last_reset_at: string | null;
}

export class SocialSuggestionService {
  private readonly thresholdDays: number;

  constructor(private deps: SocialSuggestionDeps) {
    this.thresholdDays = deps.thresholdDays ?? DEFAULT_THRESHOLD_DAYS;
  }

  /**
   * Ermittelt Beziehungs-Kandidaten: A2A-Partner, deren letzter Kontakt älter
   * als die Schwelle ist. Rein lesend, kein Pending. `now` injizierbar (Test).
   */
  findCandidates(now: Date): SuggestionCandidate[] {
    const ownLower = this.deps.ownHandle.toLowerCase();

    // Alle Konversationen des Twins mit ECHTEN Partnern (≠ eigener Handle =
    // nicht Owner-Direct). Indiziert auf twin_id.
    const convs = this.deps.db
      .prepare(
        `SELECT id, partner_handle, started_at, ended_at, last_reset_at
           FROM conversations WHERE twin_id = ?`,
      )
      .all(this.deps.twinId) as ConvRow[];

    const auditMaxStmt = this.deps.db.prepare(
      `SELECT MAX(timestamp) AS m FROM audit WHERE conversation_id = ?`,
    );

    // lastContact pro Partner = MAX über alle seine Konversations-Aktivitäten.
    const lastByPartner = new Map<string, string>();
    for (const c of convs) {
      if (c.partner_handle.toLowerCase() === ownLower) continue; // Owner-Direct
      const auditMax = (auditMaxStmt.get(c.id) as { m: string | null }).m;
      const activity = [c.started_at, c.ended_at, c.last_reset_at, auditMax]
        .filter((v): v is string => !!v)
        .reduce((a, b) => (a > b ? a : b));
      const prev = lastByPartner.get(c.partner_handle);
      if (!prev || activity > prev) lastByPartner.set(c.partner_handle, activity);
    }

    const out: SuggestionCandidate[] = [];
    for (const [partnerHandle, lastContact] of lastByPartner) {
      const days = Math.floor((now.getTime() - new Date(lastContact).getTime()) / MS_PER_DAY);
      if (days < this.thresholdDays) continue; // frisch genug → kein Nudge
      const relativeText = relativeTime(lastContact, now);
      out.push({
        partnerHandle,
        lastContact,
        daysSince: days,
        relativeText,
        suggestionText: `Dein letzter Kontakt mit ${partnerHandle} war ${relativeText} — willst du dich mal wieder melden?`,
      });
    }
    // Älteste Kontakte zuerst.
    out.sort((a, b) => b.daysSince - a.daysSince);
    return out;
  }

  /**
   * Erzeugt pro Kandidat einen PENDING-Audit (capability='social-suggestion').
   * Dedup: max 1 offenes Pending PRO PARTNER. Einziger Effekt sind die Pendings
   * — kein Send, kein Wirksam-Werden Richtung Partner.
   */
  async nudge(now: Date): Promise<SocialNudgeResult> {
    const candidates = this.findCandidates(now);

    // Offene social-suggestion-Pendings → Set der Partner, die schon einen
    // unbeantworteten Vorschlag haben (Guard, pro Partner).
    const open = await this.deps.auditService.repo.list({
      twinId: this.deps.twinId,
      limit: 200,
    });
    const pendingPartners = new Set(
      open
        .filter((a) => a.capability === SOCIAL_SUGGESTION_CAPABILITY && a.status === "pending")
        .map((a) => (a.input as { partnerHandle?: string }).partnerHandle)
        .filter((h): h is string => !!h),
    );

    const created: SocialNudgeResult["created"] = [];
    const skippedExistingPending: string[] = [];
    for (const c of candidates) {
      if (pendingPartners.has(c.partnerHandle)) {
        skippedExistingPending.push(c.partnerHandle);
        continue;
      }
      const audit = await this.deps.auditService.start({
        capability: SOCIAL_SUGGESTION_CAPABILITY,
        mandateId: null,
        initialStatus: "pending",
        input: {
          partnerHandle: c.partnerHandle,
          lastContact: c.lastContact,
          relativeText: c.relativeText,
          suggestionText: c.suggestionText,
        },
      });
      created.push({ partnerHandle: c.partnerHandle, auditId: audit.id, suggestionText: c.suggestionText });
    }

    return { created, skippedExistingPending, partnersChecked: candidates.length };
  }
}
