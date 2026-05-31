# DISTRIBUTION — Nolmi als Produkt für andere

**Stand:** Strategie-Session abgeschlossen Tag 31 (30. Mai 2026). **Status:** Setzungen D1–D5 gelockt. **Etappe 1 + Etappe 2 (inkl. Production-Deploy Schritt 5, `c88f0eb`, Migration 026 FK-safe auf Echtdaten) abgeschlossen** — Production läuft auf `srv1712371`. Offen: Onboarding-Wizard-Solo-Pfad, **Schritt 3b** (TLS/Traefik-Install), Update-Mechanismus, Etappe 3 (Release, gated durch §5).

**Kontext:** Nolmi läuft produktiv für Markus (Self-Hosting-VPS, siehe [`docs/PHASE-4-VPS-STRATEGY.md`](./PHASE-4-VPS-STRATEGY.md)). Diese Doku rahmt den Schritt von „läuft für mich" zu **„ist ein Produkt für andere"**. Sie ist Strategie-Setzung + Bau-Vorlage; konkrete Sub-Block-Briefings entstehen pro Etappe.

---

## 1. Ziel + zwei Wege

**Ein Produkt, zwei Betriebsmodi:**

1. **Self-Hosting via GitHub** — One-Liner-Install (`curl … | sh` o.ä.), wie OpenClaw / Hermes. User bringt eigenen LLM-Key, hostet auf eigener Maschine/VPS, volle Datenhoheit. **Der primäre Weg (D1).**
2. **Managed via `nolmi.ai`** — gehostete Instanz, der User registriert sich und nutzt ohne eigene Infrastruktur. **Der zweite Strang** — eigenes kommerzielles Unternehmen, bewusst später (D5).

Beide Modi sind **derselbe Code**. Der Unterschied ist Betrieb (wer hostet), nicht Funktion. Distribution heißt: das, was heute für eine Person läuft, so verpacken, dass andere es in Minuten starten — und die wenigen Stellen härten, die „eine Person" stillschweigend angenommen haben.

---

## 2. Die fünf Setzungen

### D1 — Self-Hosting zuerst, Managed zweiter Strang

**Self-Hosting ist der erste Distributions-Weg, Managed folgt.**

Begründung:
- **Der Code ist bereits Self-Host-fähig** — Nolmi läuft genau so auf Markus' VPS. Das Cookbook (`DEPLOYMENT.md` §9 + die Phase-4-Befunde) ist faktisch die Anleitung; Distribution automatisiert sie, erfindet sie nicht.
- **OAuth-Liability ist dezentral kleiner** — verteilt auf viele Self-Hoster mit je eigenem Key liegt das Risiko beim Einzelnen, nicht zentral bei uns (siehe D2 + §6).
- **Open-Source-Reichweite** — der Self-Hosting-Markt 2026 (OpenClaw/Hermes) zeigt: One-Liner + Open Source ist der Reichweiten-Hebel.
- **Managed = eigenes Unternehmen** — gehostet anzubieten ist Betrieb, Support, Abrechnung, Haftung, DSGVO. Das ist ein eigener Schritt mit eigener Entscheidung (D5), nicht ein Nebenprodukt des Self-Hosting-Release.

### D2 — API-Key-Default (der Fels); OAuth als widerrufbare Betreiber-Setzung, provider-differenziert

**Grundsatz:** **API-Key (BYO) ist der Default und der Fels.** Er funktioniert **provider-unabhängig** und hängt von **keiner Drittanbieter-Politik** ab — er trägt das System weiter, egal was ein einzelner Provider mit seinen OAuth-/Subscription-Mustern macht. **OAuth ist IMMER eine bewusste, widerrufbare Betreiber-Setzung** über die Allowlist (`auth_mode` + Admin-CLI `twin:auth-mode`, gebaut in 2.4a) — **nie ein Default**, und **nie ein Code-Pfad, der annimmt, dass ein Provider OAuth dauerhaft stützt**. **Anonyme Fremde bekommen API-Key-only.** Diese Setzung hat **eingebaute Vergänglichkeit**: die Provider-Lage unten ist beweglich, deshalb ist die Robustheit nicht „OAuth sicher machen", sondern „nie davon abhängen".

**Mechanik:** ein `auth_mode`-Flag pro Account/Twin — `api_key` (Default) / `oauth` (manuell gesetzte Ausnahme). UI-Gate blendet den OAuth-Pfad nur bei `oauth` ein. **Kein Self-Service-OAuth** — niemand kann sich selbst OAuth freischalten.

**Durchsetzung gebaut (Etappe 2.4a, Block 24, lokal verifiziert):** Das Flag war vorher nur passiv (Send-Path-Provider-Wahl) + der OAuth-Start war lückenhaft (UI bot api_key-Twins „OAuth aktivieren", CLI `twin:oauth-login` schaltete jeden Twin selbst auf `oauth`). Jetzt **zwei-Ebenen-Gate**: (1) `twin:oauth-login` **lehnt hart ab**, wenn `auth_mode != 'oauth'` (kein Self-Grant mehr). (2) Settings-UI zeigt bei `api_key` **nur Status, keinen Aktivieren-Pfad**. (3) Allowlisting läuft getrennt über den **Admin-CLI `twin:auth-mode <@handle> oauth`** (Shell-only = self-hosted-Admin) — es gibt **keine HTTP-User-Route**, die `auth_mode` ändert (`/full-config` ignoriert das Feld, verifiziert). So ist das Flag echte Vorbedingung statt Login-Nebeneffekt.

**Provider-Lage (Stand 31. Mai 2026, beweglich — verifiziert):** OAuth-/Subscription-Reuse ist bei keinem großen Provider offiziell für Dritt-Tools gewidmet; der Status ist ein bewegliches Ziel:
- **Anthropic:** hat das Subscription-OAuth-Muster (Claude-CLI-Token-Reuse / `claude -p`) zwischenzeitlich **blockiert** (April 2026, Accounts terminiert), **laut OpenClaw-Doku inzwischen wieder toleriert**. Bewegliches Ziel — toleriert heute, nicht garantiert morgen.
- **OpenAI/Codex:** Codex-OAuth **funktioniert** in Drittanbieter-Tools (OpenClaw nutzt es), ist aber ein **reverse-engineertes Community-Muster**, **nicht offiziell für Dritte gewidmet**, und kann sich laut Quelllage **jederzeit ändern**. Toleriert, nicht garantiert.

**Architektur-Konsequenz (das Robuste):** Nolmi darf **nie** davon abhängen, dass ein bestimmter Provider OAuth erlaubt. Die 2.4a-Allowlist-Mechanik ist genau richtig — sie macht OAuth zu einer **pro-Twin-Betreiber-Entscheidung**, die bei einem Politik-Wechsel **einfach widerrufen** wird (`twin:auth-mode <@handle> api_key`), **ohne dass Architektur bricht**. Der API-Key-Default trägt das System unabhängig davon weiter. Robustheit = die Widerrufbarkeit, nicht die Wette auf Provider-Toleranz.

**Self-Hosting vs. Managed (die Grenze):**
- **Self-Hosting:** OAuth-Muster **nutzbar** — der Nutzer verwendet sein **eigenes** Abo auf seiner **eigenen** Maschine. Das Liability-Risiko (reverse-engineertes Muster, Politik-Wechsel) liegt **beim Nutzer** und ist überschaubar.
- **Managed (`nolmi.ai`):** OAuth-Muster **heikel** — hier würde **Nolmi** das Liability tragen (fremde Tokens, zentral von einer Server-IP refreshend = Subscription-Sharing-Optik, ein Terminierungs-Trigger). **Vorsicht; nicht ohne bewusste Entscheidung einbauen.** Der API-Key-Default bleibt im Managed-Kontext die sichere Linie; OAuth dort nur für eine bekannte, klein gehaltene, aufgeklärte Allowlist-Gruppe mit offener Risiko-Kommunikation.

### D3 — Bridge optional (drei Stufen)

Die A2A-Bridge ist heute faktisch Voraussetzung (Twins registrieren sich, Boot erwartet sie). Für Distribution muss ein **Solo-Twin ohne Bridge** der Default-Einstieg sein. Drei Stufen:

1. **Standalone** — Twin läuft ohne jede Bridge (kein A2A). Der Default-Einstieg fürs Self-Hosting.
2. **Eigene Bridge** — User hostet seine eigene Bridge (z.B. Familie/Team), Twins darin reden miteinander.
3. **Fremde Bridge** — Twin bindet sich an eine bestehende Bridge (z.B. eine Community-Bridge).

**D3-Scope = Entkopplung + Re-Bind**, nicht Föderation:
- Schema NULL-fähig machen, wo heute eine Bridge-Referenz hart erwartet wird (`bridge_url`/`bridge_token` optional).
- **Boot-Guard:** Runtime bootet sauber ohne Bridge (kein Crash, klare Log-Zeile „kein Bridge-Modus").
- **A2A-UI-Toleranz:** die Web-UI zeigt A2A-Features ausgegraut/abwesend statt zu brechen, wenn keine Bridge da ist.
- **Re-Bind:** ein Twin kann nachträglich an eine Bridge gebunden werden (Stufe 1 → 2/3). **✅ Etappe 2.4b (Block 25):** CLI `twin:bind-bridge <@handle> --bridge-url <url> [--register-token …]` bindet einen Solo-Twin (bridge_url NULL) an die **eigene** Bridge (Owner kennt das Register-Token). Nutzt den vorhandenen `registerHandleOnBridge`-Mechanismus; registriert ZUERST an der Bridge, schreibt bridge_url/token ERST nach Erfolg (atomar — Fehlerfall lässt den Twin Solo). Re-Bind greift nach **Runtime-Neustart** (Boot-Guard baut den BridgeClient/Stream beim Twin-Load; kein Live-Re-Init). Nur solo→bound (kein Umbinden), `auth_mode` unberührt. UI-Knopf in Settings als spätere zweite Tür notiert (Neustart-Erfordernis macht UI-Re-Bind ohne Live-Reload wenig sinnvoll). Lokal verifiziert.

**Ausdrücklich NICHT in D3:** offene Föderation mit Fremd-Vertrauen (mehrere Bridges sprechen, Trust über Bridge-Grenzen) — das ist **Produkt-Phase 4** (Multi-Channel/Föderation, ROADMAP-Achse 1), nicht Distribution. **2.4b deckt nur die EIGENE Bridge ab** (Owner hat Register-Token); fremde Bridge / Fremd-Trust bleibt Phase 4.

### D4 — Phase 2.5 reicht für die Allowlist-Gruppe; Fremden-Apparat vertagt

Die heutige Multi-Tenant-Schicht (Phase 2.5: User-Auth, Trust-Layer, per-Twin-Isolation) **reicht für die Allowlist-Gruppe** (Owner + F&F auf `nolmi.ai`). Der **Fremden-Apparat** — Self-Service-Signup, Abuse-/Rate-Limits, Resource-Limits pro Tenant, DSGVO-Apparat — wird **nach Closed-Beta-Logik vertagt** (erst wenn echte Fremde kommen, D5).

**Ein Sofort-Schritt zieht aber vor:** ein **Tenant-Isolations-Audit** — die Verifikation, dass **jede** DB-Query owner-scoped ist (kein Twin/User kann Daten eines anderen sehen). Motiviert durch die **#59-Präzedenz** (`/messages/:id/sender` leakte Existenz, bevor es Auth bekam): Isolations-Lücken sind genau die Klasse Bug, die im Single-User-Betrieb unsichtbar bleibt und beim ersten echten zweiten Fremden zum Daten-Leak wird. Read-only Audit, Etappe 0 (§3).

### D5 — Gratis-Closed-Beta jetzt; kommerziell-Managed als bewusst offene spätere Tür

**Jetzt:** Self-Hosting **Open Source + gratis**; `nolmi.ai` **privat** (Owner + F&F, Closed Beta, kein offenes Signup). **Kommerziell-Managed** (bezahltes Hosting) ist eine **bewusst offen gehaltene spätere Tür** — keine Absage, aber auch keine jetzige Verpflichtung. Der **Fremden-Apparat (D4)** wird erst gebaut, **wenn diese Tür durchschritten wird**.

**Entscheidung vertagt** auf „nach dem Self-Hosting-Launch, mit Resonanz-Information" — ob/wann Managed kommerziell wird, entscheidet sich an der tatsächlichen Resonanz des Open-Source-Release, nicht vorab. (Konsistent mit ROADMAP-Veröffentlichungs-Strategie: „offen, Tendenz Open Core, MVP first".)

---

## 3. Bauschritt-Sequenz (vier Etappen)

### Etappe 0 — Diagnosen (alle read-only, kein Code)

Bevor irgendetwas gebaut wird — Sicht holen (Pattern aus den Phase-4-Lessons #45/#64):
- **Bridge-Abhängigkeitstiefe** — wie tief sitzt die Bridge-Annahme im Boot/Schema/Send-Path/UI? Bestimmt die Größe von Etappe 1. (Cross-Ref `PHASE-4-VPS-STRATEGY.md` §4: Bridge ist 2 Tabellen, aber die Runtime-Kopplung ist die offene Frage.)
- **Tenant-Isolations-Audit (D4)** — ist jede Query owner-scoped? Liste der DB-Zugriffspfade, je „scoped / nicht scoped / unklar".
- **Onboarding-Stand (#110)** — was kann der Wizard heute web-only vs. was braucht den CLI-Pfad? Bestimmt, wie viel CLI-Onboarding Etappe 2 bauen muss.

### Etappe 1 — Bridge-Optionalität (D3) — ✅ Kern gebaut + verifiziert (Tag 31 Block 20+21)

Entkopplung + Boot-Guard + A2A-UI-Toleranz. Die Diagnose D-1 ergab: **Guard, kein durchziehender Umbau** (der Kern-Wertpfad war schon bridge-frei). Umgesetzt (Commit `6c6032f`): Migration 026 (`bridge_url`/`bridge_token` nullable, FK-Cascade-sicher via Runner-`foreign_keys_off`-Opt-in), Registry-Boot-Guard, A2A graceful (`BridgeDisabledError` → HTTP 409 `bridge_disabled`), Chat-UI-Toleranz, `bootstrap-twin` Solo-Pfad. **Lokal 4/4 am Verhalten verifiziert** (Solo-Twin `@solo`: Boot „Solo-Modus"/kein Reconnect-Loop · Direct-Chat end-to-end ohne Bridge → 200 · UI blendet A2A aus · A2A-Send → 409; Bridge-Twin-Regression intakt).

**Verbleibend aus Etappe 1 (→ Etappe 2):** ~~Re-Bind~~ ✅ (Etappe 2.4b, CLI `twin:bind-bridge`, eigene Bridge) + Onboarding-Wizard-Solo-Pfad + ~~Production-Deploy der Migration 026~~ ✅ (Schritt 5, siehe Etappe 2 unten — `c88f0eb` auf `srv1712371`, **026 FK-safe auf Echtdaten**). UI-Re-Bind-Knopf (zweite Tür) + Umbinden bereits gebundener Twins als spätere Sub-Punkte.

### Etappe 2 — Distribution-Layer

- **One-Liner-Install** — Automatisierung von Phase-4-B1+B2 (VPS-Prep + Docker + Stack-Build). **Zwei-stufig nach TLS-Bedarf:**
  - **Drei Self-Hosting-Szenarien** — der Single-Host-Pfad (2.3) deckt die ersten zwei ab, 3b das dritte:
    1. **Lokal** (Laptop, Browser auf demselben Rechner) → 2.3, `NOLMI_HOST=localhost`.
    2. **VPS ohne Domain** (Server-IP, http) → 2.3, `NOLMI_HOST=<server-ip>`.
    3. **VPS mit Domain** (HTTPS, `app.<domain>`) → **3b** (Traefik/ACME/BasicAuth).
  - **✅ Schritt 2.3 (Block 26 gebaut, Block 27 Frische-Test bestanden) — Single-Host ohne TLS:** `install/install.sh` (`curl … | bash`) + Traefik-freie `docker/nolmi/docker-compose.single-host.yml` (Ports 3000/4000/5100 direkt). Prüft Docker, holt Repo, generiert Secrets lokal via `openssl` (Format = `key:generate`/`loadMasterKey`: `NOLMI_ENCRYPTION_KEY` 32-Byte-base64), baut+startet, übergibt an `twin:onboard`. Adressiert die Single-Host-relevanten §7-Befunde: **B2-Befund 2** (`TELEGRAM_USE_POLLING=true` → kein `RUNTIME_PUBLIC_URL`-Crash-Loop) + **#126** (`NEXT_PUBLIC_RUNTIME_URL=http://<host>:4000`, `DEPLOYMENT_LABEL=self-host` statt production → Build-Guard no-op) + Single-Host-spezifisch `SESSION_COOKIE_SECURE=false` (Login über http). DB-Init idempotent im Container-CMD. **Frische-Test bestanden (Block 27):** echter Lauf von Null in einem isolierten `docker:dind`-Wegwerf-Container (srv1046432, danach restlos entfernt) — credential-frei via `git archive` (**Mode 1**, kein Clone/PAT), **7/7 Schritte grün**, **3 Container gesund**, alle **26 Migrationen frisch inkl. 026 (`foreign_keys_off`) auf leerer DB**, kein `EADDRINUSE`/Telegram-Crash-Loop, Isolation gehalten.
  - **Schritt 3b (offen) — Production/TLS (Szenario 3):** Traefik + ACME + Domain + BasicAuth (der bestehende `docker-compose.yml`). Die Traefik-spezifischen §7-Befunde (Traefik v3.6, Netz `external`, htpasswd am Traefik-Stack, Resolver-Store-Reset) gehören dorthin.
- **CLI-Onboarding** — zweite Tür neben dem Web-Wizard (#110), für Self-Hoster.
  - **Etappe 2.1 ✅ (Block 22, Commit 24665a1):** `twin:bootstrap` setzt `owner_user_id` via `OWNER_EMAIL`-Lookup (+ `OWNER_USER_ID`-Fallback, WARN bei fehlendem Owner). Der Release-Blocker (frisch ge-bootstrappter Twin ownerlos + im Switcher unsichtbar) ist damit für den **direkten Bootstrap-Weg** behoben.
  - **Etappe 2.2 ✅ (Block 23, Weg A / Opt 3, lokal verifiziert):** `pnpm twin:onboard` legt **nur den ersten User** an (E-Mail+Passwort interaktiv, `readSecret`) — die einzige Lücke, die der Browser nicht kann (keine öffentliche Signup-Seite). Den **Twin baut danach der Web-Wizard** im 0-owned-Twins-Flow (Persona+LLM-Key+Presets im UI; Owner wird dort korrekt gesetzt, `server.ts:791`). **Diagnose-Befund (Phase A):** der Web-Wizard kann **keinen vorhandenen Twin aufgreifen** (`/onboarding/submit` macht immer `INSERT`, 409 bei existierendem Handle) und ein Owner-mit-Twin landet nie im Wizard (`/chat`→`/chat/<handle>`). Deshalb legt das CLI bewusst **keinen** Twin an → kein Doppel-Twin, kein 409. **Endzustand: zwei gleichwertige Türen** für den User-Bootstrap (CLI legt ersten User, Browser-Wizard macht den Twin).
  - **Weg B (später):** durchgehendes Terminal-Onboarding inkl. Persona/LLM-Key im CLI — baut auf 2.2 auf (Opt 3 verbaut es nicht). Bräuchte u.a. einen „vorhandenen Twin ergänzen"-Pfad im Wizard ODER einen Stub-Twin-Modus im Bootstrap.
- **`auth_mode`-Flag (D2) — ✅ Etappe 2.4a (Block 24):** Durchsetzung gebaut. `twin:oauth-login` gated hart auf `auth_mode='oauth'` (kein Self-Grant), Settings-UI ohne OAuth-Pfad bei `api_key`, Allowlisting nur via Admin-CLI `twin:auth-mode` (keine HTTP-User-Route). Lokal verifiziert (beide Ebenen). Verbleibend: optional eine `auth_mode_default`-Policy für Managed-Mode (heute global `api_key`-Default reicht).
- **Production-Deploy (Schritt 5) — ✅ Sammeldeploy `c88f0eb`, Production live.** `main`→`c88f0eb` auf `srv1712371` (Etappe 1 + 2.1/2.2/2.4a/2.4b/2.3 + **Migration 026**). **Befund vorab:** die Etappe-2-Commits waren lokal committet, aber **nicht gepusht** (`origin/main` `2ad7d3d`→`c88f0eb`, FF) — Single-Point-of-Failure beseitigt. **Migration 026 (destruktiver FK-Rebuild) auf Production-Echtdaten SICHER:** Log „026 … angewendet (foreign_keys_off-Modus)" (neuer FK-sicherer Runner fuhr sie), `foreign_key_check` leer, `bridge_url`/`bridge_token` `notnull=0`, **Kind-Tabellen-Counts vorher=nachher identisch** (nur `schema_migrations` 25→26) → kein Cascade-Verlust. B4-Klasse Pre-Flight: `VACUUM INTO`-Backup beider DBs offsite, Rollback-Image `rollback-025` getaggt. Live: Direct-Chat @markus (`app.nolmi.ai`), A2A @markus→@florian (201), `auth_mode`-Gate 2.4a. 3 Container Up, Bridge unangefasst. **Offen (Backlog, kein Blocker):** `nolmi.ai` Apex liefert 404 (Landing-Page fehlt). **3b (TLS-Install) bleibt offen.**
- **Update-Mechanismus** — wie ein Self-Hoster eine neue Version zieht (git pull + rebuild, oder Image-Tag-Bump).
- **NPM-Distribution (`npm i -g nolmi` → `nolmi onboard`) — Phasenweg, an die Public-Strategie gekoppelt (Diagnose Tag 33, Pfad a).** Ein globales npm-Paket wie OpenClaw. **Phasenweg:** **B jetzt** (dünner Wrapper um das Single-Host-Compose) → **A später** (Single-Process ohne Docker, eigener Diagnose-Befund Tag 33) → **C Endbild** (beide Modi, `nolmi onboard` vs. `--no-docker`). Der Phasenweg bleibt gültig — **aber der B-Bau ist an die Public-Strategie gekoppelt**, nicht davor.
  - **Diagnose-Befund (Tag 33):** B ist **technisch trivial** — die 7 `install.sh`-Schritte portieren sauber nach Node (`node:crypto` ersetzt das `openssl`-CLI, eine Abhängigkeit weniger), und **A-später wird nicht verbaut** (gemeinsames CLI-Gerüst, Docker-Orchestrierung als ein Modul, A als Geschwister-Modus). Der Haken ist **nicht** die Technik, sondern der **Code-Bezug**: das Single-Host-Compose baut aus `apps/*` (`build: context ../..`), den Source hat ein npm-Paket nicht automatisch — und **das Repo ist privat** (anonym `404` auf raw + Landing; der gestrige Frische-Test lief über `git archive`/Mode 1, nie über den Public-Clone).
  - **Drei B-Pfade:**
    - **B2 (Source ins npm-Paket):** heute baubar **ohne neue Infra** (~4.6 MB Source → npm-gzipped ~1–1.5 MB, via `package.json` `"files"`), aber = **Public-via-npm** (aktueller Stand öffentlich über den npm-Tarball) **+ Nutzer baut lokal** (Docker-Build). **VERWORFEN als Stolperschritt:** eine Public-Freigabe durch den Seiteneingang statt durch die bewusste Etappe-3-Entscheidung. (Der §5a-Secret-**History**-Vorbehalt überträgt sich nicht — der Tarball hat keine `.git`-History — aber der aktuelle Baum würde trotzdem ungewollt-öffentlich.)
    - **B1-Clone (CLI klont das Repo):** braucht **Repo public** → gated durch **Etappe-3-Gate §5a** (PAT-Rotation + Secret-History-Scan, ggf. `git filter-repo`). Nutzer braucht Docker + lokalen Build + Clone.
    - **B1-Image-Pull (Compose zieht vorgebaute Images):** **ENDBILD-NAH** — **kleinstes** npm-Paket (nur CLI + Compose), beim Nutzer **nur Docker** (kein Build, kein Source), **KEINE Source-Exposure** (nur Images), und **entschärft das Secret-History-Problem** (keine `.git`-History im Spiel). Voraussetzung: **Docker-Hub-Push** (Account existiert, Images werden aktuell nur lokal gebaut) + eine `image:`-Pull-Variante des Single-Host-Compose (heute `build:`).
  - **Technik-Befund (für den späteren Bau festgehalten):** eigenes Paket **`nolmi`** (Name auf npm **FREI**, Registry-404) mit `"bin": { "nolmi": "dist/cli.js" }`; der **Monorepo-Root bleibt `private:true`** (nie publiziert). Secrets via **`node:crypto`**: `NOLMI_ENCRYPTION_KEY` = 32-Byte-**base64** (byte-genaues `loadMasterKey`-Format), Session/Bridge-Token = 32-Byte-hex; `.env` mit `mode 0o600`, idempotent (skip wenn vorhanden). `onboard`-Übergabe via `docker compose exec -it` braucht **interaktiven TTY-Passthrough** (`stdio: 'inherit'`).
  - **ENTSCHEIDUNG (Pfad a, präzisiert Tag 33 durch die Open-Source-Setzung):** Der **NPM-Wrapper-Bau wird Teil des Public-/Etappe-3-Blocks** — NPM-Distribution gehört **hinter** die Public-Entscheidung, nicht davor. Da **Open Source gesetzt** ist (Repo public, §5/Etappe 3), ist **B1-Clone der primäre Pfad** (Wrapper klont das öffentliche Repo). **B1-Image-Pull** ist nicht mehr der primäre Weg — er war nur nötig, um Source zu verstecken, was mit Open Source entfällt; bleibt höchstens **optional** als schlankster Install-Weg (kein Schutz-Treiber mehr). **Nach dem Secret-Gate §5a.** Kein B2-Bau jetzt.

### Etappe 3 — Release

- **Install-README** — One-Liner + Voraussetzungen + Modus-Wahl (standalone/Bridge).
- **Repo öffentlich — Open-Source-Richtung GESETZT (Tag 33).** Code wird sichtbar (Open Source), **nicht** nur-Images. Begründung: A2A-Bridge soll Standard + Community werden, Managed ist Bequemlichkeit kein Burggraben, Beiträge + Reichweite gewünscht — alle drei verlangen offenen Code; der Managed-Schutz läuft über die **Lizenz** (§5b Copyleft-Start), nicht übers Verstecken. **§5a-Gate erfüllt** (Scan 🟢 sauber). Reihenfolge: finale Lizenz setzen → Hygiene-Re-Scan → public.
- **Lizenz** — **Copyleft-Start (AGPL-artig) als Default-Richtung**, finale Wahl offen am Lizenztext (s. **§5b**). *(MIT als Default verworfen — schlösse die spätere geschützte Option für immer, s. Relizenzierungs-Argument §5b.)*
- **NPM-Wrapper-Bau (`npm i -g nolmi`)** — **hierher gekoppelt** (Entscheidung Pfad a, §3 Etappe 2). **Nach dem Secret-Gate §5a.** **Mit der Open-Source-Setzung ist B1-Clone (Repo public) der primäre Pfad** — der Wrapper klont das öffentliche Repo. **B1-Image-Pull** entfällt als *primärer* Weg (er war nur nötig, um Source zu verstecken — bei Open Source kein Treiber mehr; kann **optional** als schlankster Install-Weg bleiben, aber nicht aus Schutzgründen). Technik-Befund liegt vor (eigenes `nolmi`-Paket, `node:crypto`-Secrets, TTY-Passthrough). B2 (Source-via-npm) verworfen.

---

## 4. Was schon steht (relativierend)

Distribution ist überwiegend **„verpacken, was da ist"** plus **eine** echte Architektur-Arbeit (Bridge-Optionalität, Etappe 1). Vorhanden:

- **Multi-Tenant (Phase 2.5)** — User-Auth, Trust-Layer, per-Twin-Isolation.
- **Memory** (Conversation/Semantic/Episodic), **Skills**, **MCP-Client**, **Telegram-Adapter** (#130), **OAuth #131** (Phase A).
- **Onboarding-Wizard (#110)** — Web-Pfad steht.
- **Docker + Traefik-Stack** (`docker/nolmi/`) **+ 6 verifizierte Cookbook-Befunde** — der Install-Script-Kern existiert als erprobtes Runbook.
- **Backup-/Migrations-Disziplin** — Doppel-DB-Migration, byte-genauer Encryption-Key, Token-Match (B4/B5 verifiziert).

Das einzige strukturell Neue ist die Bridge-Optionalität. Der Rest ist Automatisierung + Härtung.

---

## 5. Release-Gates (Blocker vor Repo-Öffnung)

**(a) Secret-freie Git-History — HARTER BLOCKER für den Open-Source-Weg.** Ein Repo öffentlich zu machen veröffentlicht die **komplette History**, nicht nur den aktuellen Stand. Konkret: der vorgestern im Chat-Kontext gepostete **Fine-grained PAT** (read-only, `nolmi-ai/nolmi`, für den VPS-Repo-Klon, S5) liegt **potenziell in der History/in Commits/Notizen**. Vor `Repo public`:
- **PAT rotieren** (alten Token bei GitHub widerrufen, neuen ausstellen) — entwertet den alten, falls er irgendwo liegt.
- **History-Secret-Scan** (`gitleaks`/`trufflehog` o.ä. über die volle History) — findet PATs, Keys, `.env`-Leaks. Bei Treffer: History-Rewrite (`git filter-repo`) **vor** dem Öffnen.

Das ist **kein Hygiene-Nice-to-have, sondern Release-Gate** — ein geleakter Token in öffentlicher History ist sofort kompromittiert. BACKLOG-Item, `must-vor-Release`.

**✅ ERFÜLLT (Tag 33):** **PAT-Rotation** durch (alter Token revoked, neuer read-only im Credential-Store). **Secret-History-Scan 🟢 sauber** — gitleaks 8.30.1 über die **volle History (327 Commits, alle Branches)** + manueller Muster-Gegencheck (sk-ant/sk-/`ghp_`/`github_pat_`/PEM/JWT = 0; keine echte `.env`/`.db` je committet; sensible ENV-Vars nur Platzhalter). **Einziger gitleaks-Treffer = dokumentierter False-Positive**: der Komponentenname `OAuthActivationModal` in einer `STAND.md`-Changelog-Zeile, von der Entropie-Heuristik fehlgedeutet — kein Secret. **Der Tag-30-PAT war nie in einem Commit** (nur Chat). → **Kein `git filter-repo`/History-Rewrite nötig.** **Hygiene-Reminder:** den Scan **unmittelbar vor** dem tatsächlichen Public-Schalten **einmal wiederholen** (deckt alles ab, was bis dahin noch committet wird).

**(b) Lizenz wählen — Default-Richtung von MIT auf Copyleft-Start revidiert (Tag 33).** **Lizenz-Entscheidung bleibt offen; Default-Richtung ist jetzt ein Copyleft-Start (AGPL-artig), MIT/permissiv als spätere Lockerungs-Option.** Die finale Wahl wird **am konkreten Lizenztext** getroffen, ggf. mit einem Fachkundigen — das ist rechtlich relevant und wird **nicht aus dem Stand fixiert**.

**Warum Copyleft-Start (der entscheidende Hebel — Relizenzierungs-Richtung):** Relizenzierung geht nur sicher **restriktiv→permissiv**. **AGPL→MIT** ist jederzeit möglich (der Rechteinhaber lockert); **MIT→AGPL** ist praktisch unmöglich — **jede einmal unter MIT veröffentlichte Version bleibt für immer permissiv forkbar**. Markus' Tendenz „permissiv-nah langfristig, geschützter Start" funktioniert deshalb **nur mit restriktivem Start**: MIT jetzt würde die spätere geschützte Option **für immer schließen**, Copyleft jetzt hält **beide** Türen offen.

**Warum das zu den Zielen passt (kein Widerspruch zu Open Source):** Markus' drei Ziele — A2A-Bridge soll langfristig **Standard + Community** werden (→ Code **offen**, nicht verstecken), Managed ist **Bequemlichkeits-Option, kein Monetarisierungs-Burggraben**, und **Beiträge + Reichweite** am Anfang gewünscht — sprechen **alle** für offenen Code. Der Schutz der Managed-Tür läuft **nicht übers Verstecken** (das widerspräche dem Community-Ziel), sondern **über die Lizenz**: Copyleft hält den Code offen **und** verhindert, dass ein Dritter eine geschlossene Managed-Konkurrenz aus genau diesem Code baut, ohne zurückzugeben.

**Open-Core/dual-license einordnen:** **ein einzelnes Copyleft auf das ganze Repo ist einfacher** als ein MIT-Kern/Bridge-Split (dual-licensed Teile) — und passt **besser** zum Ziel „Bridge offen". Ein dual-license-Apparat (D5-Territorium) wäre erst nötig, wenn ein kommerziell-geschlossener Managed-Kern gebaut würde; das ist heute nicht der Plan.

**Altlast-Hinweis (Konsistenz):** Das Repo trägt aus #111 (Repo-Hygiene Tag 25) bereits eine **Apache-2.0-`LICENSE` + `package.json: "license": "Apache-2.0"`** — gesetzt **vor** dieser Revision und damit jetzt **veraltet relativ zur neuen Richtung**. Beides ist **vor dem Public-Schalten an die finale Copyleft-Entscheidung anzupassen** (reine Code-/Metadaten-Änderung, hier bewusst noch nicht ausgeführt — diese Revision ist nur die Strategie-Setzung).

---

## 6. Differenzierung vs. OpenClaw / Hermes

**Marktbild 2026:** OpenClaw (Steinberger, ~100k Stars) und Hermes (Nous Research, ~153k Stars) sind die zwei dominanten self-hosted-Agent-Vorbilder. Beide: BYO-LLM + Memory + MCP + One-Liner-Install + Onboarding-Wizard. **Beide sind Solo-Agents — kein A2A.**

- **Solo-Twin = Einstieg auf deren Niveau.** Was OpenClaw/Hermes können (persönlicher Agent, Memory, Tools, einfacher Self-Host), muss Nolmi als Standalone-Twin (D3 Stufe 1) **gleichwertig** bieten — das ist die Eintrittskarte, nicht die Differenzierung.
- **A2A-Bridge = das, was keiner hat.** Twin-zu-Twin-Kommunikation (eigene Bridge, später Föderation) ist Nolmis **Alleinstellung**. Die Distribution muss den Solo-Einstieg leicht machen **und** den Bridge-Pfad als das sichtbar machen, was Nolmi von den Solo-Agents abhebt.
- **OAuth-Liability-Lehre (aus dem OpenClaw-Block).** Anthropic terminierte April 2026 OpenClaw-Accounts wegen zentral eingesammelter Subscription-OAuth. Lehre: OAuth ist als **verteiltes** Feature (self-hosted, je eigener Key) tragbar, als **zentral aggregiertes** Feature eine Liability. D2 setzt genau diese Lehre um.

---

## Verweise

- [`docs/ROADMAP.md`](./ROADMAP.md) — Distribution als Arbeits-Achse / Meilenstein
- [`docs/PHASE-4-VPS-STRATEGY.md`](./PHASE-4-VPS-STRATEGY.md) — VPS-Deploy + die 6 Cookbook-Befunde (§7), Basis des Install-Scripts
- [`docs/131-OAUTH-STRATEGY.md`](./131-OAUTH-STRATEGY.md) — OAuth-Mechanik (D2)
- [`docs/BACKLOG.md`](./BACKLOG.md) — Release-Gate-Item (§5a), #59-Isolations-Präzedenz (D4)
- [`docs/TWIN-VISION.md`](./TWIN-VISION.md) — Open-Core/Veröffentlichungs-Haltung (D5)
