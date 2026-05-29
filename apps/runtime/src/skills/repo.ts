import type Database from "better-sqlite3";
import { nanoid } from "nanoid";
import type { Skill, SkillManifest, SkillSource } from "@nolmi/shared";

// ─── SKILL REPOSITORY ───────────────────────────────────────────────────────
//
// Eine Row pro Skill, isoliert pro Twin. Hybrid-Ansatz: manifest_json (Object)
// + instructions_md (Markdown) + scriptTs (optional). UNIQUE (twin_id, name)
// erzwingt eindeutige Namen pro Twin — zwei Twins dürfen denselben Namen
// haben, ein Twin nicht zweimal.
//
// JSON-Felder (manifest_json, source_metadata) werden hier transparent
// (de)serialisiert; isActive wird zwischen JS-Boolean und SQLite-INTEGER
// gemappt; Timestamps liegen als epoch ms vor (konsistent mit twin_profiles).
//
// Soft-Delete via setActive() ist die normale Lifecycle-Operation; remove()
// existiert für Tests / harte Lösch-Fälle und löst dank ON DELETE CASCADE
// keinen FK-Bruch aus.

export interface CreateSkillInput {
  twinId: string;
  name: string;
  description: string;
  manifestJson: SkillManifest;
  instructionsMd: string;
  scriptTs?: string | null;
  source?: SkillSource;
  sourceMetadata?: Record<string, unknown> | null;
  // 3.2.C: nur bei source='mcp' setzen; bei 'manual' beides null/undefined.
  // validateInput() enforced die Konsistenz.
  mcpServerId?: string | null;
  mcpToolName?: string | null;
}

export interface UpdateSkillInput {
  name?: string;
  description?: string;
  manifestJson?: SkillManifest;
  instructionsMd?: string;
  scriptTs?: string | null;
  source?: SkillSource;
  sourceMetadata?: Record<string, unknown> | null;
  mcpServerId?: string | null;
  mcpToolName?: string | null;
}

export interface ListSkillsOptions {
  activeOnly?: boolean;
  source?: SkillSource;
}

interface SkillRow {
  skill_id: string;
  twin_id: string;
  name: string;
  description: string;
  manifest_json: string;
  instructions_md: string;
  script_ts: string | null;
  source: string;
  source_metadata: string | null;
  mcp_server_id: string | null;
  mcp_tool_name: string | null;
  is_active: number;
  created_at: number;
  updated_at: number;
}

export class SkillAlreadyExistsError extends Error {
  constructor(twinId: string, name: string) {
    super(`Skill '${name}' existiert bereits für Twin ${twinId}`);
    this.name = "SkillAlreadyExistsError";
  }
}

export class SkillNotFoundError extends Error {
  constructor(identifier: string) {
    super(`Skill '${identifier}' nicht gefunden`);
    this.name = "SkillNotFoundError";
  }
}

export class SkillValidationError extends Error {
  constructor(reason: string) {
    super(`Skill-Validation fehlgeschlagen: ${reason}`);
    this.name = "SkillValidationError";
  }
}

/**
 * Erzwingt Konsistenz zwischen `source` und `mcpServerId`/`mcpToolName`.
 * source='mcp' verlangt beide Felder gesetzt; alle Non-MCP-Quellen
 * ('manual', 'example', ggf. spätere) verlangen beide null. SQLite kann
 * das nicht in einem CHECK-Constraint elegant ausdrücken, also macht es
 * der Repo-Layer — sowohl bei add() als auch update().
 */
function validateSourceConsistency(
  source: SkillSource,
  mcpServerId: string | null,
  mcpToolName: string | null,
): void {
  if (source === "mcp") {
    if (!mcpServerId) {
      throw new SkillValidationError(
        "source='mcp' verlangt mcpServerId — fehlt",
      );
    }
    if (!mcpToolName) {
      throw new SkillValidationError(
        "source='mcp' verlangt mcpToolName — fehlt",
      );
    }
    return;
  }
  // Non-MCP-Sources: kein MCP-Binding.
  if (mcpServerId !== null) {
    throw new SkillValidationError(
      `source='${source}' verlangt mcpServerId=null`,
    );
  }
  if (mcpToolName !== null) {
    throw new SkillValidationError(
      `source='${source}' verlangt mcpToolName=null`,
    );
  }
}

export class SkillRepo {
  constructor(private db: Database.Database) {}

  add(input: CreateSkillInput): Skill {
    const now = Date.now();
    const source = input.source ?? "manual";
    const mcpServerId = input.mcpServerId ?? null;
    const mcpToolName = input.mcpToolName ?? null;
    validateSourceConsistency(source, mcpServerId, mcpToolName);

    const skill: Skill = {
      skillId: `skill_${nanoid(16)}`,
      twinId: input.twinId,
      name: input.name,
      description: input.description,
      manifestJson: input.manifestJson,
      instructionsMd: input.instructionsMd,
      scriptTs: input.scriptTs ?? null,
      source,
      sourceMetadata: input.sourceMetadata ?? null,
      mcpServerId,
      mcpToolName,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    };
    try {
      this.db
        .prepare(
          `INSERT INTO skills
             (skill_id, twin_id, name, description, manifest_json, instructions_md,
              script_ts, source, source_metadata, mcp_server_id, mcp_tool_name,
              is_active, created_at, updated_at)
           VALUES
             (@skill_id, @twin_id, @name, @description, @manifest_json, @instructions_md,
              @script_ts, @source, @source_metadata, @mcp_server_id, @mcp_tool_name,
              @is_active, @created_at, @updated_at)`,
        )
        .run({
          skill_id: skill.skillId,
          twin_id: skill.twinId,
          name: skill.name,
          description: skill.description,
          manifest_json: JSON.stringify(skill.manifestJson),
          instructions_md: skill.instructionsMd,
          script_ts: skill.scriptTs,
          source: skill.source,
          source_metadata: skill.sourceMetadata
            ? JSON.stringify(skill.sourceMetadata)
            : null,
          mcp_server_id: skill.mcpServerId,
          mcp_tool_name: skill.mcpToolName,
          is_active: skill.isActive ? 1 : 0,
          created_at: skill.createdAt,
          updated_at: skill.updatedAt,
        });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // UNIQUE-Violation → eigener Fehler-Typ, damit der Server-Layer (3.1.E)
      // 409 statt 500 zurückgeben kann.
      if (msg.includes("UNIQUE constraint failed")) {
        throw new SkillAlreadyExistsError(input.twinId, input.name);
      }
      throw err;
    }
    return skill;
  }

  findById(skillId: string): Skill | null {
    const row = this.db
      .prepare("SELECT * FROM skills WHERE skill_id = ?")
      .get(skillId) as SkillRow | undefined;
    return row ? rowToSkill(row) : null;
  }

  findByName(twinId: string, name: string): Skill | null {
    const row = this.db
      .prepare("SELECT * FROM skills WHERE twin_id = ? AND name = ?")
      .get(twinId, name) as SkillRow | undefined;
    return row ? rowToSkill(row) : null;
  }

  list(twinId: string, opts: ListSkillsOptions = {}): Skill[] {
    const where: string[] = ["twin_id = @twin_id"];
    const params: Record<string, unknown> = { twin_id: twinId };
    if (opts.activeOnly) {
      where.push("is_active = 1");
    }
    if (opts.source !== undefined) {
      where.push("source = @source");
      params.source = opts.source;
    }
    const sql =
      "SELECT * FROM skills WHERE " +
      where.join(" AND ") +
      " ORDER BY created_at ASC";
    const rows = this.db.prepare(sql).all(params) as SkillRow[];
    return rows.map(rowToSkill);
  }

  /**
   * Patcht ausgewählte Felder. `skillId`, `twinId`, `createdAt` sind immutable;
   * `updatedAt` setzt der Repo. UNIQUE-Verletzung beim Umbenennen wirft
   * SkillAlreadyExistsError.
   */
  update(skillId: string, patch: UpdateSkillInput): Skill {
    const existing = this.findById(skillId);
    if (!existing) {
      throw new SkillNotFoundError(skillId);
    }
    const merged: Skill = {
      ...existing,
      ...patch,
      skillId: existing.skillId,
      twinId: existing.twinId,
      createdAt: existing.createdAt,
      updatedAt: Date.now(),
      // patch-spread könnte `scriptTs` undefined machen, falls explizit nicht
      // gesetzt — wir wollen aber nullable behalten.
      scriptTs: patch.scriptTs === undefined ? existing.scriptTs : patch.scriptTs,
      sourceMetadata:
        patch.sourceMetadata === undefined
          ? existing.sourceMetadata
          : patch.sourceMetadata,
      mcpServerId:
        patch.mcpServerId === undefined ? existing.mcpServerId : patch.mcpServerId,
      mcpToolName:
        patch.mcpToolName === undefined ? existing.mcpToolName : patch.mcpToolName,
    };
    validateSourceConsistency(merged.source, merged.mcpServerId, merged.mcpToolName);
    try {
      this.db
        .prepare(
          `UPDATE skills SET
             name             = @name,
             description      = @description,
             manifest_json    = @manifest_json,
             instructions_md  = @instructions_md,
             script_ts        = @script_ts,
             source           = @source,
             source_metadata  = @source_metadata,
             mcp_server_id    = @mcp_server_id,
             mcp_tool_name    = @mcp_tool_name,
             updated_at       = @updated_at
           WHERE skill_id = @skill_id`,
        )
        .run({
          skill_id: merged.skillId,
          name: merged.name,
          description: merged.description,
          manifest_json: JSON.stringify(merged.manifestJson),
          instructions_md: merged.instructionsMd,
          script_ts: merged.scriptTs,
          source: merged.source,
          source_metadata: merged.sourceMetadata
            ? JSON.stringify(merged.sourceMetadata)
            : null,
          mcp_server_id: merged.mcpServerId,
          mcp_tool_name: merged.mcpToolName,
          updated_at: merged.updatedAt,
        });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("UNIQUE constraint failed")) {
        throw new SkillAlreadyExistsError(merged.twinId, merged.name);
      }
      throw err;
    }
    return merged;
  }

  /**
   * Alle Skills eines MCP-Servers (active+inactive). Für refresh()-Diff und
   * Listings. Keine sortierte Liste nötig — Caller macht eigene Sortierung.
   */
  listByMcpServer(mcpServerId: string): Skill[] {
    const rows = this.db
      .prepare(
        "SELECT * FROM skills WHERE mcp_server_id = ? ORDER BY mcp_tool_name ASC",
      )
      .all(mcpServerId) as SkillRow[];
    return rows.map(rowToSkill);
  }

  /**
   * Lookup für refresh()-Sync: gibt es schon einen Skill für (server, tool)?
   * Effizienter als listByMcpServer + filter, weil partial-Index zieht.
   */
  findByMcpTool(mcpServerId: string, toolName: string): Skill | null {
    const row = this.db
      .prepare(
        "SELECT * FROM skills WHERE mcp_server_id = ? AND mcp_tool_name = ?",
      )
      .get(mcpServerId, toolName) as SkillRow | undefined;
    return row ? rowToSkill(row) : null;
  }

  setActive(skillId: string, isActive: boolean): void {
    const result = this.db
      .prepare(
        "UPDATE skills SET is_active = ?, updated_at = ? WHERE skill_id = ?",
      )
      .run(isActive ? 1 : 0, Date.now(), skillId);
    if (result.changes === 0) {
      throw new SkillNotFoundError(skillId);
    }
  }

  remove(skillId: string): void {
    const result = this.db
      .prepare("DELETE FROM skills WHERE skill_id = ?")
      .run(skillId);
    if (result.changes === 0) {
      throw new SkillNotFoundError(skillId);
    }
  }
}

function rowToSkill(row: SkillRow): Skill {
  return {
    skillId: row.skill_id,
    twinId: row.twin_id,
    name: row.name,
    description: row.description,
    manifestJson: JSON.parse(row.manifest_json) as SkillManifest,
    instructionsMd: row.instructions_md,
    scriptTs: row.script_ts,
    source: row.source as SkillSource,
    sourceMetadata: row.source_metadata
      ? (JSON.parse(row.source_metadata) as Record<string, unknown>)
      : null,
    mcpServerId: row.mcp_server_id,
    mcpToolName: row.mcp_tool_name,
    isActive: row.is_active === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
