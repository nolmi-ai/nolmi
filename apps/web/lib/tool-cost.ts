import { stripMcpPrefix } from "./tool-display";

// ─── tool-cost (UX.1.A / #98) ────────────────────────────────────────────────
//
// Heuristik: pro bekanntem MCP-Tool eine grobe Schätzung für Latenz und
// Kosten. Wird im Approve-Dialog (Inbox-Pending + Chat-McpToolCallBox)
// als „Schätzung: ~Ns · ~0,02 €"-Zeile vor den Buttons gerendert, damit
// User vor dem Klick weiß, was er auslöst.
//
// **Wichtig:** Werte sind Größenordnungen, keine Messungen. Eine spätere
// empirische Kalibrierung gegen echte Audit-Daten ist eigenes Item — für
// MVP reichen Bereich-Schätzungen. Anti-Goal: keine Persistenz, keine
// User-Konfig, keine Token-basierte Inferenz.
//
// Tool-Name-Schlüssel sind die Bare-Tool-Namen nach `stripMcpPrefix` —
// identisch mit der Mapping-Tabelle in tool-display.ts. Wenn dort ein Tool
// gemappt ist, sollte es hier eine Schätzung haben (oder bewusst leer
// bleiben → Fallback "Schätzung: unbekannt").

export type LatencyClass = "fast" | "moderate" | "slow" | "unknown";

export type ToolEstimate = {
  /** Latenz in Sekunden (Median-Schätzung). */
  latencySeconds: number;
  /** Latenz-Klasse — heute UI-intern reserviert, könnte später eine Farb-
   *  Codierung treiben. */
  latencyClass: LatencyClass;
  /** Kosten in Cent. Optional — `undefined` heißt „unbekannt", `0` heißt
   *  „kostenlos" (lokales Tool, keine Cloud-Session). */
  costCents?: number;
  /** true wenn die Schätzung aus dem Generic-Fallback kommt. */
  isFallback: boolean;
};

// Empirisch grobe Schätzungen. Hyperbrowser-Werte basieren auf Tag-17-
// Smoke-Beobachtungen (Cloud-Session-Spawn ~3-5s plus Page-Operation).
// Everything-Server läuft lokal über stdio — sub-Sekunde, kostenlos.
const TOOL_ESTIMATES: Record<string, ToolEstimate> = {
  // ── Hyperbrowser (Cloud-Session-kostenpflichtig) ──────────────────────
  scrape_webpage: {
    latencySeconds: 8,
    latencyClass: "moderate",
    costCents: 2,
    isFallback: false,
  },
  extract_structured_data: {
    latencySeconds: 12,
    latencyClass: "moderate",
    costCents: 3,
    isFallback: false,
  },
  search_with_bing: {
    latencySeconds: 3,
    latencyClass: "fast",
    costCents: 1,
    isFallback: false,
  },
  crawl: {
    latencySeconds: 45,
    latencyClass: "slow",
    costCents: 15,
    isFallback: false,
  },
  browser_use_agent: {
    latencySeconds: 120,
    latencyClass: "slow",
    costCents: 30,
    isFallback: false,
  },
  claude_computer_use_agent: {
    latencySeconds: 180,
    latencyClass: "slow",
    costCents: 50,
    isFallback: false,
  },
  openai_computer_use_agent: {
    latencySeconds: 180,
    latencyClass: "slow",
    costCents: 50,
    isFallback: false,
  },
  create_profile: {
    latencySeconds: 2,
    latencyClass: "fast",
    costCents: 0,
    isFallback: false,
  },
  delete_profile: {
    latencySeconds: 2,
    latencyClass: "fast",
    costCents: 0,
    isFallback: false,
  },

  // ── Everything-Server (Test-Fixture, lokal über stdio) ────────────────
  echo: {
    latencySeconds: 0.5,
    latencyClass: "fast",
    costCents: 0,
    isFallback: false,
  },
  add: {
    latencySeconds: 0.5,
    latencyClass: "fast",
    costCents: 0,
    isFallback: false,
  },
  "get-annotated-message": {
    latencySeconds: 0.5,
    latencyClass: "fast",
    costCents: 0,
    isFallback: false,
  },
  "get-env": {
    latencySeconds: 0.5,
    latencyClass: "fast",
    costCents: 0,
    isFallback: false,
  },
  printEnv: {
    latencySeconds: 0.5,
    latencyClass: "fast",
    costCents: 0,
    isFallback: false,
  },
  longRunningOperation: {
    latencySeconds: 5,
    latencyClass: "moderate",
    costCents: 0,
    isFallback: false,
  },
  sampleLLM: {
    latencySeconds: 8,
    latencyClass: "moderate",
    costCents: 1,
    isFallback: false,
  },
};

export function estimateToolCost(
  toolIdentifier: string,
  _args?: Record<string, unknown>,
): ToolEstimate {
  const bare = stripMcpPrefix(toolIdentifier);
  const hit = TOOL_ESTIMATES[bare];
  if (hit) return hit;
  return genericFallback();
}

function genericFallback(): ToolEstimate {
  // Ohne Mapping-Daten können wir Cloud-Call von Local-Call nicht sicher
  // unterscheiden — vorsichtig „unknown" markieren, keine Cost-Annahme.
  return {
    latencySeconds: 10,
    latencyClass: "unknown",
    isFallback: true,
  };
}

// ─── Formatter ──────────────────────────────────────────────────────────────
//
// Liefert die Anzeige-Strings für die UI. Getrennt von `estimateToolCost`,
// damit Caller (Inbox, Chat) wahlweise eigene Render-Strukturen nutzen
// können, aber für den Default-Pfad gibt es `formatEstimate()`.

export function formatLatency(seconds: number): string {
  if (seconds < 1) return `~${seconds.toFixed(1)}s`;
  if (seconds < 60) return `~${Math.round(seconds)}s`;
  const min = seconds / 60;
  if (min < 10) return `~${min.toFixed(1)} min`;
  return `~${Math.round(min)} min`;
}

export function formatCost(costCents: number | undefined): string | null {
  if (costCents === undefined) return null;
  if (costCents === 0) return "kostenlos";
  const euro = costCents / 100;
  // Deutsche Locale: Komma als Dezimaltrenner. Mind. 2 Nachkommastellen
  // für Cent-Beträge, sonst sieht „~0 €" billig aus bei 1¢.
  const formatted = euro.toLocaleString("de-DE", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `~${formatted} €`;
}

/**
 * Komponiert die volle Anzeige-Zeile „Schätzung: ~Ns · ~0,02 €" für die
 * Standard-Approve-UI. Branch-Logik:
 *   - Fallback → „Schätzung: unbekannt"
 *   - Cost === 0 → „Schätzung: ~Ns · kostenlos"
 *   - Cost unknown → „Schätzung: ~Ns" (ohne Cost-Teil)
 *   - sonst → „Schätzung: ~Ns · ~0,XX €"
 */
export function formatEstimate(estimate: ToolEstimate): string {
  if (estimate.isFallback) return "Schätzung: unbekannt";
  const lat = formatLatency(estimate.latencySeconds);
  const cost = formatCost(estimate.costCents);
  return cost ? `Schätzung: ${lat} · ${cost}` : `Schätzung: ${lat}`;
}
