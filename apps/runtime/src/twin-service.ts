import type {
  AuditEntry,
  AuditToolCall,
  ChatMessage,
  ForcedToolChoice,
  Mandate,
  MemoryHit,
  Persona,
  Skill,
} from "@twin-lab/shared";
import {
  generateObject,
  generateText,
  stepCountIs,
  type LanguageModel,
  type ModelMessage,
  type StopCondition,
  type ToolSet,
} from "ai";
import type Database from "better-sqlite3";
import { checkMandate } from "./mandates/service.js";
import { AuditService } from "./audit/service.js";
import type { EventBus } from "./events/bus.js";
import type { BridgeClient } from "./bridge/client.js";
import { BridgeError } from "./bridge/client.js";
import type { BridgeMessage } from "./bridge/types.js";
import type { TrustRepo } from "./trust/trust-repo.js";
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
  auditsToOwnerDirectMessagesChronological,
  buildSummaryBlock,
  loadConversationHistory,
} from "./conversations/history-loader.js";
import type { McpServersRepo } from "./mcp/repo.js";
import type { McpClientFactory } from "./mcp/client-factory.js";
import type { FactsRepo } from "./facts/repo.js";
import {
  aggregateConversationForEmbedding,
  type MemoryEmbeddingService,
} from "./episodic/memory-embedding-service.js";
import type { MemoryRetrievalService } from "./episodic/memory-retrieval-service.js";
import { buildEpisodicBlock } from "./episodic/prompt-builder.js";
import type { TwinDiaryService } from "./episodic/twin-diary-service.js";
import { buildFactsBlock } from "./facts/prompt-builder.js";
import {
  ExtractionEngine,
  ExtractionResultSchema,
  type ExtractionResult,
} from "./facts/extraction-engine.js";
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
    this.memoryEmbeddingService = deps.memoryEmbeddingService;
    this.memoryRetrievalService = deps.memoryRetrievalService;
    this.twinDiaryService = deps.twinDiaryService;
    this.profilesRepo = new TwinProfilesRepo(deps.db);
  }

  /**
   * 3.4.D: Reset-Pfad mit Episodic-Memory-Pflege. Wenn die Konversation
   * bereits Summary-Segments hat, sind die schon embedded (Send-Path
   * triggert nach jeder Summary-Generation) — wir beenden nur die Konv.
   * Ohne Segments (kurze Konversationen unter dem Threshold) wird die
   * ganze Konversation in einen einzelnen Embedding-Eintrag verdichtet,
   * sonst gäbe es keine Spur im Episodic-Memory.
   *
   * Failure-Verhalten: Embedding-Fehler unterbrechen das Reset nicht; der
   * Service schluckt sie und setzt status='failed'.
   */
  async resetConversation(conversationId: string): Promise<void> {
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
    }
    this.deps.conversations.end(conversationId);
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
    const detection = detectCapability(lastUser);

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
      const reply = await this.runModel(persona, messages);
      await this.deps.audit.complete(audit.id, {
        reply: reply.content,
        providerMetadata: reply.metadata,
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
    // #71b/#80: Direct-Chat-Audits werden mit der aktiven Konversation
    // verknüpft. ownerUserId muss gesetzt sein, weil Owner-Bypass nur greift
    // wenn requesterUserId === ownerUserId — der `chat()`-Caller stellt das
    // sicher. Defensive Sanity-Prüfung trotzdem, damit ein vergessener
    // Test-Pfad nicht still mit conversation_id=NULL durchläuft.
    let conversationId: string | null = null;
    let history: ChatMessage[] = [];
    let summaries: ConversationSummary[] = [];
    if (this.deps.ownerUserId) {
      const conv = this.deps.conversations.getOrStart(
        this.deps.ownerUserId,
        this.deps.persona.handle.startsWith("@")
          ? this.deps.persona.handle
          : `@${this.deps.persona.handle}`,
        this.deps.twinId,
      );
      conversationId = conv.id;
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
    const episodicBlock = buildEpisodicBlock(episodicMemories);

    try {
      const reply = await this.runModel(
        this.deps.persona,
        llmMessages,
        undefined,
        {
          enableMcpTools: true,
          forcedToolChoice: options.forcedToolChoice,
          summaryBlock: buildSummaryBlock(summaries),
          factsBlock,
          episodicBlock,
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

  // ─── Owner-Direct-Send (User-initiierte A2A) ──────────────────────────────
  //
  // Wird von POST /twins/:handle/conversations/:partnerHandle/send aufgerufen.
  // Owner ist eingeloggt, hat selbst getippt — kein Mandate-Check, kein
  // Approval-Loop. Direkter Bridge-Send mit messageType="twin".
  //
  // inReplyTo optional: in der Conversation-View setzt das Frontend das auf
  // die letzte empfangene Nachricht, damit der Empfänger das via Reply-
  // Detection als Antwort erkennt und keinen neuen Pending erzeugt.

  async ownerDirectSend(opts: {
    toHandle: string;
    content: string;
    inReplyTo?: string | null;
  }): Promise<{ messageId: string; auditId: string; sentAt: string }> {
    if (!this.deps.bridgeClient) {
      throw new Error("Bridge-Modus ist nicht aktiv — owner-direct-send nicht möglich");
    }
    const sentAt = new Date().toISOString();
    const audit = await this.deps.audit.start({
      capability: "owner-direct-send",
      mandateId: null,
      input: {
        toHandle: opts.toHandle,
        content: opts.content,
        inReplyTo: opts.inReplyTo ?? null,
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
        inReplyTo: opts.inReplyTo ?? null,
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

    // 2. Reply-Detection (2.5.4.2): wenn die Nachricht inReplyTo-set hat
    // UND die referenzierte Original-Message von uns gesendet wurde, ist die
    // neue Nachricht eine Antwort. Kein Mandate-Check, kein neuer Pending —
    // sondern reply-received-Audit + SSE-Event für die Sidebar.
    //
    // Failsafe: bei Bridge-Lookup-Fehler (Network down etc.) loggen wir und
    // fallen auf den TrustLevel-Pfad zurück. Lieber doppelt verarbeiten als
    // eine echte Anfrage fälschlich verschlucken.
    if (msg.inReplyTo) {
      let originalSender: { fromHandle: string } | null = null;
      let lookupFailed = false;
      try {
        originalSender = await this.deps.bridgeClient.lookupSender(msg.inReplyTo);
      } catch (err) {
        lookupFailed = true;
        const reason = err instanceof Error ? err.message : String(err);
        console.warn(
          `[twin] lookupSender(${msg.inReplyTo}) fehlgeschlagen: ${reason} — failsafe auf TrustLevel-Pfad`,
        );
      }
      if (
        !lookupFailed &&
        originalSender &&
        originalSender.fromHandle.toLowerCase() ===
          this.deps.bridgeClient.handle.toLowerCase()
      ) {
        // Antwort auf eine Message von uns → reply-received.
        const audit = await this.deps.audit.start({
          capability: "reply-received",
          mandateId: null,
          input: {
            bridgeMessageId: msg.id,
            fromHandle: msg.fromHandle,
            content: msg.content,
            inReplyTo: msg.inReplyTo,
            receivedAt: new Date().toISOString(),
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
        return;
      }
      // Sonst: lookup === null oder fromHandle !== uns → fällt durch zum
      // normalen Pfad. Auch bei lookupFailed: failsafe weiter.
    }

    // 3. Trust-Level checken — Hot-Path-Lookup über (twin_id, trusted_handle).
    const trusted = this.deps.trustRepo.isTrusted(this.deps.twinId, msg.fromHandle);
    if (trusted) {
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
        content: input.assistantContent,
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
        content: input.assistantContent,
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

  private async approveDefault(entry: AuditEntry, persona: Persona): Promise<ApproveResult> {
    const messages = extractMessages(entry, "messages");
    this.deps.bus.emit({ type: "twin.thinking", payload: { capability: entry.capability } });
    try {
      const reply = await this.runModel(persona, messages);
      await this.deps.audit.complete(entry.id, {
        reply: reply.content,
        providerMetadata: reply.metadata,
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
      throw new Error("Bridge-Modus ist nicht aktiv — send_to_twin nicht möglich");
    }
    const targetHandle = (entry.input as { targetHandle?: string }).targetHandle;
    if (!targetHandle) {
      throw new Error(`Audit ${entry.id} hat keinen targetHandle`);
    }
    const messages = extractMessages(entry, "messages");

    this.deps.bus.emit({ type: "twin.thinking", payload: { capability: entry.capability } });
    try {
      const reply = await this.runModel(persona, messages);
      const sent = await this.deps.bridgeClient.sendMessage({
        to: targetHandle,
        content: reply.content,
      });
      await this.deps.audit.complete(entry.id, {
        reply: reply.content,
        sentMessageId: sent.messageId,
        targetHandle,
        providerMetadata: reply.metadata,
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
      throw new Error("Bridge-Modus ist nicht aktiv — respond_to_twin_message nicht möglich");
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
        inReplyTo: input.bridgeMessageId,
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
        inReplyTo: msg.id,
      });
      await this.deps.audit.complete(audit.id, {
        reply: reply.content,
        sentMessageId: sent.messageId,
        targetHandle: msg.fromHandle,
        providerMetadata: reply.metadata,
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
    return (
      `Du führst gerade eine Konversation mit dem Twin ${fromHandle} über die Bridge.\n` +
      `Beziehe dich auf den Verlauf. Wenn der andere Twin auf eine deiner früheren\n` +
      `Nachrichten antwortet, geh konkret darauf ein — frag nicht nach dem Worum-geht's,\n` +
      `das weißt du selbst.`
    );
  }

  // ─── private helpers ─────────────────────────────────────────────────────


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
    const hasTools = Object.keys(mcpTools).length > 0;
    if (hasTools) {
      console.log(
        `[mcp:tools] passing ${Object.keys(mcpTools).length} tool(s) to LLM (twin=${this.deps.twinId})`,
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
          availableToolKeys: new Set(Object.keys(mcpTools)),
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
      mcpTools[effectiveForcedToolChoice.toolName] !== undefined
        ? effectiveForcedToolChoice
        : null;
    if (effectiveForcedToolChoice && !forcedTool) {
      console.warn(
        `[mcp:tools] forcedToolChoice ${effectiveForcedToolChoice.toolName} ` +
          `nicht im aktiven Tool-Set — fallback auf toolChoice='auto'`,
      );
    }
    const result = await generateText({
      model: activeModel,
      system,
      messages: toModelMessages(messages),
      ...(hasTools
        ? {
            tools: mcpTools,
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
        tools: mcpTools,
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
        output: matchingResult ? matchingResult.output : null,
      };
    });

    const finalText = followupResult ? followupResult.text : result.text;
    const finalFinishReason = followupResult
      ? followupResult.finishReason
      : result.finishReason;
    const mergedUsage = followupResult
      ? mergeTokenUsage(result.usage, followupResult.usage)
      : result.usage;

    return {
      content: finalText,
      metadata: {
        provider: activeModelLabel,
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

  private async failWithReason(auditId: string, err: unknown): Promise<void> {
    const reason = err instanceof Error ? err.message : String(err);
    await this.deps.audit.fail(auditId, reason);
    this.deps.bus.emit({ type: "twin.idle", payload: {} });
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
 * Composition des Owner-Direct-System-Prompts.
 *
 * Sieben Schichten, Reihenfolge bewusst:
 *   1. extraSystem (situativer Bridge-Kontext, optional)
 *   2. persona.systemPrompt + factsBlock (combined — Facts sind Persona-
 *      konstitutiv und profitieren von der Attention-Position am
 *      Prompt-Anfang, 3.3.E)
 *   3. skillsBlock (Skill-Erweiterungen, ergänzen Persona — nur Manual-Skills,
 *      `null` im Codex-Pfad bis Phase 3.3 Tool-Use nachzieht)
 *   4. toolUseDirective (Anti-Halluzination-Regeln, nur bei aktivem Tool-Set,
 *      `null` im Codex-Pfad bis Phase 3.3)
 *   5. LANGUAGE_DIRECTIVE (Anti-„weiss"-statt-„weiß", gilt für alle Twins)
 *   6. summaryBlock (3.3.C — verdichtete Vorgeschichte der LAUFENDEN Konv)
 *   7. episodicBlock (3.4.E — Top-K Erinnerungen aus VERGANGENEN Konv + Diary)
 *
 * `null`-Schichten werden via `.filter(Boolean)` rausgeworfen. Konsumenten:
 * `runModel` (Vercel-AI-SDK-Pfad mit allen 7 Schichten) und
 * `runModelViaCodex` (OAuth-Codex-Pfad ohne Schicht 3+4 in Phase 3.2).
 *
 * #131 Phase 3.2: extrahiert aus runModel, damit beide Pfade strukturell
 * dieselbe Composition haben und neue Schichten nicht nur in einem Pfad
 * eingebaut werden (Drift-Prevention).
 */
function composeOwnerSystemPrompt(parts: {
  persona: Persona;
  extraSystem: string | null | undefined;
  factsBlock: string | null | undefined;
  skillsBlock: string | null | undefined;
  toolUseDirective: string | null | undefined;
  summaryBlock: string | null | undefined;
  episodicBlock: string | null | undefined;
}): string {
  const personaWithFacts = parts.factsBlock
    ? `${parts.persona.systemPrompt}\n\n${parts.factsBlock}`
    : parts.persona.systemPrompt;
  return [
    parts.extraSystem,
    personaWithFacts,
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
// Der Persistenz-Schema lebt zentral in `@twin-lab/shared`
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
function toModelMessages(messages: ChatMessage[]): ModelMessage[] {
  return messages
    .filter((m) => m.role !== "system")
    .map((m) => {
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

// ─── CAPABILITY DETECTION ────────────────────────────────────────────────────
//
// Phase 2: erweitert um send_to_twin, das zusätzlich einen targetHandle aus
// dem Text zieht. Weiterhin keyword-basiert; reicht für Phase 2, später kann
// das auch ein eigener Detector-Pass mit Modell sein.

export type CapabilityDetectionResult =
  | { capability: "respond_to_chat" }
  | { capability: "draft_linkedin_post" }
  | { capability: "summarize_topic" }
  | { capability: "send_to_twin"; targetHandle: string };

const KNOWN_HANDLES: Record<string, string> = {
  florian: "@florian",
  markus: "@markus",
  dev: "@dev",
};

export function detectCapability(userMessage: string): CapabilityDetectionResult {
  const lower = userMessage.toLowerCase();

  // 1. send_to_twin: Trigger-Wort + Empfänger erkennbar
  const sendTriggers = ["sende", "schicke", "frag ", "frage ", "schreib", "kontaktier"];
  const hasSendTrigger = sendTriggers.some((t) => lower.includes(t));
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

  // Default: normale Chat-Antwort
  return { capability: "respond_to_chat" };
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
