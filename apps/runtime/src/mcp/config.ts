// ─── MCP-CLIENT TUNABLES (Phase 3.2 Sub-Schritt B) ──────────────────────────
//
// Drei Timeouts steuern den Lifecycle der MCP-Client-Subprocesses. Defaults
// sind für lokale Dev-Loops gewählt; Production kann sie via ENV überschreiben.
//
//   - SPAWN: 30s deckt npm-Download beim ersten npx-Run ab. Production-Caches
//     (warm npx) brauchen typischerweise <1s.
//   - IDLE: 5 Min — lang genug, dass eine Konversations-Session den Subprocess
//     warm hält; kurz genug, dass verwaiste Server nicht für Stunden RAM
//     halten. Reset bei jedem Tool-Call.
//   - DISCONNECT: 2s graceful Window für client.close() bevor SIGKILL den
//     Prozess hart beendet. Mehr ist Theater (MCP-Server haben keine
//     ausgedehnte Cleanup-Phase); weniger riskiert Datenrennen mit dem
//     stdio-Buffer-Flush.
//
// Number(undefined) === NaN; Number(null) === 0 — beides nicht das, was wir
// wollen. parseEnv() nutzt nur den Default, wenn die ENV nicht oder nicht
// als positive ganze Zahl gesetzt ist.

function parseEnv(name: string, defaultMs: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return defaultMs;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) {
    console.warn(
      `[mcp] ${name}='${raw}' ist keine positive Zahl — fallback auf Default ${defaultMs}ms`,
    );
    return defaultMs;
  }
  return n;
}

export const MCP_IDLE_TIMEOUT_MS = parseEnv(
  "MCP_IDLE_TIMEOUT_MS",
  5 * 60 * 1000,
);
export const MCP_SPAWN_TIMEOUT_MS = parseEnv(
  "MCP_SPAWN_TIMEOUT_MS",
  30 * 1000,
);
export const MCP_DISCONNECT_TIMEOUT_MS = parseEnv(
  "MCP_DISCONNECT_TIMEOUT_MS",
  2 * 1000,
);
