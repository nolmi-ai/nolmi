# #131 OpenAI Subscription-OAuth — Strategy

**Status:** Strategy-Phase abgeschlossen Tag 27 Vormittag, Bau-Start pending.

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
