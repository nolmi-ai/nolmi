import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import cors from "@fastify/cors";
import cookie from "@fastify/cookie";
import { nanoid } from "nanoid";
import { resolve } from "node:path";
import { z } from "zod";
import type Database from "better-sqlite3";
import type { AuditRepository } from "./repository/types.js";
import {
  ChatRequestSchema,
  FactCreateRequestSchema,
  FactExtractRequestSchema,
  FactUpdateRequestSchema,
  McpServerCreateRequestSchema,
  PersonaInputSchema,
  FullConfigUpdateRequestSchema,
  SkillCreateRequestSchema,
  SkillImportRequestSchema,
  SkillUpdateRequestSchema,
  type AuditEntry,
  type FactConfidence,
  type FactItem,
  type McpServer,
  type McpServerUiPayload,
  type SkillDetailPayload,
  type TwinToolListItem,
} from "@twin-lab/shared";
import {
  McpServerAlreadyExistsError,
  McpServerValidationError,
  McpServersRepo,
} from "./mcp/repo.js";
import { FactsRepo } from "./facts/repo.js";
import { TwinMaturityService } from "./twin-maturity/twin-maturity-service.js";
import type { RegistryEntry, TwinServiceRegistry } from "./twin-service-registry.js";
import { TwinProfilesRepo, type TwinProfile } from "./twin-profiles-repo.js";
import { encrypt } from "./crypto-utils.js";
import { LLM_PROVIDERS, type StoredLlmConfig } from "./llm-config.js";
import { buildPersonaMarkdown } from "./onboarding/persona-builder.js";
import { loadMandateTemplate } from "./onboarding/mandate-templates.js";
import { validateApiKey } from "./onboarding/api-key-validator.js";
import {
  registerHandleOnBridge,
  BridgeRegisterError,
} from "./onboarding/bridge-register.js";
import { getCurrentUser } from "./auth/get-current-user.js";
import { UsersRepo, UserAlreadyExistsError, type User } from "./auth/users-repo.js";
import { destroySession, setSession } from "./auth/session.js";
import {
  TrustRepo,
  TrustAlreadyExistsError,
  TrustNotFoundError,
} from "./trust/trust-repo.js";
import {
  SkillAlreadyExistsError,
  SkillRepo,
  SkillValidationError,
} from "./skills/repo.js";
import {
  importSkillFromDir,
  SkillImportError,
} from "./skills/import-from-dir.js";
import { scanExamplesPresets } from "./skills/scan-examples-presets.js";
import { activatePresets } from "./skills/activate-presets.js";
import type {
  PresetActivationResult,
  Skill,
  SkillUiPayload,
} from "@twin-lab/shared";
import type { ConversationsRepo } from "./conversations/repo.js";
import {
  mergeAuditIntoBridgeMessages,
  type MergedMessage,
} from "./audit/conversation-merge.js";
import { BridgeClient } from "./bridge/client.js";

// ─── HTTP SERVER ─────────────────────────────────────────────────────────────
//
// Phase 2.5d: Multi-Twin pro Runtime. Routing-Schema:
//
//   GET  /health                                      → server-weit
//   GET  /twins                                       → Liste aller aktiven Twins
//   GET  /twins/:handle/profile                       → Profil eines Twins
//   POST /twins/:handle/chat                          → Chat mit einem Twin
//   GET  /twins/:handle/audit?limit=50                → Audit-Log eines Twins
//   GET  /twins/:handle/audit/pending                 → Pending eines Twins
//   POST /twins/:handle/audit/:id/approve             → Approve
//   POST /twins/:handle/audit/:id/reject              → Reject
//   GET  /twins/:handle/stream                        → SSE für einen Twin
//
// Backward-Compat (legacy, route auf @markus):
//   POST /chat                              → POST /twins/@markus/chat
//   GET  /audit, /audit/pending             → /twins/@markus/audit*
//   POST /audit/:id/approve, /audit/:id/reject
//   GET  /stream                            → /twins/@markus/stream
//   GET  /twin-profile                      → /twins/@markus/profile
//
// Phase 1: keine Auth — läuft nur lokal auf 127.0.0.1.

const LEGACY_HANDLE = "@markus";

export interface ServerDeps {
  audit: AuditRepository;
  registry: TwinServiceRegistry;
  /** Für /onboarding-Endpoints: Handle-Lookup + neuer Twin-Insert. */
  profilesRepo: TwinProfilesRepo;
  /** Für /onboarding/submit: API-Key-Verschlüsselung. */
  masterKey: Buffer;
  /** Für Auth + Owner-Checks: gemeinsame DB-Connection (UsersRepo etc.). */
  db: Database.Database;
  /** Für /twins/:handle/trust* — geteilte Instanz mit der Registry. */
  trustRepo: TrustRepo;
  /** Für /twins/:handle/skills* — geteilte Instanz mit der Registry. */
  skillRepo: SkillRepo;
  /** Für /twins/:handle/conversations/reset — geteilte Instanz mit der Registry. */
  conversationsRepo: ConversationsRepo;
  /** 3.2.H — für GET /twins/:handle/tools (Server-Name pro Skill). */
  mcpServersRepo: McpServersRepo;
  /** 3.3.D — für /twins/:handle/facts-Endpoints (CRUD-API für Semantic-Memory). */
  factsRepo: FactsRepo;
  /** #101 — für GET /twins/:handle/maturity. */
  twinMaturityService: TwinMaturityService;
  /**
   * #110: Absoluter Pfad zum `examples/skills/`-Verzeichnis. Wird vom
   * Skill-Import-Endpoint genutzt, um Templates per Whitelist-Path zu laden.
   * Quelle: `RuntimeConfig.examplesDir`.
   */
  examplesDir: string;
}

export async function createServer(deps: ServerDeps) {
  const app = Fastify({ logger: true });

  await app.register(cors, {
    origin: true,
    credentials: true,
  });
  await app.register(cookie);

  // ─── Helpers ───────────────────────────────────────────────────────────────

  const requireEntry = (
    handle: string,
    reply: FastifyReply,
  ): RegistryEntry | null => {
    const entry = deps.registry.getEntry(handle);
    if (!entry) {
      reply.status(404).send({ error: `Twin "${handle}" nicht gefunden oder inaktiv` });
      return null;
    }
    return entry;
  };

  /**
   * Owner-Gate für /twins/:handle/*-Routes. Prüft Reihenfolge:
   *   1. Login → 401
   *   2. Twin existiert → 404 (über requireEntry)
   *   3. user.userId === twin.ownerUserId → 403
   * Returns { entry, user } bei Erfolg, null wenn schon eine Antwort
   * gesendet wurde (Caller muss dann nichts mehr tun).
   */
  const requireOwner = async (
    request: FastifyRequest,
    reply: FastifyReply,
    handle: string,
  ): Promise<{ entry: RegistryEntry; user: User } | null> => {
    const user = await getCurrentUser(request, deps.db);
    if (!user) {
      reply.status(401).send({ error: "Login erforderlich" });
      return null;
    }
    const entry = requireEntry(handle, reply);
    if (!entry) return null;
    if (entry.profile.ownerUserId !== user.userId) {
      reply.status(403).send({ error: "Kein Zugriff auf diesen Twin" });
      return null;
    }
    return { entry, user };
  };

  const profileToResponse = (entry: RegistryEntry) => {
    const p = entry.profile;
    return {
      twinId: p.twinId,
      handle: p.handle,
      displayName: p.displayName,
      llmConfig: {
        provider: p.llmConfig.provider,
        model: p.llmConfig.model,
        baseUrl: p.llmConfig.baseUrl ?? null,
        // API-Key wird NIE im Klartext zurückgegeben; nur die Maske aus dem
        // beim Boot einmal entschlüsselten Wert + die Source.
        apiKeyMasked: entry.llmDisplay.apiKeyMasked,
        apiKeySource: entry.llmDisplay.apiKeySource,
      },
      bridge: {
        url: p.bridgeUrl,
        tokenMasked: maskToken(p.bridgeToken),
      },
      mandatesCount: p.mandates.length,
      isActive: p.isActive,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
    };
  };

  // ─── Health ────────────────────────────────────────────────────────────────
  app.get("/health", async () => ({
    status: "ok",
    timestamp: new Date().toISOString(),
    twins: deps.registry.list().length,
  }));

  // ─── Auth ──────────────────────────────────────────────────────────────────
  registerAuthRoutes(app, deps);

  // ─── Twin-Liste (gefiltert auf eigene Twins) ───────────────────────────────
  app.get("/twins", async (request, reply) => {
    const user = await getCurrentUser(request, deps.db);
    if (!user) {
      return reply.status(401).send({ error: "Login erforderlich" });
    }
    // Heute jeden Registry-Entry mit profile gegenchecken — bei wachsender
    // Twin-Zahl per-User sollte das in TwinProfilesRepo eine Index-Query
    // werden.
    const owned = deps.registry.list().filter((summary) => {
      const entry = deps.registry.getEntry(summary.handle);
      return entry?.profile.ownerUserId === user.userId;
    });
    return { twins: owned };
  });

  // ─── Onboarding ────────────────────────────────────────────────────────────
  registerOnboardingRoutes(app, deps);

  // ─── Profil ────────────────────────────────────────────────────────────────
  app.get<{ Params: { handle: string } }>(
    "/twins/:handle/profile",
    async (request, reply) => {
      const ctx = await requireOwner(request, reply, request.params.handle);
      if (!ctx) return;
      const { entry } = ctx;
      return profileToResponse(entry);
    },
  );

  // ─── Twin-Reife (#101) ─────────────────────────────────────────────────────
  app.get<{ Params: { handle: string } }>(
    "/twins/:handle/maturity",
    async (request, reply) => {
      const ctx = await requireOwner(request, reply, request.params.handle);
      if (!ctx) return;
      const { entry } = ctx;
      return await deps.twinMaturityService.computeMaturity(entry.twinId);
    },
  );

  // ─── Chat ──────────────────────────────────────────────────────────────────
  app.post<{ Params: { handle: string } }>(
    "/twins/:handle/chat",
    async (request, reply) => {
      const ctx = await requireOwner(request, reply, request.params.handle);
      if (!ctx) return;
      const { entry, user } = ctx;
      const parsed = ChatRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: parsed.error.message });
      }
      try {
        // requesterUserId triggert den Owner-Bypass im TwinService — heute
        // immer der Owner (requireOwner stellt das sicher), aber explizit
        // weiterzureichen ist robuster, falls die Route mal aufgemacht wird.
        // 3.2.H: forcedToolChoice (vom Tool-Picker) wird durchgereicht; ohne
        // greift Default-Auto.
        return await entry.service.chat(parsed.data.messages, {
          requesterUserId: user.userId,
          forcedToolChoice: parsed.data.forcedToolChoice,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Unknown error";
        return reply.status(500).send({ error: msg });
      }
    },
  );

  // ─── Trust-Relationships ───────────────────────────────────────────────────
  registerTrustRoutes(app, deps, requireOwner);

  // ─── Skills (3.1.E) ────────────────────────────────────────────────────────
  registerSkillRoutes(app, deps, requireOwner);

  // ─── Tools (3.2.H — Tool-Picker-UI) ───────────────────────────────────────
  registerToolRoutes(app, deps, requireOwner);

  // ─── MCP-Server (#87 — Configurator-UI) ───────────────────────────────────
  registerMcpServerRoutes(app, deps, requireOwner);

  // ─── Settings (#110 Phase 2B Commit 11 — Pre-Fill + Edit) ─────────────────
  registerTwinSettingsRoutes(app, deps, requireOwner);

  // ─── Facts (3.3.D — Semantic-Memory CRUD) ─────────────────────────────────
  registerFactRoutes(app, deps, requireOwner);

  // ─── A2A-Conversations (2.5.4.2) ──────────────────────────────────────────
  registerConversationRoutes(app, deps, requireOwner);

  // ─── Audit-Liste ───────────────────────────────────────────────────────────
  app.get<{ Params: { handle: string }; Querystring: { limit?: string; offset?: string } }>(
    "/twins/:handle/audit",
    async (request, reply) => {
      const ctx = await requireOwner(request, reply, request.params.handle);
      if (!ctx) return;
      const { entry } = ctx;
      const limit = Math.min(Number(request.query.limit ?? 50), 200);
      const offset = Number(request.query.offset ?? 0);
      const entries = await deps.audit.list({ limit, offset, twinId: entry.twinId });
      return { entries };
    },
  );

  // ─── Pending-Liste ─────────────────────────────────────────────────────────
  app.get<{ Params: { handle: string } }>(
    "/twins/:handle/audit/pending",
    async (request, reply) => {
      const ctx = await requireOwner(request, reply, request.params.handle);
      if (!ctx) return;
      const { entry } = ctx;
      // Pragmatisch: alle holen (200), in JS auf pending filtern. Bei
      // wachsendem Volumen besser eine WHERE status='pending'-Query im Repo.
      const entries = await deps.audit.list({ limit: 200, twinId: entry.twinId });
      return { entries: entries.filter((e) => e.status === "pending") };
    },
  );

  // ─── Approve ───────────────────────────────────────────────────────────────
  app.post<{ Params: { handle: string; id: string } }>(
    "/twins/:handle/audit/:id/approve",
    async (request, reply) => {
      const ctx = await requireOwner(request, reply, request.params.handle);
      if (!ctx) return;
      const { entry } = ctx;
      const auditEntry = await deps.audit.get(request.params.id);
      if (!auditEntry || auditEntry.twinId !== entry.twinId) {
        return reply.status(404).send({ error: "Audit-Eintrag nicht für diesen Twin" });
      }
      try {
        return await entry.service.approvePending(request.params.id);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Unknown error";
        return reply.status(400).send({ error: msg });
      }
    },
  );

  // ─── Mark-Read (für reply-received Indicator in der Sidebar) ─────────────
  app.post<{ Params: { handle: string; id: string } }>(
    "/twins/:handle/audit/:id/mark-read",
    async (request, reply) => {
      const ctx = await requireOwner(request, reply, request.params.handle);
      if (!ctx) return;
      const { entry } = ctx;
      const auditEntry = await deps.audit.get(request.params.id);
      if (!auditEntry || auditEntry.twinId !== entry.twinId) {
        return reply.status(404).send({ error: "Audit-Eintrag nicht für diesen Twin" });
      }
      await deps.audit.markRead(auditEntry.id);
      return { ok: true };
    },
  );

  // ─── Reject ────────────────────────────────────────────────────────────────
  app.post<{ Params: { handle: string; id: string }; Body: { reason?: string } }>(
    "/twins/:handle/audit/:id/reject",
    async (request, reply) => {
      const ctx = await requireOwner(request, reply, request.params.handle);
      if (!ctx) return;
      const { entry } = ctx;
      const auditEntry = await deps.audit.get(request.params.id);
      if (!auditEntry || auditEntry.twinId !== entry.twinId) {
        return reply.status(404).send({ error: "Audit-Eintrag nicht für diesen Twin" });
      }
      try {
        const reason = request.body?.reason ?? "Rejected by user";
        await entry.service.rejectPending(request.params.id, reason);
        return { ok: true };
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Unknown error";
        return reply.status(400).send({ error: msg });
      }
    },
  );

  // ─── Stream (SSE) ──────────────────────────────────────────────────────────
  app.get<{ Params: { handle: string } }>(
    "/twins/:handle/stream",
    async (request, reply) => {
      const ctx = await requireOwner(request, reply, request.params.handle);
      if (!ctx) return;
      const { entry } = ctx;

      // SSE-Header: Origin reflektieren (NICHT "*"), weil EventSource mit
      // withCredentials sonst die Connection vom Browser geblockt wird —
      // CORS-Spec verbietet Wildcard-Origin bei credentialed Requests.
      const origin = request.headers.origin ?? "*";
      reply.raw.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "Access-Control-Allow-Origin": origin,
        "Access-Control-Allow-Credentials": "true",
      });

      const send = (event: unknown) => {
        reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
      };

      send({ type: "heartbeat", payload: { timestamp: new Date().toISOString() } });

      const unsubscribe = entry.bus.subscribe((event) => send(event));

      const heartbeat = setInterval(() => {
        send({ type: "heartbeat", payload: { timestamp: new Date().toISOString() } });
      }, 15_000);

      request.raw.on("close", () => {
        clearInterval(heartbeat);
        unsubscribe();
      });
    },
  );

  // ─── Legacy-Aliases (route auf @markus) ────────────────────────────────────
  // Heute: erhält die Phase-2-UI am Leben, solange sie noch nicht alle
  // Endpoints umgestellt hat. Soll nach UI-Migration entfernt werden.

  registerLegacyAliases(app, deps, profileToResponse);

  return app;
}

// ─── Legacy-Aliases ──────────────────────────────────────────────────────────

function registerLegacyAliases(
  app: FastifyInstance,
  deps: ServerDeps,
  profileToResponse: (entry: RegistryEntry) => unknown,
) {
  const requireLegacyEntry = (reply: FastifyReply): RegistryEntry | null => {
    const entry = deps.registry.getEntry(LEGACY_HANDLE);
    if (!entry) {
      reply.status(404).send({
        error: `Legacy-Default-Twin "${LEGACY_HANDLE}" nicht aktiv — Endpoints sind deprecated, nutze /twins/<handle>/...`,
      });
      return null;
    }
    return entry;
  };

  app.get("/twin-profile", async (_request, reply) => {
    const entry = requireLegacyEntry(reply);
    if (!entry) return;
    return profileToResponse(entry);
  });

  app.post("/chat", async (request, reply) => {
    const entry = requireLegacyEntry(reply);
    if (!entry) return;
    const parsed = ChatRequestSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.message });
    try {
      return await entry.service.chat(parsed.data.messages);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      return reply.status(500).send({ error: msg });
    }
  });

  app.get<{ Querystring: { limit?: string; offset?: string } }>(
    "/audit",
    async (request, reply) => {
      const entry = requireLegacyEntry(reply);
      if (!entry) return;
      const limit = Math.min(Number(request.query.limit ?? 50), 200);
      const offset = Number(request.query.offset ?? 0);
      const entries = await deps.audit.list({ limit, offset, twinId: entry.twinId });
      return { entries };
    },
  );

  app.get("/audit/pending", async (_request, reply) => {
    const entry = requireLegacyEntry(reply);
    if (!entry) return;
    const entries = await deps.audit.list({ limit: 200, twinId: entry.twinId });
    return { entries: entries.filter((e) => e.status === "pending") };
  });

  app.post<{ Params: { id: string } }>(
    "/audit/:id/approve",
    async (request, reply) => {
      const entry = requireLegacyEntry(reply);
      if (!entry) return;
      try {
        return await entry.service.approvePending(request.params.id);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Unknown error";
        return reply.status(400).send({ error: msg });
      }
    },
  );

  app.post<{ Params: { id: string }; Body: { reason?: string } }>(
    "/audit/:id/reject",
    async (request, reply) => {
      const entry = requireLegacyEntry(reply);
      if (!entry) return;
      try {
        const reason = request.body?.reason ?? "Rejected by user";
        await entry.service.rejectPending(request.params.id, reason);
        return { ok: true };
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Unknown error";
        return reply.status(400).send({ error: msg });
      }
    },
  );

  app.get("/stream", async (request, reply) => {
    const entry = requireLegacyEntry(reply);
    if (!entry) return;
    // Origin reflektieren statt "*", damit EventSource(withCredentials:true)
    // nicht vom Browser geblockt wird (CORS verbietet Wildcard bei creds).
    const origin = request.headers.origin ?? "*";
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Credentials": "true",
    });
    const send = (event: unknown) => {
      reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
    };
    send({ type: "heartbeat", payload: { timestamp: new Date().toISOString() } });
    const unsubscribe = entry.bus.subscribe((event) => send(event));
    const heartbeat = setInterval(() => {
      send({ type: "heartbeat", payload: { timestamp: new Date().toISOString() } });
    }, 15_000);
    request.raw.on("close", () => {
      clearInterval(heartbeat);
      unsubscribe();
    });
  });
}

// ─── ONBOARDING ──────────────────────────────────────────────────────────────
//
// Drei Endpoints für den Wizard:
//   GET  /onboarding/check-handle?handle=@x   → { available, suggestions? }
//   POST /onboarding/validate-api-key         → { valid, reason? }
//   POST /onboarding/submit                   → 201 { twinId, handle }
//
// Submit ist NICHT in einer DB-Transaktion gewrappt — der Bridge-Call zwischen
// Validation und INSERT macht das nicht sinnvoll. Race-Behandlung: kollidiert
// jemand zwischen check-handle und Submit, liefert die Bridge 409 oder das
// UNIQUE-Constraint von twin_profiles wirft. Beides wird abgefangen.
//
// Hot-Reload für neuen Twin in laufende Registry: NICHT implementiert in
// 2.5.3 (Backlog #37). Nach Submit muss `pnpm dev` neu gestartet werden,
// damit der neue Twin live wird.

// #110 Phase 2B Commit 11: PersonaInputSchema lebt jetzt in @twin-lab/shared
// (oben in den Imports). Settings-Frontend nutzt das gleiche Schema für
// Pre-Fill + Update — Single-Source-of-Truth.

const OnboardingSubmitSchema = z.object({
  persona: PersonaInputSchema,
  // #110 Phase 2A: optional. Wizard sendet das Feld nicht mehr — der Wahlschritt
  // ist entfernt, weil Mandate-Konzepte für Erstnutzer schwer sind. Default
  // 'cautious' (alles geht durch Approval) bleibt sicher und kann später in
  // Settings angepasst werden. Backward-Compat: Clients, die das Feld noch
  // mitschicken, werden akzeptiert.
  mandateTemplate: z
    .enum(["cautious", "trusting", "business"])
    .optional()
    .default("cautious"),
  llmConfig: z.object({
    provider: z.enum(LLM_PROVIDERS),
    model: z.string().min(1),
    apiKey: z.string().min(1),
  }),
  // #110 Phase 2B: optionale Liste von Preset-IDs aus `examples/skills/`.
  // Backend whiteliste-validiert die IDs zur Submit-Zeit gegen den
  // Scan-Output (Single-Source-of-Truth examples/skills/-Folder).
  // Activation ist soft — Failures landen im Response, Twin bleibt
  // angelegt. MCP-Server-Provisioning ist NICHT Teil dieser Aktivierung
  // (siehe #122) — Pattern-Skills werden importiert, Tool-Bindings
  // erfordern manuelles MCP-Setup in Settings.
  presets: z.array(z.string()).optional().default([]),
});

const ValidateApiKeySchema = z.object({
  provider: z.enum(LLM_PROVIDERS),
  model: z.string().min(1),
  apiKey: z.string().min(1),
});

function registerOnboardingRoutes(app: FastifyInstance, deps: ServerDeps) {
  // ─── #110 Phase 2B: Preset-Katalog (öffentlich) ──────────────────────────
  //
  // Liest examples/skills/ als Single-Source-of-Truth. Kein Auth — die Liste
  // ist nicht twin- oder user-spezifisch, Inhalte stehen 1:1 auf GitHub.
  // Schlägt nie fehl: ungültige Manifests werden geskippt mit Warn-Log.
  app.get("/examples/presets", async (request) => {
    const presets = scanExamplesPresets(deps.examplesDir, {
      warn: (msg, meta) => request.log.warn(meta ?? {}, msg),
    });
    return { presets };
  });

  // ─── Handle-Uniqueness ───────────────────────────────────────────────────
  app.get<{ Querystring: { handle?: string } }>(
    "/onboarding/check-handle",
    async (request, reply) => {
      const raw = request.query.handle?.trim();
      if (!raw || !/^@[a-z0-9_-]+$/.test(raw)) {
        return reply.status(400).send({
          error:
            "handle muss '@<name>' sein (Kleinbuchstaben, Ziffern, _ und -)",
        });
      }
      const existing = deps.profilesRepo.findByHandle(raw);
      if (!existing) return { available: true };

      // Drei einfache Suggestions: Suffix -2, -3, -4 — solange frei.
      const base = raw;
      const suggestions: string[] = [];
      for (let i = 2; i <= 4 && suggestions.length < 3; i++) {
        const candidate = `${base}-${i}`;
        if (!deps.profilesRepo.findByHandle(candidate)) suggestions.push(candidate);
      }
      return { available: false, suggestions };
    },
  );

  // ─── API-Key Validation (auth nötig) ────────────────────────────────────
  app.post("/onboarding/validate-api-key", async (request, reply) => {
    const user = await getCurrentUser(request, deps.db);
    if (!user) return reply.status(401).send({ error: "Login erforderlich" });
    const parsed = ValidateApiKeySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.message });
    }
    const result = await validateApiKey(
      parsed.data.provider,
      parsed.data.apiKey,
      parsed.data.model,
    );
    return result;
  });

  // ─── Submit (auth nötig, owner_user_id = session.userId) ────────────────
  app.post("/onboarding/submit", async (request, reply) => {
    const user = await getCurrentUser(request, deps.db);
    if (!user) return reply.status(401).send({ error: "Login erforderlich" });

    const parsed = OnboardingSubmitSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.message });
    }
    const { persona, mandateTemplate, llmConfig, presets } = parsed.data;

    // 1. Defensive Handle-Check (UNIQUE catched es spätestens, aber 409
    //    früh ist freundlicher).
    if (deps.profilesRepo.findByHandle(persona.handle)) {
      return reply.status(409).send({
        error: `Handle '${persona.handle}' ist bereits vergeben`,
      });
    }

    // 2. API-Key validieren
    const validation = await validateApiKey(
      llmConfig.provider,
      llmConfig.apiKey,
      llmConfig.model,
    );
    if (!validation.valid) {
      return reply.status(400).send({
        error: `API-Key ungültig: ${validation.reason}`,
      });
    }

    // 3. Bridge-Handle registrieren
    let bridgeToken: string;
    const bridgeUrl = pickBridgeUrlForOnboarding();
    try {
      const result = await registerHandleOnBridge({
        bridgeUrl,
        handle: persona.handle,
        displayName: persona.fullName,
      });
      bridgeToken = result.token;
    } catch (err) {
      const status = err instanceof BridgeRegisterError ? err.status : 502;
      const msg = err instanceof Error ? err.message : String(err);
      return reply.status(status === 409 ? 409 : 502).send({
        error: `Bridge-Registrierung fehlgeschlagen: ${msg}`,
      });
    }

    // 4. Persona-MD bauen + Mandates laden
    const personaMd = buildPersonaMarkdown(persona);
    const mandates = loadMandateTemplate(mandateTemplate);

    // 5. API-Key verschlüsseln — trim aus dem gleichen Grund wie im
    // Validator (Copy-Paste-Whitespace würde sonst persistiert und der
    // Live-Chat scheitert später mit "invalid x-api-key").
    const trimmedKey = llmConfig.apiKey.trim();
    const storedLlmConfig: StoredLlmConfig = {
      provider: llmConfig.provider,
      model: llmConfig.model,
      apiKeyEncrypted: encrypt(trimmedKey, deps.masterKey),
      apiKeySource: "user",
    };

    // 6. INSERT — bei UNIQUE-Race wirft sqlite, fängt's der catch
    const twinId = `twin_${nanoid(16)}`;
    let profile;
    try {
      profile = deps.profilesRepo.insert({
        twinId,
        handle: persona.handle,
        displayName: persona.fullName,
        personaMd,
        // #110 Phase 2B Commit 11: strukturierte Form für späteren Settings-
        // Pre-Fill mitspeichern. `persona` ist das vom Wizard validierte
        // PersonaInput-Object (matched PersonaInputSchema in shared).
        personaInputJson: persona,
        mandates,
        llmConfig: storedLlmConfig,
        bridgeUrl,
        bridgeToken,
        ownerUserId: user.userId,
        isActive: true,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return reply.status(500).send({
        error: `DB-Insert fehlgeschlagen: ${msg}`,
      });
    }

    // 7. Hot-Reload (#37) — Twin direkt in die Registry einklinken, damit
    // der Wizard-Redirect zu /chat/<handle> ohne Runtime-Restart funktioniert.
    // Bei Hot-Load-Fehler: Profil bleibt in DB, User bekommt 201 mit
    // ehrlichem Restart-Hinweis (Restart hilft, weil loadAll() das Profil
    // dann beim Boot picked). Preset-Activation läuft auch im Fehlerfall
    // nicht, weil die Pattern-Skills ohne Registry-Eintrag keine Engine
    // hätten — Twin müsste dann nach Restart neu via Settings ergänzen.
    try {
      await deps.registry.addTwin(profile.twinId);
      const presetResults = await activatePresets({
        presetIds: presets,
        twinId: profile.twinId,
        examplesDir: deps.examplesDir,
        skillRepo: deps.skillRepo,
        logger: app.log,
      });
      return reply.status(201).send({
        twinId: profile.twinId,
        handle: profile.handle,
        requiresRestart: false,
        presetResults,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      app.log.error(
        { err, twinId: profile.twinId, handle: profile.handle },
        "[onboarding] Hot-Load fehlgeschlagen — Profil ist in DB, Restart hilft",
      );
      return reply.status(201).send({
        twinId: profile.twinId,
        handle: profile.handle,
        requiresRestart: true,
        hotLoadError: msg,
      });
    }
  });
}

/**
 * Bridge-URL für neu angelegte Twin-Profile. Production setzt
 * `TWIN_LAB_DEFAULT_BRIDGE_URL` in der `.env` auf die gehostete Bridge,
 * lokal bleibt sie ungesetzt → Fallback auf den Dev-Bridge-Port.
 */
function pickBridgeUrlForOnboarding(): string {
  return (
    process.env.TWIN_LAB_DEFAULT_BRIDGE_URL?.trim() || "http://127.0.0.1:5100"
  );
}

// ─── AUTH ROUTES ─────────────────────────────────────────────────────────────
//
// Email/Passwort-Login mit iron-session-Cookie. Bewusst keine Email-
// Verifikation heute (kommt 2.5.5) und kein Rate-Limiting (Backlog #41).
// Generic-Error-Strings bei Login, damit User-Enumeration nicht trivial ist.

const EmailSchema = z.string().trim().toLowerCase().email();

const RegisterSchema = z.object({
  email: EmailSchema,
  password: z.string().min(8, "Passwort muss mind. 8 Zeichen haben"),
  displayName: z.string().trim().min(1).optional(),
});

const LoginSchema = z.object({
  email: EmailSchema,
  password: z.string().min(1),
});

function registerAuthRoutes(app: FastifyInstance, deps: ServerDeps) {
  const usersRepo = new UsersRepo(deps.db);

  app.post("/auth/register", async (request, reply) => {
    const parsed = RegisterSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.message });
    }
    try {
      const user = usersRepo.create(
        parsed.data.email,
        parsed.data.password,
        parsed.data.displayName,
      );
      await setSession(reply, { userId: user.userId });
      return reply.status(201).send({
        userId: user.userId,
        email: user.email,
        displayName: user.displayName,
      });
    } catch (err) {
      if (err instanceof UserAlreadyExistsError) {
        return reply.status(409).send({ error: err.message });
      }
      throw err;
    }
  });

  app.post("/auth/login", async (request, reply) => {
    const parsed = LoginSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.message });
    }
    const user = usersRepo.verifyPassword(parsed.data.email, parsed.data.password);
    if (!user) {
      // Gleiche Fehlermeldung für "User nicht gefunden" und "Passwort
      // falsch" — verhindert User-Enumeration via Login-Endpoint.
      return reply.status(401).send({ error: "Email oder Passwort falsch" });
    }
    await setSession(reply, { userId: user.userId });
    return {
      userId: user.userId,
      email: user.email,
      displayName: user.displayName,
    };
  });

  app.post("/auth/logout", async (_request, reply) => {
    destroySession(reply);
    return reply.status(204).send();
  });

  app.get("/auth/me", async (request, reply) => {
    const user = await getCurrentUser(request, deps.db);
    if (!user) return reply.status(401).send({ error: "Nicht eingeloggt" });
    return {
      userId: user.userId,
      email: user.email,
      displayName: user.displayName,
    };
  });
}

// ─── TRUST ROUTES ────────────────────────────────────────────────────────────
//
// Phase 2.5.4.1: Owner verwaltet die Trust-Liste seines Twins. Alle drei
// Routes Owner-gated. POST validiert, dass der trustedHandle in der Bridge
// existiert (Tippfehler-Schutz) und dass es kein Self-Trust ist (kein DB-
// Eintrag, aber 200 mit Hinweis — Self-Trust hat sowieso keinen Effekt, weil
// receiveBridgeMessage nie eine eigene Nachricht empfängt).

const TrustAddSchema = z.object({
  trustedHandle: z.string().regex(/^@[a-z0-9_-]+$/),
  note: z.string().max(500).optional(),
});

function registerTrustRoutes(
  app: FastifyInstance,
  deps: ServerDeps,
  requireOwner: (
    request: FastifyRequest,
    reply: FastifyReply,
    handle: string,
  ) => Promise<{ entry: RegistryEntry; user: User } | null>,
) {
  // Liste
  app.get<{ Params: { handle: string } }>(
    "/twins/:handle/trust",
    async (request, reply) => {
      const ctx = await requireOwner(request, reply, request.params.handle);
      if (!ctx) return;
      const trusts = deps.trustRepo.list(ctx.entry.twinId);
      return { trusts };
    },
  );

  // Add
  app.post<{ Params: { handle: string } }>(
    "/twins/:handle/trust",
    async (request, reply) => {
      const ctx = await requireOwner(request, reply, request.params.handle);
      if (!ctx) return;
      const { entry, user } = ctx;
      const parsed = TrustAddSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: parsed.error.message });
      }
      const { trustedHandle, note } = parsed.data;
      const normalized = trustedHandle.toLowerCase();

      // Self-Trust: still ignorieren. Kein DB-Eintrag, kein Audit, aber
      // 200 mit Hinweis — UI kann die Meldung anzeigen, ohne dass es als
      // Fehler durchgeht.
      if (normalized === entry.handle.toLowerCase()) {
        return reply.status(200).send({
          ignored: true,
          reason: "Self-Trust hat keinen Effekt — eigene Anfragen sind ohnehin Owner-Direct.",
        });
      }

      // Bridge-Lookup: existiert der Handle? Wir nutzen GET /twins der Bridge
      // (auth-protected mit unserem Bridge-Token) und checken die Liste. So
      // schützen wir vor Tippfehlern wie @floran statt @florian.
      const knownHandles = await fetchBridgeHandles(entry).catch((err) => {
        request.log.warn({ err }, "[trust] Bridge-Handle-Lookup fehlgeschlagen");
        return null;
      });
      if (knownHandles === null) {
        return reply.status(502).send({
          error: "Bridge ist gerade nicht erreichbar — Handle konnte nicht validiert werden.",
        });
      }
      if (!knownHandles.has(normalized)) {
        return reply.status(400).send({
          error: "Diesen Handle kennt die Bridge nicht. Tippfehler? Oder noch nicht registriert?",
          code: "HANDLE_NOT_REGISTERED",
        });
      }

      try {
        const trust = deps.trustRepo.add(entry.twinId, normalized, user.userId, note);
        // Audit-Trace, damit der Owner im Log sieht, wann Trust gesetzt wurde.
        await deps.audit.append({
          id: `audit_${nanoid(12)}`,
          twinId: entry.twinId,
          timestamp: new Date().toISOString(),
          capability: "trust-added",
          mandateId: null,
          status: "executed",
          input: { trustedHandle: normalized, note: trust.note },
          output: { trustId: trust.trustId },
          reason: null,
        });
        return reply.status(201).send({
          trustId: trust.trustId,
          trustedHandle: trust.trustedHandle,
          note: trust.note,
          createdAt: trust.createdAt,
        });
      } catch (err) {
        if (err instanceof TrustAlreadyExistsError) {
          return reply.status(409).send({
            error: "Schon in deiner Vertrauten-Liste.",
            code: "TRUST_ALREADY_EXISTS",
          });
        }
        throw err;
      }
    },
  );

  // Remove
  app.delete<{ Params: { handle: string; trustId: string } }>(
    "/twins/:handle/trust/:trustId",
    async (request, reply) => {
      const ctx = await requireOwner(request, reply, request.params.handle);
      if (!ctx) return;
      const { entry } = ctx;

      // Sicherstellen, dass die Trust-Row zum richtigen Twin gehört —
      // sonst könnte ein Owner mit /twins/@own/trust/:id einen fremden
      // Trust löschen, wenn er die ID kennt.
      const existing = deps.trustRepo.findById(request.params.trustId);
      if (!existing || existing.twinId !== entry.twinId) {
        return reply.status(404).send({ error: "Trust-Eintrag nicht für diesen Twin" });
      }

      try {
        deps.trustRepo.remove(existing.trustId);
        await deps.audit.append({
          id: `audit_${nanoid(12)}`,
          twinId: entry.twinId,
          timestamp: new Date().toISOString(),
          capability: "trust-removed",
          mandateId: null,
          status: "executed",
          input: { trustedHandle: existing.trustedHandle, trustId: existing.trustId },
          output: null,
          reason: null,
        });
        return reply.status(204).send();
      } catch (err) {
        if (err instanceof TrustNotFoundError) {
          return reply.status(404).send({ error: err.message });
        }
        throw err;
      }
    },
  );
}

// ─── SKILL ROUTES (3.1.E) ────────────────────────────────────────────────────
//
// Read-only Skill-UI: GET listet Skills im UI-Payload-Format (ohne
// instructions_md/script_ts), PATCH togglet `isActive`. Anlegen, Editieren,
// Löschen läuft weiter über CLI (`twin:skill-create`) — Edit-UI kommt später.

const SkillToggleSchema = z.object({
  isActive: z.boolean(),
});

function toSkillUiPayload(skill: Skill): SkillUiPayload {
  return {
    skillId: skill.skillId,
    name: skill.name,
    description: skill.description,
    capability: skill.manifestJson.capability,
    requiresApproval: skill.manifestJson.requiresApproval,
    source: skill.source,
    isActive: skill.isActive,
    instructionsLength: skill.instructionsMd.length,
    hasScript: skill.scriptTs !== null && skill.scriptTs.length > 0,
    createdAt: new Date(skill.createdAt).toISOString(),
    updatedAt: new Date(skill.updatedAt).toISOString(),
  };
}

/**
 * #86: Detail-Payload mit Manifest + Instructions + Script — für den
 * Skill-Editor (Prefill in Edit-Mode, Response auf Create/Update).
 * Listings nutzen weiter den schlanken UiPayload.
 */
function toSkillDetailPayload(skill: Skill): SkillDetailPayload {
  return {
    ...toSkillUiPayload(skill),
    manifestJson: skill.manifestJson,
    instructionsMd: skill.instructionsMd,
    scriptTs: skill.scriptTs,
  };
}

function registerSkillRoutes(
  app: FastifyInstance,
  deps: ServerDeps,
  requireOwner: (
    request: FastifyRequest,
    reply: FastifyReply,
    handle: string,
  ) => Promise<{ entry: RegistryEntry; user: User } | null>,
) {
  // Liste — aktive Skills zuerst (alphabetisch), dann inaktive (alphabetisch).
  app.get<{ Params: { handle: string } }>(
    "/twins/:handle/skills",
    async (request, reply) => {
      const ctx = await requireOwner(request, reply, request.params.handle);
      if (!ctx) return;
      const skills = deps.skillRepo
        .list(ctx.entry.twinId)
        .map(toSkillUiPayload)
        .sort((a, b) => {
          if (a.isActive !== b.isActive) return a.isActive ? -1 : 1;
          return a.name.localeCompare(b.name);
        });
      return { skills };
    },
  );

  // Toggle isActive. Cross-Twin-Schutz: Skill muss zum aufgerufenen Twin
  // gehören — sonst 404, gleicher Trick wie bei DELETE /trust/:id.
  app.patch<{ Params: { handle: string; skillId: string } }>(
    "/twins/:handle/skills/:skillId/active",
    async (request, reply) => {
      const ctx = await requireOwner(request, reply, request.params.handle);
      if (!ctx) return;
      const { entry } = ctx;

      const parsed = SkillToggleSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: parsed.error.message });
      }

      const existing = deps.skillRepo.findById(request.params.skillId);
      if (!existing || existing.twinId !== entry.twinId) {
        return reply.status(404).send({ error: "Skill nicht für diesen Twin" });
      }

      deps.skillRepo.setActive(existing.skillId, parsed.data.isActive);
      const updated = deps.skillRepo.findById(existing.skillId);
      if (!updated) {
        // Sollte unmöglich sein — setActive ist atomar, kein DELETE dazwischen.
        return reply.status(500).send({ error: "Skill nach Update nicht gefunden" });
      }
      return toSkillUiPayload(updated);
    },
  );

  // ─── #86: Detail-View für Edit-Prefill ──────────────────────────────────
  app.get<{ Params: { handle: string; skillId: string } }>(
    "/twins/:handle/skills/:skillId",
    async (request, reply) => {
      const ctx = await requireOwner(request, reply, request.params.handle);
      if (!ctx) return;
      const { entry } = ctx;
      const skill = deps.skillRepo.findById(request.params.skillId);
      if (!skill || skill.twinId !== entry.twinId) {
        return reply.status(404).send({ error: "Skill nicht für diesen Twin" });
      }
      return toSkillDetailPayload(skill);
    },
  );

  // ─── #86: Create (manual only) ──────────────────────────────────────────
  app.post<{ Params: { handle: string } }>(
    "/twins/:handle/skills",
    async (request, reply) => {
      const ctx = await requireOwner(request, reply, request.params.handle);
      if (!ctx) return;
      const { entry } = ctx;

      const parsed = SkillCreateRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: parsed.error.message });
      }
      const { name, description, manifestJson, instructionsMd, scriptTs } =
        parsed.data;

      // Manifest hat eigene name/description-Felder — wir spiegeln die
      // Request-Top-Level-Werte rein, damit Form-Inputs und JSON-Editor
      // nicht doppelt gepflegt werden müssen.
      const fullManifest = { ...manifestJson, name, description };

      try {
        const created = deps.skillRepo.add({
          twinId: entry.twinId,
          name,
          description,
          manifestJson: fullManifest,
          instructionsMd,
          scriptTs: scriptTs ?? null,
          source: "manual",
        });
        return reply.status(201).send(toSkillDetailPayload(created));
      } catch (err) {
        if (err instanceof SkillAlreadyExistsError) {
          return reply.status(409).send({
            error: "skill_name_taken",
            name,
          });
        }
        if (err instanceof SkillValidationError) {
          return reply.status(400).send({ error: err.message });
        }
        throw err;
      }
    },
  );

  // ─── #110: Import aus examples/skills/ (Production-Templates) ──────────
  //
  // Idempotent (force=true): existing Skill mit gleichem Namen wird
  // überschrieben, neu eingespielt sonst. Whitelist via Zod-Enum in shared
  // (`EXAMPLE_SKILL_TEMPLATES`), plus defensiver Path-Injection-Check.
  app.post<{ Params: { handle: string } }>(
    "/twins/:handle/skills/import",
    async (request, reply) => {
      const ctx = await requireOwner(request, reply, request.params.handle);
      if (!ctx) return;
      const { entry } = ctx;

      const parsed = SkillImportRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: parsed.error.message });
      }
      const { path } = parsed.data;

      // Defensiver Doppel-Check: Zod-Enum schließt Path-Traversal bereits aus,
      // aber wenn die Whitelist mal um dynamische Quellen erweitert wird
      // (`source: 'url'` etc.), bleibt diese Sperre als zweite Verteidigungs-
      // Linie stehen.
      if (path.includes("..") || path.includes("/") || path.includes("\\")) {
        return reply.status(400).send({
          error: "path enthält ungültige Zeichen (.., / oder \\ nicht erlaubt)",
        });
      }

      const skillDir = resolve(deps.examplesDir, path);
      try {
        const result = importSkillFromDir({
          skillRepo: deps.skillRepo,
          twinId: entry.twinId,
          skillDir,
          force: true, // Endpoint ist idempotent — kein 409, sondern UPDATE.
          // Tracking: aus Production-Template importiert, nicht hand-getippt.
          // Unterscheidung von CLI-Default 'manual' für späteres Re-Import-
          // Pattern (Template-Update → Endpoint flippt source bei UPDATE).
          source: "example",
        });
        const statusCode = result.status === "created" ? 201 : 200;
        return reply.status(statusCode).send({
          skillId: result.skill.skillId,
          status: result.status,
          name: result.skill.name,
        });
      } catch (err) {
        if (err instanceof SkillImportError) {
          return reply.status(400).send({ error: err.message });
        }
        if (err instanceof SkillValidationError) {
          return reply.status(400).send({ error: err.message });
        }
        request.log.error(
          { err, twinId: entry.twinId, path },
          "[skills/import] unerwarteter Fehler beim Skill-Import",
        );
        return reply.status(500).send({
          error: err instanceof Error ? err.message : String(err),
        });
      }
    },
  );

  // ─── #86: Update (manual only — MCP-Skills sind read-only) ──────────────
  app.patch<{ Params: { handle: string; skillId: string } }>(
    "/twins/:handle/skills/:skillId",
    async (request, reply) => {
      const ctx = await requireOwner(request, reply, request.params.handle);
      if (!ctx) return;
      const { entry } = ctx;

      const existing = deps.skillRepo.findById(request.params.skillId);
      if (!existing || existing.twinId !== entry.twinId) {
        return reply.status(404).send({ error: "Skill nicht für diesen Twin" });
      }
      // MCP-Skills sind synthetisch (via mcp-add/mcp-refresh), Edit würde
      // beim nächsten Refresh überschrieben — daher 403.
      if (existing.source === "mcp") {
        return reply.status(403).send({ error: "mcp_skill_not_editable" });
      }

      const parsed = SkillUpdateRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: parsed.error.message });
      }

      // Top-Level description ist Source of Truth — wir spiegeln sie immer
      // in das Manifest, egal ob der Client `manifestJson` explizit mit-
      // schickt oder nicht. Sonst sieht die Detail-Response inkonsistente
      // Werte (Top-Level neu, Manifest alt).
      const patch: Parameters<typeof deps.skillRepo.update>[1] = {};
      if (parsed.data.description !== undefined) {
        patch.description = parsed.data.description;
      }
      const nextDescription =
        parsed.data.description ?? existing.description;
      if (parsed.data.manifestJson !== undefined) {
        patch.manifestJson = {
          ...parsed.data.manifestJson,
          name: existing.name,
          description: nextDescription,
        };
      } else if (parsed.data.description !== undefined) {
        // Nur description geändert — Manifest aus existing-Stand re-patchen,
        // damit die Spiegelung greift.
        patch.manifestJson = {
          ...existing.manifestJson,
          description: nextDescription,
        };
      }
      if (parsed.data.instructionsMd !== undefined) {
        patch.instructionsMd = parsed.data.instructionsMd;
      }
      if (parsed.data.scriptTs !== undefined) {
        patch.scriptTs = parsed.data.scriptTs;
      }

      try {
        const updated = deps.skillRepo.update(existing.skillId, patch);
        return toSkillDetailPayload(updated);
      } catch (err) {
        if (err instanceof SkillValidationError) {
          return reply.status(400).send({ error: err.message });
        }
        throw err;
      }
    },
  );

  // ─── #86: Delete (manual only) ──────────────────────────────────────────
  app.delete<{ Params: { handle: string; skillId: string } }>(
    "/twins/:handle/skills/:skillId",
    async (request, reply) => {
      const ctx = await requireOwner(request, reply, request.params.handle);
      if (!ctx) return;
      const { entry } = ctx;

      const existing = deps.skillRepo.findById(request.params.skillId);
      if (!existing || existing.twinId !== entry.twinId) {
        return reply.status(404).send({ error: "Skill nicht für diesen Twin" });
      }
      if (existing.source === "mcp") {
        // MCP-Skills werden via `mcp-remove` (CLI) plus Cascade-Delete
        // entfernt — direkter DELETE würde den FK reißen.
        return reply.status(403).send({ error: "mcp_skill_not_editable" });
      }

      deps.skillRepo.remove(existing.skillId);
      return reply.status(204).send();
    },
  );
}

// ─── MCP-SERVER ROUTES (#87) ─────────────────────────────────────────────────
//
// HTTP-Verträge für den Settings-MCP-Configurator. Sensitive Felder bleiben
// server-only: kein command/args/url/env in den Listings — der UI-Payload
// trägt nur Identität + Lifecycle + skillCount für die Cascade-Warnung.
//
// Add läuft analog zum CLI-Pfad (`mcp-add`):
//   1. Spec-Schema validieren
//   2. Repo.add (verschlüsselt env mit Master-Key)
//   3. Twin-eigener McpSkillSync.syncOnAdd → spawnt Server + listTools + Skills
//   4. Bei Sync-Failure: Repo.remove (Rollback, sonst halb-konfigurierter Server)
//
// Delete: Manager.disconnect (falls running) → Repo.remove. Skills-Cascade
// via FK ON DELETE CASCADE (mcp_server_id → mcp_servers.id).

function toMcpServerUiPayload(
  server: McpServer,
  skillCount: number,
): McpServerUiPayload {
  return {
    serverId: server.id,
    name: server.name,
    transport: server.transport,
    isActive: server.isActive,
    defaultRequiresApproval: server.defaultRequiresApproval,
    skillCount,
    createdAt: server.createdAt,
    updatedAt: server.updatedAt,
  };
}

function registerMcpServerRoutes(
  app: FastifyInstance,
  deps: ServerDeps,
  requireOwner: (
    request: FastifyRequest,
    reply: FastifyReply,
    handle: string,
  ) => Promise<{ entry: RegistryEntry; user: User } | null>,
) {
  // skillCount per Server in O(n_skills) — kein eigener COUNT(*)-Query, weil
  // SkillRepo.listByMcpServer schon existiert und die Twin-Listings klein
  // genug sind, dass eine zusätzliche SQL-Optimierung sich nicht lohnt.
  const countSkills = (mcpServerId: string): number =>
    deps.skillRepo.listByMcpServer(mcpServerId).length;

  // ─── List ───────────────────────────────────────────────────────────────
  app.get<{ Params: { handle: string } }>(
    "/twins/:handle/mcp-servers",
    async (request, reply) => {
      const ctx = await requireOwner(request, reply, request.params.handle);
      if (!ctx) return;
      const { entry } = ctx;
      const servers = deps.mcpServersRepo
        .list(entry.twinId)
        .map((s) => toMcpServerUiPayload(s, countSkills(s.id)))
        .sort((a, b) => a.name.localeCompare(b.name));
      return { servers };
    },
  );

  // ─── Create + Sync ──────────────────────────────────────────────────────
  app.post<{ Params: { handle: string } }>(
    "/twins/:handle/mcp-servers",
    async (request, reply) => {
      const ctx = await requireOwner(request, reply, request.params.handle);
      if (!ctx) return;
      const { entry } = ctx;

      const parsed = McpServerCreateRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: parsed.error.message });
      }
      const spec = parsed.data;

      let serverId: string | null = null;
      let synced = false;
      try {
        const created = deps.mcpServersRepo.add({
          twinId: entry.twinId,
          name: spec.name,
          transport: spec.transport,
          command: spec.command ?? null,
          args: spec.args ?? null,
          env: spec.env ?? null,
          url: spec.url ?? null,
          defaultRequiresApproval: spec.defaultRequiresApproval ?? true,
        });
        serverId = created.id;

        // Twin-eigener Sync zieht die Tools, schreibt Skills, hält das
        // Mapping mcp_server_id → skill_id in der DB.
        const syncResult = await entry.service.mcpSkillSync.syncOnAdd(
          created.id,
        );
        synced = true;
        return reply.status(201).send({
          ...toMcpServerUiPayload(created, syncResult.added),
          syncedSkills: syncResult.added,
          skippedSkills: syncResult.skipped,
        });
      } catch (err) {
        if (err instanceof McpServerAlreadyExistsError) {
          return reply
            .status(409)
            .send({ error: "mcp_server_name_taken", name: spec.name });
        }
        if (err instanceof McpServerValidationError) {
          return reply.status(400).send({ error: err.message });
        }
        // Spawn-/Sync-Failure: Server-Eintrag rollback (Skills wurden noch
        // nicht gewritten, da Sync gefailt vor Skill-Insert).
        const message = err instanceof Error ? err.message : String(err);
        return reply.status(400).send({
          error: "mcp_server_spawn_failed",
          detail: message,
        });
      } finally {
        if (!synced && serverId) {
          try {
            deps.mcpServersRepo.remove(serverId);
          } catch (rollbackErr) {
            request.log.error(
              { err: rollbackErr, serverId },
              "[mcp-servers] Rollback nach Sync-Failure fehlgeschlagen",
            );
          }
        }
      }
    },
  );

  // ─── Toggle active ──────────────────────────────────────────────────────
  app.patch<{ Params: { handle: string; serverId: string } }>(
    "/twins/:handle/mcp-servers/:serverId/active",
    async (request, reply) => {
      const ctx = await requireOwner(request, reply, request.params.handle);
      if (!ctx) return;
      const { entry } = ctx;
      const parsed = z.object({ isActive: z.boolean() }).safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: parsed.error.message });
      }

      const existing = deps.mcpServersRepo
        .list(entry.twinId)
        .find((s) => s.id === request.params.serverId);
      if (!existing) {
        return reply
          .status(404)
          .send({ error: "MCP-Server nicht für diesen Twin" });
      }

      deps.mcpServersRepo.setActive(existing.id, parsed.data.isActive);
      const updated = deps.mcpServersRepo
        .list(entry.twinId)
        .find((s) => s.id === existing.id);
      if (!updated) {
        return reply.status(500).send({
          error: "MCP-Server nach Toggle nicht gefunden",
        });
      }
      return toMcpServerUiPayload(updated, countSkills(updated.id));
    },
  );

  // ─── Delete + Cascade ───────────────────────────────────────────────────
  app.delete<{ Params: { handle: string; serverId: string } }>(
    "/twins/:handle/mcp-servers/:serverId",
    async (request, reply) => {
      const ctx = await requireOwner(request, reply, request.params.handle);
      if (!ctx) return;
      const { entry } = ctx;

      const existing = deps.mcpServersRepo
        .list(entry.twinId)
        .find((s) => s.id === request.params.serverId);
      if (!existing) {
        return reply
          .status(404)
          .send({ error: "MCP-Server nicht für diesen Twin" });
      }

      const skillCount = countSkills(existing.id);

      // Falls Server-Prozess gerade läuft: graceful disconnect.
      // Manager.disconnect ist idempotent (no-op wenn kein Prozess da).
      try {
        await entry.service.mcp.disconnect(existing.id);
      } catch (err) {
        request.log.warn(
          { err, serverId: existing.id },
          "[mcp-servers] Disconnect vor Delete fehlgeschlagen — fahre fort",
        );
      }

      deps.mcpServersRepo.remove(existing.id);
      return reply
        .status(200)
        .send({ ok: true, deletedSkills: skillCount });
    },
  );
}

// ─── SETTINGS ROUTES (#110 Phase 2B Commit 11) ──────────────────────────────
//
// GET /twins/:handle/settings-data: Pre-Fill-Daten für die Settings-Page.
// Liefert die strukturierte Persona-Form (oder Hint, dass Legacy-Twin),
// LLM-Provider/Model + API-Key-Maske, und die Liste der aktiven Preset-
// Skills (source='example').
//
// PATCH /twins/:handle/full-config: atomarer Update-Pfad für Persona +
// LLM-Config + Presets. Alle drei Block sind optional — Frontend sendet
// nur das, was sich geändert hat. API-Key kennt `null` als no-change-
// Signal; sonst wird er validiert + neu encrypted. Presets sind ein
// Soll-Zustand (Delete-and-Re-Insert von source='example'-Skills).
//
// Hot-Reload: nach Persona- oder LLM-Updates muss die Registry den Twin
// neu laden, sonst lesen aktive Sessions weiter den alten Stand. Wir
// nutzen `registry.reloadTwin` (idempotenter Remove-and-Add-Pfad).

function registerTwinSettingsRoutes(
  app: FastifyInstance,
  deps: ServerDeps,
  requireOwner: (
    request: FastifyRequest,
    reply: FastifyReply,
    handle: string,
  ) => Promise<{ entry: RegistryEntry; user: User } | null>,
) {
  // ─── GET /twins/:handle/settings-data ──────────────────────────────────
  app.get<{ Params: { handle: string } }>(
    "/twins/:handle/settings-data",
    async (request, reply) => {
      const ctx = await requireOwner(request, reply, request.params.handle);
      if (!ctx) return;
      const { entry } = ctx;

      // Bug-Fix Tag 22: `entry.profile` ist Registry-Cache vom Boot/Hot-Load.
      // Nach Settings-Updates (PATCH /full-config) hat die DB den neuen Stand,
      // aber Registry-Cache nicht. Heißt: User reloadet Settings und sieht
      // weiterhin den alten Wert. Fix: fresh `findById` aus dem Repo.
      const profile = deps.profilesRepo.findById(entry.twinId);
      if (!profile) {
        return reply.status(404).send({ error: "Twin nicht in DB" });
      }

      const persona = profile.personaInputJson;
      const activePresets = deps.skillRepo
        .list(profile.twinId, { activeOnly: false })
        .filter((s) => s.source === "example")
        .map((s) => s.name)
        .sort();

      return {
        persona,
        personaSource: persona ? "structured" : "legacy_markdown",
        llmConfig: {
          provider: profile.llmConfig.provider,
          model: profile.llmConfig.model,
          // API-Key-Maske aus llmDisplay (Boot-decrypteter Masked-String).
          // Auch das ist stale nach PATCH; akzeptabel weil Maske nur die
          // ersten/letzten 4 chars zeigt und unsere Maske über das ganze
          // Onboarding-Submit konsistent ist. Für vollständige Frische
          // wäre Registry-Reload nötig (siehe requiresRestart-Doku).
          apiKeyMasked: entry.llmDisplay.apiKeyMasked,
        },
        activePresets,
      };
    },
  );

  // ─── PATCH /twins/:handle/full-config ──────────────────────────────────
  app.patch<{ Params: { handle: string } }>(
    "/twins/:handle/full-config",
    async (request, reply) => {
      const ctx = await requireOwner(request, reply, request.params.handle);
      if (!ctx) return;
      const { entry } = ctx;

      const parsed = FullConfigUpdateRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: parsed.error.message });
      }
      const body = parsed.data;

      let touchedProfile = false;
      let touchedLlm = false;

      // 1. Persona-Update — gleichzeitig persona_md + persona_input_json
      //    aktualisieren, damit beide Repräsentationen konsistent bleiben.
      let nextPersonaMd: string | undefined;
      let nextPersonaInput: PersonaInputUpdate | undefined;
      if (body.persona) {
        nextPersonaMd = buildPersonaMarkdown(body.persona);
        nextPersonaInput = body.persona;
        touchedProfile = true;
      }

      // 2. LLM-Update — apiKey explizit behandeln: null/undefined = no-change,
      //    String = validateApiKey + encrypt.
      let nextLlmConfig: StoredLlmConfig | undefined;
      if (body.llmConfig) {
        // Bug-Fix Tag 22: existing aus DB statt aus Registry-Cache, damit
        // nach mehreren aufeinanderfolgenden Settings-Updates der jeweils
        // aktuelle Stand als Basis dient. Registry-Cache bleibt sonst auf
        // Boot-Snapshot stehen.
        const dbProfile = deps.profilesRepo.findById(entry.twinId);
        if (!dbProfile) {
          return reply.status(404).send({ error: "Twin nicht in DB" });
        }
        const existing = dbProfile.llmConfig;
        const provider = body.llmConfig.provider ?? existing.provider;
        const model = body.llmConfig.model ?? existing.model;
        let apiKeyEncrypted = existing.apiKeyEncrypted;

        if (body.llmConfig.apiKey != null) {
          const trimmedKey = body.llmConfig.apiKey.trim();
          if (!trimmedKey) {
            return reply.status(400).send({
              error: "API-Key ist leer — null senden für no-change",
            });
          }
          // Provider/Model können sich gerade ändern; wir validieren gegen
          // die finalen Werte, damit ein Provider-Wechsel mit gültigem
          // Schlüssel direkt erkannt wird.
          const validation = await validateApiKey(
            provider as (typeof LLM_PROVIDERS)[number],
            trimmedKey,
            model,
          );
          if (!validation.valid) {
            return reply.status(400).send({
              error: `API-Key ungültig: ${validation.reason}`,
            });
          }
          apiKeyEncrypted = encrypt(trimmedKey, deps.masterKey);
        }

        nextLlmConfig = {
          ...existing,
          provider: provider as (typeof LLM_PROVIDERS)[number],
          model,
          apiKeyEncrypted,
          apiKeySource: "user",
        };
        touchedProfile = true;
        touchedLlm = true;
      }

      // 3. Profile-Update in einem Repo-Call (atomic UPDATE pro Row).
      // Patch explizit gebaut statt via conditional-spread — leichter zu
      // lesen und gegen JS-Spread-Subtleties (z.B. accidental undefined-
      // properties) immun.
      if (touchedProfile) {
        const patchObj: Record<string, unknown> = {};
        if (nextPersonaMd !== undefined) patchObj.personaMd = nextPersonaMd;
        if (nextPersonaInput !== undefined)
          patchObj.personaInputJson = nextPersonaInput;
        if (nextLlmConfig !== undefined) patchObj.llmConfig = nextLlmConfig;
        deps.profilesRepo.update(entry.twinId, patchObj);
      }

      // 4. Preset-Update als Soll-Zustand. Delete-all-example-Skills,
      //    dann re-import. Whitelist via Scanner (Single-Source-of-Truth
      //    examples/skills/-Folder).
      const presetResults: PresetActivationResult[] = [];
      if (body.presets) {
        const existingExampleSkills = deps.skillRepo
          .list(entry.twinId, { activeOnly: false })
          .filter((s) => s.source === "example");
        for (const skill of existingExampleSkills) {
          try {
            deps.skillRepo.remove(skill.skillId);
          } catch (err) {
            request.log.warn(
              { err, skillId: skill.skillId },
              "[settings/full-config] preset-skill remove failed",
            );
          }
        }
        const activated = await activatePresets({
          presetIds: body.presets,
          twinId: entry.twinId,
          examplesDir: deps.examplesDir,
          skillRepo: deps.skillRepo,
          logger: app.log,
        });
        presetResults.push(...activated);
      }

      // 5. Hot-Reload-Notiz: Skills werden per-Send-Call frisch aus der DB
      //    gelesen (3.1.B-Pattern), also greifen Preset-Updates sofort.
      //    Persona-MD und LLM-Config werden aber nur beim TwinService-Boot
      //    gelesen — die Registry hat heute keinen `reloadTwin`-Pfad. Bis das
      //    in einem Folge-Commit kommt, sendet das Backend ein
      //    `requiresRestart`-Flag und das Frontend zeigt einen Hinweis.
      const requiresRestart = touchedProfile || touchedLlm;

      // 6. Frische settings-data zurückgeben — Frontend reload-frei.
      const refreshed = deps.profilesRepo.findById(entry.twinId);
      if (!refreshed) {
        return reply.status(500).send({ error: "Profil nach Update weg" });
      }
      const refreshedEntry = deps.registry.getEntry(refreshed.handle);
      const apiKeyMasked =
        refreshedEntry?.llmDisplay.apiKeyMasked ?? entry.llmDisplay.apiKeyMasked;
      const activePresets = deps.skillRepo
        .list(entry.twinId, { activeOnly: false })
        .filter((s) => s.source === "example")
        .map((s) => s.name)
        .sort();

      return reply.status(200).send({
        persona: refreshed.personaInputJson,
        personaSource: refreshed.personaInputJson ? "structured" : "legacy_markdown",
        llmConfig: {
          provider: refreshed.llmConfig.provider,
          model: refreshed.llmConfig.model,
          apiKeyMasked,
        },
        activePresets,
        presetResults,
        requiresRestart,
      });
    },
  );
}

type PersonaInputUpdate = NonNullable<TwinProfile["personaInputJson"]>;

// ─── TOOL ROUTES (3.2.H — Tool-Picker-UI) ────────────────────────────────────
//
// Liefert die aktiven MCP-Tools des Twins für den Tool-Picker im Chat-Input.
// Filter: source='mcp' AND is_active=true. Pro Skill resolven wir den Server-
// Namen über mcpServersRepo (Join wäre eleganter, aber das Volumen ist klein
// genug, dass ein In-Memory-Lookup über Map<id, name> ausreicht).
//
// inputSchema kommt aus dem Skill-Manifest (`mcpInputSchema`, befüllt von
// McpSkillSync.syncOnAdd seit 3.2.C). Picker-Frontend baut daraus die
// typisierte Args-Form. toolName ist der AI-SDK-Key (`mcp_<server>_<tool>` —
// derselbe Schlüssel, mit dem buildMcpToolsFromSkills die Tools registriert),
// damit forcedToolChoice 1:1 matcht.

function registerToolRoutes(
  app: FastifyInstance,
  deps: ServerDeps,
  requireOwner: (
    request: FastifyRequest,
    reply: FastifyReply,
    handle: string,
  ) => Promise<{ entry: RegistryEntry; user: User } | null>,
) {
  app.get<{ Params: { handle: string } }>(
    "/twins/:handle/tools",
    async (request, reply) => {
      const ctx = await requireOwner(request, reply, request.params.handle);
      if (!ctx) return;
      const { entry } = ctx;

      const skills = deps.skillRepo.list(entry.twinId, {
        activeOnly: true,
        source: "mcp",
      });

      // Server-Namen vorab in eine Map laden — N+1 vermeiden, weil ein Twin
      // typischerweise wenige MCP-Server hat aber dutzende Tools.
      const servers = deps.mcpServersRepo.list(entry.twinId);
      const serverNameById = new Map(servers.map((s) => [s.id, s.name]));

      const tools: TwinToolListItem[] = [];
      for (const skill of skills) {
        if (!skill.mcpServerId || !skill.mcpToolName) continue;
        const serverName = serverNameById.get(skill.mcpServerId);
        if (!serverName) continue; // Server gelöscht aber Skill noch da — skippen
        const toolKey = skill.name.replaceAll(":", "_");
        const inputSchema = skill.manifestJson.mcpInputSchema ?? null;
        tools.push({
          skillId: skill.skillId,
          skillName: skill.name,
          toolName: toolKey,
          description: skill.manifestJson.description ?? skill.description ?? null,
          inputSchema,
          serverName,
          requiresApproval: skill.manifestJson.requiresApproval,
        });
      }

      // Stabile Sortierung: Server-Name, dann Tool-Name. Macht den Picker
      // beim mehrmaligen Öffnen vorhersehbar.
      tools.sort((a, b) => {
        if (a.serverName !== b.serverName) {
          return a.serverName.localeCompare(b.serverName);
        }
        return a.skillName.localeCompare(b.skillName);
      });

      return { tools };
    },
  );
}

// ─── FACT ROUTES (3.3.D — Semantic-Memory CRUD) ──────────────────────────────
//
// Owner-gated CRUD für die facts-Tabelle aus Migration 014. Read-Pfad
// optional gefiltert nach confidence (Query-Param `?status=`). Create ist
// explizit non-upsert: bei existierendem (twin, key) gibt's 409 statt
// stilles UPDATE — der UI-Flow für "Wert ändern" geht über PATCH. Repo-
// upsert verwenden wir aber trotzdem als Insert-Pfad (Pre-Check vorher).
//
// `factKey` darf alle URL-safe Zeichen enthalten; im PATCH/DELETE-Pfad
// wird er via Fastify-Param dekodiert. Bei Pilot-Convention (lowercase +
// Underscore) sind keine encoding-Sonderfälle zu erwarten.

const FACT_STATUS_VALUES = ["approved", "pending", "auto"] as const;
type FactStatusFilter = (typeof FACT_STATUS_VALUES)[number];

function isFactStatus(v: unknown): v is FactStatusFilter {
  return typeof v === "string" && (FACT_STATUS_VALUES as readonly string[]).includes(v);
}

function toFactItem(f: {
  id: string;
  factKey: string;
  factValue: string;
  source: FactItem["source"];
  confidence: FactItem["confidence"];
  createdAt: string;
  updatedAt: string;
}): FactItem {
  return {
    id: f.id,
    factKey: f.factKey,
    factValue: f.factValue,
    source: f.source,
    confidence: f.confidence,
    createdAt: f.createdAt,
    updatedAt: f.updatedAt,
  };
}

function registerFactRoutes(
  app: FastifyInstance,
  deps: ServerDeps,
  requireOwner: (
    request: FastifyRequest,
    reply: FastifyReply,
    handle: string,
  ) => Promise<{ entry: RegistryEntry; user: User } | null>,
) {
  // ─── LIST ────────────────────────────────────────────────────────────────
  app.get<{
    Params: { handle: string };
    Querystring: { status?: string };
  }>("/twins/:handle/facts", async (request, reply) => {
    const ctx = await requireOwner(request, reply, request.params.handle);
    if (!ctx) return;
    const { entry } = ctx;

    const rawStatus = request.query.status?.trim();
    if (rawStatus && !isFactStatus(rawStatus)) {
      return reply.status(400).send({
        error: `status muss eines von ${FACT_STATUS_VALUES.join(", ")} sein`,
      });
    }
    const statusFilter = isFactStatus(rawStatus) ? rawStatus : null;

    // FactsRepo.listByTwin hat nur `onlyApproved` — restliche Filter machen
    // wir hier post-hoc. Bei null/undefined → alle Facts.
    const all = deps.factsRepo.listByTwin(entry.twinId);
    const filtered = statusFilter
      ? all.filter((f) => f.confidence === statusFilter)
      : all;
    return { facts: filtered.map(toFactItem) };
  });

  // ─── CREATE (create-only, 409 bei Konflikt) ──────────────────────────────
  app.post<{ Params: { handle: string } }>(
    "/twins/:handle/facts",
    async (request, reply) => {
      const ctx = await requireOwner(request, reply, request.params.handle);
      if (!ctx) return;
      const { entry } = ctx;

      const parsed = FactCreateRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: parsed.error.message });
      }
      const { factKey, factValue, source, confidence } = parsed.data;

      // Pre-Check: UPSERT würde stilles UPDATE machen — für den Create-Pfad
      // soll der Caller explizit PATCH nehmen, daher 409.
      const existing = deps.factsRepo.get(entry.twinId, factKey);
      if (existing) {
        return reply.status(409).send({
          error: `Fact '${factKey}' existiert bereits — nutze PATCH zum Aktualisieren`,
          code: "FACT_ALREADY_EXISTS",
        });
      }

      const fact = deps.factsRepo.upsert({
        twinId: entry.twinId,
        factKey,
        factValue,
        source,
        confidence,
      });
      return reply.status(201).send({ fact: toFactItem(fact) });
    },
  );

  // ─── UPDATE (Value + optional Confidence) ────────────────────────────────
  app.patch<{ Params: { handle: string; factKey: string } }>(
    "/twins/:handle/facts/:factKey",
    async (request, reply) => {
      const ctx = await requireOwner(request, reply, request.params.handle);
      if (!ctx) return;
      const { entry } = ctx;

      const factKey = decodeURIComponent(request.params.factKey);
      const parsed = FactUpdateRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: parsed.error.message });
      }

      const existing = deps.factsRepo.get(entry.twinId, factKey);
      if (!existing) {
        return reply.status(404).send({ error: `Fact '${factKey}' nicht gefunden` });
      }

      const nextConfidence: FactConfidence =
        parsed.data.confidence ?? existing.confidence;
      const fact = deps.factsRepo.upsert({
        twinId: entry.twinId,
        factKey,
        factValue: parsed.data.factValue,
        // source bleibt beim Original — PATCH ändert nie die Provenance.
        source: existing.source,
        confidence: nextConfidence,
      });
      return reply.status(200).send({ fact: toFactItem(fact) });
    },
  );

  // ─── DELETE ──────────────────────────────────────────────────────────────
  app.delete<{ Params: { handle: string; factKey: string } }>(
    "/twins/:handle/facts/:factKey",
    async (request, reply) => {
      const ctx = await requireOwner(request, reply, request.params.handle);
      if (!ctx) return;
      const { entry } = ctx;

      const factKey = decodeURIComponent(request.params.factKey);
      const removed = deps.factsRepo.delete(entry.twinId, factKey);
      if (!removed) {
        return reply.status(404).send({ error: `Fact '${factKey}' nicht gefunden` });
      }
      return reply.status(204).send();
    },
  );

  // ─── EXTRACT (3.3.F — Twin-Vorschläge) ───────────────────────────────────
  // Triggert die ExtractionEngine pro Konversation. Pending-Facts und Pending-
  // Audits landen direkt; Approve/Reject läuft über die generischen
  // `/twins/:handle/audit/:id/approve` und `.../reject`-Routes — kein
  // dedizierter Endpoint nötig, weil der `TwinService.approvePending`-Switch
  // den Capability-Branch `semantic-fact-write` schon kennt.
  app.post<{ Params: { handle: string } }>(
    "/twins/:handle/facts/extract",
    async (request, reply) => {
      const ctx = await requireOwner(request, reply, request.params.handle);
      if (!ctx) return;
      const { entry } = ctx;

      const parsed = FactExtractRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: parsed.error.message });
      }
      try {
        const result = await entry.service.extractionEngine.extractFromConversation(
          parsed.data.conversationId,
        );
        return reply.send(result);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Unknown error";
        return reply.status(500).send({ error: msg });
      }
    },
  );
}

// ─── CONVERSATION ROUTES (2.5.4.3) ───────────────────────────────────────────
//
// Symmetrische A2A-Conversations: Bridge-Messages sind die Source-of-Truth für
// den Verlauf, das lokale Audit-Log reichert nur an (Capability, Status,
// Read-State). Damit sehen beide Seiten denselben chronologischen Verlauf —
// vorher zog jede Seite nur ihre eigenen Audits, was zu Asymmetrie führte
// (Markus sah 5 Messages, Florian nur 1).
//
// Conversations-Liste: aus Bridge-Verlauf aggregiert (Partner = jeder Handle,
// mit dem wir Nachrichten ausgetauscht haben). Unread-Count zählt lokale
// reply-received-Audits ohne read_at.

const SendSchema = z.object({
  content: z.string().min(1).max(8000),
  /** Wenn die Conversation-View in einem Thread antwortet: id der Original-
   *  Message. Empfänger nutzt das für Reply-Detection — kein neuer Pending. */
  inReplyTo: z.string().nullable().optional(),
});

interface ConversationItem {
  partnerHandle: string;
  partnerDisplayName: string | null;
  lastMessageAt: string;
  unreadCount: number;
  /** #105: 'active' | 'ended' aus conversations-Tabelle. Bridge-Aggregat-Treffer */
  /** sind immer 'active' (nur aktive haben Bridge-Messages), lokale Merge-Treffer */
  /** kommen mit ihrem echten DB-Status. */
  status: "active" | "ended";
}

function registerConversationRoutes(
  app: FastifyInstance,
  deps: ServerDeps,
  requireOwner: (
    request: FastifyRequest,
    reply: FastifyReply,
    handle: string,
  ) => Promise<{ entry: RegistryEntry; user: User } | null>,
) {
  // GET /twins/:handle/conversations — Übersicht
  //
  // Aggregiert alle Bridge-Partner: jeder Handle, mit dem wir mindestens eine
  // Bridge-Message ausgetauscht haben. lastMessageAt aus Bridge, unreadCount
  // aus lokalen reply-received-Audits ohne read_at (gemerged via
  // bridgeMessageId).
  app.get<{ Params: { handle: string } }>(
    "/twins/:handle/conversations",
    async (request, reply) => {
      const ctx = await requireOwner(request, reply, request.params.handle);
      if (!ctx) return;
      const { entry } = ctx;

      const bridgeClient = bridgeClientFor(entry);
      let bridgePartners = new Map<string, { lastAt: string }>();
      let displayNames: Map<string, string> | null = null;

      // Bridge-Down → wir liefern leere Liste statt 502, damit die UI nicht
      // beim ersten Render bricht. UI soll error-tolerant sein; Owner sieht
      // dann halt keine Conversations, kann aber settings + Direct-Chat
      // weiter benutzen.
      try {
        const allMessages = await fetchAllBridgeConversations(entry, bridgeClient);
        bridgePartners = aggregateBridgePartners(allMessages, entry.handle);
        displayNames = await fetchBridgeDisplayNames(entry).catch(() => null);
      } catch (err) {
        request.log.warn({ err }, "[conversations] Bridge-Fetch fehlgeschlagen");
      }

      // Unread-Count: lokale reply-received-Audits, die noch kein read_at
      // haben. Wir gruppieren die nach fromHandle und matchen das auf die
      // Bridge-Partner-Map.
      const audits = await deps.audit.list({ limit: 1000, twinId: entry.twinId });
      const unreadByPartner = countUnreadRepliesByPartner(audits);

      const conversations: ConversationItem[] = [];
      for (const [partner, info] of bridgePartners) {
        conversations.push({
          partnerHandle: partner,
          partnerDisplayName: displayNames?.get(partner) ?? null,
          lastMessageAt: info.lastAt,
          unreadCount: unreadByPartner.get(partner) ?? 0,
          status: "active",
        });
      }

      // #105: lokale start-only-Konversationen ergänzen, die noch keine
      // Bridge-Messages haben. Sonst sind frisch angelegte A2A-Konvs in der
      // Sidebar unsichtbar. Filter:
      //   - status='active' (ended liegt unter UI-Lifecycle-Item #118)
      //   - partner != self (Direct-Chat-Rows raus, sonst Doppel-Render)
      //   - Partner nicht schon im Bridge-Aggregat (Bridge-Pfad hat Vorrang)
      const seenPartners = new Set(conversations.map((c) => c.partnerHandle));
      const localConvs = deps.conversationsRepo.listActiveByOwnerAndTwin(
        ctx.user.userId,
        entry.twinId,
      );
      const selfHandle = entry.handle.toLowerCase();
      for (const conv of localConvs) {
        const partner = conv.partnerHandle.toLowerCase();
        if (partner === selfHandle) continue;
        if (seenPartners.has(partner)) continue;
        conversations.push({
          partnerHandle: partner,
          partnerDisplayName: displayNames?.get(partner) ?? null,
          lastMessageAt: conv.startedAt,
          unreadCount: 0,
          status: "active",
        });
      }

      conversations.sort((a, b) => b.lastMessageAt.localeCompare(a.lastMessageAt));
      return { conversations };
    },
  );

  // GET /twins/:handle/conversations/:partnerHandle — chronologischer Thread
  //
  // Bridge-Verlauf zwischen uns und partner, angereichert mit lokalem Audit-
  // Wissen (capability, status, readAt). Symmetrisch — beide Seiten sehen
  // denselben Verlauf.
  app.get<{ Params: { handle: string; partnerHandle: string } }>(
    "/twins/:handle/conversations/:partnerHandle",
    async (request, reply) => {
      const ctx = await requireOwner(request, reply, request.params.handle);
      if (!ctx) return;
      const { entry, user } = ctx;
      const partner = decodeURIComponent(request.params.partnerHandle).toLowerCase();
      const isDirectChat = partner === entry.handle.toLowerCase();

      // #106: Direct-Chat hat keine Bridge-Messages — der Audit-Stream ist
      // dort die Truth-Source. Bridge-Call würde mit „Bridge nicht
      // erreichbar" fehlschlagen, weil es für die Self-Reference keinen
      // gültigen Bridge-Endpoint gibt. A2A-Pfad fragt Bridge wie bisher.
      const bridgeClient = bridgeClientFor(entry);
      let bridgeMessages: Awaited<ReturnType<typeof bridgeClient.getConversationMessages>> = [];
      if (!isDirectChat) {
        try {
          bridgeMessages = await bridgeClient.getConversationMessages(partner);
        } catch (err) {
          request.log.warn(
            { err, partner },
            "[conversations] Bridge-Conversation-Fetch fehlgeschlagen",
          );
          return reply.status(502).send({
            error: "Bridge nicht erreichbar — Conversation konnte nicht geladen werden.",
          });
        }
      }

      const audits = await deps.audit.list({ limit: 1000, twinId: entry.twinId });
      const merged: MergedMessage[] = mergeAuditIntoBridgeMessages(
        bridgeMessages,
        audits,
        entry.handle,
      );

      // #106: aktive Conv-Metadata für den Reset-Filter im Frontend. null
      // wenn keine aktive Konv da ist (kann bei A2A passieren, wo der
      // Bridge-Verlauf existiert aber lokal noch keine Row angelegt wurde).
      const activeConv = deps.conversationsRepo.findActive(
        user.userId,
        partner,
        entry.twinId,
      );
      const conversation = activeConv
        ? {
            id: activeConv.id,
            status: activeConv.status,
            startedAt: activeConv.startedAt,
            endedAt: activeConv.endedAt,
            lastResetAt: activeConv.lastResetAt,
          }
        : null;

      return { partnerHandle: partner, messages: merged, conversation };
    },
  );

  // POST /twins/:handle/conversations/reset — Direct-Chat-Konversation beenden
  // (#71b/#80 Sub-Schritt D). Lazy-Start der nächsten Konversation passiert
  // beim ersten Send via getOrStart() im TwinService. Idempotent: ohne aktive
  // Konversation kommt {reset:false} zurück, kein Fehler. partner_handle für
  // Direct-Chat = der Twin-Handle selbst (Owner chattet mit dem eigenen Twin),
  // konsistent mit Sub-Schritt B.
  app.post<{ Params: { handle: string } }>(
    "/twins/:handle/conversations/reset",
    async (request, reply) => {
      const ctx = await requireOwner(request, reply, request.params.handle);
      if (!ctx) return;
      const { entry, user } = ctx;

      const active = deps.conversationsRepo.findActive(
        user.userId,
        entry.handle,
        entry.twinId,
      );
      if (!active) {
        return { reset: false, reason: "no_active_conversation" };
      }
      // 3.4.D: resetConversation() macht den Embedding-Versuch für
      // Konversationen ohne Segments und ruft danach conversationsRepo.end().
      // Embedding-Failure unterbricht das Reset nicht.
      await entry.service.resetConversation(active.id);

      // #106: Eager-Start der nächsten Konv mit last_reset_at = NOW(). Das
      // ersetzt das bisherige Lazy-Start-via-getOrStart-beim-nächsten-Send.
      // Frontend nutzt last_reset_at als Filter-Boundary im DirectChat —
      // Audits mit timestamp < last_reset_at werden standardmäßig versteckt.
      const lastResetAt = new Date().toISOString();
      const fresh = deps.conversationsRepo.start({
        ownerUserId: user.userId,
        partnerHandle: entry.handle,
        twinId: entry.twinId,
        lastResetAt,
      });
      request.log.info(
        {
          oldConversationId: active.id,
          newConversationId: fresh.id,
          twinId: entry.twinId,
        },
        "[conversations] reset durch owner — alte beendet, neue eager gestartet",
      );
      return {
        reset: true,
        oldConversationId: active.id,
        newConversationId: fresh.id,
        lastResetAt,
      };
    },
  );

  // POST /twins/:handle/conversations/:partnerHandle — Start ohne Send (#105)
  //
  // Erlaubt einer A2A-Konversation den expliziten Start, bevor die erste
  // Nachricht geschrieben wird. Body wird ignoriert (Anti-Goal: keine
  // versteckte Send-Logic in der Start-Route). Idempotent via getOrStart —
  // wenn bereits eine aktive Konversation für (owner, partner, twin)
  // existiert, kommt sie zurück; sonst wird eine neue angelegt.
  //
  // Bridge-Handle-Validation analog zur Send-Route — verhindert dass ein
  // Tippfehler eine orphaned-Konversation hinterlässt, die der Empfänger
  // gar nicht kennen kann.
  app.post<{ Params: { handle: string; partnerHandle: string } }>(
    "/twins/:handle/conversations/:partnerHandle",
    async (request, reply) => {
      const ctx = await requireOwner(request, reply, request.params.handle);
      if (!ctx) return;
      const { entry, user } = ctx;
      const partner = decodeURIComponent(request.params.partnerHandle).toLowerCase();

      if (partner === entry.handle.toLowerCase()) {
        return reply.status(400).send({ error: "Selbst-Start nicht erlaubt" });
      }

      const knownHandles = await fetchBridgeHandles(entry).catch(() => null);
      if (knownHandles === null) {
        return reply.status(502).send({
          error: "Bridge nicht erreichbar — Empfänger konnte nicht validiert werden.",
        });
      }
      if (!knownHandles.has(partner)) {
        return reply.status(400).send({
          error: "Diesen Handle kennt die Bridge nicht.",
          code: "HANDLE_NOT_REGISTERED",
        });
      }

      const conversation = deps.conversationsRepo.getOrStart(
        user.userId,
        partner,
        entry.twinId,
      );
      return reply.status(201).send({ conversation });
    },
  );

  // POST /twins/:handle/conversations/:partnerHandle/send — Owner-Direct-Send
  app.post<{
    Params: { handle: string; partnerHandle: string };
    Body: { content?: string; inReplyTo?: string | null };
  }>(
    "/twins/:handle/conversations/:partnerHandle/send",
    async (request, reply) => {
      const ctx = await requireOwner(request, reply, request.params.handle);
      if (!ctx) return;
      const { entry } = ctx;
      const partner = decodeURIComponent(request.params.partnerHandle).toLowerCase();
      const parsed = SendSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: parsed.error.message });
      }
      if (partner === entry.handle.toLowerCase()) {
        return reply.status(400).send({ error: "Selbst-Senden nicht erlaubt" });
      }

      // Bridge-Handle-Validation, gleicher Pfad wie bei Trust-Add. Verhindert
      // Tippfehler-Sends an nicht existierende Empfänger.
      const knownHandles = await fetchBridgeHandles(entry).catch(() => null);
      if (knownHandles === null) {
        return reply.status(502).send({
          error: "Bridge nicht erreichbar — Empfänger konnte nicht validiert werden.",
        });
      }
      if (!knownHandles.has(partner)) {
        return reply.status(400).send({
          error: "Diesen Handle kennt die Bridge nicht.",
          code: "HANDLE_NOT_REGISTERED",
        });
      }

      try {
        const result = await entry.service.ownerDirectSend({
          toHandle: partner,
          content: parsed.data.content,
          inReplyTo: parsed.data.inReplyTo ?? null,
        });
        return reply.status(201).send({
          messageId: result.messageId,
          auditId: result.auditId,
          sentAt: result.sentAt,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Unknown error";
        return reply.status(500).send({ error: msg });
      }
    },
  );
}

/**
 * Baut einen ad-hoc BridgeClient für einen Twin-Entry. Nutzt die im Profil
 * hinterlegte Bridge-URL + Token. Kein Caching nötig — die HTTP-Calls sind
 * stateless, der Aufruf ist günstig.
 */
function bridgeClientFor(entry: RegistryEntry): BridgeClient {
  return new BridgeClient({
    url: entry.profile.bridgeUrl,
    handle: entry.handle,
    token: entry.profile.bridgeToken,
  });
}

/**
 * Holt sich für jeden bekannten Bridge-Partner den Conversation-Verlauf.
 * Im Phase-2-Setup haben wir keinen "list my conversations"-Endpoint — wir
 * nehmen die Twin-Liste der Bridge und fragen pro Handle.
 *
 * Optimierung später: dedizierter /conversations-Endpoint in der Bridge,
 * der per Sender alle Partner mit lastMessageAt ausspuckt.
 */
async function fetchAllBridgeConversations(
  entry: RegistryEntry,
  client: BridgeClient,
): Promise<{ partner: string; createdAt: string }[]> {
  // Twin-Liste der Bridge holen (Reuse fetchBridgeHandles — gleiche Auth).
  const knownHandles = await fetchBridgeHandles(entry);
  const ownLower = entry.handle.toLowerCase();
  const partners = [...knownHandles].filter((h) => h !== ownLower);

  // Pro Partner Bridge-Messages holen. Sequentielle Promise.all reicht für
  // die paar Twins der Phase 2; bei wachsendem Volumen → Bridge-Endpoint
  // mit Server-seitiger Aggregation.
  const results = await Promise.all(
    partners.map(async (p) => {
      try {
        const msgs = await client.getConversationMessages(p);
        return msgs.map((m) => ({ partner: p, createdAt: m.createdAt }));
      } catch {
        return [];
      }
    }),
  );
  return results.flat();
}

function aggregateBridgePartners(
  entries: { partner: string; createdAt: string }[],
  ownHandle: string,
): Map<string, { lastAt: string }> {
  const ownLower = ownHandle.toLowerCase();
  const map = new Map<string, { lastAt: string }>();
  for (const { partner, createdAt } of entries) {
    if (partner === ownLower) continue;
    const cur = map.get(partner);
    if (!cur) {
      map.set(partner, { lastAt: createdAt });
    } else if (createdAt > cur.lastAt) {
      cur.lastAt = createdAt;
    }
  }
  return map;
}

function countUnreadRepliesByPartner(audits: AuditEntry[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const e of audits) {
    if (e.capability !== "reply-received") continue;
    if ((e.readAt ?? null) !== null) continue;
    const from = (e.input as { fromHandle?: string }).fromHandle?.toLowerCase();
    if (!from) continue;
    map.set(from, (map.get(from) ?? 0) + 1);
  }
  return map;
}

/**
 * Display-Name-Lookup über Bridge GET /twins. Liefert Map handle→displayName.
 * Bei Bridge-Down: Caller fängt das und liefert null zurück.
 */
async function fetchBridgeDisplayNames(entry: RegistryEntry): Promise<Map<string, string>> {
  const url = `${entry.profile.bridgeUrl}/twins`;
  const res = await fetch(url, {
    method: "GET",
    headers: { Authorization: `Bearer ${entry.profile.bridgeToken}` },
  });
  if (!res.ok) throw new Error(`Bridge GET /twins → HTTP ${res.status}`);
  const body = (await res.json()) as { twins: { handle: string; displayName: string }[] };
  const map = new Map<string, string>();
  for (const t of body.twins) {
    map.set(t.handle.toLowerCase(), t.displayName);
  }
  return map;
}

/**
 * Holt die Liste registrierter Handles von der Bridge per GET /twins. Auth
 * mit dem Bridge-Token des fragenden Twins — jeder Twin darf das, weil das
 * eine öffentliche Discovery-Funktion ist.
 *
 * Returns ein Set von normalisierten Handle-Strings (lowercase).
 */
async function fetchBridgeHandles(entry: RegistryEntry): Promise<Set<string>> {
  const url = `${entry.profile.bridgeUrl}/twins`;
  const res = await fetch(url, {
    method: "GET",
    headers: { Authorization: `Bearer ${entry.profile.bridgeToken}` },
  });
  if (!res.ok) {
    throw new Error(`Bridge GET /twins → HTTP ${res.status}`);
  }
  const body = (await res.json()) as { twins: { handle: string }[] };
  return new Set(body.twins.map((t) => t.handle.toLowerCase()));
}

// ─── helpers ─────────────────────────────────────────────────────────────────

/**
 * Maskiert einen Bridge-Token für die UI-Anzeige: erste 4 + "…" + letzte 4
 * Zeichen. Bei Tokens unter 9 Zeichen geben wir nur "…" zurück.
 */
function maskToken(token: string): string {
  if (token.length < 9) return "…";
  return `${token.slice(0, 4)}…${token.slice(-4)}`;
}
