import "dotenv/config";
import Database from "better-sqlite3";
import type { LanguageModel } from "ai";
import {
  classifyMentionIntent,
  type MentionIntent,
} from "../a2a/mention-intent-classifier.js";
import { loadTwinLlmConfig, type TwinLlmConfig } from "../llm-config.js";
import { createLlmClient } from "../llm-client.js";
import { resolveClassifierConfig } from "../skills/classifier-map.js";
import { loadRuntimeConfig } from "../config.js";
import { TwinProfilesRepo } from "../twin-profiles-repo.js";
import { loadMasterKey, decrypt } from "../crypto-utils.js";

// ─── SMOKE-HARNESS: @-Mention-Intent-Klassifikator (Weg 2 SS1) ───────────────
//
// Zwei Teile:
//   1. Fail-safe (KEINE Keys nötig): bogus model → generateObject wirft →
//      classifyMentionIntent MUSS "CHAT" liefern.
//   2. Echter Modell-Lauf (braucht TWIN_LLM_*-Key in der .env): die kuratierten
//      Fälle gegen das classifierModel, Tabelle intent/reason + Soll/Ist.
//
// Aufruf:  pnpm --filter @nolmi/runtime exec tsx src/scripts/test-mention-intent.ts
// Ohne Key läuft nur Teil 1.

const TARGET = "@florian";

interface Case {
  text: string;
  expected: MentionIntent;
  note?: string;
}

// Kuratierter Grenzfall-Satz: ≥5 SEND, ≥5 CHAT + die 3 harten deferred-Fälle.
const CASES: Case[] = [
  // — SEND: Owner adressiert @florian direkt —
  { text: "@florian kannst du Freitag?", expected: "SEND" },
  { text: "@florian was hältst du von dem neuen Pricing?", expected: "SEND" },
  { text: "@florian kurzer Test, ignorier das einfach", expected: "SEND" },
  { text: "@florian hast du die Slides schon gesehen?", expected: "SEND" },
  { text: "@florian lass uns Montag telefonieren", expected: "SEND" },
  // — CHAT: Owner redet ÜBER @florian / fragt den eigenen Twin —
  { text: "was hat @florian gesagt?", expected: "CHAT" },
  { text: "@florian meinte gestern, das Quartal wird eng", expected: "CHAT" },
  { text: "@florian könnte das eigentlich wissen", expected: "CHAT" },
  { text: "wann hat @florian zuletzt geschrieben?", expected: "CHAT" },
  { text: "ich find @florian macht das richtig gut", expected: "CHAT" },
  // — 🔴 harte deferred-Fälle: MÜSSEN CHAT sein —
  { text: "ich sollte @florian mal fragen ob er Zeit hat", expected: "CHAT", note: "deferred" },
  { text: "vielleicht frag ich @florian später dazu", expected: "CHAT", note: "deferred" },
  { text: "müsste @florian eigentlich auch mal kontaktieren", expected: "CHAT", note: "deferred" },
];

async function runFailsafe(): Promise<boolean> {
  console.log("=== Teil 1: Fail-safe (bogus model → CHAT) ===");
  // Bewusst ungültiges Modell → generateObject wirft → fail-safe greift.
  const bogus = {} as unknown as LanguageModel;
  const r = await classifyMentionIntent("@florian kurzer Test", TARGET, bogus);
  const ok = r.intent === "CHAT";
  console.log(
    `  bogus-model → intent=${r.intent} reason="${r.reason}"  ${ok ? "✅ CHAT (fail-safe)" : "❌ ERWARTET CHAT"}`,
  );
  return ok;
}

/** CLI-Arg `--key=value` lesen. */
function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`${name}=`));
  return hit ? hit.slice(name.length + 1) : undefined;
}

/**
 * Resolvt das classifierModel für den echten Lauf. Drei Quellen:
 *   --twin=<handle>  → der ECHTE classifierModel dieses Twins aus der DB
 *                      (llm_config entschlüsselt + resolveClassifierConfig).
 *                      🔴 Nutzt NIE den Codex/OAuth-Pfad — der #107-Classifier
 *                      läuft IMMER über createLlmClient (provider-switch).
 *   --model=<m>      → überschreibt nur das Modell (Provider/Key wie Quelle).
 *   (default)        → loadTwinLlmConfig() aus den TWIN_LLM_*-Env-Vars.
 * Gibt null, wenn kein Key auflösbar (→ echter Lauf übersprungen).
 */
function resolveClassifierModel(): { model: LanguageModel; label: string } | null {
  const twinArg = arg("--twin");
  const modelOverride = arg("--model");

  let base: TwinLlmConfig;
  let origin: string;

  if (twinArg) {
    const handle = twinArg.startsWith("@") ? twinArg : `@${twinArg}`;
    const config = loadRuntimeConfig();
    const db = new Database(config.dbPath, { readonly: true });
    try {
      const profile = new TwinProfilesRepo(db).findByHandle(handle);
      if (!profile) {
        console.log(`\n=== Teil 2: ÜBERSPRUNGEN — Twin ${handle} nicht in DB ===`);
        return null;
      }
      const stored = profile.llmConfig;
      if (!stored.apiKeyEncrypted) {
        console.log(
          `\n=== Teil 2: ÜBERSPRUNGEN — ${handle} hat keinen apiKeyEncrypted ` +
            `(auth_mode=${profile.authMode}). Standalone nicht baubar. ===\n` +
            `    Hinweis: der #107-Classifier nutzt NIE Codex/OAuth — er läuft ` +
            `über createLlmClient(provider). Auf einem oauth-Twin ohne gespeicherten ` +
            `Key bitte direkt auf Prod testen (dort liegt @markus' llm_config).`,
        );
        return null;
      }
      const apiKey = decrypt(stored.apiKeyEncrypted, loadMasterKey());
      base = {
        provider: stored.provider,
        model: stored.model,
        apiKey,
        baseUrl: stored.baseUrl,
      };
      origin = `twin ${handle} (auth_mode=${profile.authMode})`;
    } finally {
      db.close();
    }
  } else {
    base = loadTwinLlmConfig();
    origin = "env-default (TWIN_LLM_*)";
  }

  if (!base.apiKey) {
    console.log(
      "\n=== Teil 2: ÜBERSPRUNGEN — kein API-Key auflösbar ===\n" +
        "    Optionen: --twin=@markus (DB) ODER TWIN_LLM_API_KEY in der .env.",
    );
    return null;
  }

  let classifierCfg = resolveClassifierConfig(base);
  if (modelOverride) classifierCfg = { ...classifierCfg, model: modelOverride };
  return {
    model: createLlmClient(classifierCfg),
    label: `${classifierCfg.provider}/${classifierCfg.model} — ${origin}`,
  };
}

async function runReal(): Promise<void> {
  const resolved = resolveClassifierModel();
  if (!resolved) return;
  const { model, label } = resolved;
  console.log(`\n=== Teil 2: Echter Lauf — classifier=${label} ===`);

  let pass = 0;
  let deferredOk = true;
  for (const c of CASES) {
    const r = await classifyMentionIntent(c.text, TARGET, model);
    const ok = r.intent === c.expected;
    if (ok) pass++;
    if (c.note === "deferred" && r.intent !== "CHAT") deferredOk = false;
    console.log(
      `  [${ok ? "✅" : "❌"}] soll=${c.expected.padEnd(4)} ist=${r.intent.padEnd(4)}` +
        `${c.note ? " (" + c.note + ")" : ""}  "${c.text}"\n        reason: ${r.reason}`,
    );
  }
  console.log(`\n  Ergebnis: ${pass}/${CASES.length} korrekt.`);
  console.log(
    `  🔴 deferred-Fälle alle CHAT: ${deferredOk ? "✅ JA" : "❌ NEIN — Prompt nachschärfen"}`,
  );
}

async function main(): Promise<void> {
  const failsafeOk = await runFailsafe();
  if (!failsafeOk) {
    console.error("❌ Fail-safe verletzt — Abbruch.");
    process.exit(1);
  }
  await runReal();
}

void main();
