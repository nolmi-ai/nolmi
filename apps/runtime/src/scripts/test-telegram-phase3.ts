import "dotenv/config";

if (!process.env.TELEGRAM_USE_POLLING) {
  process.env.TELEGRAM_USE_POLLING = "true";
}

import Database from "better-sqlite3";
import Fastify from "fastify";
import { loadRuntimeConfig } from "../config.js";
import { TwinProfilesRepo } from "../twin-profiles-repo.js";
import {
  EncryptionKeyMissingError,
  loadMasterKey,
} from "../crypto-utils.js";
import { TelegramConfigsRepo } from "../telegram/configs-repo.js";
import { TelegramMessagesRepo } from "../telegram/messages-repo.js";
import { PairingService } from "../telegram/pairing-service.js";
import {
  TelegramMessageRouter,
  type TelegramReplyContext,
} from "../telegram/message-router.js";
import { registerTelegramApiRoutes } from "../telegram/api-routes.js";
import { ConversationsRepo } from "../conversations/repo.js";
import { createSqliteRepository } from "../repository/index.js";
import { AuditService } from "../audit/service.js";
import { EventBus } from "../events/bus.js";

// ─── TEST: TELEGRAM PHASE 3 ──────────────────────────────────────────────────
//
// Smoke für MessageRouter + API-Routes (ohne echten Telegram-Server, ohne
// echten LLM). Fastify-Inject für die API-Routes mit gemocktem requireOwner;
// MessageRouter mit Mock-TwinService-Registry, Mock-Telegraf-Context.
//
// Aufruf:
//   pnpm --filter @nolmi/runtime exec tsx \
//     src/scripts/test-telegram-phase3.ts [@markus]

const TWIN_HANDLE_DEFAULT = "@markus";
const TEST_BOT_TOKEN = "0000000000:AAAA-TEST-TOKEN-DO-NOT-USE-AT-TELEGRAM";
const TEST_BOT_USERNAME = "_test_twin_lab_bot_phase3";
const TEST_CHAT_ID = 5555555555;
const TEST_TELEGRAM_USER_ID = 1234567890;
const TEST_INBOUND_MESSAGE_ID = 100;

function log(msg: string): void {
  console.log(msg);
}

function banner(msg: string): void {
  console.log(`\n── ${msg} ${"─".repeat(Math.max(0, 70 - msg.length))}`);
}

function cleanup(db: Database.Database, twinId: string): void {
  db.prepare(`DELETE FROM telegram_messages WHERE twin_id = ?`).run(twinId);
  db.prepare(`DELETE FROM telegram_configs WHERE twin_id = ?`).run(twinId);
}

async function main(): Promise<void> {
  const handle = (process.argv[2] ?? TWIN_HANDLE_DEFAULT).toLowerCase();

  let masterKey: Buffer;
  try {
    masterKey = loadMasterKey();
  } catch (err) {
    if (err instanceof EncryptionKeyMissingError) throw new Error(err.message);
    throw err;
  }

  const runtimeConfig = loadRuntimeConfig();
  const db = new Database(runtimeConfig.dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  const profilesRepo = new TwinProfilesRepo(db);
  const configsRepo = new TelegramConfigsRepo(db, masterKey);
  const messagesRepo = new TelegramMessagesRepo(db);
  const conversationsRepo = new ConversationsRepo(db);
  const pairingService = new PairingService(configsRepo);

  const profile = profilesRepo.findByHandle(handle);
  if (!profile) throw new Error(`Twin '${handle}' nicht in DB.`);
  if (!profile.ownerUserId) {
    throw new Error(`Twin '${handle}' hat keinen Owner — Smoke unmöglich.`);
  }
  log(`Test-Twin: ${profile.handle} (${profile.twinId})`);

  cleanup(db, profile.twinId);

  let issues = 0;

  // ─── STEP 1: splitMessage — Paragraph-Boundary + Satz-Fallback ──────────
  banner("STEP 1 — splitMessage (Pure-Function)");
  const dummyRouter = new TelegramMessageRouter(
    configsRepo,
    messagesRepo,
    conversationsRepo,
    // unused in splitMessage — type-cast für Smoke
    null as unknown as ConstructorParameters<typeof TelegramMessageRouter>[3],
  );

  // Short text — no splitting
  const short = "Kurz und knapp.";
  const shortChunks = dummyRouter.splitMessage(short, 3500);
  if (shortChunks.length !== 1 || shortChunks[0] !== short) {
    issues++;
    log(`  ⚠ short input lieferte ${shortChunks.length} chunks`);
  } else {
    log(`  ✓ short input → 1 chunk unverändert`);
  }

  // Paragraph-Boundary
  const para = "A".repeat(2000) + "\n\n" + "B".repeat(2000);
  const paraChunks = dummyRouter.splitMessage(para, 3500);
  if (paraChunks.length !== 2 || paraChunks[0]?.length !== 2000) {
    issues++;
    log(
      `  ⚠ paragraph-split: ${paraChunks.length} chunks, erster Chunk-Länge ${paraChunks[0]?.length}`,
    );
  } else {
    log(`  ✓ paragraph-split: 2 Chunks à 2000`);
  }

  // Satz-Fallback bei riesigem Paragraph
  const longSentence =
    Array.from({ length: 50 }, (_, i) => `Satz nummer ${i} hier.`).join(" ");
  const longChunks = dummyRouter.splitMessage(longSentence, 200);
  const allUnderLimit = longChunks.every((c) => c.length <= 200);
  if (!allUnderLimit || longChunks.length < 2) {
    issues++;
    log(
      `  ⚠ Satz-Fallback: ${longChunks.length} chunks, all under 200: ${allUnderLimit}`,
    );
  } else {
    log(`  ✓ Satz-Fallback: ${longChunks.length} Chunks, alle ≤200 Zeichen`);
  }

  // ─── STEP 2: API GET /config (404 wenn nichts da) ───────────────────────
  banner("STEP 2 — API GET /config (404 ohne Config)");
  const app = await buildTestApp(
    configsRepo,
    pairingService,
    profile.twinId,
    profile.handle,
    profile.ownerUserId,
  );
  const get404 = await app.inject({
    method: "GET",
    url: `/twins/${encodeURIComponent(profile.handle)}/telegram/config`,
  });
  if (get404.statusCode !== 404) {
    issues++;
    log(`  ⚠ erwartet 404, bekam ${get404.statusCode}`);
  } else {
    log(`  ✓ 404 ohne konfigurierten Bot`);
  }

  // ─── STEP 3: API POST /pairing-code (404 ohne Config) ───────────────────
  banner("STEP 3 — API POST /pairing-code (404 ohne Config)");
  const pc404 = await app.inject({
    method: "POST",
    url: `/twins/${encodeURIComponent(profile.handle)}/telegram/pairing-code`,
  });
  if (pc404.statusCode !== 404) {
    issues++;
    log(`  ⚠ erwartet 404, bekam ${pc404.statusCode}`);
  } else {
    log(`  ✓ 404 ohne konfigurierten Bot`);
  }

  // Config direkt einfügen (bypass POST /config das echte Telegram-API
  // aufruft — getMe() würde mit Test-Token failen)
  configsRepo.create({
    twin_id: profile.twinId,
    bot_token: TEST_BOT_TOKEN,
    bot_username: TEST_BOT_USERNAME,
  });

  // ─── STEP 4: API GET /config (200 mit Public-View) ──────────────────────
  banner("STEP 4 — API GET /config (200 mit Public-View)");
  const get200 = await app.inject({
    method: "GET",
    url: `/twins/${encodeURIComponent(profile.handle)}/telegram/config`,
  });
  if (get200.statusCode !== 200) {
    issues++;
    log(`  ⚠ erwartet 200, bekam ${get200.statusCode}`);
  } else {
    const body = JSON.parse(get200.body) as Record<string, unknown>;
    if ("bot_token_encrypted" in body || "webhook_secret" in body) {
      issues++;
      log(`  ⚠ Public-View leakt Secrets: ${Object.keys(body).join(", ")}`);
    } else if (body.bot_username !== TEST_BOT_USERNAME) {
      issues++;
      log(`  ⚠ bot_username falsch: ${body.bot_username}`);
    } else {
      log(`  ✓ Public-View ohne Secrets, bot_username=${body.bot_username}`);
    }
  }

  // ─── STEP 5: API POST /pairing-code (200 mit Code) ──────────────────────
  banner("STEP 5 — API POST /pairing-code (200 mit Code + Expiry)");
  const pcOk = await app.inject({
    method: "POST",
    url: `/twins/${encodeURIComponent(profile.handle)}/telegram/pairing-code`,
  });
  if (pcOk.statusCode !== 200) {
    issues++;
    log(`  ⚠ erwartet 200, bekam ${pcOk.statusCode}`);
  } else {
    const body = JSON.parse(pcOk.body) as { code: string; expires_at: string | null };
    if (!/^\d{6}$/.test(body.code)) {
      issues++;
      log(`  ⚠ Code-Format falsch: ${body.code}`);
    } else if (!body.expires_at) {
      issues++;
      log(`  ⚠ expires_at fehlt`);
    } else {
      log(`  ✓ Code ${body.code}, Expiry ${body.expires_at}`);
    }
  }

  // ─── STEP 6: MessageRouter.handleInboundOwnerMessage (Happy-Path) ───────
  banner("STEP 6 — MessageRouter Happy-Path (Mock-TwinService)");
  // Bot ist seit STEP-3 schon gepaart? Nein — die Config existiert, ist aber
  // ungepairt. Wir manipulieren paired_owner_telegram_user_id für den Test.
  db.prepare(
    `UPDATE telegram_configs SET paired_owner_telegram_user_id = ?
      WHERE twin_id = ?`,
  ).run(TEST_TELEGRAM_USER_ID, profile.twinId);

  // Fake-Registry mit einem Mock-Service, der LLM-Calls abfängt.
  type MockCtx = { channel?: string; requesterUserId?: string };
  let mockChatCalls = 0;
  let mockChatLastInput = "";
  let mockChatLastCtx: MockCtx | null = null;
  const fakeRegistry = {
    getEntry(_handle: string) {
      return {
        twinId: profile.twinId,
        service: {
          chat: async (
            messages: Array<{ role: string; content: string }>,
            ctx?: { channel?: string; requesterUserId?: string },
          ) => {
            mockChatCalls += 1;
            mockChatLastInput = messages.at(-1)?.content ?? "";
            mockChatLastCtx = ctx ?? null;
            return {
              message: {
                role: "assistant",
                content: `Mocked LLM antwortet auf: ${mockChatLastInput}`,
              },
              auditId: `aud_mock_${mockChatCalls}`,
              pending: false,
            };
          },
        },
      };
    },
  };

  const routerWithFake = new TelegramMessageRouter(
    configsRepo,
    messagesRepo,
    conversationsRepo,
    fakeRegistry as unknown as ConstructorParameters<typeof TelegramMessageRouter>[3],
  );

  const sentReplies: string[] = [];
  const sentParseModes: Array<string | undefined> = [];
  let chatActionCalls = 0;
  const fakeCtx: TelegramReplyContext = {
    async reply(text, extra) {
      sentReplies.push(text);
      sentParseModes.push(extra?.parse_mode);
      return { message_id: 1000 + sentReplies.length };
    },
    async persistentChatAction(_action, cb) {
      chatActionCalls += 1;
      await cb();
      return undefined;
    },
  };

  const currentConfig = configsRepo.findByTwinId(profile.twinId);
  if (!currentConfig) throw new Error("Test-Setup-Bug: Config fehlt");

  await routerWithFake.handleInboundOwnerMessage({
    config: currentConfig,
    twinHandle: profile.handle,
    ownerUserId: profile.ownerUserId,
    chatId: TEST_CHAT_ID,
    telegramMessageId: TEST_INBOUND_MESSAGE_ID,
    text: "Hallo Twin!",
    ctx: fakeCtx,
  });

  if (mockChatCalls !== 1) {
    issues++;
    log(`  ⚠ TwinService.chat() ${mockChatCalls}x gerufen (erwartet 1)`);
  } else {
    log(`  ✓ TwinService.chat() 1x mit Input "${mockChatLastInput}"`);
  }
  if (chatActionCalls !== 1) {
    issues++;
    log(`  ⚠ persistentChatAction ${chatActionCalls}x (erwartet 1)`);
  } else {
    log(`  ✓ persistentChatAction 1x mit Callback`);
  }
  if (sentReplies.length !== 1 || !sentReplies[0]?.includes("Mocked LLM")) {
    issues++;
    log(`  ⚠ Replies: ${JSON.stringify(sentReplies)}`);
  } else {
    log(`  ✓ Reply gesendet: "${sentReplies[0]}"`);
  }

  // #130 Phase 3 Markdown: alle Outbound-Replies müssen parse_mode='HTML'
  // setzen, sonst sieht der User auf Telegram Rohtext mit **-Markern.
  if (sentParseModes[0] !== "HTML") {
    issues++;
    log(`  ⚠ parse_mode falsch: ${JSON.stringify(sentParseModes)}`);
  } else {
    log(`  ✓ parse_mode='HTML' an ctx.reply durchgereicht`);
  }

  // #130 Phase 3: MessageRouter muss ctx.channel='telegram' an
  // twinService.chat() durchreichen — sonst landet kein Channel-Marker im
  // audit.input und der Web-UI-Badge bleibt unsichtbar.
  // TS narrows mockChatLastCtx auf 'null' (initial-Assignment) und sieht
  // die Closure-Re-Assignment nicht; explicit cast überstimmt das.
  const observedCtx = mockChatLastCtx as MockCtx | null;
  if (observedCtx?.channel !== "telegram") {
    issues++;
    log(`  ⚠ ctx.channel falsch: ${JSON.stringify(observedCtx)}`);
  } else {
    log(`  ✓ ctx.channel="telegram" an chat() durchgereicht`);
  }

  // Persistence: Inbound + Outbound müssen in telegram_messages stehen
  const persistedMessages = messagesRepo.findByTwinId(profile.twinId);
  const inbound = persistedMessages.find((m) => m.direction === "inbound");
  const outbound = persistedMessages.find((m) => m.direction === "outbound");
  if (!inbound || !outbound) {
    issues++;
    log(`  ⚠ Persistence: inbound=${!!inbound}, outbound=${!!outbound}`);
  } else if (!inbound.conversation_id || inbound.conversation_id !== outbound.conversation_id) {
    issues++;
    log(
      `  ⚠ Conversation-ID-Mismatch: in=${inbound.conversation_id}, out=${outbound.conversation_id}`,
    );
  } else {
    log(
      `  ✓ Inbound + Outbound mit conversation_id=${inbound.conversation_id} persistiert`,
    );
  }

  // ─── STEP 7: Audit-Input.channel Persistence-Roundtrip ──────────────────
  // Wir testen die Persistenz-Spur direkt am AuditService — schreibt einen
  // Audit-Eintrag mit input.channel='telegram' und liest ihn via Repo
  // zurück. Wenn der JSON-Bag-Pfad (kein Schema-Migration nötig, siehe
  // AuditEntrySchema.input: z.record) irgendwann mal gebrochen wäre, fängt
  // dieser Smoke-Step das auf.
  banner("STEP 7 — Audit-Input.channel Persistence-Roundtrip");
  const auditRepo = createSqliteRepository(runtimeConfig.dbPath);
  const auditBus = new EventBus();
  const auditService = new AuditService(auditRepo.audit, auditBus, profile.twinId);
  const writtenAudit = await auditService.start({
    capability: "owner-direct",
    mandateId: null,
    input: {
      lastMessage: "smoke phase3 channel-roundtrip",
      originalCapability: "respond_to_chat",
      channel: "telegram",
    },
    initialStatus: "executed",
    conversationId: null,
  });
  const reloaded = await auditRepo.audit.get(writtenAudit.id);
  if (!reloaded) {
    issues++;
    log(`  ⚠ audit nicht wiederladbar (id=${writtenAudit.id})`);
  } else {
    const channelOut = (reloaded.input as Record<string, unknown>).channel;
    if (channelOut !== "telegram") {
      issues++;
      log(`  ⚠ audit.input.channel falsch nach Roundtrip: ${channelOut}`);
    } else {
      log(`  ✓ audit.input.channel="telegram" überlebt SQLite-JSON-Roundtrip`);
    }
  }
  // Cleanup test audit (audit-repo hat eine delete API? Falls nicht, lassen
  // wir den Eintrag stehen — er ist als Smoke-Artefakt erkennbar.)
  db.prepare(`DELETE FROM audit WHERE id = ?`).run(writtenAudit.id);

  // ─── STEP 8: MessageRouter Error-Handling (LLM throws) ──────────────────
  banner("STEP 8 — MessageRouter Error-Handling (LLM-Failure)");
  const failRegistry = {
    getEntry(_handle: string) {
      return {
        twinId: profile.twinId,
        service: {
          chat: async () => {
            throw new Error("Mock-LLM-Failure");
          },
        },
      };
    },
  };
  const routerFail = new TelegramMessageRouter(
    configsRepo,
    messagesRepo,
    conversationsRepo,
    failRegistry as unknown as ConstructorParameters<typeof TelegramMessageRouter>[3],
  );
  const failReplies: string[] = [];
  const failCtx: TelegramReplyContext = {
    async reply(text) {
      failReplies.push(text);
      return { message_id: 9999 };
    },
    async persistentChatAction(_action, cb) {
      await cb();
      return undefined;
    },
  };

  let threw = false;
  try {
    await routerFail.handleInboundOwnerMessage({
      config: currentConfig,
      twinHandle: profile.handle,
      ownerUserId: profile.ownerUserId,
      chatId: TEST_CHAT_ID,
      telegramMessageId: TEST_INBOUND_MESSAGE_ID + 1,
      text: "Failing message",
      ctx: failCtx,
    });
  } catch {
    threw = true;
  }

  if (threw) {
    issues++;
    log(`  ⚠ MessageRouter warf bei LLM-Failure — sollte schlucken`);
  } else if (failReplies.length === 0 || !failReplies.at(-1)?.includes("Entschuldigung")) {
    issues++;
    log(`  ⚠ Fallback-Reply fehlt: ${JSON.stringify(failReplies)}`);
  } else {
    log(`  ✓ Fallback-Reply: "${failReplies.at(-1)}"`);
  }

  // ─── STEP 9: markdownToTelegramHtml Pure-Function ───────────────────────
  banner("STEP 9 — markdownToTelegramHtml (Pure-Function)");
  const md = await import("../telegram/markdown-to-telegram-html.js");
  const cases: Array<{ name: string; input: string; mustContain?: string[]; mustNotContain?: string[] }> = [
    {
      name: "Bold",
      input: "**fett**",
      mustContain: ["<strong>fett</strong>"],
      mustNotContain: ["**"],
    },
    {
      name: "Italic",
      input: "*kursiv*",
      mustContain: ["<em>kursiv</em>"],
    },
    {
      name: "Inline-Code",
      input: "siehe `foo()`",
      mustContain: ["<code>foo()</code>"],
    },
    {
      name: "Link",
      input: "[GitHub](https://github.com)",
      mustContain: ['<a href="https://github.com">GitHub</a>'],
    },
    {
      name: "Header → bold",
      input: "# Überschrift",
      mustContain: ["<b>Überschrift</b>"],
      mustNotContain: ["<h1>", "</h1>"],
    },
    {
      name: "Bullet-Liste → Bullets",
      input: "- erstes\n- zweites",
      mustContain: ["• erstes", "• zweites"],
      mustNotContain: ["<ul>", "<li>"],
    },
    {
      name: "Numbered-Liste → 1. 2.",
      input: "1. eins\n2. zwei",
      mustContain: ["1. eins", "2. zwei"],
      mustNotContain: ["<ol>", "<li>"],
    },
    {
      name: "Code-Block bleibt <pre>",
      input: "```ts\nconst x = 1;\n```",
      mustContain: ["<pre>", "</pre>", "const x = 1;"],
    },
    {
      name: "<-Escape in Plain-Text",
      input: "verwende a < b für Vergleich",
      mustContain: ["a &lt; b"],
      mustNotContain: ["a < b"],
    },
    {
      name: "Paragraph-Wrapper raus",
      input: "Erster Absatz.\n\nZweiter Absatz.",
      mustNotContain: ["<p>", "</p>"],
    },
  ];
  for (const c of cases) {
    const html = md.markdownToTelegramHtml(c.input);
    const missing = (c.mustContain ?? []).filter((s) => !html.includes(s));
    const leaked = (c.mustNotContain ?? []).filter((s) => html.includes(s));
    if (missing.length > 0 || leaked.length > 0) {
      issues++;
      log(
        `  ⚠ ${c.name}: missing=${JSON.stringify(missing)} leaked=${JSON.stringify(leaked)}`,
      );
      log(`    output: ${JSON.stringify(html)}`);
    } else {
      log(`  ✓ ${c.name}`);
    }
  }

  // ─── STEP 10: MessageRouter mit Markdown-Mock → HTML-Reply ──────────────
  banner("STEP 10 — MessageRouter Markdown-Output → Telegram-HTML");
  const mdRegistry = {
    getEntry(_handle: string) {
      return {
        twinId: profile.twinId,
        service: {
          chat: async () => ({
            message: {
              role: "assistant",
              content: "**Hallo** Markus, hier eine Liste:\n\n- erstes\n- zweites",
            },
            auditId: "aud_md_mock",
            pending: false,
          }),
        },
      };
    },
  };
  const mdRouter = new TelegramMessageRouter(
    configsRepo,
    messagesRepo,
    conversationsRepo,
    mdRegistry as unknown as ConstructorParameters<typeof TelegramMessageRouter>[3],
  );
  const mdReplies: Array<{ text: string; parse_mode?: string }> = [];
  const mdCtx: TelegramReplyContext = {
    async reply(text, extra) {
      mdReplies.push({ text, parse_mode: extra?.parse_mode });
      return { message_id: 7777 };
    },
    async persistentChatAction(_action, cb) {
      await cb();
      return undefined;
    },
  };
  await mdRouter.handleInboundOwnerMessage({
    config: currentConfig,
    twinHandle: profile.handle,
    ownerUserId: profile.ownerUserId,
    chatId: TEST_CHAT_ID,
    telegramMessageId: TEST_INBOUND_MESSAGE_ID + 2,
    text: "Gib mir Markdown",
    ctx: mdCtx,
  });
  const lastReply = mdReplies.at(-1);
  if (!lastReply || lastReply.parse_mode !== "HTML") {
    issues++;
    log(`  ⚠ parse_mode falsch: ${JSON.stringify(lastReply)}`);
  } else if (!lastReply.text.includes("<strong>Hallo</strong>")) {
    issues++;
    log(`  ⚠ HTML enthält kein <strong>Hallo</strong>: ${lastReply.text}`);
  } else if (!lastReply.text.includes("• erstes")) {
    issues++;
    log(`  ⚠ Bullet-Liste fehlt im HTML: ${lastReply.text}`);
  } else {
    log(`  ✓ Markdown → Telegram-HTML konvertiert, parse_mode='HTML' gesetzt`);
  }
  // Persistierter Text in telegram_messages.text muss Markdown-Original sein
  // (channel-agnostisch), NICHT die HTML-Konversion. findByTwinId liefert
  // DESC nach sent_at — neueste zuerst. `.at(0)` ist also der STEP-10-
  // Outbound, nicht der STEP-6.
  const lastPersisted = messagesRepo
    .findByTwinId(profile.twinId)
    .filter((m) => m.direction === "outbound")
    .at(0);
  if (!lastPersisted) {
    issues++;
    log(`  ⚠ Outbound-Message nicht persistiert`);
  } else if (lastPersisted.text.includes("<strong>")) {
    issues++;
    log(`  ⚠ Persistenz enthält HTML statt Markdown: ${lastPersisted.text}`);
  } else if (!lastPersisted.text.includes("**Hallo**")) {
    issues++;
    log(`  ⚠ Persistenz enthält kein **Hallo** (Markdown-Original): ${lastPersisted.text}`);
  } else {
    log(`  ✓ Persistierter Text bleibt Markdown-Original (channel-agnostisch)`);
  }

  // ─── STEP 11: POST /unpair Roundtrip (§h Persistent-Pairing) ────────────
  // Pre-Condition: STEP 6 hat den Twin mit TEST_TELEGRAM_USER_ID gepaired,
  // STEPs 7-10 haben den State nicht angefasst. Wir prüfen jetzt, dass
  // POST /unpair den Pair-State auf NULL setzt, OHNE die Config selbst zu
  // löschen — Bot-Config bleibt für Re-Pair erhalten.
  banner("STEP 11 — POST /unpair Roundtrip");
  const beforeUnpair = configsRepo.findByTwinId(profile.twinId);
  if (beforeUnpair?.paired_owner_telegram_user_id !== TEST_TELEGRAM_USER_ID) {
    issues++;
    log(`  ⚠ Pre-Condition: erwartet gepaired, bekam ${beforeUnpair?.paired_owner_telegram_user_id}`);
  } else {
    log(`  ✓ Pre-Condition: gepaired mit user_id=${TEST_TELEGRAM_USER_ID}`);
  }

  const unpairResp = await app.inject({
    method: "POST",
    url: `/twins/${encodeURIComponent(profile.handle)}/telegram/unpair`,
  });
  if (unpairResp.statusCode !== 204) {
    issues++;
    log(`  ⚠ erwartet 204, bekam ${unpairResp.statusCode} (body: ${unpairResp.body})`);
  } else {
    log(`  ✓ POST /unpair → 204 No Content`);
  }

  const afterUnpair = configsRepo.findByTwinId(profile.twinId);
  if (!afterUnpair) {
    issues++;
    log(`  ⚠ Config nach Unpair gelöscht — sollte erhalten bleiben (§h)`);
  } else if (afterUnpair.paired_owner_telegram_user_id !== null) {
    issues++;
    log(
      `  ⚠ paired_owner_telegram_user_id nach Unpair: ${afterUnpair.paired_owner_telegram_user_id}`,
    );
  } else {
    log(`  ✓ Config erhalten (Bot-Token + Webhook-Secret intakt), Pair-State auf NULL`);
  }

  // Idempotenz: zweiter Unpair-Call auf bereits ungepaired-Twin → 204 (kein 409)
  const unpairAgain = await app.inject({
    method: "POST",
    url: `/twins/${encodeURIComponent(profile.handle)}/telegram/unpair`,
  });
  if (unpairAgain.statusCode !== 204) {
    issues++;
    log(`  ⚠ Idempotenter zweiter Unpair: erwartet 204, bekam ${unpairAgain.statusCode}`);
  } else {
    log(`  ✓ Idempotent: zweiter Unpair-Call → 204`);
  }

  // ─── STEP 12: TelegramConfigBodySchema .strict() rejects Extra-Felder ────
  // §h-Defense-in-depth: PUT /config darf KEINE paired_owner_*-Felder
  // akzeptieren. Mit .strict() im Schema lehnt safeParse Extra-Felder vor
  // dem Token-Validation-Call ab (400 ohne Telegram-API-Touch).
  banner("STEP 12 — .strict() rejects paired_owner_* im PUT-Body");
  const putExtra = await app.inject({
    method: "PUT",
    url: `/twins/${encodeURIComponent(profile.handle)}/telegram/config`,
    payload: {
      bot_token: TEST_BOT_TOKEN,
      bot_username: TEST_BOT_USERNAME,
      paired_owner_telegram_user_id: 99999,
    },
    headers: { "content-type": "application/json" },
  });
  if (putExtra.statusCode !== 400) {
    issues++;
    log(`  ⚠ erwartet 400 (Schema-Reject), bekam ${putExtra.statusCode} (body: ${putExtra.body})`);
  } else {
    log(`  ✓ PUT mit paired_owner_telegram_user_id → 400 (Schema-Reject)`);
  }

  // Verify: Config nach Reject unverändert (Defense-in-depth verifizieren)
  const afterStrict = configsRepo.findByTwinId(profile.twinId);
  if (afterStrict?.paired_owner_telegram_user_id !== null) {
    issues++;
    log(
      `  ⚠ Config-State nach 400-Reject mutiert: paired=${afterStrict?.paired_owner_telegram_user_id}`,
    );
  } else {
    log(`  ✓ Config-State unverändert nach 400-Reject`);
  }

  // ─── Cleanup ────────────────────────────────────────────────────────────
  banner("Cleanup");
  cleanup(db, profile.twinId);
  log(`  ✓ Test-Config + Messages entfernt`);

  await app.close();

  banner("Ergebnis");
  if (issues === 0) {
    log(`✓ Alle Phase-3-Smoke-Tests grün`);
  } else {
    log(`⚠ ${issues} Issue(s) — bitte Output prüfen`);
    process.exit(1);
  }

  db.close();
}

/**
 * Baut eine Mini-Fastify-Instanz mit gemocktem requireOwner für die
 * API-Routes-Tests. Bot-Registry ist Stub (Routes mocken die setWebhook-
 * Calls nicht, weil Test-Token sowieso nicht gepairt ist und im Webhook-
 * Mode None-Op).
 */
async function buildTestApp(
  configsRepo: TelegramConfigsRepo,
  pairingService: PairingService,
  twinId: string,
  twinHandle: string,
  ownerUserId: string,
): Promise<ReturnType<typeof Fastify>> {
  const app = Fastify({ logger: false });

  // Stub-BotRegistry: API-Routes rufen startBotForTwin + register/unregister
  // Webhook auf — wir wollen aber nichts ans Telegram-API schicken. Stubs
  // tun nichts.
  const stubRegistry = {
    startBotForTwin: () => {},
    stopBotForTwin: () => {},
    registerWebhook: async () => {},
    unregisterWebhook: async () => {},
  };

  registerTelegramApiRoutes(
    app,
    {
      configsRepo,
      pairingService,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      botRegistry: stubRegistry as any,
    },
    async (_req, _reply, handle) => {
      // Nur Owner für unseren Test-Twin durchwinken. Andere Handles → 401.
      if (handle.toLowerCase() !== twinHandle.toLowerCase()) {
        _reply.status(401).send({ error: "Mock-requireOwner" });
        return null;
      }
      return {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        entry: { twinId, profile: { handle: twinHandle, ownerUserId } } as any,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        user: { userId: ownerUserId } as any,
      };
    },
  );

  await app.ready();
  return app;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
