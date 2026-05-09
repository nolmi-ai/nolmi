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

export const ChatRequestSchema = z.object({
  messages: z.array(ChatMessageSchema),
});

export const ChatResponseSchema = z.object({
  message: ChatMessageSchema,
  auditId: z.string(),
});

export type ChatMessage = z.infer<typeof ChatMessageSchema>;
export type ChatRequest = z.infer<typeof ChatRequestSchema>;
export type ChatResponse = z.infer<typeof ChatResponseSchema>;

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
});
export type Conversation = z.infer<typeof ConversationSchema>;

export const ConversationStartInputSchema = z.object({
  ownerUserId: z.string(),
  partnerHandle: z.string(),
  twinId: z.string(),
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
