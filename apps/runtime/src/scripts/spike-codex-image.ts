import "dotenv/config";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { deflateSync } from "node:zlib";
import { loadRuntimeConfig } from "../config.js";
import { loadMasterKey } from "../crypto-utils.js";
import { createSqliteRepository } from "../repository/index.js";
import { TwinProfilesRepo } from "../twin-profiles-repo.js";
import { OAuthTokensRepo } from "../oauth/oauth-tokens-repo.js";
import { OAuthRefreshService } from "../oauth/refresh-service.js";
import { CodexAdapter } from "../oauth/codex-adapter.js";
import { CodexHttpError } from "../oauth/codex-http-error.js";

// ─── SPIKE: Codex input_image-Wahrheitstest (Multimodal SS0) ─────────────────
//
// 🔴 EMPIRISCHE WAHRHEITSFRAGE, KEIN FEATURE-BAU. Klärt das EINE Gate für den
// ganzen Multimodal-Bogen: akzeptiert gpt-5.5 über den OAuth/Codex-Responses-
// API-Draht (`https://chatgpt.com/backend-api/codex/responses`) einen
// `input_image`-Part — oder droppt/ignoriert/verweigert er ihn?
//
// Befund aus der Diagnose: `mapV3PromptToCodex` (codex-vercel-provider.ts:327-339)
// filtert User-Content auf `type === "text"` → Image-Parts werden STILL gedroppt.
// Dieser Spike umgeht den Produktiv-Mapper KOMPLETT: er baut die Codex-Input-
// Items von Hand (inkl. `input_image`) und schickt sie direkt durch den echten
// `CodexAdapter`. KEINE Produktiv-Datei wird geändert, nichts wird verdrahtet.
//
// 🔴 WIE der Spike den echten Codex-Pfad erreicht
// ───────────────────────────────────────────────
// Der Codex-Pfad lebt NUR an einem Twin mit `auth_mode='oauth'` + gültigen
// OAuth-Tokens in der DB. Lokal ist @markus `api_key`/Anthropic → der Spike
// KANN den Codex-Pfad lokal NICHT treffen (er bricht mit klarer Meldung ab,
// siehe authMode-Guard unten). Der echte Test läuft deshalb auf PROD, von
// Markus, gegen die Prod-DB + Prod-OAuth-Tokens — die Secrets bleiben im
// Prod-Container, nichts wandert ins Repo oder auf eine andere Maschine:
//
//   # auf srv1712371, im Compose-Verzeichnis:
//   docker compose exec nolmi-runtime node dist/scripts/spike-codex-image.js --twin @markus
//
// (tsx-Variante lokal NUR sinnvoll gegen einen lokalen oauth-Twin:
//   pnpm --filter @nolmi/runtime exec tsx src/scripts/spike-codex-image.ts --twin @markus)
//
// AUSGÄNGE (siehe Klassifikation am Ende):
//   (1) gpt-5.5 beschreibt den roten Kreis korrekt → input_image FUNKTIONIERT
//       → grünes Licht für den Multimodal-Bogen.
//   (2) gpt-5.5 antwortet, sieht aber kein Bild → Responses-API ignoriert/
//       droppt input_image (oder gpt-5.5 ist nicht vision-fähig).
//   (3) HTTP-Fehler/Ablehnung vom Codex-Draht → input_image nicht unterstützt.
//
// 🔴 KONTROLL-CALL: derselbe Text wird ZUSÄTZLICH OHNE Bild geschickt. Sagt der
// Kontroll-Call „ich sehe kein Bild" und der Bild-Call beschreibt den Kreis →
// belastbarer Beweis (kein Halluzinieren). Beschreibt auch der Kontroll-Call
// einen Kreis → der Bild-Treffer ist NICHT vertrauenswürdig.

// ─── Mini-PNG-Encoder (RGBA, color type 6, no deps) ──────────────────────────
// Erzeugt ein erkennbares Test-Bild: roter, gefüllter Kreis auf weißem Grund.

const CRC_TABLE: number[] = (() => {
  const table: number[] = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    const byte = buf[i] ?? 0;
    c = (CRC_TABLE[(c ^ byte) & 0xff] ?? 0) ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, "ascii");
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function makeRedCirclePng(size = 64): Buffer {
  const r = size / 2 - 4;
  const cx = size / 2;
  const cy = size / 2;
  // Rohbild: pro Zeile 1 Filter-Byte (0) + size*4 RGBA-Bytes.
  const raw = Buffer.alloc(size * (1 + size * 4));
  let p = 0;
  for (let y = 0; y < size; y++) {
    raw[p++] = 0; // Filter: None
    for (let x = 0; x < size; x++) {
      const dx = x + 0.5 - cx;
      const dy = y + 0.5 - cy;
      const inside = dx * dx + dy * dy <= r * r;
      if (inside) {
        raw[p++] = 220; // R
        raw[p++] = 30; // G
        raw[p++] = 30; // B
        raw[p++] = 255; // A
      } else {
        raw[p++] = 255;
        raw[p++] = 255;
        raw[p++] = 255;
        raw[p++] = 255;
      }
    }
  }

  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); // width
  ihdr.writeUInt32BE(size, 4); // height
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace
  const idat = deflateSync(raw);
  return Buffer.concat([
    sig,
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", idat),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

// ─── Codex-Input-Items von Hand (Produktiv-Mapper bewusst NICHT genutzt) ─────
// OpenAI-Responses-API-Format: input_image trägt `image_url` als STRING
// (data-URI oder https-URL), nicht als verschachteltes Objekt (das wäre das
// alte Chat-Completions-Format). `detail:auto` ist optional.

const QUESTION =
  "Was siehst du auf diesem Bild? Beschreibe es genau (Form und Farbe). " +
  "Wenn du kein Bild siehst, sag das klar und ehrlich.";

function buildInputWithImage(dataUri: string) {
  return [
    {
      type: "message",
      role: "user",
      content: [
        { type: "input_text", text: QUESTION },
        { type: "input_image", image_url: dataUri, detail: "auto" },
      ],
    },
  ];
}

function buildInputTextOnly() {
  return [
    {
      type: "message",
      role: "user",
      content: [{ type: "input_text", text: QUESTION }],
    },
  ];
}

const INSTRUCTIONS =
  "Du bist ein knapper, ehrlicher Test-Assistent. Antworte in ein bis zwei " +
  "Sätzen. Erfinde nichts. Wenn du kein Bild erhalten hast, sage das klar.";

// ─── Ausgangs-Klassifikation (Heuristik — finale Bewertung macht der Mensch) ─

const POSITIVE = [
  "kreis",
  "circle",
  "rund",
  "round",
  "punkt",
  "scheibe",
  "disc",
  "disk",
  "kugel",
  "ball",
  "rot",
  "red",
];
const NEGATIVE = [
  "kein bild",
  "keine bild",
  "kein foto",
  "no image",
  "without an image",
  "don't see",
  "do not see",
  "cannot see",
  "can't see",
  "nicht sehen",
  "sehe kein",
  "ich kann kein",
  "ich habe kein",
  "nichts erhalten",
  "kein bild erhalten",
];

function describeMatch(text: string): { positive: boolean; negative: boolean } {
  const t = text.toLowerCase();
  return {
    positive: POSITIVE.some((m) => t.includes(m)),
    negative: NEGATIVE.some((m) => t.includes(m)),
  };
}

function parseTwinArg(): string {
  const argv = process.argv.slice(2);
  const idx = argv.indexOf("--twin");
  const raw = idx >= 0 ? argv[idx + 1]?.trim() : argv[0]?.trim();
  const handle = raw ?? "@markus";
  return handle.startsWith("@") ? handle : `@${handle}`;
}

async function main() {
  const handle = parseTwinArg();
  const config = loadRuntimeConfig();
  const masterKey = loadMasterKey();
  const repo = createSqliteRepository(config.dbPath);

  console.log(`[spike] DB: ${config.dbPath}`);
  console.log(`[spike] Twin: ${handle}`);

  const profilesRepo = new TwinProfilesRepo(repo.db);
  const profile = profilesRepo.findByHandle(handle);
  if (!profile) {
    throw new Error(
      `Twin '${handle}' nicht in twin_profiles gefunden — Handle prüfen.`,
    );
  }

  // 🔴 authMode-Guard: ohne oauth gibt es keinen Codex-Pfad. Lokal (api_key)
  // bricht der Spike hier mit klarer Meldung ab — das ist die empirische
  // Antwort auf „kann der Spike lokal den Codex-Pfad treffen?": nein.
  if (profile.authMode !== "oauth") {
    console.log("");
    console.log(
      `🔴 ABBRUCH: '${handle}' hat auth_mode='${profile.authMode}', nicht 'oauth'.`,
    );
    console.log(
      "   Der Codex/gpt-5.5-Pfad existiert NUR bei einem oauth-Twin mit gültigen",
    );
    console.log(
      "   OAuth-Tokens. Lokal ist @markus api_key/Anthropic → der Spike kann den",
    );
    console.log(
      "   Codex-Draht hier nicht erreichen. Auf PROD ausführen (Markus):",
    );
    console.log(
      "     docker compose exec nolmi-runtime node dist/scripts/spike-codex-image.js --twin @markus",
    );
    return;
  }

  const oauthTokensRepo = new OAuthTokensRepo(repo.db, masterKey);
  const refreshService = new OAuthRefreshService(oauthTokensRepo, repo.audit);
  const adapter = new CodexAdapter(refreshService);

  // Test-Bild erzeugen + zur visuellen Kontrolle ablegen.
  const png = makeRedCirclePng(64);
  const b64 = png.toString("base64");
  const dataUri = `data:image/png;base64,${b64}`;
  const outPath = resolve(process.cwd(), "spike-codex-test.png");
  try {
    writeFileSync(outPath, png);
    console.log(`[spike] Test-Bild (roter Kreis auf weiß): ${outPath}`);
  } catch {
    // Schreibfehler ist unkritisch — base64 reicht für den Call.
  }
  console.log(`[spike] PNG-Bytes: ${png.length}, base64-Länge: ${b64.length}`);

  // ── Call A: MIT Bild ──────────────────────────────────────────────────────
  console.log("\n=== Call A — MIT input_image (gpt-5.5) ===");
  let aText = "";
  let aFailed = false;
  try {
    const outA = await adapter.generateText({
      twinId: profile.twinId,
      instructions: INSTRUCTIONS,
      input: buildInputWithImage(dataUri) as never,
      model: "gpt-5.5",
    });
    aText = outA.text;
    console.log(`  planType=${outA.planType} status=${outA.status} latency=${outA.latencyMs}ms`);
    console.log(`  Antwort: ${aText.replace(/\s+/g, " ").trim() || "(leer)"}`);
  } catch (err) {
    aFailed = true;
    if (err instanceof CodexHttpError) {
      console.log(`  🔴 HTTP ${err.status}: ${err.bodySnippet ?? err.message}`);
    } else {
      console.log(`  🔴 Fehler: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // ── Call B: Kontrolle OHNE Bild ───────────────────────────────────────────
  console.log("\n=== Call B — KONTROLLE ohne Bild (gleicher Text) ===");
  let bText = "";
  try {
    const outB = await adapter.generateText({
      twinId: profile.twinId,
      instructions: INSTRUCTIONS,
      input: buildInputTextOnly() as never,
      model: "gpt-5.5",
    });
    bText = outB.text;
    console.log(`  Antwort: ${bText.replace(/\s+/g, " ").trim() || "(leer)"}`);
  } catch (err) {
    if (err instanceof CodexHttpError) {
      console.log(`  🔴 HTTP ${err.status}: ${err.bodySnippet ?? err.message}`);
    } else {
      console.log(`  🔴 Fehler: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // ── Klassifikation ────────────────────────────────────────────────────────
  console.log("\n=== BEFUND ===");
  if (aFailed) {
    console.log(
      "AUSGANG (3): Der Codex-Draht hat den input_image-Call mit Fehler/Ablehnung " +
        "quittiert → input_image über gpt-5.5/OAuth NICHT unterstützt. Multimodal-Gate: ROT.",
    );
    return;
  }

  const a = describeMatch(aText);
  const b = describeMatch(bText);

  if (a.positive && !a.negative && b.negative && !b.positive) {
    console.log(
      "AUSGANG (1): Bild-Call beschreibt den roten Kreis, Kontroll-Call sieht kein Bild " +
        "→ input_image FUNKTIONIERT. Multimodal-Gate: GRÜN.",
    );
  } else if (a.negative && !a.positive) {
    console.log(
      "AUSGANG (2): gpt-5.5 antwortet, sieht aber kein Bild → Responses-API droppt/" +
        "ignoriert input_image (oder gpt-5.5 ist nicht vision-fähig). Multimodal-Gate: ROT.",
    );
  } else if (a.positive && b.positive) {
    console.log(
      "🔴 UNZUVERLÄSSIG: BEIDE Calls (mit + ohne Bild) behaupten einen Kreis zu sehen " +
        "→ Halluzination, der Bild-Treffer ist KEIN Beweis. Manuell prüfen, ggf. Prompt schärfen.",
    );
  } else {
    console.log(
      "🟡 UNEINDEUTIG: Heuristik greift nicht sauber. Beide Antworten oben MANUELL bewerten — " +
        "beschreibt A (mit Bild) den roten Kreis und B (ohne Bild) nicht, ist es Ausgang (1).",
    );
  }
  console.log(
    `   [heuristik] A: positiv=${a.positive} negativ=${a.negative} | B: positiv=${b.positive} negativ=${b.negative}`,
  );
}

main().catch((err) => {
  console.error("[spike] Fehler:", err instanceof Error ? err.message : err);
  process.exit(1);
});
