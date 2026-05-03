import "dotenv/config";
import Database from "better-sqlite3";
import { setTimeout as sleep } from "node:timers/promises";
import type { AuditEntry } from "@twin-lab/shared";
import { loadRuntimeConfig } from "../config.js";
import { TwinProfilesRepo } from "../twin-profiles-repo.js";
import { TrustRepo } from "../trust/trust-repo.js";
import { BridgeClient } from "../bridge/client.js";
import { createSqliteRepository } from "../repository/index.js";

// ─── TEST: TRUST-FLOW ───────────────────────────────────────────────────────
//
// End-to-End-Skript für Phase 2.5.4.1 (+ 2.5.4.1.1 Loop-Fix).
//
// Schickt drei Bridge-Nachrichten von @florian an @markus und beobachtet das
// Audit-Log auf BEIDEN Seiten:
//
//   STEP 1 (BEFORE TRUST):    External-Pfad
//                             - Markus: pending + system-message (gesendet)
//                             - Florian: system-message-received (Wartemeldung)
//   STEP 2 (TRUST ADD):       TrustRepo.add(markus, @florian)
//   STEP 3 (AFTER TRUST):     Trusted-Bypass
//                             - Markus: trusted-bypass executed
//                             - Florian: respond_to_twin_message (echte Antwort)
//   STEP 4 (TRUST REMOVE):    TrustRepo.remove(markus, @florian)
//   STEP 5 (AFTER REMOVE):    External-Pfad (wie Step 1)
//
// Loop-Detection: Vor jedem Step zählen wir die Audit-Einträge auf beiden
// Seiten, danach erneut. Differenz darf STEP_MAX_DELTA nicht überschreiten —
// sonst hat sich die Wartemeldung wieder selbst beantwortet (Bug aus 2.5.4.1).
//
// Voraussetzung: pnpm dev läuft (Bridge UND Runtime). Beide Twins müssen in
// der DB als aktiv stehen, beide Bridge-Streams angeschlossen.
//
// Aufruf:
//   pnpm --filter @twin-lab/runtime trust:test
//   pnpm --filter @twin-lab/runtime trust:test @markus @florian

const RECEIVER_DEFAULT = "@markus";
const SENDER_DEFAULT = "@florian";
const POLL_TIMEOUT_MS = 12_000;
const POLL_INTERVAL_MS = 500;
// Wie viele neue Audit-Einträge pro Step plausibel sind. Bei einem Loop wie
// in 2.5.4.1 wären es schnell zweistellige Werte pro Sekunde.
const STEP_MAX_DELTA_EXTERNAL = 5;
const STEP_MAX_DELTA_TRUSTED = 3;
// Settling: nach Send + waitForAudit nochmal kurz warten, damit die System-
// Message + system-message-received-Roundtrip ankommen.
const SETTLE_MS = 1500;

async function main() {
  const receiverHandle = (process.argv[2] ?? RECEIVER_DEFAULT).toLowerCase();
  const senderHandle = (process.argv[3] ?? SENDER_DEFAULT).toLowerCase();

  const config = loadRuntimeConfig();
  const db = new Database(config.dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  const profilesRepo = new TwinProfilesRepo(db);
  const trustRepo = new TrustRepo(db);
  const repo = createSqliteRepository(config.dbPath);

  const receiver = profilesRepo.findByHandle(receiverHandle);
  const sender = profilesRepo.findByHandle(senderHandle);

  if (!receiver) throw new Error(`Receiver '${receiverHandle}' nicht in DB`);
  if (!sender) throw new Error(`Sender '${senderHandle}' nicht in DB`);
  if (!receiver.ownerUserId) {
    throw new Error(
      `Receiver '${receiverHandle}' hat keinen owner_user_id — bitte zuerst ` +
        `'pnpm --filter @twin-lab/runtime user:create … --assign-twin ${receiverHandle}' laufen lassen.`,
    );
  }

  banner("SETUP");
  log(`Receiver:       ${receiver.handle} (${receiver.twinId})`);
  log(`Sender:         ${sender.handle} (${sender.twinId})`);
  log(`Receiver-Owner: ${receiver.ownerUserId}`);
  log(`Bridge-URL:     ${sender.bridgeUrl}`);
  log("");

  // BridgeClient mit Sender-Token (Florian schickt aus Florians Identität).
  const senderBridge = new BridgeClient({
    url: sender.bridgeUrl,
    handle: sender.handle,
    token: sender.bridgeToken,
  });

  // Trust-Liste reset, damit das Skript reproduzierbar startet.
  removeTrustQuiet(trustRepo, receiver.twinId, sender.handle);

  // Loop-Detection: Audit-Counts vor allem festhalten.
  const baselineReceiver = await countAudits(repo.audit, receiver.twinId);
  const baselineSender = await countAudits(repo.audit, sender.twinId);
  log(`Baseline-Audit-Counts: receiver=${baselineReceiver}, sender=${baselineSender}`);
  log("");

  let issues = 0;

  // ─── STEP 1: BEFORE TRUST ─────────────────────────────────────────────────
  banner("STEP 1 — BEFORE TRUST");
  const before1Receiver = baselineReceiver;
  const before1Sender = baselineSender;
  log("Sende Test-Message von Florian an Markus (kein Trust)…");
  const msg1 = await senderBridge.sendMessage({
    to: receiver.handle,
    content: `Test 1 — Message vor Trust-Add (${nowSlug()})`,
  });
  log(`  Bridge-Msg-ID: ${msg1.messageId}`);
  const audit1 = await waitForAudit(repo.audit, receiver.twinId, msg1.messageId);
  printAudit(audit1, "External-Pfad: Mandate-Check, sollte Pending sein");
  await sleep(SETTLE_MS);
  const delta1Receiver = (await countAudits(repo.audit, receiver.twinId)) - before1Receiver;
  const delta1Sender = (await countAudits(repo.audit, sender.twinId)) - before1Sender;
  log(`  Δ Audit (receiver): ${delta1Receiver} (erwartet ≤ ${STEP_MAX_DELTA_EXTERNAL})`);
  log(`  Δ Audit (sender):   ${delta1Sender} (erwartet ≤ ${STEP_MAX_DELTA_EXTERNAL})`);
  if (delta1Receiver > STEP_MAX_DELTA_EXTERNAL || delta1Sender > STEP_MAX_DELTA_EXTERNAL) {
    issues += 1;
    log(`  ⚠ Loop-Verdacht in Step 1 — Counts zu hoch.`);
  }
  log("");

  // ─── STEP 2: TRUST ADD ────────────────────────────────────────────────────
  banner("STEP 2 — TRUST ADD");
  const trust = trustRepo.add(
    receiver.twinId,
    sender.handle,
    receiver.ownerUserId,
    "Test-Skript-Trust",
  );
  log(`  trustId:  ${trust.trustId}`);
  log(`  trusted:  ${trust.trustedHandle}`);
  log(`  isTrusted? ${trustRepo.isTrusted(receiver.twinId, sender.handle)}`);
  log("");

  // ─── STEP 3: AFTER TRUST ──────────────────────────────────────────────────
  banner("STEP 3 — AFTER TRUST");
  const before3Receiver = await countAudits(repo.audit, receiver.twinId);
  const before3Sender = await countAudits(repo.audit, sender.twinId);
  // Step3-Marker für Reply-Detection-Check in Step 6.
  const step3StartedAt = new Date().toISOString();
  log("Sende Test-Message von Florian an Markus (mit Trust)…");
  const msg2 = await senderBridge.sendMessage({
    to: receiver.handle,
    content: `Test 2 — Message nach Trust-Add (${nowSlug()})`,
  });
  log(`  Bridge-Msg-ID: ${msg2.messageId}`);
  const audit2 = await waitForAudit(repo.audit, receiver.twinId, msg2.messageId);
  printAudit(audit2, "Trusted-Bypass: capability sollte 'trusted-bypass' sein, status executed");
  await sleep(SETTLE_MS);
  const delta3Receiver = (await countAudits(repo.audit, receiver.twinId)) - before3Receiver;
  const delta3Sender = (await countAudits(repo.audit, sender.twinId)) - before3Sender;
  log(`  Δ Audit (receiver): ${delta3Receiver} (erwartet ≤ ${STEP_MAX_DELTA_TRUSTED})`);
  log(`  Δ Audit (sender):   ${delta3Sender} (erwartet ≤ ${STEP_MAX_DELTA_TRUSTED})`);
  if (delta3Receiver > STEP_MAX_DELTA_TRUSTED || delta3Sender > STEP_MAX_DELTA_TRUSTED) {
    issues += 1;
    log(`  ⚠ Loop-Verdacht in Step 3 — Counts zu hoch.`);
  }
  log("");

  // ─── STEP 4: TRUST REMOVE ─────────────────────────────────────────────────
  banner("STEP 4 — TRUST REMOVE");
  trustRepo.remove(trust.trustId);
  log(`  removed:   ${trust.trustId}`);
  log(`  isTrusted? ${trustRepo.isTrusted(receiver.twinId, sender.handle)}`);
  log("");

  // ─── STEP 3b: SENDER-SIDE REPLY-DETECTION (2.5.4.2) ───────────────────────
  // Nach Step 3 (Trusted-Bypass) hat Markus eine echte Antwort an Florian
  // geschickt (mit inReplyTo). Florians Runtime sollte das via Reply-Detection
  // als reply-received loggen — KEIN neuer respond_to_twin_message/pending.
  banner("STEP 6 — SENDER-SIDE REPLY-DETECTION");
  const senderAudits = await loadAudits(repo.audit, sender.twinId, 50);
  const senderRecent = senderAudits.filter((a) => a.timestamp > step3StartedAt);
  const replyReceived = senderRecent.filter((a) => a.capability === "reply-received");
  const newPendings = senderRecent.filter(
    (a) => a.capability === "respond_to_twin_message" && a.status === "pending",
  );
  log(`  Florian-seitige Audits seit Step 3: ${senderRecent.length}`);
  for (const a of senderRecent) {
    log(`    - ${a.capability} / ${a.status}`);
  }
  log(`  reply-received: ${replyReceived.length} (erwartet ≥ 1)`);
  log(`  neue Pendings:  ${newPendings.length} (erwartet 0)`);
  if (replyReceived.length === 0) {
    issues += 1;
    log(`  ⚠ Reply-Detection scheint nicht zu greifen — bei Sender kein reply-received-Audit.`);
  }
  if (newPendings.length > 0) {
    issues += 1;
    log(`  ⚠ Sender hat unerwartete Pendings — Reply-Detection bricht durch zur Mandate-Prüfung.`);
  }
  log("");

  // ─── STEP 7: READ-MARKER ──────────────────────────────────────────────────
  // Eingehende reply-received-Audits müssen initial read_at=NULL haben, damit
  // die Sidebar einen Indicator setzen kann. Nach markRead() darf der Counter
  // 0 sein. Regression-Schutz für 2.5.4.3-Sidebar-Indicator-Fix.
  banner("STEP 7 — READ-MARKER");
  const replyAudits = (await loadAudits(repo.audit, sender.twinId, 200)).filter(
    (a) => a.capability === "reply-received" && a.timestamp > step3StartedAt,
  );
  log(`  reply-received-Audits seit Step 3: ${replyAudits.length}`);
  if (replyAudits.length === 0) {
    issues += 1;
    log(`  ⚠ Kein reply-received-Audit gefunden — Step 7 nicht testbar.`);
  } else {
    const target = replyAudits[0]!;
    const initialReadAt = target.readAt ?? null;
    log(`  Target-Audit:    ${target.id}`);
    log(`  initial readAt:  ${initialReadAt ?? "NULL"}`);
    if (initialReadAt !== null) {
      issues += 1;
      log(`  ⚠ readAt ist nicht NULL initial — Indicator würde nie aufploppen.`);
    }
    const unreadBefore = countUnreadReplies(replyAudits);
    log(`  unreadCount vor markRead: ${unreadBefore}`);

    await repo.audit.markRead(target.id);

    // Erneut laden, damit wir den frischen readAt sehen.
    const afterAudits = (await loadAudits(repo.audit, sender.twinId, 200)).filter(
      (a) => a.capability === "reply-received" && a.timestamp > step3StartedAt,
    );
    const reloaded = afterAudits.find((a) => a.id === target.id);
    const newReadAt = reloaded?.readAt ?? null;
    log(`  readAt nach markRead: ${newReadAt ?? "NULL"}`);
    if (newReadAt === null) {
      issues += 1;
      log(`  ⚠ readAt wurde nicht gesetzt — markRead() hat keinen Effekt.`);
    }
    const unreadAfter = countUnreadReplies(afterAudits);
    log(`  unreadCount nach markRead: ${unreadAfter} (erwartet ${unreadBefore - 1})`);
    if (unreadAfter !== unreadBefore - 1) {
      issues += 1;
      log(`  ⚠ unreadCount hat sich nicht wie erwartet reduziert.`);
    }
  }
  log("");

  // ─── STEP 5: AFTER REMOVE ─────────────────────────────────────────────────
  banner("STEP 5 — AFTER REMOVE");
  const before5Receiver = await countAudits(repo.audit, receiver.twinId);
  const before5Sender = await countAudits(repo.audit, sender.twinId);
  log("Sende Test-Message von Florian an Markus (kein Trust mehr)…");
  const msg3 = await senderBridge.sendMessage({
    to: receiver.handle,
    content: `Test 3 — Message nach Trust-Remove (${nowSlug()})`,
  });
  log(`  Bridge-Msg-ID: ${msg3.messageId}`);
  const audit3 = await waitForAudit(repo.audit, receiver.twinId, msg3.messageId);
  printAudit(audit3, "External-Pfad: wieder Pending wie in Step 1");
  await sleep(SETTLE_MS);
  const delta5Receiver = (await countAudits(repo.audit, receiver.twinId)) - before5Receiver;
  const delta5Sender = (await countAudits(repo.audit, sender.twinId)) - before5Sender;
  log(`  Δ Audit (receiver): ${delta5Receiver} (erwartet ≤ ${STEP_MAX_DELTA_EXTERNAL})`);
  log(`  Δ Audit (sender):   ${delta5Sender} (erwartet ≤ ${STEP_MAX_DELTA_EXTERNAL})`);
  if (delta5Receiver > STEP_MAX_DELTA_EXTERNAL || delta5Sender > STEP_MAX_DELTA_EXTERNAL) {
    issues += 1;
    log(`  ⚠ Loop-Verdacht in Step 5 — Counts zu hoch.`);
  }
  log("");

  banner("ZUSAMMENFASSUNG");
  log(`STEP 1 → ${summarizeAudit(audit1)}`);
  log(`STEP 3 → ${summarizeAudit(audit2)}`);
  log(`STEP 5 → ${summarizeAudit(audit3)}`);
  log("");
  log("Audit-Deltas pro Step (Loop-Detection):");
  log(`  STEP 1: receiver=${delta1Receiver}, sender=${delta1Sender}`);
  log(`  STEP 3: receiver=${delta3Receiver}, sender=${delta3Sender}`);
  log(`  STEP 5: receiver=${delta5Receiver}, sender=${delta5Sender}`);
  log("");
  if (issues === 0) {
    log("✓ Loop-Detection: alle Deltas im Rahmen — kein Loop.");
  } else {
    log(`✗ Loop-Detection: ${issues} Step(s) über dem Limit. Details oben.`);
  }
  log("");
  log("Pending-Einträge aus STEP 1 + STEP 5 bleiben hängen — bei Bedarf in der");
  log("Settings-UI approven oder rejecten, sonst stehen sie als 'pending'.");

  db.close();
  if (issues > 0) process.exit(2);
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function banner(title: string) {
  const line = "─".repeat(72);
  console.log(`\n${line}\n  ${title}\n${line}`);
}

function log(msg: string) {
  console.log(msg);
}

function nowSlug(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function removeTrustQuiet(repo: TrustRepo, twinId: string, handle: string) {
  try {
    repo.remove(twinId, handle);
  } catch {
    // schon weg, ok
  }
}

/** Schnelle Approximation: lädt Audits mit großem Limit und zählt. Reicht
 *  fürs Test-Skript — kein produktives Volumen. */
async function countAudits(
  audit: { list: (opts: { limit: number; twinId?: string }) => Promise<AuditEntry[]> },
  twinId: string,
): Promise<number> {
  const entries = await audit.list({ limit: 1000, twinId });
  return entries.length;
}

function countUnreadReplies(audits: AuditEntry[]): number {
  return audits.filter(
    (a) => a.capability === "reply-received" && (a.readAt ?? null) === null,
  ).length;
}

async function loadAudits(
  audit: { list: (opts: { limit: number; twinId?: string }) => Promise<AuditEntry[]> },
  twinId: string,
  limit: number,
): Promise<AuditEntry[]> {
  return audit.list({ limit, twinId });
}

async function waitForAudit(
  audit: { findByInputField: (f: string, v: string, opts?: { twinId?: string }) => Promise<AuditEntry | null> },
  twinId: string,
  bridgeMessageId: string,
): Promise<AuditEntry> {
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const entry = await audit.findByInputField("bridgeMessageId", bridgeMessageId, {
      twinId,
    });
    if (entry) return entry;
    await sleep(POLL_INTERVAL_MS);
  }
  throw new Error(
    `Kein Audit-Eintrag für bridgeMessageId=${bridgeMessageId} innerhalb ${POLL_TIMEOUT_MS}ms.\n` +
      `Läuft 'pnpm dev'? Ist der ${twinId}-Bridge-Stream aktiv?`,
  );
}

function printAudit(entry: AuditEntry, expectation: string) {
  log(`  Erwartung: ${expectation}`);
  log(`  Audit:`);
  log(`    id:         ${entry.id}`);
  log(`    capability: ${entry.capability}`);
  log(`    status:     ${entry.status}`);
  log(`    mandateId:  ${entry.mandateId ?? "(none)"}`);
  if (entry.reason) log(`    reason:     ${entry.reason}`);
  const reply = (entry.output as { reply?: string } | null)?.reply;
  if (reply) {
    const truncated = reply.length > 120 ? `${reply.slice(0, 120)}…` : reply;
    log(`    reply:      ${truncated}`);
  }
}

function summarizeAudit(entry: AuditEntry): string {
  return `${entry.capability} / ${entry.status}`;
}

main().catch((err) => {
  console.error("\n[trust:test] Fehler:", err instanceof Error ? err.message : err);
  process.exit(1);
});
