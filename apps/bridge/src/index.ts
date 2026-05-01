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
// Vor dem ersten Start: `pnpm --filter @twin-lab/bridge db:init` einmal laufen
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

  const app = await createServer({ twins, messages, delivery });
  const port = Number(process.env.BRIDGE_PORT ?? 5100);
  const host = process.env.BRIDGE_HOST ?? "127.0.0.1";

  await app.listen({ port, host });
  console.log(`[boot] Bridge hört auf http://${host}:${port}`);
  console.log(`[boot] DB: ${dbPath} (${twins.list().length} registrierte Twins)`);
}

main().catch((err) => {
  console.error("[boot] Fataler Fehler:", err);
  process.exit(1);
});
