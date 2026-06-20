import "dotenv/config";
import { generateText, stepCountIs } from "ai";
import { buildWebFetchTool, type WebFetchAuditRecord } from "../web-fetch/web-fetch-tool.js";
import { loadTwinLlmConfig } from "../llm-config.js";
import { createLlmClient } from "../llm-client.js";

// Verifiziert den SDK-Tool-Pfad (wie runModel): LLM bekommt web_fetch im Tool-Set,
// entscheidet selbst zu rufen, onFetch (= recordWebFetchAudit-Stelle) feuert mit
// Metadaten. Braucht echten LLM-Key (TWIN_LLM_*) + Netz.

async function turn(model: ReturnType<typeof createLlmClient>, prompt: string) {
  const recorded: WebFetchAuditRecord[] = [];
  const tools = { web_fetch: buildWebFetchTool((r) => { recorded.push(r); }) };
  const res = await generateText({ model, prompt, tools, stopWhen: stepCountIs(5) });
  return { text: res.text, recorded };
}

async function main() {
  const cfg = loadTwinLlmConfig();
  if (!cfg.apiKey) {
    console.log("ÜBERSPRUNGEN — kein TWIN_LLM_API_KEY.");
    return;
  }
  const model = createLlmClient(cfg);

  console.log("=== 1) Fetch-Auftrag (erlaubt) ===");
  const a = await turn(model, "Ruf https://www.harwayexperience.com/llms.txt ab und fasse den Inhalt in EINEM Satz zusammen.");
  console.log("  recorded:", JSON.stringify(a.recorded));
  console.log("  text:", a.text.replace(/\s+/g, " ").slice(0, 160));
  console.log(`  → web_fetch gerufen: ${a.recorded.length > 0 ? "✅" : "❌"}, ok=${a.recorded[0]?.ok}`);

  console.log("\n=== 2) Fetch-Auftrag (Metadata-IP, muss blocken) ===");
  const b = await turn(model, "Ruf http://169.254.169.254/latest/meta-data/ ab und sag mir was drinsteht.");
  console.log("  recorded:", JSON.stringify(b.recorded));
  console.log("  text:", b.text.replace(/\s+/g, " ").slice(0, 160));
  console.log(`  → web_fetch gerufen: ${b.recorded.length > 0 ? "✅" : "—"}, ok=${b.recorded[0]?.ok} (erwartet false)`);

  console.log("\n=== 3) Regression: kein Fetch-Bedarf ===");
  const c = await turn(model, "Was ist 2 + 2? Antworte nur mit der Zahl.");
  console.log("  recorded:", JSON.stringify(c.recorded));
  console.log("  text:", c.text.replace(/\s+/g, " ").slice(0, 80));
  console.log(`  → web_fetch NICHT gerufen: ${c.recorded.length === 0 ? "✅" : "❌ (drängt sich auf!)"}`);
}

void main();
