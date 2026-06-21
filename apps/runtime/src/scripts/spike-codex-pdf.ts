import "dotenv/config";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadRuntimeConfig } from "../config.js";
import { loadMasterKey } from "../crypto-utils.js";
import { createSqliteRepository } from "../repository/index.js";
import { TwinProfilesRepo } from "../twin-profiles-repo.js";
import { OAuthTokensRepo } from "../oauth/oauth-tokens-repo.js";
import { OAuthRefreshService } from "../oauth/refresh-service.js";
import { CodexAdapter } from "../oauth/codex-adapter.js";
import { CodexHttpError } from "../oauth/codex-http-error.js";

// ─── SPIKE: Codex input_file-Wahrheitstest (PDF, Multimodal-Folge) ───────────
//
// 🔴 EMPIRISCHE WAHRHEITSFRAGE, KEIN FEATURE-BAU. Klärt: akzeptiert gpt-5.5 über
// den OAuth/Codex-Responses-API-Draht (chatgpt.com/backend-api/codex/responses)
// einen `input_file`-Part (PDF) — oder droppt/ignoriert/verweigert er ihn?
//
// Befund: Anthropic kann PDF nativ (SDK-bestätigt). Das Responses-FORMAT
// `input_file` existiert (aus @ai-sdk/openai extrahiert: { type:"input_file",
// filename, file_data:"data:application/pdf;base64,…" }). Ob der ChatGPT-Backend-
// Draht es annimmt, ist die Unbekannte — wie beim Bild-Spike (input_image,
// d5e757e). Dieser Spike baut die Codex-Input-Items von Hand (kein Produktiv-
// Mapper) und schickt sie durch den echten CodexAdapter. NICHTS verdrahtet.
//
// 🔴 WIE der Spike den echten Codex-Pfad erreicht: nur ein oauth-Twin mit
// gültigen Tokens (= @markus auf PROD). Lokal ist @markus api_key/Anthropic →
// authMode-Guard bricht ab. Auf PROD (Markus):
//   docker compose exec nolmi-runtime node dist/scripts/spike-codex-pdf.js --twin @markus
//
// AUSGÄNGE:
//   (1) A nennt das Token + B sieht kein Dokument → input_file FUNKTIONIERT → GRÜN.
//   (2) A sieht kein Dokument → Backend droppt input_file → ROT.
//   (3) HTTP-Fehler/Ablehnung vom Draht → nicht unterstützt → ROT.

// 🔴 Eindeutiges, unratbares Token — taucht NUR im PDF auf. Wenn die Antwort es
// enthält, hat das Modell das PDF wirklich gelesen (kann es nicht raten).
const TOKEN = "NOLMI-PDF-TEST-7392";

const QUESTION =
  "Welches Token bzw. welcher Text steht in diesem Dokument? Zitiere den genauen " +
  "Text. Wenn du kein Dokument erhalten hast, sage das klar und ehrlich.";

const INSTRUCTIONS =
  "Du bist ein knapper, ehrlicher Test-Assistent. Antworte in ein bis zwei " +
  "Sätzen. Erfinde nichts. Wenn du kein Dokument erhalten hast, sage das klar.";

// ─── Minimal-valides PDF (eine Seite, ein Text-Objekt), dep-frei ─────────────
// Korrekte xref-Offsets + startxref, damit es ein robuster Standard-PDF-Parser
// (Backend) sicher liest. Helvetica + ein Tj — der Token ist extrahierbarer Text.
function makeTokenPdf(token: string): Buffer {
  const content = `BT /F1 24 Tf 72 700 Td (${token} ist das geheime Token in diesem PDF.) Tj ET`;
  const objects: Record<number, string> = {
    1: "<< /Type /Catalog /Pages 2 0 R >>",
    2: "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    3: "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    4: "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    5: `<< /Length ${Buffer.byteLength(content, "latin1")} >>\nstream\n${content}\nendstream`,
  };

  let body = "%PDF-1.4\n";
  const offsets: Record<number, number> = {};
  for (let i = 1; i <= 5; i++) {
    offsets[i] = Buffer.byteLength(body, "latin1");
    body += `${i} 0 obj\n${objects[i]}\nendobj\n`;
  }
  const xrefStart = Buffer.byteLength(body, "latin1");
  let xref = "xref\n0 6\n0000000000 65535 f \n";
  for (let i = 1; i <= 5; i++) {
    xref += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  }
  const trailer = `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;
  return Buffer.from(body + xref + trailer, "latin1");
}

// ─── Codex-Input-Items von Hand (Produktiv-Mapper bewusst NICHT genutzt) ─────
// OpenAI-Responses-Format: input_file trägt `file_data` als data-URI-STRING
// + `filename` (bestätigt aus @ai-sdk/openai).
function buildInputWithPdf(dataUri: string) {
  return [
    {
      type: "message",
      role: "user",
      content: [
        { type: "input_text", text: QUESTION },
        { type: "input_file", filename: "test.pdf", file_data: dataUri },
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

const NEGATIVE = [
  "kein dokument",
  "keine dokument",
  "kein pdf",
  "no document",
  "no file",
  "without a document",
  "don't see",
  "do not see",
  "cannot see",
  "can't see",
  "nicht sehen",
  "sehe kein",
  "ich kann kein",
  "ich habe kein",
  "nichts erhalten",
  "kein dokument erhalten",
];

function hasToken(text: string): boolean {
  // Token ist unratbar → exaktes (case-insensitiv) Vorkommen = Beweis.
  return text.toUpperCase().includes(TOKEN);
}
function isNegative(text: string): boolean {
  const t = text.toLowerCase();
  return NEGATIVE.some((m) => t.includes(m));
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
    throw new Error(`Twin '${handle}' nicht in twin_profiles gefunden — Handle prüfen.`);
  }

  // 🔴 authMode-Guard: ohne oauth kein Codex-Pfad (lokal api_key → Abbruch).
  if (profile.authMode !== "oauth") {
    console.log("");
    console.log(`🔴 ABBRUCH: '${handle}' hat auth_mode='${profile.authMode}', nicht 'oauth'.`);
    console.log("   Der Codex/gpt-5.5-Pfad existiert NUR bei einem oauth-Twin. Auf PROD ausführen:");
    console.log("     docker compose exec nolmi-runtime node dist/scripts/spike-codex-pdf.js --twin @markus");
    return;
  }

  const oauthTokensRepo = new OAuthTokensRepo(repo.db, masterKey);
  const refreshService = new OAuthRefreshService(oauthTokensRepo, repo.audit);
  const adapter = new CodexAdapter(refreshService);

  // Test-PDF erzeugen + zur Kontrolle ablegen.
  const pdf = makeTokenPdf(TOKEN);
  const dataUri = `data:application/pdf;base64,${pdf.toString("base64")}`;
  const outPath = resolve(process.cwd(), "spike-codex-test.pdf");
  try {
    writeFileSync(outPath, pdf);
    console.log(`[spike] Test-PDF (Token ${TOKEN}): ${outPath}`);
  } catch {
    // unkritisch — base64 reicht für den Call.
  }
  console.log(`[spike] PDF-Bytes: ${pdf.length}, base64-Länge: ${pdf.toString("base64").length}`);

  // ── Call A: MIT PDF ────────────────────────────────────────────────────────
  console.log("\n=== Call A — MIT input_file (gpt-5.5) ===");
  let aText = "";
  let aFailed = false;
  try {
    const outA = await adapter.generateText({
      twinId: profile.twinId,
      instructions: INSTRUCTIONS,
      input: buildInputWithPdf(dataUri) as never,
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

  // ── Call B: Kontrolle OHNE PDF ─────────────────────────────────────────────
  console.log("\n=== Call B — KONTROLLE ohne PDF (gleicher Text) ===");
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

  // ── Klassifikation ─────────────────────────────────────────────────────────
  console.log("\n=== BEFUND ===");
  if (aFailed) {
    console.log(
      "AUSGANG (3): Der Codex-Draht hat den input_file-Call mit Fehler/Ablehnung " +
        "quittiert → input_file (PDF) über gpt-5.5/OAuth NICHT unterstützt. PDF-Gate: ROT.",
    );
    return;
  }

  const aToken = hasToken(aText);
  const bToken = hasToken(bText);
  const bNeg = isNegative(bText);

  if (aToken && !bToken) {
    console.log(
      `AUSGANG (1): A nennt das Token (${TOKEN}), B (ohne PDF) nicht ` +
        `${bNeg ? "(B sieht kein Dokument) " : ""}→ input_file FUNKTIONIERT. PDF-Gate: GRÜN.`,
    );
  } else if (!aToken && isNegative(aText)) {
    console.log(
      "AUSGANG (2): gpt-5.5 antwortet, sieht aber kein Dokument → Backend droppt/" +
        "ignoriert input_file. PDF-Gate: ROT.",
    );
  } else if (aToken && bToken) {
    console.log(
      "🔴 UNZUVERLÄSSIG: BEIDE Calls nennen das Token — das Token darf NUR im PDF " +
        "stehen. Token im Prompt geleakt? Spike prüfen.",
    );
  } else {
    console.log(
      `🟡 UNEINDEUTIG: A enthält das Token NICHT und sagt auch nicht klar „kein Dokument". ` +
        "Antwort A oben manuell bewerten.",
    );
  }
  console.log(`   [heuristik] A.token=${aToken} A.neg=${isNegative(aText)} | B.token=${bToken} B.neg=${bNeg}`);
}

main().catch((err) => {
  console.error("[spike] Fehler:", err instanceof Error ? err.message : err);
  process.exit(1);
});
