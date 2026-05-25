# #131 OpenAI Subscription-OAuth — Strategy

**Status:** Phase 1 + 2 + 3.0 Spike + 3.1 (3.1.1 + 3.1.2) + 3.2 + 3.3.0 Spike + 3.3.2 Spike ✅ Tag 27. Phase 3.3.1 nächster Schritt (Tag 28) — Parser-Erweiterung + MCP-Pipeline-Mapping auf zwei verifizierten Format-Schichten (§k Tool-Call-Events + §l Multi-Step-Roundtrip).

Pre-Launch-Phase A Block 5 Item. Vorgezogen von Phase B in Tag 26.

## Zusammenfassung

Twin-Lab integriert OpenAI Subscription-OAuth (ChatGPT Plus/Pro/Business) als Alternative zu API-Key-BYOK. Power-User mit existing Subscription sparen substantielle API-Kosten für 1000+ Messages/Monat. Pattern matched Branchen-Standard (Hermes Agent 140k Stars, RooCode, OpenCode).

**Twin-Lab-Default bleibt BYOK** — OAuth ist Opt-in mit ToS-Disclaimer und dokumentiertem SSH-Tunnel-Setup.

## Recherche-Findings (Tag 27 Vormittag)

### OAuth-Implementation-Constraints

| Constraint | Detail | Quelle |
|---|---|---|
| Client-ID | `app_EMoamEEZ73f0CkXaXp7hrann` (Codex Public Client) | OpenCode, RooCode Issues |
| Redirect-URI | `http://localhost:1455/auth/callback` (hardcoded) | OpenAI Codex Auth-Doku |
| Authorization-Endpoint | `https://auth.openai.com/oauth/authorize` | OpenAI Codex Auth-Doku |
| Token-Endpoint | `https://auth.openai.com/oauth/token` | OpenAI Codex Auth-Doku |
| Scope | `openid profile email offline_access` | OpenCode Codebase |
| PKCE | S256, mandatory | RFC 7636, OpenAI-Anforderung |
| Headless-OAuth | NICHT supported (Issue #2798 offen) | OpenAI Codex Repo |

### Server-App-Pattern: SSH-Tunnel

OpenAI Codex Auth-Doku dokumentiert offiziell SSH-Tunnel-Pattern für VPS-Setups:

```bash
# User auf Mac/Laptop:
ssh -L 1455:localhost:1455 user@server

# Auf Server in SSH-Session:
pnpm twin:oauth-login --twin=@markus

# → öffnet auth.openai.com URL
# User pastet URL in lokalen Browser
# Login → OpenAI redirected zu localhost:1455
# SSH-Tunnel leitet zur VPS weiter
# Runtime empfängt Code, macht Token-Exchange
```

Pattern dokumentiert von Hermes Agent (140k Stars), Codex offizielle Doku, RooCode, OpenCode.

### Owner-Persona-Validierung

Power-User mit Subscription (Markus-Profil + HN-Audience):
- Hat ChatGPT Plus/Pro ($20-200/Monat)
- Nutzt API-Key parallel für CI/CD und programmatisch (~$10-50/Monat zusätzlich)
- 1000+ Messages/Monat via API-Key kostet substantiell mehr als Subscription
- SSH-Tunnel-Kompetenz ist Power-User-Standard

## Architektur-Setzungen

### §a — CLI-First UI-Pattern

`pnpm twin:oauth-login --twin=@markus` ist Primary-Trigger. Web-UI Settings-Page zeigt nur Status (Connected / API-Key / Not configured), nicht den Trigger.

Begründung: SSH-Tunnel braucht eh Shell, User ist eh in Session. Web-UI-Trigger schafft Cross-Origin-Loopback-Problem (Web-UI auf app.domain.tld kann localhost:1455-Listener nicht triggern).

Matches Hermes' `hermes auth` Pattern.

**Bau-Granularität (Tag 27 Setzung):** Phase 3 wird als Spike-First gebaut, nicht als ein Block. Walking-Skeleton beweist Architektur, dann inkrementeller Ausbau in Sub-Phasen 3.1-3.4. Siehe §i für Sub-Phase-Sequenz.

### §b — Exklusiver Auth-Mode pro Twin

`twins.auth_mode` ist either `api_key` or `oauth`, nicht beides. Switch in Settings löscht alten Auth-Modus.

Begründung: State-Machine bleibt thin. Wenn OAuth-Refresh failt, ist das System-Signal das User-Attention braucht (Subscription-Status), kein stilles Failover.

### §c — Dedicated oauth_tokens-Tabelle (Migration 025)

```sql
CREATE TABLE oauth_tokens (
  id TEXT PRIMARY KEY,
  twin_id TEXT NOT NULL REFERENCES twins(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK(provider IN ('openai')),  -- discriminator für Phase B
  access_token TEXT NOT NULL,  -- encrypted AES-256-GCM
  refresh_token TEXT NOT NULL,  -- encrypted AES-256-GCM
  expires_at TEXT NOT NULL,  -- ISO 8601
  account_id TEXT,  -- aus access-Token extracted
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_oauth_tokens_twin_id ON oauth_tokens(twin_id);
CREATE UNIQUE INDEX idx_oauth_tokens_twin_provider ON oauth_tokens(twin_id, provider);
```

Plus Migration `twins.auth_mode TEXT NOT NULL DEFAULT 'api_key'` Spalte.

### §d — Refresh-Service mit Lazy-Fallback

Background-Refresh-Loop pollt alle 60 Sek auf nahe Expiry. Lazy-Fallback: bei Request-Time check expiry, refresh wenn < 5 Min remaining.

File-Lock-Pattern (analog OpenClaw-Doku) für Concurrent-Refresh-Prevention.

### §e — OpenRouter-Fallback dokumentiert, nicht code-implementiert

`docs/DEPLOYMENT.md` und Strategy-Doc dokumentieren OpenRouter als Alternative für User ohne SSH-Tunnel-Komfort:

```env
ACTIVE_PROVIDER=openai
OPENAI_API_KEY=sk-or-v1-... # OpenRouter-Key
OPENAI_BASE_URL=https://openrouter.ai/api/v1
```

OpenRouter ist OpenAI-API-kompatibel, kein Twin-Lab-Refactor nötig. Existing Provider-Abstraktion handles das via Env-Override.

### §f — Owner-Trust-Statement bleibt persistent

Token-Refresh-Failure invalidiert Twin nicht. Twin antwortet mit User-Facing-Error („Bitte erneut authentifizieren: `pnpm twin:oauth-login --twin=@markus`"), Auth-Mode bleibt `oauth`.

Analog #130 §h (Persistent-Pairing): User-Trust ist persistent, nicht Session-State.

## §g — Codex-Endpoint-Architektur (Tag 27 Nachmittag-Findings)

OAuth-Token funktioniert NICHT mit Standard-OpenAI-API (`api.openai.com/v1/*`).
Codex-spezifischer Backend-Endpoint ist erforderlich:

**Endpoint:** `POST https://chatgpt.com/backend-api/codex/responses`

**Request-Schema (OpenAI Responses API, nicht Chat-Completions):**
- `model`: z.B. `gpt-5.5`, `gpt-5.3-codex`
- `instructions`: System-Prompt (Codex-spezifisch, Pflicht-Field)
- `input`: Array von Messages mit `type`/`role`/`content`
- `tools`, `tool_choice`, `parallel_tool_calls`
- `store: false`, `stream: true` (Pflicht für Subscription-Auth)

**Required Headers:**
- `Authorization: Bearer <access_token>`
- `Content-Type: application/json`
- `OpenAI-Beta: responses=v1`

**Response:** SSE-Stream mit `event: response.created`, `response.output_item.added`,
`response.completed`, plus Cloudflare `__cf_bm` Bot-Management-Cookie.

**Response-Headers (Pro-Plan):**
- `x-codex-plan-type: pro`
- `x-codex-active-limit: premium`
- `x-codex-bengalfox-limit-name: GPT-5.3-Codex-Spark` (Rate-Limit-Tracking)

**Quellen:**
- Reverse-Engineering: Simon Willison (Nov 2025), HuggingFace codex-proxy
- Pre-Flight verifiziert Tag 27: Test 1 (curl Mac), Test 2 (Production-Container), Test 3 (Node native fetch) alle HTTP 200

## §h — Cloudflare-TLS-Pre-Flight (Tag 27 Nachmittag)

Codex-CLI nutzt curl-FFI/rustls für TLS-Fingerprint-Bypass weil Cloudflare
viele non-browser TLS-Stacks blockt. Pre-Flight-Test hat verifiziert dass
Node.js v22 native fetch durchgelassen wird:

| Test | Status | Latenz |
|---|---|---|
| Local curl Mac | HTTP 200 | 1556ms |
| Production-Container (Node 20-slim, VPS 31.97.78.73) | HTTP 200 | 2976ms |
| Local Node v22 native fetch | HTTP 200 | 537ms |

**Implikation:** Phase 3 baut mit Vanilla-Node-fetch. Kein curl-Subprocess,
kein Bun-Migration, kein TLS-Fingerprint-Workaround nötig.

**Cloudflare-Bot-Management-Detail:** `__cf_bm` Cookie wird gesetzt aber nicht
geblockt. Best-Practice für Production: Cookie-Jar pro Twin reusen über
Requests hinweg (reduziert Re-Inspection-Overhead).

## §i — Phase 3 Sub-Phase-Sequenz (Tag 27 Setzung)

Phase 3 (Provider-Auth-Mode-Switch + Codex-Adapter) ist substantieller als
initial geschätzt. Re-Estimate: XL → XXL. Bau in Sub-Phasen:

| Sub-Phase | Was | Aufwand | Status |
|---|---|---|---|
| **3.0 Spike** (Tag 27 Vormittag/Nachmittag) | Direct-fetch Codex-Adapter, Minimal-Instructions, Twin-Chat-API gepatcht für oauth-Branch, Pre-Flight via existing Mock-Token | 2-4h | ✅ Commit `7b8aae4` + STAND-Smoke-2 `ad48c5d` |
| **3.1.1 SSE-Parser standalone** (Tag 27 Nachmittag) | CodexSSEParser mit Hybrid-Approach (Discriminated-Union + generic Fallback), 8/8 Smoke | 1-1.5h | ✅ Commit `75d166d` |
| **3.1.2 SSE-Integration + Retry** (Tag 27 Nachmittag) | CodexHttpError + isRetryableError + withRetry (3 Retries, Backoff 1s/2s/4s, Full-Restart), 11/11 Retry-Smoke + End-to-End-Smoke | 2-3h | ✅ Commit `707f941` |
| **3.2 Codex-System-Prompt + Persona-Mapping** (Tag 27 Nachmittag) | `composeOwnerSystemPrompt`-Helper extrahiert (Drift-Prevention zwischen Vercel-SDK- und Codex-Pfad), runModelViaCodex erweitert (persona + factsBlock + episodicBlock + summaryBlock + extraSystem), CodexAdapter wird reiner HTTP-Client (pre-built instructions + input), CodexInputItem-Type exportiert, Smoke 3 End-to-End grün mit klarer Markus-Persona | ~2h | ✅ Commit `a949b7e` |
| **3.3.0 Spike Tool-Call-Discovery** (Tag 27 Abend) | Raw-fetch + Mock-Function-Tool, alle SSE-Events captured → §k dokumentiert Event-Format vollständig (7 distinct types, 14 Events, 2 IDs pro Tool-Call) | ~1h | ✅ Commit `9fa266a` |
| **3.3.2 Spike Multi-Step-Roundtrip** (Tag 27 Abend) | Drei Hypothesen sequenziell — HYPOTHESE A (function_call_output im input-Array) gewinnt First-Try, Tool-Result-Format verifiziert, alle 5 Bonus-Discovery-Events aus 3.1.2 jetzt zugeordnet → §l | ~45 Min | ✅ Commit `e4d403a` |
| **3.3.1 Parser-Erweiterung + MCP-Pipeline-Mapping** (Tag 28) | CodexSSEParser um function_call-Events erweitern (item.type-Discrimination), `mapSkillsToCodexTools`-Helper (~30 LoC), runModelViaCodex Tools durchreichen (skillsBlock + toolUseDirective composeOwnerSystemPrompt-Parameter aktivieren), Mapping auf AuditMcpToolUseInputSchema + optionales `codexCallId` für Resume-Pfad, Approval-Pipeline-Branch für provider=openai-codex | 1-2 Tage | offen, mit verifizierten §k + §l Format-Hypothesen |
| **3.3.3 Reasoning-Traces** (Tag 29, optional) | reasoning-Item-Type handlen, Audit-Persistenz | 0.5 Tag | offen |
| **3.4 Vercel-Provider-Refactor** (optional, Tag 29-30) | Direct-fetch zu sauberem Vercel-AI-SDK-Custom-Provider migrieren | 1 Tag | offen |

**Stop-Punkte:** jede Sub-Phase mit eigenem Commit + Smoke. Wenn 3.0 Spike fails:
Diagnose-Output statt blinder Weiter-Bau.

**LLM-Client-Integration (Sub-Phase 3.0):** Direct-fetch im LLM-Client mit
Branch nach `twin.auth_mode`. Vercel-AI-SDK-Provider-Integration ist Sub-Phase
3.4 (optional, falls Direct-fetch sich als sauber genug erweist kann 3.4 entfallen).

**Phase-3.3-Eingangsdaten (Bonus-Discovery aus 3.1.2-End-to-End-Smoke):** der
Hybrid-Fallback im SSE-Parser hat folgende Codex-Event-Types in der Wildbahn
captured, die heute via `unknownEventTypes` im Audit landen und Phase 3.3 als
Reverse-Engineering-Daten für Tool-Call- bzw. Content-Part-Handling dienen:

- `response.in_progress`
- `response.output_item.done`
- `response.content_part.added`
- `response.output_text.done`
- `response.content_part.done`

Details und Audit-Beleg siehe STAND.md Tag 27 (Sub-Section „Phase 3.1 Komplett — Bonus-Discovery").

## §j — Risiko-Assessment (Tag 27 Nachmittag)

### Risiko 1: ToS-Grauzone

Codex-OAuth-Token-Reuse für 3rd-Party-Apps ist nicht offiziell dokumentiert.
Existing Implementations (Hermes, OpenClaw, RooCode, openai-oauth) sind
explicit "personal use only" — Twin-Lab als Self-Hosted-Server-App ist
Reverse-Engineering-Tolerance-Zone.

**Mitigation:**
- Tos-Disclaimer in Settings-UI prominent (Phase 5)
- Monitoring auf 4xx/403 Responses (Phase 3.1)
- OpenRouter-Fallback dokumentiert (existing §e)

### Risiko 2: Pattern-Block

Präzedenz: Anthropic hat April 2026 Claude-Pro/Max-OAuth-Pattern für
3rd-Party-Tools geblockt. OpenAI könnte gleiches machen.

**Mitigation:**
- BYOK-API-Key + OpenRouter-Fallback bleiben funktional
- Phase-1+2 (OAuth-Foundation) ist generisch genug für andere OAuth-Provider
- Closed-Beta-Approach: kein massiv-User-facing Marketing für OAuth-Feature
  bis Pattern stabil

### Risiko 3: Codex-Endpoint-Format-Changes

OpenAI kann Codex-Request/Response-Schema jederzeit ändern. Existing CLI-User
sind affected, Twin-Lab müsste nachziehen.

**Mitigation:**
- Monitoring auf neue Codex-CLI-Releases (changelog watch)
- Sub-Phase 3.4 Custom-Vercel-Provider isoliert das Format-Mapping

## §k — Codex-Tool-Call-Event-Format (Phase 3.3.0 Spike-Discovery, Tag 27)

Phase 3.3.0 Spike-Script (`apps/runtime/src/scripts/test-oauth-phase3-3-spike.ts`)
hat einen Codex-Tool-Call mit einer Mock-Function-Definition
(`get_current_time`) provoziert und alle SSE-Events captured. Token kommt
direkt aus `~/.codex/auth.json` (Memory-Setzung „Discovery-Spikes lesen
Token direkt, Production-Tests gehen über DB"). Ergebnis: HTTP 200 in
1641ms, 14 SSE-Event-Blöcke, 7 distinct Event-Types — Tool-Call vollständig
in 1 Roundtrip.

### Event-Type-Histogram (1 Tool-Call)

```
  8× response.function_call_arguments.delta
  1× response.created
  1× response.in_progress
  1× response.output_item.added
  1× response.function_call_arguments.done
  1× response.output_item.done
  1× response.completed
```

**Drei neue Event-Types** gegenüber Phase 3.1/3.2 Text-Response-Smokes:

| Event-Type | Rolle |
|---|---|
| `response.output_item.added` mit `item.type === "function_call"` | Tool-Call-Item beginnt — liefert `item.id`, `call_id`, `name`, leere `arguments` |
| `response.function_call_arguments.delta` | Streaming-Chunks der Argument-JSON (analog `response.output_text.delta` für Text) |
| `response.function_call_arguments.done` | Vollständige `arguments` JSON-Strings — Sanity-Check + endgültige Verarbeitung |

Plus zwei bereits-bekannte Events aus Phase-3.1.2-Bonus-Discovery werden
hier auch genutzt: `response.in_progress` (Status-Marker nach `created`)
und `response.output_item.done` (Tool-Call-Item-Termination).

### Tool-Call-Item-Schema

```jsonc
// response.output_item.added (Tool-Call beginnt):
{
  "type": "response.output_item.added",
  "item": {
    "id": "fc_0197bf7b85ec9e8a016a14290556248191b24052b4b1d981b8",
    "type": "function_call",
    "status": "in_progress",
    "arguments": "",
    "call_id": "call_RsYWsp6Sy4tDGgMvkppxtpgY",
    "name": "get_current_time"
  },
  "output_index": 0,
  "sequence_number": 2
}

// response.function_call_arguments.delta (Streaming):
{
  "type": "response.function_call_arguments.delta",
  "delta": "{\"",
  "item_id": "fc_0197bf7b85ec9e8a016a14290556248191b24052b4b1d981b8",
  "obfuscation": "wYxgfYE2hCGmVn",
  "output_index": 0,
  "sequence_number": 3
}

// response.function_call_arguments.done (Vollständig):
{
  "type": "response.function_call_arguments.done",
  "arguments": "{\"timezone\":\"Europe/Berlin\"}",
  "item_id": "fc_0197bf7b85ec9e8a016a14290556248191b24052b4b1d981b8",
  "output_index": 0,
  "sequence_number": 11
}

// response.output_item.done (Tool-Call abgeschlossen):
{
  "type": "response.output_item.done",
  "item": {
    "id": "fc_0197bf7b85ec9e8a016a14290556248191b24052b4b1d981b8",
    "type": "function_call",
    "status": "completed",
    "arguments": "{\"timezone\":\"Europe/Berlin\"}",
    "call_id": "call_RsYWsp6Sy4tDGgMvkppxtpgY",
    "name": "get_current_time"
  },
  "output_index": 0,
  "sequence_number": 12
}
```

### Substantielle Findings für Phase 3.3.1

1. **Zwei IDs pro Tool-Call:** `item.id` (Codex-internes Item-Tracking,
   Format `fc_...`) vs. `call_id` (Tool-Call-Referenz, Format `call_...`).
   `call_id` wird vermutlich beim Tool-Result-Return als Reference benötigt
   (Codex-Multi-Step-Pattern wie OpenAI Responses API Standard).
2. **Arguments sind JSON-String, nicht Object** — Phase 3.3.1 muss
   `JSON.parse(item.arguments)` vor Mapping auf
   `AuditMcpToolUseInputSchema.toolCall.args` (das ist
   `Record<string, unknown>`).
3. **`strict: true` wurde Codex auto-ergänzt** zum Tool-Schema (siehe
   `response.created.tools[0].strict`). Phase 3.3.1 muss prüfen ob das
   die Strict-Mode-Konvention triggern könnte (zusätzliche Validation
   server-side).
4. **`obfuscation`-Field** auf jedem `function_call_arguments.delta` —
   vermutlich Cloudflare-Bot-Management-Counterpart zu `__cf_bm`. Kein
   Decoding nötig, einfach ignorieren.
5. **`output_index: 0`** auf allen Tool-Call-Events — bei
   `parallel_tool_calls: true` würden mehrere Tool-Calls mit verschiedenen
   `output_index`-Werten parallel streamen. Phase 3.3 hat parallel=false
   gesetzt, kein Multi-Index-Handling nötig (kann später nachgezogen
   werden).
6. **Keine Reasoning-Traces in diesem Smoke** trotz
   `reasoning.effort: "medium"` im response.created-Body. Wenn Reasoning
   getriggert wird, kommt es vermutlich als eigenes `output_item.added`
   mit `item.type === "reasoning"`. Phase 3.3 ignoriert Reasoning bewusst
   (Spike-Disziplin) — falls Reasoning-Events auftauchen, in
   `unknownEventTypes` capturen wie Phase 3.1.2.
7. **`usage`-Field** in `response.completed`: `input_tokens: 194`,
   `output_tokens: 22`, `total_tokens: 216`. Wäre wertvoll für
   Audit-Persistenz (Cost-Tracking) — Sub-Phase 3.4 (Vercel-Provider)
   oder eigene Phase 3.5 könnte das nachziehen.

### Phase-3.3.1-Mapping-Hypothese auf existing MCP-Pipeline

Ziel: Codex-Tool-Call auf existing `AuditMcpToolUseInputSchema` mappen
(siehe `packages/shared/src/index.ts:383`), damit die Approval-Pipeline
(`/audit/:id/approve`) und MCP-Tool-Execution unverändert greifen.

```typescript
// Mapping-Skizze für Phase 3.3.1:
const codexCall = {
  itemId: "fc_...",        // aus response.output_item.added/done
  callId: "call_...",      // aus item.call_id
  toolName: "get_current_time",  // aus item.name
  argumentsJson: "{...}",  // aus item.arguments (oder done-Event)
};
const args = JSON.parse(codexCall.argumentsJson);

// Skills-Repo-Lookup: toolName ist der human-readable Skill-Name —
// braucht Reverse-Lookup auf {mcpServerId, mcpToolName}-Tupel via
// Skills-Tabelle.
const skill = skillsRepo.findByDisplayName(twinId, codexCall.toolName);
// → mcpServerId, mcpToolName extrahieren

// AuditMcpToolUseInputSchema bauen:
const auditInput: AuditMcpToolUseInput = {
  messages: [...],
  toolCall: {
    mcpServerId: skill.mcpServerId,
    mcpToolName: skill.mcpToolName,
    args,
  },
  conversationId,
  pendingReply: "...",
};
```

**Offene Frage Phase 3.3.1:** Multi-Step-Round-Trip. Nach Tool-Result
muss ein neuer Codex-Request mit dem Result als `input`-Item vom Type
`function_call_output` gesendet werden — Schema dafür ist noch nicht
verifiziert (Spike 3.3.0 stoppt nach erstem Tool-Call). Bau-Briefing
Phase 3.3.1 muss das als eigenen Sub-Spike adressieren oder via
OpenAI-Responses-API-Doku-Recherche klären.

### Parser-Erweiterungs-Plan Phase 3.3.1

CodexSSEParser bekommt:
- Discriminated-Union erweitern: `response.output_item.added` mit
  `item: { type: "function_call" | "message" | ... }`-Refinement
- 2 neue Cases: `response.function_call_arguments.delta` + `.done`
- 1 erweiterter Case: `response.output_item.done` (heute No-op)
- Neuer State: `toolCallsInProgress: Map<itemId, { name, callId,
  argumentsBuffer }>` für Streaming-Akkumulation
- Neues Result-Field: `toolCalls: Array<{ itemId, callId, name, arguments
  }>` (arguments als parsed Object, nicht JSON-String — Caller-Convenience)

Plus Schicht 3+4 im Codex-Pfad nachziehen (`composeOwnerSystemPrompt`
unterstützt `skillsBlock` + `toolUseDirective` bereits — `runModelViaCodex`
muss sie aus dem Call-Site (`runModel` Z. 1610) durchreichen, plus
Mock-Skill-Set aus TwinService an CodexAdapter geben).

## §l — Codex-Tool-Result-Multi-Step-Roundtrip (Phase 3.3.2 Spike-Discovery, Tag 27)

Phase 3.3.2 Spike-Script (`apps/runtime/src/scripts/test-oauth-phase3-3-2-spike.ts`)
hat drei Multi-Step-Hypothesen sequenziell getestet. **HYPOTHESE A
(function_call_output im input-Array) funktioniert beim ersten Versuch** —
HTTP 200 in 521ms, finale Text-Antwort „It's 14:30 in Berlin right now."
korrekt aus Mock-Tool-Output abgeleitet. Hypothesen B (`previous_response_id`)
und C (context-fallback) wurden nicht gebraucht.

### Multi-Step-Request-Format (verified)

```jsonc
{
  "model": "gpt-5.5",
  "instructions": "<gleicher System-Prompt wie Step 1>",
  "input": [
    {
      "type": "message",
      "role": "user",
      "content": [{ "type": "input_text", "text": "What time is it in Berlin?" }]
    },
    {
      "type": "function_call",
      "call_id": "call_Do3rCLT9GQVYP8dDpprtmuVy",
      "name": "get_current_time",
      "arguments": "{\"timezone\":\"Europe/Berlin\"}"
    },
    {
      "type": "function_call_output",
      "call_id": "call_Do3rCLT9GQVYP8dDpprtmuVy",
      "output": "{\"time\":\"2026-05-25T14:30:00+02:00\",\"timezone\":\"Europe/Berlin\"}"
    }
  ],
  "tools": [<gleiche Tool-Definitionen wie Step 1>],
  "tool_choice": "auto",
  "parallel_tool_calls": false,
  "store": false,
  "stream": true
}
```

**Substantielle Findings:**

1. **`store: false` ist OK für Multi-Step.** Kein Codex-Side-State-
   Management nötig — alles im Request-Body. Twin-Lab-Pattern bleibt
   stateless (matched existing `store: false`-Setzung aus Phase 3.0).
2. **`call_id` (NICHT `item.id`/`fc_...`) ist die Cross-Reference** zwischen
   `function_call` und `function_call_output`. Bestätigt §k-Hypothese.
3. **`previous_response_id` nicht notwendig** für Multi-Step. Wäre
   incompatible mit `store: false` ohnehin (Codex müsste den voherigen
   Response-State irgendwo halten).
4. **Echo-Pattern:** Der `function_call`-Item im input-Array ist ein
   Echo des LLM-Outputs aus Step 1 (gleiches `call_id`, `name`,
   `arguments`). Phase 3.3.1 muss diese Daten beim Tool-Result-Resume
   verfügbar haben — Persistenz im Pending-Audit ist notwendig.
5. **`tools`-Field muss wiederholt werden** im Multi-Step-Request (sonst
   weiß Codex nicht, dass `function_call_output` zu einem function-Tool
   gehört). Caller darf den Tool-Set nicht weglassen.

### Final-Antwort-Event-Sequenz (19 Events, 9 distinct Types)

```
  11× response.output_text.delta
   1× response.created
   1× response.in_progress
   1× response.output_item.added       (item.type === "message")
   1× response.content_part.added
   1× response.output_text.done
   1× response.content_part.done
   1× response.output_item.done        (item.type === "message")
   1× response.completed
```

**Alle 5 Phase-3.1.2-Bonus-Discovery-Event-Types sind jetzt zugeordnet:**

| Event-Type | Zugehörige Phase | Rolle |
|---|---|---|
| `response.in_progress` | beide | Status-Marker nach `response.created`, identisches Body |
| `response.output_item.added` | beide | Item-Lifecycle-Start — `item.type` discriminiert `message` (Text) vs `function_call` (Tool-Call) |
| `response.output_item.done` | beide | Item-Lifecycle-Ende, finaler item-State (für message: vollständiger Text) |
| `response.content_part.added` | nur Text | Content-Part innerhalb eines `message`-Items beginnt — bei `function_call`-Items fehlt das |
| `response.content_part.done` | nur Text | Content-Part-Ende mit finalem text-String |
| `response.output_text.done` | nur Text | Text-Akkumulation-Final-Marker mit komplettem Text-Field |

### Message-Item-Schema (Text-Response)

```jsonc
// response.output_item.added (Text-Antwort beginnt):
{
  "type": "response.output_item.added",
  "item": {
    "id": "msg_0bf1b80cddd67e5f016a142c8bf1fc8191a6b9c8febd0fa282",
    "type": "message",
    "status": "in_progress",
    "content": [],
    "phase": "final_answer",     // bemerkenswert: Codex markiert Phase
    "role": "assistant"
  },
  "output_index": 0,
  "sequence_number": 2
}

// response.content_part.added (Text-Part beginnt):
{
  "type": "response.content_part.added",
  "content_index": 0,
  "item_id": "msg_...",
  "output_index": 0,
  "part": {
    "type": "output_text",
    "annotations": [],
    "logprobs": [],
    "text": ""
  },
  "sequence_number": 3
}

// response.output_text.done (vollständiger Text):
{
  "type": "response.output_text.done",
  "content_index": 0,
  "item_id": "msg_...",
  "output_index": 0,
  "sequence_number": 15,
  "text": "It's 14:30 in Berlin right now."
}
```

### Phase-3.3.1-Bau-Implikationen

**CodexSSEParser:** Item-Type-Discrimination in `response.output_item.added`/`.done`
muss zwei Branches haben:
- `item.type === "function_call"` → existing §k-Tool-Call-Akkumulation
- `item.type === "message"` → No-op (Text wird via `output_text.delta`
  akkumuliert, das funktioniert schon)

**Multi-Step-State im Codex-Adapter:** Der Adapter muss zwischen zwei
Modi unterscheiden:
- **Initial-Request:** `messages` (User-Input) → `input`-Array,
  optional `tools` falls Skills aktiv
- **Resume-Request:** `messages` + `function_call`-Echo (aus Pending-
  Audit) + `function_call_output` (Tool-Result) → `input`-Array,
  gleiche `tools`

**`mapSkillsToCodexTools`-Helper** (ca. 30 LoC, parallel zu existing
`buildMcpToolsFromSkills` — siehe §i Phase-3.3.1-Notiz):

```typescript
// Skizze:
function mapSkillsToCodexTools(skills: Skill[]): CodexToolDefinition[] {
  return skills
    .filter((s) => s.source === "mcp" && s.isActive && s.mcpInputSchema)
    .map((s) => ({
      type: "function",
      name: s.name.replaceAll(":", "_"),   // gleiche toolKey-Convention wie buildMcpToolsFromSkills
      description: s.manifestJson.description ?? `MCP tool: ${s.mcpToolName}`,
      parameters: s.manifestJson.mcpInputSchema as JsonSchema,
    }));
}
```

**call_id-Persistenz für Resume-Pfad:** Option (a) aus Diagnose 3.3.2.1.B
— Pending-Audit-Input erweitern um optionales `codexCallId` (oder
`providerCallId` für Provider-Agnostik). Migration in Phase 3.3.1
trivial, da `AuditMcpToolUseInputSchema` heute keine Codex-spezifischen
Felder hat.

**Approval-Pipeline-Integration:** existing `/audit/:id/approve`-Route
ruft Tool-Execution + neuen Resume-LLM-Call. Phase 3.3.1 muss den
Resume-Branch zwei Pfade unterstützen lassen:
- `provider: anthropic|openai-api` → existing AI-SDK-Resume mit
  `tool_result`-Message in History
- `provider: openai-codex` → neuer CodexAdapter-Call mit
  `function_call_output`-Item im input-Array

## §m — Approval-Pipeline-Reverse-Engineering (Phase 3.3.1.3.0 Diagnose, Tag 28)

**Scope:** PURE DIAGNOSE, kein Code. Vorarbeit für Phase 3.3.1.3.1
(Approval-Wait für Codex-Pfad). Klärt: wie macht der reguläre Vercel-SDK-Pfad
heute Pending-State + User-UI-Wait + Resume?

### Finding A — Approval-Trigger via Marker-Pattern (kein Throw)

AI SDK 6 **schluckt** `execute()`-Throws aus `tool({...})`-Definitions
und reicht sie als `output:null` tool-result an den LLM weiter
(`apps/runtime/src/mcp/tool-bridge.ts:9-17`). Throw-Pfad würde nie nach oben
propagieren — Smoke-Test Tag-10 hat das verifiziert.

**Stattdessen:** Marker-Pattern. `tool-bridge.ts:134-148` returnt für
`requiresApproval=true`-Skills einen strukturierten Marker:

```ts
return {
  content: [{ type: "text", text: MCP_PENDING_APPROVAL_MARKER }],
  isError: false,
};
```

`MCP_PENDING_APPROVAL_MARKER = "__MCP_PENDING_APPROVAL__"`. Twin-Service
detected den Marker post-`generateText` mit `detectPendingToolCall`
(`twin-service.ts:2314-2350`), wirft lokal `McpToolApprovalRequiredError`
und der existierende Catch in `runOwnerDirect` (`twin-service.ts:728-759`)
baut den Pending-Audit.

**Defense-in-Depth:** `stopOnPendingApprovalMarker`-StopCondition
(`twin-service.ts:2296-2312`) bricht den Multi-Step-Loop ab, sobald ein
Tool-Result im gerade fertiggestellten Step den Marker enthält — sonst
würde AI SDK aus dem Marker eine Synthese-Antwort generieren.

**AuditStatus-State-Machine** (`packages/shared/src/index.ts` + Audit-
Service `apps/runtime/src/audit/service.ts:13-14`):
```
pending → approved → executed
       ↘ rejected
       ↘ failed
       ↘ blocked
```
`start({initialStatus: "pending"})` legt einen Pending-Audit ohne LLM-Call
an; `complete()`/`fail()`/`reject()` transitionieren weiter.

### Finding B — Pending-Persistence: vollständiger Resume-Context in audit.input

Live-Inspektion eines mcp-tool-use-Audits (`audit_xNCqkfwJGjLO`):

```jsonc
{
  "capability": "mcp-tool-use",
  "status": "executed",      // war "pending" bis User-Approve
  "input": {
    "messages": [...],         // komplette History bis Tool-Call (Resume-Context)
    "lastMessage": "...",
    "toolCall": {              // Re-Play-Datum
      "mcpServerId": "mcp_5gdVaHNu2CA4RvLF",
      "mcpToolName": "scrape_webpage",
      "args": {...}
    },
    "conversationId": "conv_gpWMtoeSM4ryHRJZ",
    "pendingReply": "Ich möchte das Tool ... brauche aber deine Genehmigung. Bitte schau in der Inbox.",
    "originalCapability": "respond_to_chat"
  },
  "output": {                  // nach Approve+Execute befüllt
    "reply": "...",            // finale LLM-Antwort
    "toolCall": {...},
    "toolResult": [{"type": "text", "text": "..."}],
    "toolIsError": false,
    "providerMetadata": {...}
  }
}
```

**Wichtig:** Pending-Audit-Insert passiert **nach** dem Marker-Detect,
nicht vor `runModel`. Begründung `twin-service.ts:614-618`:
> audit.start() vor runModel würde bei Approval-Pending einen
> executed-then-failed-Zwischenstate hinterlassen. Stattdessen erst
> runModel versuchen — wenn Approval-Pending, dann mcp-tool-use-Audit;
> sonst owner-direct-Audit. Konsistente Audit-Trail-Reihenfolge.

**State ist Server-Restart-stabil** — alles was Resume braucht
(`messages` als komplette LLM-Konversation, `toolCall` als Re-Play-Datum)
liegt im DB-`data`-Feld.

### Finding C — Resume-API: synchroner LLM-Call nach Approve

**Endpoint:** `POST /twins/:handle/audit/:id/approve` (twin-namespaced,
`apps/runtime/src/server.ts:370-388`) plus Legacy-Variante `POST
/audit/:id/approve` (`server.ts:531-543`). Reject-Endpoints analog.

**Capability-Switch in `approvePending`** (`twin-service.ts:1001-1022`):
```
respond_to_twin_message → approveTwinResponse
send_to_twin            → approveTwinSend
mcp-tool-use            → approveMcpToolUse  ← relevant für Codex-Pfad
semantic-fact-write     → approveSemanticFactWrite
default                 → approveDefault
```

**`approveMcpToolUse`** (`twin-service.ts:1119-1179`) in 3 Schritten,
**synchron** im HTTP-Request:

1. **Tool-Execution via `mcpManager.callTool`** — kein Approval-Recheck
   (User hat durch Approve genehmigt).
2. **Resume-LLM-Call** mit Original-History plus angehängter User-Message:
   ```
   [System] Tool 'X' wurde ausgeführt. Ergebnis: <stringified>.
   Bitte gib jetzt die finale Antwort an den User basierend auf diesem Ergebnis.
   ```
   `runModel` läuft mit **enableMcpTools: false** (Default) — wir wollen
   keine zweite Tool-Use-Iteration im Resume; LLM antwortet nur mit Text.
3. **`audit.complete`** mit `{reply, toolCall, toolResult, toolIsError,
   providerMetadata}` → Status `executed`.

**Reject-Pfad** (`twin-service.ts:1068-1102`) macht analog Resume-Call mit
"Tool wurde abgelehnt. Begründung: {reason}. Bitte antworte direkt." →
`output.reply + rejected:true`, Status bleibt `rejected`.

**Race-Sicherheit:** `approvePending` prüft `entry.status !== "pending"`
und wirft sonst (`twin-service.ts:1004-1006`) — Double-Approve klickt
keine Doppel-Execution.

### Finding D — Frontend: SSE-getriebenes Audit-Stream-SSoT (kein Polling)

**Audit-Stream als SSoT für Chat-View** (`apps/web/app/chat/[handle]/
page.tsx:1184-1186`):
> 3.2.G: in beiden Fällen (pending oder direct reply) reload — der
> Audit-Stream ist Single-Source-of-Truth fürs Rendering.

Render-Mapping (`page.tsx:868-870`):
- `mcp-tool-use/pending`  → user + assistant(pendingReply) + tool-call(pending)
- `mcp-tool-use/executed` → user + assistant(pendingReply) + tool-call(executed) + assistant(finalReply)
- `mcp-tool-use/rejected` → user + assistant(pendingReply) + tool-call(rejected) + assistant(rejectReply)

**SSE-Updates** (`page.tsx` + `TopNav.tsx:111-112`): `pending-added` /
`pending-resolved`-Events triggern `loadAudits()`-Reload. Inbox + Facts +
TopNav-Badges hängen am selben Stream — kein Polling, sondern SSE-Push.

**Approve-Button-Logic** (`page.tsx:1210-1228`): `POST /twins/.../audit/
:id/approve`, dann `loadAudits()` für State-Reset.

### Finding E — End-to-End-Flow (Vercel-SDK-Pfad)

```
1. User → POST /twins/:handle/chat: "scrape anthropic.com"
2. TwinService.runOwnerDirect:
   - history + lastUser → llmMessages
   - audit NICHT vorab geöffnet (nur bei Erfolg/Failure)
   - runModel(persona, llmMessages, {enableMcpTools: true})
       ↓
3. runModel: generateText({tools: mcpTools, stopWhen: [stepCountIs(5),
                                                       stopOnPendingApprovalMarker]})
   - LLM ruft scrape_webpage (requiresApproval=true)
   - tool-bridge.execute() returnt MCP_PENDING_APPROVAL_MARKER
   - stopOnPendingApprovalMarker bricht Loop ab (Schritt 0+1)
   - detectPendingToolCall scannt result.steps[*] → findet Marker
   - wirft McpToolApprovalRequiredError
       ↓
4. runOwnerDirect Catch:
   - composeToolApprovalRequest → pendingReply
   - audit.start({capability: "mcp-tool-use", initialStatus: "pending",
                   input: {messages, lastMessage, toolCall, conversationId,
                           pendingReply, originalCapability}})
   - EventBus: pending-added → SSE
   - return {message: {assistant, pendingReply}, auditId, pending: true}
       ↓
5. Frontend: SSE pending-added → loadAudits() → Render mit Approve/Reject-Buttons
       ↓
6. User klickt Approve → POST /twins/:handle/audit/:id/approve
       ↓
7. TwinService.approveMcpToolUse:
   - mcpManager.callTool(serverId, toolName, args) → toolResult
   - resumeMessages = [...input.messages, {role:"user", content:"[System]
                                            Tool 'X' wurde ausgeführt. ..."}]
   - runModel(persona, resumeMessages, {enableMcpTools: false})
   - audit.complete({reply, toolCall, toolResult, toolIsError, providerMetadata})
   - EventBus: pending-resolved → SSE
       ↓
8. Frontend: SSE pending-resolved → loadAudits() → Render final reply
```

### Finding F — Codex-Pfad-Stand heute (Phase 3.3.1.2)

`runModelViaCodex` (`twin-service.ts:1499-1684`) hat **keinen Approval-
Pfad**. Substantielle Hinweise:

- `mapSkillsToCodexTools` (`codex-tool-mapper.ts:80-106`) filtert
  `source !== "mcp" || !isActive || !mcpServerId || !mcpToolName` —
  **filtert NICHT auf `requiresApproval`**. Comment in `twin-service.ts:
  1608-1611`:
  > requires_approval-Skills landen ohnehin nicht im Codex-tools-Field,
  > weil mapSkillsToCodexTools sie nicht zusätzlich filtert (TODO Phase
  > 3.3.1.3) — heute akzeptable Vereinfachung, weil der Smoke mit
  > no-approval-Tool läuft.

  Heisst: heute könnte Codex theoretisch ein `requires_approval=true`-Tool
  rufen → `mcpManager.callTool` würde direkt ausführen, ohne Approval.
  **Sicherheitslücke auf Pilot-Level, harmlos im Smoke-Setup.**

- Multi-Step-Pattern (`§l`): `function_call` + `function_call_output`
  werden ans `input`-Array für die nächste Iteration appended. Der
  input-Array lebt **nur im Loop**, kein DB-Persist.

### Hypothesen — Codex-Pfad-Approval-Integration

#### Hypothese 1: Async-Pending wie Vercel-SDK-Pfad (Architektur-Konsistenz)

**Idee:** runModelViaCodex bricht den Multi-Step-Loop ab, sobald Codex
ein `requires_approval=true`-Skill rufen will. Twin-Service legt
Pending-Audit (`mcp-tool-use`) an, exakt wie heute. `approveMcpToolUse`
verzweigt auf `twin.authMode`: bei `oauth` → Codex-Resume statt
AI-SDK-Resume.

**Pros:**
- Frontend-Surface (SSE, Audit-Stream, Approve-Button) erbt 1:1
- Server-Restart-Stabilität — Resume-Context in `audit.input` persistiert
- Konsistente UX für Multi-Twin-Setups mit gemischten Auth-Modi
- Pending-Audit-Insert-Logik in runOwnerDirect-Catch fast unverändert
  brauchbar (nur Catch-Quelle ändert sich: lokaler Pre-Check statt
  detectPendingToolCall)

**Cons:**
- `approveMcpToolUse` muss Switch auf `twin.authMode` →
  Resume-Funktions-Dispatch
- Codex-Resume-Context muss persistiert werden — siehe Schema-Notiz unten
- Multi-Tool-Approval (Codex ruft 2 Tools in einer Iteration, beide
  require approval) ist Edge-Case der heute schon im Vercel-Pfad als
  "erster Marker gewinnt" akzeptiert ist (`twin-service.ts:2255-2259`).
  Für Codex müssten wir entscheiden: alle pending → Multi-Audit oder
  erster wins.

#### Hypothese 2: Inline-Wait (HTTP-Long-Polling)

**Idee:** runModelViaCodex pollt DB nach Approval-Status, HTTP-Request
bleibt offen bis Approval.

**Cons:**
- Cloudflare-Edge ~100s Timeout (siehe §h) — Approval-Latency oft >100s
  (User in Inbox, Mobile)
- Long-Polling skaliert nicht
- Server-Restart während Wait → Tool-Call-State lost
- **Verworfen.**

#### Hypothese 3: Trust-Bypass-Mode (Skill-Level)

**Idee:** Owner-Trust-Setting pro Skill → skippt Approval für vertraute
Tools, sonst Hypothese 1.

**Pros:**
- UX-Reibung reduziert für High-Frequency-Tools (Web-Scrape, Search)
- Pattern-Parallele zu existierendem `trusted-bypass`-Capability für A2A
  (`twin-service.ts:2041-2042`)

**Cons:**
- Zusätzliche Schema-Surface (`mcp_skills.userTrusted` o.ä.) +
  UX-Komplexität (Skill-Toggle in Settings)
- Nicht Phase-3.3.1.3-Scope — eher Phase 4 oder BACKLOG (parallel zu §f
  Owner-Trust-Statement)

### Empfehlung Phase 3.3.1.3.1

**Hypothese 1 (Async-Pending wie Vercel-SDK-Pfad).** Code-Reuse ist
substantiell — Pending-Audit-Schema + Frontend-Render + Approve-Endpoint
sind 1:1 wiederverwendbar. Hauptaufwand sitzt in:

1. `mapSkillsToCodexTools` Filter-Param für `requiresApproval=true`
   (Pre-Filter raus aus tools-Field; alternative: Filter nicht-zwingend,
   Pending-Detect läuft im Loop pre-`callTool`).
2. **runModelViaCodex Pre-Call-Approval-Detect:** im Tool-Call-Loop vor
   `mcpManager.callTool` prüfen ob `skill.manifestJson.requiresApproval`.
   Falls true → break + throw `McpToolApprovalRequiredError` mit
   Codex-Resume-Context.
3. `approveMcpToolUse`-Dispatch auf `twin.authMode` →
   `resumeMcpToolUseViaCodex`-Funktion mit `function_call_output`-Append-
   Pattern aus §l und neuer `runModelViaCodex`-Iteration.

Hypothese 3 als BACKLOG-Idee festhalten — sinnvoll für Phase 4 oder
nach Pilot-Feedback.

### Audit-Schema-Surface-Notiz

`audit.input` für `mcp-tool-use`-Pending muss für Codex-Pfad zusätzlich
persistieren:

```jsonc
{
  // existing fields ...
  "messages": [...],
  "toolCall": {...},

  // NEU für Codex-Resume:
  "codexResumeContext": {
    "input": [...],              // CodexInputItem[] bis zum Tool-Call
                                  // (User-Message + ggf. function_call-Echos
                                  //  + function_call_output von Auto-Approve-
                                  //  Tools die VOR dem Approval-Tool kamen)
    "codexCallId": "call_...",   // Codex' call_id für function_call_output-Match
    "completedToolCalls": [...], // bisher in dieser Conversation erledigte
                                  // Tool-Calls (für AuditToolCall-Aggregation)
    "lastResponseId": "resp_...", // optional, falls Codex `previous_response_id`-
                                   // Resume später als Multi-Step-Alternative
                                   // genutzt wird (heute §l: input-Array reicht)
    "planType": "...",            // Token-Plan-Tracking über Iterationen
    "totalLatencyMs": ...         // Aggregat für Audit-Metadata
  }
}
```

`codexResumeContext` ist **rein additiv** — Vercel-SDK-Pfad ignoriert
das Feld, kein Migration nötig (alles in `audit.data`-JSON-Blob).
`approveMcpToolUse` liest das Feld nur wenn `twin.authMode === "oauth"`.

**Multi-Tool-Open-Question:** Codex-Iteration kann mehrere
`function_call`-Items pro Response liefern. Heute wird das pro Iteration
sequenziell ausgeführt (`twin-service.ts:1580`). Wenn der **zweite**
Tool-Call require approval und der **erste** nicht, dann:
- Erster Tool-Call ist schon ausgeführt → muss in `completedToolCalls`
- Resume nach Approval muss den Approval-Tool ausführen und dann mit
  beiden Outputs (auto-executed + approved) die nächste Codex-Iteration
  starten.

Vorschlag: **Erste Phase-3.3.1.3.1-Iteration auf Single-Tool-Pending
beschränken** (analog Vercel-SDK-"erster Marker gewinnt"). Multi-Tool-
Pending als Phase-3.3.1.3.2 / BACKLOG.

### Aufwand-Estimate Phase 3.3.1.3.1

**M (Medium): 1.5-2 Bautage**

| Block | Schätzung | Notiz |
|-------|-----------|-------|
| `mapSkillsToCodexTools` Filter-Param `requiresApproval=false` | 1h | Test-File anpassen |
| runModelViaCodex Pre-Call-Approval-Detect + Error-Throw | 2h | Single-Tool-Scope, Loop-Break |
| `audit.input.codexResumeContext` Schema + Persist | 1h | Additiv, kein Migration |
| `approveMcpToolUse` Switch auf authMode + `resumeMcpToolUseViaCodex` | 3h | §l-Pattern wiederverwenden |
| Reject-Pfad für Codex (Resume mit "abgelehnt"-Message) | 1.5h | Codex-Iteration mit Reject-Kontext |
| Smoke-Test: Approval-Roundtrip mit Codex-OAuth-Twin | 2h | Manuell via UI |
| Edge-Case: Multi-Step mit Auto-Tool + Approval-Tool danach | 2h | Reihenfolge-Stabilität |
| Doku §n + STAND + BACKLOG | 1h | Tag-28-Closure |

**Risiko-Notiz:** Codex' `previous_response_id` als Multi-Step-Resume-
Alternative wurde in §l-Spike nicht getestet (Hypothese A funktionierte
direkt). Falls `input`-Array-Re-Submit nach längerem Approval-Gap
Stability-Probleme zeigt, wäre `previous_response_id`-Resume Fallback —
addiert ~3h Spike-Aufwand. Heute akzeptables Risiko, weil Tag-27-§l
zeigt: `input`-Array-Re-Submit funktioniert robust (HTTP 200, 521ms).

### Diagnose-Stop

Phase 3.3.1.3.0 ist **abgeschlossen ohne Code-Bau**. Phase 3.3.1.3.1
braucht User-Bestätigung für Empfehlung (Hypothese 1) bevor Bau startet.

## §n — Codex-Pause-Pfad ✅ (Phase 3.3.1.3.1, Tag 27 Block 15)

**Scope:** Pause-Pfad isoliert — `runModelViaCodex` wirft
`McpToolApprovalRequiredError` (mit `codexResumeContext`-Snapshot)
sobald Codex ein `requiresApproval=true`-Skill aufruft, existierender
Vercel-SDK-Catch in `runOwnerDirect` persistiert Pending-Audit. Resume
ist **Phase 3.3.1.3.2** (folgt).

### Architektur (A) — Throw + Symmetrie zum Vercel-SDK-Pfad

§m hatte zwei Optionen — (A) Throw + Vercel-Catch-Reuse oder (B) Codex-
lokaler Pending-Insert. **Entschieden: (A).** Begründung:

- **Code-Reuse maximal:** der existierende Catch in
  `twin-service.ts:728-759` ändert sich nur um eine spread-conditional
  Zeile (`...(err.codexResumeContext ? { codexResumeContext: err.codexResumeContext } : {})`).
  Pending-Audit-Insert + SSE-Notify + UI-Render-Pfad sind 100% wiederverwendet.
- **Symmetrie:** beide Auth-Modi konvergieren auf denselben Error-Type
  und Persistenz-Pfad. Future-Pflege (z.B. neuer Pending-Reason) muss
  nur an einer Stelle.
- **Schema additiv:** kein Migration. `audit.input.codexResumeContext`
  ist optionales JSON-Field, Vercel-SDK-Pfad lässt es undefined,
  `AuditMcpToolUseInputShape` (lokal in twin-service.ts) um ein
  optionales Feld erweitert — `@twin-lab/shared`-`AuditMcpToolUseInputSchema`
  bleibt unverändert (validiert weiter den Kern-Pflichtsatz).

### Reihenfolge-treue Multi-Tool-Strategie (Option i)

Bei mehreren Tool-Calls in einer Codex-Iteration wird strikt sequentiell
verarbeitet (`for (const toolCall of result.toolCalls)`):

- Auto-Tools FRÜHER in der Iteration werden ausgeführt + an `input`
  appended (`function_call`+`function_call_output`-Paar pro Tool)
- Erstes Approval-Tool → `throw McpToolApprovalRequiredError` mit
  Snapshot vor dem function_call-Echo des Pending-Tools
- Restliche Tool-Calls dieser Iteration werden verworfen — bei Resume
  bekommt Codex die neue Iteration mit dem appended Pending-Output und
  kann den Plan ändern (Codex re-decided, was als nächstes nötig ist)

Matched existing Vercel-SDK "erster Marker gewinnt"-Semantik
(`twin-service.ts:2255-2259`). Multi-Approval-Tools-pro-Iteration-Edge-
Case → BACKLOG (siehe unten).

### 12-Felder-Resume-Context-Schema

Persistiert in `audit.input.codexResumeContext` (`apps/runtime/src/oauth/
codex-adapter.ts` — `CodexResumeContext`-Interface):

| Feld | Type | Zweck |
|------|------|-------|
| `pendingToolCall` | `{name, callId, arguments, itemId}` | Codex-Tool-IDs für function_call_output-Match bei Resume |
| `inputItems` | `CodexInputItemAny[]` | Snapshot VOR Echo+Output des Pending-Tools — Auto-Tool-Roundtrips früherer Iterations stehen als Paare drin |
| `toolDefinitions` | `CodexToolDefinition[]` | Tool-Set der Iteration — semantische Stabilität bei Skill-Toggle zwischen Pause+Resume |
| `iterationCount` | `number` | Loop-Iteration (1-indexed) — Trace |
| `aggregatedText` | `string` | Akkumulierter Text aus früheren Iterations (meist leer) |
| `previousToolCalls` | `AuditToolCallSnapshot[]` | Bereits ausgeführte Tools — für Audit-Trail-Kontinuität im Resume |
| `lastResponseId` | `string \| undefined` | Codex-Trace |
| `lastStatus` | `string \| undefined` | Codex-Trace |
| `lastPlanType` | `string \| null` | Token-Plan-Tracking |
| `lastCfRay` | `string \| null` | Cloudflare-Trace-ID |
| `totalLatencyMs` | `number` | Aggregat für finale Audit-Metadata |
| `unknownEventTypes` | `string[]` | Parser-Hybrid-Fallback-Aggregat |

**Neue Helper-Types in `codex-adapter.ts`:** `CodexFunctionCallItem` +
`CodexFunctionCallOutputItem` + Union `CodexInputItemAny`. Vorher wurden
die per `as unknown as CodexInputItem`-Cast geforced (§l-Pragmatik);
Phase 3.3.1.3.1 bricht das auf in typesafe Discriminated-Union, damit
Resume-Persistence typesafe wieder hochlesen kann.

### Smoke-Bilanz — `audit_KgWbPjYW_BF4`

Smoke-Setup: `pnpm twin:oauth-phase3-spike setup` (@markus auf
`authMode='oauth'` + Codex-Token), Curl-Trigger:

```bash
POST /twins/@markus/chat
  body: { messages: [{ role: "user", content:
    "Bitte rufe das Tool mcp:everything-approval:get-sum mit a=17 und b=25 auf." }] }
```

**HTTP-Response:**
```json
{ "message": {...}, "auditId": "audit_KgWbPjYW_BF4", "pending": true }
```

**Audit-Verify (vollständige Resume-Context-Persistence):**
```jsonc
{
  "capability": "mcp-tool-use",
  "status": "pending",
  "input": {
    "lastMessage": "Bitte rufe das Tool mcp:everything-approval:get-sum mit a=17 und b=25 auf.",
    "toolCall": {
      "mcpServerId": "mcp_xkSaTJvmajv5KG4r",
      "mcpToolName": "get-sum",
      "args": { "a": 17, "b": 25 }
    },
    "pendingReply": "Ich möchte das Tool 'get-sum' mit Argumenten {...} nutzen...",
    "originalCapability": "respond_to_chat",
    "codexResumeContext": {
      "pendingToolCall": {
        "name": "mcp_everything-approval_get-sum",
        "callId": "call_elbjcx5cdrdSLF1au4bls2V0",
        "arguments": "{\"a\":17,\"b\":25}",
        "itemId": "fc_0ed986896a817ba1016a14401b365c8191804a1a17fc9e28a8"
      },
      "inputItems": [...35 items...],
      "toolDefinitions": [...36 defs...],
      "iterationCount": 1,
      "aggregatedText": "",
      "previousToolCalls": [],
      "lastResponseId": "resp_0ed986896a817ba1016a14401990e88191a2d360fcfb8055bf",
      "lastStatus": "completed",
      "lastPlanType": "pro",
      "lastCfRay": null,
      "totalLatencyMs": 2823,
      "unknownEventTypes": []
    }
  }
}
```

**Beweis-Punkte:**
- Pre-Call-Detect funktioniert: Codex hat `mcp_everything-approval_get-sum`
  (requires_approval=true) gepickt → Loop wirft VOR `mcp.callTool`
- Resume-Context vollständig: 12/12 Felder gesetzt
- Codex-IDs persistiert: callId+itemId verfügbar für Phase-3.3.1.3.2
  function_call_output-Append
- inputItems=35 zeigt: komplette History-Replay + ggf. Auto-Tool-Paare
  früherer Iterations sind im Snapshot
- previousToolCalls=0: in dieser Smoke-Iteration war Pending-Tool das
  erste — späterer Test mit gemischtem Auto+Approval-Pattern erweitert
  Beweisstärke (siehe BACKLOG)
- Audit-Eintrag nach Verify gelöscht (DB-State sauber für Phase 3.3.1.3.2-Smoke)

**Cleanup:** `pnpm twin:oauth-phase3-spike cleanup` → @markus zurück auf
`api_key`, `oauth_tokens`-Eintrag entfernt.

### Diagnose-Korrekturen die der Bau aufgedeckt hat

§m hatte schon 8 Briefing-Korrekturen festgehalten. Bau-Phase
verifiziert + ergänzt:

- **Existing `audit.start()`-API ohne `createPending`:** Briefing-
  Sample-Code hatte `auditRepo.createPending(...)` — diese Methode
  existiert nicht. Korrekte API `audit.start({initialStatus: "pending"})`
  funktioniert direkt; SSE `pending-added` wird im Service-Layer
  automatisch emittiert (kein expliziter `bus.emit` nötig).
- **`AuditEntry`-Top-Level hat KEINE `pendingReply`/`pendingToolCall`-
  Felder:** Briefing-Sample war strukturell falsch (Top-Level statt
  `input.*`). Korrekt: `input: { ..., toolCall: {...}, pendingReply: "..." }`.
- **Skill-Konflikt im Smoke:** `mcp:everything:get-sum` (no-approval)
  und `mcp:everything-approval:get-sum` (approval) sind beide aktiv.
  Trigger musste explizit auf die approval-Variante zielen — sonst
  pickt Codex potenziell die Auto-Execute-Variante und Smoke verifiziert
  nicht den Pause-Pfad. Lesson: bei Smoke mit ambivalenten Tool-Pools
  explizit den Skill-Pfad referenzieren.
- **TypeScript-Quirk `z.unknown()` ↔ `unknown` optional:** `AuditToolCall.
  input/output` aus `@twin-lab/shared` via `z.unknown()` mapped auf
  TS-Type `input?: unknown` (implizit optional, weil `undefined` zu
  `unknown` assignable ist). `AuditToolCallSnapshot` musste die
  Optional-Markierung übernehmen.

### Aufwand-Bilanz vs. §m-Estimate

§m Schätzung Phase 3.3.1.3.1 + 3.3.1.3.2 zusammen: M, 1.5-2 Tage.
**Phase 3.3.1.3.1 isoliert: realer Aufwand ~2.5h** (Pre-Call-Detect +
Resume-Context-Type + Error-Erweiterung + Catch-Erweiterung + Setup +
Smoke + Cleanup + Doku). Phase 3.3.1.3.2 Estimate damit auf S-M (3-4h),
weil:

- `approveMcpToolUse` authMode-Switch ist klein
- `function_call_output`-Append + neue `runModelViaCodex`-Iteration:
  §l-Pattern bekannt, Resume-Context hat alle Daten
- Reject-Pfad: parallel zum existing Reject-Resume mit
  `"[System] Tool wurde abgelehnt..."`-Append
- Refresh-Service vor Resume-Call (siehe §m / BACKLOG #139 Token-
  Latenz-Pattern)

### Multi-Tool-Edge-Cases — Punkte für BACKLOG

Phase 3.3.1.3.1 hat bewusst Single-Tool-Pending-Scope. Folgende Edge-
Cases brauchen separate Iteration:

1. **Auto-Tool + Approval-Tool in derselben Iteration:** unter (i)
   Reihenfolge-treu funktioniert, aber Resume muss `inputItems` mit
   bereits-appended Auto-Tool-Paaren korrekt fortführen. Smoke-Verify
   noch ausstehend — wahrscheinlich Phase-3.3.1.3.2-Smoke-Variante.
2. **Mehrere Approval-Tools in derselben Iteration:** heute "erster
   gewinnt" — Resume wird Codex bei der nächsten Iteration neu plannen
   lassen. Falls Codex die anderen Tools wiederholt: zweite
   Approval-Pause. Sequentielle Approvals als UX-Kette akzeptabel,
   aber Anti-Pattern für Batch-Workflows.
3. **Token-Expiration während Pause:** wenn User minutenlang nicht
   approved, ist Token bei Resume abgelaufen. Refresh-Service-Call vor
   `runModelViaCodex`-Resume-Iteration nötig (Phase 3.3.1.3.2 muss das
   adressieren; existing Lazy-Refresh-Pattern reicht aus, wenn der
   `CodexAdapter`-Pfad konsistent durchgeht).
4. **Pending-Audit-Speicher-Größe:** `toolDefinitions` als full-JSON
   bei 36 aktiven Skills sind ~10-20 KB pro Pending-Audit. Optimization
   für Phase 3.3.1.3.2: nur Skill-IDs persistieren, bei Resume
   re-derive — spart Speicher, kostet einen Skills-Repo-Lookup.

### Bridge-Hypothese Phase 3.3.1.3.2 (Resume-Pfad)

Skizze für nachfolgendes Bau-Briefing:

1. `TwinService.approvePending` Switch erweitern: `mcp-tool-use` +
   `input.codexResumeContext != null` → neuer `approveMcpToolUseViaCodex`-
   Branch (statt existing `approveMcpToolUse` = Vercel-SDK-Resume)
2. `approveMcpToolUseViaCodex`:
   - Token-Refresh via `oauthRefreshService.ensureFresh(twinId)`
   - Tool-Execute via `mcpManager.callTool(serverId, toolName, args)`
   - `function_call`-Echo + `function_call_output` ans `inputItems`
     appenden (aus `codexResumeContext`)
   - Neue `runModelViaCodex`-Iteration ab `iterationCount + 1` mit:
     - `inputItems` als initiale `input`
     - `toolDefinitions` als `tools`-Field (oder re-derive aus aktuellen
       Skills — Architektur-Entscheidung)
     - Akkumulierter `aggregatedText` + `previousToolCalls` aus
       Resume-Context als Initial-State der neuen Loop-Vars
   - Bei Loop-Ende: `audit.complete` mit gemergten `metadata.toolCalls`
     (previousToolCalls + Pending-Tool + neue Auto-Tools)
3. Reject-Pfad analog: System-Message-Append ans `inputItems`, neue
   Iteration mit Tool deaktiviert oder Plan-Re-Entscheidung

Estimate Phase 3.3.1.3.2: **S-M (3-4h)**, siehe oben.

## §o — Codex-Resume-Pfad ✅ (Phase 3.3.1.3.2, Tag 27 Block 16)

**Scope:** Resume-Pfad nach User-Approval. Codex-OAuth-Twins können MCP-Tools
mit `requires_approval=true` jetzt vollständig durchlaufen:
**Pause (Phase 3.3.1.3.1) → User-Approve via Curl → Tool-Execute + Codex-
Resume-Iteration → finale Antwort** — symmetrisch zum Vercel-SDK-Pfad.

### Architektur-Symmetrie (Bauzeit ~3h, im S-M-Estimate)

§n-Architektur (Throw + Vercel-Catch-Reuse für Pause) wird erweitert auf:
- **Approve-Switch + Codex-Branch** in `approveMcpToolUse`. Vercel-Pfad
  bleibt unverändert; Codex-Branch via `entry.input.codexResumeContext !=
  null`.
- **Reject-Switch + Codex-Branch** in `rejectPending` (inline mcp-tool-use-
  Branch). Vercel-Pfad bleibt unverändert; Codex-Branch identisches
  Schema.
- **Helper-Extract `buildPendingMcpAuditFromError`** für Pending-Audit-
  Build: ein-Ort-für-Pending-Logik, von zwei Stellen gerufen:
  1. `runOwnerDirect`-Catch (initiale Pause beim Owner-Chat) — Refactor,
     keine Verhaltensänderung
  2. `approveMcpToolUseViaCodex`-Catch (Re-Pause während Resume-Iteration)
     — neu mit `priorAuditId`-Link
- **`runModelViaCodex` um `options.resumeContext` erweitert** (Option 1
  aus Diagnose D). Init-Phase verzweigt: Initial-Run vs Resume-from-
  Snapshot. Skill-Reverse-Map kommt aus aktuellen Skills (respektiert
  User-Skill-Toggle zwischen Pause+Approve); Tool-Definitions kommen aus
  persistiertem Pause-Snapshot (Codex-Konsistenz, §l).

### Resume-Mechanik im Detail

`approveMcpToolUseViaCodex` macht 5 Schritte:

1. **Validate**: `codexResumeContext` + `toolCall` in `entry.input` müssen
   da sein, sonst Error.
2. **Tool-Execute**: `mcp.callTool(mcpServerId, mcpToolName, args)`. Fail
   → `failWithReason` (audit auf failed), re-throw.
3. **Skill-Lookup + Map-Build**: `skills.list({activeOnly:true})` +
   `mapSkillsToCodexTools(...)`. Resume-Skill via `skillByCodexName.get(
   ctx.pendingToolCall.name)` für korrekten Twin-Lab-Skill-Name (NICHT
   naiver `replaceAll("_", ":")` — siehe §m-Korrektur).
4. **Resume-Iteration**: `runModelViaCodex(persona, [], undefined,
   {skills, resumeContext: {fromAudit, toolOutput, executedToolCall}})`.
   Init-Branch in runModelViaCodex baut `input = [...inputItems,
   function_call, function_call_output]`, restauriert Loop-State,
   pusht `previousToolCalls + executedToolCall` ans `allToolCalls`.
5. **Success-Complete**: `audit.complete` mit `reply, toolCall, toolResult,
   toolIsError, providerMetadata`. SSE `pending-resolved` automatisch
   via `maybeResolvePending`.

### Re-Pause-Pfad (gebaut, aber nicht im Smoke verifiziert)

Wenn Codex in der Resume-Iteration ein weiteres `requires_approval=true`-
Tool aufruft, schlägt der Pre-Call-Detect aus Phase 3.3.1.3.1 wieder zu
— `McpToolApprovalRequiredError` wird im Resume-Loop geworfen. Catch in
`approveMcpToolUseViaCodex` macht:

- **Original-Audit auf `executed`** mit `output.followUpPending=true`-
  Marker und der Resume-Tool-Result-Detail (semantisch: "der approvete
  Tool-Call ist durch, aber das ist nicht das Ende").
- **Neuer Pending-Audit via Helper** mit `priorAuditId=entry.id`. Frontend
  kann via SSE `pending-added` direkt rendern; UI könnte den Link für
  "Folgeaktion zu ..."-Display nutzen.
- **HTTP-Response** des Approve-Endpoints: `{auditId: <neu>, message,
  reply: <neue Wartemeldung>, pending: true}`. `ApproveResult` ist um
  `pending?: boolean` erweitert; Endpoint reicht das transparent durch.

**Smoke-Status:** Re-Pause-Pfad ist code-komplett aber **nicht im End-to-
End-Smoke verifiziert** — der `get-sum`-Smoke war zu trivial (Codex hat
keine Follow-up-Tools gebraucht). Verification braucht einen Multi-Tool-
Trigger (z.B. "rufe X auf, dann Y") wo beide Tools requires_approval
sind. BACKLOG-Item dokumentiert (siehe Tag-27-Items).

### Reject-Pfad mit `function_call_output` + `isError=true`-Marker

`rejectMcpToolUseViaCodex` ist Pendant zu Approve, aber:
- **Kein Tool-Execute** — Tool wird nicht ausgeführt
- **Resume mit Rejection-Output**: `function_call_output.output =
  "[isError=true] User rejected the tool call. Reason: <reason>. Please
  respond directly without using that tool."` (Option (a) aus Diagnose-
  Frage 5)
- **Status bleibt `rejected`** — `audit.repo.update` (NICHT `audit.complete`),
  exakt das gleiche Pattern wie der Vercel-SDK-Reject-Pfad
- **Re-Pause nach Reject** möglich (Codex könnte trotz Rejection ein
  anderes requires-approval-Tool rufen). Original-Audit kriegt
  `followUpPending=true` im output, neuer Pending-Audit mit
  `priorAuditId`-Link

### Smoke-Bilanz `audit_gSqqVwGGBY6O` (executed)

```jsonc
{
  "capability": "mcp-tool-use",
  "status": "executed",
  "reply": "17 plus 25 ergibt 42.",
  "toolCallsCount": 1,
  "toolCalls": [{
    "toolName": "mcp:everything-approval:get-sum",
    "output": "[{\"type\":\"text\",\"text\":\"The sum of 17 and 25 is 42.\"}]",
    "codexCallId": "call_BG2NRMd2pGqunYM8sYuuJj9x"
  }],
  "codexIterations": 2,          // Pause-Iteration + Resume-Iteration
  "followUpPending": null,        // Kein Re-Pause in diesem Smoke
  "latencyMs": 5424,
  "planType": "pro"
}
```

**Beweis-Punkte:**
- **Approve-Branch greift**: `audit.input.codexResumeContext` aus
  Phase-3.3.1.3.1-Persistenz wird gelesen, Codex-Branch in
  `approveMcpToolUse` aktiv
- **Tool wird tatsächlich ausgeführt**: `get-sum(17,25)` → `"The sum of
  17 and 25 is 42."` als Codex-Tool-Output sichtbar
- **Resume-Iteration läuft**: `codexIterations=2` (Pause + Resume),
  finale Antwort "17 plus 25 ergibt 42." auf Deutsch (Persona aktiv,
  System-Prompt korrekt rekonstruiert)
- **Audit-Trail komplett**: `toolCall` mit `codexCallId` aus dem
  Original-Pending bewahrt; Reply persistiert
- **Status-Transition**: pending → executed via `audit.complete` → SSE
  `pending-resolved` automatisch
- **Performance**: 5.4s mit frischem Token (vgl. §m-BACKLOG #139
  Token-Refresh-Latenz)

Smoke-Audit nach Verify gelöscht; Setup via `pnpm twin:oauth-phase3-spike
setup`, Cleanup via `... cleanup` → @markus zurück auf `api_key`.

### Phase-3-Outcome — #131 Substantiell-Closed

Mit Phase 3.3.1.3.2 sind Codex-OAuth-Twins **funktional gleichwertig zu
api_key-Twins** für den Tool-Use-Pfad:

| Capability | api_key (Vercel-SDK) | oauth (Codex) |
|------------|---------------------|---------------|
| Auto-Execute (`requires_approval=false`) | Phase 3.2 ✅ | Phase 3.3.1.2 ✅ |
| Pause (`requires_approval=true`) | Phase 3.2.F ✅ | **Phase 3.3.1.3.1 ✅** |
| Approve + Resume + Tool-Result | Phase 3.2.F ✅ | **Phase 3.3.1.3.2 ✅** |
| Reject + System-Message | Phase 3.2.F ✅ | **Phase 3.3.1.3.2 ✅** |
| Multi-Step-Loop | Phase 3.2.E ✅ | Phase 3.3.1.2 ✅ |
| Re-Pause in Resume | implizit ✅ | code-komplett, smoke offen |

**Restliche Sub-Phasen (optional):**
- **Phase 3.3.3 Reasoning-Traces** — `item.type === "reasoning"` handlen,
  Audit-Persistenz. ~0.5 Tag, optional weil Reasoning heute nicht in der
  UI gerendert wird.
- **Phase 3.4 Vercel-Provider-Refactor** — Optional, weil Direct-fetch
  sauber funktioniert. Würde sich erst lohnen wenn Vercel-AI-SDK eine
  vergleichbare Funktion bietet (heute nicht).

**Phase-3-Outcome:** #131 ist substantiell-zu. Direkt-fetch-Adapter +
SSE-Parser + System-Prompt-Mapping + Multi-Step-Tool-Loop + Approval-
Pipeline (Pause+Approve+Reject) ist Production-Ready für Owner-Self-
Use mit Codex-Subscription. Phase 4 (CLI-Login-Command) + Phase 5
(Web-UI Status + Doku + Smoke) sind die letzten Schritte vor #131-
Closure.

## §p — Codex-Reasoning-Trace-Format (Phase 3.3.3.0 Spike-Discovery, Tag 27 Block 17)

**Scope:** Discovery-Spike für Codex-Reasoning-Format vor Phase-3.3.3.1-Bau.
Trigger-Bedingungen klären + Item-Format dumpen + Parser-Compare gegen
existing CodexSSEParser. Mock-Request gegen real Codex-Endpoint, kein
TwinService-Touch, kein Code-Change.

### Smoke-Setup

Spike `apps/runtime/src/scripts/test-oauth-phase3-3-3-spike.ts` mit Token-
Pre-Check (JWT-Decode + last_refresh-Fallback) und conditional Multi-Trigger:

- **Step 1 — Math-Problem** (Two-Trains-Meet-Problem, 319 chars) mit
  `reasoning: { effort: "high" }`, `tools: []`, model `gpt-5.5`
- **Step 2 — Code-Refactor** (conditional, nur wenn Step 1 weder Items noch
  Tokens triggert)

Plus Parser-Compare: existing `CodexSSEParser` läuft parallel zum Raw-Capture
via `parseChunk(chunk)` → `finalize()`, Counts werden verglichen.

### Smoke-Result (Step 1 grün, Step 2 übersprungen)

```
HTTP 200 | 15444ms total | 521 events captured

Event-Histogram:
  511× response.output_text.delta
    2× response.output_item.added
    2× response.output_item.done
    1× response.created
    1× response.in_progress
    1× response.content_part.added
    1× response.output_text.done
    1× response.content_part.done
    1× response.completed

reasoningItems raw=2  |  reasoningTraces parser=1
reasoning_tokens=276  |  total_tokens=894 (=30.9% Reasoning-Anteil)
```

### Reasoning-Item-Format (verified)

Zwei Events pro Reasoning-Block — `added` (Start) + `done` (End) — beide mit
identischer `item.id`:

```jsonc
// Event 1 (sequence 2): output_item.added
{
  "type": "response.output_item.added",
  "item": {
    "id": "rs_0a4d9bbcdc4ef7d1016a146ecb6c8881919124caa9888cbc9d",
    "type": "reasoning",
    "summary": []         // ← LEER! kein Reasoning-Text exposed
  },
  "output_index": 0,
  "sequence_number": 2
}

// Event 2 (sequence 3): output_item.done — gleiche id, identische Payload
{
  "type": "response.output_item.done",
  "item": {
    "id": "rs_0a4d9bbcdc4ef7d1016a146ecb6c8881919124caa9888cbc9d",
    "type": "reasoning",
    "summary": []
  },
  "output_index": 0,
  "sequence_number": 3
}
```

**Substantielle Beobachtung:** `summary: []` ist **leer**. Codex exposed nur
die Reasoning-Item-Metadaten (id, type, output_index), **nicht den
tatsächlichen Reasoning-Text**. Hypothese: Anti-Distillation-Stance — der
OpenAI-Subscription-Plan macht Reasoning-Inhalt nicht zugänglich für
Re-Training. Vergleich: o1/o3 in der API-Variante exposed `summary` mit
strukturiertem Reasoning, Codex-OAuth-Pfad nicht.

**`reasoning_tokens=276` in `usage.output_tokens_details`** ist verfügbar —
quantitative Reasoning-Information geht durch, qualitative nicht.

### Parser-Compare (raw=2 vs parser=1, kein Bug)

Diskrepanz ist **kein Parser-Bug, sondern Design-Korrektur**: `codex-sse-
parser.ts:331-337` enthält explizite Heuristik:

```ts
} else if (itemType === "reasoning") {
  // Capture-only, Phase 3.3 unused. `.done`-Variante wird nicht
  // doppelt erfasst (heuristic: reasoning kommt typischerweise nur
  // einmal pro item.id, in den Smokes 3.3.0/3.3.2 garnicht).
  if (type === "response.output_item.added") {
    this.reasoningTraces.push(item);
  }
}
```

Parser de-dupliziert per `output_item.added`-Filter — der `.done`-Event
hat identische Payload und würde sonst doppelt gezählt. **Korrekt für
Phase 3.3.3.1** weil `reasoningTraces` semantisch "Anzahl Reasoning-
Blocks" repräsentieren soll, nicht "Anzahl Stream-Events".

Spike-Counter zählt beide Events (raw=2) zur Vollständigkeit der
Discovery; produktiver Parser-Count (1) ist die richtige Größe für
Persistenz.

### Hypothesen-Verifikation (aus Diagnose-C)

| Hypothese | Status |
|-----------|--------|
| **A** — Reasoning kommt nur bei non-trivial Prompts | ✅ Math-Trigger → 2 Items. (Phase-3.3.0-Smoke mit Tool-Call-Pfad hatte 0 Items — Trigger-Domain matters.) |
| **B** — `effort: "high"` macht Unterschied | ✅ effort:"high" → Reasoning. Server-Default `medium` hatte beim Tool-Call-Pfad nichts produziert. Effort + Prompt-Komplexität zusammen entscheiden. |
| **C** — Subscription-Plan exposed Items nicht | ❌ Items SIND im Stream. ABER: `summary: []` heißt der **Reasoning-Inhalt** ist nicht zugänglich — nur Metadaten + Token-Count. Halb-verifizierte C. |

### Phase-3.3.3.1-Implications

**Empfehlung: Reduziert-Weiterbauen.** Reasoning-Items im Stream sind
verifiziert, aber Inhalt (`summary: []`) ist leer — UI-Render hat keinen
substantiellen Mehrwert über "X Reasoning-Tokens verwendet" hinaus.

**Bau-Schritte für Phase 3.3.3.1 (~30-45 Min, reduziert vom S-Estimate):**

1. **`CodexAdapterOutput.reasoningTraces: unknown[]`** anbauen — heute
   schon im `CodexParseResult` da, nur Adapter-Surface muss durchreichen.
2. **`CodexAdapterOutput.reasoningTokens?: number`** aus
   `usage.output_tokens_details.reasoning_tokens` extrahieren — Parser
   liest `usage` aktuell teilweise (für `total_tokens`), Erweiterung
   minimal.
3. **`TwinService.runModelViaCodex.metadata`** appendet beide:
   `metadata.reasoningTraces` (für audit-trail completeness) +
   `metadata.reasoningTokens` (für UI-Display + Token-Cost-Analyse).
4. **Multi-Iteration-Aggregation** im Loop: `allReasoningTraces` +
   `totalReasoningTokens` analog zu `allToolCalls`/`totalLatencyMs`.
5. **Kein UI-Bau in Phase 3.3.3.1** — `summary: []` macht das uninteressant.
   Phase 5 könnte einen "🧠 N tokens"-Badge im Audit-Detail-View zeigen,
   aber das ist Polish-Niveau.

**Skip:** kein Stream-Display für Reasoning-Progress, kein Reasoning-
Pre-Pause-Visualization. Der Tool-Call-Pre-Call-Detect-Pattern aus Phase
3.3.1.3.1 ist die einzige Pre-Action-User-Surface die nötig ist.

### Optionale Phase-3.3.3.1.X — Reasoning-Effort steuerbar

Heute setzt `codex-adapter.ts:193-202` body OHNE `reasoning`-Field —
Codex-Server-Default `effort: "medium"` greift. Phase 3.3.3.1.X (optional)
könnte:

- `CodexAdapterInput.reasoningEffort?: "low" | "medium" | "high"` anbauen
- Default `"medium"` (Codex-Default-Match)
- `runModelViaCodex` reicht es durch — Owner könnte Skill-spezifisch
  high-effort triggern (z.B. für Recherche-Workflow)

**Out of Scope für 3.3.3.1:** Effort-UI-Picker, Skill-Manifest-Effort-Field.
Wäre Phase-4/5-Material und nur sinnvoll wenn UI tatsächlich Reasoning-
Tokens displayed.

### Phase-3.3.3.0-Stop

Spike-Discovery abgeschlossen. Phase 3.3.3.1 Bau-Pfad ist klar, kann auf
verifizierter Format-Basis (`{id, type: "reasoning", summary: []}` +
`reasoning_tokens` aus usage) gebaut werden.

### Phase-3.3.3.1 Smoke-Bilanz + Server-Default-Korrektur (Tag 27 Block 18)

Phase 3.3.3.1 ist gebaut + verifiziert. End-to-End-Smoke gegen
`/twins/@markus/chat` mit trivialer Math-Frage zeigt **substantielle
Korrektur der Spike-Hypothese**:

```jsonc
// audit_PPi49pkeXA2- (executed)
{
  "capability": "owner-direct",
  "reply": "17 plus 25 ergibt **42**.",
  "providerMetadata": {
    "provider": "openai-codex",
    "authMode": "oauth",
    "reasoningTraces": [
      { "id": "rs_06868287...", "type": "reasoning", "summary": [] }
    ],
    "reasoningTokens": 12,
    "codexIterations": 1,
    "latencyMs": 2330,
    "planType": "pro",
    "allMetaKeys": [
      "authMode", "cfRay", "codexIterations", "codexStatus",
      "latencyMs", "planType", "provider",
      "reasoningTokens", "reasoningTraces", "responseId"
    ]
  }
}
```

**Server-Default-`effort: medium` produziert Reasoning bei gpt-5.5** —
auch bei trivialer Frage „17 plus 25". 12 Reasoning-Tokens für eine
Addition ist überraschend, aber konsistent: gpt-5.5 ist ein Reasoning-
Modell und macht offenbar pro Request einen Reasoning-Pass.

**Spike-Hypothese-Korrektur:** §p oben hatte aus Phase-3.3.0-Smoke
geschlossen, dass Tool-Call-Pfade `reasoning_tokens=0` haben. Korrekter:
**Tool-Call-Pfad ist Reasoning-frei, Chat-Pfad nicht.** Vermutlich
optimiert Codex Tool-Call-Latenz indem es Reasoning skippt; freier
Text-Output bekommt Reasoning auch ohne explizite `effort:"high"`-Anforderung.

**Implikation für Production:** jeder oauth-Twin-Chat-Response hat ein
paar Reasoning-Tokens (12 bei trivialer Frage, vermutlich mehr bei
komplexen). Token-Accounting für Codex-Subscription muss das einrechnen
(Token-Limit = Output + Reasoning + Input). Phase B / Production-
Monitoring könnte hier ein "🧠 N reasoning"-Hint im Audit-Detail-View
zeigen, ist aber kein Blocker — `summary: []` bleibt leer, also kein
expanded Content-Render.

**Bau-Bilanz Phase 3.3.3.1 (~45 Min):**
- `CodexSSEParser.reasoningTokens?: number` aus `usage.output_tokens_details`
  (defensive 3-Ebenen-Type-Guards)
- `CodexAdapterOutput.reasoningTraces + reasoningTokens` durch parseResult
- `runModelViaCodex`: `allReasoningTraces` + `totalReasoningTokens` Loop-
  State, Pro-Iteration-Push+Add, Loop-End-Metadata (additiv mit
  conditional-spread bei 0/leer — matched `toolCalls`-Pattern), Resume-
  Init-Branch ingestet `ctx.previousReasoning*`, Throw-Site appendet
  Snapshot ins `McpToolApprovalRequiredError.codexResumeContext`
- `CodexResumeContext.previousReasoningTraces? + previousReasoningTokens?`
  Schema additiv (kein Migration, JSON-Bag)
- Re-Pause-Catches in `approveMcpToolUseViaCodex` + `rejectMcpToolUseViaCodex`
  schreiben `ctx.previousReasoning*` ans Original-Audit-providerMetadata
  (konsistent mit existing `toolCalls`-Source: Pre-Original-Pause-Daten;
  Resume-Iteration-Reasoning lebt im neuen Pending-Audit weiter)

**Phase 3.3 vollständig zu.** Codex-OAuth-Twins haben jetzt:
- Persona + Facts + Memory (Phase 3.2)
- Multi-Step-Tool-Loop mit Auto-Execute (Phase 3.3.1.2)
- Approval-Pipeline mit Pause+Approve+Resume+Reject + Re-Pause (Phase 3.3.1.3.{0,1,2})
- Reasoning-Traces + Token-Counts im Audit (Phase 3.3.3.{0,1})

**Restliche #131-Sub-Phasen (Tag 28+):**
- Phase 3.4 Vercel-Provider-Refactor — optional, lohnt nur bei AI-SDK-Update
- Phase 4 CLI-Login-Command — ~1 Tag
- Phase 5 Web-UI Status + Smoke + Doku + #131-Closure — ~1-1.5 Tage

## §q — Vercel-Provider-Mapping-Spike (Phase 3.4.0, Tag 27 Block 19)

**Scope:** Discovery-Spike: lässt sich der Codex-OAuth-Pfad als Vercel AI
SDK V3 Custom-Provider verpacken? Wenn ja → Phase 3.4 Vollbau kann
`runModelViaCodex` (~600 LOC) eliminieren und Vercel-SDK Multi-Step- /
Reasoning- / Approval-Mechanik nutzen.

### Doku-Check-Findings (Phase 3.4.0.0)

**Installed:** `ai@6.0.173` + `@ai-sdk/provider@3.0.10` (V3-Spec).

**`LanguageModelV3`-Interface:**
- `doGenerate(options) → Promise<LanguageModelV3GenerateResult>` —
  stateless, ein Request, Multi-Step-Loop wird vom SDK außen orchestriert
- `doStream(options) → Promise<LanguageModelV3StreamResult>` — analog
- Provider erwartet `specificationVersion: 'v3'` + `provider` + `modelId`
  + `supportedUrls`

**Native Stream-Primitives in V3** (substantieller Befund):
- `text-start/-delta/-end` für Text-Streaming
- **`reasoning-start/-delta/-end`** — native Reasoning-Support
- `tool-input-start/-delta/-end` + `tool-call` + `tool-result`
- **`tool-approval-request`** als first-class Type — Marker-Pattern aus
  Phase 3.2.F wäre Anti-Pattern wenn man Vercel-Pfad neu macht

**`LanguageModelV3ReasoningPart`** erwartet `text: string`. Codex liefert
`summary: []` (siehe §p). Mapping = leerer String pro Reasoning-Item.
Spec-konform, semantisch leichte Verlust.

### Code-Diagnose (Phase 3.4.0.1)

**oauth-Branch in `runModel` (`twin-service.ts:2294`):** ein-Zeilen-Branch,
würde komplett wegfallen.

**`runModelViaCodex`-Funktion** ist ~600 LOC mit Init-Branch + Multi-Step-
Loop + Pre-Call-Detect + Reasoning-Aggregation + Resume-Pfad. Bei Refactor:

| Logik heute | Bei Provider-Wrapper |
|-------------|----------------------|
| Multi-Step-Loop §l-Pattern | Vercel-SDK via `stopWhen(stepCountIs(N))` + History-Replay |
| Pre-Call-Detect requires_approval | `tool-approval-request`-Stream-Part |
| Resume-Pfad codexResumeContext | Vercel via Tool-Result-Message im Prompt |
| Reasoning-Aggregation | Vercel aggregiert `reasoning-*`-Stream-Parts automatisch |
| Token-Refresh + Retry | bleibt im Provider |

### Spike-Setup (Phase 3.4.0.2)

`apps/runtime/src/scripts/test-oauth-phase3-4-spike.ts` mit Setzung **(β)**:
- Token-Pre-Check via JWT-Decode (Pattern aus Phase 3.3.3.0)
- Inline `createCodexProvider()`-Factory mit `doGenerate`-Implementation
  (~280 LOC inkl. Mapping)
- Mapping-Helper: `mapV3PromptToCodex()` (System → instructions, User/
  Assistant → message-Items, Tool-Calls → function_call, Tool-Results →
  function_call_output per §l), `mapV3ToolsToCodex()` (V3-FunctionTool →
  Codex function-format)
- Output-Mapping: `CodexAdapterOutput` → `LanguageModelV3GenerateResult.
  content[]` (Text + ToolCall + Reasoning + finishReason + usage +
  providerMetadata)
- Test 1: `generateText({model: provider.languageModel("gpt-5.5"),
  prompt: "Was ist 17 plus 25?"})` — Basis-Mapping
- Test 2: `generateText({..., tools: {get_sum: tool({...execute})},
  stopWhen: stepCountIs(5)})` — Tool-Roundtrip via Vercel-Multi-Step

`@ai-sdk/provider@^3.0.0` als devDep dazu (vorher transitive). Pragmatic
für Spike + zukünftige Phase-3.4-Builds.

### Spike-Output (beide Tests grün auf ersten Run)

```
TEST 1 — Simple Text:
  ✓ 9084ms
  text: "17 plus 25 ist **42**."
  finishReason: stop
  providerMetadata: openai-codex { planType, cfRay, latencyMs, responseId, codexStatus }

TEST 2 — Tool-Roundtrip:
  ✓ 2572ms
  text: "Die Summe ist 42."
  steps: 2
  step[0]: text="", toolCalls=1, toolResults=1, finishReason=tool-calls
    - tool-call: get_sum({"a":17,"b":25}) callId=call_HoLTTB3XfRad3nAjekiFLZAS
    - tool-result: get_sum → {"sum":42}
  step[1]: text="Die Summe ist 42.", toolCalls=0, toolResults=0, finishReason=stop
```

**Beweis-Punkte:**
- V3Prompt → Codex-input-Mapping funktioniert (System-Part landet in
  instructions, User-Part in message-Item)
- V3 tools → Codex function-Field-Mapping funktioniert (get_sum mit
  inputSchema → strict function-spec)
- **Tool-Roundtrip via Vercel-Multi-Step ohne eigenen Loop**:
  - Step[0]: Codex liefert tool-call → Provider returnt content-Array mit
    `{type:"tool-call",...}`
  - Vercel-SDK orchestriert: ruft execute() der Tool, baut tool-Role-
    Message ans Prompt
  - Step[1]: doGenerate wird mit erweitertem Prompt erneut aufgerufen →
    Provider mapped Tool-Result-Part zu `function_call_output`-Item per
    §l → Codex liefert finale Text-Antwort
  - **Vercel-SDK reproduziert §l-Pattern transparent — kein eigener Loop
    in runModelViaCodex nötig**
- providerMetadata mit Codex-spezifischen Feldern durchgereicht (Audit-
  Persistierung kann das wie heute extrahieren)
- top-level `result.toolCalls=0`, aber `step[0].toolCalls=1` — matched
  existing Step-Walk-Pattern (`collectAllToolCalls`-Helper in
  twin-service.ts), kein neuer Code nötig

### Phase-3.4-Vollbau-Empfehlung: ✅ LOHNT SICH

Substantielle Vorteile:
- **~600 LOC `runModelViaCodex` weg** + 1 Zeile oauth-Branch in runModel
- Multi-Step-Logic in Vercel-SDK (test, dokumentiert, Multi-Provider-konsistent)
- Native Approval-Primitives — Marker-Pattern aus 3.2.F könnte parallel
  aufgeräumt werden (separater Refactor, lockt am Refactor-Trail mit)
- Reasoning-Aggregation automatisch
- Token-Refresh + Retry bleiben im Provider — keine Architektur-Änderung
- Custom-Provider ist testbar wie ein normales Vercel-Backend (Multi-
  Provider-Tests werden einfacher)

Substantielle Aufwand-Treiber:
- **Phase 3.4.1 — Provider-Move + Production-Wiring** (~2h): Spike-Code
  ins `apps/runtime/src/oauth/codex-vercel-provider.ts`-Modul, mit
  `OAuthRefreshService`-Injection statt direct token, Retry-Wrapper
  übernehmen aus `codex-adapter.ts:84` (`withRetry`)
- **Phase 3.4.2 — Tool-Approval-Mapping** (~3-4h): `tool-approval-request`-
  Content-Part emittieren für Skills mit `requiresApproval=true`. Caller-
  Side (`runOwnerDirect`) muss auf den neuen Content-Part-Type reagieren
  statt `McpToolApprovalRequiredError` zu catchen. Plus
  `approveMcpToolUseViaCodex` muss umgestellt werden auf V3-`tool-result`-
  Message-Resume (statt eigener resumeContext).
- **Phase 3.4.3 — runModelViaCodex-Removal + oauth-Branch-Cleanup**
  (~1.5h): Caller-Pfad einheitlich auf Vercel-`generateText`. Plus
  Smokes (Phase 3.3.1.2/3/3.3.3 müssen alle grün bleiben).
- **Phase 3.4.4 — Approval-Pipeline-Symmetrie für api_key-Pfad**
  (~2h, OPTIONAL): wenn man schon dabei ist, das Marker-Pattern aus
  3.2.F auf `tool-approval-request` umstellen → einheitliche Approval-
  Mechanik beide Auth-Modi. Substantiell aber lohnt-sich-Polish.

**Total Phase 3.4 Vollbau: 6.5-9.5h** (~1 Bautag). Briefing-Estimate
6-10h trifft das Mittelfeld.

**Phase-B-Defensive-Wert (qualitativ):** existing Direct-fetch ist
zentralisiert (`codex-adapter.ts:193-202` Body-Bau), aber das oauth-
Branch + Multi-Step-Loop sind über `twin-service.ts` verteilt. Bei
Codex-Format-Change ist Refactor-Surface heute substantiell. Mit
Custom-Provider wäre die Mapping-Logik im Provider isoliert.

### Bonus-Empfehlung: Marker-Pattern parallel aufräumen?

Tag-27-Implementation hat das Marker-Pattern als Workaround für AI-SDK-6-
Throw-Schluck-Verhalten gebaut (§m/§n). V3-Spec hat aber `tool-approval-
request` als first-class Content-Part — der Workaround wäre obsolet wenn
man den api_key-Pfad auch refactored.

**Aber:** das ist gleichzeitig auch ein Anti-Pattern-Treiber: tool-bridge.
ts (Marker-Emission), detectPendingToolCall (Marker-Scan),
stopOnPendingApprovalMarker (StopCondition) wären alle Legacy. Refactor
würde ~80 LOC sparen aber die existing Smokes brauchen Migration.

**Empfehlung:** Phase 3.4.4 als **separate Sub-Phase** definieren (nach
3.4.1-3 für oauth-Pfad), nur wenn User es ausdrücklich will. Heute
funktioniert das Marker-Pattern stabil, kein dringender Refactor-Treiber.

### Spike-Decision-Vorlage für User

| Option | Aufwand | Outcome |
|--------|---------|---------|
| **(A)** Phase 3.4 jetzt bauen | ~1 Bautag (3.4.1+2+3) | Codex-OAuth-Pfad clean, ~600 LOC weg |
| **(B)** Phase 3.4 + 3.4.4 Marker-Cleanup | ~1.5 Bautage | Beide Auth-Modi clean, Approval-Symmetrie |
| **(C)** Phase 3.4 für später, Phase 4 (CLI-Login) priorisieren | 0 Bautage Phase 3.4 | Closure-Speed, Phase 3.4 als Phase-B-Polish |

**Pre-Spike-Tendenz war "lean toward 'lohnt sich'"** — Spike-Output
verstärkt das. Aber Phase-3.3-Closure ist substantiell — Phase 4 + 5 zu
priorisieren für #131-Closure ist ebenso valide.

## §r — tool-approval-request-Discovery (Phase 3.4.3.0 Spike, Tag 27 Block 21)

**Scope:** Discovery-Spike vor Phase-3.4.3-Vollbau. Klären wie Vercel AI SDK 6
native Approval-Pipeline funktioniert + ob Codex-Provider transparent
mitmacht. Doku-Check + 3 Tests (Approval-Pending, Approve-Resume, Reject)
gegen echten Codex-Pro.

### Doku-Check-Findings

**`needsApproval` ist Built-in Tool-Field** in `@ai-sdk/provider-utils@4.0.26`:

```ts
tool({
  description: "...",
  inputSchema: z.object({...}),
  execute: async (args) => {...},
  needsApproval?: boolean | ToolNeedsApprovalFunction<INPUT>,
})

type ToolNeedsApprovalFunction<INPUT> = (
  input: INPUT,
  options: { toolCallId, messages, experimental_context? }
) => boolean | Promise<boolean>;
```

**V3-Spec hat `tool-approval-request`/`-response` als first-class Types**
(`@ai-sdk/provider@3.0.10`):

```ts
type LanguageModelV3ToolApprovalRequest = {
  type: 'tool-approval-request';
  approvalId: string;
  toolCallId: string;
  providerMetadata?: SharedV3ProviderMetadata;
};

interface LanguageModelV3ToolApprovalResponsePart {
  type: 'tool-approval-response';
  approvalId: string;
  approved: boolean;
  reason?: string;
}

// Tool-Role-Message akzeptiert beides:
{ role: 'tool', content: Array<ToolResultPart | ToolApprovalResponsePart> }
```

**Helper-Ecosystem:** `lastAssistantMessageIsCompleteWithApprovalResponses`,
`ChatAddToolApproveResponseFunction`, `InvalidToolApprovalError`,
`ToolCallNotFoundForApprovalError`, `getToolName`-Helpers — Chat-UI-
Integration ist erstklassig dokumentiert.

### Spike-Setup

Spike `apps/runtime/src/scripts/test-oauth-phase3-4-3-spike.ts` mit
Production-Provider-Reuse (`createCodexProvider` aus Phase 3.4.1, kein
neuer Provider). Setup analog `test-codex-vercel-provider.ts`:
DB+MasterKey+RefreshService+@markus-Lookup.

Mock-Tool `get_sum` mit `needsApproval: true` (Static-Boolean) +
execute-Tracking-Counter. Trigger-Prompt deutsch:
`"Was ist 17 plus 25? Nutze das get_sum Tool."`

### Test 1 — needsApproval triggert tool-approval-request ✅

```
✓ 1584ms
text: ""
finishReason: tool-calls
steps: 1
top-level toolCalls: 1, toolResults: 0
executeCallCount: 0  ← Tool NICHT ausgeführt!

result.content (2 parts):
  - {type:"tool-call", toolCallId:"call_2KpfNTHBduEDVdcRhSBXB2F5",
     toolName:"get_sum", input:{a:17,b:25}}
  - {type:"tool-approval-request",
     approvalId:"aitxt-SKZliSpaMWjsYCyk4D2Ivw5H",
     toolCall:{type, toolCallId, toolName, input}}
```

**Beweis:** `needsApproval:true` Static-Boolean reicht — Vercel-SDK
skipped `execute()` automatisch und emittiert `tool-approval-request` als
Content-Part. Provider-Code (`codex-vercel-provider.ts`) wurde **nicht
angefasst** — Approval-Mechanik lebt komplett im SDK-Caller.

**Format-Detail:** Approval-Part hat `approvalId` (SDK-generiert,
`aitxt-...`) und `toolCall` als VERSCHACHTELTES Objekt (NICHT nur
`toolCallId` flat). `result.content[]` und `steps[0].content[]` enthalten
beide das Part — duplizierte Repräsentation.

### Test 2 — Approve-Resume via History-Replay ✅

**Format-Discovery (Iteration 1 brach mit `AI_InvalidToolApprovalError`):**
`SDK.collectToolApprovals` scannt message-history nach matching
`tool-approval-request`-Parts via `approvalId`. Pure `tool-call`-Part in
assistant-content reicht NICHT — der **Pending-Request-Part muss
mit-persistiert** werden:

```ts
messages: [
  { role: "user", content: "Was ist 17 plus 25? ..." },
  {
    role: "assistant",
    content: [
      { type: "tool-call", toolCallId, toolName: "get_sum", input: {...} },
      { type: "tool-approval-request", approvalId, toolCallId },  // ← Pflicht!
    ],
  },
  {
    role: "tool",
    content: [
      { type: "tool-approval-response", approvalId, approved: true },
    ],
  },
],
```

**Resume-Result:**
```
✓ 1971ms
text: "17 plus 25 ist **42**."
finishReason: stop
steps: 1
executeCallCount: 1  ← Tool ausgeführt nach Approve!
```

**Beweis:** SDK ruft `execute()` automatisch, integriert Tool-Result in
nächste Iteration, liefert finale Text-Antwort. Substantieller Performance-
Vorteil ggü heute (Phase 3.3.1.3.2 hatte 5.4s, Phase 3.4.3-Spike 2s
End-to-End-Resume).

### Test 3 — Reject via History-Replay ✅

Gleiche History-Struktur mit `approved: false, reason: "User hat
abgelehnt — bitte ohne Tool antworten."`:

```
✓ 1026ms
text: "17 plus 25 ist 42."
finishReason: stop
executeCallCount: 0  ← Tool NICHT ausgeführt
```

Codex generiert Antwort ohne Tool-Use. Bei trivialen Math-Fragen reicht
das interne Wissen — bei komplexeren Tools (z.B. `fetch_url`) würde
Codex vermutlich eine "Kann ich nicht ohne das Tool"-Antwort geben.
Reason-Field wird in den Prompt eingebaut, hilft Codex bei der
Plan-Anpassung.

### Phase-3.4.3.1 Architektur — Big-Bang (api_key + oauth gleichzeitig)

**Setzung User Phase 3.4.3.0:** beide Pfade in einem Commit refactoren.
Marker-Pattern (3.2.F) wird komplett obsolet — substantielle Code-
Reduktion + Symmetrie zwischen Auth-Modi.

**Refactor-Surface:**

1. **`mcp/tool-bridge.ts:buildMcpToolsFromSkills`** erweitern:
   ```ts
   tools[toolKey] = tool({
     description: ...,
     inputSchema: ...,
     needsApproval: skill.manifestJson.requiresApproval ?? false,  // NEU
     execute: async (args) => { ... }  // unverändert, Marker-Return raus
   });
   ```
   `execute` darf jetzt direkt `mcpClientManager.callTool` rufen — kein
   `MCP_PENDING_APPROVAL_MARKER`-Return mehr nötig.

2. **`mcp/tool-bridge.ts:MCP_PENDING_APPROVAL_MARKER`** + dazugehörige
   Marker-Logik raus (kann entfernt werden).

3. **`twin-service.ts:detectPendingToolCall` + `stopOnPendingApprovalMarker`**
   raus — entfällt mit Marker.

4. **`twin-service.ts:runOwnerDirect`-Catch:** `McpToolApprovalRequiredError`-
   Catch ersetzen durch Post-Generate `result.content[]`-Scan nach
   `tool-approval-request`-Part. Falls gefunden → Pending-Audit anlegen
   mit: `messages` (history) + `assistantContent` (mit tool-call +
   approval-request) + `approvalId` + `toolCallId` + `toolName` + `input`.

5. **`twin-service.ts:approveMcpToolUse` + `approveMcpToolUseViaCodex`**:
   beide refactor auf History-Replay. Vereinheitlichung: ein einziger
   `approveMcpToolUse`-Branch, kein Codex-spezifischer. Vercel-SDK ruft
   `execute()` (= `mcpClientManager.callTool` via tool-bridge), liefert
   `result.text` direkt. Audit-Complete identisch zu heute aber ohne
   eigenen Resume-Loop.

6. **`twin-service.ts:rejectMcpToolUseViaCodex`** entfällt, `rejectPending`
   ruft direkt History-Replay mit `approved:false`.

7. **`McpToolApprovalRequiredError`-Klasse** kann entfernt werden (kein
   Caller mehr).

8. **`CodexResumeContext` + Resume-Pfad-Persistierung** (Phase 3.3.1.3.1/2)
   entfällt vollständig — Vercel-SDK macht Resume via History,
   keine codex-spezifische Persistenz nötig. **Substantielle Code-
   Reduktion (~400 LOC).**

9. **runModelViaCodex** kann eliminiert werden — oauth-Branch in
   `runModel` (twin-service.ts:2294) auf `codex-vercel-provider` umstellen
   (das ist Phase 3.4.5).

**Audit-Pending-Surface heute vs nach Refactor:**

| Heute (Marker + Codex-Resume-Context) | Nach 3.4.3.1 |
|---------------------------------------|--------------|
| `input.toolCall.{mcpServerId, mcpToolName, args}` | `input.toolCall.{toolName, input}` |
| `input.messages: ChatMessage[]` | `input.messages: ModelMessage[]` (Vercel-Format) |
| `input.pendingReply, originalCapability` | unverändert |
| `input.codexResumeContext.{pendingToolCall, inputItems, toolDefinitions, iterationCount, ...12 Felder}` | `input.approvalId` + `input.assistantContent` (genug für History-Replay) |
| `input.priorAuditId` (Re-Pause) | unverändert |

**Datenmenge im Audit:** substantiell-kleiner (12 Felder → 2 Felder pro
Pending-Audit).

### Aufwand-Estimate Phase 3.4.3.1

Briefing-Default war 3-4h. Nach Spike-Discovery realistischer:

| Block | Schätzung |
|-------|-----------|
| `buildMcpToolsFromSkills` + Marker-Removal | 1h |
| `runOwnerDirect`-Catch-Refactor (Post-Generate-Scan) | 1.5h |
| `approveMcpToolUse` Unified (Codex+Vercel-Pfad) | 1.5h |
| `rejectPending` Refactor | 1h |
| Pending-Audit-Schema-Cleanup (codexResumeContext entfernen) | 0.5h |
| Marker-Pattern-Dead-Code-Removal | 0.5h |
| End-to-End-Smokes (api_key + oauth, Pause+Approve+Reject) | 2h |
| Phase 3.3.1.3.2 Re-Smoke (Regression-Sicherheit) | 1h |

**Total: ~9-10h** (substantieller als Briefing-Default — Big-Bang
beinhaltet API-Key-Pfad-Migration + Phase-3.3.1.3.x-Code-Removal +
End-to-End-Smoke-Migration für beide Auth-Modi).

**Alternative: Graduelle Migration** (verworfen per Setzung 3.4.3.0):
- Phase 3.4.3.1a (oauth-only, ~4h) → Phase 3.4.3.1b (api_key, ~3h) →
  Phase 3.4.3.1c (Marker-Cleanup, ~2h)
- Vorteil: kleinere Diffs, weniger Smoke-Risiko
- Nachteil: längere Übergangsphase mit Doppelt-Code

### Phase-3.4.4 (Reasoning) + 3.4.5 (TwinService-Integration)

Phase 3.4.3.1 macht Phase 3.4.4 + 3.4.5 substantiell-kleiner:

- **3.4.4 Reasoning:** Provider hat schon `reasoning`-Content-Parts (Phase
  3.4.1). TwinService-Integration ergänzt nur Audit-Mapping. Trivial.
- **3.4.5 TwinService-Integration:** oauth-Branch in `runModel` (1 Zeile)
  ersetzt durch `codexProvider.languageModel(...)`. Plus
  `runModelViaCodex`-Removal (~600 LOC weg). Plus alle Resume-Pfade aus
  3.3.1.3.x weg (~400 LOC weg). **Total ~1000 LOC Removal-Win.**

**#131 Phase-3-Closure-Schätzung:** Phase 3.4.3.1 + 3.4.4 + 3.4.5 zusammen
**~12-14h (~1.5-2 Bautage)**. Danach Phase 4 + 5 (~2-2.5 Bautage). Plus
Phase 5 Smoke + Doku — #131 voll geschlossen in **Tag 28-29**.

### Bonus-Beobachtung: Resume-Performance

End-to-End-Resume-Latenz im Spike: **2s** (Test 2 mit echtem Codex-Pro).
Heutige Phase-3.3.1.3.2-Implementation: **5.4s** für gleiche Trigger.
Substantielle Performance-Verbesserung durch:
- Kein eigener Resume-Loop (Vercel-SDK direct execute + final-text in
  einer Iteration)
- Keine Re-Persistierung des codexResumeContext
- Vermutlich auch weil Provider-Round-Trip schmaler ist (kein
  `function_call_output`-Array-Append-Overhead)

§p hat das schon angedeutet: "Tool-Call-Pfad ist Reasoning-frei". Resume-
Iteration ohne Reasoning → ~1.5-2s schneller.

### Stop für Phase-3.4.3.1-Bau-Freigabe

§r-Findings reichen für Bau. User-Entscheidung:
- **(A)** Phase 3.4.3.1 jetzt anfangen (Big-Bang, ~9-10h, vermutlich 2
  Bautage)
- **(B)** Phase 3.4.3.1 für morgen (Tag 28) priorisieren, Tag 27 hier
  beenden (20+1=21 Blöcke)
- **(C)** Phase 3.4.3.1 später, Phase 4 (CLI-Login) jetzt für Closure-
  Speed

## Re-Estimate Tag 27 Nachmittag

Initial-Schätzung (Tag 25): L (3-5 Bautage)
Strategy-Closure Tag 27 Vormittag: XL (5-7 Bautage)
**Nach Phase-3-Architektur-Findings: XXL (8-12 Bautage)**

Substantielle Komplexitäts-Treiber:
- Codex-Endpoint-Reverse-Engineering (eigene Request/Response-Logic)
- SSE-Streaming-Robustness (Disconnection-Recovery, Cloudflare __cf_bm)
- Tool-Calls + Reasoning-Traces Format-Mapping
- ToS-Maintenance-Burden (Endpoint-Format kann sich ändern)

Phase-A-Launch-Window-Impact: KW 33-34 (statt KW 31-32). Buffer 0-7 Tage
(statt 5-15 Tage). Phase-A bleibt machbar aber ohne weiteren Slack.

## Bau-Plan — 5 Phasen mit Stop-Punkten

### Phase 1 — Backend-Foundation (1-1.5 Tage)

**Scope:**
- Migration 025: `oauth_tokens` Tabelle + `twins.auth_mode` Spalte
- `apps/runtime/src/oauth/openai-pkce.ts`: PKCE-Codes-Generator, Auth-URL-Builder, Token-Exchange-Client
- `apps/runtime/src/oauth/oauth-tokens-repo.ts`: CRUD mit Encryption (analog `crypto-utils.ts`-Pattern)
- Manual-Curl-Smoke: Token-Exchange mit Mock-Code

**Stop-Punkt:** DB-Schema durch, Auth-URL generierbar, Token-Exchange via Mock-Endpoint funktional.

### Phase 2 — Refresh-Service (1-1.5 Tage)

**Scope:**
- `apps/runtime/src/oauth/refresh-service.ts`: Background-Loop (60s-Interval), Lazy-Fallback bei Request-Time
- File-Lock für Concurrent-Prevention
- Error-Handling: Refresh-Failure → Audit-Log + Twin-Error-Message

**Stop-Punkt:** Refresh-Roundtrip via Mock-Token verifiziert, File-Lock-Race-Test grün.

### Phase 3 — Provider-Auth-Mode-Switch (1 Tag)

**Scope:**
- `apps/runtime/src/providers/openai.ts` erweitern: liest `twin.auth_mode`, falls `oauth` → Token aus `oauth_tokens`, falls `api_key` → existing Pattern
- TwinService-Refresh-Hook für Auth-Mode-Change

**Stop-Punkt:** Twin-Chat mit OAuth-Mode end-to-end funktional (lokales Dev via real OAuth-Login).

### Phase 4 — CLI-Command (1 Tag)

**Scope:**
- `apps/runtime/src/scripts/twin-oauth-login.ts`: Loopback-Listener (Port 1455), Auth-URL-Output, Status-Polling, Token-Persist
- `package.json` Script: `twin:oauth-login`
- Manual-Smoke: lokale Login-Roundtrip funktional

**Stop-Punkt:** `pnpm twin:oauth-login --twin=@markus` funktioniert local + dokumentierter SSH-Tunnel-Workflow validierbar.

### Phase 5 — Web-UI Status + Smoke + Doku (1-1.5 Tage)

**Scope:**
- Settings-Page: Auth-Mode-Indicator (Connected / API-Key / Not configured) + Switch-Button
- DEPLOYMENT.md §11: SSH-Tunnel-Setup-Workflow für VPS-User + OpenRouter-Fallback-Section
- README.md: OAuth als Bullet bei Features
- Production-Smoke 3/3 (Login-Roundtrip, Chat-Roundtrip, Token-Refresh)
- STAND-Update + #131-Closure

**Stop-Punkt:** #131 final ✅, Production-Bot funktional mit OAuth-Auth.

## Smoke-Tests (Phase 5)

**Pflicht-Pfade:**

1. **OAuth-Login-Roundtrip:** `pnpm twin:oauth-login --twin=@markus` auf VPS → SSH-Tunnel → Browser-Login → Token in DB encrypted ✅
2. **Chat-Roundtrip mit OAuth:** Settings zeigt „Connected", Chat in Web-UI an Twin → Response kommt zurück mit OAuth-Auth ✅
3. **Token-Refresh-Edge-Case:** Manual-Token-Expiry simulieren → Lazy-Refresh triggert beim nächsten Chat-Request ✅

**Edge-Case-Smokes (sollten grün sein, nicht-pflichtig):**

- Refresh-Failure → User-Facing-Error sichtbar
- Auth-Mode-Switch via Settings → alter Modus gelöscht, Twin neu konfiguriert
- Multi-Twin: zwei Twins mit verschiedenen OAuth-Accounts parallel funktional

## Verweise

- OpenAI Codex Auth-Doku: https://developers.openai.com/codex/auth
- OpenCode OAuth-Implementation: https://github.com/anomalyco/opencode/issues/3281
- RooCode OAuth-RFC: https://github.com/RooCodeInc/Roo-Code/issues/6993
- Hermes Agent VPS-Setup-Guide: https://hackmd.io/Dco4kJ0mSwCD2xFivfGCqg
- Codex Headless Feature-Request: https://github.com/openai/codex/issues/2798
- RFC 7636 (PKCE): https://datatracker.ietf.org/doc/html/rfc7636
