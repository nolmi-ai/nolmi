import type Database from "better-sqlite3";
import { nanoid } from "nanoid";
import type {
  McpServer,
  McpServerAddInput,
  McpServerUpdateInput,
  McpTransport,
} from "@nolmi/shared";
import { decrypt, encrypt } from "../crypto-utils.js";

// ─── MCP-SERVERS REPOSITORY (Phase 3.2.A) ───────────────────────────────────
//
// Eine Row pro MCP-Server-Konfiguration, isoliert pro Twin via UNIQUE
// (twin_id, name) — analog zur Skills-Tabelle. Tools, die ein Server
// bereitstellt, werden in späteren Sub-Schritten als Skills mit source: "mcp"
// registriert; diese Tabelle hält ausschließlich die Verbindungs-Konfig.
//
// Encryption: env (ENV-Vars als Plain-Object) wird vor dem Insert/Update mit
// dem Master-Key verschlüsselt (AES-256-GCM, Pattern wie llm_config.api_key_
// encrypted). Im Standard-Output erscheint nur `hasEnv: boolean` — der
// Klartext kommt ausschließlich über getDecryptedEnv(id) raus, damit
// ENV-Secrets nicht versehentlich in UI-Listings landen.
//
// Validation: validateInput() erzwingt Transport-Konsistenz
// (stdio↔command, http↔url) und Format-Regeln. Wird sowohl bei add() als auch
// update() aufgerufen, sodass eine spätere UI/CLI dieselben Garantien hat.

interface McpServerRow {
  id: string;
  twin_id: string;
  name: string;
  transport: McpTransport;
  command: string | null;
  args_json: string | null;
  env_json_encrypted: string | null;
  url: string | null;
  default_requires_approval: number;
  is_active: number;
  created_at: string;
  updated_at: string;
}

export class McpServerNotFoundError extends Error {
  constructor(identifier: string) {
    super(`MCP-Server '${identifier}' nicht gefunden`);
    this.name = "McpServerNotFoundError";
  }
}

export class McpServerAlreadyExistsError extends Error {
  constructor(twinId: string, name: string) {
    super(`MCP-Server '${name}' existiert bereits für Twin ${twinId}`);
    this.name = "McpServerAlreadyExistsError";
  }
}

export class McpServerValidationError extends Error {
  constructor(reason: string) {
    super(`MCP-Server-Validation fehlgeschlagen: ${reason}`);
    this.name = "McpServerValidationError";
  }
}

/**
 * Felder, die validateInput() prüfen kann. Gilt für add() (mit transport
 * gesetzt) und update() (transport unbekannt — wird vom Caller mit dem
 * vorhandenen Wert aufgefüllt).
 */
interface ValidatableInput {
  transport: McpTransport;
  name?: string;
  command?: string | null;
  args?: string[] | null;
  env?: Record<string, string> | null;
  url?: string | null;
}

export class McpServersRepo {
  constructor(
    private db: Database.Database,
    private masterKey: Buffer,
  ) {}

  /**
   * Legt einen neuen MCP-Server an. Validiert Transport-Konsistenz, ID und
   * Timestamps werden Repo-seitig gesetzt; env wird verschlüsselt vor dem
   * Insert. UNIQUE-Verletzung (gleicher Name pro Twin) → McpServerAlready-
   * ExistsError, damit Server-Layer 409 statt 500 zurückgeben kann.
   */
  add(input: McpServerAddInput): McpServer {
    validateInput({
      transport: input.transport,
      name: input.name,
      command: input.command ?? null,
      args: input.args ?? null,
      env: input.env ?? null,
      url: input.url ?? null,
    });

    const now = new Date().toISOString();
    const id = `mcp_${nanoid(16)}`;
    const argsJson =
      input.args === undefined || input.args === null
        ? null
        : JSON.stringify(input.args);
    const envJsonEncrypted =
      input.env && Object.keys(input.env).length > 0
        ? encrypt(JSON.stringify(input.env), this.masterKey)
        : null;
    const defaultRequiresApproval = input.defaultRequiresApproval ?? true;

    try {
      this.db
        .prepare(
          `INSERT INTO mcp_servers
             (id, twin_id, name, transport, command, args_json, env_json_encrypted,
              url, default_requires_approval, is_active, created_at, updated_at)
           VALUES
             (@id, @twin_id, @name, @transport, @command, @args_json, @env_json_encrypted,
              @url, @default_requires_approval, @is_active, @created_at, @updated_at)`,
        )
        .run({
          id,
          twin_id: input.twinId,
          name: input.name,
          transport: input.transport,
          command: input.command ?? null,
          args_json: argsJson,
          env_json_encrypted: envJsonEncrypted,
          url: input.url ?? null,
          default_requires_approval: defaultRequiresApproval ? 1 : 0,
          is_active: 1,
          created_at: now,
          updated_at: now,
        });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("UNIQUE constraint failed")) {
        throw new McpServerAlreadyExistsError(input.twinId, input.name);
      }
      throw err;
    }

    return {
      id,
      twinId: input.twinId,
      name: input.name,
      transport: input.transport,
      command: input.command ?? null,
      args: input.args ?? null,
      hasEnv: envJsonEncrypted !== null,
      url: input.url ?? null,
      defaultRequiresApproval,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    };
  }

  findById(id: string): McpServer {
    const row = this.db
      .prepare("SELECT * FROM mcp_servers WHERE id = ?")
      .get(id) as McpServerRow | undefined;
    if (!row) throw new McpServerNotFoundError(id);
    return rowToServer(row);
  }

  findByName(twinId: string, name: string): McpServer {
    const row = this.db
      .prepare("SELECT * FROM mcp_servers WHERE twin_id = ? AND name = ?")
      .get(twinId, name) as McpServerRow | undefined;
    if (!row) throw new McpServerNotFoundError(`${twinId}/${name}`);
    return rowToServer(row);
  }

  /** Alle Server eines Twins, sortiert nach created_at DESC (neueste zuerst). */
  list(twinId: string): McpServer[] {
    const rows = this.db
      .prepare(
        "SELECT * FROM mcp_servers WHERE twin_id = ? ORDER BY created_at DESC",
      )
      .all(twinId) as McpServerRow[];
    return rows.map(rowToServer);
  }

  /**
   * Patcht ausgewählte Felder. id/twinId/transport/createdAt sind immutable;
   * updated_at setzt der Repo. Validation läuft erneut, weil Patch
   * z.B. command auf null setzen könnte (Transport-Konsistenz prüfen).
   */
  update(id: string, patch: McpServerUpdateInput): McpServer {
    const existing = this.findById(id);

    const merged = {
      transport: existing.transport,
      name: patch.name ?? existing.name,
      command: patch.command === undefined ? existing.command : patch.command,
      args: patch.args === undefined ? existing.args : patch.args,
      // env ist nicht im existing-Object — Patch-only: nur wenn explizit gesetzt
      env: patch.env === undefined ? undefined : patch.env,
      url: patch.url === undefined ? existing.url : patch.url,
      defaultRequiresApproval:
        patch.defaultRequiresApproval ?? existing.defaultRequiresApproval,
    };

    validateInput({
      transport: merged.transport,
      name: merged.name,
      command: merged.command,
      args: merged.args,
      env: merged.env ?? null,
      url: merged.url,
    });

    const now = new Date().toISOString();
    const argsJson =
      merged.args === null ? null : JSON.stringify(merged.args);

    // env-Patch-Logik: undefined = unverändert; null = explizit löschen;
    // gesetzt = neu verschlüsseln. Ohne diese Drei-Wege-Unterscheidung könnte
    // ein PATCH ohne env-Feld die bestehenden ENV-Vars versehentlich plätten.
    let envJsonEncryptedSql: string | null | undefined;
    let newHasEnv: boolean = existing.hasEnv;
    if (patch.env === undefined) {
      envJsonEncryptedSql = undefined;
    } else if (patch.env === null || Object.keys(patch.env).length === 0) {
      envJsonEncryptedSql = null;
      newHasEnv = false;
    } else {
      envJsonEncryptedSql = encrypt(JSON.stringify(patch.env), this.masterKey);
      newHasEnv = true;
    }

    try {
      if (envJsonEncryptedSql === undefined) {
        this.db
          .prepare(
            `UPDATE mcp_servers SET
               name                      = @name,
               command                   = @command,
               args_json                 = @args_json,
               url                       = @url,
               default_requires_approval = @default_requires_approval,
               updated_at                = @updated_at
             WHERE id = @id`,
          )
          .run({
            id,
            name: merged.name,
            command: merged.command,
            args_json: argsJson,
            url: merged.url,
            default_requires_approval: merged.defaultRequiresApproval ? 1 : 0,
            updated_at: now,
          });
      } else {
        this.db
          .prepare(
            `UPDATE mcp_servers SET
               name                      = @name,
               command                   = @command,
               args_json                 = @args_json,
               env_json_encrypted        = @env_json_encrypted,
               url                       = @url,
               default_requires_approval = @default_requires_approval,
               updated_at                = @updated_at
             WHERE id = @id`,
          )
          .run({
            id,
            name: merged.name,
            command: merged.command,
            args_json: argsJson,
            env_json_encrypted: envJsonEncryptedSql,
            url: merged.url,
            default_requires_approval: merged.defaultRequiresApproval ? 1 : 0,
            updated_at: now,
          });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("UNIQUE constraint failed")) {
        throw new McpServerAlreadyExistsError(existing.twinId, merged.name);
      }
      throw err;
    }

    return {
      ...existing,
      name: merged.name,
      command: merged.command,
      args: merged.args,
      hasEnv: newHasEnv,
      url: merged.url,
      defaultRequiresApproval: merged.defaultRequiresApproval,
      updatedAt: now,
    };
  }

  setActive(id: string, isActive: boolean): void {
    const result = this.db
      .prepare(
        "UPDATE mcp_servers SET is_active = ?, updated_at = ? WHERE id = ?",
      )
      .run(isActive ? 1 : 0, new Date().toISOString(), id);
    if (result.changes === 0) {
      throw new McpServerNotFoundError(id);
    }
  }

  remove(id: string): void {
    const result = this.db
      .prepare("DELETE FROM mcp_servers WHERE id = ?")
      .run(id);
    if (result.changes === 0) {
      throw new McpServerNotFoundError(id);
    }
  }

  /**
   * Liefert die entschlüsselten ENV-Vars als Plain-Object oder null, wenn
   * der Server keine env_json_encrypted hat. Wirft McpServerNotFoundError,
   * wenn die ID nicht existiert. Decrypt-Fehler (z.B. Master-Key gewechselt)
   * propagieren als EncryptionDecryptError aus crypto-utils.
   */
  getDecryptedEnv(id: string): Record<string, string> | null {
    const row = this.db
      .prepare("SELECT env_json_encrypted FROM mcp_servers WHERE id = ?")
      .get(id) as { env_json_encrypted: string | null } | undefined;
    if (!row) throw new McpServerNotFoundError(id);
    if (!row.env_json_encrypted) return null;
    const plain = decrypt(row.env_json_encrypted, this.masterKey);
    return JSON.parse(plain) as Record<string, string>;
  }
}

function validateInput(input: ValidatableInput): void {
  if (input.name !== undefined) {
    if (input.name.length === 0) {
      throw new McpServerValidationError("name darf nicht leer sein");
    }
    if (input.name.length > 100) {
      throw new McpServerValidationError(
        `name darf max. 100 Zeichen haben (ist ${input.name.length})`,
      );
    }
  }

  if (input.transport === "stdio") {
    if (!input.command || input.command.length === 0) {
      throw new McpServerValidationError(
        "transport='stdio' verlangt ein gesetztes command",
      );
    }
    if (input.url) {
      throw new McpServerValidationError(
        "transport='stdio' verlangt url=null (url ist nur für http)",
      );
    }
  } else if (input.transport === "http") {
    if (!input.url || input.url.length === 0) {
      throw new McpServerValidationError(
        "transport='http' verlangt eine gesetzte url",
      );
    }
    if (input.command) {
      throw new McpServerValidationError(
        "transport='http' verlangt command=null (command ist nur für stdio)",
      );
    }
    if (input.args && input.args.length > 0) {
      throw new McpServerValidationError(
        "transport='http' verlangt args=null/[] (args sind nur für stdio)",
      );
    }
  }

  if (input.args !== null && input.args !== undefined) {
    if (!Array.isArray(input.args)) {
      throw new McpServerValidationError("args muss ein Array von Strings sein");
    }
    for (const a of input.args) {
      if (typeof a !== "string") {
        throw new McpServerValidationError(
          "args darf ausschließlich Strings enthalten",
        );
      }
    }
  }

  if (input.env !== null && input.env !== undefined) {
    if (typeof input.env !== "object" || Array.isArray(input.env)) {
      throw new McpServerValidationError(
        "env muss ein flaches Object {key: string} sein",
      );
    }
    for (const [k, v] of Object.entries(input.env)) {
      if (typeof v !== "string") {
        throw new McpServerValidationError(
          `env['${k}'] muss ein String sein (ist ${typeof v})`,
        );
      }
    }
  }
}

function rowToServer(row: McpServerRow): McpServer {
  return {
    id: row.id,
    twinId: row.twin_id,
    name: row.name,
    transport: row.transport,
    command: row.command,
    args: row.args_json ? (JSON.parse(row.args_json) as string[]) : null,
    hasEnv: row.env_json_encrypted !== null,
    url: row.url,
    defaultRequiresApproval: row.default_requires_approval === 1,
    isActive: row.is_active === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
