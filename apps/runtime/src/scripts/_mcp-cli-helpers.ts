import { fileURLToPath } from "node:url";
import path from "node:path";
import "dotenv/config";
import { z } from "zod";
import Database from "better-sqlite3";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import type { McpServer } from "@nolmi/shared";
import { loadRuntimeConfig } from "../config.js";
import { loadMasterKey } from "../crypto-utils.js";
import { TwinProfilesRepo, type TwinProfile } from "../twin-profiles-repo.js";
import {
  McpServerNotFoundError,
  McpServersRepo,
} from "../mcp/repo.js";
import { SkillRepo } from "../skills/repo.js";
import { McpClientManager } from "../mcp/client-manager.js";
import { McpSkillSync } from "../mcp/skill-sync.js";
import { defaultMcpClientFactory } from "../mcp/client-factory.js";

// ─── MCP CLI HELPERS (Phase 3.2 Sub-Schritt E) ──────────────────────────────
//
// Gemeinsames Setup für die vier MCP-CLI-Skripte. Bewusst KEIN
// TwinServiceRegistry-Setup wie in `index.ts` — die Registry zieht Bridge-
// Streams + Logger + LanguageModel hoch, alles unnötig für eine kurzlebige
// CLI. Stattdessen direkt die Komponenten, die wir brauchen: Profile-Lookup,
// MCP-Repo, Skill-Repo, Manager, Sync.
//
// `loadMcpCliContext` liefert ein Bundle plus eine `cleanup()`-Funktion, die
// am Ende des CLI-Skripts gerufen werden muss (Manager-Dispose + DB-Close).
// Pattern: try/finally um den Hauptpfad.

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// _mcp-cli-helpers.ts liegt in apps/runtime/src/scripts/ — Repo-Root ist 4
// Ebenen hoch (scripts → src → runtime → apps → REPO).
//
// Nötig weil pnpm-filter den CWD auf apps/runtime/ setzt; relative Specs
// vom User sollen aber zum Repo-Root resolven (`mcp-servers/everything.json`),
// nicht zu apps/runtime/mcp-servers/everything.json.
export const REPO_ROOT = path.resolve(__dirname, "../../../..");

/**
 * Resolved einen relativen Pfad gegen den Repo-Root. Absolute Pfade werden
 * unverändert durchgereicht. Pattern für alle CLI-Skripte die File-Inputs
 * vom User akzeptieren.
 */
export function resolveRepoPath(relativeOrAbsolute: string): string {
  return path.isAbsolute(relativeOrAbsolute)
    ? relativeOrAbsolute
    : path.resolve(REPO_ROOT, relativeOrAbsolute);
}

export interface McpCliContext {
  twin: TwinProfile;
  db: Database.Database;
  mcpRepo: McpServersRepo;
  skillRepo: SkillRepo;
  manager: McpClientManager;
  sync: McpSkillSync;
  cleanup: () => Promise<void>;
}

/**
 * Lädt den Twin (per Handle) plus den nötigen MCP-Komponenten-Stack. Wirft
 * mit klarer Fehlermeldung wenn Master-Key oder Twin nicht da sind — der
 * CLI-Wrapper fängt das und macht `process.exit(1)`.
 */
export async function loadMcpCliContext(
  rawHandle: string,
): Promise<McpCliContext> {
  const handle = rawHandle.startsWith("@") ? rawHandle : `@${rawHandle}`;

  const masterKey = loadMasterKey();
  const config = loadRuntimeConfig();
  const db = new Database(config.dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  const profilesRepo = new TwinProfilesRepo(db);
  const twin = profilesRepo.findByHandle(handle);
  if (!twin) {
    db.close();
    throw new Error(
      `Twin '${handle}' nicht in twin_profiles gefunden. Handle prüfen oder zuerst 'pnpm twin:bootstrap ${handle.replace(/^@/, "")}' ausführen.`,
    );
  }

  const mcpRepo = new McpServersRepo(db, masterKey);
  const skillRepo = new SkillRepo(db);
  const manager = new McpClientManager(
    twin.twinId,
    mcpRepo,
    defaultMcpClientFactory,
  );
  const sync = new McpSkillSync(mcpRepo, skillRepo, manager, twin.twinId);

  const cleanup = async () => {
    await manager.dispose();
    db.close();
  };

  return { twin, db, mcpRepo, skillRepo, manager, sync, cleanup };
}

/**
 * Findet einen MCP-Server pro Name ODER ID. ID-Pattern (`mcp_<nanoid>`)
 * kommt zuerst, sonst fallen wir auf den Namens-Lookup. Wirft mit klarer
 * Diagnose, wenn weder noch passt.
 */
export function resolveServer(
  ctx: Pick<McpCliContext, "twin" | "mcpRepo">,
  serverNameOrId: string,
): McpServer {
  if (serverNameOrId.startsWith("mcp_")) {
    try {
      return ctx.mcpRepo.findById(serverNameOrId);
    } catch (err) {
      if (!(err instanceof McpServerNotFoundError)) throw err;
      // fallthrough to name lookup, falls jemand einen Server `mcp_*` getauft hat
    }
  }
  try {
    return ctx.mcpRepo.findByName(ctx.twin.twinId, serverNameOrId);
  } catch (err) {
    if (err instanceof McpServerNotFoundError) {
      throw new Error(
        `MCP-Server '${serverNameOrId}' (weder Name noch ID) für Twin ${ctx.twin.handle} gefunden.`,
      );
    }
    throw err;
  }
}

/**
 * Plaintext-Box pro Server. Pattern wie bei `twin:reload` (gleiche Indentation
 * + Linien-Optik). Skill-Stats kommen vom Caller, weil sie zwei DB-Calls
 * brauchen (active + inactive) und der Helper repo-agnostisch bleiben soll.
 */
export function formatPlaintextServer(
  server: McpServer,
  skillStats: { active: number; inactive: number },
): string {
  const cmd = server.command
    ? [server.command, ...(server.args ?? [])].join(" ")
    : "(http transport)";
  const lines = [
    `${server.isActive ? "✓" : "✗"} ${server.name} (${server.id})`,
    `  Transport: ${server.transport}`,
    `  Command:   ${cmd}`,
    `  Active:    ${server.isActive ? "yes" : "no"}`,
    `  Tools:     ${skillStats.active} active, ${skillStats.inactive} inactive`,
    `  Approval:  ${server.defaultRequiresApproval ? "required (default)" : "not required (default)"}`,
  ];
  if (server.hasEnv) {
    lines.push(`  Env:       set (encrypted)`);
  }
  return lines.join("\n");
}

// ─── Spec-File-Schema ──────────────────────────────────────────────────────
//
// Lokales Schema für die JSON-Specs in `mcp-servers/`. Bewusst nicht
// `McpServerAddInputSchema` aus shared, weil dort `twinId` Pflicht ist —
// das Spec-File ist Twin-agnostisch, twinId kommt aus dem CLI-Handle.

export const McpServerSpecSchema = z.object({
  name: z.string().min(1).max(100),
  transport: z.enum(["stdio", "http"]),
  command: z.string().nullable().optional(),
  args: z.array(z.string()).nullable().optional(),
  url: z.string().url().nullable().optional(),
  env: z.record(z.string(), z.string()).nullable().optional(),
  defaultRequiresApproval: z.boolean().optional(),
});
export type McpServerSpec = z.infer<typeof McpServerSpecSchema>;

/**
 * Verdeckter Stdin-Prompt für ENV-Werte mit Marker `"?"`. TTY-Pfad nutzt
 * setRawMode — keine Echo-Anzeige, Backspace und Ctrl-C werden behandelt.
 * Pattern aus `set-api-key.ts` übernommen, leicht reduziert (kein Pipe-
 * Modus — CLI ist immer interaktiv beim mcp-add).
 */
export async function promptForEnvValue(key: string): Promise<string> {
  process.stdout.write(`${key}: `);
  const stdin = process.stdin;
  if (!stdin.isTTY) {
    // Nicht-TTY-Fall (z.B. CI): readline ohne Echo-Trick — der Wert ist
    // dann sichtbar, aber CI-Scripts sind selten interaktiv und dieser Pfad
    // existiert nur, damit der CLI nicht stumm hängt.
    const rl = createInterface({ input, output });
    try {
      return (await rl.question("")).trim();
    } finally {
      rl.close();
    }
  }
  return new Promise<string>((resolve, reject) => {
    stdin.setRawMode(true);
    stdin.setEncoding("utf8");
    let buf = "";
    const cleanup = () => {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.removeListener("data", handler);
    };
    const handler = (chunk: string) => {
      for (const ch of chunk) {
        if (ch === "\u0003") {
          cleanup();
          process.stdout.write("\n");
          reject(new Error("Abbruch (Ctrl-C)"));
          return;
        }
        if (ch === "\r" || ch === "\n") {
          cleanup();
          process.stdout.write("\n");
          resolve(buf);
          return;
        }
        if (ch === "\u007f" || ch === "\b") {
          if (buf.length > 0) buf = buf.slice(0, -1);
          continue;
        }
        buf += ch;
      }
    };
    stdin.on("data", handler);
    stdin.resume();
  });
}

/**
 * Yes/no Confirm-Prompt mit Default 'no'. Akzeptiert y/yes/j/ja
 * (case-insensitive). Pattern wie bei `twin:reload`.
 */
export async function confirm(question: string): Promise<boolean> {
  const rl = createInterface({ input, output });
  try {
    const answer = (await rl.question(question)).trim().toLowerCase();
    return answer === "y" || answer === "yes" || answer === "j" || answer === "ja";
  } finally {
    rl.close();
  }
}
