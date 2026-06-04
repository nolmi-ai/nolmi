import { fileURLToPath } from "node:url";
import path from "node:path";
import "dotenv/config";
import Database from "better-sqlite3";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import type { FactConfidence } from "@nolmi/shared";
import { loadRuntimeConfig } from "../config.js";
import { TwinProfilesRepo, type TwinProfile } from "../twin-profiles-repo.js";
import { FactsRepo, type Fact } from "../facts/repo.js";
import { FactsHistoryRepo } from "../facts/facts-history-repo.js";

// ─── FACTS CLI HELPERS (Phase 3.3 Sub-Schritt D) ────────────────────────────
//
// Gemeinsames Setup für die vier facts-CLI-Skripte. Pattern wie
// `_mcp-cli-helpers.ts`: kurzlebige CLI ohne Registry/Bridge — wir brauchen
// nur Profile-Lookup + FactsRepo, sonst nichts. cleanup() schließt die
// DB-Connection; der CLI-Wrapper ruft sie im try/finally.

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// _facts-cli-helpers.ts liegt in apps/runtime/src/scripts/ — Repo-Root ist
// 4 Ebenen hoch (scripts → src → runtime → apps → REPO). Pattern wie bei
// MCP-CLI: User-Pfade resolven gegen Repo-Root, nicht gegen pnpm-cwd.
export const REPO_ROOT = path.resolve(__dirname, "../../../..");

export function resolveRepoPath(relativeOrAbsolute: string): string {
  return path.isAbsolute(relativeOrAbsolute)
    ? relativeOrAbsolute
    : path.resolve(REPO_ROOT, relativeOrAbsolute);
}

export interface FactsCliContext {
  twin: TwinProfile;
  db: Database.Database;
  factsRepo: FactsRepo;
  cleanup: () => Promise<void>;
}

/**
 * Lädt den Twin (per Handle) plus FactsRepo. Wirft mit klarer Fehlermeldung,
 * wenn der Twin nicht in der DB ist — CLI-Wrapper macht daraus `exit 1`.
 */
export async function loadFactsCliContext(
  rawHandle: string,
): Promise<FactsCliContext> {
  const handle = rawHandle.startsWith("@") ? rawHandle : `@${rawHandle}`;

  const config = loadRuntimeConfig();
  const db = new Database(config.dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  const profilesRepo = new TwinProfilesRepo(db);
  const twin = profilesRepo.findByHandle(handle);
  if (!twin) {
    db.close();
    throw new Error(
      `Twin '${handle}' nicht in twin_profiles gefunden. Handle prüfen oder zuerst onboarden.`,
    );
  }

  const factsRepo = new FactsRepo(db, new FactsHistoryRepo(db));

  const cleanup = async () => {
    db.close();
  };

  return { twin, db, factsRepo, cleanup };
}

/**
 * Status-Marker für Pretty-Print:
 *   - ✓ approved (vom User bestätigt oder direkt eingegeben)
 *   - ⏳ pending (Twin will schreiben, wartet auf Approval — kommt in 3.3.F)
 *   - ? auto (Reserve für zukünftige Auto-Imports ohne explizite Bestätigung)
 */
export function statusMarker(confidence: FactConfidence): string {
  if (confidence === "approved") return "✓";
  if (confidence === "pending") return "⏳";
  return "?";
}

/**
 * Box-Drawing Pretty-Print: ein Fact pro Zeile, Status-Marker links, Key
 * (mono-breit angedeutet), Value (möglich gekürzt), Source/Confidence in
 * Klammern. Tabellen-Optik wäre schöner aber überengineered für kurze
 * Listen — pro Pilot bleiben ein paar Dutzend Facts überschaubar.
 */
export function printFactsTable(handle: string, facts: Fact[]): void {
  const count = facts.length;
  console.log(`${handle} — ${count} Fact${count === 1 ? "" : "s"}`);
  console.log("─".repeat(60));
  if (count === 0) {
    console.log("(keine Facts hinterlegt)");
    return;
  }
  for (const f of facts) {
    const marker = statusMarker(f.confidence);
    const value =
      f.factValue.length > 80 ? `${f.factValue.slice(0, 77)}...` : f.factValue;
    console.log(
      `${marker} ${f.factKey} → ${value} (${f.source}, ${f.confidence})`,
    );
  }
}

/**
 * Yes/no-Prompt mit Default 'no'. Akzeptiert y/yes/j/ja (case-insensitive).
 * Pattern wie `_mcp-cli-helpers.confirm` — kein neuer Mechanismus.
 */
export async function confirm(question: string): Promise<boolean> {
  const rl = createInterface({ input, output });
  try {
    const answer = (await rl.question(question)).trim().toLowerCase();
    return (
      answer === "y" || answer === "yes" || answer === "j" || answer === "ja"
    );
  } finally {
    rl.close();
  }
}

/**
 * Validiert Key/Value-Länge analog zum Shared-Schema (FactCreateRequestSchema):
 *   - factKey: 1-200 Zeichen
 *   - factValue: 1-10000 Zeichen
 *
 * CLI-Pfad parsed nicht durch das Zod-Schema (weil das auf Server-Format
 * gehört), aber wir wollen dieselben Constraints — sonst akzeptiert die CLI
 * Werte, die die API ablehnen würde. Wirft mit klarer Diagnose; Caller fängt
 * und exit 1't.
 */
export function validateFactInput(factKey: string, factValue: string): void {
  if (factKey.length < 1 || factKey.length > 200) {
    throw new Error(
      `factKey muss 1-200 Zeichen lang sein (got: ${factKey.length})`,
    );
  }
  if (factValue.length < 1 || factValue.length > 10000) {
    throw new Error(
      `factValue muss 1-10000 Zeichen lang sein (got: ${factValue.length})`,
    );
  }
}

/**
 * Source-Flag-Parser. CLI-Default ist 'user'. Twin/import sind explizit für
 * Bulk-Tools oder Twin-Extraction (3.3.F) reserviert — der twin:facts-add-
 * Pfad soll aber auch sie unterstützen, falls jemand z.B. manuell einen
 * import-Audit-Trail simulieren will.
 */
export function parseSourceFlag(
  raw: string | undefined,
): "user" | "twin" | "import" {
  if (raw === undefined) return "user";
  if (raw === "user" || raw === "twin" || raw === "import") return raw;
  throw new Error(`--source muss eines von user|twin|import sein (got: ${raw})`);
}
