# #130 Telegram-Adapter Stufe 1 — Architektur-Strategy

**Strategy-Session:** 24. Mai 2026, Nachmittag (Tag 25)
**Master-Doku:** [`docs/BLOCK-5-STRATEGY.md`](./BLOCK-5-STRATEGY.md) (Block-5-Überblick)
**Backlog-Item:** [`docs/BACKLOG.md` #130](./BACKLOG.md)

Dieses Dokument konkretisiert die Architektur für #130 Telegram-Adapter Stufe 1 (Owner-Only-Bridge) über sieben Achsen. Strategy-Session Tag 25 Nachmittag mit Web-Recherche zur Library-Wahl und Pattern-Übernahme aus existing Twin-Lab-Code (Encryption-Service, Traefik-Setup).

## Kontext

Strategischer Rahmen:

- **Phase A, Block 5** — Pre-Launch-Vorbereitung, Wettbewerbs-Pivot Tag 25
- **Scope-Begründung** — NanoClaw (29k Stars) und Hermes Agent (100k+ Stars) haben Multi-Channel-Messaging als Default. Twin-Lab Web-UI-only wirkt rückständig auch wenn Multi-Twin ein anderes Konzept ist. Telegram-Stufe-1 verteidigt minimal-viable.
- **Bau-Position in Block 5** — zuerst, vor #112-#115. Hero-GIF in #113 muss Telegram zeigen, deshalb Code-First-Reihenfolge.
- **Stufe-1-Scope** — Owner-Only-Bridge: Owner verbindet eigenen Telegram-Account via `/start <pairing-code>` zum eigenen Twin. Twin antwortet mit voller Memory-Tiefe und Persona. Single-User pro Twin, kein External-Sender-Auth-Flow. Stufe 2 (External Senders mit Pre-Approval) und Stufe 3 (Voll-Multi-Twin-Router) bleiben Phase B (ROADMAP Phase 4.1 Vollausbau).

## Setzungen (sieben Achsen)

### a) Bot-API-Library: Telegraf

| Setzung | Begründung |
|---|---|
| **Library:** `telegraf` (latest Major) | Stand 2026 die De-Facto-Wahl in Node.js-Ökosystem. TypeScript-First (typegram), aktive Maintenance, Middleware-Pattern Express.js-ähnlich. Express-Pattern passt mental gut zu Fastify-Pattern in Runtime. |
| **Alternative verworfen:** `node-telegram-bot-api` | Effektiv stagniert (16 Commits in 2020), deprecated `request`-Dependency, schwache TypeScript-Types. |

**Dependency-Hinzufügung:** `apps/runtime/package.json` — `telegraf` als production-dependency. Plus `@telegraf/types` falls separat benötigt (in neueren Versionen meist gebündelt).

### b) Token-Encryption: Reuse existing AES-256-GCM Pattern

| Setzung | Begründung |
|---|---|
| **Pattern:** Master-Key-Encryption via existing `EncryptionService` | Twin-Lab hat etabliertes Pattern für API-Keys und MCP-Server-ENVs (`ENCRYPTION_KEY` ENV, AES-256-GCM). Master-Key-Rotation-CLI (#34) deckt Rotation ab. |
| **Storage:** Bot-Token als `bot_token_encrypted` Spalte in neuer Tabelle | Defensiv: Bot-Token darf NIE in Plain-Logs, API-Responses oder Frontend landen. Pattern analog zu MCP-Server-ENVs. |
| **API-Surface:** GET-Endpoints geben nur `hasToken: boolean` + `bot_username` zurück, niemals den Token selbst | Same-Pattern wie API-Keys: Token wird Server-seitig entschlüsselt und an Telegraf-Init übergeben, Frontend sieht ihn nie. |

### c) Webhook-Domain-Setup: Path-Prefix unter `runtime.*`

| Setzung | Begründung |
|---|---|
| **URL-Pattern:** `https://runtime.<deine-domain>/webhooks/telegram/:twin-handle` | Runtime ist bereits Backend für externe Calls. Neue Subdomain wäre Cognitive-Overhead ohne Architektur-Gewinn. |
| **Authentication:** Telegram-Webhook-Secret im `X-Telegram-Bot-Api-Secret-Token`-Header. Path enthält Twin-Handle als Routing-Marker, nicht als Auth. | Telegram-Best-Practice: Secret-Token-Header ist canonical, Path-Routing für Multi-Tenancy. |
| **Traefik:** Keine neuen Labels nötig, existing Runtime-Container-Labels routen Path automatisch. | Single-Domain für Runtime = single Traefik-Rule. |
| **CORS:** Webhook-Endpoint braucht keine CORS-Header — Telegram-Server callen direkt, kein Browser. | Saubere Backend-zu-Backend-Surface. |

**Endpoint-Spec:**

```
POST /webhooks/telegram/:twin-handle
Headers:
  X-Telegram-Bot-Api-Secret-Token: <webhook-secret aus telegram_configs>
Body: Telegram-Update-Payload (JSON, Telegraf-typisiert)
Response: 200 OK (Telegram verlangt schnelle 200, sonst Retry)
```

### d) Migration-Schema: Zwei separate Tabellen

| Tabelle | Felder | Zweck |
|---|---|---|
| `telegram_configs` | `id` (TEXT PK), `twin_id` (FK), `bot_token_encrypted`, `bot_username`, `webhook_secret`, `paired_owner_telegram_user_id` (nullable), `pairing_code` (nullable, gesetzt während Pairing-Phase), `pairing_code_expires_at`, `created_at`, `updated_at` | Bot-Konfiguration pro Twin |
| `telegram_messages` | `id` (TEXT PK), `twin_id` (FK), `telegram_chat_id` (INTEGER), `telegram_message_id` (INTEGER), `conversation_id` (FK auf existing conversations), `direction` ('inbound' / 'outbound'), `text`, `sent_at` | Persistenz Telegram-Messages, FK auf existing conversation-Schema für Cross-Channel-Threading |

**Migration-Datei:** neue Migration in `apps/runtime/migrations/` mit nächster fortlaufender Nummer. SQL für beide Tabellen + Indices (auf `twin_id`, `telegram_chat_id`, `paired_owner_telegram_user_id`).

**Schema-Pattern:** konsistent mit existing `mcp_servers`-Tabelle (encrypted-Field-Pattern, Twin-FK, separate Configs-Tabelle).

### e) Owner-Pairing-Flow: Pairing-Code

**Sequenz:**

1. **Owner konfiguriert Bot** im Settings-UI: Bot-Token eintragen + Test-Connection-Button (verifiziert via `getMe`)
2. **Server generiert Pairing-Code** (kurzer numerischer Code, z.B. 6 Stellen, 10 Minuten TTL) und zeigt ihn im UI an: `"Send /start <code> to your bot to pair your Telegram account."`
3. **Owner schickt** `/start <code>` an seinen Bot via Telegram
4. **Webhook empfängt** `/start`-Command, prüft `<code>` gegen `pairing_code` in `telegram_configs`. Bei Match: `paired_owner_telegram_user_id = from.id` setzen, `pairing_code` löschen, Confirmation-Reply senden.
5. **Subsequent messages** vom gepaarten User werden als Owner-Messages erkannt, alle anderen Telegram-User bekommen Reject-Message.

**Sicherheits-Eigenschaften:**

- User-ID ist Telegram-permanent (Username kann sich ändern, ID nicht)
- Pairing-Code ist 1x-Setup-Friction, danach permanent
- Code-TTL verhindert lange-offene-Pairing-Windows
- Code-Generierung über `crypto.randomInt()` (nicht Math.random), 6-stellig (~1 Mio Möglichkeiten, mit Rate-Limit auf Pairing-Endpoint sicher genug)

**Variant 1 (Username-Check) verworfen:** Telegram-Usernames können geändert werden, Username-Spoofing technisch möglich. User-ID-basierte Auth ist Best-Practice.

### f) Webhook (Production) vs Polling (Local-Dev)

| Modus | Wann | Setup |
|---|---|---|
| **Webhook** | Production (mit Public-URL über Traefik) | `bot.launch({ webhook: { domain: 'https://runtime.<domain>', port: 4000, secretToken: <secret>, hookPath: '/webhooks/telegram/<twin-handle>' } })` |
| **Polling** | Local-Dev (kein Public-Tunnel nötig) | `bot.launch()` (default polling) |

**ENV-Switch:** `TELEGRAM_USE_POLLING=true` für Local-Dev, default `false` für Production. Wert pro Twin-Lab-Instanz (nicht pro Twin), in Runtime-Boot-Code ausgewertet.

**Telegraf-API:** beide Modi mit derselben Bot-Instanz-Konfiguration. Service-Layer abstrahiert.

**Lokales Dev-Setup:** Owner kann auf macOS/Linux `pnpm dev` starten, ENV `TELEGRAM_USE_POLLING=true` gesetzt, Bot pollt aktiv. Kein `ngrok` nötig. Bot-Token bekommt Owner über BotFather (1-Minuten-Setup).

### g) Cross-Channel-Conversation-Threading: Channel-unified

| Setzung | Begründung |
|---|---|
| **Threading-Modell:** Eine Konversation, Channel-Marker pro Message | Twin-Lab-Story: „ein Twin mit konsistenter Identität". Channel-getrennt würde Owner-Frage produzieren „warum kennt mich der Twin auf Telegram nicht?". |
| **Schema:** existing `conversations`-Tabelle bleibt unverändert, neue Spalte `channel` (`'web' \| 'telegram'`) in Message-Tabelle (oder Message-Metadata-JSON-Feld, je nach existing Schema-Pattern) | Minimaler Schema-Impact, Channel als Anreicherungs-Information. |
| **UI-Darstellung:** Web-Conversation-View zeigt Channel-Badge pro Message (z.B. kleines Telegram-Icon für Telegram-Messages) | Cross-Channel-Transparenz für Owner, kein Mystery wo Message herkommt. |
| **Memory-Layer:** unverändert, Episodic-Memory indiziert alle Messages unabhängig vom Channel | Memory war ohnehin schon Channel-agnostisch — saubere Architektur, kein Refactor nötig. |

**Cross-Channel-Demo-Story (für Hero-GIF #113):**

1. Owner schreibt Twin auf Telegram: „Erinnerst du dich an unser Projekt-Meeting?"
2. Twin antwortet mit Detail aus Memory (das ursprünglich aus Web-Chat stammte)
3. Owner wechselt zu Web-UI, Conversation-View zeigt Telegram-Messages und neue Web-Messages in einem Thread
4. Hero-GIF-Punch: „Same twin, web + Telegram, one continuous conversation."

## Bau-Sequenz (5 Phasen, geschätzt ~4.5 Bautage)

### Phase 1 — Backend-Foundation (~1 Tag)

- Migration für `telegram_configs` + `telegram_messages` Tabellen
- `TelegramConfigsRepo` in `apps/runtime/src/db/repos/` (CRUD + Encryption-Wrapper via existing `EncryptionService`)
- `TelegramMessagesRepo` (Persistence + Conversation-FK-Logik)
- Smoke: Migration läuft, Repos werden in Unit-Test mit Mock-Encryption getestet

### Phase 2 — Telegraf-Service + Owner-Pairing (~1.5 Tage)

- `apps/runtime/src/telegram/`-Service mit Telegraf-Bot-Manager
- Bot-Instanz pro Twin (multi-tenant), gemanaged via `TelegramBotRegistry`
- Webhook-Endpoint mit Secret-Token-Verification
- Owner-Pairing-Flow: `/start <code>`-Command-Handler, Code-Validation, User-ID-Persistence
- Polling-Modus über ENV-Switch
- Smoke: Lokaler Bot über BotFather erstellt, Pairing-Flow End-to-End durchlaufen

### Phase 3 — Message-Routing + LLM-Integration (~1 Tag)

- Inbound-Message-Handler: Telegram-Update → Conversation-Insert → Twin-Service-Call → LLM-Response → Outbound-Send
- Channel-Marker durchgängig setzen
- Memory-Layer transparent integriert (existing Code unverändert)
- Smoke: Multi-Turn-Konversation mit Memory-Recall über mehrere Sessions

### Phase 4 — Settings-UI (~0.5 Tag)

- Settings-Section „Telegram-Bot" pro Twin
- Bot-Token-Eingabe + Test-Connection-Button (`getMe`-Call)
- Pairing-Code-Display + Refresh-Button
- Paired-Status-Anzeige + Unpair-Button (für Re-Pairing)
- Cascade-Delete-Warning (wenn Bot-Konfig entfernt wird)

### Phase 5 — Production-Deploy + Smoke (~0.5 Tag)

- Production-Build mit neuer Migration
- Webhook-URL bei Telegram registrieren (`setWebhook`-Call nach Bot-Konfig)
- Smoke-Tests:
  - Send-Receive-Roundtrip via Production-Webhook
  - Multi-Turn mit Memory-Recall
  - Cross-Channel-Threading: Telegram-Message + Web-Message in einer Conversation-View
  - Non-paired-User schickt Message → wird abgewiesen

## Anmerkungen

- **Telegraf-Bot-Instances:** ein Bot pro Twin (multi-tenant). `TelegramBotRegistry` managed Lifecycle (start/stop/reload). Memory-Footprint pro Bot: ~10-20 MB Heap. Bei 3 Twins = ~60 MB Overhead — vernachlässigbar.

- **BotFather-Setup-Friction:** Owner muss in BotFather Bot anlegen (Username + Token), bevor Settings-UI-Konfig möglich ist. Diese 1-Minuten-Friction ist intrinsisch Telegram, nicht Twin-Lab. Settings-UI bekommt Hilfe-Link zu BotFather-Anleitung.

- **Cascade-Delete-Verhalten:** wenn Owner Twin löscht, müssen Telegram-Configs + Messages mit-gelöscht werden, plus `deleteWebhook` an Telegram. Pattern analog zu MCP-Server-Delete.

- **Production-Webhook-Voraussetzung:** Runtime-Domain muss HTTPS haben (Telegram lehnt HTTP-Webhooks ab). Already-given durch existing Traefik+LetsEncrypt-Setup.

- **Stufe-2-Vorbereitungen:** Diese Architektur ist Stufe-2-ready: External-Sender-Auth-Flow wäre Erweiterung von `paired_owner_telegram_user_id` zu `paired_telegram_users[]`-Liste mit Approval-State pro User. Kein Refactor, nur Erweiterung.

## Verweise

- **Block-5-Überblick:** [`docs/BLOCK-5-STRATEGY.md`](./BLOCK-5-STRATEGY.md)
- **Backlog-Item:** [`docs/BACKLOG.md` #130](./BACKLOG.md)
- **Existing Encryption-Pattern:** `apps/runtime/src/services/encryption.ts` (oder wo `EncryptionService` heute liegt — vor Bau-Phase-1 verifizieren)
- **Existing Multi-Tenant-Pattern:** `apps/runtime/src/db/repos/mcp-servers-repo.ts` (Vorlage für `telegram-configs-repo.ts`, ggf. anderer Pfad — vor Bau-Phase-1 verifizieren)
- **Telegraf-Docs:** https://telegraf.js.org/
- **Telegram Bot API:** https://core.telegram.org/bots/api
