# twin-lab — Stand

**Letztes Update:** 6. Juni 2026, Samstag — **Tag 39 ✅**: Verdichtungs-Blockade entdeckt (Prod reich an Facts, aber unverdichtet) + drei Bausteine gebaut + deployt — G2 (Telegram-Konversations-Lifecycle: idle Konv auto-enden+embedden), Proaktiv-Nudge Anlass 3 (unbeantwortete Twin-Frage), Reverse-Memory-Query (Lebens-Narrativ Stufe 1, reaktive Rückschau im Chat); Prod-Effekt-Verifikation (G2-Embeddings, Anlass-3-Pending) bewusst auf den morgigen Fokus-Loop-Tick vertagt. Voller Tagesbogen im Tag-39-Block unten. — **Davor** 2. Juni 2026, Dienstag — **Prod-Deploy Tag 35 ✅** (`86ed1e4`→`6e32813` auf srv1712371, 29 Commits): #3 maxLength + Weg-B-Refactor + Apex-Removal live; **keine Migration** (26 skipped); runtime+web neu gebaut (Bundle korrekt `runtime.nolmi.ai`), bridge unberührt; verifiziert (Owner-Chat, A2A, Onboarding-Smoke). DEPLOYMENT.md §3 korrigiert (expliziter `docker build` + Literal-Build-Arg, da `compose up -d` hier nichts baut). Neues Item: Twin-Löschen fehlt in der UI. — **Davor** dieselben Tag — **#3 maxLength Live-Test ✅ abgeschlossen** (VM): Nicht-Owner-`respond_to_chat`-Pfad live verifiziert — präventiv (≤50 von selbst) + Retry (`output.lengthEnforced:"retried"`) bewiesen, Truncate isoliert belassen; A2A bleibt bekannte Abdeckungs-Grenze. Damit ist das #3-Gate vorm nächsten Prod-Deploy erfüllt. Protokoll-Korrektur: Flag liegt unter `audit.data.output.lengthEnforced`, nicht top-level. — **Davor** dieselben Tag — **Landing live auf nolmi.ai (Vercel) + Apex-Platzhalter entfernt**: Web-Präsenz-Architektur umgesetzt — `nolmi.ai` liegt jetzt auf **Vercel** (Landing live, Repo `nolmi-ai/nolmi-web`, brandkonform: IBM Plex Mono + NOLMI GREEN); der `nolmi-apex`-Übergangs-Container ist aus `docker-compose.yml` + `tls-promote.sh` **entfernt** (Compose VALID, `bash -n` grün, app./runtime./bridge. unberührt; **VPS-Aktion gegenstandslos** — Apex lief auf Prod nie). Dabei die **Prod-VPS-Deploy-Mechanik** dokumentiert (`/docker/nolmi/` + `repo/`-Symlink, `DEPLOYMENT.md §3`). — **Davor** dieselben Tag — **Web-Präsenz-Architektur gesetzt**: Landing (+ Docs) in ein **eigenes Repo (`nolmi-ai/nolmi-web`) auf Vercel**, getrennt vom Produkt-Stack; `nolmi.ai`-Apex → Vercel, `app./runtime./bridge.` bleiben am VPS. Landing-Pitch steht (Hero „Be present, without being always available", persönlicher Nutzen führt, A2A nachgeordnet). #112 zieht ins neue Repo. — **Davor** dieselben Tag — **`always_pending`-Onboarding diagnostiziert → kein Fix nötig** (strukturell: Owner-Bypass antwortet sofort, untrusted-A2A hartkodiert pending — nicht Template-bedingt; Owner-Fall unbetroffen). BACKLOG-Item geschlossen (diagnostiziert, nicht gefixt), zwei kleinere Folge-Fäden notiert. — **Davor** dieselben Tag — **`npm publish nolmi@0.1.0`**: der Self-Hosting-Distributionsweg ist **live auf npm** (`npm i -g nolmi` → `nolmi onboard`). AGPL-3.0-only, deps:none, LICENSE (34,5 kB) im Tarball, 14 Dateien, kein Source; `npm view nolmi` bestätigt öffentlich. **Still** (kein Launch). Voller Bogen in ~2 Tagen: Going Public (Tag 34) → Wrapper gebaut+VM-remote-verifiziert (Tag 34) → publiziert (Tag 35). Nächste Fronten: `always_pending`-Politur, #112-Landing, #3-Live-Test, Repo-Description EN — dann lauter Launch. — **Davor** 1. Juni — **NPM-Wrapper Phase 1 funktional vollständig + remote-verifiziert** (`packages/cli`): der Remote-VPS-URL-Bug ist **gefixt** (Host-Prompt + Auto-Detect-IP + Repair-Pfad `reconfigure-host`) und **auf der VM 187.124.7.94 verifiziert**. — **Davor** dieselben Tag, **Going Public vollzogen**: `nolmi-ai/nolmi` ist seit 1. Juni 2026 **PUBLIC** (AGPL-3.0-only, GitHub-Lizenz-Erkennung im Repo-Header bestätigt). **Strategie A „still public"**: Code + volle History sichtbar, **kein Launch/Announcement** (0 stars/forks/watching, pre-launch) — das öffentliche Repo ist das Tor für NPM-Wrapper + Landing, der Launch kommt bewusst SPÄTER wenn rund. Vorbereitung: Apache→AGPL-Swap (`0d750db`, kanonischer AGPL-3.0-Volltext + alle 5 package.json) + Hygiene-Re-Scan über **341 Commits 🟢 sauber** (einziger gitleaks-Treffer = bekannter False-Positive `OAuthActivationModal`). **Der irreversible Schritt ist getan** — ab jetzt sind Code + volle History für immer öffentlich. — **Davor** 31. Mai 2026, Sonntag — **Production-Deploy Etappe 2 Schritt 5 erfolgreich**: Sammeldeploy `main`→`c88f0eb` auf `srv1712371` (Etappe 1 + 2.1/2.2/2.4a/2.4b/2.3 + **Migration 026**). **Befund vorab:** die Etappe-2-Commits waren lokal committet, aber **nicht gepusht** — erst `git push` (`origin/main` `2ad7d3d`→`c88f0eb`, FF, kein Force; Pre-Push-Build grün), dann VPS-`pull` + Rebuild auf dem vollständigen Stand (Single-Point-of-Failure beseitigt). **Migration 026 (destruktiver FK-Rebuild) auf Production-Echtdaten SICHER:** Runtime-Log „026 … angewendet (foreign_keys_off-Modus)" = der neue FK-sichere Runner fuhr sie · `foreign_key_check` leer · `bridge_url`/`bridge_token` `notnull=0` · **Kind-Tabellen-Counts vorher=nachher IDENTISCH** (nur `schema_migrations` 25→26) → **kein Cascade-Verlust, Twin-Historie intakt**. Pre-Flight B4-Klasse: `VACUUM INTO`-Backup beider DBs offsite auf den Mac (`nolmi-db-backup-20260531-064823.tar.gz`), Rollback-Image `rollback-025` getaggt, Counts-before festgehalten. Live: Direct-Chat @markus (`app.nolmi.ai`) · A2A @markus→@florian Echtzeit (201, kein 409, `bridge_url` erhalten) · `auth_mode`-Gate 2.4a live (api_key-Twin kein OAuth-Button). 3 Container Up, Bridge unangefasst. Offener Befund (Backlog, kein Blocker): `nolmi.ai` Root-Domain liefert **404** (Landing-Page fehlt). 3b (TLS-Install) bleibt offen. — **Davor** 30. Mai, Samstag (Tag-31-Push fortgesetzt, Block 27 — Distribution Etappe 2.3 **Frische-Test bestanden**: `install/install.sh` + `docker-compose.single-host.yml` von echtem Null in einem isolierten `docker:dind`-Wegwerf-Container (srv1046432, strikt getrennt vom Standby) durchgespielt. **7/7 Skript-Schritte grün**, alle **3 Container gesund** (kein Restart-Loop), Runtime bootet sauber — **alle 26 Migrationen frisch angewendet inkl. 026 im `foreign_keys_off`-Modus auf LEERER DB** (Nebenbefund: der FK-Cascade-sichere Runner-Tweak läuft auch auf frischer Wiese, nicht nur als Daten-Migration), Onboarding-only/0 Twins, :4000, **kein EADDRINUSE, kein Telegram-Crash-Loop**. Code **credential-frei** rein (git archive + stdin-tar → **Mode 1 „Im Repo ausgeführt"**, kein Clone/PAT). Isolation gehalten (Standby + alle srv1046432-Stacks unberührt), Wegwerf-Container restlos entfernt. Bewusst nicht im dind getestet: `twin:onboard`+Browser (in 2.2 schon end-to-end bewiesen) + externer Port-Zugang. Vorher Block 26 — Single-Host One-Liner-Install gebaut: `install/install.sh` (`curl … | bash`) + Traefik-freie `docker/nolmi/docker-compose.single-host.yml` (Ports 3000/4000/5100 direkt, `build:`-Blöcke) + `install/README.md`. Skript: Docker prüfen/installieren → Repo holen → Secrets lokal via `openssl` (nie geloggt, Key-Format = `loadMasterKey`) → Stack bauen+starten → Übergabe an `twin:onboard`. Adressiert §7-Single-Host-Befunde: B2-2 (`TELEGRAM_USE_POLLING=true`, kein Crash-Loop) + #126 (`NEXT_PUBLIC_RUNTIME_URL`/`DEPLOYMENT_LABEL=self-host`) + `SESSION_COOKIE_SECURE=false`. DB-Init idempotent im Container-CMD. **NICHT ausgeführt** (Frische-Test separat, isolierter Container); `bash -n` + `docker compose config` grün. TLS/Domain = Schritt 3b. Vorher Block 25 — Etappe 2.4b (Re-Bind eigene Bridge). Neuer CLI `twin:bind-bridge <@handle> --bridge-url <url>` bindet einen Solo-Twin nachträglich an die **eigene** Bridge: registriert via vorhandenem `registerHandleOnBridge` (Token aus Arg/Env/Prompt), schreibt bridge_url/token ERST nach Erfolg (atomar), greift nach Runtime-Neustart (Boot-Guard). Nur solo→bound, `auth_mode` unberührt. Lokal verifiziert: Solo 409 → Re-Bind → Stream verbunden → A2A-Send 201 (nicht mehr 409); Fehlerfälle (falsches Token 401, unerreichbare Bridge) lassen bridge_url NULL; @markus-Regression intakt. Föderation/Fremd-Bridge bleibt Phase 4. Vorher Block 24 — Etappe 2.4a (`auth_mode`/D2 durchgesetzt). Vorher lückenhaft (UI bot api_key-Twins „OAuth aktivieren", `twin:oauth-login` schaltete jeden Twin selbst auf oauth). Jetzt **zwei-Ebenen-Gate**: CLI-Login lehnt `auth_mode!='oauth'` hart ab (kein Self-Grant), Settings-UI ohne OAuth-Pfad bei api_key, Allowlisting nur via neuem Admin-CLI `twin:auth-mode` (keine HTTP-User-Route ändert auth_mode — `/full-config` ignoriert es, verifiziert). Lokal verifiziert: @markus(oauth) passt Gate, @florian(api_key) abgelehnt, /full-config-Toggle wirkungslos, api_key-Chat läuft. Vorher Block 23 — Etappe 2.2 (CLI-Onboarding Weg A / Opt 3). `pnpm twin:onboard` legt **nur den ersten User** an (E-Mail+Passwort interaktiv via `readSecret`) — die einzige Lücke, die der Browser nicht kann (keine Signup-Seite). Den Twin baut danach der **Web-Wizard** im 0-owned-Flow (Owner wird dort korrekt gesetzt). Phase-A-Befund: Wizard kann keinen vorhandenen Twin aufgreifen → CLI legt bewusst keinen an (kein Doppel-Twin/409). End-to-End verifiziert: onboard→User, Login→0 Twins→Wizard, submit→@onboardtest mit Owner gesetzt, Direct-Chat grün, kein Doppel-Twin. **Zwei gleichwertige Türen** erreicht. Vorher Block 22 — Etappe 2.1 (`owner_user_id` via `OWNER_EMAIL`, Release-Blocker behoben))

## Historisches Archiv

Phase 2.5 bis Tag 24 ausgelagert nach
[`docs/archive/STAND-history-pre-tag25.md`](./archive/STAND-history-pre-tag25.md).

Live-STAND beginnt bei Tag 25 (24. Mai 2026 — Block-5-Strategy-Session).

## Aktuell in Arbeit

**Pre-Launch-Phase A gestartet (Tag 18, 17. Mai 2026).** Ziel:
Self-Hosting-Launch in 6 Wochen (Ende Juni / Anfang Juli 2026).
Strategy-Doc: `docs/PRE-LAUNCH-A-STRATEGY.md`.

Build-Pfad (Hybrid-Sequenz aus dem Strategy-Pivot):
1. UX-Welle 1 Tranche A abschließen (#95 Tool-Names human-readable)
2. Vision-kritisch vorgezogen: #100 Memory-Hit, #101 Twin-Reife
3. Restliche Welle-1-Items (#86, #87, #98, #99)
4. Architektur-Follow-ups (#105, #106)
5. Schmaler Computer-Use-Recherche-Workflow (Block 3, #107/#108)
6. Self-Hosting-Polish (Block 4, #109/#110/#111)
7. Launch-Vorbereitung (Block 5, #112/#113/#114/#115)

**Phase 3.6 (Computer-Use-Agent-Pattern) verschoben auf
Pre-Launch-Phase B** oder später. Schmaler Recherche-Workflow
bleibt als Hook-Feature in Phase A (Beta-deklariert).

Differenzierungs-Story für Launch: **Memory-Tiefe + Persona +
A2A-Bridge**. Nicht Computer-Use.

**UX-Welle 1 ist jetzt Block 1 von Pre-Launch-Phase A.** Welle-1-
Inhalte (11 Items in drei Tranchen) unverändert, nur Build-Pfad
leicht angepasst (#100/#101 vorgezogen, weil Vision-kritisch für
die Differenzierungs-Story).

## Tag 30 (28. Mai 2026, Donnerstag) — Phase-A-Polish (#129 + #127 + #126) + Rebrand Phase 1 (Light-Mode)

**Stand Tag 30 Block 3:** Drei Phase-A-Polish-Items + Rebrand-Phase-1-Start. `.env.example`-Klarstellung (#129 + #127, Block 1) und Build-Guard gegen den `localhost:4000`-im-Client-Bundle-Bug (#126, Block 2, Tag-11-Pattern nach 3-fachem Auftreten). **Block 3 startet den Twin-Lab → Tavryn-Rebrand** mit dem namens-unabhängigen Light-Mode-Switch — Strategy-Doc `docs/REBRAND-TAVRYN-STRATEGY.md` (4 Phasen, Trademark-Gate für Phase 2-4) ist heute im Repo. Phase 1 lebt erstmal **nur im Repo + lokal**, kein Production-Deploy — Tavryn kommt auf separaten Hostinger-VPS (Phase 4 nach Trademark-Klärung).

### Block 1 — #129 + #127 .env.example-Klarstellung

| Block | Item | Commit | Aufwand | Was |
|---|---|---|---|---|
| Block 1 | #129 Provider-Default Anthropic + #127 Bridge-Vars Power-User-Block | `5770f03` | ~15 Min | `.env.example` Provider-Block umgestellt: `ANTHROPIC_API_KEY=sk-ant-replace-me` aktiv, `ANTHROPIC_MODEL=claude-opus-4-7` aktiv, `ACTIVE_PROVIDER=anthropic` (vorher `openai`), OpenAI als auskommentierter Alternativ-Block mit Switch-Anleitung. Bridge-Section neu strukturiert: `TWIN_LAB_DEFAULT_BRIDGE_URL` zuerst als „Wizard-Default" (einzige Bridge-Var im Standard-Self-Hosting-Pfad), `BRIDGE_URL`/`BRIDGE_TWIN_HANDLE`/`BRIDGE_TWIN_TOKEN` darunter als „Advanced: File-basierter Twin-Bootstrap (`pnpm twin:bootstrap`)" mit klarer Wizard-Abgrenzung. **#127 Scope-Korrektur:** ursprünglicher Plan war Var-Delete, real (α) sind die drei Vars von `bootstrap-twin.ts:87-95` aktiv gelesen (wirft mit klarer Diagnose wenn fehlend) — daher als Power-User-Block markiert statt gelöscht, bootstrap-twin.ts bleibt gewollter File-basierter Pfad ohne Deprecation. Diagnose-Befund vorab: Wizard nutzt `TWIN_LAB_DEFAULT_BRIDGE_URL` aus `server.ts`, Legacy-Vars hat sonst keine Leser außer Bootstrap-CLI. 11 Treffer der 4 funktionalen Vars in finalem File — keine accidental-Delete. Reine Doku-Datei-Änderung, kein Code-Pfad angefasst. |
| Block 2 | #126 Build-Guard für `NEXT_PUBLIC_RUNTIME_URL` im Production-Build | `9e6f52d` | ~30 Min | **Strukturelle Lösung statt Doku-Pflaster** nach dreimaligem `localhost:4000`-im-Client-Bundle-Bug (Tag 23/28/29). Neues Guard-Script `apps/web/scripts/check-build-env.mjs` als prebuild-npm-Hook in `apps/web/package.json`. Guard-Logik gekoppelt an existierenden Production-Marker `NEXT_PUBLIC_DEPLOYMENT_LABEL=production`: wenn Label=production UND (`NEXT_PUBLIC_RUNTIME_URL` fehlt ODER matched `/localhost\|127\.0\.0\.1/`) → exit 1 mit handlungsleitender Fehlermeldung; sonst no-op. Dev/local-Builds + Husky-Pre-Push (das `pnpm -r build` ohne `DEPLOYMENT_LABEL` ausführt) bleiben unberührt. Source-`?? "http://localhost:4000"`-Fallbacks in den 9 page.tsx nicht angefasst (für `pnpm dev` korrekt, Defense-in-Depth). pnpm-Hook-Trigger empirisch verifiziert mit `NEXT_PUBLIC_DEPLOYMENT_LABEL=production pnpm --filter @twin-lab/web build` ohne URL → `ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL`, `next build` startet nicht, `.next/` unangetastet. **5/5-Smokes grün** (Dev/Production-missing/Production-localhost/Production-127.0.0.1/Production-real). Dockerfile-Kommentar Z.41-43 + DEPLOYMENT.md §3.1.2 verweisen auf den Guard. |
| Block 3 | Rebrand Phase 1 — Light-Mode-Switch (Tavryn-Branding) | (dieser Commit) | ~30 Min Bau + ~30 Min Smoke | **Erster Schritt des Twin-Lab → Tavryn-Rebrands.** Namens-**unabhängiger** Theme-Switch — Light-first als visuelle Differenzierung gegen die dark-mode-Konkurrenz (OpenClaw/Hermes/NanoClaw). Hart auf Light, **kein Toggle** (Strategy-Doc §5 S7). Diagnose-Befund vorab bestätigt: Theme sauber zentralisiert in zwei Dateien, Components ohne eigene Hex-Farben (Hardcoded-Grep nur Treffer in `globals.css` selbst). `apps/web/tailwind.config.js`: 8 Token-Werte Dark → Tavryn-Light (`bg #0a0a0a→#F4F1EA`, `surface #141414→#FFFCF6`, `surface-hover #1f1f1f→#ECE8E0` mit invertierter Hover-Logik im Light, `border #2a2a2a→#D8D3CA`, `muted #666666→#6F6A60`, `text #e8e8e8→#111111`, `accent #4a9e6a→#1E9B5A` grün bleibt grün, `warn #cc4444→#C8332A`) + 5 neue additive Status-Tokens (`accent-dark`, `info`, `warning`, `pending`, `success`). `apps/web/app/globals.css`: `color-scheme: dark→light`, 8 CSS-Var-Aliases gespiegelt (für sonner-Toaster), 3 hardcoded Stellen (`html,body` + `::selection`) auf Light-Werte. **Strategy-Doc `docs/REBRAND-TAVRYN-STRATEGY.md`** (heute angelegt, war untracked) im selben Commit mit-committed — 4 Phasen, Trademark-Gate für Phase 2-4, Token-Mapping, Produkt-Narrativ. Typecheck 4/4 grün. **Browser-Smoke alle 7 Haupt-Views grün** (Login, Onboarding, Chat/@markus, Inbox, Settings, Facts, Stream): Kontrast überall lesbar, Status-Farben sichtbar, User-vs-Twin-Bubble-Unterscheidung erhalten, keine Token-Korrekturen nötig. **KEIN Production-Deploy** — Light lebt erstmal nur im Repo + lokal, Tavryn kommt auf separaten Hostinger-VPS (Phase 4 nach Trademark-Klärung). Kein „Twin-Lab"-String angefasst (Phase 2 trademark-gated). |

### Tag-30-Outcome-Bilanz

**Item-Closures Tag 30 (laufend):**
- #129 ✅ Provider-Default auf Anthropic in `.env.example` (Block 1, Commit `5770f03`)
- #127 ✅ Bridge-Vars-Klarstellung in `.env.example` mit Scope-Korrektur (Block 1, Commit `5770f03`)
- #126 ✅ Build-Guard für `NEXT_PUBLIC_RUNTIME_URL` im Production-Build (Block 2, Commit `9e6f52d`, prebuild-Hook + Guard-Script, 5/5 Smokes grün)
- **Rebrand Phase 1** ✅ Light-Mode-Switch (Block 3, Tavryn-Branding-Tokens live im Repo, Browser-Smoke 7/7 grün, Production-Deploy defer auf Phase 4 / Tavryn-VPS)

**Neue BACKLOG-Items aus Tag 30:**
- **Rebrand-Section** in BACKLOG (4-Phasen-Struktur, Phase 1 ✅, Phase 2-4 trademark-/VPS-gated) — Verweis auf `docs/REBRAND-TAVRYN-STRATEGY.md` als Master-Doku.

**Tag-30-Total bis Block 3:** 3 Closures + 1 Rebrand-Phase (1/4), 3 Blöcke, ~1h 45 Min Netto (Block 1 ~15 Min + Block 2 ~30 Min + Block 3 ~60 Min inkl. Browser-Smoke).

**Lessons Tag 30:**

- **Lesson Tag 30 #1: Strukturelle Lösung gegen wiederkehrende Build-Bugs schlägt Doku-Pflaster.** Der `localhost:4000`-im-Client-Bundle-Bug hat dreimal zugeschlagen (Tag 23 Production-Re-Deploy, Tag 28 Block 13 Build-Arg-Bugfix, Tag 29 Block 7 nur durch Pre-Flight-Lesson vermieden), trotz dokumentierter Warnung in DEPLOYMENT.md. Das ist Tag-11-Lesson-Pattern: wenn ein Failure-Mode wiederholt auftritt, ist Doku alleine nicht genug — die Maschine muss den falschen Pfad mechanisch blockieren. #126 implementiert das als `prebuild`-npm-Hook mit Production-Label-Coupling, sodass Dev-Workflow unberührt bleibt (keine Reibung) aber Production-Builds ohne korrekte ARGs früh und laut failen. **Mini-Mustererkennung:** wenn ein Item zum dritten Mal als „Re-Diagnose und Re-Fix" auf einem STAND-Tag landet, dann ist es Zeit für einen Guard statt eine bessere Doku.

**Closing-Note Tag 30 (post-hoc dokumentiert Tag 31):** Der Arbeitstitel „Tavryn" wurde Tag 30/31 final verworfen (`tavrn.ai`-Kollision in §0 des Strategy-Docs). Nach 4 weiteren Iterationen (Aurelun, Brelon, Nerlo — alle aus Codex-Vorschlägen, alle verworfen) wurde Tag 31 **Nolmi** als finaler Name etabliert. Strategy-Doc Tag 31 umbenannt via `git mv`: `REBRAND-TAVRYN-STRATEGY.md` → `REBRAND-NOLMI-STRATEGY.md`. Phase-1-Branding-Tokens (Block 3 dieses Tages) bleiben unverändert gültig — Codex-Branding-Guides für Tavryn/Aurelun/Brelon/Nerlo/Nolmi sind in Hex-Werten identisch, nur die Wordmark hat sich pro Iteration geändert. Trademark-Gate für Phase 2-4 ist Tag 31 grün.

## Tag 31 (29. Mai 2026, Freitag) — Doku-Übergang Tavryn → Nolmi + Foundation gesichert

**Stand Tag 31 Start:** Tag 30 Nachmittag/Abend hat die Namens-Frage final geklärt (Nolmi, Trademark grün) und die komplette operative Foundation für die Marke gesichert. Tag 31 dokumentarischer Übergang: Strategy-Doc + STAND + BACKLOG synchron auf Nolmi-Stand. **Phase 2** (Name-Strings im Code) ist nun entblockt, **Phase 3** (Env/Package-Aliasing) ebenso, **Phase 4** (VPS) braucht nur noch operativen Setup-Block.

### Foundation-Stand (gesichert Tag 30/31)

- Domain `nolmi.ai` + `getnolmi.com` (Hostinger)
- DNS 5 A-Records grün (apex + app + runtime + bridge + docs → `187.124.3.235`)
- E-Mail `hello@nolmi.ai` + Aliase `security@` + `founders@`, Forwarding → `markus.baier@harway.de` verifiziert
- VPS Hostinger Frankfurt, Ubuntu 24.04 LTS, IP `187.124.3.235`
- npm Org `@nolmi` + 2FA
- PyPI Account `markusbaier` + 2FA (Package-Name `nolmi` verifiziert frei, Publishing in Phase 3)
- Docker Hub `nolmi` + 2FA
- GitHub Org `nolmi-ai` (Bindestrich, AI-Sektor-Konvention `langchain-ai`/`anthropic-ai`)

### Block 1 — Doku-Übergang Tavryn → Nolmi

| Block | Item | Commit | Aufwand | Was |
|---|---|---|---|---|
| Block 1 | Strategy-Doc Rename + Inhalts-Refresh + STAND/BACKLOG-Sync | `8aec762` | ~30-45 Min | `git mv docs/REBRAND-TAVRYN-STRATEGY.md → REBRAND-NOLMI-STRATEGY.md` (History-Preserve). Inhalts-Edits: Header + §0 Trademark-Status BLOCKIEREND → GRÜN (USPTO + EUIPO 0 Treffer, 5 Namens-Iterationen Tavryn/Aurelun/Brelon/Nerlo/Nolmi dokumentiert), §1 Name + Domain + VPS-Status, §2 Mapping-Spaltenkopf Tavryn-Light → Nolmi-Light (Hex-Werte identisch — historische Stabilität dokumentiert), §3 Phase-2-Status entblockt + Phase-3 mit `@nolmi/*`-Paketen + `nolmi/runtime`-Images + Phase-4-VPS bereits provisioniert, §4 ASCII-Gate-Label aktualisiert, §5 S2/S4 entblockt + neue S8 `nolmi-ai`-Inkonsistenz akzeptiert + S7 Toggle entschieden, §6 Nolmi-Leitsatz „Aktive Erinnerung unter Owner-Kontrolle" als Subsection-Eröffner (komplementiert das Drei-Stufen-Narrativ), §7 Marketing-Items auf Nolmi, §8 Aufwand-Tabelle Gate-Status aktualisiert, **neue §9 Operative Foundation Status** (Domain + DNS + VPS + Mail + 4 Namespaces + bewusste GitHub-Inkonsistenz), §Verweis Branding-Guide-Doc-Name aktualisiert. STAND: Tag-30-Closing-Note (post-hoc Erklärung der Namens-Verwerfung + Branding-Token-Stabilität) + neue Tag-31-Section + Lesson Tag 31 #1. BACKLOG: Rebrand-Section auf Nolmi, Phase-2 + Phase-3 entblockt, Phase-4 VPS-Status. **Kein Code-Change** — reine Doku, Phase 2 (Name-Strings im Code) als nächster Block separat. |
| Block 2 | Rebrand Phase 2 — User-facing Name-Strings Twin-Lab → Nolmi | `f6ebd61` | ~1h | **Erster Code-Touch des Rebrands** auf Strings (Theme-Tokens kamen Phase 1 Tag 30 Block 3). Diagnose-First: 3 Scans (Volltext + HTML-Title/Metadata + CSS-Klassen-Audit). Befund: 7 user-visible Stellen + 1 Footer-Fallback (Mini-Justierung nach Smoke-Befund). **Edits (7 Files):** `apps/web/app/layout.tsx` (title `twin-lab` → `Nolmi` + description auf Nolmi-Leitsatz „Aktive Erinnerung unter Owner-Kontrolle…"), `apps/web/app/login/page.tsx` (h1), `apps/web/components/AppHeader.tsx` (Brand-Link), `apps/web/components/FooterMeta.tsx` (Fallback `multi-twin` → `Nolmi` + 2 Kommentare, Mini-Justierung nach Smoke), `README.md` (H1 + What/Why-Sections + 2× Pre-Launch-Tagline, Repo-URLs Z.44-45 unverändert per Phase-3-Scope), `docs/DEPLOYMENT.md` (H1 + 2 Intro-Zeilen + 2 Display-Stellen), `docs/ROADMAP.md` (H1). **NICHT angefasst per Setzungen:** Session-Cookie-Name `twin-lab-session` in `middleware.ts:19` (Phase 3, würde Live-User-Sessions invalidieren), alle `from "@twin-lab/shared"`-Imports (Phase 3 Workspace-Rename), CSS-Klassen `.twin-toast*` (S2), Code-Kommentare mit „Twin-Lab" in 6 Files (interne historische Notizen, nicht user-visible), Strategy-Docs (REBRAND-NOLMI/BLOCK-5/130-TELEGRAM/131-OAUTH — historische Genauigkeit), Docker-Container-Namen `twin-lab-web`/`-runtime`/`-bridge` + `/docker/twin-lab-web/`-Pfade (Phase 3), `apps/web/styles/DESIGN-AUDIT.md` (internes Design-Doc). Typecheck 4/4 grün. **Browser-Smoke 7/7 grün:** Login, Onboarding, Chat/@markus, Inbox, Settings, Facts, Stream — Header überall „Nolmi", Browser-Tab-Title „Nolmi", `<meta name=\"description\">` mit Leitsatz via Devtools verifiziert, Footer dynamisch („1 Twin aktiv · läuft lokal"). **Cmd+F „Twin-Lab" pro Page = 0 Treffer.** „Twin"-Konzept-Wort (Twin-Profil, Twin-Reife, Twin-Service, `twin_*`-IDs) unverändert per S1. **KEIN Production-Deploy** — Phase 2 lebt nur im Repo + lokal, Nolmi-Deploy kommt in Phase 4 auf separatem Hostinger-VPS. |
| Block 3 | Rebrand Phase 3a — Env/Package/Cookie-Aliasing | (dieser Commit) | ~2h | **Tiefe technische Renames** mit Backward-Compat-Aliasing (Env + Cookie) + Hart-Switch (Workspace-Packages, technisch nicht aliasable). Diagnose-First verifiziert Briefing-Scope: 21 Source-Files mit `TWIN_LAB_*`-Refs, 124 `@twin-lab/`-Imports in TS/TSX, Cookie an 2 Stellen. **(1) getEnv-Helper:** `packages/shared/src/env.ts` (Read-Both, Write-New, Warn-Once) + Subpath-Export `@nolmi/shared/env` + `packages/shared/src/env.test.ts` (4 Pfade: new-wins / only-old-warns / only-new-silent / both-unset) — lauffähig via `pnpm --filter @nolmi/shared test:env`, **4/4 Cases OK**. tsx als devDep zu `@nolmi/shared` (minimal, matches runtime-Pattern). **(2) Env-Vars in 21 Files:** Production-Read-Pfad (`NOLMI_SESSION_SECRET`, `NOLMI_ENCRYPTION_KEY`, `NOLMI_DEFAULT_BRIDGE_URL`, `NOLMI_MODEL_CACHE_DIR`, `NOLMI_EMBEDDING_{PROVIDER,MODEL,DTYPE,API_KEY}`) via `getEnv(newName, oldName)` in `session.ts`, `crypto-utils.ts`, `server.ts`, `episodic/providers/factory.ts`, `episodic/providers/local-provider.ts` — manuell editiert mit ausführlichen Aliasing-Hinweisen in Doc-Strings + Error-Messages („NOLMI_X (oder deprecated TWIN_LAB_X) ist nicht gesetzt"). Test-Only-Vars (`NOLMI_RUN_LOCAL_RETRIEVAL_TEST`, `NOLMI_SKIP_LOCAL`) + Comments + CLI-Output via stumpfem `sed` in 16 weiteren Files. **(3) 4 Workspace-Packages atomar umbenannt:** `@twin-lab/{web,runtime,bridge,shared}` → `@nolmi/{web,runtime,bridge,shared}`. Sed-Pass über 96 Source-Files + Root-`package.json` (11 Script-Refs) — 124 Import-Statements rewriten. `grep "@twin-lab/" apps/ packages/` = 0 Treffer im Source. Live-Docs (`DEPLOYMENT.md`, `131-OAUTH-STRATEGY.md`) mit-rewriten; `docs/archive/*` als historisches Archiv unangetastet. **(4) Cookie-Aliasing:** `SESSION_COOKIE_NAME = "nolmi-session"` + `LEGACY_SESSION_COOKIE_NAME = "twin-lab-session"` exportiert aus `apps/runtime/src/auth/session.ts`. `getSession()` Read-Both (neu zuerst, dann Legacy-Fallback), `setSession()` Write-New only, `destroySession()` löscht **beide** aktiv — sonst überschattet ein Bestands-Legacy-Cookie das Logout (Erweiterung gegenüber Briefing, das nur „läuft natürlich ab" für Login-Pfad spezifiziert; auf Logout-Pfad ist aktives Löschen nötig). `apps/web/middleware.ts` Konstanten lokal dupliziert (Cross-App-Import vom Runtime ist strukturell nicht vorgesehen — Runtime exportiert keine Subpaths) + Read-Both im Cookie-Presence-Check. Konsolidierung in `@nolmi/shared/auth-cookies` als BACKLOG-Item. **(5) `.env.example`:** Header-Notiz zum 6–12-Monats-Aliasing-Fenster + alle `TWIN_LAB_*`/`@twin-lab/*` auf `NOLMI_*`/`@nolmi/*`. **Verifikation:** clean `pnpm install` (455 packages) + `pnpm typecheck` (4/4 Workspaces grün, ~10s) + `pnpm -r build` minus `@nolmi/web` (shared+runtime+bridge grün; web absichtlich nicht gebaut wegen geteilten `.next/`-Caches mit Dev) — Husky pre-push deckt web build auf Push-Seite ab. **Lessons-Worth:** (a) Workspace-Renames brauchen `rm -rf node_modules` + `pnpm install` (Symlinks werden sonst stale); (b) Briefing-Test-Spec „Standard Vitest/Jest" passt nicht zur Codebase ohne Test-Runner — pragmatischer Node-assert-Smoke matched bestehendes `test-*.ts`-Pattern und liefert dieselbe Coverage; (c) `destroySession` muss beim Logout BEIDE Cookie-Namen löschen, sonst leakt das Legacy-Cookie weiter; (d) blanket `sed TWIN_LAB_→NOLMI_` schießt sich selbst beim Erstellen von Aliasing-Header-Texten in den Fuß (mein erster Versuch klobiete die `.env.example`-Notiz selbst — Lesson: Aliasing-Erklärungen NACH dem sed schreiben oder Strings escapen). **KEIN Production-Deploy** — Nolmi-Stack lebt nur im Repo, Production-Twin-Lab unverändert. Phase 3b (Verzeichnis-Rename + GitHub-Repo-Move) als operativer Folge-Block. |
| Block 4 | Rebrand Phase 3b — Verzeichnis-Rename + GitHub-Repo-Move + Root-package.json | (dieser Commit) | ~45 Min operative Schritte + ~15 Min Closure-Commit | **Operative Closure der Code-Rebrand-Pipeline (Phase 1-3b zusammen).** GitHub: `markusbaier/twin-lab` → `markusbaier/nolmi` (Rename) → `nolmi-ai/nolmi` (Transfer zur Org). Lokal: `mv /Users/mjb/Visual Studio/twin-lab/ /Users/mjb/Visual Studio/nolmi/`. Git-Remote auf `https://github.com/nolmi-ai/nolmi.git`. Husky pre-push grün (Build aller 4 Packages incl. web, 21s). Smoke `pnpm dev` im neuen Pfad sauber: 9 Twins, Bridge-Connection, Chat-Flow funktional. Root-`package.json` Metadaten auf Nolmi (name + description + author.email + repository.url + bugs.url + homepage). `.gitignore` ergänzt um `.claude/`. **Bewusst unverändert:** `docker/twin-lab-web/` (Phase-4-Material — Production-Stack auf srv1046432 läuft, Rename entsteht beim VPS-Setup auf srv1712371). User-action außerhalb des Commits: `.claude/settings.local.json` gelöscht (Whitelist baut sich beim nächsten Bash-Command neu auf — sauberer Schnitt nach Repo-Rebrand). |
| Block 5 | Hygiene-Pass: .gitignore-Erweiterung + Test-Twins-Cleanup | (dieser Commit) | ~30 Min Diagnose + Action + Closure | **Letzter Block des Tag-31-Push, nach Code-Rebrand-Closure.** Drei Hygiene-Items: (1) `scripts/smoke-139.sh` (Tag-28-Cruft, #139 Tag 27 committet) gelöscht, `scripts/`-Verzeichnis automatisch mit-entfernt. (2) `.gitignore` erweitert um `data/*.db.backup*`-Pattern — vorhandene 3 DB-Backup-Files (`twin.db.backup`, `twin.db.backup-pre-commit-11a`, jetzt zusätzlich `twin.db.backup-pre-test-twin-cleanup-tag31`) sauber aus Untracked-Liste. (3) Test-Twin-Cleanup in lokaler DB: 6 Test-Twins (`@maxm`, `@test22`, `@test22-2`, `@test22-3`, `@test22-6`, `@postmig1`) gelöscht via sqlite3-CLI mit `PRAGMA foreign_keys = ON` + Transaction. Verbliebene Twins: `@markus`, `@florian`, `@heiko` (drei Realmenschen). Vor-Verifikation zeigte: Test-Twins fast komplett leer (0 convs, 0 facts, 0 audit, nur 1 skill bei @test22-2 — durch CASCADE mit weg). DB-Backup vor Action gezogen. **Bewusst außerhalb dieses Commits:** SSH-Alias und Test-Twin-Cleanup sind lokale Operationen, nicht reposy. Item 2 (SSH-Alias `github.com-twin-lab`) ist auf MacBook obsolet (kein lokaler `~/.ssh/config`-Eintrag — Production-VPS srv1046432=31.97.78.73 nutzt SSH-Direct `root@IP`, nicht GitHub-Alias) → als BACKLOG-Item für Phase-4-Setup. |
| Block 6 | Phase-4-VPS-Strategy-Session (7 Setzungen + hängende Items aufgelöst) | (dieser Commit) | ~Strategy-Session + Doku | **Bau-Vorlage für den Production-Deploy auf den Greenfield-VPS `187.124.3.235` (Hostinger Frankfurt, Ubuntu 24.04 LTS), parallel zum laufenden Bestand `srv1046432`.** Neue Doku `docs/PHASE-4-VPS-STRATEGY.md` (Stil wie REBRAND-NOLMI/131-OAUTH): zwei harte **Bedingungen** (A Encryption-Key-Kontinuität — derselbe `NOLMI_ENCRYPTION_KEY` MUSS übernommen werden, sonst alle per-Twin-API-Keys + @markus' Codex-OAuth-Token unbrauchbar; B Bridge zieht mit, weil die 3 Twins an `bridge.twin.harwayexperience.com` auf srv1046432 hängen) + **7 Setzungen** (S1 DB-Migration statt Fresh-Start, S2 voller Stack runtime+web+bridge unter `/docker/nolmi/` + Twins gegen frische Bridge re-registrieren, S3 `.env`-Secrets mit Key-Übernahme, S4 Traefik v3 + BasicAuth-Pflicht, S5 HTTPS+Fine-grained-PAT statt SSH, S6 Parallel-Cut-Over mit Freeze-Fenster, S7 alter Stack = Hot-Standby-Rollback 1–2 Wochen) + Cut-Over-Sequenz + Rollback-Plan + offene Pre-Flight-Verifikation (§4 Bridge-DB-Inhalt) + Bau-Reihenfolge B1–B7. **3 hängende BACKLOG-Items aufgelöst:** SSH-Auth → HTTPS+PAT (S5), docker/twin-lab-web→docker/nolmi → entfällt (Greenfield-Neuanlage, S2), srv1046432-Abschaltung → terminiert nach stillem Fenster (S7). **1 neues Item:** Pre-Flight Bridge-DB-Inhalt verifizieren (S, B3). Reine Doku, kein Code-Touch, kein Deploy. |
| Block 7 | B3 Pre-Flight: Bridge-DB-Inhalt am Source verifiziert | (dieser Commit) | ~Diagnose-Scan + Doku | **Beantwortet §4 von PHASE-4-VPS-STRATEGY.md: hält die Bridge-DB etwas Unersetzliches außer Routing?** Diagnose-Scan am `apps/bridge`-Source (2 Tabellen: `twins` + `messages`, Schema in `migrations/001+002`) + Gegenprobe am Runtime-Source. **Befund:** `twins` = Klasse A (re-registrierbar). `messages` mit `delivered_at` gesetzt = Klasse B (runtime-seitig in Audits gespiegelt — `receiveBridgeMessage` schreibt Audit mit vollem Content **vor** dem `safeAck`/`delivered_at`-Set, also garantiert gespiegelt). `messages` mit `delivered_at IS NULL` (unzugestellte Queue) = **Klasse C, einzige echt bridge-only Menge.** Quer dazu: die symmetrische Conversation-View (`/messages/conversation`) ist bridge-verankert — Content überlebt in Audits, aber die View-Historie ginge verloren. **Verdikt: S2 im Kern BESTÄTIGT** (Re-Registrierung statt voller Bridge-DB-Migration korrekt) **mit zwei Auflagen für B4:** (1 hart) im Freeze-Fenster `COUNT(*) WHERE delivered_at IS NULL` = 0 verifizieren (sonst drainen/mitnehmen); (2 Akzeptanz) Conversation-View-History-Verlust per S2 akzeptiert. **Strukturbefund für B4:** Bridge ist NICHT im Repo-Compose (`docker/twin-lab-web/docker-compose.yml` hat nur runtime+web) — Live-Bridge auf srv1046432 hat eigene Config/Volume außerhalb des Repos, DB-Pfad `data/bridge.db`. Re-Reg vergibt neue api_tokens → runtime-seitiger Token muss aktualisiert werden. §4 von offen → ✅ geschlossen, S2/§5.2/§8-B4 nachgezogen. Reine Diagnose + Doku, kein Code-Touch. |
| Block 8 | S2-Korrektur: Bridge-DB-Migration statt Re-Registrierung | (dieser Commit) | ~Doku | **Kippt die in Block 6 gelockte S2 auf Basis des B3-Pre-Flight-Befunds.** Der B3-Scan (Commit `64f91e1`) deckte zwei Dinge auf, die die Lock-Entscheidung noch nicht kannte: (1) die Bridge ist nur 2 Tabellen mit 3-Twin-Datensatz → Migration trivial klein; (2) Re-Registrierung erzwingt neue `api_token`s → einen Token-Writeback pro Twin in die frisch migrierte `twin.db` (mutierender Schritt auf gerade restaurierter DB, fragilster Cut-Over-Teil). **Korrektur:** BEIDE DBs migrieren (`twin.db` + `bridge.db`) aus demselben Freeze-Moment, **keine** Re-Registrierung, **kein** Token-Writeback (Tokens matchen beidseitig). Vorteile: atomarer Zwei-DB-Snapshot, A2A-View bleibt erhalten, undelivered-Queue kommt gratis mit. Die zwei Block-7-Auflagen (Queue-leer-Zwang + View-History-Verlust-Akzeptanz) sind damit **moot** — ersetzt durch eine reine Token-Match-Lese-Verifikation in B4. Verworfener Re-Register-Pfad als ADR-Notiz in S2 erhalten. Dependent-Sections nachgezogen: §0 (Hostname=IP-Konsistenzzeile), §3/S3 (Register-Token orthogonal — gilt nur für künftige Registrierungen), §4 (Verdikt + B4-Token-Match), §5.2 (A2A ohne Re-Reg, kein 401), §5.3 (Doppel-Tarball), §8 (B2 Restore-Volume + B4 Doppel-Migration). BACKLOG Pre-Flight-Item + Phase-4-Status auf S2-final. Reine Doku, kein Code, kein Deploy. |
| Block 9 | Bau-Block B1 — VPS-Prep + Docker + Traefik auf 187.124.3.235 | (manuelle SSH-Session, Doku in diesem Commit) | ~Runbook-Session + Doku | **Erster echter Bau-Block der Phase 4** — manuelle SSH-Runbook-Session auf dem neuen Nolmi-VPS `187.124.3.235` (= `srv1712371`), **kein Code-Touch, kein Service deployed** (nur Traefik als leerer Reverse-Proxy). Ergebnis verifiziert: Ubuntu 24.04, Kernel auf `6.8.0-124` (Reboot durchgeführt, neuer Kernel aktiv); Docker `29.5.2` + Compose `v5.1.4` (get.docker.com); UFW aktiv mit `22/80/443` allow (v4+v6); **Traefik v3.6** als Reverse-Proxy up unter `/docker/traefik/`, `traefik-proxy`-Network (external), Let's-Encrypt-Resolver `le` (HTTP-Challenge, ACME-Mail `hello@nolmi.ai`). Verifikation am **Verhalten**: `restarts=0`, `curl http://localhost` → `301` (HTTP→HTTPS-Redirect greift), Auto-Restart nach Reboot bewiesen, `acme.json` leer (korrekt — kein Service beansprucht bisher einen Host; Certs entstehen mit dem Stack in B2). **Drei Stolpersteine gelöst** (Details in PHASE-4-VPS-STRATEGY §7) — alle drei sind Cookbook-Bugs für aktuelle Docker-Versionen: (1 HART) Traefik v3.0 bricht mit Docker 29+ (API 1.24 zu alt, stiller Fehler) → v3.6; (2 MITTEL) geteiltes Netz muss `external: true` sein (Compose v5 verweigert sonst); (3 PROZESS) reboot+verify nicht als Sammel-Paste (läuft auf sterbender Session, liefert Pre-Reboot-Zustand). Nächster Block: **B2** (Stack-Build + .env + BasicAuth). Reine Doku, kein Code, kein Deploy. |
| Block 10 | B2-Prep — Nolmi-Stack-Compose autoret (docker/nolmi/) | (dieser Commit) | ~Diagnose-First + Compose-Autorenschaft + Doku | **Stack-Definition als Code** für den Nolmi-Production-Stack — die Code-Hälfte von B2 (der VPS-Build kommt als separates Runbook). Diagnose-First am Bestand (`docker/twin-lab-web/`-Compose + Override + 3 Dockerfiles + Bridge-Verdrahtung), dann `docker/nolmi/docker-compose.yml` mit **drei Services**: `nolmi-runtime` (:4000), `nolmi-web` (:3000), `nolmi-bridge` (:5100, S2 — voller Stack inkl. Bridge). `image:`-Tags wie Base (robuster gegen VPS-Symlink-Trap als `build:`-Kontext). Netze: `traefik-proxy` (external: true, B1-Befund 2) für die drei Public-Router + `nolmi-internal` (compose-managed) für den Runtime→Bridge-Hop (`NOLMI_DEFAULT_BRIDGE_URL=http://nolmi-bridge:5100`, kein Public-Hairpin, S4). Traefik-Labels mit `tls.certresolver=${ACME_RESOLVER}` (parametrisiert für Staging→Prod-Flip), Host-Rules `app/runtime/bridge.nolmi.ai`. **BasicAuth nur auf nolmi-web** im selben File (kein offenes Signup-Fenster). Named Volumes `nolmi-runtime-data` (`/data`, twin.db) + `nolmi-bridge-data` (`/data`, bridge.db) — **leer in B2** (Mechanik-Validierung mit Wegwerf-Secrets), **Restore-Ziele in B4**. Plus `docker-compose.override.yml.example` (Bind-Mounts auf `/docker/nolmi/`) + `.env.example` (NOLMI_*-Placeholder, `ACME_RESOLVER=le-staging`-Default, Cookie-Domain `.nolmi.ai`). **Guard:** `docker compose -f docker/nolmi/docker-compose.yml config --quiet` exit 0 (kein up/build/deploy); `docker/twin-lab-web/` unangetastet. **Zwei Blocker-Befunde als Runbook-TODOs (§8):** (1) alle drei Dockerfiles filtern noch `@twin-lab/*` → `docker build` bricht, vor B2-Build auf `@nolmi/*` ziehen (Code-TODO); (2) Bridge-CMD macht kein Auto-init-db → auf leerem B2-Volume separat laufen lassen. Reine Doku/Compose-Code, kein Deploy, kein VPS-Touch. |
| Block 11 | Phase-3a-Nachzügler — Dockerfile-pnpm-Filter @twin-lab→@nolmi | (dieser Commit) | ~Diagnose + schmaler Fix + Verify | **Schmaler Code-Fix**, von der B2-Prep-Diagnose (Block 10, `aad399c`) aufgedeckt: Phase 3a (`e746446`) benannte die 4 Workspace-Packages auf `@nolmi/*` um, erfasste aber die **Dockerfile-pnpm-Filter nicht** — `apps/{runtime,web,bridge}/Dockerfile` filterten weiter `pnpm --filter @twin-lab/*` → `docker build` from-scratch bricht (Bestand baut nur dank Image-Cache, daher latent). Fix: `@twin-lab/` → `@nolmi/` in 3 Dockerfiles (11 Filter-/Build-Stellen + Kommentare) + 2 `.dockerignore`-Kommentare. 1:1-Mapping wie Phase 3a, keine sonstigen Dockerfile-Änderungen (keine Base-Bumps, keine ARG-Changes). **Verify (ohne Build):** `grep @twin-lab/ apps/*/Dockerfile*` = 0 Treffer; `pnpm --filter @nolmi/{runtime,web,bridge,shared} exec true` 4/4 resolved (Filter-Namen matchen die echten Packages); typecheck 4/4 grün. `docker/twin-lab-web/` unangetastet (Bestand). **Entblockt den B2-Build** (war Runbook-TODO #1 in PHASE-4-VPS-STRATEGY §8, jetzt im Repo gefixt → aus der TODO-Liste gestrichen). Kein Deploy, kein VPS-Touch, kein Build (Test ist der VPS-Build in B2). |
| Block 12 | Bridge-Auto-init-db in CMD (Option B, Runtime-Symmetrie) | (dieser Commit) | ~Verify + 1-Zeilen-Fix + Doku | **Schmaler Code-Fix**, von der B2-Bridge-Init-Diagnose aufgedeckt: die `nolmi-bridge` crasht beim Boot gegen ein leeres/restored Volume mit `no such table: twins` (`twins.list()` im Boot-Log, kein Schema), weil die Bridge-CMD — anders als die Runtime — **kein Auto-init-db** machte. Boot war bewusst „DB-existiert-Annahme" + separater Init-Schritt, was einen manuellen, vergesslichen Schritt erzwang (beißt v.a. in B4-Restore). **Fix (Option B):** Bridge-CMD an das Runtime-Pattern angeglichen → `sh -c "node dist/scripts/init-db.js && exec node dist/index.js"`. `dist/scripts/init-db.js` ist **idempotent** (schema_migrations-Tracker + `CREATE TABLE IF NOT EXISTS` + `INSERT OR IGNORE`-Backward-Compat) → läuft auf leerem (B2) **und** restored (B4) Volume gefahrlos; liest dieselbe `BRIDGE_DATABASE_PATH` wie der Boot. **Verify-before:** Bridge hatte genau 1 CMD; tsc (`rootDir src`/`outDir dist`) + `pnpm deploy --prod` legen `dist/scripts/init-db.js` + `migrations/` ins Image (WORKDIR `/app/apps/bridge`) → Pfad identisch zur Runtime-CMD, 1:1-Angleich korrekt. **Verify:** neue CMD == Runtime-CMD-Pattern, nur `apps/bridge/Dockerfile` geändert, typecheck 4/4 grün. **Eliminiert** den B2-Runbook-TODO „Bridge-init-db separat laufen lassen" (§8 gestrichen) und macht B4-Restore selbstheilend. Kein Deploy, kein VPS-Touch, kein Build (Test ist der Rebuild in B2). |
| Block 13 | B2 auf Staging grün + htpasswd-Mount-Konsistenz im Repo | (dieser Commit) | ~VPS-Bring-up + Diagnose + Repo-Fix + Doku | **Erster echter Stack-Bring-up der Phase 4** — die 3 Nolmi-Services (`nolmi-runtime`+`-web`+`-bridge`) laufen auf `187.124.3.235` gegen **Staging-ACME** mit Wegwerf-Secrets + leeren Volumes (Mechanik-Validierung). Verifiziert: Stack up, Staging-Certs über `app/runtime/bridge.nolmi.ai` ((STAGING) Dastardly Durum), Bridge selbstheilend (Auto-init Block 12 greift), Runtime initialisiert, **BasicAuth aktiv (app→401 + `www-authenticate`)**. **4 Cookbook-Bugs + 2 Config-Lücken** auf Wegwerf-Daten gefunden + gefixt (Details PHASE-4-VPS-STRATEGY §7): B2-Befund 1 (HART) htpasswd gehört zum **Traefik**-Stack, nicht an web (BasicAuth wertet Traefik aus → web-Mount bricht mit „open /htpasswd: no such file", app→404 statt 401; VPS-Fix htpasswd→`/docker/traefik/`, app→401 verifiziert); B2-Befund 2 (MITTEL) `RUNTIME_PUBLIC_URL` Pflicht bei `TELEGRAM_USE_POLLING=false` (sonst Runtime-Crash-Loop, Webhook-Modus); B2-Befund 3 (META) alte Logs als aktuell fehlgelesen (`tail`/`grep` ohne `--since`). Plus die zwei bereits per Commit gelösten (Dockerfile-Filter Block 11, Bridge-init Block 12). **Repo-Konsistenz-Fix (dieser Commit):** irreführender `htpasswd:/htpasswd:ro`-Mount aus `nolmi-web` in `docker/nolmi/docker-compose.yml` entfernt (Labels + Klarstellungs-Kommentar bleiben — Datei kommt vom Traefik-Stack), veraltete htpasswd-Notizen in Compose-Header + Override-Pfadbaum angeglichen, `.env.example` `RUNTIME_PUBLIC_URL` als Pflicht-bei-Webhook markiert. `compose config` grün, typecheck 4/4. **Nächster Schritt: Flip auf `le`-Prod** (`ACME_RESOLVER=le` + recreate + Trusted-Cert-Verify). |
| Block 14 | B2 vollständig abgeschlossen — Prod-Cert-Flip | (dieser Commit) | ~VPS-Flip + Diagnose + Doku | **B2 final: der Nolmi-Stack läuft mit vertrauten Production-Zertifikaten.** Nach Staging-grün (Block 13) auf `ACME_RESOLVER=le` geflippt. **Flip griff erst nach einem Resolver-Cache-Fix:** Traefik lieferte weiter Staging-Certs, weil die drei Domains im `acme-staging.json`-Store lagen und Traefik nach **Domain** (nicht Resolver) matcht — Label war korrekt `le`, Prod-`acme.json` leer (§7 B2-Befund 4). Symptom: `TLS-verify=20`, HTTP `000`, ACME-Log leer. Fix: `acme-staging.json` geleert (`> file` + `chmod 600`) + Traefik-Restart + Request-Trigger → Prod-Certs in ~30–90 s gezogen. **Finaler Verify:** Issuer `Let's Encrypt CN=YR2` (kein STAGING) über `app/runtime/bridge.nolmi.ai`, `TLS-verify=0`, app→401 (BasicAuth aktiv), runtime/bridge→404 (kein `/`-Router, korrekt). Nolmi-Stack läuft damit **end-to-end auf echter Infra mit vertrauten Certs** — weiter auf Wegwerf-Secrets + leeren Volumes, Production (`srv1046432`) unberührt. §7 fünfter B2-Befund + §8 B2 auf ✅ DONE (Prod) + B4-Volume/Cert-Vormerkung. Reine Doku, kein Code, kein Deploy. **Nächster Block: B4** (Doppel-DB-Migration). |
| Block 15 | B4 Doppel-DB-Migration verifiziert (auf Backup-Kopie, ohne Freeze) | (dieser Commit) | ~Migration-Probelauf + Verifikation + Doku | **B4 erfolgreich — der Mechanik-Beweis für den echten Cut-Over.** twin.db (Runtime) + bridge.db (Bridge) vom alten VPS `srv1046432` migriert, **beide aus demselben §8.3-Backup-Moment** (Off-Site-Kopie auf Mac), **OHNE Production-Freeze** (auf der Backup-Kopie — der echte delta-freie Freeze kommt erst B6; Production läuft unterdessen weiter). `NOLMI_ENCRYPTION_KEY` **byte-genau** vom alten `TWIN_LAB_ENCRYPTION_KEY` übernommen. **Verifiziert am Verhalten:** (1) **Bedingung A** — kein GCM-/Decrypt-Fehler, Boot-Log zeigt entschlüsselte API-Keys (`sk-a…jAAA`), oauth-refresh läuft → Key sitzt byte-genau. (2) **S2 Token-Match** — `bridge_token` (twin.db) == `api_token` (bridge.db) byte-gleich für @markus (`d7f0e2c3…`), @florian (`b8996dbd…`), @heiko (`c6f6a78f…`) → kein 401 beim A2A-Hop, kein Re-Register/Writeback nötig (S2-Korrektur Block 8 bestätigt). (3) **A2A-Verbindung** — nach `bridge_url`-Fix `[bridge:stream] verbunden` ×3 gegen `nolmi-bridge:5100`. (4) **Bridge-Auto-init** (Block 12) idempotent gegen restored Volume (0 neu, 2 skipped), 4 registrierte Twins. **Zwei B6-Pflicht-Befunde** aus dem Probelauf gewonnen (Details PHASE-4-VPS-STRATEGY §5): B6-1 Stale-Infra-Reference-Sweep (`twin_profiles.bridge_url` 3× `twin-lab-bridge`→`nolmi-bridge`; per-Twin-DB-Wert sticht die Env), B6-2 verwaister Bridge-Twin `@test122prod` (in bridge.db, nicht in twin.db — Tag-29-Test-Twin, beim Cut-Over zu löschen). **Production (`srv1046432`) unberührt**, läuft weiter. Reine Doku, kein Code, kein Deploy. **Nächster Block: B5/B6** (Smoke + Cut-Over mit Freeze). |
| Block 16 | B5 Smoke + 3-Twin-Verifikation auf migriertem Stack (alle 4 §6-Stufen grün) | (dieser Commit) | ~Smoke-Welle + Doku | **Der migrierte Nolmi-Stack ist auf echten Daten voll funktional** — der §6-Smoke (4 Stufen) gegen die Kopie-Daten aus B4 ist vollständig grün. **§6.1 Container/Health:** 3 Container Up, `runtime/health` + `bridge/health` → 200. **§6.2 Migration:** `schema_migrations` intakt bis `025_oauth_tokens.sql`. **§6.3 Browser-Smoke:** BasicAuth-Gate + App-Login mit **Bestands-Credentials** (User-Tabelle migriert), `/chat` zeigt @markus, **echter Chat-Turn beantwortet** (= **Bedingung A END-TO-END**: der entschlüsselte API-Key macht einen funktionierenden LLM-Call, nicht nur GCM-Tag-OK), Memory-Retrieval auf migrierten Daten (3 Erinnerungen), Settings/Profil zeigt API-Key „verschlüsselt in DB" + nutzbar + OAuth-Account + **Bridge=`http://nolmi-bridge:5100`** (B4-`bridge_url`-Fix in der UI sichtbar) + Footer „production" (`NEXT_PUBLIC_DEPLOYMENT_LABEL` greift). **DevTools — alle drei §7-Fallen negativ:** Requests an `https://runtime.nolmi.ai` (Build-ARG ok, **nicht** localhost), 200, `Access-Control-Allow-Origin=https://app.nolmi.ai` + `Allow-Credentials=true` (Cookie-Domain `.nolmi.ai` greift, kein CORS). **§6.4 A2A END-TO-END:** frischer Send @markus→@florian (09:43), Antwort in Echtzeit zurück, **kein 401** — **S2 jetzt auch am Verhalten bewiesen** (nicht nur Token-Match-DB aus B4); Trust-Relation migriert (Twin als „VERTRAUT" markiert). **Production (`srv1046432`) unberührt.** Reine Doku, kein Code, kein Deploy. **Nächster Block: B6** (Cut-Over) — gated nur noch durch die Freeze-Fenster-Koordination mit Florian/Heiko. |
| Block 17 | B6 Cut-Over in reduziertem Umfang — **PHASE 4 IM ZIEL** | (dieser Commit) | ~Geist-Twin-Cleanup + Cut-Over-Entscheidung + Closure-Doku | **Nolmi ist produktiv auf dem neuen VPS `187.124.3.235`.** B6 bewusst **reduziert**: Markus' Entscheidung — @florian/@heiko sind Test-Twins, **nur Markus nutzt das System** → **kein** koordinierter Freeze mit Dritten, **kein** finaler Re-Sync (kein erhaltenswertes Delta seit dem 06:39-Backup; nur Test-Geplänkel auf dem alten Stack, verzichtbar). Der B5-verifizierte migrierte Stand **ist** der Produktivstand. **Durchgeführt:** (1) B6-Pflicht-Sweep 2 — verwaister Geist-Twin `@test122prod` aus `bridge.db` gelöscht (Bridge-DB-Backup `bridge-db-pre-ghostdelete` davor; Vor-Delete-`SELECT` bestätigte exakt 4 Handles, nach Delete exakt die 3 echten @markus/@florian/@heiko; gelöscht: 1). (2) B6-Pflicht-Sweep 1 (`bridge_url`→`nolmi-bridge:5100`) war bereits in B4 erledigt + in der B5-UI sichtbar — damit schon abgehakt. **Bewusst NICHT (mit Begründung):** alter Stack `srv1046432` wird **nicht** abgeschaltet — bleibt **Hot-Standby** (S7), weil Markus' echte @markus-Daten dort in nicht-reproduzierbarem Zustand liegen und das Standby-Netz **jetzt** (Nolmi produktiv) am wertvollsten ist; Abschaltung ist eine **spätere Einzelentscheidung** (S7: 1–2 Wochen), kein Pflichtteil des Cut. **Offene Notiz (kein To-do jetzt):** Gewohnheit/Bookmarks auf `app.nolmi.ai` umstellen (versehentliches Weitertesten auf `twin.harwayexperience.com` vermeiden); optional später alte Domain auf „umgezogen"-Redirect — **ohne** den Standby-Stack zu killen. Reine Doku, kein Code, kein Deploy. **Phase 4 abgeschlossen (B1–B6).** |
| Block 18 | ROADMAP-Re-Baseline auf Nolmi-Stand (3 Achsen) | (dieser Commit) | ~Bestandsaufnahme + Re-Write + Doku | **ROADMAP.md von „Stand 12. Mai" (Tag 12, 223 Commits veraltet) auf den Ist-Stand neu aufgesetzt.** Drei orthogonale Achsen statt einer Feature-Liste: (1) Engineering/Feature-Phasen (1/2/2.5 ✅, 3.1–3.5 ✅ Production-live, 3.7 OAuth Phase A ✅ + Phase-B-Reste #143–#145 offen, **Phase 4 = Multi-Channel/Föderation** als echte nächste Feature-Front, 3.6 verschoben), (2) UX-Reifungs-Stufen (Stufe 0/1 ✅, Stufe 2/Casual = nächste offene UX-Front, Welle-2-Session ausstehend — orthogonal explizit erhalten), (3) Vision-Patterns (8 Patterns als Reifungs-Pfade Stufe 1–4, ethische Leitplanken via Verweis auf TWIN-VISION.md). **Phase-4-Doppelbelegung aufgelöst:** Rebrand + VPS-Deploy als eigener **Infrastruktur-Meilenstein-Block** (✅, Verweis REBRAND-NOLMI/PHASE-4-VPS-STRATEGY), NICHT als Produkt-Phase 4. Erledigte Stränge auf ✅+Production-live (3.4/3.5/#86/#87/#110/#130/#131-A inkl. Polish-Quartett #139–#142). „Was als Nächstes" (Tag-13-Text) ersetzt durch reale offene Front (a Launch #112–#115, b Multi-Channel, c UX-Welle 2, d Vision-Patterns) — Richtungs-Priorisierung bewusst offen gelassen. Rebrand-stale raus (ROADMAP-Body Z.169 „Twin-Lab-Default", BACKLOG #114 „Show HN: Twin-Lab"→Nolmi). **#59-Nummern-Kollision gefixt** (BACKLOG-Verweis „(#59)"→„(#58)" Visual-Design; #59 ist vergeben für erledigtes Bridge-Auth). TWIN-VISION/UX-STRATEGY inhaltlich unangetastet (nur referenziert). Reine Doku, kein Code, kein Deploy. |
| Block 19 | Distribution-Strategie-Session (D1–D5) + DISTRIBUTION-STRATEGY.md | (dieser Commit) | ~Strategie-Session + Doku | **Der Schritt von „läuft für mich" zu „Produkt für andere".** Neue Doku `docs/DISTRIBUTION-STRATEGY.md` (Struktur analog PHASE-4-VPS): **ein Produkt, zwei Betriebsmodi** — Self-Hosting via GitHub (One-Liner-Install wie OpenClaw/Hermes) + Managed via nolmi.ai. **Fünf Setzungen:** D1 Self-Hosting zuerst, Managed zweiter Strang · D2 API-Key-Default, OAuth nur self-hosted + manuelle Allowlist (Liability-Lehre aus Anthropics OpenClaw-Block April 2026: zentral aggregierte Subscription-OAuth = Terminierungs-Trigger) · D3 Bridge optional (standalone→eigene→fremde Bridge; offene Föderation bleibt Produkt-Phase 4) · D4 Phase 2.5 reicht für Allowlist-Gruppe, Fremden-Apparat (Signup/Rate-Limits/DSGVO) vertagt, Sofort-Schritt Tenant-Isolations-Audit (motiviert durch #59-Präzedenz) · D5 Gratis-Closed-Beta jetzt, kommerziell-Managed als bewusst offene spätere Tür. **Bau-Sequenz:** Etappe 0 read-only Diagnosen → 1 Bridge-Optionalität → 2 Distribution-Layer (One-Liner = Phase-4-B1/B2 + 6 Cookbook-Befunde automatisiert) → 3 Release. **Release-Gate (Blocker):** secret-freie Git-History — PAT-Rotation + History-Secret-Scan (im Chat geposteter Fine-grained-PAT potenziell in History) als BACKLOG must-vor-Release. **Differenzierung:** Solo-Twin auf OpenClaw/Hermes-Niveau (Einstieg) + A2A-Bridge als Alleinstellung. ROADMAP: Distribution als aktive Arbeits-Achse + priorisierte offene Front (vor Launch/Föderation), D5 offen. Reine Doku, kein Code, kein Deploy. |
| Block 20 | Distribution Etappe 1 — Bridge-Optionalität (Solo-Twin) | (dieser Commit) | ~Migration + Runner-Tweak + 6 Code-Punkte + lokale Verifikation | **Erster Code-Block der Distribution: ein Twin ohne A2A-Bridge bootet/chattet sauber.** Setzt die Etappe-0-Diagnose D-1 um (Bridge-Annahme war gekapselt → Guard, kein durchziehender Umbau). **(1) Migration 026** `twin_profiles.bridge_url`/`bridge_token` NOT NULL→nullable. **FK-Cascade-Befund:** 11 Tabellen referenzieren `twin_profiles` per `ON DELETE CASCADE` → ein naiver DROP-Rebuild unter `foreign_keys=ON` hätte alle Kind-Daten kaskadiert. **Lösung (User-Entscheidung):** offizieller 12-Schritt-Rebuild mit `foreign_keys=OFF`, ermöglicht durch einen **minimalen Runner-Tweak** (`init-db.ts`): Migrationen mit Magic-Comment `-- nolmi:foreign_keys_off` in Zeile 1 laufen FK-off (außerhalb der Tx) + `foreign_key_check` vor COMMIT; alle 25 Bestands-Migrationen unverändert. Post-Loop unbedingtes FK=ON (Gürtel+Hosenträger). Bridge-Runner unberührt (analoger Tweak wäre separat nötig, falls dort je ein FK-Rebuild ansteht). **(2) Registry-Boot-Guard** (`twin-service-registry.ts`): BridgeClient/Stream nur bei vorhandener Bridge-Konfig, `RegistryEntry.bridgeClient/Stream` nullable, Solo-Twin kein Inbox-Sync/Connect/Reconnect-Loop. **(3) A2A graceful:** `BridgeDisabledError` (typisiert), Routen antworten **HTTP 409 `bridge_disabled`** statt Crash; conversations-Routen solo-sicher (kein Bridge-Fetch). **(4) UI-Toleranz:** Chat-Sidebar blendet A2A-Liste + „Neue Konversation" aus, wenn `profile.bridge.url == null` (Inbox-Tab BLEIBT — enthält bridge-unabhängige Tool/Mandate-Approvals; das Ausblenden hätte die versteckt). **(5) Boot-Log** „Solo-Modus (keine Bridge)". **(6) `bootstrap-twin`** ohne `BRIDGE_URL` legt Solo-Twin an (Handle `@<name>`, bridge NULL, keine Registrierung). **Lokale Verhaltens-Verifikation grün:** Migration `foreign_key_check` leer + notnull=0 + Kind-Counts identisch (38/9/44/0/1/34/1/3/2) + Bestands-Twins behalten bridge_url; typecheck 4/4; Solo-Twin gebootet → Log „Solo-Modus" (×2), KEIN `[bridge:stream]`-Reconnect für Solo, `Runtime hört auf`, Bridge-Twins (@markus/@florian/@heiko) connecten unverändert (Regression grün); `pnpm -r build` grün. Wegwerf-Test-Twin + DB-Backup nach Verifikation entfernt. **KEIN Production-Deploy** — die Migration läuft Prod separat mit Backup davor (eigener Schritt). **Etappe 2** (Distribution-Layer: One-Liner-Install, CLI-Onboarding, `auth_mode`-Flag) als nächster Block. |
| Block 21 | Distribution Etappe 1 — interaktiver Verhaltens-Smoke (Solo-Twin 4/4) | (dieser Commit) | ~lokaler Smoke + Doku | **Schließt die in Block 20 noch offene interaktive Schicht** (Browser/Session, die Claude Code im Build-Commit nicht hatte). Lokaler Solo-Twin `@solo` (`bridge_url`/`bridge_token` NULL via `twin:bootstrap` ohne `BRIDGE_URL`) am Verhalten verifiziert — **alle vier grün:** (1) **Boot** — Log „@solo: Solo-Modus (keine Bridge)", **kein** `[bridge:stream]`-Reconnect-Loop, Runtime hört auf :4000; Migration 026 bestätigt (NULL-`bridge_url` in DB, vor 026 unmöglich). (2) **Direct-Chat end-to-end ohne Bridge** — echte LLM-Antwort, `POST /twins/@solo/chat` → 200, neue Konversation; `runOwnerDirect` bridge-frei bestätigt. (3) **UI-Toleranz** — @solo zeigt keine A2A-Liste, sondern „Solo-Modus — keine Bridge. A2A-Konversationen sind aus."; Bridge-Twins zeigen A2A weiter. (4) **A2A-Send-Guard graceful** — `POST /twins/@solo/conversations/@florian/send` → **HTTP 409** `{"code":"bridge_disabled",...}`, **kein** 500/Crash; Solo-Guard feuert vor jeder Bridge-Validierung. **Regression:** @markus/@florian/@heiko verbinden unverändert (`[bridge:stream] verbunden`). **Befund (Release-relevant, KEIN Etappe-1-Bug):** `twin:bootstrap` setzt keinen `owner_user_id` → der Solo-Twin wurde ownerlos angelegt und war im Twin-Switcher unsichtbar (owner-gescopte Liste), bis ein manuelles `UPDATE owner_user_id` + Runtime-Neustart (Owner-Zuordnung wird beim Boot gecached). Der Solo-Pfad selbst ist lückenlos — vorbestehende Bootstrap-Lücke, die der Solo-Modus nur sichtbar machte (Bridge-Twins bekamen Owner über Wizard/Migration). **Release-Blocker für Self-Hosting** (frischer Self-Hoster sähe seinen eigenen Twin nicht) → Fix in **Etappe 2** (CLI-Onboarding koppelt User-Anlage + Twin-Owner-Zuweisung). Als BACKLOG-Item geführt. Reine Doku, kein Code, kein Deploy. |
| Block 22 | Distribution Etappe 2.1 — `bootstrap` setzt `owner_user_id` (OWNER_EMAIL-Lookup) | (dieser Commit) | ~Phase-A-Diagnose + 1 Code-File + lokale Verhaltens-Verifikation | **Release-Blocker Self-Hosting behoben.** Der Etappe-1-Smoke (Block 21) hatte gezeigt: `twin:bootstrap` legt Twins mit `owner_user_id = NULL` an → frischer Solo-Twin im owner-gescopten Switcher unsichtbar, ein neuer Self-Hoster sähe seinen Twin nach Install nicht. **Phase-A-Diagnose (read-only, Design getragen, kein STOP):** `UsersRepo.findByEmail()` existiert (normalisiert trim+lowercase), user-id-Format `user_<nanoid16>`, `GET /twins` filtert `registry.list()` nach `profile.ownerUserId === user.userId` (`server.ts:250`), Repo-`insert`/`update` persistieren `owner_user_id` schon. **Fix (`bootstrap-twin.ts`):** Owner-Auflösung aus ENV — bevorzugt `OWNER_EMAIL=` → `findByEmail()` → `user_id`; trifft die E-Mail keinen User → **harter Fehler** (kein stiller NULL-Fallback) mit `user:create`-Hinweis. Fallback `OWNER_USER_ID=` (direkte ID, Skripte/Tests). Kein Owner → **deutliche `WARN`-Zeile** statt lautlos NULL. UPDATE-Pfad überschreibt Owner nur bei explizit übergebenem Owner (kein Reset bestehender Zuordnung). Keine Schema-Änderung (`owner_user_id` nullable seit Migration 026). **Lokal am Verhalten verifiziert (Wegwerf-Twin @solo2, danach DB-Row + Persona-Files entfernt):** (1) bootstrap mit `OWNER_EMAIL=markus.baier@harway.de` ohne `BRIDGE_URL` → DB `owner_user_id = user_GnAgLosIQsW1ymQu` (≠ NULL); (2) owner-gescopte Switcher-Query (identisch zu `GET /twins`) liefert `@solo2`, Registry-Boot lädt ihn eager → **erscheint sofort, ohne manuelles UPDATE**; (3) Gegenprobe ohne `OWNER_EMAIL` → `WARN` + Owner NULL; (4) Fehler-Pfad `OWNER_EMAIL` ohne User → harter Fehler. typecheck grün. **KEIN Production-Deploy.** Verbleibend: interaktives CLI-Onboarding koppelt User-Anlage + Owner-Zuweisung (Etappe 2.2; `user:create --assign-twin` deckt den manuellen Pfad heute schon). |
| Block 23 | Distribution Etappe 2.2 — CLI-Onboarding Weg A / Opt 3 (`twin:onboard` legt ersten User, Wizard macht Twin) | (dieser Commit) | ~Phase-A-Diagnose + 1 neues CLI-Skript + Helper-Extraktion + End-to-End-Verifikation | **Zweite Tür neben dem Web-Wizard (#110) — gebaut, ohne den Wizard anzufassen.** **Phase-A-Befund (Übergabe CLI→Wizard, die kritische Frage):** Der Web-Wizard kann **keinen vorhandenen Twin aufgreifen** — `POST /onboarding/submit` macht immer `INSERT` und wirft **409 bei existierendem Handle** (`server.ts:723`), registriert immer auf der Bridge; und ein Owner, der **schon einen Twin besitzt, landet nie im Wizard** (`/chat`→`/chat/<handle>`, Wizard nur bei 0 owned Twins, `chat/page.tsx:38`). Zusatz: `bootstrap-twin` ist gar nicht „minimal" — es verlangt Persona-Files **und** LLM-Key (Pflicht), erzeugt also schon einen vollständigen Twin. **A3 (Owner-Korrektheit im Wizard-Pfad) verifiziert, NICHT angenommen:** `/onboarding/submit` setzt `ownerUserId: user.userId` (`server.ts:791`) — kein Re-Auftreten der 2.1-Lücke. **Entscheidung (Markus, Opt 3):** das CLI deckt nur die echte Terminal-/UI-Lücke ab — den **ersten User** anlegen (es gibt keine öffentliche Signup-Seite, nur `/login`; ohne Login kein Wizard-Zugang). Den Twin macht der bewährte Web-Wizard. **Implementierung:** neues `pnpm twin:onboard` (`scripts/onboard.ts`) — interaktiv E-Mail (`readLine`) + Passwort+Bestätigung (`readSecret`, kein Echo, nicht in Shell-History) + optionaler Anzeigename → User via `UsersRepo.create` (bcrypt cost 12). Idempotent: existierender User → klare „logge dich ein"-Meldung, kein Doppel-Anlegen. Abschluss = kopierbare Übergabe an Tür 2. `readSecret`/`readLine` in `scripts/_prompt-helpers.ts` extrahiert (DRY beim zweiten Aufruf; `set-api-key.ts` nutzt jetzt denselben Baustein). **KEINE** Wizard-/Persona-/Bridge-Änderung im CLI. **End-to-End lokal verifiziert (Wegwerf-User `test-onboard@local.dev` + Twin `@onboardtest`, danach restlos entfernt):** (1) `twin:onboard` via echtem PTY → User angelegt, DB-Hash `$2a$12$` (len 60), Übergabe-Meldung; Idempotenz-Gegenprobe greift. (2) Login → `GET /twins` = `{"twins":[]}` (0 owned = Wizard-Trigger). (3) Wizard-Backend `POST /onboarding/submit` (Anthropic-Key aus `.env`) → 201, Bridge-Registrierung OK. (4) **DB: `@onboardtest.owner_user_id = test-onboard-User` (owner_match=1), genau 1 Twin des Owners (kein Doppel-Twin).** (5) `@onboardtest` im Switcher (`GET /twins`). (6) Direct-Chat `POST /twins/@onboardtest/chat` → echte LLM-Antwort, HTTP 200 (LLM-Key greift). Kein 409, kein manuelles UPDATE irgendwo. Cleanup: User+Twin+Bridge-Registrierung+verwaiste conv/audit-Zeilen entfernt, 3 Original-Twins intakt, keine Persona-Files (Opt 3 legt keine an). typecheck grün. **KEIN Production-Deploy.** Weg B (durchgehendes Terminal-Onboarding inkl. Persona/Key) als späterer Sub-Punkt — Opt 3 verbaut ihn nicht. |
| Block 24 | Distribution Etappe 2.4a — `auth_mode` (D2) durchgesetzt (OAuth nur bei `auth_mode='oauth'`, kein Self-Service) | (dieser Commit) | ~Phase-A-Diagnose + 1 neuer Admin-CLI + CLI-Gate + UI-Gate + End-to-End-Verifikation | **D2-Durchsetzung gebaut.** **Phase-A-Befund (war auth_mode tot/gegated/lückenhaft?):** **lückenhaft.** `auth_mode` war LIVE für die Send-Path-Provider-Wahl (`twin-service.ts:1758` OAuth- vs api_key-Provider), aber der **OAuth-START-Pfad nicht gegated**: (a) Settings-UI bot `api_key`-Twins einen **„OAuth aktivieren"-Button** (`settings/page.tsx:1374`, Self-Service-Affordance); (b) `twin:oauth-login` **schaltete jeden Twin selbst auf `oauth`** (`setAuthMode` am Ende, `cli-oauth-login.ts:378`) statt eine Vorbedingung zu prüfen. **Kein** HTTP-User-Route ändert `auth_mode` (`/full-config`-Schema kennt das Feld nicht; `setAuthMode` nur CLI) — also keine echte HTTP-Self-Service-Lücke, nur UI-Button + ungegateter CLI → simpler Guard, kein STOP. **Implementierung (zwei Ebenen, weil UI-only umgehbar):** (1) **CLI-Gate** `cli-oauth-login.ts`: lehnt hart ab, wenn `auth_mode != 'oauth'` (klare D2-Meldung + Verweis auf `twin:auth-mode`), das abschließende `setAuthMode('oauth')` bleibt nur als idempotente Bestätigung (kein Self-Grant). (2) **UI-Gate** `settings/page.tsx`: `api_key`-Zweig zeigt nur „API-Key"-Status, kein Aktivieren-Button (oauth-Zweig/Re-Login unverändert). (3) **Neuer Admin-CLI** `twin:auth-mode <@handle> [oauth|api_key]` (`scripts/set-auth-mode.ts`, Shell-only): die manuelle Allowlist — getrennt vom Login (Allowlisting ≠ Login). **KEINE Migration** (Spalte existiert). **End-to-End lokal verifiziert:** (A) `twin:oauth-login @florian` (api_key) → **abgelehnt am Gate** vor jedem Codex-Versuch. (B) `twin:oauth-login @markus` (oauth) → **passt Gate** („allowlistet"), fällt erst am (gefälschten `CODEX_BIN`) Codex-Schritt → kein Browser, `@markus.auth_mode` unverändert (Regression). (C) `twin:auth-mode`-Anzeige + Allowlist→Login→Revoke-Flow auf Wegwerf-Twin `@authtest`: set oauth → `settings-data` mode flippt auf `oauth` → `twin:oauth-login` passt Gate → revoke api_key. (D) `settings-data` für `@authtest` (api_key) = `{"mode":"api_key","oauth":null}` (UI rendert keinen Button). (E) **Self-Service-Lücke geschlossen:** `PATCH /full-config {"authMode":"oauth"}` → 200 aber `auth_mode` bleibt `api_key` (Feld ignoriert). (F) api_key-Chat `@authtest` → echte LLM-Antwort, HTTP 200. typecheck runtime+web grün. Cleanup: `@authtest`+User+Orphans+Persona-Files entfernt, 3 Original-Twins mit korrekten Modi (@markus oauth, @florian/@heiko api_key). **KEIN Production-Deploy.** |
| Block 25 | Distribution Etappe 2.4b — Re-Bind Solo-Twin an eigene Bridge (CLI) | (dieser Commit) | ~Phase-A-Diagnose + Helper-Param + 1 neuer CLI + End-to-End-Verifikation | **D3 Stufe 1→2: ein Solo-Twin kann nachträglich an die eigene Bridge gebunden werden.** **Phase-A-Befund:** `registerHandleOnBridge` (`onboarding/bridge-register.ts`) ist der vorhandene Register-Mechanismus (POST `/twins/register`, Token aus ENV, `BridgeRegisterError(status)` für 409/401) — standalone, nur von onboarding-submit genutzt, **nicht** bootstrap-wired → wiederverwendbar. **Live-vs-Neustart:** kein Live-Re-Init — `addTwin` ist no-op bei bereits geladenem Twin, kein `setBridgeClient`; `buildEntry` baut den BridgeClient nur bei `bridgeUrl && bridgeToken` beim Boot → **Re-Bind greift erst nach Runtime-Neustart**. **auth_mode:** `update()` merged, Patch nur `{bridgeUrl, bridgeToken}` → orthogonal, unberührt. **UI:** Settings-Bridge-Row zeigt nur url/token, kein Control; UI-Re-Bind ohne Live-Reload wenig sinnvoll → **CLI-only, UI als spätere Tür notiert**. **Implementierung:** (1) `registerHandleOnBridge` um optionalen `registerToken`-Param erweitert (backward-compat: Fallback auf ENV) — der Owner gibt das Token seiner eigenen Bridge explizit. (2) Neuer CLI `twin:bind-bridge <@handle> --bridge-url <url> [--register-token …]` (`scripts/bind-bridge.ts`): validiert solo (kein Umbinden bestehender Bindungen), Register-Token via Arg/ENV/`readSecret`-Prompt, **registriert ZUERST**, schreibt bridge_url/token **ERST nach Erfolg** (atomar — Fehlerfall lässt den Twin Solo), klare Fehlermeldungen (401 Token, 409 Handle, Netzwerk), Neustart-Hinweis. Keine Migration. **End-to-End lokal verifiziert (Wegwerf-Twin @bindtest, danach restlos entfernt):** (1) Solo bestätigt (bridge_url NULL) + A2A-Send → **409 `bridge_disabled`** (Etappe-1-Baseline). (2) **Fehlerfälle atomar:** Re-Bind mit falschem Token → **401** „registration not allowed", bridge_url bleibt NULL; gegen unerreichbare Bridge (:5999) → „fetch failed", NULL. (3) Erfolgreicher Re-Bind gegen lokale Bridge (:5100, Token aus .env) → bridge_url/token gesetzt, **Bridge-DB zeigt @bindtest registriert**, `auth_mode` unverändert (api_key). (4) Already-bound-Guard: erneuter Re-Bind → abgelehnt. (5) Runtime-Neustart → Boot-Log `@bindtest: Bridge=http://127.0.0.1:5100` (nicht Solo) + `[bridge:stream] verbunden`. (6) A2A-Send von gebundenem @bindtest → **HTTP 201** (`messageId`/`auditId`/`sentAt`), **nicht mehr 409**. (7) Regression: @markus unverändert (bound, oauth). typecheck grün. Cleanup restlos (Twin+User+Bridge-Reg+Orphans+Persona-Files), 3 Original-Twins intakt. **KEIN Production-Deploy. Föderation/Fremd-Bridge bleibt Phase 4.** |
| Block 26 | Distribution Etappe 2.3 — Single-Host One-Liner-Install-Skript (ohne TLS) | (dieser Commit) | ~Phase-A-Diagnose + 1 Compose-Variante + Install-Skript + README | **Self-Hosting-Einstieg `curl … | bash` für den Single-Host-Fall (localhost / VPS-ohne-Domain).** **Phase-A-Befund:** (1) Vorhandener `docker/nolmi/docker-compose.yml` ist der **Production-Stack** (Traefik-Netz `external`, TLS-certresolver, htpasswd) → **nicht** Single-Host-tauglich, separate Variante nötig. (2) Pflicht-Secrets: `NOLMI_ENCRYPTION_KEY` (32-Byte-**base64**, `loadMasterKey` validiert exakt das → `openssl rand -base64 32` ist Drop-in), `NOLMI_SESSION_SECRET`, `BRIDGE_REGISTER_TOKEN`; Generatoren `key:generate`/`session-secret:generate` existieren, brauchen aber Host-node → für ein Docker-only-Install ist `openssl` (so dokumentiert in `.env.example`) der pragmatische, format-gleiche Weg. (3) **DB-Init automatisch** im Container-CMD (`init-db.js && exec node …`, idempotent — Runtime UND Bridge) → kein manueller `db:init`-Schritt. (4) Alle drei Dockerfiles nutzen schon `@nolmi/*`-Filter (der B2-Runbook-„@twin-lab"-Hinweis ist stale) → `docker compose build` läuft out-of-the-box. (5) §7-Single-Host-Befunde: **B2-2** (`RUNTIME_PUBLIC_URL`-Crash-Loop bei Webhook-Modus → Single-Host setzt `TELEGRAM_USE_POLLING=true`) + **#126** (localhost im Web-Client-Bundle → `NEXT_PUBLIC_RUNTIME_URL=http://<host>:4000` + `DEPLOYMENT_LABEL=self-host`, damit der Build-Guard no-op bleibt aber die URL stimmt); Traefik-Befunde (B1-1/2, B2-1/4) sind 3b. **Implementierung:** `docker/nolmi/docker-compose.single-host.yml` (3 Services, `build:`-Blöcke Kontext `../..`, Ports direkt, internes Netz, kein Traefik, `SESSION_COOKIE_SECURE=false` für Login über http), `install/install.sh` (`set -euo pipefail`, 7 Schritte: OS/Tools → Docker prüfen/+apt-install → Repo klonen-oder-nutzen → `.env` mit `openssl`-Secrets **idempotent + nie geloggt, umask 077** → `up --build -d` → DB-Init-Hinweis → Übergabe-Meldung an `docker compose exec … node dist/scripts/onboard.js`), `install/README.md` (lokal vs. VPS via `NOLMI_HOST`, Ports/Sichtbarkeit, TLS=3b). **NICHT ausgeführt** (Frische-Test läuft separat in isoliertem Wegwerf-Container auf srv1046432). Verifiziert: `bash -n` Syntax grün, `docker compose -f …single-host.yml config` VALID (3 Services). **KEIN Production-Deploy.** |
| Block 27 | Distribution Etappe 2.3 — Single-Host-Install **Frische-Test bestanden** (von Null, dind-isoliert) | (dieser Commit, reine Doku) | ~Frische-Test im Wegwerf-Container + Doku | **Aus „statisch verifiziert" wird „am Verhalten verifiziert".** Echter Lauf von `install/install.sh` + `docker-compose.single-host.yml` (Commit `4ee36ad`) von echtem Null in einem isolierten `docker:dind`-Wegwerf-Container auf srv1046432 — strikt getrennt vom Standby-Stack, danach restlos entfernt. **(1) Credential-frei rein:** Code via `git archive` + stdin-tar in den Container (KEIN `git clone`, KEIN PAT) → die In-Repo-Erkennung des Skripts greift sauber („Im Repo ausgeführt", **Mode 1**), kein Clone-Versuch gegen das private Repo. **(2) 7/7 Skript-Schritte grün:** Voraussetzungen, Docker-Check, Repo, `.env`-Secrets (via `openssl`, **nicht geloggt** + Sicherungs-Hinweis Encryption-Key), **Build aller 3 Images (~115 s, out-of-the-box, keine stale `@twin-lab`-Referenz)**, DB-Init automatisch, Abschluss-Meldung mit `onboard`-Übergabe. **(3) Stack-Health:** alle 3 Container **Up** (kein Restart-Loop/Exit). Runtime bootet sauber — **ALLE 26 Migrationen frisch angewendet, inkl. 026 im `foreign_keys_off`-Modus auf LEERER DB**. **Nebenbefund (festgehalten):** der FK-Cascade-sichere Runner-Tweak (Magic-Comment `-- nolmi:foreign_keys_off`, Etappe 1/Block 20) läuft auch auf **frischer Wiese** korrekt durch, nicht nur als Rebuild bestehender Daten — also kein Sonderpfad-Risiko beim Self-Hoster-Erstinstall. Onboarding-only-Modus, **0 Twins**, Runtime hört auf :4000, **kein `EADDRINUSE`, kein Telegram-Crash-Loop** (`TELEGRAM_USE_POLLING=true`-Default greift, §7 B2-Befund 2 praktisch bestätigt). **(4) Isolation:** Standby-Stack (`twin-lab-*`) + alle anderen srv1046432-Stacks (openclaw/hermes/traefik/…) unberührt; Wegwerf-Container danach restlos entfernt, kein Rückstand. **Bewusst NICHT im dind getestet (ehrlich):** `twin:onboard` + Browser-Klick (Netz/IP-Fummelei im dind; Onboard ist in Etappe 2.2 schon end-to-end bewiesen) + echter externer Port-Zugang (der Offene-Ports-Hinweis steht ehrlich im Skript-Output). **Frische-Test-Ziel „install → gesunder Stack" ist lückenlos.** Reine Doku, kein Code, kein Deploy. TLS/Domain bleibt Schritt 3b. |

### Tag-31-Outcome-Bilanz

**Item-Closures Tag 31 (laufend):**
- Doku-Übergang Tavryn → Nolmi ✅ (Block 1, `8aec762`)
- **Rebrand Phase 2** ✅ User-facing Name-Strings Twin-Lab → Nolmi (Block 2, `f6ebd61`, 7 Files, Smoke 7/7 grün)
- **Rebrand Phase 3a** ✅ Env/Package/Cookie-Aliasing Twin-Lab → Nolmi (Block 3, getEnv-Helper + 4 Packages umbenannt + 124 Imports + Cookie-Aliasing, typecheck + build grün, getEnv-Smoke 4/4 OK)
- **Rebrand Phase 3b** ✅ Verzeichnis-Rename + GitHub-Repo-Move + Root-package.json (Block 4, GitHub `markusbaier/twin-lab` → `nolmi-ai/nolmi`, lokales Verzeichnis + Git-Remote umgestellt, Root-package.json + .gitignore auf Nolmi, Smoke im neuen Pfad grün)

**Tag-31-Total bis Block 27:** 27 Blöcke + 1 operative Mini-Closure (getnolmi.com-Redirect), ~3.5h Netto + Phase-4 (Strategy→B1–B6, Nolmi produktiv) + ROADMAP-Re-Baseline + Distribution-Strategie-Session + Distribution Etappe 1 (Bridge-Optionalität, gebaut + interaktiv am Verhalten verifiziert) + Distribution Etappe 2.1 (`owner_user_id`-Bootstrap-Fix, Release-Blocker behoben) + Distribution Etappe 2.2 (CLI-Onboarding Weg A / Opt 3, zwei gleichwertige Türen) + Distribution Etappe 2.4a (`auth_mode`/D2 durchgesetzt) + Distribution Etappe 2.4b (Re-Bind eigene Bridge, D3 Stufe 1→2) + Distribution Etappe 2.3 (Single-Host One-Liner-Install, ohne TLS — **gebaut + Frische-Test bestanden**). **Distribution-Stand:** Etappe 0 (Diagnosen) ✅ + Etappe 1 (Bridge optional) ✅ lokal verifiziert (4/4) + Etappe 2.1 (`owner_user_id`) ✅ + Etappe 2.2 (CLI-Onboarding `twin:onboard`) ✅ + Etappe 2.4a (`auth_mode`-Gate) ✅ + Etappe 2.4b (Re-Bind `twin:bind-bridge`) ✅ + Etappe 2.3 (Single-Host-Install `install/install.sh`) ✅ **am Verhalten verifiziert (Frische-Test von Null, dind-isoliert, 7/7 + Stack gesund + 026 auf frischer DB)**; nächster: Schritt 3b (Production/TLS via Traefik), Update-Mechanismus, Onboarding-Wizard-Solo-Pfad, Weg B (durchgehendes Terminal-Onboarding).

### Phase-4-Closure (B1–B6) — Nolmi produktiv

**Phase 4 abgeschlossen.** Der Nolmi-Stack (runtime + web + bridge) läuft produktiv auf dem eigenen Hostinger-VPS `187.124.3.235` unter `app/runtime/bridge.nolmi.ai` mit vertrauten Let's-Encrypt-Zertifikaten, BasicAuth, migrierten Echtdaten (twin.db + bridge.db, byte-genauer Encryption-Key) und 3 Twins:
- **B1** ✅ VPS-Prep + Docker + Traefik v3.6 (Block 9)
- **B2** ✅ 3-Service-Stack-Build + Prod-Certs (Block 13/14)
- **B3** ✅ Pre-Flight Bridge-DB → S2-Korrektur auf Doppel-DB-Migration (Block 7/8)
- **B4** ✅ Doppel-DB-Migration auf Kopie verifiziert: Bedingung A + S2-Token-Match 3/3 (Block 15)
- **B5** ✅ Smoke 4/4: Bedingung A & S2 **end-to-end am Verhalten** (Block 16)
- **B6** ✅ Cut-Over (reduziert): Geist-Twin bereinigt, Cut-Over-Entscheidung, kein Dritt-Freeze nötig (Block 17)

**Bewusst offen (einzige Phase-4-Restaktion):** Abschaltung des alten Stacks `srv1046432` — bleibt Hot-Standby (S7), spätere Einzelentscheidung nach stabilem Nolmi-Prod-Fenster. Als BACKLOG-Item geführt. Damit ist die komplette Rebrand→Deploy-Pipeline (Phase 1+2+3a+3b+4) im Ziel; Code-Rebrand + Hygiene + Production-Migration vollständig.

**Lesson Tag 31 #2: Ein Pre-Flight kann eine gelockte Setzung begründet kippen — genau dafür ist er da.** S2 war Tag 31 Block 6 als „Re-Registrierung" gelockt. Der B3-Source-Scan (Block 7) deckte zwei Fakten auf, die die Lock-Entscheidung nicht kannte (triviale Bridge-Größe + erzwungener Token-Writeback), und kippte S2 in Block 8 auf Bridge-DB-Migration. **Lock heißt nicht immun gegen Source-Befund** — eine Setzung ist so gut wie die Annahmen, auf denen sie ruht; tauchen am echten Code andere Fakten auf, ist die begründete Korrektur kein Wortbruch, sondern der Sinn des „Sicht holen vor Aktion"-Patterns (Cross-Ref Lessons #45/#64).

**Lesson Tag 31 #3: „Up" ist kein Funktionsbeweis — Verifikation muss am Verhalten hängen, nicht am Container-Status.** In B1 lief Traefik dreimal als `Up`, während es nacheinander (a) gar nicht gestartet war (`docker ps` leer), (b) den Docker-Provider nicht erreichte (Docker 29 hob die min. API-Version auf 1.44, Traefik <v3.6 pinnt 1.24 → „client version 1.24 is too old", **stiller Fehler nur im Log**), (c) potenziell crash-loopte. `Up` sagt nur „PID läuft", nicht „tut das Richtige". Verifikation muss am beobachtbaren Verhalten hängen — `curl → 301`, `restarts=0`, Provider-Log — nicht am `Status`-Feld. Hätte man sich auf Status-Grün verlassen, wäre der Fehler erst in B2 als „Certs kommen nicht" hochgekommen: viel teurer zu diagnostizieren, weil dann zwei Unbekannte (Stack **und** Proxy) im Spiel sind. **Pattern:** für jeden Infra-Baustein vorab definieren, welcher *verhaltensbasierte* Check „funktioniert" beweist — und genau den fahren, nicht `docker ps`. Cross-Ref die drei Cookbook-Bugs in PHASE-4-VPS-STRATEGY §7 (Traefik-Pin v3.6, Netz `external: true`, reboot/verify einzeln).

**Lesson Tag 31 #4: Container-Logs ohne `--since` lügen über die Gegenwart.** In B2 hat `docker logs`/`tail`/`grep` mehrfach die letzten **passenden** Zeilen gezeigt — alte `ERR`-Einträge, die ein zwischenzeitlicher Recreate längst überholt hatte — statt der **neuesten** Ereignisse. Die Diagnose setzte dadurch wiederholt auf totem Zustand auf (z.B. „htpasswd not found", obwohl der Mount-Fix schon lief). **Pattern:** bei Log-Diagnose nach einem Recreate/Restart **immer** `--since <zeit>` (oder `--tail` + Zeitstempel-Abgleich gegen „jetzt") — ein nacktes `grep ERR` über die volle Log-Historie ist ein Zeitreise-Bug. Verwandt mit dem B1-Reboot-Befund (Verify auf der sterbenden Session, §7 B1-Befund 3): beide Male war die Falle „der Output sieht aktuell aus, ist es aber nicht". Cross-Ref §7 B2-Befund 3.

**Lesson Tag 31 #5: Staging-Certs kleben beim Resolver-Flip — Traefik matcht Certs nach Domain, nicht nach Resolver.** Beim B2-Flip `le-staging`→`le` blieb Traefik bei den Staging-Zertifikaten, obwohl das `tls.certresolver`-Label korrekt `le` war und der Prod-`acme.json` leer. Ursache: ein Cert für `app/runtime/bridge.nolmi.ai` lag bereits im `acme-staging.json`-Store, und Traefik bezieht für eine Domain nichts Neues, solange irgendein Store ein gültiges Cert dafür hält — der Resolver-Wechsel allein triggert keinen Neubezug. Fix: alten Store leeren + Restart + Request-Trigger. **Dritter Fall derselben Verify-Fallen-Linie** (nach #3 „Up ≠ funktioniert" und #4 „Logs ohne --since lügen"): der Flip **sah erledigt aus** (Label korrekt, Prod-Store leer) war es aber nicht (das alte Cert lag woanders und überschattete). **Pattern:** ein Zustandswechsel ist erst bewiesen, wenn das **beobachtbare Ergebnis** sich geändert hat (hier: Issuer ≠ STAGING, `TLS-verify=0`) — nicht, wenn die Konfiguration „richtig aussieht". Cross-Ref §7 B2-Befund 4.

**Lessons Tag 31:**

- **Lesson Tag 31 #1: Reality-Check vor jedem Namens-Reservieren — GitHub-Reservierung als Hard-Gate, separat von Trademark.** Tag 30/31 hat fünf Namens-Iterationen durchlaufen (Tavryn → Aurelun → Brelon → Nerlo → Nolmi). Die Verwerfungs-Gründe waren unterschiedlich: Tavryn an einer phonetisch-zu-nahen Trademark (`tavrn.ai`), Aurelun an einem Markennamens-Cluster (Aurelio/Aureum/AureliaX), Brelon an einer aktiven BREV-Anmeldung, Nerlo an einer belegten GitHub-Org. **GitHub hat einen eigenen Reservierungs-Mechanismus**, der unabhängig von USPTO/EUIPO/`.ai`-TLD ist und erst beim Anlege-Versuch sichtbar wird. Für Nolmi konkret: USPTO + EUIPO sauber, npm/PyPI/Docker frei — aber GitHub-Org `nolmi` intern reserviert ohne sichtbaren Trademark-Grund (Support-Anfrage Tag 30 gestartet, Tag 30 Abend gestoppt wegen Form-Routing-Sackgasse und niedriger Erfolgswahrscheinlichkeit). Lösung: AI-Sektor-Konvention `nolmi-ai` (vgl. `langchain-ai`, `anthropic-ai`) — bewusste Inkonsistenz mit `nolmi` als npm/PyPI/Docker-Namespace (siehe Strategy-Doc §0 + S8 + Lesson dokumentiert in §9). **Pattern für künftige Marken-Sicherungen:** Trademark-Quick-Search ist nur **eine** Säule. Vor Domain-Kauf zusätzlich (a) GitHub-Org-Verfügbarkeit, (b) npm/PyPI/Docker-Namespace, (c) Phonetic-Cluster-Check via Web-Suche prüfen. Ein Punkt rot heißt nicht „Name verbrannt", aber er heißt „bewusste Setzung treffen, ob Inkonsistenz akzeptiert wird, statt blind Domain zu kaufen". Vier Iterationen vor Nolmi hätten mit dieser Checkliste teilweise früher abgebrochen werden können.

## Tag 33 (31. Mai 2026, Sonntag) — Distribution Etappe 2 Schritt 5: Production-Deploy (Sammeldeploy c88f0eb), Migration 026 FK-safe auf Echtdaten

**Stand Tag 33:** Die komplette Etappe-2-Arbeit (Etappe 1 + 2.1/2.2/2.4a/2.4b/2.3 + Migration 026) ist jetzt **auf Production** (`srv1712371`, `187.124.3.235`, `/docker/nolmi/repo`). Der destruktive 12-Schritt-FK-Rebuild **026** lief auf **Production-Echtdaten ohne Datenverlust** — der gestern gebaute FK-Cascade-sichere Runner (`foreign_keys_off`-Opt-in aus `6c6032f`) hat seinen Ernstfall bestanden. Davor ein Foundation-Befund: die Etappe-2-Commits existierten **nur lokal**.

### Befund vorab — Etappe-2-Commits nur lokal (Single-Point-of-Failure)

Pre-Flight ergab: `origin/main` stand auf `2ad7d3d` („Etappe 1 verifiziert"), die sechs Etappe-2-Commits (`24665a1`, `c5f9012`, `a75adbe`, `aaf207a`, `4ee36ad`, `c88f0eb`) waren **lokal committet, aber nie gepusht**. Ein VPS-`git pull` hätte nur den halben Stand gezogen. **Behoben:** sauberer Fast-Forward-`git push` (`2ad7d3d`→`c88f0eb`, kein Force; der Husky-Pre-Push-Hook fuhr `pnpm -r build` über runtime + web → grün, dann erst Push). `origin/main` jetzt `c88f0eb`. Die gesamte Etappe-2-Arbeit lag damit als nur-lokaler Single-Point-of-Failure vor — jetzt redundant auf `origin`.

### Production-Deploy (B4-Klasse Pre-Flight)

| Phase | Was |
|---|---|
| Phase 0 (Claude Code) | Pre-Flight read-only: HEAD `c88f0eb` clean, enthält `6c6032f`+2.4a+2.4b · Runner-Lebensretter im zu deployenden Stand verifiziert (`init-db.ts` Marker-Handler `foreign_keys_off` außerhalb der Tx + `foreign_key_check` vor COMMIT + Post-Loop-FK=ON-Reset) · 026 trägt Marker in Z.1 · **nur runtime + web** rebuilden (Bridge unverändert — `bridge-register.ts` liegt unter `apps/runtime/`, nicht in der Bridge-App) · exakte Deploy-Befehle + Rollback-Plan (Restore `VACUUM INTO`-Snapshot + Retag `rollback-025`) geliefert. |
| Phase 1 (Backup) | `VACUUM INTO`-Konsistenz-Snapshot `twin.db` **und** `bridge.db`, tar.gz nach `/docker/nolmi`, **offsite auf den Mac** (`nolmi-db-backup-20260531-064823.tar.gz`). Counts-before festgehalten. Rollback-Image `rollback-025` getaggt **vor** dem Rebuild. |
| Phase 2 (Deploy) | VPS-`git pull --ff-only` (HEAD = `c88f0eb` verifiziert) → runtime + web neu gebaut (web mit `--build-arg NEXT_PUBLIC_RUNTIME_URL=https://runtime.nolmi.ai`, `DEPLOYMENT_LABEL=production`) → `docker compose up -d --force-recreate` runtime (init-db.js fährt 026 mit neuem Runner), dann web. |
| Phase 3 (Verifikation) | siehe unten. |

### Migration 026 SICHER auf Production-Echtdaten — die Belege

- **Runtime-Log „026 … angewendet (foreign_keys_off-Modus)"** → der **neue** Runner fuhr die Migration, nicht der alte. Der Schutz greift, weil das neue Image Runner **und** 026 zusammen bündelt (`CMD: init-db.js && exec index.js`) → beim Boot läuft immer der neue Runner zuerst. Der alte Runner unter `foreign_keys=ON` hätte das `DROP TABLE twin_profiles` über 11 FK-Kinder kaskadiert → Totalverlust; dieser Pfad war strukturell ausgeschlossen.
- **`foreign_key_check` leer** — kein verwaister FK nach dem Rebuild.
- **`bridge_url`/`bridge_token` jetzt `notnull=0`** (vorher 1, der eigentliche Migrations-Zweck: Solo-Twin-Support).
- **Kind-Tabellen-Counts vorher=nachher IDENTISCH** (`conversations`, `facts`, `oauth_tokens`, `skills`, `mcp_servers`, `trust_relationships`, `telegram_*`, `twin_diary`, `embeddings`, `audit`) — einzige Schema-Differenz `schema_migrations` 25→26. **Kein Cascade-Verlust — der härteste Beweis, dass die Twin-Historie intakt ist.**

### Funktion live (am Verhalten)

- **Direct-Chat @markus** über `app.nolmi.ai` — echte LLM-Antwort.
- **A2A @markus→@florian** in Echtzeit: **201** (kein 409), `bridge_url` der drei Twins erhalten.
- **`auth_mode`-Gate 2.4a live**: der api_key-Twin zeigt in Settings **keinen** OAuth-Button.
- **3 Container Up**, **Bridge unangefasst** (kein Rebuild nötig).

### Offener Befund (Backlog, kein Deploy-Fehler)

**`nolmi.ai` (Root/Apex, ohne `app.`) liefert 404** — die App lebt unter `app.`/`runtime.`/`bridge.`, die Apex-Domain ist im Traefik-Routing unbelegt / keine Landing-Page. **Kein aktueller Blocker** (Closed-Beta läuft über die Subdomains), aber **vor öffentlichem Launch** zu schließen — neues BACKLOG-Item, Berührungspunkt mit #112. Rollback-Images `rollback-025` (runtime + web) bleiben bis zur Stabilitäts-Schamfrist auf dem VPS, Aufräumen erst nach einigen Tagen unauffälliger Production-Laufzeit.

### Distribution-Stand nach Tag 33

Etappe 1 + Etappe 2 (2.1–2.4b + 2.3 Single-Host + **Production-Deploy 026**) **abgeschlossen**. Offen in Etappe 2: Onboarding-Wizard-Solo-Pfad (Web), **Schritt 3b** (TLS/Traefik-Production-Install), Update-Mechanismus. Etappe 3 (Release) gated durch §5 (secret-freie History).

### D2-Revision (Strategie, kein Code) — OAuth provider-differenziert + eingebaute Vergänglichkeit

`DISTRIBUTION-STRATEGY.md` §2 D2 umgeschrieben (Mechanik unverändert — 2.4a hat sie schon gebaut). Schärfer gefasst: **API-Key-Default ist der Fels** (provider-unabhängig, keine Drittanbieter-Politik-Abhängigkeit); **OAuth ist IMMER eine widerrufbare Betreiber-Setzung** über die Allowlist, nie ein Default und nie ein Code-Pfad, der dauerhafte Provider-Toleranz annimmt. **Provider-Lage (Stand 31. Mai, beweglich):** Anthropic hatte Subscription-OAuth (Claude-CLI-Reuse) blockiert, toleriert es laut OpenClaw-Doku inzwischen wieder; OpenAI/Codex-OAuth funktioniert in Drittanbieter-Tools, ist aber reverse-engineert und nicht offiziell gewidmet — beides toleriert, nicht garantiert. **Architektur-Konsequenz:** nie von Provider-OAuth abhängen — die 2.4a-Widerrufbarkeit (`twin:auth-mode … api_key`) ist die Robustheit, nicht die Wette auf Toleranz. **Neue Grenze Self-Hosting↔Managed:** self-hosted nutzt der User sein eigenes Abo auf eigener Maschine (Liability beim User, überschaubar); auf `nolmi.ai` trüge **Nolmi** das Liability → heikel, API-Key-Default bleibt die sichere Linie. Folge-Item im BACKLOG notiert (Codex-OAuth-Provider erst in Weg-B-Onboarding, self-hosted-only).

### §5a-Gate erfüllt + Open-Source-Richtung gesetzt + Lizenz-Default revidiert (Strategie, kein Code)

Vorbereitung der Public-Entscheidung (Etappe 3).

- **§5a Secret-Gate ERFÜLLT.** PAT-Rotation durch; **Secret-History-Scan 🟢 sauber** (gitleaks 8.30.1 frisch geladen, volle History **327 Commits/alle Branches** + manueller Muster-Gegencheck). 0 echte Token (sk-ant/sk-/`ghp_`/`github_pat_`/PEM/JWT), nie eine echte `.env`/`.db` committet, sensible ENV-Vars nur Platzhalter. **Einziger gitleaks-Treffer = dokumentierter False-Positive** (`OAuthActivationModal`-Komponentenname in einer STAND.md-Changelog-Zeile). **Der Tag-30-PAT war nie in einem Commit** (nur Chat). → **Kein `filter-repo` nötig.** Hygiene-Reminder: Scan **unmittelbar vor** dem Public-Schalten einmal wiederholen.
- **Open-Source-Richtung GESETZT** (nicht nur-Images). Code wird sichtbar. Begründung: A2A-Bridge soll **Standard + Community** werden, Managed ist **Bequemlichkeit kein Burggraben**, **Beiträge + Reichweite** gewünscht — alle drei verlangen offenen Code. Der Managed-Schutz läuft über die **Lizenz**, nicht übers Verstecken. **Folge:** NPM-Onboarding über **B1-Clone** (Repo public) als primärer Pfad; **B1-Image-Pull** verliert den Schutz-Treiber (nur noch optional als schlankster Install-Weg).
- **Lizenz-Default MIT → Copyleft revidiert** (Zwischenschritt) → **final GESETZT: AGPL-3.0** (recherche-basiert, eigener Eintrag unten). Hebel: Relizenzierung geht nur sicher **restriktiv→permissiv** (AGPL→MIT jederzeit; MIT→AGPL praktisch unmöglich — jede MIT-Version bleibt für immer forkbar) → restriktiver Start hält „Weg 3 jetzt, Weg 1 langfristig" offen.
- **Doku-Konsistenz:** `DISTRIBUTION-STRATEGY §5a/§5b` + Etappe-3-Release-Weg + NPM-Pfade, `ROADMAP` Release-Gate, `PRE-LAUNCH-A` LICENSE-Item nachgezogen. Alle „MIT-als-Default"-Behauptungen über `docs/` beseitigt (Fremdprojekt-MIT/Archiv/„mit"-Wort unberührt).

### Weg-B-Onboarding Phase 1+2 ✅ — durchgehendes Terminal-Onboarding (twin:onboard baut den Twin)

Die zweite Tür neben dem Web-Wizard ist jetzt **durchgehend**: `twin:onboard` legt User **und** Twin an, ohne Browser-Zwang (Headless-VPS).

- **Phase 1 (Commit `759fcbf`) — createTwin-Service-Extract:** die 7-Schritt-Twin-Erstellung aus dem `/onboarding/submit`-Handler in einen geteilten `createTwin(input, deps)` gezogen, den Web-Wizard **und** CLI aufrufen (keine Duplikation). Verhaltensneutral, Web-Wizard am Verhalten verifiziert (Owner/Switcher/Chat/Presets). Deps als Parameter → CLI-tauglich.
- **Phase 2 (Commit `2e61007`) — CLI-Flow:** `twin:onboard` durchgehend (DB-Check → User idempotent → Doppel-Twin-Schutz → QuickStart/Advanced → Persona/Mandate/Bridge/Key → `validateApiKey`-Live-Check → `createTwin`). `createTwin` additiv erweitert (Wizard byte-unverändert): **Solo-Pfad** (`bridgeUrl=null`) + optionaler `bridgeRegisterToken`; **Hot-Load-Deps optional** (ohne Live-Registry: Twin in DB, `requiresRestart=true`, keine Presets). Kein OAuth-Prompt (D2), `auth_mode`-Default `api_key`.
- **Verifiziert (interaktiv, Wegwerf-DB):** QuickStart durchgelaufen — Twin `@cli-twin` mit Owner + generierter Persona + `bridge_url` NULL (Solo) + `auth_mode` api_key; Doppel-Twin-Schutz greift (freundlicher Abbruch). Switcher/Chat-nach-Restart über Phase-1-Smoke + identischen Hot-Load-Pfad abgedeckt.
- **MVP-Grenze:** keine Presets im CLI (`activatePresets` braucht die Live-Registry) → via Settings nachholbar; Twin geht erst nach Runtime-Restart live (Registry-Boot-Load — für Headless der Normalfall).
- **Advanced-Pfad ✅ (Tag 33, nachgezogen):** auch am Verhalten verifiziert (Wegwerf-DB + echte Bridge) — volle PersonaInput (CTO/direct/du/no-emojis), Mandate-Wahl, **eigene Bridge** via `registerHandleOnBridge` → `@advancedtest` an der Bridge registriert (`bridge.db`: JA), `twin.db` mit `bridge_url`/`bridge_token`/`owner_user_id`; Test-Handle danach aus `bridge.db` entfernt. **Beide** Weg-B-Pfade (Solo + eigene Bridge) damit verifiziert.
- **TTY-Befund (steht weiter):** `readLine`/`readSecret` teilen keinen Buffer über Aufrufe → nur interaktiv, nicht piped/CI (Helper-Refactor wäre separates Stück). Als BACKLOG-Item notiert.

### Lizenz GESETZT: AGPL-3.0 (recherche-basiert, Strategie — kein Code)

Nolmi wird unter **AGPL-3.0** (GNU Affero GPL v3) lizenziert. **Warum AGPL:** Copyleft **mit Network-Use-Klausel (§13)** → schließt die **SaaS-Lücke** der normalen GPL (wer es gehostet anbietet, muss auch modifizierten Quellcode rausgeben) → **Schutz gegen geschlossene kommerzielle Forks / Konkurrenz-Managed** bei vollem offenem Code für Community/Beiträge. Etablierter **2026-Standard für Open-Source-SaaS** dieser Klasse (Grafana, Bitwarden-Server, Mattermost, Gitea, Nextcloud, Mastodon, Plausible). **Relizenzierungs-Logik:** AGPL→MIT jederzeit lockerbar, MIT→AGPL unmöglich → restriktiver Start hält „Weg 3 (geschützt) jetzt, Weg 1 (permissiv) langfristig" offen.

**Bewusst später (offene Items, nicht jetzt entscheiden):** **Dual-Licensing** (AGPL frei + kommerzielle Lizenz) als Monetarisierungs-Pfad der späteren Managed-Tür — Ausgestaltung erst wenn konkret, dann mit Lizenzrecht-Fachkundigem. **CLA/DCO** als Vorbedingung dafür — muss vor dem ersten externen Beitrag stehen (jetzt unkritisch, Alleinautor).

**Altlast (jetzt-relevant, vor Public zu fixen):** committet liegen Apache-2.0-`LICENSE` + `package.json: "license": "Apache-2.0"` (aus #111) → widersprechen AGPL. Vor Public: `LICENSE`→AGPL-3.0, `package.json`→`AGPL-3.0`, ggf. Header/README. **Nicht in diesem Doku-Commit** — eigener Going-Public-Schritt (BACKLOG-Item). Doku-Orte aktualisiert: `DISTRIBUTION-STRATEGY §5b` + §3-Cross-Refs, ROADMAP-Gate, PRE-LAUNCH-A.

## Tag 34 (1. Juni 2026, Montag) — Going Public vollzogen (Repo PUBLIC, AGPL-3.0-only, still)

**Der irreversible Schritt ist getan.** `nolmi-ai/nolmi` ist seit **1. Juni 2026 PUBLIC** — Code **und volle Git-History** sind ab jetzt für immer öffentlich.

- **Lizenz:** **AGPL-3.0-only**. GitHub erkennt die Lizenz korrekt im Repo-Header (LICENSE = kanonischer AGPL-3.0-Volltext, alle 5 `package.json` = `AGPL-3.0-only`).
- **Strategie A — „still public":** Code sichtbar, **bewusst KEIN Launch / kein Announcement**. Status pre-launch (0 stars/forks/watching). Das öffentliche Repo ist die **Voraussetzung** für die zwei distributions-gekoppelten Folge-Items (NPM-Wrapper B1-Clone + volle #112-Landing); der eigentliche **Launch kommt später, wenn das Produkt rund ist** — nicht jetzt.
- **Vorbereitung (beide ✅ vor dem Schalten):**
  - **Lizenz-Swap** (`0d750db`): Apache-2.0 → AGPL-3.0-only. Kanonischer AGPL-3.0-Volltext von gnu.org (verbatim, unmodifiziert) in `LICENSE`; `license`-Feld in Root + 4 Workspaces auf `AGPL-3.0-only`; README-Badge + License-Sektion angeglichen. Build grün (SPDX-Wert bricht kein Tooling).
  - **Hygiene-Re-Scan** (Schritt 3, unmittelbar vor dem Schalten): gitleaks **8.30.1** über die **volle History / alle Branches** — **341 Commits 🟢 sauber** (Tag 33 waren 327 → +14). Einziger Treffer = der **bereits Tag 33 dokumentierte False-Positive** (`OAuthActivationModal`-Komponentenname in einer STAND.md-Changelog-Zeile, Entropie-Fehldeutung; captured „Secret" = das Wort „4-Schritt-Anleitung"). Manueller Gegencheck: 0 echte Token (sk-ant/sk-/`ghp_`/`github_pat_`/PEM/JWT), `BRIDGE_REGISTER_TOKEN` nur als Platzhalter/`process.env` (Advanced-Test-Token nie committet), nie eine echte `.env`/`.db` committet, kein Klartext-Master/Session-Key. → **Kein `filter-repo` nötig.**

**Jetzt freigeschaltet (waren an Public gekoppelt, ab sofort baubar):**
- **NPM-Wrapper `npm i -g nolmi`** — B1-Clone-Pfad (braucht public Repo, jetzt erfüllt; B1-Image-Pull weiter bevorzugt). Diagnose Tag 33 durch, Bau offen.
- **Volle #112-Launch-Landing** — kann die `nolmi-apex`-Platzhalter-Seite ersetzen.

**Launch-blockierende Politur bleibt sichtbar (offen, vor echtem Launch):**
- **QuickStart-Mandate-Default `respond_to_chat = always_pending`** — frischer Twin antwortet nie sofort (außer Owner-Bypass); zu klären, ob `auto` der bessere QuickStart-Default ist.
- **#3 maxLength-Enforcement Live-Test** — gebaut (`6c836d5`), aber noch nicht am laufenden Twin verifiziert.
- **#112-Landing** (s.o.) — minimale Apex-Platzhalter-Seite ist live-validiert, die echte Launch-Landing fehlt.

**Kosmetik vor Launch (Mini-Item, GitHub-Settings, kein Repo-File):** Repo-Description ist noch deutsch („Lab-Setup für persönliche AI-Twins…"), README pitcht englisch → vor Launch EN-angleichen.

### NPM-Wrapper Phase 1 GEBAUT + VM-E2E-verifiziert (`2beff2f`) — 1 Remote-Bug gefunden

Erstes (und einziges) publizierbares Paket **`packages/cli`** (`name "nolmi"`, `bin nolmi→dist/cli.js`, `AGPL-3.0-only`, nicht `private`) — Node-Port der bewiesenen `install/install.sh` (7 Schritte) mit den drei vorgesehenen Abweichungen: public-Repo-Clone (kein PAT) · `node:crypto` statt openssl · TTY-Passthrough fürs `onboard`. `--no-docker` (Phase A) als Groove reserviert, nicht gebaut. Statisch grün (typecheck/build/`pnpm -r build`, `.env` byte-identisch + mode 0600, enc-Key=32-Byte-base64).

- **VM-E2E-Test (187.124.7.94) ✅:** Klon des public Repos → `docker compose up --build -d` → idempotente `.env` → interaktives `onboard` (User+Twin angelegt). **Der Klon/Build/Onboarding-Pfad trägt end-to-end.**
- **🔴 Bug gefunden (NICHT gefixt, eigenes BACKLOG-Item, HOCH):** `onboard` backt `NEXT_PUBLIC_RUNTIME_URL=http://localhost:4000` ins Web-Bundle (build-time, aus install.sh geerbt, für **lokales** Single-Host). Bei **Remote-VPS-Zugriff** (Browser auf anderem Rechner als die VM) zeigt das Bundle auf den Browser-Rechner → Login „Failed to fetch". Runtime selbst gesund (`/health` 200, `0.0.0.0`), nur die **gebackene Adresse** ist falsch. **Blockiert den primären Self-Hoster-Fall (VPS + Laptop-Zugriff)** → vor `npm publish` + Launch zu fixen (Optionen a/b/c im BACKLOG, Größe M).
- **Vor Publish ebenfalls offen:** `packages/cli` shippt mit `files: ["dist"]` **keinen AGPL-Volltext** im Tarball (root-`LICENSE` liegt eine Ebene drüber) → `LICENSE` nach `packages/cli/` aufnehmen.

→ **Phase 1 ist solide (Pfad bewiesen), aber NICHT publish-reif**: erst der Remote-URL-Bug + LICENSE-im-Tarball, dann `npm publish`.

### Remote-URL-Fix VM-verifiziert (`fix(cli): Remote-URL …`) — B1-Clone trägt jetzt remote end-to-end

Der HOCH-Bug (gebackenes `localhost:4000` → Remote-Login „Failed to fetch") ist **gefixt + auf der VM am echten Verhalten verifiziert**. Lösung: **Option a + Auto-Vorschlag** — `onboard` löst die Browser-Adresse **vor** dem Build auf (explizit `--host`/`NOLMI_HOST` → kein Prompt; sonst TTY-Rückfrage mit erkannter IP als Vorschlag; kein TTY → erkannte IP + laut geloggt), `https://` wird mit 3b-Hinweis abgelehnt. Plus **Repair-Pfad `nolmi reconfigure-host`**: ersetzt **nur** die `NEXT_PUBLIC_RUNTIME_URL`-Zeile (zeilenweise, **Secrets nie angefasst**) + web-Rebuild. `install.sh` als DRY-Spiegel mitgezogen (`detect_ip`/`resolve_host`), `.env`-Formel byte-identisch, `SESSION_COOKIE_SECURE=false` bleibt (für http+IP korrekt).

- **VM-Beleg (187.124.7.94):** Tarball-mit-Fix → `reconfigure-host` → **IP 187.124.7.94 korrekt vorgeschlagen** + bestätigt → URL-Zeile ersetzt → web-Rebuild → **Browser-Login vom Mac (http://187.124.7.94:3000) funktioniert, Twin antwortet** auf „Hallo". **Secrets-Beweis:** der Twin liefert eine echte LLM-Antwort → `NOLMI_ENCRYPTION_KEY` ist unversehrt (die `.env`-Zeilen-Ersetzung hat nichts Verschlüsseltes berührt).
- **Kleine Erkenntnis:** `detect-ip` (`os.networkInterfaces()`, erste non-internal IPv4) nahm auf dem VPS **korrekt die öffentliche IP** — kein Docker-Bridge-IP-Problem (172.x), keine NAT-Verwirrung. Die schlichte Heuristik trägt für den **schlichten VPS-Fall** (gebundene IP = öffentliche IP); der Prompt bleibt das Sicherheitsnetz für NAT/Multi-IP.
- **Damit:** Phase 1 **funktional vollständig + remote-verifiziert**. Vor `npm publish` nur noch 2 bewusste Schritte: (a) LICENSE ins Tarball, (b) publish selbst.

## Tag 35 (2. Juni 2026, Dienstag) — `npm publish nolmi@0.1.0`: B1-Clone-Distributionsweg LIVE (still)

**Meilenstein:** `nolmi@0.1.0` ist **publiziert auf `registry.npmjs.org`** — der Self-Hosting-Distributionsweg steht öffentlich: **`npm i -g nolmi` → `nolmi onboard`**.

- **Paket:** AGPL-3.0-only, **deps: none** (nur `node:*`-Builtins), `bin: nolmi`, Maintainer `markusbaier`, **LICENSE im Tarball (34,5 kB AGPL-Volltext)**, **14 Dateien** (nur `dist/` + LICENSE + README + package.json — kein Source, keine `.env`). `npm view nolmi` bestätigt die öffentliche Abrufbarkeit.
- **Still:** wie Going Public **kein Launch/Announcement** — das Paket ist da, der laute Launch kommt später, wenn die Politur rund ist.
- **Voller Bogen in ~2 Tagen:** **Going Public** (Tag 34, Repo public + AGPL-Swap) → **NPM-Wrapper gebaut + VM-remote-verifiziert** (Tag 34, inkl. Remote-URL-Fix) → **LICENSE ins Tarball** (`a315b08`) → **publiziert** (Tag 35). Pre-Flight war 6/6 grün (Name frei, Tarball sauber, nur `packages/cli` nicht-private).
- **Kosmetischer Befund beim Publish:** npm normalisierte `repository.url` zu `git+https://…` (Warnung) → `npm pkg fix`-Mini-Item im BACKLOG (XS, kein Funktions-Einfluss).

**Jetzt klar sichtbare nächste Fronten (Launch-Vorbereitung, nicht heute zwingend):** ~~`always_pending`-Onboarding-Politur~~ (Tag 35 diagnostiziert → kein Fix nötig, s.u.), volle #112-Landing (ersetzt Apex-Platzhalter, braucht Pitch/Hero-GIF), #3-Live-Test (Nicht-Owner), Repo-Description EN. **Erst wenn die rund sind: lauter Launch (HN/Twitter).**

### `always_pending`-Onboarding diagnostiziert — KEIN Fix nötig (strukturell, nicht Template; Owner-Fall unbetroffen)

Read-only Diagnose des vermuteten „frischer Twin antwortet Nicht-Ownern nie"-Problems → **gegenstandslos für den realen Self-Hoster (= Owner)**, **keine Code-Änderung** (Entscheidung Markus). Das Verhalten ist **strukturell, nicht Template-bedingt**:
- **Owner-Web-Chat antwortet immer sofort** — `/twins/:handle/chat` ist `requireOwner`-gated → Owner-Bypass (`twin-service.ts:437`) überspringt das Mandate. (VM bestätigt.)
- **Untrusted A2A immer pending — hartkodiert** (`twin-service.ts:952`, liest `escalation` nicht); **trusted A2A immer auto** (Trust-Bypass). → cautious↔trusting ändert am Chat-/A2A-Ersteindruck fast nichts.
- **Kein Nicht-Owner-Chat-Pfad** existiert heute (UI komplett `requireOwner`; nur der tote Legacy-`/chat`-Alias umgeht den Bypass). „Fremde chatten mit meinem Twin" wäre ein neues Feature.

→ Item im BACKLOG **geschlossen** (diagnostiziert, nicht „gefixt"). Die Diagnose legte zwei echte, kleinere Fäden frei, als eigene Items notiert (nicht gebaut): (1) **Cleanup toter Reste** (`above_threshold` totes Enum, deprecated `/chat`, `requiresApprovalIfMatches` unausgewertet), (2) **offene Produktfrage** — soll der A2A-Empfangspfad das Mandate-`escalation` respektieren statt untrusted=immer-pending hartzukodieren (die eigentliche „sollen Twins einander spontan antworten"-Entscheidung).

### Web-Präsenz-Architektur GESETZT — eigenes Repo + Vercel, getrennt vom Produkt-Stack

Die Marketing-Landing (+ künftige Docs) wird **vom Produkt-Monorepo getrennt** — eigener Lebenszyklus:
- **Eigenes Repo** (`nolmi-ai/nolmi-web`) auf **Vercel** (Next.js-Nähe, Git-Deploy, CDN, Auto-SSL).
- **Subdomains:** `nolmi.ai` (Apex) → Landing/Vercel · `app.nolmi.ai` → Produkt-UI (VPS, unverändert) · `docs.nolmi.ai` → Docs (später, Vercel).
- **DNS (reversibel):** nur der Apex-A-Record (`nolmi.ai`) zeigt künftig auf Vercel statt VPS (`187.124.3.235`); `app./runtime./bridge.` bleiben am VPS.
- **Folge:** der Übergangs-Container **`nolmi-apex` wird abgelöst**, sobald die Vercel-Landing live + DNS umgestellt ist (Service aus `docker-compose.yml` + Apex-Eintrag aus `tls-promote.sh` — Cleanup-Item).
- **Landing-Pitch steht** (englisch, Positionierungs-Session): Hero **„Be present, without being always available"**, 3 persönliche Nutzen führen, A2A als nachgeordneter 4. Punkt, Trade-off-Satz, npm-Install, AGPL, pre-launch. #112 zieht entsprechend in das neue Repo um (alter „Memory Depth + Inter-Twin"-Hero überholt — führte mit dem Infra-Feature statt dem persönlichen Nutzen).
- **Descriptions auf persönlichen Pitch:** **GitHub ✅ (Tag 35)** — Repo-Description gesetzt auf „Be present, without being always available — your self-hosted personal AI twin." (ersetzt die A2A-/Infra-geführte Fassung, konsistent zur Landing). **npm offen** → beim nächsten CLI-Publish (0.1.1) mitnehmen (`packages/cli/package.json:"description"`), an das NPM-Distribution-Item gekoppelt.

### Landing live auf nolmi.ai (Vercel) + Apex-Platzhalter abgelöst/entfernt

Die Web-Präsenz-Architektur ist umgesetzt: **`nolmi.ai` liegt jetzt auf Vercel** (Landing live, Repo `nolmi-ai/nolmi-web` — IBM-Plex-Mono + NOLMI-GREEN, brandkonform). Damit ist der Übergangs-Container **`nolmi-apex` gegenstandslos und aus dem Produkt-Repo entfernt**:
- **`docker/nolmi/docker-compose.yml`:** `nolmi-apex`-Service + Top-Level-`configs:`-Block raus (verifiziert `docker compose config` VALID → nur noch runtime/bridge/web, kein `configs:`-Key). Networks/Volumes unberührt.
- **`install/tls-promote.sh`:** Apex aus der `HOSTS`-Cert-Trigger-Liste + den Texten zurückgebaut (`bash -n` grün) → Certs nur noch app/runtime/bridge. `app./runtime./bridge.`-Router, Traefik und deren Certs **unangetastet**.
- **VPS-Aktion GEGENSTANDSLOS (Befund Tag 35):** `nolmi-apex` lief auf Production **nie** — der Apex wurde Tag 34 (`f7e7954`) im Repo gebaut, aber der geplante Sammeldeploy fand nie statt; Prod (`srv1712371`) läuft bewusst auf einem Stand VOR dem Apex (`docker compose ls` = `nolmi running(3)`). Der Code-Diff (`37fabdb`) genügt → kommt beim nächsten Deploy gar nicht erst auf. **Kein VPS-Eingriff, kein offener Rest.** Reversibel.

### Prod-VPS-Deploy-Mechanik dokumentiert (authoritative) + nächster Deploy bewusst getaktet

Beim Apex-Befund klar geworden — bisher nicht sauber dokumentiert, jetzt in `DEPLOYMENT.md §3` (Callout) + BACKLOG + Memory: **Prod-VPS `srv1712371`-Layout** `/docker/nolmi/` (Laufzeit-`.env`, htpasswd, DB-Backups, model-cache) + `repo/`-Unterverzeichnis; `docker-compose.yml` ist ein **Symlink** → `repo/docker/nolmi/docker-compose.yml`. **Deploy-Sequenz:** `cd /docker/nolmi/repo && git pull` → zurück nach `/docker/nolmi` → `docker compose up -d` (nutzt Symlink + Laufzeit-`.env`).

**Reminder:** Production läuft auf einem Stand **vor** dem Tag-34/35-Stapel. Der **nächste reguläre Deploy** bringt den ganzen aufgelaufenen Stapel (#3 maxLength, Weg-B-Refactor, Apex-Removal, …) — **bewusst getaktet**, nicht versehentlich nebenbei (eigenes BACKLOG-Item). Das **#3-Live-Test-Gate ist jetzt ✅ erfüllt** (s.u.).

### #3 maxLength Live-Test ✅ abgeschlossen (VM 187.124.7.94)

Der Nicht-Owner-`respond_to_chat`-Pfad (🔶 → ✅): `escalation:auto`, über den deprecated `/chat`-Legacy-Alias gegen einen Test-Twin **@markus** (`LEGACY_HANDLE` ist fest `@markus` → ein @test-Twin ist über `/chat` nicht erreichbar). **Zwei der drei Enforcement-Stufen live bewiesen:**
- **Präventiv:** `maxLength:50`, 2 Calls → Modell blieb von sich aus ≤50 (43/47 Zeichen, `finishReason:stop`, **kein Flag — by design**).
- **Retry:** `maxLength:20` + Langer-Absatz-Prompt → Erstantwort zu lang → 1 Retry → „Kurz halten." (12 Z.), **`output.lengthEnforced:"retried"`** korrekt protokolliert.
- **Truncate:** nicht live erzwungen (bräuchte ein Modell, das auch den Retry ignoriert — künstlich) → bleibt isoliert im #3-Bau getestet, bewusst so.

**Korrektur fürs Protokoll:** `lengthEnforced`/`reply` liegen unter **`audit.data.output.…`**, nicht top-level (`AuditService.complete()` → `entry.output`) — der ursprüngliche Verifikationsbefehl las top-level → fälschlich `undefined`. Kein Bug, Mess-Fehler. **Bekannte Abdeckungs-Grenze (beibehalten):** #3 deckt nur `respond_to_chat`/default-Branch ab; **A2A wird nicht längenbegrenzt**. Optionales XS-Folge-Item notiert (Enforcement-Telemetrie: `maxLengthApplied`-Flag, da „präventiv eingehalten" heute nicht von „kein maxLength" unterscheidbar).

### Prod-Deploy Tag 35 ✅ — aufgelaufener Stapel auf srv1712371 (86ed1e4 → 6e32813)

Der getaktete Production-Deploy ist durch: **`86ed1e4` → `6e32813`** auf `srv1712371` (29 Commits — **#3 maxLength**, **Weg-B-Onboarding-Refactor**, **Apex-Removal**, Lizenz/Going-Public-Doku, 3b-TLS-Tooling).
- **KEINE Migration** (Runner: 26 bereits angewendet/skipped) → kein Schema-/Rollback-Risiko.
- **runtime + web neu gebaut**, **bridge unberührt** (kein Code-Change). Web-Bundle korrekt auf **`runtime.nolmi.ai`** (Literal-Build-Arg, nicht `${DOMAIN}`-leer — s. DEPLOYMENT.md-Stolperstein).
- **Live verifiziert:** Owner-Direct-Chat (@markus antwortet) · A2A (@markus→@florian) · **Weg-B-Onboarding-Smoke** (Test-Twin angelegt → geantwortet → wieder gelöscht). Container stabil.
- **Rollback-Artefakte auf dem VPS:** Images `rollback-86ed1e4` (runtime+web) + DB-Backups `*.preflight-bak` — **später aufräumen** (nach einigen Tagen stabiler Laufzeit).
- **Befund beim Build (jetzt dokumentiert):** der Prod-Stack nutzt `image:latest` ohne `build:` → `docker compose up -d` baut nichts; explizites `docker build` aus dem Repo-Root gehört davor. **DEPLOYMENT.md §3 entsprechend korrigiert** (inkl. Literal-Build-Arg-Warnung, da der #126-Guard ein leeres `${DOMAIN}` nicht abfängt).
- **Smoke deckte eine UX-Lücke auf:** ein im Wizard angelegter Twin ist über die UI **nicht löschbar** (musste per DB-Skript raus) → neues BACKLOG-Item.

## Tag 47 (17. Juni 2026) — 🚀 Twin-Zeitgefühl auf Prod (aktuelles Datum/Wochentag im System-Prompt)

**Tag 47 (Forts.) — Twins kennen jetzt Datum + Wochentag.** Runtime-only-Deploy `870a38a → ec68aac` auf srv1712371. `composeOwnerSystemPrompt` injiziert einen `## Heute`-Block („Heute ist {Wochentag}, {D}. {Monat} {Jahr}.", de-DE) — **pro Request** via `new Date()` (kein eingefrorenes Boot-Datum), **owner-lokale TZ** via `OWNER_DISPLAY_TZ` (reused `QUIET_HOURS_TZ`-Env, Default `Europe/Berlin`; ungültige TZ → UTC-Fallback). Greift über **alle Konversations-Pfade** (Owner-Chat, A2A trusted-bypass, send_to_twin, Summary) **und beide Modell-Pfade** (Vercel + Codex) — `runModel` baut `system` genau einmal hier. Autonome Engines (focus/reflection/nudge/extraction) bewusst außen vor (eigene `buildSystemPrompt`, kein Zeitgefühl-Symptom). **Prod-Smoke beidseitig:** Owner-Chat nennt korrektes Datum (Codex-Pfad bestätigt), A2A verortet Wochentage/Termine korrekt relativ zu heute (lokal: „übermorgen = Freitag" sauber). Boot grün, **nur runtime-Image**, keine Migration. Rollback-Tag `nolmi-runtime:rollback-tag47b`. → **Backlog-Item #1 (Zeitgefühl) erledigt.**



**Tag 47 (Forts.) — A2A-Summary-Verbesserungen live auf Prod.** Runtime-only-Deploy `a817c2a → 870a38a` auf srv1712371. Zwei Commits: **`300d27d`** (Summary scopt das Thread-Material per `a2aThreadId` + volle Historie statt `partnerHandle`/`slice(-5)` → keine Vermischung paralleler Threads, ganzer Verlauf von Anfang bis Ende) und **`870a38a`** (Summary öffnet mit der ursprünglichen Auslöser-Frage bei **owner-initiierten** Threads, Variante A — ein `output.reply` für Telegram + Bubble; partner-initiiert → kein Vorspann). **Nur runtime-Image neu** (web+bridge unberührt → kein Bundle-Check), **keine Migration**. Boot grün: `[a2a-sweep] started`, 3 Twins, kein Crash. Rollback-Tag `nolmi-runtime:rollback-tag47`.

**Lokaler Befund beim Bau (KEIN Prod-Problem):** Während der inkrementellen lokalen Builds entstand ein Bubble-Schwall (14 `a2a-summary-notice` aus dem Pre-armed-Fenster ~10:01, vor armedAt ~10:10). Ursache: ein Zwischen-Build hatte die Bubble (SS-C) schon, aber noch **ohne** das Backfill-Gate (`a817c2a`) und lieferte im 60s-Sweep alle undelivered Summaries. **Kein Code-Bug** — der aktuelle Code gated Bubble **und** Telegram korrekt hinter armedAt (`continue` vor `ensureA2aSummaryBubble`). Lokal bereinigt (14 stale notices gelöscht). **Prod unbetroffen:** das Tag-47-Bündel kam atomar inkl. `a817c2a` → erster Sweep lief armedAt-first, keine rückwirkenden Bubbles.



**Tag 47 (Forts.) — A2A Etappe 1+2 + @-Mention-Autocomplete + A2A-Zusammenfassungs-Zustellung live auf Prod.** Deployt `d14816a → a817c2a` auf srv1712371; **beide Images neu** (runtime+web), **Bridge unberührt**, **keine Migration**. Enthalten: A2A Glied 2 Etappe 1+2 (`b357f6c`, `e44461d`, `2275b3e`, `c163ede`, `9ed53f0`), @-Mention-Autocomplete (`5b4887b`), A2A-Zusammenfassungs-Zustellung (`96e1b45`, `4a43128`, `949b823`, `a817c2a`). **Prod-Smoke grün:** Chat + Streaming (OAuth/codex-Pfad bei @markus), @-Autocomplete (vertraute Twins), **A2A autonom mehrrundig** (echte Terminverhandlung @markus↔@florian), Abbruch-Button sichtbar. Sweep aktiv (`[a2a-sweep] started`, quiescence 5 min). Rollback-Tags `nolmi-{runtime,web}:rollback-tag46` gesetzt.

🔴 **Neue ENV auf Prod:** `A2A_CLOSE_SWEEP_ENABLED=true` (Pflicht — sonst keine Zustellung), gesetzt via Whitelist-Durchreichung `- A2A_CLOSE_SWEEP_ENABLED=${A2A_CLOSE_SWEEP_ENABLED:-}` in `/docker/nolmi/docker-compose.yml` + Wert in `/docker/nolmi/.env`. Optionale Defaults (nicht gesetzt): `A2A_THREAD_QUIESCENCE_MIN=5`, `A2A_CLOSE_SWEEP_INTERVAL_SEC=60`, `A2A_MAX_FOLLOWUP_ROUNDS=5`.

🔴🔴 **INFRA-KORREKTUR (wichtig — Annahme war falsch):** `/docker/nolmi/docker-compose.yml` ist **KEIN Symlink** auf `repo/docker/nolmi/docker-compose.yml`, sondern eine **eigenständige Prod-Datei** (zuletzt ~10. Juni editiert). **Edits am Repo-Compose erreichen Prod NICHT.** Prod-ENV-Muster: Whitelist-Durchreichung `- VAR=${VAR:-}` in `/docker/nolmi/docker-compose.yml` + Wert in `/docker/nolmi/.env`; zusätzlich existiert `/docker/nolmi/docker-compose.override.yml`. **Gemergte Config IMMER via `docker compose config` vor `--force-recreate` prüfen.** (Memory `prod-vps-deploy-mechanik` entsprechend korrigiert.)



**Tag 47 (Forts.) — A2A Glied 2 Etappe 2 lokal vollständig verifiziert.** Loop bis 5 Runden/Seite + Abbruch-Sicherung + Owner-Zusammenfassung bei Limit. Commits: **SS1 `2275b3e`** (Bremse: In-Memory `abortedThreadIds`-Set + `POST /twins/:handle/a2a/abort` mit requireOwner+IDOR + A2AChat-Abbruch-Button), **SS2 `c163ede`** (Loop auf `A2A_MAX_FOLLOWUP_ROUNDS` Default 5, Reihenfolge Bremse→Limit→Gas, `summarizeA2aThreadOnce` → `a2a-summary`-Audit mit Dedup), **FIX `9ed53f0`** (Abbruch-Button zielte via `.find()` auf den ältesten Eröffner statt den laufenden Thread — teils pre-SS1 `tid=null`; jetzt jüngster Anker `inReplyTo ?? bridgeMessageId`, null/System übersprungen). Live-Verifikation (nicht typecheck): **(b) Manueller Abbruch ✅** — Log `Thread=msg_iEFoAP2o abgebrochen — kein weiterer Send`, danach keine Folgerunde; erster Abbruch-Versuch hatte versagt (falsche threadId), Fix `9ed53f0` live bestätigt (ins Set geschriebene ID == Live-Anker). **(e) Automatisches Limit ✅** — deterministisch via temporärem `A2A_MAX_FOLLOWUP_ROUNDS=2`: DB zeigt `a2a-summary` bei Limit erzeugt (thread `msg_0pogSvY…`), Loop gestoppt; Limit danach auf Default 5 zurückgesetzt. **(f) Thread-ID ✅** — pro Thread konsistent, zwischen Threads distinkt. Zusammenfassung wird erzeugt (`a2a-summary`, ein Eintrag pro Thread, kein Duplikat). 🔴 **NICHT DEPLOYT:** Etappe 1+2 sind lokal-only (b357f6c, e44461d, 2275b3e, c163ede, 9ed53f0 — nicht auf Prod). Deploy = eigener Schritt (runtime+web, `NEXT_PUBLIC_RUNTIME_URL`-Build-Arg-Pfad, Bundle-Check, Rollback-Tags). **Bekannte Grenzen / Backlog:** (1) Abbruch ist EINSEITIG — nur der abbrechende Twin stoppt, die Gegenseite antwortet bis zu ihrem eigenen 5er-Limit weiter; beidseitiger Abbruch (Bridge-Signal an Gegenseite) = späterer Baustein. (2) `a2a-summary` landet als Audit im Inbox/Audit-Stream, NICHT als aktive Owner-Benachrichtigung (Telegram) — TwinService hat keinen `sendToOwner`-Kanal; aktive Zustellung = nächster gewünschter Baustein. **Umgebungs-Notizen (lokal):** Migration 030 via `pnpm db:init` nachgezogen (war HTTP-500-Sidebar-Ursache); Port-4000-Zombies via `lsof -ti :4000 | xargs kill -9`; `A2A_MAX_FOLLOWUP_ROUNDS` ist Modul-Konstante (Restart-Pflicht); Repo-Root `.env` (`apps/runtime/.env` ist Symlink dorthin).

## Tag 47 (17. Juni 2026) — ✅ A2A Glied 2 Etappe 1 lokal verifiziert (Thread-ID + 1 Folgerunde)

**Tag 47 — A2A Glied 2 Etappe 1 lokal vollständig verifiziert.** Commits SS1 b357f6c (Thread-ID-Propagation, kein Schema-Upgrade) + SS2 e44461d (Rundenzähler + EINE Folgerunde + Hard-Stop). Live-Smoke @markus↔@florian (beide vertraut, nach Migration 030 nachgezogen):
**(c) @markus reagiert autonom auf florians Antwort (Runde 2 lief) ✅** — Log: `[a2a:glied2] Folgerunde für Thread=<id>, followUpsDone=0`. **(e) Hard-Stop nach 1 Folgerunde ✅** — kein weiterer Send trotz florians offener Rückfrage; Log: `[a2a:glied2] Hard-Stop: Etappe-1-Limit erreicht (followUpsDone=1)`. **(f) Thread-ID propagiert sauber ✅** — `a2aThreadId = sentMessageId` der Eröffnung, liegt in `audit.data.input.a2aThreadId` (eingehend) bzw. `output.a2aThreadId` (ausgehend), pro Austausch konsistent, zwischen Austauschen distinkt. Inhaltlich: Twins führten echtes Gespräch über Twin-als-Verhandlungspartner inkl. Täuschungs-/Commitment-Ethik. 🔴 **Noch nicht deployt:** Etappe 1 ist lokal-only — bewusst, da eine Folgerunde allein auf Prod keinen Mehrwert hat; Deploy zusammen mit Etappe 2 geplant. **Nebendiagnose (Umgebung):** `SQLITE_ERROR: no such column: archived_at` — Migration 030 lokal nicht angewandt; behoben via `pnpm db:init` (idempotent, zog 030 nach). Port-4000-Zombies bei Neustarts: `lsof -ti :4000 | xargs kill -9`. Lokaler Telegram-Bot 401: Token-Konflikt mit Prod, kosmetisch.

## Tag 46 (14.–16. Juni 2026) — ✅ Approval-Toggle live + A2A Glied 1 Prod-verifiziert

**Tag 46 (Forts.) — A2A Glied 1 auf Prod verifiziert, kein Bau nötig.** Die Kette war code-komplett; nur Verifikation stand aus. Bestätigter Ablauf: Owner "schreib @florian X" → `send_to_twin` `always_pending` → Owner approved → @markus formuliert autonom (`approveTwinSend` → LLM → Bridge `twin-initiated`) → @florians Twin antwortet autonom (`canAutoRespond=true`, `familiarity_level=vertraut`, `handleTrustedBridgeMessage` → `twin-reply`) → Owner sieht Antwort im A2AChat (`reply-received`). Trust-Stand Prod bestätigt: @markus↔@florian beide `vertraut` (Tabelle `trust_relationships`, Spalten `twin_id`/`trusted_handle`/`familiarity_level`). 🎯 Live-Beweis: Florians Twin antwortete inhaltlich echt + fragte zurück — und zeigte damit zugleich den Glied-2-Bruchpunkt: @markus reagiert NICHT automatisch auf die Rückfrage (reply-received = Hard-Stop, kein LLM). 🔴 **Glied 2 (Mehrstufigkeit) als nächsten Bogen im BACKLOG erfasst** (twin-reply als Folgerunden-Einstieg, Rundenlimit, Rückfall an Owner, Schleifenschutz — Größe M-L, heikelste Autonomie-Stufe).

**Tag 46 — Approval-Toggle pro Tool deployt + Prod-verifiziert.** Dedizierter Backend-Endpoint `PATCH /twins/:handle/skills/:skillId/approval` (b95eb5c) — analog `/active`, kein source-403 (MCP-Skills erlaubt, expliziter User-Override), server-seitiger Merge `{ ...existing.manifestJson, requiresApproval }` → kein Feldverlust (capability, mcpServerId, mcpToolName, mcpInputSchema etc. unverändert). UI (d14816a): read-only-Badge → klickbarer Toggle (`toggleApproval` analog `toggleSkill`, optimistic + busyIds + revert); `auto-approve ⚠` warn-farbig markiert (Sicherheitsanzeige, Tool läuft autonom), `requires approval` = sicherer Default (muted). 🎯 End-to-End live: auto-Tool läuft im Chat OHNE Inbox-Pending + liefert Ergebnis; zurückgeschaltet → wieder pending. Default unverändert — neue Tools erben Server-Default; Vertrauen wird explizit pro Tool erteilt.

## Tag 45 (12.–13. Juni 2026) — 🎯 Web-Token-Streaming live (Web + OAuth-Twin)

**Tag 45 — Web-Token-Streaming: Bogen von SS1 bis Prod-Verifikation.** Mehrstufiger Bau, zwei Plattformen (api_key-Anthropic + OAuth-Codex), ein Prod-Crash unterwegs. **SS1** (2cb5820): `streamText` + `twin.token`-Bus-Event + `onToken`-Callback in `runModel` — Audit-Vertrag (voller Text am Ende) unverändert. **SS2** (f060a8e): `useToolCallStream` um `twin.token` erweitert, Streaming-Bubble in `DirectChat`. **Bubble-Fix** (a8f086c): Streaming-Bubble als `<Bubble role="assistant">` statt eigenem `<div>` — identisches Label/Layout/Border, kein Sprung beim Übergang Stream→final. 🔴 **hasTools-Guard-Problem:** SS1 hatte Guard `!hasTools && onToken` — greift nie für Twins mit aktiven MCP-Skills (`hasTools` immer `true`). **fullStream-Umbau** (892a4b8): `streamText/fullStream` statt `textStream` für alle Tools — `text-delta`-Chunks live, Tool-Calls atomar am Ende, Approval-Detect auf awaited `streamRes.steps` (heikelste Stelle, verhaltensidentisch), Audit aus vollständigem Text. 🔴 **Prod-Crash OAuth-Pfad:** `@markus` läuft auf OAuth → Codex-Backend (`codex-vercel-provider`, `LanguageModelV3`), `doStream not implemented` → Chat-Crash auf Prod. **Sofort-Fallback** (b8a6cd6): `try/catch` um streamText-Pfad, bei `doStream`-Fehler Warning + Fall-Through zu `generateText` (blockend, kein Crash). **Echter OAuth-doStream-Fix** (0b7a38a): `CodexAdapter.streamFetch()` gibt rohen SSE-Body, `doStream` mappt Codex-SSE-Events (`response.output_text.delta` → `text-delta`, Tool-Calls atomar) auf `ReadableStream<LanguageModelV3StreamPart>` — Mock-Fetch-Test (a)–(d) grün. **Auto-Scroll** (b8fc6d3): `streamingLength` als dritter Dep in `useAutoScroll` → Scroll-Effect feuert pro Token, `wasAtBottomRef`-Guard (manuelles Hochscrollen = kein Zurückzerren) unverändert. 🎯 **Verifikation live (Prod, api_key + OAuth):** Token fließen progressiv, Bubble pixel-gleich, Approval (Browser-Profil-Listing) landet pending (Approval-Detect hält), Auto-Scroll folgt. 🔴 **Methodik-Lehre:** `typecheck-grün ≠ funktioniert` — SS1 war grün, lief aber nie (hasTools-Guard). Konsequenz: Streaming + Provider-Verhalten IMMER live im Browser/mit echtem Call verifizieren. Lokal-vs-Prod: api_key streamt nativ (Anthropic-Provider), OAuth=Codex brauchte eigenes `doStream` — der eine ungetestete Unterschied, der auf Prod zuschlug; Fallback fing ihn sauber. **BACKLOG (kein Sofort-Druck):** (1) Tool-Call-Streaming atomar (bewusst, Feinschliff); (2) OAuth-Refresh-Loop überspringt `auth_mode=api_key`-Twins nicht (refresh_token_reused-Spam — Loop sollte api_key skippen); (3) requiresApproval per Tool/Server konfigurierbar (Markus will auto-approve für vertraute Tools; Vorstufe zur A2A-Autonomie).

**Tag 45 (Abend) — Kleine Fäden + Approval-Diagnose.** (2) **OAuth-Refresh-Loop-Fix deployt** (ff4e2dc): `findTwinIdsExpiringSoon` bekommt JOIN auf `twin_profiles.auth_mode = 'oauth'` — strukturelle Invariante, Loop berührt nie api_key-Twins unabhängig vom DB-Zustand. Prod-verifiziert: Audit-Log sauber, refresh_token_reused-Spam weg. (1) **Tool-Call-Streaming atomar → deltas** bewusst NICHT gebaut — kein Schmerz, Gold-Plating, Backlog-Notiz ohne Druck. (3) **Approval-Steuerung Diagnose abgeschlossen (Bau offen):** Mechanismus existiert und ist pro Tool granular: `tool-bridge.ts:108` liest `skill.manifestJson.requiresApproval` pro Skill; änderbar via PATCH `/twins/:handle/skills/:skillId` (manifestJson), überlebt Re-Sync (`skill-sync.ts:109` schützt User-Edits). Server-Default `mcp_servers.default_requires_approval` ist nur Erst-Quelle beim Sync. UI zeigt requiresApproval als read-only-Badge (kein Toggle). Kein CLI-Kommando. Die zwei Server-Varianten (`-approval`/ohne) sind technisch unnötig — ein Server + Per-Skill-Toggle täte es. 🔴 **Offene Design-Entscheidung (Markus, frischer Kopf vor dem Bau):** welche Tools auto-approve, welche behalten Freigabe-Pflicht? Read-only (list/scrape) vs. wirksam (browser-agent, später Kalender/Mail/MCP-Aktionen) — das ist die Kontrollgrenze Richtung A2A-Autonomie.

## Tag 44 (11. Juni 2026) — 🔴 Prod-Audit-Verifikation: Tag-43-Fehlzuordnung korrigiert + Fokus-Nudge-Cooldown-Fix

**Tag 44 — Prod-Audit-Verifikation: Fokus-Nudge statt Reflexions-Nudge (Tag-43-Fehlzuordnung).** Read-only audit.data-Analyse der vier Telegram-Fires (~14:59/21:47/01:47/05:47 Tag 43). Befund: alle vier Audits capability='proactive-nudge', input.anlass='fokus' — es war der FOKUS-Loop (seit Tag 37), nicht die Äußern/Reflexions-Säule. 🔴 Zwei verbindliche Tag-43-Korrekturen: (1) Der „erste autonome Reflexions-Einwurf im Feld" (Tag 43 Forts. 2c) ist eine Fehlzuordnung — die Fires waren proactive-nudge, nicht reflection-nudge. Der Meilenstein „autonomer Reflexions-Einwurf in der Wildbahn" ist unbeliegt (der echte Reflexions-Nudge mit 7d-Cooldown hat im Feld noch nicht beobachtbar gefeuert). (2) Das angegebene Treffsicherheits-Gate war aufgebläht: die vier Fires stammen von EINER Beobachtung (Launch-Fokus/Agentic Web), die der instabile LLM-thema-Dedup-Schlüssel + FOCUS_LOOP_INTERVAL_HOURS=4 (Test-Wert) viermal durchließ. Inhaltlich trafen sie (Markus' Urteil echt), aber als ein wiederholter Befund — nicht vier unabhängige Datenpunkte. Die autonome Treffsicherheit ist noch unbelegt. 🔴 URSACHE: Fokus-Nudge-Dedup hing am frei generierten LLM-thema-String (norm=trim+lowercase) → nie stabil → kein Dedup; flankiert vom Test-Wert INTERVAL=4h. **Fix (zwei Commits, reine Config/Runtime):** FOCUS_LOOP_INTERVAL_HOURS 4→24 (Config) + 48h-Zeit-Cooldown-Boden (`FOCUS_NUDGE_COOLDOWN_HOURS`, 6c8ff04) + Cosine-Dedup als zweite Bremse (fe3af53). Embedding-Schwelle allein trennt „gleiche Episode" nicht sauber von „anderes Thema" (e5-q8 staucht kurze dt. Phrasen, Bänder 0.83–0.97 überlappen) → Zeit-Cooldown ist der robuste Boden, Cosine Beiwerk. 🔴 METHODIK-LEHRE: bei „welcher Mechanismus feuert" zuerst das Audit-Objekt prüfen (capability + input.anlass), nicht von der plausiblen Erscheinung ausgehen — die Telegram-Nachrichten sahen nach Reflexion aus, waren aber Fokus. Erst der audit.data-Blick klärte es.

**Tag 44 (Forts. 2) — Tenant-Isolations-Audit (Distribution D4/Etappe 0) + kritischer Legacy-Leak geschlossen.** Distribution-Einstieg über den ausstehenden Tenant-Isolations-Audit. Befund read-only: die neue `/twins/:handle/*`-API lückenlos owner-scoped (`requireOwner` auf allen Pfaden, IDOR-Checks auf `:auditId`/`:trustId`), alle Tenant-Tabellen `twin_id`/`owner_user_id`-gescoped. 🔴 EIN kritischer Fund: `registerLegacyAliases` exponierte 7 Routen (`/twin-profile`, `/chat`, `/audit`, `/audit/pending`, `/audit/:id/approve|reject`, `/stream`) ohne jede Auth, hardcoded auf `@markus` — `curl` ohne Login → 200 (Daten-Leak + IDOR auf approve/reject). Prod-verifiziert toter Code (UI nutzt ausschließlich `/twins/:handle/*`). Fix: ersatzlos entfernt (6904217, −130 Zeilen). Prod-Deploy (runtime-only): curl 200→404, neue API→401, Container gesund. Genau der Audit-Zweck: die im Single-User-Betrieb unsichtbare Lücke VOR breiterem Zugang finden. 🟡 Rest-Befunde (kein Sofort-Druck): #2 `GET /onboarding/check-handle` Handle-Enumeration ohne Auth (Existenz-Leak, #59-Muster) → hinter Login ODER by-design dokumentieren; #3 `GET /health` gibt twins-Zähler zurück (niedrig, kein unmittelbarer Handlungsbedarf). Beide als Backlog notiert.

**Tag 44 (Forts.) — Quiet-Hours-Gate für autonome Nudges gebaut + deployt (365bde1).** Ein Gate in `emitNudge()` (gemeinsamer Kern für Fokus + Reflexion) verwirft autonome Nudges im konfigurierten Zeitfenster — verwerfen, nicht aufstauen (nächster Tick prüft neu). Owner-Antwort-Pfad (CHAT_CAPABILITIES) strukturell getrennt, nicht betroffen. Lokale Zeit via `Intl.DateTimeFormat` (kein systemweites TZ-Env, kein `getHours()`=UTC). Über-Mitternacht-Fenster korrekt (START=22, END=8 → 22/23/0–7 quiet, 8+ feuert). Cooldown-Cursor rückt bei verworfenem Nudge NICHT vor (kein Phantom-Cooldown). Opt-in, default AUS: Feature greift nur wenn `QUIET_HOURS_START` + `QUIET_HOURS_END` (0–23) gesetzt; `QUIET_HOURS_TZ` optional (Default `Europe/Berlin`). Bewusst NICHT aktiviert — 48h-Cooldown deckelt bereits; Quiet-Hours ist zweite Linie für den Fall, dass ein erlaubter Nudge nachts fällt. Beobachten, dann gezielt schalten.

## Tag 43 (10. Juni 2026) — 🎯 Facts-Kohärenz-Review (#94 neu zugeschnitten) gebaut, deployt, Prod-bewiesen

**Ausgangsfrage:** „Haben wir Twin-Löschen nicht schon gebaut? Und was ist mit der Dream-Schicht?" — beides am echten Stand geprüft statt aus dem Gedächtnis. Twin-Löschen IST gebaut (Tag 36, #744: DELETE /twins/:handle + Cascade + ConfirmDeleteTwinModal); offen nur zwei kleine Reste (Browser-Durchklick, Bridge-Orphan-Cleanup). Dream (#94) war NICHT gebaut, mehrfach als daten-blockiert dokumentiert (8 Facts/0 Summaries).

**#94 neu vermessen — die alte Blockade ist gefallen, aber das Pattern hat sich verschoben.** Messung @markus Prod: 43 Facts (war 8), 2 Summaries (war 0) — Mengen-Blockade gefallen. ABER: jeder fact_key nur 1× (keine Duplikate) → der ursprüngliche #94-Dedup-Kern ist OBSOLET, weil die facts-Tabelle UNIQUE(twin_id,fact_key) hat (Duplikate strukturell unmöglich, #97-upsert). 🔴 Verbleibender ECHTER Kern mit GEMESSENEM Schaden: semantische Widersprüche + Veraltetes ÜBER fact_keys hinweg — die das UNIQUE-Schema NICHT fängt. Belege: wife_name='Anna' (30d, source user) widersprach relationship_status='keine Frau, Anna ist nicht seine Frau' (6d); product_concept_tavryn + project_codename (Tavryn verworfen) widersprachen product_name_final='Nolmi'. Diese Lücke deckt weder semantic-fact-write (extrahiert nur neue Keys) noch reflection-owner (schreibt keine Facts) noch UNIQUE ab.

**#94 neu zugeschnitten als Facts-Kohärenz-Review (docs/FACTS-KOHAERENZ-REVIEW-STRATEGY.md, e0ffa20).** Der Twin liest seinen approved-facts-Store, findet Widersprüche/Veraltetes, schlägt Korrektur(update)/Löschung(delete) als PENDING vor; Markus approved/rejected; KEIN autonomes Aufräumen (Vision-Grenze Z.147). Diagnose-Kernbefund: die bestehende Pending-Fact-Mechanik (semantic-fact-write) hat die FALSCHE Form (pre-write + confidence-flip, nur neue Keys) → der Review braucht eine neue „apply-on-approve"-Mechanik (Vorschlag lässt Fact unberührt, erst Approve führt upsert/delete aus). Gebaut+deployt: SS1 (a5ed1ab, apply-on-approve: Capability fact-coherence-fix + Approve-Handler führt upsert/delete aus, B4-Robustheit: stale update auf Ghost-Key legt NICHT neu an, applied:false), SS2 (8f11764, eigene facts/coherence-engine.ts — Generator liest approved Facts + jüngste Summaries als Aktualitäts-Kontext, RAW-konservativ-Prompt, generate-only + Pending-Pfad, defensiver isValidProposal-Filter), SS3 (54b0cb3, twin:facts-review CLI + Guards: Dedup gegen offene Pendings + Rejected-Gedächtnis + Within-Batch-Dedup, Guards in reviewAndCreatePending → greifen auch im späteren Loop). 🎯 PROD-BEWEIS (twin:facts-review @markus): der echte Opus fand ALLE drei gemessenen Schäden (product_concept_tavryn→delete, project_codename→delete, wife_name→delete) UND einen vierten unerwarteten (favorite_breakfast→update auf das neue Magerquark-Setup, aus dem Summary-Kontext erkannt). 4 Pendings, 0 übersprungen. Nach Markus' Approve verifiziert: 3 Facts gelöscht, favorite_breakfast aktualisiert, facts_history 4 neue Einträge (3 delete + 1 value_change), Facts 43→40, fact-coherence-fix offen=0/erledigt=4. Vision-Grenze gewahrt (nichts autonom geschrieben, jede Änderung ein bewusster Approve). 🔴 Der wife_name-Widerspruch (24 Tage im Bestand) ist behoben.

**NICHT gebaut (bewusst, eigene spätere Stücke):** Loop-Wiring (autonomer periodischer Review — erst nach Treffsicherheits-Beobachtung); bewertende Tiefe; Cross-Fact-Synthese (neue verdichtete Facts).

**Tag 43 (Forts.) — Kohärenz-Review-Loop autonom + Drei-Pattern-Neuvermessung am gewachsenen Korpus.** Nach dem Facts-Kohärenz-Review (CLI, Prod-bewiesen) das Loop-Wiring gebaut+deployt (1b36837): dritter Pfad coherenceReviewForTwin in runTick (nach self+owner), eigener Cursor lastCoherenceReviewTs (capability='fact-coherence-fix'), eigener Cooldown DEFAULT_COHERENCE_REVIEW_COOLDOWN_HOURS=168 (env REFLECTION_COHERENCE_COOLDOWN_HOURS). 🔴 Genuin neuer Substanz-Check: MAX(facts.updated_at) > Cursor (NICHT hasNewSubstanceSince — das misst Gesprächs-Korpus + facts.created_at, verfehlt Wert-Änderungen). Effizienz-Guard (offenes fact-coherence-fix-Pending → Review ganz skippen). KEIN neues Gate (Inbox-Pending = sichere Stufe, REFLECTION_LOOP_ENABLED genügt), keine Migration. Container nach Deploy gesund (running, restarts 0). Damit ist der Kohärenz-Review autonom: läuft ~7d-getaktet, nur bei Fact-Änderung + leerer Inbox. Die Pflegen-Säule ist komplett.

**Drei-Pattern-Neuvermessung (read-only, ergebnisoffen — wie #94 gestern):** Nach #94-Erfolg geprüft, ob am gewachsenen Korpus eines der drei daten-blockierten Vision-Patterns „aufgetaut" ist. Befund: alle drei bleiben blockiert, aber mit WICHTIGER Unterscheidung. 🔴 **Lebens-Narrativ (A) — einziges mit internem Freischalt-Hebel.** twin_diary @markus: 2 Einträge, davon nur 1 echtes (A)-Substrat (Twin über sich selbst: „ich schiebe nach jeder Aussage strukturierte Listen nach"); der zweite ist eine owner-Beobachtung (über Markus, kein Selbst-Bogen). Faktisch 1 self-Datenpunkt → nicht baubar (ein Punkt ist kein Bogen). ABER: beide Einträge autonom durch den (gestern scharfen) Reflexions-Loop entstanden → der Hebel GREIFT, das Diary wächst von selbst. Lebens-Narrativ (A) reift allein durch Zeit, ohne Nutzungsänderung. 🟡 NOTIZ für späteren (A)-Bau: der Generator muss nach Subjekt/triggered_by filtern (nur self-Einträge in den Selbst-Bogen), sonst vermischt er „Twin über sich" mit „Twin über Markus" — im Diary liegen beide. **Gewohnheiten — weiter blockiert (Datenquelle misst Falsches):** 94 Telegram-Msgs/17 Konv über 1 Monat = Build-Aktivität an Nolmi, kein gelebter Alltag; Menge ändert das nicht, nur andere (nicht-Build-)Nutzung. **Werte-Drift — weiter blockiert (kein werthaltiger Drift):** facts_history 6 Einträge (3 delete-Bereinigung heute + 3 value_change), aber die value_change sind Sachkorrekturen (business_partner 2x, favorite_breakfast 1x), KEINE Werte-/Überzeugungs-Verschiebung. 🔴 STRATEGISCHE ERKENNTNIS: Von den offenen Vision-Patterns hängen Gewohnheiten+Werte-Drift an Markus' gelebtem Leben (externe Daten, nur durch andere Nutzung) — Lebens-Narrativ (A) als einziges am autonom wachsenden Diary (interner Hebel, läuft). Wiederaufnahme-Trigger: (A) = Diary-Tiefe über Wochen (Re-Messung in ~2-4 Wochen sinnvoll); Gewohnheiten/Werte-Drift = echte Nicht-Build-Nutzung über Zeit.

**Tag 43 (Forts. 2) — Bridge-Orphan-Cleanup (#744-Rest) deployt + Prod-bewiesen; Festhängen-Anlass korrigiert. 🔴 TAG-44-KORREKTUR: „erster autonomer Reflexions-Einwurf im Feld" war Fehlzuordnung — tatsächlich Fokus-Nudge (proactive-nudge/anlass=fokus).** (a) #744-Rest geschlossen: admin-autorisierter Deregister-Pfad, weil beim Orphan genau das per-twin-Token fehlt. Neue Bridge-Route DELETE /admin/twins/:handle hinter requireAdmin (BRIDGE_ADMIN_TOKEN opt-in, timing-safe, default AUS→503, idempotent) + Runtime-CLI twin:bridge-deregister (9c4ec4b/4117702). Diagnose-Kern: Bridge ist zustandsloser Handle+Token-Router ohne Runtime-Rückbezug → kann Waisen nicht selbst erkennen; bindender Constraint war Autorisierung, nicht Erkennung → targeted statt reconcile. Deploy: erste Bridge-Code-Änderung seit Langem, Bridge+Runtime-Image neu gebaut, web/A2A unberührt, Boot-Log 'Admin-Cleanup-Endpoint: aktiv'. Prod-Beweis @deploytest_orphan: 201→409→401(falsches Token, Row blieb)→deregistriert→201(Block gelöst). Hash-Vergleich .env==Container bestätigte Whitelist sauber. Stufe 6: Bestand bereinigt — Bridge-Boot meldete registeredTwins:4 bei drei echten Twins; der untracked Orphan @test_twin (registriert 2026-06-02, aus einem Anfang-Juni-Test) via twin:bridge-deregister abgeräumt → registeredTwins:3. Bridge steht sauber bei @markus/@florian/@heiko. (b) SS3: reflection-loop Boot-Label auf 'self + owner + coherence' korrigiert (0d0b02f). (c) 🔴 KORREKTUR einer verbindlichen Setzung: Der 'Festhängen/stuck'-Anlass wurde Tag 42 als systematischer Miss für Markus' Muster abgeschrieben — gemessen am THEME-SNAPSHOT-Korpus. Am ERSCHLOSSENEN Korpus (#161) traf er: Telegram ~14:59, Loop-getickt, gepusht, spannte über fünf Fronten (Nolmi, Website-Relaunch, Checker, Commerce-MVP, Simulation-Tool) und rahmte echte Fokus-Streuung — Markus' Urteil: 'trifft inhaltlich ziemlich gut'. 🔴 TAG-44-KORREKTUR: Diese Fires (14:59, 21:47, 01:47, 05:47) waren NICHT reflection-nudge, sondern proactive-nudge/anlass=fokus — Prod-Audit-Verifikation Tag 44 bestätigt (capability='proactive-nudge', input.anlass='fokus'). Es war der Fokus-Loop (seit Tag 37), nicht die Äußern/Reflexions-Säule. Der Meilenstein 'erster autonomer Reflexions-Einwurf im Feld' ist eine Fehlzuordnung. (d) 🔴 TAG-44-KORREKTUR: Die vier Fires sind NICHT vier unabhängige Treffsicherheits-Datenpunkte, sondern EINE Beobachtung (Launch-Fokus/Agentic Web), die der instabile LLM-thema-Dedup-Schlüssel + FOCUS_LOOP_INTERVAL_HOURS=4 (Test-Wert) viermal durchließ. Inhaltlich trafen sie (Markus' Urteil echt), aber als ein wiederholter Befund — kein kalibrierungstauglicher Datenpunkt. Treffsicherheits-Gate für den echten Reflexions-Nudge (7d-Cooldown) ist unbeliegt — hat im Feld noch nicht beobachtbar gefeuert. Fix: Tag 44 (6c8ff04/fe3af53).

**Tag 43 (Forts. 3) — Reconcile-Sweep (Folge zu #744-Rest) gebaut, deployt, Prod-Dry-run sauber.** Nach dem targeted Bridge-Orphan-Cleanup die optionale Folge: ein Sweep, der ALLE Waisen findet statt einzeln benannte. Diagnose-Kern: Bridge bleibt zustandslos (kann Waisen nicht selbst erkennen) → Runtime-getriebener Diff. 🔴 Die scharfe Kante war die Live-Quelle: registry.list() ⊆ twin_profiles(activeOnly) ⊆ twin_profiles(alle) — nur die UNFILTERTE twin_profiles-Menge ist konservativ-sicher (ein nicht-in-Registry-geladener oder via setActive(false) deaktivierter, aber existierender Twin ist lebend; nur der #744-Hard-Delete entfernt die Row wirklich). Die engeren Quellen würden lebende Twins als Waisen löschen. Gebaut: GET /admin/twins (face451, requireAdmin wiederverwendet, Body ohne api_token) + twin:bridge-reconcile (9f1b614) mit drei nicht-verhandelbaren Guards — Dry-run-Default, Sanity-Floor (leeres Live-Set → Abbruch gegen Massenlöschung bei DB-Read-Fehler), konservative Quelle + Doppel-Prüfung. Bewusst KEIN Loop/Autosend: ein destruktiver Multi-Handle-Sweep bleibt Hand-Werkzeug, kein autonomes Risiko. Lokal verifiziert (Dry-run listet, --apply löscht nur Waise, lebende unberührt, Sanity-Floor bricht ab). Deploy (Bridge+Runtime neu gebaut, A2A nach Recreate intakt). 🎯 Prod-Dry-run gegen die heute schon bereinigte Bridge: Live-Set 3 (@markus/@florian/@heiko), Bridge 3, 0 Waisen, deckungsgleich — kein --apply nötig. Das ist der richtige Beweis: der Sweep schweigt korrekt bei sauberem Stand und fasst die echten Twins nicht an. Sein Wert liegt im künftigen Fall angesammelter Test-Waisen. Damit ist der Bridge-Orphan-Komplex (targeted + sweep) vollständig.

## Tag 42 (9. Juni 2026, Dienstag)

**Tag 42 — #160 leere Konv aufräumen: gebaut, deployt, Prod-verifiziert.** Diagnose: Leere „(kein Inhalt)"-Konv entstehen an ZWEI End-Punkten, wenn eine leere aktive aus dem Aktiv-Status genommen wird — start()-End-all (Continue + jeder start()-Caller) und resetConversation→end() (Reset + autonomer G2/Fokus-Loop). „leer" = 0 Audit-Turns (→ 0 summaries/embeddings, cascade-frei). Lösung (Variante A, tiefe Stellen, dcf8a10): dedizierter Repo-Helper deleteIfEmpty(convId) (löscht conversations-Row nur bei 0 Turns + defensiv 0 summaries, self-contained this.db, KEIN Cascade — deleteConversation #53 NICHT wiederverwendet wegen deps-Kopplung); eingebaut an start()-End-all (pro abgehender aktive: leer→DELETE sonst→ended, in der tx, Invariante gewahrt) + resetConversation-Guard (leer→deleteIfEmpty+return, sonst normaler Verdichten+Enden-Pfad). 🔴 C6: nur die ABGEHENDE Konv wird gelöscht, nie die lebende eingehende aktive. Lokal: start()-Invariante grün (leerer Vorgänger weg, nicht-leerer ended+Turns intakt, COUNT(active)==1). 🔴 Prod-Verifikation resetConversation-Pfad: zwei „Neu starten" hintereinander ohne Schreiben → conversations +1 (nicht +2), LEERE Konv=1 (nur die neue aktive, KEINE leere ended-Leiche) → die leere abgehende wurde beim Übergang hart gelöscht. Reset/G2-Zweig damit direkt belegt. #160 komplett, keine neuen Leichen mehr.

**Tag 42 (Forts.) — Wow-Strang 1 (proaktiver Einwurf): Infra komplett gebaut + deployt, Anlass-Grenze erkannt.** Ziel: der Twin wirft autonom ein (Vision-Kriterium 3+5). Diagnose-Kette: (1) Apparat zahnlos = 0 proactive-nudge-Audits je, weil detectStuck nie feuert (Schwelle 3 themen-gleiche Snapshots, 24h-Loop). (2) detectStuck verglich Themen exakt (norm=trim+lowercase) → reale variabel formulierte Themen ("Agent Readiness Framework" vs "...als HARWAY-Produktfeld") matchen nie → semantische Lösung via Theme-Embeddings. GEBAUT + deployt + Prod-verifiziert: Schwelle 3→2 (495cd4c), twin:focus-tick mit botRegistry für Telegram-Push, PROACTIVE_NUDGE_AUTOSEND_ENABLED + FOCUS_LOOP_INTERVAL_HOURS=4 (VPS .env). Theme-Similarity SS1 (b25d9db, Migration 032 theme_embeddings_blob + embed-on-create in deriveFocus via lokalem Provider, 1024-dim Prod-bewiesen) · SS2 (44bfbb2, detectStuck Cosine-Rewrite ≥0.85, norm-Fallback) · SS3 (0367b05, Backfill-CLI, 5 @markus-Snapshots gebackfillt). 🎯 RESULTAT: detectStuck feuert jetzt mechanisch (erkannte Stuck am Thema "Nolmi/AI-Twin" über 8.6./9.6.-Snapshots — semantische Überlappung greift, vorher not-stuck). ABER: LLM-shouldNudge declined ('twin-declined') — zu Recht: ein produktives Kernprojekt-Dauerthema ist kein "Festhängen". 🔴 ERKENNTNIS (verbindlich für den nächsten Schritt): Der Anlass "stuck/Festhängen" trifft Markus' Nutzungsmuster systematisch nicht (er arbeitet fokussiert, ist nicht blockiert). Der Wow braucht einen anderen Anlass. Geprüft: (a) Anlass "Muster/Verbindung" via Theme-Embeddings (mittlere Cosine) findet nur OFFENSICHTLICHE Nachbarschaften (alles ist Nolmi/Agents) → kein Wow, würde detectStucks Schicksal wiederholen. (b) Der durchdachte Muster-Anlass existiert bereits als STUFE-3-MUSTER-NUDGE-STRATEGY.md (Quer-Muster über Wochen aus VERDICHTETEN Episoden, nicht Theme-Snapshots) — aber datenblockiert (braucht G2-Substanz/Episoden-Tiefe, die noch nicht da ist). FAZIT: Infra steht + ist scharf (Theme-Embeddings, Push-Pfad, LLM-Filter, Notbremse), wartet auf das richtige Signal. Weiterbauen (Theme-Muster ODER Stufe 3) läuft jetzt gegen eine Daten-/Konzept-Grenze. Theme-Embedding-Infra ist eigenständig wertvoll (wiederverwendbar für Strang 2 Dream-Einsichten).

**Tag 42 (Forts. 2) — Wurzel-Befund: Verdichtungs-Loch für unter-Schwelle beendete Konversationen.** Nach dem Wow-Infra-Abschluss die Anlass-Frage weiterverfolgt (Anlass 3, #94 Dream-Pattern, reflection-owner) — durchgehend derselbe bindende Constraint: nicht Code, sondern Korpus-/Längs-Datentiefe. Bei der Korpus-Messung auf Prod der eigentliche Befund: @markus hat 41 approved Facts (gewachsen), aber nur 2 conversation_summaries bei 16 beendeten Konversationen. Ursache-Diagnose (read-only): 🔴 conv_5W09i-eXW2d (Direct-Chat @markus-self, ended seit 8.6., 26 owner-direct-Turns + 17 fact-writes) ist embedding_status=pending, hat 0 Summaries UND 0 conversation-Embeddings — sie ist durch ALLE DREI Verdichtungs-Netze gefallen: (a) kein Summary-Segment (26 Turns < Summary-Schwelle ~40-50), (b) der Whole-Conv-Embed (den die Tail-Flush-Strategie Tag 40 für 0-Segment-Konv vorsah) lief NICHT (status weiter pending), (c) die Tail-Flush-Selektion (twin-service.ts flushPendingConversationTails) überspringt sie via `if conversationSummaries.count(conv.id)===0 continue` — sie wird nie Tail-Flush-Kandidat. 🔴 KERN-ERKENNTNIS: Substanzielle, aber UNTER der Summary-Schwelle beendete Konversationen (10-40 Turns) werden weder summarisiert noch embedded → im Memory-Retrieval UNSICHTBAR. Bei Markus' Nutzungsmuster (viele mittellange Gespräche, 95% Telegram, selten 50+ Turns, nie neue Konv gestartet) trifft das vermutlich VIELE Konversationen. Das erklärt die Wow-Dünne tiefer: nicht „zu wenig gelebt", sondern das Gelebte landet nicht im verdichteten/embeddeten Korpus. Tag-40-Strategie-Annahme (Zeile 27: „0-Segment-Konv laufen korrekt über summaries===0-Whole-Embed") stimmt für conv_5W09 nicht. 🔴 OFFENE FRAGE für Folge-Diagnose: WARUM lief der Whole-Conv-Embed bei conv_5W09 nicht (pending)? Zwei Hypothesen: (i) Whole-Embed triggert nur beim status=ended-Übergang + conv_5W09 endete auf einem Weg, der ihn nicht auslöste; (ii) Whole-Embed hat eigene Bedingung, die hier nicht griff. — Backup twin.db.bak-pre-tailflush liegt (kein Schreibvorgang erfolgt, reine Diagnose). Nichts geflusht/geändert.

**Tag 42 (Forts. 3) — #161 Verdichtungs-Loch geschlossen (Code + Backfill, Prod-verifiziert).** Wurzel-Diagnose: conv_5W09 endete über die start()-Invariante (repo.ts:121-128, raw UPDATE status='ended' OHNE Embed → pending), und der einzige Whole-Embed-Verarbeiter für 0-Segment-Konv (embedAll) ist manuell — kein Loop griff sie auf. Zwei Halb-Löcher (Beenden ohne Embed + kein autonomer Verarbeiter). Fix (bbfb156, runtime-only): der count===0-Skip in flushPendingConversationTails (twin-service.ts) ist jetzt ein Whole-Embed-Zweig — 0-Segment-ended-pending-Konv MIT Inhalt werden whole-embedded (Rezept 1:1 aus resetConversation: aggregateConversationForEmbedding → embedConversation), eigener wholeEmbedded-Zähler, Batch-Limit über beide Pfade, "MIT Inhalt"-Guard (leere 0-Turn-Konv werden NICHT embedded), unter demselben TAIL_FLUSH_AUTONOMOUS_ENABLED-Gate. start()-Invariante bewusst unberührt (DB-Schicht, kein async Embed in der tx). 🎯 Prod-verifiziert: Backfill via twin:memory-embed-all @markus → conv_5W09 (26 Turns) + conv_wRUgwuz5 whole-embedded (local-multilingual-e5-large-q8), conversation-Embeddings 10→12, conv_5W09 pending→done, @markus ended+pending 2→0. Wiederkehr-Schutz: künftige 0-Segment-Konv werden im Fokus-Loop-Tick automatisch whole-embedded. Backups twin.db.bak-pre-tailflush + .bak-pre-161 liegen. 🔴 ERKENNTNIS: Das war die tiefere Wurzel der "Wow-Dünne" — gelebtes Korpus blieb unsichtbar, nicht weil zu wenig gelebt, sondern weil unter-Schwelle beendete Konv durch alle Verdichtungs-Netze fielen. Jetzt erschlossen. Nächster offener Faden: twin:reflect 'owner' auf dem jetzt vollständigeren Korpus testen (ist Einsicht erreichbar?).

**Tag 42 (Forts. 4) — 🎯 Wow-Strang 2 (proaktiver Reflexions-Einwurf) gebaut, deployt, SCHARF, Prod-bewiesen: der Twin hat den ersten echten Wow-Einwurf auf Markus' Telegram gepusht.** Nach #161 (Korpus erschlossen) wurde reflection-owner als proaktiver Telegram-Einwurf gebaut (docs/REFLEXIONS-EINWURF-STRATEGY.md): der Twin äußert eine Beobachtung über Markus an dessen Telegram — ÄUSSERN (status=sent) ohne SPEICHERN (approveSelfReflectionWrite nie gerufen, kein Diary), Vision-Grenze Z.147 strukturell gewahrt. Gebaut+deployt: SS1 (efbd523, worthNudging-Gate + generate-only-Pfad), SS2 (59697ae, reflection-nudge-Capability + emitReflectionNudge, emitNudge parametrisiert, Fokus-Pfad byte-identisch, Gate REFLECTION_NUDGE_AUTOSEND_ENABLED), Test-CLI twin:reflect-nudge (04a21af), SS3 (a4a282d, owner-Push im Reflexions-Loop: ownerNudgeForTwin, eigener Cursor lastOwnerNudgeTs auf capability='reflection-nudge', Guard A open-pending + Episode-Cooldown 7d + Guard B neue Substanz). 🎯 PROD-BEWEIS (reflect-nudge @markus, Autosend scharf): zwei Läufe, zwei korrekte Urteile. Lauf 1: worthNudging=FALSE bei der "Strategie↔Umsetzung"-Beobachtung (klug: "wahr, aber für Markus nicht überraschend — Selbstbestätigung"). Lauf 2 (nach Whitelist-Fix): worthNudging=TRUE bei einer TIEFEREN Meta-Beobachtung ("der Twin ist für Markus weniger Ideengeber als externes Arbeitsgedächtnis/Prüfschicht; er baut sich genau das Werkzeug, das er selbst am intensivsten nutzt — Dogfooding, passt zum Nolmi-Kernsatz 'Präsent bleiben ohne ständig verfügbar zu sein'") → autonom auf Telegram gepusht (audit_fa_qmr0EKsUB, status=sent, pushed=true), KEIN Diary (Vision-Grenze verifiziert). Das Gate unterscheidet nachweislich zwischen banal (false) und echter nicht-offensichtlicher Meta-Einsicht (true). Aktivierungs-Status: REFLECTION_LOOP_ENABLED + REFLECTION_NUDGE_AUTOSEND_ENABLED beide scharf (Markus' Entscheidung "mutig an" — worthNudging-Gate + 7d-Cooldown als Schutz). Der autonome Reflexions-Loop pusht ab jetzt alle 24h bei neuer Substanz + abgelaufenem Cooldown + worthNudging=true einen Einwurf an Markus' Telegram. 🟡 OFFEN (kosmetisch): Boot-Log "[reflection-loop] started (self-mode)" veraltet (macht jetzt self+owner; reflection-loop-service.ts:128). 🔴 META-ERKENNTNIS: Der Wow ist gebaut, urteilsfähig UND bewiesen — er trifft die überraschende Meta-Beobachtung, wenn er die richtige Ebene wählt, und schweigt bei der banalen. Der bindende Constraint bleibt Korpus-Tiefe/-Breite (mehr Substanz → mehr/tiefere Wow-Momente), aber die Maschine funktioniert end-to-end.

## Tag 41 (8. Juni 2026, Montag)

**Autonomer Loop tickt in der Bauphase nie — Timer-Reset durch häufige Deploys (Diagnose + manueller Tick-Trigger gebaut).** Morgen-Check des ersten autonomen Tail-Flush-Ticks zeigte: kein Tick gelaufen, embeddings unverändert 13, ended+pending=0. Ursache-Diagnose: jeder --force-recreate setzt den 24h-Loop-Timer zurück (Container-Laufzeit < 24h) → seit den häufigen Tag-39/40-Deploys lief der Fokus-Loop kein einziges Mal autonom (jüngster focus_snapshot war 04.06.). 🔴 Wichtige Konsequenz: „Loop scharfgeschaltet" (Tail-Flush Tag 40) und „Loop läuft autonom" sind zwei verschiedene Dinge — in einer aktiven Deploy-Phase kommt der autonome Pfad faktisch nie zum Zug. Kein Bug, sondern Timer-Semantik.

**Lösung: CLI twin:focus-tick (b58be08)** — löst EINEN vollständigen runTick() on-demand aus (G2 → Tail-Flush → Fokus → Nudge Anlass1 → Anlass3), bitgenau wie der autonome Tick (Gates gelten, trigger='autonomous', keine botRegistry → Nudges=Pending), mit Live-Logs (additiver runTick(loggerOverride?)) + DB-Delta-Messung vorher/nachher. Macht den autonomen Apparat in der Bauphase prüfbar, ohne 24h-Timer und ohne Timer-Semantik zu ändern.

**Erster echter Tick (Prod, 3 Twins) — autonomer Apparat verifiziert korrekt:** @markus: neuer Fokus-Snapshot focus_fgjfmFYr1wX2u-mx (aus 2 Summaries + 26 Turns, erster seit 04.06.) → focus_snapshots 3→4; Anlass 1 'not-stuck' (frischer Snapshot bringt neue Themen, keine monothematische Kette — korrekt: kein Festhängen); Anlass 3 'no-open-question' (keine offene Twin-Frage der letzten 72h). @florian/@heiko: 'zu wenig Substanz' → kein Snapshot (korrekt, Test-Twins ohne Konv-Substanz). G2 + Tail-Flush: nichts zu tun (active=1/ended=14 unverändert, embeddings 13→13 — aktive Konv nicht >24h idle, keine pending Tails). **Damit die zwei offenen Vierfach-Check-Punkte beantwortet:** Anlass-1-Kandidat + Anlass-3-Pending feuern korrekt NICHT (kein Festhängen, keine offene Frage) — keine hängenden Schulden, sondern korrektes Verhalten bei aktueller Datenlage.

**Meta-Erkenntnis:** Der eigentliche Wert lag nicht im Vierfach-Check selbst, sondern in der Loop-Timer-Diagnose + dem on-demand-Trigger. Mehrere geratene Schema-Namen (themes→themes_json, diary_entries existiert nicht) bestätigten erneut: Spaltennamen lesen, nicht raten.

**Tag 41 (Forts.) — #53 Konv-Löschen (SS1+SS2) gebaut, deployt, auf Prod verifiziert.** Strategie docs/KONV-LOESCHEN-ARCHIVIEREN-STRATEGY.md (30019f1): zwei Achsen — Löschen=endgültiges Vergessen (Row+Audits+Summaries+Embeddings weg), Archiv=reine UI-Sichtbarkeit (kein Memory-Entzug); 4 Sub-Steps, Löschen zuerst. SS1 Backend (7b99ebd): ConversationsRepo.deleteConversation — Cascade in 1 tx (Summary-IDs ZUERST enumerieren → deleteByTarget je summary_segment+conversation für embeddings/vec/fts atomar → conversation_summaries → audit hart → conv-row), owner-gegatete DELETE-Route + IDOR. SS2 Frontend (15d0b45): Lösch-Aktion pro ended-Eintrag in History-Panel + ReadView-Kopf (NICHT bei aktiver Konv → laufender Chat geschützt), Confirm-Dialog mit Memory-Hinweis-Wortlaut. Deploy web+runtime (Build-Args+Bundle-Grep grün, rollback-b58be08). 🔴 Prod-Verifikation: Tool-Test-Konv gelöscht → conversations 15→14, embeddings 13→12 (conversation 10→9), Waisen-Check 0/0 (keine verwaisten audit-Turns/summaries) → Cascade auf echten Daten vollständig, kein Memory-Müll. Löschen-Teil komplett. OFFEN: SS3 Archiv-Backend (Migration archived_at + Filter), SS4 Archiv-Frontend.

**Tag 41 (Forts. 2) — #53 komplett: Archivieren (SS3+SS4) gebaut, deployt, auf Prod verifiziert.** SS3 Backend (36f989a): Migration 030_conversations_archived_at (additive ALTER, idempotent, läuft automatisch beim Boot via init-db) + archive()/unarchive()-Routen (owner-gegatet, IDOR) + Archiv-Filter. 🔴 Scope-Befund: listEndedByTwin speist AUCH die Memory-Maintenance (Re-Embed) → NICHT im Repo gefiltert, sondern am Sidebar-Consumer; sonst hätte der Filter archivierte Konv vom Re-Embedding ausgeschlossen (verletzt „Archiv ≠ Memory-Entzug"). SS4 Frontend (23e6400): Verlauf⇄Archiv-Tabs + archivieren/wiederherstellen pro ended-Eintrag (kein Confirm, reversibel) + löschen auch im Archiv; Farb-Trennung (löschen warn-rot, archivieren neutral-accent), aktive Konv nie archivierbar. Deploy web+runtime mit Migration (DB-Backup twin.db.bak-pre-030, Boot-Log „030 angewendet"/„29 skipped", archived_at-Spalte verifiziert, rollback-15d0b45). 🔴 Prod-Verifikation beider Achsen: Löschen → conversations 15→14, embeddings 13→12, Waisen 0/0 (Memory weg); Archivieren → archiviert=1, embeddings UNVERÄNDERT 12 (Memory bleibt). Damit #53 komplett (SS1 Löschen-BE · SS2 Löschen-FE · SS3 Archiv-BE · SS4 Archiv-FE), die Kern-Unterscheidung Archiv=Sichtbarkeit / Löschen=Vergessen auf echten Daten bewiesen.

**Tag 41 (Forts. 3) — Direct-Chat-Fortsetzen v2 komplett: gebaut, deployt, Prod-verifiziert.** Diagnose verwarf echtes Reaktivieren (alte Konv wird aktiv): die „höchstens eine aktive Konv pro Tripel"-Invariante lebt nur prozedural in start() (repo.ts:101, KEIN DB-Constraint) → naives UPDATE status='active' erzeugt zwei aktive → stille Korruption; echtes Reaktivieren erzwingt M+-Umbau (Loader+lastResetAt+ResetMarker). Stattdessen v2 = „Fortsetzen": neue Konv via start() mit Summary-Snapshot der alten als unsichtbarem Seed-Kontext (Strategie docs/DIRECT-CHAT-FORTSETZEN-STRATEGY.md, 47445b4). SS1 Backend (b006bd5): Migration 031 (continued_from_conversation_id + seed_context, additiv) + startContinuation (nutzt start() → Invariante exakt gewahrt) + Seed-Snapshot aus summary_segments (Text-Kopie, robust gegen Löschen der Ur-Konv) + buildSeedBlock in history-loader (additiv, loadConversationHistory unverändert) + continue-Route (owner-gegatet, IDOR); seedContext server-intern, nur continuedFromConversationId exponiert. SS2 Frontend (0799b66): „fortsetzen"-Knopf im ReadView (ended-only) + „↩ fortgesetzt aus…"-Marker im Stream-Kopf. Fix (409eb07): startContinuation setzt lastResetAt=now → frischer Stream + Marker sichtbar (war durch Auto-Scroll im Voll-Verlauf weggeschoben). 🔴 Prod-Verifikation: Agent-Readiness-Konv fortgesetzt → Twin gab die 6 Scoring-Kategorien + Positionierung des alten Strangs wieder (Seed greift im LLM-Kontext); nach Fix frischer Stream mit sichtbarem Marker. v2 komplett (SS1 BE · SS2 FE · lastResetAt-Fix). 🟡 Bekannte Nebenwirkung (Backlog): „Fortsetzen" ohne anschließende Nachricht hinterlässt eine leere „(kein Inhalt)"-Konv im Verlauf; per #53-Löschen wegräumbar (ended), aktive löst sich beim nächsten Reset. 🔴 DEPLOY-LEKTION: Commits die apps/runtime berühren NICHT als feat(web) labeln — verleitet zu web-only-Deploy; der Deploy muss runtime bauen, wenn apps/runtime im Diff ist. Damit ist die Direct-Chat-Historie-Reihe rund: v1 lesen (Tag 40) → v2 fortsetzen (Tag 41).

## Tag 40 (7. Juni 2026, Sonntag) — Verdichtungs-Tiefendiagnose + Tail-Flush-Verarbeiter gebaut, deployt, scharf

**Tag 40 (7. Juni) — Verdichtungs-Tiefendiagnose + Tail-Flush-Verarbeiter gebaut, deployt, scharf.** Der erwartete G2-Effekt blieb aus (Embeddings unverändert 12 trotz 14/15 conversations ended) → mehrstufige read-only Diagnose legte die Wurzel frei: substanzielle Konversationen fallen un-verdichtet durch alle Pfade. Befund am Beispiel conv_m4J0tWfr4z (53 Turns, 15 Tage, ended, embedding_status=pending): nur 1 summary_segment (Turns 1–40, via Schwelle 50/Batch 40), der Tail (41–53, jüngster Inhalt) in keinem Embedding. Wurzel = L3: die Annahme „segCount>0 ⇒ Inhalt abgedeckt" ist falsch — Segmente decken den unsummarisierten Tail nicht ab. resetConversation übersprang bei summaries>0 den Whole-Embed; G2 ist active-only (sieht beendete Konv nicht); kein automatischer pending-Verarbeiter; ein Whole-Conv-Embed wäre kein Ausweg (e5-large trunkiert bei ~512 Tokens). L1 (G2 active-only) + L2 (kein Verarbeiter) sind Symptome.

**Hebel + Bau (Strategie docs/TAIL-FLUSH-VERDICHTUNG-STRATEGY.md):** vereinter Tail-Flush-Verarbeiter — beim Konv-Ende / über listPendingByTwin den unsummarisierten Tail final-segmentieren+embedden (schleifenbasiert bis Tail=0, da THRESHOLD 50 > BATCH 40), statt zu überspringen. In 6 sub-step-verifizierten Schritten gebaut: Smoke-Gate-0 (Cursor/Idempotenz read-only belegt) → Primitive (eeb832b) → resetConversation-Hook (35ab18e) → pending-Verarbeiter + context-Gate (1513fbd) → CLI-Wiring (2af44dd) + dry-run-fix tail-aware (fc12d26) → Loop-Schritt (1fe3f6c). Design: EIN context-Gate (TAIL_FLUSH_AUTONOMOUS_ENABLED) deckt alle autonomen Auslöser (G2-Reset + Loop) ab, manuelle Pfade (Web-Reset, CLI) immer; Batch-Limit (Default 5); Idempotenz cursor-garantiert + UNIQUE-Constraint.

**Backfill-Beweis (Prod, @markus):** manueller CLI-Lauf (twin:memory-embed-all @markus, trigger=manual, gate-frei) verdichtete conv_m4J0tWfr4z' Tail → neues summary_segment (13 messages → 205 words) + Embedding, embeddings 12→13, status done, rest-tail 0. 🔴 Qualitativer Beweis: Reverse-Memory-Query „was hat mich bei Agent-Readiness beschäftigt" zog danach den jüngsten Strang-Inhalt (Produkt-Framing/Demo/Trust-by-Design aus dem Tail), den der Twin vorher nicht greifen konnte. Verdichtung macht Substanz nutzbar.

**Deploy + scharf (leicht, keine Migration, kein web).** Alle Sub-Steps deployt (rollback-Tags je Schritt: a59b4af → 2af44dd → fc12d26 → 1fe3f6c). Nach Deploy autonom still (Flag AUS). Dann bewusst scharfgeschaltet: TAIL_FLUSH_AUTONOMOUS_ENABLED=true in VPS-.env (Z.44) + Compose-Passthrough (Z.88, nicht committet — Loop-Steuerungs-Prinzip), Flag im Container=true verifiziert, Backups *.bak-pre-tailflush. **Wirkung:** ab nächstem 24h-Tick verdichtet das System beendete Konv-Tails autonom (Batch-Limit 5). Erster autonomer Tick = Beobachtungspunkt (Tag 41) — der Hauptfall conv_m4J0tWfr4z ist schon manuell done, der Dauerwert ist die automatische Vollverdichtung künftiger langer Konv.

**Rest-Symptom:** „3 Erinnerungen immer gleich" bessert sich erst mit mehr verdichteten Konv (Korpus wächst über den Loop) — ein irrelevanter Treffer (Frühstücks-Präferenz) im Reverse-Query-Test bestätigt den noch kleinen Korpus.

**Tag 40 (Fortsetzung) — #118-Kern: ended-Konversationen in der Sidebar sichtbar gemacht.** Nach dem Tail-Flush-Bogen ein kleines UX-Stück: der Web-Listen-Endpoint (server.ts) filterte beendete Konv weg + hardcodierte status="active"; jetzt liefert er ended-Konv mit echtem status/ended_at/embedding_status, die Sidebar zeigt ein dezentes „beendet"-Badge + „✓ verdichtet" (bei embedding_status=done), aktive zuerst sortiert (518037d). ConversationSchema um embeddingStatus erweitert (shared). 🔴 Scope-Befund: der Endpoint listet A2A-Konv (Direct-Chat läuft über Reset-Marker, partner==self ausgeschlossen). Prod-Messung: alle 15 @markus-Konv sind Direct-Chat (partner=@markus) → es existieren KEINE ended A2A-Konv → das Feature ist korrekt deployt, aber heute ohne sichtbaren Effekt (wartet auf erste beendete A2A-Konv). Web-Deploy (Build-Args + Bundle-Grep grün, runtime.nolmi.ai/keine localhost), beide Container sauber, nichts gebrochen (Florian-A2A-Chat + Direct-Chat laden normal). Rollback-Tags *:rollback-1fe3f6c. OFFEN als eigenes Stück: den Direct-Chat-Lifecycle (Reset-Marker-Pfad) sichtbar machen — das wäre der visuelle Lohn für @markus, ist aber nicht Teil von #118-Kern.

**Tag 40 (Fortsetzung 2) — Direct-Chat-Konversations-Historie gebaut + deployt (M+, 4 Sub-Steps).** Nach #118 (das nur A2A-Konv abdeckte) der eigentliche visuelle Lohn: der Owner kann seine vergangenen Direct-Chat-Konversationen finden + read-only lesen. Diagnose ergab: „Mit meinem Twin" zeigt nur die jüngsten ~50 Audits hinter einem Reset-Toggle — die 53-Turn-Agent-Readiness-Konv war jenseits des Fensters UND hinter Soft-Hide unsichtbar (im Memory nutzbar via Reverse-Query, aber im UI verschwunden). Strategie docs/DIRECT-CHAT-HISTORIE-STRATEGY.md (eeccf76): Verlauf-Button → Konv-Liste (Datum/Snippet/Status) → read-only Konv-View, zweistufiges On-Demand-Laden, kein Reaktivieren v1. Bau: Sub-Step 1 zwei owner-gegatete read-only Routen (Konv-Liste mit Snippet + Konv-Audits-by-id, IDOR-Schutz, eec9f75); Sub-Step 2 Verlauf-Button + Listen-Panel (9c3ac58); Sub-Step 3 read-only Konv-View (buildChatBlocksFromAudits wiederverwendet, ASC/DESC-Fix, McpToolCallBox readOnly-Prop, a616fc1); Sub-Step 4 Deploy (web+runtime, Build-Args + Bundle-Grep grün, rollback-518037d). 🔴 Prod-Beweis: Verlauf zeigt alle 15 Direct-Chat-Konv, die 53-Turn-Konv (04.06.) mit Snippet „## Tavryn → Nolmi: Naming-Wechsel…" aus dem heute-Vormittag-Tail-Flush-Segment — die Verdichtung macht die Liste navigierbar. Klick lädt die Konv vollständig read-only (nicht vom 50-Fenster gekappt — Route 2 liefert alle Audits). Der Bogen Tag 40 geschlossen: die Konv aus dem un-verdichteten Tail ist jetzt im Memory UND im UI erreichbar. OFFEN (v2): Reaktivieren/Fortsetzen alter Konv; A2A-Konv-Historie (#118-Full-Scope); Löschen/Archivieren (#53).

## Tag 39 (6. Juni 2026, Samstag) — Verdichtungs-Blockade entdeckt + G2 (Telegram-Konversations-Lifecycle) gebaut + deployt

**Tag 39 (6. Juni 2026) — Verdichtungs-Blockade entdeckt + G2 (Telegram-Konversations-Lifecycle) gebaut + deployt.** Morgen-Check: nichts über Nacht (kein autonomer Nudge, keine Reflexions-Pendings) — erwartbar (Fokus-Loop erst seit Tag 37, ≥3 aufeinanderfolgende Tage nicht erreicht; focus_snapshots = 3, aber alle vom 04.06.). Markus' Einwand „Nutzung läuft intensiv" widersprach den „daten-blockiert"-Verdikten der letzten Tage → Prod-Memory read-only gemessen (twin_jgqzOIkzdTsTx6vv).

**🔴 Befund: Prod ist reich an Facts, aber verdichtungs-blockiert.** 32 Facts (29 twin-extrahiert, DYNAMISCH: business_idea_agent_readiness, next_action_2025, current_reading, communication_preference_style etc. — nicht nur statische Identität wie Dev mit 11). ABER Längsschnitt dünn: conversation_summaries=1, twin_diary=1 (nur post_extract), embeddings=12 — bei 67 telegram_messages (33 in/34 out) + 15 conversations. Markus' Einwand war berechtigt: die Roh-Substanz IST da, sie wird nur nicht verdichtet.

**🔴 Diagnose der Verdichtungs-Blockade (read-only):** Telegram-Pfad bypasst Post-Processing NICHT (gleiche chat()/runOwnerDirect-Kette, Beweis: 1 Summary existiert). Drei strukturelle Lücken: G1 (Summary-Schwelle 50 zu grob für Kurz-Chat), **G2 (größter Hebel: Telegram hat keinen Konversations-Lifecycle — Episodic-Embed feuert nur bei resetConversation, das NUR die Web-Route auslöst → laufende Telegram-Konv sammeln sich un-embedded; die 12 Embeddings stammen aus Web-Resets, 10× conversation/1× diary/1× summary_segment)**, G3 (Fact-Extraktion nur manuelle Route). Reflexions-Loop NICHT ausgehungert (liest 40 Roh-Audit-Turns + 32 Facts, nicht die dünnen Summaries; self-reflection-write = 1 executed → Loop gesund, 0 weitere = Timing). 🔴 STRATEGISCH: die „daten-blockiert"-Verdikte (Lebens-Narrativ, Gewohnheiten) wurden an dünnen Summaries/Embeddings gemessen, die dünn sind WEGEN G2/G3 — nicht wegen fehlender Nutzung. Roh-Substanz existiert.

**Schritt — G2 gebaut (`d113225`).** ConversationsRepo.listIdleActive(twinId, cutoffIso): aktive Konv mit letzter Aktivität (MAX audit.timestamp, Fallback started_at) älter als Cutoff. FocusLoopService.endIdleConversationsForTwin(twin) am Anfang jedes Fokus-Loop-Ticks (vor focusForTwin/nudgeForTwin, kein Substanz-Guard-Einfluss verifiziert), per-Twin+per-Konv try/catch, ruft unveränderten resetConversation (end+embed). ENV CONVERSATION_IDLE_HOURS Default 24, ENV-justierbar. 🔴 KEY: G2 ist Default-AN (nicht gated-off wie der Nudge-Push) — Verdichtung ist intern/peripher/reversibel (kein Approval), soll sofort wirken. KEIN G3 (LLM-Kosten + Inbox-Flut-Falle), KEIN G1, KEINE Migration (idle aus vorhandenen Timestamps), KEIN lazy-Trigger (nur Loop-Schritt). Idempotenz schon gelöst (embedding_status='done' + listPendingByTwin + UNIQUE-Constraint + frische Konv nach end). Lokal 6/6 grün (Idle-Detektion inkl. Fallback, end+embed-Kette, Idempotenz 2. Tick=0, Frische-Trennung, Default 24h, leerer Normalfall).

**Deploy (leicht — keine Migration, kein WAL-Backup).** Stop-Gate: hostname srv1712371, --stat = nur runtime+docs (KEINE .sql). Rollback-Tags *:rollback-f7a443e. Nur runtime neu gebaut+recreatet (web unberührt — kein web-Diff, Bundle-Grep entfällt). Boot: beide Loops überleben, Server listening, Live-Traffic bedient. **Verifikation des Prod-Effekts bewusst auf morgen vertagt:** der manuelle Smoke (a) hätte die G2-Kette nur NACHGEBILDET (endIdleConversationsForTwin ist nicht exponiert) + Zweitschreiber auf Prod-DB; der natürliche 24h-Tick beweist den ECHTEN Pfad (Auto-Detektion + Auto-End+Embed im laufenden Prozess) ohne Eingriff. Erwartung morgen: embeddings springen von 12 nach oben, sobald die idle Telegram-Konv embedded sind. **Danach:** die „daten-blockiert"-Verdikte (Lebens-Narrativ, Gewohnheiten) neu vermessen — Roh-Substanz wird jetzt verdichtet.

**Tag 39 (Fortsetzung) — Proaktiv-Nudge Anlass 3 v1 gebaut + deployt (unbeantwortete Twin-Frage).** Nach G2 weiter an der Proaktivität: Anlass 3 = der Twin stößt an, wenn er dem Owner eine RELEVANTE Frage gestellt hat, die unbeantwortet blieb. Diagnose-Befund: die heute (Anlass 2) als „sichere Sorte" verschmolzene Form ist (a) Twin-Frage-unbeantwortet — die EINZIGE Sorte, bei der „offen" UND „erledigt" gratis aus der Audit-Turn-Reihenfolge ableitbar sind (kein Migration). Die wertvollere Sorte (b) „vergessene Absicht" bleibt blockiert am fehlenden erledigt-Signal (eigene Strategie, nicht dieser Bau).

**Schritt (`191ab01`).** Detektor detectOpenQuestion (proactive-nudge-service.ts): rein lesend, jüngste Audit-Row pro Konv ist das letzte Wort — endet output.reply auf '?' und gibt es keine neuere Row, ist die Frage offen (deckt aktive + G2-beendete Konv). Recency-Cutoff OPEN_QUESTION_MAX_AGE_HOURS (Default 72). BREIT detektieren, LLM-Generator filtert: scharfer Prompt (RAW: „Stoße NUR an, wenn die unbeantwortete Frage eine echte, für den Owner wichtige offene Entscheidung oder Klärung betraf. Bei rhetorischen, beiläufigen oder Höflichkeits-Fragen: shouldNudge=false."), Generator bekommt Facts + jüngste Summaries als Kontext → erkennt Cross-Konv-erledigt OHNE Themen-Matching. Pipeline 1:1 geerbt via gemeinsamem emitNudge (Pending/Push/Fallback für beide Anlässe). 🔴 Dedup anlass-bewusst gemacht (loadNudges(anlass) filtert pro input.anlass) — Anlass-1- und Anlass-3-Pendings blockieren sich nicht mehr; Episode-Cooldown bei Anlass 3 pro conversationId. Dritter Tick-Schritt openQuestionForTwin (nach G2 → focusForTwin → nudgeForTwin), eigener try/catch. Anlass-1-Detektor/Generator unverändert; Anlass-1-Regression grün.

**🔴 Eigenes Autosend-Gate (Default aus): PROACTIVE_NUDGE_ANLASS3_AUTOSEND_ENABLED.** Bewusst NICHT ans bestehende (scharfe) Anlass-1-Flag gehängt — Anlass 3 hat eine ungetestete Relevanz-Filterung („echte Entscheidung vs. rhetorische Floskel"), die erst in der Inbox sichtbar werden soll, bevor sie autonom pusht (spiegelt die Anlass-1-Vorsicht: erst Pending sehen, dann scharf). Nach Deploy: Anlass 3 landet nur als Pending in der Inbox; Autosend separat scharfschaltbar wenn überzeugt.

**Deploy (leicht — keine Migration, kein web).** Stop-Gate --stat = nur runtime+docs (KEINE .sql, kein web-Diff). Rollback-Tags *:rollback-d113225. Nur runtime gebaut+recreatet. Boot: [db:init] 29 skipped, beide Loops starten sauber (Fokus-Loop trotz emitNudge-Refactor — Anlass 1 intakt), 3 Twins aktiv, Bridge-Streams verbunden, Live-Traffic bedient. Lokal 6/6 grün + Anlass-1-Regression. **Verifikation des Prod-Effekts (zus. mit G2): morgen** — erster Anlass-3-Pending in der Inbox, sobald eine relevante unbeantwortete Twin-Frage existiert + Fokus-Loop tickt.

**Tag 39 (Fortsetzung) — Reverse-Memory-Query gebaut + deployt (Lebens-Narrativ Stufe 1).** Nach Anlass 3 weiter an der Vision: Lebens-Narrativ (TWIN-VISION Pattern 7) als gestufter Reifungspfad eingeordnet — Stufe 0 (Memory rückblickend abfragbar = G2), Stufe 1 (reaktive Reverse-Memory-Query, „Twin, was hab ich über X gesagt / was hat mich beschäftigt"), Stufe 3 (proaktive Muster-Einsicht, vierter Nudge-Anlass, später). Markus wollte Richtung Stufe 3 — Reihenfolge-Entscheidung: erst Stufe 1, weil sie das Retrieval-/Synthese-Substrat + Treffsicherheit de-riskt, auf der Stufe 3 aufsetzt (Stufe 3 ist Inferenz über den Owner → Approval-Pflicht-Klasse, braucht erprobtes Substrat).

**Diagnose (read-only):** Das Hybrid-Retrieval steht komplett (MemoryRetrievalService.retrieve, Vektor-KNN + FTS5/BM25, RRF-merge) und ist in runOwnerDirect schon verdrahtet — der Chat kann eine Rückschau HEUTE halb (limitiert durch EPISODIC_TOP_K=3, keine Synthese, dünne Episoden). Stufe 1 = kein Neubau, sondern bewusste Aktivierung: Intent-Erkennung + Synthese-Schicht + breiteres topK + Zeitfilter.

**Schritt (`a59b4af`).** Zeitfilter (embeddings-repo.ts SearchOptions.since/until auf created_at, Vektor + FTS5, Default kein Filter → bestehende Aufrufer unberührt, KEINE Migration). Intent: neue Capability reverse_memory_query (detectCapability, signal-basiert — robust gegen eingeschobene Zeitangaben), Zeitbezug → since (week/month/recent). Zwei Typen: (b) Stichwort „über X gesagt" (Retrieval pur), (a) Thema/Zeitraum „was hat mich beschäftigt" (+ Zeitfenster). 🔴 Synthese-Schicht synthesizeRetrospective (PUBLIC, Sprungbrett für Stufe 3): retrievte Treffer + RAW-Rückblick-Directive (harte Anti-Halluzination — ehrlich bei dünnem Korpus „finde wenig dazu", erfindet NICHTS, in Owner-Stimme). runReverseMemoryQuery als eigener Pfad in runOwnerDirect, inline im Chat, breiteres REVERSE_QUERY_TOP_K (Default 12, Chat-Default 3 unberührt). KEIN Gate (rein reaktiv, kein autonomes Verhalten). Lokal 5/5 grün (Intent-Typen + kein Fehlauslösen, Zeitfilter beide Pfade, Synthese voll+leer, topK) + Regression (episodic-repos, hybrid-retrieval). 🔴 LLM-Synthese-GÜTE = Markus' Live-Test; echte Qualitäts-Demo erst nach G2-Reife (verdichtete Episoden).

**Deploy (leicht — keine Migration, kein web).** Stop-Gate --stat = nur runtime+docs. Rollback-Tags *:rollback-191ab01. Nur runtime gebaut+recreatet. Boot: beide Loops starten sauber, Server listening. **Wirkung:** Reverse-Memory-Query sofort reaktiv nutzbar, aber sinnvoll erst mit G2-verdichteten Episoden (morgen) — dann kann Markus den Twin fragen „was hat mich diese Woche beschäftigt" und bekommt eine Synthese aus echtem gelebtem Material. G2 + Reverse-Query greifen ineinander.

## Tag 38 (5. Juni 2026, Freitag)

**Tag 38 (5. Juni 2026) — Reflexions-Loop SCHARF GESCHALTET auf Prod (srv1712371).** Zweiter autonomer Loop nach dem Fokus-Loop (Tag 37). Bewusste Entscheidung mit klarem Ziel: der Reflexions-Loop ist der INTERNE HEBEL, der die daten-blockierten Vision-Patterns entblockt — er lässt das Twin-Diary autonom wachsen (gestern diagnostiziert: Lebens-Narrativ (A) braucht Diary-Tiefe, real erst 1 Eintrag). Aktivierung via ENV (NICHT im git-Repo): `docker-compose.yml` `nolmi-runtime.environment` um `REFLECTION_LOOP_ENABLED`/`REFLECTION_LOOP_INTERVAL_HOURS` als `${VAR:-}`-Durchreichung ergänzt (analog FOCUS_LOOP Tag 37, direkt darunter); Werte in der VPS-`.env`: `REFLECTION_LOOP_ENABLED=true` + `REFLECTION_LOOP_INTERVAL_HOURS=24`. `docker compose config` bestätigte beide Loops (reflection true/24, focus unverändert true/24). Recreate runtime-only → Boot-Log `[reflection-loop] started, interval 86400000ms (self-mode, opt-in)` + `[focus-loop] started` (beide scharf), Server listening. 🔴 **Betriebszustand: ab jetzt laufen ZWEI autonome Loops auf Prod.** Reflexions-Loop: nur `'self'`-Modus (Selbstreflexionen des Twins, NIE autonome Owner-Inferenzen), erzeugt nur PENDINGS (nie direkt wirksam — Approval-Pflicht, anders als Fokus-Loop der direkt schreibt), zwei Guards (max 1 offenes Pending/Twin + nur bei neuer Substanz → 0 Token im Normalfall). Wirkung: alle 24h ggf. eine Pending-Selbstreflexion in der Inbox (subject-aware „über sich selbst"); Approve → Diary-Eintrag, Reject → spurlos. Erwartung: @markus gelegentlich, @florian/@heiko still (zu wenig Substanz). **Kein 3-Min-Beobachtungstick nötig** (Loop erprobt Tag 36, erzeugt nur reversible Pendings); erster echter Tick kommt organisch in 24h, sichtbar in der Inbox. **Diary-Wachstums-Hebel ist aktiv — über Wochen akkumuliert die Längs-Historie für Lebens-Narrativ (A).** Kontrolle: Inbox (Approve/Reject) + jederzeit abschaltbar via `.env`. Steuerung beider Loops lebt in der VPS-`.env`, nicht in git.

**Tag 38 (Fortsetzung) — Phase 4.3 Beziehungs-Modell: sichere Hälfte gebaut (Schritte 1–3 von 5, lokal verifiziert, NICHT deployt).** Große Feature-Achse nach „näher zur Vision" eröffnet (Strategie gelockt, docs/PHASE-4.3-BEZIEHUNGS-MODELL-STRATEGY.md). Setzungen: vier Stufen (fremd/bekannt/vertraut/eng); Wirkung BEIDES (Verpackung + Autonomie); Setzung HYBRID (Twin schlägt vor, Owner bestätigt); Startwert aus binärem Trust migriert; Leitplanke-vor-Sensiblem (wie Fokus Tag 37). Davor zwei Memory-Diagnosen (#101, #96) read-only an echten Daten als marginal → Backlog vermessen (inkl. Prod-Gegenmessung: Prod-@markus 12 Embeddings < Dev 35).

**Schritt 1/5 — Datenschicht (`7171ab8`).** Migration 029_familiarity_level.sql: `ALTER TABLE trust_relationships ADD COLUMN familiarity_level TEXT NOT NULL DEFAULT 'vertraut' CHECK (IN fremd/bekannt/vertraut/eng)` — additiv, kein Rebuild (UNIQUE intakt, kein abhängiger FK). 🔴 Schlüssel-Befund: „trusted" IST Row-Existenz (kein Flag) → „untrusted→fremd" hat nichts zu migrieren; alle existierenden Rows sind trusted → DEFAULT 'vertraut' backfillt sie (S4); 'fremd' ist der Lese-Default bei fehlender Row (lebt im Repo-Getter, kein gespeicherter Wert). trust-repo: getFamiliarity (Row-Level oder 'fremd'), setFamiliarity (UPDATE; wirft bei fehlender Row — kein Auto-Insert, weil Row=trusten=Dispatch-Wirkung). add/remove/list/isTrusted unverändert. 🔴 Lokal verifiziert MIT echter Dev-DB-Gegenprobe (Markus): `db:init` musste manuell laufen (Claude Codes Temp-DB-Test belegt nur Mechanismus, nicht laufende Dev-DB — Lesson reinforced); danach beide echten Rows (@markus↔@florian) = 'vertraut', schema_migrations=29.

**Schritt 2/5 — Verpackungs-Wirkung, mild (`513adf0`).** familiarity_level → A2A-Prompt-Ton (Vision „Substanz konstant, Verpackung passt sich an"). buildFamiliarityBlock(level, partner) (Muster buildFocusBlock): vier Ton-Leitsätze (fremd→zurückhaltend/Klärungsfragen · bekannt→offen-freundlich · vertraut→direkt/darf urteilen · eng→sehr direkt/darf kritisieren); alle vier erzeugen einen Block (fremd ist ein Ton, kein Fehlen). 🔴 Zwei Anbau-Stellen (Scope: beide Richtungen): eingehend via bridgeContextHint (deckt handleTrustedBridgeMessage + approveTwinResponse in einem Chokepoint), ausgehend via approveTwinSend (sonst klänge der Twin beim Antworten vertraut, beim Selbst-Schreiben neutral). A2A-only (Spiegelbild zu focusBlock owner-only — kein Owner-Leak, composeOwnerSystemPrompt-Signatur unverändert). Dispatch unberührt. Lokal verifiziert (getFamiliarity→Ton-Kette, A2A-only-Grep, typecheck).

**Schritt 3/5 — Sichtbarkeit + manuelle Kontrolle, die Leitplanke (`18bd747`).** Bewusst VOR den autonomen Schritten 4+5 (Fokus-Muster). Backend additiv: familiarityLevel in TrustRow+TrustRelationship+rowToTrust → GET /trust trägt das Level; neue owner-gegatete Route POST /twins/:handle/trust/:trustId/familiarity (Zod-Enum, findById, setFamiliarity, familiarity-set-Audit). Web: <select> (vier Stufen) pro Zeile im „Vertraute"-Tab, inline-Feedback (Tab-konsistent). 🔴 Variante 1 (kollisionsfrei): Selektor nur auf getrustete Rows → setFamiliarity wirft nie im UI; isTrusted row-basiert unberührt. Ehrlicher UI-Hinweis: Level beeinflusst Ton, NICHT Autonomie (das wäre heute falsch — Schritt 5). Lokal verifiziert (owner-gegated 403, POST persistiert, Kette zu Schritt 2, twin-service.ts unberührt); offen: Browser-Check (#5) + test-trust-flow — beide beim Prod-Deploy/separat.

**Stand:** Sichere Hälfte komplett — Twin kennt Vertrautheit, passt Ton an, Owner kontrolliert manuell; Sicherheitslinie unberührt. **NICHT deployt** (ganze Achse deployt gebündelt auf Signal; Schritt 1 ist „mit-Migration"-Klasse → WAL-DB-Backup vor 029 wie 028). **Offen — die sensible Hälfte (frisch):** Schritt 4 (Hybrid-Vorschläge: Twin leitet Level ab, schlägt als Pending vor — Social-Suggestion-Muster, neue Capability, LLM-Inferenz); Schritt 5 (Autonomie-Abstufung: Level steuert autonom-antworten vs. pending — 🔴 die isTrusted-Reconciliation von „Row-Existenz" auf level-basiert + die Sicherheitsentscheidung „welche Stufen dürfen autonom antworten", erst bei Schritt 5 zu treffen).

**Tag 38 (Fortsetzung) — Phase 4.3 funktional vollständig: Schritt 5 (Autonomie) gebaut, Schritt 4 vertagt.** Nach dem Sport weitergebaut. Schritt 4 (Auto-Ableitung) read-only diagnostiziert → daten-blockiert vertagt (Muster wiederverwendbar, aber echte Daten tragen nicht: @florian = 1 A2A-Konversation/~7 Interaktionen/ein Tag; kein interner Hebel, Föderations-nah). Reihenfolge-Korrektur: Schritt 5 ist NICHT daten-abhängig → vorgezogen.

**Schritt 5/5 — Autonomie-Abstufung (`1378a71`).** Das familiarity_level steuert jetzt autonom-antworten vs. pending. 🔴 Sicherheitsentscheidung Tag 38: AUTO_RESPONABLE_LEVELS = {vertraut, eng} — konservativ, reproduziert das frühere binäre trusted-Verhalten EXAKT (Backfill setzte alle Bestands-Rows auf vertraut → autonom wie früher; fremd-Default → pending wie früher; Δ=0 für bestehende Beziehungen). bekannt/fremd → pending (graded Mitte über den bestehenden pending-Pfad, ohne neuen Code). 🔴 Architektur: NEUE Methode canAutoRespond(twinId, partner) = getFamiliarity ∈ AUTO_RESPONABLE_LEVELS; isTrusted NICHT umdefiniert (anderes Konzept: „steht in Vertraute-Liste"). isTrusted hatte genau EINEN verhaltenswirksamen Aufrufer (Dispatch :1035) → Reconciliation = eine Zeile (isTrusted→canAutoRespond, Variable mayAuto). Nur eingehend (handleBridgeMessage); ausgehende Sends bleiben owner-initiiert. Die Politik lebt an EINER benannten Konstante (jederzeit enger/lockerer steuerbar). Lokal verifiziert: Regression Δ=0 für Bestehende, Graded-Mitte (bekannt→pending, vertraut→autonom), isTrusted/canAutoRespond sauber getrennt.

**Phase 4.3 Stand:** Schritte 1 (Schema) · 2 (Ton) · 3 (Sichtbarkeit+Kontrolle) · 5 (Autonomie) gebaut + lokal verifiziert + **deployt Tag 38** (siehe Schluss-Absatz). Schritt 4 (Auto-Ableitung) daten-vertagt. **Funktional vollständig** (bis auf das datenabhängige Schritt 4): Twin kennt Vertrautheit, passt Ton an, Owner kontrolliert manuell, Autonomie level-basiert + konservativ. **Deploy war „mit-Migration"-Klasse (029)** → WAL-DB-Backup vor Deploy wie 028. Deploy-Verify-Punkte: Browser-Check Schritt-3-Selektor ✅ (auf Prod gesehen), A2A-Ton-Effekt (Schritt 2) am echten Verkehr (organisch), Graded-Mitte-Dispatch (Schritt 5) lokal verifiziert, auf Prod konservativ Δ=0.

**Deployt + live verifiziert auf Prod (srv1712371, Tag 38).** Zweite Migration seit 027 (nach 028 gestern). Volle Stop-and-Verify-Sequenz: hostname-Gate, git-fetch-Vorschau (nur Phase 4.3 + Doku, kein facts-Kollateral), Rollback-Tags `*:rollback-c35bc04` (alle drei), 🔴 WAL-konsistentes DB-Backup via better-sqlite3 .backup() VOR der Migration (`twin.db.pre-029-2026-06-05T14-13-26Z.bak`, byte-genau = Live-DB 5177344, bleibt liegen wie pre-028). Build runtime+web (literale NEXT_PUBLIC-Args), Web-Bundle-Grep grün (`runtime.nolmi.ai` gebacken, kein localhost:4000). `--force-recreate` runtime+web (bridge unberührt) → Boot-Log `[db:init] 029_familiarity_level.sql angewendet`, beide Loops überleben (`[reflection-loop] started` + `[focus-loop] started`), Server listening. DB-Gegenprobe: schema_migrations=29, familiarity_level-Spalte da, Prod-Trust-Rows (@florian + reziprok) beide auf `vertraut` (S4-Backfill korrekt). **Live-Beleg Browser @markus:** Settings „Vertraute"-Tab zeigt Level-Selektor pro Partner (@florian = vertraut) + ehrlichen Hinweis-Text (Level beeinflusst Ton, nicht Autonomie). Dispatch-Test (Schritt 5) bewusst NICHT auf Prod erzwungen — lokal verifiziert (bekannt→pending, vertraut→autonom), konservative Linie {vertraut,eng} hält Δ=0 für bestehende Beziehungen (alle Bestands-Trusts sind vertraut → autonom wie vor dem Deploy). **Phase 4.3 erreicht:** das Beziehungs-Modell ist live — Twin kennt Vertrautheit, passt Ton an, Owner kontrolliert das Level, Autonomie level-basiert. Schritt 4 (Auto-Ableitung) bleibt daten-vertagt.

**Tag 38 (Fortsetzung) — Proaktiver Fokus-Nudge Stufe 1 gebaut (aus täglicher Nutzungs-Erfahrung).** Markus' Befund aus dem echten Alltag: der Twin läuft gut, ist aber noch nicht proaktiv (kommt nicht von selbst). Gewählt: Proaktivität (b) „von-selbst-kommen", Anlass 1 (Fokus: „du hängst seit Tagen an X"), Ziel-Kanal Telegram — aber mit Leitplanke: Stufe 1 = PENDING-Vorschlag in der Inbox (Owner liest, was der Twin sagen würde), autonomer Telegram-Push ist spätere Freischaltung (wie Reflexions-Loop).

**Diagnose (read-only):** focus_snapshots (Mig. 027) ist by design historisiert (append-only/soft-supersede) → „festhängen" aus der Snapshot-Reihe ableitbar, KEIN Vorbau. Reale Historie aber dünn (Dev 0, Prod ~1 Tag jung seit Fokus-Loop scharf Tag 37) → Feature „scharf aber still", feuert ersten echten Nudge, sobald Prod ≥3 Tage stabile Snapshots hat. Aktiver Telegram-Sendepfad existiert heute NICHT (nur ctx.reply request-response), Bausteine da (Chat-ID in telegram_configs, Bot via BotRegistry erreichbar) → spätere Stufe ~S (BotRegistry.sendToOwner).

**Schritt — Stufe 1 (`952370b`).** ProactiveNudgeService.detectStuck (focus/proactive-nudge-service.ts): Themen-Überlappung über die ≥3 jüngsten Snapshots (Überlappung statt String-Gleichheit, da deriveFocus variiert) via neuem FocusSnapshotsRepo.listRecent. Schwelle (Setzung): dasselbe Hauptthema in ≥3 aufeinanderfolgenden täglichen Snapshots (konservativ, treffsicher). Nudge-Generator: echter LLM-Call (deriveFocus-Muster, Persona-Stimme), Output {shouldNudge, message, reasoning}; shouldNudge = zweite Bremse (Twin darf „nicht der Mühe wert" sagen). Pending capability='proactive-nudge' (Social-Muster), Payload {anlass:'fokus', thema, tageStabil, message, reasoning}. approveProactiveNudge = acknowledge (KEIN Send — Telegram käme genau hier rein). Inbox-UI rendert message prominent. Guards: <3 Snapshots still (0 Token), Dedup (max 1 offen), Episode-Cooldown. Am Fokus-Loop-Tick angehängt (kein eigenes Gate, hängt an FOCUS_LOOP_ENABLED). Lokal verifiziert (synthetisch: 3× stabiles Thema → isStuck, wechselnd → false; Guards; leerer Normalfall still; Dev-DB unberührt/:memory:).

**🔴 Qualitäts-Check (echter LLM-Lauf, Markus mit Key):** gegen synthetischen Stuck-Fall „Beziehungs-Modell" 3 Tage. Ergebnis sehr gut: shouldNudge=true, aber der Twin erkannte (reasoning) dass das Thema substanziell FERTIG ist (nicht stagniert) und wählte einen Standortbestimmungs-Ton statt „du hängst fest" — referenzierte sogar den echten Stand (canAutoRespond, isTrusted weg, Escalation geklärt). Persona-Stimme getroffen, konkreter Anstoß, nicht aufdringlich. System-Prompt braucht KEINE Nachschärfung. (Vorbehalt: ein Lauf, ein Fall; echter Stagnations-Ton zeigt sich erst an realer Historie.)

**Stand:** Stufe 1 gebaut + lokal verifiziert, Qualität bestätigt, NICHT deployt. **Offen:** Deploy (mit dem nächsten Prod-Deploy mitnehmen — kein eigener Migrations-Deploy nötig, kein neues Schema); spätere Stufe = autonomer Telegram-Push (BotRegistry.sendToOwner ~S, separat freischaltbar wie Reflexions-Loop); die anderen zwei Anlässe (Muster/Widerspruch in Memories — heikelste, Inferenz über Owner; offene Frage unaufgelöst) vertagt.

**Tag 38 (Fortsetzung) — Proaktiv-Nudge Stufe 2 gebaut + deployt + Autosend scharf auf Prod.** Markus wollte den Nudge heute vollständig: mit Telegram + auf Production. Gebaut in zwei Sub-Schritten. **Stufe 2a (`0bae670`):** BotRegistry.sendToOwner — erster aktiver Owner-Push-Pfad (bot.telegram.sendMessage an gepairte Chat-ID, außerhalb des ctx.reply-Request-Response-Modells), graceful (no-bot/not-paired/send-failed → {sent:false}, kein Throw), markdownToTelegramHtml wiederverwendet. **Stufe 2b (`f7a443e`):** ENV-Gate PROACTIVE_NUDGE_AUTOSEND_ENABLED (Default aus). Flag AUS → Pending wie Stufe 1; Flag AN + Push OK → sendToOwner + Audit-Status 'sent' (neuer AuditStatus, stille Spur, kein offenes To-do); 🔴 Flag AN + Push-Fehlschlag → Fallback auf Pending (Nudge geht nie verloren). DI: Sender per-Call in nudge() injiziert (botRegistry durch FocusLoopDeps). Dedup im Push-Modus stützt sich auf gesamte Nudge-Historie inkl. 'sent' (nicht auf offene Pendings → kein täglicher Wiederhol-Push). 🔴 Bewusste Abweichung (Claude-Code-Befund): compose-Passthrough NICHT in git committet (Loop-Steuerung lebt in VPS-.env, dokumentiertes Prinzip) — nur .env.example dokumentiert; das committete docker-compose.yml bleibt unberührt.

**Deploy (kein Migrations-Deploy — kein Schema-Change, audit.status hat keinen CHECK-Constraint, verifiziert).** Volle Stop-and-Verify-Sequenz: hostname srv1712371, git-fetch-Vorschau (Nudge-Stufen + Doku, kein facts/migrations-Kollateral), Rollback-Tags *:rollback-d0ced4d (alle drei). KEIN WAL-Backup nötig (kein Schema-Change). Build runtime+web (literale Args), Bundle-Grep grün. --force-recreate runtime+web → beide Loops überleben, Server listening. **🔴 Echter Sende-Smoke auf Prod:** frische Minimal-Registry via docker compose exec (eagerLoadAllBots ohne setWebhook/launch → kein 409, laufender Prozess unberührt, readonly-DB) → sendToOwner(twin_jgqzOIkzdTsTx6vv) → {sent:true} + Nachricht real auf Markus' Telegram angekommen. Der aktive Push-Pfad ist damit bewiesen, nicht nur unit-getestet.

**Autosend scharf geschaltet (VPS-.env + VPS-compose, wie Fokus-Loop).** PROACTIVE_NUDGE_AUTOSEND_ENABLED=true in VPS-.env (Z.43, neben FOCUS_LOOP_ENABLED) + Passthrough in VPS-docker-compose.yml ergänzt (YAML-validiert, Backup docker-compose.yml.bak-pre-nudge). Recreate → `Flag im Container: true` verifiziert. **Stand: scharf, aber still** — der erste echte autonome Nudge feuert, sobald der Prod-Fokus-Loop ≥3 Tage stabile Themen-Snapshots gesammelt hat (Loop läuft seit Tag 37). Rückweg jederzeit: Flag=false + recreate → stiller Pending-Modus. **Offen:** erster echter Live-Nudge als Qualitäts-Test unter Realbedingungen (synthetisch heute exzellent: Twin unterschied „fertig" von „festgefahren"); die anderen zwei Anlässe (Muster/Widerspruch — heikelste; offene Frage) bleiben vertagt.

## Tag 37 (4. Juni 2026, Donnerstag)

**Telegram Re-Connect selbstheilend** (`9ef57ba`): Der echte Fix zum gestrigen setWebhook-Befund. Diagnose (read-only) korrigierte die Annahme „Erst-Connect setzt keinen Webhook" — POST /config (:159) UND PUT /config (:225) rufen registerWebhook; die Lücke war ausschließlich POST /pairing-code (:320), das ihn NICHT rief. Chicken-and-Egg: /start <code> kommt selbst über den Webhook rein → der Re-Register gehört an die Code-Generierung (die dem /start vorausgeht), nicht an den /start-Handler. **Fix:** POST /pairing-code triggert jetzt startBotForTwin (idempotent) + registerWebhook (liest bestehendes webhook_secret frisch, rotiert NICHT → bricht keine Verbindungen), beides in try/catch (Webhook-Fehler blockiert die Code-Ausgabe nicht). Telegram-setWebhook ist idempotent (Mehrfach-Connect safe). 5/5 Belege grün (Kern: Secret unverändert + Fehler-Toleranz). Nur runtime, keine Migration, keine neue UI. Damit ist der „Token ändern"-Workaround überflüssig. **Deployt auf Prod (Tag 37, `0305d55`→`4c4dfa7`, nur runtime, keine Migration) + gegen echte Daten verifiziert:** unpair → Pairing-Code generieren (löst jetzt registerWebhook aus) → `/start <code>` „Paired successfully" → frische Telegram-Nachricht → Twin antwortete substanziell (mit Memory-Abruf) — alles OHNE „Token ändern". Selbstheilung end-to-end bewiesen; der gestrige Workaround ist überflüssig. Telegram-Komplex damit vollständig abgeschlossen (Empfang automatisiert + Verarbeitung idempotent + Re-Connect selbstheilend).

**Social-Suggestion prod-auslösbar — letzte CLI-only-Vision-Lücke geschlossen** (`2125a77`): Vision-Pattern #3 „Soziale Proaktivität" Stufe 1 war wie die Reflexion CLI-only (`twin:social-nudge`, braucht tsx → auf Prod tot). Diagnose (read-only): zwei Befunde — (A2) der Service scannt ALLE A2A-Partner (kein Partner-Param, `nudge(new Date())`, social-suggestion-service.ts:130) → Route ohne Body, UI ohne Picker; (B4) der erzeugende Service war — anders als reflectionEngine — NICHT als `entry.service`-Feld verdrahtet → ein Mini-Konstruktor-Schritt nötig. **Gebaut:** (1) public `socialSuggestionService`-Feld im TwinService (1:1 reflectionEngine-Muster; Deps minimal: db+audit+handle+threshold, kein Model); (2) owner-gegatete Route `POST /twins/:handle/social-nudge` (Vorlage /reflect; kein Body; gibt created/skippedExistingPending/partnersChecked); (3) UI-Knopf „Beziehungen prüfen" in der Inbox (wo die Pendings ohnehin landen → kohärenter Datenfluss; twin-global, nicht konversationsgebunden). **Leitplanke gehalten:** Route berührt nur `nudge` (Pending-Erzeugung), `approveSocialSuggestion` bleibt NO-OP/acknowledge — kein autonomer Send. Belege a–f grün (Kern: d Leitplanke nur-Pending + b Leer-Fall). Service-Logik selbst unverändert seit 7c871be → nicht doppelt getestet. Nur runtime+web, keine Migration. **Erwartung Prod:** bei dünnem A2A-Graph feuert der Vorschlag real selten — Leer-Fall („keine fälligen Kontakte") ist der erwartete Normalfall, kein Defekt (deterministisch, kein LLM); echte Demo wenn Beziehungen wachsen. **Damit sind alle drei Vision-Patterns auf Prod auslösbar** (Zeit-Erleben automatisch, Reflexion + Social-Suggestion per Trigger). **Deployt auf Prod (Tag 37, `4c4dfa7`→`a4ff67a`, runtime+web, bridge unberührt, keine Migration) + verifiziert:** Inbox-Knopf „Beziehungen prüfen" → `POST /twins/@markus/social-nudge` → Toast „Keine fälligen Kontakte — alles aktuell" (created=0). Erwarteter Leer-Fall beim dünnen A2A-Graph = bestandener Mechanik-Test (Route feuert, Scan läuft, keine Partner über 21-d-Schwelle); echte Demo wenn Beziehungen wachsen. **Alle drei Vision-Patterns jetzt auf Prod auslösbar** (Zeit-Erleben automatisch, Reflexion + Social-Suggestion per Trigger) — Vision-Trigger-Strang rund, keine CLI-only-Lücke mehr.

**Vision-Pattern „Aufmerksamkeit/Fokus" Stufe 1 — Schritt 1/4 gebaut** (`dac15b4`): Fundament für den autonom gepflegten Fokus. Setzungen (Strategie-Runde): Fokus wirkt automatisch im Prompt + on-demand (1C), wird autonom gepflegt + gespeichert ohne Approval (2B, Vision „peripheres Wissen"), LLM-abgeleitet (3A), fortgeschrieben durch periodischen Loop (opt-in, default aus). Diagnose-getrieben in 4 Sub-Schritte zerlegt: **1 Schema+Generator+Trigger** (dieser), 2 Prompt-Integration, 3 Sichtbarkeit+Reset (Leitplanke), 4 Loop — bewusst Leitplanke (3) VOR Autonomie (4). **Schritt 1:** Migration 027 `focus_snapshots` (append-only, Soft-Supersede via superseded_at, FK ON DELETE CASCADE → #744-Lösch-Cascade); FocusSnapshotsRepo (insert/getCurrent); FocusEngine (Input-Assembly nach reflection-engine-Vorbild, ABER `.slice(-8)` = jüngste Summaries weil gegenwartsbezogen; LLM-Ableitung; Halluzinations-Bremse hasEnoughSubstance); 🔴 **kein Pending, direkt geschrieben** — bewusste Abweichung von Reflexion (autonom gepflegtes peripheres Wissen, kein Approval-Gate); focusEngine als entry.service-Feld; Route `POST /twins/:handle/focus/refresh` (owner-gated). Belege a–f grün (Kern: b plausibler Fokus, c Leer-Fall ohne Erfindung). NOCH NICHT prompt-wirksam, KEIN Loop, KEINE Sichtbarkeits-UI (Schritte 2–4). **Deployt auf Prod (Tag 37, `a4ff67a`→`e316d16`, nur runtime, MIT Migration 027) + gegen echte Daten verifiziert.** Erste Migration seit 026 — „mit-Migration"-Klasse sauber gefahren: WAL-konsistentes DB-Backup vor dem Deploy (`twin.db.pre-027-…` via better-sqlite3 `.backup()`), Migrations-Verify nach Boot (`027_focus_snapshots.sql angewendet`, Tabelle existiert, in `schema_migrations` getrackt, idempotent). **Qualitäts-Beleg:** `focus/refresh` gegen echten @markus (Owner-Session via Browser-fetch, da UI-Trigger erst Schritt 3) → abgeleiteter Fokus traf präzise („Nolmi-Aufbau, Framing/Positionierung, nolmi.ai/VPS/Telegram, parallel Thiel-Lektüre", aus 1 Summary + 24 Turns) — der Twin versteht den aktuellen Arbeitskontext gegen echte Prod-Historie. Erster focus_snapshot in Prod-DB (noch NICHT prompt-wirksam, kein Loop, keine Sichtbarkeit — Schritte 2–4). **Schritt 1/4 abgeschlossen.**

**Aufmerksamkeit/Fokus — Schritt 2/4 (Prompt-Integration) gebaut** (`9d04599`): der gespeicherte Fokus wird prompt-wirksam. `buildFocusBlock(snapshot, ownerName)` (Vorbild buildEpisodicBlock, `string|null`-Idiom) baut einen „## Aktueller Fokus"-Block mit dem entscheidenden Rahmungs-Hinweis „aus jüngsten Gesprächen abgeleitet — als Kontext nutzen, nicht erzwingen" (verhindert, dass der Twin den Fokus übergewichtet); themes optional dahinter. In composeOwnerSystemPrompt als neuer focusBlock-Layer **direkt nach personaWithFacts** (hohe Attention, „aktueller Zustand" konstitutiv), vor skills/summary/episodic — Schichten-Doku auf 8. 🔴 **Defensiv:** kein Snapshot/leer → null → vom `.filter(Boolean)` rausgeworfen (kein leerer Block, kein Throw). 🔴 **Kein A2A-Leak:** focusBlock wird NUR in runOwnerDirect gesetzt (via focusRepo.getCurrent); A2A-runModel-Calls lassen ihn undefined → fremde Twins erfahren NICHT, woran Markus arbeitet (per-call-options-Muster wie episodicBlock, kein Helper-Gating nötig). **Architektur-Vereinfachung bestätigt:** Codex-Pfad ist inzwischen in runModel vereinheitlicht (kein separates runModelViaCodex mehr) → eine compose-Site bedient api_key+oauth, focusBlock kann nicht pfad-abhängig fehlen. On-demand „woran arbeite ich gerade?" kommt gratis (Fokus steht im Prompt). Belege a–f grün (Kern: b defensiv, c eine Site/beide Modi). Keine Migration. **Deployt auf Prod (Tag 37, `e316d16`→`40c0de4`, nur runtime, KEINE Migration) + gegen echte Daten verifiziert.** Chat-Test in frisch zurückgesetztem @markus-Chat (kein Kontext im Gespräch): (1) Wirksamkeit „Was beschäftigt mich zurzeit?" → Twin antwortet aus dem Fokus-Block (Nolmi-Kern + Framing-Zitat + nolmi.ai/VPS/Telegram + parallel Thiel/Tech-Macht) ohne dass es ihm im Chat gesagt wurde; (2) Nicht-Dominanz zweifach: Reise-Frage (Herbst-Urlaub) → vollständig beim Thema (Sylt/Tirol/Lissabon), nutzt Fokus nur als Hintergrund (kennt „Longevity-Mode"), kein Nolmi-Bogen; Espresso/Ristretto → reine Fachantwort, am Ende praktischer Siebträger-Zusatz (Fokus-Wissen als Mehrwert, nicht als Zwangsthema). Der „als Kontext nutzen, nicht erzwingen"-Hinweis wirkt nachweisbar. **Schritt 2/4 abgeschlossen — Fokus ist von gespeichert zu wirksam geworden.** Offen: Schritt 3 (Sichtbarkeit+Reset, Leitplanke) vor Schritt 4 (opt-in Loop).

**Aufmerksamkeit/Fokus — Schritt 3/4 (Sichtbarkeit + Reset, die Leitplanke) gebaut** (`eae5eb8`): die Pflicht-Leitplanke für autonom-ohne-Approval — Owner kann den gespeicherten Fokus JEDERZEIT SEHEN und ZURÜCKSETZEN. Bewusst VOR Schritt 4 (autonomer Loop), weil sie dessen Voraussetzung ist. **Gebaut:** `FocusSnapshotsRepo.supersede(twinId)` (in Schritt 1 zurückgestellt, jetzt gebaut) — non-destruktives UPDATE der jüngsten aktiven Row (superseded_at=now), idempotent (kein aktiver → false, kein Fehler), History bleibt; zwei owner-gegatete Routen `GET /twins/:handle/focus` (lesen, null sauber) + `POST /twins/:handle/focus/reset` (schreibend, supersede); neuer Settings-Tab „Fokus" (FocusTab, Muster TelegramChannelTab): focusText + Themen-Pills + „abgeleitet am … · aus N Summaries + M Turns", Empty-State, „Fokus zurücksetzen" mit ModalWrapper-Bestätigung → Toast → Empty-State. Reset-Knopf nur bei vorhandenem Fokus. 🔴 **Kern-Belege:** b Reset owner-gegated + non-destruktiv (Nicht-Owner→403, nichts geändert); f Reset wirkt auf Prompt (getCurrent→null → buildFocusBlock→null → kein Fokus-Block — Kette zu Schritt 2 geschlossen). Kein „neu ableiten"-Knopf (Reset-allein bewusst, autonomes Ableiten = Schritt 4). Keine Migration. **Deployt auf Prod (Tag 37, `40c0de4`→`8dd79b0`, runtime+web, keine Migration) + gegen echte Daten verifiziert — beide Leitplanken-Hälften.** Sichtbarkeit: Fokus-Tab zeigt focusText + Themen-Pills + „abgeleitet am … · aus 1 Summaries + 24 Turns" + Erklär-Satz. Eingriff: „Fokus zurücksetzen" auf Prod GEKLICKT (echter schreibender End-to-End-Test) → Bestätigung → Toast → Empty-State „Aktuell kein gespeicherter Fokus". Reset wirkt owner-gegated + non-destruktiv (alter Snapshot bleibt supersedet in History) + bis in den Prompt (getCurrent→null). Fokus danach per focus/refresh neu abgeleitet (frischer Snapshot, History-Mechanik bestätigt). **Damit ist die Leitplanke vollständig verifiziert — Schritt 4 (opt-in autonomer Loop) ist jetzt verantwortbar. Schritt 3/4 abgeschlossen.**

**Aufmerksamkeit/Fokus — Schritt 4/4 (autonomer Loop, opt-in, DEFAULT AUS) gebaut** (`eaf7b15`): die autonome Dimension — der Twin leitet seinen Fokus periodisch + selbsttätig neu ab. Schließt das Pattern ab. **FocusLoopService** 1:1 nach ReflectionLoopService (start/stop idempotent, ENV-Gate, per-Tick-.catch, per-Twin-try/catch, Boot-Wiring nach listen + Shutdown-stop). 🔴 **Eine Guard-Ebene (Substanz-Guard, bewusst KEIN Pending-Guard):** hasNewSubstanceSince (neuer Audit-Turn ODER neue Summary seit aktivem Snapshot) → keine neue Substanz → kein LLM-Call → 0 Token; eigener focus-spezifischer Check (reflection-loop unberührt). 🔴 **Snapshot-Lifecycle geklärt:** deriveFocus supersediert jetzt VOR dem Insert (supersede-then-insert, Reihenfolge load-bearing) → Invariante „genau ein aktiver Snapshot", History sauber, gilt für beide Pfade (manuell + Loop), konsistent zum Reset (Schritt 3). 🔴 **Direkt-schreiben, KEIN Pending** — die bewusste Abweichung vom Reflexions-Loop (der nur Pending erzeugte); möglich NUR weil die Leitplanke (Schritt 3 Sichtbarkeit+Reset) als Voraussetzung steht. ENV: FOCUS_LOOP_ENABLED (default false) + FOCUS_LOOP_INTERVAL_HOURS (default 24), in .env.example auskommentiert dokumentiert. Belege a–f grün (Kern: b Substanz-Guard/Token-Bremse, c direkt-schreiben + genau-ein-aktiver + kein Pending). 🔴 **DEFAULT AUS — Bau aktiviert den Loop NICHT; Verifikation lief nicht scharf (runTick direkt).** Keine Migration. **Damit ist das Aufmerksamkeit/Fokus-Pattern (4. der 8 Vision-Patterns) komplett gebaut: Schema → Generator → Prompt → Leitplanke → Loop. Deployt auf Prod (Tag 37, `8dd79b0`→`65c0dc8`, nur runtime, keine Migration) — Loop-Code live, aber INAKTIV.** Boot-Verify: `[focus-loop] disabled (FOCUS_LOOP_ENABLED nicht true)` + `[reflection-loop] disabled` (Loop-Infrastruktur intakt) + Server listening, keine Errors. Der autonome Loop liegt auf Prod, schläft aber — kein Verhaltens-Test nötig (nichts ändert sich, solange er aus ist). **Damit ist das Aufmerksamkeit/Fokus-Pattern (4. der 8 Vision-Patterns) vollständig: Schema → Generator → Prompt → Leitplanke → Loop, alle vier Schritte gebaut, deployt, verifiziert.** 🔴 **Scharfschalten (FOCUS_LOOP_ENABLED=true auf Prod) ist eine getrennte, bewusste Entscheidung — noch NICHT getroffen.** Bei Aktivierung würde der Twin alle FOCUS_LOOP_INTERVAL_HOURS (default 24) autonom + ohne Approval seinen Fokus neu ableiten (substanz-gegated → 0 Token ohne neue Gespräche); Leitplanke (Sichtbarkeit+Reset, Schritt 3) als Sicherung steht.

**Fokus-Loop SCHARF GESCHALTET auf Prod (Tag 37) — autonome Dimension live + gegen echte Daten bewiesen.** Bewusste Vertrauens-Entscheidung nach vollständigem Pattern-Bau. Aktivierung via ENV (NICHT im git-Repo — `docker-compose.yml` `nolmi-runtime.environment` um `FOCUS_LOOP_ENABLED`/`FOCUS_LOOP_INTERVAL_HOURS` als `${VAR:-}`-Durchreichung ergänzt; Werte in der VPS-`.env` auf `srv1712371`). **Beobachteter erster autonomer Tick** (3-Min-Intervall fürs Beobachten): `[focus-loop] started` → nach Ablauf autonom (kein manueller Trigger) `[focus-loop] neuer Fokus-Snapshot erzeugt` für @markus (`focus_r4vIOdraLcl7Y8L9`, aus 1 Summary + 25 Turns) — supersedete den vorigen 3ms vor dem Insert (supersede-then-insert live korrekt), Invariante „genau 1 aktiv" hält; @florian/@heiko korrekt „zu wenig Substanz — kein Snapshot" (Halluzinations-Bremse greift bei substanzlosen Twins). **Danach Dauerzustand gesetzt: `FOCUS_LOOP_INTERVAL_HOURS=24`** (3-Min-Beobachtungswert war NUR temporär), Boot-Log `[focus-loop] started, interval 86400000ms`. 🔴 **Betriebszustand-Hinweis: der Fokus-Loop läuft ab jetzt DAUERHAFT autonom auf Prod (einmal täglich, substanz-gegated → 0 Token ohne neue Gespräche).** Kontrolle über Fokus-Tab (Sichtbarkeit) + Reset (Eingriff) steht. Reflexions-Loop bleibt unverändert AUS. **Damit ist das Aufmerksamkeit/Fokus-Pattern (4. der 8 Vision-Patterns) vollständig abgeschlossen — gebaut, deployt, verifiziert UND autonom scharf.**

**Vision-Pattern „Gewohnheiten/Rituale" — read-only Diagnose: heute NICHT baubar (Datenschicht misst das Falsche).** Diagnose vor Konzeption (Pattern war „Ist: offen", nicht „Foundation da"). 🔴 Befund mit echten Zahlen (Dev-DB @markus, die optimistische Schätzung; Prod jünger): 154 Audits/19 Tage haben Volumen, aber die Timestamps messen **Build-Aktivität, nicht Lebensrhythmus** — ein Muster daraus wäre trivial („arbeitet tagsüber an Nolmi"), instabil (So-Spike, Do=0, 4-Tage-Lücken = Sprint-Rauschen) und falsch-präzise. conversation_summaries für @markus = 0 (nie über Threshold) → thematische Quelle leer. Leitplanke bestätigt: Gewohnheiten sind Inferenzen über Markus → **pending-gated** (wie self-reflection-write owner), kein autonom-direkt wie Fokus — was bei schwachen Daten Approval-Müll erzeugen würde. **Entscheidung: nicht gebaut.** Schärfer als die Social-Suggestion-Lage: dort „feuert selten", hier „Daten sagen aktiv das Falsche". **Erkenntnis (größer als die Pattern-Wahl):** Die offenen Inferenz-Patterns zerfallen in zwei Klassen — datenHUNGRIG (Gewohnheiten, Werte-Drift, teils Lebens-Narrativ; brauchen organische Längs-Historie, die nach 34 Build-Tagen fehlt → erst post-launch erlebbar) vs. datenSCHAFFEND/-unabhängig (Schlaf/Träume erzeugt die fehlenden Summaries; Stufe-2-Ausbauten bestehender Patterns). Diagnose-Disziplin: ~2,5 Min read-only haben einen Fehlbau verhindert.

**Schlaf/Träume (#94) geprüft — ebenfalls daten-blockiert; Vision-Pattern-Achse vorerst ausgereizt.** Vor Konzeption das eigene BACKLOG gelesen: #94 hat explizite Vorbedingung „~50+ Fakten pro Twin, damit der Verdichtungs-Job sinnvolle Eingangsdaten hat — aktuell @markus ~8 Facts, zu wenig". Plus: conversation_summaries @markus = 0 (aus Gewohnheiten-Diagnose). #94 ist primär ein Facts-Kuratierungs-Job (dedupliziert/verdichtet Facts + Konversations-Insights), kein reiner Summary-Erzeuger → hängt SEHR WOHL an akkumulierter Historie (frühere Einordnung „datenschaffend, historie-unabhängig" korrigiert). Mit 8 Facts + 0 Summaries: nichts zu kuratieren → „mechanisch fertig, nicht erlebbar"-Falle wie Gewohnheiten. **Erkenntnis (strategisch): die Vision-Pattern-Achse ist vorerst ausgereizt.** Die 4 gebauten (Zeit-Erleben, Selbst-Reflexion, Soziale Proaktivität, Aufmerksamkeit/Fokus) standen auf vorhandener Foundation; die 4 offenen (Gewohnheiten, Werte-Drift, Schlaf/Träume, teils Lebens-Narrativ) brauchen organische Längs-Historie, die nach 34 Build-Tagen fehlt. **Trigger zum Wiederaufnehmen:** echte (Nicht-Build-)Nutzung über Wochen/Monate. Bis dahin sind andere Achsen (Distribution/Launch, Phase 4, UX-Welle 2, Backlog-Polish) die sinnvolleren Bau-Fronten. Diagnose-Disziplin (diesmal schon das BACKLOG-Lesen vor Code) hat den zweiten Fehlbau in Folge verhindert.

**Lebens-Narrativ (#7) geprüft — daten-blockiert; Vision-Pattern-Achse VIERFACH bestätigt ausgereizt.** Read-only Diagnose mit Scope-Klärung zuerst. 🔴 SCOPE: Vision meint Lesart (A) „Twin hat kohärente Story über SICH SELBST" (TWIN-VISION :79 neben Selbst-Reflexion :78; :205 „periodische Selbst-Zustand-Snapshots, Twin-Diary"), NICHT (B) Markus-Biografie. 🟡 Doku-Drift entdeckt: BACKLOG #97-Cross-Ref listet Lebens-Narrativ als „Story aus zeitlich verorteten Facts" = (B) — widerspricht der Vision; im Konflikt gewinnt Vision → (A). 🔴 Daten (Dev-DB @markus): Lesart (A) Quelle = Twin-Diary, real = 1 Eintrag (1 self-reflection executed, 1 rejected) → kein Bogen, nichts zu verweben (summaries=0-Falle). Lesart (B) = 9 Facts + 0 Summaries → dünn + pending-pflichtig (Inferenz über Markus). Beide tragen heute nicht. Leitplanke: (A) leitplanken-entspannt/autonom-fähig (Twin über sich, Klasse self-reflection subject='self'); (B) approval-pflichtig. **Damit alle 4 offenen Patterns daten-blockiert bestätigt (Gewohnheiten, Werte-Drift, Schlaf/Träume, Lebens-Narrativ) — die Vision-Pattern-Achse ist WIRKLICH ausgereizt, viermal diagnostisch belegt.** 🔑 ABER ein Unterschied: Lebens-Narrativ (A) ist der EINZIGE der vier mit internem Freischalt-Hebel — sein Diary wächst durch den (gebauten, aber ausgeschalteten) Reflexions-Loop autonom nach. Pfad: Reflexions-Loop scharf → Diary wächst über Wochen → dann trägt Lebens-Narrativ (A). Anders als Gewohnheiten (braucht Markus' organisches Leben) intern erzeugbar. **Maschinerie-Skizze (für später):** Verdichtung vieler Diary-Einträge zu einem Bogen (self-reflection-Generator als Vorbild, neuer Modus/Generator mit N Diary-Entries als Input); Speicher append-only wie focus_snapshots (Supersede+History passt zu „entwickelt sich"); Migration vermutlich ja. Abgrenzung sauber: Selbst-Reflexion = Einzel-Beobachtung, Lebens-Narrativ = Synthese über Zeit.

**#97 Facts-History / Validity-Windows ✅ gebaut (4 Sub-Schritte, lokal end-to-end verifiziert) — temporales Substrat für Werte-Drift + Lebens-Narrativ(B) + Zeit-Erleben.** Erster Bau nach der vierfach bestätigten Vision-Pattern-Sperre — bewusst ein SUBSTRAT-Item (nicht daten-blockiert, sondern „Gefäß jetzt, Auszahlung wenn Facts driften"; jeder Tag ohne es = künftiger Drift geht verloren). Diagnose-getrieben, Architektur-Glücksfall genutzt: alle 6 Schreib-Eintrittspunkte funneln durch FactsRepo.upsert/delete → History-Capture an zwei zentralen Stellen erfasst alles ohne Call-Site-Churn. **Schritt 1 (04c3c6d):** Migration 028_facts_history.sql — SEPARATE Tabelle (additiv, KEIN facts-Rebuild; facts unverändert, UNIQUE intakt, alter Code 1:1). change_type-CHECK nur 'value_change'/'delete' ('confidence_change' später additiv), Snapshot des alten Zustands, FK ON DELETE CASCADE. FactsHistoryRepo (record/getTimeline/getAsOf) als dummer Append-/Read-Store. **Schritt 2 (339637d) — der riskante:** Capture in upsert+delete, ATOMAR (db.transaction), NUR bei echtem fact_value-Drift (No-op/source/confidence erzeugen nichts). FactsHistoryRepo required Konstruktor-Arg → Compile-Garantie über alle 6 Stellen. Beleg (e) Atomarität: record() wirft → Rollback, facts unverändert (kein halber Zustand). **Schritt 3 (b37e52f):** owner-gated GET /twins/:handle/facts/:factKey/history (Leer→[]+200, kein twin_id, 403 für Nicht-Owner); Lese-Schutz formal bestätigt (kein History-Leak in den Prompt — alle current-Reads aus facts). **Schritt 4 (1809601):** UI — Lazy „▸ Verlauf"-Aufklappen pro Fact in facts/page.tsx (inline), nur-bei-Bedarf-Laden, Leer-Fall ruhig, dezent unter dem dominanten aktuellen Wert. Kein globaler Toggle, keine Twin-weite Sicht (beide additiv nachrüstbar). **Lokale End-to-End-Verifikation (Browser, echter Stack):** Drift Roding→München → Verlauf korrekt gerendert; Leer-Fall ruhig; visuell konsistent Light-Theme; Bonus — Atomarität (e) nochmal real gegen echte DB bestätigt (record() warf bei noch-nicht-migrierter History → Rollback hielt). 🔴 **Deploy-relevanter Nebenbefund:** Runtime wendet Migrationen NICHT beim Boot an — 028 muss explizit via Migrations-Sequenz (pnpm db:init o.ä.) angewendet werden, Boot allein reicht nicht. „mit-Migration"-Klasse → DB-Backup vor 028 zwingend. **Confidence-History + Twin-weite Sicht + getAsOf-Route bewusst zurückgestellt (additiv).** **Deployt + erreicht auf Prod (srv1712371, Tag 37).** Erste Prod-Migration seit 027. Sequenz Stop-and-Verify: hostname-Gate (srv1712371), diff --stat (additiv bestätigt — nur neue 028, kein facts-Rebuild), Rollback-Tags `*:rollback-65c0dc8` (alle drei), 🔴 WAL-konsistentes DB-Backup via better-sqlite3 .backup() VOR Migration (`twin.db.pre-028-2026-06-04T19-37-19Z`, 5165056 B = identisch zur DB, WAL war leer; bleibt liegen wie pre-027). Build runtime+web (literale NEXT_PUBLIC-Build-Args), Web-Bundle-Grep grün (`runtime.nolmi.ai` gebacken, kein `localhost:4000`). **Migrations-Mechanik geklärt:** Runtime-Boot wendet Migrationen via Dockerfile-CMD an (`node dist/scripts/init-db.js && exec node dist/index.js` — kompiliertes init-db, kein tsx) — NICHT in index.ts; die lokale Dev-Verwirrung kam vom direkten `node dist/index.js` ohne CMD. `--force-recreate` runtime+web (bridge unberührt) → Boot-Log `[db:init] 028_facts_history.sql angewendet`, `facts_history existiert: 1`, Server listening, **Fokus-Loop überlebte den Recreate (`[focus-loop] started, 86400000ms`)**, Bridge verbunden, reflection-loop weiter aus. **Live-Beleg gegen echte Prod-Owner-Session (Browser @markus):** Facts-Page zeigt „▸ Verlauf" pro Fact; Leer-Fall „Keine früheren Werte." ruhig; erster echter Prod-Drift erzeugt (business_partner-Wert geändert) → Verlauf zeigt „geändert von: <alter Wert> · <Zeit>". Das Substrat lebt — ab jetzt wird jeder Fact-Wert-Drift erfasst statt verloren. #97 „gebaut" → „erreicht".

## Tag 36 (3. Juni 2026, Mittwoch) — Setzung „launch-rund → Vision" + #744 Twin-Löschfunktion komplett

**Strategie-Setzung (Richtungs-Session):** Nächster Abschnitt = **launch-rund machen** (Hygiene vor Launch), substantielle Produkt-Achse **danach = Vision-Patterns** — bewusst NICHT Phase 4 (Multi-Channel/Föderation: premature reach, kein Differenzierungs-Story-Beitrag) und NICHT die volle UX-Stufe 2 (Casual-User = eigene Phase-B-Bau-Runde). Begründung: Differenzierung ist Memory + Persona + A2A, nicht Erreichbarkeit; Vision-Patterns sind billig (je 1–2 Tage Logik auf der 3.4-Foundation) und tragen die Launch-Story.

**#744 Twin-Löschfunktion ✅ komplett (3 Schritte, diagnose-getrieben):** Vorab read-only Diagnose statt Briefing-aus-dem-Gedächtnis — zu Recht: „DB regelt den Cascade" galt nur für 10 von 13 Tabellen, und der Bridge-Deregister existierte gar nicht.
- **Schritt 1 — Bridge-Deregister-Mechanik** (`ef2b832`): fehlender Gegenpart zu `registerHandleOnBridge` gebaut — `DELETE /twins/:handle` an der Bridge (Per-Twin-Bearer-Auth via `requireTwinAuth`/`getByToken`, NICHT der shared `X-Register-Token`), `TwinsRepo.delete()`, Runtime-Client `deregisterHandleFromBridge`. Isoliert an Wegwerf-Handle verifiziert. **Befund:** Idempotenz endet unter Per-Twin-Auth in 401 (Token lebt in derselben Row), nicht 404 → Deregister genau EINMAL mit lebendem Token VOR dem lokalen Löschen, best-effort im Caller-try/catch.
- **Schritt 2 — Runtime-Löschkern** (`f5cb42c`): owner-gegateter `DELETE /twins/:handle` (`requireOwner`), `deleteTwinLocal` als geordnete Transaktion mit `foreign_keys=ON` (Reihenfolge IST die Sicherheit, kein `foreign_keys_off`): conversation_summaries → audit → trust_relationships → embeddings+Shadows → twin_profiles[+Cascade]. Registry-Hot-Unload `removeTwin` (Gegenstück zu `addTwin`) inkl. Telegram-Bot-Teardown (die `bot-registry.ts:162-165`-Vorab-Notiz wartete auf genau diesen Hook; Teardown-Interface-Injektion vermeidet den Import-Zyklus). `EmbeddingsRepo.deleteByTwin` spiegelt `deleteByTarget` (Anti-Shadow-Drift statt handgeschriebener Deletes). Behavior-Gate 14/14: `foreign_key_check` LEER (mit bewusst geseedeter `conversation_summaries→audit`-Kante als Reihenfolge-Test), alle 13 Tabellen twin-scoped = 0, `embeddings_vec` konsistent (34==34), kein Kollateral an anderen Twins.
- **Schritt 3 — UI** (`77b9812`): Danger-Zone in Settings + `ConfirmDeleteTwinModal` (Type-to-confirm, Handle exakt tippen) auf bestehendem `ModalWrapper`; `bridgeOrphan:true` → sichtbarer Cleanup-Hinweis (kein Fehler); Switcher-Refresh + saubere Nach-Lösch-Navigation (verbleibender Twin oder /onboarding, keine tote `?twin=`-URL). Owner-Sichtbarkeit über schon owner-gescopetes `GET /twins` (kein neues Profil-Feld). HTTP-Contract via `app.inject` verifiziert (inkl. bridgeOrphan-Pfad über toten Port); **Browser-Durchklick manuell nachzuholen** (keine Browser-Automation im Repo, Client-Reibungen review-abgedeckt).

**Caveats (bewusst, dokumentiert):** (1) **Hard-Delete bricht bewusst die Soft-Delete-Konvention** (`twin-profiles-repo.ts:12` „kein delete(), nur setActive(false)") — `setActive(false)` löst das Handle-Frei-Problem nicht (Bridge-Registrierung + Daten blieben); `setActive(false)` bleibt als „deaktivieren" daneben bestehen. (2) **Bridge-Orphan recoverable, nicht still:** war die Bridge beim Löschen nicht erreichbar, bleibt der Handle dort registriert — UI zeigt den Hinweis, Bridge-seitiger Bootstrap-Cleanup steht im BACKLOG („Bridge-DB-Cleanup als Bootstrap-Schritt"). persona/mandates unangetastet (global, nicht twin-scoped).

**launch-rund abgeschlossen — First-Run-Hygiene-Diagnose + Doku-Sweep:** Read-only Diagnose aus Self-Hoster-Brille (erste 10 Min: `npm i -g nolmi` → onboard → erste Aktionen) — überwiegend 🟢/🟡, **kein zweites verstecktes #744**. onboard-Vorbedingungen (OS/git/docker/daemon), API-Key-Fehlererlebnis (Loop mit klarer Meldung) und Bridge-Reachability beim ersten Twin (Single-Host-Compose setzt interne Bridge-URL) sauber abgefangen. Einziger CREATE-ohne-Gegenstück-Fund: **Account/User-Delete** (das #744-Muster eine Ebene höher) — getrackt als eigenes Item, bewusst NICHT gebaut (semantisch heavy: User→Twin-Kaskade→A2A→FK-Audit `users(user_id)`; 🟡 heute, 🔴 sobald externe Nutzer onboarden). Doku-Sweep (`3f79c26`): npm-README-Staleness gefixt (sagte fälschlich „noch nicht publiziert" trotz `nolmi@0.1.0` live — der Tarball-Erstkontakt), plus zwei nice-Items getrackt (Port-Pre-Check vor `compose up`; SETUP.md-Provider-Framing Anthropic-Default). Damit ist „launch-rund" glaubwürdig durch.

**Vision-Achse gestartet — Pattern „Zeit-Erleben" Stufe 1 ✅** (`c2697e1`): erster der acht Vision-Patterns live im Prompt. Diagnose-getrieben (read-only): Datenschicht trägt, KEINE Migration für Stufe 1 — `RetrievalResult.createdAt` floss schon bis in `episodic/prompt-builder.ts`, wurde nur fallengelassen; `embeddings.last_accessed_at`+`access_count` waren bereits beim 3.4-Bau bewusst „fürs Zeit-Erleben-Pattern" angelegt (`embeddings-repo.ts:351`). Gebaut: `relativeTime(iso, now)`-Helper (deutsche Buckets „gerade eben"/„heute"/„gestern"/„vor X Tagen/Wochen/Monaten"/„vor über einem Jahr", kalenderbasiert, defensiv → "" statt Throw), `now`-Anker (Request-Zeitpunkt) in den Prompt-Pfad gereicht, Annotation in die **Block-Überschrift** (nicht in den Content — der bleibt byte-verbatim, respektiert den Anti-Halluzinations-Tenor). **Bewusst nur Episodic, NICHT Facts:** `created_at` eines Fakts ist nicht dessen Relevanz-Zeit, eine „vom 12. Mai"-Annotation an stabilem Wissen wirkt falsch; episodische Ereignisse tragen „vor 3 Wochen / gestern" inhaltlich korrekt. **Anschluss-Stufen (notiert, nicht jetzt):** Frequenz-Dimension Stufe 2 (episodic-only, schemafrei — `access_count`/`last_accessed_at` durch `RetrievalResult` plumben); Facts-Recency separat (bräuchte Schema `facts.last_accessed_at`); Selbst-Reflexion als reicheres zweites Pattern (Twin-Diary 3.4.F + Extract-Approval 3.3.F).

**Vision-Pattern #2 „Selbst-Reflexion" Stufe 1 ✅ komplett (beide Subjekte, pending-gated)** — diagnose-getrieben, mit ethischer Leitplanke als verdrahteter harter Regel. Diagnose (read-only) bestätigte: Leitplanke hält heute (kein autonomer Inferenz-Pfad über Markus; Diary manuell; Fact-Inferenzen approval-gated), Pending-Maschinerie ist **capability-agnostisch** (nur die Wirkung ist fakt-spezifisch), Diary prompt-verdrahtet, `triggered_by`-Enum hatte `'post_extract'`/`'scheduled'` schon reserviert. **Sequenziell gebaut** (nicht „beides auf einmal"), um den leitplanken-sensiblen Pfad isoliert zu beweisen.
- **Schritt 1 — Reflexion über Markus** (`b6702c6`): neue Capability `self-reflection-write`, Generator nach `ExtractionEngine`-Vorlage (Input-Assembly aus facts/summaries/Historie, NICHT memory-retrieval — query-gebunden untauglich). **Harte Regel (TWIN-VISION.md:145-150): Output IMMER Pending, nie autonom wirksam** — Trigger erzeugt nur einen Pending-Audit (`status=pending`, `output=null`), erst Approve schreibt ins Diary. Kern-Beleg gegen den echten Registry-TwinService-Dispatch (nicht nur die Engine): (a) Trigger → Pending, Diary=0; (b) Approve → Diary=1, Text==Pending. Halluzinations-Bremse im Prompt (`hasEnoughSubstance=false` → keine Reflexion; leer ist besser als erfunden). Manueller Trigger `twin:reflect <@handle>` (kein Background-Loop — `'scheduled'` bleibt Stufe-2-reserviert).
- **Schritt 2 — Reflexion über sich selbst** (`c344d52`): additiv als **Modus** innerhalb derselben Capability (`subject: 'owner' | 'self'` im Audit-input), keine zweite Capability. Ein Generator mit `subject`-Param (zwei Funktionen wären 90 % Duplikat), eigener self-System-Prompt (Twin reflektiert über sein EIGENES Twin-Verhalten, Identitäts-Leitplanke „gibt sich nie als Markus aus" bleibt; introspektiv, leitplanken-entspannter weil keine Inferenz über einen Menschen). CLI-Flag `--self`. Inbox subject-aware (self-Header „über sich selbst" vs. owner „über dich"); Legacy-Pending ohne `subject` defaultet defensiv auf `'owner'` (kein Bruch). Belege a–f grün (self Pending→Approve→Diary; owner-Regression; Inbox-Doppel; Leer-Fall; semantic-fact-write unberührt).
- **Verifikations-Vorbehalt (bewusst):** Belege nutzen einen deterministischen LLM-Mock — der `subject`-Plumbing-Pfad ist real bewiesen, die introspektive **Text-Qualität** des echten LLM-Calls war im Bau noch ungeprüft — **inzwischen eingelöst (Tag 36, realer Lauf):** `twin:reflect @markus` + `--self` gegen Claude Opus 4.7 lieferten beide substanzielle, evidenzgestützte Reflexionen im korrekten Vorschlags-Ton (owner: erkannte korrekt die Diagnose-/Smoke-Test-Phase aus den Owner-Turns; self: beobachtete das eigene reflexhafte „Läuft."/„Bestätigt."-Antwortmuster inkl. der einen Ausnahme). Approve→Diary / Reject→nichts per Auge bestätigt (`twin:diary-list`: genau 1 Eintrag, die rejectete spurlos). Der Prompt trägt ohne Mock. **Zurückgestellt (notiert):** dedizierter `'reflection'`-Diary-Enum-Wert (🟡, mit nächster Diary-Migration bündeln); Background-Loop-Trigger `'scheduled'` = Stufe 2; Frequenz-Dimension bei Zeit-Erleben = Stufe 2 (episodic-only, schemafrei).

**Selbst-Reflexion Stufe 2 — autonomer opt-in `'scheduled'`-Loop ✅** (`6db32bf`): erstes Pattern mit AUTONOMER Dimension — der Twin reflektiert von sich aus, nicht nur auf manuellen Trigger. Diagnose-getrieben; die befürchteten 🔴 (Dedup nicht billig / Multi-Tenant-Key-Problem) traten NICHT ein. `ReflectionLoopService` nach `oauth/refresh-service`-Vorlage (start/stop idempotent, per-Tick-`.catch`, per-Twin-`try/catch`, ENV-Disable-Guard). **Leitplanke unverändert: autonom ausgelöst erzeugt die Reflexion NUR ein Pending, nie etwas Wirksames** (Beleg d: Happy-Path → 1 Pending `output=null`, kein Diary). **Bewusst nur `'self'`-Modus im Loop, NICHT `'owner'`** — autonome Inferenzen über Markus bleiben die sensibelste Klasse und damit manuell; Selbst-Beobachtung ist die leitplanken-entspanntere, die autonom laufen darf. **Dedup = beide Guards (Skip VOR LLM-Call → 0 Token):** Guard A „max 1 offenes Pending pro Twin" (indizierte audit-Query) stoppt die Flut; Guard B „nur bei neuer Substanz seit letzter Reflexion" (ein `EXISTS`-OR über conversations/facts/summaries) stoppt niedrigwertige Wiederholungen über unveränderte Daten. **Generator-Erweiterung (verbessert auch den manuellen Pfad):** jüngste Diary-Reflexionen als „Schon notiert — nicht wiederholen"-Kontext im `'self'`-Prompt (Vorbild: ExtractionEngine gibt existierende Facts mit). **Opt-in, Default AUS** (`REFLECTION_LOOP_ENABLED=false`, `REFLECTION_LOOP_INTERVAL_HOURS=24`, Advanced-Block) — autonome Token-Kosten + autonome Pending-Erzeugung als bewusste Self-Hoster-Entscheidung. `removeTwin` (#744) greift automatisch (Loop iteriert `registry.list()` → gelöschter Twin sofort raus). Belege a–h grün. **Verifikations-Vorbehalt (bewusst):** Loop NICHT echt durchlaufen — `runTick`/`reflectForTwin` direkt gerufen (Stub-Registry + Spy, reale Dedup-Queries); die Prozess-Verdrahtung ist **inzwischen auge-bestätigt (Tag 36, scharfer `REFLECTION_LOOP_ENABLED=true`-Boot):** Boot-Log `[reflection-loop] started, interval 86400000ms (self-mode, opt-in)` (Start nach `listen` + ENV-Guard greift) und beim SIGINT `[reflection-loop] stopped` (Shutdown-Hook cleart das Interval). Der einzige nicht beobachtete Rest ist „setInterval feuert nach Ablauf runTick" = Standard-Node-Verhalten (runTick selbst ist via Belege a–h getestet). **Zurückgestellt:** `'owner'`-Loop (eigene spätere Entscheidung); Frequenz-Dimension bei Zeit-Erleben (Stufe 2, schemafrei).

**Vision-Pattern #3 „Soziale Proaktivität" Stufe 1 ✅** (`7c871be`): der Twin schlägt vor „Dein letzter Kontakt mit @<partner> war vor <Zeit> — willst du dich melden?" — pending-gated, Markus entscheidet. Diagnose-getrieben mit **Phase-4-Grenze als Hauptaufgabe** (Soziale Proaktivität als Vision-Pattern vs. Phase 4.3 Beziehungs-Modell). **Zwei Grenz-Disziplinen als harte Regeln gehalten:** (1) **binäres Trust + Recency, KEIN graded Vertrautheits-Level** (das wäre Phase 4.3) — der Vorschlag liest nur bekannte A2A-Partner + letzten Kontakt; (2) **Approve = NO-OP/Acknowledge, KEIN autonomer Twin-Send** — das ist die Stufe-1/2-Grenze (Mensch meldet sich, nicht der Twin). Kern-Grenz-Beleg: `approveSocialSuggestion` macht ausschließlich `audit.complete(executed)`, kein Bridge-Aufruf, `bridgeClient===null`, Send-Audit-Count unverändert. **Rein datengetrieben, KEIN LLM-Call** (deterministisch aus Partner + Recency-Schwelle — keine Token-Kosten, keine Halluzinations-Frage). Neue Capability `social-suggestion` in der bekannten Audit-Pending-Maschinerie; `relativeTime()` (Zeit-Erleben) wiederverwendet; Dedup „max 1 offenes Pending pro Partner"; Schwelle `SOCIAL_NUDGE_THRESHOLD_DAYS` (Default 21); manueller Trigger `twin:social-nudge <@handle>` (kein Loop-Anschluss — späterer Schritt). **Bau-Befund (Annahme korrigiert):** A2A-Audits tragen real meist KEIN `conversation_id` (`with_conv=0`) — die Diagnose-Annahme „Recency primär über Audit-MAX pro Conversation" hätte echte Partner verfehlt; robust gelöst per `COALESCE` auf die immer gefüllten Konversations-Timestamps (`started_at`/`ended_at`/`last_reset_at`), Audit-MAX als Bonus wo verknüpft. Belege a–g grün (gesteuerte Seed-Daten). **Verifikations-Vorbehalt (bewusst, anders als Reflexion):** „Mechanik fertig, Demo später" — gegen Seed-Daten bewiesen, aber heute NICHT real erlebbar (dünner A2A-Graph; Vorschlag feuert real selten, Leer-Fall sauber). Da deterministisch (kein LLM), steht KEINE Output-Qualität aus — offen ist nur, ob Schwelle (21 d) + `COALESCE`-Recency sich gegen echten A2A-Verkehr sinnvoll anfühlen (zeigt sich nach Launch, wenn Beziehungen wachsen). **Zurückgestellt:** Loop-Anschluss (Stufe 1.5/2); autonomer Reach-out (Stufe 2 = Phase-4-nah).

**Prod-Deploy Tag 36 — drei Vision-Patterns + #744 live auf srv1712371** (`6e32813`→`c6d5479`): einfacher Deploy (KEINE Migration, Stand bleibt 026 → kein Schema-/Daten-Risiko), alle drei Container neu gebaut — **diesmal inkl. bridge** (Abweichung vom „bridge unberührt"-Muster, nötig wegen #744-1-Deregister-Endpoint; Rollback-Tags `*:rollback-6e32813` für alle drei). Stop-and-Verify an jedem Schritt: Web-Bundle gegen `https://runtime.nolmi.ai` verifiziert (Literal-Build-Arg, der `DEPLOYMENT.md`-§3-Grep-Pfad war relativ falsch → absolut `/app/apps/web/.next` korrigiert, Merker fürs Doc), Boot-Log bestätigt `[reflection-loop] disabled` (Loop läuft auf Prod NICHT — gewollt), Bridge erreichbar über internes Docker-Netz (kein ECONNREFUSED). **Live-Beleg Zeit-Erleben:** @markus im Prod-Chat verortet Erinnerungen jetzt zeitlich („Ein älteres Fragment vor ca. 3 Wochen", „vor ca. 2 Wochen") — die Episodic-Recency-Annotation wirkt gegen echte Daten; der Twin halluziniert nicht über dünne alte Fragmente („nichts dazuerfinden"). „Gebaut" → „erreicht". Nebenbefund (sauber): falscher Server (`srv1046432`, alter Stack) zu Beginn erwischt + korrigiert; `docker tag` dort folgenlos.

**Reflexions-Trigger-Lücke entdeckt + UI-Trigger gebaut** (`88e9fc8`): Prod-Test der Selbst-Reflexion deckte auf, dass sie auf Production GAR NICHT auslösbar war — das CLI `twin:reflect` ruft den Generator direkt in-process und braucht `tsx`, das im Prod-Build (`pnpm deploy --prod`) fehlt; ein UI-Trigger existierte nicht; der Loop ist bewusst aus. Zusätzlich: der bestehende Chat-Button „Reflektieren" machte in Wahrheit **Fact-Extraktion** (`POST /facts/extract`) — Fehlbenennung, in die der Prod-Test lief. **Gefixt:** neue owner-gegatete Route `POST /twins/:handle/reflect` (Vorlage `facts/extract`; greift `entry.service.reflectionEngine.reflect(subject)` — wie diagnostiziert erreichbar; Output bleibt Pending, kein autonomer Effekt); echter UI-Trigger „Reflektieren ▾" im Chat-Header mit zwei Modi („Über dich"=owner / „Über sich selbst"=self, konsistent zu den Inbox-Headern); der fehlbenannte Button heißt jetzt ehrlich „Fakten extrahieren". Belege a–e grün (Route-Contract via app.inject; **UI-Klick nicht browser-automatisiert** — review-/contract-abgedeckt, wie #744 Schritt 3). **Deployt auf Prod (Tag 36, `c6d5479`→`017af80`, nur runtime+web, bridge unberührt, keine Migration)** — und end-to-end gegen echte Daten verifiziert: UI-Button „Reflektieren → Über sich selbst" → `/reflect`-Route → Pending in der Inbox; die Reflexion gegen die echte Prod-Historie war substanziell + evidenzgestützt (Twin erkannte sein eigenes Muster „nach fast jeder Aussage strukturierte Folge-Checkliste, fast reflexartig", mit Beleg-Turns), pending-gated, von Markus approved → im Diary. Der Mittags-Befund (Reflexion auf Prod nicht auslösbar) ist damit eingelöst. Naming-Fix live („Fakten extrahieren" vs. „Reflektieren ▾"). Nebenbefund: `frontend-design`-Skill nicht auffindbar → bestehende Tailwind-Tokens/Button-Stil gespiegelt. **Analoge Lücke offen (notiert, nicht gebaut):** Social-Suggestion ist ebenfalls CLI-only ohne Route — eigenes späteres Item, gleiche Vorlage.

**Telegram-Empfang debuggt + UNIQUE-Bug gefixt** (`0438c5d`): @markus neu mit Telegram verbunden (Bot @nolmi_bot) → Pairing funktionierte, aber Bot antwortete nicht. Diagnose (read-only): Webhook war bei Telegram nicht registriert — `RUNTIME_PUBLIC_URL`/Webhook-Mode in der `.env` KORREKT, also kein `.env`-Problem; der Re-Pairing-Pfad löste `setWebhook` nicht aus (`bot-registry.ts:21` setzt ihn beim Eager-Load bewusst NICHT; ausgelöst wird er nur über die Token-Route `api-routes.ts:143`). **Workaround verifiziert:** „Token ändern" in Settings→Channels (gleicher Token) triggert `setWebhook` → Empfang repariert (`POST /webhooks/telegram/@markus` kommt an). Danach trat ein ZWEITER, älterer Bug zutage: jeder eingehende Message-Insert scheiterte an `UNIQUE constraint failed: telegram_messages (twin_id, telegram_chat_id, telegram_message_id)` → handler-error, keine Reply. Ursache: plain INSERT ohne Conflict-Handling seit Phase 1 (2026-05-23) — KEIN heutiger Commit beteiligt (`git log --since=2026-06-03 -- apps/runtime/src/telegram` leer); die Webhook-Reparatur legte den latenten Bug frei (Telegram-Redelivery des aufgestauten Backlogs). Der Doc-Kommentar versprach Idempotenz, die SQL implementierte sie nie. **Fix `0438c5d`:** Insert idempotent (`ON CONFLICT(...) DO NOTHING`), `changes===0`-Fall holt die existierende Row übers UNIQUE-Tripel (statt NotFound-Throw auf nie-geschriebene id); inbound-Insert fehlertolerant gekapselt (DB-Hiccup unterdrückt nie mehr die Reply). 13/13 Behavior-Checks grün gegen echtes UNIQUE-Schema. Nur runtime, keine Migration. **Deployt auf Prod (Tag 36, `017af80`→`0305d55`, nur runtime, keine Migration) + gegen echte Daten verifiziert:** frische Telegram-Nachricht an @nolmi_bot → `POST /webhooks/telegram/@markus` empfangen, KEIN UNIQUE-/handler-error mehr, aufgestauter Redelivery-Backlog dedupt durchgelaufen, Twin antwortete substanziell über OAuth (mit korrektem Memory-Abruf + Anti-Halluzinations-Haltung). Telegram end-to-end funktionsfähig — Empfang (via „Token ändern"→setWebhook) UND Verarbeitung (idempotenter Insert) repariert. Offen bleibt nur der getrackte setWebhook-Re-Connect-Automatismus (BACKLOG).

## Tag 29 (27. Mai 2026, Mittwoch) — Pre-Launch-Phase A Block 4 Self-Hosting-Polish

**Stand Tag 29 Block 8:** **Beide Tag-29-Items vollständig in Production.** #135 Account-Settings UI live seit Block 3 (`3561122`, Smoke 7/7), #122 MCP-Server-Auto-Provisioning live seit Block 7 (`cbc0d4c` mit Dockerfile-Fix als Sub-Block A) — Production-Smoke grün mit Twin `twin_qHZZCooUhCHMYutw` + MCP-Server `mcp_wIn0_jJ35wdqc4-c` + 11 Tool-Skills, Filesystem-Sanity (`/app/mcp-servers/` mit 4 Files), Cleanup via PRAGMA-Pattern (Lesson Tag 29 #4) — FK-Cascade in Production live verifiziert.

### Block 1 — #135 Account-Settings UI (Email/Password-Edit)

| Block | Item | Commit | Aufwand | Was |
|---|---|---|---|---|
| Block 1 | #135 Account-Settings UI (Email/Password-Edit) | `f39b14f` | ~3h | UsersRepo um `updateEmail` (Email-Uniqueness-Pre-Check, `UserAlreadyExistsError`) + `updatePassword` (bcrypt cost 12) erweitert. Zwei neue Endpoints `PATCH /auth/me/email` + `PATCH /auth/me/password` (Session-Check + `verifyPassword`-Confirm + Zod-Validierung min 8 Zeichen). Route `/account` mit zwei separaten Forms (Email-Change + Password-Change), Live-Validation auf Passwort-Mismatch + Mindestlänge, toast-Feedback. ProfileMenu-Link „Account" oberhalb Logout. Middleware `PROTECTED_PREFIXES` um `/account` ergänzt. Typecheck 4/4 grün, Husky-Build 4/4 grün, Local-Smoke 7/7 grün. |
| Block 2 | #135 Closure-Doku | `3561122` | ~10 Min | STAND-Tag-29-Section mit Block-1-SHA + Smoke-Status, BACKLOG #135 als ✅ Tag 29 DONE finalisiert (Smoke-Bestätigung in Status-Notiz), Tag-29-Outcome-Bilanz nach Block 1 initialisiert. |
| Block 3 | #135 Production-Deploy | (Deploy-Action) | ~20 Min | `git pull origin main` auf VPS `srv1046432` zog `f39b14f` + `3561122` (Drift ab Tag-28-Block-20 `7453bd9` → `3561122`, ~2 Code-Commits + 1 Doku). **Bridge bewusst nicht rebuilt** — Lesson Tag 28 #15 angewandt: #135 fasst nur Runtime + Web an, Bridge-Schema unverändert. `docker build` runtime + web mit korrektem `--build-arg NEXT_PUBLIC_RUNTIME_URL=https://runtime.twin.harwayexperience.com` (aus Tag-28-Lesson #13), `docker compose up -d --force-recreate runtime web` grün. Production-Smoke 7/7: Login → `/account` via ProfileMenu → Email-Change Happy-Path → Re-Login mit neuer Email → Password-Change Happy-Path → Re-Login mit neuem PW → Edge-Cases (401 falsches PW, 409 kollidierende Email, Submit-Disabled bei `<8` und Mismatch). DB-Verify: `markus.baier@harway.de`, `updated_at: 2026-05-27T16:08:18.760Z` (Audit-trail-fähig). Nach Smoke Original-Email + Original-Passwort restored. |
| Block 4 | #135 Production-Deploy-Closure-Doku | `93421be` | ~10 Min | STAND Block 3+4, BACKLOG-Status um Production-Deploy + DB-Verify + Original-Restore, Tag-29-Outcome auf „1 Closure inkl. Production", Lesson Tag 29 #1 (Bridge-Skip aus Tag-28-Lesson #15 sauber angewandt). |
| Block 5 | #122 MCP-Server-Auto-Provisioning im Wizard | `a3c6b3a` | ~3.5h | `packages/shared`: neues `PresetSelectionSchema` (`presetId` + `mcpServerKeys`-Record), `PresetActivationResult.mcpServers[]` mit `added`/`skipped`/`failed`-Status. `RuntimeConfig.mcpServersDir` neu (default `WORKSPACE_ROOT/mcp-servers`), in `ServerDeps` durchgereicht. `activate-presets.ts` Komplett-Refactor: Input-Type von `presetIds: string[]` auf `PresetSelection[]` umgestellt, pro Preset → Skill-Import + Schleife über `requiresMcpServers` mit `provisionMcpServer`-Helper (Idempotenz-Check via `findByName`, Template laden, Zod-Validation via `McpServerSpecSchema`, env-`"?"`-Marker durch User-Key ersetzen, `mcpServersRepo.add` + `entry.service.mcpSkillSync.syncOnAdd`, Rollback bei Sync-Failure spiegelt `server.ts:1556-1573`). `OnboardingSubmitSchema`: `presets: string[]` → `presetSelections: PresetSelection[]`. Settings full-config-PATCH wrappt `body.presets.map(id => ({ presetId: id, mcpServerKeys: {} }))` — bestehendes Verhalten (kein Auto-Provisioning aus Settings). Wizard State `presetsSelected: string[]` → `presetSelections: Record<id,{enabled,mcpServerKeys}>`. PresetCard refaktoriert (nicht mehr `<button>`-only — Card-Frame `<div>` mit Header-Button + Inline-Env-Form als Geschwister, sonst nested-input nicht möglich). `useMemo`-`hasMissingKeys` für Soft-Block-α. Typecheck 4/4 grün, Husky-Build 4/4 grün. **Local-Smoke 4/4 grün:** (1) Happy-Path Recherche-Preset mit Hyperbrowser-Provisioning grün — DB-Verify Twin `twin_u7QzPozUBNdbM3yh` + `hyperbrowser-approval`-Server + 11 Tool-Skills (`mcp:hyperbrowser-approval:*`) + Recherche-Pattern-Skill. (2) Soft-Block α verifiziert — Preset enabled ohne Key → Submit disabled + Tooltip. (3) No-Preset-Backward-Compat grün — Skip-Default unselected, Submit grün, Twin ohne Skills/MCP-Server. (4) Error-Edge mit Dummy-Key sauber — Provisioning succeeds (Spawn + `listTools` validieren den Key nicht), Tool-Call failt ehrlich mit Twin-Antwort als zwei-Optionen-Vorschlag („retry" oder „trockene Liste aus MCP-Stand") statt zu hallucinieren oder generisch zu errorn (siehe Lesson Tag 29 #3). |
| Block 6 | #122 Closure-Doku + Lessons-Welle + neues BACKLOG-Item | `bdc2160` | ~25 Min | STAND-Tag-29 Block-5 um Refactor-Sichtbarkeit + Twin-ID + Pfad-4-Twin-Antwort-Detail ergänzt, Block-6 selbst als Tabellen-Zeile. BACKLOG #122 als ✅ Tag 29 DONE mit ausführlicher Status-Notiz (Soft-Block-α + Skip-Default + Reuse-Liste). Tag-29-Outcome auf 2 Closures + 6 Blöcke + ~7h Netto + 1 neues BACKLOG-Item. **Drei Lessons** Tag 29: #2 MCP-Sync ist Server-level, #3 Twin-Antwort bei Auth-Failure ist Persona/Mandate-Win, #4 SQLite-FK-Cascade braucht `PRAGMA foreign_keys = ON` per Connection. **Neues BACKLOG-Item #159** FK-Cascade-Check für User/Twin/Owner-Relations (S, nice, Phase B, Cross-Ref Lesson #4). |
| Sub-Block A | Pre-Flight + Dockerfile-Fix `mcp-servers/` | `cbc0d4c` | ~10 Min | **Pre-Flight-Check vor Production-Deploy:** `grep mcp-servers apps/runtime/Dockerfile` → nur `examples/`-COPY (Z. 74) gefunden, `mcp-servers/` fehlte. WORKSPACE_ROOT resolved im Container auf `/app` (weil `__dirname` = `/app/apps/runtime/dist`), `mcpServersDir = resolve(WORKSPACE_ROOT, "mcp-servers")` → `/app/mcp-servers` — ohne COPY würde der Wizard-Submit beim Template-Load soft-failen. Fix: `COPY mcp-servers /app/mcp-servers` analog #120-Pattern (Z. 74-78 Dockerfile), Pattern 1:1 aus Tag-20-Lesson übernommen. Runner-Stages 5 → 6. Husky-Build grün, Push grün. **Präventiv via Pre-Flight gefunden statt durch Smoke-Failure** — Lesson Tag 29 #5. |
| Block 7 | #122 Production-Deploy | (Deploy-Action, Code-SHA `cbc0d4c`) | ~25 Min | `git pull origin main` auf VPS `srv1046432` zog `a3c6b3a` (Block 5 #122-Code) + `602bb5c` + `bdc2160` (Block 6 Closures) + `cbc0d4c` (Sub-Block A Dockerfile). Runtime + Web rebuilt mit korrektem `--build-arg NEXT_PUBLIC_RUNTIME_URL=https://runtime.twin.harwayexperience.com` (Tag-28-Lesson #13), **Bridge bewusst nicht rebuilt** (Lesson Tag 29 #1, kein Bridge-Code-Change). `docker compose up -d --force-recreate runtime web` grün. **Boot-Verify clean:** 3 Twins aktiv (@markus, @florian, @heiko), bridge-stream verbunden, oauth-refresh started. **Filesystem-Sanity:** `ls -la /app/mcp-servers/` zeigt 4 Files (`everything.json`, `everything-approval.json`, `hyperbrowser-approval.json`, `README.md`) — Sub-Block-A-Fix greift. **Production-Smoke grün** mit Test-User `test-122-prod@harway.local` + Twin `@test122prod` + Recherche-Preset + Dummy-Hyperbrowser-Key: DB-Verify `twin_qHZZCooUhCHMYutw` + MCP-Server `mcp_wIn0_jJ35wdqc4-c` (`is_active=1`) + 11 Skills (1 `recherche-workflow` + 10 `mcp:hyperbrowser-approval:*`-Tool-Skills) — strukturell identisch zum Local-Smoke. **Cleanup via PRAGMA** (`db.pragma("foreign_keys = ON")`, Lesson Tag 29 #4): Twin + MCP-Server + Skills + User in einer Operation kaskadiert weg, Post-Cleanup-Counts beide `c: 0` — **FK-Cascade in Production funktional verifiziert** (Lesson Tag 29 #6). |
| Block 8 | #122 Production-Closure-Doku | (dieser Commit) | ~15 Min | STAND-Tag-29 um Sub-Block A + Block 7 erweitert, Block 8 selbst als Tabellen-Zeile. BACKLOG #122 Production-Deploy-Hash `cbc0d4c` + Sub-Block-A-Erkenntnis ergänzt. Tag-29-Outcome auf 7 Blöcke + Sub-Block A + ~7.5h Netto + **2 Closures (#135 + #122) jetzt beide Code + Doku + Production**. **Zwei neue Lessons:** #5 Pre-Flight-Diagnose vor Production-Deploy spart Smoke-Failure-Detour (Cross-Ref #120 + #159), #6 SQLite-FK-Cascade in Production verifiziert (#159 teil-verifiziert). |

**Phase-A-Setzungen umgesetzt (aus Tag-26-Briefing):**
- Email-Change-Flow: direkt umstellen, kein Verify-Link (Phase-A-pragmatisch für drei dev-fitte Owner)
- Password-Change-Flow: Old-Password als Confirm-Pflicht
- Account-Delete: **defer** auf eigenes Item (semantisch heavy — Twin-Kaskadierung, A2A-Konversationen)
- Email-Verify-Flow: **defer** auf Phase B

**Diagnose-First-Befunde (vor Code-Änderung):**
- `getCurrentUser(request, db)` ist der existing Session-Pattern (bereits in `/auth/me`, `/auth/register`, ...)
- Kein `toPublicUser`-Helper — Endpoints bauen Response manuell: `{ userId, email, displayName }`. Pattern 1:1 für PATCH-Endpoints übernommen.
- `apps/web/lib/toast.ts` wrappt sonner (UX.1.A.1 Pattern aus Tag 22)
- Middleware-`PROTECTED_PREFIXES` ist die saubere Stelle für neue protected Routen
- AppHeader rendert ProfileMenu global — keine Page-spezifische Integration nötig

**Code-Hotspots:**
- `apps/runtime/src/auth/users-repo.ts:107-141` — zwei neue Methoden, beide normalisieren bzw. hashen analog `create()` (DRY-Konsistenz). Repo wirft NotFound nicht — Returnt `null`, Caller-Endpoint mappt auf 404.
- `apps/runtime/src/server.ts:918-988` — zwei neue PATCH-Endpoints nach `/auth/me`. Email-Endpoint: 400 (Schema), 401 (nicht eingeloggt / falsches Passwort), 409 (Email vergeben), 200. Password-Endpoint: 400, 401, 200 mit `{ ok: true }`.
- `apps/web/app/account/page.tsx` — 250 LOC, zwei `<section>`-Cards mit `border + bg-surface` Pattern aus Settings, separater Busy-State + Submit-Disabled-Logic pro Form.
- `apps/web/components/ProfileMenu.tsx:148-156` — Account-Link zwischen Settings und Divider.
- `apps/web/middleware.ts:20` — `/account` in `PROTECTED_PREFIXES`.

### Tag-29-Outcome-Bilanz

**Item-Closures Tag 29:**
- #135 ✅ Account-Settings UI **Code + Doku + Production** (Block 1 Bau `f39b14f`, Block 2 Closure-Doku `3561122`, Block 3 Production-Deploy auf `3561122` mit Production-Smoke 7/7 grün + DB-Verify `markus.baier@harway.de` `updated_at: 2026-05-27T16:08:18.760Z`, Original-Werte restored, Block 4 Production-Closure-Doku `93421be`)
- #122 ✅ MCP-Server-Auto-Provisioning im Wizard **Code + Doku + Production** (Block 5 Bau `a3c6b3a`, Block 6 Closure-Doku + Lessons + #159 `bdc2160`, Sub-Block A Pre-Flight + Dockerfile-COPY `cbc0d4c`, Block 7 Production-Deploy auf `cbc0d4c` mit Production-Smoke grün — Twin `twin_qHZZCooUhCHMYutw` + MCP-Server `mcp_wIn0_jJ35wdqc4-c` + 11 Tool-Skills, FK-Cascade-Cleanup via PRAGMA funktional verifiziert, Block 8 Production-Closure-Doku)

**Neue BACKLOG-Items aus Tag 29:**
- **#159** FK-Cascade-Check für alle User/Twin/Owner-Relations (S, nice, Phase B) — aus Lesson Tag 29 #4 entstanden, **in Production teil-verifiziert** durch Block-7-Cleanup (Twin + MCP-Server + Skills + User kaskadieren weg, wenn `PRAGMA foreign_keys = ON` gesetzt ist). Verbleibender Scope: Audit der DB-öffnenden Code-Pfade auf konsistente PRAGMA-Setzung + DB-CLI-Cheat-Sheet.

Account-Delete und Email-Verify-Flow (aus #135) und ein Settings-API-Key-UI für nachträgliches MCP-Provisioning (Konsequenz aus #122 Settings-Path-Soft-Fail) bleiben unbeschriftet — wenn sie konkret werden, legt der jeweils briefende Block ein neues Item an.

**Tag-29-Total bis Block 8:** **2 Closures** (#135 + #122, beide Code + Doku + Production), **7 Blöcke + Sub-Block A**, ~7.5h Netto (Block 1 #135-Bau ~3h, Block 2 Closure-Doku ~10 Min, Block 3 #135-Production-Deploy ~20 Min, Block 4 Production-Closure-Doku ~10 Min, Block 5 #122-Bau ~3.5h, Block 6 Closure-Doku + Lessons + #159 ~25 Min, Sub-Block A Pre-Flight + Dockerfile-Fix ~10 Min, Block 7 #122-Production-Deploy ~25 Min, Block 8 Production-Closure-Doku ~15 Min). **1 neues BACKLOG-Item** (#159).

**Lessons Tag 29:**

- **Lesson Tag 29 #1: Production-Deploy ohne Bridge-Rebuild wenn kein Bridge-Code touched.** Tag-28-Lesson #15 hatte das Multi-Service-Deploy-Briefing als Risiko markiert (Bridge wurde übersehen, weil das Briefing nur Runtime + Web nannte). Block 3 Tag 29 wendet die Lesson aktiv in die **andere Richtung** an: bewusste Bridge-Skip. #135 fasst ausschließlich `apps/runtime/src/auth/` + `apps/runtime/src/server.ts` + `apps/web/**` an, das Bridge-Schema (`MessageType`-Union etc.) bleibt unverändert. Deshalb nur runtime + web rebuilt + recreated, Bridge-Container unangetastet. Generelles Prinzip: Multi-Service-Disziplin schneidet in beide Richtungen — bei Schema-Changes muss man alle Services rebuilden, bei Single-Service-Items muss man die anderen bewusst nicht anfassen, sonst riskiert man unnötige Downtime + Cache-Warm-up. **Mini-Checkliste vor Deploy:** `git diff <last-prod-sha>..HEAD --name-only` → welche `apps/*` und `packages/*`-Verzeichnisse sind im Diff → exakt diese Container rebuilten, alle anderen lassen.

- **Lesson Tag 29 #2: MCP-Sync ist Server-level, nicht Skill-level.** Block-5-Smoke 1 hat gezeigt: nach `mcpSkillSync.syncOnAdd(serverId)` landen **alle** Tools des MCP-Servers als Tool-Skills in der DB — nicht nur die, die im Preset-Frontmatter unter `requires_tools` referenziert sind. Beispiel: das `recherche-workflow`-Preset listet z.B. `mcp:hyperbrowser-approval:search_with_bing` + `mcp:hyperbrowser-approval:scrape_webpage` in `requires_tools`, aber `syncOnAdd` legt 11 Tool-Skills an (alles, was `listTools` vom Subprocess zurückgibt). Das ist **by design** (vgl. `mcp/skill-sync.ts:60-99` und Lesson aus Tag 21 zum Auto-Tool-Picker): Subset-Synchronisation würde stille Drift erzeugen, wenn der MCP-Server später neue Tools dazubekommt. **Konsequenz für Preset-Definition:** `requires_tools` ist ein **Pre-Pass-Hint** für die Tool-Forcing-Heuristik (welche Tools der Pattern-Skill kennen muss, um Pre-Pass-Forcing zu triggern), nicht ein Tool-Filter für die Provision-Phase. Wer in Zukunft erwartet, dass `requires_tools` die DB-Skill-Liste limitiert, muss das explizit als Sub-Schritt bauen (z.B. `skillRepo.setActive(false)` für Out-of-Scope-Tools post-Sync) — und sollte vorher diskutieren, ob das die Drift-Frage löst oder neu eröffnet.

- **Lesson Tag 29 #3: Twin-Antwort bei Auth-Failure ist Persona/Mandate-Win, kein Bug.** Pfad-4-Smoke mit Dummy-Hyperbrowser-Key hat einen Bing-Auth-Failure im MCP-Tool-Call getriggert. Default-Pattern wäre gewesen: Twin halluciniert eine erfundene Recherche-Antwort, oder das System rotzt eine generische Error-Trace raus. Stattdessen: der Twin hat **strukturiert** geantwortet mit zwei sauberen Optionen — („retry mit korrektem Key" ODER „trockene Liste aus aktuellem MCP-Tool-Stand"). Das ist Persona+Mandate-Win: Tool-Failure wird als **Erste-Klasse-Information für die Konversation** behandelt, nicht versteckt und nicht aufgeblasen. **Implikation für künftige Bau-Items:** Tool-Errors sollten dem LLM als reguläre Tool-Output-Message zurückgegeben werden (nicht als Exception verschluckt oder als Pre-Pass-Forcing-Loop hängen lassen), damit die Persona/Mandate-Layer entscheiden können, wie sie damit umgehen. Wenn ein künftiger Refactor das Error-Handling „cleaner" machen will: vorher prüfen, ob die strukturierte Twin-Antwort-Qualität dabei verloren geht.

- **Lesson Tag 29 #4: SQLite-FK-Cascade braucht `PRAGMA foreign_keys = ON` per Connection.** Bei Block-5-Smoke-Cleanups (Test-User + Test-Twin nach Smoke 1 und 4 löschen) sind via `sqlite3`-CLI Orphan-Rows in `twin_profiles` zurückgeblieben, weil `sqlite3` per default Foreign-Keys **nicht** enforced — das Pragma muss pro Connection explizit gesetzt werden. Application-Code macht das schon (`apps/runtime/src/scripts/_mcp-cli-helpers.ts:77-78` und gleichlautend in `init-db.ts` + allen anderen DB-Connectoren: `db.pragma("foreign_keys = ON")`), aber jede ad-hoc sqlite3-Shell-Session muss `PRAGMA foreign_keys = ON;` als ersten Befehl setzen. **Konsequenz:** für manuelle Cleanup-DELETEs (Test-User, Smoke-Twins) in DB-Sessions immer Pragma vorab. Sonst stehen z.B. nach `DELETE FROM users WHERE email='test@…'` die zugehörigen `twin_profiles`-Rows + `audit_log`-Rows + `mcp_servers`-Rows orphaned in der DB — bis zum nächsten Application-Boot mit korrekter Pragma-Config (und auch dann nicht, weil DELETE-CASCADE nur beim CASCADE-Trigger feuert). Aus dieser Beobachtung BACKLOG #159 (FK-Cascade-Check, S, Phase B): Verifikation dass alle DB-öffnenden Code-Pfade die Pragma setzen, plus DB-CLI-Cheat-Sheet für künftige Smoke-Cleanups.

- **Lesson Tag 29 #5: Pre-Flight-Diagnose vor Production-Deploy spart einen Smoke-Failure-Detour.** Vor dem #122-Production-Deploy (Block 7) hat ein simples `grep mcp-servers apps/runtime/Dockerfile` gezeigt: der `examples/`-COPY ist da (#120-Pattern), `mcp-servers/` fehlt komplett. Sub-Block A (`cbc0d4c`) hat die Dockerfile um eine Zeile erweitert, **bevor** der Container Production-Smoke-Failure mit „Template fehlt" produziert hätte. Ohne den Pre-Flight wäre die Sequenz gewesen: Rebuild → Smoke startet → Wizard-Submit failt → Diagnose → Dockerfile-Fix → Rebuild → Smoke. Mit Pre-Flight: Diagnose → Fix → Rebuild → Smoke. **Spart eine Rebuild-Iteration und einen halben Diagnose-Zyklus.** Direkter Pattern-Match aus Tag-20-Lesson zum #120-Dockerfile-Fix (`examples/` ist auch kein Workspace-Member, brauchte expliziten COPY). **Generelles Prinzip:** wenn ein neues Feature einen Workspace-Folder als Filesystem-Ressource zur Laufzeit liest (`readFileSync`, `import.meta.url`-relative Paths, `WORKSPACE_ROOT`-resolves), vor dem Production-Deploy einmal grep gegen Dockerfile + Container-Resolution kurz im Kopf durchspielen. Cross-Ref BACKLOG #159 — gleicher Spirit (Hygiene-Checks bevor Production-Failure entsteht, statt Failure → Diagnose → Fix). **Mini-Checkliste:** `git diff <last-prod-sha>..HEAD -- 'apps/runtime/src/**' | grep -E 'readFileSync|WORKSPACE_ROOT|resolve.*"[a-z]'` → wenn Treffer auf neue Filesystem-Ressourcen-Reads, dann `grep <folder> apps/runtime/Dockerfile` pflichtmäßig.

- **Lesson Tag 29 #6: SQLite-FK-Cascade funktioniert in Production wie erwartet, wenn `PRAGMA foreign_keys = ON` gesetzt ist.** Block-7-Production-Smoke hat das ad-hoc verifiziert: `db.pragma("foreign_keys = ON")` + `DELETE FROM twin_profiles WHERE handle = '@test122prod'` + `DELETE FROM users WHERE email = 'test-122-prod@harway.local'` → MCP-Server `mcp_wIn0_jJ35wdqc4-c`, alle 11 Skills, alle Audit-Rows kaskadieren in einer Operation weg, Post-Cleanup-Counts beide `c: 0`. Damit ist **#159 teil-verifiziert** — die Schema-Cascade-Definitionen sind korrekt, die FK-Constraints sind sauber gesetzt. **Verbleibender Scope für #159:** (a) Audit aller DB-öffnenden Code-Pfade auf konsistente PRAGMA-Setzung (was Production-Code schon macht, aber CLI-Skripte sind selektiv), (b) DB-CLI-Cheat-Sheet für künftige Smoke-Cleanups, (c) optional Smoke-Cleanup-Helper-Script (`pnpm db:cleanup-test-user <email>`). **Implikation:** wir können der DB-Schicht für Cascade-Verhalten vertrauen, solange jede Connection das Pragma setzt — kein eigener Cascade-Code auf Application-Layer nötig.

## Tag 28 (26. Mai 2026, Dienstag) — Polish + Production-Deploy + #131 Phase B + A2A-Architektur-Fix (#155) + #140 Smoke

Drei Phasen:
1. **Polish-Vormittag (Block 1-12):** #141+#142+#139+#150+#146+#149 — providerMetadata-Verlust, Refresh-Latenz-Tracking, Token-Lifetime-Doku, extractModel-Cleanup, Mutex-Diagnose Pattern Null.
2. **Production-Deploy + OAuth-VPS (Block 13-15):** VPS auf `f52e07f` synchronisiert + Build-Arg-Bugfix, `--auth-json`-Flag (Phase B) + 4-Schritt-VPS-OAuth-Workflow live, Doku-Closure (§y + Lessons #11-#13).
3. **A2A-Architektur-Fix + Re-Pause-Smoke (Block 16-17):** #155 messageType als Single-Source-of-Truth für Empfänger-Verhalten statt inReplyTo-Heuristik, #140 E2E-Smoke 2-Tool-Pause-Sequenz verifiziert.

**Stand Tag 28:** Phase-A-Polish-Item #141+#142 (providerMetadata-Verlust nach Big-Bang Approval-Refactor) gefixt in drei Blöcken (Diagnose → Bau → Doku). Commit `0b02482` auf `origin/main`. Patch zentral in `apps/runtime/src/twin-service.ts:runModel`-Return — Un-Nest des verschachtelten Provider-Namespace + flat-merge ins Audit-Output + TwinService-Kontext-Inject (`authMode`, `twinId`) + pre-Branch `latencyMs`-Messung für oauth + api_key. Mikro-Korrektur in Block 2.3: `model` aus `result.response.modelId` (Provider-deklariert) statt aus `activeModelLabel`-Split — gleiche Werte, sauberere Source.

### #141+#142 providerMetadata-Verlust gefixt (~2h netto)

**Diagnose (Block 1):** Alle 7 LLM-tragenden `audit.complete`-Caller in `twin-service.ts` reichen `providerMetadata: reply.metadata` durch. `reply.metadata` kommt aus `runModel`-Return, das vor Patch `result.providerMetadata` komplett verworfen hat. Verlust ist mono-kausal in einem Return-Statement zentralisiert → Variante B (Fix in `runModel`-Return) ist Single-Point-Fix für alle Caller, inkl. Resume-Pfad via `approveMcpToolUseViaHistoryReplay`.

**Bau (Block 2):** Patch um Z. 2009-2020 in `twin-service.ts`:
- `providerKey = isOAuth ? "openai-codex" : "anthropic"` wählt Namespace
- `rawMeta[providerKey]` un-nestet (V3-Spec: `Record<providerName, Record<string, unknown>>`)
- `activeModelLabel.split("/")` für `provider`/`model`-Split (Pre-Refactor-Konsistenz)
- `authMode` + `twinId` via `this.deps.twinId` + `isOAuth`-Flag injected
- `unknownEventTypes` Array-normalisiert (vom Provider als CSV-String emittiert)
- `latencyMs` zentral pre-Branch gemessen mit `Date.now()`-Diff um `generateText`-Call

**Diagnose-Spike (Block 2.2):** Smoke-Output zeigte vermeintliche "Lücken" — Pre-Refactor-Audits ohne neue Felder. Pre-Bau-Check auf `data/twin.db` ergab: keine 26.05-Audits vor Diag-Spike. Lessons direkt umgesetzt: temp-Diag-Log via `/tmp`-Dump-Datei (Hot-Reload safe), Live-Smoke gegen `@markus`, Verifikation gegen frischen Audit (`audit_WQx50REscTUL` → alle Felder gefüllt), Diag-Log wieder entfernt. Befund: `result.response.modelId === "gpt-5.5"` ist Provider-deklarierte Source-of-Truth für `model`-Wert. `unknownEventTypes` ist by-design weg seit Codex-SSE-Parser-Cleanup (`codex-sse-parser.ts:31` — Parser kennt alle Events, Field nur sichtbar wenn `length > 0`).

**Mikro-Korrektur (Block 2.3):** `model` aus `result.response.modelId` mit Fallback auf `activeModelLabel.split("/")`. Provider-deklarierte ID statt Label-Reconstruktion. Verifikation `audit_kEc7Oap0pQfo` (26.05 11:53) — alle Felder gefüllt, `model:"gpt-5.5"` identisch zum Pre-Mikro-Wert.

### Tag-28-Closure-Bilanz

**Drei Blöcke an einem Polish-Tag — #141+#142 + Follow-up-Items:**

| Block | Commit | Was |
|---|---|---|
| 1. Diagnose | (kein Commit) | #141+#142 Verlust-Pfade lokalisiert. Code-Trace aller 7 `audit.complete`-Caller. Variante B (`runModel`-Return-Fix) als Single-Point-Fix empfohlen — eine Stelle deckt initial-Pfad + Resume-Pfad ab. ~10 Min. |
| 2. Bau | (Patch in-place) | #141+#142 Fix in `twin-service.ts:runModel`-Return: Un-Nest `providerMetadata["openai-codex"]`-Namespace + flat-merge + `provider`/`model`-Split + `authMode`/`twinId`-Inject + `latencyMs`-pre-Branch-Messung + `unknownEventTypes`-Array-Norm. TS-Build green. ~30 Min. |
| 2.1 | (ad-hoc Skript) | Smoke-Skript A/B/C/D + Pre-Refactor-Vergleichs-Spot. Smoke C skipped (api_key-Setup-Overhead, → #148), Smoke B/D Approve-Pfad blockt durch Auto-Tool-Picker-Problem (#87/#89, → #147). ~5 Min. |
| 2.2 | (Diag-Logs nicht committed) | Diagnose-Spike — vermeintliche Lücken (`model`/`twinId`/`unknownEventTypes` fehlen in Smoke A; mcp-tool-use über Anthropic) als Pre-Refactor-Audit-Beobachtungen entlarvt. Temp `/tmp/diag-141-*.json`-Dump aus `runModel` zeigt `result.response.modelId` als bessere Source-of-Truth, `result.providerMetadata` ist tatsächlich verschachtelt unter `"openai-codex"`. Diag-Logs danach wieder entfernt, nicht committed. ~20 Min. |
| 2.3 | `0b02482` | Mikro-Korrektur: `model` bevorzugt aus `result.response.modelId` (Provider-deklariert), Fallback auf `activeModelLabel.split("/")`. Verifikation gegen frischen Audit `audit_kEc7Oap0pQfo` (26.05 11:53) — Wert "gpt-5.5" identisch, Source-of-Truth-Wechsel ohne funktionale Änderung. Commit + Push (Husky grün). ~10 Min. |
| 3. BACKLOG + STAND | `2ce4c4d` | #141 + #142 als ✅ Tag 28 DONE im BACKLOG markiert mit Status-Notiz und Commit-Verweis. Neue Section "Tag-28-Items (#141+#142-Follow-ups)" mit #146 (`extractModel()`-Cleanup nice), #147 (Auto-Tool-Picker-Reliability Cross-Ref #87/#89 nice), #148 (api_key-Pfad-Smoke S nice). STAND-Tag-28-Section + Block-Tabelle 1-3 + Lessons. ~10 Min. |
| 4. Diagnose #139 | (kein Commit) | OAuthRefreshService-Surface kartiert (`refresh-service.ts`-Layout, Hybrid-Trigger: Background-Poll 60s + Lazy `ensureFresh` vor jedem Codex-fetch). Latenz-Tracking-Status: keines — nur Failure-Audit (`oauth-refresh-failure`), Success ist stumm. Refresh-Frequenz im letzten 24h: 1 Update für @markus (Token-Lifetime damals vermutet ~10 Tage). Verdikt: Lesart 1 (Messung fehlt). Bau-Pfad A empfohlen: `oauth-refresh-success`-Audit analog `recordFailure`. ~30 Min. |
| 5. Bau #139 | (Patch in-place) | `recordSuccess`-Method neu in `refresh-service.ts:264-306` analog `recordFailure`. `doRefreshIfNeeded` um `oldExpiresAt`-Capture + `Date.now()`-Diff um `refreshAccessToken` + `recordSuccess`-Call erweitert. `ensureFresh(twinId, triggeredBy = "lazy")`-Signature, `pollAllTokens` markiert `"background"`. CodexAdapter unverändert (Default greift). TS-Build green. Plus ad-hoc `scripts/smoke-139.sh` für DB-Patch-Trigger + Rollback-Pfad. ~30 Min. |
| 6. Background-Poll-STOP | (Patch in-place) | env-Guard `OAUTH_REFRESH_POLL_DISABLED` in `refresh-service.ts:75-87`. Default-Verhalten unverändert (Poll an), `=true` deaktiviert Background-Loop. Lazy-Refresh in CodexAdapter bleibt in beiden Modi aktiv. Eingeführt nach zwei Token-Invalidierungs-Smokes (`refresh_token_reused` + `refresh_token_invalidated`) — pragmatische Sicherung gegen Refresh-Audit-Flood vor Diagnose-Spike. ~5 Min. |
| 7. Phase-A-Diagnose | (kein Commit, Diag-Logs raus) | Drei Hypothesen geprüft. H1 (refresh_token rotiert nicht atomar): **widerlegt** — Live-Diag-Dump zeigt `newRefreshTokenSameAsOld: false`, `upsert` schreibt neuen Wert sauber. H2 (refreshAccessToken-Parsing-Bug): **widerlegt** — Response-Body enthält `refresh_token` mit Länge 90, Cast greift. H3 (Race-Condition zwischen Background-Poll und Lazy-Trigger): **unverifiziert**, durch Block-6-Guard empirisch entschärft. Live-Smoke `audit_FuawriTsQd1j`: capability=`oauth-refresh-success`, `latencyMs:446`, `triggeredBy:"lazy"`, atomare Token-Rotation, `newExpiresAt` = `2026-06-05T13:08:16.657Z` (10 Tage future). **Codex-Refresh-Token-Lifetime ist 10 Tage (`expires_in: 863999`)**, nicht durch Code limitiert. Diag-Logs (temp `/tmp/diag-phase-a-*.json`-Dumps) entfernt, nicht committed. ~40 Min. |
| 8. #139 Commit + Doku-Closure | `b639b26` | #139 als ✅ Tag 28 DONE im BACKLOG markiert. Drei neue Phase-A-Follow-up-Items: #149 (Mutex-Hardening M), #150 (Token-Lifetime-Doku XS), #151 (`id_token`/`scope`-Evaluation S). STAND Block 4-8 + Lessons + Outcome erweitert. Wochentag-Fix Montag → Dienstag. ~15 Min. |
| 9. #150 Token-Lifetime-Doku | `3987e4e` | §x in `docs/131-OAUTH-STRATEGY.md` mit 6 Sub-Sections (§x.1-§x.6). Refresh-Token-Lifetime ist 10 Tage (`expires_in:863999`) live verifiziert, Code limitiert nichts — `pnpm twin:oauth-login`-Initial-Token mit ~50 Min ist CLI-Artefakt, springt nach erstem Refresh auf 10 Tage. BACKLOG #150 als ✅ Tag 28 DONE markiert. ~5 Min. |
| 10. #146 extractModel-Cleanup | `3dbbc0b` | `apps/web/lib/audit-render/utils.ts:50-65` — Compound-String-Split aus `provider`-Feld entfernt, Return-Type `string \| null → string` mit `"unknown"`-Fallback. Konsumenten (`twin-answer.tsx:39`, `a2a-activity.tsx:73`) unverändert; `?? undefined`-Pattern dort jetzt dead code für rechte Seite, funktional äquivalent (`formatTokenCost` fällt für `"unknown"` über Pricing-Lookup-Miss auf `DEFAULT_MODEL` zurück). Pre-Tag-28-Audits zeigen jetzt `"unknown"` — Drift akzeptiert als Debug-Surface. ~5 Min. |
| 11. Diagnose-Spike #149 | (kein Commit) | Race-Hypothese strukturell entzaubert. `inFlight`-Mutex in `ensureFresh` ist korrekt im pure-JS-Single-Process-Modell (`Map.get`/`Map.set` synchron im selben Event-Loop-Tick, kein await-Boundary). Tag-28-Vormittag-Failures (`refresh_token_reused`, `refresh_token_invalidated`) sind nicht Mutex-Lücke, sondern wahrscheinlich Hot-Reload-Race (`tsx watch` parallele Instanzen) oder CLI-Concurrent-Write (`pnpm twin:oauth-login` schreibt parallel zur Runtime). Race-Repro nicht versucht (Runtime down, theoretisch im pure-JS-Modell nicht reproduzierbar). Verdikt: **Pattern Null** (kein Code-Change). ~30 Min. |
| 12. #149 Pattern Null + Tag-Final | `f52e07f` | JSDoc-Erweiterung in `refresh-service.ts:ensureFresh` mit Concurrency-Doku, Race-Quellen (Hot-Reload, CLI-Concurrent-Write) + Cross-Refs auf Block-6-Guard und #152. BACKLOG: #146 nachträglich closed, #149 closed (Diagnose-Closure, Pattern Null), #152 neu (Hot-Reload-Race im `tsx watch`-Dev-Setup, Phase B, M-L). STAND Block 9-12 + Lessons #9-#10 + Outcome erweitert. ~20 Min. |
| 13. Production-Deploy + Build-Arg-Bugfix | (kein Code-Commit, Deploy-Action) | Pre-Deploy-Diagnose: VPS-Repo war auf `ff70656` (Tag 26 Abend), Drift ~30 Code-Commits Tag 27+28. `git pull origin main` zog `f52e07f`, Migration 024+025 auto-applied via `CREATE TABLE IF NOT EXISTS`. `docker build` runtime + web → `docker compose up -d --force-recreate runtime web` grün. **Bug:** Web-Container rief `http://localhost:4000/auth/login` statt Production-Runtime-URL. Root Cause: `apps/web/Dockerfile` hat `ARG NEXT_PUBLIC_RUNTIME_URL=http://localhost:4000` als Default, Production-Build hatte kein `--build-arg` gesetzt → Default landete via `NEXT_PUBLIC_*`-Build-Inlining im JS-Bundle. Fix: `docker build --build-arg NEXT_PUBLIC_RUNTIME_URL=https://runtime.twin.harwayexperience.com -t twin-lab-web:latest -f apps/web/Dockerfile .` aus Repo-Root, Web-Container recreated. Smoke 1 (UI Login + Settings + Chat) ✓, Smoke 2 (Telegram-Bot `@twin_lab_markus_bot` live) ✓. ~30 Min Diagnose, ~10 Min Re-Build. Folge-Items: #154 (DEPLOYMENT-Doku Build-Arg). |
| 14. #131 Phase B `--auth-json`-Flag + VPS-OAuth-Smoke | `76e49fe` | Problem: Phase-A-CLI baut nur macOS-Path (`codex login` Subprocess), VPS-Linux hat keinen Codex-Binary und DB liegt im Docker-Volume. Setzung: scp-Workflow + `--auth-json=<path>`-Flag (Strategy §t.8 Option (c)). Code: `parseHandle → parseArgs` mit `{handle, authJsonPath}`, `loadCodexToken(filePath?)` mit Default-Parameter, `main()`-Branch skip Subprocess + Hybrid-Detection wenn `authJsonPath !== null`. Production-Smoke 4-Schritt-Workflow: Mac `codex login` → `scp ~/.codex/auth.json root@31.97.78.73:/tmp/auth.json` → `docker cp /tmp/auth.json twin-lab-runtime:/tmp/auth.json` → `docker exec twin-lab-runtime npx tsx /app/apps/runtime/src/scripts/cli-oauth-login.ts @markus --auth-json=/tmp/auth.json` grün. DB-Check: `@markus authMode='oauth'`, `oauth_tokens` mit `account_id=07b2ba12-...-220f775`, expires ~50min future. Cleanup: `auth.json` aus Container + VPS-Host gelöscht. Smoke 3 (Chat-Roundtrip OAuth): `audit_u31GW1dRJtjk` (17:22:53.441Z), `providerMetadata.provider="openai-codex"`, `model="gpt-5.5"`, `authMode="oauth"`, `planType="pro"`, `cfRay="a01e76db0d9571b9-FRA"`, `latencyMs=2758` ✓. Settings-UI zeigt Auth-Row `OAuth (ChatGPT)` mit account-id-Maske + Re-Login-Link. ~15 Min Code-Bau + ~15 Min E2E-Smoke. |
| 15. Doku-Closure | `1982253` | STAND Block 13-15 + Lessons #11-#13 + Outcome auf 15 Blöcke. BACKLOG: #153 (DEPLOYMENT §11 OAuth-Production-Workflow), #154 (Web-Dockerfile Build-Arg-Doku). §y in `131-OAUTH-STRATEGY.md` mit 6 Sub-Sections (Problem, Setzung, Code-Pattern, Production-Workflow, Smoke-Validierung, Phase-B-Roadmap). ~25 Min. |
| 16. #155 A2A Reply-Architektur-Korrektur | `903a813` | Bug: Web-UI setzte `inReplyTo` automatisch mit letzter Thread-Message bei jedem Send → jede Owner-Frage wurde als "reply" geframed → Empfänger-Twin-Service hat reply-received-Audit geschrieben statt LLM zu rufen. Wurzel: Tag-14-Heuristik (`inReplyTo`-Match + Bridge-`lookupSender`-Failsafe) war zu breit. Refactor: `messageType` als Single-Source-of-Truth, Union von 2 auf 5 Werte (`twin`, `system`, `owner-direct`, `twin-initiated`, `twin-reply`) in `apps/bridge/src/messages-repo.ts`. Runtime-Send-Pfade: `ownerDirectSend → owner-direct`, `approveTwinSend → twin-initiated`, `approveTwinResponse` + `handleTrustedBridgeMessage → twin-reply`. Inbound-Switch in `receiveBridgeMessage`: alter Reply-Detection-Block (~53 LOC mit `lookupSender`-Failsafe) entfernt, ersetzt durch ~30 LOC `messageType`-Switch mit Legacy-Normalisierung `'twin' → 'twin-initiated'`. Web-UI: `lastReceivedBridgeId`-Memo + `inReplyTo` aus Send-Body raus. `inReplyTo` bleibt im Schema reserviert für künftiges Quote-Reply, `lookupSender` als `@deprecated` markiert. 8 Files, +173/-115. Production-Deploy: 3 Container rebuilt + recreated (Runtime, Web, Bridge — Bridge wurde initial übersehen, siehe Lesson #15). Smoke 1 grün: Owner-Direct an vertrauten Twin → Trusted-Bypass → Reply. Audits: `audit_yBNtNszbAbkF` (owner-direct-send), `audit_qx0zMZHtSO21` (trusted-bypass), `audit_QZ0Rl-YFte5P` (reply-received). Latenz ~4 Sek. ~50 Min. |
| 17. #140 Re-Pause-Smoke + Closure-Doku | `9503a43` | E2E-Smoke des Re-Pause-Pfads via 2-Tool-Sequenz: "Rufe `mcp:everything-approval:get-sum` mit a=17, b=25 auf, danach `mcp:everything-approval:echo` mit dem Ergebnis als message". Pending-Audit 1 `audit_utkmv7E3YmUu` (get-sum, status=pending) → User approved → transitioniert zu `executed` mit `followUpPending=true`. Pending-Audit 2 `audit_Bm2GfH-gUD6R` (echo, status=pending) mit `priorAuditId: audit_utkmv7E3YmUu` → User approved → `executed`. Final-Audit: `Echo: 42`, `providerMetadata.provider="openai-codex"`, `model="gpt-5.5"`, `authMode="oauth"`, `planType="pro"`, `latencyMs=1822`. **Resume-nach-Resume verifiziert** — Codex bleibt zwischen zwei aufeinanderfolgenden Pauses im OAuth-Pfad, kein Token-Drift, kein `refresh_token_reused`. Plus Doku-Commit: STAND Block 16+17, Lessons #14-#16, BACKLOG #140 closed, #155 closed, #156 neu (DEPLOYMENT Multi-Service-Sequenz). ~30 Min Smoke + ~25 Min Doku. |
| 18. Doku-Hygiene-Welle | `762cb0e` | STAND-Auslagerung Phase 2.5 bis Tag 24 nach `docs/archive/STAND-history-pre-tag25.md` (1201 Zeilen), BACKLOG-Auslagerung Closed-vor-Tag-26 nach `docs/archive/BACKLOG-closed-pre-tag26.md` (661 Zeilen via awk-Range-Split). Live-STAND 2637 → 1455 Zeilen, Live-BACKLOG 3105 → 2463 Zeilen. PRE-LAUNCH-A-STRATEGY Launch-Window auf KW 31-32 korrigiert, UX-STRATEGY Tag-28-Anmerkung zu Phase-3.6-Status, ROADMAP Stand-Warnung. ~30 Min. |
| 19. Repo-Inventur (Read-Only) | `7b9b88c` | `docs/INVENTORY-tag28.md` (278 Zeilen, 13 KB) — 7 Sektionen + 10-Punkte-Beobachtungen. Findings: 0 Vitest-Tests (bestätigt CLAUDE.md), 35 Smoke-Scripts (22 in package.json registriert, 13 unregistriert), `auth-stub.ts` DEPRECATED mit 0 Importer, `persona-florian.md` ist trotz 0 Filename-Match nicht verwaist (dynamisch via Pattern), `.gitignore` sauber. Pre-Push-PATH-Issue mit pnpm via expliziten PATH-Override gelöst. Read-Only-Snapshot als Basis für Cleanup-Entscheidungen. ~30 Min. |
| 20. Repo-Cleanup Kategorie 1 (low-risk) | (dieser Commit) | `apps/runtime/src/auth-stub.ts` gelöscht (Pre-Check grep 0 Importer, TS-Build green nach Delete). `docs/archive/README.md` erweitert um STAND-/BACKLOG-Auslagerungen aus Block 18 + Strategy-Doc-Lifecycle-Konvention. `.gitignore` um Editor-Backup-Patterns (`*.orig`, `*.bak`, `*.swp`, `*.swo`) erweitert. BACKLOG #157 (Smoke-Scripts Phase-by-Phase-Archivierung, Schule B, M-L) + #158 (Strategy-Doc-Lifecycle-Konvention, S) angelegt. Kategorie 2 (Smoke-Scripts) + Kategorie 3 (Big-Files) als BACKLOG-Items defer. ~15 Min. |

**Lessons Tag 28:**

- **Lesson Tag 28 #1: Smoke-Auswertung braucht Audit-ID + Timestamp.** Tag-28-Block-2.2 hat ohne Audit-ID-Check Pre-Refactor-Audits gelesen und als "Lücken im Fix" interpretiert. Lesson: SQL-Queries in Smoke-Skripten geben `id` + `timestamp` mit aus, Auswertung muss explizit "frischer Audit?" prüfen, bevor "Soll-Felder fehlen" gefolgert wird.

- **Lesson Tag 28 #2: Pre-Refactor-Audit-Drift ist Normalität.** Schemas ändern sich über Refactors (z.B. `unknownEventTypes` weg, `model` + `twinId` dazu). Alte Audits in der DB sind Schnappschüsse des damaligen Schemas, kein Bug. Vergleich Pre/Post nur als "was hat sich strukturell geändert", nicht als "was fehlt jetzt".

- **Lesson Tag 28 #3: STOP + Diagnose hat gegriffen.** Bei Smoke-Output "Felder fehlen" wäre Default-Pattern weiter-debuggen mit Hypothesen gewesen. Stattdessen Block 2.2 als sauberer Diagnose-Spike (temp-Log via `/tmp`-Dump, Live-Smoke, Diag-Log raus), der die vermeintlichen Lücken als Beobachtungs-Artefakt aufgelöst hat. ~20 Min Diagnose haben einen Falsch-Fix gespart.

- **Lesson Tag 28 #4: Mikro-Korrekturen über Polish-Tage einsammeln.** `result.response.modelId` als Source-of-Truth war keine Anforderung im Original-Briefing, sondern eine Beobachtung im Diagnose-Output. Polish-Tage sind genau das richtige Zeitfenster für solche Mikro-Polituren — auf Bau-Tagen würde man sie als Scope-Creep abweisen.

- **Lesson Tag 28 #5: STOP-und-Diagnose hat ein zweites Mal gegriffen.** Nach Smoke-Output „Refresh failt mit `refresh_token_reused`" wäre Default-Pattern „Re-Login und nochmal" gewesen. Stattdessen Block-6-Guard als pragmatische Sicherheits-Maßnahme + Phase-3-Diagnose-Spike (Block 7). Diagnose hat H1 + H2 widerlegt und H3 als plausibel-aber-unverifiziert markiert. Ohne diesen Stopp hätten wir eventuell Code „gefixt" der nicht kaputt war.

- **Lesson Tag 28 #6: Reality-Check-Korrektur ist okay.** Im Verlauf der Diagnose hatte ich (Claude im Chat) zweimal Setzungen mit falschen Annahmen gemacht: (a) „1h-Token-Lifetime ist Codex-Realität" — falsch, Codex liefert 10 Tage, die 50 Min waren CLI-Initial-Token-Artefakt; (b) „Phase-A-Show-Stopper, Florian/Heiko-Onboarding wird scheppern" — übertrieben dramatisiert, Risiko ist niedriger als dargestellt. Beide Korrekturen sind in der Diagnose-Bilanz ehrlich aufgelöst. Generelles Prinzip: **Setzungen müssen revidierbar sein wenn Diagnose-Daten kommen** — Sticking-to-Original-Hypothese ohne Daten-Update wäre der Anti-Pattern.

- **Lesson Tag 28 #7: Codex-Refresh-Token-Lifetime ist 10 Tage, nicht 50 Min.** Direkt-Beweis via `expires_in: 863999` Sekunden + `audit_FuawriTsQd1j` mit `newExpiresAt: 2026-06-05T13:08:16.657Z`. Unser Code limitiert die Lifetime nicht — `new Date(Date.now() + response.expires_in * 1000)` in `refresh-service.ts:165-167` schreibt direkt was Codex liefert. Das `pnpm twin:oauth-login`-Initial-`expires_at` mit ~50 Min ist CLI-Wrapper-Verhalten (vermutlich `id_token.exp`-Claim oder Codex-CLI-internes Initial-Token-Lifecycle-Step), kein System-Constraint. Cross-Ref #150.

- **Lesson Tag 28 #8: Background-Poll-Guard als permanente Sicherung.** Default-Verhalten unverändert (Poll an), env-Override `OAUTH_REFRESH_POLL_DISABLED=true` aktiviert Disable. Lazy-Refresh über `CodexAdapter.executeRequest` bleibt in beiden Modi aktiv, Funktional-Loss = 0. Wenn #149 (Mutex-Hardening) später implementiert wird: Guard kann entfernt oder als Notfall-Schalter bleiben. Niedriger Code-Footprint (vier Zeilen Guard), hohe Resilience-Wirkung.

- **Lesson Tag 28 #9: Verdachts-Items brauchen Diagnose vor BACKLOG-Aufnahme.** #149 wurde am Vormittag aus dem Race-Verdacht (`refresh_token_reused`) als BACKLOG-Item formuliert: „Mutex-Hardening, M ~1 Tag". Block-11-Diagnose hat das aufgelöst: kein Race-Window im aktuellen Code (`Map.get`/`Map.set` synchron im selben Event-Loop-Tick), die echten Wurzelursachen sind Hot-Reload-Race und CLI-Concurrent-Write. Lesson: Items aus „heute haben wir was komisches gesehen"-Momenten brauchen einen kurzen Diagnose-Spike, bevor sie als M-Bau-Item ins BACKLOG wandern — sonst entstehen Phantom-Items, die spätere Sessions Stunden kosten würden, wenn jemand „M, ein Tag" ohne Diagnose abnickt.

- **Lesson Tag 28 #10: Pattern Null ist ein legitimer Verdikt.** Bei #149-Diagnose war die ehrliche Antwort: kein Code-Change, nur JSDoc-Klarstellung. Verlockung wäre gewesen, Defense-in-Depth (M1'-IIFE try/finally) zu bauen, weil „wir sind eh schon dran und es ist XS". Pattern Null hat negativen Cargo-Cult-Risiko: zukünftige Reader würden M1' als Lösung für ein nicht-existentes Problem interpretieren und beim nächsten Mutex-Item dieselbe Defensive-Schicht reproduzieren. JSDoc + Cross-Ref auf reale Race-Quellen (Hot-Reload, CLI-Concurrent-Write) ist die richtige Investition — Information statt Phantom-Code.

- **Lesson Tag 28 #11: Models nicht aus Output-Stil ableiten, nur aus Audit-`providerMetadata`.** Während Block-14-Smoke-Auswertung wurde ich (Claude im Chat) durch den präzisen Persona-Output des Codex-OAuth-Twins kurz dahin verleitet, „das klingt nach Claude" zu schlussfolgern. Erst der DB-Check (`json_extract(data, '$.output.providerMetadata.provider')`) hat den Provider definitiv geklärt: `openai-codex`. Lesson: bei Provider-Identifikation **immer** `providerMetadata.provider` + `.model` aus dem Audit lesen, niemals Output-Heuristik nutzen. Die Heuristik versagt genau dort, wo Persona-Tuning gut ist — also bei den interessantesten Twins.

- **Lesson Tag 28 #12: Settings-UI-LLM-Anzeige und tatsächlicher Provider divergieren bewusst im OAuth-Mode.** UI zeigt persistierte `llmConfig` (`anthropic / claude-opus-4-7` per Default), tatsächlich getriggert wird `openai-codex/gpt-5.5` weil `runModel` bei `authMode==='oauth'` auf den Codex-Provider switcht (Strategy §g.3). Das ist Setzung, kein Bug — aber dokumentations-würdig, sonst gibt's Wiederfindungs-Konfusion in zukünftigen Sessions. Settings-Auth-Row dokumentiert den effektiven Provider via `Mode: OAuth (ChatGPT)`, das LLM-Feld bleibt API-Key-Fallback-Konfiguration.

- **Lesson Tag 28 #13: VPS-OAuth-Workflow ist 4-Schritt-Manual.** Solange #143 (Web-OAuth ohne CLI) nicht gebaut ist, läuft VPS-Re-Login + Onboarding über `codex login` Mac → `scp` → `docker cp` → `docker exec ... --auth-json=...`. `--auth-json`-Flag (Block 14) macht das möglich, aber jeder Re-Login bleibt manueller 4-Schritt — kein Browser-Click-Through. DEPLOYMENT.md §11 muss das aufnehmen (Item #153), sonst wird's bei nächstem `@florian`/`@heiko`-Onboarding aus dem Chat-Transkript rekonstruiert.

- **Lesson Tag 28 #14: Reply-Detection-Pattern war zu breit.** Tag-14-Implementierung (3. Mai 2026) hat `reply-received` als generischen Fallschirm für jeden `inReplyTo`-Match gebaut, mit Annahme „Twin-A-Anfrage kommt zurück". Tag 28 Abend hat gezeigt: dieselbe Heuristik feuert auch bei „Owner schreibt neue Frage in aktiven Thread" und stellt das LLM stumm — kein Mandate-Check, kein LLM-Call, nur Audit + SSE. Die Symmetrie-Annahme „Inbound mit inReplyTo == Reply auf unsere Anfrage" war für Twin↔Twin korrekt, aber Owner→Twin schreibt aus Empfänger-Sicht eine neue Anfrage in einen bestehenden Thread. Lesson generell: bei Symmetrie-Annahmen explizit fragen, ob auch der asymmetrische Fall durch dieselbe Heuristik fällt — und dann das, was die zwei Fälle unterscheidet, als first-class-Discriminator persistieren (hier: `messageType`).

- **Lesson Tag 28 #15: Multi-Service-Refactors brauchen vollständige Container-Liste in Deploy-Briefings.** Block 16 hat Bridge + Runtime + Web geändert (Schema-Erweiterung `MessageType`-Union, beide Seiten müssen den neuen Wert kennen). Deploy-Briefing nannte nur Runtime + Web — Bridge wurde übersehen. Production-Smoke schlug fehl mit `"messageType muss einer von [twin, system] sein"` (Bridge-400-Validation, alter Type-Union noch im Build). Diagnose ~5 Min (Failed-Audit `audit_pk2D6B1bbdMx` zeigte den Bridge-400-Response direkt), Bridge-Rebuild + Recreate ~30 Sek. Lesson: Multi-Service-Briefings müssen alle betroffenen Services explizit nennen, vor allem bei Schema-Changes die mehrere Container kennen müssen. Cross-Ref BACKLOG #156.

- **Lesson Tag 28 #16: Audit-Trail dokumentiert Bug-Fix-Verlauf in Production.** Der Failed-Audit `audit_pk2D6B1bbdMx` (owner-direct-send, status=failed, 19:07:19) ist live in der DB sichtbar — Beweis dass der Bridge-400-Bug während des Smokes existiert hat. Plus der Successful-Audit `audit_yBNtNszbAbkF` (19:10:27) nach Bridge-Rebuild. Diagnose-Sequenz ist in der Audit-Chain rekonstruierbar — ein nachträglicher Reader kann „failed → bridge-rebuild → success" allein aus DB-Zeitstempeln lesen, ohne Chat-Transkript. Verstärkt Lesson #11 (Models aus Audit, nicht Output-Stil): Audit-Trail ist Ground-Truth für „was ist wirklich passiert".

**Tag-28-Outcome:** Neun Item-Closures (#141+#142+#139+#150+#146+#149+#131 Phase B `--auth-json`+#155 A2A-Refactor+#140 Re-Pause-Smoke), fünf neue BACKLOG-Items aus Block 13-20 (#153 DEPLOYMENT §11 OAuth-Workflow, #154 Web-Dockerfile Build-Arg-Doku, #156 DEPLOYMENT Multi-Service-Sequenz, #157 Smoke-Scripts Phase-by-Phase-Archivierung, #158 Strategy-Doc-Lifecycle-Konvention) plus die vier aus Block 8/12 (#149-#152). Plus Block-18/19/20-Hygiene: STAND/BACKLOG halbiert via Archiv-Auslagerung, Repo-Inventur als Cleanup-Basis, `auth-stub.ts` als deprecated Stub entfernt. Phase-A-Stabilitäts-Risiko empirisch entschärft via Block-6-Guard, #149 als Phantom-Bug aufgelöst, reale Wurzel sitzt im Dev-Tool-Lifecycle (#152). **Production live mit Phase A + Phase B + A2A-Refactor:** VPS `srv1046432` synchron mit `origin/main` ab `903a813` (Block 16), `@markus` läuft Codex-OAuth in Production mit korrektem A2A-Pfad, Re-Pause-Smoke verifiziert (Audits `audit_u31GW1dRJtjk` Tag-Vormittag, `audit_yBNtNszbAbkF` A2A-Smoke, `audit_utkmv7E3YmUu` + `audit_Bm2GfH-gUD6R` Re-Pause-Sequence). Polish-Item-Quartett (#139, #140, #141, #142) **4/4 abgearbeitet** — Tag 28 schließt das komplette Quartett. **Tag-28-Total: 20 Blöcke, Netto-Zeit ~8.5h Chat- und Code-Zeit.** **Schluss-Bilanz:** Diagnose-First hat fünfmal entscheidende Korrekturen gebracht (Block 2.2 Smoke-Auswertung, Block 7 Phase-A-Hypothesen, Block 11 Phantom-Bug-#149, Block 13 Build-Arg-Bug, Block 16 Bridge-Service-übersehen). Reality-Check-Kultur fortgeführt: drei Setzungs-Korrekturen aus Vormittag plus eine aus Abend (Reply-Detection-Heuristik als zu-breit identifiziert statt verteidigt). Code-seitig sauberer Tag mit fokussierten Commits (`0b02482`, `b639b26`, `3987e4e`, `3dbbc0b`, `f52e07f`, `76e49fe`, `1982253`, `903a813` + dieser Doc-Commit). **Production-Ready:** OAuth-Login durch komplette VPS-Pipeline, A2A-Reply-Architektur Single-Source-of-Truth-Pattern, Re-Pause-Pfad E2E grün. Das komplette #131-OAuth-Polish-Quartett ist live.

## Tag 27 (25. Mai 2026, Sonntag) — Pre-Launch-Phase A Polish (#137) + #131 Phase 3.0/3.1

**Stand Tag 27 Vormittag:** #137 Husky Pre-Push-Build-Hook abgeschlossen (~1h). Strukturelle Prävention für Phase-5-Bug-Pattern (Production-Static-Generation strenger als pnpm dev). origin/main = `1a1f653` nach Push.

### #137 Husky Pre-Push-Build-Hook (~45 Min)

Strategy-Setzungen Vormittag:
- Husky (lokal, nicht GitHub-Action — Sole-Maintainer-Setup)
- Beide Builds via `pnpm build` Root-Script
- Strict + Skip-Flag (`--no-verify` für WIP/Doku, in CONTRIBUTING dokumentiert)

**Implementation:**
- husky installiert (devDep root), prepare-Script in package.json triggert Setup beim `pnpm install`
- `.husky/pre-push` ruft `pnpm build` (alle Workspaces via `pnpm -r build`), blockt Push bei Failure
- CONTRIBUTING.md Pre-push-Section zwischen "How We Work" und "Pull Request Guidelines" ergänzt
- README Quick-Start: `pnpm install`-Comment um „(also sets up git hooks via Husky)" erweitert

**Test-Verifikation (3/3 grün):**
- Smoke 2 (Build-Failure-Block): temp `apps/web/app/tmp-husky-test/page.tsx` mit useSearchParams ohne Suspense → Hook Exit 1, ❌-Message korrekt
- Smoke 3a (Skip-Flag-Aktiv): `git push --no-verify --dry-run` → kein Pre-push-Output, Hook übersprungen
- Smoke 3b (Hook-Aktiv): `git push --dry-run` → voller Build green, ✅-Message vor git-Output
- Smoke 1 (Happy-Path): finaler feat-Push selbst (Hook firert für real, Build muss durchlaufen)

**Detour Setzung-vs-Realität:** User-Setzung Smoke 3 sah `git reset --hard HEAD~1` zum Cleanup — hätte uncommitted Husky-Setup-Files gekillt, da working tree zu dem Zeitpunkt noch dirty war (feat-Commit kam nach Smokes). Stattdessen `--soft` für äquivalentes Result auf empty-Commit.

Phase-5-Bug-Pattern strukturell prevented für future commits.

### #131 OpenAI-OAuth Strategy-Session (~2h)

Vormittag-Block 2 nach #137-Closure. Substantielle Strategy-Klärung mit Tag-26-Annahmen-Korrektur.

**Recherche-Investment (~30-45 Min):**

Web-Recherche zu OpenAI-OAuth-Constraints + Hermes-Pattern + Server-App-Realität. Drei wesentliche Befunde:

1. **OpenAI Codex OAuth hat hardcoded `localhost:1455`-Redirect** — kein Custom-Redirect möglich, Token-Paste-Flow ist Tag-26-Annahme die nicht funktioniert
2. **Headless-OAuth ist offiziell nicht supported** (Codex Issue #2798 offen seit August 2025)
3. **SSH-Tunnel-Pattern ist Branchen-Standard** für VPS-Setups (Hermes, Codex offizielle Doku, RooCode, OpenCode alle dokumentiert)

Tag-26-Annahme „Loopback-Pattern wie OpenClaw funktioniert" war falsch für Server-App-Architektur. **Vor dem Bau hätten 1-2 Tage in falsche Richtung gegangen** (Web-UI-Trigger mit Cross-Origin-Loopback-Problem).

**Strategy-Setzungen:**

- CLI-First: `pnpm twin:oauth-login` Primary-Trigger, Web-UI zeigt nur Status (Hermes-Pattern, matches `hermes auth`)
- Exklusiver Auth-Mode pro Twin: `api_key` XOR `oauth`, kein simultaner Multi-Auth
- Storage: Migration 025 dedizierte `oauth_tokens`-Tabelle + `twins.auth_mode`-Spalte
- OAuth + OpenRouter-Fallback dokumentieren (Hermes-Pattern), BYOK als dritte Schicht
- Re-Estimate: L → XL (5-7 Bautage)
- 5-Phasen-Bau mit Stop-Punkten (analog #130-Pattern)

Strategy-Doc: [`docs/131-OAUTH-STRATEGY.md`](./131-OAUTH-STRATEGY.md), 6 §-Sections (CLI-First, Exklusiv-AuthMode, Storage-Schema, Refresh-Service, OpenRouter-Fallback, Owner-Trust-Persistenz).

**Lesson Tag 27 #1: Recherche-Investment vor Bau-Planung zahlt sich aus** — 30-45 Min Recherche-Aufwand hat substantielle Architektur-Korrektur ermöglicht. Tag 26 hatte Tag-25-Backlog-Skizze übernommen ohne Server-App-Pattern-Verifikation. Verstärkt Tag-26 Lesson #11 (Production-Build-Test fehlt im Workflow) — generelles Prinzip: **bei substantiellen Items immer Verifikations-Schicht vor Strategie-Setzung**.

**Phase-A-Launch-Window-Update:** Buffer 5-15 Tage (von 10-23 Tage vorher) — XL akzeptiert für Power-User-Feature-Sorgfalt, KW 32-33 als realistisches Launch-Window.

### #131 Phase 1 + 2 Bau (Tag 27 Vormittag-Nachmittag)

**Phase 1 — Backend-Foundation (Commit `cfe223c`):** Migration 025 (`oauth_tokens`-Tabelle + `twins.auth_mode`-Spalte), PKCE-Client (`apps/runtime/src/oauth/openai-pkce.ts`) mit S256 + State-Generator + Token-Exchange, OAuth-Tokens-Repository mit AES-256-GCM-Verschlüsselung (analog `crypto-utils.ts`-Pattern). Manual-Curl-Smoke via Mock-Code grün.

**Phase 2 — Refresh-Service (Commit `638e200`):** Background-Polling-Loop (60s-Interval), Lazy-Refresh bei Request-Time (<5 Min remaining), File-Lock-Mutex gegen Concurrent-Refresh. Refresh-Roundtrip via Mock-Token verifiziert, File-Lock-Race-Test grün.

### #131 Nachmittag — Phase 3 Strategy-Iteration + Pre-Flight (~2.5h)

Phase 3 sollte initial als ein Block gebaut werden (Provider-Auth-Mode-Switch). Strategy-Iteration vor Bau hat substantielle Findings ergeben, die das Re-Estimate auf XXL und einen Spike-First-Approach erzwungen haben.

**Phase 3 Architektur-Findings:**

1. **OAuth-Token funktioniert NICHT mit Standard-OpenAI-API.** Naive Annahme „Codex-Token = OpenAI-API-Key" stimmt nicht. Codex-OAuth-Token ist für einen separaten Backend-Endpoint scoped.

2. **Codex-Endpoint:** `POST https://chatgpt.com/backend-api/codex/responses` (Responses-API-Format, nicht Chat-Completions). Required Headers `Authorization: Bearer ...` + `Content-Type: application/json` + `OpenAI-Beta: responses=v1`. Pflicht-Field `instructions` (System-Prompt). Streaming via SSE mit `response.created`/`response.output_item.added`/`response.completed`. Quellen: Simon Willison Reverse-Engineering (Nov 2025), HuggingFace codex-proxy.

3. **Cloudflare-TLS-Pre-Flight grün.** Codex-CLI nutzt curl-FFI/rustls für TLS-Fingerprint-Bypass weil CF viele non-browser Stacks blockt. Aber: Node.js v22 native fetch wird durchgelassen.

| Pre-Flight-Test | Status | Latenz |
|---|---|---|
| Local curl Mac | HTTP 200 | 1556ms |
| Production-Container Node 20-slim VPS 31.97.78.73 | HTTP 200 | 2976ms |
| Local Node v22 native fetch | HTTP 200 | 537ms |

**Implikation:** Phase 3 baut mit Vanilla-Node-fetch. Kein curl-Subprocess, kein Bun-Migration, kein TLS-Fingerprint-Workaround. `__cf_bm` Cookie wird gesetzt aber nicht geblockt — Best-Practice: Cookie-Jar pro Twin reusen.

**Re-Estimate XL → XXL (8-12 Bautage):**

Komplexitäts-Treiber: Codex-Endpoint-Reverse-Engineering (eigene Request/Response-Logic), SSE-Streaming-Robustness, Tool-Calls + Reasoning-Traces Format-Mapping, ToS-Maintenance-Burden.

**Bau-Approach: Spike-First Walking-Skeleton + Sub-Phasen 3.1-3.4:**

| Sub-Phase | Aufwand | Tag |
|---|---|---|
| 3.0 Spike (Direct-fetch + Minimal-Instructions, Twin-Chat-API gepatcht) | 2-4h | 27 |
| 3.1 SSE-Parser-Robustness | 1 Tag | 28 |
| 3.2 Codex-System-Prompt-Engineering | 0.5-1 Tag | 28 |
| 3.3 Tool-Calls + Reasoning-Traces | 1-2 Tage | 29 |
| 3.4 Vercel-Provider-Refactor (optional) | 1 Tag | 29-30 |

Jede Sub-Phase mit eigenem Commit + Smoke. Wenn 3.0 fails: Diagnose statt blinder Weiter-Bau.

**Risiko-Assessment (neu in Strategy-Doc §j):**

- **Risiko 1: ToS-Grauzone** — Codex-OAuth-Token-Reuse nicht offiziell für 3rd-Party-Apps dokumentiert. Existing Implementations (Hermes, OpenClaw, RooCode) sind „personal use only". Mitigation: Disclaimer + 4xx/403-Monitoring + OpenRouter-Fallback (§e).
- **Risiko 2: Pattern-Block-Präzedenz** — Anthropic hat April 2026 Claude-Pro/Max-OAuth-Pattern für 3rd-Party-Tools geblockt. Mitigation: BYOK-API-Key + OpenRouter bleiben funktional, OAuth-Foundation generisch für andere Provider, Closed-Beta-Approach (kein Massiv-Marketing bis Pattern stabil).
- **Risiko 3: Codex-Endpoint-Format-Changes** — OpenAI kann Schema jederzeit ändern. Mitigation: Codex-CLI-Changelog-Monitoring, Sub-Phase 3.4 Custom-Vercel-Provider isoliert das Format-Mapping.

**Launch-Window-Impact:** KW 33-34 (statt KW 31-32). Buffer 0-7 Tage (statt 5-15 Tage). Phase-A bleibt machbar aber ohne weiteren Slack.

**Lesson Tag 27 #3: End-to-End-Validation vor Bau** — Pre-Flight-Test mit drei Stacks (Mac curl, VPS Production-Container, Node v22 native fetch) hat in ~45 Min Klarheit über TLS-Realität geschaffen. Ohne Pre-Flight wären 1-2 Tage in TLS-Bypass-Recherche gegangen („wir brauchen curl-FFI / Bun / undici-Workaround"). Verstärkt Lesson #1 (Recherche-Investment vor Bau-Planung) — generelles Prinzip: **bei Reverse-Engineering-Items immer mit echtem Request-Smoke verifizieren, nicht aus Quellen extrapolieren**. Externe Implementierungen können legacy Workarounds tragen, die für unseren Stack nicht nötig sind.

### #131 Phase 3.0 Spike — Codex-Adapter Walking-Skeleton (~2h)

**Variante (c) — Branch in TwinService.chat() vor `generateText`-Call.** Vor der ganzen Skill/Tool/Pre-Pass-Logik wird `profilesRepo.findById()` mit frischem `authMode`-Lookup konsultiert; bei `oauth` → `runModelViaCodex` (eigene Helper-Methode, bypassed alle Phase-3.1+-Schichten).

**Sub-Bau:**

| Schritt | Was | LoC |
|---|---|---|
| 1 | `TwinProfile.authMode` exposen (Interface + Row + INSERT/UPDATE + `setAuthMode`-Method + `rowToProfile`) | ~30 |
| 2 | `OAuthRefreshService` in `RegistryDeps` + `TwinServiceDeps`, optional gehalten | ~15 |
| 3 | `oauth/codex-adapter.ts` — direct-fetch + SSE-Text-Collector, Minimal-Codex-Instructions, planType/cfRay-Capture | ~140 |
| 4 | `runModelViaCodex` Branch in `runModel`, Codex-Adapter lazy konstruiert | ~40 |
| 5 | Helper-Script `test-oauth-phase3-spike.ts` mit `smoke`/`setup`/`cleanup`-Modes | ~150 |

**Smoke 1 (Adapter-only) — grün:**

```
✅ Codex-Token geladen (account=07b2ba12-…-2b1fd220f775)
✅ Test-Twin: @markus, authMode → oauth
✅ HTTP 200 in 2401ms
   plan-type: pro
   cf-ray:    a0133fc1fba49276-MUC
   text:      "Hello there, friend"
🧹 Cleanup: @markus authMode zurück auf 'api_key'.
```

Bilanz Smoke 1: echter Codex-Token → DB-Persist + AES-256-GCM → Refresh-Service `ensureFresh` → Direct-fetch → SSE-Stream → Text-Collect. End-to-End-Architektur verifiziert.

**Smoke 2 (End-to-End via `/twins/@markus/chat`) — grün nach #138-Fix.** Nachdem #138 (Local-Dev-Default für Runtime-Boot) durch war, `pnpm dev` neu gestartet, Setup-Mode auf `@markus`, Login als `markus.baier@harway.de`, curl gegen `/twins/@markus/chat`.

```
POST /twins/@markus/chat
  → HTTP 200 in 2937ms (server total)
  → message.content = "Hello there, friend"
  → Audit-Eintrag audit_1Qzg49Ganjsr
       capability   = owner-direct (Owner-Bypass-Pfad, kein Mandate-Check)
       status       = executed
       providerMetadata = {
         provider:  "openai-codex",
         authMode:  "oauth",
         planType:  "pro",
         cfRay:     "a01375f40961f66d-MUC",
         latencyMs: 1396
       }
```

Server-Latenz (2.9s) − Codex-Latenz (1.4s) ≈ 1.5s Owner-Direct-Vor-Pipeline (Facts-Load, Memory-Retrieval, History-Load, Audit-Start). Das ist die existing Multi-Layer-Send-Path-Kosten und unabhängig vom Codex-Branch.

**Diagnose-Erkenntnis (wichtig für Phase 3.2):** `runModelViaCodex` ignoriert Persona/Facts/Memory **bewusst** — Spike-Disziplin. Der Owner-Direct-Vor-Pfad in `chat()` lädt `[facts] loaded 9 approved facts` und `[memory-retrieval] 3 hits`, hängt sie ans Audit-Output für den Frontend-Memory-Indicator (#100), aber dem Codex-Request gehen nur `messages.at(-1).content` mit. Das `instructions`-Field bleibt der Hardcode `"You are a helpful coding assistant."` — Markus-Persona-Stimme fehlt.

**Phase 3.2 Aufgabenliste (aus Smoke-2-Diagnose):**
- Persona-Markdown → `instructions`-Field, eventuell hinter Codex-CLI-Echtem-Prefix
- Approved Facts → `instructions`-Anhang (analog `buildFactsBlock` im Vercel-SDK-Pfad)
- Memory-Hits → zusätzliche `input`-Messages (developer-Role) oder Header im User-Prompt
- History-Loader → vorherige User/Assistant-Turns als `input`-Messages
- `runModelViaCodex` braucht erweiterte Signatur (analog `runModel(persona, messages, extraSystem?, options?)`)

**#138-Verifikation in der Praxis:** Der Runtime-Restart vor Smoke 2 lief ohne explizite `TELEGRAM_USE_POLLING` in `.env` durch — Auto-Detection-Fallback hat sauber gegriffen, Warning-Log erschien, 9 Twins kamen hoch.

Phase 3.0 Spike damit **final verifiziert**. Walking-Skeleton steht End-to-End, alle Server-Layer (`requireOwner`, Owner-Bypass, Audit-Pipeline, Conversation-Persistierung) sind durchlaufen. Phase 3.1 (Tag 28) kann auf der existing Architektur aufbauen.

**Lesson Tag 27 #4: Migration ohne Repo-Update ist Anti-Pattern** — Phase 1 (#131 Tag 27 Vormittag) hat Migration 025 mit `twin_profiles.auth_mode`-Spalte angelegt, aber das Feld nie in `TwinProfile`-Interface / Row-Mapping / `SELECT *`-Queries durchgezogen. Phase 3.0 hat den Fehler beim ersten echten Konsum aufgedeckt (`profile.authMode` undefined obwohl DB-Default `'api_key'`). Repair ~30 LoC, kein Production-Risiko, aber strukturell hätten Phase 1 + Tests-fehlen das fangen müssen. Generelles Prinzip: **eine Migration ist erst „durch", wenn die Spalte sowohl im Read- als auch Write-Pfad des zuständigen Repos lebt** — Migration alleine ist Schema-Modifikation, nicht Feature-Capability.

**Phase 3.0-Outcome:** Walking-Skeleton steht. Phase 3.1-3.4 bauen darauf inkrementell mit eigenen Stop-Punkten weiter (siehe Strategy-Doc §i).

### #131 Nachmittag — Phase 3.1 Komplett (CodexSSEParser + Integration + Retry)

Phase 3.1 (SSE-Parser-Robustness) ist beidseitig durch: Standalone-Parser in 3.1.1, Integration + Retry-Wrapper in 3.1.2. Strategy-Doc §i markiert beide Sub-Phasen als ✅. Damit ist der gesamte Phase-3.0-bis-3.1-Block heute an einem Tag abgeschlossen — Walking-Skeleton + Robustness-Layer ohne Übernachtung.

#### Phase 3.1.1 — SSE-Parser Standalone (Commit `75d166d`, ~1-1.5h)

`apps/runtime/src/oauth/codex-sse-parser.ts` mit Hybrid-Approach:

- **Discriminated-Union** für sechs bekannte Event-Types (`response.created`, `response.output_item.added`, `response.output_text.delta`, `response.completed`, `response.failed`, `response.error`)
- **Generic-Fallback** für unbekannte Event-Types: Name landet in `result.unknownEventTypes`, blockt nicht
- **Error-Events werfen** `CodexStreamParseError` mit Message + Code + eventType (Spike-Phase 3.0 hat sie stillschweigend ignoriert)
- **Stateful:** `buffer` tracked Buffer-Grenzen zwischen Reader-Chunks
- **API:** `parse(body)` für Stream-Komplett-Verbrauch, `parseChunk()` + `finalize()` für Phase-3.1.2-Retry-after-Disconnect-Pfad

**Test-Approach folgt CLAUDE.md-Setzung „keine Test-Suite":** Smoke-Script mit `node:assert` + Counter, kein vitest/jest. Pattern analog `test-memory-repos.ts` / `test-episodic-repos.ts`. **8/8 Cases grün:** happy-path, chunked-reads, `response.failed` wirft Error mit Code, `[DONE]`-Termination, malformed JSON ohne Crash, unknown-Event-Sammlung, null-body-Throw, leere Event-Blöcke.

#### Phase 3.1.2 — SSE-Integration + Retry-Wrapper (Commit `707f941`, ~2-3h)

CodexAdapter refactored: `collectSSEText` raus, `CodexSSEParser` rein. Plus Retry-Wrapper basierend auf BridgeStream-Pattern (adaptiert für Promise-Loop statt EventSource-Reconnect).

**Drei neue Files:**

- `oauth/codex-http-error.ts` — `CodexHttpError` mit `status: number` Field (Pattern analog `CodexStreamParseError`, vermeidet String-Matching auf Message)
- `oauth/codex-retry.ts` — `isRetryableError` + `withRetry`, generisch typisiert (Phase 3.3 Tool-Call kann reusen)
- `scripts/test-codex-retry.ts` — 10 Cases + 1 Bonus mit `node:assert` + Counter

**Klassifizierung:**

- `CodexStreamParseError` → no-retry (Codex hat Error-Event geschickt, endgültig)
- `CodexHttpError` 4xx → no-retry (Auth/Quota/Validation, User-Action)
- `CodexHttpError` 5xx → retry (transient server-side)
- `AbortError` → no-retry (User-Cancel)
- Network-Errors (`ECONNRESET`, `ETIMEDOUT`, `ENOTFOUND`, `fetch failed`, `socket hang up`) → retry
- Conservative default: no-retry für unbekannte Messages

**Retry-Konfiguration:** Max 3 Retries, Backoff 1s/2s/4s, Full-Restart-Pattern (neuer Parser, neuer fetch, `ensureFresh` re-konsultiert für refresh-bedingten Token-Wechsel).

**11/11 Retry-Smoke grün** (10 Cases + Backoff-Timing-Bonus): isRetryableError × 6 + withRetry × 5 (Success, Loop, Non-Retryable, Exhaustion, Backoff-Sequenz).

**End-to-End-Confidence-Smoke grün** (Audit-Entry `audit_n_O_SynH6dK1`):

```
POST /twins/@markus/chat
  → HTTP 200 in 3815ms (server total, 2480ms davon Codex)
  → providerMetadata = {
      provider:           "openai-codex",
      authMode:           "oauth",
      planType:           "pro",
      cfRay:              "a013ae658812c9e3-MUC",
      latencyMs:          2480,
      responseId:         "resp_0866ee19ccb58f72016a141d3ea74c819181950e39354aa1bc",
      codexStatus:        "completed",
      unknownEventTypes:  [siehe Bonus-Discovery]
    }
```

Audit-Output ist deutlich reicher als nach Phase 3.0: `responseId` + `codexStatus` + `unknownEventTypes` kommen jetzt aus dem Parser durch TwinService bis ins Audit.

#### Bonus-Discovery für Phase 3.3

Der Hybrid-Fallback im SSE-Parser hat **fünf weitere Codex-Event-Types** in der Wildbahn captured, die heute via `unknownEventTypes` ins Audit-Meta fließen:

- `response.in_progress`
- `response.output_item.done`
- `response.content_part.added`
- `response.output_text.done`
- `response.content_part.done`

Das sind **Reverse-Engineering-Daten für Phase 3.3** (Tool-Calls + Reasoning-Traces + Content-Part-Handling). Statt diese Event-Types aus externen Quellen zu deduzieren (Simon-Willison-Blog, HuggingFace codex-proxy), haben wir sie jetzt mit echtem Codex-Pro-Account direkt aus dem Stream. Strategy-Doc §i hat den Hinweis unter Phase 3.3 dokumentiert.

**Architektur-Win:** Hybrid-Approach (Discriminated-Union + generic Fallback) zahlt sich sofort aus — strikte Schema-Validierung hätte heute schon 5 Events geworfen statt sie zu sammeln.

### #131 Nachmittag/Abend — Phase 3.2 Codex-System-Prompt + Persona-Mapping (Commit `a949b7e`, ~2h)

Phase 3.2 schließt die Phase-3.0-Lücke: `runModelViaCodex` ignorierte bisher Persona/Facts/Memory bewusst (Spike-Disziplin). Phase 3.2 reicht die komplette System-Prompt-Komposition + History durch — strukturell sauber via extrahiertem Helper.

#### Diagnose-Catch

Briefing-Annahme war, `runModelViaCodex` müsse eine `conversationId`-Option akzeptieren und History selbst via `conversationsRepo.loadMessages` laden. Phase-3.2.1-Diagnose hat das korrigiert: `messages`-Parameter enthält **bereits** History (vom Caller `runOwnerDirect` pre-built via `loadConversationHistory` + `auditsToOwnerDirectMessagesChronological`). Codex-Pfad braucht nur Format-Mapping, kein History-Loading. Substantielle Vereinfachung gegenüber Briefing-Plan.

Zweiter Diagnose-Catch: kein dedizierter `buildSystemPrompt`-Helper existing — Composition ist **inline in `runModel`** (7 Schichten). Ohne Helper-Extraktion würde Phase 3.2 die Schichten-Logic im Codex-Pfad duplizieren — strukturelles Drift-Risiko bei künftigen Erweiterungen (Phase 3.3 zieht z.B. Skills + TOOL_USE_DIRECTIVE nach).

#### Bau

**`composeOwnerSystemPrompt(parts)`** — neue top-level Function in twin-service.ts neben `LANGUAGE_DIRECTIVE`. Sieben Parameter (persona, extraSystem, factsBlock, skillsBlock, toolUseDirective, summaryBlock, episodicBlock), `.filter(Boolean).join("\n\n")`-Pattern wie vorher. Beide Pfade nutzen denselben Helper:

- **Vercel-SDK-Pfad (`runModel`):** alle 7 Schichten, `skillsBlock` + `TOOL_USE_DIRECTIVE` werden vom Caller berechnet
- **Codex-Pfad (`runModelViaCodex`):** 5 von 7 Schichten — `skillsBlock` + `toolUseDirective` als `null` übergeben (Phase 3.3 zieht Tool-Use nach)

**`mapChatMessagesToCodexInput(messages)`** — neue Helper-Function: user → `input_text`, assistant → `output_text` (matched Codex-Response-Format). System-Messages werden übersprungen, weil System-Prompt via `instructions`-Field geht.

**`runModelViaCodex` neue Signatur:**

```typescript
private async runModelViaCodex(
  persona: Persona,
  messages: ChatMessage[],
  extraSystem?: string,
  options: {
    factsBlock?: string | null;
    episodicBlock?: string | null;
    summaryBlock?: string | null;
  } = {},
): Promise<{ content: string; metadata: Record<string, unknown> }>
```

**`CodexAdapter` Hybrid-Architektur:** Adapter ist jetzt reiner HTTP-Client. `CodexAdapterInput` akzeptiert pre-built `instructions: string` + `input: CodexInputItem[]` statt rohes `userMessage`. `SPIKE_INSTRUCTIONS`-Konstante entfällt. `CodexInputItem`-Type exportiert für Caller-Type-Safety.

**Aufruf-Site in `runModel`:** OAuth-Branch (Z. 1610) reicht jetzt `extraSystem` + `options.factsBlock/episodicBlock/summaryBlock` durch.

#### Smoke 3 End-to-End grün (Audit `audit_kbYtQUfxn9Jy`)

```
POST /twins/@markus/chat
  → Frage: "Wer bist du? Beschreib dich in 2-3 Sätzen."

  → Reply: "Ich bin der digitale Twin von Markus Johannes Baier.
     Ich spreche in seinem Namen, soweit das in meinem Mandat liegt:
     AI-native Product Delivery, Design Systems, Vibe Coding,
     Agentic AI und HARWAY Experience.
     Ich bin nicht sein Assistent und treffe keine verbindlichen
     Zusagen für ihn."

  → providerMetadata = {
      provider:    "openai-codex",
      authMode:    "oauth",
      planType:    "pro",
      cfRay:       "a013e1491cb79b35-MUC",
      latencyMs:   3215,
      responseId:  "resp_00f5f250cc1ba6b2016a142562f5908191be7a85870e4aa375",
      codexStatus: "completed",
      unknownEventTypes: [5 captures wie Phase 3.1.2]
    }
  → memoryHits: 3 (episodic search lieferte 3 relevante Hits)
```

**Smoke-Bilanz:** klare Markus-Persona statt Phase-3.0-„Hello there, friend"-Output, deutsche Sprache (LANGUAGE_DIRECTIVE wirkt durch), Mandate-Wissen aus Persona-Markdown, Owner-vs-Twin-Guardrail aktiv, 3 Memory-Hits aus Episodic-Search durchgereicht. Phase-3.0-Lücke vollständig geschlossen.

### #131 Abend — Phase 3.3.0 Spike Tool-Call-Discovery (Commit `9fa266a`, ~1h)

Spike-First wie Phase 3.0: vor dem Bau das Format verifizieren statt auf Hypothesen-Code zu bauen. Vorbereitung mit Diagnose A-D hat ergeben, dass CodexSSEParser `response.output_item.added` heute als No-op behandelt mit explizitem Phase-3.3-TODO-Marker (`apps/runtime/src/oauth/codex-sse-parser.ts:222-226`). Format der Tool-Call-Events war Spike-Ziel.

#### Spike-Disziplin

- **Token-Quelle direkt aus `~/.codex/auth.json`** (kein DB-Touch, kein authMode-Switch, kein Setup/Cleanup-Mode). Memory-Setzung etabliert: Discovery-Spikes lesen direkt, Production-Pfad-Tests (Smoke 1/2/3) gehen über DB + OAuthRefreshService.
- **Kein CodexSSEParser-Touch.** Manuelles SSE-Parsing im Spike-Script — Parser-Erweiterung folgt in Phase 3.3.1 auf verifizierter Format-Hypothese statt auf Annahmen.
- **Mock-Function-Definition** `get_current_time` (OpenAI Responses API Format), Prompt explizit mit Tool-Use-Anweisung („You MUST call the get_current_time tool").

`apps/runtime/src/scripts/test-oauth-phase3-3-spike.ts` (215 Z) — Raw-fetch, Event-Histogram, Tool-Call-Match-Suche, Full-Raw-Dump. Plus Script-Eintrag in `apps/runtime/package.json` (`twin:oauth-phase3-3-spike`).

#### Spike-Output (HTTP 200, 758ms to first byte, 1641ms total)

**Event-Type-Histogram (14 Events, 7 distinct Types):**

```
  8× response.function_call_arguments.delta
  1× response.created
  1× response.in_progress
  1× response.output_item.added
  1× response.function_call_arguments.done
  1× response.output_item.done
  1× response.completed
```

**Drei neue Event-Types** gegenüber Phase-3.1/3.2-Text-Response-Smokes:

- `response.output_item.added` mit `item.type === "function_call"` (Tool-Call beginnt)
- `response.function_call_arguments.delta` (Streaming-Chunks der Argument-JSON, analog `output_text.delta` für Text)
- `response.function_call_arguments.done` (vollständige Arguments JSON-String)

Plus zwei bereits-bekannte Phase-3.1.2-Bonus-Discovery-Events (`response.in_progress` + `response.output_item.done`) werden hier auch genutzt.

#### Substantielle Findings für Phase 3.3.1

1. **2 IDs pro Tool-Call:** `item.id` (`fc_...`, Codex-internes Tracking) vs `call_id` (`call_...`, für Multi-Step-Tool-Result-Reference)
2. **Arguments als JSON-String** (nicht Object) — Phase 3.3.1 muss `JSON.parse(item.arguments)` vor Mapping
3. **`strict: true`** wurde Codex auto-ergänzt zum Tool-Schema
4. **`obfuscation`-Field** auf jedem Delta-Event (vermutlich CF-Bot-Mgmt, ignorieren)
5. **`output_index: 0`** auf allen Events (parallel_tool_calls=false setting — Multi-Index erst bei parallel=true)
6. **Keine Reasoning-Traces** in diesem Smoke trotz `reasoning.effort: "medium"` (vermutlich bei diesem Tool-Call-Pfad kein Reasoning getriggert)
7. **`usage`-Field** in `response.completed`: `input_tokens: 194`, `output_tokens: 22` — Cost-Tracking-Eingangsdaten für mögliche Phase 3.5

#### Mapping-Hypothese auf existing MCP-Pipeline

Ziel Phase 3.3.1: Codex-Tool-Call auf existing `AuditMcpToolUseInputSchema` mappen (`packages/shared/src/index.ts:383`), damit Approval-Pipeline (`/audit/:id/approve`) und MCP-Tool-Execution unverändert greifen. Skills-Repo-Reverse-Lookup `name → {mcpServerId, mcpToolName}` braucht ggf. Schema-Erweiterung wenn aktueller Skill-Lookup nur über interne IDs geht.

**Offene Frage Phase 3.3.1:** Multi-Step-Round-Trip — nach Tool-Result muss neuer Codex-Request mit `function_call_output`-Input-Item gesendet werden. Schema noch nicht verifiziert (Spike 3.3.0 stoppt nach erstem Tool-Call). Bau-Briefing Phase 3.3.1 muss das als eigenen Sub-Spike adressieren oder via OpenAI-Responses-API-Doku-Recherche klären.

Detail-Format + 4 JSON-Beispiel-Events in `docs/131-OAUTH-STRATEGY.md §k`.

### #131 Abend — Phase 3.3.2 Spike Multi-Step-Tool-Roundtrip (Commit `e4d403a`, ~45 Min)

Zweiter Discovery-Spike der Phase 3.3 — Multi-Step-Tool-Roundtrip-Format verifizieren bevor Phase 3.3.1 die MCP-Pipeline-Integration baut. Reduzierter Spike-Scope: Tool-Definition-Format ist konzeptionell aus 3.3.0 geklärt (Codex hat HTTP 200 mit Hand-built-Schema + `strict: true` auto-ergänzt gezeigt). Diagnose 3.3.2.1 hat ergeben: `buildMcpToolsFromSkills` returnt Vercel-AI-SDK-`Tool`-Objects, NICHT Codex-Schema — Phase 3.3.1 braucht einen eigenen `mapSkillsToCodexTools`-Helper (~30 LoC). Hauptfokus des Spikes blieb damit Multi-Step.

#### 3-Hypothesen-Test

Spike-Script (`apps/runtime/src/scripts/test-oauth-phase3-3-2-spike.ts`, 280 Z) testet sequenziell:

- **A:** `function_call_output`-Item im `input`-Array (gleiche conversation, gleiches `tools`-Feld)
- **B:** `previous_response_id` im body, nur `function_call_output` im input
- **C:** Tool-Output als context-Message in `instructions`, neuer Roundtrip ohne `tools`

**HYPOTHESE A gewinnt First-Try** — HTTP 200 in 521ms. Codex hat Mock-Tool-Output `{"time":"2026-05-25T14:30:00+02:00","timezone":"Europe/Berlin"}` korrekt interpretiert und natürliche Antwort generiert: **„It's 14:30 in Berlin right now."** Hypothesen B + C wurden nicht ausgeführt.

#### Substantielle Findings

1. **`store: false` ist OK für Multi-Step** — kein Codex-Side-State-Management, alles im Request-Body. Twin-Lab-Pattern bleibt stateless (matched existing 3.0-Setzung).
2. **`call_id` ist die Cross-Reference** zwischen `function_call` und `function_call_output` (nicht `item.id`/`fc_...`). §k-Hypothese bestätigt.
3. **`previous_response_id` nicht notwendig** für Multi-Step (wäre incompatible mit `store: false`).
4. **Echo-Pattern:** Der `function_call`-Item im input-Array ist Echo des LLM-Outputs aus Step 1 — `call_id`/`name`/`arguments` müssen für Resume persistiert werden (Pending-Audit-State).
5. **`tools`-Field muss wiederholt werden** im Resume-Request — sonst weiß Codex nicht, dass `function_call_output` zu einem function-Tool gehört.

#### Bonus-Closure: Phase-3.1.2-Bonus-Discovery-Events vollständig zugeordnet

Alle 5 zuvor unbekannten Event-Types aus Phase 3.1.2 sind jetzt mapped:

| Event-Type | Rolle |
|---|---|
| `response.in_progress` | Status-Marker nach `response.created`, identisches Body |
| `response.output_item.added`/`.done` | Item-Lifecycle — `item.type` discriminiert `message` (Text-Antwort) vs `function_call` (Tool-Call) |
| `response.content_part.added`/`.done` | Content-Part-Lifecycle innerhalb `message`-Items (NICHT bei function_call) |
| `response.output_text.done` | Text-Akkumulation-Final-Marker mit komplettem Text-Field |

Final-Antwort-Event-Sequenz für Text-Response (HYPOTHESE A): 19 Events, 9 distinct Types — 11× `output_text.delta` plus den Item/Content-Lifecycle drumherum.

#### Phase-3.3.1-Bau-Implikationen (in §l ausführlich)

- **CodexSSEParser:** `response.output_item.added`/`.done` braucht `item.type`-Discrimination (`message` → No-op, `function_call` → §k-Akkumulation)
- **`mapSkillsToCodexTools`-Helper** (~30 LoC, parallel zu existing `buildMcpToolsFromSkills`)
- **Multi-Step-State im Codex-Adapter:** unterscheiden zwischen Initial-Request und Resume-Request
- **call_id-Persistenz:** Option (a) aus 3.3.2.1.B — Pending-Audit-Input erweitern um optionales `codexCallId`/`providerCallId`
- **Approval-Pipeline-Branch:** `/audit/:id/approve`-Resume muss provider-discriminiert handeln (AI-SDK vs CodexAdapter mit function_call_output-Pattern)

### #131 Abend — Phase 3.3.1.1 Helper + Parser-Erweiterung (Commit `d576c05`, ~1.5h)

Erste Sub-Phase des substantiellen Phase-3.3.1-Code-Schritts: Helper und Parser standalone bauen + testen, bevor TwinService-Integration kommt.

#### Bau

`apps/runtime/src/oauth/codex-tool-mapper.ts` (neu, ~60 Z) — `mapSkillsToCodexTools(skills) → CodexToolDefinition[]`. Filter-Logic 1:1 wie `tool-bridge.ts:112-114` (source=mcp + isActive + mcpServerId/Name present), Tool-Key-Convention `replaceAll(":", "_")` matched `buildMcpToolsFromSkills` (Cross-Provider-Reverse-Lookup bleibt portabel), EMPTY-Schema-Fallback bei fehlendem `mcpInputSchema` (analog `EMPTY_INPUT_SCHEMA`-Pattern). Field-Mapping aus `skill.manifestJson` (Diagnose-Catch — Briefing hatte falschen Pfad `skill.mcpInputSchema` statt `skill.manifestJson.mcpInputSchema`).

`apps/runtime/src/oauth/codex-sse-parser.ts` (erweitert, +~180 Z, additiv):
- `CodexOutputItem`-Discriminated-Union exportiert (message/function_call/reasoning/generic)
- 7 neue Event-Types in `CodexStreamEvent`-Union (in_progress, output_item.done, content_part.added/done, output_text.done, function_call_arguments.delta/done)
- `CodexParseResult` erweitert: `toolCalls: CodexToolCall[]` + `reasoningTraces: unknown[]`
- State: `toolCallsByItemId`-Map (keyed by `item.id` für Streaming-Akkumulation)
- Dispatch erweitert: `output_item.added/done` mit `item.type`-Discrimination (function_call → toolCalls, reasoning → reasoningTraces, message → No-op), `function_call_arguments.delta` akkumuliert pro itemId, `.done` überschreibt defensive (Buffer-Boundary-Sicherheit), 4 Signal-Events explicit No-op statt unknownEventTypes (verhindert Audit-Meta-Noise bei jedem Text-Response)

#### Tests

`apps/runtime/src/scripts/test-codex-sse-parser.ts` auf 15 Cases erweitert (8 existing bleiben grün): 4 neue Parser-Cases (function_call-Capture, parallel-tool-calls, reasoning-Trace, signal-events), 3 Helper-Cases (single-convert, filter, empty-schema-fallback). **15/15 grün.**

### #131 spät-Abend — Phase 3.3.1.2 Multi-Step-Loop + Auto-Execute (Commit `797a464`, ~2h)

Substantielle Code-Phase: Codex-OAuth-Twins können jetzt MCP-Tools rufen — Auto-Execute via existing McpClient, Multi-Step-Roundtrip per §l-Pattern. Approval-Pipeline für `requires_approval`-Skills bleibt Phase 3.3.1.3.

#### Diagnose-Catches (Briefing-Plan substantiell vereinfacht)

**1. Migration 026 entfällt vollständig.** Twin-Lab persistiert Tool-Calls als JSON-Array im `audit.output.toolCalls`, **nicht** in einer relationalen Tabelle. Existing Pattern (`twin-service.ts:1865-1894`): `AuditToolCall[]` wird in `metadata.toolCalls` gepackt → `audit.complete(id, { providerMetadata })` schreibt es als JSON. AuditToolCallSchema-Erweiterung um `codexCallId` optional ist damit Schema-only — kein SQL-Migration, keine DB-Schema-Änderung, keine Repo-Method-Anpassung.

**2. mapSkillsToCodexTools-Map-Pattern statt String-Replace-Reverse-Lookup.** Existing Skills wie `mcp:hyperbrowser-approval:scrape_webpage` haben `_` im `mcpToolName`-Teil. Codex-Tool-Name wird `mcp_hyperbrowser-approval_scrape_webpage`, naives `replaceAll("_", ":")` würde 5 Segmente liefern statt 3 — Reverse-Lookup-Ambiguity zerstört Dispatching. Helper-Refactor: returnt jetzt `{ tools, skillByCodexName: Map<string, Skill> }` (parallel zu `buildMcpToolsFromSkills.skillByToolKey`). Map ist eindeutig, robust gegen Edge-Cases. Test-Suite +1 Case (16/16) mit Hyperbrowser-Edge-Case + Naive-String-Replace-Counter-Example.

#### Bau

- CodexAdapterInput erweitert um optional `tools`, CodexAdapterOutput reicht `parser.toolCalls` durch
- AuditToolCallSchema in shared erweitert: `codexCallId` optional
- `runModelViaCodex` Multi-Step-while-Loop:
  - `CODEX_MAX_TOOL_ITERATIONS = 5` (Safety-Cap analog AI-SDK `stepCountIs(5)`)
  - Pro Iteration: `codex.generateText` mit `tools`-Field (§l: tools muss pro Iteration mitgeschickt werden), Tool-Calls extrahieren, Auto-Execute via `this.mcp.callTool`, `function_call`+`function_call_output` ans input-Array appenden
  - Tool-Execution-Errors als `isError=true`-Output an Codex zurückgereicht statt Loop crashen
  - Audit-Metadata: `codexIterations` + `toolCalls[]` mit `codexCallId`
- Aufruf-Site (`runModel:oauth-Branch`) lädt skills via `this.deps.skills.list(twinId, { activeOnly: true })` und reicht sie durch

#### Smoke-Verifikation (echter @markus / oauth / Codex-Pro)

- **Smoke 1** (audit `audit_huPk4-BddyVD`): 220s Wall-Clock, 2 Iterationen, grün aber substantiell langsam — Hypothese: alter Token nach setup-Idle hat Refresh-Service blockiert (siehe BACKLOG #139)
- **Smoke 2** (audit `audit_fKxYZKYZYL5j`): 16.4s Wall-Clock, 15.1s Codex-Latenz, `codexIterations=2`, `mcp:everything:get-sum(a=89,b=134)` → „The sum of 89 and 134 is 223", reply „89 plus 134 ergibt 223." — clean Roundtrip mit frischem Token

Audit-Beleg vollständig: `toolName=mcp:everything:get-sum`, `input={a:89, b:134}`, `output.text="The sum of 89 and 134 is 223"`, `codexCallId=call_SL1AFdhUIPU00EsHqHBOCmid`. Phase 3.3.1.2 End-to-End-grün.

#### Latenz-Diskrepanz → BACKLOG #139

Faktor 14× Latenz zwischen Smoke 1 (220s) und Smoke 2 (15s) bei identischem Flow deutet auf Token-Refresh-Block-Pattern hin: `OAuthRefreshService.ensureFresh` wird pro Codex-Request synchron konsultiert (codex-adapter.ts:78), bei nahem Ablauf vermutlich Refresh-Endpoint-Stall + Retry-Backoff-Akkumulation. **Kein Phase-3.3.1.2-Blocker** (Smoke 2 verifiziert Code-Korrektheit), aber Production-UX-Issue für langlebige Sessions. Detail-Diagnose in BACKLOG #139 (Medium-Priorität, Phase B / Polish).

#### Plan Tag 28+

- **Phase 3.3.1.3 Approval-Pipeline (Tag 28, ~1 Tag)** — `requires_approval`-Skills im Codex-Pfad: Pending-Audit-State, `/audit/:id/approve`-Branch für `provider=openai-codex`, Resume mit `function_call_output` analog 3.3.1.2-Auto-Execute aber nach User-Approval
- **Phase 3.3.3 Reasoning-Traces (Tag 29, optional, ~0.5 Tag)** — `item.type === "reasoning"` handlen, Audit-Persistenz
- **Phase 3.4 Vercel-Provider-Refactor (optional, Tag 29-30)** — Entscheidung nach 3.3.1.3: wenn Direct-fetch sauber bleibt, kann 3.4 entfallen

### #131 Nacht — Phase 3.3.1.3.0 Diagnose + Phase 3.3.1.3.1 Codex-Pause-Pfad (Commits `67dc9f3` + nächster, ~3h)

**Block 15 splittet sich in zwei Sub-Phasen:** zuerst eine reine Diagnose der existing Approval-Pipeline (Phase 3.3.1.3.0, `67dc9f3`, kein Code), dann der Pause-Pfad-Bau (Phase 3.3.1.3.1).

#### Phase 3.3.1.3.0 Diagnose-Output (kein Code-Commit, ~1h)

Reverse-Engineering der Vercel-SDK-Approval-Pipeline als Grundlage für Phase-3.3.1.3.1-Architektur. Findings in §m (docs/131-OAUTH-STRATEGY.md):

- **A:** Approval läuft via Marker-Pattern (`MCP_PENDING_APPROVAL_MARKER`), nicht Throw — AI SDK 6 schluckt `execute()`-Throws. `detectPendingToolCall` + `stopOnPendingApprovalMarker` triggern den Pending-Audit-Pfad.
- **B:** Vollständiger Resume-Context in `audit.input` (`messages` + `toolCall` + `pendingReply` + `conversationId` + `originalCapability`) — Server-Restart-stabil.
- **C:** `POST /audit/:id/approve` → synchron Tool-Execute + Resume-LLM-Call mit `enableMcpTools:false` → `audit.complete`. Race-Sicherheit via `entry.status !== "pending"`-Check.
- **D:** Frontend ist SSE-getriebenes Audit-Stream-SSoT, kein Polling. `pending-added`/`pending-resolved` triggern Reload.

**Empfehlung Phase 3.3.1.3.1:** Hypothese 1 (Async-Pending analog Vercel-SDK-Pfad). Schema-Erweiterung `audit.input.codexResumeContext` additiv (kein Migration). Aufwand M (1.5-2 Bautage geschätzt).

#### Phase 3.3.1.3.1 Sub-Diagnose (Phase 3.3.1.3.1.1, kein Commit, ~30min)

Diagnose-Reflex 14. Mal: substantielle Briefing-Korrekturen aufgedeckt vor Bau:

1. `auditRepo.createPending(...)` existiert nicht — korrekte API ist `audit.start({initialStatus: "pending"})`. SSE `pending-added` wird automatisch emittiert.
2. `AuditEntry`-Top-Level hat KEINE `pendingReply`/`pendingToolCall`-Felder — die leben in `input.*` (matched existing `AuditMcpToolUseInputShape`).
3. `mapSkillsToCodexTools` braucht keinen Refactor — Skill-Object in der existing Map enthält bereits `manifestJson.requiresApproval`.
4. `CodexInputItem`-Type ist heute schmal (`{type:"message",...}`); `function_call`/`function_call_output`-Items wurden per `unknown`-Cast geforced — für typesafe Resume-Persistence braucht's eine Discriminated Union (`CodexInputItemAny`).
5. Pre-Call-Detect-Einbau-Stelle: zwischen `parsedArgs`-Parse (Z.1604) und `mcp.callTool` (Z.1614).
6. **Substantielle Entdeckung:** @markus war im DB-Stand bereits auf `auth_mode='api_key'` zurückgesetzt (vorheriger Smoke-Cleanup). Smoke-Sequenz braucht `pnpm twin:oauth-phase3-spike setup` vorher.
7. **Skill-Konflikt:** beide `mcp:everything:get-sum` (no-approval) und `mcp:everything-approval:get-sum` (approval) sind aktiv. Trigger musste explizit auf die approval-Variante zielen.

Architektur-Wahl: **(A) Throw + Vercel-Catch-Reuse** statt (B) Codex-lokaler Pending-Insert — maximaler Code-Reuse, Symmetrie zum Vercel-Pfad. **(i) Reihenfolge-treu** für Multi-Tool-Edge-Cases — autoTools davor exekutiert, ApprovalTool stoppt, restliche verworfen.

#### Bau Phase 3.3.1.3.1 (~1.5h)

- `apps/runtime/src/oauth/codex-adapter.ts`: neue Types `CodexFunctionCallItem`, `CodexFunctionCallOutputItem`, Union `CodexInputItemAny`, plus `CodexResumeContext`-Interface (12 Felder) + `AuditToolCallSnapshot`-Mini-Shape (lokal, vermeidet harten Import des Shared-Types in OAuth-Layer)
- `apps/runtime/src/mcp/errors.ts`: `McpToolApprovalRequiredError`-Class erweitert um optionales `codexResumeContext`-Property — single Class für beide Auth-Modi, Catch checkt nur `err.codexResumeContext != null`
- `apps/runtime/src/twin-service.ts`:
  - `input`-Array-Type von `CodexInputItem[]` auf `CodexInputItemAny[]` (Cast auf Adapter-Param-Type bei `codexAdapter.generateText`-Call)
  - Pre-Call-Detect-Block im Multi-Step-Loop: vor `mcp.callTool` prüfen `skill.manifestJson.requiresApproval` → `throw McpToolApprovalRequiredError` mit Snapshot vor function_call-Echo
  - `input.push()`-Casts cleanup: kein `as unknown as CodexInputItem` mehr — typesafe via `CodexInputItemAny`
  - `AuditMcpToolUseInputShape` (lokal) um `codexResumeContext?: CodexResumeContext` erweitert
  - Catch in `runOwnerDirect` (Z.728-759): additive spread-conditional `...(err.codexResumeContext ? { codexResumeContext: err.codexResumeContext } : {})` ans Pending-Audit-Input

Typecheck grün. Build nicht aufgerufen (Memory: kein `next build` während Dev läuft).

#### Smoke-Bilanz (echter @markus / oauth / Codex-Pro, audit `audit_KgWbPjYW_BF4`)

Setup automatisch via `pnpm twin:oauth-phase3-spike setup`. User-Curl mit explizitem approval-Trigger:
```
Bitte rufe das Tool mcp:everything-approval:get-sum mit a=17 und b=25 auf.
```

**HTTP 200 mit `pending=true`** und vollständigem Audit-Eintrag persistiert:
- `capability=mcp-tool-use`, `status=pending`
- `input.toolCall.mcpServerId=mcp_xkSaTJvmajv5KG4r`, `mcpToolName=get-sum`, `args={a:17,b:25}`
- `input.pendingReply` mit deutscher Persona-Wartemeldung
- **`input.codexResumeContext` mit allen 12 Feldern persistiert:** `pendingToolCall` mit Codex-IDs (callId=`call_elbjcx5cdrdSLF1au4bls2V0`, itemId=`fc_0ed98...`), `inputItems`-Count=35, `toolDefinitions`-Count=36, `iterationCount=1`, `aggregatedText=""`, `previousToolCalls=[]`, `lastResponseId=resp_0ed98...`, `lastStatus=completed`, `lastPlanType=pro`, `lastCfRay=null`, `totalLatencyMs=2823`, `unknownEventTypes=[]`

Audit-Eintrag nach Verify gelöscht (DB-State sauber für Phase 3.3.1.3.2-Smoke). Cleanup automatisch via `pnpm twin:oauth-phase3-spike cleanup` → @markus zurück auf `api_key`.

Substantielle Architektur-Beweise:
- **Pre-Call-Detect funktioniert:** Codex wählte `mcp_everything-approval_get-sum` (requires_approval=true) → Loop wirft VOR `mcp.callTool`, kein Tool-Execute
- **Resume-Context Server-Restart-stabil:** alle Codex-IDs + Loop-State + Tool-Definitions in DB
- **Symmetrie zum Vercel-SDK-Pfad:** identischer Pending-Audit-Insert-Pfad, additive spread-Zeile

#### Plan Tag 28+ (revidiert)

- **Phase 3.3.1.3.2 Codex-Resume-Pfad (Tag 28, ~3-4h S-M)** — `approveMcpToolUseViaCodex`-Branch: Token-Refresh, Tool-Execute, function_call_output-Append, neue `runModelViaCodex`-Iteration mit `inputItems`+`toolDefinitions`+`previousToolCalls` aus Resume-Context. Reject-Pfad analog mit System-Message-Append.
- **Phase 3.3.3 Reasoning-Traces (Tag 28-29, optional, ~0.5 Tag)** — `item.type === "reasoning"` handlen, Audit-Persistenz
- **Phase 3.4 Vercel-Provider-Refactor (optional, Tag 29-30)** — Entscheidung nach 3.3.1.3.2

§n in docs/131-OAUTH-STRATEGY.md dokumentiert: Architektur-Wahl, Reihenfolge-treu-Strategie, 12-Felder-Resume-Context-Schema, Smoke-Bilanz mit JSON-Beweis, Multi-Tool-Edge-Cases für BACKLOG, Bridge-Hypothese für Phase 3.3.1.3.2.

### #131 Nacht — Phase 3.3.1.3.2 Codex-Resume-Pfad (Commit nächster, ~3h)

**Block 16 schließt #131 Phase 3.3 substantiell ab.** Codex-OAuth-Twins können MCP-Tools mit `requires_approval=true` jetzt vollständig durchlaufen: Pause (Phase 3.3.1.3.1) → User-Approve → Tool-Execute + Codex-Resume-Iteration → finale Antwort.

#### Diagnose-Korrekturen (Phase 3.3.1.3.2.1, ~30min)

Substantielle Architektur-Findings die Briefing-Annahmen korrigiert haben:

1. **`approveMcpToolUse` ruft `runModel`, NICHT `runModelViaCodex` direkt.** Der oauth-Branch in `runModel` (Z. 1818-1827) ignoriert `enableMcpTools` und lädt IMMER alle aktiven Skills. Heißt: Naive Wiederverwendung im Codex-Pfad würde eine NEUE Codex-Iteration ohne function_call_output starten, kein Resume. Konsequenz: `approveMcpToolUseViaCodex` muss direkt `runModelViaCodex` aufrufen mit `resumeContext`-Option.
2. **Helper-Extraktion für Pending-Audit-Build NÖTIG.** Re-Pause im Approve-Pfad würde sonst Code-Duplication des existing runOwnerDirect-Catch erzeugen. `buildPendingMcpAuditFromError` als private Method extrahiert, beide Stellen rufen ihn.
3. **`ApproveResult` braucht `pending?: boolean`-Feld** für Re-Pause-Variante im Approve-Response.
4. **Reject-Pattern Status bleibt `rejected`** (nicht executed) — `audit.repo.update` mit erhaltenem Status, NICHT `audit.complete`.
5. **Skill-Lookup im Resume via `mapSkillsToCodexTools(skills.list).skillByCodexName`** — Naive `replaceAll("_", ":")` bricht bei underscored Tool-Namen.
6. **Re-Pause hat eigenen Pending-Audit mit `priorAuditId`-Link** für Trace/UX.

Architektur-Wahlen (alle aus Diagnose): (1) `runModelViaCodex.options.resumeContext` (Init-Skip), (A) Helper-Extract, (X) `priorAuditId`-Field, (4a) `ApproveResult.pending?: boolean`, (5a) Reject via `function_call_output` mit `[isError=true]`-Marker.

#### Bau (~2h)

- `ApproveResult` + `AuditMcpToolUseInputShape` um `pending?: boolean` und `priorAuditId?: string` erweitert
- `buildPendingMcpAuditFromError`-Helper extrahiert; `runOwnerDirect`-Catch refactor (Phase-3.3.1.3.1-Verhalten bleibt unverändert, nur Code-Wiederverwendung)
- `runModelViaCodex` um `options.resumeContext: {fromAudit, toolOutput, executedToolCall}` erweitert. Init-Branch verzweigt: Initial-Path (existing) vs Resume-Path (input = inputItems+function_call+function_call_output, Loop-State aus Snapshot, allToolCalls = previousToolCalls + executedToolCall). codexTools aus Pause-Snapshot, skillByCodexName aus aktuellen Skills (User-Toggle-Respekt)
- `approveMcpToolUse`-Switch via `codexResumeContext` → `approveMcpToolUseViaCodex` (Tool-Execute via existing McpClient, Resume-Iteration via runModelViaCodex, audit.complete mit kompletten toolCalls, Re-Pause-Catch mit Original-Audit auf executed+followUpPending + Helper-Aufruf für neuen Pending mit priorAuditId)
- `rejectPending`-Switch im mcp-tool-use-Branch via `codexResumeContext` → `rejectMcpToolUseViaCodex` (kein Tool-Execute, function_call_output mit `[isError=true]`-Rejection-Message, audit.repo.update mit erhaltenem rejected-Status, Re-Pause analog)

Typecheck inkrementell nach jedem Schritt grün.

#### Smoke-Bilanz (echter @markus / oauth / Codex-Pro, audit `audit_gSqqVwGGBY6O`)

Setup automatisch via `pnpm twin:oauth-phase3-spike setup`. User-Curl:
1. Pause-Trigger via `/twins/@markus/chat` → HTTP 200 mit `pending=true, auditId=audit_gSqqVwGGBY6O` (Phase-3.3.1.3.1-Verhalten unverändert)
2. Approve via `POST /twins/@markus/audit/audit_gSqqVwGGBY6O/approve` → HTTP 200 mit `{auditId, message: {content: "17 plus 25 ergibt 42."}, reply: "17 plus 25 ergibt 42."}`
3. Audit-Verify zeigt:
   - `status: executed`, `capability: mcp-tool-use`
   - `reply: "17 plus 25 ergibt 42."` (deutsche Persona aktiv)
   - `toolCalls[0]`: `toolName=mcp:everything-approval:get-sum`, `output="The sum of 17 and 25 is 42."`, `codexCallId=call_BG2NRMd2pGqunYM8sYuuJj9x`
   - `codexIterations: 2` (Pause + Resume)
   - `followUpPending: null` (kein Re-Pause in diesem Smoke)
   - `latencyMs: 5424`, `planType: "pro"`

Audit nach Verify gelöscht. Cleanup automatisch via `... cleanup` → @markus zurück auf `api_key`.

#### Architektur-Beweise

- **Approve-Branch greift**: `audit.input.codexResumeContext` aus Phase-3.3.1.3.1-Persistenz wird gelesen, Codex-Branch in `approveMcpToolUse` aktiv (sonst Vercel-Pfad mit fehlerhaftem runModel-Call)
- **Tool-Execute funktioniert**: get-sum(17,25) → echtes Codex-Tool-Output sichtbar
- **Resume-Iteration läuft**: codexIterations=2, Persona+Sprache+Konversations-Kontext rekonstruiert
- **§l-Pattern in Praxis**: function_call+function_call_output ans input-Array aus Pause-Snapshot
- **Skill-Reverse-Map funktioniert**: `mcp_everything-approval_get-sum` korrekt aufgelöst auf `mcp:everything-approval:get-sum`
- **Re-Pause-Pfad code-komplett, Smoke offen** — `get-sum` triggert keine Follow-up-Tools. BACKLOG-Item dokumentiert.

#### Plan Tag 28+ (revidiert nach #131-Phase-3-Closure)

- **Phase 3.3.3 Reasoning-Traces** (optional, ~0.5 Tag) — `item.type === "reasoning"` handlen + Audit-Persistenz. Optional weil heute nicht in UI gerendert.
- **Phase 3.4 Vercel-Provider-Refactor** (optional) — Direct-fetch funktioniert, würde sich erst lohnen wenn Vercel-AI-SDK vergleichbare Funktion bietet.
- **Phase 4 CLI-Login-Command** (~1 Tag) — `pnpm twin:oauth-login` mit Loopback-Listener für lokales+VPS-Login
- **Phase 5 Web-UI Status + Smoke + Doku + #131-Closure** (~1-1.5 Tage)

§o in docs/131-OAUTH-STRATEGY.md dokumentiert: Architektur-Symmetrie, buildPendingMcpAuditFromError-Helper-Pattern, Re-Pause-Pfad-Architektur (gebaut, Smoke offen), Reject-Pattern mit function_call_output `[isError=true]`-Marker, Phase-3-Outcome-Tabelle (api_key vs oauth Capability-Parity).

### #131 Spät-Nacht — Phase 3.3.3.0 Spike + Phase 3.3.3.1 Reasoning-Persistenz (Commits `0cf822e` + nächster, ~75min total)

**Block 17 + 18** schließen #131 Phase 3.3 vollständig zu (vorher "substantiell-zu" nach Block 16). Reasoning-Traces + Reasoning-Token-Count sind jetzt im Audit, Codex-OAuth-Twins haben Capability-Parity zum api_key-Pfad inklusive Reasoning-Tracking.

#### Phase 3.3.3.0 Spike — Reasoning-Trace-Discovery (Block 17, Commit `0cf822e`, ~45min)

Discovery-Spike für Codex-Reasoning-Format. Spike-Script `apps/runtime/src/scripts/test-oauth-phase3-3-3-spike.ts` mit Token-Pre-Check (JWT-Decode + Heuristik-Fallback), Parser-Compare (raw vs CodexSSEParser), Conditional Multi-Trigger (Math → Code-Refactor).

**Findings (§p in OAUTH-Strategy):**
- Reasoning-Items SIND im Stream: `{id, type: "reasoning", summary: []}` — `summary` **leer** (Codex Anti-Distillation)
- `reasoning_tokens=276 / total_tokens=894 (30.9%)` aus `usage.output_tokens_details`
- Parser-Heuristik korrekt (de-duplicate via `.added`-Filter): raw=2 vs parser=1 ist Design, kein Bug
- Hypothesen: A ✅ Math-Trigger produziert Reasoning, B ✅ `effort:"high"` vs Server-Default macht Unterschied, C halb-verifiziert (Items im Stream, aber Content leer)

**Phase-3.3.3.1-Empfehlung aus Spike:** Reduziert-Weiterbauen (~30-45 Min), kein UI-Bau (leere summary macht Render uninteressant).

#### Phase 3.3.3.1 Reasoning-Persistenz (Block 18, Commit nächster, ~45min)

Pipeline-Erweiterung Parser → Adapter → TwinService → Audit. Plus Resume-Context-Erweiterung für Pause-Pfad-Konsistenz.

**Substantielle Architektur-Findings aus Diagnose:**
- Parser-Erweiterung **Pflicht, nicht optional** — `response.completed`-Handler ignoriert `usage` komplett heute
- CodexResumeContext-Schema-Erweiterung **substantiell-nötig** (sonst Daten-Loss bei Pause+Approve)
- Re-Pause-Catch-Polish nötig für Konsistenz mit toolCalls-Pattern

**Bau:**
- `CodexSSEParser`: `private reasoningTokens?: number` State, `response.completed`-Handler extrahiert `usage.output_tokens_details.reasoning_tokens` mit defensiven 3-Ebenen-Type-Guards, `finalize()` returnt es additiv
- `CodexAdapterOutput`: `reasoningTraces: unknown[]` + `reasoningTokens?: number` ans Interface, Return-Block reicht beide aus parseResult durch
- `CodexResumeContext`: `previousReasoningTraces?: unknown[]` + `previousReasoningTokens?: number` additiv
- `runModelViaCodex`: `allReasoningTraces` + `totalReasoningTokens` Loop-State, Resume-Init-Branch ingestet `ctx.previousReasoning*`, Pro-Iteration-Aggregation analog `allToolCalls`/`totalLatencyMs`, Throw-Site snapshot ins `McpToolApprovalRequiredError.codexResumeContext` (conditional spread bei 0/leer), Loop-End-Metadata mit `...({reasoningTraces}/{reasoningTokens})` (matched existing toolCalls-Pattern)
- `approveMcpToolUseViaCodex` + `rejectMcpToolUseViaCodex` Re-Pause-Catches: `ctx.previousReasoning*` ans Original-Audit-providerMetadata (konsistent mit toolCalls-Source = Pre-Original-Pause-Daten; Resume-Iteration-Reasoning lebt im neuen Pending-Audit weiter)

Typecheck inkrementell nach jedem Schritt grün.

**Smoke-Bilanz (audit `audit_PPi49pkeXA2-`):**
- `POST /twins/@markus/chat` mit trivialer Math-Frage "Was ist 17 plus 25?"
- Response: "17 plus 25 ergibt **42**."
- Audit-Verify:
  - `provider=openai-codex`, `authMode=oauth`
  - `reasoningTraces=[{id:"rs_06868287...", type:"reasoning", summary:[]}]`
  - `reasoningTokens=12` — **Server-Default-medium produziert Reasoning bei gpt-5.5**
  - `hasReasoningTracesKey:true`, `hasReasoningTokensKey:true`
  - `codexIterations=1`, `latencyMs=2330`, `planType="pro"`
  - allMetaKeys: 10 Felder vollständig (authMode, cfRay, codexIterations, codexStatus, latencyMs, planType, provider, reasoningTokens, reasoningTraces, responseId)

**Substantielle Bonus-Erkenntnis (korrigiert Spike-Hypothese):**
Phase-3.3.3.0-Spike hatte aus Phase-3.3.0-Smoke (Tool-Call-Pfad, 0 Reasoning) geschlossen, dass Server-Default-medium "kein Reasoning für simple Requests" produziert. Phase-3.3.3.1-Smoke widerlegt: **trivialer Chat-Pfad mit Server-Default produziert 12 Reasoning-Tokens für "17+25"**. Korrektur: Tool-Call-Pfad ist Reasoning-frei (vermutlich Codex-Latenz-Optimierung), Chat-Pfad nicht — gpt-5.5 macht standardmäßig einen Reasoning-Pass. Implikation: jede oauth-Twin-Antwort hat ein paar Reasoning-Tokens, Token-Accounting muss das einrechnen.

Audit nach Verify gelöscht. Cleanup automatisch via `pnpm twin:oauth-phase3-spike cleanup` → @markus zurück auf `api_key`.

#### Plan Tag 28+ (revidiert nach Phase-3.3-Closure)

**#131 Phase 3.3 vollständig zu.** Codex-OAuth-Twins haben jetzt:
- Persona + Facts + Memory (Phase 3.2)
- Multi-Step-Tool-Loop + Auto-Execute (Phase 3.3.1.2)
- Approval-Pipeline mit Pause+Approve+Resume+Reject + Re-Pause (Phase 3.3.1.3.{0,1,2})
- Reasoning-Traces + Token-Counts im Audit (Phase 3.3.3.{0,1})

**Restliche #131-Sub-Phasen Tag 28+:**
- Phase 3.4 Vercel-Provider-Refactor — optional, lohnt nur bei AI-SDK-Update
- Phase 4 CLI-Login-Command — ~1 Tag
- Phase 5 Web-UI Status + Smoke + Doku + #131-Closure — ~1-1.5 Tage

§p in docs/131-OAUTH-STRATEGY.md ergänzt um Phase-3.3.3.1 Smoke-Bilanz + Server-Default-Behavior-Korrektur + Phase-3.3-Closure-Note.

### #131 Tag-27-Spätnacht — Phase 3.4 Vercel-Provider-Refactor (Blöcke 19-22, Commits `69bd303`/`d0b2aa9`/`3f21b3f`/`e5acb63` + 8× Phase-3.4.3.1)

**Phase 3.4 substantiell-zu**. Codex-OAuth-Pfad ist jetzt ein normaler Vercel AI SDK V3 Provider — Twin-Service hat KEIN auth-mode-Branch mehr in `runModel`, beide Modi (api_key + oauth) durchlaufen identische Pipeline mit identischer Approval-Mechanik.

#### Phase 3.4.0 Spike (Block 19, `69bd303`)

Discovery-Spike Doku-Check + Mock-Provider mit Simple-Text + Tool-Roundtrip durch echten Codex-Pro. Findings: Vercel-SDK reproduziert §l-Pattern transparent, Mapping ~280 LoC trivial, native V3-Primitives für Approval+Reasoning.

#### Phase 3.4.1 Provider-Basis (Block 20, `d0b2aa9`)

`apps/runtime/src/oauth/codex-vercel-provider.ts` als Production-Code (~290 LOC): Hybrid-Factory `createCodexProvider({refreshService, twinId})` mit callable+`.languageModel()`-Method, `CodexLanguageModel` implements `LanguageModelV3`, 3 Mapping-Helper (`mapV3PromptToCodex`, `mapV3ToolsToCodex`, `mapCodexOutputToV3Result`). Standalone-Smoke 6/6 Verify-Checks ✅.

#### Phase 3.4.2 Tool-Roundtrip-Smoke (Block 21, `3f21b3f`)

Test 2 dazu im Standalone-Smoke: `get_sum`-Mock-Tool + `stopWhen(stepCountIs(5))`. Verify-Checks step-walken: 2 Steps, 1 Tool-Call, Args `{a:17,b:25}`, finale "42"-Antwort. 2790ms in Spike-Pattern. **Substantielle Diagnose-Korrektur:** `buildMcpToolsFromSkills` ist schon `Record<string, Tool>` — optional-Subschritt `codex-vercel-tools.ts` entfällt komplett (~50 LOC Architektur-Win).

#### Phase 3.4.3.0 Spike — tool-approval-request Discovery (Block 21, `e5acb63`)

Doku-Check (`needsApproval` ist Built-in Tool-Field in `provider-utils@4.0.26`) + 3-Test-Spike mit Production-Provider-Reuse. **Findings (§r):**

- Test 1 ✅: `tool({needsApproval:true})` triggert `tool-approval-request`-Content-Part, `execute()` wird NICHT gerufen
- Test 2 ✅ (Format-Discovery!): Resume erfordert `assistantContent` im History-Replay-Messages (mit `tool-call` + `tool-approval-request` Parts) — pure `tool-call` reicht nicht. `AI_InvalidToolApprovalError` ohne den Pending-Request-Part
- Test 3 ✅: Reject via `approved:false` → SDK skipped execute(), Codex antwortet ohne Tool

**Performance-Win vorhergesagt:** Resume in 2s vs heute 5.4s (Phase 3.3.1.3.2-Codex-Pattern) — 2.7× schneller wegen kein eigener Loop + keine Re-Persistierung.

#### Phase 3.4.3.1 Big-Bang Approval-Refactor (Block 22, 8 Commits)

**Marathon-Push Marker-Pattern komplett raus.** Beide Auth-Modi auf native V3 unified. Sub-Phase-disziplinierte Sequenz mit inkrementellen Sub-Commits:

| Sub-Phase | Commit | Inhalt |
|-----------|--------|--------|
| A | `fe32a75` | `buildMcpToolsFromSkills.needsApproval`-Field, Marker-Return weg |
| B | `f9efb82` | `runModel` oauth-Branch nutzt `codexProvider` (Lazy-Singleton) statt runModelViaCodex |
| C | `a5d455b` | `ApprovalRequestedError` + `detectToolApprovalRequest`-Helper + `createPendingAuditFromApprovalRequest` |
| D+E | `1d8007f` | `approveMcpToolUseViaHistoryReplay` + `rejectMcpToolUseViaHistoryReplay` |
| D+E-Fix | `06322f4` | `toModelMessages` content-Array-Pass-through + `enableMcpTools: true` für History-Replay |
| F | `13829be` | ~1400 LOC Legacy-Removal: runModelViaCodex, approveMcpToolUseViaCodex, McpToolApprovalRequiredError, Marker-Pattern, codexResumeContext, test-regression-89 etc. |
| G-Smoke-Fix | `10f809b` | `mapAssistantContentForModelMessage` — V3-Provider-Output (`tool-call.input: string`) → V4-AssistantContent (`input: unknown` parsed) |

**Sub-Phase G Bug-Discovery (Lesson):** Spike-Pattern testete Happy-Path mit manuell konstruiertem `{a, b}`-Object. Production-Code liest `assistantContent` aus Provider-Result, dort `tool-call.input` als `string` (JSON-stringified). `AI_InvalidPromptError` beim Vercel-SDK-Schema-Match. Fix via Mapper-Helper.

**End-to-End-Smoke beide Auth-Modi nach Fix grün:**
- api_key `audit_vO17sY8JXhUj`: provider=anthropic/claude-opus-4-7, reply="42.", status=executed
- oauth `audit_0voltaVcvQaD`: provider=openai-codex/gpt-5.5, reply="17 plus 25 ergibt 42.", status=executed

**Code-Bilanz:** ~1400 LOC raus, ~140 LOC dazu → **Net ~1260 LOC weg**. Plus substantielle Architektur-Vereinfachung — kein auth-mode-Branching mehr in approveMcpToolUse/rejectPending/runModel, eine einzige Pipeline für beide Provider-Klassen.

§s in docs/131-OAUTH-STRATEGY.md dokumentiert: Sub-Phasen-Tabelle, Bug-Discovery, End-to-End-Smoke-Beweise, Code-Bilanz, Phase-3.4-Closure-Status, BACKLOG #141 für providerMetadata-Verlust (planType/cfRay null nach Refactor — nice-to-have).

**Lessons:**

1. **Sub-Smoke-Disziplin pro Sub-Phase ist Pflicht, nicht Empfehlung.** Sub-Phase G hat einen Bug aufgedeckt der in Sub-Phasen D+E entstanden ist — bei Sub-Smoke nach D+E vor F (Removal) hätte ich den Bug gefangen ohne ~1400 LOC Removal-Diff im Hintergrund. So musste ich erst denken "was passiert wenn ich revert".
2. **Cast über `unknown` maskiert Type-Mismatches.** `as ChatMessage`-Cast hat den V3↔V4-Schema-Unterschied verschluckt — typecheck war grün, Runtime brach. Pattern: Mapping-Layer mit echtem Typ-Filter statt `unknown`-Cast vertrauen.
3. **Spike-Pattern testet Happy-Path, Production andere Type-Boundary.** Spike hat assistantContent manuell konstruiert (Object), Production liest aus Provider-Output (string). Test-Coverage muss bewusst die Production-Datenflüsse durchspielen.

#### Phase-3.4-Closure-Status

- 3.4.0 Spike ✅, 3.4.1 ✅, 3.4.2 ✅, 3.4.3.0 ✅, 3.4.3.1 ✅
- 3.4.4 Reasoning-Mapping-Smoke offen (~10 Min, mit Phase 4/5 mit-ziehen — Provider liefert schon `reasoning`-Content-Parts)
- 3.4.5 TwinService-Integration ✅ (in 3.4.3.1 Sub-Phase B mit-gemacht)
- 3.4.6 Marker-Cleanup api_key-Pfad ✅ (in 3.4.3.1 Sub-Phase F mit-gemacht)

**#131 Restliche Sub-Phasen:** Phase 4 (CLI-Login, ~1 Tag) + Phase 5 (Web-UI + Smoke + Doku + Closure, ~1-1.5 Tage). Plus BACKLOG #140 (Re-Pause-Smoke, S nice) und #141 (providerMetadata pass-through, S nice).

### Tag-27-Closure-Bilanz

**Dreißig Blöcke an einem Tag — Husky-Hook bis Phase 5 + #131-BACKLOG-Closure komplett:**

| Block | Commit | Was |
|---|---|---|
| 1. Husky | `1a1f653` | #137 Husky Pre-Push-Build-Hook |
| 2. Phase 1 | `cfe223c` | #131 Migration 025 + PKCE-Client + Tokens-Repo |
| 3. Phase 2 | `638e200` | #131 Refresh-Service (Background-Poll + Lazy-Refresh + Mutex) |
| 4. Strategy-Iteration | `6667b81` | #131 Strategy-Doc §g/§h/§i/§j + Re-Estimate XL→XXL |
| 5. Pre-Flight | (kein Commit) | 3/3 HTTP 200 gegen Codex-Endpoint (Mac/VPS/Node v22) |
| 6. Phase 3.0 Spike | `7b8aae4` | #131 Codex-Adapter Walking-Skeleton + Smoke 1 grün |
| 7. Local-Dev-Fix | `6d33ade` | #138 TELEGRAM_USE_POLLING Auto-Detection-Fallback |
| 8. Phase 3.0 Smoke 2 | `ad48c5d` | #131 End-to-End via `/twins/@markus/chat` grün + STAND-Update |
| 9. Phase 3.1 (3.1.1 + 3.1.2) | `75d166d` + `707f941` | #131 CodexSSEParser standalone + SSE-Integration + Retry-Wrapper, 8/8 + 11/11 + End-to-End-Smoke grün |
| 10. Phase 3.2 | `a949b7e` | #131 composeOwnerSystemPrompt-Helper + Persona/Facts/Memory-Mapping + Smoke 3 mit klarer Markus-Persona-Response |
| 11. Phase 3.3.0 Spike | `9fa266a` | #131 Tool-Call-Event-Discovery — 7 distinct Event-Types verifiziert, §k dokumentiert (4 JSON-Beispiele + 7 Findings + Mapping-Hypothese) |
| 12. Phase 3.3.2 Spike | `e4d403a` | #131 Multi-Step-Tool-Roundtrip-Discovery — HYPOTHESE A wins first try, alle 5 Bonus-Discovery-Events vollständig zugeordnet, §l dokumentiert |
| 13. Phase 3.3.1.1 | `d576c05` | #131 mapSkillsToCodexTools-Helper + CodexSSEParser Tool-Call-Support, 15/15 Smoke grün |
| 14. Phase 3.3.1.2 | `797a464` | #131 Multi-Step-Loop + Auto-Execute Tool-Pipeline, Smoke 2 grün (get-sum a=89/b=134→223, codexIterations=2, codexCallId persistiert), 16/16 Smoke + BACKLOG #139 für Token-Refresh-Latenz |
| 15. Phase 3.3.1.3.0 + 3.3.1.3.1 | `67dc9f3` + `87c62fd` | #131 Approval-Pipeline reverse-engineered (§m) + Codex-Pause-Pfad gebaut: McpToolApprovalRequiredError-Erweiterung um codexResumeContext, CodexInputItemAny-Union, Pre-Call-Detect im Multi-Step-Loop (Reihenfolge-treu), Vercel-Catch-Reuse via Throw, 12-Felder-Resume-Context persistiert. Smoke grün mit `audit_KgWbPjYW_BF4` (mcp:everything-approval:get-sum → pending). §n dokumentiert. |
| 16. Phase 3.3.1.3.2 | `0f1b7ce` | #131 Codex-Resume-Pfad nach Approval: approveMcpToolUse-Switch via codexResumeContext, approveMcpToolUseViaCodex (Tool-Execute + Resume-Iteration via runModelViaCodex mit options.resumeContext), rejectMcpToolUseViaCodex (function_call_output mit `[isError=true]`-Marker, audit.repo.update mit erhaltenem rejected-Status), buildPendingMcpAuditFromError-Helper extrahiert für Re-Pause-Pfad-Reuse, ApproveResult um pending?: boolean + priorAuditId optionales Feld. Smoke grün mit `audit_gSqqVwGGBY6O` (reply="17 plus 25 ergibt 42.", codexIterations=2, 5.4s). §o dokumentiert. **#131 Phase 3.3 substantiell-zu.** |
| 17. Phase 3.3.3.0 Spike | `0cf822e` | #131 Codex-Reasoning-Trace-Discovery: Spike-Script mit Token-Pre-Check (JWT exp + Heuristik-Fallback), Parser-Compare via CodexSSEParser, Conditional Multi-Trigger (Math → Code-Refactor). Findings: Reasoning-Items IM Stream (`{id, type:"reasoning", summary:[]}`), `summary` LEER (Anti-Distillation), `reasoning_tokens=276/894 (30.9%)`, Hypothesen A+B verifiziert, C halb. Empfehlung: reduziert-weiterbauen (kein UI). §p dokumentiert. |
| 18. Phase 3.3.3.1 | (Reasoning-Persistenz) | #131 Reasoning-Trace-Persistenz End-to-End: Parser usage-Erweiterung mit defensive Type-Guards, CodexAdapterOutput um reasoningTraces+reasoningTokens, runModelViaCodex Multi-Iteration-Aggregation (Loop-State + Init-Branch + Throw-Site + Loop-End-Metadata), CodexResumeContext additiv erweitert um previousReasoning*, Re-Pause-Catches in approve+rejectMcpToolUseViaCodex schreiben Reasoning ans Original-Audit. Smoke grün mit `audit_PPi49pkeXA2-`: provider=openai-codex, 1 reasoningTrace + 12 reasoningTokens (Server-Default-medium produziert Reasoning bei gpt-5.5 auch bei trivialer Math-Frage — korrigiert Spike-Hypothese). §p erweitert. **#131 Phase 3.3 vollständig zu.** |
| 19. Phase 3.4.0 Spike | `69bd303` | #131 Vercel-Provider-Mapping-Verification: Doku-Check (LanguageModelV3 stable, native tool-approval-request + reasoning primitives) + Spike mit inline-Provider + Test 1 (Simple Text) + Test 2 (Tool-Roundtrip via Vercel-Multi-Step in 2.5s). §q dokumentiert: Vercel-SDK reproduziert §l transparent, Empfehlung "lohnt sich" für Phase 3.4-Vollbau. |
| 20. Phase 3.4.1 Provider-Basis | `d0b2aa9` | #131 codex-vercel-provider.ts (~290 LOC Production-Code): createCodexProvider-Hybrid-Factory + CodexLanguageModel implements LanguageModelV3 + 3 Mapping-Helper (mapV3PromptToCodex/mapV3ToolsToCodex/mapCodexOutputToV3Result). Standalone-Smoke 6/6 Verify-Checks ✅ in 1.6s. @ai-sdk/provider devDep→production-dep. |
| 21. Phase 3.4.2 + 3.4.3.0 | `3f21b3f` + `e5acb63` | #131 Tool-Roundtrip-Smoke (3.4.2): Test 2 dazu im Standalone-Smoke, 6/6 step-walk-Checks ✅ in 2.8s. Plus: substantieller Architektur-Win durch Diagnose (existing buildMcpToolsFromSkills ist 1:1 reuse-bar, codex-vercel-tools.ts-Helper entfällt). Plus 3.4.3.0 Spike (tool-approval-request Discovery): Doku-Check `needsApproval` Built-in Tool-Field + 3-Test-Smoke mit Production-Provider — Format-Discovery für History-Replay (assistantContent muss tool-call+tool-approval-request enthalten). §r dokumentiert. |
| 22. Phase 3.4.3.1 Big-Bang | `fe32a75` + `f9efb82` + `a5d455b` + `1d8007f` + `06322f4` + `13829be` + `10f809b` (7 Sub-Commits) | #131 Marker-Pattern komplett raus. Beide Auth-Modi auf native V3 unified (needsApproval + tool-approval-request + History-Replay). ~1400 LOC Removal (runModelViaCodex, approveMcpToolUseViaCodex, McpToolApprovalRequiredError, codexResumeContext, Marker-Pattern, test-regression-89, ...). ~140 LOC Add (ApprovalRequestedError, detectToolApprovalRequest, approve+rejectMcpToolUseViaHistoryReplay, createPendingAuditFromApprovalRequest, mapAssistantContentForModelMessage). Net ~1260 LOC weg. Sub-Phase-disziplinierte Sequenz: A→B→C→D+E→F(Removal)→G(Smoke+Fix). End-to-End grün beide Auth-Modi (`audit_vO17sY8JXhUj` api_key + `audit_0voltaVcvQaD` oauth). **#131 Phase 3.4 substantiell-zu.** §s dokumentiert. |
| 23. Phase 4.0 CLI-Login-Diagnose | `c8ebca8` + `8793cb8` | #131 Pure Diagnose vor Phase-4.1-Bau. Wrapper-Architektur (`codex login` als Subprocess + auth.json-Read + DB-Persist via Handle-Resolution) ersetzt die ursprünglich skizzierte Loopback-Listener-Variante — kein eigener PKCE, kein Port 1455. Substantielle Befunde: `codex` nicht im PATH (nur App-Bundle `/Applications/Codex.app/...`, codex-cli 0.131.0-alpha.9), kein Multi-Account in codex CLI (single account_id, Re-Login = Overwrite), Reuse-Inventar komplett (loadCodexToken + findByHandle + setAuthMode + tokensRepo.upsert), Phase-4.1-Code ~80 LOC plus Reuse. Setzungen-Block §t.10 User-bestätigt 20:30 mit Hybrid-Subprocess-Detection (Promise.race über child.on('close') + fs.watch(auth.json) mtime + 90s-Timeout). Aufwand-Estimate Phase 4.1+4.2+4.3: ~2-2.5h. §t dokumentiert (10 Sub-Sections, 281 Lines). |
| 24. Phase 4.1+4.1.1 CLI-Bau | `a5fa712` + `481945c` | #131 Production-CLI `pnpm twin:oauth-login <@handle>` gebaut (~420 LOC), Handle-Bug nachgepatcht. Sub-Phasen A-F: parseHandle (regex-validiert) + locateCodexBinary (CODEX_BIN-Env + macOS-Default + fs-Check) + waitForLoginCompletion (Hybrid-Promise mit fs.watch + Polling + 90s-Timeout, zentrales cleanups[]) + loadCodexTokenWithRetry (200ms-Settle bei partial-write) + DB-Persist via Reuse + package.json Script-Entries + Spike-Setup-Mode DEPRECATED. Bonus-Refactor: loadCodexToken in eigenes Module `apps/runtime/src/oauth/codex-auth-file.ts` extrahiert (DRY-Reuse durch CLI + Spike, typed CodexAuthFileError für Retry-Diskriminierung). Real-Aufwand ~50 Min (Estimate 75). Phase 4.1.1 Bug: parseHandle stripped @, DB-Storage ist @-prefixed → findByHandle null. Fix: @-normalized return + 6 Display-Sites direkt mit DB-Handle, JSDoc-Edge-Case-Tabelle. Briefing-Pseudo-Code hatte 3 API-Bugs (upsert-Args, expiresAt-Type, loadMasterKey-await) — verifizierte Real-API verwendet. |
| 25. Phase 4.2+4.3 E2E-Smoke + Doku | `5ecc522` | #131 End-to-End-Smoke des Production-CLI grün. CLI-Lauf: codex login Browser-PKCE durchgeklickt, **Hybrid-Detection feuerte via auth.json mtime-Update** (nicht child-close — Subprocess war noch in Cleanup-Phase, mtime kam zuerst), 200ms-Settle + Token-Read im ersten Versuch grün, DB-Persist + setAuthMode('oauth') durch. Chat-Roundtrip `audit_ukzHFjas_woB`: provider="openai-codex/gpt-5.5", capability=owner-direct, reply="Hallo.". CLI-persistierter Token funktional in Production-Stack. Cosmetic: providerMetadata.authMode + twinId null (BACKLOG #142, analog #141). Phase 4.3 Doku: §u in OAUTH-Strategy (5 Sub-Sections + Closure-Bilanz), STAND-Blocks 24+25, README §6 OAuth-Twin-Setup, BACKLOG #142. **#131 Phase 4 vollständig zu.** Real-Aufwand Phase 4 gesamt ~2.5h (Estimate ~2-2.5h). |
| 26. Phase 5.0 Web-UI-Diagnose | `8ae6736` | #131 Pure Diagnose vor Phase-5.1-5.4-Bau. UI-Setzung Tag-28-Abend: Status-Display + "OAuth aktivieren"-Button öffnet Modal mit CLI-Befehl + Copy-Button — Phase-4-CLI bleibt Login-Pfad, kein Web-OAuth in Phase A. §v in 8 Sub-Sections + Architektur-Skizze für 5.1-5.4 + 7 Setzungen. Substantielle Befunde: profileToResponse fehlt authMode komplett, OAuthTokensRepo.toPublic() existiert aber findRowByTwinAndProvider ist private (neuer findPublic-Reader ~10 LOC). Endpoint-Strategie Option A (settings-data-Erweiterung, DRY). UI-Stack: plain Tailwind + sonner + ModalWrapper (kein shadcn). Modal-Pattern + clipboard.writeText alles existing. Aufwand-Estimate 5.1+5.2+5.3+5.4: ~2-2.5h. |
| 27. Phase 5.1 Backend | `7616634` | #131 settings-data um auth-Block erweitert: GET /twins/:handle/settings-data → { ..., auth: { mode, oauth } }. OAuthTokensRepo.findPublic(twinId, provider) neu (wrappt findDecryptedByTwinAndProvider + toPublic, Klartext verlässt Methode nie). ServerDeps.oauthTokensRepo + index.ts createServer-Call angepasst. Shared-Schema-Erweiterung in @twin-lab/shared: AuthModeSchema + OAuthTokenPublicSchema + SettingsDataResponseSchema.auth. Typecheck grün. Real ~20 Min (Estimate 30). |
| 28. Phase 5.2 Web-UI | `0468c2b` | #131 Settings-Page Auth-Row + OAuthActivationModal.tsx. Auth-Row in Profile-Übersicht zeigt mode=api_key → "OAuth aktivieren"-Button, mode=oauth → Account-ID + Ablauf-Zeit + Re-Login-Button mit isExpired/isExpiringSoon-Badges. OAuthActivationModal: 4-Schritt-Anleitung + Code-Block mit `pnpm twin:oauth-login @<handle>` + Copy-Button (navigator.clipboard + sonner-Toast-Wrapper), "Status aktualisieren"-Button (just-on-click) **plus Auto-Refresh bei Modal-Close** (§v.8 #4 Setzung). ProfileBody-Signatur um auth + onActivateOAuth erweitert, oauthModalOpen-State in SettingsInner. Typecheck grün (web + shared + runtime). Real ~45 Min (Estimate 60). |
| 29. Phase 5.3 Doku-Closure | `4700695` | #131 Phase 5.3 ROADMAP + README + STAND + §w-Bilanz. ROADMAP neue Section `### 3.7 — OpenAI-Subscription-OAuth (#131) ✅ Phase A komplett` mit Sub-Phasen-Häkchen 3.7.1-3.7.6. README §OAuth-Twin erweitert um Web-UI-Hinweis (Settings-Page Auth-Row + Modal). §w in OAUTH-Strategy: 5 Sub-Sections für Phase 5.1+5.2+5.3 + Aufwand-Real (~90 Min für 5.1-5.3, schneller als Estimate 120 Min weil Reuse-Inventar aus §v.3 exakt zutraf). STAND-Header auf 29 Blöcke, Tag-27-Outcome um Phase 5 erweitert. |
| 30. Phase 5.4 BACKLOG-Closure | (dieser Commit) | #131 Phase 5.4 BACKLOG-Cleanup. #131-Item-Header auf "✅ Phase A DONE" mit Verweis auf docs/131-OAUTH-STRATEGY.md §a-§w, Historische Original-Spec als "Historische Doku"-Abschnitt erhalten (Bauzeit-Pfad-Doku). "#131 Status nach Tag 27"-Schluss-Block aktualisiert: 30 Blöcke, ~22h netto, drei neue Phase-B-Items #143 (Web-OAuth-Production-Flow ohne CLI, XL), #144 (VPS/Linux-Path via --device-auth, M), #145 (Multi-Account-Support, M). **#131 Phase A vollständig zu — Tag 27 = 30 Blöcke, Husky-Hook bis #131-Closure.** Phase-B-Polish bleibt BACKLOG-tracked (#139-#145). |

**Fünf Lessons:** Recherche vor Bau (#1), STAND-Doppelpflege (#2), End-to-End-Validation vor Bau (#3), Migration ohne Repo-Update ist Anti-Pattern (#4), Twin-Lab-eigene Setzungen schlagen Industry-Defaults (#5).

**Lesson Tag 27 #5: Twin-Lab-eigene Setzungen (CLAUDE.md) sind nicht zu überschreiben mit „industry best practice".** Phase 3.1.1 Bau-Briefing hatte Vitest reingebrieft („Standard für TypeScript-Unit-Tests"). Phase-1.1-Diagnose hat die CLAUDE.md-Setzung „keine Test-Suite" aufgefangen und Smoke-Script-Pattern empfohlen — matched Tag-12-Memory-Repos und Tag-22-MCP-Skills. Ergebnis: 8/8 + 11/11 Smoke grün ohne neue devDeps, ohne Husky-Hook-Eingriff, ohne CLAUDE.md-Bruch. Generelles Prinzip: **Project-spezifische Setzungen (CLAUDE.md, MEMORY, existing-Pattern-Dichte im Code) haben Vorrang vor generischen Industry-Defaults** — bevor neue Infrastruktur eingeführt wird, prüfen ob das Projekt eine eigene Setzung hat.

**Phase-3.2-Bonus-Lesson (Diagnose-Wert, kein neuer Lesson-Eintrag):** Briefing für Phase 3.2 hatte angenommen, `runModelViaCodex` müsse `conversationId` akzeptieren und History selbst laden. Phase-3.2.1-Diagnose hat gezeigt: History ist bereits in `messages` (Caller `runOwnerDirect` lädt sie OUTSIDE `runModel` via `loadConversationHistory`). Ohne Diagnose wäre Phase 3.2 mit doppeltem History-Loading + neuer Dep-Injection gebaut worden — Phase-1.1-Diagnose-Pattern bestätigt 13. Mal.

**Tag-27-Outcome #131 (final):** Phase 1 ✅ + Phase 2 ✅ + Strategy-Iteration ✅ + Phase 3.0 Spike ✅ + Phase 3.1 ✅ + Phase 3.2 ✅ + Phase 3.3.0/3.3.2 Spikes ✅ + Phase 3.3.1.{1,2} ✅ + Phase 3.3.1.3.{0,1,2} ✅ (Approval-Pipeline §m+§n+§o) + Phase 3.3.3.{0,1} ✅ (Reasoning §p) + Phase 3.4.{0,1,2} ✅ (Vercel-Provider §q) + Phase 3.4.3.{0,1} ✅ (Big-Bang Approval-Refactor §r+§s, 7 Sub-Commits, ~1260 LOC Net-Removal) + Phase 4.0 ✅ CLI-Login-Diagnose §t + Phase 4.1/4.1.1/4.2/4.3 ✅ CLI Production-Tool §u (~420 LOC Add, E2E-Smoke `audit_ukzHFjas_woB` grün, Hybrid-Detection via mtime-Update real-world bestätigt) + **Phase 5.0 ✅ Web-UI-Diagnose §v + Phase 5.1/5.2/5.3/5.4 ✅ Web-UI + Doku + BACKLOG-Closure §w (settings-data + OAuthTokensRepo.findPublic + AuthRow + OAuthActivationModal, plain Tailwind + sonner + ModalWrapper-Reuse, ~250 LOC Add, Auto-Refresh bei Modal-Close, ROADMAP §3.7 ✅, Strategy-Doc §a-§w 27 Sub-Sections, Phase-B-Items #143/#144/#145 skizziert).** **#131 Phase A vollständig zu — Bauzeit ~22h netto (~3 Tage) gegen XXL-Estimate 8-12 Tage.** Codex-OAuth-Twins sind funktional gleichwertig zu api_key-Twins, beide Auth-Modi laufen durch identische Vercel-`generateText`-Pipeline mit nativer V3-Approval-Mechanik (`needsApproval` + `tool-approval-request` + History-Replay). Marker-Pattern aus Phase 3.2.F komplett raus. **Substantielle Architektur-Vereinfachung:** kein auth-mode-Branching mehr in `runModel`/`approveMcpToolUse`/`rejectPending`, kein eigener Codex-Loop, kein codex-spezifischer Resume-Snapshot. **Phase-4-Pivot durch §t-Diagnose:** alte Loopback-Listener-Variante (~1400 LOC Estimate) ersetzt durch Wrapper-Pattern (~420 LOC inkl. Bonus-Helper) — Real-Aufwand Phase 4 gesamt ~2.5h statt 1 Tag (~4x schneller). **Lessons Tag 27:** (1) Sub-Smoke-Disziplin pro Sub-Phase ist Pflicht — Sub-Phase G aufgedeckter V3↔V4-Schema-Bug wäre ohne ~1400 LOC Removal-Diff im Hintergrund leichter zu fixen gewesen; (2) Cast über `unknown` maskiert Type-Mismatches; (3) Spike-Pattern testet Happy-Path, Production hat andere Type-Boundary; (4) Diagnose-Phase vor Bau-Phase fängt Architektur-Pivots — Phase 4.0 hat ein 1400-LOC-Plan zu einem 80-LOC-Plan zusammengeschrumpft, weil `codex login` als Subprocess-Wrapper trivial machbar ist und alle Helpers schon existieren; (5) **Args-Parser-Test-Cases im Bau-Briefing als Pflicht** — Phase 4.1.1 Handle-Bug (`parseHandle` strippte @, DB-Storage ist @-prefixed) wäre durch Edge-Case-Tabelle im Briefing vermeidbar gewesen; Diagnose-Tool `sqlite3 SELECT hex(column)` lokalisiert Encoding-Mismatches in <30s. **Restliche Sub-Phasen Tag 28+:** Phase 5 Web-UI + Smoke + #131-Closure (~1-1.5 Tage). Plus BACKLOG #140 (Re-Pause-Smoke nice), #141+#142 (providerMetadata pass-through nice, sollten gemeinsam gefixt werden).

**Tag-27-Outcome #138:** Local-Dev-Boot-Friction strukturell behoben, in der Praxis verifiziert beim Smoke-2-Setup.

## Tag 26 — Sonntag, 25. Mai 2026

### Status

**Phase 3 von #130 final zu — Sammel-Commit `7c74a33`.** 17 Files, 2725 Insertions, 24 Deletions. #130 ist jetzt 60% durch (3/5 Phasen).

**Strategy-Setzungen Tag 26:**
- Persistent-Pairing-Prinzip für alle Channel-Adapter festgeschrieben (drei Aktionen für Phase 4)
- OpenAI-OAuth-Vorziehung von Phase B nach Phase A Block 5 (#131)
- Anthropic-OAuth-Item (#132) bleibt Phase B mit Konzept-Update-Pflicht (Stance hat sich geändert: kein 3rd-Party-OAuth mehr, nur Token-Kauf)
- STAND.md ab heute doppelt: Project Knowledge + `docs/STAND.md` im Repo

**Launch-Window-Anpassung:** KW 29-30 → wahrscheinlich KW 31-32 (4-5 Bautage extra für #131 Vorziehung).

### Tag-26-Bilanz — 1 Commit

| Hash | Files | Z | Was |
|---|---|---|---|
| `7c74a33` | 17 | +2725 / -24 | #130 Phase 3: Message-Routing + LLM + API + setWebhook + Channel-Badge + Markdown |

### Was in Phase 3 reinging

**Backend (3 neue Files, 6 modified):**
- `apps/runtime/src/telegram/message-router.ts` (250 Z) — TelegramMessageRouter mit Owner-Bypass-Reuse-Pattern aus Phase-1.1-Diagnose
- `apps/runtime/src/telegram/api-routes.ts` (291 Z) — 5 API-Routes (`:handle`-Pattern) für Config-CRUD + Pairing-Code-Generation
- `apps/runtime/src/telegram/markdown-to-telegram-html.ts` (138 Z) — Pure-Function `markdownToTelegramHtml` via marked + Sanitize-Layer auf Telegram-HTML-Subset
- `twin-service.ts` Channel-Pass-Through (`ChatRequestContext.channel?: 'telegram' | 'discord' | 'whatsapp'`)
- `bot-registry.ts`, `telegraf-setup.ts`, `server.ts`, `index.ts` — Wiring + setWebhook-Lifecycle
- `test-telegram-phase3.ts` (~580 Z, 10/10 grün)

**Frontend (1 neue Component, 1 modified):**
- `MessageChannelBadge.tsx` (55 Z) — Inline-SVG Lucide-Send-Icon oben rechts im Bubble-Header mit SVG-`<title>`-Tooltip
- `chat/[handle]/page.tsx` — Bubble dual-branch (User-Pfad whitespace-pre-wrap Plain, Assistant-Pfad react-markdown + remark-gfm), Channel-Prop-Durchreichung, MARKDOWN_COMPONENTS-Map für Tailwind-Twin-Lab-Aesthetik, normalizeChannel-Helper

**Dependencies:**
- Backend: marked ^18.0.4
- Frontend: react-markdown ^10.1.0 + remark-gfm ^4.0.1

**Docs:**
- `130-TELEGRAM-STRATEGY.md` — Phase-3-Scope-Korrektur (Phase 2.5 entfiel, in Phase 3 konsolidiert; Scope-Erweiterungen Channel-Badge + Markdown dokumentiert)
- `BACKLOG.md` — #133 Cross-Channel-Mental-Model-Doku angelegt (XS, should, Block 5)

### Manual-Smoke

Drei separate Smoke-Runden während Bau:

| Smoke | Coverage |
|---|---|
| Phase-3-Core (5/5 Pflicht-Tests grün) | Config-Create + Pairing + LLM-Antwort + Cross-Channel-Memory + Cleanup |
| Channel-Badge v1 (3/3 Pflicht, mit UX-Befund) | Daten-Pfad ok, aber Heavy-User-Visual-Noise + Tooltip-Discoverability schwach → v1 verworfen |
| Markdown + Channel-Badge v2 (3/3 Pflicht + 3/3 Polish grün) | Markdown sauber in beiden Surfaces, Icon-only Channel-Badge mit SVG-`<title>`-Tooltip |

Plus Phase-2-Regression-Smoke 8/8 grün (kein Bruch durch Phase-3-Erweiterungen).

### Scope-Erweiterungen Tag 26

Drei während Bau eingefügt (nicht ursprünglich Phase-3-Scope):

**1. Channel-Badge** — von Manual-Smoke Test 5 entdeckt: Web-UI zeigt alle Cross-Channel-Messages, aber ohne Channel-Marker. Heavy-User-UX-Problem.
- v1 gebaut: dezente „über Telegram"-Subline unter Bubble mit native `title=`-Tooltip
- v1 verworfen nach Manual-Smoke: Heavy-User-Visual-Noise (90%-Telegram-User sieht überall „über Telegram"-Text), Tooltip-Discoverability schwach, räumliche Entkopplung vom Read-Flow
- v2 gebaut: Inline-SVG Lucide-Send-Icon oben rechts im Bubble-Header mit SVG-`<title>` als first-child (100-200ms Hover-Latenz statt 500ms)

**2. Markdown-Rendering beide Surfaces** — von Manual-Smoke entdeckt: LLM-Output ist Markdown, aber Web-UI zeigt Rohtext mit `**`-Sternchen + Telegram zeigt `<b>`-Tags als sichtbaren Text.
- Web-UI: react-markdown + remark-gfm, Bubble-Component dual-branch (User Plain, Assistant Markdown)
- Telegram: marked → Sanitize-Layer auf Telegram-HTML-Subset, `parse_mode: 'HTML'` mit Plain-Fallback bei Parse-Error
- Persistenz bleibt Markdown-Original (channel-agnostisch)

**3. Backlog #133 Cross-Channel-Mental-Model-Doku** — Asymmetrie zwischen Web-UI (zeigt alle Channels) vs Telegram (zeigt nur Telegram) ist Onboarding-Friction. Touch-Points: #110 Onboarding-Wizard, #112 Landing, #113 Hero-GIF.

### Lessons Tag 26

**1. Channel-Badge v1 → v2 Discoverability-Lesson:** Native-Tooltip funktioniert technisch — Discoverability ist die eigentliche UX-Frage. v1-`title=`-Attribut war technisch korrekt; das Problem war räumliche Entkopplung vom Read-Flow + diffuser Italic-Text statt scharfer Icon-Affordance. Lesson für künftige UX-Setzungen: bei „dezente Marker"-Design mit Heavy-User-Persona-Frage durchgehen („was wenn User das zu 90% sieht?").

**2. Smoke-Driven-Development findet latente Bugs:** Drei während-Smoke entdeckte Edge-Case-Bugs während Markdown-Konversion:
- `<p[^>]*>` matched `<pre>` als Prefix → Code-Blocks verloren Wrapper. Fix: `<p(?=\s|>)[^>]*>` Word-Boundary-Lookahead
- `() => ${counter++}. $1\n` — `$1` in Callback-Returns nicht substituiert. Fix: Callback-Argument `(_match, item) => ...${item}...`
- `at(-1)` vs `at(0)` auf DESC-Order-Result (Sortier-Reihenfolge-Annahme falsch)

Diese drei wären in Production unschönes Verhalten geworden (Code-Blocks ohne Format, Listen mit `$1` als Rohtext, Smoke-Test gibt False-Positive).

**3. SVG-`<title>` first-child schlägt HTML-`title=`-Attribut:** 100-200ms Hover-Latenz vs ~500ms-2000ms (Browser-Default). Plus ist die korrekte Methode für `<svg>`-Elemente.

**4. Type-Future-Proofing zur niedrigsten Kosten:** `channel?: 'telegram' | 'discord' | 'whatsapp'`-Union statt nur `'telegram'` erspart Refactor bei Phase 4.1 (WhatsApp) / Discord. Konsequenz: drei Stellen brauchen Erweiterung statt invasive Refactor.

**5. Phase-1.1-Diagnose-Wert 10. Mal bestätigt:** Drei kritische Realitäts-Korrekturen gegen Briefing-Annahmen:
- AuditEntry.input als `z.record(z.string(), z.unknown())` ist schon flexibler JSON-Bag → kein Schema-Migration nötig für channel-Marker
- `:handle`-Pattern-Drift gegen vermutetes `:twin_id`
- `ctx.persistentChatAction`-Telegraf-Builtin statt manuelles setInterval-mit-Cleanup

**6. Manual-Smoke deckt UX-Realität auf, die Strategy-Session nicht antizipiert:** Channel-Badge v1 wurde durch Heavy-User-Use-Case während Manual-Smoke verworfen (nicht durch Strategy-Frage). Lesson: Strategy-Setzungen mit „was wenn User 90% via Channel X?"-Frage durchgehen.

**7. STAND.md ab Tag 26 doppelt: Project Knowledge + `docs/STAND.md` im Repo:** Stand-Recovery bei Chat-Window-Wechsel + git-History für Stand-Verläufe. Doppel-Edit-Disziplin: bei Tag-Closure beide updaten, bei Konflikt gewinnt Repo (authoritative).

**8. Telegram-Long-Polling-Backlog-Replay.** Bei Manual-Smoke Phase 4.1 wurde der Bot zunächst ohne `TELEGRAM_USE_POLLING=true` gestartet — Pairing-Code-`/start`-Messages kamen nicht an. Nach Polling-Aktivierung wurden die Updates retroaktiv aus dem Telegram-Server-Backlog nachgeliefert. Update-Acknowledgement passiert beim ersten Polling-Roundtrip nach Aktivierung, nicht zum Zeitpunkt des `/start`-Sends. Praktische Konsequenz: Smoke-Manual ohne explizite Polling-Mode-Check produzierte 5 Minuten Confusion, dann „magic working" Effekt.

**9. Keyboard-Nav ohne Ref-Map via DOM-API.** Tabs-Component (Phase 4.2) nutzt `closest('[role="tablist"]').querySelectorAll('[role="tab"]:not([disabled])')` statt expliziter Ref-Map für Tab-Reihenfolge. Vorteil: keine useRef-Map, keine Tab-Registry, kein Cleanup auf Unmount, plus Sub-Tabs verschachtelt funktionieren automatisch ohne Bleed (jeder TabList scoped sich selbst via closest()). Pattern-Win für Compound-Components mit Keyboard-Navigation.

**10. Phase-1.1-Diagnose-Wert 11. Mal bestätigt.** Vier Phase-1.1-Sessions in Phase 4 (4.1, 4.2-Initial, 4.2-Refactor, 4.3, 4.4), jede mit substantiellen Realitäts-Korrekturen gegen Briefing-Annahmen: Backend-§h-Items 3/4 schon konform, text-text statt text-foreground, full-border statt border-l-2, Components schon extrahiert, paired_at-Schema fehlt, Modal-Pattern-Verifikation. Ohne Diagnose-Disziplin wären die Phase-4-Sub-Phasen alle 50-100% länger gewesen. Phase 4 Net-Aufwand ~3.5h statt geschätzter 7-9h.

### Persistent-Pairing-Setzung für Phase 4

Owner-Pairing zwischen Twin und Channel-Adapter (Telegram, künftig WhatsApp/Discord) ist **dauerhaft persistent bis explicit Disconnect**. Drei Implementations-Konsequenzen für Phase 4 Settings-UI:

**1. PUT /config preserve-paired:** API-Schema lehnt `paired_owner_*`-Felder im Update explicit ab. Nur Token + Username + ähnliche nicht-Pairing-Felder sind mutable.

**2. Token-Rotation triggert setWebhook neu:** Owner kann Bot-Token rotieren (z.B. nach BotFather-Compromise) ohne Re-Pairing. Helper `rotateWebhook()` updated Token + Secret in Telegram, behält paired_user_id unverändert.

**3. Explicit Unpair-Button in Settings-UI + neuer Endpoint:** dedizierter `POST /twins/:handle/telegram/unpair`-Endpoint. Setzt paired_user_id auf NULL, behält Bot-Config + Pairing-Code-Generation-Capability. UI-Button mit Bestätigungs-Dialog separat von „Delete Config".

**Architektur-Prinzip §h** in `130-TELEGRAM-STRATEGY.md` festgeschrieben — Begründung: Pairing ist Owner-Trust-Statement, nicht Session-State. Container-Restart / Token-Rotation / Re-Konfiguration sollte den Trust nicht versehentlich invalidieren.

### OpenAI-OAuth-Vorziehung

**#131 verschoben von Phase B nach Phase A Block 5.** Bau-Reihenfolge: `#130 → #131 → #113 → #112 → #114 → #115`.

**Begründung Tag 26:**
- Owner-Persona-Validierung: Power-User mit OpenAI + Claude beide via Subscription
- Wettbewerbs-Positionierung: OpenClaw + Hermes haben OAuth, „BYOK-only" wäre HN-Feedback-Schwäche
- OpenAI dokumentiert + supported 3rd-Party-OAuth offiziell (developers.openai.com/codex/auth), nicht Reverse-Engineering
- Launch-Toleranz akzeptiert (KW 29-30 → KW 31-32, 1-2 Wochen Verschiebung)

**#132 Anthropic-OAuth bleibt Phase B mit Konzept-Update-Pflicht:** Anthropic-Stance hat sich Tag 25-26 geklärt: kein 3rd-Party-OAuth mehr, nur Token-Kauf. Item bleibt im Backlog, aber Konzept braucht Update vor Phase-B-Bau — Token-Buying-Surface statt CLI-Reuse-Pattern.

**Twin-Lab-Default bleibt BYOK** (API-Key). OAuth ist Opt-in mit ToS-Disclaimer („OpenAI hat das nicht für 3rd-Party-Apps dokumentiert, kann gekappt werden").

### Stand pro Strategy-Doc

Diese vier Doku-Updates folgen Tag 26 nach STAND-Closure als separate Doku-Texte (pending Bau):

- `docs/130-TELEGRAM-STRATEGY.md` — §h Persistent-Pairing-Prinzip als Architektur-Section add
- `docs/BACKLOG.md` — #131 Phase-A-Markierung + Status-Notiz, #132 Stance-Update-Notiz
- `docs/BLOCK-5-STRATEGY.md` — Bau-Reihenfolge erweitert, Launch-Window adjusted
- `docs/PRE-LAUNCH-A-STRATEGY.md` — Pflicht-Aufwand-Tabellen + Anti-Goals updated

### Plan ab Tag 26 Nachmittag

- **Doku-Updates** für die vier obigen Files (45-60 Min, Tag-26-Nachmittag)
- **Phase 4 — Telegram Settings-UI** Strategy + Phase-1.1 + Bau-Start (1.5-2h, Rest Tag 27 Vormittag)

### Plan Tag 27-32

- Phase 4 Settings-UI Frontend + Smoke + Manual-Smoke (Tag 27 Vormittag)
- Phase 5 #130 Production-Deploy Phase 1+2+3 zusammen + Phase 4 wenn bereit (Tag 27 Nachmittag oder Tag 28)
- #131 OpenAI-OAuth Strategy + Phase 1.1 + Bau (Tag 28-32, 4-5 Bautage)
- Block 5 Marketing-Items #112-115 + Launch

### Pending vor Launch

- #59 `/messages/:id/sender`-Endpoint securen (offen seit vor #130, Auth + Owner-Scope-Check)
- Wettbewerbs-Verifikations-Zwischen-Tag (Stars + Stances vor Block-5-Marketing-Items)
- Closed-Beta-Externe-User-Onboarding-Konzept (Strategie 2.5.5 Notifications hängt davon ab)

### Wichtige Pfade (für Stand-Recovery bei Chat-Wechsel)

- Repo lokal: `/Users/mjb/Visual Studio/twin-lab`
- Repo remote: `github.com/markusbaier/twin-lab` (privat)
- Production-VPS: `srv1046432`, Stand `bb50b14` (Tag-25-Closure, vor Phase 3)
- BotFather-Bot: `@twin_lab_markus_test_bot`
- Strategy-Docs: `docs/{PRE-LAUNCH-A-STRATEGY,BLOCK-5-STRATEGY,130-TELEGRAM-STRATEGY,BACKLOG,ROADMAP,ARCHITECTURE,STAND}.md`

### Tag-26-Closure-Erkenntnis

Phase 3 ist die substantiellste Phase von #130 mit 2725 Insertions in einem Commit — größer als Phase 1 (858) + Phase 2 (1403) zusammen. Drei Scope-Erweiterungen (Channel-Badge + Markdown + Persistent-Pairing-Setzung als Architektur-Add) verdoppelten den ursprünglich geplanten Phase-3-Scope. Manual-Smoke deckte zwei substantielle UX-Korrekturen auf (Channel-Badge v1→v2, Markdown-Rendering fehlte komplett). Ohne diese Manual-Smoke-Catches wäre Production-Deploy in Phase 5 unprofessionell geworden.

OpenAI-OAuth-Vorziehung ist die wichtigste Roadmap-Entscheidung Tag 26 — verschiebt Launch-Window um 1-2 Wochen, aber positioniert Twin-Lab wettbewerbs-stark und matched Owner-Persona-Realität.

### Nachmittag/Abend — Phase 4 komplett zu (~14:00-19:30)

Phase 4 von #130 wurde an einem Nachmittag/Abend durchgezogen — vier Sub-Phasen, sechs Commits. Initial-Schätzung war 7-9 Stunden ab 14:30, Realität war ~3.5h dank Phase-1.1-Diagnose-Disziplin (Components schon extrahiert, Backend-Erweiterungen 3 von 4 schon konform).

**Phase 4 Sub-Phasen:**

| Phase | Was | Stand |
|---|---|---|
| 4.1 Backend §h | POST /unpair + .strict() Schema + rotateWebhook-Alias | ✅ Commit `1c91f04`, Smoke 12/12 + Manual 4/4 grün |
| 4.2 Tabs-Component | Compound-API Shared Component für Web-UI | ✅ Commit `d4c231f`, Test-Page `37d0a27` |
| Sidebar-Pivot | Tabs von Horizontal-Top zu Vertical-Sidebar | ✅ Commit `ef8be75` |
| 4.3 Settings-Restructuring | 8 Bereiche in 7 Tabs + Channels-Sub-Sidebar | ✅ Commit `402a1ae` |
| 4.4 Telegram-Settings-UI | TelegramChannelTab 5 Modi (557 Z) | ✅ Commit `97b2ce7`, Manual-Smoke 5/5 Pflicht |
| Backlog | #134/#135/#136 angelegt | ✅ Commit `13d34ea` |

**Tag-26-Bilanz aktualisiert — 12 Commits:**

Vormittag-Welle (Tag-26-Strategie + Doku-Welle):
- `7c74a33` #130 Phase 3 Sammel-Commit (17 Files, 2725 Insertions)
- `d3c921f` STAND.md Tag-26-Vormittag-Closure
- `4bd8de8` BACKLOG: #131 vorgezogen + #132 + #133
- `4e538a0` BLOCK-5-STRATEGY: Bau-Reihenfolge + Launch-Window
- `a25f41d` PRE-LAUNCH-A-STRATEGY: Block-5-Scope + Anti-Goals
- `9d282a5` 130-TELEGRAM-STRATEGY: §h Persistent-Pairing-Prinzip

Nachmittag/Abend-Welle (Phase 4):
- `1c91f04` Phase 4.1 Backend §h
- `d4c231f` Phase 4.2 Tabs-Component
- `37d0a27` Tabs Manual-Render-Test-Page
- `ef8be75` Tabs Sidebar-Refactor
- `402a1ae` Phase 4.3 Settings-Restructuring
- `97b2ce7` Phase 4.4 Telegram-Settings-UI
- `13d34ea` Backlog #134/#135/#136

**Sidebar-Pivot Phase 4.2:**

Phase 4.2 initial mit Horizontal-Top-Tabs gebaut, Test-Page-Verifikation grün. Aber während Closure-Phase: Vorschlag, Tabs als Sidebar-Layout matched Twin-Lab Chat-UI besser. Begründung:
- 7 Top-Level-Tabs + verschachtelte Sub-Tabs (Channels) — Horizontal wird unübersichtlich
- Mental-Model-Konsistenz mit existing Chat-Page-Layout (linke Sidebar)
- Wettbewerbs-Aesthetik-Match (Self-Hosted-Apps nutzen Sidebar-Layout)

Refactor: 33 Insertions / 17 Deletions, Component-API stabil. Test-Page rendert automatisch mit neuem Layout.

Phase-1.1-Diagnose-Catch beim Refactor: Briefing-Setzung war `border-l-2 border-accent` (Material-Design-Style). Chat-Sidebar nutzt aber full `border-accent` + `bg-bg`. Pattern-Konsistenz zu existing Twin-Lab-Aesthetik schlägt naive shadcn-Convention.

**Konfig-Tab Atomic-Submit-Coupling (Phase 4.3):**

Settings-Page hatte 8 Bereiche, davon Persona/LLM/Presets als gekoppeltes Trio mit shared dirty-State + atomic Submit (PUT /full-config). Strategy-Entscheidung: Konfig-Tab aggregiert die drei mit existing Coupling-Pattern, kein Refactor jetzt. Per-Tab-Submit-Refactor als #134 Backlog-Item für später.

**Phase-1.1-Diagnose-Catch Phase 4.3:** Persona/LLM/Presets sind bereits in eigene Components extrahiert (`<PersonaEditSection>`, `<LlmEditSection>`, `<PresetsEditSection>`) — Migration trivial. Vorab-Schätzung war M (Refactor), Realität war S (Migration ohne Code-Refactor).

**Phase 4.4 — TelegramChannelTab 5 Modi:**

`apps/web/components/TelegramChannelTab.tsx` (557 Z, neu): Empty / Configured-Unpaired / Configured-Paired / Loading / Error State-Switch. Auto-Chain Empty → Unpaired (POST /config → POST /pairing-code → fetch). Token-Inline-Edit statt drittes Modal. Zwei Confirmation-Modals (Unpair + Delete).

**Phase-1.1-Diagnose-Catch Phase 4.4:** paired_at + last_message_at-Schema-Felder fehlen im Backend. paired_at braucht Migration → Out-of-Scope. Status-Felder weggelassen, #136 Backlog-Item für Polish-Welle. Pragmatic-Win.

**Backlog-Items aus Phase 4:**

| # | Titel | Größe | Priorität | Spur |
|---|---|---|---|---|
| #134 | Settings Per-Tab-Submit-Refactor | S-M | could | Phase B / Polish |
| #135 | Account-Settings UI (Email/Password) | S | should | Phase A Block 4 / Phase B |
| #136 | Telegram-Config Status-Felder (paired_at + last_message_at) | S | could | Polish nach Phase 5 |

**Status #130 (final Tag 26):**

- Phase 1 ✅ Backend-Foundation
- Phase 2 ✅ Telegraf-Service + Pairing
- Phase 3 ✅ Message-Routing + LLM + API + Channel-Badge + Markdown
- Phase 4 ✅ Settings-UI komplett (4 Sub-Phasen + Sidebar-Pivot)
- Phase 5 ✅ Production-Deploy + Documentation

#130 ist 100% durch — 5 von 5 Phasen ✅. Phase 5 effektiv ~2.5h statt geplanter 1.5h wegen vier Detours, alle als Lessons dokumentiert.

### Phase 5 — Build-Bug-Detour (~20:15)

Production-Build-Fehler beim Web-Image: Test-Page nutzt useSearchParams() ohne Suspense-Wrapper. Production-Static-Generation strenger als local pnpm dev. Test-Page entfernt (Tag-26-Phase-4.2-Zweck erfüllt durch Settings-Page Phase 4.3). Plus #137 Backlog für Pre-Push-Build-Hook.

**Lesson Tag 26 #11: Production-Build-Test fehlt im Workflow** — lokal pnpm dev übersieht Static-Generation-Issues. Hätte den Bug in Phase 4.2 sofort gezeigt.

### Phase 5 — Compose-Yaml-ENV-Forwarding-Detour (~20:45)

Production-Deploy-Stop: Container startete nicht trotz korrekt gesetzter .env-Vars. Root cause: docker-compose.yml listet Runtime-ENVs explizit, TELEGRAM_USE_POLLING und RUNTIME_PUBLIC_URL fehlten im environment:-Block. .env wird nur für `${VAR}`-Substitution genutzt, nicht für volle Forwarding.

Fix: Compose-Yaml ergänzt + .env.example ergänzt + DEPLOYMENT-§10.1 Hinweis. Single-Commit-Fix, Production-Deploy fortsetzbar.

**Lesson Tag 26 #12: docker-compose explicit-env-listing-Pattern** — Self-Hoster-Doku muss klar machen wo Vars gelistet sein müssen (`.env` UND `compose.yml`). Sonst nicht-debugbar für externe User.

Phase-1.1-Diagnose 12. Mal bestätigt: Compose-Yaml früher lesen hätte den Stop vermieden.

### Phase 5 — Production-Deploy Closure (~21:30)

#130 Phase 5 abgeschlossen. Production-Bot `@twin_lab_markus_bot` (separat vom lokalen Test-Bot `@twin_lab_markus_test_bot`) auf srv1046432 konfiguriert und gepaart.

**Manual-Smoke 3/3 Pflicht-Pfade grün:**

- Send-Receive-Roundtrip mit Twin-Persona (Latenz ~5-15 Sek)
- Cross-Channel-Memory-Recall (Telegram-Fact über Avocado-Toast in Web-UI korrekt rekalliert mit allen 3 Komponenten — Channel-agnostische Memory-Layer-Architektur verifiziert)
- Webhook-Roundtrip-Logs (POST /webhooks/telegram/@markus, 200, responseTime 3219ms inkl. LLM-Roundtrip, kein 401)

**Phase-5-Detours (Lessons Tag 26 #11-#13):**

- Service-Name-Mismatch (compose-Service `runtime`/`web` vs Container `twin-lab-runtime`/`twin-lab-web`)
- Image-Build-Workflow nicht via `docker compose build`, sondern via manuellem `docker build -t ... -f apps/*/Dockerfile .` aus Repo-Root
- Build-Bug #137 (Test-Page useSearchParams ohne Suspense-Wrapper, Production-Static-Generation strenger als pnpm dev)
- ENV-Forwarding-Lücke (Compose-Yaml `environment:`-Block listet Vars explizit, `.env` ist nur Substitutions-Quelle)

**DEPLOYMENT.md §10.1** von Phase-4-Placeholder zu konkretem Channels-Tab-Workflow aktualisiert.

**#130 100% durch — 5 von 5 Phasen ✅.**

Net-Aufwand Tag 26: ~5.5h (geschätzt 4-5h). Plus erweiterte Lessons-Bibliothek (3 neue Lessons aus Phase-5-Detours).

### Plan Tag 27

**Vormittag (frisch nach Schlafen):**
1. Polish-Pfade Phase 4.4 (~30 Min): Copy-Button-Test, Token-Inline-Edit-§h-Test, Unpair-Roundtrip, Refresh-Code, Telegram-Deeplink-Click
2. Phase 5 Strategy-Session (~30-45 Min): #130 Production-Deploy (Webhook-Mode auf srv1046432, DEPLOYMENT.md-Ergänzung)
3. Phase 5 Bau (~2-3h): Production-Deploy mit Webhook-URL-Setup, Manual-Smoke gegen Production

**Falls Zeit:**
- #131 OpenAI-OAuth-Strategy-Session (vorgezogen aus Phase B, siehe BLOCK-5-STRATEGY)
- DEPLOYMENT.md Tag-26-Lessons-Welle (Telegram-Polling-Backlog-Replay als Production-Smoke-Hinweis)
- Phase 5 STAND-Update Tag 27

**Token-Rotation-Reminder:** Bot-Token + Session-Cookie aus Tag-26-Manual-Smoke sind im Chat-Verlauf sichtbar geworden. Vor Production-Deploy: BotFather `/revoke` + neuer Token, Twin-Lab-Session-Rotation via Re-Login.

---

## Tag 25 (24. Mai 2026, Sonntag) — Pre-Launch-Phase A Block 4 (#111 Closure + Block-4-Bilanz)

**Stand Tag 25 Abend:** #111 Repo-Hygiene abgeschlossen über zwei Sub-Schritte (Schritt 6 LICENSE + Boilerplate, Schritt 7 README Demo-First). Block 4 = 3/3 ✅. Drei Commits gepusht plus Backlog-Item #129 emergent. origin/main = `217d299` (Stand vor Tag-25-Closure-Commit).

### #111 Schritt 6 (LICENSE + Boilerplate, Commit `eef78f3`, ~1.5h)

Sieben Files neu angelegt plus package.json-Patch:

- **LICENSE** — Apache 2.0 Volltext + Copyright-Notice "Copyright 2026 Markus Baier" (Leerzeile statt `---`-Trenner, kanonisches Pattern)
- **CONTRIBUTING.md** — EN, Pair-Programming-Pattern transparent gemacht ("External contributors don't need to follow this verbatim"), CoC-Absatz mit Email-Kontakt
- **SECURITY.md** — 5-Zeilen-Variante, Email-Disclosure ohne SLA-Versprechen (Sole-Maintainer)
- **`.github/ISSUE_TEMPLATE/`** — bug_report.yml + feature_request.yml + question.yml (GitHub-Forms-Format) + config.yml (blank disabled + 2 Contact-Links)
- **package.json** — `license: Apache-2.0` + `author: { name, email }` Object-Form + `repository` + `bugs` + `homepage`

Email konsistent: `markus.baier@harwayexperience.com` (Forward auf harway.de für GitHub-Verknüpfung).

**Phase-1.1-Diagnose-Findings:**

- `.github/`-Verzeichnis existierte gar nicht — Tabula rasa
- package.json `license` + `author` waren beide unset
- Kein `pnpm test`-Script vorhanden (keine zentrale Test-Infrastruktur) — CONTRIBUTING Code-Style-Bullet ehrlich ohne pnpm-test-Verweis

### #111 Schritt 7 (README Demo-First, Commit `217d299`, ~2h)

README komplett überschrieben (85 Z deutsch → 126 Z EN). 11 Sektionen Demo-First-Struktur:

1. **Hero** — Tagline "Self-hosted AI twins that remember, have personality, and talk to each other." + 3 Badges (License Apache 2.0, Status pre-launch, Built with Claude in Anthropic-Brand-Color `#D97757`)
2. **Hero-Visual** — Placeholder-Blockquote mit `[Demo video coming soon]`-Marker (HTML-Comment plus sichtbares Element, verhindert Render-Lücke vor #113-GIF)
3. **What is Twin-Lab** — 3-Satz-Differenzierung gegen ChatGPT/Claude.ai
4. **Why Twin-Lab** — 4 Bullets mit Emojis (Memory + Persona + A2A + Research-Beta)
5. **Quick Start** — pnpm-native-Pfad (clone → install → .env-Edit Anthropic-Switch → db:init → dev) + Requirements-Zeile + DEPLOYMENT.md-Verweis für Production
6. **Screenshots** — 2×2-Tabelle mit 4 PNG-Stubs in `docs/screenshots/` (echte PNGs folgen)
7. **Status & Beta** — Works today / Beta / Coming in Phase B (#108-Footprint organisch)
8. **Tech Stack** — mit Major-Versionen (Next.js 15 + React 19, Fastify 5, better-sqlite3 11, AI SDK v6, @ai-sdk/anthropic 3)
9. **Roadmap** — 2-Zeilen-Hint + ROADMAP.md-Verweis
10. **Contributing** — Verweis CONTRIBUTING.md + BACKLOG.md
11. **License** — Verweis LICENSE

**Phase-1.1-Diagnose-Findings (Schritt 7):**

- Existing README war Markus-Internal-Framing ("Tag 1 Closed Twin"), komplett überschrieben
- **Provider-Discrepanz entdeckt:** `.env.example` Default ist `ACTIVE_PROVIDER=openai`, aber Tech-Stack-Story sagt Claude Opus 4.7. Quick-Start im README zeigt 2-Zeilen-.env-Edit für Anthropic-Switch. Backlog-Item #129 angelegt: `.env.example`-Default auf Anthropic switchen (XS/should, vor Self-Hosting-Launch zu lösen)
- **docker-compose ist Production-only:** Network `traefik-proxy` external + image-tag-only + hardcoded Markus-Domain. Local-Dev geht via pnpm, nicht via `docker compose up`. Quick-Start-Pfad entsprechend angepasst (pnpm-native).

### Walkthrough-Befunde Schritt 7 (eingearbeitet)

- Beta-Sektion „Conversational skill install" reformuliert (Jargon raus → „telling your twin 'install the calendar integration'")
- Tech-Stack-Schluss-Zeile entfernt (Requirements-Duplikat zu Quick-Start)
- Quick-Start `open http://localhost:3000` zu Kommentar gemacht (Cross-Platform: Linux/Windows haben kein `open`)
- Screenshots-Tabelle GitHub-Render verifiziert (2×2 sauber, Captions korrekt)

### Backlog-Updates

- **#111 ✅** Closure-Notiz (Schritt 6 + 7)
- **#109 + #110** ✅-Header retrofit + Closure-Notizen (Block-4-Closure-Standard etabliert)
- **#129 neu:** `.env.example`-Default auf Anthropic switchen (XS/should, Phase-A)

### Block-4-Closure-Bilanz

| Item | Status | Commits |
|---|---|---|
| #110 Onboarding-Wizard | ✅ Tag 22 | 13 Commits (Phase 1 + 2A + 2B) |
| #109 DEPLOYMENT.md | ✅ Tag 24 | Tag 23+24 (~1700 Zeilen) |
| #111 Repo-Hygiene | ✅ Tag 25 | `eef78f3` + `217d299` + Closure |

**Block 4 = 3/3 ✅.** Pre-Launch-Phase A jetzt bei **Block 5 (Launch-Vorbereitung)**.

### Pre-Launch-Phase A Bilanz nach Tag 25

- Block 1: ✅ 11/11 (Tag 18, deployed)
- Block 2: ✅ 2/2 (Tag 19, deployed)
- Block 3: ◐ 1/2 (#107 ✅, #108 organisch in #111 README §7 eingearbeitet — kein eigenes Closure nötig)
- Block 4: ✅ 3/3 (Tag 22 + 24 + 25)
- Block 5: 0/4 offen

Bei 17 Tagen verfügbar (Tag 25 → Tag 42) und Block 5 ~5-7 Tage kalkuliert bleiben ~10-12 Tage Reserve.

### Production-Deploy-Stand

Production-VPS synchron mit origin/main `bb50b14` nach Tag-25-Nachmittag-Re-Deploy (Schritt 9, Pfad A). Container-Restart nicht nötig wegen reiner Doku-Drift. Container-Uptime 18-19h durchgehend. Details siehe Sub-Sektion „Production-Re-Deploy Schritt 9" unten.

### Block-5-Strategy-Session (Commit `4cf9457`, ~1.5h)

Tag-25-Nachmittag — vor Block-5-Bau eine Strategy-Session, weil BLOCK-4-STRATEGY nur Block 4 abgedeckt hatte. Pattern wie Tag-20-Session (BLOCK-4-STRATEGY-Anlage). Vier Items: #112 Landing / #113 Demo / #114 Launch-Posts / #115 Launch-Timing.

**Wichtigster Befund — Wettbewerbs-Discovery via Web-Search:**

| Projekt | Stars | Released | Differenzierung gegen Twin-Lab |
|---|---|---|---|
| NanoClaw | 29.2k | Jan 2026 | Single-Agent, 13 Messaging-Plattformen, Container-Isolation |
| Hermes Agent (Nous) | 100k+ | Feb 2026 | Single-Agent, persistent memory + auto-skills |
| OpenClaw | 100k+ | Nov 2025 | Monolithic Agent-Platform |

Beide Konkurrenten haben **Multi-Channel-Messaging als Default**. Twin-Lab heute Web-UI only — wirkt rückständig auch wenn Multi-Twin ein anderes Konzept ist.

**Pivot-Entscheidung:** Telegram-Adapter Stufe 1 (Owner-Only-Bridge) auf Phase A vorgezogen aus ROADMAP Phase 4.1. Neues Backlog-Item **#130 Telegram-Adapter** mit Größe L (4-5 Bautage). Block-5-Bau-Reihenfolge wird `#130 → #113 → #112 → #114 → #115` weil Hero-GIF in #113 Telegram zeigen muss.

**Konsequenz: Launch-Window verschiebt von KW 25-27 (Ende Juni / Anfang Juli) auf KW 29-30 (15.-22. Juli 2026)** — ~2 Wochen Verzögerung gegenüber Original. Bei 17 Tagen Reserve (Tag 25 → Tag 42) bleiben ~5-6 Tage Buffer nach Block-5-Bau.

**Bau-Output:**

- `docs/BLOCK-5-STRATEGY.md` neu mit Setzungen für 5 Items + Bau-Reihenfolge + Tag-Schätzungen + Anmerkungen
- `docs/BACKLOG.md` mit #130 als Phase-A-Item
- `docs/PRE-LAUNCH-A-STRATEGY.md` mit Hybrid-Header-Edit (Audience + weiches Ziel preserved) + Block-5-Sektion erweitert + Pflicht-Aufwand-Summe updated (42→56 Tage verfügbar, 43-55 Total)
- `docs/ROADMAP.md` mit Phase-4.1-Status-Notiz (Stufe 1 vorgezogen, Vollausbau bleibt Phase B)

### Production-Re-Deploy Schritt 9 (kein Commit, ~30 Min)

VPS-Stand vor Re-Deploy war `574f3b2` (Tag 22) — **10 Commits Drift**, nicht 5 wie ursprünglich angenommen. Phase-1.1-Diagnose von Claude Code hatte korrekt `121950a` als VPS-Annahme — Realität war tiefer, aber:

**Code-vs-Doku-Diff `git diff --stat HEAD..origin/main -- apps/ packages/ examples/skills/` = LEER.** Trotz 10 Commits Drift = reine Doku.

**Pfad gewählt: A — nur `git pull`, kein Container-Restart.** Begründung: zero Code-Drift, kein Bind-Mount-Trigger, package.json-Metadaten werden Runtime nicht gelesen, Restart-Risk > Restart-Nutzen.

**Sequenz auf VPS:**

1. `git fetch origin` + `git log HEAD..origin/main --oneline` (Drift sichtbar gemacht)
2. `git diff --stat HEAD..origin/main -- apps/ packages/ examples/skills/` (Code-Drift-Verifikation = leer)
3. `git pull origin main` (Fast-forward 574f3b2 → 4cf9457, 16 Files)
4. Container-Sanity: `docker compose ps` (alle Up, 18-19h Uptime), Logs grep error/warn (leer), `runtime/health` 200, `app/` 307 → `/login?next=%2F` (Next.js Auth-Middleware-Default)

**Resultat: Production-VPS synchron mit origin/main `4cf9457` ohne Container-Restart, ohne Downtime.** Sauberer Doku-Only-Drift-Re-Deploy.

### Doku-Only-Drift-Pattern Mini-Commit (Commit `bb50b14`, ~10 Min)

Re-Deploy hat aufgedeckt: existing DEPLOYMENT.md §3.2 Pattern erwartet immer Rebuild — deckt nicht den Doku-Only-Drift-Fall ab.

**Edit:** Blockquote-Box am Anfang von §3.2.2 mit Erkennungs-Regel (Doku-Pfade-Liste) + Verifikations-Snippet (`git diff --stat HEAD..origin/main -- apps/ packages/`).

Schärft Pattern für künftige Self-Hoster und vermeidet unnötige Rebuilds bei Doku-Updates.

### #130-Architektur-Strategy-Session (Commit `b800d20`, ~45 Min)

Tag-25-Nachmittag-Welle-2 — vor Phase-1-Bau eine Item-spezifische Architektur-Session. Tiefe rechtfertigte eigenes Doc analog zu BLOCK-4-STRATEGY-Pattern: 7 Achsen × Setzungs-Tabellen + 5-Phasen-Bau-Sequenz (~4.5 Bautage).

**Sieben Achsen-Setzungen (mit Web-Recherche Tag 25 Nachmittag):**

| Achse | Setzung |
|---|---|
| a) Bot-Library | Telegraf (Stand 2026, TypeScript-First, aktive Maintenance — node-telegram-bot-api ist stagniert) |
| b) Token-Encryption | Reuse existing AES-256-GCM via `crypto-utils.ts` |
| c) Webhook-Domain | Path-Prefix unter `runtime.*` (keine neue Subdomain) |
| d) Schema | Zwei separate Tabellen (`telegram_configs` + `telegram_messages`) |
| e) Owner-Pairing | Pairing-Code via `/start <code>` (Telegram-User-ID als persistente Auth) |
| f) Webhook vs Polling | Webhook Production, Polling Local-Dev (ENV-Switch) |
| g) Cross-Channel-Threading | Channel-unified Conversation (existing Conversation-Schema + Channel-Marker) |

**Bau-Output:**

- `docs/130-TELEGRAM-STRATEGY.md` neu (177 Z, H1 + 5 H2 + 7+5 H3)
- BLOCK-5-STRATEGY-#130-Sektion + BACKLOG-#130-Body mit Verweis-Edits

### #130 Phase 1 — Backend-Foundation (Commit `843c714`, ~2.5h)

Erste echte Code-Phase von #130. Migration + zwei Repos + Smoke-Script.

**Bau-Output (858 Z Code):**

- Migration `024_telegram_adapter.sql` mit `telegram_configs` + `telegram_messages` (FK auf `twin_profiles(twin_id)`, 5 Indices, Stufe-2-Vorbereitungs-Kommentar)
- `apps/runtime/src/telegram/configs-repo.ts` mit Class `TelegramConfigsRepo` (11 Methoden + 3 Error-Classes + Pairing-Lifecycle atomar via SQLite-Transaction)
- `apps/runtime/src/telegram/messages-repo.ts` mit Class `TelegramMessagesRepo` (5 Methoden + UNIQUE-Constraint gegen Webhook-Retry-Doppel-Inserts)
- `apps/runtime/src/scripts/test-telegram-repos.ts` mit 10 Lifecycle-Steps

**Verifizierte Eigenschaften (Smoke 10/10 grün):**

- Encryption-Roundtrip (Token encrypted gespeichert, dekryptiert matched Original)
- Public-Type strippt `bot_token_encrypted` + `webhook_secret`
- UNIQUE(twin_id) blockt Doppel-Konfig pro Twin
- UNIQUE(twin_id, chat_id, message_id) blockt Telegram-Retry-Doppel-Inserts
- Pairing-Code-Lifecycle atomar (validate-and-consume in einer Transaktion)
- Audit-Trail-Asymmetrie: Config-Delete behält Messages, nur Twin-Delete kaskadiert beide

**Phase-1.1-Diagnose-Findings (kritisch):**

- `EncryptionService` ist tatsächlich `encrypt()`/`decrypt()`-Funktionen in `crypto-utils.ts`, keine Class
- MCP-Server-Repo lebt unter `apps/runtime/src/mcp/repo.ts` (Domain-Folder-Pattern), nicht `db/repos/`
- Existing FK-Targets sind auf `twin_profiles(twin_id)`, nicht `twins(id)` — wäre ohne Diagnose Migration-Failure
- Timestamps Repo-seitig (kein DB-Default)
- ID-Pattern `tg_cfg_${nanoid(16)}` / `tg_msg_${nanoid(16)}` (Prefix + nanoid)
- Keine Unit-Test-Suite — Smoke-Scripts unter `apps/runtime/src/scripts/test-*.ts` als Konvention

**Walkthrough-Befunde (eingearbeitet):**

- B6 Migration-Kommentar über UNIQUE(twin_id) für Stufe-2-Vorbereitung
- B7 JSDoc bei `decryptToken` mit auffälligem SERVER-INTERNAL-Marker + `@internal`-Tag
- B8 JSDoc bei `updateToken` mit setWebhook-Caller-Pflicht-Hinweis

**Smoke-Test-Korrektur:** initial erwartete der Smoke CASCADE für Messages bei Config-Delete. Strategy-Doc §Anmerkungen sagt Audit-Trail-Asymmetrie (SET NULL für Messages). Test auf Strategy-Realität korrigiert — Pattern „Strategy-Doc + Smoke als zwei unabhängige Verifikations-Quellen" hat funktioniert.

### Wettbewerbs-Recherche-Session OpenAI/Anthropic-OAuth (kein Commit dieser Session)

Nutzer-Frage Tag 25 Nachmittag: „OpenClaw und Hermes Agent erlauben Subscription-OAuth — können wir das auch?"

**Befund Selbst-Korrektur:** Tag-25-Vormittag-Wettbewerbs-Analyse (NanoClaw/Hermes mit 29k-100k+ Stars) war zu schnell aus Such-Snippets übernommen, mit teilweise unverifizierter Existenz/Reichweite. Heute Nachmittag mit gezielter Recherche tieferer Stand:

- **OpenAI Codex hat offiziellen OAuth-Flow** (`developers.openai.com/codex/auth`) — dokumentiert für eigene Codex-Produkte (CLI, IDE, App, Cloud), nicht explizit für 3rd-Party-Apps
- **OpenClaw nutzt Codex-OAuth-Flow für eigene App** (`docs.openclaw.ai/concepts/oauth`) mit detailliertem PKCE-Pattern — laut OpenClaw-Doku „explicitly supported", laut OpenAI-Doku nicht explizit für externe Apps adressiert. ToS-Stance fluide.
- **Anthropic** hat Anfang April 2026 Claude Pro/Max via 3rd-Party-Agent-Frameworks gekappt, laut OpenClaw-Doku „wieder erlaubt" — Status nicht öffentlich publiziert

**Konsequenz:** Patterns sind interessant aber risikoreich für Phase-A-Launch (jederzeit revozierbar). Beide als Phase-B-Backlog-Items mit Implementations-Skizzen + dokumentierten ToS-Grauzonen-Risiken.

### #131 + #132 Subscription-Auth-Backlog-Items (Commit `445fb67`, ~20 Min)

- **#131 OpenAI Subscription-OAuth (Beta, Codex-Pattern):** PKCE-Flow analog OpenClaw, 8-Schritte-Implementations-Skizze, Größe L (4-5 Bautage), Priorität `later`, Spur Pre-Launch-Phase B
- **#132 Anthropic Subscription-Auth (Claude-CLI-Reuse-Pattern):** CLI-Detection + Credential-Mirror, 4-Schritte-Skizze, Größe M (2-3 Bautage), Priorität `later`, Spur Pre-Launch-Phase B
- Alle 4 Quellen-Links HTTP 200 verifiziert
- Format konsistent zu existing Phase-B-Items (#116/#117) — Drifts (could → later, Phase B+ → Pre-Launch-Phase B) korrekt korrigiert

### #130 Phase 2 — Telegraf-Service + Owner-Pairing-Flow (Commit `82bb36d`, ~4h)

Zweite Code-Phase. Service-Layer komplett: PairingService + TelegramBotRegistry + Telegraf-Setup + Webhook-Endpoint + Boot-Hook + Manual-Smoke-Helper.

**Bau-Output (1403 Insertions, 14 Files):**

- `apps/runtime/src/telegram/pairing-service.ts` (Code-Generation + atomare Validation, 6-stellig, 10min TTL)
- `apps/runtime/src/telegram/telegraf-setup.ts` (createTelegrafBot-Factory mit Three-State-Text-Handler)
- `apps/runtime/src/telegram/bot-registry.ts` (Multi-Tenant-Lifecycle + eager-load + lazy + webhook-dispatch + shutdown)
- `apps/runtime/src/telegram/webhook-routes.ts` (registerTelegramWebhookRoutes mit Handle-Lookup + Secret-Verify)
- `apps/runtime/src/scripts/setup-telegram-manual-smoke.ts` (Helper für Pairing-Setup ohne Settings-UI)
- `apps/runtime/src/scripts/test-telegram-phase2.ts` (8-Step-Smoke)
- ENV-Schema: `parseBoolEnv` + `telegramUsePolling` + `runtimePublicUrl` + Cross-Validation
- TelegramConfigsRepo erweitert um `findAll()` + `findByTwinHandle()` (mit JOIN auf twin_profiles)
- Boot-Hook in `index.ts` zwischen Z.96-101 (eagerLoadAllBots) und nach Z.133 (start(logger))
- DEPLOYMENT.md §10 (Production-Setup für Self-Hoster, drei Sub-Sektionen)
- SETUP.md erweitert um „Telegram-Bot Local Development" (Polling-Default + ngrok-Alternative)

**Semantik-Korrektur während Bau (eagerLoadPairedBots → eagerLoadAllBots):**

Phase-2-Manual-Smoke-Helper-Schreiben deckte Chicken-and-Egg-Design-Gap auf: ursprüngliche Tag-25-Strategy-Setzung „Eager für gepaarte, Lazy für ungepaarte" verhinderte First-Pairing. Frisch konfigurierter Bot ohne `paired_owner_telegram_user_id` wurde vom Boot-Loader übersprungen → `/start <code>` kam nirgendwo an → konnte nie gepaart werden.

Korrektur: alle Configs eager laden (Bot-Liveness am Token, nicht am Pairing). Pairing-State nur in Text-Handler relevant.

**Three-State-Text-Handler** (folgt aus Semantik-Korrektur):

- Unpaired Bot: `"This bot isn't paired yet. The owner should send /start <code>..."`
- Paired Bot, wrong User: `"This bot is paired with a different Telegram account..."`
- Paired Bot, Owner: `"(Phase 2 stub — LLM integration in Phase 3)"`

**Smoke 8/8 grün** (Pairing-Lifecycle inkl. expired-Code-Filter + Wrong-Code + Resolve-By-User + Unpair + findByTwinHandle + BotRegistry-Eager-Load).

**Manual-Smoke 5/5 grün** (via BotFather-Bot `@twin_lab_markus_test_bot`, Test-Pfade: Help-Reply / Wrong-Code / Unpaired-State / Valid-Pair / Owner-Text). Cleanup via Helper-Script-Flag `--cleanup`.

**Phase-2.5-Scope-Anpassung:** ursprünglich war Phase 2.5 als Mini-Phase für Pairing-Code-Generation-API + setWebhook-Trigger geplant. Entscheidung Tag 25 Abend: Phase 2.5 entfällt, Scope zusammengelegt mit Phase 3. Phase 3 deckt damit: Message-Routing + LLM-Integration + Pairing-API + setWebhook-Lifecycle. Geschätzt 1.5-2 Tage (statt ursprünglich 1 Tag).

### Was als nächstes ansteht

**Tag 26 — #130 Phase 3 (Message-Routing + LLM-Integration + Pairing-API + setWebhook, ~1.5-2 Bautage):**

Phase-3-Scope wurde Tag 25 Abend erweitert um Pairing-Code-Generation-API + setWebhook-Trigger (Phase 2.5 entfällt). Strategy-Klärungen vor Bau:

- Conversation-Resolution-Heuristik (last-active vs neue Conversation pro Chat)
- Message-Router-Service-Layering (zwischen Telegraf-Handler und Twin-Service)
- Pairing-Code-Generation-API als POST-Route — wo lebt sie (Auth-Required, Owner-only)?
- setWebhook-Call-Trigger-Position (in PairingService oder direkt nach configsRepo.create() bei Re-Tokenization)

**Tag 27 — Production-Deploy Phase 1 + 2 + 3 (gemeinsam):**

Migration + Bot-Lifecycle + Message-Routing zusammen deployen. Telegram-Bot-Smoke auf Production-VPS mit echtem Webhook (statt Local-Polling).

**Wettbewerbs-Verifikation-Zwischen-Tag (optional, ~1-2h):**

Tag-25-Vormittag-Wettbewerbs-Analyse hat unverifizierte Stars/Reichweite-Zahlen genutzt. Vor Block-5-Items #112-#114 (Landing-Vergleichs-Tabelle, Launch-Posts-Wettbewerbs-Positionierung) eine Verifikations-Session — sind die Projekte/Zahlen verlässlich? Falls nein, BLOCK-5-STRATEGY-Wettbewerbs-Tabelle anpassen. Falls ja, Setzungen bleiben. Nicht launch-blocking, aber sauberer vor Marketing-Items.

