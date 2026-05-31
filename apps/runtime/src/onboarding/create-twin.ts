import { nanoid } from "nanoid";
import type { PersonaInput, PresetSelection } from "@nolmi/shared";
import { getEnv } from "@nolmi/shared/env";
import { encrypt } from "../crypto-utils.js";
import {
  type LlmProvider,
  type StoredLlmConfig,
} from "../llm-config.js";
import { buildPersonaMarkdown } from "./persona-builder.js";
import {
  loadMandateTemplate,
  type MandateTemplateId,
} from "./mandate-templates.js";
import { validateApiKey } from "./api-key-validator.js";
import { registerHandleOnBridge, BridgeRegisterError } from "./bridge-register.js";
import { activatePresets } from "../skills/activate-presets.js";
import type { TwinProfilesRepo } from "../twin-profiles-repo.js";
import type { TwinServiceRegistry } from "../twin-service-registry.js";
import type { SkillRepo } from "../skills/repo.js";
import type { McpServersRepo } from "../mcp/repo.js";

// ─── CREATE-TWIN-SERVICE (Distribution Weg B, Phase 1) ───────────────────────
//
// Die 7-Schritt-Twin-Erstellung — extrahiert aus dem `/onboarding/submit`-
// Handler (server.ts), damit Web-Wizard UND CLI (Weg B) denselben Pfad nutzen
// (keine Duplikation, zwei Türen synchron). REINER Umzug: gleiche Reihenfolge,
// gleiche Felder, gleiches Verhalten inkl. der 409-Fälle.
//
// Server-prozess-gebundene Abhängigkeiten kommen als `deps`-Parameter rein
// (NICHT global importiert), damit der Service auch aus einem anderen Kontext
// aufrufbar ist, soweit die deps dort verfügbar sind.

/** Minimaler Logger (kompatibel mit Fastify-`app.log` und einem CLI-Logger). */
export interface CreateTwinLogger {
  warn: (obj: Record<string, unknown>, msg?: string) => void;
  error: (obj: Record<string, unknown>, msg?: string) => void;
  info?: (obj: Record<string, unknown>, msg?: string) => void;
}

export interface CreateTwinInput {
  ownerUserId: string;
  persona: PersonaInput;
  mandateTemplate: MandateTemplateId;
  llmConfig: { provider: LlmProvider; model: string; apiKey: string };
  presetSelections: readonly PresetSelection[];
  /** Optional — Default aus `resolveOnboardingBridgeUrl()` (ENV/Fallback). */
  bridgeUrl?: string;
}

export interface CreateTwinDeps {
  profilesRepo: TwinProfilesRepo;
  registry: TwinServiceRegistry;
  skillRepo: SkillRepo;
  mcpServersRepo: McpServersRepo;
  masterKey: Buffer;
  examplesDir: string;
  mcpServersDir: string;
  logger: CreateTwinLogger;
}

export interface CreateTwinResult {
  twinId: string;
  handle: string;
  /** true, wenn Hot-Load fehlschlug — Profil ist in DB, Restart hilft. */
  requiresRestart: boolean;
  /** Preset-Aktivierungs-Ergebnisse (nur bei erfolgreichem Hot-Load). */
  presetResults?: Awaited<ReturnType<typeof activatePresets>>;
  /** Fehlermeldung des fehlgeschlagenen Hot-Loads (nur bei requiresRestart). */
  hotLoadError?: string;
}

/**
 * Typisierter Fehler mit HTTP-Status, damit der Handler die exakten
 * Status-Codes des bisherigen Verhaltens 1:1 abbilden kann (409/400/502/500).
 */
export class CreateTwinError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "CreateTwinError";
  }
}

/**
 * Bridge-URL für neu angelegte Twin-Profile. Production setzt
 * `NOLMI_DEFAULT_BRIDGE_URL` in der `.env` auf die gehostete Bridge, lokal
 * bleibt sie ungesetzt → Fallback auf den Dev-Bridge-Port. Aliasing:
 * `TWIN_LAB_DEFAULT_BRIDGE_URL` wird via getEnv noch als Fallback gelesen.
 * (Aus server.ts hierher gezogen — Default-Logik lebt beim Service.)
 */
export function resolveOnboardingBridgeUrl(): string {
  return (
    getEnv("NOLMI_DEFAULT_BRIDGE_URL", "TWIN_LAB_DEFAULT_BRIDGE_URL")?.trim() ||
    "http://127.0.0.1:5100"
  );
}

export async function createTwin(
  input: CreateTwinInput,
  deps: CreateTwinDeps,
): Promise<CreateTwinResult> {
  const { persona, llmConfig } = input;

  // 1. Defensive Handle-Check (UNIQUE catched es spätestens, aber 409 früh ist
  //    freundlicher).
  if (deps.profilesRepo.findByHandle(persona.handle)) {
    throw new CreateTwinError(
      409,
      `Handle '${persona.handle}' ist bereits vergeben`,
    );
  }

  // 2. API-Key validieren
  const validation = await validateApiKey(
    llmConfig.provider,
    llmConfig.apiKey,
    llmConfig.model,
  );
  if (!validation.valid) {
    throw new CreateTwinError(400, `API-Key ungültig: ${validation.reason}`);
  }

  // 3. Bridge-Handle registrieren
  let bridgeToken: string;
  const bridgeUrl = input.bridgeUrl ?? resolveOnboardingBridgeUrl();
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
    throw new CreateTwinError(
      status === 409 ? 409 : 502,
      `Bridge-Registrierung fehlgeschlagen: ${msg}`,
    );
  }

  // 4. Persona-MD bauen + Mandates laden
  const personaMd = buildPersonaMarkdown(persona);
  const mandates = loadMandateTemplate(input.mandateTemplate);

  // 5. API-Key verschlüsseln — trim aus dem gleichen Grund wie im Validator
  //    (Copy-Paste-Whitespace würde sonst persistiert und der Live-Chat
  //    scheitert später mit "invalid x-api-key").
  const trimmedKey = llmConfig.apiKey.trim();
  const storedLlmConfig: StoredLlmConfig = {
    provider: llmConfig.provider,
    model: llmConfig.model,
    apiKeyEncrypted: encrypt(trimmedKey, deps.masterKey),
    apiKeySource: "user",
  };

  // 6. INSERT — bei UNIQUE-Race wirft sqlite, fängt's der catch.
  //    auth_mode wird bewusst NICHT gesetzt → Spalten-Default 'api_key' (D2).
  const twinId = `twin_${nanoid(16)}`;
  let profile;
  try {
    profile = deps.profilesRepo.insert({
      twinId,
      handle: persona.handle,
      displayName: persona.fullName,
      personaMd,
      // Strukturierte Form für späteren Settings-Pre-Fill mitspeichern.
      personaInputJson: persona,
      mandates,
      llmConfig: storedLlmConfig,
      bridgeUrl,
      bridgeToken,
      ownerUserId: input.ownerUserId,
      isActive: true,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new CreateTwinError(500, `DB-Insert fehlgeschlagen: ${msg}`);
  }

  // 7. Hot-Reload (#37) — Twin direkt in die Registry einklinken, damit der
  //    Wizard-Redirect zu /chat/<handle> ohne Runtime-Restart funktioniert.
  //    Bei Hot-Load-Fehler: Profil bleibt in DB, Caller bekommt
  //    requiresRestart=true mit ehrlichem Hinweis (Restart hilft, weil
  //    loadAll() das Profil dann beim Boot picked). Preset-Activation läuft
  //    auch im Fehlerfall nicht, weil die Pattern-Skills ohne Registry-Eintrag
  //    keine Engine hätten — Twin müsste dann nach Restart via Settings ergänzt
  //    werden.
  try {
    await deps.registry.addTwin(profile.twinId);
    const presetResults = await activatePresets({
      presetSelections: input.presetSelections,
      twinId: profile.twinId,
      twinHandle: profile.handle,
      examplesDir: deps.examplesDir,
      mcpServersDir: deps.mcpServersDir,
      skillRepo: deps.skillRepo,
      mcpServersRepo: deps.mcpServersRepo,
      registry: deps.registry,
      logger: deps.logger,
    });
    return {
      twinId: profile.twinId,
      handle: profile.handle,
      requiresRestart: false,
      presetResults,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    deps.logger.error(
      { err, twinId: profile.twinId, handle: profile.handle },
      "[onboarding] Hot-Load fehlgeschlagen — Profil ist in DB, Restart hilft",
    );
    return {
      twinId: profile.twinId,
      handle: profile.handle,
      requiresRestart: true,
      hotLoadError: msg,
    };
  }
}
