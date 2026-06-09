import { z } from "zod";
import type { AuditEntry } from "@nolmi/shared";
import type { AuditService } from "../audit/service.js";
import type {
  ConversationSummariesRepo,
  ConversationSummary,
} from "../conversations/summaries-repo.js";
import type { FocusSnapshot, FocusSnapshotsRepo } from "./focus-snapshots-repo.js";
import type { EmbeddingProvider } from "../episodic/providers/index.js";
import { f32ToBuffer } from "../episodic/embeddings-repo.js";

// ─── FOCUS ENGINE (Aufmerksamkeit/Fokus Stufe 1 — Schritt 1) ────────────────
//
// Leitet den „aktuellen Fokus" eines Twins ab: woran der Owner GERADE arbeitet,
// als kurzer gegenwartsbezogener Fließtext + optionale Themen-Liste. Input-
// Assembly nach dem reflection-engine-Vorbild (verdichtete Summaries + jüngste
// Konversations-Turns), LLM via injizierter `derive`-Funktion (generateObject +
// Zod), damit Tests einen Mock ohne Provider-Aufruf nutzen können.
//
// ── BEWUSSTE ABWEICHUNG VON DER REFLEXION (load-bearing) ──
// KEIN Approval-Gate, KEIN Pending: der Fokus wird bei Erfolg DIREKT als
// Snapshot geschrieben. Fokus ist „peripheres Wissen", das der Twin autonom
// pflegt (TWIN-VISION.md Schichtung) — anders als self-reflection-write
// (Inferenz über Markus → immer Pending). Die Leitplanke ist hier nicht ein
// Approval, sondern Sichtbarkeit + Reset (Schritt 3, noch nicht gebaut).
//
// ── ABWEICHUNG bei der Input-Auswahl ──
// reflection-engine nimmt `listByTwin(...).slice(0, 8)` — das sind wegen
// ASC-Sortierung die ÄLTESTEN Summaries. Fokus ist gegenwartsbezogen, also
// nehmen wir hier die JÜNGSTEN (`.slice(-N)`). Bewusst, nicht 1:1 kopiert.
//
// Halluzinations-Bremse wie bei der Reflexion: hasEnoughSubstance=false → KEIN
// Snapshot, klare Rückmeldung. Lieber kein Fokus als ein erfundener über dünnen
// Daten (bei dünner DB der erwartete Normalfall).

export const FOCUS_CAPABILITY = "focus-derive";

/** Wie viele jüngste Summaries / Turns in den Generator-Input. */
const SUMMARY_LIMIT = 8;
const TURN_LIMIT = 40;

export const FocusOutputSchema = z.object({
  /** false = zu wenig belastbare Evidenz → keinen Fokus ableiten. */
  hasEnoughSubstance: z.boolean(),
  /** Kurzer, gegenwartsbezogener Fokus-Text; leer, wenn keine Substanz. */
  focusText: z.string().max(1000),
  /** Optionale Themen-Schlagworte (0–5). */
  themes: z.array(z.string().max(80)).max(5),
});
export type FocusOutput = z.infer<typeof FocusOutputSchema>;

export interface FocusGenerator {
  (params: { system: string; prompt: string }): Promise<FocusOutput>;
}

export interface FocusEngineDeps {
  auditService: AuditService;
  summariesRepo: ConversationSummariesRepo;
  focusRepo: FocusSnapshotsRepo;
  twinId: string;
  twinName: string;
  ownerName: string;
  derive: FocusGenerator;
  /**
   * Theme-Similarity SS1: Lazy-Resolve auf den Embedding-Provider — wie
   * memory-embedding-service (`() => getEmbeddingProvider()`), NICHT hart
   * verdrahtet. Production: der lokale Provider (gratis, batched, normalisiert
   * → Cosine = Dot-Product). deriveFocus embeddet damit die ≤5 Themen EINMAL
   * bei der Snapshot-Erzeugung. Optional: fehlt er, wird kein Theme-BLOB
   * gespeichert (Snapshot bleibt unberührt) — Tests ohne Provider laufen weiter.
   */
  getEmbeddingProvider?: () => EmbeddingProvider;
}

export interface FocusResult {
  /** true → ein Snapshot wurde geschrieben. */
  created: boolean;
  snapshot?: FocusSnapshot;
  /** Grund, wenn nichts erzeugt wurde (zu wenig Substanz / LLM-Fehler). */
  skipped?: boolean;
  reason?: string;
}

export class FocusEngine {
  constructor(private deps: FocusEngineDeps) {}

  /**
   * Leitet den aktuellen Fokus ab und schreibt ihn — bei Erfolg — DIREKT als
   * Snapshot (kein Pending, kein Approval). Bei zu wenig Substanz / LLM-Fehler:
   * kein Snapshot, `{ created: false, skipped: true, reason }`.
   */
  async deriveFocus(): Promise<FocusResult> {
    // 1. Input-Assembly — JÜNGSTE Summaries + jüngste Turns (gegenwartsbezogen).
    const allSummaries = this.deps.summariesRepo.listByTwin(this.deps.twinId);
    const summaries = allSummaries.slice(-SUMMARY_LIMIT); // ASC → die letzten N = neueste
    const recentAudits = await this.deps.auditService.repo.list({
      twinId: this.deps.twinId,
      limit: TURN_LIMIT,
    });
    const turns = recentAudits
      .map((a) => renderAuditTurn(a, this.deps.twinName))
      .filter((l): l is string => l !== null);
    const turnCount = turns.length;

    // 2. Prompt + LLM-Call
    const system = buildSystemPrompt(this.deps.twinName, this.deps.ownerName);
    const prompt = buildUserPrompt({
      twinName: this.deps.twinName,
      summaries,
      // repo.list kommt DESC → chronologisch (neueste zuletzt) für den Prompt.
      turnsChronological: [...turns].reverse(),
    });

    let out: FocusOutput;
    try {
      out = await this.deps.derive({ system, prompt });
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      console.warn(`[focus] generation failed for twin=${this.deps.twinId}: ${reason}`);
      return { created: false, skipped: true, reason: `LLM-Fehler: ${reason}` };
    }

    const text = out.focusText?.trim() ?? "";
    if (!out.hasEnoughSubstance || text === "") {
      console.log(`[focus] kein Fokus für twin=${this.deps.twinId} — zu wenig Substanz`);
      return {
        created: false,
        skipped: true,
        reason: "zu wenig Substanz — kein Fokus abgeleitet (leeres Ergebnis ist erlaubt)",
      };
    }

    // 3. DIREKT schreiben — kein Pending (bewusste Abweichung zur Reflexion).
    // Snapshot-Lifecycle: erst den bisherigen aktiven Snapshot supersedieren,
    // DANN den neuen inserten → Invariante „genau ein aktiver Snapshot"
    // (superseded_at IS NULL) bleibt erhalten, die History (alte als superseded)
    // bleibt sauber. Reihenfolge ist load-bearing: supersede-THEN-insert; bei
    // insert-then-supersede würde supersede() den GERADE eingefügten (= jüngsten
    // aktiven) wieder supersedieren. Idempotent — kein aktiver → no-op.
    // Gilt für beide Pfade (manuelles focus/refresh + Loop Schritt 4),
    // konsistent zum Reset-Verhalten (Schritt 3).
    const basisSummary = `aus ${summaries.length} Summaries + ${turnCount} Turns`;
    const themes = out.themes ?? [];

    // Theme-Similarity SS1: die ≤5 Themen EINMAL hier (wo eh ein LLM-Call lief)
    // embedden + als BLOB mit dem Snapshot speichern. detectStuck (SS2) rechnet
    // dann nur noch Cosine über die gespeicherten Vektoren — 0 Token zur
    // Detektionszeit. DEFENSIV: schlägt das Embedden fehl (oder fehlt der
    // Provider), wird der Snapshot TROTZDEM geschrieben (themes_json wie bisher,
    // BLOB NULL). Der Snapshot darf nicht verloren gehen, nur weil das Embedding
    // scheitert (NULL-BLOBs fängt der SS2-Fallback ab).
    const themeEmbeddingsBlob = await this.embedThemes(themes);

    this.deps.focusRepo.supersede(this.deps.twinId);
    const snapshot = this.deps.focusRepo.insert({
      twinId: this.deps.twinId,
      focusText: text,
      themes,
      basisSummary,
      themeEmbeddingsBlob,
    });

    console.log(
      `[focus] Snapshot geschrieben für twin=${this.deps.twinId}, id=${snapshot.id} (${basisSummary})`,
    );
    return { created: true, snapshot };
  }

  /**
   * Embeddet die Fokus-Themen in EINEM batched Provider-Call (≤5 Vektoren) und
   * packt sie zu EINEM konkatenierten Float32-BLOB (Reihenfolge = `themes`).
   * Gibt null zurück, wenn nichts zu embedden ist, kein Provider injiziert
   * wurde oder der Embed-Call fehlschlägt — der Caller schreibt den Snapshot
   * dann ohne BLOB (defensiv, load-bearing: Snapshot nie wegen Embedding-Fehler
   * verlieren). inputType 'passage' wie im memory-embedding-service.
   */
  private async embedThemes(themes: string[]): Promise<Buffer | null> {
    if (themes.length === 0) return null;
    const resolve = this.deps.getEmbeddingProvider;
    if (!resolve) return null;
    try {
      const provider = resolve();
      const vectors = await provider.embed(themes, { inputType: "passage" });
      // Korrespondenz Theme↔Vektor ist load-bearing fürs Unpack in SS2
      // (BLOB-Offset i = themes[i]). Stimmt die Anzahl nicht, lieber NULL als
      // ein BLOB mit verschobener Zuordnung.
      if (vectors.length !== themes.length) {
        console.warn(
          `[focus] theme-embed Anzahl-Mismatch twin=${this.deps.twinId}: ${vectors.length} Vektoren für ${themes.length} Themen — BLOB verworfen`,
        );
        return null;
      }
      return packThemeEmbeddings(vectors);
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      console.warn(
        `[focus] theme-embed failed twin=${this.deps.twinId}: ${reason} — Snapshot wird ohne BLOB geschrieben`,
      );
      return null;
    }
  }
}

/**
 * Konkateniert die Theme-Vektoren zu EINEM Float32-BLOB. Voraussetzung für
 * das Unpack in SS2: alle Vektoren gleiche Dimension → BLOB-Länge /
 * (dim × 4 Bytes) = Anzahl Themen, Offset i = i-tes Thema. Verschiedene
 * Dimensionen (dürfte beim selben Provider nie passieren) → null statt eines
 * nicht entpackbaren BLOBs.
 */
function packThemeEmbeddings(vectors: Float32Array[]): Buffer | null {
  const first = vectors[0];
  if (!first) return null;
  const dim = first.length;
  if (dim === 0) return null;
  if (vectors.some((v) => v.length !== dim)) return null;
  const combined = new Float32Array(vectors.length * dim);
  vectors.forEach((v, i) => combined.set(v, i * dim));
  return f32ToBuffer(combined);
}

// ─── Prompt-Builder (modul-lokal, pure) ──────────────────────────────────────

function buildSystemPrompt(twinName: string, ownerName: string): string {
  return `Du bist ${twinName}, der digitale Twin von ${ownerName}. Leite den AKTUELLEN FOKUS ab: woran ${ownerName} GERADE arbeitet bzw. welche Hauptthemen ihn in letzter Zeit beschäftigen.

WICHTIG — Leitplanken (hart):
- Gegenwartsbezogen + konkret. Beschreibe die aktuellen Themen knapp (1–3 Sätze), kein Schwall, keine lange Liste.
- Stütze dich AUSSCHLIESSLICH auf die vorliegende Evidenz (Summaries + jüngste Konversations-Turns unten). Erfinde NICHTS dazu. Behaupte keine Themen, die die Daten nicht hergeben.
- Wenn die Daten zu dünn sind für einen belastbaren Fokus: setze hasEnoughSubstance=false und gib einen leeren focusText zurück. Ein fehlender Fokus ist BESSER als ein halluzinierter.
- Du gibst dich NIEMALS als ${ownerName} aus — du beschreibst SEINEN Fokus aus deiner Twin-Sicht.

Ausgabe-Felder:
- hasEnoughSubstance: ist genug belastbare Evidenz für einen aktuellen Fokus da?
- focusText: der Fokus als kurzer Fließtext (leer, wenn hasEnoughSubstance=false).
- themes: 0–5 kurze Themen-Schlagworte (leer, wenn keine).`;
}

function buildUserPrompt(input: {
  twinName: string;
  summaries: ConversationSummary[];
  turnsChronological: string[];
}): string {
  const parts: string[] = [];

  parts.push(
    "Aufgabe: Leite aus der jüngsten Vorgeschichte den AKTUELLEN Fokus des Owners ab — woran er gerade arbeitet / was ihn beschäftigt.",
    "",
  );

  if (input.summaries.length > 0) {
    parts.push("**Verdichtete jüngste Vorgeschichte (Konversations-Summaries):**", "");
    input.summaries.forEach((s, i) => {
      parts.push(`Segment ${i + 1}: ${s.summaryMd}`, "");
    });
  }

  parts.push("**Jüngste Konversations-Turns (neueste zuletzt):**", "");
  if (input.turnsChronological.length === 0) {
    parts.push("(keine verwertbaren Turns)");
  } else {
    for (const t of input.turnsChronological) parts.push(t);
  }

  return parts.join("\n").trimEnd();
}

// Spiegelt reflection-engine.renderAuditTurn: nur ausgeführte Chat-Turns,
// als [Owner]/[twinName]-Zeilen. Tool-Use zählt mit (zeigt Arbeits-Kontext).
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
