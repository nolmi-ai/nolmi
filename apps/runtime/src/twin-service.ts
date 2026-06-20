import type {
  Attachment,
  AuditEntry,
  AuditToolCall,
  ChatMessage,
  ForcedToolChoice,
  Mandate,
  MemoryHit,
  Persona,
  Skill,
} from "@nolmi/shared";
import {
  generateObject,
  generateText,
  streamText,
  stepCountIs,
  type LanguageModel,
  type ModelMessage,
  type StopCondition,
  type ToolSet,
} from "ai";
import type Database from "better-sqlite3";
import { checkMandate } from "./mandates/service.js";
import { loadAttachmentBytes } from "./multimodal/attachment-loader.js";
import { AuditService } from "./audit/service.js";
import type { EventBus } from "./events/bus.js";
import type { BridgeClient } from "./bridge/client.js";
import { BridgeError, BridgeDisabledError } from "./bridge/client.js";
import type { BridgeMessage } from "./bridge/types.js";
import type { TrustRepo } from "./trust/trust-repo.js";
import { buildFamiliarityBlock } from "./trust/prompt-builder.js";
import type { SkillRepo } from "./skills/repo.js";
import { buildSkillsBlock } from "./skills/prompt-builder.js";
import {
  classifyForcedTool,
  selectForcedCandidates,
} from "./skills/pre-pass.js";
import { TwinProfilesRepo } from "./twin-profiles-repo.js";
import type { OAuthRefreshService } from "./oauth/refresh-service.js";
import {
  createCodexProvider,
  type CodexProvider,
} from "./oauth/codex-vercel-provider.js";
import type { ConversationsRepo } from "./conversations/repo.js";
import type {
  ConversationSummariesRepo,
  ConversationSummary,
} from "./conversations/summaries-repo.js";
import { SummaryEngine } from "./conversations/summary-engine.js";
import {
  flushConversationTail,
  type TailFlushTrigger,
} from "./conversations/tail-flush.js";
import {
  auditsToOwnerDirectMessagesChronological,
  buildSeedBlock,
  buildSummaryBlock,
  loadConversationHistory,
} from "./conversations/history-loader.js";
import type { McpServersRepo } from "./mcp/repo.js";
import type { McpClientFactory } from "./mcp/client-factory.js";
import type { FactsRepo } from "./facts/repo.js";
import { FACT_COHERENCE_FIX_CAPABILITY } from "./facts/repo.js";
import {
  FactsCoherenceEngine,
  FactCoherenceOutputSchema,
  type FactCoherenceOutput,
} from "./facts/coherence-engine.js";
import {
  aggregateConversationForEmbedding,
  type MemoryEmbeddingService,
} from "./episodic/memory-embedding-service.js";
import type {
  MemoryRetrievalService,
  RetrievalResult,
} from "./episodic/memory-retrieval-service.js";
import type { EmbeddingProvider } from "./episodic/providers/index.js";
import { buildEpisodicBlock } from "./episodic/prompt-builder.js";
import { REVERSE_QUERY_TOP_K } from "./config.js";
import type { TwinDiaryService } from "./episodic/twin-diary-service.js";
import { TwinDiaryRepo } from "./episodic/twin-diary-repo.js";
import { buildFactsBlock } from "./facts/prompt-builder.js";
import {
  ExtractionEngine,
  ExtractionResultSchema,
  type ExtractionResult,
} from "./facts/extraction-engine.js";
import {
  ReflectionEngine,
  ReflectionOutputSchema,
  REFLECTION_CAPABILITY,
  type ReflectionOutput,
} from "./reflection/reflection-engine.js";
import {
  SOCIAL_SUGGESTION_CAPABILITY,
  SocialSuggestionService,
} from "./social/social-suggestion-service.js";
import {
  FocusEngine,
  FocusOutputSchema,
  type FocusOutput,
} from "./focus/focus-engine.js";
import { FocusSnapshotsRepo } from "./focus/focus-snapshots-repo.js";
import { buildFocusBlock } from "./focus/prompt-builder.js";
import {
  PROACTIVE_NUDGE_CAPABILITY,
  ProactiveNudgeService,
  NudgeOutputSchema,
  type NudgeOutput,
} from "./focus/proactive-nudge-service.js";
import { classifyMentionIntent } from "./a2a/mention-intent-classifier.js";
import {
  buildWebFetchTool,
  type WebFetchAuditRecord,
} from "./web-fetch/web-fetch-tool.js";
import { McpClientManager } from "./mcp/client-manager.js";
import { McpSkillSync } from "./mcp/skill-sync.js";
import { buildMcpToolsFromSkills } from "./mcp/tool-bridge.js";
import { ApprovalRequestedError } from "./mcp/errors.js";

// ─── TWIN SERVICE ────────────────────────────────────────────────────────────
//
// Zentrale Orchestrierung. Jede vom User ausgelöste Twin-Aktion durchläuft
// hier die folgenden Schritte:
//
//   1. Capability Detection      → was will der User vom Twin?
//   2. Trust-Level (2.5.4.1)     → Owner / Trusted-Twin / External
//   3. Mandate-Check              → nur bei External; Owner & Trusted bypassen
//   4. Escalation-Check           → läuft die Aktion auto oder pending?
//   5. Audit-Eintrag (start)      → mit Trust-Bypass-Marker, falls zutreffend
//   6. Provider-Call (oder skip)  → bei pending: erst nach Approval
//   7. Audit-Eintrag (complete)   → das Ergebnis wird festgehalten
//
// Trust-Levels (2.5.4.1):
//   - Owner    → der eingeloggte User ist Owner des Twins
//                → Bypass für Chat-Capabilities (respond_to_chat, drafts,
//                  summaries). send_to_twin bleibt mandate-gated, weil das
//                  ein extern-sichtbarer Bridge-Send ist.
//   - Trusted  → der Bridge-Absender steht in der Trust-Liste des Twins
//                → Bypass für respond_to_twin_message; direkte Antwort an
//                  die Bridge ohne Approval-Schritt.
//   - External → alle anderen → Mandate-Check wie bisher.

export interface TwinServiceDeps {
  /** Twin-ID aus dem Profil, für Audit-Filter und Logs. */
  twinId: string;
  /** Owner-User-ID — Basis für die Owner-Trust-Stufe. */
  ownerUserId: string | null;
  /** Vercel-AI-SDK-LanguageModel — siehe `llm-client.ts`. */
  model: LanguageModel;
  /** Kompaktes Label "<provider>/<model>", landet in Audit-Metadata. */
  modelLabel: string;
  /**
   * #107: Kleines Classifier-Modell für den Pre-Pass-Layer. Selber Provider/
   * API-Key wie das Haupt-Modell, aber günstigere Stufe (z.B. Haiku statt
   * Opus). Wird im Send-Path nur konsultiert, wenn mindestens ein aktiver
   * Skill `triggerMode='forced'` hat — sonst gar nicht gerufen.
   */
  classifierModel: LanguageModel;
  /** Kompaktes Label des Classifier-Modells, für Pre-Pass-Logs. */
  classifierModelLabel: string;
  audit: AuditService;
  bus: EventBus;
  /** Persona kommt aus `twin_profiles.persona_md` + `display_name`/`handle`. */
  persona: Persona;
  /** Mandates kommen aus `twin_profiles.mandates_json` als in-memory Array. */
  mandates: Mandate[];
  bridgeClient?: BridgeClient | null;
  /** Trust-Repository — Hot-Path bei jedem eingehenden Bridge-Call. */
  trustRepo: TrustRepo;
  /**
   * Skill-Repository — bei jedem Modell-Call werden alle aktiven Skills des
   * Twins geladen und permanent in den System-Prompt eingebettet (Strategie
   * B, siehe `skills/prompt-builder.ts`).
   */
  skills: SkillRepo;
  /**
   * Conversations-Repository (#71b/#80) — Direct-Chat-Audits werden mit der
   * aktiven Konversation verknüpft. Lazy-Start: bestehende aktive
   * wiederverwenden, sonst neue starten.
   */
  conversations: ConversationsRepo;
  /**
   * MCP-Server-Konfigurationen pro Twin (3.2.A). Manager nutzt das zum
   * Lookup beim Lazy-Spawn; Tool-Discovery + Execution kommen in 3.2.C/D.
   */
  mcpServersRepo: McpServersRepo;
  /**
   * 3.3.B: gemeinsame DB-Connection für SummaryEngine-SQL-Counts (capability-
   * gefilterte audit-Aggregationen, die das AuditRepository-Interface
   * bewusst nicht abbildet).
   */
  db: Database.Database;
  /**
   * 3.3.B: Conversation-Summaries-Repo. Wird vom SummaryEngine im Send-Path
   * gelesen + geschrieben; im History-Loader (3.3.C) zum Prompt-Aufbau gelesen.
   */
  conversationSummaries: ConversationSummariesRepo;
  /**
   * 3.3.E: Facts-Repo für Semantic-Memory. Pro Send werden die approved
   * Facts geladen und als Block direkt nach der Persona in den System-Prompt
   * eingebaut. Pending-/Auto-Facts werden bewusst NICHT geladen (Trennung
   * User-bestätigt vs. Twin-vorgeschlagen).
   */
  facts: FactsRepo;
  /**
   * 3.4.D: Memory-Embedding-Service. Wird im Send-Path nach SummaryEngine-
   * Generation aufgerufen, im Reset-Pfad für Konversationen ohne Segments,
   * und vom TwinDiaryService nach Diary-Inserts. Failures werden geschluckt
   * — Hauptoperation läuft weiter.
   */
  memoryEmbeddingService: MemoryEmbeddingService;
  /**
   * 3.4.E: Vector-Search im Send-Path. Wird vor runModel aufgerufen, liefert
   * Top-K ähnliche Memories aus vergangenen Konversationen / Diary-Einträgen.
   * Failures sind eskaliert auf "leere Memories-Liste" — Send läuft normal.
   */
  memoryRetrievalService: MemoryRetrievalService;
  /**
   * Theme-Similarity SS1: Lazy-Resolve auf den Embedding-Provider (derselbe
   * Singleton wie memoryEmbeddingService). Wird in den FocusEngine
   * durchgereicht, damit deriveFocus die Themen bei der Snapshot-Erzeugung
   * embedden kann. Production: `() => getEmbeddingProvider()`.
   */
  getEmbeddingProvider: () => EmbeddingProvider;
  /**
   * 3.4.D: Diary-Service-Wrapper (Insert + Auto-Embedding). Wird in 3.4.F
   * vom CLI twin:diary-add genutzt; der Pattern-Phase Self-Reflection für
   * Auto-Generierung steht er ebenfalls bereit.
   */
  twinDiaryService: TwinDiaryService;
  /**
   * Factory für McpClient-Instanzen (3.2.B). Production: defaultMcpClient-
   * Factory; Tests injecten Mock-Factory, sodass keine echten Subprocesses
   * gespawnt werden.
   */
  mcpClientFactory: McpClientFactory;
  /**
   * #131 Phase 3.0 Spike: Refresh-Service-Singleton aus dem Boot-Pfad. Im
   * Send-Path NUR bei `twin.authMode === 'oauth'` konsultiert (Lazy-Refresh
   * vor Codex-Adapter-Call). Optional, damit Tests + api_key-Bootstraps das
   * Feld nicht setzen müssen — der Branch wirft mit klarer Diagnose, falls
   * ein OAuth-Twin den Service nicht zur Hand hat.
   */
  oauthRefreshService?: OAuthRefreshService;
}

export interface ApproveResult {
  auditId: string;
  message?: ChatMessage;
  reply?: string;
  sentMessageId?: string;
  targetHandle?: string;
  /**
   * #131 Phase 3.3.1.3.2: Re-Pause-Use-Case. Wenn der Codex-Resume nach Approval
   * erneut ein `requires_approval=true`-Tool aufruft, schlägt der Pre-Call-Detect
   * im Loop wieder zu — `approveMcpToolUseViaCodex` catcht das, legt einen neuen
   * Pending-Audit an (mit `priorAuditId`-Link zum Original-Audit) und returnt
   * hier `pending: true`. Endpoint reicht das transparent durch, Frontend rendert
   * den neuen Pending wie jeden anderen mcp-tool-use-Pending.
   */
  pending?: boolean;
}

/** Optional: wer hat den Chat ausgelöst (für Owner-Bypass). */
export interface ChatRequestContext {
  requesterUserId?: string;
  /**
   * 3.2.H: User-getriggerte Tool-Use über den Picker. Wenn gesetzt, reichen
   * wir das Feld bis runModel/generateText durch und erzwingen den Tool-Call.
   * Default-Auto bleibt für reguläre Chats.
   */
  forcedToolChoice?: ForcedToolChoice;
  /**
   * #130 Phase 3: Channel-Marker für Cross-Channel-UX im Web-UI. Web-Form-
   * Calls lassen das Feld leer (Default = web). Telegram-MessageRouter setzt
   * `'telegram'`. Künftige Discord-/WhatsApp-Adapter erweitern den Union-Type.
   * Wird im audit.start-input als opt-in Feld weitergegeben.
   */
  channel?: "telegram" | "discord" | "whatsapp";
}

/**
 * A2A Glied 2 — Etappe 2: Maximale autonome Folgerunden PRO SEITE in einem
 * Twin-zu-Twin-Thread. Kontrollgrenze von Markus (nicht verhandelbar): bei
 * Erreichen → harter Stopp + einmalige Owner-Zusammenfassung. ENV-konfigurierbar
 * (A2A_MAX_FOLLOWUP_ROUNDS), Default 5. Die initiale send_to_twin-Eröffnung
 * zählt NICHT mit — nur die autonomen Reaktionen dieser Seite.
 */
const A2A_MAX_FOLLOWUP_ROUNDS = Number(process.env.A2A_MAX_FOLLOWUP_ROUNDS) || 5;

export class TwinService {
  /**
   * MCP-Lifecycle-Manager dieses Twins. Hält pro Server-ID einen Subprocess
   * (lazy gespawnt beim ersten Tool-Call), idle-disconnected nach
   * MCP_IDLE_TIMEOUT_MS. Wird in {@link dispose} sauber heruntergefahren.
   *
   * Public-readonly, damit Sub-D (Tool-Execution-Pfad) den Manager direkt
   * über service.mcp ansprechen kann — wir kapseln das nicht hinter weiteren
   * Wrapper-Methoden, weil der Manager schon das passende Interface ist.
   */
  public readonly mcp: McpClientManager;

  /**
   * Tool-Discovery + Skill-Registration für MCP-Server (3.2.C). Wird vom
   * CLI-Add-Pfad (Sub-E) per `service.mcpSkillSync.syncOnAdd(serverId)`
   * aufgerufen, sobald eine neue mcp_servers-Row existiert. Manueller
   * Refresh nutzt `service.mcpSkillSync.refresh(serverId)`.
   */
  public readonly mcpSkillSync: McpSkillSync;

  /**
   * 3.3.B: Sliding-Window-Auto-Summary für lange Konversationen. Wird im
   * Owner-Direct-Send-Pfad vor dem LLM-Call konsultiert; bei Threshold-
   * Überschreitung läuft die Verdichtung synchron. Mock-fähig via injizierter
   * summarize-Funktion, die hier ad hoc um generateText gewrappt wird.
   */
  public readonly summaryEngine: SummaryEngine;

  /**
   * 3.3.F: Twin-Fact-Extraction. Wird vom Server-Endpoint
   * `POST /twins/:handle/facts/extract` und vom CLI `facts-extract`
   * aufgerufen. Strukturierter LLM-Output via `generateObject`, persistiert
   * pro Vorschlag einen `confidence='pending'`-Fact plus einen pending-Audit
   * mit `capability='semantic-fact-write'`.
   */
  public readonly extractionEngine: ExtractionEngine;

  /**
   * Selbst-Reflexion Stufe 1 (über Markus): Twin-getriebene Inferenz über den
   * Owner. Vom CLI `twin:reflect` getriggert. Einziger Effekt eines Laufs ist
   * ein PENDING-Audit (`capability='self-reflection-write'`) — Approve schreibt
   * erst ins Diary (`approveSelfReflectionWrite`). NIE autonom wirksam.
   */
  public readonly reflectionEngine: ReflectionEngine;
  /**
   * Facts-Kohärenz-Review (#94 neu, SS2). Liest approved Facts, findet
   * Widersprüche/Veraltetes, schlägt fact-coherence-fix-Pendings vor. Der
   * Auslöser kommt per CLI (SS3) über die Registry — wie reflectionEngine.
   */
  public readonly factsCoherenceEngine: FactsCoherenceEngine;

  /**
   * Soziale Proaktivität Stufe 1: datengetriebener Beziehungs-Vorschlag (KEIN
   * LLM). Vom CLI `twin:social-nudge` und der Route `POST /twins/:handle/
   * social-nudge` getriggert. `nudge()` scannt ALLE A2A-Partner des Twins und
   * erzeugt pro fälligem Partner ein PENDING-Audit (`capability=
   * 'social-suggestion'`) — Approve ist NO-OP/acknowledge, KEIN autonomer Send.
   */
  public readonly socialSuggestionService: SocialSuggestionService;

  /**
   * Aufmerksamkeit/Fokus Stufe 1: leitet den „aktuellen Fokus" des Owners per
   * LLM aus jüngsten Summaries+Turns ab und schreibt ihn DIREKT als Snapshot
   * (kein Approval-Gate — peripheres Wissen, autonom gepflegt). Schritt 1:
   * via Route `POST /twins/:handle/focus/refresh` getriggert; Prompt-Integration
   * (Schritt 2), Loop (4) und Sichtbarkeit/Reset (3) folgen separat.
   */
  public readonly focusEngine: FocusEngine;

  /**
   * Schritt 2/3: derselbe Repo wie im FocusEngine, gehoisted als Feld. Schritt 2
   * nutzt `getCurrent` im Owner-Send-Pfad für den Prompt-Block; Schritt 3
   * (Sichtbarkeit/Reset) liest ihn aus den Routen `GET /focus` / `POST
   * /focus/reset` über `entry.service.focusRepo` (daher public, wie
   * reflectionEngine/socialSuggestionService).
   */
  public readonly focusRepo: FocusSnapshotsRepo;

  /**
   * Proaktiver Fokus-Nudge Stufe 1: detektiert „Owner hängt seit ≥3 Snapshots
   * am selben Thema", lässt den Twin einen Anstoß TEXTEN (LLM) und legt ihn als
   * PENDING ab (`capability='proactive-nudge'`). KEIN Versand — Approve =
   * acknowledge (Owner liest den Vorschlag in der Inbox). Vom Fokus-Loop-Tick
   * getriggert (nicht separat opt-in — hängt an FOCUS_LOOP_ENABLED). Public, weil
   * der Loop ihn über `entry.service.proactiveNudgeService.nudge()` erreicht.
   */
  public readonly proactiveNudgeService: ProactiveNudgeService;

  /**
   * 3.4.D: Memory-Embedding-Service. Public, damit der Server-Reset-Pfad
   * über `entry.service.memoryEmbeddingService.embedConversation()` darauf
   * zugreifen kann. Send-Path benutzt es intern nach `summaryEngine`.
   */
  public readonly memoryEmbeddingService: MemoryEmbeddingService;

  /**
   * 3.4.E: Memory-Retrieval-Service. Public für CLI-Smoke-Pfade; im Send-
   * Path wird er intern vor runModel konsumiert.
   */
  public readonly memoryRetrievalService: MemoryRetrievalService;

  /**
   * 3.4.D: Diary-Service. Public für CLI-Pfade (3.4.F) und künftige
   * Pattern-Phase Self-Reflection. Insert + Auto-Embedding atomar.
   */
  public readonly twinDiaryService: TwinDiaryService;

  /**
   * #107: Repo für den research_first_use_seen-Flag (Beta-Hint-Modal nach
   * erster Recherche). Eigenes Repo statt deps-Plumbing, weil Service nur
   * zwei Methoden braucht (findById + markResearchFirstUseSeen) und
   * Construction zustandslos ist.
   *
   * #131 Phase 3.0: wird zusätzlich im Send-Path konsultiert (authMode-Lookup
   * frisch aus DB pro chat-Call), damit der Helper-Smoke live zwischen
   * api_key und oauth umschalten kann ohne Registry-Reload.
   */
  private readonly profilesRepo: TwinProfilesRepo;

  /** #131 Phase 3.4.3.1 Big-Bang: Lazy-Singleton für den Codex-Vercel-Provider.
   *  Wird im runModel-oauth-Branch statt direct CodexAdapter genutzt — beide
   *  Auth-Modi laufen jetzt durch dieselbe Vercel-generateText-Pipeline. */
  private codexProvider: CodexProvider | null = null;

  /**
   * A2A Glied 2 — Abbruch-Mechanik: In-Memory-Set abgebrochener Threads.
   * Pro Boot ephemer (bei Restart vergessen → Thread kann erneut anlaufen;
   * für den Pilot akzeptiert, weil Neustart eine neue Verhandlungssitzung
   * impliziert). Der Owner ruft POST /twins/:handle/a2a/abort, der Endpoint
   * setzt die threadId hier. receiveBridgeMessage prüft vor jeder Folgerunde.
   */
  private readonly abortedThreadIds = new Set<string>();

  /**
   * A2A Glied 2 — Etappe 2: Threads, für die bereits eine Owner-Zusammenfassung
   * erzeugt wurde. Verhindert, dass weitere eingehende Replies eines bereits
   * gestoppten (Limit erreicht ODER abgebrochenen) Threads erneut summarizen —
   * die Zusammenfassung läuft EINMAL, nicht pro Runde. Pro Boot ephemer, analog
   * zu abortedThreadIds (Pilot-Scope).
   */
  private readonly summarizedThreadIds = new Set<string>();

  /** Markiert einen A2A-Thread als abgebrochen — keine weiteren Folgerunden. */
  abortThread(threadId: string): void {
    this.abortedThreadIds.add(threadId);
    console.log(`[a2a:glied2] Thread abgebrochen: ${threadId}`);
  }

  /** Prüft ob ein Thread abgebrochen wurde (vor Folgerunde aufrufen). */
  isThreadAborted(threadId: string): boolean {
    return this.abortedThreadIds.has(threadId);
  }

  constructor(private deps: TwinServiceDeps) {
    this.mcp = new McpClientManager(
      deps.twinId,
      deps.mcpServersRepo,
      deps.mcpClientFactory,
    );
    this.mcpSkillSync = new McpSkillSync(
      deps.mcpServersRepo,
      deps.skills,
      this.mcp,
      deps.twinId,
    );
    this.summaryEngine = new SummaryEngine({
      db: deps.db,
      summariesRepo: deps.conversationSummaries,
      summarize: async (system, user) => {
        // Summary-LLM nutzt denselben Provider/Modell wie der Twin selbst —
        // Persona-Konsistenz und Provider-Agnostik. Wir packen `system` als
        // Prompt-System und `user` als einzige user-Message — kein Tool-Use,
        // kein Multi-Step.
        const result = await generateText({
          model: deps.model,
          system,
          messages: [{ role: "user", content: user }],
        });
        return { text: result.text };
      },
    });
    this.extractionEngine = new ExtractionEngine({
      facts: deps.facts,
      conversationSummaries: deps.conversationSummaries,
      auditService: deps.audit,
      twinId: deps.twinId,
      twinName: deps.persona.name,
      extract: async ({ system, prompt }) => {
        // Strukturierter Output via Zod-Schema. Twin-eigener Provider/Model
        // analog zum SummaryEngine — Persona-Stimme bleibt konsistent.
        const result = await generateObject({
          model: deps.model,
          schema: ExtractionResultSchema,
          system,
          prompt,
        });
        return result.object as ExtractionResult;
      },
    });
    this.reflectionEngine = new ReflectionEngine({
      facts: deps.facts,
      conversationSummaries: deps.conversationSummaries,
      auditService: deps.audit,
      twinId: deps.twinId,
      twinName: deps.persona.name,
      ownerName: deps.persona.name,
      // 'self'-Modus: jüngste Diary-Reflexionen als „schon beobachtet"-Kontext.
      diaryRepo: new TwinDiaryRepo(deps.db),
      reflect: async ({ system, prompt }) => {
        // Strukturierter Output via Zod-Schema, Twin-eigener Provider/Model —
        // analog ExtractionEngine/SummaryEngine.
        const result = await generateObject({
          model: deps.model,
          schema: ReflectionOutputSchema,
          system,
          prompt,
        });
        return result.object as ReflectionOutput;
      },
    });
    // Facts-Kohärenz-Review (#94 neu, SS2): eigener Generator im facts-Domain
    // (NICHT reflection-engine — anderer Concern). Strukturierter Output via
    // Zod, Twin-eigener Provider/Model — analog reflection/extraction.
    this.factsCoherenceEngine = new FactsCoherenceEngine({
      facts: deps.facts,
      conversationSummaries: deps.conversationSummaries,
      auditService: deps.audit,
      twinId: deps.twinId,
      twinName: deps.persona.name,
      ownerName: deps.persona.name,
      generate: async ({ system, prompt }) => {
        const result = await generateObject({
          model: deps.model,
          schema: FactCoherenceOutputSchema,
          system,
          prompt,
        });
        return result.object as FactCoherenceOutput;
      },
    });
    this.memoryEmbeddingService = deps.memoryEmbeddingService;
    this.memoryRetrievalService = deps.memoryRetrievalService;
    this.twinDiaryService = deps.twinDiaryService;
    // Soziale Proaktivität Stufe 1: rein datengetrieben, kein Model-Dep. Schwelle
    // aus derselben env-Quelle wie der CLI (scripts/social-nudge.ts), gleicher
    // Default 21 — nicht neu erfinden.
    this.socialSuggestionService = new SocialSuggestionService({
      db: deps.db,
      auditService: deps.audit,
      twinId: deps.twinId,
      ownHandle: deps.persona.handle,
      thresholdDays: Number(process.env.SOCIAL_NUDGE_THRESHOLD_DAYS) || 21,
    });
    // Aufmerksamkeit/Fokus: braucht den LLM-Client (wie reflectionEngine) —
    // injizierte derive-Funktion über deps.model + generateObject + Zod.
    this.focusRepo = new FocusSnapshotsRepo(deps.db);
    this.focusEngine = new FocusEngine({
      auditService: deps.audit,
      summariesRepo: deps.conversationSummaries,
      focusRepo: this.focusRepo,
      twinId: deps.twinId,
      twinName: deps.persona.name,
      ownerName: deps.persona.name,
      derive: async ({ system, prompt }) => {
        const result = await generateObject({
          model: deps.model,
          schema: FocusOutputSchema,
          system,
          prompt,
        });
        return result.object as FocusOutput;
      },
      // Theme-Similarity SS1: Provider lazy durchreichen (derselbe Singleton wie
      // memoryEmbeddingService) — deriveFocus embeddet damit die Themen.
      getEmbeddingProvider: deps.getEmbeddingProvider,
    });
    // Proaktiver Fokus-Nudge: teilt den focusRepo (liest die Snapshot-Historie)
    // und braucht — wie focusEngine — den LLM-Client für den Anstoß-Text.
    this.proactiveNudgeService = new ProactiveNudgeService({
      db: deps.db,
      auditService: deps.audit,
      focusRepo: this.focusRepo,
      twinId: deps.twinId,
      twinName: deps.persona.name,
      ownerName: deps.persona.name,
      // Anlass 3: aktueller Kontext (Facts + Summaries) für die Relevanz-/
      // Erledigt-Prüfung des shouldNudge-Generators.
      factsRepo: deps.facts,
      summariesRepo: deps.conversationSummaries,
      generate: async ({ system, prompt }) => {
        const result = await generateObject({
          model: deps.model,
          schema: NudgeOutputSchema,
          system,
          prompt,
        });
        return result.object as NudgeOutput;
      },
    });
    this.profilesRepo = new TwinProfilesRepo(deps.db);
  }

  /**
   * 3.4.D + Sub-Step 3 (Tail-Flush): Reset-Pfad mit Episodic-Memory-Pflege.
   *   - OHNE Segments (kurze Konv unter dem Threshold): die ganze Konversation
   *     wird in einen einzelnen Embedding-Eintrag verdichtet (Whole-Conv-Embed),
   *     sonst gäbe es keine Spur im Episodic-Memory. UNVERÄNDERT.
   *   - MIT Segments (lange Konv): die Segmente sind schon embedded, ABER der
   *     unsummarisierte Tail (Turns nach dem letzten Segment-Cursor, unter der
   *     Schwelle) fiel bisher durch (L3-Lücke, docs/TAIL-FLUSH-VERDICHTUNG-
   *     STRATEGY.md). Statt Skip → flushConversationTail verdichtet ihn final.
   *
   * Reihenfolge: Embed/Flush VOR end() — auf der noch-aktiven Konv, damit die
   * Audit-/Cursor-Zählung sauber ist. end() läuft danach in JEDEM Fall (auch
   * wenn der Flush scheitert — der Tail bleibt dann 'failed' für den späteren
   * Loop-Verarbeiter, Sub-Step 4).
   *
   * Failure-Verhalten: Embedding-/Flush-Fehler unterbrechen das Reset nicht;
   * Service/Primitive schlucken sie und setzen status='failed'.
   *
   * `trigger`: 'manual' (Default) = owner-getriggert (Web-Reset) → Tail-Flush
   * läuft immer. 'autonomous' = G2-Idle-Reset → Tail-Flush nur bei
   * TAIL_FLUSH_AUTONOMOUS_ENABLED. NUR der Tail-Flush-Pfad (summaries>0) ist
   * gegated; der Whole-Conv-Embed (summaries===0) und end() laufen immer.
   */
  async resetConversation(
    conversationId: string,
    trigger: TailFlushTrigger = "manual",
  ): Promise<void> {
    // #160: leere ABGEHENDE Konv → direkt hart löschen statt zu beenden (kein
    // Embed/End nötig — 0 Turns ⇒ nichts zu verdichten). deleteIfEmpty liefert
    // false bei ≥1 Turn → dann läuft der normale Verdichten+Enden-Pfad unverändert.
    // Fängt Reset (Owner) UND G2/Fokus-Loop (beide rufen resetConversation).
    if (this.deps.conversations.deleteIfEmpty(conversationId)) {
      console.log(
        `[reset] conv=${conversationId} war leer — gelöscht statt beendet (#160)`,
      );
      return;
    }
    const summaries =
      this.deps.conversationSummaries.listByConversation(conversationId);
    if (summaries.length === 0) {
      // Audits laden — Repo gibt DESC zurück, wir brauchen ASC für die
      // chronologische Aggregation. Limit 10_000 ist praktisch unbegrenzt
      // (Reset bei kurzen Konversationen, weit unter dem Summary-Threshold).
      const auditsDesc = await this.deps.audit.repo.listByConversation(
        conversationId,
        10_000,
      );
      const auditsAsc = [...auditsDesc].reverse();
      const content = aggregateConversationForEmbedding(auditsAsc);
      if (content.length > 0) {
        await this.memoryEmbeddingService.embedConversation({
          twinId: this.deps.twinId,
          conversationId,
          content,
        });
      } else {
        console.log(
          `[reset] conv=${conversationId} hatte keine zählenden Audits — kein Embedding nötig`,
        );
      }
    } else {
      // Sub-Step 3: lange Konv mit Segment(en) → unsummarisierten Tail final
      // verdichten statt überspringen. Selbst kosten-/scope-gegated (Tail=0 →
      // No-op). Eigener try/catch: ein Flush-Fehler darf das Reset NICHT
      // crashen — end() unten muss laufen.
      try {
        const conv = this.deps.conversations.findById(conversationId);
        await flushConversationTail(
          {
            summaryEngine: this.summaryEngine,
            memoryEmbeddingService: this.memoryEmbeddingService,
            conversationsRepo: this.deps.conversations,
            conversationSummariesRepo: this.deps.conversationSummaries,
            twinId: this.deps.twinId,
          },
          conversationId,
          {
            twinName: this.deps.persona.name,
            partnerHandle: conv.partnerHandle,
          },
          trigger,
        );
      } catch (err) {
        console.error(
          `[reset] Tail-Flush warf conv=${conversationId} — übersprungen, Reset läuft weiter: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
    this.deps.conversations.end(conversationId);
  }

  /**
   * Sub-Step 5 (Tail-Flush-Verarbeiter): greift die bereits BEENDETEN pending-
   * Konversationen MIT Segment(en) auf und verdichtet ihren unsummarisierten
   * Tail. Schließt die L3-Lücke für Konv, die NICHT über resetConversation
   * endeten (z.B. start()-Invariante, Pre-G2-Bestand) — die G2 (active-only)
   * nicht erreicht.
   *
   * Nutzt die EIGENEN Engines des TwinService (summaryEngine mit echtem Modell,
   * memoryEmbeddingService) — KEINE Neu-Konstruktion von Provider/LLM. trigger
   * wird durchgereicht: der autonome Loop ruft mit 'autonomous' (in
   * flushConversationTail gegen TAIL_FLUSH_AUTONOMOUS_ENABLED gegated). Nur Konv
   * MIT Segment (segCount>0); segment-lose pending gehören in den Whole-Embed-
   * Pfad (Maintenance-CLI), nicht in den autonomen Loop. Batch-Limit + per-Konv
   * try/catch (ein Fehler kippt den Lauf nicht).
   */
  async flushPendingConversationTails(
    trigger: TailFlushTrigger,
    limit: number,
  ): Promise<{ flushed: number; candidates: number; wholeEmbedded: number }> {
    const pending = this.deps.conversations.listPendingByTwin(this.deps.twinId);
    let flushed = 0;
    let candidates = 0;
    let wholeEmbedded = 0;
    for (const conv of pending) {
      // #161: Batch-Limit gilt über BEIDE Verarbeitungs-Arten (Tail-Flush +
      // Whole-Embed) — sonst Kosten-Spike beim ersten Lauf über den Bestand.
      if (flushed + wholeEmbedded >= limit) break;

      // #161: 0-Segment-ended-pending-Konv (durch die start()-Invariante beendet,
      // nie embedded) fielen bisher hier raus (count===0 → continue) und blieben
      // für immer pending — der einzige Whole-Embed-Verarbeiter (embedAll) ist
      // manuell. Stattdessen: hier whole-embedden, mit DEMSELBEN Rezept wie
      // resetConversation (aggregateConversationForEmbedding → embedConversation).
      // embedConversation setzt embedding_status selbst (done/failed). Eigener
      // Zweig + eigener Zähler; der Tail-Flush für Konv MIT Segment bleibt unten
      // unverändert.
      if (this.deps.conversationSummaries.count(conv.id) === 0) {
        try {
          // Audits DESC → ASC für die chronologische Aggregation (wie reset).
          const auditsDesc = await this.deps.audit.repo.listByConversation(
            conv.id,
            10_000,
          );
          const content = aggregateConversationForEmbedding([...auditsDesc].reverse());
          // „MIT Inhalt"-Guard: wirklich leere 0-Turn-Konv NICHT embedden (kein
          // leerer Call) — exakt das resetConversation-Kriterium (content.length).
          if (content.length === 0) continue;
          await this.memoryEmbeddingService.embedConversation({
            twinId: this.deps.twinId,
            conversationId: conv.id,
            content,
          });
          wholeEmbedded += 1;
          console.log(
            `[tail-flush-loop] conv=${conv.id} 0-Segment whole-embedded (#161)`,
          );
        } catch (err) {
          console.error(
            `[tail-flush-loop] conv=${conv.id} whole-embed fehlgeschlagen: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
        continue;
      }

      candidates += 1;
      try {
        const res = await flushConversationTail(
          {
            summaryEngine: this.summaryEngine,
            memoryEmbeddingService: this.memoryEmbeddingService,
            conversationsRepo: this.deps.conversations,
            conversationSummariesRepo: this.deps.conversationSummaries,
            twinId: this.deps.twinId,
          },
          conv.id,
          { twinName: this.deps.persona.name, partnerHandle: conv.partnerHandle },
          trigger,
        );
        if (res.status === "done") flushed += 1;
      } catch (err) {
        console.error(
          `[tail-flush-loop] conv=${conv.id} fehlgeschlagen: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
    return { flushed, candidates, wholeEmbedded };
  }

  /**
   * Container-Shutdown-Hook: wird von TwinServiceRegistry.disposeAll() bei
   * SIGTERM/SIGINT gerufen. Beendet alle gehaltenen MCP-Subprocesses graceful
   * (mit SIGKILL-Fallback nach MCP_DISCONNECT_TIMEOUT_MS pro Server).
   */
  async dispose(): Promise<void> {
    await this.mcp.dispose();
  }

  /**
   * Bridge-Client nach dem Service-Start nachreichen. Boot-Reihenfolge will
   * Server zuerst hochziehen (für den Logger), dann Bridge — und dabei muss
   * der TwinService schon stehen, damit `receiveBridgeMessage` ihn nutzen kann.
   */
  setBridgeClient(client: BridgeClient | null): void {
    this.deps.bridgeClient = client;
  }

  async chat(
    messages: ChatMessage[],
    ctx: ChatRequestContext = {},
  ): Promise<{
    message: ChatMessage | null;
    auditId: string;
    pending: boolean;
    /** #100: Memory-Hits aus dem Owner-Bypass-Pfad. Andere Pfade leer. */
    memoryHits?: MemoryHit[];
    /**
     * #107: Beta-Hint-Signal nach erster Recherche pro Twin. Heute nur
     * `'research'` als einziger Wert; Frontend matched darauf einen Modal.
     * Undefined wenn keine Pre-Pass-Triggerung oder Flag bereits gesetzt.
     */
    firstUseHint?: "research";
  }> {
    // 1. Capability detecten
    const lastUser = messages.at(-1)?.content ?? "";
    let detection = detectCapability(lastUser);

    // 1b. A2A-Autosend Weg 2 SS2 — SCHATTEN-Modus. Bei VERBLOSER @-Mention
    // (respond_to_chat + fremdes @-Target + KEIN Sende-Verb) klassifiziert ein
    // kleiner Modell-Call die Absicht (SEND/CHAT) und LOGGT sie immer. Der
    // detection-Override auf send_to_twin passiert NUR bei
    // MENTION_AUTOSEND_ENABLED=true (opt-in). Ohne Flag: kein Verhaltens-Change
    // — detection bleibt respond_to_chat, der Weg-3-Verb-Hint feuert weiter.
    // 🔴 Selbst bei Override bleibt send_to_twin always_pending → Approval (kein
    // Auto-Send); ownerBypass (unten) schließt send_to_twin bewusst aus.
    if (detection.capability === "respond_to_chat") {
      const mentioned = detectTargetHandle(lastUser);
      const ownHandle = (
        this.deps.persona.handle.startsWith("@")
          ? this.deps.persona.handle
          : `@${this.deps.persona.handle}`
      ).toLowerCase();
      const hasSendVerb = SEND_TRIGGERS.some((t) =>
        lastUser.toLowerCase().includes(t),
      );
      if (mentioned && mentioned !== ownHandle && !hasSendVerb) {
        const armed =
          process.env.MENTION_AUTOSEND_ENABLED?.trim().toLowerCase() === "true";
        const result = await classifyMentionIntent(
          lastUser,
          mentioned,
          this.deps.classifierModel,
        );
        console.log(
          `[mention-intent] twin=${this.deps.persona.handle} target=${mentioned} ` +
            `intent=${result.intent} gate=${armed ? "armed" : "shadow"} ` +
            `reason="${result.reason}" text="${lastUser.slice(0, 80).replace(/\n/g, " ")}"`,
        );
        if (armed && result.intent === "SEND") {
          detection = { capability: "send_to_twin", targetHandle: mentioned };
        }
      }
    }

    // 2. Trust-Level: Owner-Bypass nur für non-Bridge-Capabilities. Ein
    // send_to_twin-Aufruf hat extern-sichtbaren Side-Effect — den lassen wir
    // bewusst weiter mandate-gated, auch beim Owner. Approval ist hier eine
    // Tippfehler-Bremse, kein Vertrauens-Gate.
    const isOwner =
      !!ctx.requesterUserId &&
      this.deps.ownerUserId !== null &&
      ctx.requesterUserId === this.deps.ownerUserId;
    const ownerBypass = isOwner && detection.capability !== "send_to_twin";

    if (ownerBypass) {
      return this.runOwnerDirect(detection.capability, messages, lastUser, {
        forcedToolChoice: ctx.forcedToolChoice,
        channel: ctx.channel,
        // Reverse-Memory-Query Typ a: Zeitfenster mitgeben (sonst undefined).
        reverseTimeframe:
          detection.capability === "reverse_memory_query"
            ? detection.reverseTimeframe
            : undefined,
      });
    }

    // 3. Mandate-Check (External-Pfad — Owner-Bypass schon oben abgehandelt)
    const check = checkMandate(this.deps.mandates, detection.capability);
    if (!check.allowed) {
      const blocked = await this.deps.audit.block({
        capability: detection.capability,
        input: { messages },
        reason: check.reason ?? "Mandate check failed",
      });
      throw new Error(`Twin blocked: ${blocked.reason}`);
    }

    // Bridge-only Capability ohne aktive Bridge → früh blocken, sonst landet
    // ein Pending-Audit in der Queue, das man nie approven kann.
    if (detection.capability === "send_to_twin" && !this.deps.bridgeClient) {
      const blocked = await this.deps.audit.block({
        capability: detection.capability,
        input: { messages, targetHandle: detection.targetHandle },
        reason: "Bridge-Modus ist nicht aktiv",
      });
      throw new Error(`Twin blocked: ${blocked.reason}`);
    }

    const persona = this.deps.persona;

    // 4. Escalation-Check: läuft auto oder bleibt pending?
    const isPending = check.mandate?.escalation === "always_pending";

    // 5. Audit öffnen — Capability-spezifischer Input.
    const baseInput: Record<string, unknown> = {
      messages,
      lastMessage: lastUser,
    };
    if (detection.capability === "send_to_twin") {
      baseInput.targetHandle = detection.targetHandle;
    }
    const audit = await this.deps.audit.start({
      capability: detection.capability,
      mandateId: check.mandate?.id ?? null,
      input: baseInput,
      initialStatus: isPending ? "pending" : "approved",
    });

    if (isPending) {
      // Pending: kein Modell-Call jetzt. Aktion wartet auf Approval.
      this.deps.bus.emit({ type: "twin.idle", payload: {} });
      return { message: null, auditId: audit.id, pending: true };
    }

    // 6. Auto: direkt zum Modell
    this.deps.bus.emit({ type: "twin.thinking", payload: { capability: detection.capability } });
    try {
      // #3: maxLength-Enforcement aus dem greifenden Mandate (z.B.
      // respond_to_chat 4000). `check.mandate` ist hier in Scope.
      const reply = await this.enforceMaxLength(check.mandate, (hint) =>
        this.runModel(persona, messages, hint ?? undefined),
      );
      await this.deps.audit.complete(audit.id, {
        reply: reply.content,
        providerMetadata: reply.metadata,
        ...(reply.lengthEnforced
          ? { lengthEnforced: reply.lengthEnforced }
          : {}),
      });
      this.deps.bus.emit({ type: "twin.idle", payload: {} });
      return {
        message: { role: "assistant", content: reply.content },
        auditId: audit.id,
        pending: false,
      };
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      await this.deps.audit.fail(audit.id, reason);
      this.deps.bus.emit({ type: "twin.idle", payload: {} });
      throw err;
    }
  }

  // ─── Owner-Bypass ──────────────────────────────────────────────────────────
  //
  // Wenn der eingeloggte User Owner des Twins ist, antwortet der Twin direkt
  // ohne Mandate-Check. Audit-Capability "owner-direct" (statt der Original-
  // Capability), `originalCapability` im input für Trace-Zwecke.

  private async runOwnerDirect(
    originalCapability: string,
    messages: ChatMessage[],
    lastUser: string,
    options: {
      forcedToolChoice?: ForcedToolChoice;
      /** #130 Phase 3: weitergereicht in audit.input.channel für Web-UI-Badge. */
      channel?: "telegram" | "discord" | "whatsapp";
      /** Reverse-Memory-Query Typ a: erkanntes Zeitfenster (undefined = Typ b). */
      reverseTimeframe?: ReverseTimeframe;
    } = {},
  ): Promise<{
    message: ChatMessage;
    auditId: string;
    pending: boolean;
    /** #100: optional, nur im Success-Pfad gesetzt wenn Hits vorlagen. */
    memoryHits?: MemoryHit[];
    /** #107: Beta-Hint-Signal nach erster Recherche pro Twin. */
    firstUseHint?: "research";
  }> {
    // Reverse-Memory-Query (Lebens-Narrativ Stufe 1): reaktive Rückschau —
    // eigener Retrieval+Synthese-Pfad statt der normalen Chat-Kette. Inline im
    // Chat (Gesprächscharakter), kein eigener Endpoint.
    if (originalCapability === "reverse_memory_query") {
      return this.runReverseMemoryQuery(
        messages,
        lastUser,
        options.reverseTimeframe,
      );
    }
    // #71b/#80: Direct-Chat-Audits werden mit der aktiven Konversation
    // verknüpft. ownerUserId muss gesetzt sein, weil Owner-Bypass nur greift
    // wenn requesterUserId === ownerUserId — der `chat()`-Caller stellt das
    // sicher. Defensive Sanity-Prüfung trotzdem, damit ein vergessener
    // Test-Pfad nicht still mit conversation_id=NULL durchläuft.
    let conversationId: string | null = null;
    let history: ChatMessage[] = [];
    let summaries: ConversationSummary[] = [];
    // Fortsetzen v2: Seed-Kontext der aktiven Konv (Summary-Snapshot der Ur-
    // Konv). Nur Fortsetzungs-Konv tragen einen → über das continuedFrom-Flag
    // gegated, damit normale Sends KEINEN Extra-Lookup zahlen.
    let seedContext: string | null = null;
    if (this.deps.ownerUserId) {
      const conv = this.deps.conversations.getOrStart(
        this.deps.ownerUserId,
        this.deps.persona.handle.startsWith("@")
          ? this.deps.persona.handle
          : `@${this.deps.persona.handle}`,
        this.deps.twinId,
      );
      conversationId = conv.id;
      if (conv.continuedFromConversationId) {
        seedContext = this.deps.conversations.getSeedContext(conv.id);
      }
      // 3.3.B: Summary-Check VOR dem History-Load — wenn der Threshold
      // überschritten ist, persistiert die SummaryEngine die ältesten
      // Messages noch in dieser Send-Latenz. Sync, weil Edge-Case
      // (>50 zählende Messages). 3.3.C zieht den frisch erzeugten Summary
      // direkt im folgenden loadConversationHistory()-Call mit in den
      // System-Prompt. Failures schluckt die Engine intern und loggt —
      // Caller fährt einfach mit dem heutigen Verhalten weiter.
      if (await this.summaryEngine.shouldSummarize(conv.id)) {
        console.log(
          `[summary] threshold reached for conversation=${conv.id}, generating summary...`,
        );
        const summaryResult = await this.summaryEngine.generateSummary(
          conv.id,
          {
            twinName: this.deps.persona.name,
            partnerHandle: this.deps.persona.handle.startsWith("@")
              ? this.deps.persona.handle
              : `@${this.deps.persona.handle}`,
          },
        );
        // 3.4.D: frisch erzeugtes Segment ins Episodic-Memory. Embedding-
        // Failure schluckt der Service intern — Send-Path läuft unverändert
        // weiter. `summaryEngine.generateSummary` selbst liefert bei eigenem
        // Failure null; dann gibt's nichts zu embedden.
        if (summaryResult) {
          const segment = this.deps.conversationSummaries.listByConversation(
            conv.id,
          );
          const fresh = segment.find((s) => s.id === summaryResult.summaryId);
          if (fresh) {
            await this.memoryEmbeddingService.embedSummarySegment({
              twinId: this.deps.twinId,
              segmentId: fresh.id,
              content: fresh.summaryMd,
            });
          }
        }
      }

      // 3.3.C: Sliding-Window-History mit optionalem Summary-Block.
      // Wenn Summaries existieren, kommt das Live-Window via Cursor (alle
      // Audits NACH dem letzten summarized Audit, ASC). Ohne Summaries:
      // Fallback auf Hard-Cap wie bisher. Failure-Pfad in
      // loadConversationHistory schluckt Exceptions und liefert leere
      // Summaries + Hard-Cap-Audits.
      const loaded = await loadConversationHistory(
        {
          summariesRepo: this.deps.conversationSummaries,
          auditRepo: this.deps.audit.repo,
          fallbackLimit: HISTORY_AUDIT_LIMIT,
        },
        conv.id,
      );
      summaries = loaded.summaries;
      history = auditsToOwnerDirectMessagesChronological(loaded.liveAuditsAsc);
      if (summaries.length > 0) {
        console.log(
          `[history] loaded conversation=${conv.id} with ${summaries.length} summaries + ${loaded.liveAuditsAsc.length} live audits`,
        );
      }
    }

    // 3.2.F: audit.start() VOR runModel würde bei Approval-Pending einen
    // executed-then-failed-Zwischenstate hinterlassen. Stattdessen erst
    // runModel versuchen — wenn es McpToolApprovalRequiredError wirft, einen
    // Pending-Audit `mcp-tool-use` anlegen; sonst den normalen owner-direct-
    // Audit. Konsistente Audit-Trail-Reihenfolge: ein Audit pro User-Send.
    const llmMessages: ChatMessage[] = [
      ...history,
      { role: "user", content: lastUser },
    ];

    this.deps.bus.emit({
      type: "twin.thinking",
      payload: { capability: "owner-direct" },
    });

    // 3.3.E: Facts-Block für den System-Prompt — approved-only, alphabetisch
    // sortiert, leerer Block bei keinen Facts. Sync-Lookup (~1-2ms pro Send,
    // kein Caching nötig). Pending/Auto-Facts werden bewusst NICHT geladen.
    const approvedFacts = this.deps.facts.listByTwin(this.deps.twinId, {
      onlyApproved: true,
    });
    if (approvedFacts.length > 0) {
      console.log(
        `[facts] loaded ${approvedFacts.length} approved facts for twin=${this.deps.twinId}`,
      );
    }
    const factsBlock = buildFactsBlock(approvedFacts);

    // 3.4.E: Episodic-Retrieval — User-Message gegen vergangene Memories
    // suchen. Failure-Pfad gibt `[]` zurück, also kein Throw an dieser Stelle.
    // Filter auf laufende Konv (Konversation + Summary-Segments), damit
    // Twin nicht seine eigene aktuelle History als "Erinnerung" gespiegelt
    // bekommt.
    const episodicMemories = await this.memoryRetrievalService.retrieve({
      twinId: this.deps.twinId,
      userMessage: lastUser,
      currentConversationId: conversationId,
      excludeSummarySegmentIds: summaries.map((s) => s.id),
    });
    // Zeit-Erleben Stufe 1: Request-Zeitpunkt als „jetzt"-Anker für die
    // Relativ-Zeit-Annotation der episodischen Erinnerungen.
    const now = new Date();
    const episodicBlock = buildEpisodicBlock(episodicMemories, now);

    // Aufmerksamkeit/Fokus Stufe 1 — Schritt 2: gespeicherter Fokus (jüngster
    // Snapshot) als Prompt-Block. NUR im Owner-Pfad (hier) — A2A-runModel-Calls
    // reichen den focusBlock bewusst NICHT (Owner-Kontext, kein Fremd-Wissen).
    // Defensiv: kein Snapshot → buildFocusBlock liefert null → .filter(Boolean)
    // im Helper wirft ihn raus (kein leerer Header).
    const focusBlock = buildFocusBlock(
      this.focusRepo.getCurrent(this.deps.twinId),
      this.deps.persona.name,
    );

    // Weg 3: ehrlicher Hint bei VERBLOSER @-Mention. Der Chat-LLM kennt
    // send_to_twin nicht und würde sonst „geht in die Queue" halluzinieren.
    // Feuert NUR bei respond_to_chat + erkanntem FREMDEN @-Handle OHNE Sende-Verb
    // (dieselbe SEND_TRIGGERS-Liste wie detectCapability). Self-Mention ausgenommen.
    // Kein Re-Routing — reine Prompt-Schicht; bei false bleibt extraSystem undefined.
    let verblessMentionHint: string | undefined;
    if (originalCapability === "respond_to_chat") {
      const mentioned = detectTargetHandle(lastUser);
      const ownHandle = (
        this.deps.persona.handle.startsWith("@")
          ? this.deps.persona.handle
          : `@${this.deps.persona.handle}`
      ).toLowerCase();
      const hasSendVerb = SEND_TRIGGERS.some((t) =>
        lastUser.toLowerCase().includes(t),
      );
      if (mentioned && mentioned !== ownHandle && !hasSendVerb) {
        verblessMentionHint =
          `Hinweis: Der Owner hat ${mentioned} erwähnt, aber ohne Sende-Verb. ` +
          `Es wurde KEINE Nachricht an ${mentioned} gesendet. Behaupte nicht, etwas ` +
          `gesendet oder in eine Queue gelegt zu haben. Falls der Owner tatsächlich eine ` +
          `Nachricht an ${mentioned} schicken möchte, weise ihn freundlich darauf hin, dass ` +
          `er das mit einem klaren Verb tun kann, z.B. „Schreib ${mentioned}: …". Falls es ` +
          `nur eine Erwähnung oder Frage über ${mentioned} war, beantworte sie normal.`;
      }
    }

    try {
      const reply = await this.runModel(
        this.deps.persona,
        llmMessages,
        verblessMentionHint,
        {
          enableMcpTools: true,
          forcedToolChoice: options.forcedToolChoice,
          // Fortsetzen v2: Seed-Block (Ur-Konv-Snapshot) VOR den eigenen
          // Summaries der laufenden Konv — ältester Kontext zuerst, gleiche
          // Prompt-Schicht. Beide null → kein Block. Seed wird IMMER mitgegeben
          // (auch wenn die Fortsetzung schon eigene Summaries hat): er ist der
          // Anker des fortgesetzten Strangs, bounded Text, einfache Regel.
          summaryBlock:
            [buildSeedBlock(seedContext), buildSummaryBlock(summaries)]
              .filter(Boolean)
              .join("\n\n---\n\n") || null,
          factsBlock,
          episodicBlock,
          focusBlock,
          // Token-Streaming für den Web-Chat-Pfad: jeder Token-Chunk geht
          // als twin.token-Event auf den Bus → SSE → Browser. Telegram sieht
          // die Bus-Events nicht (kein SSE in Telegram) — kein Behaviour-Change
          // dort. Der Audit-Write unten bleibt auf dem vollen finalen Text.
          onToken: (chunk: string) =>
            this.deps.bus.emit({ type: "twin.token", payload: { chunk } }),
        },
      );
      // #100: Slim-Projektion der konsultierten Memory-Hits für die UI. Score-
      // Felder bleiben backend-intern; das Frontend bekommt nur targetType,
      // Klartext und Datum. Wird im Audit-Output persistiert, damit
      // buildChatBlocksFromAudits() im Web den Badge auch nach Page-Reload
      // rendern kann (Audit-Stream ist SSoT für die Chat-View).
      const memoryHits: MemoryHit[] = episodicMemories.map((m) => ({
        targetType: m.targetType,
        content: m.content,
        createdAt: m.createdAt,
      }));
      const audit = await this.deps.audit.start({
        capability: "owner-direct",
        mandateId: null,
        input: {
          messages,
          lastMessage: lastUser,
          originalCapability,
          // #130 Phase 3: Channel-Marker für Cross-Channel-UX im Web-UI.
          // Nur gesetzt wenn der Caller ihn explizit liefert (Telegram-
          // MessageRouter); Web-Form-Calls lassen ihn undefined.
          ...(options.channel ? { channel: options.channel } : {}),
        },
        initialStatus: "executed",
        conversationId,
      });
      await this.deps.audit.complete(audit.id, {
        reply: reply.content,
        providerMetadata: reply.metadata,
        ...(memoryHits.length > 0 ? { memoryHits } : {}),
      });
      // #107: First-Use-Hint einmalig flippen, wenn der Pre-Pass-Classifier
      // den Recherche-Skill getriggert hat. Frontend zeigt das Beta-Modal nur
      // bei `firstUseHint='research'` — was nur passiert, wenn der Flag im
      // DB-Profil vorher 0 war. Reads + Update sind sync (better-sqlite3),
      // kein await nötig.
      let firstUseHint: "research" | undefined;
      if (reply.prePassSkillName === "recherche-workflow") {
        const profile = this.profilesRepo.findById(this.deps.twinId);
        if (profile && !profile.researchFirstUseSeen) {
          this.profilesRepo.markResearchFirstUseSeen(this.deps.twinId);
          firstUseHint = "research";
        }
      }
      this.deps.bus.emit({ type: "twin.idle", payload: {} });
      return {
        message: { role: "assistant", content: reply.content },
        auditId: audit.id,
        pending: false,
        ...(memoryHits.length > 0 ? { memoryHits } : {}),
        ...(firstUseHint ? { firstUseHint } : {}),
      };
    } catch (err) {
      // 3.2.F: zwei Wege ende hier in derselben Branch:
      //   1. Marker-Pfad (Standard): runModel detected den Marker im
      //      result.toolCalls, wirft McpToolApprovalRequiredError.
      //   2. Phase 3.4.3.1 Big-Bang: Native-V3-Approval — Caller throw aus
      //      runModel.detectToolApprovalRequest. Pending-Audit-Build via
      //      createPendingAuditFromApprovalRequest. Marker-Pattern-Catch
      //      (Phase 3.2.F) und Codex-Resume-Context-Catch (Phase 3.3.1.3.2)
      //      sind in Sub-Phase F entfernt — es gibt nur noch den V3-Pfad.
      if (err instanceof ApprovalRequestedError) {
        // #131 Phase 3.4.3.1 Big-Bang: native V3-Approval-Catch. Persistiert
        // approvalId + assistantContent für History-Replay-Approve.
        const pending = await this.createPendingAuditFromApprovalRequest(err, {
          llmMessages,
          lastUser,
          conversationId,
          originalCapability,
        });
        this.deps.bus.emit({ type: "twin.idle", payload: {} });
        return {
          message: pending.message,
          auditId: pending.auditId,
          pending: true,
        };
      }
      // Anderer Fehler: Audit als failed loggen (Reihenfolge wie bei Erfolg
      // — wir öffnen erst, dann markieren wir fail).
      const failedAudit = await this.deps.audit.start({
        capability: "owner-direct",
        mandateId: null,
        input: {
          messages,
          lastMessage: lastUser,
          originalCapability,
        },
        initialStatus: "executed",
        conversationId,
      });
      await this.failWithReason(failedAudit.id, err);
      throw err;
    }
  }

  // ─── Reverse-Memory-Query (Lebens-Narrativ Stufe 1) ───────────────────────
  //
  // Reaktive Rückschau: Owner fragt „was hab ich über X gesagt?" (Typ b,
  // Stichwort) / „was hat mich diesen Monat beschäftigt?" (Typ a, Zeitfenster).
  // Erbt das vorhandene Hybrid-Retrieval (breiteres topK), synthetisiert via
  // synthesizeRetrospective. Inline im Chat (Audit-Capability 'owner-direct',
  // originalCapability='reverse_memory_query' im Input für Trace). Bewusst OHNE
  // Live-History/Summary-Maschinerie — die Rückschau steht für sich.

  private async runReverseMemoryQuery(
    messages: ChatMessage[],
    lastUser: string,
    timeframe?: ReverseTimeframe,
  ): Promise<{
    message: ChatMessage;
    auditId: string;
    pending: boolean;
    memoryHits?: MemoryHit[];
  }> {
    // Konversations-Linkage wie im normalen Owner-Pfad (Turn gehört zur Konv).
    let conversationId: string | null = null;
    if (this.deps.ownerUserId) {
      const conv = this.deps.conversations.getOrStart(
        this.deps.ownerUserId,
        this.deps.persona.handle.startsWith("@")
          ? this.deps.persona.handle
          : `@${this.deps.persona.handle}`,
        this.deps.twinId,
      );
      conversationId = conv.id;
    }

    this.deps.bus.emit({
      type: "twin.thinking",
      payload: { capability: "owner-direct" },
    });

    // Typ a: Zeitfenster → since-ISO. Typ b: kein Zeitfilter.
    const since = timeframe
      ? reverseTimeframeToSinceIso(timeframe, new Date())
      : undefined;

    // Breiteres Retrieval als der Chat-Default (REVERSE_QUERY_TOP_K) — eine
    // Rückschau braucht mehr Treffer zum Verdichten. Failure-Pfad gibt [].
    const memories = await this.memoryRetrievalService.retrieve({
      twinId: this.deps.twinId,
      userMessage: lastUser,
      currentConversationId: conversationId,
      topK: REVERSE_QUERY_TOP_K,
      since,
    });

    const { content, metadata } = await this.synthesizeRetrospective(
      lastUser,
      memories,
    );

    const memoryHits: MemoryHit[] = memories.map((m) => ({
      targetType: m.targetType,
      content: m.content,
      createdAt: m.createdAt,
    }));

    const audit = await this.deps.audit.start({
      capability: "owner-direct",
      mandateId: null,
      input: {
        messages,
        lastMessage: lastUser,
        originalCapability: "reverse_memory_query",
        ...(timeframe ? { reverseTimeframe: timeframe } : {}),
      },
      initialStatus: "executed",
      conversationId,
    });
    await this.deps.audit.complete(audit.id, {
      reply: content,
      providerMetadata: metadata,
      ...(memoryHits.length > 0 ? { memoryHits } : {}),
    });
    this.deps.bus.emit({ type: "twin.idle", payload: {} });
    return {
      message: { role: "assistant", content },
      auditId: audit.id,
      pending: false,
      ...(memoryHits.length > 0 ? { memoryHits } : {}),
    };
  }

  /**
   * Synthese-Schicht (Herzstück, wiederverwendbar für Stufe 3 / proaktive
   * Muster-Einsicht): verdichtet die retrievten Memory-Treffer zu einer
   * Rückschau in der Stimme des Twins. Rückblick-orientierter System-Block +
   * die Treffer; Anti-Halluzination ist eingebaut (ehrlich bei dünnem Korpus).
   * KEINE MCP-Tools (rein Memory-gestützt, keine Außen-Calls).
   */
  async synthesizeRetrospective(
    query: string,
    memories: RetrievalResult[],
  ): Promise<{ content: string; metadata: Record<string, unknown> }> {
    const directive = buildRetrospectiveDirective(
      this.deps.persona.name,
      memories,
    );
    const reply = await this.runModel(
      this.deps.persona,
      [{ role: "user", content: query }],
      directive,
      { enableMcpTools: false },
    );
    return { content: reply.content, metadata: reply.metadata };
  }

  // ─── Owner-Direct-Send (User-initiierte A2A) ──────────────────────────────
  //
  // Wird von POST /twins/:handle/conversations/:partnerHandle/send aufgerufen.
  // Owner ist eingeloggt, hat selbst getippt — kein Mandate-Check, kein
  // Approval-Loop. Direkter Bridge-Send mit messageType="owner-direct".
  //
  // Tag-28-Block-16-Refactor: `inReplyTo`-Parameter entfernt. Empfänger-
  // Verhalten wird über `messageType` ausgewertet. Wenn jemand künftig
  // Quote-Reply-Feature baut, kommt `inReplyTo` als separater Parameter
  // mit anderer Semantik zurück.

  async ownerDirectSend(opts: {
    toHandle: string;
    content: string;
  }): Promise<{ messageId: string; auditId: string; sentAt: string }> {
    if (!this.deps.bridgeClient) {
      throw new BridgeDisabledError("owner-direct-send");
    }
    const sentAt = new Date().toISOString();
    const audit = await this.deps.audit.start({
      capability: "owner-direct-send",
      mandateId: null,
      input: {
        toHandle: opts.toHandle,
        content: opts.content,
        sentAt,
      },
      // Konsistent mit trusted-bypass / owner-direct: kein Approval-Workflow,
      // Owner hat selbst getippt — daher "executed" als initial. complete()
      // überschreibt nach erfolgreichem Bridge-Send ohnehin.
      initialStatus: "executed",
    });
    try {
      const sent = await this.deps.bridgeClient.sendMessage({
        to: opts.toHandle,
        content: opts.content,
        messageType: "owner-direct",
      });
      await this.deps.audit.complete(audit.id, {
        sentMessageId: sent.messageId,
        targetHandle: opts.toHandle,
      });
      return { messageId: sent.messageId, auditId: audit.id, sentAt };
    } catch (err) {
      await this.failWithReason(audit.id, err);
      throw err;
    }
  }

  // ─── Bridge-Empfang ────────────────────────────────────────────────────────
  //
  // Wird sowohl vom Inbox-Sync beim Boot als auch live vom SSE-Stream
  // aufgerufen. Drei Pfade:
  //   - Trusted-Twin → direkter LLM-Call + Bridge-Antwort, audit "trusted-bypass"
  //   - External + Mandate-pending → Pending-Audit + System-Wartemeldung an
  //     Bridge-Absender, echte Antwort kommt nach Approval
  //   - External + auto / kein Mandate → wie bisher (bzw. block)
  //
  // Idempotent: gleiche bridgeMessageId → silent return.

  async receiveBridgeMessage(msg: BridgeMessage): Promise<void> {
    if (!this.deps.bridgeClient) {
      // Sollte nie passieren, weil receiveBridgeMessage nur im Bridge-Modus
      // gecallt wird. Defensive Sanity-Check.
      throw new Error("receiveBridgeMessage ohne aktiven BridgeClient aufgerufen");
    }

    const existing = await this.deps.audit.repo.findByInputField(
      "bridgeMessageId",
      msg.id,
      { twinId: this.deps.twinId },
    );
    if (existing) {
      return;
    }

    // 1. messageType-Filter (2.5.4.1.1): System-Nachrichten — also Wartemeldung
    // oder Reject-Hinweis vom Gegenüber — werden NICHT beantwortet. Würden wir
    // antworten, gäbe es einen Pingpong-Loop ("Anfrage zur Freigabe…" ↔
    // "Anfrage zur Freigabe…"). Wir loggen sie nur fürs Audit-Trail und ackn.
    if (msg.messageType === "system") {
      await this.deps.audit.start({
        capability: "system-message-received",
        mandateId: null,
        input: {
          bridgeMessageId: msg.id,
          fromHandle: msg.fromHandle,
          content: msg.content,
          inReplyTo: msg.inReplyTo,
        },
        initialStatus: "executed",
      });
      await this.safeAck(msg.id);
      this.deps.bus.emit({
        type: "bridge.message.received",
        payload: { auditId: msg.id, fromHandle: msg.fromHandle },
      });
      return;
    }

    // 2. Message-Type-Switch (Tag-28-Block-16): Single-Source-of-Truth für
    // Empfänger-Verhalten. Vier Werte:
    //   - "owner-direct"    → Owner schickt via UI → durch zum Trust/Mandate-Pfad (LLM-Reply)
    //   - "twin-initiated"  → Twin schickt autonom → durch zum Trust/Mandate-Pfad (LLM-Reply)
    //   - "twin-reply"      → Antwort auf vorherige eigene Anfrage → reply-received-Audit, kein LLM
    //   - "system"          → schon oben gefiltert
    //
    // Legacy: `"twin"` aus alten Bridge-Rows wird semantisch als
    // `"twin-initiated"` behandelt (durchfallen zum Trust/Mandate-Pfad).
    //
    // Ersetzt die alte `inReplyTo`-Heuristik mit Bridge-`lookupSender`-Lookup
    // (Pre-Block-16-Pfad). Web-UI setzt `inReplyTo` nicht mehr automatisch,
    // damit Owner-Direct-Sends nicht fälschlich als Reply geframed werden.
    const normalizedType =
      msg.messageType === "twin" ? "twin-initiated" : msg.messageType;

    if (normalizedType === "twin-reply") {
      // A2A Glied 2: Thread-Anker aus inReplyTo ableiten (= Root-messageId
      // des Austauschs). Falls inReplyTo null, ist msg selbst die Root.
      const a2aThreadId = msg.inReplyTo ?? msg.id;

      const audit = await this.deps.audit.start({
        capability: "reply-received",
        mandateId: null,
        input: {
          bridgeMessageId: msg.id,
          fromHandle: msg.fromHandle,
          content: msg.content,
          inReplyTo: msg.inReplyTo,
          receivedAt: new Date().toISOString(),
          a2aThreadId,
        },
        initialStatus: "executed",
      });
      await this.safeAck(msg.id);
      this.deps.bus.emit({
        type: "reply-received",
        payload: {
          auditId: audit.id,
          partnerHandle: msg.fromHandle,
          content: msg.content,
        },
      });

      // A2A Glied 2 — Etappe 2: Kontrollierte Folgerunden-Schleife (bis 5/Seite).
      // Voraussetzung: Partner vertraut. Reihenfolge der Kontrollgrenzen (von
      // Markus festgelegt): erst die Bremse (Abbruch), dann das Rundenlimit,
      // dann erst die nächste autonome Folgerunde. Bei Abbruch ODER Limit →
      // harter Stopp + EINMALIGE Owner-Zusammenfassung (kein Send mehr).
      const mayAutoFollow =
        this.deps.trustRepo.canAutoRespond(this.deps.twinId, msg.fromHandle);
      if (mayAutoFollow) {
        if (this.abortedThreadIds.has(a2aThreadId)) {
          // (a) Bremse: Owner hat abgebrochen → kein Send, Zusammenfassung.
          console.log(
            `[a2a:glied2] Thread=${a2aThreadId} abgebrochen — kein weiterer Send`,
          );
          await this.summarizeA2aThreadOnce(a2aThreadId, msg.fromHandle, "abort");
        } else {
          const followUpsDone = await this.countA2aFollowUpRounds(a2aThreadId);
          if (followUpsDone < A2A_MAX_FOLLOWUP_ROUNDS) {
            // (b) Unter Limit → eine weitere autonome Folgerunde.
            console.log(
              `[a2a:glied2] Folgerunde ${followUpsDone + 1}/${A2A_MAX_FOLLOWUP_ROUNDS} ` +
                `für Thread=${a2aThreadId}, partner=${msg.fromHandle}`,
            );
            // handleTrustedBridgeMessage erzeugt trusted-bypass-Audit mit
            // a2aThreadId im input → countA2aFollowUpRounds steigt um 1.
            await this.handleTrustedBridgeMessage(msg);
          } else {
            // (c) Rundenlimit erreicht → harter Stopp + Zusammenfassung.
            console.log(
              `[a2a:glied2] Hard-Stop: Rundenlimit ${A2A_MAX_FOLLOWUP_ROUNDS} erreicht ` +
                `für Thread=${a2aThreadId} — Zusammenfassung an Owner`,
            );
            await this.summarizeA2aThreadOnce(a2aThreadId, msg.fromHandle, "limit");
          }
        }
      }

      return;
    }

    // 3. Phase 4.3 Schritt 5: Autonomie-Weiche jetzt LEVEL-basiert. canAutoRespond
    // = familiarity_level ∈ {vertraut, eng} (AUTO_RESPONABLE_LEVELS). Ersetzt den
    // alten row-basierten isTrusted-Check — konservativ, reproduziert das frühere
    // binäre Verhalten (Bestands-Trusts sind 'vertraut' → autonom; keine Row →
    // 'fremd' → pending). 'bekannt' (Row da, aber unter der Schwelle) fällt in den
    // ELSE-Zweig (checkMandate → pending) = graded Mitte. handleTrustedBridgeMessage
    // heißt intern weiter so (kein Verhaltens-Change durch den Namen).
    const mayAuto = this.deps.trustRepo.canAutoRespond(this.deps.twinId, msg.fromHandle);
    if (mayAuto) {
      await this.handleTrustedBridgeMessage(msg);
      return;
    }

    // 2. External: Mandate-Check wie bisher.
    const check = checkMandate(this.deps.mandates, "respond_to_twin_message");
    if (!check.allowed) {
      // Auch ohne Mandate erfassen wir die Nachricht — als blocked. So sieht
      // der User im Audit-Log, dass jemand geschrieben hat, kann aber nicht
      // antworten ohne erst das Mandate zu setzen.
      await this.deps.audit.block({
        capability: "respond_to_twin_message",
        input: {
          bridgeMessageId: msg.id,
          fromHandle: msg.fromHandle,
          content: msg.content,
          inReplyTo: msg.inReplyTo,
        },
        reason: check.reason ?? "Kein Mandate für respond_to_twin_message",
      });
      // Trotzdem ackn — sonst spammt die Bridge uns endlos die gleiche Message.
      await this.safeAck(msg.id);
      return;
    }

    const audit = await this.deps.audit.start({
      capability: "respond_to_twin_message",
      mandateId: check.mandate?.id ?? null,
      input: {
        bridgeMessageId: msg.id,
        fromHandle: msg.fromHandle,
        content: msg.content,
        inReplyTo: msg.inReplyTo,
      },
      initialStatus: "pending",
    });

    await this.safeAck(msg.id);

    this.deps.bus.emit({
      type: "bridge.message.received",
      payload: { auditId: audit.id, fromHandle: msg.fromHandle },
    });

    // 3. Wartemeldung an Absender — transparent, dass eine Approval läuft.
    // Kein Throw bei Bridge-Fehler — Pending-Audit bleibt valide, Owner kann
    // weiterhin approven; die Wartemeldung ist Komfort, nicht Pflicht.
    await this.sendSystemMessage({
      toHandle: msg.fromHandle,
      inReplyTo: msg.id,
      reasonCode: "pending-wait",
      content: this.composeWaitMessage(),
      relatedAuditId: audit.id,
    });
  }

  // ─── Pending-Audit-Helper (Phase 3.4.3.1 Big-Bang) ──────────────────────
  //
  // Native-V3-Helper `createPendingAuditFromApprovalRequest` ist unten.
  // Legacy-Helper `buildPendingMcpAuditFromError` (Phase 3.3.1.3.2) wurde
  // mit Marker-Pattern + Codex-Resume-Context-Pfaden gemeinsam entfernt.
  // Es gibt nur noch einen Pending-Audit-Build-Pfad (Native-V3) — kein
  // capability-/auth-mode-Branching mehr.
  /**
   * #131 Phase 3.4.3.1 Big-Bang: Pending-Audit-Build aus `ApprovalRequestedError`
   * (native V3-Pattern). Symmetrie zu `buildPendingMcpAuditFromError`, aber
   * Resume-Format ist anders:
   * - Persistiert `approvalId` + `assistantContent` für History-Replay
   *   (statt `mcpServerId`/`mcpToolName`/`args` flat)
   * - Resume-Approve appendet `assistantContent` als assistant-Message +
   *   tool-Role-Message mit `tool-approval-response{approved}` ans Prompt
   *   und ruft `generateText` — SDK ruft `execute()` automatisch
   *
   * `priorAuditId` ist Re-Pause-Link (analog Phase-3.3.1.3.2-Pattern).
   * `toolCall.{mcpServerId, mcpToolName, args}` weggelassen — Resume nutzt
   *   nur den V3-`toolCallId`/`approvalId`-Match. Frontend kann
   *   `toolName` (skill-name) + `toolInput` für UI-Display nutzen.
   */
  private async createPendingAuditFromApprovalRequest(
    err: ApprovalRequestedError,
    context: {
      llmMessages: ChatMessage[];
      lastUser: string;
      conversationId: string | null;
      originalCapability: string;
      priorAuditId?: string;
    },
  ): Promise<{
    auditId: string;
    pendingReply: string;
    message: ChatMessage;
  }> {
    const pendingReply = composeToolApprovalRequest(
      err.toolName,
      (err.toolInput ?? {}) as Record<string, unknown>,
    );
    const pendingAudit = await this.deps.audit.start({
      capability: "mcp-tool-use",
      mandateId: null,
      input: {
        messages: context.llmMessages,
        lastMessage: context.lastUser,
        // V3-Display-Surface (toolName ist Tool-Key wie
        // `mcp_everything-approval_get-sum`):
        toolName: err.toolName,
        toolInput: err.toolInput,
        // V3-Approval-Daten für History-Replay:
        approvalId: err.approvalId,
        toolCallId: err.toolCallId,
        assistantContent: err.assistantContent,
        conversationId: context.conversationId,
        pendingReply,
        originalCapability: context.originalCapability,
        ...(context.priorAuditId
          ? { priorAuditId: context.priorAuditId }
          : {}),
      },
      initialStatus: "pending",
      conversationId: context.conversationId,
    });
    return {
      auditId: pendingAudit.id,
      pendingReply,
      message: { role: "assistant", content: pendingReply },
    };
  }

  // ─── Approve & Reject ──────────────────────────────────────────────────────
  //
  // Werden vom Server-Layer aufgerufen, wenn der Mensch in Settings auf
  // Approve oder Reject klickt. Verhalten je nach Capability unterschiedlich:
  //   - respond_to_twin_message → Modell antwortet, Reply geht über Bridge;
  //     bei Reject: System-Antwort "nicht freigegeben" über die Bridge
  //   - send_to_twin            → Modell formuliert, Nachricht geht über Bridge
  //   - sonst (z.B. draft_…)    → Modell antwortet, Reply landet im Audit

  async approvePending(auditId: string): Promise<ApproveResult> {
    const entry = await this.deps.audit.repo.get(auditId);
    if (!entry) throw new Error(`Audit ${auditId} not found`);
    if (entry.status !== "pending") {
      throw new Error(`Audit ${auditId} is not pending (status: ${entry.status})`);
    }

    const persona = this.deps.persona;

    switch (entry.capability) {
      case "respond_to_twin_message":
        return this.approveTwinResponse(entry, persona);
      case "send_to_twin":
        return this.approveTwinSend(entry, persona);
      case "mcp-tool-use":
        return this.approveMcpToolUse(entry, persona);
      case "semantic-fact-write":
        return this.approveSemanticFactWrite(entry);
      case FACT_COHERENCE_FIX_CAPABILITY:
        return this.approveFactCoherenceFix(entry);
      case REFLECTION_CAPABILITY:
        return this.approveSelfReflectionWrite(entry);
      case SOCIAL_SUGGESTION_CAPABILITY:
        return this.approveSocialSuggestion(entry);
      case PROACTIVE_NUDGE_CAPABILITY:
        return this.approveProactiveNudge(entry);
      default:
        return this.approveDefault(entry, persona);
    }
  }

  async rejectPending(auditId: string, reason: string): Promise<void> {
    const entry = await this.deps.audit.repo.get(auditId);
    if (!entry) throw new Error(`Audit ${auditId} not found`);
    if (entry.status !== "pending") {
      throw new Error(`Audit ${auditId} is not pending (status: ${entry.status})`);
    }
    await this.deps.audit.reject(auditId, reason);

    // Bei eingehenden A2A-Anfragen: System-Antwort an den Absender, damit der
    // andere Twin nicht im Dunkeln bleibt. Send_to_twin-Rejects bleiben
    // weiterhin still — da war noch keine Bridge-Nachricht raus.
    if (entry.capability === "respond_to_twin_message") {
      const input = entry.input as { fromHandle?: string; bridgeMessageId?: string };
      if (input.fromHandle && this.deps.bridgeClient) {
        await this.sendSystemMessage({
          toHandle: input.fromHandle,
          inReplyTo: input.bridgeMessageId ?? null,
          reasonCode: "rejected",
          content: this.composeRejectMessage(),
          relatedAuditId: auditId,
        });
      }
      return;
    }

    // 3.3.F: Reject eines semantic-fact-write Pending → confidence='rejected'
    // im Facts-Repo. Audit-Status ist bereits durch `audit.reject` oben auf
    // 'rejected' gesetzt; wir markieren nur noch den Fact-Eintrag.
    if (entry.capability === "semantic-fact-write") {
      const input = entry.input as { factKey?: string };
      if (input.factKey) {
        this.deps.facts.setConfidence(
          this.deps.twinId,
          input.factKey,
          "rejected",
        );
      }
      return;
    }

    // Facts-Kohärenz-Review SS1: Reject = verwerfen. Der Audit ist bereits
    // 'rejected' (audit.reject oben). Der bestehende Fact bleibt UNBERÜHRT —
    // KEIN Write, KEIN Delete (anders als semantic-fact-write gibt es keine
    // pre-write-Row, die zurückzudrehen wäre). Das rejected-Audit dient SS3
    // als Rejected-Gedächtnis-Marker (denselben Fix nicht erneut vorschlagen).
    if (entry.capability === FACT_COHERENCE_FIX_CAPABILITY) {
      return;
    }

    // Selbst-Reflexion (über Markus): Reject = verwerfen. Der Pending-Audit ist
    // bereits auf 'rejected' (audit.reject oben). KEIN Diary-Write, kein Rest-
    // Effekt — nichts bleibt. Explizit früh raus, damit kein Fall-Through.
    if (entry.capability === REFLECTION_CAPABILITY) {
      return;
    }

    // Sozialer Vorschlag (Stufe 1): Reject = verwerfen. Audit ist rejected, KEIN
    // Send, kein Rest-Effekt — nichts bleibt (subject-unabhängig, wie Reflexion).
    if (entry.capability === SOCIAL_SUGGESTION_CAPABILITY) {
      return;
    }

    // 3.2.F: Reject eines mcp-tool-use Pending → kein Tool-Aufruf, statt-
    // dessen Resume des LLM mit "Tool-Call wurde abgelehnt" als Kontext.
    // Die finale Antwort landet im output.reply, damit die Inbox sie zeigen
    // kann (gleicher Pfad wie executed-Audits mit reply).
    if (entry.capability === "mcp-tool-use") {
      const input = entry.input as AuditMcpToolUseInputShape;
      // #131 Phase 3.4.3.1 Big-Bang: einziger Reject-Pfad ist Native-V3 via
      // History-Replay. Legacy-Pfade (Marker + Codex-Resume-Context) sind in
      // Sub-Phase F entfernt — Pending-Audits in DB sind alle approvalId-
      // basiert (Closed-Beta-Migration-Strategy: keine Pre-3.4.3.1-Audits
      // erwartet).
      if (input.approvalId && input.assistantContent) {
        await this.rejectMcpToolUseViaHistoryReplay(entry, reason);
      }
    }
  }

  /**
   * #131 Phase 3.4.3.1 Big-Bang: Native-V3-Reject via History-Replay.
   * Vereinheitlicht api_key + oauth Pfade. SDK ruft execute() NICHT auf
   * weil approved=false — Codex bekommt reason als Kontext und antwortet
   * ohne Tool (Spike §r Test 3 verifiziert).
   *
   * Status bleibt `rejected` (audit.reject() lief vor dem Branch), Output
   * wird via audit.repo.update appended (matched existing Reject-Pattern).
   */
  private async rejectMcpToolUseViaHistoryReplay(
    entry: AuditEntry,
    reason: string,
  ): Promise<void> {
    const input = entry.input as AuditMcpToolUseInputShape;
    if (!input.approvalId || !input.assistantContent) return;

    const baseMessages = input.messages ?? [];
    const resumeMessages: ChatMessage[] = [
      ...baseMessages,
      {
        role: "assistant",
        // #131 Phase 3.4.3.1 Sub-Phase G Fix: V3-Provider-Output → V4-
        // ModelMessage-Format (input string→Object, providerMetadata weg).
        content: mapAssistantContentForModelMessage(input.assistantContent),
      } as unknown as ChatMessage,
      {
        role: "tool",
        content: [
          {
            type: "tool-approval-response",
            approvalId: input.approvalId,
            approved: false,
            reason,
          },
        ],
      } as unknown as ChatMessage,
    ];

    try {
      // enableMcpTools: true — Tools im SDK-Pipeline für approvalId-Lookup
      // (SDK validiert approval-response gegen Tool-Set). Bei Reject ruft
      // SDK execute() nicht (approved=false), Codex antwortet ohne Tool.
      const reply = await this.runModel(
        this.deps.persona,
        resumeMessages,
        undefined,
        { enableMcpTools: true },
      );
      const updatedEntry = await this.deps.audit.repo.get(entry.id);
      if (updatedEntry) {
        updatedEntry.output = {
          reply: reply.content,
          rejected: true,
          rejectReason: reason,
          providerMetadata: reply.metadata,
        };
        await this.deps.audit.repo.update(entry.id, updatedEntry);
        this.deps.bus.emit({ type: "audit.updated", payload: updatedEntry });
      }
    } catch (err) {
      if (err instanceof ApprovalRequestedError) {
        // Re-Approval nach Reject — Codex hat trotz Rejection neues Tool
        // gerufen. Original-Audit kriegt followUpPending-Marker, neuer
        // Pending mit priorAuditId-Link.
        const updatedEntry = await this.deps.audit.repo.get(entry.id);
        if (updatedEntry) {
          updatedEntry.output = {
            reply: "",
            rejected: true,
            rejectReason: reason,
            followUpPending: true,
          };
          await this.deps.audit.repo.update(entry.id, updatedEntry);
          this.deps.bus.emit({ type: "audit.updated", payload: updatedEntry });
        }
        await this.createPendingAuditFromApprovalRequest(err, {
          llmMessages: baseMessages,
          lastUser: input.lastMessage ?? "",
          conversationId: input.conversationId ?? null,
          originalCapability:
            input.originalCapability ?? "respond_to_chat",
          priorAuditId: entry.id,
        });
        return;
      }
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(
        `[mcp-tool-use:reject-v3] Resume-LLM-Call fehlgeschlagen: ${msg}`,
      );
    }
  }

  // ─── Approve-Branches ──────────────────────────────────────────────────────

  /**
   * 3.2.F: Approve eines mcp-tool-use Pending. Drei Schritte:
   *
   *   1. Tool-Call ausführen (mcpManager.callTool — kein Approval-Recheck,
   *      weil der User bereits durch das Approve genehmigt hat).
   *   2. Resume-Run: LLM-Call mit der Original-History plus dem Tool-Result
   *      als zusätzliche User-Kontext-Message. Tools sind im Resume
   *      explizit DEAKTIVIERT — sonst könnte LLM den Tool-Call retriggern
   *      und in eine Approval-Schleife laufen. Multi-Tool-Use kommt mit
   *      späteren Sub-Schritten.
   *   3. Audit auf executed mit toolCall+Result+finaler Antwort.
   */
  private async approveMcpToolUse(
    entry: AuditEntry,
    persona: Persona,
  ): Promise<ApproveResult> {
    const input = entry.input as AuditMcpToolUseInputShape;
    // #131 Phase 3.4.3.1 Big-Bang: einziger Approve-Pfad ist Native-V3 via
    // History-Replay. Legacy-Pfade (Marker, Codex-Resume-Context) sind in
    // Sub-Phase F entfernt.
    if (!input.approvalId || !input.assistantContent) {
      throw new Error(
        `Audit ${entry.id} hat keine V3-Approval-Felder (approvalId + assistantContent) — kann nicht approved werden`,
      );
    }
    return this.approveMcpToolUseViaHistoryReplay(entry, persona);
  }

  /**
   * #131 Phase 3.4.3.1 Big-Bang: Native-V3-Approve via History-Replay.
   * Vereinheitlicht api_key + oauth Pfade — Vercel-SDK kümmert sich um
   * execute() + tool-result + Multi-Step automatisch nach approval.
   *
   * Resume-Pattern (aus §r Spike Test 2 verifiziert):
   *   messages: [
   *     ...stored-history,
   *     { role: "assistant", content: <stored-assistantContent> },
   *     { role: "tool", content: [{type:"tool-approval-response",
   *                                approvalId, approved:true}] },
   *   ]
   *
   * Re-Approval-Check: wenn die Resume-Iteration erneut ein needsApproval-
   * Tool triggert, wirft runModel `ApprovalRequestedError` — Catch hier
   * baut neuen Pending-Audit mit `priorAuditId`-Link.
   */
  private async approveMcpToolUseViaHistoryReplay(
    entry: AuditEntry,
    persona: Persona,
  ): Promise<ApproveResult> {
    const input = entry.input as AuditMcpToolUseInputShape;
    if (!input.approvalId || !input.assistantContent) {
      throw new Error(
        `Audit ${entry.id} hat keinen approvalId/assistantContent — V3-Resume nicht möglich`,
      );
    }
    const baseMessages = input.messages ?? [];
    const resumeMessages: ChatMessage[] = [
      ...baseMessages,
      // Bewusster Cast über `unknown`: ChatMessage ist Twin-Lab-intern (role
      // + content-string), aber Vercel-SDK akzeptiert die V3-Message-Form
      // mit content-Array (tool-call + tool-approval-request). runModel
      // reicht messages an toModelMessages weiter — das pass-throughed
      // bekannte Vercel-Shapes.
      {
        role: "assistant",
        // #131 Phase 3.4.3.1 Sub-Phase G Fix: V3-Provider-Output → V4-
        // ModelMessage-Format (input string→Object, providerMetadata weg).
        content: mapAssistantContentForModelMessage(input.assistantContent),
      } as unknown as ChatMessage,
      {
        role: "tool",
        content: [
          {
            type: "tool-approval-response",
            approvalId: input.approvalId,
            approved: true,
          },
        ],
      } as unknown as ChatMessage,
    ];

    this.deps.bus.emit({
      type: "twin.thinking",
      payload: { capability: "mcp-tool-use" },
    });

    let reply: { content: string; metadata: Record<string, unknown> };
    try {
      // enableMcpTools: true — History-Replay braucht aktive Tools, damit
      // SDK execute() für den approved Tool-Call findet. Re-Approval-Chain
      // läuft über Pre-Generate-Skill-Set-Lookup analog Initial-Run.
      reply = await this.runModel(persona, resumeMessages, undefined, {
        enableMcpTools: true,
      });
    } catch (err) {
      // Re-Approval: Resume-Iteration hat erneut needsApproval-Tool
      // getriggert. Original-Audit auf executed mit followUpPending-Marker,
      // neuer Pending-Audit mit priorAuditId-Link via History-Replay-Helper.
      if (err instanceof ApprovalRequestedError) {
        await this.deps.audit.complete(entry.id, {
          reply: "",
          approvalId: input.approvalId,
          toolCallId: input.toolCallId,
          toolName: input.toolName,
          followUpPending: true,
          providerMetadata: { approvedAndChainedTo: "see-next-pending" },
        });
        const pending = await this.createPendingAuditFromApprovalRequest(err, {
          llmMessages: input.messages ?? [],
          lastUser: input.lastMessage ?? "",
          conversationId: input.conversationId ?? null,
          originalCapability:
            input.originalCapability ?? "respond_to_chat",
          priorAuditId: entry.id,
        });
        this.deps.bus.emit({ type: "twin.idle", payload: {} });
        return {
          auditId: pending.auditId,
          message: pending.message,
          reply: pending.pendingReply,
          pending: true,
        };
      }
      await this.failWithReason(entry.id, err);
      throw err;
    }

    await this.deps.audit.complete(entry.id, {
      reply: reply.content,
      approvalId: input.approvalId,
      toolCallId: input.toolCallId,
      toolName: input.toolName,
      toolInput: input.toolInput,
      providerMetadata: reply.metadata,
    });
    this.deps.bus.emit({ type: "twin.idle", payload: {} });
    return {
      auditId: entry.id,
      message: { role: "assistant", content: reply.content },
      reply: reply.content,
    };
  }


  /**
   * 3.3.F: Approve eines `semantic-fact-write`-Pending. Twin hatte den Fact
   * als `confidence='pending'` mit `source='twin'` vorgeschlagen; der User
   * bestätigt → confidence wechselt auf `approved`, der Audit wird auf
   * `executed` gestellt. Der Fact-Wert bleibt unverändert — `source='twin'`
   * markiert weiterhin die Twin-Herkunft.
   *
   * Edge-Case: wenn der Fact zwischen dem Pending-Insert und dem Approve via
   * `twin:facts-remove` gelöscht wurde, ist `setConfidence` ein No-op
   * (returnt false). Wir loggen das, completion läuft trotzdem — der User
   * hat dem nicht-mehr-existierenden Fact zugestimmt, kein Schaden.
   */
  private async approveSemanticFactWrite(
    entry: AuditEntry,
  ): Promise<ApproveResult> {
    const input = entry.input as {
      factKey?: string;
      factValue?: string;
      factId?: string;
      reasoning?: string;
    };
    if (!input.factKey) {
      throw new Error(
        `Audit ${entry.id} hat keinen factKey im Input — semantic-fact-write nicht approvable`,
      );
    }

    const updated = this.deps.facts.setConfidence(
      this.deps.twinId,
      input.factKey,
      "approved",
    );
    if (!updated) {
      console.warn(
        `[facts] approve: fact '${input.factKey}' nicht mehr in der DB — Audit wird trotzdem completed`,
      );
    }

    await this.deps.audit.complete(entry.id, {
      factKey: input.factKey,
      factValue: input.factValue ?? null,
      factId: input.factId ?? null,
      reasoning: input.reasoning ?? null,
    });
    return {
      auditId: entry.id,
    };
  }

  /**
   * Facts-Kohärenz-Review SS1: Approve eines `fact-coherence-fix`-Pending —
   * die „apply-on-approve"-Mechanik. ANDERS als semantic-fact-write (das nur
   * eine vor-geschriebene Row auf 'approved' flippt): hier wurde der bestehende
   * Fact bis JETZT NICHT angefasst, und ERST dieser Approve führt die im Proposal
   * vorgeschlagene Aktion aus:
   *   - 'update' → facts.upsert(newValue, source='twin', confidence='approved')
   *     (überschreibt den Wert; facts.delete/upsert erfassen den Drift in der
   *     facts_history als value_change).
   *   - 'delete' → facts.delete (Fact weg; facts_history erfasst den delete).
   * Bei Reject (rejectPending) bleibt der Fact unberührt.
   *
   * 🔴 Robustheit (B4): Ein Proposal kann zwischen Erzeugung und Approve veralten
   * (Markus hat den Key inzwischen anders geändert/gelöscht). Verhalten:
   *   - 'update' auf einen NICHT mehr existierenden Key → wird NICHT neu angelegt
   *     (eine bewusste Löschung soll nicht aus einem stale Proposal wiederaufleben);
   *     der Approve completed mit applied=false + Hinweis.
   *   - 'delete' auf einen schon abwesenden Key → No-op (facts.delete liefert
   *     false); das Ziel (Fact abwesend) ist ohnehin erreicht.
   * In keinem Fall ein Crash — definierter Ausgang, Audit wird completed.
   */
  private async approveFactCoherenceFix(
    entry: AuditEntry,
  ): Promise<ApproveResult> {
    const input = entry.input as {
      factKey?: string;
      proposedAction?: "update" | "delete";
      newValue?: string;
      reasoning?: string;
    };
    const factKey = input.factKey;
    const action = input.proposedAction;
    if (!factKey || (action !== "update" && action !== "delete")) {
      throw new Error(
        `Audit ${entry.id} hat kein gültiges fact-coherence-fix-Proposal (factKey/proposedAction) — nicht approvable`,
      );
    }

    let applied = false;
    let note: string | null = null;

    if (action === "update") {
      const newValue = input.newValue?.trim();
      if (!newValue) {
        throw new Error(
          `Audit ${entry.id}: proposedAction='update' ohne newValue — nicht approvable`,
        );
      }
      // Nur ändern, wenn der Key noch existiert — kein Re-Create aus stale Proposal.
      const existing = this.deps.facts.get(this.deps.twinId, factKey);
      if (!existing) {
        note = "fact-not-found — Key zwischenzeitlich entfernt, kein Re-Create aus stale Proposal";
        console.warn(`[fact-coherence] approve update '${factKey}' für twin=${this.deps.twinId}: ${note}`);
      } else {
        this.deps.facts.upsert({
          twinId: this.deps.twinId,
          factKey,
          factValue: newValue,
          source: "twin",
          confidence: "approved",
        });
        applied = true;
      }
    } else {
      // delete: No-op auf nicht-existentem Key (returnt false) — Ziel erreicht.
      const removed = this.deps.facts.delete(this.deps.twinId, factKey);
      applied = removed;
      if (!removed) {
        note = "already-gone — Fact existierte beim Approve nicht mehr (No-op)";
        console.warn(`[fact-coherence] approve delete '${factKey}' für twin=${this.deps.twinId}: ${note}`);
      }
    }

    await this.deps.audit.complete(entry.id, {
      factKey,
      proposedAction: action,
      newValue: input.newValue ?? null,
      reasoning: input.reasoning ?? null,
      applied,
      note,
    });
    return { auditId: entry.id };
  }

  /**
   * Selbst-Reflexion Stufe 1: Approve eines `self-reflection-write`-Pending.
   * ERST hier wird der Reflexions-Text wirksam — als Diary-Eintrag. Das ist die
   * Leitplanke: der Generator hat NUR den Pending-Audit erzeugt; ohne diesen
   * Approve gibt es keinen Diary-/State-Write. `triggeredBy: 'post_extract'`
   * (vorhandener Enum-Wert) — ein dedizierter 'reflection'-Wert wäre eine
   * Schema/Enum-Änderung und ist bewusst NICHT Teil dieses Schritts (🟡).
   */
  private async approveSelfReflectionWrite(
    entry: AuditEntry,
  ): Promise<ApproveResult> {
    const input = entry.input as {
      subject?: "owner" | "self";
      reflectionText?: string;
      reasoning?: string;
    };
    const text = input.reflectionText?.trim();
    if (!text) {
      throw new Error(
        `Audit ${entry.id} hat keinen reflectionText im Input — self-reflection-write nicht approvable`,
      );
    }
    // Subtyp: Schritt-1-Einträge tragen kein subject → defensiv 'owner'.
    const subject = input.subject ?? "owner";

    // EINZIGER Wirksam-Werden-Pfad (beide Subjekte gleich): Diary-Eintrag. Insert
    // ist atomar VOR dem Embedding (twin-diary-service); Embedding-Fehler werden
    // geschluckt. Content verbatim — der 'Mir fällt auf …'-Ton macht den
    // Reflexions-Charakter selbst erkennbar (keine Überarchitektur).
    await this.deps.twinDiaryService.addEntry({
      twinId: this.deps.twinId,
      content: text,
      triggeredBy: "post_extract",
    });

    await this.deps.audit.complete(entry.id, {
      subject,
      reflectionText: text,
      reasoning: input.reasoning ?? null,
    });
    return { auditId: entry.id };
  }

  /**
   * Soziale Proaktivität Stufe 1: Approve eines `social-suggestion`-Pending.
   * KONSERVATIV / NO-OP: setzt den Audit nur auf `executed` — KEIN Send an den
   * Partner, KEINE A2A-Message, KEIN Diary-Effekt Richtung Partner. Das ist die
   * Stufe-1/2-Grenze: „Twin schlägt vor, Markus entscheidet" — der MENSCH meldet
   * sich, nicht der Twin. Ein autonomer Send hier wäre Stufe 2.
   */
  private async approveSocialSuggestion(
    entry: AuditEntry,
  ): Promise<ApproveResult> {
    const input = entry.input as { partnerHandle?: string };
    await this.deps.audit.complete(entry.id, {
      partnerHandle: input.partnerHandle ?? null,
      acknowledged: true,
    });
    return { auditId: entry.id };
  }

  /**
   * Proaktiver Fokus-Nudge Stufe 1: Approve eines `proactive-nudge`-Pending.
   * KONSERVATIV / ACKNOWLEDGE: setzt den Audit nur auf `executed` — KEIN Send an
   * den Owner (kein Telegram), KEIN Effekt nach außen. Die Stufe-1-Wirkung IST,
   * dass der Owner den Anstoß in der Inbox gelesen hat. Der echte Versand
   * (sendToOwner via Telegram) ist die spätere Freischaltung und käme GENAU hier
   * rein — jetzt bewusst nicht. Reject = verwerfen (rejectPending, kein Sonderfall).
   */
  private async approveProactiveNudge(
    entry: AuditEntry,
  ): Promise<ApproveResult> {
    const input = entry.input as { thema?: string };
    await this.deps.audit.complete(entry.id, {
      thema: input.thema ?? null,
      acknowledged: true,
    });
    return { auditId: entry.id };
  }

  private async approveDefault(entry: AuditEntry, persona: Persona): Promise<ApproveResult> {
    const messages = extractMessages(entry, "messages");
    this.deps.bus.emit({ type: "twin.thinking", payload: { capability: entry.capability } });
    try {
      // #3: maxLength-Enforcement — Mandate aus der Capability ableiten (z.B.
      // draft_linkedin_post 2000). Ohne maxLength → no-op.
      const mandate =
        this.deps.mandates.find((m) => m.capability === entry.capability) ??
        null;
      const reply = await this.enforceMaxLength(mandate, (hint) =>
        this.runModel(persona, messages, hint ?? undefined),
      );
      await this.deps.audit.complete(entry.id, {
        reply: reply.content,
        providerMetadata: reply.metadata,
        ...(reply.lengthEnforced
          ? { lengthEnforced: reply.lengthEnforced }
          : {}),
      });
      this.deps.bus.emit({ type: "twin.idle", payload: {} });
      return {
        auditId: entry.id,
        message: { role: "assistant", content: reply.content },
        reply: reply.content,
      };
    } catch (err) {
      await this.failWithReason(entry.id, err);
      throw err;
    }
  }

  private async approveTwinSend(entry: AuditEntry, persona: Persona): Promise<ApproveResult> {
    if (!this.deps.bridgeClient) {
      throw new BridgeDisabledError("send_to_twin");
    }
    const targetHandle = (entry.input as { targetHandle?: string }).targetHandle;
    if (!targetHandle) {
      throw new Error(`Audit ${entry.id} hat keinen targetHandle`);
    }
    const messages = extractMessages(entry, "messages");

    // Phase 4.3 Schritt 2: Vertrautheits-Ton auch für AUSGEHENDE Sends — sonst
    // klänge der Twin beim Antworten vertraut, beim Selbst-Schreiben neutral.
    // Hier kein bridgeContextHint (das ist Antwort-Kontext „du führst eine
    // Konversation MIT"); für ausgehend reicht der reine Ton-Block als
    // extraSystem. NUR Stil — keine Dispatch-/Autonomie-Wirkung.
    const famLevel = this.deps.trustRepo.getFamiliarity(this.deps.twinId, targetHandle);
    const famBlock = buildFamiliarityBlock(famLevel, targetHandle);

    this.deps.bus.emit({ type: "twin.thinking", payload: { capability: entry.capability } });
    try {
      const reply = await this.runModel(persona, messages, famBlock ?? undefined);
      const sent = await this.deps.bridgeClient.sendMessage({
        to: targetHandle,
        content: reply.content,
        // Twin schickt aktiv eine Anfrage an einen anderen Twin
        // (z.B. send_to_twin-Mandate, skill-triggered). Empfänger antwortet
        // via LLM. Cross-Ref Tag-28-Block-16.
        messageType: "twin-initiated",
      });
      // A2A Glied 2: die sentMessageId des ersten Sends ist der Thread-Anker.
      // Alle Folgenachrichten dieser Verhandlungssitzung tragen dieselbe
      // a2aThreadId im Audit-input/-output und im Bridge-inReplyTo-Feld.
      const a2aThreadId = sent.messageId;
      await this.deps.audit.complete(entry.id, {
        reply: reply.content,
        sentMessageId: sent.messageId,
        targetHandle,
        providerMetadata: reply.metadata,
        a2aThreadId,
      });
      this.deps.bus.emit({ type: "twin.idle", payload: {} });
      return {
        auditId: entry.id,
        reply: reply.content,
        sentMessageId: sent.messageId,
        targetHandle,
      };
    } catch (err) {
      await this.failWithReason(entry.id, err);
      throw err;
    }
  }

  private async approveTwinResponse(
    entry: AuditEntry,
    persona: Persona,
  ): Promise<ApproveResult> {
    if (!this.deps.bridgeClient) {
      throw new BridgeDisabledError("respond_to_twin_message");
    }
    const input = entry.input as {
      bridgeMessageId?: string;
      fromHandle?: string;
      content?: string;
    };
    if (!input.fromHandle || !input.content || !input.bridgeMessageId) {
      throw new Error(`Audit ${entry.id} hat unvollständigen Bridge-Input`);
    }

    // Konversations-Thread aus dem Audit-Log rekonstruieren — frühere
    // gesendete und beantwortete Nachrichten zwischen uns und fromHandle, plus
    // die aktuelle eingehende Nachricht ans Ende. Ohne diesen Kontext sieht
    // das Modell nur die aktuelle Message und antwortet kontextlos.
    const thread = await this.buildBridgeThread(entry, input.fromHandle);

    const contextHint = this.bridgeContextHint(input.fromHandle);

    this.deps.bus.emit({ type: "twin.thinking", payload: { capability: entry.capability } });
    try {
      const reply = await this.runModel(persona, thread, contextHint);
      const sent = await this.deps.bridgeClient.sendMessage({
        to: input.fromHandle,
        content: reply.content,
        // Wir antworten auf eine eingehende Twin-Message (approveTwinResponse-
        // Pfad nach Approval). Empfänger schreibt reply-received-Audit ohne
        // LLM-Reply. Cross-Ref Tag-28-Block-16.
        messageType: "twin-reply",
      });
      await this.deps.audit.complete(entry.id, {
        reply: reply.content,
        sentMessageId: sent.messageId,
        targetHandle: input.fromHandle,
        providerMetadata: reply.metadata,
      });
      this.deps.bus.emit({ type: "twin.idle", payload: {} });
      return {
        auditId: entry.id,
        reply: reply.content,
        sentMessageId: sent.messageId,
        targetHandle: input.fromHandle,
      };
    } catch (err) {
      await this.failWithReason(entry.id, err);
      throw err;
    }
  }

  // ─── Trusted-Bypass ────────────────────────────────────────────────────────
  //
  // Trusted-Twin hat eine Bridge-Nachricht geschickt: keine Pending-Phase,
  // kein Mandate-Check. Wir bauen den Konversations-Thread wie im normalen
  // Approve-Pfad, generieren die Antwort und schicken sie sofort zurück.
  // Audit-Capability "trusted-bypass", damit sichtbar bleibt, dass die
  // Antwort ohne Approval rausging.

  private async handleTrustedBridgeMessage(msg: BridgeMessage): Promise<void> {
    if (!this.deps.bridgeClient) {
      throw new Error("handleTrustedBridgeMessage ohne aktiven BridgeClient");
    }

    // A2A Glied 2: Thread-Anker ableiten. Wenn msg.inReplyTo gesetzt ist,
    // ist die Root-Nachricht bekannt; sonst ist msg selbst die Root.
    const a2aThreadId = msg.inReplyTo ?? msg.id;

    const audit = await this.deps.audit.start({
      capability: "trusted-bypass",
      mandateId: null,
      input: {
        bridgeMessageId: msg.id,
        fromHandle: msg.fromHandle,
        content: msg.content,
        inReplyTo: msg.inReplyTo,
        // Trace, welche Capability der External-Pfad gewählt hätte.
        originalCapability: "respond_to_twin_message",
        // Thread-Anker für Rundenzählung (Glied 2).
        a2aThreadId,
      },
      // Konsistent mit owner-direct-send / system-message: kein Approval-
      // Workflow, der Bypass ist direkt — daher "executed" als initial. Nach
      // erfolgreichem Modell-Call überschreibt complete() ohnehin auf "executed".
      initialStatus: "executed",
    });

    await this.safeAck(msg.id);
    this.deps.bus.emit({
      type: "bridge.message.received",
      payload: { auditId: audit.id, fromHandle: msg.fromHandle },
    });

    const thread = await this.buildBridgeThread(audit, msg.fromHandle);
    const contextHint = this.bridgeContextHint(msg.fromHandle);

    this.deps.bus.emit({
      type: "twin.thinking",
      payload: { capability: "trusted-bypass" },
    });
    try {
      const reply = await this.runModel(this.deps.persona, thread, contextHint);
      const sent = await this.deps.bridgeClient.sendMessage({
        to: msg.fromHandle,
        content: reply.content,
        // Trusted-Bypass: Inbound-Twin-Message wurde von trusted-twin gesendet
        // (kein Mandate-Check nötig), wir antworten direkt. Aus Empfänger-Sicht
        // ist das die Antwort auf seine Anfrage → twin-reply.
        // Cross-Ref Tag-28-Block-16.
        messageType: "twin-reply",
        // A2A Glied 2: Thread-Anker als inReplyTo weiterführen, damit der
        // Empfänger die a2aThreadId rekonstruieren kann (msg.inReplyTo ?? msg.id).
        // Heute fehlend — das ist der Thread-Bruch aus Diagnose Befund B.
        inReplyTo: a2aThreadId,
      });
      await this.deps.audit.complete(audit.id, {
        reply: reply.content,
        sentMessageId: sent.messageId,
        targetHandle: msg.fromHandle,
        providerMetadata: reply.metadata,
        a2aThreadId,
      });
      this.deps.bus.emit({ type: "twin.idle", payload: {} });
    } catch (err) {
      await this.failWithReason(audit.id, err);
      // Bewusst kein Re-Throw: Stream-Konsument soll nicht crashen, nur
      // gelogged + Audit failed.
    }
  }

  // ─── System-Antworten (Wartemeldung / Reject-Hinweis) ──────────────────────
  //
  // Schickt eine Bridge-Nachricht im Namen des Twins, markiert sie aber im
  // Audit-Log als "system-message" mit reasonCode. Bridge-Schema bleibt
  // unverändert — die Markierung lebt nur im Audit-Trail des Senders.

  private async sendSystemMessage(opts: {
    toHandle: string;
    inReplyTo: string | null;
    reasonCode: "pending-wait" | "rejected";
    content: string;
    relatedAuditId: string;
  }): Promise<void> {
    if (!this.deps.bridgeClient) return;

    let sentMessageId: string | null = null;
    let sendError: string | null = null;
    try {
      const sent = await this.deps.bridgeClient.sendMessage({
        to: opts.toHandle,
        content: opts.content,
        inReplyTo: opts.inReplyTo,
        // 2.5.4.1.1: explizit als System markieren, damit der Empfänger nicht
        // mit einer eigenen Wartemeldung antwortet (Loop-Schutz).
        messageType: "system",
      });
      sentMessageId = sent.messageId;
    } catch (err) {
      sendError = err instanceof Error ? err.message : String(err);
      console.warn(
        `[twin] sendSystemMessage (${opts.reasonCode}) an ${opts.toHandle} fehlgeschlagen: ${sendError}`,
      );
    }

    const audit = await this.deps.audit.start({
      capability: "system-message",
      mandateId: null,
      input: {
        reasonCode: opts.reasonCode,
        toHandle: opts.toHandle,
        content: opts.content,
        inReplyTo: opts.inReplyTo,
        relatedAuditId: opts.relatedAuditId,
      },
      initialStatus: sendError ? "failed" : "executed",
    });

    if (sendError) {
      await this.deps.audit.fail(audit.id, sendError);
    } else if (sentMessageId) {
      await this.deps.audit.complete(audit.id, {
        sentMessageId,
        toHandle: opts.toHandle,
      });
    }
  }

  private composeWaitMessage(): string {
    const ownerName = this.ownerDisplayName();
    return `Eine Anfrage ist bei ${ownerName} zur Freigabe. Sobald er draufschaut, kommt eine echte Antwort.`;
  }

  private composeRejectMessage(): string {
    const ownerName = this.ownerDisplayName();
    return `${ownerName} hat diese Anfrage nicht freigegeben. Falls dringend, kontaktiere ihn direkt.`;
  }

  /**
   * Display-Name für System-Antworten. Heute fallback auf Persona-Name —
   * sobald wir den User-Display-Name pro Twin im Service-Deps haben, kann das
   * hier dynamisch überschrieben werden.
   */
  private ownerDisplayName(): string {
    return this.deps.persona.name || this.deps.persona.handle;
  }

  private bridgeContextHint(fromHandle: string): string {
    const base =
      `Du führst gerade eine Konversation mit dem Twin ${fromHandle} über die Bridge.\n` +
      `Beziehe dich auf den Verlauf. Wenn der andere Twin auf eine deiner früheren\n` +
      `Nachrichten antwortet, geh konkret darauf ein — frag nicht nach dem Worum-geht's,\n` +
      `das weißt du selbst.`;
    // Phase 4.3 Schritt 2: Vertrautheits-Ton an den A2A-Kontext anhängen. NUR
    // Stil — keine Dispatch-/Autonomie-Wirkung (isTrusted bleibt row-basiert).
    // getFamiliarity liefert immer einen der vier Werte ('fremd'-Default ohne Row).
    const level = this.deps.trustRepo.getFamiliarity(this.deps.twinId, fromHandle);
    const famBlock = buildFamiliarityBlock(level, fromHandle);
    return famBlock ? `${base}\n\n${famBlock}` : base;
  }

  // ─── private helpers ─────────────────────────────────────────────────────


  /**
   * #3 Mandate-Condition `maxLength` — Premium-Enforcement (zentral).
   *
   * `maxLength` (Zeichen, wie in mandates.yaml) ist eine OUTPUT-Bedingung —
   * prüfbar erst NACH der Generierung. Mechanik:
   *   1. PRÄVENTIV — Längen-Hinweis als zusätzliche System-Instruktion in den
   *      Prompt; das Modell trifft das Limit meist beim ersten Versuch.
   *   2. REAKTIV — ist `reply.content` zu lang: EIN Retry (max. 1) mit
   *      verschärftem Hinweis. Immer noch zu lang → Truncate am Satz-/Wortende
   *      (finales Netz). Loop-Cap fix → garantiert eine Antwort, keine
   *      Endlosschleife.
   * Ohne `maxLength` auf dem Mandate (oder Mandate null, z.B. Owner-Direct):
   * 1× `generate(null)`, byte-identisches Verhalten wie vorher.
   *
   * `generate(hint)` ruft `runModel` mit `hint` als `extraSystem` auf — jede
   * Aufrufstelle reicht ihre eigenen messages/options durch (ein Helfer, kein
   * Stellen-Sonderfall). `lengthEnforced` im Ergebnis → Audit-Flag fürs Tuning.
   */
  private async enforceMaxLength(
    mandate: Mandate | null,
    generate: (
      extraHint: string | null,
    ) => Promise<{
      content: string;
      metadata: Record<string, unknown>;
      prePassSkillName?: string;
    }>,
  ): Promise<{
    content: string;
    metadata: Record<string, unknown>;
    prePassSkillName?: string;
    lengthEnforced?: "retried" | "truncated";
  }> {
    const raw = mandate?.conditions?.maxLength;
    const maxLength = typeof raw === "number" && raw > 0 ? raw : null;
    if (!maxLength) return generate(null);

    const preventive = `Längenlimit: Antworte in HÖCHSTENS ${maxLength} Zeichen. Bleib innerhalb des Limits, ohne den Gedanken mitten im Satz abzubrechen.`;
    const first = await generate(preventive);
    if (first.content.length <= maxLength) return first;

    const stricter = `Deine vorige Antwort war mit ${first.content.length} Zeichen zu lang (erlaubt sind ${maxLength}). Formuliere kürzer — höchstens ${maxLength} Zeichen, vollständiger Gedanke, nicht mitten im Satz abbrechen.`;
    const retry = await generate(stricter);
    if (retry.content.length <= maxLength) {
      return { ...retry, lengthEnforced: "retried" };
    }

    // Finales Netz: am letzten Satz-/Wortende vor dem Limit schneiden.
    return {
      ...retry,
      content: this.truncateAtBoundary(retry.content, maxLength),
      lengthEnforced: "truncated",
    };
  }

  /**
   * Schneidet `text` auf <= `maxLength` Zeichen, bevorzugt am letzten
   * Satz-Ende, sonst Wortende — nie mitten im Wort. Dezenter Kürzungs-Hinweis
   * ` […]`. Garantiert Länge <= maxLength.
   */
  private truncateAtBoundary(text: string, maxLength: number): string {
    if (text.length <= maxLength) return text;
    const HINT = " […]";
    if (maxLength <= HINT.length) return text.slice(0, maxLength);
    const budget = maxLength - HINT.length;
    const head = text.slice(0, budget);
    const sentenceEnd = Math.max(
      head.lastIndexOf(". "),
      head.lastIndexOf("! "),
      head.lastIndexOf("? "),
      head.lastIndexOf("\n"),
    );
    let cut: string;
    if (sentenceEnd >= budget * 0.5) {
      cut = text.slice(0, sentenceEnd + 1);
    } else {
      const wordEnd = head.lastIndexOf(" ");
      cut = wordEnd >= budget * 0.5 ? head.slice(0, wordEnd) : head;
    }
    return cut.trimEnd() + HINT;
  }

  /**
   * Ein Modell-Call über das Vercel AI SDK. Persona kommt als top-level
   * `system`-Parameter, der optionale `extraSystem`-Hinweis (z.B.
   * Bridge-Konversations-Kontext) wird vor die Persona gesetzt — gleicher
   * Wirkung wie früher die zwei system-Messages, aber ohne Provider-Splitting.
   *
   * Mit `enableMcpTools: true` (Owner-Direct-Pfad) werden aktive MCP-Skills
   * als AI-SDK-Tools an generateText übergeben und das SDK orchestriert den
   * Tool-Use-Loop. Tool-Calls landen in metadata.toolCalls — der Audit-Insert
   * zieht das automatisch ins audit.output. Bridge-Pfade (Approve/Trusted)
   * lassen das Flag aus — andere Twins sollen unsere Tools nicht spontan
   * triggern dürfen.
   *
   * Rückgabe-Shape ist die alte ProviderCompleteOutput, damit die Aufrufer
   * (`approveDefault`, `approveTwinSend`, …) unverändert bleiben.
   */
  private async runModel(
    persona: Persona,
    messages: ChatMessage[],
    extraSystem?: string,
    options: {
      enableMcpTools?: boolean;
      /**
       * 3.2.H: User-getriggerte Tool-Use über den Picker. Wird als
       * `toolChoice` an `generateText` durchgereicht und erzwingt den
       * spezifischen Tool-Call (kein LLM-Ermessen). Nur wirksam, wenn auch
       * `enableMcpTools=true` ist und das Tool im aktiven Skill-Set
       * existiert — sonst ignoriert (LLM-Default-Auto greift).
       */
      forcedToolChoice?: ForcedToolChoice;
      /**
       * 3.3.C: Conversation-Summary-Block für lange Konversationen. Wenn
       * gesetzt, fließt er als 6. System-Prompt-Schicht hinter
       * LANGUAGE_DIRECTIVE ein — der Twin kennt damit die verdichtete
       * Vorgeschichte. Bei `null`/`undefined` greift nichts (alte
       * Hard-Cap-Semantik).
       */
      summaryBlock?: string | null;
      /**
       * 3.3.E: Facts-Block aus dem Semantic-Memory. Wenn gesetzt, wird er
       * direkt an den Persona-System-Prompt angehängt (gleiche Schicht) —
       * Facts sind Persona-konstitutiv und profitieren von der
       * Attention-Position am Prompt-Anfang. Bei `null`/`undefined` bleibt
       * der reine Persona-Prompt.
       */
      factsBlock?: string | null;
      /**
       * 3.4.E: Episodic-Memory-Block. Top-K Hits aus dem Vector-Search über
       * vergangene Summaries/Konversationen/Diary-Einträge. Wird hinter
       * dem summaryBlock gerendert — semantisch "passend, aber nicht in der
       * aktuellen Konv". Bei `null` oder leeren Memories nimmt der
       * filter(Boolean)-Schritt es raus, kein leerer Header im Prompt.
       */
      episodicBlock?: string | null;
      /**
       * Aufmerksamkeit/Fokus Stufe 1 — Schritt 2: gespeicherter „aktueller
       * Fokus" als Prompt-Block. Wird NUR vom Owner-Send-Pfad (runOwnerDirect)
       * gesetzt — A2A-/Fremd-Calls lassen ihn weg (Owner-Kontext). Bei `null`
       * fällt er im composeOwnerSystemPrompt-`.filter(Boolean)` raus.
       */
      focusBlock?: string | null;
      /**
       * Streaming-Callback: wird pro Token aufgerufen, wenn der streamText-Pfad
       * aktiv ist (hasTools=false). Default=undefined → blockend (generateText).
       * NUR für den Web-Owner-Chat gesetzt — alle anderen Caller (Telegram,
       * A2A, Mandate, Reflect, …) übergeben kein onToken und bleiben blockend.
       */
      onToken?: (chunk: string) => void;
    } = {},
  ): Promise<{
    content: string;
    metadata: Record<string, unknown>;
    /**
     * #107: Wenn der Pre-Pass-Classifier einen forced-Skill getriggert hat,
     * landet der Skill-Name hier. runOwnerDirect nutzt das, um den
     * research_first_use_seen-Flag genau einmal pro Twin zu flippen und im
     * Response-Body `firstUseHint: 'research'` zu signalisieren. Undefined
     * wenn kein Match oder Pre-Pass nicht aktiviert war.
     */
    prePassSkillName?: string;
  }> {
    // #131 Phase 3.4.3.1 Big-Bang: oauth-Branch ist nicht mehr ein separater
    // Codex-Pfad (runModelViaCodex), sondern entscheidet nur welches `model`
    // an Vercel `generateText` geht. Provider via Lazy-Singleton, Tools +
    // System-Prompt + Multi-Step-Loop + needsApproval-Handling sind alle
    // identisch zwischen api_key und oauth.
    const profileNow = this.profilesRepo.findById(this.deps.twinId);
    const isOAuth = profileNow?.authMode === "oauth";
    let activeModel = this.deps.model;
    let activeModelLabel = this.deps.modelLabel;
    if (isOAuth) {
      if (!this.deps.oauthRefreshService) {
        throw new Error(
          "[twin-service] runModel: twin.authMode='oauth' aber " +
            "OAuthRefreshService nicht injiziert — Boot-Pfad muss " +
            "registry.loadAll({ oauthRefreshService }) übergeben.",
        );
      }
      if (!this.codexProvider) {
        this.codexProvider = createCodexProvider({
          refreshService: this.deps.oauthRefreshService,
          twinId: this.deps.twinId,
        });
      }
      activeModel = this.codexProvider.languageModel("gpt-5.5");
      activeModelLabel = "openai-codex/gpt-5.5";
    }

    // Skills landen zwischen Persona und LANGUAGE_DIRECTIVE: sie ergänzen die
    // Persona ("wer der Twin ist") um Wissen/Verhalten ("was er zusätzlich
    // kann"), sollen sie aber nicht überschreiben. Direktive bleibt am Ende
    // dominant. Strategie B: alle aktiven Skills permanent geladen.
    const skills: Skill[] = this.deps.skills.list(this.deps.twinId, {
      activeOnly: true,
    });
    const skillsBlock = skills.length > 0 ? buildSkillsBlock(skills) : null;
    if (skillsBlock) {
      // Token-Volumen-Proxy für späteren C-Wechsel (Core/On-demand). Echte
      // Provider-Token-Counts wären teuer; Zeichenanzahl reicht als Schwellwert-
      // Indikator.
      console.log(
        `[skills] block in system-prompt: twinId=${this.deps.twinId}, ` +
          `skillCount=${skills.length}, skillsBlockChars=${skillsBlock.length}`,
      );
    }

    // Vier Schichten, Reihenfolge bewusst:
    //   1. extraSystem (situativer Bridge-Kontext, optional)
    //   2. persona.systemPrompt (wer der Twin ist)
    //   3. skillsBlock (Skill-Erweiterungen, ergänzen Persona)
    //   4. LANGUAGE_DIRECTIVE (Anti-"weiss"-statt-"weiß", gilt für alle Twins)
    // Direktive ans Ende, weil LLMs den letzten System-Block stärker gewichten.
    const mcpToolsResult = options.enableMcpTools
      ? buildMcpToolsFromSkills({
          skills,
          mcpManager: this.mcp,
          bus: this.deps.bus,
        })
      : { tools: {}, skillByToolKey: new Map<string, Skill>() };
    const mcpTools = mcpToolsResult.tools;
    const skillByToolKey = mcpToolsResult.skillByToolKey;
    // web_fetch SS3b: NUR im Owner-Chat-Pfad verfügbar. `enableMcpTools` ist das
    // explizite Tool-Enablement-Flag — gesetzt von runOwnerDirect (Owner-Chat-
    // Antwort) + dessen Tool-Resume-Fortsetzungen, NICHT von trusted-bypass
    // (eingehende Partner-Nachricht), approveTwinSend oder der Summary. Damit ist
    // web_fetch im A2A-Pfad NICHT im Tool-Set → ein fremder Twin kann meinen Twin
    // nicht zu einem Fetch verleiten (Prompt-Injection-Fläche geschlossen). Voller
    // Owner-Use-Case bleibt. onFetch → recordWebFetchAudit (url+status+bytes, KEIN
    // Body). Autonome Engines gehen ohnehin nicht über runModel.
    const allTools: ToolSet = options.enableMcpTools
      ? {
          ...mcpTools,
          web_fetch: buildWebFetchTool((rec) => this.recordWebFetchAudit(rec)),
        }
      : mcpTools;
    const hasTools = Object.keys(allTools).length > 0;
    if (hasTools) {
      console.log(
        `[mcp:tools] passing ${Object.keys(allTools).length} tool(s) to LLM (twin=${this.deps.twinId})`,
      );
    }

    // Tool-Use-Direktive: nur wenn Tools übergeben werden. Tag-11-Befund hat
    // gezeigt, dass Claude Opus 4.7 ohne harten Schutz sogar Code-interne
    // Marker-Strings (z.B. __MCP_PENDING_APPROVAL__) und Tool-Outputs
    // ("Echo: …") halluziniert — Pattern aus dem Training-Korpus, das auf
    // Basis der Tool-Namen plausibel rekonstruiert wird. REGEL 4 + 6 sind
    // explizit gegen diese Befunde formuliert. Phrasing knapp, sechs nummerierte
    // Punkte — länger dilutiert die Wirkung.
const TOOL_USE_DIRECTIVE = hasTools
      ? `Du hast Werkzeuge (Tools) zur Verfügung. STRIKT BEFOLGEN:

REGEL 1: Wenn eine Anfrage durch ein Tool gelöst werden kann, RUFE ES AUF. Beschreibe nicht, was es tun würde — RUFE.

REGEL 2: Wenn du nicht selbst die exakte Information hast, nutze ein passendes Tool statt zu raten.

REGEL 3 (Anti-Halluzination): Erfinde NIEMALS Tool-Outputs. Wenn du kein Tool aufgerufen hast, hast du kein Tool-Result. Schreibe NIEMALS "Tool-Result: ...", "Echo: ...", oder ähnliche Output-Imitationen.

REGEL 4 (Anti-Marker-Halluzination): Erfinde NIEMALS technische Marker oder Status-Strings wie "__PENDING__", "__MCP_PENDING_APPROVAL__", "approved", "queued". Diese sind interne System-Konventionen, die nur durch echte Tool-Calls entstehen.

REGEL 5: Behaupte nicht, dass ein Tool nicht funktioniert, ohne es tatsächlich aufgerufen zu haben. Wenn du es nicht versucht hast, weißt du es nicht.

REGEL 6: Wenn der User dich explizit bittet, ein Tool zu nutzen ("rufe das X-Tool auf", "nutze Y"), MUSST du es rufen. Verweigere nicht und ersetze nicht durch eigene Antworten.`
      : null;

    // System-Prompt-Composition via composeOwnerSystemPrompt-Helper (siehe
    // dort für Schichten-Doku). runModelViaCodex nutzt denselben Helper —
    // Drift-Prevention zwischen Vercel-SDK- und Codex-Pfad.
    const system = composeOwnerSystemPrompt({
      persona,
      extraSystem,
      factsBlock: options.factsBlock,
      focusBlock: options.focusBlock,
      skillsBlock,
      toolUseDirective: TOOL_USE_DIRECTIVE,
      summaryBlock: options.summaryBlock,
      episodicBlock: options.episodicBlock,
    });

    // stopWhen: stepCountIs(5) limitiert Tool-Use-Iterationen pro User-Send.
    // Default in AI-SDK-6 ist stepCountIs(1) — also genau ein LLM-Call.
    // Mit Tool-Use brauchen wir mehrere Steps (call → result → call → ...);
    // 5 ist der Briefing-Default und reicht für die Pilot-Tools allemal.
    //
    // #107: Pre-Pass-Classifier — User-Picker (3.2.H) hat Vorrang. Pre-Pass
    // wird nur konsultiert, wenn der Caller keinen forcedToolChoice
    // durchgereicht hat UND mindestens ein aktiver Skill triggerMode='forced'
    // hat. Bei Match wird der `effectiveForcedToolChoice` auf den Classifier-
    // Output gesetzt; die folgende Validierung gegen `mcpTools` greift dann
    // genauso wie beim User-Picker-Pfad. `prePassSkillName` fließt nach oben,
    // damit runOwnerDirect den First-Use-Hint flippen kann.
    let effectiveForcedToolChoice = options.forcedToolChoice;
    let prePassSkillName: string | undefined;
    if (
      hasTools &&
      !effectiveForcedToolChoice &&
      selectForcedCandidates(skills).length > 0
    ) {
      const lastUserMessage = messages.at(-1)?.content ?? "";
      if (lastUserMessage) {
        const match = await classifyForcedTool({
          userMessage: lastUserMessage,
          skills,
          availableToolKeys: new Set(Object.keys(allTools)),
          classifierModel: this.deps.classifierModel,
          twinId: this.deps.twinId,
        });
        if (match) {
          effectiveForcedToolChoice = match.forcedToolChoice;
          prePassSkillName = match.skillName;
        }
      }
    }

    // 3.2.H: forcedToolChoice nur wenn das Ziel-Tool im aktuellen Tool-Set
    // existiert. AI SDK 6 wirft sonst einen NoSuchToolError; lieber lautlos
    // auf Auto zurückfallen und im Audit als ganz normaler LLM-Antwort-Pfad
    // landen, statt dem User einen 500 zu zeigen wenn sein Picker-Skill
    // gerade deaktiviert wurde.
    const forcedTool =
      hasTools &&
      effectiveForcedToolChoice &&
      allTools[effectiveForcedToolChoice.toolName] !== undefined
        ? effectiveForcedToolChoice
        : null;
    if (effectiveForcedToolChoice && !forcedTool) {
      console.warn(
        `[mcp:tools] forcedToolChoice ${effectiveForcedToolChoice.toolName} ` +
          `nicht im aktiven Tool-Set — fallback auf toolChoice='auto'`,
      );
    }
    // #141/#142: latencyMs zentral messen — gilt für oauth + api_key (inkl.
    // Followup-Step). Vorher nur im Codex-Provider-Output, jetzt provider-
    // agnostisch in der Audit-Metadata sichtbar.
    const startedAt = Date.now();

    // Streaming-Pfad: fullStream liefert text-delta + tool-call/result-Chunks
    // in einem Strom. Text-Deltas → onToken → Bus; Tool-Chunks durchlaufen —
    // tool.call.start/complete kommen weiterhin aus tool-bridge.ts execute().
    // Audit-Vertrag und Approval-Detect identisch zum generateText-Pfad.
    if (options.onToken) {
      try {
      const { onToken } = options;
      const streamRes = streamText({
        model: activeModel,
        system,
        messages: toModelMessages(messages),
        ...(hasTools
          ? {
              tools: allTools,
              stopWhen: stepCountIs(5),
              ...(forcedTool ? { toolChoice: forcedTool } : {}),
            }
          : {}),
      });

      let streamFullText = "";
      for await (const chunk of streamRes.fullStream) {
        // AI SDK v6: text-delta-Chunks liefern das Delta im Feld `text`.
        if (chunk.type === "text-delta") {
          onToken(chunk.text);
          streamFullText += chunk.text;
        }
        // Alle anderen Chunk-Typen (tool-call, tool-result, step-finish, …)
        // stilll durchlaufen — kein Bus-Emit hier (kommt aus tool-bridge).
      }

      const [sSteps, sFinishReason, sUsagePre, sMeta, sResponse] =
        await Promise.all([
          streamRes.steps,
          streamRes.finishReason,
          streamRes.usage,
          streamRes.providerMetadata,
          streamRes.response,
        ]);

      // Synthetisches Result-Objekt: dieselbe Schnittstelle wie GenerateTextOutcome,
      // damit detectToolApprovalRequest + collectAllTool* unverändert laufen.
      const streamResultLike = {
        steps: sSteps,
        toolCalls: sSteps.flatMap((s) => (s as { toolCalls?: unknown[] }).toolCalls ?? []),
        toolResults: sSteps.flatMap((s) => (s as { toolResults?: unknown[] }).toolResults ?? []),
        text: streamFullText,
        finishReason: sFinishReason,
      } as unknown as GenerateTextOutcome;

      // Approval-Detect (heikelste Stelle): identische Logik wie generateText-Pfad,
      // auf awaited steps/content — Verzweigung auto-approve vs. pending bleibt
      // exakt gleich.
      if (hasTools) {
        const approval = detectToolApprovalRequest(streamResultLike);
        if (approval) {
          throw new ApprovalRequestedError(approval);
        }
      }

      // Followup-Call (forcedTool-Edge-Case): selbe Bedingung wie generateText-Pfad.
      // forcedTool → nur 1 Step, text="", finishReason="tool-calls" → Synthese-Step.
      let sUsage = sUsagePre;
      const sNeedsFollowUp =
        forcedTool !== null &&
        streamFullText === "" &&
        (streamResultLike.toolCalls as unknown[]).length > 0 &&
        sFinishReason === "tool-calls";

      if (sNeedsFollowUp) {
        console.log(
          `[mcp:tools] forcedToolChoice + finishReason=tool-calls — running followup for final text (stream, twin=${this.deps.twinId})`,
        );
        const sResponseMessages =
          (sResponse as { messages?: unknown[] } | undefined)?.messages ?? [];
        const followupStreamRes = streamText({
          model: activeModel,
          system,
          messages: [
            ...toModelMessages(messages),
            ...(sResponseMessages as Parameters<typeof toModelMessages>[0]),
          ],
          tools: allTools,
          stopWhen: stepCountIs(2),
        });
        for await (const fChunk of followupStreamRes.fullStream) {
          if (fChunk.type === "text-delta") {
            onToken(fChunk.text);
            streamFullText += fChunk.text;
          }
        }
        const followupUsage = await followupStreamRes.usage;
        sUsage = mergeTokenUsage(sUsage, followupUsage);
      }

      // Tool-Calls für Audit-Metadata — wie generateText-Pfad.
      const sAllToolCalls = collectAllToolCalls(streamResultLike);
      const sAllToolResults = collectAllToolResults(streamResultLike);
      const sToolCallsForAudit: AuditToolCall[] = sAllToolCalls.map((tc) => {
        const matchingResult = sAllToolResults.find(
          (tr) => tr.toolCallId === tc.toolCallId,
        );
        return {
          toolName: tc.toolName,
          input: tc.input,
          output: redactToolOutputForAudit(
            tc.toolName,
            matchingResult ? matchingResult.output : null,
          ),
        };
      });

      const streamLatencyMs = Date.now() - startedAt;
      const sPK = isOAuth ? "openai-codex" : "anthropic";
      const sRawMeta = (sMeta ?? {}) as Record<string, unknown>;
      const sNestedMeta =
        (sRawMeta[sPK] as Record<string, unknown> | undefined) ?? {};
      const [sProviderName, ...sModelParts] = activeModelLabel.split("/");
      const sResponseModelId = (sResponse as { modelId?: string } | undefined)
        ?.modelId;
      const sModelName =
        sResponseModelId || sModelParts.join("/") || undefined;
      return {
        content: streamFullText,
        metadata: {
          ...sNestedMeta,
          provider: sProviderName ?? sPK,
          ...(sModelName ? { model: sModelName } : {}),
          authMode: isOAuth ? "oauth" : "api_key",
          twinId: this.deps.twinId,
          latencyMs: streamLatencyMs,
          usage: sUsage,
          finishReason: sFinishReason,
          ...(sToolCallsForAudit.length > 0
            ? { toolCalls: sToolCallsForAudit }
            : {}),
        },
        ...(prePassSkillName ? { prePassSkillName } : {}),
      };
      } catch (streamErr) {
        // ApprovalRequestedError ist erwartetes Business-Verhalten (Approval-Detect
        // nach Stream-Ende) — weiterwerfen, NICHT als Provider-Fehler behandeln.
        if (streamErr instanceof ApprovalRequestedError) throw streamErr;
        // doStream nicht implementiert (z.B. OAuth/Codex-Provider in Phase 3.4.1)
        // oder anderer Stream-Fehler → sauber auf blockenden generateText-Pfad fallen.
        // doStream wirft sofort (kein Yield) → streamFullText war leer, kein Token
        // wurde emittiert → Fallback ist sauber, kein Doppel-Aufruf.
        console.warn(
          `[stream] provider doStream nicht verfügbar für twin=${this.deps.twinId}, ` +
            `Fallback auf generateText: ${streamErr instanceof Error ? streamErr.message : String(streamErr)}`,
        );
        // Fall-Through → generateText-Pfad unten
      }
    }

    const result = await generateText({
      model: activeModel,
      system,
      messages: toModelMessages(messages),
      ...(hasTools
        ? {
            tools: allTools,
            // 3.5.E.B: stopWhen-Array hat OR-Semantik — Multi-Step bricht ab,
            // sobald das Step-Limit (5) erreicht ist. Marker-StopCondition
            // (Phase 3.2.F) wurde mit Marker-Pattern in Sub-Phase F entfernt.
            stopWhen: stepCountIs(5),
            ...(forcedTool ? { toolChoice: forcedTool } : {}),
          }
        : {}),
    });

    // #131 Phase 3.4.3.1 Big-Bang: native V3-Approval-Detect. Vercel-SDK
    // emittiert `tool-approval-request` als Content-Part wenn ein Tool mit
    // needsApproval=true aufgerufen wurde — execute() wurde noch nicht
    // gerufen. Wir scannen result.content[] + alle steps[i].content[] (Step-
    // Walk-Pattern wie bei toolCalls) und werfen `ApprovalRequestedError`
    // mit allen Resume-History-Daten. Catch in `runOwnerDirect` baut den
    // Pending-Audit. Marker-Detect oben wird durch needsApproval-Pattern
    // obsolet — bleibt bis Sub-Phase F für Defense-in-Depth.
    if (hasTools) {
      const approval = detectToolApprovalRequest(result);
      if (approval) {
        throw new ApprovalRequestedError(approval);
      }
    }

    // 3.2.H Patch: bei forciertem toolChoice macht AI SDK 6 nur EINEN Step.
    // Tool wird gerufen, Result kommt zurück, finishReason='tool-calls' —
    // aber kein Synthese-Step für die finale Text-Antwort, also `text=""`.
    // stopWhen greift hier nicht, weil das forced-Tool-Verhalten den Step
    // explizit beendet. Wir hängen einen Followup-Call dran (toolChoice
    // 'auto', also Default), der mit der bisherigen Konversation + den
    // assistant-Tool-Call- und tool-Result-Messages weiterarbeitet und den
    // Final-Text liefert. stepCountIs(2) reicht: ein einziger Text-Step
    // ohne weiteres Tool-Use ist alles was wir brauchen.
    const needsFollowUp =
      forcedTool !== null &&
      result.text === "" &&
      result.toolCalls.length > 0 &&
      result.finishReason === "tool-calls";

    let followupResult: typeof result | null = null;
    if (needsFollowUp) {
      console.log(
        `[mcp:tools] forcedToolChoice + finishReason=tool-calls — running followup for final text (twin=${this.deps.twinId})`,
      );
      followupResult = await generateText({
        model: activeModel,
        system,
        // response.messages enthält die assistant-Tool-Call- und
        // tool-Result-Messages aus dem ersten Step — direkt anhängen, dann
        // ist der Kontext komplett.
        messages: [
          ...toModelMessages(messages),
          ...result.response.messages,
        ],
        tools: allTools,
        stopWhen: stepCountIs(2),
        // Kein toolChoice → Default 'auto'. LLM darf jetzt frei antworten.
      });
    }

    // Tool-Use-Detail in die Audit-Metadata. Der Audit-Insert in den
    // Approve-/OwnerDirect-Pfaden packt metadata komplett ins audit.output —
    // damit landen Tool-Calls automatisch im Audit-Trail, ohne weitere
    // Anpassung. AI-SDK 6 nutzt input/output (nicht args/result).
    //
    // 3.5.E.B: collectAllTool* statt result.toolCalls/.toolResults direkt
    // — Multi-Step legt frühere Tool-Calls in result.steps[i].toolCalls,
    // top-level zeigt nur den letzten Step. Vorher hat der Audit-Trail bei
    // Multi-Step-Tool-Use leere toolCalls gezeigt, obwohl Tools sehr wohl
    // gerufen wurden. Final-Text kommt weiter aus dem Followup, falls
    // vorhanden; der erste Call liefert die Tool-Calls aller Steps.
    const allToolCalls = collectAllToolCalls(result);
    const allToolResults = collectAllToolResults(result);
    const toolCallsForAudit: AuditToolCall[] = allToolCalls.map((tc) => {
      const matchingResult = allToolResults.find(
        (tr) => tr.toolCallId === tc.toolCallId,
      );
      return {
        toolName: tc.toolName,
        input: tc.input,
        output: redactToolOutputForAudit(
          tc.toolName,
          matchingResult ? matchingResult.output : null,
        ),
      };
    });

    const finalText = followupResult ? followupResult.text : result.text;
    const finalFinishReason = followupResult
      ? followupResult.finishReason
      : result.finishReason;
    const mergedUsage = followupResult
      ? mergeTokenUsage(result.usage, followupResult.usage)
      : result.usage;
    const latencyMs = Date.now() - startedAt;

    // #141/#142: providerMetadata-Aufbereitung für audit.output.
    //   - `result.providerMetadata` ist nach V3-Spec verschachtelt unter dem
    //     Provider-Namespace (`{ "openai-codex": {...} }` bzw. `{ anthropic: {...} }`).
    //     Wir un-nesten flach (Pre-Refactor-Konsistenz, Debug-Query-freundlich).
    //   - `provider` + `model` werden aus dem Compound-`activeModelLabel`
    //     (`"openai-codex/gpt-5.5"`) gesplittet — Pre-Refactor-Audits hatten
    //     `provider` flach ohne Modell-Suffix.
    //   - `authMode` + `twinId` werden via TwinService-Kontext injected (Provider
    //     kennt sie nicht).
    //   - `unknownEventTypes` wird vom Provider als kommaseparierter String
    //     emittiert (codex-vercel-provider.ts:297) — hier zurück zu Array für
    //     Konsistenz mit Pre-Refactor-Audits.
    const providerKey = isOAuth ? "openai-codex" : "anthropic";
    const rawMeta = (result.providerMetadata ?? {}) as Record<string, unknown>;
    const nestedMeta =
      (rawMeta[providerKey] as Record<string, unknown> | undefined) ?? {};

    const [providerName, ...modelParts] = activeModelLabel.split("/");
    const responseModelId = (result.response as { modelId?: string } | undefined)
      ?.modelId;
    const splitModelName = modelParts.join("/");
    const modelName = responseModelId || splitModelName || undefined;

    const rawUnknown = nestedMeta.unknownEventTypes;
    const unknownEventTypes =
      typeof rawUnknown === "string"
        ? rawUnknown
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean)
        : Array.isArray(rawUnknown)
        ? rawUnknown
        : [];

    return {
      content: finalText,
      metadata: {
        ...nestedMeta,
        provider: providerName ?? providerKey,
        ...(modelName ? { model: modelName } : {}),
        authMode: isOAuth ? "oauth" : "api_key",
        twinId: this.deps.twinId,
        latencyMs,
        ...(unknownEventTypes.length > 0 ? { unknownEventTypes } : {}),
        usage: mergedUsage,
        finishReason: finalFinishReason,
        ...(toolCallsForAudit.length > 0
          ? { toolCalls: toolCallsForAudit }
          : {}),
      },
      ...(prePassSkillName ? { prePassSkillName } : {}),
    };
  }

  /**
   * Baut den Konversations-Thread mit einem bestimmten Twin aus den eigenen
   * Audit-Einträgen. Berücksichtigt:
   *   - send_to_twin executed mit output.targetHandle === fromHandle
   *     → eigene gesendete Nachricht (assistant)
   *   - respond_to_twin_message executed mit input.fromHandle === fromHandle
   *     → eingehende Nachricht (user) + unsere Antwort darauf (assistant)
   *   - trusted-bypass executed mit input.fromHandle === fromHandle
   *     → wie respond_to_twin_message, nur ohne Pending-Phase gewesen
   *
   * Sortierung chronologisch nach Audit-Timestamp; Limit 5 vorherige Einträge,
   * danach die aktuelle Nachricht — macht zusammen genau 6 Messages
   * (3 Roundtrips), wie spezifiziert.
   */
  private async buildBridgeThread(
    current: AuditEntry,
    fromHandle: string,
  ): Promise<ChatMessage[]> {
    type ThreadItem = { ts: string; role: ChatMessage["role"]; content: string };
    const items: ThreadItem[] = [];

    // Pragmatisch: letzte 200 Audits laden und filtern. Bei wachsendem
    // Volumen würde man hier eine indizierte SQL-Query bauen.
    const all = await this.deps.audit.repo.list({ limit: 200 });

    for (const e of all) {
      if (e.id === current.id) continue;
      if (e.status !== "executed") continue;

      if (e.capability === "send_to_twin") {
        const out = e.output as { targetHandle?: string; reply?: string } | null;
        if (out?.targetHandle === fromHandle && typeof out.reply === "string") {
          items.push({ ts: e.timestamp, role: "assistant", content: out.reply });
        }
        continue;
      }

      if (
        e.capability === "respond_to_twin_message" ||
        e.capability === "trusted-bypass"
      ) {
        const inp = e.input as { fromHandle?: string; content?: string };
        if (inp.fromHandle !== fromHandle) continue;
        const out = e.output as { reply?: string } | null;
        if (typeof inp.content === "string") {
          items.push({ ts: e.timestamp, role: "user", content: inp.content });
        }
        if (typeof out?.reply === "string") {
          items.push({ ts: e.timestamp, role: "assistant", content: out.reply });
        }
      }
    }

    // Stable sort: gleicher Timestamp (z.B. user+assistant aus demselben Audit)
    // behält die Push-Reihenfolge, also user vor assistant.
    items.sort((a, b) => a.ts.localeCompare(b.ts));

    // 5 historische Einträge + aktuelle Nachricht = 6 (3 Roundtrips).
    const recent = items.slice(-5);
    recent.push({
      ts: current.timestamp,
      role: "user",
      content: (current.input as { content?: string }).content ?? "",
    });

    return recent.map(({ role, content }) => ({ role, content }));
  }

  /**
   * A2A Glied 2 — Etappe 3 SS1: Rekonstruiert den VOLLEN Verlauf EINES Threads
   * (scoped auf `threadId`) für die Zusammenfassung — anders als buildBridgeThread,
   * das für Live-Antworten bewusst nur das letzte 6-Message-Fenster über alle
   * Partner-Threads zieht. Hier:
   *   - Scoping über a2aThreadId (input.a2aThreadId ODER output.a2aThreadId, tiefe
   *     JSON-Ebene) statt partnerHandle → keine Vermischung paralleler Threads.
   *   - GANZE Thread-Historie (kein slice(-5)); ein Thread ist durch das
   *     5-Runden/Seite-Limit ohnehin gedeckelt (~12 Items). Defensiver slice(-40)
   *     nur gegen pathologische/Alt-Daten.
   *   - Eingehende Partner-Nachrichten dedupliziert über bridgeMessageId, weil
   *     reply-received UND trusted-bypass dieselbe Partner-Message tragen.
   * Chronologisch (ältester zuerst), damit das LLM den Verlauf von Anfang bis
   * Ende sieht. Capabilities: send_to_twin (Eröffnung, output.reply),
   * reply-received (eingehend, input.content), trusted-bypass /
   * respond_to_twin_message (eigene Antwort output.reply + ggf. eingehend input).
   */
  private async buildA2aThreadForSummary(
    threadId: string,
  ): Promise<ChatMessage[]> {
    type ThreadItem = { ts: string; role: ChatMessage["role"]; content: string };
    const items: ThreadItem[] = [];
    const seenIncoming = new Set<string>();

    const all = await this.deps.audit.repo.list({
      limit: 500,
      twinId: this.deps.twinId,
    });

    // Nur echte Verhandlungs-Audits ins Material — schließt insbesondere
    // a2a-summary / a2a-summary-notice aus (die tragen ebenfalls threadId +
    // output.reply und würden sonst eine frühere Zusammenfassung in den
    // Verlauf zurückspeisen; hasA2aSummary verhindert das im Normalfall,
    // die Allowlist ist die robuste Leitplanke).
    const THREAD_CAPS = new Set([
      "send_to_twin",
      "reply-received",
      "trusted-bypass",
      "respond_to_twin_message",
    ]);
    for (const e of all) {
      if (e.status !== "executed") continue;
      if (!THREAD_CAPS.has(e.capability)) continue;
      const input = e.input as {
        a2aThreadId?: string;
        content?: string;
        bridgeMessageId?: string;
      };
      const output = e.output as
        | { a2aThreadId?: string; reply?: string }
        | null;
      const tid = input?.a2aThreadId ?? output?.a2aThreadId;
      if (tid !== threadId) continue;

      // Eingehende Partner-Nachricht (reply-received + trusted-bypass tragen sie
      // beide → dedup über die Bridge-Message-ID, sonst Doppeln pro Runde).
      if (typeof input?.content === "string" && input.bridgeMessageId) {
        if (!seenIncoming.has(input.bridgeMessageId)) {
          seenIncoming.add(input.bridgeMessageId);
          items.push({ ts: e.timestamp, role: "user", content: input.content });
        }
      }
      // Eigene ausgehende Nachricht (Eröffnung bei send_to_twin, sonst Antwort).
      if (typeof output?.reply === "string") {
        items.push({ ts: e.timestamp, role: "assistant", content: output.reply });
      }
    }

    items.sort((a, b) => a.ts.localeCompare(b.ts));
    return items.slice(-40).map(({ role, content }) => ({ role, content }));
  }

  /**
   * A2A Glied 2 — Etappe 3 SS2: Eröffnungstext eines Threads = der vom Twin
   * formulierte send_to_twin-Text an den Partner (output.reply des Openers mit
   * output.a2aThreadId === threadId). Dient als Auslöser-Vorspann der
   * Zusammenfassung. Gibt null zurück, wenn der Twin den Thread NICHT eröffnet
   * hat (Partner-initiiert → kein send_to_twin auf unserer Seite) → dann kein
   * (erfundener) Vorspann.
   */
  private async getA2aOpeningText(threadId: string): Promise<string | null> {
    const all = await this.deps.audit.repo.list({
      limit: 500,
      twinId: this.deps.twinId,
    });
    for (const e of all) {
      if (e.capability !== "send_to_twin") continue;
      if (e.status !== "executed") continue;
      const out = e.output as { a2aThreadId?: string; reply?: string } | null;
      if (out?.a2aThreadId === threadId && typeof out.reply === "string") {
        return out.reply;
      }
    }
    return null;
  }

  /**
   * A2A Glied 2 — Etappe 2: Zählt wie viele autonome Follow-Up-Runden
   * DIESE Seite für den gegebenen Thread bereits GESENDET hat (=trusted-bypass-
   * Audits mit passendem input.a2aThreadId). Die initiale send_to_twin-Runde
   * zählt NICHT. Grenze: A2A_MAX_FOLLOWUP_ROUNDS (Default 5, ENV-konfigurierbar).
   */
  private async countA2aFollowUpRounds(threadId: string): Promise<number> {
    const all = await this.deps.audit.repo.list({ limit: 200 });
    return all.filter((e) => {
      if (e.status !== "executed") return false;
      if (e.capability !== "trusted-bypass") return false;
      const inId = (e.input as { a2aThreadId?: string })?.a2aThreadId;
      return inId === threadId;
    }).length;
  }

  /**
   * A2A Glied 2 — Etappe 2: Erzeugt EINMAL pro Thread eine LLM-Zusammenfassung
   * des Verhandlungsstands mit `partnerHandle` und legt sie als Audit ab
   * (Capability "a2a-summary"). Trigger: Rundenlimit erreicht ("limit") ODER
   * Owner-Abbruch ("abort").
   *
   * Surface: Der Audit (+ die von AuditService emittierten audit.created/
   * audit.updated-Events) erscheint im Inbox-/Audit-Stream des Owners. Ein
   * Telegram-Push an den Owner (sendToOwner) existiert in TwinService NOCH NICHT
   * (vgl. approveProactiveNudge — spätere Freischaltung); die Zusammenfassung
   * landet daher als Audit, nicht als Telegram-Nachricht.
   *
   * Dedup über summarizedThreadIds (in-memory, pro Boot): weitere eingehende
   * Replies eines bereits gestoppten Threads triggern KEINE zweite
   * Zusammenfassung. Markiert wird VOR dem Modell-Call, damit parallele Replies
   * nicht doppelt summarizen; bei Modell-Fehler bleibt der Audit "failed", der
   * Thread gilt aber als summarized (Pilot-Scope, dokumentiert).
   */
  private async summarizeA2aThreadOnce(
    threadId: string,
    partnerHandle: string,
    reason: "limit" | "abort" | "quiescence",
  ): Promise<void> {
    if (this.summarizedThreadIds.has(threadId)) return;
    // DB-Dedup (restart-sicher): existiert schon eine a2a-summary für diesen
    // Thread, NICHT erneut summarizen. Deckt den Quiescence-Sweep gegen den
    // synchronen Limit/Abbruch-Pfad ab und überlebt Neustarts (das in-memory
    // Set wird beim Boot vergessen).
    if (await this.hasA2aSummary(threadId)) {
      this.summarizedThreadIds.add(threadId);
      return;
    }
    this.summarizedThreadIds.add(threadId);

    // input.content wird von buildBridgeThread als finaler User-Turn an das
    // Modell gehängt — daher ist es zugleich der Zusammenfassungs-Auftrag.
    // 🔴 Persona-Disziplin: NEUTRALE Zusammenfassung des tatsächlich Besprochenen
    // — keine erfundenen Zusagen, keine Aktionen, die nicht im Thread standen.
    const NEUTRAL_GUARD =
      ` Fasse ausschließlich zusammen, was im Austausch tatsächlich besprochen ` +
      `wurde — erfinde keine Zusagen, Termine oder Aktionen, die nicht gefallen sind.`;

    // SS2: Auslöser-Vorspann (Variante A) — nur bei owner-initiiertem Thread
    // (send_to_twin-Opener vorhanden). Das LLM webt den Aufhänger ein; bei
    // Partner-initiierten Threads bleibt es leer → kein erfundener Vorspann.
    const opening = await this.getA2aOpeningText(threadId);
    const OPENING_PREFIX = opening
      ? `Der Austausch begann mit dieser Anfrage an ${partnerHandle}: ` +
        `„${opening.trim()}". Beginne deine Zusammenfassung mit einem kurzen ` +
        `Aufhänger (worum es ging), dann der Stand. `
      : "";

    const instruction =
      OPENING_PREFIX +
      (reason === "limit"
        ? `Fasse für mich (Owner) den Stand der Verhandlung mit ${partnerHandle} ` +
          `in 3-5 Sätzen zusammen: Was wurde besprochen, worauf habt ihr euch ` +
          `geeinigt, was ist noch offen? Der autonome Austausch wurde nach ` +
          `${A2A_MAX_FOLLOWUP_ROUNDS} Runden pro Seite automatisch gestoppt.`
        : reason === "abort"
          ? `Fasse für mich (Owner) den Stand der Verhandlung mit ${partnerHandle} ` +
            `in 3-5 Sätzen zusammen: Was wurde besprochen, was ist noch offen? ` +
            `Ich habe den autonomen Austausch gerade abgebrochen.`
          : `Fasse für mich (Owner) den Stand des Austauschs mit ${partnerHandle} ` +
            `in 3-5 Sätzen zusammen: Was wurde besprochen, worauf habt ihr euch ` +
            `geeinigt, was ist noch offen? Der Austausch ist zur Ruhe gekommen ` +
            `(keine neuen Nachrichten mehr).`) + NEUTRAL_GUARD;

    const audit = await this.deps.audit.start({
      capability: "a2a-summary",
      mandateId: null,
      input: {
        a2aThreadId: threadId,
        partnerHandle,
        reason,
        content: instruction,
      },
      initialStatus: "executed",
    });

    this.deps.bus.emit({
      type: "twin.thinking",
      payload: { capability: "a2a-summary" },
    });
    try {
      // SS1: VOLLEN Verlauf NUR dieses Threads rekonstruieren (threadId-scoped,
      // keine slice-Kappung) — damit die Zusammenfassung Anfang bis Ende abdeckt
      // und keine parallelen @partner-Threads vermischt. Die instruction als
      // finalen User-Turn anhängen (vorher übernahm das buildBridgeThread via
      // current.input.content).
      const thread = await this.buildA2aThreadForSummary(threadId);
      thread.push({ role: "user", content: instruction });
      const reply = await this.runModel(this.deps.persona, thread, undefined);
      await this.deps.audit.complete(audit.id, {
        reply: reply.content,
        partnerHandle,
        a2aThreadId: threadId,
        reason,
        providerMetadata: reply.metadata,
      });
      this.deps.bus.emit({ type: "twin.idle", payload: {} });
    } catch (err) {
      await this.failWithReason(audit.id, err);
    }
  }

  /**
   * A2A Glied 2 — Etappe 3 (Zustellung): Existiert bereits eine a2a-summary
   * (egal welcher Grund/Status) für diesen Thread? DB-basierte, restart-sichere
   * Dedup-Quelle für summarizeA2aThreadOnce und den Quiescence-Sweep.
   */
  private async hasA2aSummary(threadId: string): Promise<boolean> {
    const all = await this.deps.audit.repo.list({
      limit: 500,
      twinId: this.deps.twinId,
    });
    return all.some(
      (e) =>
        e.capability === "a2a-summary" &&
        (e.input as { a2aThreadId?: string })?.a2aThreadId === threadId,
    );
  }

  /**
   * A2A Glied 2 — Etappe 3 SS-A: Quiescence-Sweep. Findet A2A-Threads dieses
   * Twins, die seit `quiescenceMs` keine neue Nachricht mehr hatten und noch
   * KEINE a2a-summary haben → erzeugt sie mit Grund "quiescence". Limit/Abbruch-
   * Threads sind bereits summarized (synchroner Pfad) und werden via hasA2aSummary
   * übersprungen — kein Doppel-Summary. Aufgerufen vom A2ACloseSweepService.
   *
   * Thread-Identität = a2aThreadId (in input ODER output). Partner-Handle wird
   * aus den Thread-Audits abgeleitet (send_to_twin.output.targetHandle bzw.
   * fromHandle bei eingehenden). Gibt die Zahl frisch erzeugter Summaries zurück.
   */
  async sweepA2aThreadClosures(
    quiescenceMs: number,
    armedAtMs: number,
  ): Promise<number> {
    const all = await this.deps.audit.repo.list({
      limit: 1000,
      twinId: this.deps.twinId,
    });

    // Pro Thread: jüngster Timestamp + ein Partner-Handle. Nur Audits, die eine
    // a2aThreadId tragen (send_to_twin / reply-received / trusted-bypass).
    const threads = new Map<
      string,
      { lastTs: number; partner: string | null; hasSummary: boolean }
    >();
    for (const e of all) {
      const input = e.input as {
        a2aThreadId?: string;
        fromHandle?: string;
      };
      const output = e.output as
        | { a2aThreadId?: string; targetHandle?: string }
        | null;
      const tid = input?.a2aThreadId ?? output?.a2aThreadId;
      if (!tid) continue;
      const ts = Date.parse(e.timestamp);
      const partner = output?.targetHandle ?? input?.fromHandle ?? null;
      const cur = threads.get(tid);
      if (!cur) {
        threads.set(tid, {
          lastTs: Number.isFinite(ts) ? ts : 0,
          partner,
          hasSummary: e.capability === "a2a-summary",
        });
      } else {
        if (Number.isFinite(ts) && ts > cur.lastTs) cur.lastTs = ts;
        if (!cur.partner && partner) cur.partner = partner;
        if (e.capability === "a2a-summary") cur.hasSummary = true;
      }
    }

    const now = Date.now();
    let created = 0;
    for (const [tid, info] of threads) {
      if (info.hasSummary) continue; // Limit/Abbruch o. früherer Sweep
      if (!info.partner) continue; // ohne Partner kein sinnvoller Summary-Prompt
      if (now - info.lastTs <= quiescenceMs) continue; // noch aktiv
      // Backfill-Schutz: Threads, die schon VOR dem Scharfschalten verstummt
      // waren, sind Alt-Bestand → KEINE rückwirkende Summary (und damit kein
      // späterer Push). Nur Threads, deren letzte Aktivität ab armedAt liegt,
      // werden zusammengefasst.
      if (info.lastTs < armedAtMs) continue;
      await this.summarizeA2aThreadOnce(tid, info.partner, "quiescence");
      created += 1;
    }
    return created;
  }

  /**
   * A2A Glied 2 — Etappe 3 SS-B: Stellt noch-nicht-zugestellte a2a-summaries
   * aktiv an den Owner zu (Telegram via `sender`). `sender` ist die an diesen
   * Twin gebundene `BotRegistry.sendToOwner`-Closure (der Sweep reicht sie rein,
   * weil die BotRegistry erst nach der Registry existiert).
   *
   * Idempotenz / kein Doppel-Push: nur Summaries mit `output.deliveredAt == null`;
   * bei erfolgreichem Send wird `deliveredAt` PERSISTENT im Audit gesetzt
   * (repo.update, NICHT read_at) — restart-sicher. Schlägt der Send fehl
   * (z.B. nicht gepaart, Bot blockiert), bleibt `deliveredAt` null → nächster
   * Sweep versucht es erneut. Gibt die Zahl frisch zugestellter Summaries zurück.
   */
  async deliverPendingA2aSummaries(
    sender: (text: string) => Promise<{ sent: boolean; reason?: string }>,
    armedAtMs: number,
  ): Promise<number> {
    const all = await this.deps.audit.repo.list({
      limit: 500,
      twinId: this.deps.twinId,
    });
    const pending = all.filter((e) => {
      if (e.capability !== "a2a-summary") return false;
      if (e.status !== "executed") return false; // gescheiterte (kein reply) skip
      const out = e.output as { reply?: string; deliveredAt?: string } | null;
      return typeof out?.reply === "string" && !out.deliveredAt;
    });

    let delivered = 0;
    for (const entry of pending) {
      // 🔴 Stiller Backfill: Summaries, die VOR dem Scharfschalten entstanden
      // (Alt-Bestand — z.B. heutige Limit/Abbruch-Threads), werden OHNE Push und
      // OHNE Direct-Chat-Bubble als delivered markiert. Kein rückwirkender
      // Telegram-Schwall beim ersten Lauf. Maßstab ist der Summary-Timestamp
      // (≈ Thread-Abschlusszeit); restart-sicher, weil armedAt persistent ist.
      const summaryTs = Date.parse(entry.timestamp);
      if (Number.isFinite(summaryTs) && summaryTs < armedAtMs) {
        await this.markA2aSummaryDelivered(entry.id);
        continue;
      }

      const out = entry.output as {
        reply?: string;
        partnerHandle?: string;
        deliveredAt?: string;
      } | null;
      const reply = out?.reply;
      if (!reply) continue;
      const partner = out?.partnerHandle ?? "einem anderen Twin";
      const threadId = (entry.input as { a2aThreadId?: string })?.a2aThreadId;

      // SS-C: Proaktive Direct-Chat-Bubble — idempotent (eigene Notice-Audit-
      // Existenz), unabhängig vom Telegram-Erfolg. So erscheint die Summary
      // als Twin-Bubble im Owner-Chat, auch wenn der Telegram-Push (noch) fehlt.
      if (threadId) {
        await this.ensureA2aSummaryBubble(threadId, partner, reply);
      }

      // Rich-Message: Markdown — sendToOwner macht Markdown→HTML (mit Plain-
      // Fallback). Überschrift + die neutrale Zusammenfassung.
      const text = `*🤝 Austausch mit ${partner} abgeschlossen*\n\n${reply}`;

      const result = await sender(text);
      if (!result.sent) continue; // deliveredAt bleibt null → Retry nächster Sweep

      await this.markA2aSummaryDelivered(entry.id);
      delivered += 1;
    }
    return delivered;
  }

  /**
   * Setzt `output.deliveredAt = jetzt` persistent (repo-Read-Merge, NICHT
   * read_at). Restart-sicherer Dedup-Marker gegen Doppel-Push/-Backfill.
   */
  private async markA2aSummaryDelivered(auditId: string): Promise<void> {
    const existing = await this.deps.audit.repo.get(auditId);
    const mergedOutput = {
      ...((existing?.output as Record<string, unknown> | null) ?? {}),
      deliveredAt: new Date().toISOString(),
    };
    await this.deps.audit.repo.update(auditId, { output: mergedOutput });
  }

  /**
   * A2A Glied 2 — Etappe 3 Fix: Scharfschalt-Zeitpunkt (armedAt) des
   * Quiescence-Sweeps — persistent + restart-sicher als Audit "a2a-sweep-armed"
   * (genau einer pro Twin, idempotent). Beim allerersten Sweep gesetzt = jetzt.
   * Threads/Summaries, deren Aktivität/Erzeugung DAVOR liegt, sind Alt-Bestand
   * und werden nie rückwirkend gepusht (stiller Backfill). Gibt armedAt in ms.
   */
  async ensureSweepArmed(): Promise<number> {
    const existing = await this.deps.audit.repo.findByInputField(
      "sweepArmedMarker",
      "a2a-sweep-armed",
      { twinId: this.deps.twinId },
    );
    if (existing) {
      const armed =
        (existing.input as { armedAt?: string })?.armedAt ?? existing.timestamp;
      const ms = Date.parse(armed);
      return Number.isFinite(ms) ? ms : Date.now();
    }
    const nowIso = new Date().toISOString();
    await this.deps.audit.start({
      capability: "a2a-sweep-armed",
      mandateId: null,
      // sweepArmedMarker: fester Wert für die gezielte findByInputField-Query
      // (robust unabhängig vom Audit-Volumen, kein limit-Cutoff).
      input: { sweepArmedMarker: "a2a-sweep-armed", armedAt: nowIso },
      initialStatus: "executed",
    });
    return Date.parse(nowIso);
  }

  /**
   * A2A Glied 2 — Etappe 3 SS-C: Schreibt die Zusammenfassung als proaktive
   * Twin-Bubble in den Owner-Direct-Chat (Capability "a2a-summary-notice",
   * verknüpft mit der Owner-Direct-Konversation). assistant-only — kein
   * Owner-Input ging voraus. Idempotent: existiert für diesen Thread schon eine
   * Notice, passiert nichts (verhindert Doppel-Bubble bei Telegram-Retries).
   * Kein read_at — Direct-Chat-Bubbles tragen keinen Lesestatus (wie owner-direct).
   */
  private async ensureA2aSummaryBubble(
    threadId: string,
    partnerHandle: string,
    summaryText: string,
  ): Promise<void> {
    if (this.deps.ownerUserId === null) return; // ohne Owner keine Direct-Konv

    const all = await this.deps.audit.repo.list({
      limit: 500,
      twinId: this.deps.twinId,
    });
    const exists = all.some(
      (e) =>
        e.capability === "a2a-summary-notice" &&
        (e.input as { a2aThreadId?: string })?.a2aThreadId === threadId,
    );
    if (exists) return;

    // Owner-Direct-Konversation auflösen (gleicher Resolver wie der Owner-Pfad):
    // Direct-Chat-Partner = der Twin-Handle selbst.
    const ownHandle = this.deps.persona.handle.startsWith("@")
      ? this.deps.persona.handle
      : `@${this.deps.persona.handle}`;
    const conv = this.deps.conversations.getOrStart(
      this.deps.ownerUserId,
      ownHandle,
      this.deps.twinId,
    );

    const audit = await this.deps.audit.start({
      capability: "a2a-summary-notice",
      mandateId: null,
      input: { a2aThreadId: threadId, partnerHandle },
      initialStatus: "executed",
      conversationId: conv.id,
    });
    // Summary-Text ins output.reply → der Direct-Chat-Renderer zeigt ihn als
    // assistant-only-Bubble.
    await this.deps.audit.complete(audit.id, {
      reply: summaryText,
      partnerHandle,
      a2aThreadId: threadId,
    });
  }

  private async failWithReason(auditId: string, err: unknown): Promise<void> {
    const reason = err instanceof Error ? err.message : String(err);
    await this.deps.audit.fail(auditId, reason);
    this.deps.bus.emit({ type: "twin.idle", payload: {} });
  }

  /**
   * web_fetch SS3: schreibt pro web_fetch-Call einen Audit-Eintrag (Capability
   * "web-fetch") — NUR Metadaten (url/status/contentType/bytes/truncated bzw.
   * error), NIE der Body. Die einzige persistente Spur autonomer Web-Zugriffe
   * (auch geblockte). Fehler hier brechen den Fetch/Turn nie (eigener try/catch).
   */
  private async recordWebFetchAudit(rec: WebFetchAuditRecord): Promise<void> {
    try {
      const audit = await this.deps.audit.start({
        capability: "web-fetch",
        mandateId: null,
        input: { url: rec.url },
        initialStatus: "executed",
      });
      await this.deps.audit.complete(audit.id, {
        ok: rec.ok,
        ...(rec.status !== undefined ? { status: rec.status } : {}),
        ...(rec.contentType ? { contentType: rec.contentType } : {}),
        ...(rec.bytes !== undefined ? { bytes: rec.bytes } : {}),
        ...(rec.truncated !== undefined ? { truncated: rec.truncated } : {}),
        ...(rec.finalUrl ? { finalUrl: rec.finalUrl } : {}),
        ...(rec.error ? { error: rec.error } : {}),
      });
    } catch (err) {
      console.warn(
        `[web-fetch] Audit-Schreibfehler (twin=${this.deps.twinId}):`,
        err instanceof Error ? err.message : err,
      );
    }
  }

  private async safeAck(messageId: string): Promise<void> {
    if (!this.deps.bridgeClient) return;
    try {
      await this.deps.bridgeClient.acknowledge(messageId);
    } catch (err) {
      // Ack-Fehler ist nicht fatal — Bridge wird die Nachricht erneut zustellen,
      // und unsere Idempotenz (findByInputField) verhindert Doubletten.
      const msg = err instanceof BridgeError ? err.message : String(err);
      console.warn(`[twin] ack für ${messageId} fehlgeschlagen: ${msg}`);
    }
  }
}

// ─── helpers (modul-lokal) ───────────────────────────────────────────────────

// #71b/#80: Sliding-Window-Cap pro Direct-Chat-Konversation. ~20 Turns
// (User+Assistant pro Audit), also ~40 LLM-Messages. Bei Bedarf später als
// Config-Option exponieren — für jetzt fix.
const HISTORY_MESSAGE_CAP = 40;
const HISTORY_AUDIT_LIMIT = Math.ceil(HISTORY_MESSAGE_CAP / 2);

/** #131 Phase 3.3.1.2: Safety-Cap für Codex-Multi-Step-Tool-Loop.
 *  Default 5 matched `stepCountIs(5)` im Vercel-AI-SDK-Pfad
 *  (twin-service.ts ~Z. 1707). Bei Erreichen: Throw, weil Codex sonst
 *  potenziell endlos Tool-Calls anfordert (siehe Anti-Halluzinations-
 *  Regeln im Vercel-SDK-TOOL_USE_DIRECTIVE — Codex hat heute keine
 *  entsprechende Direktive). */
const CODEX_MAX_TOOL_ITERATIONS = 5;

// Globale Sprach-Direktive — wird an JEDE Persona-System-Prompt angehängt,
// unabhängig von Twin oder Modell. Anlass: Anthropic-Modelle haben in mehreren
// Live-Tests Umlaut-Ersatz produziert ("weiss" statt "weiß", "beschaeftigt"
// statt "beschäftigt") trotz deutschsprachiger Persona. Diese Direktive zentral,
// damit kein Persona-File oder DB-Eintrag angepasst werden muss.
const LANGUAGE_DIRECTIVE = `
## Sprache

Schreibe immer mit korrekten deutschen Umlauten (ä, ö, ü, ß).
Niemals "ae", "oe", "ue" oder "ss" als Ersatz verwenden.
Auch nicht "ae" für Eigennamen wie "Bär" oder Begriffe wie
"beschäftigt", "Größe", "schön".
`.trim();

/**
 * web_fetch SS3: web_fetch-Tool-Output für die Audit-Metadata (metadata.toolCalls)
 * redacten — der volle Body (bis 2 MB) gehört NICHT in den Audit-Trail. Nur
 * Metadaten behalten, Body → bytes-Länge. Andere Tools unverändert durchreichen.
 */
function redactToolOutputForAudit(toolName: string, output: unknown): unknown {
  if (toolName !== "web_fetch" || !output || typeof output !== "object") {
    return output;
  }
  const { body, ...rest } = output as Record<string, unknown>;
  return {
    ...rest,
    ...(typeof body === "string" ? { bytes: body.length } : {}),
  };
}

/**
 * Owner-lokale Anzeige-Zeitzone für den „Heute"-Block im System-Prompt.
 * Reused dieselbe Env wie die Quiet-Hours (proactive-nudge-service), damit es
 * EINE TZ-Quelle gibt; Default Europe/Berlin. Der Server läuft UTC — ohne TZ
 * würde der Wochentag/das Datum nahe Mitternacht kippen.
 */
const OWNER_DISPLAY_TZ =
  (process.env.QUIET_HOURS_TZ ?? "").trim() || "Europe/Berlin";

/**
 * Twin-Zeitgefühl: natürlichsprachlicher „Heute ist {Wochentag}, der {D}.
 * {Monat} {Jahr}"-Block, owner-lokal formatiert. PRO REQUEST berechnet (now wird
 * von composeOwnerSystemPrompt mit `new Date()` übergeben) — NICHT modul-
 * konstant, sonst friert das Datum beim Boot ein. Ungültige TZ → UTC-Fallback
 * (nie crashen).
 */
function buildDateBlock(now: Date): string {
  const opts: Intl.DateTimeFormatOptions = {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  };
  let formatted: string;
  try {
    formatted = new Intl.DateTimeFormat("de-DE", {
      timeZone: OWNER_DISPLAY_TZ,
      ...opts,
    }).format(now);
  } catch {
    formatted = new Intl.DateTimeFormat("de-DE", opts).format(now);
  }
  return `## Heute\n\nHeute ist ${formatted}.`;
}

/**
 * Composition des Owner-Direct-System-Prompts.
 *
 * Acht Schichten, Reihenfolge bewusst:
 *   1. extraSystem (situativer Bridge-Kontext, optional)
 *   2. persona.systemPrompt + factsBlock (combined — Facts sind Persona-
 *      konstitutiv und profitieren von der Attention-Position am
 *      Prompt-Anfang, 3.3.E)
 *   3. focusBlock (Fokus Stufe 1 Schritt 2 — „aktueller Fokus", hohe Attention
 *      direkt nach Persona+Facts; nur Owner-Pfad, A2A lässt ihn null)
 *   4. skillsBlock (Skill-Erweiterungen, ergänzen Persona — nur Manual-Skills,
 *      `null` im Codex-Pfad bis Phase 3.3 Tool-Use nachzieht)
 *   5. toolUseDirective (Anti-Halluzination-Regeln, nur bei aktivem Tool-Set,
 *      `null` im Codex-Pfad bis Phase 3.3)
 *   6. LANGUAGE_DIRECTIVE (Anti-„weiss"-statt-„weiß", gilt für alle Twins)
 *   7. summaryBlock (3.3.C — verdichtete Vorgeschichte der LAUFENDEN Konv)
 *   8. episodicBlock (3.4.E — Top-K Erinnerungen aus VERGANGENEN Konv + Diary)
 *
 * `null`-Schichten werden via `.filter(Boolean)` rausgeworfen. Konsumenten:
 * `runModel` (Vercel-AI-SDK-Pfad mit allen 7 Schichten) und
 * `runModelViaCodex` (OAuth-Codex-Pfad ohne Schicht 3+4 in Phase 3.2).
 *
 * #131 Phase 3.2: extrahiert aus runModel, damit beide Pfade strukturell
 * dieselbe Composition haben und neue Schichten nicht nur in einem Pfad
 * eingebaut werden (Drift-Prevention).
 */
export function composeOwnerSystemPrompt(parts: {
  persona: Persona;
  extraSystem: string | null | undefined;
  factsBlock: string | null | undefined;
  /**
   * Aufmerksamkeit/Fokus Stufe 1 — Schritt 2: „aktueller Fokus"-Block. Position
   * direkt nach Persona+Facts (hohe Attention, konstitutiver Gegenwarts-Kontext).
   * Nur der Owner-Pfad (runOwnerDirect) setzt ihn; A2A-Calls lassen ihn null.
   */
  focusBlock: string | null | undefined;
  skillsBlock: string | null | undefined;
  toolUseDirective: string | null | undefined;
  summaryBlock: string | null | undefined;
  episodicBlock: string | null | undefined;
}): string {
  const personaWithFacts = parts.factsBlock
    ? `${parts.persona.systemPrompt}\n\n${parts.factsBlock}`
    : parts.persona.systemPrompt;
  // Zeit-Anker: hohe Attention direkt nach Persona/Facts. PRO REQUEST via
  // new Date() (per-Call von composeOwnerSystemPrompt) → kein eingefrorenes
  // Boot-Datum. Greift über beide Modell-Pfade (Vercel + Codex), da runModel
  // genau einmal hier durchgeht.
  const dateBlock = buildDateBlock(new Date());
  return [
    parts.extraSystem,
    personaWithFacts,
    dateBlock,
    parts.focusBlock,
    parts.skillsBlock,
    parts.toolUseDirective,
    LANGUAGE_DIRECTIVE,
    parts.summaryBlock,
    parts.episodicBlock,
  ]
    .filter(Boolean)
    .join("\n\n");
}

// 3.2.F: Shape des Pending-Audit-Input für mcp-tool-use. Lokal als Type-
// Alias, damit der Cast in approveMcpToolUse / reject-Branch lesbar bleibt.
// Der Persistenz-Schema lebt zentral in `@nolmi/shared`
// (`AuditMcpToolUseInputSchema`); diesen lokalen Shape ziehen wir bewusst
// nicht aus dem zod-Schema, weil die Inbox-Display-Felder (lastMessage,
// originalCapability) mitgespeichert werden, ohne den Frontend-Typ zu
// erweitern.
interface AuditMcpToolUseInputShape {
  messages?: ChatMessage[];
  lastMessage?: string;
  /** Legacy-Form (Phase 3.2.F + 3.3.1.3.x): mcpServerId/mcpToolName/args
   *  für direkte Tool-Re-Execution via mcpManager.callTool. Native-V3-
   *  Pending-Audits lassen das Feld optional und nutzen toolName/toolInput
   *  als parallele Display-Felder (Resume läuft via approvalId + history-
   *  replay). */
  toolCall?: {
    mcpServerId: string;
    mcpToolName: string;
    args: Record<string, unknown>;
  };
  conversationId?: string | null;
  pendingReply?: string;
  originalCapability?: string;
  /** #131 Phase 3.3.1.3.2: bei Re-Pause-Audit gesetzt — Link zum vorher-
   *  pausierten Audit der nach Approve eine neue Pause getriggert hat. */
  priorAuditId?: string;
  /** #131 Phase 3.4.3.1 Big-Bang: Native-V3-Approval-ID aus Vercel-SDK.
   *  Resume-Approve nutzt diese ID + `assistantContent` für History-Replay.
   *  Wenn gesetzt, ist `toolCall` (Legacy-Form) typisch undefined — V3-
   *  Pending nutzt `toolName`/`toolInput` als Display-Surface. */
  approvalId?: string;
  /** #131 Phase 3.4.3.1: Vercel-tool-call-ID. */
  toolCallId?: string;
  /** #131 Phase 3.4.3.1: Tool-Key aus Vercel-Tool-Set (z.B.
   *  `mcp_everything-approval_get-sum`) für UI-Display. */
  toolName?: string;
  /** #131 Phase 3.4.3.1: Tool-Input-Args für UI-Display (geparst aus
   *  approval-request.toolCall.input). */
  toolInput?: unknown;
  /** #131 Phase 3.4.3.1: komplettes `assistant`-Content-Array aus dem
   *  Pause-Result (enthält tool-call + tool-approval-request). Resume
   *  appendet das als assistant-Message ans messages-Array. */
  assistantContent?: unknown;
}

type GenerateTextOutcome = Awaited<ReturnType<typeof generateText>>;

// ─── 3.5.E.B: STEP-WALK FÜR TOOL-CALLS / TOOL-RESULTS ──────────────────────
//
// AI SDK 6 propagiert bei Multi-Step-`generateText`-Calls die Tool-Calls
// aus früheren Steps NICHT ins top-level `result.toolCalls` — das zeigt
// nur den letzten Step. Wir flachen daher über `result.steps` und fallen
// nur dann auf top-level zurück, wenn `steps` fehlt (defensive: ältere
// SDK-Version oder Single-Step-Cache-Hit). Spike 3.5.E.0 hat das Verhalten
// verifiziert (siehe Findings-Doc auf Branch `spike/89-tool-autonomy`).
export function collectAllToolCalls(
  result: GenerateTextOutcome,
): GenerateTextOutcome["toolCalls"] {
  const fromSteps = result.steps?.flatMap((s) => s.toolCalls ?? []);
  return fromSteps && fromSteps.length > 0
    ? fromSteps
    : (result.toolCalls ?? []);
}

export function collectAllToolResults(
  result: GenerateTextOutcome,
): GenerateTextOutcome["toolResults"] {
  const fromSteps = result.steps?.flatMap((s) => s.toolResults ?? []);
  return fromSteps && fromSteps.length > 0
    ? fromSteps
    : (result.toolResults ?? []);
}


/**
 * #131 Phase 3.4.3.1 Big-Bang: scannt das Vercel-`generateText`-Result auf
 * `tool-approval-request`-Parts und extrahiert die Resume-History-Daten.
 *
 * Step-Walk: der Part lebt in `result.steps[i].content[]` (Spike §r hat
 * verifiziert: identisch dupliziert in `result.content[]`, aber Step-Walk
 * ist robust gegen Multi-Step-Iterationen). Erstes Match gewinnt — bei
 * mehreren parallelen Approval-Requests wäre Re-Approval-Chain via
 * priorAuditId-Link nötig (Out of Scope für 3.4.3.1, gleicher Pattern
 * wie Phase 3.3.1.3.2-"erster Marker gewinnt").
 *
 * Resume-History braucht assistantContent (komplettes step.content-Array
 * mit tool-call + tool-approval-request) damit das SDK den Pending-Request
 * via approvalId matchen kann. Spike Test 2 hat das verifiziert (Iteration
 * 1 brach mit AI_InvalidToolApprovalError, Fix war assistantContent-
 * Persistierung).
 */
function detectToolApprovalRequest(
  result: GenerateTextOutcome,
): {
  approvalId: string;
  toolCallId: string;
  toolName: string;
  toolInput: unknown;
  assistantContent: unknown;
} | null {
  const steps = result.steps ?? [];
  for (const step of steps) {
    const content = step.content as Array<Record<string, unknown>> | undefined;
    if (!Array.isArray(content)) continue;
    for (const part of content) {
      if (part?.type !== "tool-approval-request") continue;
      const approvalId =
        typeof part.approvalId === "string" ? part.approvalId : null;
      const toolCall = part.toolCall as
        | { toolCallId?: string; toolName?: string; input?: unknown }
        | undefined;
      if (!approvalId || !toolCall) continue;
      const toolCallId =
        typeof toolCall.toolCallId === "string" ? toolCall.toolCallId : null;
      const toolName =
        typeof toolCall.toolName === "string" ? toolCall.toolName : null;
      if (!toolCallId || !toolName) continue;
      return {
        approvalId,
        toolCallId,
        toolName,
        toolInput: toolCall.input ?? {},
        assistantContent: content,
      };
    }
  }
  return null;
}

/**
 * 3.2.F: vorlautet die Wartemeldung an den User, wenn ein Tool-Call auf
 * Approval wartet. Bewusst kurz; Inline-Tool-Args helfen dem User, das in
 * der Inbox/Chat-Warteschlange zuzuordnen.
 */
function composeToolApprovalRequest(
  toolName: string,
  args: Record<string, unknown>,
): string {
  let argsPreview: string;
  try {
    argsPreview = JSON.stringify(args);
  } catch {
    argsPreview = "(args nicht serialisierbar)";
  }
  if (argsPreview.length > 200) argsPreview = argsPreview.slice(0, 197) + "…";
  return (
    `Ich möchte das Tool '${toolName}' mit Argumenten ${argsPreview} nutzen, ` +
    `brauche aber deine Genehmigung. Bitte schau in der Inbox.`
  );
}

/**
 * 3.2.H Patch: summiert Token-Stats aus zwei `generateText`-Calls (erster
 * Call mit forciertem Tool, zweiter Call für Final-Text). AI SDK 6 hält die
 * Felder `inputTokens`/`outputTokens`/`totalTokens` als optional-number; wir
 * addieren defensiv mit 0-Default und behalten alle übrigen Felder aus dem
 * ersten Call (z.B. cached-Tokens-Varianten je nach Provider) bei.
 *
 * Form-Toleranz: nicht-numerische Werte fallen auf 0 zurück, damit ein
 * Provider-Update mit anderem Schema uns nicht crasht.
 */
function mergeTokenUsage(
  a: GenerateTextOutcome["usage"],
  b: GenerateTextOutcome["usage"],
): GenerateTextOutcome["usage"] {
  const sum = (x: number | undefined, y: number | undefined) =>
    (typeof x === "number" ? x : 0) + (typeof y === "number" ? y : 0);
  return {
    ...a,
    inputTokens: sum(a.inputTokens, b.inputTokens),
    outputTokens: sum(a.outputTokens, b.outputTokens),
    totalTokens: sum(a.totalTokens, b.totalTokens),
  };
}

/**
 * 3.2.F: konvertiert die MCP-Tool-Result-Content-Liste in einen einzeiligen
 * String, damit wir ihn dem Resume-LLM als Klartext-Kontext servieren können.
 * Text-Parts werden konkateniert, andere Content-Typen (z.B. image) werden
 * als JSON serialisiert — die Pilot-Tools liefern alle Text.
 */
function stringifyToolContent(content: unknown): string {
  if (!Array.isArray(content)) {
    try {
      return JSON.stringify(content);
    } catch {
      return String(content);
    }
  }
  const parts = content.map((p: unknown) => {
    if (p && typeof p === "object" && "text" in p && typeof (p as { text?: unknown }).text === "string") {
      return (p as { text: string }).text;
    }
    try {
      return JSON.stringify(p);
    } catch {
      return String(p);
    }
  });
  return parts.join(" ");
}

function extractMessages(entry: { input: Record<string, unknown> }, key: string): ChatMessage[] {
  const value = entry.input[key];
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`Audit-Input enthält keine "${key}"-Liste`);
  }
  return value as ChatMessage[];
}

/**
 * Konvertiert unser kompakt-internes ChatMessage-Format ins ModelMessage-Shape
 * des Vercel AI SDK. Wir filtern hier defensiv `system`-Rollen heraus — die
 * Persona kommt über den `system`-Parameter von `generateText`, system-Slots
 * im messages-Array sind in der neuen API verboten/redundant.
 */
export function toModelMessages(messages: ChatMessage[]): ModelMessage[] {
  return messages
    .filter((m) => m.role !== "system")
    .map((m) => {
      // Multimodal SS3a (Anthropic-Pfad): NUR wenn die Message Attachments
      // trägt, bauen wir das Content-Array [Text-Part, …Image-Parts]. Bytes
      // werden hier zur Call-Zeit aus dem Store geladen (loadAttachmentBytes),
      // nie aus der Message gelesen (die hält nur die `ref`). Vercel-SDK +
      // @ai-sdk/anthropic akzeptieren ImagePart { type:'image', image, mediaType }.
      // 🔴 Codex-Pfad (mapV3PromptToCodex) bleibt unberührt — das ist SS3b.
      if (m.attachments && m.attachments.length > 0) {
        const parts: unknown[] = [];
        // Leeren Text-Part vermeiden (Anthropic mag keine leeren Text-Blocks).
        if (m.content) parts.push({ type: "text", text: m.content });
        for (const a of m.attachments) {
          parts.push(buildImagePart(a));
        }
        return { role: m.role, content: parts } as unknown as ModelMessage;
      }

      // 🔴 Abwärtskompatibel: ohne Attachments exakt wie bisher.
      // #131 Phase 3.4.3.1 Big-Bang: History-Replay-Messages haben role
      // "tool" und content-Array (tool-approval-response). assistant-
      // Messages aus V3-Pause haben auch content-Array (tool-call + tool-
      // approval-request). Beide Shapes pass-throughed, weil Vercel-SDK
      // sie native akzeptiert (V3-ModelMessage-Spec). Cast über unknown
      // weil ChatMessage-Type (twin-lab-intern) nur String-content kennt.
      return {
        role: m.role,
        content: m.content,
      } as unknown as ModelMessage;
    });
}

/**
 * Baut aus einem Attachment den Vercel-SDK-ImagePart. Lädt die Bytes über die
 * Storage-Naht (SS3a: Test-Stub; SS2: echter /data-Store). `mediaType` kommt
 * aus dem Schema-Feld `mimeType`.
 */
function buildImagePart(a: Attachment): {
  type: "image";
  image: Buffer;
  mediaType: string;
} {
  return {
    type: "image",
    image: loadAttachmentBytes(a.ref),
    mediaType: a.mimeType,
  };
}

/**
 * #131 Phase 3.4.3.1 Sub-Phase G Fix: assistantContent aus dem Provider-
 * Output (LanguageModelV3-Spec) hat ein anderes Schema als die
 * `AssistantContent`-Form, die Vercel `generateText` für History-Replay
 * erwartet:
 *
 * - **tool-call.input**: V3 liefert `string` (JSON-stringified), V4 erwartet
 *   `unknown` (Object). Wir parsen den JSON-String.
 * - **tool-call.providerMetadata**: V3 hat das Feld, V4-AssistantContent
 *   nicht. Weglassen.
 * - **tool-approval-request.providerMetadata**: dito.
 * - **Andere Parts (text, reasoning, file)**: pass-through, V3 + V4 sind
 *   kompatibel.
 *
 * Defensive Filter — unbekannte Part-Types werden verworfen statt
 * durchgereicht, damit Vercel-SDK-Validation nicht bricht.
 */
function mapAssistantContentForModelMessage(
  raw: unknown,
): Array<Record<string, unknown>> {
  if (!Array.isArray(raw)) return [];
  const out: Array<Record<string, unknown>> = [];
  for (const part of raw) {
    if (!part || typeof part !== "object") continue;
    const p = part as Record<string, unknown>;
    const type = p.type;
    if (type === "text") {
      out.push({ type: "text", text: typeof p.text === "string" ? p.text : "" });
    } else if (type === "tool-call") {
      // V3 input ist JSON-String, V4 will Object — parse defensive
      let parsedInput: unknown = p.input;
      if (typeof p.input === "string") {
        try {
          parsedInput = JSON.parse(p.input);
        } catch {
          parsedInput = p.input; // fallback: roher String
        }
      }
      out.push({
        type: "tool-call",
        toolCallId: typeof p.toolCallId === "string" ? p.toolCallId : "",
        toolName: typeof p.toolName === "string" ? p.toolName : "",
        input: parsedInput,
      });
    } else if (type === "tool-approval-request") {
      out.push({
        type: "tool-approval-request",
        approvalId: typeof p.approvalId === "string" ? p.approvalId : "",
        toolCallId:
          typeof p.toolCallId === "string"
            ? p.toolCallId
            : ((p.toolCall as { toolCallId?: string } | undefined)?.toolCallId ??
              ""),
      });
    } else if (type === "reasoning") {
      out.push({ type: "reasoning", text: typeof p.text === "string" ? p.text : "" });
    }
    // Unbekannte Parts (file, source, ...) verworfen — Approval-Flow braucht
    // sie nicht.
  }
  return out;
}

// ─── CAPABILITY DETECTION ────────────────────────────────────────────────────
//
// Phase 2: erweitert um send_to_twin, das zusätzlich einen targetHandle aus
// dem Text zieht. Weiterhin keyword-basiert; reicht für Phase 2, später kann
// das auch ein eigener Detector-Pass mit Modell sein.

export type CapabilityDetectionResult =
  | { capability: "respond_to_chat" }
  | { capability: "draft_linkedin_post" }
  | { capability: "summarize_topic" }
  | { capability: "send_to_twin"; targetHandle: string }
  | {
      capability: "reverse_memory_query";
      /** Zeitbezug in der Frage (Typ a). Undefined = Stichwort-Rückschau (Typ b). */
      reverseTimeframe?: ReverseTimeframe;
    };

/** Reverse-Memory-Query Typ a: erkanntes Zeitfenster der Rückschau-Frage. */
export type ReverseTimeframe = "week" | "month" | "recent";

const KNOWN_HANDLES: Record<string, string> = {
  florian: "@florian",
  markus: "@markus",
  dev: "@dev",
};

/**
 * Sende-Trigger-Verben für die send_to_twin-Capability-Erkennung. Modul-Konstante
 * (statt lokal in detectCapability), damit der Weg-3-Hint in runOwnerDirect
 * exakt dieselbe Liste prüft — eine Quelle, kein Drift.
 */
const SEND_TRIGGERS = ["sende", "schicke", "frag ", "frage ", "schreib", "kontaktier"];

export function detectCapability(userMessage: string): CapabilityDetectionResult {
  const lower = userMessage.toLowerCase();

  // 1. send_to_twin: Trigger-Wort + Empfänger erkennbar
  const hasSendTrigger = SEND_TRIGGERS.some((t) => lower.includes(t));
  if (hasSendTrigger) {
    const target = detectTargetHandle(userMessage);
    if (target) {
      return { capability: "send_to_twin", targetHandle: target };
    }
  }

  // 2. LinkedIn-Drafts: bewusst eng triggern, damit nicht jede Frage zu LinkedIn
  // versehentlich pending wird.
  const isLinkedInDraft =
    (lower.includes("linkedin") || lower.includes("li-post") || lower.includes("li post")) &&
    (lower.includes("draft") ||
      lower.includes("entwurf") ||
      lower.includes("schreib mir") ||
      lower.includes("schreib einen") ||
      lower.includes("formulier") ||
      lower.includes("post zu") ||
      lower.includes("post über"));

  if (isLinkedInDraft) return { capability: "draft_linkedin_post" };

  // 3. Zusammenfassungen
  const isSummary =
    lower.includes("fass zusammen") ||
    lower.includes("zusammenfassung") ||
    lower.includes("summarize");

  if (isSummary) return { capability: "summarize_topic" };

  // 4. Reverse-Memory-Query (Lebens-Narrativ Stufe 1): reaktive Rückschau auf
  //    eigene frühere Äußerungen/Themen. Signal-basiert statt fixe Phrasen,
  //    damit eingeschobene Zeitangaben („was hab ich LETZTE WOCHE über X
  //    gesagt") nicht die Erkennung brechen. Bewusst BREIT (first-person-Owner-
  //    phrasiert, geringe A2A-Fehlauslöse-Gefahr) — der Synthese-Prompt ist eh
  //    ehrlich bei Fehltreffern.
  if (isReverseMemoryQuery(lower)) {
    return {
      capability: "reverse_memory_query",
      reverseTimeframe: detectReverseTimeframe(lower),
    };
  }

  // Default: normale Chat-Antwort
  return { capability: "respond_to_chat" };
}

/**
 * Reverse-Query-Erkennung (signal-basiert, robust gegen eingeschobene
 * Zeitangaben). Drei Wege: (1) direkte Memory-Adresse an den Twin
 * („erinnerst du", „weißt du noch"); (2) First-Person-Vergangenheit („hab ich")
 * + Recall-Wort („über"/„gesagt"/…); (3) „beschäftigt … mich".
 */
function isReverseMemoryQuery(lower: string): boolean {
  const memoryAddress =
    lower.includes("erinnerst du") ||
    lower.includes("weißt du noch") ||
    lower.includes("was weißt du über") ||
    lower.includes("weißt du noch über");
  if (memoryAddress) return true;

  const firstPersonPast =
    lower.includes("hab ich") ||
    lower.includes("habe ich") ||
    lower.includes("worüber hab") ||
    lower.includes("worüber habe");
  const recallWord =
    lower.includes("über") ||
    lower.includes("gesagt") ||
    lower.includes("erzählt") ||
    lower.includes("erwähnt") ||
    lower.includes("gedacht");
  if (firstPersonPast && recallWord) return true;

  // „was hat mich … beschäftigt" / „womit beschäftige ich mich"
  if (lower.includes("beschäftig") && lower.includes("mich")) return true;

  return false;
}

/**
 * Zeitbezug einer Reverse-Query erkennen → Typ a (Zeitfenster). Kein Treffer →
 * undefined (Typ b, Stichwort-Rückschau). Reine Keyword-Heuristik; das konkrete
 * `since`-Datum berechnet der Send-Path (braucht „jetzt").
 */
function detectReverseTimeframe(lower: string): ReverseTimeframe | undefined {
  if (
    lower.includes("diese woche") ||
    lower.includes("letzte woche") ||
    lower.includes("letzten woche") ||
    lower.includes("vergangene woche")
  ) {
    return "week";
  }
  if (
    lower.includes("diesen monat") ||
    lower.includes("dieser monat") ||
    lower.includes("letzten monat") ||
    lower.includes("letzter monat") ||
    lower.includes("vergangenen monat")
  ) {
    return "month";
  }
  if (
    lower.includes("in letzter zeit") ||
    lower.includes("in der letzten zeit") ||
    lower.includes("letzte tage") ||
    lower.includes("letzten tagen") ||
    lower.includes("kürzlich") ||
    lower.includes("neulich") ||
    lower.includes("zuletzt")
  ) {
    return "recent";
  }
  return undefined;
}

/** Reverse-Query Typ a: Zeitfenster → since-ISO relativ zu `now`. */
export function reverseTimeframeToSinceIso(
  timeframe: ReverseTimeframe,
  now: Date,
): string {
  const days = timeframe === "week" ? 7 : timeframe === "month" ? 30 : 14;
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000).toISOString();
}

/**
 * Rückblick-System-Block für die Synthese-Schicht. Enthält die harte
 * Anti-Halluzinations-Leitplanke (ehrlich bei dünnem/leerem Korpus) + die
 * gefundenen Treffer als zu verdichtende Substanz. Self-contained, damit
 * synthesizeRetrospective (und später Stufe 3) ihn 1:1 nutzen kann.
 */
export function buildRetrospectiveDirective(
  ownerName: string,
  memories: RetrievalResult[],
): string {
  const parts: string[] = [
    `Der Owner (${ownerName}) fragt nach einer Rückschau über seine eigenen früheren Äußerungen/Themen. Fasse zusammen, was sich über die gefundenen Erinnerungs-Treffer hinweg ergibt — Themen, Entwicklungen, Wiederkehrendes. Erfinde NICHTS, was nicht in den Treffern steht; wenn die Treffer dünn sind, sage das ehrlich („dazu finde ich wenig"). Antworte in ${ownerName}' Stimme, als sein Twin.`,
    "",
  ];

  if (memories.length === 0) {
    parts.push(
      "## Gefundene Erinnerungen",
      "",
      "(keine Treffer — sage ehrlich, dass du dazu wenig/nichts in deinen Erinnerungen findest; erfinde nichts)",
    );
    return parts.join("\n");
  }

  parts.push("## Gefundene Erinnerungen (rückblickend zu verdichten)", "");
  memories.forEach((m, i) => {
    // created_at als Datum (YYYY-MM-DD) für den zeitlichen Verlauf; Content
    // byte-verbatim, damit der Anti-Halluzinations-Tenor nicht zum Ausschmücken
    // einlädt.
    const date = m.createdAt ? m.createdAt.slice(0, 10) : "?";
    parts.push(`### Treffer ${i + 1} — ${m.targetType} (${date})`, m.content.trim(), "");
  });
  return parts.join("\n").trimEnd();
}

function detectTargetHandle(text: string): string | null {
  // 1. Explizites @handle gewinnt — "frag @florian", "an @dev"
  const atMatch = text.match(/@([a-zA-Z0-9_-]+)/);
  if (atMatch?.[1]) return `@${atMatch[1].toLowerCase()}`;

  // 2. Bekannte Klartext-Namen mit Wortgrenzen
  for (const [name, handle] of Object.entries(KNOWN_HANDLES)) {
    if (new RegExp(`\\b${name}\\b`, "i").test(text)) return handle;
  }
  return null;
}
