import Database from "better-sqlite3";
import type { AuditEntry } from "@nolmi/shared";
import type { AuditRepository } from "../repository/types.js";
import type { EventBus } from "../events/bus.js";
import { AuditService } from "../audit/service.js";
import { FocusSnapshotsRepo } from "../focus/focus-snapshots-repo.js";
import {
  ProactiveNudgeService,
  PROACTIVE_NUDGE_CAPABILITY,
  ANLASS_OFFENE_FRAGE,
  type NudgeOutput,
} from "../focus/proactive-nudge-service.js";

// ─── TEST: Proaktiv-Nudge Anlass 3 (unbeantwortete Twin-Frage) ──────────────
//
// Self-contained, KEIN echter LLM (generate gemockt). Beweist: Detektor (offen
// vs. erledigt vs. keine Frage vs. zu alt), Generator-Filter, anlass-bewusstes
// Dedup, Recency-Default, leerer Normalfall.
//   pnpm --filter @nolmi/runtime exec tsx src/scripts/test-proactive-nudge-open-question.ts

let failures = 0;
function assert(cond: boolean, label: string): void {
  if (cond) console.log(`  ✓ ${label}`);
  else { console.error(`  ✗ FAIL: ${label}`); failures += 1; }
}

const T = "twin_x";
const HOUR = 60 * 60 * 1000;
const iso = (msAgo: number) => new Date(Date.now() - msAgo).toISOString();

/** In-Memory-AuditRepo (append/get/list) — wie der Anlass-1-Test. */
function makeAudit(): AuditService {
  const rows: AuditEntry[] = [];
  const repo = {
    async append(e: AuditEntry) { rows.push(e); },
    async get(id: string) { return rows.find((r) => r.id === id) ?? null; },
    async list({ limit }: { twinId?: string; limit?: number }) {
      return [...rows]
        .sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1))
        .slice(0, limit ?? 200);
    },
  } as unknown as AuditRepository;
  const bus = { emit() {} } as unknown as EventBus;
  return new AuditService(repo, bus, T);
}

let seq = 0;
/** Seedet einen Chat-Turn-Audit (owner-direct) mit Reply + Konv + Alter. */
async function seedChatAudit(
  audit: AuditService,
  opts: { convId: string; reply: string; msAgo: number; status?: AuditEntry["status"] },
): Promise<void> {
  await audit.repo.append({
    id: `aud_${seq++}`,
    twinId: T,
    timestamp: iso(opts.msAgo),
    capability: "owner-direct",
    mandateId: null,
    status: opts.status ?? "executed",
    input: { lastMessage: "owner sagt etwas" },
    output: { reply: opts.reply },
    reason: null,
    conversationId: opts.convId,
  } as AuditEntry);
}

/** Seedet ein offenes Anlass-1-Pending (fokus) — für den Dedup-Cross-Test. */
async function seedFokusPending(audit: AuditService): Promise<void> {
  await audit.repo.append({
    id: `aud_${seq++}`,
    twinId: T,
    timestamp: iso(1 * HOUR),
    capability: PROACTIVE_NUDGE_CAPABILITY,
    mandateId: null,
    status: "pending",
    input: { anlass: "fokus", thema: "Beziehungs-Modell" },
    output: null,
    reason: null,
    conversationId: null,
  } as AuditEntry);
}

function makeService(
  audit: AuditService,
  generate: (p: { system: string; prompt: string }) => Promise<NudgeOutput>,
  maxAgeHours?: number,
): ProactiveNudgeService {
  const db = new Database(":memory:"); // nur für FocusSnapshotsRepo (von Anlass 3 ungenutzt)
  return new ProactiveNudgeService({
    db, auditService: audit, focusRepo: new FocusSnapshotsRepo(db),
    twinId: T, twinName: "Twin", ownerName: "Markus",
    generate, openQuestionMaxAgeHours: maxAgeHours,
  });
}

const okGen = async (): Promise<NudgeOutput> => ({
  shouldNudge: true,
  message: "Du wolltest noch entscheiden, ob Florian beim Workshop mitmacht — wie ist der Stand?",
  reasoning: "echte offene Entscheidung",
});
const declineGen = async (): Promise<NudgeOutput> => ({
  shouldNudge: false, message: "", reasoning: "rhetorische Frage, nicht relevant",
});

async function pendingCount(audit: AuditService, anlass: string): Promise<number> {
  return (await audit.repo.list({ twinId: T, limit: 200 }))
    .filter((a) => a.capability === PROACTIVE_NUDGE_CAPABILITY
      && a.status === "pending"
      && (a.input as { anlass?: string }).anlass === anlass).length;
}

async function main(): Promise<void> {
  // ── 2) Detektor synthetisch ──
  console.log("\n── 2) Detektor: offen / erledigt / keine-Frage / zu-alt");
  {
    const audit = makeAudit();
    // (a) Konv endet mit Twin-Frage, kein späterer user-Turn → Kandidat
    await seedChatAudit(audit, { convId: "convA", reply: "Sollen wir Florian einladen?", msAgo: 2 * HOUR });
    // (b) Twin-Frage MIT späterer Owner-Antwort (neuere Audit-Row, reply keine Frage) → erledigt
    await seedChatAudit(audit, { convId: "convB", reply: "Wollen wir den Termin verschieben?", msAgo: 3 * HOUR });
    await seedChatAudit(audit, { convId: "convB", reply: "Alles klar, dann Dienstag.", msAgo: 1 * HOUR });
    // (c) Konv endet mit Twin-Aussage (keine Frage) → kein Kandidat
    await seedChatAudit(audit, { convId: "convC", reply: "Ich habe das notiert.", msAgo: 2 * HOUR });
    // (d) Twin-Frage älter als Cutoff (72h) → kein Kandidat (Recency)
    await seedChatAudit(audit, { convId: "convD", reply: "Brauchst du dafür Budget?", msAgo: 100 * HOUR });

    const d = await makeService(audit, okGen, 72).detectOpenQuestion(T);
    assert(d.isOpen === true, "(a) offene Frage erkannt (isOpen=true)");
    assert(d.conversationId === "convA", `(a) jüngster Kandidat = convA (got ${d.conversationId})`);
    assert(d.question === "Sollen wir Florian einladen?", "(a) Frage-Text korrekt");
  }
  {
    const audit = makeAudit(); // nur (b): beantwortet
    await seedChatAudit(audit, { convId: "convB", reply: "Wollen wir verschieben?", msAgo: 3 * HOUR });
    await seedChatAudit(audit, { convId: "convB", reply: "Gut, machen wir so.", msAgo: 1 * HOUR });
    assert((await makeService(audit, okGen, 72).detectOpenQuestion(T)).isOpen === false,
      "(b) beantwortete Frage (späterer Turn) → KEIN Kandidat");
  }
  {
    const audit = makeAudit(); // nur (c): keine Frage
    await seedChatAudit(audit, { convId: "convC", reply: "Erledigt.", msAgo: 2 * HOUR });
    assert((await makeService(audit, okGen, 72).detectOpenQuestion(T)).isOpen === false,
      "(c) letzter Turn keine Frage → KEIN Kandidat");
  }
  {
    const audit = makeAudit(); // nur (d): zu alt
    await seedChatAudit(audit, { convId: "convD", reply: "Budget nötig?", msAgo: 100 * HOUR });
    assert((await makeService(audit, okGen, 72).detectOpenQuestion(T)).isOpen === false,
      "(d) Frage älter als Cutoff → KEIN Kandidat (Recency)");
  }

  // ── 3) Generator-Filter ──
  console.log("\n── 3) Generator filtert (rhetorisch vs. echt)");
  {
    const audit = makeAudit();
    await seedChatAudit(audit, { convId: "convR", reply: "Spannend, oder?", msAgo: 2 * HOUR });
    const r = await makeService(audit, declineGen, 72).nudgeOpenQuestion();
    assert(r.created === false && r.reason === "twin-declined", "rhetorisch → shouldNudge=false → twin-declined");
    assert((await pendingCount(audit, ANLASS_OFFENE_FRAGE)) === 0, "rhetorisch → kein Pending");
  }
  {
    const audit = makeAudit();
    await seedChatAudit(audit, { convId: "convE", reply: "Sollen wir den Preis anheben?", msAgo: 2 * HOUR });
    const r = await makeService(audit, okGen, 72).nudgeOpenQuestion();
    assert(r.created === true, "echte Entscheidungsfrage → Pending erzeugt");
    assert((await pendingCount(audit, ANLASS_OFFENE_FRAGE)) === 1, "echte Frage → genau 1 Anlass-3-Pending");
    const p = (await audit.repo.list({ twinId: T, limit: 200 }))
      .find((a) => a.capability === PROACTIVE_NUDGE_CAPABILITY && a.status === "pending");
    assert((p?.input as { anlass?: string }).anlass === ANLASS_OFFENE_FRAGE, "anlass='offene_frage' im Payload");
    assert((p?.input as { conversationId?: string }).conversationId === "convE", "conversationId im Payload");
  }

  // ── 4) Dedup anlass-bewusst ──
  console.log("\n── 4) Anlass-1-Pending blockiert Anlass 3 NICHT");
  {
    const audit = makeAudit();
    await seedFokusPending(audit); // offenes Anlass-1-Pending
    await seedChatAudit(audit, { convId: "convF", reply: "Sollen wir den Vertrag kündigen?", msAgo: 2 * HOUR });
    const r = await makeService(audit, okGen, 72).nudgeOpenQuestion();
    assert(r.created === true, "trotz offenem fokus-Pending → Anlass-3-Pending erzeugt");
    assert((await pendingCount(audit, ANLASS_OFFENE_FRAGE)) === 1, "1 offene_frage-Pending");
    assert((await pendingCount(audit, "fokus")) === 1, "fokus-Pending unberührt (weiter 1)");
  }
  // Umgekehrt: zweiter Anlass-3-Tick bei offenem offene_frage-Pending → Dedup
  {
    const audit = makeAudit();
    await seedChatAudit(audit, { convId: "convG", reply: "Sollen wir expandieren?", msAgo: 2 * HOUR });
    const svc = makeService(audit, okGen, 72);
    await svc.nudgeOpenQuestion();
    const r2 = await svc.nudgeOpenQuestion();
    assert(r2.created === false && r2.reason === "open-pending", "zweiter Anlass-3-Tick → open-pending");
  }

  // ── 5) Recency-Default (72h ohne env-Override) ──
  console.log("\n── 5) Recency-Default 72h");
  {
    const auditYoung = makeAudit();
    await seedChatAudit(auditYoung, { convId: "convH", reply: "Sollen wir starten?", msAgo: 71 * HOUR });
    // KEIN maxAgeHours → Service nutzt OPEN_QUESTION_MAX_AGE_HOURS (Default 72)
    assert((await makeService(auditYoung, okGen).detectOpenQuestion(T)).isOpen === true,
      "Frage 71h alt → Kandidat (unter Default-Cutoff)");
    const auditOld = makeAudit();
    await seedChatAudit(auditOld, { convId: "convI", reply: "Sollen wir starten?", msAgo: 73 * HOUR });
    assert((await makeService(auditOld, okGen).detectOpenQuestion(T)).isOpen === false,
      "Frage 73h alt → kein Kandidat (über Default-Cutoff)");
  }

  // ── 6) Leerer Normalfall ──
  console.log("\n── 6) Leerer Normalfall");
  {
    const audit = makeAudit();
    const r = await makeService(audit, okGen, 72).nudgeOpenQuestion();
    assert(r.created === false && r.reason === "no-open-question", "keine offene Frage → no-open-question, still");
    assert((await pendingCount(audit, ANLASS_OFFENE_FRAGE)) === 0, "kein Pending, kein Fehler");
  }

  console.log(failures === 0
    ? "\n✅ ALLE CHECKS GRÜN — Anlass 3 (Detektor offen/erledigt/recency, Generator-Filter, anlass-bewusstes Dedup, leerer Normalfall).\n"
    : `\n❌ ${failures} FEHLER\n`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => { console.error(err); process.exit(1); });
