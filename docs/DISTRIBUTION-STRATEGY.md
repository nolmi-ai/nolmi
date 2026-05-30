# DISTRIBUTION — Nolmi als Produkt für andere

**Stand:** Strategie-Session abgeschlossen Tag 31 (30. Mai 2026). **Status:** Setzungen D1–D5 gelockt, Bau noch nicht begonnen — nächster Schritt sind die read-only Etappe-0-Diagnosen (§3).

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

### D2 — API-Key-Default; OAuth nur self-hosted + manuelle Allowlist

**Default für alle ist BYO-API-Key.** **OAuth (ChatGPT-Subscription, #131) ist die Ausnahme**, nicht der Default — und nur unter zwei Bedingungen: (a) **self-hosted** (der User trägt sein eigenes Token auf seiner eigenen Infra) oder (b) auf `nolmi.ai` **nur für eine manuelle Allowlist** (Owner + kleine Friends-&-Family-Gruppe, mit **offener Risiko-Kommunikation**). **Anonyme Fremde bekommen API-Key-only**, kein OAuth.

**Mechanik:** ein `auth_mode`-Flag pro Account/Twin — `api_key_only` (Default) / `oauth_allowed` (manuell gesetzte Ausnahme). UI-Gate blendet den OAuth-Pfad nur bei `oauth_allowed` ein. **Kein Self-Service-OAuth** — niemand kann sich selbst OAuth freischalten.

**Risiko-Note (warum so streng):** Fremde OAuth-Tokens zentral auf **einer** Infrastruktur einzusammeln ist exakt das OpenClaw-Muster, das Anthropic im April 2026 geblockt hat (Accounts terminiert). Mehrere ChatGPT-Accounts, die von **einer** Server-IP refreshen, sehen für OpenAI nach **Subscription-Sharing** aus — ein Terminierungs-Trigger. Self-hosted verteilt das Risiko; zentral konzentriert es. Deshalb OAuth zentral nur für eine bekannte, klein gehaltene, aufgeklärte Gruppe.

### D3 — Bridge optional (drei Stufen)

Die A2A-Bridge ist heute faktisch Voraussetzung (Twins registrieren sich, Boot erwartet sie). Für Distribution muss ein **Solo-Twin ohne Bridge** der Default-Einstieg sein. Drei Stufen:

1. **Standalone** — Twin läuft ohne jede Bridge (kein A2A). Der Default-Einstieg fürs Self-Hosting.
2. **Eigene Bridge** — User hostet seine eigene Bridge (z.B. Familie/Team), Twins darin reden miteinander.
3. **Fremde Bridge** — Twin bindet sich an eine bestehende Bridge (z.B. eine Community-Bridge).

**D3-Scope = Entkopplung + Re-Bind**, nicht Föderation:
- Schema NULL-fähig machen, wo heute eine Bridge-Referenz hart erwartet wird (`bridge_url`/`bridge_token` optional).
- **Boot-Guard:** Runtime bootet sauber ohne Bridge (kein Crash, klare Log-Zeile „kein Bridge-Modus").
- **A2A-UI-Toleranz:** die Web-UI zeigt A2A-Features ausgegraut/abwesend statt zu brechen, wenn keine Bridge da ist.
- **Re-Bind:** ein Twin kann nachträglich an eine Bridge gebunden werden (Stufe 1 → 2/3).

**Ausdrücklich NICHT in D3:** offene Föderation mit Fremd-Vertrauen (mehrere Bridges sprechen, Trust über Bridge-Grenzen) — das ist **Produkt-Phase 4** (Multi-Channel/Föderation, ROADMAP-Achse 1), nicht Distribution.

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

**Verbleibend aus Etappe 1 (→ Etappe 2):** Re-Bind (Bridge nachträglich einhängen, Stufe 1→2/3) + Onboarding-Wizard-Solo-Pfad + Production-Deploy der Migration 026.

### Etappe 2 — Distribution-Layer

- **One-Liner-Install** — Automatisierung von Phase-4-B1+B2 (VPS-Prep + Docker + Traefik + Stack-Build) **mit den 6 Cookbook-Befunden bereits eingebaut** (Traefik v3.6, Netz `external`, htpasswd am Traefik-Stack, `RUNTIME_PUBLIC_URL`-Pflicht, Resolver-Store-Reset, Bridge-Auto-init — siehe `PHASE-4-VPS-STRATEGY.md` §7). Der Install-Script ist faktisch das Cookbook als Code.
- **CLI-Onboarding** — Twin-Anlage ohne Web-UI für Self-Hoster (Lücken aus Etappe-0-#110-Diagnose). **⚠ Release-Blocker-Sub-Punkt (Befund Block 21):** `twin:bootstrap` setzt heute **keinen `owner_user_id`** → ein frisch ge-bootstrappter Twin ist ownerlos und im Twin-Switcher unsichtbar (owner-gescopte `/twins`-Liste). CLI-Onboarding muss **User-Anlage + Twin-Owner-Zuweisung koppeln**. BACKLOG-Item (must-vor-Release).
- **`auth_mode`-Flag (D2)** — `api_key_only`-Default + UI-Gate.
- **Update-Mechanismus** — wie ein Self-Hoster eine neue Version zieht (git pull + rebuild, oder Image-Tag-Bump).

### Etappe 3 — Release

- **Install-README** — One-Liner + Voraussetzungen + Modus-Wahl (standalone/Bridge).
- **Repo öffentlich** — **gated durch §5** (secret-freie History!).
- **Lizenz** — MIT (Default-Annahme, in §5 final wählen).

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

**(b) Lizenz wählen.** Default-Annahme **MIT** (maximale Self-Hosting-Reichweite, konsistent mit Open-Core-Tendenz). Vor Release final setzen + `LICENSE`-Datei. Falls Open-Core mit kommerziellem Managed-Kern: prüfen, ob Teile dual-licensed/getrennt sein sollen — das ist aber D5-Territorium und blockt den Self-Hosting-Release nicht (MIT auf den Self-Host-Code reicht).

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
