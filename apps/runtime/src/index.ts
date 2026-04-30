import "dotenv/config";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdir } from "node:fs/promises";
import { createSqliteRepository } from "./repository/index.js";
import { createProvider } from "./providers/index.js";
import { EventBus } from "./events/bus.js";
import { AuditService } from "./audit/service.js";
import { TwinService } from "./twin-service.js";
import { createServer } from "./server.js";
import { loadPersonaFromDocs } from "./persona/loader.js";
import { loadMandatesFromYaml, syncMandates } from "./mandates/service.js";

// ─── BOOTSTRAP ───────────────────────────────────────────────────────────────
//
// Bootet den Runtime in dieser Reihenfolge:
//   1. ENV laden, DB-File sicherstellen, Repository erzeugen
//   2. Persona aus docs/persona.md laden, ins Repository schreiben
//   3. Mandates aus docs/mandates.yaml laden, mit Repository syncen
//   4. Provider erzeugen (OpenAI oder Anthropic je nach ENV)
//   5. Services verkabeln
//   6. HTTP-Server starten

async function main() {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);
  // Vom Runtime-src-Verzeichnis hoch zum Repo-Root, dann zu docs/
  const repoRoot = resolve(__dirname, "../../..");
  const dbPath = process.env.DATABASE_PATH ?? resolve(repoRoot, "data/twin.db");
  const docsDir = resolve(repoRoot, "docs");

  await mkdir(resolve(dbPath, ".."), { recursive: true });

  // 1. Repository
  const repo = createSqliteRepository(dbPath);

  // 2. Persona laden + speichern
  const persona = await loadPersonaFromDocs(docsDir);
  await repo.persona.save(persona);
  console.log(`[boot] Persona geladen: ${persona.name} (@${persona.handle})`);

  // 3. Mandates syncen
  const mandates = await loadMandatesFromYaml(resolve(docsDir, "mandates.yaml"));
  await syncMandates(repo.mandates, mandates);
  console.log(`[boot] ${mandates.length} Mandates synchronisiert`);

  // 4. Provider
  const provider = createProvider();
  console.log(`[boot] Provider aktiv: ${provider.name}`);

  // 5. Services
  const bus = new EventBus();
  const audit = new AuditService(repo.audit, bus);
  const twin = new TwinService({
    provider,
    audit,
    bus,
    personaRepo: repo.persona,
    mandateRepo: repo.mandates,
  });

  // 6. Server
  const app = await createServer({ twin, audit: repo.audit, bus });
  const port = Number(process.env.RUNTIME_PORT ?? 4000);
  const host = process.env.RUNTIME_HOST ?? "127.0.0.1";

  await app.listen({ port, host });
  console.log(`[boot] Runtime hört auf http://${host}:${port}`);
}

main().catch((err) => {
  console.error("[boot] Fataler Fehler:", err);
  process.exit(1);
});
