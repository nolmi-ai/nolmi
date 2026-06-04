import Fastify from "fastify";
import { registerTelegramApiRoutes } from "../telegram/api-routes.js";

// ─── TEST: SELF-HEALING WEBHOOK BEIM PAIRING-CODE (#130 Re-Connect-Fix) ──────
//
// Behavior-Level-Beweis (Fastify-Inject mit gestubbten Deps), dass
// POST /pairing-code den Webhook (neu) registriert BEVOR der Code rausgeht —
// und dass ein Webhook-Fehler die Code-Ausgabe NICHT blockiert.
//
// Self-contained: Stub-configsRepo + Stub-pairingService + Spy-botRegistry,
// gemockter requireOwner (Muster aus test-telegram-phase3.ts:708). Kein echtes
// Telegram-API, keine DB, kein Master-Key.
//
// Aufruf:
//   pnpm --filter @nolmi/runtime exec tsx src/scripts/test-telegram-pairing-webhook.ts

const TWIN_ID = "twin_test";
const TWIN_HANDLE = "@markus";
const OWNER = "user_owner";

let failures = 0;
function assert(cond: boolean, label: string): void {
  if (cond) console.log(`  ✓ ${label}`);
  else {
    console.error(`  ✗ FAIL: ${label}`);
    failures += 1;
  }
}

interface Spy {
  startCalls: string[];
  registerCalls: string[];
  registerThrows: boolean;
}

// Modelliert die telegram_configs-Row inkl. webhook_secret. generatePairingCode
// (Stub) fasst das Secret bewusst NICHT an — exakt wie setPairingCode real.
const configRow = {
  twin_id: TWIN_ID,
  bot_username: "_test_bot",
  webhook_secret: "SECRET_FIXED_DO_NOT_ROTATE",
  paired_owner_telegram_user_id: null as number | null,
  pairing_code: null as string | null,
  pairing_code_expires_at: null as string | null,
};

function buildApp(spy: Spy) {
  const app = Fastify({ logger: false });

  const stubConfigsRepo = {
    findByTwinId: () => configRow,
    toPublic: (r: typeof configRow) => r,
  };

  const stubPairingService = {
    generatePairingCode: (_twinId: string) => {
      // Wie der echte Service: setzt Code + Expiry, Secret bleibt unberührt.
      configRow.pairing_code = "123456";
      configRow.pairing_code_expires_at = "2026-06-04T12:00:00.000Z";
      return "123456";
    },
  };

  const spyRegistry = {
    startBotForTwin: (twinId: string) => {
      spy.startCalls.push(twinId);
    },
    registerWebhook: async (twinId: string) => {
      spy.registerCalls.push(twinId);
      if (spy.registerThrows) {
        throw new Error("Telegram setWebhook abgelehnt (gemockt)");
      }
      // Liest das Secret (read-only), rotiert es NICHT.
      void configRow.webhook_secret;
    },
  };

  registerTelegramApiRoutes(
    app,
    {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      configsRepo: stubConfigsRepo as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      pairingService: stubPairingService as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      botRegistry: spyRegistry as any,
    },
    async (_req, _reply, handle) => {
      if (handle.toLowerCase() !== TWIN_HANDLE.toLowerCase()) {
        _reply.status(401).send({ error: "Mock-requireOwner" });
        return null;
      }
      return {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        entry: { twinId: TWIN_ID, profile: { handle: TWIN_HANDLE, ownerUserId: OWNER } } as any,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        user: { userId: OWNER } as any,
      };
    },
  );

  return app;
}

async function main(): Promise<void> {
  const PC_URL = `/twins/${encodeURIComponent(TWIN_HANDLE)}/telegram/pairing-code`;

  // ── a) Happy-Path: Code + registerWebhook gerufen, Secret unverändert ──
  console.log("\n── a) POST /pairing-code → Code + Webhook-Register");
  {
    const spy: Spy = { startCalls: [], registerCalls: [], registerThrows: false };
    const app = buildApp(spy);
    await app.ready();
    const secretBefore = configRow.webhook_secret;

    const res = await app.inject({ method: "POST", url: PC_URL });
    const body = res.json();

    assert(res.statusCode === 200, "HTTP 200");
    assert(body.code === "123456", "Pairing-Code in Response (unverändert)");
    assert("expires_at" in body, "expires_at in Response (unverändert)");
    assert(spy.registerCalls.length === 1, "registerWebhook genau 1×");
    assert(spy.startCalls.length === 1, "startBotForTwin genau 1× (vor register)");
    assert(
      configRow.webhook_secret === secretBefore,
      "webhook_secret NACH Call identisch (NICHT rotiert)",
    );
    await app.close();
  }

  // ── b) KERN: registerWebhook wirft → trotzdem 200 + Code ──
  console.log("\n── b) KERN: Webhook-Fehler blockiert Code-Ausgabe NICHT");
  {
    const spy: Spy = { startCalls: [], registerCalls: [], registerThrows: true };
    const app = buildApp(spy);
    await app.ready();

    const res = await app.inject({ method: "POST", url: PC_URL });
    const body = res.json();

    assert(spy.registerCalls.length === 1, "registerWebhook wurde versucht (warf)");
    assert(res.statusCode === 200, "TROTZ Webhook-Fehler HTTP 200");
    assert(body.code === "123456", "Code trotz Webhook-Fehler ausgegeben");
    await app.close();
  }

  // ── c) Idempotenz: zweimaliges POST → kein Crash, je 1 Call pro Request ──
  console.log("\n── c) Zweimaliges POST /pairing-code");
  {
    const spy: Spy = { startCalls: [], registerCalls: [], registerThrows: false };
    const app = buildApp(spy);
    await app.ready();

    const r1 = await app.inject({ method: "POST", url: PC_URL });
    const r2 = await app.inject({ method: "POST", url: PC_URL });

    assert(r1.statusCode === 200 && r2.statusCode === 200, "beide Requests 200");
    assert(spy.startCalls.length === 2, "startBotForTwin 2× (je Request)");
    assert(spy.registerCalls.length === 2, "registerWebhook 2× (je Request)");
    await app.close();
  }

  // ── d) Regression (statisch): 404 ohne Config — kein Webhook-Versuch ──
  console.log("\n── d) Kein Config → 404, KEIN Webhook-Versuch");
  {
    const spy: Spy = { startCalls: [], registerCalls: [], registerThrows: false };
    const app = Fastify({ logger: false });
    registerTelegramApiRoutes(
      app,
      {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        configsRepo: { findByTwinId: () => null } as any,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        pairingService: {} as any,
        botRegistry: {
          startBotForTwin: (t: string) => spy.startCalls.push(t),
          registerWebhook: async (t: string) => {
            spy.registerCalls.push(t);
          },
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any,
      },
      async (_req, _reply, handle) => {
        if (handle.toLowerCase() !== TWIN_HANDLE.toLowerCase()) {
          _reply.status(401).send({ error: "Mock" });
          return null;
        }
        return {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          entry: { twinId: TWIN_ID, profile: { handle: TWIN_HANDLE, ownerUserId: OWNER } } as any,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          user: { userId: OWNER } as any,
        };
      },
    );
    await app.ready();

    const res = await app.inject({ method: "POST", url: PC_URL });
    assert(res.statusCode === 404, "404 ohne Config (404-Guard vor Webhook)");
    assert(spy.registerCalls.length === 0, "KEIN registerWebhook ohne Config");
    await app.close();
  }

  console.log(
    failures === 0
      ? "\n✅ ALLE CHECKS GRÜN — Pairing-Code re-registriert Webhook, Fehler-tolerant.\n"
      : `\n❌ ${failures} CHECK(S) FEHLGESCHLAGEN.\n`,
  );
  if (failures > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
