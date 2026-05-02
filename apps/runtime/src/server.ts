import Fastify, { type FastifyInstance, type FastifyReply } from "fastify";
import cors from "@fastify/cors";
import { nanoid } from "nanoid";
import { z } from "zod";
import type { AuditRepository } from "./repository/types.js";
import { ChatRequestSchema } from "@twin-lab/shared";
import type { RegistryEntry, TwinServiceRegistry } from "./twin-service-registry.js";
import { TwinProfilesRepo } from "./twin-profiles-repo.js";
import { encrypt } from "./crypto-utils.js";
import { LLM_PROVIDERS, type StoredLlmConfig } from "./llm-config.js";
import { buildPersonaMarkdown } from "./onboarding/persona-builder.js";
import { loadMandateTemplate } from "./onboarding/mandate-templates.js";
import { validateApiKey } from "./onboarding/api-key-validator.js";
import {
  registerHandleOnBridge,
  BridgeRegisterError,
} from "./onboarding/bridge-register.js";
import { getCurrentUser } from "./auth-stub.js";

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
}

export async function createServer(deps: ServerDeps) {
  const app = Fastify({ logger: true });

  await app.register(cors, {
    origin: true,
    credentials: true,
  });

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

  // ─── Twin-Liste ────────────────────────────────────────────────────────────
  app.get("/twins", async () => ({ twins: deps.registry.list() }));

  // ─── Onboarding ────────────────────────────────────────────────────────────
  registerOnboardingRoutes(app, deps);

  // ─── Profil ────────────────────────────────────────────────────────────────
  app.get<{ Params: { handle: string } }>(
    "/twins/:handle/profile",
    async (request, reply) => {
      const entry = requireEntry(request.params.handle, reply);
      if (!entry) return;
      return profileToResponse(entry);
    },
  );

  // ─── Chat ──────────────────────────────────────────────────────────────────
  app.post<{ Params: { handle: string } }>(
    "/twins/:handle/chat",
    async (request, reply) => {
      const entry = requireEntry(request.params.handle, reply);
      if (!entry) return;
      const parsed = ChatRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: parsed.error.message });
      }
      try {
        return await entry.service.chat(parsed.data.messages);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Unknown error";
        return reply.status(500).send({ error: msg });
      }
    },
  );

  // ─── Audit-Liste ───────────────────────────────────────────────────────────
  app.get<{ Params: { handle: string }; Querystring: { limit?: string; offset?: string } }>(
    "/twins/:handle/audit",
    async (request, reply) => {
      const entry = requireEntry(request.params.handle, reply);
      if (!entry) return;
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
      const entry = requireEntry(request.params.handle, reply);
      if (!entry) return;
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
      const entry = requireEntry(request.params.handle, reply);
      if (!entry) return;
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

  // ─── Reject ────────────────────────────────────────────────────────────────
  app.post<{ Params: { handle: string; id: string }; Body: { reason?: string } }>(
    "/twins/:handle/audit/:id/reject",
    async (request, reply) => {
      const entry = requireEntry(request.params.handle, reply);
      if (!entry) return;
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
      const entry = requireEntry(request.params.handle, reply);
      if (!entry) return;

      reply.raw.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "Access-Control-Allow-Origin": "*",
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
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "Access-Control-Allow-Origin": "*",
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

const PersonaInputSchema = z.object({
  fullName: z.string().min(1),
  handle: z.string().regex(/^@[a-z0-9_-]+$/),
  role: z.string().min(1),
  tone: z.array(z.enum(["direct", "polite", "casual", "formal"])).min(1),
  pronoun: z.enum(["du", "sie", "context-dependent"]),
  preferences: z.array(z.enum(["no-emojis", "no-platitudes", "short-answers"])),
  topics: z.array(z.string().min(1)).min(1),
  relationships: z.array(z.object({ name: z.string(), description: z.string() })),
});

const OnboardingSubmitSchema = z.object({
  persona: PersonaInputSchema,
  mandateTemplate: z.enum(["cautious", "trusting", "business"]),
  llmConfig: z.object({
    provider: z.enum(LLM_PROVIDERS),
    model: z.string().min(1),
    apiKey: z.string().min(1),
  }),
});

const ValidateApiKeySchema = z.object({
  provider: z.enum(LLM_PROVIDERS),
  model: z.string().min(1),
  apiKey: z.string().min(1),
});

function registerOnboardingRoutes(app: FastifyInstance, deps: ServerDeps) {
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

  // ─── API-Key Validation ──────────────────────────────────────────────────
  app.post("/onboarding/validate-api-key", async (request, reply) => {
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

  // ─── Submit ──────────────────────────────────────────────────────────────
  app.post("/onboarding/submit", async (request, reply) => {
    const parsed = OnboardingSubmitSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.message });
    }
    const { persona, mandateTemplate, llmConfig } = parsed.data;

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
    const bridgeUrl = pickBridgeUrlForOnboarding(deps);
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
    const owner = getCurrentUser();
    const twinId = `twin_${nanoid(16)}`;
    try {
      const profile = deps.profilesRepo.insert({
        twinId,
        handle: persona.handle,
        displayName: persona.fullName,
        personaMd,
        mandates,
        llmConfig: storedLlmConfig,
        bridgeUrl,
        bridgeToken,
        ownerUserId: owner?.userId ?? null,
        isActive: true,
      });
      return reply.status(201).send({
        twinId: profile.twinId,
        handle: profile.handle,
        // Hot-Reload kommt in Backlog #37 — bis dahin brauchts Restart.
        requiresRestart: true,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return reply.status(500).send({
        error: `DB-Insert fehlgeschlagen: ${msg}`,
      });
    }
  });
}

/**
 * Heute: Bridge-URL kommt aus dem ersten existierenden Twin, oder Fallback
 * auf localhost. Sauberer wäre ein eigenes ENV/Config — Backlog.
 */
function pickBridgeUrlForOnboarding(deps: ServerDeps): string {
  const first = deps.registry.list()[0];
  if (first) {
    const entry = deps.registry.getEntry(first.handle);
    if (entry?.profile.bridgeUrl) return entry.profile.bridgeUrl;
  }
  return process.env.BRIDGE_URL?.trim() || "http://127.0.0.1:5100";
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
