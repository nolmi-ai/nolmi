import Database from "better-sqlite3";
import { TelegramMessagesRepo } from "../telegram/messages-repo.js";

// ─── TEST: TELEGRAM-MESSAGE-INSERT IDEMPOTENZ (#130 Alt-Bug-Fix) ─────────────
//
// Behavior-Level-Beweis, dass ein doppelter insert() mit identischem
// UNIQUE-Tripel (twin_id, telegram_chat_id, telegram_message_id) bei
// Telegram-Redelivery NICHT mehr am UNIQUE-Constraint scheitert, sondern
// die existierende Row zurückgibt (ON CONFLICT DO NOTHING).
//
// Self-contained: In-Memory-DB mit minimalem telegram_messages-Schema
// (FKs ausgelassen — wir testen nur die Insert-Idempotenz, nicht die
// Cross-Channel-Verlinkung). Keine echte DB, kein Master-Key, kein Twin nötig.
//
// Aufruf:
//   pnpm --filter @nolmi/runtime tsx src/scripts/test-telegram-insert-idempotent.ts

// Schema-Auszug aus migrations/024_telegram_adapter.sql — ohne FK-REFERENCES,
// damit der Test ohne twin_profiles/conversations läuft. UNIQUE-Tripel
// (die getestete Invariante) bleibt 1:1 erhalten.
const SCHEMA = `
  CREATE TABLE telegram_messages (
    id                   TEXT PRIMARY KEY NOT NULL,
    twin_id              TEXT NOT NULL,
    telegram_chat_id     INTEGER NOT NULL,
    telegram_message_id  INTEGER NOT NULL,
    conversation_id      TEXT,
    direction            TEXT NOT NULL CHECK (direction IN ('inbound', 'outbound')),
    text                 TEXT NOT NULL,
    sent_at              TEXT NOT NULL,
    UNIQUE(twin_id, telegram_chat_id, telegram_message_id)
  );
`;

let failures = 0;

function assert(cond: boolean, label: string): void {
  if (cond) {
    console.log(`  ✓ ${label}`);
  } else {
    console.error(`  ✗ FAIL: ${label}`);
    failures += 1;
  }
}

function main(): void {
  const db = new Database(":memory:");
  db.exec(SCHEMA);
  const repo = new TelegramMessagesRepo(db);

  const base = {
    twin_id: "twin_test",
    telegram_chat_id: 4242,
    direction: "inbound" as const,
  };

  // ── a) Erst-Insert (frische message_id): Row geschrieben + zurückgegeben ──
  console.log("\n── a) Erst-Insert (frische message_id)");
  const first = repo.insert({ ...base, telegram_message_id: 100, text: "hallo" });
  assert(first.id.startsWith("tg_msg_"), "Row mit generierter id zurückgegeben");
  assert(first.telegram_message_id === 100, "message_id korrekt");
  assert(first.text === "hallo", "text korrekt");
  const countAfterFirst = db
    .prepare(`SELECT COUNT(*) AS n FROM telegram_messages`)
    .get() as { n: number };
  assert(countAfterFirst.n === 1, "genau 1 Row in der Tabelle");

  // ── b) KERN: Zweiter Insert mit IDENTISCHEM Tripel (Telegram-Redelivery) ──
  console.log("\n── b) KERN: Re-Insert identisches Tripel (Redelivery)");
  let threw = false;
  let second: ReturnType<typeof repo.insert> | null = null;
  try {
    // Anderer text/id-Wunsch, aber identisches UNIQUE-Tripel — wie es bei
    // einem redelivered Update mit derselben message_id passiert.
    second = repo.insert({
      ...base,
      telegram_message_id: 100,
      text: "hallo (redelivery)",
    });
  } catch (err) {
    threw = true;
    console.error(`  (unerwarteter Throw: ${(err as Error).message})`);
  }
  assert(!threw, "KEIN Throw mehr bei doppeltem Insert");
  assert(second !== null, "Row zurückgegeben statt Exception");
  assert(second?.id === first.id, "existierende Row (gleiche id) zurückgegeben");
  assert(
    second?.text === "hallo",
    "Original-Row unverändert (DO NOTHING — kein Overwrite)",
  );
  const countAfterSecond = db
    .prepare(`SELECT COUNT(*) AS n FROM telegram_messages`)
    .get() as { n: number };
  assert(countAfterSecond.n === 1, "weiterhin genau 1 Row (dedupliziert)");

  // ── c) Outbound-Insert (andere message_id) unverändert funktionsfähig ──
  console.log("\n── c) Outbound-Insert (andere message_id)");
  const outbound = repo.insert({
    twin_id: base.twin_id,
    telegram_chat_id: base.telegram_chat_id,
    telegram_message_id: 101,
    direction: "outbound",
    text: "antwort",
  });
  assert(outbound.direction === "outbound", "outbound-Row geschrieben");
  assert(outbound.telegram_message_id === 101, "neue message_id eingefügt");
  const countAfterOutbound = db
    .prepare(`SELECT COUNT(*) AS n FROM telegram_messages`)
    .get() as { n: number };
  assert(countAfterOutbound.n === 2, "jetzt 2 Rows (inbound + outbound)");

  db.close();

  console.log(
    failures === 0
      ? "\n✅ ALLE CHECKS GRÜN — Insert ist idempotent, Redelivery dedupt.\n"
      : `\n❌ ${failures} CHECK(S) FEHLGESCHLAGEN.\n`,
  );
  if (failures > 0) process.exit(1);
}

main();
