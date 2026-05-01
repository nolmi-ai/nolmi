import type Database from "better-sqlite3";
import type { Mandate } from "@twin-lab/shared";
import type { TwinLlmConfig } from "./llm-config.js";

// ─── TWIN PROFILES REPOSITORY ────────────────────────────────────────────────
//
// Eine Row pro Twin-Instanz. JSON-Felder (mandates, llmConfig) werden hier
// transparent (de)serialisiert, sodass Aufrufer mit typisierten Objekten
// arbeiten. Booleans und Timestamps werden zwischen JS-Form (boolean,
// number) und SQLite-Form (INTEGER 0/1, INTEGER epoch ms) gemappt.
//
// Soft-Delete: kein `delete()`. Stattdessen `setActive(twinId, false)`.

export interface TwinProfile {
  twinId: string;
  handle: string;
  displayName: string;
  personaMd: string;
  mandates: Mandate[];
  llmConfig: TwinLlmConfig;
  bridgeUrl: string;
  bridgeToken: string;
  ownerUserId: string | null;
  createdAt: number;
  updatedAt: number;
  isActive: boolean;
}

interface TwinProfileRow {
  twin_id: string;
  handle: string;
  display_name: string;
  persona_md: string;
  mandates_json: string;
  llm_config: string;
  bridge_url: string;
  bridge_token: string;
  owner_user_id: string | null;
  created_at: number;
  updated_at: number;
  is_active: number;
}

export interface ListFilter {
  activeOnly?: boolean;
  ownerUserId?: string;
}

/** Felder, die bei Insert vom Repo gesetzt werden — nicht vom Caller. */
type InsertInput = Omit<TwinProfile, "createdAt" | "updatedAt">;

export class TwinProfilesRepo {
  constructor(private db: Database.Database) {}

  insert(profile: InsertInput): TwinProfile {
    const now = Date.now();
    const row: TwinProfileRow = {
      twin_id: profile.twinId,
      handle: profile.handle,
      display_name: profile.displayName,
      persona_md: profile.personaMd,
      mandates_json: JSON.stringify(profile.mandates),
      llm_config: JSON.stringify(profile.llmConfig),
      bridge_url: profile.bridgeUrl,
      bridge_token: profile.bridgeToken,
      owner_user_id: profile.ownerUserId,
      created_at: now,
      updated_at: now,
      is_active: profile.isActive ? 1 : 0,
    };
    this.db
      .prepare(
        `INSERT INTO twin_profiles
           (twin_id, handle, display_name, persona_md, mandates_json, llm_config,
            bridge_url, bridge_token, owner_user_id, created_at, updated_at, is_active)
         VALUES
           (@twin_id, @handle, @display_name, @persona_md, @mandates_json, @llm_config,
            @bridge_url, @bridge_token, @owner_user_id, @created_at, @updated_at, @is_active)`,
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
           handle        = @handle,
           display_name  = @display_name,
           persona_md    = @persona_md,
           mandates_json = @mandates_json,
           llm_config    = @llm_config,
           bridge_url    = @bridge_url,
           bridge_token  = @bridge_token,
           owner_user_id = @owner_user_id,
           updated_at    = @updated_at,
           is_active     = @is_active
         WHERE twin_id = @twin_id`,
      )
      .run({
        twin_id: merged.twinId,
        handle: merged.handle,
        display_name: merged.displayName,
        persona_md: merged.personaMd,
        mandates_json: JSON.stringify(merged.mandates),
        llm_config: JSON.stringify(merged.llmConfig),
        bridge_url: merged.bridgeUrl,
        bridge_token: merged.bridgeToken,
        owner_user_id: merged.ownerUserId,
        updated_at: merged.updatedAt,
        is_active: merged.isActive ? 1 : 0,
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
}

function rowToProfile(row: TwinProfileRow): TwinProfile {
  return {
    twinId: row.twin_id,
    handle: row.handle,
    displayName: row.display_name,
    personaMd: row.persona_md,
    mandates: JSON.parse(row.mandates_json) as Mandate[],
    llmConfig: JSON.parse(row.llm_config) as TwinLlmConfig,
    bridgeUrl: row.bridge_url,
    bridgeToken: row.bridge_token,
    ownerUserId: row.owner_user_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    isActive: row.is_active === 1,
  };
}
