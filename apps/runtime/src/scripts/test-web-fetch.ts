import { executeWebFetch, NOLMI_UA } from "../web-fetch/web-fetch-tool.js";

// ─── web_fetch-TOOL SMOKE (echte Calls) ──────────────────────────────────────
// Braucht Netz. WEB_FETCH_MAX_BYTES=<klein> setzen für den Truncation-Lauf.

const HARWAY_LLMS = "https://www.harwayexperience.com/llms.txt";
const HARWAY_API = "https://www.harwayexperience.com/api/agent/workshops";

async function show(label: string, url: string): Promise<void> {
  const r = await executeWebFetch({ url });
  if (r.ok) {
    console.log(
      `  ✅ ${label}: status=${r.status} type=${r.contentType} truncated=${r.truncated} len=${r.body.length} final=${r.finalUrl}`,
    );
    const preview = r.body.replace(/\s+/g, " ").slice(0, 90);
    console.log(`       body[0..90]: ${preview}`);
  } else {
    console.log(`  ⛔ ${label}: ok=false error="${r.error}"`);
  }
}

async function main(): Promise<void> {
  console.log(`UA = ${NOLMI_UA}`);
  console.log(`MAX_BYTES = ${process.env.WEB_FETCH_MAX_BYTES ?? "(default 2MB)"}\n`);

  console.log("=== ✅ ERLAUBT (HARWAY) ===");
  await show("llms.txt", HARWAY_LLMS);
  await show("api/agent/workshops", HARWAY_API);

  console.log("\n=== UA-Beweis (httpbin echo) ===");
  const ua = await executeWebFetch({ url: "https://httpbin.org/user-agent" });
  if (ua.ok) {
    const hit = ua.body.includes("Nolmi/0.1");
    console.log(`  ${hit ? "✅" : "❌"} echo enthält "Nolmi/0.1": ${ua.body.replace(/\s+/g, " ").trim()}`);
  } else {
    console.log(`  ⚠ httpbin nicht erreichbar: ${ua.error}`);
  }

  console.log("\n=== 🔴 BLOCKIERT (muss ok:false) ===");
  await show("metadata 169.254.169.254", "http://169.254.169.254/");
  await show("localhost:4000 (eigene Runtime)", "http://localhost:4000/");

  console.log("\n=== 🔴 Redirect-auf-intern (httpbin 302 → 169.254.169.254) ===");
  await show(
    "redirect→metadata",
    "https://httpbin.org/redirect-to?url=http%3A%2F%2F169.254.169.254%2F&status_code=302",
  );

  console.log("\n=== Content-Type-Reject (Bild) ===");
  await show("image/png", "https://httpbin.org/image/png");

  console.log("\n=== Truncation (nur sichtbar mit kleinem WEB_FETCH_MAX_BYTES) ===");
  await show("llms.txt @cap", HARWAY_LLMS);
}

void main();
