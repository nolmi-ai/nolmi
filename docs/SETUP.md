# Setup — Tag 1

Schritt-für-Schritt-Anleitung für den ersten Tag.

## Voraussetzungen

- Node.js 20 oder neuer (`node --version`)
- pnpm 9 oder neuer (`pnpm --version`)
  - Falls nicht installiert: `npm install -g pnpm`
- Ein OpenAI API-Key (oder später: Anthropic API-Key)

## Aufsetzen

```bash
# 1. Ins Projektverzeichnis wechseln
cd twin-lab

# 2. Dependencies installieren
pnpm install

# 3. Environment-Datei aus Template anlegen
cp .env.example .env

# 4. .env bearbeiten — den OpenAI-Key eintragen
#    OPENAI_API_KEY=sk-...

# 5. Datenbank initialisieren
pnpm db:init

# 6. Persona schärfen
#    Öffne docs/persona.md und ersetze die [TODO]-Blöcke mit eigenem Inhalt.
#    Mindestens die drei Hilfsfragen unter "Wie Markus klingt" beantworten.

# 7. Beides parallel starten — Runtime + Web
pnpm dev
```

Nach `pnpm dev` läuft:
- Runtime auf `http://127.0.0.1:4000`
- Web-UI auf `http://localhost:3000`

## Was gleich tun

1. **`http://localhost:3000` öffnen** → Landing-Page erscheint
2. **Auf „chat" klicken** → erste Nachricht eingeben
3. **Auf „stream" wechseln** in einem zweiten Tab → Live-Aktivität sehen
4. **Auf „settings" wechseln** → Audit-Log prüfen

## Persona iterieren

Phase 1 ist im Wesentlichen eine **Persona-Iteration**. Die Architektur steht;
was den Twin gut oder schlecht macht, ist `docs/persona.md`.

Workflow:
1. Persona ändern in `docs/persona.md`
2. Runtime neu starten (`Ctrl+C` und `pnpm dev` erneut, oder einfach Runtime
   neu starten — er liest persona.md beim Boot)
3. Im Chat testen
4. Wiederholen, bis externe Personen sagen: „klingt wie Markus"

## Wenn was nicht läuft

- **Runtime startet nicht:** prüfe ob `pnpm db:init` durchgelaufen ist und
  `data/twin.db` existiert
- **Web kann Runtime nicht erreichen:** prüfe `NEXT_PUBLIC_RUNTIME_URL` in `.env`
- **Modell antwortet 401:** OpenAI-Key in `.env` korrekt? `ACTIVE_PROVIDER=openai`?
- **TypeScript-Fehler:** `pnpm typecheck` zeigt sie alle, oft helfen
  `pnpm install` und IDE-Neustart

## Wechsel auf Anthropic

In `.env`:
```
ACTIVE_PROVIDER=anthropic
ANTHROPIC_API_KEY=sk-ant-...
ANTHROPIC_MODEL=claude-opus-4-7
```

Runtime neu starten. Kein Code-Change nötig — die Provider-Abstraktion macht
das.

## Telegram-Bot Local Development (#130, optional)

Wenn du den Telegram-Adapter lokal testen willst:

1. **Bot anlegen** über [@BotFather](https://t.me/botfather) auf Telegram
   (`/newbot`, Anweisungen folgen, Token kopieren).
2. **Bot-Token im Twin konfigurieren** über die Settings-UI (Phase 2.5 —
   sobald die UI-Route da ist; bis dahin via direktem DB-Insert in
   `telegram_configs`).
3. **Modus wählen.** Default ist Webhook (Production-Pattern), Local-Dev
   nutzt entweder Long-Polling (kein öffentliches Ingress nötig) oder
   Webhook + ngrok.

**Variante A — Long-Polling (einfach):**

In `.env`:
```
TELEGRAM_USE_POLLING=true
```

Runtime startet beim Boot einen Long-Poll-Loop pro gepaartem Bot — keine
öffentliche URL nötig. Skaliert nicht für viele Bots, perfekt für Dev.

**Variante B — Webhook + ngrok (Production-Pattern lokal):**

In `.env`:
```
TELEGRAM_USE_POLLING=false
RUNTIME_PUBLIC_URL=https://<dein-ngrok-host>.ngrok.io
```

In einem zweiten Terminal:
```bash
ngrok http 4000
```

Beim Pairing-Abschluss registriert die Runtime das Webhook bei Telegram
via `setWebhook`. Telegram POSTet Updates an
`<RUNTIME_PUBLIC_URL>/webhooks/telegram/<twin-handle>` — Runtime
verifiziert den Secret-Header und dispatcht ans Telegraf-Bot-Object.

**Pairing-Flow:**

1. In Settings-UI Code generieren (Phase 2.5; bis dahin via
   `PairingService.generatePairingCode(twin_id)`).
2. Auf Telegram an deinen Bot senden: `/start <code>`.
3. Bot antwortet mit `✓ Paired successfully…` — danach ist der Telegram-
   User als Owner gespeichert.

## Was Phase 1 nicht ist

Wenn dir während des Bauens auffällt „aber das müsste auch noch...", schau
in `docs/ROADMAP.md`. Wahrscheinlich ist es Phase 2. Disziplin im Scope ist
hier wichtiger als Featurefülle.
