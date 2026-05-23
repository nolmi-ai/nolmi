# Block-5-Strategy — Launch-Vorbereitung + Telegram-Pivot

**Strategy-Session:** 24. Mai 2026, Vormittag (Tag 25)
**Master-Doku:** [`docs/PRE-LAUNCH-A-STRATEGY.md`](./PRE-LAUNCH-A-STRATEGY.md)

Dieses Dokument verfeinert Block 5 (Launch-Vorbereitung) der Pre-Launch-Phase A mit konkreten Setzungen über fünf Items: **#130 Telegram-Adapter** (neu, Wettbewerbs-Pivot), #112 Landing-Page, #113 Demo-Material, #114 Launch-Posts, #115 Launch-Timing.

## Kontext + Pivot

Block 5 sollte ursprünglich vier Items abdecken (#112-#115). Strategy-Session Tag 25 fügte ein fünftes Item hinzu: **#130 Telegram-Adapter Stufe 1 (Owner-Only-Bridge)** als Wettbewerbs-Reaktion auf NanoClaw + Hermes Agent.

### Wettbewerbs-Realität (Stand 24. Mai 2026)

| Projekt | GitHub-Stars | Released | Core-Story |
|---|---|---|---|
| OpenClaw | 100k+ | Nov 2025 | Monolithic agent platform, 400k LOC, 50+ Integrations |
| NanoClaw | 29.2k | Jan 31, 2026 | 15-File-Minimalismus, Container-Isolation, 13 Messaging-Plattformen |
| Hermes Agent (Nous Research) | 101k–153k | Feb 2026 | Self-improving Memory, auto-generierte Skills, 6+ Messaging-Plattformen |
| Twin-Lab | 0 (heute privat) | Launch Juli 2026 | **Multi-Twin + A2A-Bridge** (anderes Konzept, nicht Single-Agent) |

**Differenzierungs-Befund:** NanoClaw und Hermes sind Single-Agent-Harnesses („dein Agent lernt dich"). Twin-Lab ist Multi-Twin-Platform („mehrere Twins die miteinander reden"). Anderes Konzept — keine direkte Konkurrenz, aber gleiche Audience (Self-Hoster, Tech-Affine).

**Schwäche-Befund:** Twin-Lab hat Web-UI only. Konkurrenz hat Messaging-Integration als Default. Launch ohne Messaging-Story wirkt rückständig in der Audience-Wahrnehmung — auch wenn das Konzept anders ist.

**Pivot-Entscheidung:** Telegram-Adapter Stufe 1 in Phase A vorziehen (ursprünglich ROADMAP Phase 4.1). Launch-Window verschiebt sich um ~2 Wochen.

## Setzungen #130 Telegram-Adapter (Phase A, neu)

| Aspekt | Setzung | Begründung |
|---|---|---|
| Scope | Stufe 1 — Owner-Only-Bridge (minimal) | Verteidigt gegen „kann das auch Messaging?"-Frage ohne Stufe-2-Komplexität (External-Sender-Auth-Flow). Stufe 2+3 bleiben Phase B. |
| Auth-Modell | Bot-Token per Twin (klassisches Bot-API) | Dokumentiert, stabil, kein API-Key-Risiko wie MTProto. Owner verbindet eigenen Telegram-Account via `/start`-Command zum eigenen Twin. |
| Position in Block 5 | Zuerst, vor #112-#115 | Hero-GIF in #113 muss Telegram visualisieren. Code-Item vor Marketing-Items ist Best-Practice. |
| Persistenz | Conversation-Threads in existing SQLite-Schema, neue Migration für `telegram_chats`-Tabelle und Bot-Token-Storage | Reuse bestehender Persistence-Layer, kein neuer Storage-Backend. |
| Production-Deploy | Webhook-Pattern (Telegram → `/webhooks/telegram/:twin-handle`) mit Twin-Lab-Runtime-Container behind Traefik | Polling-Pattern wäre einfacher aber skaliert schlechter; Webhook ist Production-Standard. |

Implementation-Skizze und Smoke-Tests siehe BACKLOG #130.

**Erwartete Größe:** L (4-5 Bautage).

## Setzungen #112 Landing-Page

| Aspekt | Setzung | Begründung |
|---|---|---|
| Plattform | Vercel oder Cloudflare-Pages mit Astro Static-Site + Custom-Domain | Konkurrenz hat Custom-Domains + professionelles Design (`nanoclaw.dev`, `hermes-agent.org`). GitHub-Pages signalisiert „Hobby" im Vergleich. |
| Custom-Domain | `twin-lab.dev` falls verfügbar, sonst Alternative (`twinlab.dev`, `twin-lab.ai`, `twin-lab.app`) — Domain-Recherche in #112 Phase 1.1 | TLD signalisiert Tech/Modern-Audience. Bei Bau-Start verfügbarkeits-Check + Registration vor Bau-Start. |
| Sektion-Sequenz | Hero + Differenzierungs-Vergleich-Tabelle + Multi-Twin-Visual + Quick-Start + Footer | NanoClaw hat erfolgreiche Vergleichs-Tabelle gegen OpenClaw — Pattern übernehmen. Ehrliche Differenzierung, kein FUD. |
| Vergleichs-Tabelle | Twin-Lab vs NanoClaw vs Hermes Agent vs ChatGPT — Achsen: Concept (Single-Agent / Multi-Twin), Memory, Communication-Pattern, Messaging-Support, Self-Hosting, Audience | Audience-Frage „warum sollte ich das statt NanoClaw nutzen?" direkt addressieren. |
| Visual-Asset Multi-Twin | Hero-GIF aus #113 zeigt 2 Twins mit A2A-Bridge + Telegram-Notification — sichtbarer USP-Beweis | Visual ist überzeugender als Text. Single-Twin-Demo macht uns austauschbar mit NanoClaw. |
| Content-Reuse aus README | Sektion-Inhalte spiegeln README (Tagline, Why-Bullets, Quick-Start), aber visuell anders | Single Source of Truth = README, kein Drift-Risiko. |

**Erwartete Größe:** M (1.5-2 Bautage statt 1 — Custom-Domain + Astro-Skelett + Vergleichs-Tabelle + Polish).

## Setzungen #113 Demo-Material

| Aspekt | Setzung | Begründung |
|---|---|---|
| Format | Hybrid: `docs/WALKTHROUGH.md` (schriftlich) + 60-Sek-Hero-GIF | BACKLOG-Original-Setzung übernommen. Voll-Video Phase B. |
| Hero-GIF-Inhalt | Multi-Twin im Web → A2A-Bridge → Telegram-Notification auf Phone-Mockup — eine GIF, beide Stories | „Same twin, web + messaging" als visueller Sales-Pitch. Single-Story-GIF wäre weniger einprägsam. |
| Hero-GIF-Szenen-Sequenz | (1) Dashboard mit 2 Twins → (2) Konversation mit Twin A → (3) Twin A initiiert A2A-Bridge → (4) Bridge-Approval → (5) Cross-Twin-Konversation läuft + Memory-Hit-Badge → (6) Phone-Mockup zeigt Telegram-Notification mit derselben Konversation | ~10 Sek pro Szene = 60 Sek total. Sequenz erzählt USP-Story (Multi-Twin, A2A, Memory, Multi-Channel) in einem Stück. |
| Aufnahme-Workflow | macOS Screenshot-Tool (Cmd+Shift+5) → MP4 → ffmpeg-Konvertierung zu GIF (`fps=15, scale=1200:-1, ≤2 MB`) | Kein zusätzliche Software-Install. Phone-Mockup als statisches PNG-Frame mit Telegram-UI-Screenshot reinmontiert. |
| Schriftlicher Walkthrough | `docs/WALKTHROUGH.md` mit 4 Sektionen: First Boot → First Conversation → A2A in Action → Telegram-Integration | Erweitert Hero-GIF um Detail-Level. Screenshots aus `docs/screenshots/` (auch Telegram-Bot-Setup). |

**Erwartete Größe:** S-M (1-1.5 Bautage, durch Telegram-Szene + Phone-Mockup-Montage komplexer als BACKLOG-Original-Schätzung S).

## Setzungen #114 Launch-Posts

| Aspekt | Setzung | Begründung |
|---|---|---|
| Plattform-Mix | HN (Show HN) + Twitter-Thread + r/LocalLLaMA + r/SelfHosted | High-Signal-Low-Effort. r/MachineLearning ist Research-fokussiert (mismatched), Discords sind Aftercare. |
| Tone-Linie | „I built this because"-Story + ehrliche Wettbewerbs-Positionierung | HN-Audience hasst Marketing-Speak. Direkte Erwähnung von NanoClaw/Hermes mit ehrlicher Differenzierung. |
| HN-Title | `Show HN: Twin-Lab — Multi-twin platform with twin-to-twin communication` | Tagline-Variante aus README, „Show HN" Prefix Pflicht, unter HN-60-char-Limit. Hervorhebung des USP (Multi-Twin) vor Single-Agent-Wettbewerb. |
| HN-Body-Struktur | (1) What I built (2-3 Sätze) → (2) How it's different from NanoClaw/Hermes (Multi-Twin vs Single-Agent, ehrlich) → (3) Tech-Details (Stack, A2A-Bridge-Architektur, Telegram-Integration) → (4) What's beta / limitations → (5) Quick-Start-Link | Klassisches Show-HN-Pattern. Wettbewerbs-Sektion explizit, nicht ausgespart. |
| Submission-Reihenfolge | HN zuerst (15:00 Berlin) → Twitter-Thread mit HN-Link (15:05) → Reddit-Submissions parallel (15:10) | HN braucht Erst-Position für Algorithm-Boost. Twitter referenziert HN-Link. Reddit ist Long-Tail. |
| Review-Loop | Florian punktuell für Tweet-Drafts + HN-Body innerhalb 24h | BACKLOG-Wunsch übernommen. Heiko optional. Kein Block bei No-Response. |
| Drafts-Format | `docs/LAUNCH-DRAFTS.md` in `.gitignore` bis Launch-Day, dann committet als Archive | Vermeidet versehentliches Public-Push. |

**Erwartete Größe:** S (0.5-1 Bautag).

## Setzungen #115 Launch-Timing

| Aspekt | Setzung | Begründung |
|---|---|---|
| Wochentag | Dienstag oder Mittwoch | HN-Algorithm-Optimum (BACKLOG-Übernahme). |
| Uhrzeit | 9:00 Uhr US-East-Coast = 15:00 Uhr Berlin | HN-Erstposition-Optimum. |
| Launch-Window | KW 29-30 (15.-22. Juli 2026) | Pivot von KW 25-27. Verzögerung durch Telegram-Item gerechtfertigt. |
| Konkretes Launch-Datum | Bei #115-Bau festlegen (Wetter-/Konkurrenz-Check Hermes/NanoClaw-Major-Releases) | Calendar-Check vor finaler Setzung. Distance zu zeitgleichen self-hosted-AI-Posts. |
| Repo-Public-Schalt | Tag minus 2 vor Launch (GitHub-Search-Indexing-Window + Pre-Launch-Tester-Smoke) | Vermeidet Last-Minute-Public-Schalt mit Risk. |
| Launch-Day-Sequenz | Vormittag VPS-Smoke + Landing-Smoke → 15:00 HN-Post → 15:05 Twitter-Thread → 15:10 Reddit-Submissions → Monitoring bis 22:00 | Konkrete Stunden-Sequenz vermeidet improvisiertes Klicken. |
| Pre-Launch-Checklist | Eigene `docs/LAUNCH-CHECKLIST.md` mit ~15 Items (Production-Smoke, Backup-Test, Landing-Live, Telegram-Bot-Live, Drafts-final, etc.) | Wird in #115 Bau angelegt. |

**Erwartete Größe:** XS-S (0.5 Bautag).

## Bau-Reihenfolge Block 5

**#130 → #113 → #112 → #114 → #115**

Begründung:

- **#130 Telegram zuerst** — Code-Item vor Marketing-Items, Hero-GIF braucht Telegram-Demo
- **#113 Demo dann** — Hero-GIF braucht Twin-Lab-mit-Telegram als live-Asset
- **#112 Landing dann** — braucht Hero-GIF + Screenshots als visuelle Assets
- **#114 Launch-Posts dann** — braucht Landing-URL als Verweis-Ziel
- **#115 Launch-Timing zuletzt** — alle vorherigen Artefakte als bekannte Größen

## Tag-Schätzungen

| Phase | Item | Tage |
|---|---|---|
| 1 | #130 Telegram-Adapter Backend (Bot-Client + Migration + Webhook + Owner-Pairing) | 3 |
| 2 | #130 Settings-UI + Smoke-Tests | 1.5 |
| 3 | #113 Hero-GIF + Walkthrough-Doc + Screenshots-Session | 1.5 |
| 4 | #112 Landing-Page (Domain + Astro + Vergleichs-Tabelle + Polish) | 2 |
| 5 | #114 Launch-Drafts (HN-Body + Twitter-Thread + 2 Reddit-Bodies) | 0.5 |
| 6 | #115 Launch-Checklist + Timing-Plan + Pre-Launch-Smoke | 0.5 |
| 7 | Pre-Launch-Review-Loop + Polish | 1 |
| 8 | Launch-Day + Monitoring | 1 |

**Total geschätzt:** 11-12 Bautage. Bei 17 Tagen Reserve (Tag 25 → Tag 42) bleiben 5-6 Tage Buffer für Bug-Fixes, Pivots, oder Polish-Wellen.

## Anmerkungen

- **Wettbewerbs-Pivot-Begründung:** Strategy-Session Tag 25 entdeckte mit Web-Recherche, dass NanoClaw (29k Stars, Jan 2026) und Hermes Agent (100k+ Stars, Feb 2026) den self-hosted-AI-Markt etabliert haben mit Multi-Channel-Messaging als Default. Twin-Lab ohne Messaging-Integration wirkt rückständig — auch wenn Multi-Twin ein anderes Konzept ist. Telegram-Stufe-1 verteidigt minimal-viable gegen diese Wahrnehmung.

- **Phase-B-Implikation:** Telegram-Stufe-2 (External Senders mit Pre-Approval) und Stufe-3 (Voll-Multi-Twin-Router) bleiben Phase B. WhatsApp + Discord + Slack folgen in Phase 4.1-4.5 wie geplant.

- **Custom-Domain-Aufwand:** Domain-Verfügbarkeits-Check + Registration kostet 1-2h und ~15€/Jahr. In Phase 1.1 von #112 prüfen und Markus bestätigen lassen vor Plattform-Bau.

- **Risiko-Reserve:** 5-6 Tage Buffer bei 11-12 Tage Bau ist okay für Phase A, aber Telegram-Adapter ist neue Surface — bei Bug-Discovery in Stufe 1 kann Buffer schnell weg sein. Risk-Mitigation: Stufe-1-Scope strikt halten, keine Feature-Erweiterungen während Bau.

## Verweis

Master-Doku: [`docs/PRE-LAUNCH-A-STRATEGY.md`](./PRE-LAUNCH-A-STRATEGY.md). Diese Setzungen verfeinern Block 5 konkret.
