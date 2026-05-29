import "dotenv/config";
import Database from "better-sqlite3";
import { loadRuntimeConfig } from "../config.js";
import { TwinProfilesRepo } from "../twin-profiles-repo.js";
import {
  ConversationNotFoundError,
  ConversationsRepo,
} from "../conversations/repo.js";

// ─── TEST: CONVERSATIONS-REPO (#71b + #80 Sub-Schritt A) ────────────────────
//
// Schema-Test gegen die lokale DB. Nimmt einen existierenden Twin (default
// @markus) plus seinen Owner-User. Partner ist ein synthetischer Test-Handle,
// damit echte Konversationen nicht angefasst werden. Cleanup am Ende löscht
// die Test-Rows hart per DELETE — `end()` setzt nur status='ended', würde
// also Test-Rückstände in der DB hinterlassen.
//
// Voraussetzung: pnpm db:init lief (Migration 009 angewendet) und der
// Ziel-Twin existiert in twin_profiles mit gesetztem ownerUserId.
//
// Aufruf:
//   pnpm --filter @nolmi/runtime tsx src/scripts/test-conversations-repo.ts
//   pnpm --filter @nolmi/runtime tsx src/scripts/test-conversations-repo.ts @florian

const TWIN_HANDLE_DEFAULT = "@markus";
const TEST_PARTNER = "@_test-conversations-partner";

async function main() {
  const handle = (process.argv[2] ?? TWIN_HANDLE_DEFAULT).toLowerCase();

  const config = loadRuntimeConfig();
  const db = new Database(config.dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  const profilesRepo = new TwinProfilesRepo(db);
  const repo = new ConversationsRepo(db);

  const profile = profilesRepo.findByHandle(handle);
  if (!profile) {
    throw new Error(`Twin '${handle}' nicht in DB.`);
  }
  if (!profile.ownerUserId) {
    throw new Error(
      `Twin '${handle}' hat keinen ownerUserId — bitte zuerst onboarden.`,
    );
  }

  log(`Test-Twin:   ${profile.handle} (${profile.twinId})`);
  log(`Owner-User:  ${profile.ownerUserId}`);
  log(`Partner:     ${TEST_PARTNER}`);

  // Reset: falls ein Vor-Lauf hängengebliebene Test-Rows hinterlassen hat.
  cleanup(db, profile.ownerUserId, TEST_PARTNER, profile.twinId);

  let issues = 0;

  // ─── STEP 1: start() ohne existierende aktive ──────────────────────────────
  banner("STEP 1 — start() ohne existierende aktive");
  const first = repo.start({
    ownerUserId: profile.ownerUserId,
    partnerHandle: TEST_PARTNER,
    twinId: profile.twinId,
  });
  log(`  id:        ${first.id}`);
  log(`  status:    ${first.status}`);
  log(`  startedAt: ${first.startedAt}`);
  if (!first.id.startsWith("conv_")) {
    issues += 1;
    log(`  ⚠ id-Präfix unerwartet.`);
  }
  if (first.status !== "active") {
    issues += 1;
    log(`  ⚠ status nicht active.`);
  }
  if (first.endedAt !== null) {
    issues += 1;
    log(`  ⚠ endedAt sollte null sein.`);
  }

  // ─── STEP 2: findActive() findet sie ──────────────────────────────────────
  banner("STEP 2 — findActive()");
  const found = repo.findActive(profile.ownerUserId, TEST_PARTNER, profile.twinId);
  if (!found || found.id !== first.id) {
    issues += 1;
    log(`  ⚠ findActive liefert nicht die erwartete Konversation.`);
  } else {
    log(`  gefunden: ${found.id}`);
  }

  // ─── STEP 3: list() returns 1 ─────────────────────────────────────────────
  banner("STEP 3 — list() (1 Eintrag)");
  const listAfterFirst = repo.list(profile.ownerUserId, TEST_PARTNER, profile.twinId);
  log(`  count: ${listAfterFirst.length}`);
  if (listAfterFirst.length !== 1) {
    issues += 1;
    log(`  ⚠ erwartet 1, gefunden ${listAfterFirst.length}.`);
  }

  // ─── STEP 4: zweites start() — alte ended, neue active ────────────────────
  banner("STEP 4 — zweites start() (alte → ended, neue → active)");
  const second = repo.start({
    ownerUserId: profile.ownerUserId,
    partnerHandle: TEST_PARTNER,
    twinId: profile.twinId,
  });
  log(`  neue id: ${second.id}`);
  const oldReloaded = repo.findById(first.id);
  log(`  alte status: ${oldReloaded.status}, endedAt: ${oldReloaded.endedAt}`);
  if (oldReloaded.status !== "ended") {
    issues += 1;
    log(`  ⚠ alte Konversation wurde nicht beendet.`);
  }
  if (oldReloaded.endedAt === null) {
    issues += 1;
    log(`  ⚠ alte Konversation hat kein endedAt.`);
  }
  if (second.status !== "active") {
    issues += 1;
    log(`  ⚠ neue Konversation ist nicht active.`);
  }

  // ─── STEP 5: findActive() returns nur neue ────────────────────────────────
  banner("STEP 5 — findActive() (nur neue)");
  const activeNow = repo.findActive(profile.ownerUserId, TEST_PARTNER, profile.twinId);
  if (!activeNow || activeNow.id !== second.id) {
    issues += 1;
    log(`  ⚠ findActive liefert nicht die neue Konversation.`);
  } else {
    log(`  gefunden: ${activeNow.id}`);
  }

  // ─── STEP 6: list() returns 2, neueste zuerst ─────────────────────────────
  banner("STEP 6 — list() (2 Einträge, neueste zuerst)");
  const listAfterSecond = repo.list(profile.ownerUserId, TEST_PARTNER, profile.twinId);
  log(`  count: ${listAfterSecond.length}`);
  if (listAfterSecond.length !== 2) {
    issues += 1;
    log(`  ⚠ erwartet 2, gefunden ${listAfterSecond.length}.`);
  }
  if (listAfterSecond[0]?.id !== second.id) {
    issues += 1;
    log(`  ⚠ Sortierung falsch — neueste sollte zuerst kommen.`);
  }

  // ─── STEP 7: end() der aktiven ────────────────────────────────────────────
  banner("STEP 7 — end() der aktiven");
  repo.end(second.id);
  const noActive = repo.findActive(profile.ownerUserId, TEST_PARTNER, profile.twinId);
  if (noActive !== null) {
    issues += 1;
    log(`  ⚠ findActive sollte nach end() null liefern.`);
  } else {
    log(`  findActive: null ✓`);
  }
  const listAfterEnd = repo.list(profile.ownerUserId, TEST_PARTNER, profile.twinId);
  const endedCount = listAfterEnd.filter((c) => c.status === "ended").length;
  log(`  list: ${listAfterEnd.length} total, ${endedCount} ended`);
  if (listAfterEnd.length !== 2 || endedCount !== 2) {
    issues += 1;
    log(`  ⚠ erwartet 2 ended-Einträge, gefunden ${endedCount}.`);
  }

  // ─── STEP 8: end() einer schon ended Konversation → idempotent ────────────
  banner("STEP 8 — end() idempotent");
  let threwOnSecondEnd = false;
  try {
    repo.end(second.id);
  } catch {
    threwOnSecondEnd = true;
  }
  if (threwOnSecondEnd) {
    issues += 1;
    log(`  ⚠ end() auf bereits ended Konversation hat geworfen.`);
  } else {
    log(`  end() erneut: kein Fehler ✓`);
  }

  // Zusatzcheck: end() auf nicht-existierende ID wirft korrekt.
  let threwOnUnknown = false;
  try {
    repo.end("conv_does-not-exist");
  } catch (err) {
    if (err instanceof ConversationNotFoundError) {
      threwOnUnknown = true;
    }
  }
  if (!threwOnUnknown) {
    issues += 1;
    log(`  ⚠ end() auf unbekannte ID hätte ConversationNotFoundError werfen müssen.`);
  } else {
    log(`  end() auf unbekannte ID wirft ConversationNotFoundError ✓`);
  }

  // ─── STEP 9: Cleanup ──────────────────────────────────────────────────────
  banner("STEP 9 — Cleanup");
  cleanup(db, profile.ownerUserId, TEST_PARTNER, profile.twinId);
  const after = repo.list(profile.ownerUserId, TEST_PARTNER, profile.twinId);
  log(`  nach Cleanup: ${after.length} Einträge (erwartet 0)`);
  if (after.length !== 0) {
    issues += 1;
  }

  banner("ZUSAMMENFASSUNG");
  if (issues === 0) {
    log("✓ alle Tests grün");
  } else {
    log(`✗ ${issues} Issue(s) — Details oben.`);
  }

  db.close();
  if (issues > 0) process.exit(2);
}

function banner(title: string) {
  const line = "─".repeat(72);
  console.log(`\n${line}\n  ${title}\n${line}`);
}

function log(msg: string) {
  console.log(msg);
}

function cleanup(
  db: Database.Database,
  ownerUserId: string,
  partnerHandle: string,
  twinId: string,
) {
  db.prepare(
    `DELETE FROM conversations
       WHERE owner_user_id = ?
         AND partner_handle = ?
         AND twin_id = ?`,
  ).run(ownerUserId, partnerHandle, twinId);
}

main().catch((err) => {
  console.error(
    "\n[conversations:test] Fehler:",
    err instanceof Error ? err.message : err,
  );
  process.exit(1);
});
