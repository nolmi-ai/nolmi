import "dotenv/config";
import Database from "better-sqlite3";
import * as sqliteVec from "sqlite-vec";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { nanoid } from "nanoid";
import { loadRuntimeConfig, REVERSE_QUERY_TOP_K } from "../config.js";
import { EmbeddingsRepo } from "../episodic/embeddings-repo.js";
import {
  detectCapability,
  reverseTimeframeToSinceIso,
  buildRetrospectiveDirective,
} from "../twin-service.js";
import type { RetrievalResult } from "../episodic/memory-retrieval-service.js";

// ─── TEST: Reverse-Memory-Query (Lebens-Narrativ Stufe 1) ───────────────────
//
// Deterministische Mechanik-Verifikation (KEIN LLM): Intent-Erkennung,
// Zeitfilter im Repo (Vektor + FTS), Synthese-Directive-Ehrlichkeit. Die
// LLM-Synthese-Güte (Treffer zusammenfassen) verifiziert Markus live mit
// echtem Key — heute nur Mechanik gegen synthetische/dünne Daten (G2-Reife
// kommt morgen).
//   pnpm --filter @nolmi/runtime exec tsx src/scripts/test-reverse-memory-query.ts

const EMBEDDING_DIM = 1024;
const TEST_MODEL = "Xenova/multilingual-e5-large";

let failures = 0;
function assert(cond: boolean, label: string): void {
  if (cond) console.log(`  ✓ ${label}`);
  else { console.error(`  ✗ FAIL: ${label}`); failures += 1; }
}

/** Einfacher normalisierter Einheitsvektor — alle gleich → Distanz 0 zur Query. */
function unitVec(): Float32Array {
  const v = new Float32Array(EMBEDDING_DIM);
  v[0] = 1;
  return v;
}

async function main(): Promise<void> {
  // ── 2) Intent-Erkennung (pure detectCapability) ──
  console.log("\n── 2) Intent-Erkennung");
  {
    const b = detectCapability("Was hab ich über Bayreuth gesagt?");
    assert(b.capability === "reverse_memory_query", "Stichwort-Frage → reverse_memory_query (Typ b)");
    assert(
      b.capability === "reverse_memory_query" && b.reverseTimeframe === undefined,
      "Typ b → kein Zeitfenster",
    );

    const aWeek = detectCapability("Was hab ich letzte Woche über das Projekt gesagt?");
    assert(
      aWeek.capability === "reverse_memory_query" && aWeek.reverseTimeframe === "week",
      "eingeschobene Zeitangabe bricht Erkennung NICHT + timeframe=week",
    );

    const aMonth = detectCapability("Was hat mich diesen Monat beschäftigt?");
    assert(
      aMonth.capability === "reverse_memory_query" && aMonth.reverseTimeframe === "month",
      "diesen-Monat-Frage → Typ a, month",
    );

    const aRecent = detectCapability("Was hat mich in letzter Zeit beschäftigt?");
    assert(
      aRecent.capability === "reverse_memory_query" && aRecent.reverseTimeframe === "recent",
      "in-letzter-Zeit-Frage → Typ a, recent",
    );

    const addr = detectCapability("Erinnerst du dich, was wir zu HARWAY besprochen haben?");
    assert(addr.capability === "reverse_memory_query", "erinnerst-du-dich → reverse");

    const normal1 = detectCapability("Wie ist das Wetter heute?");
    assert(normal1.capability === "respond_to_chat", "normale Frage → respond_to_chat (kein Fehlauslösen)");
    const normal2 = detectCapability("Kannst du mir bei der Präsentation helfen?");
    assert(normal2.capability === "respond_to_chat", "normale Bitte → respond_to_chat");
    const summary = detectCapability("Fass zusammen, was wichtig ist");
    assert(summary.capability === "summarize_topic", "Summary bleibt summarize_topic (reverse übersteuert nicht)");
  }

  // ── reverseTimeframeToSinceIso ──
  console.log("\n── reverseTimeframeToSinceIso");
  {
    const now = new Date("2026-06-06T12:00:00Z");
    const dayMs = 24 * 60 * 60 * 1000;
    assert(
      reverseTimeframeToSinceIso("week", now) === new Date(now.getTime() - 7 * dayMs).toISOString(),
      "week → now-7d",
    );
    assert(
      reverseTimeframeToSinceIso("month", now) === new Date(now.getTime() - 30 * dayMs).toISOString(),
      "month → now-30d",
    );
    assert(
      reverseTimeframeToSinceIso("recent", now) === new Date(now.getTime() - 14 * dayMs).toISOString(),
      "recent → now-14d",
    );
  }

  // ── 3) Zeitfilter im Repo (Vektor + FTS), echtes Schema ──
  console.log("\n── 3) Zeitfilter (since) im Repo");
  {
    const db = new Database(":memory:");
    sqliteVec.load(db);
    db.pragma("journal_mode = MEMORY");
    db.pragma("foreign_keys = ON");
    const config = loadRuntimeConfig();
    for (const file of readdirSync(config.migrationsDir).filter((f) => f.endsWith(".sql")).sort()) {
      db.exec(readFileSync(resolve(config.migrationsDir, file), "utf-8"));
    }
    const userId = `user_${nanoid(16)}`;
    const nowIso = new Date().toISOString();
    db.prepare(
      `INSERT INTO users (user_id, email, password_hash, display_name, created_at, updated_at)
       VALUES (?, ?, 'x', 'Test', ?, ?)`,
    ).run(userId, `${nanoid(8)}@test.invalid`, nowIso, nowIso);
    const twinId = `twin_${nanoid(16)}`;
    db.prepare(
      `INSERT INTO twin_profiles (twin_id, handle, display_name, persona_md, mandates_json,
         llm_config, bridge_url, bridge_token, owner_user_id, is_active, created_at, updated_at)
       VALUES (?, ?, 'T', '# P', '[]', ?, NULL, NULL, ?, 1, ?, ?)`,
    ).run(twinId, `@rq-${nanoid(4)}`, JSON.stringify({ provider: "openai", model: "x", apiKeyEncrypted: "x", apiKeySource: "user" }), userId, Date.now(), Date.now());

    const repo = new EmbeddingsRepo(db);
    // Zwei Embeddings, gleicher Vektor + geteiltes FTS-Token „apfelthema",
    // unterschiedliches Alter.
    const recent = repo.insert(
      { twinId, targetType: "conversation", targetId: "c_recent", embeddingModel: TEST_MODEL, embedding: unitVec() },
      { ftsContent: "apfelthema frisch besprochen" },
    );
    const old = repo.insert(
      { twinId, targetType: "conversation", targetId: "c_old", embeddingModel: TEST_MODEL, embedding: unitVec() },
      { ftsContent: "apfelthema vor langer zeit" },
    );
    // Alter setzen: recent = heute, old = vor 100 Tagen.
    const dayMs = 24 * 60 * 60 * 1000;
    db.prepare("UPDATE embeddings SET created_at=? WHERE id=?").run(new Date().toISOString(), recent.id);
    db.prepare("UPDATE embeddings SET created_at=? WHERE id=?").run(new Date(Date.now() - 100 * dayMs).toISOString(), old.id);

    const since = new Date(Date.now() - 30 * dayMs).toISOString();

    // Vektor-Pfad
    const vecAll = repo.search(twinId, unitVec(), { topK: 10, similarityThreshold: 0, embeddingModel: TEST_MODEL });
    assert(vecAll.length === 2, `Vektor ohne Filter → beide (got ${vecAll.length})`);
    const vecSince = repo.search(twinId, unitVec(), { topK: 10, similarityThreshold: 0, embeddingModel: TEST_MODEL, since });
    assert(vecSince.length === 1 && vecSince[0]?.record.targetId === "c_recent",
      `Vektor mit since (30d) → nur recent (got ${vecSince.map((h) => h.record.targetId).join(",")})`);

    // FTS-Pfad
    const ftsAll = repo.searchFts5(twinId, "apfelthema", { topK: 10, embeddingModel: TEST_MODEL });
    assert(ftsAll.length === 2, `FTS ohne Filter → beide (got ${ftsAll.length})`);
    const ftsSince = repo.searchFts5(twinId, "apfelthema", { topK: 10, embeddingModel: TEST_MODEL, since });
    assert(ftsSince.length === 1 && ftsSince[0]?.targetId === "c_recent",
      `FTS mit since (30d) → nur recent (got ${ftsSince.map((h) => h.targetId).join(",")})`);

    db.close();
  }

  // ── 5) Synthese-Directive: Ehrlichkeit bei leer, Treffer-Rendering bei voll ──
  console.log("\n── 5) Synthese-Directive (Anti-Halluzination)");
  {
    const empty = buildRetrospectiveDirective("Markus", []);
    assert(empty.includes("keine Treffer") || empty.includes("wenig"),
      "leerer Korpus → Directive instruiert Ehrlichkeit (kein Halluzinieren)");
    assert(empty.includes("Erfinde NICHTS"), "leer → harte Anti-Halluzinations-Leitplanke enthalten");

    const hits: RetrievalResult[] = [
      { embeddingId: "e1", targetType: "conversation", targetId: "c1", content: "Workshop-Preis auf 2500 EUR/Tag gesetzt", createdAt: "2026-05-01T10:00:00Z", rrfScore: 0.1 },
      { embeddingId: "e2", targetType: "diary_entry", targetId: "d1", content: "Über Agent-Readiness nachgedacht", createdAt: "2026-05-10T10:00:00Z", rrfScore: 0.09 },
    ];
    const full = buildRetrospectiveDirective("Markus", hits);
    assert(full.includes("Workshop-Preis auf 2500") && full.includes("Agent-Readiness"),
      "voller Korpus → Treffer-Content im Block enthalten");
    assert(full.includes("2026-05-01") && full.includes("Markus' Stimme"),
      "voller Korpus → Datum + Stimme-Instruktion enthalten");
  }

  // ── 6) Config: eigener REVERSE_QUERY_TOP_K (Chat-Default unberührt) ──
  console.log("\n── 6) REVERSE_QUERY_TOP_K");
  assert(REVERSE_QUERY_TOP_K === 12, `Default 12 (got ${REVERSE_QUERY_TOP_K})`);

  console.log(failures === 0
    ? "\n✅ ALLE CHECKS GRÜN — Reverse-Memory-Query (Intent inkl. Zeitangabe, Repo-Zeitfilter Vektor+FTS, Synthese-Ehrlichkeit, topK).\n"
    : `\n❌ ${failures} FEHLER\n`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => { console.error(err); process.exit(1); });
