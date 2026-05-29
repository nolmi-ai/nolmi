import "dotenv/config";
import Database from "better-sqlite3";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { nanoid } from "nanoid";
import { loadRuntimeConfig } from "../config.js";
import { ConversationSummariesRepo } from "../conversations/summaries-repo.js";
import { FactsRepo } from "../facts/repo.js";

// ─── TEST: MEMORY-REPOS (Phase 3.3 Sub-Schritt A) ───────────────────────────
//
// Verifiziert ConversationSummariesRepo + FactsRepo gegen eine frische
// In-Memory-DB. Migrations laden wir aus dem migrations-Ordner und führen
// sie alle aus — damit ist die DB-Topologie 1:1 wie in Production.
//
// Fixtures legen wir manuell: ein Twin-Profil, ein User, eine Konversation,
// zwei Audits. Die echte DB wird nicht angefasst — :memory: stirbt am
// Ende des Skripts ohne Spuren.
//
// Aufruf:
//   pnpm --filter @nolmi/runtime test-memory-repos

async function main() {
  const db = new Database(":memory:");
  db.pragma("journal_mode = MEMORY");
  db.pragma("foreign_keys = ON");

  // Migrations laden — gleicher Mechanismus wie init-db.ts. Wir vereinfachen
  // das Tracking weg (in :memory: gibt's keine Re-Runs).
  const config = loadRuntimeConfig();
  const files = readdirSync(config.migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  for (const file of files) {
    const sql = readFileSync(resolve(config.migrationsDir, file), "utf-8");
    db.exec(sql);
  }
  log(`Migrations geladen: ${files.length}`);

  // Fixtures: User → Twin-Profil → Conversation → zwei Audits. So sind
  // die Foreign-Keys aus 013 + 014 erfüllbar.
  const fixtures = createFixtures(db);
  log(`Fixtures: user=${fixtures.userId} twin=${fixtures.twinId} conv=${fixtures.conversationId}`);
  log(`Audits:   ${fixtures.auditA} ${fixtures.auditB}`);

  let issues = 0;

  // ─── TEST 1: ConversationSummariesRepo ────────────────────────────────────
  issues += runSummariesTests(db, fixtures);

  // ─── TEST 2: FactsRepo ────────────────────────────────────────────────────
  issues += await runFactsTests(db);

  banner("ZUSAMMENFASSUNG");
  if (issues === 0) {
    log("✓ alle Tests grün");
  } else {
    log(`✗ ${issues} Issue(s) — Details oben.`);
  }

  db.close();
  if (issues > 0) process.exit(2);
}

// ─── TEST 1: ConversationSummariesRepo ──────────────────────────────────────

function runSummariesTests(
  db: Database.Database,
  fx: Fixtures,
): number {
  const repo = new ConversationSummariesRepo(db);
  let issues = 0;

  banner("TEST 1.1 — insert() erste Summary");
  const first = repo.insert({
    conversationId: fx.conversationId,
    segmentStartAuditId: fx.auditA,
    segmentEndAuditId: fx.auditA,
    segmentMessageCount: 2,
    summaryMd: "## Summary 1\nErste Frage zum Workshop, Antwort gegeben.",
  });
  log(`  id:                    ${first.id}`);
  log(`  segmentMessageCount:   ${first.segmentMessageCount}`);
  if (!first.id.startsWith("summary_")) {
    issues += 1;
    log("  ⚠ id-Präfix unerwartet.");
  }
  if (first.conversationId !== fx.conversationId) {
    issues += 1;
    log("  ⚠ conversationId stimmt nicht.");
  }
  if (first.createdAt === "") {
    issues += 1;
    log("  ⚠ createdAt nicht gesetzt.");
  }

  banner("TEST 1.2 — listByConversation() liefert 1 Eintrag");
  const afterFirst = repo.listByConversation(fx.conversationId);
  if (afterFirst.length !== 1) {
    issues += 1;
    log(`  ⚠ erwartet 1, gefunden ${afterFirst.length}.`);
  } else {
    log(`  count: ${afterFirst.length}`);
  }
  if (repo.count(fx.conversationId) !== 1) {
    issues += 1;
    log("  ⚠ count() inkonsistent mit listByConversation().");
  }

  banner("TEST 1.3 — zweite Summary, Sortierung chronologisch");
  // Zweiter Audit hat eine ID, die lexikographisch GRÖSSER ist als der erste
  // (createFixtures garantiert das via Suffix). Damit ist die Reihenfolge im
  // Repo deterministisch.
  const second = repo.insert({
    conversationId: fx.conversationId,
    segmentStartAuditId: fx.auditB,
    segmentEndAuditId: fx.auditB,
    segmentMessageCount: 3,
    summaryMd: "## Summary 2\nFolgegespräch, Termin vereinbart.",
  });
  const both = repo.listByConversation(fx.conversationId);
  if (both.length !== 2) {
    issues += 1;
    log(`  ⚠ erwartet 2, gefunden ${both.length}.`);
  }
  if (both[0]?.id !== first.id || both[1]?.id !== second.id) {
    issues += 1;
    log("  ⚠ Sortierung falsch — älteres Segment sollte zuerst kommen.");
  } else {
    log("  Sortierung chronologisch ✓");
  }

  banner("TEST 1.4 — CASCADE-Delete via conversation_id");
  // Konversation hart löschen → Summaries müssen automatisch verschwinden.
  db.prepare("DELETE FROM conversations WHERE id = ?").run(fx.conversationId);
  const afterCascade = repo.listByConversation(fx.conversationId);
  if (afterCascade.length !== 0) {
    issues += 1;
    log(`  ⚠ CASCADE-Delete: erwartet 0, gefunden ${afterCascade.length}.`);
  } else {
    log("  CASCADE-Delete greift ✓");
  }

  banner("TEST 1.5 — deleteByConversation() Cleanup-Helper");
  // Neue Konversation + Summary für den Test des manuellen Cleanups.
  const conv2 = `conv_${nanoid(16)}`;
  db.prepare(
    `INSERT INTO conversations (id, owner_user_id, partner_handle, twin_id, status, started_at, ended_at)
     VALUES (?, ?, ?, ?, 'active', ?, NULL)`,
  ).run(conv2, fx.userId, "@_test-summary-partner", fx.twinId, new Date().toISOString());
  repo.insert({
    conversationId: conv2,
    segmentStartAuditId: fx.auditA,
    segmentEndAuditId: fx.auditB,
    segmentMessageCount: 5,
    summaryMd: "## Summary X",
  });
  const removed = repo.deleteByConversation(conv2);
  if (removed !== 1) {
    issues += 1;
    log(`  ⚠ deleteByConversation: erwartet 1 removed, gefunden ${removed}.`);
  } else {
    log("  deleteByConversation entfernt 1 ✓");
  }
  // Cleanup
  db.prepare("DELETE FROM conversations WHERE id = ?").run(conv2);

  return issues;
}

// ─── TEST 2: FactsRepo ──────────────────────────────────────────────────────

async function runFactsTests(db: Database.Database): Promise<number> {
  const repo = new FactsRepo(db);
  let issues = 0;

  // Zwei Twins anlegen, damit Multi-Twin-Isolation testbar ist. Das in
  // createFixtures angelegte Twin nutzen wir nicht direkt, weil seine
  // Konversation in TEST 1.4 schon gelöscht wurde (CASCADE-Test) — frische
  // Twins für klare Trennung.
  const twinA = createTwinProfile(db, "@_test-twin-a", "Test Twin A");
  const twinB = createTwinProfile(db, "@_test-twin-b", "Test Twin B");
  log(`Twins: A=${twinA} B=${twinB}`);

  banner("TEST 2.1 — upsert() erstes Fakt");
  const factA1 = repo.upsert({
    twinId: twinA,
    factKey: "wife_name",
    factValue: "Anna",
    source: "user",
    confidence: "approved",
  });
  log(`  id:        ${factA1.id}`);
  log(`  factValue: ${factA1.factValue}`);
  log(`  source:    ${factA1.source}`);
  if (!factA1.id.startsWith("fact_")) {
    issues += 1;
    log("  ⚠ id-Präfix unerwartet.");
  }
  if (factA1.factValue !== "Anna") {
    issues += 1;
    log("  ⚠ factValue stimmt nicht.");
  }

  banner("TEST 2.2 — get() findet den Fakt");
  const fetched = repo.get(twinA, "wife_name");
  if (!fetched || fetched.factValue !== "Anna") {
    issues += 1;
    log("  ⚠ get() liefert nicht den erwarteten Fakt.");
  } else {
    log(`  gefunden: ${fetched.factKey}=${fetched.factValue}`);
  }

  banner("TEST 2.3 — upsert() gleicher Key → UPDATE, updated_at neuer");
  // Kleiner Delay, damit updated_at sich messbar unterscheiden kann.
  // ISO-Strings haben ms-Granularität — 50 ms reichen, ohne den Test-Lauf
  // spürbar zu bremsen.
  await sleep(50);
  const factA1b = repo.upsert({
    twinId: twinA,
    factKey: "wife_name",
    factValue: "Sabine",
    source: "user",
    confidence: "approved",
  });
  if (factA1b.id !== factA1.id) {
    issues += 1;
    log("  ⚠ id sollte nach UPDATE gleich bleiben.");
  }
  if (factA1b.factValue !== "Sabine") {
    issues += 1;
    log("  ⚠ factValue nicht aktualisiert.");
  }
  if (factA1b.createdAt !== factA1.createdAt) {
    issues += 1;
    log("  ⚠ createdAt sollte nach UPDATE unverändert bleiben.");
  }
  if (factA1b.updatedAt <= factA1.updatedAt) {
    issues += 1;
    log(`  ⚠ updatedAt sollte nach UPDATE neuer sein (alt=${factA1.updatedAt} neu=${factA1b.updatedAt}).`);
  } else {
    log("  UPDATE-Semantik ✓ (id stabil, value neu, updated_at neuer)");
  }

  banner("TEST 2.4 — listByTwin() alphabetisch sortiert");
  repo.upsert({
    twinId: twinA,
    factKey: "company",
    factValue: "Harway Experience",
    source: "user",
    confidence: "approved",
  });
  repo.upsert({
    twinId: twinA,
    factKey: "birthday",
    factValue: "1985-03-14",
    source: "user",
    confidence: "approved",
  });
  const listA = repo.listByTwin(twinA);
  log(`  count: ${listA.length}`);
  const keys = listA.map((f) => f.factKey);
  const expected = ["birthday", "company", "wife_name"];
  if (JSON.stringify(keys) !== JSON.stringify(expected)) {
    issues += 1;
    log(`  ⚠ Sortierung falsch — erwartet ${JSON.stringify(expected)}, got ${JSON.stringify(keys)}.`);
  } else {
    log(`  Sortierung alphabetisch ✓ (${keys.join(", ")})`);
  }

  banner("TEST 2.5 — onlyApproved filtert pending raus");
  repo.upsert({
    twinId: twinA,
    factKey: "tentative_hobby",
    factValue: "Klettern",
    source: "twin",
    confidence: "pending",
  });
  const all = repo.listByTwin(twinA);
  const approvedOnly = repo.listByTwin(twinA, { onlyApproved: true });
  if (all.length !== 4) {
    issues += 1;
    log(`  ⚠ all: erwartet 4, gefunden ${all.length}.`);
  }
  if (approvedOnly.length !== 3) {
    issues += 1;
    log(`  ⚠ approvedOnly: erwartet 3, gefunden ${approvedOnly.length}.`);
  }
  if (approvedOnly.some((f) => f.confidence !== "approved")) {
    issues += 1;
    log("  ⚠ approvedOnly enthält nicht-approved Fakten.");
  } else {
    log("  onlyApproved-Filter greift ✓");
  }

  banner("TEST 2.6 — delete() entfernt + returnt true/false korrekt");
  const removedTrue = repo.delete(twinA, "tentative_hobby");
  if (!removedTrue) {
    issues += 1;
    log("  ⚠ delete() sollte true zurückgeben.");
  }
  const removedFalse = repo.delete(twinA, "does-not-exist");
  if (removedFalse) {
    issues += 1;
    log("  ⚠ delete() auf nicht-existenten Key sollte false zurückgeben.");
  } else {
    log("  delete-Semantik ✓");
  }

  banner("TEST 2.7 — Multi-Twin-Isolation");
  repo.upsert({
    twinId: twinB,
    factKey: "wife_name",
    factValue: "Mara",
    source: "user",
    confidence: "approved",
  });
  // twinA hat wife_name="Sabine", twinB hat wife_name="Mara" — UNIQUE
  // gilt nur PRO twin_id.
  const fromA = repo.get(twinA, "wife_name");
  const fromB = repo.get(twinB, "wife_name");
  if (fromA?.factValue !== "Sabine" || fromB?.factValue !== "Mara") {
    issues += 1;
    log(`  ⚠ Isolation gebrochen — A=${fromA?.factValue} B=${fromB?.factValue}.`);
  } else {
    log(`  Isolation ✓ (A.wife_name=Sabine, B.wife_name=Mara)`);
  }
  if (repo.count(twinB) !== 1) {
    issues += 1;
    log(`  ⚠ count(twinB): erwartet 1, gefunden ${repo.count(twinB)}.`);
  }

  banner("TEST 2.8 — count()");
  const countA = repo.count(twinA);
  if (countA !== 3) {
    issues += 1;
    log(`  ⚠ count(twinA): erwartet 3, gefunden ${countA}.`);
  } else {
    log(`  count(twinA)=${countA} ✓`);
  }

  return issues;
}

// ─── FIXTURES ────────────────────────────────────────────────────────────────

interface Fixtures {
  userId: string;
  twinId: string;
  conversationId: string;
  auditA: string;
  auditB: string;
}

function createFixtures(db: Database.Database): Fixtures {
  const now = new Date().toISOString();
  const userId = `user_${nanoid(16)}`;
  const twinId = `twin_${nanoid(16)}`;
  const conversationId = `conv_${nanoid(16)}`;

  // Minimal-User (users-Schema aus Migration 005 — wir setzen nur die
  // Pflicht-Felder; Repo-Logik testen wir hier nicht).
  db.prepare(
    `INSERT INTO users (user_id, email, password_hash, display_name, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(
    userId,
    `${nanoid(8)}@test.invalid`,
    "x",
    "Test Owner",
    now,
    now,
  );

  // Twin-Profil (twin_profiles-Schema aus Migration 002 + 004) — der echte
  // TwinProfilesRepo verschlüsselt API-Keys; wir umgehen das hier mit
  // INSERT direkt, weil wir keinen Master-Key brauchen für den Repo-Test.
  // created_at/updated_at sind hier INTEGER (epoch ms) im Unterschied zu
  // anderen Tabellen, die ISO-Strings verwenden.
  const nowMs = Date.now();
  db.prepare(
    `INSERT INTO twin_profiles (
       twin_id, handle, display_name, persona_md, mandates_json,
       llm_config, bridge_url, bridge_token,
       owner_user_id, is_active, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
  ).run(
    twinId,
    `@_test-${nanoid(6)}`,
    "Test Twin",
    "# Persona\n",
    "[]",
    JSON.stringify({
      provider: "openai",
      model: "gpt-4o-mini",
      apiKeyEncrypted: "x",
      apiKeySource: "user",
    }),
    "http://127.0.0.1:5100",
    "test-token",
    userId,
    nowMs,
    nowMs,
  );

  // Conversation (Schema aus Migration 009)
  db.prepare(
    `INSERT INTO conversations (id, owner_user_id, partner_handle, twin_id, status, started_at, ended_at)
     VALUES (?, ?, ?, ?, 'active', ?, NULL)`,
  ).run(conversationId, userId, "@_test-partner", twinId, now);

  // Zwei Audit-Rows mit lexikographisch aufsteigenden IDs (Suffix-Counter),
  // damit Sortierung in TEST 1.3 deterministisch ist. Die echten Audit-IDs
  // haben kein garantiertes Ordering; für den Test reicht uns ein
  // dokumentiertes Aufsteigen.
  const auditA = `audit_aaa_${nanoid(8)}`;
  const auditB = `audit_bbb_${nanoid(8)}`;
  for (const [id, capability] of [
    [auditA, "owner-direct"],
    [auditB, "owner-direct"],
  ]) {
    db.prepare(
      `INSERT INTO audit
         (id, timestamp, capability, mandate_id, status, data, twin_id, conversation_id)
       VALUES (?, ?, ?, NULL, 'executed', '{}', ?, ?)`,
    ).run(id, now, capability, twinId, conversationId);
  }

  return { userId, twinId, conversationId, auditA, auditB };
}

function createTwinProfile(
  db: Database.Database,
  handleBase: string,
  displayName: string,
): string {
  const twinId = `twin_${nanoid(16)}`;
  // Owner-User für FK-Erfüllung — wir leihen uns den ersten verfügbaren User.
  const ownerRow = db
    .prepare("SELECT user_id FROM users LIMIT 1")
    .get() as { user_id: string } | undefined;
  if (!ownerRow) throw new Error("createTwinProfile: kein User in Fixtures");

  const nowMs = Date.now();
  db.prepare(
    `INSERT INTO twin_profiles (
       twin_id, handle, display_name, persona_md, mandates_json,
       llm_config, bridge_url, bridge_token,
       owner_user_id, is_active, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
  ).run(
    twinId,
    `${handleBase}-${nanoid(4)}`,
    displayName,
    "# Persona\n",
    "[]",
    JSON.stringify({
      provider: "openai",
      model: "gpt-4o-mini",
      apiKeyEncrypted: "x",
      apiKeySource: "user",
    }),
    "http://127.0.0.1:5100",
    "test-token",
    ownerRow.user_id,
    nowMs,
    nowMs,
  );
  return twinId;
}

// ─── helpers ─────────────────────────────────────────────────────────────────

function banner(title: string) {
  const line = "─".repeat(72);
  console.log(`\n${line}\n  ${title}\n${line}`);
}

function log(msg: string) {
  console.log(msg);
}

function sleep(ms: number): Promise<void> {
  // Param `done` statt `resolve`, weil oben `resolve` aus node:path im Scope ist.
  return new Promise((done) => setTimeout(done, ms));
}

main().catch((err) => {
  console.error(
    "\n[memory-repos:test] Fehler:",
    err instanceof Error ? err.message : err,
  );
  process.exit(1);
});
