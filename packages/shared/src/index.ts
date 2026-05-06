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
  capability: z.string(), // z.B. "respond_to_chat"
  requiresApproval: z.boolean(),
  inputs: z.array(SkillInputSchema).optional(),
  outputs: z.array(SkillOutputSchema).optional(),
});
export type SkillManifest = z.infer<typeof SkillManifestSchema>;

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
  isActive: z.boolean(),
  createdAt: z.number(),
  updatedAt: z.number(),
});
export type Skill = z.infer<typeof SkillSchema>;
