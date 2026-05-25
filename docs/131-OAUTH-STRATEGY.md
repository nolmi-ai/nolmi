# #131 OpenAI Subscription-OAuth — Strategy

**Status:** Phase 1 + 2 + 3.0 Spike + 3.1 (3.1.1 + 3.1.2) + 3.2 + 3.3.0 Spike ✅ Tag 27. Phase 3.3.1 nächster Schritt (Tag 28) — Parser-Erweiterung + MCP-Pipeline-Mapping auf Basis verifizierter §k-Findings.

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
| **3.3.1 Parser-Erweiterung + MCP-Pipeline-Mapping** (Tag 28) | CodexSSEParser um function_call-Events erweitern, runModelViaCodex Tools durchreichen (skillsBlock + toolUseDirective), Mapping auf AuditMcpToolUseInputSchema, Multi-Step-Round-Trip-Spike | 1-2 Tage | offen |
| **3.3.2 Reasoning-Traces** (Tag 29, optional) | reasoning-Item-Type handlen, Audit-Persistenz | 0.5 Tag | offen |
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
