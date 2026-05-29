import "dotenv/config";
import {
  LocalEmbeddingProvider,
  OpenAIEmbeddingProvider,
  VoyageEmbeddingProvider,
  getEmbeddingProvider,
  _resetEmbeddingProvider,
} from "../episodic/providers/index.js";

// ─── TEST: EMBEDDING PROVIDERS (Phase 3.4 Sub-Schritt B) ────────────────────
//
// Zwei Test-Phasen:
//   Phase 1 — Factory-Logik ohne Modell-Load (schnell, immer)
//   Phase 2 — LocalEmbeddingProvider mit echtem Modell (langsam, einmalig
//             pro Maschine wegen Cache, optional via NOLMI_SKIP_LOCAL=1)
//   Phase 3 — OpenAI/Voyage nur wenn API-Keys gesetzt (sonst skip mit Hinweis)
//
// Modell-Load dauert beim ersten Lauf je nach Verbindung mehrere Minuten
// (Pre-Check: 48s auf M1 Max mit fp32; q8 ist kleiner, also vergleichbar
// oder schneller). Nachfolgende Läufe sind ms aus dem ONNX-Cache.
//
// Aufruf:
//   pnpm --filter @nolmi/runtime test-embedding-providers

async function main() {
  let issues = 0;

  issues += await runFactoryTests();

  if (process.env.NOLMI_SKIP_LOCAL === "1") {
    log("\n⊘ LocalEmbeddingProvider-Tests übersprungen (NOLMI_SKIP_LOCAL=1)\n");
  } else {
    issues += await runLocalProviderTests();
  }

  issues += await runOptionalExternalTests();

  banner("ZUSAMMENFASSUNG");
  if (issues === 0) {
    log("✓ alle Tests grün");
  } else {
    log(`✗ ${issues} Issue(s) — Details oben.`);
    process.exit(2);
  }
}

// ─── PHASE 1: FACTORY ───────────────────────────────────────────────────────

async function runFactoryTests(): Promise<number> {
  let issues = 0;
  // ENV-Snapshot, damit die Factory-Tests sich nicht gegenseitig stören.
  const snapshot: Record<string, string | undefined> = {
    NOLMI_EMBEDDING_PROVIDER: process.env.NOLMI_EMBEDDING_PROVIDER,
    NOLMI_EMBEDDING_API_KEY: process.env.NOLMI_EMBEDDING_API_KEY,
    NOLMI_EMBEDDING_MODEL: process.env.NOLMI_EMBEDDING_MODEL,
    NOLMI_EMBEDDING_DTYPE: process.env.NOLMI_EMBEDDING_DTYPE,
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    VOYAGE_API_KEY: process.env.VOYAGE_API_KEY,
  };

  banner("TEST 1.1 — Factory: default = LocalEmbeddingProvider");
  _resetEmbeddingProvider();
  delete process.env.NOLMI_EMBEDDING_PROVIDER;
  const defaultProvider = getEmbeddingProvider();
  if (!(defaultProvider instanceof LocalEmbeddingProvider)) {
    issues += 1;
    log(`  ⚠ Default sollte LocalEmbeddingProvider sein, got ${defaultProvider.constructor.name}`);
  } else {
    log(`  default = Local ✓ (modelName=${defaultProvider.modelName}, dim=${defaultProvider.dimensions})`);
  }

  banner("TEST 1.2 — Singleton: zweiter getEmbeddingProvider() ist === erster");
  const second = getEmbeddingProvider();
  if (second !== defaultProvider) {
    issues += 1;
    log("  ⚠ Singleton-Cache greift nicht.");
  } else {
    log("  Singleton ✓");
  }

  banner("TEST 1.3 — _resetEmbeddingProvider() lässt neue Instanz zu");
  _resetEmbeddingProvider();
  const fresh = getEmbeddingProvider();
  if (fresh === defaultProvider) {
    issues += 1;
    log("  ⚠ Reset hatte keinen Effekt — gleiche Instanz zurück.");
  } else {
    log("  Reset ✓");
  }

  banner("TEST 1.4 — Factory: openai ohne Key wirft");
  _resetEmbeddingProvider();
  delete process.env.OPENAI_API_KEY;
  delete process.env.NOLMI_EMBEDDING_API_KEY;
  process.env.NOLMI_EMBEDDING_PROVIDER = "openai";
  let threw = false;
  try {
    getEmbeddingProvider();
  } catch (err) {
    threw = true;
    log(`  expected throw: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (!threw) {
    issues += 1;
    log("  ⚠ openai ohne API-Key hätte werfen müssen.");
  } else {
    log("  openai ohne Key wirft ✓");
  }

  banner("TEST 1.5 — Factory: voyage ohne Key wirft");
  _resetEmbeddingProvider();
  delete process.env.VOYAGE_API_KEY;
  delete process.env.NOLMI_EMBEDDING_API_KEY;
  process.env.NOLMI_EMBEDDING_PROVIDER = "voyage";
  let voyageThrew = false;
  try {
    getEmbeddingProvider();
  } catch {
    voyageThrew = true;
  }
  if (!voyageThrew) {
    issues += 1;
    log("  ⚠ voyage ohne API-Key hätte werfen müssen.");
  } else {
    log("  voyage ohne Key wirft ✓");
  }

  banner("TEST 1.6 — Factory: unbekannter Provider wirft");
  _resetEmbeddingProvider();
  process.env.NOLMI_EMBEDDING_PROVIDER = "made-up";
  let unknownThrew = false;
  try {
    getEmbeddingProvider();
  } catch {
    unknownThrew = true;
  }
  if (!unknownThrew) {
    issues += 1;
    log("  ⚠ unbekannter Provider hätte werfen müssen.");
  } else {
    log("  unbekannter Provider wirft ✓");
  }

  banner("TEST 1.7 — Factory: openai mit dummy Key gibt OpenAI-Instanz");
  _resetEmbeddingProvider();
  process.env.NOLMI_EMBEDDING_PROVIDER = "openai";
  process.env.OPENAI_API_KEY = "sk-dummy-for-test";
  const openaiInstance = getEmbeddingProvider();
  if (!(openaiInstance instanceof OpenAIEmbeddingProvider)) {
    issues += 1;
    log(`  ⚠ openai-Provider erwartet, got ${openaiInstance.constructor.name}`);
  } else {
    log(`  openai-Instanz ✓ (modelName=${openaiInstance.modelName}, dim=${openaiInstance.dimensions})`);
  }

  banner("TEST 1.8 — Factory: voyage mit dummy Key gibt Voyage-Instanz");
  _resetEmbeddingProvider();
  process.env.NOLMI_EMBEDDING_PROVIDER = "voyage";
  process.env.VOYAGE_API_KEY = "pa-dummy-for-test";
  const voyageInstance = getEmbeddingProvider();
  if (!(voyageInstance instanceof VoyageEmbeddingProvider)) {
    issues += 1;
    log(`  ⚠ voyage-Provider erwartet, got ${voyageInstance.constructor.name}`);
  } else {
    log(`  voyage-Instanz ✓ (modelName=${voyageInstance.modelName}, dim=${voyageInstance.dimensions})`);
  }

  banner("TEST 1.9 — Constructor wirft bei leerem API-Key");
  let openaiCtorThrew = false;
  try {
    new OpenAIEmbeddingProvider({ apiKey: "" });
  } catch {
    openaiCtorThrew = true;
  }
  let voyageCtorThrew = false;
  try {
    new VoyageEmbeddingProvider({ apiKey: "  " });
  } catch {
    voyageCtorThrew = true;
  }
  if (!openaiCtorThrew || !voyageCtorThrew) {
    issues += 1;
    log("  ⚠ Constructor mit leerem Key hat nicht geworfen.");
  } else {
    log("  beide Constructor-Validierungen ✓");
  }

  // ENV restoren, damit die Local-/External-Tests sauber starten.
  _resetEmbeddingProvider();
  for (const [k, v] of Object.entries(snapshot)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }

  return issues;
}

// ─── PHASE 2: LOCAL PROVIDER (echter Modell-Call) ──────────────────────────

async function runLocalProviderTests(): Promise<number> {
  let issues = 0;

  banner("TEST 2.1 — isReady() vor Init = false");
  const provider = new LocalEmbeddingProvider({ dtype: "q8" });
  const readyBefore = await provider.isReady();
  if (readyBefore) {
    issues += 1;
    log("  ⚠ isReady() = true vor erstem embed-Call.");
  } else {
    log(`  vor Init: ready=false ✓ (modelName=${provider.modelName})`);
  }

  banner("TEST 2.2 — Single Embed (Passage, deutsch)");
  log("  → erster Call lädt das Modell — kann beim allerersten Lauf dauern…");
  const t0 = Date.now();
  let single: Float32Array[];
  try {
    single = await provider.embed(
      "Markus arbeitet bei HARWAY Experience und lebt in Roding.",
      { inputType: "passage" },
    );
  } catch (err) {
    issues += 1;
    log(`  ⚠ embed() geworfen: ${err instanceof Error ? err.message : err}`);
    return issues;
  }
  const t1 = Date.now();
  log(`  fertig in ${((t1 - t0) / 1000).toFixed(1)}s (inkl. evtl. Modell-Load)`);

  if (single.length !== 1) {
    issues += 1;
    log(`  ⚠ erwartet 1 Embedding, got ${single.length}`);
  }
  const emb = single[0];
  if (!emb || !(emb instanceof Float32Array)) {
    issues += 1;
    log("  ⚠ Embedding ist kein Float32Array.");
    return issues;
  }
  if (emb.length !== provider.dimensions) {
    issues += 1;
    log(`  ⚠ Dimension: erwartet ${provider.dimensions}, got ${emb.length}`);
  } else {
    log(`  dims=${emb.length} ✓`);
  }

  // L2-Norm sollte ≈ 1 sein (normalize:true).
  let norm = 0;
  for (let i = 0; i < emb.length; i++) {
    const v = emb.at(i) ?? 0;
    norm += v * v;
  }
  const l2 = Math.sqrt(norm);
  if (Math.abs(l2 - 1.0) > 0.02) {
    issues += 1;
    log(`  ⚠ L2-Norm ${l2.toFixed(4)} weicht zu stark von 1 ab.`);
  } else {
    log(`  L2-Norm ${l2.toFixed(4)} ≈ 1 ✓`);
  }

  banner("TEST 2.3 — isReady() nach Init = true");
  const readyAfter = await provider.isReady();
  if (!readyAfter) {
    issues += 1;
    log("  ⚠ isReady() = false nach erfolgreichem embed-Call.");
  } else {
    log("  ready=true ✓");
  }

  banner("TEST 2.4 — Batch Embed (3 Passages)");
  const t2 = Date.now();
  const batch = await provider.embed(
    [
      "Markus arbeitet bei HARWAY Experience.",
      "Florian ist Markus' Geschäftspartner.",
      "Anna ist Markus' Frau.",
    ],
    { inputType: "passage" },
  );
  const t3 = Date.now();
  log(`  3-Batch in ${t3 - t2}ms`);
  if (batch.length !== 3) {
    issues += 1;
    log(`  ⚠ erwartet 3 Embeddings, got ${batch.length}`);
  }
  for (let i = 0; i < batch.length; i++) {
    const v = batch[i];
    if (!v || v.length !== provider.dimensions) {
      issues += 1;
      log(`  ⚠ Batch-Embedding ${i} hat falsche Dimension.`);
    }
  }

  banner("TEST 2.5 — Single vs. 1-Batch sind ≈ identisch");
  // Determinismus: derselbe Text einmal als String, einmal als [string]
  // → numerisch nahezu gleicher Vektor.
  const text = "Hallo Welt";
  const [s1] = await provider.embed(text, { inputType: "passage" });
  const [s2] = await provider.embed([text], { inputType: "passage" });
  if (!s1 || !s2) {
    issues += 1;
    log("  ⚠ Embedding fehlt.");
  } else {
    let maxDelta = 0;
    for (let i = 0; i < s1.length; i++) {
      const a = s1.at(i) ?? 0;
      const b = s2.at(i) ?? 0;
      const d = Math.abs(a - b);
      if (d > maxDelta) maxDelta = d;
    }
    if (maxDelta > 1e-4) {
      issues += 1;
      log(`  ⚠ String- vs. Array-Input weicht zu stark ab (max delta ${maxDelta}).`);
    } else {
      log(`  Konsistenz ✓ (max delta ${maxDelta.toExponential(2)})`);
    }
  }

  banner("TEST 2.6 — Query/Passage-Prefix bringt semantischen Treffer (deutsch)");
  const passages = [
    "Markus arbeitet bei HARWAY Experience.",
    "Florian ist Markus' Geschäftspartner.",
    "Anna ist Markus' Frau.",
  ];
  const passageEmbs = await provider.embed(passages, { inputType: "passage" });
  const [queryEmb] = await provider.embed("Wer ist Markus' Frau?", {
    inputType: "query",
  });
  if (!queryEmb) {
    issues += 1;
    log("  ⚠ Query-Embedding fehlt.");
  } else {
    const sims = passages.map((p, i) => ({
      p,
      sim: dotProduct(queryEmb, passageEmbs[i]!),
    }));
    sims.sort((a, b) => b.sim - a.sim);
    sims.forEach((s) =>
      log(`   sim=${s.sim.toFixed(4)} | ${s.p}`),
    );
    const top = sims[0]?.p;
    if (!top?.includes("Anna")) {
      issues += 1;
      log(`  ⚠ Top-Match enthält nicht "Anna" — got: ${top}`);
    } else {
      log('  Top-Match enthält "Anna" ✓ (E5-Prefix wirkt)');
    }
  }

  banner("TEST 2.7 — leeres Input-Array → leeres Output-Array");
  const emptyOut = await provider.embed([], { inputType: "passage" });
  if (emptyOut.length !== 0) {
    issues += 1;
    log("  ⚠ embed([]) sollte [] zurückgeben.");
  } else {
    log("  embed([]) = [] ✓");
  }

  return issues;
}

// ─── PHASE 3: External Provider (Live-API, optional) ────────────────────────

async function runOptionalExternalTests(): Promise<number> {
  let issues = 0;
  const openaiKey = process.env.OPENAI_API_KEY?.trim();
  const voyageKey = process.env.VOYAGE_API_KEY?.trim();

  banner("TEST 3.1 — OpenAI live (skip wenn kein API-Key)");
  if (!openaiKey || openaiKey.startsWith("sk-dummy")) {
    log("  ⊘ kein echter OPENAI_API_KEY — übersprungen");
  } else {
    try {
      const p = new OpenAIEmbeddingProvider({ apiKey: openaiKey });
      const [emb] = await p.embed("Test", { inputType: "passage" });
      if (!emb || emb.length !== p.dimensions) {
        issues += 1;
        log(`  ⚠ falsche Dimension: ${emb?.length}`);
      } else {
        log(`  OpenAI ✓ (dim=${emb.length})`);
      }
    } catch (err) {
      issues += 1;
      log(`  ⚠ OpenAI-Live-Call geworfen: ${err instanceof Error ? err.message : err}`);
    }
  }

  banner("TEST 3.2 — Voyage live (skip wenn kein API-Key)");
  if (!voyageKey || voyageKey.startsWith("pa-dummy")) {
    log("  ⊘ kein echter VOYAGE_API_KEY — übersprungen");
  } else {
    try {
      const p = new VoyageEmbeddingProvider({ apiKey: voyageKey });
      const [emb] = await p.embed("Test", { inputType: "passage" });
      if (!emb || emb.length !== p.dimensions) {
        issues += 1;
        log(`  ⚠ falsche Dimension: ${emb?.length}`);
      } else {
        log(`  Voyage ✓ (dim=${emb.length})`);
      }
    } catch (err) {
      issues += 1;
      log(`  ⚠ Voyage-Live-Call geworfen: ${err instanceof Error ? err.message : err}`);
    }
  }

  return issues;
}

// ─── helpers ────────────────────────────────────────────────────────────────

function dotProduct(a: Float32Array, b: Float32Array): number {
  let s = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const av = a.at(i) ?? 0;
    const bv = b.at(i) ?? 0;
    s += av * bv;
  }
  return s;
}

function banner(title: string) {
  const line = "─".repeat(72);
  console.log(`\n${line}\n  ${title}\n${line}`);
}

function log(msg: string) {
  console.log(msg);
}

main().catch((err) => {
  console.error(
    "\n[embedding-providers:test] Fehler:",
    err instanceof Error ? err.stack ?? err.message : err,
  );
  process.exit(1);
});
