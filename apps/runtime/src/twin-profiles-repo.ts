import type Database from "better-sqlite3";
import type { Mandate, PersonaInput } from "@twin-lab/shared";
import type { StoredLlmConfig } from "./llm-config.js";

// ─── TWIN PROFILES REPOSITORY ────────────────────────────────────────────────
//
// Eine Row pro Twin-Instanz. JSON-Felder (mandates, llmConfig) werden hier
// transparent (de)serialisiert, sodass Aufrufer mit typisierten Objekten
// arbeiten. Booleans und Timestamps werden zwischen JS-Form (boolean,
// number) und SQLite-Form (INTEGER 0/1, INTEGER epoch ms) gemappt.
//
// Soft-Delete: kein `delete()`. Stattdessen `setActive(twinId, false)`.

/**
 * #131 Phase 1: Exklusiv-Switch pro Twin (Strategy §b).
 * - `api_key`: existing BYOK-Pfad via `llmConfig.apiKeyEncrypted`
 * - `oauth`: OpenAI-Subscription-Token in `oauth_tokens`-Tabelle, Codex-Adapter
 *
 * DB-CHECK-Constraint hält beide Werte; DEFAULT `api_key` für Backward-Compat.
 */
export type AuthMode = "api_key" | "oauth";

export interface TwinProfile {
  twinId: string;
  handle: string;
  displayName: string;
  personaMd: string;
  /**
   * #110 Phase 2B Commit 11: strukturierte Persona-Form, für Settings-
   * Pre-Fill. Null bei Legacy-Twins (bootstrap-CLI, Pre-Migration-023);
   * Onboarding-Submit speichert das Object seit Commit 11 parallel zur
   * `personaMd`-Markdown-Form.
   */
  personaInputJson: PersonaInput | null;
  mandates: Mandate[];
  llmConfig: StoredLlmConfig;
  bridgeUrl: string;
  bridgeToken: string;
  ownerUserId: string | null;
  createdAt: number;
  updatedAt: number;
  isActive: boolean;
  /**
   * #107: einmaliger Beta-Hint nach erster Recherche. Flag wird im Send-Path
   * nach Pre-Pass-Match auf 1 gesetzt; das Frontend zeigt das Modal nur, wenn
   * `firstUseHint='research'` im Chat-Response steht — was nur passiert, wenn
   * der Flag VOR dem Send noch 0 war.
   */
  researchFirstUseSeen: boolean;
  /**
   * #131 Phase 1: Auth-Mode-Switch (Migration 025). DB-Default `api_key`, also
   * existing Twins bleiben unverändert. `oauth` triggert den Codex-Adapter-
   * Branch in TwinService statt des Vercel-SDK-Aufrufs.
   */
  authMode: AuthMode;
}

interface TwinProfileRow {
  twin_id: string;
  handle: string;
  display_name: string;
  persona_md: string;
  persona_input_json: string | null;
  mandates_json: string;
  llm_config: string;
  bridge_url: string;
  bridge_token: string;
  owner_user_id: string | null;
  created_at: number;
  updated_at: number;
  is_active: number;
  research_first_use_seen: number;
  auth_mode: AuthMode;
}

export interface ListFilter {
  activeOnly?: boolean;
  ownerUserId?: string;
}

/**
 * Felder, die bei Insert vom Repo gesetzt werden — nicht vom Caller.
 * `researchFirstUseSeen` ist im Profil required (Read-Form), beim Insert
 * aber optional — Bootstrap-Pfad kennt das Feld nicht, Default ist `false`.
 * `personaInputJson` ist analog optional: Bootstrap-CLI hat keine
 * strukturierte Form, Onboarding-Submit übergibt das Object explizit.
 */
type InsertInput = Omit<
  TwinProfile,
  | "createdAt"
  | "updatedAt"
  | "researchFirstUseSeen"
  | "personaInputJson"
  | "authMode"
> & {
  researchFirstUseSeen?: boolean;
  personaInputJson?: PersonaInput | null;
  /** #131: Default `api_key` für Bootstrap/Onboarding — OAuth-Switch via `setAuthMode`. */
  authMode?: AuthMode;
};

export class TwinProfilesRepo {
  constructor(private db: Database.Database) {}

  insert(profile: InsertInput): TwinProfile {
    const now = Date.now();
    const row: TwinProfileRow = {
      twin_id: profile.twinId,
      handle: profile.handle,
      display_name: profile.displayName,
      persona_md: profile.personaMd,
      persona_input_json:
        profile.personaInputJson != null
          ? JSON.stringify(profile.personaInputJson)
          : null,
      mandates_json: JSON.stringify(profile.mandates),
      llm_config: JSON.stringify(profile.llmConfig),
      bridge_url: profile.bridgeUrl,
      bridge_token: profile.bridgeToken,
      owner_user_id: profile.ownerUserId,
      created_at: now,
      updated_at: now,
      is_active: profile.isActive ? 1 : 0,
      research_first_use_seen: profile.researchFirstUseSeen ? 1 : 0,
      auth_mode: profile.authMode ?? "api_key",
    };
    this.db
      .prepare(
        `INSERT INTO twin_profiles
           (twin_id, handle, display_name, persona_md, persona_input_json,
            mandates_json, llm_config, bridge_url, bridge_token, owner_user_id,
            created_at, updated_at, is_active, auth_mode)
         VALUES
           (@twin_id, @handle, @display_name, @persona_md, @persona_input_json,
            @mandates_json, @llm_config, @bridge_url, @bridge_token, @owner_user_id,
            @created_at, @updated_at, @is_active, @auth_mode)`,
      )
      .run(row);
    return rowToProfile(row);
  }

  findById(twinId: string): TwinProfile | null {
    const row = this.db
      .prepare("SELECT * FROM twin_profiles WHERE twin_id = ?")
      .get(twinId) as TwinProfileRow | undefined;
    return row ? rowToProfile(row) : null;
  }

  findByHandle(handle: string): TwinProfile | null {
    const row = this.db
      .prepare("SELECT * FROM twin_profiles WHERE handle = ?")
      .get(handle) as TwinProfileRow | undefined;
    return row ? rowToProfile(row) : null;
  }

  list(filter: ListFilter = {}): TwinProfile[] {
    const where: string[] = [];
    const params: Record<string, unknown> = {};
    if (filter.activeOnly) {
      where.push("is_active = 1");
    }
    if (filter.ownerUserId !== undefined) {
      where.push("owner_user_id = @ownerUserId");
      params.ownerUserId = filter.ownerUserId;
    }
    const sql =
      "SELECT * FROM twin_profiles" +
      (where.length ? ` WHERE ${where.join(" AND ")}` : "") +
      " ORDER BY created_at ASC";
    const rows = this.db.prepare(sql).all(params) as TwinProfileRow[];
    return rows.map(rowToProfile);
  }

  /**
   * Patcht ausgewählte Felder. `twinId`, `createdAt` und `updatedAt` werden
   * ignoriert/überschrieben (twinId ist immutable; updatedAt setzt der Repo).
   * Wirft, wenn der Twin nicht existiert.
   */
  update(twinId: string, patch: Partial<TwinProfile>): TwinProfile {
    const existing = this.findById(twinId);
    if (!existing) {
      throw new Error(`TwinProfile ${twinId} nicht gefunden`);
    }
    const merged: TwinProfile = {
      ...existing,
      ...patch,
      twinId: existing.twinId,
      createdAt: existing.createdAt,
      updatedAt: Date.now(),
    };
    this.db
      .prepare(
        `UPDATE twin_profiles SET
           handle             = @handle,
           display_name       = @display_name,
           persona_md         = @persona_md,
           persona_input_json = @persona_input_json,
           mandates_json      = @mandates_json,
           llm_config         = @llm_config,
           bridge_url         = @bridge_url,
           bridge_token       = @bridge_token,
           owner_user_id      = @owner_user_id,
           updated_at         = @updated_at,
           is_active          = @is_active,
           auth_mode          = @auth_mode
         WHERE twin_id = @twin_id`,
      )
      .run({
        twin_id: merged.twinId,
        handle: merged.handle,
        display_name: merged.displayName,
        persona_md: merged.personaMd,
        persona_input_json:
          merged.personaInputJson != null
            ? JSON.stringify(merged.personaInputJson)
            : null,
        mandates_json: JSON.stringify(merged.mandates),
        llm_config: JSON.stringify(merged.llmConfig),
        bridge_url: merged.bridgeUrl,
        bridge_token: merged.bridgeToken,
        owner_user_id: merged.ownerUserId,
        updated_at: merged.updatedAt,
        is_active: merged.isActive ? 1 : 0,
        auth_mode: merged.authMode,
      });
    return merged;
  }

  setActive(twinId: string, isActive: boolean): void {
    const result = this.db
      .prepare("UPDATE twin_profiles SET is_active = ?, updated_at = ? WHERE twin_id = ?")
      .run(isActive ? 1 : 0, Date.now(), twinId);
    if (result.changes === 0) {
      throw new Error(`TwinProfile ${twinId} nicht gefunden`);
    }
  }

  /**
   * #107: setzt den Beta-Hint-Flag idempotent auf 1. Wird im Send-Path
   * gerufen, sobald der Pre-Pass-Classifier den Recherche-Skill triggert
   * und der Flag noch 0 ist. Eigene Methode statt patch-Update, weil
   * update() die volle Profile-Spalte überschreibt — wir wollen aber nur
   * dieses eine Boolean-Flag flippen.
   */
  markResearchFirstUseSeen(twinId: string): void {
    const result = this.db
      .prepare(
        "UPDATE twin_profiles SET research_first_use_seen = 1, updated_at = ? WHERE twin_id = ?",
      )
      .run(Date.now(), twinId);
    if (result.changes === 0) {
      throw new Error(`TwinProfile ${twinId} nicht gefunden`);
    }
  }

  /**
   * #131 Phase 3.0: gezielter Single-Column-Switch zwischen `api_key` und
   * `oauth`. Analog `setActive`/`markResearchFirstUseSeen` — kein update()
   * weil das die ganze Profile-Spalte überschreibt und Registry-Boot-Pfad
   * keine konsistente in-memory Profile-Kopie hat (Spike-Smoke setzt Mode
   * via dieser Methode direkt im DB-Pfad).
   */
  setAuthMode(twinId: string, authMode: AuthMode): void {
    const result = this.db
      .prepare(
        "UPDATE twin_profiles SET auth_mode = ?, updated_at = ? WHERE twin_id = ?",
      )
      .run(authMode, Date.now(), twinId);
    if (result.changes === 0) {
      throw new Error(`TwinProfile ${twinId} nicht gefunden`);
    }
  }
}

function rowToProfile(row: TwinProfileRow): TwinProfile {
  return {
    twinId: row.twin_id,
    handle: row.handle,
    displayName: row.display_name,
    personaMd: row.persona_md,
    // #110 Phase 2B Commit 11: NULL bei Legacy-Twins (Pre-Migration-023 oder
    // Bootstrap-CLI). Defensive try/catch gegen korruptes JSON in der Spalte
    // — Settings-Layer behandelt das wie Legacy, kein Crash.
    personaInputJson: parsePersonaInputJsonOrNull(row.persona_input_json ?? null),
    mandates: JSON.parse(row.mandates_json) as Mandate[],
    llmConfig: JSON.parse(row.llm_config) as StoredLlmConfig,
    bridgeUrl: row.bridge_url,
    bridgeToken: row.bridge_token,
    ownerUserId: row.owner_user_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    isActive: row.is_active === 1,
    // #107: SQLite-DEFAULT 0 deckt brand-new Rows ab; defensive `?? 0`-Cast
    // schützt Tests, die das Feld in Mock-Rows nicht setzen.
    researchFirstUseSeen: (row.research_first_use_seen ?? 0) === 1,
    // #131 Migration 025 setzt DEFAULT 'api_key'; `??`-Fallback schützt
    // Mock-Rows in Tests, die die Spalte nicht setzen.
    authMode: (row.auth_mode ?? "api_key") as AuthMode,
  };
}

function parsePersonaInputJsonOrNull(raw: string | null): PersonaInput | null {
  if (raw == null) return null;
  try {
    return JSON.parse(raw) as PersonaInput;
  } catch {
    return null;
  }
}
