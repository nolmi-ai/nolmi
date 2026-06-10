import "dotenv/config";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdir } from "node:fs/promises";
import { openDatabase } from "./db.js";
import { TwinsRepo } from "./twins-repo.js";
import { MessagesRepo } from "./messages-repo.js";
import { DeliveryHub } from "./delivery.js";
import { createServer } from "./server.js";

// ─── BOOTSTRAP ───────────────────────────────────────────────────────────────
//
// Bootet die Bridge in dieser Reihenfolge:
//   1. ENV laden, DB-File sicherstellen, DB öffnen
//   2. Repos & DeliveryHub erzeugen
//   3. HTTP-Server starten
//
// Vor dem ersten Start: `pnpm --filter @nolmi/bridge db:init` einmal laufen
// lassen, damit die Migrationen durchlaufen.

async function main() {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);
  const packageRoot = resolve(__dirname, "..");
  const dbPath = process.env.BRIDGE_DATABASE_PATH ?? resolve(packageRoot, "data/bridge.db");

  await mkdir(resolve(dbPath, ".."), { recursive: true });

  const db = openDatabase(dbPath);
  const twins = new TwinsRepo(db);
  const messages = new MessagesRepo(db);
  const delivery = new DeliveryHub();

  // Register-Allowlist-Token: ohne ENV läuft die Bridge weiter, aber
  // /twins/register antwortet mit 503. Bewusst fail-closed — ein offener
  // Register-Endpoint auf der Production-Bridge ist kein akzeptabler Default.
  const registerToken = process.env.BRIDGE_REGISTER_TOKEN?.trim() || null;
  if (!registerToken) {
    console.warn(
      "[boot] WARN BRIDGE_REGISTER_TOKEN ist nicht gesetzt — POST /twins/register ist deaktiviert.\n" +
        "       Setze BRIDGE_REGISTER_TOKEN in der ENV, um neue Twins registrieren zu können.",
    );
  }

  // Admin-Token für den Orphan-Cleanup-Endpoint (#744-Rest). Optional/opt-in:
  // ohne ENV läuft die Bridge weiter, DELETE /admin/twins/:handle antwortet 503.
  const adminToken = process.env.BRIDGE_ADMIN_TOKEN?.trim() || null;

  const app = await createServer({ twins, messages, delivery, registerToken, adminToken });
  const port = Number(process.env.BRIDGE_PORT ?? 5100);
  const host = process.env.BRIDGE_HOST ?? "127.0.0.1";

  await app.listen({ port, host });
  console.log(`[boot] Bridge hört auf http://${host}:${port}`);
  console.log(`[boot] DB: ${dbPath} (${twins.list().length} registrierte Twins)`);
  console.log(
    `[boot] Register-Endpoint: ${registerToken ? "geschützt (Token aktiv)" : "DEAKTIVIERT (kein Token)"}`,
  );
  console.log(
    `[boot] Admin-Cleanup-Endpoint: ${adminToken ? "aktiv (Admin-Token gesetzt)" : "DEAKTIVIERT (kein BRIDGE_ADMIN_TOKEN)"}`,
  );
}

main().catch((err) => {
  console.error("[boot] Fataler Fehler:", err);
  process.exit(1);
});
