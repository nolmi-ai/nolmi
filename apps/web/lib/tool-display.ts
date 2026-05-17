// ─── tool-display (UX.1.A / #95) ─────────────────────────────────────────────
//
// Mapping-Layer: roher MCP-Tool-Identifier → human-readable Label + Args-
// Pretty-Print. Wird im Approve-Dialog an drei Stellen gebraucht: Inbox-
// Pending-Block, Chat-McpToolCallBox, Reject-Modal-`subject`-Prop.
//
// Drei Resolution-Quellen für das Label, in der Reihenfolge:
//   1. manifestData.displayName (Hook für späteren Skill-/MCP-Owner-Override —
//      heute nirgends gesetzt, aber API-Form steht)
//   2. KNOWN_TOOL_PATTERNS-Direkt-Mapping nach Bare-Tool-Name
//   3. Generic-Fallback: Server-Prefix strippen + snake/kebab-case → Title Case
//
// Bare-Tool-Name: In der heutigen DB landet in `toolCall.mcpToolName` bereits
// der Tool-Name ohne Server-Prefix (`scrape_webpage`, `echo`). Der Strip-
// Heuristic-Code im Fallback ist defensiv für Edge-Cases, in denen ein voller
// Identifier wie `mcp_hyperbrowser-approval_scrape_webpage` durchkommt (z.B.
// wenn ein Caller das Skill-Naming statt des Tool-Names übergibt).

export type ToolDisplay = {
  /** Human-readable Name, z.B. „Webseite lesen". */
  label: string;
  /** Optionaler Kurz-Hint (heute ungenutzt — reserviert für manifestData). */
  description?: string;
  /** Formatierter Args-String, z.B. „anthropic.com (markdown)". */
  argsPreview: string;
  /** true, wenn Label per Generic-Fallback erzeugt wurde. */
  isFallback: boolean;
};

// Bekannte Tool-Patterns. Schlüssel ist der Bare-Tool-Name (nach Prefix-Strip).
// DE-First — Twin-Lab ist deutschsprachig.
const KNOWN_TOOL_PATTERNS: Record<string, string> = {
  // Hyperbrowser
  scrape_webpage: "Webseite lesen",
  extract_structured_data: "Strukturierte Daten extrahieren",
  search_with_bing: "Web-Suche (Bing)",
  crawl: "Webseite crawlen",
  browser_use_agent: "Browser-Agent (autonom)",
  openai_computer_use_agent: "Computer-Use-Agent (OpenAI)",
  claude_computer_use_agent: "Computer-Use-Agent (Claude)",
  create_profile: "Browser-Profil anlegen",
  delete_profile: "Browser-Profil löschen",

  // Everything-Server (Test-Fixture)
  echo: "Echo (Test)",
  add: "Addition (Test)",
  "get-annotated-message": "Test: annotierte Nachricht",
  "get-env": "Test: Environment-Variablen",
  printEnv: "Test: Environment-Variablen",
  longRunningOperation: "Test: lange Operation",
  sampleLLM: "Test: LLM-Sampling",
};

type Args = Record<string, unknown> | undefined;

// Pattern-spezifische Args-Formatter. Liefern eine kompakte, lesbare Repr.
// Schlüssel wieder Bare-Tool-Name. Fallback siehe formatArgsGeneric().
const ARG_FORMATTERS: Record<string, (args: Args) => string> = {
  scrape_webpage: (args) => {
    const url = typeof args?.url === "string" ? cleanUrl(args.url) : "?";
    const fmt = Array.isArray(args?.outputFormat)
      ? (args.outputFormat[0] as string | undefined)
      : typeof args?.outputFormat === "string"
        ? args.outputFormat
        : undefined;
    return fmt ? `${url} (${fmt})` : url;
  },
  extract_structured_data: (args) => {
    const url = typeof args?.url === "string" ? cleanUrl(args.url) : "?";
    return url;
  },
  search_with_bing: (args) => {
    const q = typeof args?.query === "string" ? args.query : "?";
    return `„${q}"`;
  },
  crawl: (args) => {
    const url = typeof args?.url === "string" ? cleanUrl(args.url) : "?";
    return url;
  },
  browser_use_agent: (args) => {
    const task = typeof args?.task === "string" ? truncate(args.task, 60) : "?";
    return task;
  },
  echo: (args) => {
    const msg =
      typeof args?.message === "string"
        ? args.message
        : typeof args?.msg === "string"
          ? args.msg
          : null;
    return msg ? `„${truncate(msg, 60)}"` : "?";
  },
  add: (args) => {
    const a = args?.a;
    const b = args?.b;
    if (typeof a === "number" && typeof b === "number") return `${a} + ${b}`;
    return formatArgsGeneric(args);
  },
};

export function resolveToolDisplay(
  toolIdentifier: string,
  args: Args,
  manifestData?: {
    displayName?: string;
    description?: string;
  },
): ToolDisplay {
  const bare = stripMcpPrefix(toolIdentifier);
  const argsPreview = formatArgs(toolIdentifier, args);

  // Quelle 1: explizit gesetzter Display-Name aus Manifest (zukünftiges
  // Owner-Override — heute kein Schema-Feld, nur Hook).
  if (manifestData?.displayName && manifestData.displayName.trim().length > 0) {
    return {
      label: manifestData.displayName,
      description: manifestData.description,
      argsPreview,
      isFallback: false,
    };
  }

  // Quelle 2: bekanntes Pattern.
  const known = KNOWN_TOOL_PATTERNS[bare];
  if (known) {
    return {
      label: known,
      description: manifestData?.description,
      argsPreview,
      isFallback: false,
    };
  }

  // Quelle 3: Generic-Fallback (Title Case auf Bare-Name).
  return {
    label: titleCase(bare),
    description: manifestData?.description,
    argsPreview,
    isFallback: true,
  };
}

export function formatArgs(toolIdentifier: string, args: Args): string {
  const bare = stripMcpPrefix(toolIdentifier);
  const fmt = ARG_FORMATTERS[bare];
  if (fmt) {
    try {
      return fmt(args);
    } catch {
      // Formatter-Fehler (z.B. unerwarteter Args-Shape) → Generic-Fallback.
      return formatArgsGeneric(args);
    }
  }
  return formatArgsGeneric(args);
}

// ─── Helpers ────────────────────────────────────────────────────────────────

const MAX_GENERIC_ARGS = 80;

function formatArgsGeneric(args: Args): string {
  if (!args || Object.keys(args).length === 0) return "(keine Args)";
  let json: string;
  try {
    json = JSON.stringify(args);
  } catch {
    return "(args nicht serialisierbar)";
  }
  return truncate(json, MAX_GENERIC_ARGS);
}

// MCP-Skill-Namen folgen oft dem Schema `mcp_<server>[-approval]_<tool>` oder
// `mcp:<server>:<tool>` — wenn so ein Identifier durchkommt, wollen wir den
// Tool-Anteil isolieren. Heuristik: letzter Underscore-Block, dann letzter
// Doppelpunkt-Block.
function stripMcpPrefix(id: string): string {
  if (!id) return id;
  let s = id;
  // `mcp:server:tool` → `tool`
  if (s.includes(":")) {
    const parts = s.split(":");
    s = parts[parts.length - 1] ?? s;
  }
  // `mcp_server-approval_tool_name` → wenn `mcp_`-Prefix vorhanden, alles
  // bis nach dem zweiten Underscore-Segment droppen. Wir nehmen die *letzten*
  // Segmente, weil Tool-Namen selbst Underscores enthalten dürfen
  // (`extract_structured_data`).
  if (s.startsWith("mcp_")) {
    // mcp_<server[-approval]>_<rest...> → <rest...>
    const afterMcp = s.slice("mcp_".length);
    const firstUnderscore = afterMcp.indexOf("_");
    if (firstUnderscore > -1) {
      s = afterMcp.slice(firstUnderscore + 1);
    }
  }
  return s;
}

function titleCase(name: string): string {
  if (!name) return name;
  return name
    .replace(/[_-]+/g, " ")
    .trim()
    .split(/\s+/)
    .map((w) => (w.length === 0 ? w : w[0]!.toUpperCase() + w.slice(1)))
    .join(" ");
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, Math.max(0, max - 1)) + "…";
}

// http(s)://host/path → host/path (ohne Schema + ohne trailing-Slash). Lässt
// Pfad und Query stehen, weil das oft die Information ist, die der User
// sehen will.
function cleanUrl(url: string): string {
  let s = url.replace(/^https?:\/\//, "");
  s = s.replace(/\/$/, "");
  return truncate(s, 60);
}
