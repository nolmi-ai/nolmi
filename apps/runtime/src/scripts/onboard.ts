import "dotenv/config";
import Database from "better-sqlite3";
import { loadRuntimeConfig } from "../config.js";
import { UserAlreadyExistsError, UsersRepo } from "../auth/users-repo.js";
import { TwinProfilesRepo } from "../twin-profiles-repo.js";
import { loadMasterKey } from "../crypto-utils.js";
import {
  createTwin,
  CreateTwinError,
  type CreateTwinInput,
} from "../onboarding/create-twin.js";
import { validateApiKey } from "../onboarding/api-key-validator.js";
import {
  LLM_PROVIDERS,
  defaultModelFor,
  type LlmProvider,
} from "../llm-config.js";
import type { MandateTemplateId } from "../onboarding/mandate-templates.js";
import { PersonaInputSchema, type PersonaInput } from "@nolmi/shared";
import { readLine, readSecret } from "./_prompt-helpers.js";

// ─── TWIN ONBOARD (CLI) — Distribution Weg B (durchgehendes Terminal-Onboarding)
//
// Die zweite Tür neben dem Web-Wizard, jetzt DURCHGEHEND: erster User + Twin
// (Persona + LLM-Key + Mandate + Bridge optional), ohne Browser-Zwang — wichtig
// für Headless-VPS, wo der Wizard ohne TLS/Tunnel nicht erreichbar ist.
//
// Ruft den geteilten createTwin-Service (Phase 1) auf — KEINE Logik-Duplikation,
// der Flow sammelt nur interaktiv die Eingaben.
//
// MVP-Grenzen (Diagnose Tag 33):
//   - KEINE Presets: activatePresets braucht die Live-Registry des Server-
//     Prozesses, die ein CLI-Prozess nicht hat → Skills/Presets danach im Web
//     unter Settings. createTwin überspringt den Hot-Load (kein registry-Dep).
//   - Der Twin landet in der DB, geht aber erst nach Runtime-RESTART live
//     (Registry wird beim Boot geladen). Für Headless der Normalfall.
//   - D2-konform: API-Key ist der einzige Weg, KEIN OAuth-Prompt (OAuth bleibt
//     Admin-Allowlist via twin:auth-mode). auth_mode-Default 'api_key'.
//
// Aufruf:
//   pnpm --filter @nolmi/runtime twin:onboard
//   docker compose exec -it nolmi-runtime node dist/scripts/onboard.js  (Container)
//
// Secrets (Passwort, LLM-Key) via readSecret — kein Echo, nicht in der History.

const WEB_URL = process.env.NOLMI_WEB_URL?.trim() || "http://localhost:3000";
const RESTART_HINT =
  process.env.NOLMI_RESTART_HINT?.trim() ||
  "docker compose restart nolmi-runtime  (lokal: pnpm dev neu starten)";

const logger = {
  warn: (obj: Record<string, unknown>, msg?: string) =>
    console.warn(`[twin:onboard] ${msg ?? ""}`, obj),
  error: (obj: Record<string, unknown>, msg?: string) =>
    console.error(`[twin:onboard] ${msg ?? ""}`, obj),
  info: (_obj: Record<string, unknown>, _msg?: string) => {},
};

function die(msg: string): never {
  throw new Error(msg);
}

/** Normalisiert einen Handle auf `@kleinbuchstaben` und validiert das Format. */
function normalizeHandle(raw: string): string {
  const h = raw.trim().toLowerCase();
  const withAt = h.startsWith("@") ? h : `@${h}`;
  if (!/^@[a-z0-9_-]+$/.test(withAt)) {
    die(`Handle '${raw}' ungültig — erlaubt: @, Kleinbuchstaben, Ziffern, _ und -.`);
  }
  return withAt;
}

async function promptChoice<T extends string>(
  prompt: string,
  options: readonly T[],
  def: T,
): Promise<T> {
  const raw = (await readLine(`${prompt} [${def}]: `)).trim().toLowerCase();
  if (!raw) return def;
  const match = options.find((o) => o.toLowerCase() === raw);
  if (!match) {
    die(`'${raw}' nicht erlaubt — Optionen: ${options.join(", ")}.`);
  }
  return match;
}

/** Komma-separierte Liste → gefiltert auf erlaubte Enum-Werte (Reihenfolge erhalten). */
function parseEnumList<T extends string>(raw: string, allowed: readonly T[]): T[] {
  return raw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
    .map((s) => {
      const m = allowed.find((a) => a.toLowerCase() === s);
      if (!m) die(`'${s}' nicht erlaubt — Optionen: ${allowed.join(", ")}.`);
      return m;
    });
}

async function gatherLlmConfig(
  advanced: boolean,
): Promise<{ provider: LlmProvider; model: string }> {
  const provider = advanced
    ? await promptChoice("LLM-Provider", LLM_PROVIDERS, "anthropic")
    : "anthropic";
  const defModel = defaultModelFor(provider);
  const model = advanced
    ? (await readLine(`Model [${defModel}]: `)).trim() || defModel
    : defModel;
  return { provider, model };
}

/** Liest den LLM-Key (kein Echo) + Live-Check via validateApiKey, bis zu 3 Versuche. */
async function gatherValidatedKey(
  provider: LlmProvider,
  model: string,
): Promise<string> {
  for (let attempt = 1; attempt <= 3; attempt++) {
    const key = (await readSecret("LLM-API-Key (kein Echo): ")).trim();
    if (!key) {
      console.log("  Kein Key eingegeben.");
      continue;
    }
    process.stdout.write("  Prüfe Key beim Provider … ");
    const v = await validateApiKey(provider, key, model);
    if (v.valid) {
      console.log("ok.");
      return key;
    }
    console.log(`ungültig: ${v.reason}`);
    if (attempt < 3) console.log("  Nochmal:");
  }
  die("LLM-Key nach 3 Versuchen nicht akzeptiert — Abbruch.");
}

async function buildQuickStartPersona(): Promise<PersonaInput> {
  const handle = normalizeHandle(await readLine("Handle (z.B. @markus): "));
  const fullName =
    (await readLine("Anzeigename: ")).trim() || handle.replace(/^@/, "");
  const role =
    (await readLine("Rolle [Persönlicher Assistent]: ")).trim() ||
    "Persönlicher Assistent";
  const topicRaw = (await readLine("Schwerpunkt-Thema [Allgemein]: ")).trim();
  return {
    fullName,
    handle,
    role,
    tone: ["direct"],
    pronoun: "context-dependent",
    preferences: [],
    topics: [topicRaw || "Allgemein"],
    relationships: [],
  };
}

async function buildAdvancedPersona(): Promise<PersonaInput> {
  const handle = normalizeHandle(await readLine("Handle (z.B. @markus): "));
  const fullName = (await readLine("Voller Name: ")).trim() || handle.replace(/^@/, "");
  const role = (await readLine("Rolle (z.B. CTO, Berater): ")).trim() || "Assistent";
  const tone = parseEnumList(
    (await readLine("Ton (komma-sep: direct,polite,casual,formal) [direct]: ")).trim() ||
      "direct",
    ["direct", "polite", "casual", "formal"] as const,
  );
  const pronoun = await promptChoice(
    "Anrede (du/sie/context-dependent)",
    ["du", "sie", "context-dependent"] as const,
    "context-dependent",
  );
  const preferences = parseEnumList(
    (await readLine(
      "Präferenzen (komma-sep: no-emojis,no-platitudes,short-answers) [leer]: ",
    )).trim(),
    ["no-emojis", "no-platitudes", "short-answers"] as const,
  );
  const topics = (await readLine("Themen (komma-sep, mind. 1): "))
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (topics.length === 0) die("Mindestens ein Thema nötig.");
  return {
    fullName,
    handle,
    role,
    tone: tone.length ? tone : ["direct"],
    pronoun,
    preferences,
    topics,
    relationships: [],
  };
}

/** Bridge-Wahl: Solo (null) oder eigene Bridge (URL + Register-Token). */
async function gatherBridge(
  advanced: boolean,
): Promise<{ bridgeUrl: string | null; bridgeRegisterToken?: string }> {
  if (!advanced) return { bridgeUrl: null }; // QuickStart = Solo
  const choice = await promptChoice(
    "Bridge: Solo (s) oder eigene Bridge (b)?",
    ["s", "b"] as const,
    "s",
  );
  if (choice === "s") return { bridgeUrl: null };
  const bridgeUrl =
    (await readLine("Bridge-URL [http://127.0.0.1:5100]: ")).trim() ||
    "http://127.0.0.1:5100";
  const token = (await readSecret("Register-Token (leer = BRIDGE_REGISTER_TOKEN-ENV): ")).trim();
  return { bridgeUrl, bridgeRegisterToken: token || undefined };
}

async function main() {
  console.log("┌─ Nolmi CLI-Onboarding (Weg B) ─────────────────────────────");
  console.log("│ Durchgehend im Terminal: Account + Twin (Persona, LLM-Key,");
  console.log("│ Mandate, Bridge optional). Kein Browser nötig.");
  console.log("└────────────────────────────────────────────────────────────");

  const config = loadRuntimeConfig();
  const db = new Database(config.dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  try {
    // 1. Stack-Voraussetzung: DB muss initialisiert sein (onboard füllt, es
    //    installiert nicht). Ohne twin_profiles-Tabelle → Hinweis auf Install.
    const hasSchema = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='twin_profiles'",
      )
      .get();
    if (!hasSchema) {
      die(
        `DB unter ${config.dbPath} ist nicht initialisiert (keine Migrationen).\n` +
          "  → Erst den Stack aufsetzen: install/install.sh (ohne TLS) bzw.\n" +
          "    install/install-tls.sh (Domain), oder 'pnpm db:init' im Dev.",
      );
    }

    const usersRepo = new UsersRepo(db);
    const profilesRepo = new TwinProfilesRepo(db);

    // 2. Erster User — idempotent: existiert er, wird er als Owner genutzt
    //    (CLI-Prozess hat DB-Zugriff = Self-Host-Admin-Kontext), nicht neu
    //    angelegt.
    const email = (await readLine("\nE-Mail: ")).trim().toLowerCase();
    if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      die("Keine gültige E-Mail-Adresse — Abbruch.");
    }
    let user = usersRepo.findByEmail(email);
    if (user) {
      console.log(`[twin:onboard] Account '${email}' existiert — wird Owner.`);
    } else {
      const password = await readSecret("Passwort (min. 8 Zeichen, kein Echo): ");
      if (password.length < 8) die("Passwort muss mind. 8 Zeichen haben — Abbruch.");
      const confirm = await readSecret("Passwort wiederholen: ");
      if (password !== confirm) die("Passwörter stimmen nicht überein — Abbruch.");
      const displayName = (await readLine("Anzeigename (optional): ")).trim() || undefined;
      try {
        user = usersRepo.create(email, password, displayName);
      } catch (err) {
        if (err instanceof UserAlreadyExistsError) {
          die(`Account '${email}' wurde zwischenzeitlich angelegt — erneut starten.`);
        }
        throw err;
      }
      console.log(`[twin:onboard] ✓ Account '${user.email}' angelegt.`);
    }

    // 3. Doppel-Twin-Schutz: hat der User schon einen Twin → freundlicher
    //    Abbruch (Weg B legt den ERSTEN an; weitere via Web).
    const owned = profilesRepo.list({ ownerUserId: user.userId });
    if (owned.length > 0) {
      console.log("");
      console.log(
        `[twin:onboard] Du hast bereits einen Twin (${owned
          .map((t) => t.handle)
          .join(", ")}).`,
      );
      console.log(
        `[twin:onboard] Weg B legt nur den ersten an — weitere Twins/Änderungen über ${WEB_URL} (Settings).`,
      );
      return;
    }

    // 4. QuickStart vs. Advanced
    const mode = await promptChoice(
      "\nModus: QuickStart (q) oder Advanced (a)?",
      ["q", "a"] as const,
      "q",
    );
    const advanced = mode === "a";

    // 5. Eingaben sammeln (Persona, LLM, Bridge, Mandate)
    const persona = advanced
      ? await buildAdvancedPersona()
      : await buildQuickStartPersona();
    const personaCheck = PersonaInputSchema.safeParse(persona);
    if (!personaCheck.success) {
      die(`Persona ungültig: ${personaCheck.error.message}`);
    }
    const { provider, model } = await gatherLlmConfig(advanced);
    const mandateTemplate: MandateTemplateId = advanced
      ? await promptChoice(
          "Mandate-Template (cautious/trusting/business)",
          ["cautious", "trusting", "business"] as const,
          "cautious",
        )
      : "cautious";
    const bridge = await gatherBridge(advanced);

    // 6. LLM-Key (kein Echo) + Live-Check VOR dem Anlegen (fängt Tippfehler).
    const apiKey = await gatherValidatedKey(provider, model);

    // 7. Twin anlegen via geteiltem Service — presetSelections leer (CLI-MVP),
    //    keine registry-Deps → createTwin überspringt den Hot-Load.
    const input: CreateTwinInput = {
      ownerUserId: user.userId,
      persona,
      mandateTemplate,
      llmConfig: { provider, model, apiKey },
      presetSelections: [],
      bridgeUrl: bridge.bridgeUrl,
      bridgeRegisterToken: bridge.bridgeRegisterToken,
    };
    let result;
    try {
      result = await createTwin(input, {
        profilesRepo,
        masterKey: loadMasterKey(),
        logger,
      });
    } catch (err) {
      if (err instanceof CreateTwinError) {
        die(`Twin-Anlage fehlgeschlagen (${err.status}): ${err.message}`);
      }
      throw err;
    }

    // 8. Abschluss
    console.log("");
    console.log(`[twin:onboard] ✓ Twin ${result.handle} angelegt (in der DB).`);
    console.log(
      `              Owner:    ${user.email}\n` +
        `              Provider: ${provider} / ${model}\n` +
        `              Bridge:   ${bridge.bridgeUrl ?? "Solo (keine Bridge / kein A2A)"}\n` +
        `              Mandate:  ${mandateTemplate}`,
    );
    console.log("");
    console.log("  Damit der Twin LIVE geht (Registry lädt beim Boot):");
    console.log(`    ${RESTART_HINT}`);
    console.log(
      `  Danach im Switcher sichtbar + Chat aktiv. Skills/Presets ergänzt du im`,
    );
    console.log(`  Web unter Settings (${WEB_URL}).`);
    console.log("");
  } finally {
    db.close();
  }
}

main().catch((err) => {
  console.error("[twin:onboard] Fehler:", err instanceof Error ? err.message : err);
  process.exit(1);
});
