import Fastify from "fastify";
import { registerFactRoutes } from "../server.js";

// ─── TEST: ROUTE-CONTRACT POST /twins/:handle/social-nudge ──────────────────
//
// Behavior-Level-Beweis für die NEUE Verdrahtung (Vision-Pattern #3 prod-
// triggerbar). Die SocialSuggestionService-LOGIK selbst (Kandidaten/Dedup/
// Leer-Fall/nur-Pending) ist bereits in 7c871be mit Seed-Daten grün belegt und
// hier NICHT erneut getestet — meine Änderung berührt sie nicht. Geprüft wird:
//
//   a) Owner → 200, ruft entry.service.socialSuggestionService.nudge() genau 1×,
//      gibt das Service-Ergebnis (created/skippedExistingPending/partnersChecked)
//      unverändert durch.
//   Nicht-Owner → 403, nudge NICHT gerufen.
//   b) Leer-Fall: nudge() liefert created:[] → 200, Passthrough (UI mappt auf
//      „keine fälligen Kontakte").
//   d) Leitplanke: die Route ruft AUSSCHLIESSLICH nudge (Erzeugungs-Pfad) — kein
//      Send/Approve/Bridge. Der Spy exponiert nur nudge; jeder andere Zugriff
//      würde werfen.
//
// Mount-Muster wie die Telegram-api-routes-Tests: registerFactRoutes mit
// gemocktem requireOwner + Spy-Service. deps werden im social-nudge-Handler
// nicht berührt → {} as any genügt (andere Fact-Routes rufen wir nicht).
//
// Aufruf:
//   pnpm --filter @nolmi/runtime exec tsx src/scripts/test-social-nudge-route.ts

const TWIN_ID = "twin_test";
const HANDLE = "@markus";
const OWNER = "user_owner";

let failures = 0;
function assert(cond: boolean, label: string): void {
  if (cond) console.log(`  ✓ ${label}`);
  else {
    console.error(`  ✗ FAIL: ${label}`);
    failures += 1;
  }
}

interface NudgeResult {
  created: Array<{ partnerHandle: string; auditId: string; suggestionText: string }>;
  skippedExistingPending: string[];
  partnersChecked: number;
}

function buildApp(nudgeReturn: NudgeResult, spy: { nudgeCalls: number }) {
  const app = Fastify({ logger: false });

  // Spy-Service: NUR nudge. Greift die Route versehentlich auf einen anderen
  // (Send-/Approve-)Pfad zu, fliegt der Test mit „is not a function".
  const socialSuggestionService = {
    nudge: async (_now: Date): Promise<NudgeResult> => {
      spy.nudgeCalls += 1;
      return nudgeReturn;
    },
  };

  registerFactRoutes(
    app,
    // deps wird im social-nudge-Handler nicht berührt.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    {} as any,
    async (_req, reply, handle) => {
      if (handle.toLowerCase() !== HANDLE.toLowerCase()) {
        reply.status(403).send({ error: "Mock-requireOwner: not owner" });
        return null;
      }
      return {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        entry: { twinId: TWIN_ID, handle: HANDLE, service: { socialSuggestionService } } as any,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        user: { userId: OWNER } as any,
      };
    },
  );

  return app;
}

async function main(): Promise<void> {
  const url = (h: string) => `/twins/${encodeURIComponent(h)}/social-nudge`;

  // ── a) Owner mit Treffern: 200, nudge 1×, Passthrough ──
  console.log("\n── a) Owner → 200, nudge() 1×, Ergebnis durchgereicht");
  {
    const result: NudgeResult = {
      created: [
        { partnerHandle: "@florian", auditId: "audit_x1", suggestionText: "…" },
        { partnerHandle: "@heiko", auditId: "audit_x2", suggestionText: "…" },
      ],
      skippedExistingPending: ["@anna"],
      partnersChecked: 3,
    };
    const spy = { nudgeCalls: 0 };
    const app = buildApp(result, spy);
    await app.ready();

    const res = await app.inject({ method: "POST", url: url(HANDLE) });
    const body = res.json();

    assert(res.statusCode === 200, "HTTP 200");
    assert(spy.nudgeCalls === 1, "nudge() genau 1× gerufen");
    assert(body.created?.length === 2, "created durchgereicht (2)");
    assert(
      JSON.stringify(body.skippedExistingPending) === JSON.stringify(["@anna"]),
      "skippedExistingPending durchgereicht",
    );
    assert(body.partnersChecked === 3, "partnersChecked durchgereicht");
    await app.close();
  }

  // ── Nicht-Owner: 403, nudge NICHT gerufen ──
  console.log("\n── Nicht-Owner → 403, nudge NICHT gerufen");
  {
    const spy = { nudgeCalls: 0 };
    const app = buildApp(
      { created: [], skippedExistingPending: [], partnersChecked: 0 },
      spy,
    );
    await app.ready();

    const res = await app.inject({ method: "POST", url: url("@fremder") });
    assert(res.statusCode === 403, "HTTP 403 für Nicht-Owner");
    assert(spy.nudgeCalls === 0, "nudge() NICHT gerufen (Owner-Gate vor Service)");
    await app.close();
  }

  // ── b) Leer-Fall: created:[] → 200, sauberer Passthrough ──
  console.log("\n── b) Leer-Fall → 200, created=0");
  {
    const spy = { nudgeCalls: 0 };
    const app = buildApp(
      { created: [], skippedExistingPending: [], partnersChecked: 0 },
      spy,
    );
    await app.ready();

    const res = await app.inject({ method: "POST", url: url(HANDLE) });
    const body = res.json();
    assert(res.statusCode === 200, "HTTP 200 auch im Leer-Fall");
    assert(spy.nudgeCalls === 1, "nudge() gerufen");
    assert(
      Array.isArray(body.created) && body.created.length === 0,
      "created=[] (UI mappt auf 'keine fälligen Kontakte')",
    );
    await app.close();
  }

  // ── d) Leitplanke: Route ruft NUR nudge — kein anderer Pfad ──
  console.log("\n── d) Leitplanke: Erzeugungs-Pfad isoliert (nur nudge)");
  {
    // Spy-Service exponiert ausschließlich nudge. Würde der Handler send/approve/
    // bridge anfassen, gäbe es einen TypeError → 500. Wir prüfen: 200 + nudge 1×,
    // also wurde NUR der Pending-Erzeugungs-Pfad berührt.
    const spy = { nudgeCalls: 0 };
    const app = buildApp(
      {
        created: [{ partnerHandle: "@florian", auditId: "a", suggestionText: "…" }],
        skippedExistingPending: [],
        partnersChecked: 1,
      },
      spy,
    );
    await app.ready();
    const res = await app.inject({ method: "POST", url: url(HANDLE) });
    assert(res.statusCode === 200, "200 — kein Zugriff auf einen anderen (Send-)Pfad");
    assert(spy.nudgeCalls === 1, "ausschließlich nudge() berührt (kein Send/Approve)");
    await app.close();
  }

  console.log(
    failures === 0
      ? "\n✅ ALLE CHECKS GRÜN — Route owner-gated, Passthrough korrekt, nur Pending-Erzeugung.\n"
      : `\n❌ ${failures} CHECK(S) FEHLGESCHLAGEN.\n`,
  );
  if (failures > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
