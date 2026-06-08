import { z } from "zod";

// ─── ENV-Aliasing-Helper (Rebrand Twin-Lab → Nolmi) ──────────────────────────
// Re-Export, damit Konsumenten via `@nolmi/shared` ODER `@nolmi/shared/env`
// importieren können. Der Subpath wird empfohlen, weil Tree-Shaking sauberer
// bleibt; der Re-Export hier ist Convenience.
export { getEnv } from "./env.js";

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
  escalation: z.enum(["auto", "always_pending"]),
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
  "sent",        // Autonom an den Owner gepusht (kein offenes To-do) — Proaktiv-Nudge 2b
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
  // #107: Live-Progress-Events für Auto-Approve-Tool-Calls. Werden im
  // tool-bridge.execute()-Pfad pro MCP-Call emittiert (start + complete).
  // Nicht DB-persistiert — ephemerer Live-State, der nach `twin.idle` im
  // Frontend mit kurzem Delay verworfen wird. Args werden vorher String-
  // weise auf 500 chars truncated (Display-Only, nicht Re-Run-Quelle).
  // Diagnose Tag 20: Auto-Approve-Tools (z.B. Hyperbrowser-Recherche)
  // erzeugen keine separaten Audit-Rows, der Audit-Stream ist also opak
  // bis zum finalen owner-direct-Audit am Cycle-Ende.
  z.object({
    type: z.literal("tool.call.start"),
    payload: z.object({
      callId: z.string(),
      toolName: z.string(),
      mcpServerId: z.string(),
      args: z.record(z.string(), z.unknown()),
      startedAt: z.string().datetime(),
    }),
  }),
  z.object({
    type: z.literal("tool.call.complete"),
    payload: z.object({
      callId: z.string(),
      status: z.enum(["executed", "failed"]),
      error: z.string().optional(),
      completedAt: z.string().datetime(),
      durationMs: z.number().int().nonnegative(),
    }),
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

// 3.4.A / #118: Verdichtungs-Status (episodisches Embedding) der Konversation.
// Spiegelt conversations.embedding_status (Migration 018):
//   'pending' → noch nicht verdichtet · 'done' → verdichtet (Tail-Flush/Reset
//   hat eingebettet) · 'failed' → Embedding-Versuch gescheitert.
export const ConversationEmbeddingStatusSchema = z.enum([
  "pending",
  "done",
  "failed",
]);
export type ConversationEmbeddingStatus = z.infer<
  typeof ConversationEmbeddingStatusSchema
>;

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
  /**
   * #118: Verdichtungs-Status der Konversation. Optional, weil primär für die
   * Sidebar-Anzeige beendeter Konv relevant (→ „verdichtet"-Hinweis bei
   * 'done'). Wird aus conversations.embedding_status gelesen.
   */
  embeddingStatus: ConversationEmbeddingStatusSchema.optional(),
  /**
   * #53 SS3: ISO-Timestamp der Archivierung. NULL = nicht archiviert. Archiv
   * ist reine UI-Sichtbarkeit (orthogonal zu status), kein Memory-Entzug.
   */
  archivedAt: z.string().nullable().optional(),
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

// ─── DIRECT-CHAT-HISTORIE (Sub-Step 1) ──────────────────────────────────────
//
// Leichte Metadaten einer Direct-Chat-Konversation für die Verlauf-Liste —
// ohne die vollen Audits (die kommen on-demand über die by-id-Route). Siehe
// docs/DIRECT-CHAT-HISTORIE-STRATEGY.md.

export const ConversationHistoryMetaSchema = z.object({
  id: z.string(),
  status: ConversationStatusSchema,
  startedAt: z.string(),
  endedAt: z.string().nullable(),
  embeddingStatus: ConversationEmbeddingStatusSchema.optional(),
  /** #53 SS3: ISO-Timestamp der Archivierung, NULL = nicht archiviert. */
  archivedAt: z.string().nullable().optional(),
});
export type ConversationHistoryMeta = z.infer<
  typeof ConversationHistoryMetaSchema
>;

export const ConversationHistoryItemSchema = ConversationHistoryMetaSchema.extend({
  /**
   * Themen-Snippet: erstes summary_segment der Konv (gekürzt). Fallback bei
   * segment-loser Konv: erste User-Nachricht. null wenn beides fehlt.
   */
  snippet: z.string().nullable(),
});
export type ConversationHistoryItem = z.infer<
  typeof ConversationHistoryItemSchema
>;

// ─── SKILLS (Phase 3.1) ──────────────────────────────────────────────────────
//
// Skills bündeln Wissen + optional Script, das ein Twin im Rahmen einer
// Capability anwenden kann. Hybrid-Ansatz: maschinen-lesbares Manifest +
// Markdown-Instructions + optional Action-Script.
//
// Mandate bleibt auf Capability-Ebene (Twin darf "respond_to_chat"). Skills
// haben zusätzlich `requiresApproval` als Inner-Mandate, das die Engine in
// 3.1.B+ auswerten wird.

// #110: 'example' für Skills, die aus `examples/skills/<name>/`-Templates per
// Wizard-Endpoint importiert wurden. Tracking-Information: erlaubt späteres
// idempotentes Re-Import bei Template-Updates und UI-Unterscheidung zwischen
// Production-Templates und hand-getippten Custom-Skills. CLI bleibt
// default-mäßig auf 'manual' (Backward-Compat für bestehende Bootstrap-Pfade).
export const SkillSourceSchema = z.enum(["manual", "mcp", "example"]);
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

// #107: triggerMode steuert, ob ein Skill vom LLM-Classifier-Pre-Pass im
// Send-Path forciert getriggert werden darf. 'passive' (Default) heißt:
// Skill liegt nur im System-Prompt, LLM entscheidet frei. 'forced' heißt:
// Pre-Pass-Classifier prüft die User-Message gegen `triggerCondition` und
// erzwingt bei Match toolChoice auf das erste Tool aus requiresTools.
// Backward-Compat: existierende Skills ohne triggerMode werden zu 'passive'.
export const SkillTriggerModeSchema = z.enum(["forced", "passive"]);
export type SkillTriggerMode = z.infer<typeof SkillTriggerModeSchema>;

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
  // #107: Pre-Pass-Classifier-Felder. `triggerMode` ist optional — undefined
  // wird im Send-Path semantisch als 'passive' behandelt (Pre-Pass-Check
  // matched nur `=== 'forced'`). Kein .default('passive'), weil DB-Reads
  // im SkillRepo das Manifest als JSON-Cast ohne Zod-Parse durchreichen —
  // ein Default würde dort nicht greifen und nur false security suggestieren.
  // `triggerCondition` ist nur bei triggerMode='forced' relevant, aber ohne
  // refine() — UI/CLI können auch passive Skills mit beschreibender Condition
  // anlegen, die später per Edit auf 'forced' geflippt werden.
  triggerMode: SkillTriggerModeSchema.optional(),
  triggerCondition: z.string().optional(),
  // #107: Liste der MCP-Tool-Keys, die der Skill als forced-Trigger-Ziel
  // anbietet. Format: 'mcp:<serverHandle>:<toolName>' (analog dem AI-SDK-
  // Tool-Key-Format aus tool-bridge.ts). Pre-Pass nimmt das erste Element
  // als toolChoice. Manual-Skills ohne Tool-Trigger lassen das Feld weg.
  requiresTools: z.array(z.string()).optional(),
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
  // #131 Phase 3.3.1.2: Cross-Reference auf den Codex-call_id, damit der
  // Multi-Step-Resume-Pfad das `function_call_output`-Item korrekt
  // adressieren kann (§l). Nur gesetzt für Codex-OAuth-Pfad; AI-SDK-Pfad
  // (Anthropic/OpenAI-API) hat keinen entsprechenden externen Identifier.
  codexCallId: z.string().optional(),
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

/**
 * #110: strukturierte Persona-Form, die der Onboarding-Wizard sammelt und
 * `buildPersonaMarkdown` zu System-Prompt-Markdown rendert. Seit Phase 2B
 * Commit 11 wird das Object auch als `twin_profiles.persona_input_json`
 * persistiert — Pre-Fill für Settings-Re-Configuration.
 */
export const PersonaInputSchema = z.object({
  fullName: z.string().min(1),
  handle: z.string().regex(/^@[a-z0-9_-]+$/),
  role: z.string().min(1),
  tone: z.array(z.enum(["direct", "polite", "casual", "formal"])).min(1),
  pronoun: z.enum(["du", "sie", "context-dependent"]),
  preferences: z.array(z.enum(["no-emojis", "no-platitudes", "short-answers"])),
  topics: z.array(z.string().min(1)).min(1),
  relationships: z.array(
    z.object({ name: z.string(), description: z.string() }),
  ),
});
export type PersonaInput = z.infer<typeof PersonaInputSchema>;

/**
 * #110: Whitelist der Skill-Templates aus `examples/skills/<name>/`, die
 * der Wizard via POST /twins/:handle/skills/import importieren darf.
 * Neue Templates kommen hier dazu, sobald sie in `examples/skills/`
 * gelandet sind — Zod-Enum schützt gegen Path-Injection und unbekannte
 * Verzeichnisse.
 */
export const EXAMPLE_SKILL_TEMPLATES = ["recherche-workflow"] as const;
export type ExampleSkillTemplate = (typeof EXAMPLE_SKILL_TEMPLATES)[number];

/**
 * #110: Request-Schema für POST /twins/:handle/skills/import. Generisch via
 * `source`-Discriminator angelegt, damit später weitere Quellen (z.B.
 * `'url'` für externe Skill-Repos oder `'manifest'` für direkten JSON-Upload)
 * additive Varianten werden können.
 */
export const SkillImportRequestSchema = z.object({
  source: z.literal("example"),
  path: z.enum(EXAMPLE_SKILL_TEMPLATES),
});
export type SkillImportRequest = z.infer<typeof SkillImportRequestSchema>;

/** #110: Response-Payload für POST /twins/:handle/skills/import. */
export const SkillImportResponseSchema = z.object({
  skillId: z.string(),
  status: z.enum(["created", "updated"]),
  name: z.string(),
});
export type SkillImportResponse = z.infer<typeof SkillImportResponseSchema>;

/**
 * #110 Phase 2B: ein Preset, das der Wizard aus `examples/skills/` anbietet.
 * `requiresMcpServers` extrahiert aus `manifest.requires_tools` die einzigartigen
 * MCP-Server-Namen (z.B. `mcp:hyperbrowser-approval:search_with_bing`
 * → `hyperbrowser-approval`) — für Card-Hint im Wizard. Tatsächliches
 * MCP-Server-Provisioning ist heute manuell (Settings) und kommt in #122.
 */
export const PresetSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  requiresMcpServers: z.array(z.string()),
});
export type Preset = z.infer<typeof PresetSchema>;

export const PresetsListResponseSchema = z.object({
  presets: z.array(PresetSchema),
});
export type PresetsListResponse = z.infer<typeof PresetsListResponseSchema>;

/**
 * #122: Preset-Auswahl mit API-Keys für requires-MCP-Server. Frontend
 * sammelt pro selektiertem Preset die Keys für die MCP-Server, die das
 * Preset braucht. Wenn `requiresMcpServers` leer ist, bleibt `mcpServerKeys`
 * leer; Settings-Path nutzt das auch (kein API-Key-UI dort) — Provisioning
 * fällt dann soft, Skill wird aber importiert.
 */
export const PresetSelectionSchema = z.object({
  presetId: z.string(),
  mcpServerKeys: z.record(z.string(), z.string()),
});
export type PresetSelection = z.infer<typeof PresetSelectionSchema>;

/**
 * #110 Phase 2B + #122: Result-Item pro Preset im Onboarding-Submit-
 * Response. `imported` = Skill angelegt, `failed` = soft-fail (geloggt,
 * Twin bleibt), `unknown` = Preset-ID nicht in Scan-Whitelist.
 *
 * `mcpServers` (#122): pro Preset-requires-MCP-Server ein Status —
 *   - `added`: Server angelegt + Tool-Skills via syncOnAdd persistiert
 *   - `skipped`: Server existierte schon für diesen Twin (Idempotenz)
 *   - `failed`: Template fehlt, API-Key fehlt, Spawn-Failure, Sync-Failure
 */
export const PresetActivationResultSchema = z.object({
  id: z.string(),
  status: z.enum(["imported", "failed", "unknown"]),
  reason: z.string().optional(),
  mcpServers: z
    .array(
      z.object({
        name: z.string(),
        status: z.enum(["added", "skipped", "failed"]),
        reason: z.string().optional(),
      }),
    )
    .optional(),
});
export type PresetActivationResult = z.infer<typeof PresetActivationResultSchema>;

/**
 * #110 Phase 2B Commit 11: Pre-Fill-Payload für die Settings-Page.
 *
 * `personaSource`:
 * - `"structured"` — `persona_input_json` ist gesetzt, `persona`-Object
 *   ist verfügbar
 * - `"legacy_markdown"` — Bootstrap-CLI-Twin oder Pre-Migration-Onboarding,
 *   `persona` ist null → Frontend zeigt Hint und kein Pre-Fill
 *
 * `activePresets` ist die Liste der Skill-Namen, die source=`example`
 * haben — entspricht 1:1 den Preset-IDs aus `examples/skills/`.
 */
// #131 Phase 5.1 — Auth-Status für Settings-UI. `mode` matched
// twin_profiles.auth_mode in runtime. `oauth` ist Owner-Safe-View aus
// oauth_tokens (kein access_token / refresh_token).
export const AuthModeSchema = z.enum(["api_key", "oauth"]);
export type AuthMode = z.infer<typeof AuthModeSchema>;

export const OAuthTokenPublicSchema = z.object({
  twinId: z.string(),
  provider: z.literal("openai"),
  expiresAt: z.string(),
  accountId: z.string().nullable(),
  isExpired: z.boolean(),
  isExpiringSoon: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type OAuthTokenPublic = z.infer<typeof OAuthTokenPublicSchema>;

export const SettingsDataResponseSchema = z.object({
  persona: PersonaInputSchema.nullable(),
  personaSource: z.enum(["structured", "legacy_markdown"]),
  llmConfig: z.object({
    provider: z.string(),
    model: z.string(),
    apiKeyMasked: z.string(),
  }),
  auth: z.object({
    mode: AuthModeSchema,
    oauth: OAuthTokenPublicSchema.nullable(),
  }),
  activePresets: z.array(z.string()),
});
export type SettingsDataResponse = z.infer<typeof SettingsDataResponseSchema>;

/**
 * #110 Phase 2B Commit 11: Update-Payload für PATCH /twins/:handle/full-config.
 * Alle Felder optional — Frontend sendet nur das, was sich geändert hat.
 *
 * `llmConfig.apiKey`:
 * - `undefined` oder Feld nicht gesetzt → no-change
 * - `null` → no-change (explizites Signal, falls UI vereinheitlicht)
 * - String → validateApiKey + re-encrypt
 *
 * `presets` ist immer der Soll-Zustand (delete-and-re-insert). Wenn Feld
 * nicht gesetzt: kein Touch an Preset-Skills.
 */
export const FullConfigUpdateRequestSchema = z.object({
  persona: PersonaInputSchema.optional(),
  llmConfig: z
    .object({
      provider: z.string().min(1).optional(),
      model: z.string().min(1).optional(),
      apiKey: z.string().min(1).nullable().optional(),
    })
    .optional(),
  presets: z.array(z.string()).optional(),
});
export type FullConfigUpdateRequest = z.infer<typeof FullConfigUpdateRequestSchema>;

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
