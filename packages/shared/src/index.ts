import { z } from "zod";

// ─── PERSONA ─────────────────────────────────────────────────────────────────
//
// Die Persona definiert, *wer* der Twin ist: Stil, Themen, Tonalität.
// Phase 1: aus docs/persona.md geladen, einmalig im System-Prompt.
// Phase 2+: erweitert um Memory-Snippets, langfristig dynamisch.

export const PersonaSchema = z.object({
  name: z.string(),
  handle: z.string(), // z.B. "markus" — wird in Phase 3 zu @markus.twin
  systemPrompt: z.string(),
  metadata: z.record(z.string(), z.unknown()).default({}),
});

export type Persona = z.infer<typeof PersonaSchema>;

// ─── MANDATES ────────────────────────────────────────────────────────────────
//
// Mandates sind der Vertrag zwischen Mensch und Twin: was darf der Twin tun.
// Maschinen-prüfbar, aber für Menschen schreibbar.
//
// Beispiel:
//   capability: "draft_linkedin_post"
//   scope:      ["public", "private"]
//   conditions: { maxLength: 2000, requiresApproval: true }
//   escalation: "always_pending"

export const MandateScopeSchema = z.enum(["private", "connected", "public"]);

export const MandateSchema = z.object({
  id: z.string(),
  capability: z.string(), // z.B. "draft_linkedin_post", "summarize_inbox"
  description: z.string(),
  scope: z.array(MandateScopeSchema),
  conditions: z.record(z.string(), z.unknown()).default({}),
  escalation: z.enum(["auto", "always_pending", "above_threshold"]),
  createdAt: z.string().datetime(),
});

export type Mandate = z.infer<typeof MandateSchema>;
export type MandateScope = z.infer<typeof MandateScopeSchema>;

// ─── AUDIT ───────────────────────────────────────────────────────────────────
//
// Append-only Log aller Twin-Aktionen.
// Jeder Eintrag referenziert das Mandate, unter dem die Aktion lief.

export const AuditStatusSchema = z.enum([
  "pending",     // Aktion ist gestartet, wartet auf Mandate-Check
  "approved",    // Mandate-Check OK, Aktion läuft
  "executed",    // Aktion abgeschlossen
  "rejected",    // Vom Menschen abgelehnt vor Ausführung
  "blocked",     // Vom Mandate-System blockiert
  "failed",      // Technischer Fehler
]);

export const AuditEntrySchema = z.object({
  id: z.string(),
  twinId: z.string().nullable(), // null nur für Legacy-Rows aus Pre-2.5d
  timestamp: z.string().datetime(),
  capability: z.string(),
  mandateId: z.string().nullable(), // null wenn keine Mandate-Übereinstimmung
  status: AuditStatusSchema,
  input: z.record(z.string(), z.unknown()),
  output: z.record(z.string(), z.unknown()).nullable(),
  reason: z.string().nullable(), // Begründung bei rejected/blocked
  // 2.5.4.2: nur für 'reply-received' (und ggf. künftig andere Inbox-Typen)
  // gesetzt. NULL = noch nie gelesen, ISO-Timestamp = vom Owner via UI
  // bestätigt. Backward-compat: alte Rows haben das Feld nicht — Repository
  // mappt fehlende Spalte auf null.
  readAt: z.string().datetime().nullable().optional(),
  // #71b/#80: Verknüpfung zur conversations-Tabelle. In Sub-Schritt B nur für
  // capability='owner-direct' gesetzt; alle anderen Capabilities haben
  // conversation_id=NULL. Backward-compat: alte Audits aus Pre-Migration-009
  // haben die Spalte nicht — Repository mappt fehlende Spalte auf null.
  conversationId: z.string().nullable().optional(),
});

export type AuditEntry = z.infer<typeof AuditEntrySchema>;
export type AuditStatus = z.infer<typeof AuditStatusSchema>;

// ─── EVENTS ──────────────────────────────────────────────────────────────────
//
// Events werden vom Runtime via SSE an die UI gestreamt.
// Format ist absichtlich einfach: type + payload.

export const TwinEventSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("audit.created"),
    payload: AuditEntrySchema,
  }),
  z.object({
    type: z.literal("audit.updated"),
    payload: AuditEntrySchema,
  }),
  z.object({
    type: z.literal("twin.thinking"),
    payload: z.object({ capability: z.string() }),
  }),
  z.object({
    type: z.literal("twin.idle"),
    payload: z.object({}),
  }),
  z.object({
    type: z.literal("heartbeat"),
    payload: z.object({ timestamp: z.string().datetime() }),
  }),
  z.object({
    type: z.literal("bridge.message.received"),
    payload: z.object({
      auditId: z.string(),
      fromHandle: z.string(),
    }),
  }),
  z.object({
    type: z.literal("reply-received"),
    payload: z.object({
      auditId: z.string(),
      partnerHandle: z.string(),
      content: z.string(),
    }),
  }),
  // 2.5.4.3: gezielte Events für die Inbox-Badge — kein voller Audit-Reload
  // mehr nötig, das Frontend kann den Counter inkrementell halten.
  z.object({
    type: z.literal("pending-added"),
    payload: z.object({
      auditId: z.string(),
      capability: z.string(),
    }),
  }),
  z.object({
    type: z.literal("pending-resolved"),
    payload: z.object({
      auditId: z.string(),
      // executed | rejected | failed | blocked — Endstatus nach der Resolution
      status: AuditStatusSchema,
    }),
  }),
]);

export type TwinEvent = z.infer<typeof TwinEventSchema>;

// ─── CHAT ────────────────────────────────────────────────────────────────────

export const ChatMessageSchema = z.object({
  role: z.enum(["user", "assistant", "system"]),
  content: z.string(),
});

// 3.2.H: User-getriggerte Tool-Use über den Tool-Picker. Wenn gesetzt, reicht
// TwinService das Feld als `toolChoice` an `generateText` durch — AI SDK 6
// erzwingt damit den genannten Tool-Call. Default-Auto bleibt unverändert,
// wenn das Feld nicht gesetzt ist (LLM entscheidet selbst). Nur die Tool-Form
// wird heute unterstützt; 'required'/'none'/'auto' brauchen wir nicht, weil
// das LLM-Default-Verhalten der Picker explizit umgeht.
export const ForcedToolChoiceSchema = z.object({
  type: z.literal("tool"),
  toolName: z.string().min(1),
});
export type ForcedToolChoice = z.infer<typeof ForcedToolChoiceSchema>;

export const ChatRequestSchema = z.object({
  messages: z.array(ChatMessageSchema),
  forcedToolChoice: ForcedToolChoiceSchema.optional(),
});

// #100 Memory-Hit-Indikator: Slim-Projektion der internen `RetrievalResult`-
// Struktur für die Frontend-Anzeige. Score-Felder (rrfScore, vectorSimilarity,
// bm25Rank) bleiben backend-intern — User sieht eine Zahl + Snippets, kein
// Debugging-Telemetry.
export const MemoryHitTargetTypeSchema = z.enum([
  "conversation",
  "summary_segment",
  "diary_entry",
]);

export const MemoryHitSchema = z.object({
  targetType: MemoryHitTargetTypeSchema,
  content: z.string(),
  /** ISO-Timestamp des Embedding-Eintrags (≈ Datum der Erinnerung). */
  createdAt: z.string(),
});

export const ChatResponseSchema = z.object({
  message: ChatMessageSchema,
  auditId: z.string(),
  /** #100: Memory-Hits, die der Twin bei dieser Antwort konsultiert hat. */
  memoryHits: z.array(MemoryHitSchema).optional(),
});

export type ChatMessage = z.infer<typeof ChatMessageSchema>;
export type ChatRequest = z.infer<typeof ChatRequestSchema>;
export type ChatResponse = z.infer<typeof ChatResponseSchema>;
export type MemoryHit = z.infer<typeof MemoryHitSchema>;
export type MemoryHitTargetType = z.infer<typeof MemoryHitTargetTypeSchema>;

// 3.2.H: GET /twins/:handle/tools — Antwort-Format für den Tool-Picker. Pro
// aktivem MCP-Skill ein Eintrag mit dem AI-SDK-Tool-Key (`toolName`) und dem
// JSON-Schema, aus dem das Frontend die Args-Form generiert. serverName aus
// dem zugehörigen mcp_servers-Eintrag, requiresApproval aus dem Manifest.
export const TwinToolListItemSchema = z.object({
  skillId: z.string(),
  skillName: z.string(),
  toolName: z.string(),
  description: z.string().nullable(),
  inputSchema: z.unknown().nullable(),
  serverName: z.string(),
  requiresApproval: z.boolean(),
});
export type TwinToolListItem = z.infer<typeof TwinToolListItemSchema>;

export const TwinToolListResponseSchema = z.object({
  tools: z.array(TwinToolListItemSchema),
});
export type TwinToolListResponse = z.infer<typeof TwinToolListResponseSchema>;

// ─── CONVERSATIONS (Phase 3 / #71b + #80) ────────────────────────────────────
//
// Eine Konversation gruppiert Audits zu einer Direct-Chat- oder (später)
// Bridge-Chat-Session. Höchstens eine aktive pro (owner, partner, twin) —
// wird im Repo enforced. „Neue Konversation"-Aktion = alte enden, neue
// starten in einer Transaktion.

export const ConversationStatusSchema = z.enum(["active", "ended"]);
export type ConversationStatus = z.infer<typeof ConversationStatusSchema>;

export const ConversationSchema = z.object({
  id: z.string(),
  ownerUserId: z.string(),
  partnerHandle: z.string(),
  twinId: z.string(),
  status: ConversationStatusSchema,
  startedAt: z.string(),
  endedAt: z.string().nullable(),
  /**
   * #106: ISO-Timestamp des letzten Resets. NULL = nie zurückgesetzt
   * (brand-new Twin oder erste Konv). Frontend nutzt das im DirectChat,
   * um Audits mit `timestamp < lastResetAt` standardmäßig auszublenden.
   */
  lastResetAt: z.string().nullable(),
});
export type Conversation = z.infer<typeof ConversationSchema>;

export const ConversationStartInputSchema = z.object({
  ownerUserId: z.string(),
  partnerHandle: z.string(),
  twinId: z.string(),
  /** #106: Reset-Pfad gibt einen ISO-Timestamp mit; sonst null. */
  lastResetAt: z.string().nullable().optional(),
});
export type ConversationStartInput = z.infer<typeof ConversationStartInputSchema>;

// ─── SKILLS (Phase 3.1) ──────────────────────────────────────────────────────
//
// Skills bündeln Wissen + optional Script, das ein Twin im Rahmen einer
// Capability anwenden kann. Hybrid-Ansatz: maschinen-lesbares Manifest +
// Markdown-Instructions + optional Action-Script.
//
// Mandate bleibt auf Capability-Ebene (Twin darf "respond_to_chat"). Skills
// haben zusätzlich `requiresApproval` als Inner-Mandate, das die Engine in
// 3.1.B+ auswerten wird.

export const SkillSourceSchema = z.enum(["manual", "mcp"]);
export type SkillSource = z.infer<typeof SkillSourceSchema>;

export const SkillInputSchema = z.object({
  name: z.string(),
  type: z.enum(["string", "number", "boolean", "object"]),
  description: z.string(),
  required: z.boolean(),
});
export type SkillInput = z.infer<typeof SkillInputSchema>;

export const SkillOutputSchema = z.object({
  name: z.string(),
  type: z.enum(["string", "number", "boolean", "object"]),
  description: z.string(),
});
export type SkillOutput = z.infer<typeof SkillOutputSchema>;

export const SkillManifestSchema = z.object({
  name: z.string(),
  description: z.string(),
  capability: z.string(), // z.B. "respond_to_chat", "mcp_tool"
  requiresApproval: z.boolean(),
  inputs: z.array(SkillInputSchema).optional(),
  outputs: z.array(SkillOutputSchema).optional(),
  // 3.2.C: synthetisches Manifest für MCP-Tools. Manual-Skills haben diese
  // Felder nicht. version='auto-generated' macht den synthetischen Ursprung
  // im DB-Inhalt sichtbar (Listings/Debug); kein semantisches Versioning heute.
  version: z.string().optional(),
  mcpServerId: z.string().optional(),
  mcpToolName: z.string().optional(),
  mcpInputSchema: z.unknown().optional(),
});
export type SkillManifest = z.infer<typeof SkillManifestSchema>;

// ─── MCP TOOL DEFINITION (Phase 3.2.C) ───────────────────────────────────────
//
// Das, was ein MCP-Server via listTools() advertised. Wird in
// McpSkillSync zum Skill-Manifest gemappt; in 3.2.D landet das input_schema
// als Tool-Use-Schema im LLM-Prompt.

export const McpToolDefinitionSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  inputSchema: z.unknown(), // JSON-Schema-Object vom Server
});
export type McpToolDefinition = z.infer<typeof McpToolDefinitionSchema>;

// ─── MCP TOOL APPROVAL (Phase 3.2.F) ────────────────────────────────────────
//
// Pre-Call-Approval-Pattern: wenn LLM ein Tool mit requiresApproval=true
// ruft, wirft Tool-Bridge `McpToolApprovalRequiredError`. Twin-Service
// catcht das, persistiert die Tool-Call-Daten plus die Message-History
// dieser LLM-Session in einem Pending-Audit (capability='mcp-tool-use'),
// und antwortet dem User mit einer Wartemeldung. Beim Approve wird der
// Tool-Call ausgeführt und ein neuer LLM-Resume-Call gemacht — die
// History garantiert, dass der LLM den Kontext der ursprünglichen Frage
// hat. Persistenz via Audit ist Server-Restart-stabil.

export const AuditMcpToolUseInputSchema = z.object({
  messages: z.array(ChatMessageSchema),
  toolCall: z.object({
    mcpServerId: z.string(),
    mcpToolName: z.string(),
    args: z.record(z.string(), z.unknown()),
  }),
  conversationId: z.string().nullable(),
  // Pseudo-Twin-Antwort, mit der wir dem User die Wartemeldung schicken.
  // Im Audit-Output kommt später beim Approve die finale Antwort dazu.
  pendingReply: z.string(),
});
export type AuditMcpToolUseInput = z.infer<typeof AuditMcpToolUseInputSchema>;

// ─── AUDIT TOOL CALL (Phase 3.2.D) ───────────────────────────────────────────
//
// Tool-Use-Detail-Eintrag im Audit-Output. Wird vom AI-SDK-Loop pro Tool-
// Call erzeugt: toolName ist der Skill-Name (z.B. "mcp:everything:echo"),
// input ist das, was der LLM als Tool-Argument generiert hat (geparst aus
// dem Tool-Call-JSON), output ist die Server-Antwort. Feldnamen folgen der
// AI-SDK-6-Konvention (input/output, nicht args/result), damit der DB-Inhalt
// 1:1 mit den TypedToolCall/TypedToolResult-Feldern lesbar bleibt.

export const AuditToolCallSchema = z.object({
  toolName: z.string(),
  input: z.unknown(),
  output: z.unknown().nullable(),
});
export type AuditToolCall = z.infer<typeof AuditToolCallSchema>;

/**
 * Schmales UI-Payload-Format. Backend-Routes liefern die GET-/PATCH-Skill-
 * Antworten in dieser Form, statt das volle DB-Skill-Objekt durchzugeben.
 * Spart Bandbreite und schützt davor, dass Markdown-Instructions oder
 * Script-Code unnötig in die UI fließen.
 *
 * Timestamps als ISO-8601-Strings (DB hält epoch ms, Konvertierung im Server-
 * Handler) — konsistent mit Trust-Pattern, das ebenfalls strings nach außen
 * gibt.
 */
export const SkillUiPayloadSchema = z.object({
  skillId: z.string(),
  name: z.string(),
  description: z.string(),
  capability: z.string(),
  requiresApproval: z.boolean(),
  source: SkillSourceSchema,
  isActive: z.boolean(),
  instructionsLength: z.number().int().nonnegative(),
  hasScript: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type SkillUiPayload = z.infer<typeof SkillUiPayloadSchema>;

/**
 * #86: Detail-Payload für den Skill-Editor. Im Gegensatz zu
 * `SkillUiPayload` enthält dieses Shape `manifestJson`, `instructionsMd`
 * und `scriptTs` — alles was das Modal zum Prefill und Speichern braucht.
 * Listings bleiben beim schlanken UiPayload (kein Manifest/Markdown in
 * jedem Listing über die Leitung).
 */
export const SkillDetailPayloadSchema = SkillUiPayloadSchema.extend({
  manifestJson: SkillManifestSchema,
  instructionsMd: z.string(),
  scriptTs: z.string().nullable(),
});
export type SkillDetailPayload = z.infer<typeof SkillDetailPayloadSchema>;

/** #86: Request-Schema für POST /twins/:handle/skills. */
export const SkillCreateRequestSchema = z.object({
  /** Eindeutig pro Twin, ohne Whitespace. */
  name: z
    .string()
    .min(1)
    .max(200)
    .refine((s) => !/\s/.test(s), {
      message: "Name darf keinen Whitespace enthalten",
    }),
  description: z.string().min(1).max(500),
  manifestJson: SkillManifestSchema,
  instructionsMd: z.string().min(1),
  scriptTs: z.string().nullable().optional(),
});
export type SkillCreateRequest = z.infer<typeof SkillCreateRequestSchema>;

/**
 * #86: Request-Schema für PATCH /twins/:handle/skills/:skillId. Name ist
 * NICHT änderbar (vermeidet Konflikte mit MCP-Sync-Naming und schützt
 * gegen versehentliches Umbenennen von im System-Prompt referenzierten
 * Skills). isActive läuft weiter über die existierende Toggle-Route.
 */
export const SkillUpdateRequestSchema = z.object({
  description: z.string().min(1).max(500).optional(),
  manifestJson: SkillManifestSchema.optional(),
  instructionsMd: z.string().min(1).optional(),
  scriptTs: z.string().nullable().optional(),
});
export type SkillUpdateRequest = z.infer<typeof SkillUpdateRequestSchema>;

export const SkillSchema = z.object({
  skillId: z.string(),
  twinId: z.string(),
  name: z.string(),
  description: z.string(),
  manifestJson: SkillManifestSchema,
  instructionsMd: z.string(),
  scriptTs: z.string().nullable(),
  source: SkillSourceSchema,
  sourceMetadata: z.record(z.string(), z.unknown()).nullable(),
  // 3.2.C: nur bei source='mcp' gesetzt, sonst null. FK-CASCADE via Migration —
  // wenn der MCP-Server entfernt wird, fliegt der Skill automatisch raus.
  mcpServerId: z.string().nullable(),
  mcpToolName: z.string().nullable(),
  isActive: z.boolean(),
  createdAt: z.number(),
  updatedAt: z.number(),
});
export type Skill = z.infer<typeof SkillSchema>;

// ─── MCP SERVERS (Phase 3.2) ─────────────────────────────────────────────────
//
// Pro Twin konfigurierte MCP-Server. Die Tools, die ein Server bereitstellt,
// werden in späteren Sub-Schritten als Skills mit source: "mcp" registriert —
// diese Tabelle hält nur die Verbindungs-Konfiguration.
//
// `env` (Plain-Object mit ENV-Vars) wird im Repo verschlüsselt abgelegt
// (Master-Key, AES-256-GCM, analog zu llm_config.api_key_encrypted). Im
// McpServer-Listing-Output gibt's nur `hasEnv: boolean` als Signal — der
// Klartext kommt nur via getDecryptedEnv() raus, damit ENV-Secrets nicht
// versehentlich in Standard-Listings (und damit ins Frontend) leaken.

export const McpTransportSchema = z.enum(["stdio", "http"]);
export type McpTransport = z.infer<typeof McpTransportSchema>;

export const McpServerSchema = z.object({
  id: z.string(),
  twinId: z.string(),
  name: z.string(),
  transport: McpTransportSchema,
  // stdio: gesetzt; http: null
  command: z.string().nullable(),
  args: z.array(z.string()).nullable(),
  // Nur Signal — Klartext nur über getDecryptedEnv(id) im Repo.
  hasEnv: z.boolean(),
  // http: gesetzt; stdio: null
  url: z.string().nullable(),
  defaultRequiresApproval: z.boolean(),
  isActive: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type McpServer = z.infer<typeof McpServerSchema>;

export const McpServerAddInputSchema = z.object({
  twinId: z.string(),
  name: z.string().min(1).max(100),
  transport: McpTransportSchema,
  command: z.string().nullable().optional(),
  args: z.array(z.string()).nullable().optional(),
  // Plain-Object — wird im Repo verschlüsselt vor dem Insert.
  env: z.record(z.string(), z.string()).nullable().optional(),
  url: z.string().url().nullable().optional(),
  defaultRequiresApproval: z.boolean().optional(),
});
export type McpServerAddInput = z.infer<typeof McpServerAddInputSchema>;

// twinId/transport sind nach dem Anlegen immutable — Transport-Wechsel würde
// alle Felder rotieren und ist als „neu anlegen" sauberer.
export const McpServerUpdateInputSchema = McpServerAddInputSchema
  .omit({ twinId: true, transport: true })
  .partial();
export type McpServerUpdateInput = z.infer<typeof McpServerUpdateInputSchema>;

// ─── MCP SERVER UI-VERTRAG (#87) ─────────────────────────────────────────────
//
// Wire-Format für die MCP-Configurator-UI in Settings. Spec-Schema spiegelt
// die CLI-Spec (`scripts/_mcp-cli-helpers.ts → McpServerSpecSchema`) plus
// `env`-Validierung: keine Marker-`"?"`-Werte erlaubt, Frontend muss die
// vorher durch User-Input ersetzen. Listings geben NIEMALS sensitive Felder
// (command, args, url, env) zurück — env_json_encrypted bleibt server-only.

export const McpServerCreateRequestSchema = z.object({
  name: z.string().min(1).max(100),
  transport: McpTransportSchema,
  command: z.string().nullable().optional(),
  args: z.array(z.string()).nullable().optional(),
  url: z.string().url().nullable().optional(),
  env: z
    .record(z.string(), z.string())
    .nullable()
    .optional()
    .refine(
      (env) => !env || Object.values(env).every((v) => v !== "?"),
      {
        message:
          "env-Werte dürfen nicht den Marker '?' enthalten — Frontend muss User-Input einsetzen",
      },
    ),
  defaultRequiresApproval: z.boolean().optional(),
});
export type McpServerCreateRequest = z.infer<typeof McpServerCreateRequestSchema>;

/** Schmaler Listings-/Detail-Payload — keine Connection-Details, kein env. */
export const McpServerUiPayloadSchema = z.object({
  serverId: z.string(),
  name: z.string(),
  transport: McpTransportSchema,
  isActive: z.boolean(),
  defaultRequiresApproval: z.boolean(),
  /** Wieviele Skills mit `source='mcp'` von diesem Server stammen. */
  skillCount: z.number().int().nonnegative(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type McpServerUiPayload = z.infer<typeof McpServerUiPayloadSchema>;

// ─── FACTS (Phase 3.3 — Semantic-Memory KV-Store) ────────────────────────────
//
// API-Verträge für die Facts-Endpoints aus 3.3.D. Source/Confidence-Enums
// spiegeln die CHECK-Constraints aus Migration 014.
//
// factKey/factValue-Längen: bewusst großzügig (200 / 10000). Pilot-Facts sind
// kurz ("Anna", "Harway Experience"), aber Reserve für gelegentliche
// längere Werte (Adressen, Notizen) — ohne dass wir uns die Tabelle mit
// Volltext-Werten zumüllen.

export const FactSourceSchema = z.enum(["user", "twin", "import"]);
export type FactSource = z.infer<typeof FactSourceSchema>;

// 3.3.F: 'rejected' kommt dazu — wenn der User einen Twin-Vorschlag ablehnt,
// bleibt der Fact in der Tabelle mit confidence='rejected'. ExtractionEngine
// nutzt die rejected-Liste als Negativ-Beispiele im LLM-Prompt, damit der
// Twin denselben Vorschlag nicht im Loop erneut macht.
export const FactConfidenceSchema = z.enum([
  "approved",
  "pending",
  "auto",
  "rejected",
]);
export type FactConfidence = z.infer<typeof FactConfidenceSchema>;

export const FactItemSchema = z.object({
  id: z.string(),
  factKey: z.string(),
  factValue: z.string(),
  source: FactSourceSchema,
  confidence: FactConfidenceSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type FactItem = z.infer<typeof FactItemSchema>;

export const FactListResponseSchema = z.object({
  facts: z.array(FactItemSchema),
});
export type FactListResponse = z.infer<typeof FactListResponseSchema>;

export const FactCreateRequestSchema = z.object({
  factKey: z.string().min(1).max(200),
  factValue: z.string().min(1).max(10000),
  source: FactSourceSchema.optional().default("user"),
  confidence: FactConfidenceSchema.optional().default("approved"),
});
export type FactCreateRequest = z.infer<typeof FactCreateRequestSchema>;

export const FactUpdateRequestSchema = z.object({
  factValue: z.string().min(1).max(10000),
  confidence: FactConfidenceSchema.optional(),
});
export type FactUpdateRequest = z.infer<typeof FactUpdateRequestSchema>;

// 3.3.F: Twin-Fact-Extraction. Endpoint POST /twins/:handle/facts/extract
// triggert die ExtractionEngine; Approval läuft über den generischen Audit-
// Approve-Pfad (capability='semantic-fact-write').
export const FactExtractRequestSchema = z.object({
  conversationId: z.string().min(1),
});
export type FactExtractRequest = z.infer<typeof FactExtractRequestSchema>;

export const FactExtractResponseSchema = z.object({
  extracted: z.number().int().nonnegative(),
  pendingFactIds: z.array(z.string()),
});
export type FactExtractResponse = z.infer<typeof FactExtractResponseSchema>;

// ─── TWIN-REIFE (#101) ───────────────────────────────────────────────────────
//
// Heuristik aus vier Dimensionen (Konversationen, Facts, Themen-Vielfalt,
// Zeitspanne). „Themen-Vielfalt" wird durch Greedy-Cosine-Bucketing der
// summary_segment-Embeddings im Backend bestimmt — Frontend bekommt nur die
// Cluster-Zahl. Schwellen leben im Backend, Frontend rendert nur Strings.
//
// 3-von-4-Dimensionen-Regel: ein Twin erreicht Stufe X, sobald mindestens
// drei der vier Dimensionen auf Stufe X stehen. Damit kann eine schwache
// Dimension (z.B. wenige Facts) eine ansonsten reife Persona nicht ewig
// blocken.

export const MaturityLevelSchema = z.union([
  z.literal(0),
  z.literal(1),
  z.literal(2),
  z.literal(3),
]);
export type MaturityLevel = z.infer<typeof MaturityLevelSchema>;

export const MATURITY_LEVEL_LABELS: Record<MaturityLevel, string> = {
  0: "Onboarding",
  1: "Bewohnt",
  2: "Vertraut",
  3: "Tief",
};

export const MaturityDimensionSchema = z.enum([
  "conversation",
  "facts",
  "topics",
  "span",
]);
export type MaturityDimension = z.infer<typeof MaturityDimensionSchema>;

export const TwinStatsSchema = z.object({
  conversationCount: z.number().int().nonnegative(),
  factsCount: z.number().int().nonnegative(),
  /** Anzahl Themen-Cluster (Greedy Cosine-Bucketing über summary_segment-Embeddings). */
  topicCount: z.number().int().nonnegative(),
  /** ISO-Timestamp der ältesten Chat-Konversation oder null wenn keine. */
  firstConvAt: z.string().nullable(),
  /** Math.floor((now - firstConvAt) / 1 Tag in ms), 0 falls firstConvAt null. */
  daysSinceFirst: z.number().int().nonnegative(),
});
export type TwinStats = z.infer<typeof TwinStatsSchema>;

export const DimensionLevelsSchema = z.object({
  conversation: MaturityLevelSchema,
  facts: MaturityLevelSchema,
  topics: MaturityLevelSchema,
  span: MaturityLevelSchema,
});
export type DimensionLevels = z.infer<typeof DimensionLevelsSchema>;

export const MissingDimensionSchema = z.object({
  dimension: MaturityDimensionSchema,
  current: z.number(),
  needed: z.number(),
  /** Vorgekochter Frontend-String, z.B. "Noch 5 Konversationen für Bewohnt". */
  label: z.string(),
});
export type MissingDimension = z.infer<typeof MissingDimensionSchema>;

export const ProgressToNextSchema = z.object({
  targetLevel: MaturityLevelSchema,
  targetLabel: z.string(),
  /** 0-100, grob Mittel der Per-Dimension-Fortschritte zur nächsten Stufe. */
  percent: z.number().int().min(0).max(100),
  missingDimensions: z.array(MissingDimensionSchema),
});
export type ProgressToNext = z.infer<typeof ProgressToNextSchema>;

export const MaturityResultSchema = z.object({
  currentLevel: MaturityLevelSchema,
  currentLabel: z.string(),
  stats: TwinStatsSchema,
  dimensionLevels: DimensionLevelsSchema,
  /** null wenn currentLevel === 3 (höchste Stufe erreicht). */
  progressToNext: ProgressToNextSchema.nullable(),
});
export type MaturityResult = z.infer<typeof MaturityResultSchema>;
