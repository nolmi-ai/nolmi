# Backlog Phase 2.5 und später

Stand: 26. Mai 2026 (Tag 28) — Tag-26+ -Closures bleiben hier mit Status-Notizen, ältere Closures im Archiv (siehe unten). Phase A komplett (#131 OAuth + Tag-28-Polish-Quartett #139+#140+#141+#142 zu, plus #146/#149/#150/#155 + #131-Phase-B `--auth-json`). Originaler Tag-12-Stand-Header (Phase 3.3-Closure) im Archiv.

Format: Punkte mit Größe (S/M/L/XL) und Priorität (must/should/nice).

## Archiv

Closed Items vor Tag 26 ausgelagert nach
[`docs/archive/BACKLOG-closed-pre-tag26.md`](./archive/BACKLOG-closed-pre-tag26.md).

---

## Architektur-Entscheidungen (Stand 2. Mai 2026)

Wichtige Weichen, die geklärt sind — Referenz für alle weiteren Items:

**Hybrid-Strategie statt Hermes-Adoption.** Eigenes TypeScript-Backend, lernend von Hermes Agent (Nous Research), MCP-fähig in Phase 3. Begründung: Easy-Setup für externe User (Multi-Tenant SaaS, kein Self-Hosting), Verleihbarer-Twin-Vision (statt Hermes' "mein Assistent"-Ansatz), Stack-Konsistenz (TypeScript statt Python).

**Memory-Phase als Phase 3.** Nach Phase 2.5 (Multi-Tenant), vor Phase 4 (Multi-Channel/Föderation). Begründung: Memory macht Twins inhaltlich tiefer, Multi-Channel macht sie erreichbar — Reihenfolge zählt.

**Memory in 4 Schichten:** Conversation, Episodic, Semantic, Procedural. Implementierung über sqlite-vec (Episodic), `facts.md` (Semantic), strukturierte Skill-Files (Procedural).

**Skills in 4 Layer:** Capability → Tool → Skill → Mandate. Skill-System ist Vorbedingung für externe Tool-Integrationen (Hyperbrowser, MCP-Server-Tools).

**Per-Twin Konfiguration als Pattern.** LLM-Config heute (mit AES-256-GCM-Verschlüsselung der API-Keys), Skill-Config in Phase 3, Channel-Config in Phase 4 — alle pro Twin, nicht pro Plattform. Konsistent mit Multi-Tenant-Vision.

**Drei Deployment-Modelle:** Lokal (Self-Hosted), Hosted mit BYO-API-Key (verschlüsselt mit Server-Master-Key), Hosted mit System-API-Key (Premium-Abo). Onboarding-Wizard (2.5.3) bietet aktuell A+B, C kommt später mit Stripe-Anbindung.

**A2A-Protokoll-Strategie:** Google A2A wird in Phase 4 oder 5 als Adapter-Schicht obendrauf gebaut, nicht als Ersatz für die interne Bridge. Ökosystem-Anbindung ohne Lock-In auf eigenes Protokoll.

**Onboarding-Strategie:** Strukturierte Felder statt Markdown-Editor für non-tech-User. Persona-Markdown wird im Backend aus Form-Inputs generiert. Drei vorgefertigte Mandate-Templates (cautious/trusting/business) statt YAML-Editor. API-Key-Test-Call vor Submit, atomarer DB-Insert mit Verschlüsselung.

**User-Auth ist Vorbedingung für mehrere UX-Fixes (NEU 2. Mai).** Live-Test mit Heiko-Twin hat gezeigt, dass Owner-Recognition (#14), Approval-Routing und Owner-aware Twin-Verhalten sich nur mit echten User-Identitäten sauber lösen lassen. 2.5.4 (User-Auth) ist deshalb Pflicht-Vorbedingung für 2.5.5 und 2.5.6, plus für die UX-Refinements aus 2.5.3.

**Trust-Layer als Vorbedingung für Multi-User-Realität (NEU 3. Mai).** Mit User-Auth aus 2.5.4 hat jeder Twin einen Owner. Aber daraus ergibt sich konzeptionell ein Cluster aus drei Vertrauensstufen: Owner-Direct (kein Mandate-Check), Trusted-Twin (kein Mandate-Check, audit `trusted-bypass`), External (Mandate-Check, System-Wartemeldung). Das System ist in 2.5.4.1 gebaut, mit `trust_relationships`-Tabelle, Trust-Repo, Settings-UI-Block. Plus eine subtile Designentscheidung: Owner-Bypass gilt **nicht** für `send_to_twin` — sonst würde Tippfehler im Owner-Chat eine Bridge-Nachricht ohne Approval rausschicken. Sicherheits-Trade-off zugunsten von Approval-Gate auch für Owner.

**Reply-Detection als Backbone für A2A-Symmetrie (NEU 3. Mai).** A2A-Konversationen brauchen ein Konzept von „diese Antwort ist Reply auf eine vorherige Anfrage von uns, kein neuer Mandate-Check". Implementierung in 2.5.4.2: Bridge speichert `in_reply_to`, neuer Bridge-Endpoint `GET /messages/:id/sender` für Sender-Lookup, Twin-Service prüft `inReplyTo` + Lookup → wenn Original-Sender = wir, dann Audit `reply-received` ohne Mandate. Plus Conversation-View aus Bridge-Messages-DB statt aus lokalen Audits — symmetrische Sicht auf beiden Seiten der Konversation.

**Inbox vs. Settings als konzeptionelle Trennung (NEU 3. Mai).** Settings-Page mischte Konfiguration (Persona, Mandates, Trust) mit Aktivität (Pending, Approvals, Audit). Reorganisation in 2.5.4.3: neue `/inbox`-Page mit Pending-Approvals + Letzte Approvals + Audit-Log. Settings nur noch Twin-Profil + Vertraute Twins + Persona-Hilfe. Plus Top-Nav-Tab mit Live-Badge (Pending-Count via SSE-Events `pending-added` / `pending-resolved`).

**Status-Konsistenz als Audit-Reporting-Hygiene (NEU 3. Mai).** Drei Bypass-Pfade (`owner-direct`, `owner-direct-send`, `trusted-bypass`) verwendeten initial `status: "approved"`, was semantisch falsch ist (kein Approval-Workflow gefunden). Heute auf `"executed"` korrigiert. Mandate-Check-Pfad behält `"approved"` — dort ist das semantisch korrekt (Mandate-Check ist passiert und positiv ausgegangen).

**Container-zu-Container-Hop statt Public-URL (NEU 4. Mai).** Production-Setup hat Bridge auf eigener Subdomain plus Web-Runtime auf eigener Subdomain — beide auf demselben VPS, beide hinter Traefik. Naive Annahme: Web-Runtime ruft Bridge via Public-URL `https://bridge.twin.harwayexperience.com`. Realität: viele VPS-Provider blocken Hairpin-NAT (Container darf nicht an seine eigene Public-IP), Connect-Timeout. Lösung: beide Container im `traefik-proxy`-Network, interne Calls via Container-Name als Hostname (`http://twin-lab-bridge:5100`). Schneller (kein TLS-Overhead), zuverlässig (kein Hairpin), spart Bandbreite. Generelles Pattern für Multi-Container-Setups auf einem Host.

**NEXT_PUBLIC-Vars zur Build-Zeit, nicht zur Runtime (NEU 4. Mai).** Next inlined `NEXT_PUBLIC_*`-Variablen ins Client-Bundle beim Build. Compose-`environment:`-Block setzt sie zur Runtime, kommt zu spät — Bundle hat dann hartcodierte Default-URLs aus dem Code. Pattern: ARG/ENV im Dockerfile-Builder-Stage, plus `--build-arg` beim `docker build`. README dokumentiert den Aufruf für Production-Builds. Kein Compose-Trick, keine Runtime-Override.

**Cookie-Domain als ENV-getriebener Quick-Fix (NEU 4. Mai).** Cross-Subdomain-Setup (Web auf `app.*`, Backend auf `runtime.*`) braucht Session-Cookie auf Parent-Domain `.twin.harwayexperience.com`. Implementiert via zwei ENVs (`SESSION_COOKIE_DOMAIN`, `SESSION_COOKIE_SECURE`) mit konservativen Defaults — lokal HTTP ohne Domain bleibt unverändert. Sauberere Variante: Reverse-Proxy-Architektur (Same-Origin) eliminiert das Problem strukturell. Backlog #65 für später, kein Blocker.

**Bridge-DB-Cleanup als Production-Bootstrap-Schritt (NEU 4. Mai).** Wenn Bridge schon vor dem Web-Stack existiert (Tag 4 Bridge-Sync-Test mit alten Handles) und die neue Web-Runtime mit eigener leerer DB startet, kollidiert das Onboarding (Bridge meldet „Handle existiert bereits"). Cleanup-Pfad: alte Handles via Volume-Mount löschen, dann neu registrieren. Pattern für künftige Re-Bootstraps oder Migrations.

**packages/shared braucht eigenes dist/ für Production-Container (NEU 4. Mai).** Lokal funktionierte `main: "src/index.ts"` durch tsx und Next-dev-Auflösung. Production-Container-Node ohne tsx-Loader brach mit ERR_UNKNOWN_FILE_EXTENSION. Pattern: shared baut explizit nach `dist/`, `package.json` zeigt mit main/types/exports darauf, `files: ["dist"]` für pnpm-deploy. Plus predev-Hook in jeder App, damit lokale Entwicklung weiter ohne manuellen Build-Schritt funktioniert. Dockerfiles bauen shared explizit vor App-Build.

**Mandate-Terminologie-Klarstellung (NEU 21. Mai).** Google's **AP2 (Agent Payments Protocol)** verwendet „Mandate" als cryptographisch-signierte Intent-Contracts für Payment-Authorization („Intent Mandate" für Suchauftrag, „Cart Mandate" für Kauf-Approval).

twin-lab's **Mandate-Layer** ist semantisch unterschiedlich: Approval-Gate für Twin-Aktionen (Skill-Calls, Send-To-Twin, etc.), gespeichert in `mandates_json` pro Twin, drei Templates cautious/trusting/business. Kein Payment-Bezug, kein Cryptographic-Signing.

Beide Begriffe leben in unterschiedlichen Bedeutungsräumen (Twin-Verhaltens-Policy vs. Payment-Authorization-Contract). Sollte twin-lab in Phase 6+ Payment-Integration bekommen, ist explizite Disambiguierung nötig — z.B. „twin-lab Behavior-Mandate" vs. „AP2 Payment-Mandate", oder eines der beiden umbenannt. Bis dahin: keine Aktion, eigene Bedeutung etabliert.

Plus: **AITP** (Agent Interaction & Transaction Protocol, NEAR AI) ist ein weiterer parallel-Standard für Agent-to-Agent + Payment mit NEAR/EVM-Wallet-Capabilities. Awareness-Item, Phase-6+-Territorium wenn Blockchain-Bezahlebene aktiv (#32-orthogonal).

### Protokoll-Landscape (Stand Tag 22)

Vier etablierte Agentic-Standards, jeweils ein Layer:

| Layer | Standard | Twin-Lab-Position |
|---|---|---|
| Agent↔Tools | MCP (Anthropic) | ✅ Live in Phase 3.2 |
| Agent↔Agent | A2A (Google) | Backlog #36, Phase 4 |
| Agent↔User | AG-UI (CopilotKit) | Backlog #125, Phase 4+ |
| Agent↔Payment | AP2 (Google) | Phase 6+ |
| Agent↔Federation/Identity | ANP | Backlog #31 + #32, Phase 4/5+ |
| Agent↔Transaction (alt) | AITP (NEAR AI) | Awareness, Phase 6+ |

**Twin-Lab-Strategie:** Eigene Bridge + SSE bleibt Foundation für Twin-Lab-spezifische Pfade (Mandate-Layer, Owner-Recognition, Trust-Relationships, Reply-Detection). Standards werden als Adapter-Schichten obendrauf eingebunden — analog zur A2A-Strategie aus 2. Mai 2026: „zusätzlich, nicht statt".

### 19. Hermes Agent als Backend evaluieren — ENTSCHIEDEN
Strategische Option, die geklärt wurde: **Nein.** Hybrid-Strategie — eigenes TypeScript-Backend mit Hermes-Inspirationen (Profile-Mechanismus, FTS5 Session Search, agentskills.io-Format). Begründung in Architektur-Entscheidungen oben.


---

## Phase 2.5 — Konkrete nächste Sub-Schritte

Geordnete Liste für die kommenden Sessions. Jeder Sub-Schritt ist abgeschlossen testbar.

### 2.5.5 — Notification-System für Pending
**Größe:** M · **Zeitfenster:** 1-2 Sessions (~4-6h)

Heute: Pending nur sichtbar wenn Settings-Page offen.
- Browser-Notifications (Web Push API)
- Email-Notifications via resend.com (Konto vorhanden)
- Konfigurierbar pro Twin: welche Events triggern Notifications
- Vorbedingung: 2.5.4 (User-Auth, weil Notification-Routing pro User)

**Stufe:** 0 → 1 · **Spur:** UX-Reifung

## Phase 2.5 Total — Status

**Abgeschlossen:** 2.5.1, 2.5.2 (a-e), 2.5.3, 2.5.4 (inkl. .1/.1.1/.2/.3), 2.5.6.
**Verschoben:** 2.5.5 (Notifications) — bewusst, bis Schmerz sichtbar wird. Inbox-Badge plus drei Power-User vorm Browser reicht heute.
**Definition of Done für Phase 2.5 erreicht:** Externer User kann sich registrieren, eigenen Twin onboarden, mit dem Twin chatten, Pending approven, Twin verleihen. Multi-Tenant-SaaS funktional unter `app.twin.harwayexperience.com`.

Phase 2.5 als Ganzes ist damit faktisch abgeschlossen. 2.5.5 wird bei Bedarf nachgezogen, ist aber kein Blocker für Phase 3.

---

## Aus Phase 2 entstanden

### 1. Twin-Konversationen als Threads (Variante 2)
Eigene `twin_conversations`-Tabelle. Jede Nachricht referenziert eine `conversationId`. Ganze Threads werden bei Approve gerendert. UI-Möglichkeit für Conversation-View in Settings.
**Größe:** L · **Priorität:** should · **Aus:** Phase-2-Live-Test

### 2. Lokale Spiegelung des Bridge-Streams (Variante 3)
Alle Twin-Nachrichten persistent in der Twin-DB, nicht nur Audits. Bridge wird zum reinen Transport. Authoritative Konversations-Historie liegt lokal.
**Größe:** XL · **Priorität:** nice · **Aus:** Phase-2-Architektur-Diskussion

### 3. Mandate-Conditions-Auswertung — ✅ erledigt + live verifiziert (Tag 33 Bau, Tag 35 Live)
`requiresApproval`, `maxLength`, etc. wurden in `checkMandate()` ignoriert. **Diagnose Tag 33:** die zwei Conditions sind semantisch verschieden — `requiresApproval` ist **deklarativ/redundant** (das echte Approval-Gate ist `escalation: always_pending`, die Runtime routet darüber; kein Logikbau nötig), `maxLength` ist die **einzige echt tote** Condition (Output-Cap in Zeichen).

**Gebaut (Tag 33):** zentraler `TwinService.enforceMaxLength`-Helfer — **präventiv** (Längen-Hinweis als System-Instruktion in den Prompt) → **reaktiv** (max. 1 Retry mit verschärftem Hinweis) → **Truncate-Fallback** am Satz-/Wortende (` […]`). Loop-Cap fix, garantiert eine Antwort. Audit-Flag `lengthEnforced: retried|truncated` fürs Tuning. Gehookt an `chat()` (respond_to_chat, 4000) + `approveDefault()` (draft_linkedin_post, 2000). `requiresApproval`-Klarstellung in `mandates.yaml` + `checkMandate`-Kommentar.

**Verifikations-Stand:**
- ✅ `enforceMaxLength`-Logik **isoliert deterministisch bewiesen** (no-op · präventiv · 1-Retry · Truncate am Satz-/Wortende · Audit-Flag).
- ✅ **Owner-Direct-Pfad am Verhalten bestätigt** (lokaler Chat, Wegwerf-DB): owner-direct/`mandate_id=null` → maxLength greift bewusst NICHT, kein `lengthEnforced` — wie designt.
- ✅ **LIVE verifiziert (Tag 35, VM 187.124.7.94):** Nicht-Owner-`respond_to_chat`-Pfad (`escalation:auto`, über den deprecated `/chat`-Legacy-Alias gegen einen Test-Twin `@markus` — `LEGACY_HANDLE` ist fest `@markus`). **Zwei der drei Stufen live bewiesen:**
  - **Präventiv:** `maxLength:50`, 2 Calls → Modell blieb von sich aus ≤50 (43/47 Zeichen, `finishReason:stop`, **kein Flag — by design**).
  - **Retry:** `maxLength:20` + Langer-Absatz-Prompt → Erstantwort zu lang → 1 Retry → „Kurz halten." (12 Zeichen), **`output.lengthEnforced:"retried"` korrekt protokolliert**.
  - **Truncate:** **nicht live erzwungen** (erfordert, dass das Modell AUCH den Retry ignoriert — künstlich) → bleibt **isoliert im #3-Bau getestet**, bewusst so belassen.

**📌 Korrektur fürs Protokoll:** `lengthEnforced` (und `reply`) liegen unter **`audit.data.output.lengthEnforced`** bzw. **`.output.reply`** — NICHT top-level (`AuditService.complete()` legt den Payload als `entry.output` ab). Der ursprüngliche Test-Plan-Verifikationsbefehl las top-level → fälschlich immer `undefined`. **Kein Bug, Mess-Fehler.**

**Abdeckungs-Grenze (bekannte Lücke, beibehalten):** `enforceMaxLength` deckt **nur** den `respond_to_chat`-/default-Branch ab. **A2A wird NICHT längenbegrenzt** — weder Trusted-Auto (`handleTrustedBridgeMessage` → `runModel` direkt, `mandate_id=null`) noch Approve (`approveTwinResponse` → `runModel` direkt). Verwandt mit dem offenen Item „A2A-Empfangspfad respektiert `escalation` nicht".

**Größe:** ursprünglich M → real S · **Status:** ✅ DONE (Live-Beleg Tag 35)

### Optional: Enforcement-Telemetrie — „maxLength aktiv + präventiv eingehalten" sichtbar machen (Design-Beobachtung, kein Bug)

**Status:** OFFEN (notiert, später) | **Größe XS** | **Priorität:** nice

Beim #3-Live-Test (Tag 35) aufgefallen: Im Audit ist **„maxLength war aktiv, aber präventiv eingehalten"** nicht von **„kein maxLength gesetzt"** unterscheidbar — beide haben **kein** `lengthEnforced`-Flag (das Flag entsteht nur bei Retry/Truncate). Falls Enforcement-Telemetrie/Tuning gewünscht: bei aktivem `maxLength` immer ein `maxLengthApplied: true` (+ ggf. Original-Länge vor Kürzung) ins `output` schreiben. Kein Funktions-Bug — die Längen werden eingehalten; nur die Beobachtbarkeit fehlt.

### Design-Erkenntnis: maxLength gilt nur für Nicht-Owner-Chats (owner-direct ist unlimitiert)
**Bestätigt via Audit Tag 33.** `maxLength` (und Mandate-Checks generell) greifen **konzeptionell nur für Nicht-Owner-Chats** (`respond_to_chat` über `checkMandate`+Mandate). Der **Owner-Direct-Chat** (Owner mit dem eigenen Twin) läuft über `capability=owner-direct` / `mandate_id=null` (Owner-Bypass) und ist **bewusst unlimitiert** — der Owner soll keine gekappten Antworten von seinem eigenen Twin bekommen. Das ist die eigentliche Design-Klärung des Features (kein Bug): wer das maxLength-Verhalten testen will, muss den Nicht-Owner-Pfad treffen.

### QuickStart-Mandate-Default: respond_to_chat = always_pending — DIAGNOSTIZIERT, gegenstandslos für den Owner-Fall

**Status:** ✅ **GESCHLOSSEN — diagnostiziert, keine Änderung nötig (Tag 35).** Nicht „gefixt" (es wurde nichts geändert): das vermutete Problem ist für den realen Self-Hoster-Fall (= Owner) **gegenstandslos**. | war: should/klären | **Entscheidung (Markus):** nichts ändern.

**Diagnose (Tag 35, read-only):** Die „frischer Twin antwortet Nicht-Ownern nie"-Symptomatik kommt **NICHT** aus dem cautious-Template, sondern ist **strukturell**:
1. **Owner-Web-Chat antwortet immer sofort** — das Web-UI postet an `/twins/:handle/chat` (hinter `requireOwner`) → `requesterUserId` ist immer der Owner → **Owner-Bypass** (`twin-service.ts:437`) überspringt das Mandate ganz. Auf der VM gesehen.
2. **Untrusted A2A ist immer pending — HARTKODIERT** (`twin-service.ts:952`, `initialStatus: "pending"`): der A2A-Empfangspfad liest das Mandate-`escalation` gar nicht. → cautious↔trusting macht hier **keinen** Unterschied.
3. **Trusted A2A ist immer auto** (Trust-Bypass `handleTrustedBridgeMessage`), unabhängig vom Template.
4. **Es gibt heute keinen Nicht-Owner-Chat-Pfad:** das Web-UI ist komplett `requireOwner`-gated. „Fremde chatten mit meinem Twin" existiert nicht (wäre ein neues Feature). Der einzige nicht-bypassende `respond_to_chat`-Pfad ist der **deprecated `/chat`-Legacy-Alias**, den das UI nicht nutzt.

**Folge:** Ein Wechsel cautious→trusting würde am Chat-/A2A-Ersteindruck **fast nichts** ändern (nur `delegate_research`/`share_profile`-Autonomie + der tote Legacy-`/chat`). Der normale Self-Hoster (= Owner) bekommt **sofort** Antworten; der cautious-Default schadet der Erste-Erfahrung **nicht**. War ein vermuteter, kein realer Blocker. Die zwei echten (kleineren) Fäden, die die Diagnose freilegte, sind als eigene Items unten notiert.

### Tote Enum-/Pfad-Reste rund um Mandate-Escalation (Cleanup) — aus always_pending-Diagnose Tag 35

**Status:** OFFEN (notiert, nicht jetzt bauen) | **Größe XS–S** | **Priorität:** nice (Hygiene)

**Status Tag 38 (read-only verifiziert):** (a) `above_threshold` ENTFERNT (war nirgends ausgewertet, 0 DB-Rows, strukturell unerzeugbar). (b) `/chat`-Legacy-Alias bleibt — KEIN Einzelrest, sondern eine von 7 Routen in `registerLegacyAliases()`; Geschwister-Alias `/stream` wird noch live genutzt (`stream/page.tsx:22` bare `EventSource(RUNTIME_URL/stream)`). Ganzer Block erst entfernbar, wenn `stream/page.tsx` auf `/twins/<handle>/stream` migriert ist → dann `registerLegacyAliases` komplett raus als EINE Aktion (verschmilzt mit BACKLOG-Legacy-Alias-Cluster). (c) `requiresApprovalIfMatches` bleibt — KEIN verwaister Wert, sondern Teil des Conditions-Clusters (mit `requiresApproval`/`maxLength`, service.ts:70-76), Platzhalter mit Inline-Zeiger auf Backlog #3 (Content-Matching geplant, nie verdrahtet). Der Beispiel-Wert dokumentiert die Absicht — gehört unter ein gemeinsames „Conditions-Auswertung (#3) — definiert, nicht verdrahtet"-Item, NICHT einzeln löschen.

Die `always_pending`-Diagnose (Tag 35) legte mehrere tote/inkonsistente Reste frei — Cleanup-Kandidaten, kein Funktionsfehler:
- **`above_threshold`-Escalation:** im Enum (`packages/shared` `z.enum(["auto","always_pending","above_threshold"])`, `mandates/service.ts:20`), aber **nirgends ausgewertet** und in keinem Template verwendet → totes Enum.
- **deprecated `/chat`-Legacy-Alias** (`server.ts:510`): einziger nicht-owner-bypassender `respond_to_chat`-Pfad, vom Web-UI nicht genutzt → Kandidat zum Entfernen (oder bewusst als Test-Hook dokumentieren).
- **`requiresApprovalIfMatches`** (trusting-Template, `mandate-templates.ts:95`): definiert, aber **nicht ausgewertet** (gleicher Cluster wie #3 / `requiresApproval`/`maxLength`-Conditions). Entweder auswerten (Inhalts-Matching) oder als „noch nicht aktiv" markieren.

### isTrusted ohne verhaltenswirksamen Aufrufer seit Phase 4.3 Schritt 5 (Cleanup)

**Status:** OFFEN (notiert) | **Größe XS** | **Priorität:** nice (Hygiene), kein Verhalten betroffen

`canAutoRespond` (Phase 4.3 Schritt 5, `1378a71`) hat im Dispatch (`twin-service.ts:1035`) den row-basierten `isTrusted`-Check abgelöst. `TrustRepo.isTrusted` hat seitdem **keinen verhaltenswirksamen Aufrufer** mehr (bewusst behalten — das Konzept „steht in der Vertraute-Liste" bleibt gültig; tsc grün). Entscheiden: entweder von der UI/list-Semantik aktiv nutzen (z.B. „in Liste"-Anzeige) ODER als toten Code entfernen. Niedrige Prio.

### A2A-Empfangspfad respektiert Mandate-`escalation` nicht (untrusted = hartkodiert pending) — ENTSCHIEDEN/GESCHLOSSEN

**Status Tag 38: ENTSCHIEDEN — geschlossen (escalation auf dem A2A-Empfangspfad wird bewusst NICHT verdrahtet).** Begründung: Die Lücke, die dieses Item füllen wollte (binär trusted→auto / untrusted→pending, nichts dazwischen), ist durch Phase 4.3 Schritt 5 anders gefüllt — `canAutoRespond` ({vertraut, eng}) steuert die A2A-Autonomie jetzt abgestuft. Damit sind die zwei denkbaren Steuerungs-Achsen klar: **Familiarity ist partner-bezogen** („wie nah ist mir dieses Gegenüber?"), **Mandate-escalation wäre capability-bezogen** („wie riskant ist diese Aktion?"). 🔴 escalation trägt auf dem A2A-Empfangspfad heute NICHTS bei, weil es nur EINE eingehende A2A-Capability gibt (`respond_to_twin_message`) — eine capability-Achse, die genau einen Wert differenziert, ist kein Gewinn, sondern ein zweiter globaler An/Aus-Schalter neben Familiarity. Zwei Achsen für dieselbe binäre Entscheidung (auto vs. pending) erzeugen nur Verknüpfungs-Verwirrung (UND/ODER? wer gewinnt bei Konflikt @florian=vertraut aber respond_to_twin_message=always_pending?). Entscheidung: **eine Steuerungs-Achse — Familiarity** (bildet das reale Bedürfnis feiner ab, vier Stufen statt zwei). Das ignorierte `escalation`-Lesen auf diesem Pfad ist damit eine bewusste Designentscheidung, KEIN Bug. 🔵 **Wiederaufnahme-Trigger:** wenn es mehrere A2A-Capabilities mit UNTERSCHIEDLICHEM Risiko gibt (über `respond_to_twin_message` hinaus — z.B. „im Namen des Owners zusagen", „Termine vereinbaren"). Dann wird die capability-bezogene Achse wertvoll (z.B. „antworten=auto, zusagen=immer pending" unabhängig vom Partner). Verortung: frühestens Phase-4-Kontext (Föderation/Multi-Channel = Monate, nice), das auslösende Szenario (erweitertes A2A-Aktions-Vokabular) ist in keiner Phase-4-Unterphase (4.1–4.5) konkret geplant — also noch dahinter. Bis dahin: untrusted/fremd = pending bleibt die Sicherheitslinie, abgestuft durch Familiarity.

**Status (Original, Tag 35):** OFFEN — **bewusste Produkt-/Sicherheitsfrage, kein Bau jetzt** | **Größe M** | **Priorität:** klären, falls A2A-Auto-Antworten je gewünscht | aus Diagnose Tag 35 (Option D-i)

**Befund:** `receiveBridgeMessage` setzt für untrusted Sender `initialStatus: "pending"` **hartkodiert** (`twin-service.ts:952`) und liest das `escalation`-Feld von `respond_to_twin_message` **nicht**. Heißt: das trusting-Template (`respond_to_twin_message: auto`) hat auf dem A2A-**Empfangs**pfad **keine Wirkung** — Auto-Reply auf eingehende A2A geht heute **ausschließlich** über die Trust-Liste (`handleTrustedBridgeMessage`).

**Die eigentliche Frage:** Soll der A2A-Empfangspfad das Mandate-`escalation` **respektieren** (dann wirkt ein „auto"-Template wirklich, und ein Twin könnte untrusted-Twins autonom antworten), oder bleibt **untrusted = immer pending** die bewusste Sicherheitslinie (Auto nur für explizit getrustete Handles)? Das ist **die** Sicherheits-/Produktentscheidung hinter „sollen Twins einander spontan antworten". **Bewusst offen** — erst entscheiden, dann ggf. bauen. Verwandt mit „Auto-Reply-Mandate für vertraute Twins" (unten) und #39 (Classifier-Preflight).

### 4. Auto-Reply-Mandate für vertraute Twins
Mandate-Condition wie "Auto-Reply, wenn Absender = vertrauter Handle UND Inhalt enthält keine Sensitiv-Wörter". Aktuell gehen alle eingehenden Nachrichten in Pending.
**Größe:** M · **Priorität:** should · **Aus:** Phase-2-Spec-Diskussion

### 5. Reject-Notification an Absender
Aktuell: Reject = Stille. Optional könnte der andere Twin eine kurze Notification bekommen ("Markus hat deine Nachricht nicht beantwortet"). Phase-2-Spec hatte das bewusst weggelassen.
**Größe:** S · **Priorität:** nice · **Aus:** Phase-2-Spec
**Stufe:** 0 → 1 · **Spur:** UX-Reifung

### 6. Bridge-Catch-up beim Reconnect
Aktuell: Reconnect verlässt sich darauf, dass die Bridge alle nicht-gelieferten Nachrichten beim SSE-Connect nachschickt. Falls die Bridge das nicht macht (z.B. nach Bridge-Crash), bleiben Nachrichten ungesehen bis zum nächsten Twin-Boot. Idempotenz fängt das ab, aber sauberer wäre ein eigener `getInbox()`-Call beim Reconnect.
**Größe:** S · **Priorität:** should · **Aus:** Briefing #2 Limitation

### 7. Bridge im pnpm-dev-Verbund
`pnpm dev` startet aktuell auch die Bridge mit, die dann mit der externen Bridge auf 5100 kollidiert (EADDRINUSE). Saubere Lösung: Bridge aus dem Root-Verbund entfernen, weil sie konzeptionell ein anderer Prozess ist.
**Größe:** S · **Priorität:** should · **Aus:** Phase-2-Live-Test

### 8. Replaced-Conflict-Recovery
Wenn ein zweiter Markus-Twin sich registriert, schließt der erste seine Connection ohne Reconnect (sonst Ping-Pong). Aber: Es gibt kein Auto-Recovery, wenn der Konflikt-Twin verschwindet. Manueller Reconnect-Knopf in Settings als Lösung.
**Größe:** S · **Priorität:** nice · **Aus:** Briefing #2 Limitation

### 9. Persona-Versionierung
Aktuell wird die Persona bei jedem Boot überschrieben. Wenn du sie iterierst, verlierst du die Historie. Versioniert speichern, mit Diff-View.
**Größe:** M · **Priorität:** nice · **Aus:** allgemeine Beobachtung

### 10. UI-Bearbeitung von Persona/Mandates
In Phase 1 und 2 explizit ausgeschlossen — Files in `docs/` sind die Source of Truth. Phase 2.5.3 (Onboarding-Wizard) hat den Initial-Setup gelöst, aber **nicht** die spätere Bearbeitung. Twin-User können heute ihre Persona/Mandates nur durch Re-Bootstrap oder direkte DB-Edits ändern.
**Größe:** L · **Priorität:** should · **Aus:** Phase-1-Scope-Disziplin
**Stufe:** 0 → 2 · **Spur:** UX-Reifung

### 11. Persona-Klarstellung: 1. Person vs. Stellvertreter-Sprech
Twin spricht aktuell teilweise in dritter Person über Markus ("checke es bei Markus"). Klären, ob das gewünscht ist (zeigt klar: Twin ist nicht Markus selbst) oder ob er als "ich" konsistent für Markus sprechen soll. Verknüpft mit #14 (Owner-Recognition) — Stellvertreter-Sprech ist im A2A-Modus richtig, im Web-UI-Owner-Modus eher nicht. **Entblockt (Owner-Recognition gebaut)** — technische Basis da (owner-Web vs A2A-Kontext); offen ist die Persona-Verhaltens-Entscheidung + Umsetzung. Jetzt entscheidbar.
**Größe:** S · **Priorität:** should · **Aus:** Phase-2-Live-Test

---

## Aus Phase 2.5 entstanden

### 13. metadata_json in twin_profiles ergänzen
Aktuell hardcoded `{}` im Boot — Persona-Metadata (Verbindungen, Tags, etc.) hat keine DB-Spalte. Migration 005 für `metadata_json TEXT`-Spalte. Genutzt u.a. für Beziehungs-Mapping ("Florian ist Co-Founder von Markus").
**Größe:** S · **Priorität:** should · **Aus:** Sub-Schritt 2c Caveat

### 17. Stream-Page auf Multi-Twin migrieren
`/stream` zeigt aktuell @markus via Legacy-Alias. Neue Route `/stream/[handle]/page.tsx` analog zur Chat-Route. Backend-Routes `/twins/:handle/stream` existieren bereits.
**Größe:** S · **Priorität:** should · **Aus:** Sub-Schritt 2d Caveat #2
**Stufe:** 0 → 1 · **Spur:** UX-Reifung

### 18. @-Char in URLs decodieren bei Display-Output
Chat-Header zeigt `%40florian` statt `@florian` (URL-encodierter `@`). Backend-Routes akzeptieren beides, aber UI-Display sollte decoded sein. Einmal `decodeURIComponent()` an den richtigen Stellen.
**Größe:** S · **Priorität:** nice · **Aus:** Sub-Schritt 2d Live-Test, in 2.5.3 erneut sichtbar (Chat-Header zeigt "%40heiko")

### 33. Mandate-basierte Approval-Logik auch im Web-UI
Heute: Web-UI-Chat überspringt Approval-Flow für Markus, aber blockt für Heiko (cautious). A2A-Eingang nutzt Approval. Konzeptionell unklar: was, wenn Markus im Web-UI eine sensitive Antwort generieren lässt, die er sich nochmal anschauen will? Vorschlag: Mandates differenzieren `requires_approval` per Channel. RESPOND_TO_CHAT könnte für Owner-Chats `false`, für externe `true` sein. Verknüpft mit #14 (Owner-Recognition). **Entblockt + teil-adressiert:** Owner-vs-Extern via `ownerBypass` faktisch da (hardcoded über `isOwner`); offen ist der konfigurierbare Per-Channel-Teil (`requires_approval` pro Channel, Conditions-Auswertung fehlt).
**Größe:** M · **Priorität:** should · **Aus:** Live-Test 2.5.2e, in 2.5.3 verstärkt sichtbar
**Stufe:** 0 → 1 · **Spur:** UX-Reifung

### 34. Master-Key-Rotation CLI
Heute: bei Verdacht auf Kompromittierung des Master-Keys oder regulärer Rotation muss manuell entschlüsselt und neu verschlüsselt werden. Sauber: CLI-Tool `pnpm key:rotate` das den alten Master-Key liest, alle `apiKeyEncrypted` entschlüsselt, mit neuem Key verschlüsselt, in DB schreibt. Out of scope für 2.5.2e.
**Größe:** S · **Priorität:** nice · **Aus:** 2.5.2e Caveat

### 35. Provider-aware API-Key-Maskierung
Heute: `maskApiKey` zeigt `sk-a…IgAA` für Anthropic-Keys (sk-ant-…) — Provider-Präfix wird abgeschnitten. Provider-Erkennung im Mask: `sk-ant-…IgAA` für Anthropic, `sk-…XYZ` für OpenAI, etc. Schöner für Debugging, leakt minimal mehr Bits. Konsistenz mit Bridge-Token-Mask überprüfen.
**Größe:** S · **Priorität:** nice · **Aus:** 2.5.2e Caveat

### 38. Approval-Wartemeldung als System-Antwort statt LLM-Improvisation — NEU aus 2.5.3
Heute: wenn ein Twin im Approval-Modus ist, generiert er trotzdem eine LLM-improvisierte Wartemeldung. Heiko hat geantwortet "Diese Anfrage habe ich an Markus zur Freigabe weitergeleitet" — falsch, weil Markus nicht sein Owner ist und der Twin den Namen aus der Beziehungs-Liste improvisiert hat.

Fix: Approval-Wartemeldung wird NICHT vom LLM generiert, sondern ist ein System-Festtext wie "Diese Anfrage liegt zur Freigabe — du erhältst die Antwort, sobald sie freigegeben ist." Kein Owner-Name, kein UI-Verweis (Settings-Tab ist unsichtbar für Nicht-Owner).

UI-mässig sollte die System-Antwort visuell anders dargestellt werden als eine echte Twin-Antwort — z.B. als graue Info-Box statt Twin-Sprechblase. Polish, nicht Architektur.

Vorteile: eliminiert Improvisations-Risiko, schneller (kein LLM-Call), spart Kosten, klares Mental-Model für den Chat-Partner.
**Status Tag 39:** Entblockt + Runtime-Teil de facto erledigt: Pending-Pfad gibt `message:null` zurück, kein Modell-Call → die LLM-Improvisation des Original-Bugs (Heiko-Twin „an Markus weitergeleitet") ist strukturell weg (`twin-service.ts` isPending-Pfad). OFFENER REST-SCOPE (klein, MUST): nur noch der UI-Festtext — graue Info-Box mit festem Wartetext statt Twin-Sprechblase im Web (heute nur Pending-Badges in `TopNav.tsx`, kein Festtext). = scharf umrissenes kleines Frontend-Item.
**Aktualisierung nach Diagnose Tag 39:** UI-Rest (graue Info-Box) im jetzigen Web gegenstandslos — kein menschlich-sichtbarer Pending-Wait-Auslöser (Owner bypasst; MCP-Tool-Pending bereits sauber gerendert; kein External-/Public-Web-Chat). Wartebox wird erst mit External-Web-Chat-Surface relevant → mit Public-Mode #29/#30 zusammen bauen. Priorität MUST→should (Original-Bug behoben, UI-Rest gating-abhängig).
**Größe:** S · **Priorität:** should · **Aus:** 2.5.3 Heiko-Live-Test
**Stufe:** 0 → 1 · **Spur:** UX-Reifung

### 39. Cautious-Mode mit Klassifikator-Vorlauf — Phase 3 — NEU aus 2.5.3
Heute: cautious-Template hat `requires_approval=true` für RESPOND_TO_CHAT. Heißt: ALLE Chat-Anfragen gehen durch Approval, auch simple Smalltalk- oder Identitäts-Fragen wie "Wer bist du?". Das ist UX-mässig falsch — Selbstbeschreibung sollte ohne Approval beantwortbar sein.

Lösung: bevor der Twin antwortet, ein billiger 50-Token-Klassifikator-Call:
- A) Selbstbeschreibung/Begrüßung/Smalltalk → ohne Approval
- B) Inhaltliche Anfrage, Vereinbarung, Empfehlung → Approval-Pfad
- C) Sonstiges/unklar → Approval-Pfad (sicherer Default)

Vorteile: robust gegen Formulierungs-Varianten, lernfähig, billig (~$0.0005 pro Klassifikator).

Nachteile: zusätzlicher LLM-Call vor jeder Antwort, mehr Latenz (~300-500ms), zusätzliche Komplexität.

Konzeptionell ist das ein Skill-System-Feature (Capability-Layer entscheidet, ob Skill ohne Approval ausführbar ist). Deshalb auf Phase 3 verschoben, nicht in 2.5.x.
**Größe:** L · **Priorität:** should · **Aus:** 2.5.3 Heiko-Live-Test

## Aus Phase 2.5.4.1-3 entstanden

### 47. Reply-Marker bei Approval-Antworten manchmal fehlend
Conversation-View zeigt Reply-Marker (`↩ reply`) nicht zuverlässig bei allen Approval-Antworten — z.B. die „Wieder ein Test"-Antwort um 13:45 in Florian's View ohne Marker, obwohl konzeptionell Reply auf vorherige Test-Message. Hypothese: Backend setzt `inReplyTo` korrekt, aber Frontend-Render verschluckt es bei bestimmten Pfaden. Vermutlich Edge-Case in `mergeAuditIntoBridgeMessages` oder in der Render-Conditional, die zwischen `reply-received` und `respond_to_twin_message` unterscheidet.
**Größe:** S · **Priorität:** nice · **Aus:** 2.5.4.3 Live-Test
**Stufe:** 0 → 1 · **Spur:** UX-Reifung

### 48. Conversations-List Bridge-Roundtrip pro Partner
`fetchAllBridgeConversations` ruft `getConversationMessages` für jeden bekannten Bridge-Twin in Schleife. Bei vielen Twins teuer. Lösung: dedizierter Bridge-Endpoint `/conversations` mit Server-Aggregation, der eine Liste aller Partner mit `lastMessageAt` zurückgibt, statt N Roundtrips.
**Größe:** M · **Priorität:** nice · **Aus:** 2.5.4.3 Caveat #1

### 49. Mark-Read-Delay konfigurierbar
Aktuell 700ms hartcodiert in `chat/[handle]/page.tsx` als `MARK_READ_DELAY_MS`-Konstante. Falls UX-Feedback zu langsam/schnell kommt, oder unterschiedliche Geschwindigkeiten je nach Conversation-Typ (Direct-Chat vs. A2A) gewollt, sollte das in eine Twin-Config oder als Settings-Option ausziehbar sein.
**Größe:** S · **Priorität:** nice · **Aus:** 2.5.4.3 Caveat #3

### 50. Sidebar-Polling für Reconnect-Robustheit
SSE-Reconnect der Chat-Page funktioniert automatisch, aber wenn Connection lange weg ist und Reply-Events durchrauschen, wird die Sidebar erst beim nächsten manuellen Reload oder neuem Reply-Event aktualisiert. A2A-View hat 5s-Polling als Backstop, Direct-Chat und Sidebar nicht. Lösung: globaler Reconnect-Trigger der `loadConversations` neu aufruft, oder Sidebar-Polling alle 30s als Fallback.
**Größe:** S · **Priorität:** nice · **Aus:** 2.5.4.2 Caveat

### 51. DisplayName-Cache mit kurzer TTL
Bei jedem GET `/conversations` macht der Server einen Bridge-Roundtrip pro Partner für DisplayName-Lookup. Bei Bridge-Down: `partnerDisplayName=null`, Fallback auf Handle. Cache wäre einfach machbar — z.B. In-Memory-Map mit 60s-TTL pro Handle.
**Größe:** S · **Priorität:** nice · **Aus:** 2.5.4.2 Caveat

### 52. read_at im Audit-Log-UI sichtbar machen
Mark-Read setzt `read_at`-Spalte, aber Audit-Log-UI im Inbox zeigt das heute nicht an. Optional: kleiner Indikator in der Audit-Log-Tabelle, z.B. „gelesen 5 Min nach Empfang" als Spalte oder Tooltip. Polish, nicht Architektur.
**Größe:** S · **Priorität:** nice · **Aus:** 2.5.4.2 Caveat
**Stufe:** 0 → 1 · **Spur:** UX-Reifung

### 53. Conversations löschen/archivieren — NEU 3. Mai 2026 nachmittags
Aktuell: Konversationen in der Sidebar bleiben dauerhaft sichtbar. Bei vielen A2A-Partnern oder nach abgeschlossenen Projekten unübersichtlich. Plus: nach Test-Sessions sammeln sich Test-Konversationen, die man weghaben will. Implementation: `archived_at` und `deleted_at`-Spalten in einem `conversations`-Tabelle ODER pro Audit-Eintrag flaggen. UI: Hover-Action oder Rechtsklick-Menü mit „archivieren" und „löschen". Plus: archivierte Konversationen in separater „Archiv"-Sicht wieder einsehbar (löschen ist endgültig). Konzeptionelle Frage: was passiert mit Bridge-Messages, wenn beide Seiten archivieren? Bridge bleibt unverändert, jeder Twin entscheidet lokal über Sichtbarkeit.
**Größe:** M · **Priorität:** should · **Aus:** UX-Diskussion 3. Mai
**Stufe:** 0 → 1 · **Spur:** UX-Reifung

### 54. Header-Höhe als CSS-Variable statt hartcodiert — NEU 3. Mai 2026 nachmittags
Heute: `h-[calc(100vh-65px)]` in ChatLayout setzt voraus, dass AppHeader exakt 65px hoch ist. Wenn AppHeader-Style sich ändert (Padding, Button-Höhen), muss die Konstante mitziehen. Sauberer: CSS-Variable `--app-header-height: 65px` im `:root` setzen, sowohl AppHeader als auch ChatLayout nutzen. Plus: bei Mobile-Layout-Anpassungen (Backlog #56) könnte die Höhe variieren — CSS-Variable macht das responsive einfach.
**Größe:** S · **Priorität:** nice · **Aus:** UX-Iteration 3. Mai (Layout-Fix)

### 55. Mobile-Layout für Chat-Page (Sidebar-Toggle/Collapse) — NEU 3. Mai 2026 nachmittags
Heute: Chat-Layout fest auf Desktop-Breite optimiert. Sidebar w-72 (288px) belegt auf Mobile fast die halbe Bildschirmbreite, Conversation wird sehr eng. Plus: Top-Nav mit Brand + 3 Tabs + Switcher + Avatar nebeneinander bricht bei <768px. Lösung: Sidebar als Off-Canvas-Drawer mit Toggle-Button, Top-Nav mit Hamburger-Menü oder Tabs als Bottom-Nav. Pattern wie WhatsApp-Web oder Slack-Mobile. Vorbedingung: Visual-Design-Iteration (#58). *(Nummern-Fix Tag 31: hier stand fälschlich „#59" — gemeint ist das Visual-Design-Item #58. Die Nummer #59 ist vergeben für „Bridge-Auth `/messages/:id/sender` securen" — erledigt, siehe Lessons-Sektion, Commit `8783d97`.)*
**Größe:** L · **Priorität:** should · **Aus:** UX-Iteration 3. Mai (Layout-Fix Caveat)
**Stufe:** 0 → 1 · **Spur:** UX-Reifung

### 56. Textarea Auto-Grow mit Cap im Conversation-Input — NEU 3. Mai 2026 nachmittags
Heute: Textarea im Conversation-Input ist fix h-20 (80px), bei längeren Eingaben scrollt sie intern. Bei mehrzeiligen Antworten umständlich, weil User nicht den ganzen Text sieht. Lösung: Auto-Grow mit Cap — Textarea wächst mit Inhalt bis 3-4 Zeilen, dann scrollt sie intern weiter. Container-Höhe muss flexibel sein, oder Textarea overlay'd den Verlauf-Bereich. Pattern wie Slack/Discord — Input wächst nach oben, Verlauf rutscht entsprechend hoch.
**Größe:** S · **Priorität:** nice · **Aus:** UX-Iteration 3. Mai (Layout-Fix Caveat)

### 57. 100dvh statt 100vh für Mobile-Browser-Kompatibilität — NEU 3. Mai 2026 nachmittags
Heute: ChatLayout nutzt `h-[calc(100vh-65px)]`. Auf Safari iOS (und älteren Mobile-Browsern) berücksichtigt 100vh die dynamische Toolbar nicht — Conversation-Input könnte unter den Address-Bar gequetscht werden. Lösung: `100dvh` (dynamic viewport height) — wird von modernen Browsern korrekt berechnet. Backwards-Compatibility: `min-h-[100vh] min-h-[100dvh]` als Fallback. Vermutlich gehört zur Mobile-Layout-Iteration (#56).
**Größe:** S · **Priorität:** nice · **Aus:** UX-Iteration 3. Mai (Layout-Fix Caveat)
**Stufe:** 0 → 1 · **Spur:** UX-Reifung

### Nolmi-Visual-Design-Iteration (vor Public-Polish)

*(Triage 2c: twin-lab-Branding-Bezug raus; frische Nolmi-Visual-Welle, low/launch-nah.)*
Aktuell: monospace, schwarz-weiß-grün, sehr functional. Konzeptionell stimmig zum „Lab"-Charakter, aber spätestens bei Multi-Tenant-Public-Launch (nach 2.5.6) wird die Frage akut: wie soll twin-lab aussehen für externe User? Eigene Brand-Identity entwickeln (Logo, Farben, Typografie-Hierarchie), Header-Komponente neu konzipieren, Page-Templates strukturieren, Conversation-Bubble-Designs polishen. Vorbereitung: Mood-Boards, Inspiration sammeln. Empfohlen mit Florian zusammen (Designer). Trigger: vor Phase 2.5.6 oder nach.
**Größe:** XL · **Priorität:** should · **Aus:** UX-Diskussion 3. Mai (Option-3-Reizfrage)
**Stufe:** 0 → 2 · **Spur:** UX-Reifung

### 66. DB-Backup-Strategie für Production-DBs — NEU 4. Mai
Drei DBs auf VPS, alle bisher ohne Backup: `twin-lab-bridge-data`, `twin-lab-web-data` (Runtime), und implizit auch `traefik`-Konfig. Bei Volume-Verlust sind drei User-Accounts plus Twin-Profile (Persona, Mandates, Encryption-Keys, API-Keys verschlüsselt) weg.

Pattern-Optionen:
- Cron-Job auf VPS, sqlite-`.backup`-Befehl täglich nach `/var/backups/twin-lab/`, Rotation 7 Tage
- Plus optional rsync/rclone zu externem Storage (Hetzner Storage Box, Backblaze B2)
- Alternativ: Volume-Snapshots via Hetzner-API, wenn VPS dort liegt

Master-Key sollte separat gesichert sein (Passwort-Manager, schon erledigt) — ohne Master-Key sind die API-Keys aus Backup nicht entschlüsselbar.

Kein Notfall solange nichts kaputt ist. Wird wichtig sobald mehr als drei Power-User dranhängen.
**Größe:** M · **Priorität:** should · **Aus:** 2.5.6 Production-Reflexion

### README für `docker/nolmi/` (Production-Stack-Doku am Ort)

*(Triage 2c: Verzeichnis heißt jetzt `docker/nolmi/`; low.)*
Heute: README im Repo unter `docker/twin-lab-web/README.md` beschreibt Build-Sequenz und ENV-Variablen. Ergänzen um:
- Operations-Runbook: wie Restart, wie Logs lesen, wie .env editieren ohne Container zu stoppen
- Troubleshooting-Sektion: Hairpin-NAT-Symptom (Connect-Timeout zu Bridge-Public-URL), Cookie-Domain-Symptom (Login-Loop), NEXT_PUBLIC-Symptom (hartcodierte URLs im Bundle)
- Disaster-Recovery: was wenn Volume verloren, was wenn Master-Key verloren, was wenn TLS-Zertifikat abgelaufen
- Backup/Restore-Anleitung (verknüpft mit #66)

**Größe:** S · **Priorität:** should · **Aus:** 2.5.6 Reflexion

## Aus Phase 3.1 entstanden

### 73. Inline-Twin-Befehle aus Owner-Chat heraus
Aus „Mit meinem Twin"-Konversation soll User natural-language-Befehle geben können wie „Frage @florian wann er morgen Zeit hat" oder „Schick @heiko die Workshop-Details". Markus-Twin erkennt Intent, formuliert Nachricht im Markus-Stil, sendet via Bridge. Antwort kommt in der entsprechenden A2A-Konversation an. Optional: Round-trip-Update zurück in Owner-Konversation („Florian sagt: 14 Uhr passt").

Drei Schichten nötig:
- **Intent-Detection** — LLM-basierter Klassifikator („ist das ein send_to_twin-Intent?"), Regex auf @-Patterns zu fragil
- **Tool-Use-Pattern** — Twin nutzt Skill `send_to_twin` als Tool-Call, formuliert Recipient + Content, System schickt
- **Round-trip-Threading** — Antwort taucht in A2A-Konversation auf (haben wir), optional in Owner-Konversation als Update (neu)

Approval-Strategie: **Variante C — Trust-basiert.** Vertraute Twins direkt (existierende Trust-Layer aus 2.5.4.1 wiederverwenden, nicht duplizieren), Fremde mit Approval. Skill-Manifest-Feld `requires_approval` muss Trust-aware werden — entweder Logik im Skill, oder Skill ruft existierende `checkTrust()`-Funktion auf.

Vorbedingung: 3.1 Skill-System ✅ + 3.2 Tool-Use über MCP-Pattern. Implementation als Action-Skill `send_to_twin` mit Manifest, Mandate-gated. Kalenderzeit: 6-10 Wochen ab heute.

**Größe:** L · **Priorität:** should · **Aus:** Markus-Idee 6. Mai während 3.1.B-Implementation
**Stufe:** 0 → 1 · **Spur:** UX-Reifung

### 75. Skills lokal vs. Production-Sync
Skills leben heute nur in der lokalen DB (`data/twin.db`). Markus-Twin auf Production hat keine Skills, weil Skill-Files via CLI lokal in lokale DB importiert wurden — Production-DB ist unberührt.

Drei Sync-Strategien denkbar:
- **Manuell pro Production-Deploy** — Skill-Files committen (gitignored entfernen), CLI auf Production laufen lassen. Einfach, aber: Skills im Repo = öffentlich
- **Skill-Sync-Endpoint** — Backend-Route `POST /twins/:handle/skills/sync` mit Manifest+Markdown-Body, importiert in DB. Wäre auch UI-fähig (3.1-Phase-Ende oder später, war geplant) — Edit/Create via UI baut auf demselben Endpoint
- **Eigener Skill-Repo pro User** — User hat einen privaten Repo nur für Skills, Production-Twin liest beim Boot (oder via Webhook-Refresh). Komplexer, aber: Multi-Device-fähig, Skills versioniert

Vote heute: **2.** Macht Skills UI-fähig und löst gleichzeitig das Sync-Problem. Gehört eigentlich zur „UI-Editierbarkeit"-Phase, die bisher als Phase 3-Ende oder später angesetzt war. Konkret: Endpoint, dann optional UI-Editor in Phase 4.

**Größe:** M · **Priorität:** should · **Aus:** 3.1.F Pilot-Skill war lokal, Frage „und Production?" ungeklärt

### 76. Skill-Edit / Delete via UI
Heute (3.1.E): UI ist read-only mit Aktiv-Toggle. Skills werden via CLI angelegt und überschrieben (`--force`). Es gibt keinen UI-Pfad zum Editieren oder Löschen.

Was fehlt:
- **Edit:** Skill-Detail-View mit Markdown-Editor für SKILL.md, Form-Fields für Manifest. Auf Save: PATCH gegen `/twins/:handle/skills/:skillId`. Vorbedingung: Sync-Endpoint aus #75
- **Delete:** Confirm-Dialog, dann DELETE gegen `/twins/:handle/skills/:skillId`. Optional: „Soft-Delete" via `is_active=false` (haben wir schon im Toggle), Hard-Delete als zweite Stufe

Verknüpft mit #10 (UI-Bearbeitung von Persona/Mandates). Konsistente UX: alles, was heute in Files lebt, soll später in der UI editierbar sein.

**Größe:** L · **Priorität:** should · **Aus:** 3.1.E expliziter Scope-Ausschluss
**Stufe:** 0 → 2 · **Spur:** UX-Reifung

### 79. Phase-1-`persona`-Tabelle ist Altlast in DB
Bei der #78-Diagnose gesichtet: Tabelle `persona` mit `id INTEGER PRIMARY KEY CHECK (id = 1)` und `data TEXT` enthält noch den ursprünglichen Phase-1-Snapshot (single-twin, Pre-2.5.2). Wird vom Code seit Phase 2.5.2b nicht mehr genutzt — Persona kommt jetzt aus `twin_profiles.persona_md`. Tote Tabelle, harmlos, aber Confound bei DB-Inspect (man fragt sich „warum ist Workshop-Inhalt da drin?").

Migration 009 könnte die Tabelle droppen. Triviale `DROP TABLE persona;`. Nice-to-have, kein Blocker.

**Größe:** XS · **Priorität:** nice · **Aus:** Tag-8 #78-Diagnose

### 83. UI-Reply-Verkettung verhindert Twin-Trigger bei Folge-Fragen
Beim Tag-8-Production-Smoke-Test fiel auf: Florians Twin antwortet nicht autonom auf Markus' Bridge-Messages — obwohl Trust beidseitig gesetzt ist und der Mandate-Layer Trusted-Bypass für `respond_to_twin_message` korrekt definiert hat. Initial-Hypothese „Auto-Respond gebrochen seit 4. Mai" hat sich als falsch erwiesen.

**Tatsächliche Diagnose (Tag 9 Vormittag):**

Architektur funktioniert wie spezifiziert. Der Test `pnpm --filter @twin-lab/runtime trust:test` läuft erfolgreich durch alle drei Pfade (External-Pending, Trusted-Bypass, External-Pending nach Trust-Removal). Plus Browser-Test mit komplett leerer Konversation: Markus sendet „Hey Florian, wann hast du morgen Zeit?" → Florians Twin antwortet in 3 Sekunden via `trusted-bypass`. Audits korrekt: `owner-direct-send` → `trusted-bypass` → `reply-received`.

**Was den Twin-Trigger blockiert:** Frontend setzt bei jedem Send in einer existierenden Konversation `in_reply_to` auf die letzte Bridge-Message. Reply-Detection im Backend (`twin-service.ts:327-378`) prüft ob die referenzierte Original-Message von uns gesendet wurde — wenn ja: `reply-received` Audit, kein neuer Twin-Trigger. Heißt: nach der ersten Florian-Twin-Antwort hängen sich alle weiteren Markus-Sends an diese Antwort, Reply-Detection greift, Twin antwortet nicht mehr.

**Reproduzierbar in beide Richtungen:**
- Frische Konversation (keine vorherige Message zwischen den Twins) → Twin antwortet ✓
- Folge-Frage in laufender Konversation → Twin schweigt ✗

**Architektonische Frage:** sollen Folge-Fragen in einer Konversation Twin-Trigger erzeugen oder nicht?

Argument dafür: aus User-Sicht ist „Hey Florian, wann hast du morgen Zeit?" als zweite Frage in der Konversation **eine neue Anfrage**, nicht ein Reply auf die vorherige Antwort. Twin sollte triggern.

Argument dagegen: Reply-Detection wurde explizit eingebaut um Loop-Risiko zu vermeiden — wenn Twin auf jede Folge-Message antwortet, kann sich eine Konversation beider Twins selbst befeuern. `test-trust-flow.ts` enthält explizit Loop-Detection (`STEP_MAX_DELTA_TRUSTED = 3`) als Schutz vor genau diesem Bug aus 2.5.4.1.

**Drei Lösungs-Optionen:**

1. **`in_reply_to` nur bei explizitem Reply-Button setzen** — UI bekommt einen Reply-Button pro Bridge-Message. Send ohne Reply-Button hat `in_reply_to: NULL`, neue Frage triggert Twin. Sauber, aber UI-Refactor mit Reply-Button-Logik nötig
2. **`in_reply_to` immer leer lassen vom Frontend** — schnellster Fix. Bricht aber Reply-Threading falls für künftige UI-Features (Conversation-Threads in #20 Conversation-Memory) gebraucht
3. **Reply-Detection im Backend nur bei kurzem Zeitfenster greifen** — z.B. nur wenn letzte Bridge-Message <60s her ist. Heuristik, fragil

**Mein Vote (Markus): 1.** Sauberste Trennung zwischen User-Intent „Reply auf diese Message" und „neue Frage in der Konversation". Plus konsistent mit anderen Chat-UIs (Slack, iMessage).

**Verwandt mit #80:** History-Reset-Pfad. Beide adressieren UX-Lücken in der Konversations-UI. Könnten architektur-seitig gemeinsam gedacht werden — Konversations-Konzept (Threads, Resets, Reply-Verlinkung) als kohärentes UX-Subsystem.

**Größe:** M (Variante 1, mit UI-Refactor) / XS (Variante 2, Frontend-Quickfix) · **Priorität:** should · **Aus:** Tag-8-Production-Smoke-Test, korrigierte Diagnose Tag-9-Vormittag
**Stufe:** 0 → 1 · **Spur:** UX-Reifung

**Status-Erkenntnis aus der Diagnose:** Der gestern als „echte Production-Regression" eingeordnete Bug ist keine Regression — die `trusted-bypass`-Architektur war seit 2.5.4.1 stabil und hat heute morgen im Test sauber funktioniert. Was geändert wurde: die UI-Verkettungs-Logik im Frontend produziert seit irgendwann (vermutlich Phase 2.5.5 mit Konversations-UI-Refactor) immer ein `in_reply_to`. Das versteckt den Twin-Trigger-Pfad bei allen Folge-Fragen. Ist also ein UX-Bug, nicht Architektur-Bug. Plus eine wichtige Lesson: Reply-Detection greift sowohl bei semantischen Replies („okay, danke!") als auch bei neuen Fragen, weil das Frontend nicht zwischen beiden unterscheidet. Differenzierung braucht UI-Konzept-Arbeit, nicht nur Backend-Fix.

---

## Aus Phase 3.2 entstanden

### 88. Multi-Provider Tool-Use-Adapter
Aktuelle Tool-Bridge (3.2.D) nutzt das AI-SDK direkt — `generateText({tools})` abstrahiert die Provider-API-Schemata für Anthropic/OpenAI/Google/Groq/Ollama. Funktioniert für die bestehenden Provider Out-of-the-Box ohne eigenen Adapter.

Sollte ein Provider in Zukunft Tool-Use-Spezifika haben, die das AI SDK noch nicht abdeckt (z.B. neue Function-Calling-Formate, Streaming-Tool-Calls mit Provider-spezifischen Erweiterungen, oder direkter Anthropic-Tool-Use ohne SDK), bauen wir hier einen Adapter-Layer ein. Für jetzt: das SDK macht es, kein Adapter nötig.

**Größe:** M · **Priorität:** nice · **Aus:** 3.2-Strategie-Session, Tag-10-Vormittag

### 90. Resume-Prompt-Tuning für Reject-Pfad
Beim Sub-Schritt-3.2.G-Reject-Smoke-Test aufgefallen: bei trivialen Math-Problemen ignoriert der LLM das Reject-Resume-Signal. Test-Setup: User-Message "Rufe mcp_everything-approval_get-sum mit a=99 und b=1 auf", Tool-Call wird vorgeschlagen, User klickt Reject mit Reason "Nicht freigegeben". Resume-Prompt: "[System] Tool-Call wurde abgelehnt. Begründung: Nicht freigegeben." Antwort vom LLM: "99 + 1 = 100." statt "Verstanden, ohne Tool kann ich nicht antworten."

Verhalten von Claude Opus 4.7 bei trivialen Aufgaben — er weiß `99 + 1 = 100` und gibt's einfach aus. Bei nicht-trivialen Tools (echte Web-Searches oder File-Operations) tritt das Problem nicht auf, weil der LLM ohne Tool-Result gar nichts hat.

Lösungsansätze:
1. **Härteres Reject-Resume-Phrasing** — explizit instruieren "Berechne nicht selbst, beziehe dich nicht auf das Ergebnis. Sag dass ohne Tool keine Antwort möglich ist."
2. **Pro-Tool-Resume-Templates** — manche Tools (Math) brauchen anderes Reject-Phrasing als andere (Web-Operations)
3. **Kontext-Awareness** — Reject-Reason vom User in den Resume-Prompt einbauen

Pattern ähnlich zu #89 — vermutlich auch nur partiell wirksam wie die TOOL_USE_DIRECTIVE-Härtung. Bei echten Tools (Hyperbrowser in 3.5) wird sich's vermutlich nicht zeigen, aber das Pattern sollte vor 3.5 sauber sein.

**Größe:** M · **Priorität:** should · **Aus:** Tag-10-Mittag 3.2.G-Reject-Smoke-Test

### 91. Reject-Reason-UI (window.prompt durch Komponente ersetzen)
Aktuelle 3.2.G-Implementation nutzt `window.prompt()` für die Reject-Begründung — pragmatisch und funktional, aber UX-mäßig nicht der Stand der Kunst. Browser-Prompt blockiert die UI, kein Multi-Line-Support, kein Cancel-Default-Handling, kein Theming-Bezug zur App-UI.

Saubere Lösung: Modal-Komponente oder Inline-Eingabefeld mit Textarea (analog zur Approve-/Reject-Inbox-UI in 2.5.4.3). Pattern-Vorlage: existierende Modal-Komponenten in der App-UI (z.B. Onboarding-Wizard-Modals oder Reset-Confirm-UI aus #84, oder ToolPicker-Modal aus 3.2.H).

Vorbedingung: keine. Diff-Scope: Frontend only, ein Edit in `apps/web/app/chat/[handle]/page.tsx` plus eventuell Helper-Komponente.

**Größe:** S · **Priorität:** nice · **Aus:** Tag-10-Mittag 3.2.G-Implementation (window.prompt analog Inbox)
**Stufe:** 0 → 1 · **Tranche:** A · **Spur:** UX-Reifung Welle 1 (Bau-Plan in `docs/UX-STRATEGY.md`)

### 93. Thinking-Aktivierung-Form für Opus 4.7
Spike-Befund (Tag 17): Claude Opus 4.7 lehnt `providerOptions.anthropic.thinking={type:'enabled', budgetTokens:N}` mit API-Error ab — Hinweis aus der API: `Use 'thinking.type.adaptive' and 'output_config.effort' to control thinking behavior.` `{type:'adaptive', display:'summarized'}` funktioniert hingegen.

Aktuell nicht relevant, weil Thinking im Send-Path nicht aktiviert ist. Wenn künftig Thinking-Aktivierung gebraucht wird (z.B. für komplexe Tool-Use-Reasoning-Chains, oder als Fallback-Lever bei #89-Rest-Bug), die `adaptive`-Form nutzen, nicht `enabled`. Plus: Modell-Version-Check einbauen, falls neuere Opus-Versionen die `enabled`-Form wieder unterstützen sollten.

**Größe:** XS · **Priorität:** nice · **Aus:** Spike 3.5.E.0 (Tag 17)

---

## Phase 3 — Memory + Skills + Tools

Memory-Schichten und Skill-System. Vor Phase 4. Aufwand-Cluster.

### 26. agentskills.io-Kompatibilität
Skills im Hermes/agentskills.io-Format implementieren, damit wir community-Skills nutzen können und eigene Skills portabel sind.
**Größe:** M · **Priorität:** should · **Aus:** Skills-Diskussion 1.5.

### 27. Hyperbrowser als Web-Browser-Skill
Cloud-Browser-Infrastruktur (hyperbrowser.ai, Y Combinator backed) als Skill-Tool. Twins können Web navigieren, scrapen, Forms ausfüllen — autonomes Web-Handling. Use-Cases: Web-Research für Konversationen, Form-Filling mit Approval-Gate, A2A-Erweiterung (Twins navigieren zu URLs, die andere Twins teilen). Vorbedingung: Skill-System (#25). Per-Twin Setup analog zu LLM-Config. Pricing ab $99/mo Basic, skaliert nach Proxy- und CAPTCHA-Volumen. Alternativen evaluieren: Browserbase/Stagehand, Browser Use (Open-Source), Skyvern (Computer-Vision-basiert), Lightpanda. Tool-Abstraktion über Provider — analog zur Vercel AI SDK für LLM.
**Größe:** L · **Priorität:** should · **Aus:** Backlog-Anregung Markus, 1. Mai 2026 Abend

**Update Tag 18 (verschoben auf Pre-Launch-Phase B oder später):** Strategic-Pivot in `docs/PRE-LAUNCH-A-STRATEGY.md` (Tag 18). Foundation-Teil dieses Items (Hyperbrowser-MCP-Spec, Tool-Sync, Approval-Gate) ist durch Phase 3.5 abgeschlossen und seit Tag 17 in Production live. Das verbleibende Ambitions-Set unter diesem Item — autonomes Computer-Use-Agent-Pattern, Multi-Step-Browser-Workflows mit `claude_computer_use_agent`, Form-Filling mit Approval-Gate, Persistent-Profiles — ist **nicht Teil von Pre-Launch-Phase A**. Schmaler Recherche-Workflow (`search_with_bing` + `scrape_webpage` + Synthese) bleibt als Hook-Feature in Phase A, Beta-deklariert (siehe neue Items #107 + #108 unten). Vollständiges Computer-Use-Agent-Pattern folgt nach Phase-A-Launch in Pre-Launch-Phase B oder als eigenes Item.

Hinweis zur Phase-Nummerierung: Phase 3.6 wurde in der ursprünglichen ROADMAP als „Procedural Memory" definiert (siehe `docs/ROADMAP.md`), in jüngerer Lesart (Strategy-Docs ab Tag 16) wird „Phase 3.6 Computer-Use-Agent-Pattern" synonym verwendet. **Beide Stränge sind durch dieses Update verschoben.**

### 28. Autonome Skill-Generierung (Lernschleife)
Twin schreibt nach komplexen Tasks (5+ Tool-Calls oder definierte Trigger) eine Skill-Markdown-Datei selbst. Lernschleife wie bei Hermes. Überschneidet mit Procedural Memory (#23).
**Größe:** XL · **Priorität:** nice · **Aus:** Skills-Diskussion 1.5.

---

## Phase 4 — Multi-Channel + Föderation

Twins werden überall erreichbar, Bridge-Architektur dezentralisiert.

## Cross-Cutting / Architektur-Erwägungen

### Verknüpfung mit Items #1 und #2
Items #1 (Twin-Konversationen als Threads) und #2 (Lokale Spiegelung des Bridge-Streams) sind eng verknüpft. Beide adressieren das Problem, dass aktuell Audit-Log und Konversations-Historie identisch sind. Empfehlung: zusammen in einer Phase angehen, frühestens Phase 3 nach Memory-Schichten.

### Cluster Owner-Recognition (#14, #38, #33)
Drei Items hängen zusammen und sollten in 2.5.4 koordiniert angegangen werden:
- #14 Owner-Recognition: Twin weiß, wer sein Owner ist — **gebaut** (twin-service.ts isOwner/ownerBypass, ownerUserId)
- #33 Mandate per Channel: Owner-Chat überspringt Approval, externe nicht
- #38 Approval-Wartemeldung: kein improvisiertes Owner-Naming mehr

Plus #39 (Klassifikator-Vorlauf) ist eine orthogonale Verbesserung in Phase 3.

---

## Strategische Optionen (Stand 2. Mai 2026)

Offene Entscheidungen, die als Sparring-Punkte stehen.

### Zentralisierungsgrad der Bridge — geplant entlang Phasen
Phase 2: zentrale Bridge ✅ (live unter `bridge.twin.harwayexperience.com`).
Phase 3: bleibt zentral (Memory + Skills sind orthogonal).
Phase 4: Föderation (Matrix-Modell), mehrere Bridges können sprechen, plus A2A-Adapter (#36).
Phase 5: Voll-P2P mit DIDs für Identität.
Optional Phase 6: Wenn Wertübertragung nötig — Blockchain als Bezahlebene OBEN AUF Messaging.

### Skill-Sourcing Strategie
Eigene Skills schreiben vs. agentskills.io-Community-Skills nutzen vs. Hybrid. Empfehlung: Hybrid, aber erst nach Skill-System #25.

### Memory-Persistenz — lokal vs. Cloud
Memory in Phase 3 lokal in Twin-DB. Bei Multi-Tenant-Cloud-Deployment (2.5.6) muss entschieden werden: pro User isoliert in geteilter DB, oder pro User eigene SQLite-Instanz. Performance vs. Isolation-Trade-off.

**Update Tag 23 (22. Mai 2026):** Für Phase B SaaS-Hosting gibt es neben SQLite-Skalierung eine dritte Option: Hosted-Vector-Search-Service.

**Turbopuffer** (turbopuffer.com) ist Vector + Full-Text Search auf Object Storage (S3) mit Memory/SSD-Cache-Layer davor. Produktions-Use bei Cursor, Notion, Anthropic, Linear. Sub-10ms p50 für warme Namespaces. Hybrid-Search (Vector + BM25 = unser Pattern aus 3.4), Metadata-Filtering, Multi-Tenancy via Namespace-pro-Customer.

Pricing: $64/mo Launch, $256/mo Scale, $4096/mo Enterprise (BYOC). 10x billiger als klassische Vector-DBs durch Object-Storage-Foundation — kalte Namespaces kosten nur Storage, warme werden gecacht.

**Architektur-Eignung für twin-lab Phase B:**
- Multi-Tenancy passt strukturell (Namespace pro Twin oder pro User)
- Cold/Warm-Tiering passt zum Memory-Pattern (alte Konversationen selten gequeried, neue heißer)
- Hybrid-Search ist Datenschicht-kompatibel mit unserem 3.4-FTS5-Setup
- Bridge bleibt unverändert, Episodic-Memory-Layer würde Turbopuffer-Calls statt sqlite-vec-Calls machen

**Trade-offs vs. sqlite-vec:**
- Bricht Self-Hosting-Story (Phase A): Hobby-User können nicht mehr voll-lokal hosten ohne Turbopuffer-Account
- Mindestkosten $64/mo schliessen Free-Tier-Hobby-User aus
- Lock-In auf Hosted-Service vs. heutige Portabilität (SQLite-File mitnehmen)

**Empfehlung:** Für Phase A unverändert sqlite-vec lokal. Für Phase B SaaS-Hosting als konkrete Option neben sqlite-vec-Skalierung in Strategy-Session prüfen — vor allem wenn Embedding-Volumen pro User in den Millionen-Bereich wächst (Long-Tail-Konversationen, Cross-Twin-Search aus Phase 4 #31).

Alternative Hosted-Optionen für gleiche Strategy-Session: Pinecone, Qdrant, Weaviate, pgvector. sqlite-vec selbst-skalierend (pro-User SQLite-File oder shared mit twin_id-Filter) bleibt Self-Hosting-freundlicher Pfad.

Spec: turbopuffer.com/docs

### Owner-Mode vs. Public-Mode Priorisierung
In Phase 4: Owner-Mode (Markus chattet via Telegram mit eigenem Twin) deutlich einfacher als Public-Mode (externe schreiben Twin an, Mandate entscheidet). Owner-Mode zuerst, Public-Mode später wenn Mandate-Layer reif.

### A2A vs. eigene Bridge-Strategie
A2A wird zusätzlich gebaut, nicht statt. Eigene Bridge bleibt für Twin-Lab-spezifische Features (Mandate-Layer, Approval-Gates, eigene Persona-Modellierung). A2A ist Adapter-Schicht obendrauf für Ökosystem-Anbindung. Entscheidung in Phase 4.

---

## UX-Reifung — Welle 1 (Less Technical)

Parallel zu Phase 3.6. Vollständige Spec: `docs/UX-STRATEGY.md`.

Welle vs. Stufe: **„Welle 1"** ist die aktuelle Bau-Runde (Sub-Schritte UX.1.A–D), **„Stufe N"** ist die Reife-Ziel-Marke einzelner Items. Welle 1 bringt die meisten Items auf Stufe 1, plus drei Tranche-C-Vorbereitungs-Items, die schon auf Stufe 2 zielen.

Stufen-Konzept: 0 = Engineer-Stand, 1 = Tech-Affine ohne Doku-Lookup, 2 = Casual-User-fähig, 3 = ohne tech. Vorkenntnis. Backlog-Items ohne Stufen-Marker = implizit Stufe 0 (UX-irrelevant für diese Spur).

### Tranche A — Quick-Wins

Bestehende Items, jetzt re-klassifiziert:
- **#91 Reject-Reason-UI** (window.prompt → Modal) — siehe Item oben, jetzt `Stufe: 0 → 1`, `Tranche: A`

Neu für Tranche A:

### 94. Toast-Framework statt `alert()` / `confirm()` in der Web-UI
Aktuell nutzt `apps/web` an mehreren Stellen Browser-`alert()` / `confirm()` für Erfolgs-, Fehler- und Status-Meldungen. Das blockt die UI, ist nicht theme-bar, und sieht in Production wie ein Bug aus. Plus: für Mobile/Tablet ist das katastrophal.

Was zu tun ist: leichtgewichtiges Toast-Framework (z.B. `sonner` oder `react-hot-toast`, beide Tailwind-kompatibel und klein) plus konsistenten Wrapper `toast.success/error/info(...)`. Inkrementelle Migration der `alert()`-Stellen — Settings-Save, MCP-Add-Fehler, Skill-Toggle, etc.

Plus zentraler Stand: `toast.promise(...)` für API-Calls mit pending/success/error in einem Aufruf. Spart Redundanz pro Try-Catch-Stelle.

**Größe:** M · **Priorität:** should · **Aus:** UX-Strategie-Session Tag 17 Abend
**Stufe:** 0 → 1 · **Tranche:** A · **Spur:** UX-Reifung Welle 1 (Bau-Plan in `docs/UX-STRATEGY.md`)

### 96. Empty-State-Onboarding für Chat (partially functional)
Erstuser landet im Chat-Tab mit nur einem leeren Input-Feld. Keine Erklärung, was der Twin kann, welche Tools verfügbar sind, wie Memory funktioniert. Aktuelle User wissen es, neue User scheitern.

Was zu tun ist: bei leerer Konversation (`messages.length === 0`) statt nur leeres Feld ein Onboarding-Block:
- 1-2 Sätze „Das ist dein Twin von X" mit Persona-Display-Name
- Liste der wichtigsten Capabilities („Web lesen, Memory abfragen, Skills X/Y")
- 2-3 Beispiel-Prompts als anklickbare Chips, die ins Input-Feld einsetzen

Pattern: bekannt aus ChatGPT/Claude-Web. Verschwindet sobald die erste User-Message gesendet wurde.

**Größe:** S · **Priorität:** should · **Aus:** UX-Strategie-Session Tag 17 Abend
**Stufe:** 0 → 1 · **Tranche:** A · **Spur:** UX-Reifung Welle 1 (Bau-Plan in `docs/UX-STRATEGY.md`)

**Update Tag 17 Abend (partially functional):** Implementiert in Commit `9121405` (EmptyState-Component + Inbox + Chat). Verifikation zeigt: DirectChat-EmptyState ist nur bei brand-new Twin (Tag-1-Onboarding) sichtbar — nach erstem Send sieht User immer Audit-Historie, weil DirectChat strukturell ein Audit-Log-Viewer ist (Reset löscht die Historie nicht). A2AChat-EmptyState ist strukturell unerreichbar, weil `NewConversationModal` Erst-Nachricht erzwingt — A2A-EmptyState im Folge-Commit `UX.1.A.3.X` aus dem Code entfernt (toter Pfad). Architektur-Fixes als Items #105 (A2A-Modal) und #106 (DirectChat-View-Architektur) angelegt, beide Welle-2-Material.

## Pre-Launch-Phase A — Block 3: Schmaler Computer-Use-Hook

Items aus dem Strategy-Pivot Tag 18. Block 3 nutzt die seit Phase 3.5 deployed Hyperbrowser-Foundation für einen schmalen Recherche-Workflow als Hook-Feature. Vollständiges Computer-Use-Agent-Pattern bleibt verschoben (siehe #27 Update). Spec: `docs/PRE-LAUNCH-A-STRATEGY.md`.

### 108. Launch-Deklaration Recherche-Capability als Beta
In README, Landing-Page und ggf. UI-Hint klarstellen, dass die Recherche-Capability im Self-Hosting-Launch Beta-Status hat. Erwartungs-Management vermeidet User-Enttäuschung bei Edge-Cases.

Konkrete Stellen:
- **README:** Hauptpitch-Block mit „Features"-Liste, Recherche-Capability als „(Beta)" gekennzeichnet
- **Landing-Page:** gleiche Deklaration im Feature-Abschnitt
- **Optional UI-Hint im Approve-Dialog** bei Recherche-Tool-Calls („Beta-Capability — Feedback willkommen")

**Größe:** XS · **Priorität:** must · **Aus:** Pre-Launch-Phase-A-Strategy (Block 3) · **Spur:** Pre-Launch-Phase A

**Status Tag 20:** UI-Hint-Teil ist durch #107 Patch 3 (ResearchFirstUseModal, Commit `150cdc8`) bereits ausgeliefert — Erstnutzung pro Twin-Owner blendet 3-Bullet-Beta-Hinweis ein. Verbleibend für #108: README-Hauptpitch-Block und Landing-Page-Feature-Deklaration mit „(Beta)"-Kennzeichnung. Reine Doku-Arbeit, keine Architektur-Änderung — nicht blockierend für Production-Deploy von #107.

### 119. Skills-Deaktivierung blockt nur Pre-Pass, nicht autonomes Tool-Use

**Befund Tag 20 (Test 6 #107):** Skill `is_active=0` deaktiviert nur den Pre-Pass-Trigger (forced toolChoice), nicht die MCP-Tool-Availability für den LLM. Wenn ein Twin Recherche-Skill aktiv hatte und mehrere Tool-Use-Patterns aus dem Send-History gelernt hat, ruft er Tools weiter autonom auf — auch nach Skill-Deaktivierung.

**Ist das ein Bug?** Strukturell nein, Vision-konform: Tag-16-Designprinzip („Tool-Aufruf darf nur Fallback sein, Tools müssen direkt in der Konversation automatisch aufgerufen werden") ist genau diese Autonomie. Skill steuert Pre-Pass, nicht Tool-Block.

**Aber UX-Konsequenz:** wenn User Skill deaktiviert in der Annahme „Twin macht keine Recherche mehr", wird Erwartung enttäuscht. Server-level-Block ist nötig.

**Lösungs-Optionen für später:**

1. **MCP-Server-Toggle:** Wenn User Recherche ganz blocken will, Hyperbrowser-Server `is_active=0` setzen (Server-level, nicht Skill-level). Macht alle Hyperbrowser-Tools für LLM unsichtbar.
2. **Skill-aware Tool-Filtering:** Pre-Pass-Logic erweitern. Wenn ein Tool nur durch einen deaktivierten Skill exponiert wäre, aus dem LLM-Tool-Set herausfiltern. Aber: Tools sind nicht 1:1 an Skills gebunden.
3. **Setting „Twin autonomes Tool-Use erlauben: ja/nein":** Pro Twin oder pro MCP-Server. Wenn off: kein Pre-Pass-Trigger, plus Tools werden nicht ans LLM gegeben.

**Größe:** S (Variante 1) / M (Variante 2/3) · **Priorität:** nice · **Aus:** Tag-20 Test 6 #107
**Status:** offen, kein Pre-Launch-Phase-A-Blocker

### 121. Wizard-Layout-Polish

**Befund Tag 21 (#110 Phase 2A Smoke):** Wizard-Layout ist nach Container-Width-Fix funktional, aber nicht mit dem eingeloggten Zustand visuell konsistent.

Verbleibende Polish-Punkte:
- Step-Indicator als visueller Stepper (heute nur Text-Header „Schritt N von M")
- Card-Styling konsistent zum DirectChat/A2A-Chat-Look
- Mobile-Responsive prüfen
- Form-Field-Layout (Spacing, Label-Style, Input-Width)
- Plus generelle UX-Polish (Animations, Hover-States, etc.)

**Größe:** S-M · **Priorität:** should · **Aus:** Tag 21 #110 Phase 2A Smoke-Befund
**Status:** offen, Phase-B-Kandidat (UX-Welle 2)

**Update Tag 21 (nach Phase 2A Closure):** Foundation aus Phase 2A für den vollen Polish steht — `w-full max-w-X mx-auto`-Pattern in flex-col-Layouts (gelernt im Tag-21-Layout-Saga, siehe STAND-Lesson) und Container-Width-Hierarchie (`/login` 448px für Auth, Onboarding/Wizard 672px). Beim vollen Polish: Hierarchie nicht brechen, Pattern weiter nutzen für Step-Indicator, Mobile-Responsive, Animationen. Section-Component hat heute optionalen `title` — bleibt verfügbar für künftige Card-Gruppen, ohne in Form-Steps zurückzukommen.

### 123. Handle-Editierung im Settings-Wizard

**Befund Tag 22 (#110 Phase 2B Commit 11):** Settings-Page hat Handle heute read-only mit Hint. Handle-Änderung verlangt:

- Bridge-Re-Register: alter Handle abmelden, neuer Handle registrieren (POST `/twins/register` an die Bridge mit neuem Token)
- Conversation-Migration: alle existing Bridge-Conversations sind am alten Handle gebunden — entweder migrieren oder Hint zeigen
- Skill- und MCP-Server-Mapping: an `twin_id` gebunden (nicht handle), kein Touch nötig
- URL-Update für aktive Sessions (Tabs/Bookmarks zeigen alten `/chat/@old-handle`)
- Conflict-Handling: 409 wenn neuer Handle vergeben

**Größe:** M-L · **Priorität:** nice · **Aus:** Tag 22 #110 Phase 2B Commit 11
**Status:** offen, Phase-B-Kandidat (wenn User-Demand kommt)

### 124. Wizard-Components zu shared `apps/web/components/`-Folder extrahieren

**Befund Tag 22 (#110 Phase 2B Commit 11B):** Persona-/LLM-/Presets-Form-Code existiert heute dupliziert in `apps/web/app/onboarding/page.tsx` (Wizard) und `apps/web/app/settings/page.tsx` (Settings-Edit-Sections). ~250 Zeilen Duplikation (Persona-Felder + Tone/Pronoun/Preferences-Pills + Topics/Beziehungen-Editor + LLM-Provider-Cards + Preset-Cards). β-Approach wurde gewählt für 11B, weil γ-Extract substantieller Refactor des Onboarding-Files gewesen wäre und das Settings-Bau-Scope gesprengt hätte.

**Plan:** Components extrahieren zu `apps/web/components/`:

- `persona-form.tsx` mit Props `{value, onChange, handleReadOnly?, handleLiveCheck?}` — Settings setzt `handleReadOnly=true`, Wizard nutzt `handleLiveCheck=true` (mit Debounce + Status-Label)
- `llm-config-form.tsx` mit Props `{provider, model, onProviderChange, onModelChange, apiKeyMode, apiKeyInput, ...}` — Wizard nutzt Create-Mode (immer editierbar), Settings nutzt Edit-Mode mit Maske + Ändern-Button
- `presets-form.tsx` mit Props `{available, selected, onToggle, loading?, error?}`
- Plus Utility-Components: `Pill`, `HandleStatusLabel`

Beide Pages importieren die shared Components. Onboarding-File würde ~1497 → ~1100 Z, Settings ~1670 → ~1300 Z.

**Größe:** L · **Priorität:** nice · **Aus:** Tag 22 #110 Phase 2B Commit 11B
**Status:** offen, Phase-2C-Kandidat (kein Phase-A-Blocker — Duplikation funktioniert)

### OpenAI/Codex-OAuth-Provider — erst in Weg-B-Onboarding, self-hosted-only

**Status:** OFFEN (Awareness / Folge-Item aus D2-Revision Tag 33) | **Größe S–M** | **Priorität:** nice | **Trigger:** erst wenn **Weg B** (durchgehendes Terminal-Onboarding inkl. Persona/Key, Etappe 2) gebaut wird

Aus der **D2-Revision** (`DISTRIBUTION-STRATEGY.md §2`, Tag 33): Ein OpenAI/Codex-OAuth-Provider (analog zum bestehenden #131-Anthropic-OAuth) ist **kein eigenständiges Item für jetzt**, sondern hängt an Weg B. Die Provider-Lage ist beweglich: Codex-OAuth funktioniert heute in Drittanbieter-Tools (OpenClaw), ist aber **reverse-engineert und nicht offiziell für Dritte gewidmet** — toleriert, nicht garantiert.

**Leitplanken (falls/wenn gebaut):**
- **Self-hosted-only** — nutzbar, weil der User sein eigenes Abo auf eigener Maschine fährt (Liability beim User). **Auf `nolmi.ai` (Managed) bewusst NICHT** ohne separate Entscheidung — dort trüge Nolmi das Liability (Subscription-Sharing-Optik einer Server-IP).
- **Keine Architektur-Abhängigkeit** — wie bei Anthropic-OAuth strikt hinter `auth_mode='oauth'` + Admin-CLI-Allowlist (2.4a), bei Provider-Politik-Wechsel via `twin:auth-mode … api_key` widerrufbar, ohne dass etwas bricht. API-Key bleibt der Default-Fels.

Bis Weg B existiert: **keine Aktion**, nur dokumentierte Setzung.

### Web-Präsenz-Architektur GESETZT (Tag 35): eigenes Repo + Vercel, getrennt vom Produkt-Stack

**Status:** **GESETZT (Tag 35)** — Architektur-Entscheidung, Umsetzung folgt (Landing = #112) | **Priorität:** prägt #112 + Apex-Cleanup

Die **Web-Präsenz** (Marketing-Landing + künftige Docs) wird **vom Produkt-Stack getrennt** — eigener Lebenszyklus, eigenes Deploy, kein Monorepo-Ballast.

- **Eigenes Repo** (z.B. `nolmi-ai/nolmi-web`), **nicht** im Produkt-Monorepo `nolmi-ai/nolmi`.
- **Host: Vercel** (Next.js-Nähe, Git-Deploy, CDN, Auto-SSL).
- **Subdomain-Struktur:**
  - `nolmi.ai` (Apex) → **Landing auf Vercel**
  - `app.nolmi.ai` → **Produkt-Web-UI (VPS, unverändert)**
  - `docs.nolmi.ai` → **Docs (später, auch Vercel)**
- **DNS-Umstellung (reversibel):** nur der **Apex-A-Record** (`nolmi.ai`) zeigt künftig auf **Vercel** statt VPS (`187.124.3.235`). `app.` / `runtime.` / `bridge.` bleiben auf dem VPS.
- **Landing-Pitch steht** (englisch): Hero **„Be present, without being always available"**, 3 persönliche Nutzen + A2A als **nachgeordneter 4. Punkt**, Trade-off-Satz, npm-Install, AGPL, pre-launch. Quelle: Positionierungs-Session mit Markus' Nolmi.
- **Konsequenz → Apex-Cleanup-Item:** sobald die Vercel-Landing live ist + DNS umgestellt, wird der Übergangs-Container **`nolmi-apex` abgelöst** → Service aus `docker/nolmi/docker-compose.yml` + den Apex-Eintrag aus `install/tls-promote.sh` entfernen (s. Apex-Item unten).
- **Folge-Item — Descriptions auf persönlichen Pitch:** **GitHub ✅ erledigt (Tag 35):** Repo-Description gesetzt auf **„Be present, without being always available — your self-hosted personal AI twin."** (ersetzt die A2A-/Infra-geführte Fassung, konsistent zur Landing, persönlicher Nutzen führt). **npm OFFEN** → beim nächsten CLI-Publish (0.1.1) mitnehmen, s. NPM-Distribution-Item.

### nolmi.ai Root-Domain — Apex-Platzhalter ✅ ABGELÖST durch Vercel-Landing (Cleanup vollzogen)

**Status:** ✅ **DONE (Tag 35)** — Apex liegt jetzt auf **Vercel** (Landing live), der `nolmi-apex`-Übergangs-Container ist **aus dem Repo entfernt**. | **Größe S** | Befund Tag 33 → abgelöst Tag 35

**Cleanup vollzogen (Tag 35):** `nolmi.ai` zeigt per A-Record auf **Vercel** (Landing live, Repo `nolmi-ai/nolmi-web`). Der Platzhalter-Container ist damit gegenstandslos und **entfernt**: `nolmi-apex`-Service + Top-Level-`configs:`-Block aus `docker/nolmi/docker-compose.yml` raus (verifiziert: `docker compose config` VALID, nur noch runtime/bridge/web, kein `configs:`-Key); Apex aus der `HOSTS`-Liste + Texten in `install/tls-promote.sh` zurückgebaut (`bash -n` grün, Cert-Trigger nur noch app/runtime/bridge). `app./runtime./bridge.` + Traefik + deren Certs **unberührt**. **VPS-Aktion entfiel (Befund Tag 35):** der `nolmi-apex`-Container existiert auf Production **nie** — der Apex wurde im Repo gebaut (Tag 34, `f7e7954`), aber der geplante Sammeldeploy fand nie statt, Prod läuft bewusst auf einem Stand VOR dem Apex (`docker compose ls` = `nolmi running(3)`, nur runtime/bridge/web). Der Code-Diff (`37fabdb`) genügt → Apex kommt beim nächsten regulären Deploy gar nicht erst auf. **Kein offener VPS-Rest.** Reversibel (Diff zurücknehmen + A-Record zurück auf VPS).

<details><summary>Historie (Übergangs-Container, Tag 33–35)</summary>

Apex-`nolmi.ai` lieferte 404 (kein Traefik-Router). **Gewählt: Option (b)** (Diagnose) — ein **separater Static-Container `nolmi-apex` (nginx:alpine)**, isoliert von Next-App/Auth/BasicAuth:

Apex-`nolmi.ai` lieferte 404 (kein Traefik-Router). **Gewählt: Option (b)** (Diagnose) — ein **separater Static-Container `nolmi-apex` (nginx:alpine)**, isoliert von Next-App/Auth/BasicAuth:
- `docker/nolmi/docker-compose.yml`: neuer Service `nolmi-apex` mit Router `Host(\`${DOMAIN:-nolmi.ai}\`)` (nackte Apex), websecure/tls/`${ACME_RESOLVER}`, **bewusst KEIN `nolmi-auth`-Middleware-Label** → öffentlich, kein BasicAuth (verifiziert: app.-Router behält BasicAuth, Apex hat keins). HTML inline via `configs.content` (kein Bind-Mount → kein Symlink-Compose-Relativpfad-Problem, kein Custom-Build). Minimale Platzhalter-Seite („Nolmi" + ein Satz + Link `app.${DOMAIN}`), `${DOMAIN}`-interpoliert (verifiziert: DOMAIN=foo.test → Link app.foo.test).
- **ACME:** Apex braucht ein eigenes Cert (in Prod beim ersten Request gezogen). `install/tls-promote.sh` triggert + verifiziert den Apex jetzt **mit** (Host-Liste inkl. `${DOMAIN}`) — sonst klebt der Apex beim nächsten Staging→Prod-Flip auf Staging/Default.

**Verifiziert (lokal):** `docker compose config` VALID, Apex-Labels korrekt (Host nackt, Port 80, kein BasicAuth), HTML-Interpolation, app-BasicAuth unverändert, `tls-promote.sh` `bash -n` grün.
**Offen:** **Production-Live-Verifikation** (Apex liefert die Seite, kein BasicAuth, Cert) — **nicht jetzt isoliert auf Prod**, sondern als Teil des **nächsten Production-Deploys** (mit dem `git pull` + `docker compose up -d nolmi-apex` dort).

**Cross-Ref #112:** Dies ist die **minimale Platzhalter-Seite**, NICHT die volle Launch-Landing. **#112** (Self-Hosting-Launch-Landing) zieht laut **Web-Präsenz-Architektur (Tag 35)** in ein **eigenes Repo auf Vercel** um (s. Item oben), NICHT mehr in den Produkt-Stack.

**ABLÖSE-/CLEANUP:** ✅ vollzogen Tag 35 (s. Status oben) — Service + `configs:` aus dem Compose, Apex aus `tls-promote.sh`.

</details>

### Prod-Deploy Tag 35 ✅ VOLLZOGEN — aufgelaufener Stapel (86ed1e4 → 6e32813)

**Status:** ✅ **DONE (Tag 35)** — `srv1712371` von `86ed1e4` auf `6e32813` deployt (29 Commits). | war: must-vor-Launch

**Deployt + live verifiziert (Tag 35):** **#3 maxLength** (`6c836d5`), **Weg-B-Onboarding-Refactor** (`759fcbf`/`2e61007`), **Apex-Removal** (`37fabdb`, war auf Prod nie), Lizenz/Going-Public-Doku, 3b-TLS-Tooling. **KEINE Migration** (Runner: 26 bereits angewendet/skipped → kein Schema-Risiko). **runtime + web neu gebaut, bridge unberührt.** Web-Bundle korrekt auf `runtime.nolmi.ai` (Literal-Build-Arg). **Verifiziert:** Owner-Direct-Chat (@markus) · A2A (@markus→@florian) · **Weg-B-Onboarding-Smoke** (Test-Twin angelegt→geantwortet→gelöscht). Container stabil. **Rollback-Artefakte auf VPS:** Images `rollback-86ed1e4` + DB-Backups `*.preflight-bak` (später aufräumen).

**Deploy-Mechanik korrigiert (DEPLOYMENT.md §3):** Der Prod-Stack nutzt `image:latest` **ohne `build:`** → `docker compose up -d` baut nichts. Korrekte Sequenz: `git pull` → **explizit `docker build` aus dem Repo-Root** (runtime + web; web mit **Literal** `--build-arg NEXT_PUBLIC_RUNTIME_URL=https://runtime.nolmi.ai` + `…DEPLOYMENT_LABEL=production`) → Bundle verifizieren → `docker compose up -d --force-recreate nolmi-runtime nolmi-web`. **🔴 Stolperstein:** `docker build` lädt die `.env` nicht → `${DOMAIN}` leer → `https://runtime.` (kaputt); der #126-Guard fängt das NICHT (nur localhost/leer) → **immer das Literal setzen + Bundle prüfen**. (Deckt sich mit der Tag-17-Lesson „Compose ist image-tag-only, Build via `docker build`".)

### Bridge-Orphan-Cleanup bei nicht erreichbarer Bridge (aus #744)

✅ ERLEDIGT (Tag 43, deployt + Prod-bewiesen). Admin-autorisierter Deregister-Pfad statt per-twin-Token (der beim Orphan ja verloren ist): neue Bridge-Route DELETE /admin/twins/:handle hinter requireAdmin (BRIDGE_ADMIN_TOKEN, opt-in, timing-safe; default AUS → 503), idempotent (fehlender Handle → 200 deleted:false). Runtime-CLI twin:bridge-deregister (Token-Quelle ENV>--admin-token>readSecret-Prompt, nie geloggt). Commits 9c4ec4b (bridge) / 4117702 (cli) / 0d0b02f (boot-label). Prod-Beweis an Wegwerf-Handle @deploytest_orphan: register 201 → re-register 409 (Orphan-Zustand) → falsches Admin-Token 401 (Row blieb) → korrektes Token deregistriert → re-register 201 (Block gelöst). Boot-Log 'Admin-Cleanup-Endpoint: aktiv'. Erste Bridge-Code-Änderung seit Langem — Bridge-Image neu gebaut, web/A2A unberührt.
🔴 Design-Befund (für etwaigen Reconcile-Folgeschritt): twins-Schema ist reiner Handle+Token-Router OHNE Runtime-Rückbezug (kein owner/runtime-id) → Bridge kann Waisen nicht autonom erkennen; ein Sweep bräuchte die Runtime-Live-Handle-Liste als Input UND einen Admin-List-Pfad (GET /twins ist heute per-twin-gated). Der bindende Constraint war Autorisierung, nicht Erkennung. Targeted-CLI gewählt, Reconcile-Sweep bleibt optionale Folge.
Reconcile-Sweep (Folge): ✅ gebaut + deployt + Prod-Dry-run sauber (Tag 43). Admin-List-Pfad GET /admin/twins (face451, requireAdmin, Body ohne api_token) + Runtime-CLI twin:bridge-reconcile (9f1b614). Design: Runtime-getrieben, Live-Quelle = twin_profiles.list({}) UNFILTERED (konservativ — fängt nicht-geladene/deaktivierte aber lebende Twins), drei Guards: Dry-run-Default (--apply nötig), Sanity-Floor (leeres Live-Set → Abbruch, keine Massenlöschung), Doppel-Prüfung pro Handle. KEIN Loop/Autosend (destruktiver Multi-Handle-Sweep bleibt Hand-Werkzeug). Prod-Dry-run gegen die saubere Bridge: 3 Handles, 0 Waisen, deckungsgleich — kein --apply. Struktureller Vorbehalt: Diff setzt Single-Runtime voraus (föderativ würde ein fremder Bridge-Handle fälschlich als Waise erscheinen).
🟡 Folge-Hygiene-Notiz: BRIDGE_REGISTER_TOKEN wurde im Arbeitschat versehentlich exponiert → bei Gelegenheit rotieren (neuer Wert .env + Bridge recreate).

**Status:** ✅ ERLEDIGT (Tag 43) | **Größe:** S | **Priorität:** should — vor breiterem Self-Hosting/Launch | **Aus:** #744 Schritt 2/3 (Tag 36)

Beim Twin-Löschen (#744) ist die Bridge-Deregistrierung bewusst **best-effort**: ist die Bridge im Lösch-Moment nicht erreichbar (oder lehnt unter Per-Twin-Auth mit 401 ab, weil der Token-Resolve fehlschlägt), wird der Twin **lokal trotzdem vollständig gelöscht** und die Antwort setzt `bridgeOrphan:true`; die UI zeigt den Cleanup-Hinweis. Zurück bleibt eine verwaiste Handle-Row in der Bridge-DB (`apps/bridge/data/bridge.db`, Tabelle `twins`). Diese Waise blockt später ein Re-Onboarding mit demselben Handle (Bridge meldet „existiert bereits", 409). **Zu bauen:** ein Bridge-seitiger Cleanup-Pfad für verwaiste Handles — z.B. ein Admin-/Bootstrap-Schritt oder CLI, der Handles ohne lebenden Runtime-Twin findet und deregistriert (`TwinsRepo.delete` existiert seit #744 Schritt 1). Verwandt mit der bestehenden Architektur-Notiz „Bridge-DB-Cleanup als Production-Bootstrap-Schritt" (alte Handles via Volume-Mount löschen) — dort als manueller Pfad beschrieben, hier als wiederholbarer Cleanup.

### NPM-Distribution `npm i -g nolmi` — Phase 1 komplett + PUBLIZIERT ✅

**Status:** ✅ **DONE — `nolmi@0.1.0` LIVE auf npm (Tag 35, 2. Juni 2026)**. Der B1-Clone-Distributionsweg steht: **`npm i -g nolmi` → `nolmi onboard`**. | war: should | **Trigger:** Gate §5a erfüllt (Repo public)

**Publiziert (Tag 35):** `nolmi@0.1.0` auf `registry.npmjs.org` — **AGPL-3.0-only**, **deps: none**, `bin: nolmi`, Maintainer `markusbaier`, **LICENSE im Tarball (34,5 kB AGPL)**, 14 Dateien (nur `dist/` + LICENSE + README + package.json, kein Source/.env). `npm view nolmi` bestätigt öffentliche Abrufbarkeit. Pre-Flight 6/6 grün (Name frei, Tarball sauber, nur `packages/cli` nicht-private). **Still** — kein Launch/Announcement.

**Vor-Publish-Schritte (beide ✅):**
- **(a) LICENSE-im-Tarball ✅** (Commit `a315b08`): byte-gleiche Kopie nach `packages/cli/LICENSE` + explizit in `files`. `npm pack --dry-run` bestätigt 34,5 kB AGPL im Artefakt.
- **(b) `npm publish` ✅** (Tag 35): aus `packages/cli/` publiziert.

**Phase 1 ✅ (Tag 34):** `packages/cli` als einziges publizierbares Paket. Node-Port der install.sh-7-Schritte mit den drei Abweichungen (public-Clone / `node:crypto` / TTY-Passthrough). **VM-E2E (187.124.7.94):** Klon → `docker compose up --build -d` → idempotente `.env` → interaktives `onboard` → User+Twin → **Browser-Login von außen + echte Twin-Antwort**. Plus Remote-URL-Fix (Host-Prompt + Auto-Detect + `reconfigure-host`). Commits `2beff2f` (Bau) + `fix(cli)` (Remote-URL) + `a315b08` (LICENSE). `--no-docker` (Phase A) als Groove reserviert.

**📌 Beim nächsten CLI-Publish (0.1.1) mitnehmen — NICHT extra republishen:**
- **`packages/cli/package.json:"description"` angleichen:** aktuell „Self-hosted Nolmi AI-Twins — One-Command-Installer (npm i -g nolmi → nolmi onboard)". Auf die **persönliche Pitch-Linie** umstellen (konsistent zur GitHub-Description/Landing „Be present, without being always available — your self-hosted personal AI twin." — Claim oder knappe Nutzen-Fassung). **Finaler Wortlaut beim Publish festlegen.**
- **GitHub-Release** anlegen (s. eigenes Item „GitHub-Releases einführen") — getaggte `v0.1.1` + Changelog.
- (`repository.url`-Normalisierung ist bereits gefixt, `874be65`.)

**Folge (nicht jetzt):** Phase A (Single-Process, `--no-docker`) + Phase C (beide Modi) bleiben Folge-Phasen. B1-Image-Pull (Docker-Hub) optional als schlankster Weg.

Globales npm-Paket (`npm i -g nolmi` → `nolmi onboard`) wie OpenClaw. **Phasenweg:** B jetzt (Wrapper ums Single-Host-Compose) → A später (Single-Process ohne Docker) → C Endbild (beide Modi). Volle Strategie in `DISTRIBUTION-STRATEGY.md §3` (Etappe 2 NPM-Abschnitt + Etappe 3).

### `npm pkg fix` — repository.url-Normalisierung nachziehen ✅

**Status:** ✅ **DONE (Tag 35, Commit `874be65`)** | **Größe XS** | Befund beim Publish Tag 35

`packages/cli/package.json` `repository.url` gezielt auf `git+https://github.com/nolmi-ai/nolmi.git` gesetzt (Objekt-Form behalten, nur das eine Feld geändert — nicht `npm pkg fix`, das auch bin/version anfassen könnte). Behebt die npm-Normalisierungs-Warnung für künftige Publishes (0.1.1+); `version` blieb 0.1.0, kein Republish.

### Launch-Vorbereitung — die nächsten Fronten (NICHT heute zwingend)

**Kontext:** npm-Paket ist **real** (`npm i -g nolmi`), Repo public, Wrapper remote-verifiziert. Damit werden die folgenden Politur-Items **launch-relevant**, bevor es einen **lauten** Launch (HN/Twitter) gibt. Erst wenn die rund sind: Announcement.

- ~~**`always_pending`-Onboarding-Politur**~~ — **ENTSCHÄRFT (Tag 35, diagnostiziert, kein Fix nötig):** der Owner bekommt immer sofort Antworten (Owner-Bypass), untrusted-A2A ist strukturell/hartkodiert pending — nicht Template-bedingt. **Kein Launch-Blocker.** Details + Folge-Items s. „QuickStart-Mandate-Default" (oben, geschlossen).
- **Volle #112-Launch-Landing** — ersetzt die `nolmi-apex`-Platzhalterseite; braucht Pitch/Story (Demo-First, Hero-GIF #113).
- ~~**#3 maxLength Live-Test (Nicht-Owner)**~~ — **✅ erledigt (Tag 35, VM):** präventiv + retry live bewiesen, Truncate isoliert; s. Item „3. Mandate-Conditions-Auswertung".
- **Repo-Description EN** — GitHub-Settings (s. eigenes Item), vor Launch angleichen.

**Reihenfolge-Gedanke:** still bleiben, diese vier abräumen, dann lauter Launch. Kein Announcement auf halbgarem Onboarding-Eindruck.

**Diagnose-Befund (Tag 33):** B ist **technisch trivial** (7 `install.sh`-Schritte → Node, `node:crypto` ersetzt `openssl`, A-später nicht verbaut). Der Haken ist **nicht** Technik, sondern **Code-Bezug + Repo-Sichtbarkeit**: das Compose baut aus `apps/*` (`build: context ../..`), das **Repo ist privat** (anonym 404).

**Drei B-Pfade:**
- **B2 (Source ins npm-Paket):** heute baubar ohne neue Infra (~4.6 MB Source), aber = Public-via-npm + lokaler Nutzer-Build. **VERWORFEN** — Public-Freigabe durch den Seiteneingang statt bewusster Etappe-3-Entscheidung.
- **B1-Clone:** braucht **Repo public** (Gate §5a: PAT-Rotation + Secret-History-Scan). Fallback.
- **B1-Image-Pull:** braucht **Docker-Hub-Push** + `image:`-Pull-Compose-Variante. **ENDBILD-NAH** — kleinstes Paket, nur Docker beim Nutzer, keine Source-Exposure, entschärft das Secret-History-Problem. **Bevorzugt.**

**Technik-Befund (für den Bau festgehalten):**
- Eigenes Paket **`nolmi`** (npm-Name **FREI**, Registry-404), `"bin": { "nolmi": "dist/cli.js" }`; **Monorepo-Root bleibt `private:true`**.
- Secrets via **`node:crypto`**: `NOLMI_ENCRYPTION_KEY` = 32-Byte-**base64** (byte-genaues `loadMasterKey`-Format), Session/Bridge = 32-Byte-hex; `.env` `mode 0o600`, idempotent.
- `onboard`-Übergabe (`docker compose exec -it … node dist/scripts/onboard.js`) braucht **interaktiven TTY-Passthrough** (`stdio: 'inherit'`).

**Entscheidung (Pfad a):** Bau hinter die Public-Entscheidung — kein B2 jetzt. Bevorzugt B1-Image-Pull (Docker Hub), Fallback B1-Clone (Repo public). Beide nach §5a.

### ✅ BUG (GEFIXT): `nolmi onboard` backte `localhost:4000` ins Web-Bundle → Remote-VPS-Login brach ("Failed to fetch")

**Status:** ✅ **DONE — VM-verifiziert (Tag 34, Commit `fix(cli): Remote-URL …`)** | **Größe M** | war: HOCH (primärer Self-Hoster-Fall: VPS + Browser vom Laptop)

**Fix (Option a + Auto-Vorschlag + Repair-Pfad):**
- **onboard** löst die Browser-Adresse **vor** dem Build auf (`resolveHost`): `--host`/`NOLMI_HOST` explizit → nehmen (kein Prompt); sonst TTY → erkannte IP (`os.networkInterfaces()`) **vorschlagen**, Enter bestätigt, Eingabe überschreibt; kein TTY → erkannte IP + laut geloggt (Fallback localhost). `https://` wird abgelehnt mit 3b-Hinweis (http+IP-Phase).
- **Repair-Pfad `nolmi reconfigure-host`** (neu): für „localhost schon gebacken, Zugriff ist remote" — löst Adresse neu auf, ersetzt **ausschließlich** die `NEXT_PUBLIC_RUNTIME_URL`-Zeile (zeilenweise; **Secrets/Encryption-Key nie angefasst**), `compose up -d --build`. Idempotent (gleicher Host → no-op).
- **DRY:** `install.sh` gespiegelt (`detect_ip()` + `resolve_host()`, `[ -t 0 ]`-Prompt). `.env`-Formel `http://<host>:4000` byte-identisch. `SESSION_COOKIE_SECURE=false` bleibt korrekt für http+IP (kein Eingriff nötig). Compose/web-Dockerfile/#126-Guard unangetastet.
- **Neue Dateien:** `packages/cli/src/lib/{detect-ip,host,repo}.ts` + `commands/reconfigure-host.ts`; geändert: `onboard.ts`, `cli.ts`, `env-template.ts`-Kommentar, `install/install.sh`, `README.md`.

**VM-Beleg (187.124.7.94):** neues Tarball → VM → `reconfigure-host` → IP-Vorschlag **187.124.7.94 korrekt erkannt** + bestätigt → `.env`-URL-Zeile ersetzt → **Secrets intakt (Twin gibt echte LLM-Antwort = `NOLMI_ENCRYPTION_KEY` unversehrt)** → web-Rebuild → **Browser-Login von außen (Mac → http://187.124.7.94:3000) funktioniert, Twin antwortet**. Der komplette B1-Clone-Pfad inkl. Remote-Zugriff trägt end-to-end.

**Symptom (verifiziert auf VM 187.124.7.94):** `nolmi onboard` schreibt `NEXT_PUBLIC_RUNTIME_URL=http://localhost:4000` in die `.env` (aus install.sh geerbt, für **lokales** Single-Host gedacht). Diese Adresse wird **build-time ins Web-Client-Bundle gebacken** (vgl. #126 Build-Guard). Greift der Browser **von einem anderen Rechner** auf den VPS zu (der Normalfall: VM headless, Zugriff vom Laptop), zeigt das Bundle auf `localhost:4000` = **den Rechner des Browsers**, nicht die VM → der Login-Request erreicht die Runtime nie → **"Failed to fetch"**.

**Diagnose-Befund:** `.env` UND das gebackene Bundle enthalten beide `http://localhost:4000`. Die Runtime selbst ist **gesund** (`localhost:4000/health` → 200 auf der VM, Ports auf `0.0.0.0` offen) — **nur die im Bundle gebackene Adresse ist für Remote falsch**. Es ist kein Runtime-/Netzwerk-Problem, sondern eine **Build-Zeit-Annahme** (localhost) im Wrapper.

**Kern:** `NEXT_PUBLIC_RUNTIME_URL` ist build-time inlined → der Wrapper müsste **VOR dem `compose up --build`** die **browser-erreichbare** Adresse kennen (öffentliche IP/Domain), statt `localhost` anzunehmen. `NOLMI_HOST` existiert im Wrapper bereits (Default `localhost`) — der Bug ist, dass für den Remote-Fall kein sinnvoller Wert gesetzt/abgefragt wird.

**Fix-Optionen (Design-Entscheidung, frischer Kopf):**
- **(a) onboard fragt** nach der öffentlichen Adresse (IP/Domain) — explizit, robust, ein interaktiver Schritt mehr.
- **(b) Public-IP auto-erkennen** — bequem, aber **fehleranfällig** (NAT, mehrere IPs, spätere Domain). Riskant als Default.
- **(c) `localhost`-Default + klarer Hinweis** „für Remote `NOLMI_PUBLIC_HOST` setzen + neu bauen" — minimal, schiebt die Last zum User.

**Berührt außerdem:** `SESSION_COOKIE_SECURE` / Cookie-Domain könnten beim Domain-/HTTPS-Fall mit dran hängen (heute hart `false`/leer für lokales http). Beim Fix mitdenken, nicht separat lösen.

**Cross-Ref:** Hängt an `NEXT_PUBLIC_RUNTIME_URL` (Wrapper `.env` + `docker/nolmi/docker-compose.single-host.yml` Build-ARG) und an #126 (Build-Guard). install.sh hat denselben Default (`NOLMI_HOST` → `localhost`) — der Fix sollte **beide Türen** (bash + Wrapper) konsistent halten (DRY-Kopplung, s. `packages/cli/README.md`).

### 133. Cross-Channel-Mental-Model-Doku

Wenn Owner Twin-Lab über Web-UI **und** Telegram nutzt, entsteht eine UX-Asymmetrie:

- Web-UI zeigt alle Messages aus allen Channels (eine Conversation-View)
- Telegram zeigt nur Telegram-Messages (Telegram-API-Constraint, lässt rückwirkendes Anzeigen nicht zu)
- Memory + Persona funktionieren kanal-übergreifend (verifiziert in #130 Phase 3 Manual-Smoke Tag 26)

Owner-Frage beim ersten Cross-Channel-Use: „Warum sehe ich's hier aber nicht dort?" Channel-Badge im Web-UI macht den Cross-Channel-Status pro Message sichtbar (gebaut in #130 Phase 3), aber für Onboarding + Demo-Story braucht's übergeordnete Erklärung.

**Touch-Points:**

- **Onboarding-Wizard (#110):** Telegram-Setup-Schritt sollte Asymmetrie erklären. Heute kein Telegram-Step im Wizard — Settings-UI für Bot-Konfiguration (Phase 4 von #130) ist der erste Touch-Point. Dort 1-Satz-Hinweis ergänzen.
- **#113 Hero-GIF / Demo-Video:** Caption oder Voice-Over-Statement: „Same memory, two channels, two views — your twin remembers across, each channel shows its own thread." Macht Mental-Model in <10 Sek klar.
- **#112 Landing:** Section über Telegram-Integration sollte explicit machen: „Telegram zeigt deine Telegram-Konversation, Web-UI ist die Zentrale mit Cross-Channel-View."

**Architektur-Hintergrund:**

Telegram-API erlaubt nur Bot-↔-User-Messages, keine Drittquelle-Injection. Eine technische Lösung „Web-Messages an Telegram nachsenden als Bot-Sayer-Echo" wurde Tag 26 verworfen (semantisch falsch: User-Voice würde als Bot-Voice erscheinen, Notification-Storm bei jeder Web-Message). Asymmetrie als Feature akzeptiert.

**Größe:** XS (3 Touch-Points, je 1-2 Sätze Doku-Edit) · **Priorität:** should · **Aus:** #130 Phase 3 Manual-Smoke Tag 26 UX-Befund · **Spur:** Pre-Launch-Phase A (Block 5)

**Status-Notiz Tag 26:** Channel-Badge im Web-UI gebaut in #130 Phase 3 (Commit folgt). Doku-Erweiterung für drei Touch-Points kommt im Rahmen #110-Wizard-Erweiterung (Phase 4 von #130) + #112 Landing + #113 Hero-GIF.

### 134. Settings Per-Tab-Submit-Refactor (Persona/LLM/Presets)

Heute teilen sich Persona + LLM + Presets im „Konfiguration"-Tab einen atomic-Submit-Endpoint (`PATCH /twins/:handle/full-config`). Der gemeinsame `isDirty`-State + Submit-Button bedeutet: bei jedem Tab-Wechsel verliert User die Änderungen in den anderen zwei Sub-Sections (oder muss sie alle drei gleichzeitig speichern).

Per-Tab-Submit wäre saubere Architektur:
- Drei separate Endpoints (`PATCH /twins/:h/persona`, `PATCH /twins/:h/llm-config`, `PATCH /twins/:h/presets`) — explicit Routes pro Bereich
- ODER ein PATCH-Subset-Endpoint mit Body-Schema das Partial-Updates erlaubt — pragmatischer, ein Endpoint
- UI-Konsequenz: jeder Sub-Section eigener Submit-Button, eigener Dirty-State

Phase-4-Scope war zu eng für den Refactor, deshalb in Phase 4.3 pragmatisch das existing Coupling-Pattern beibehalten.

**Größe:** S-M (0.5-1 Bautag, abhängig von Endpoint-Strategy — drei separate Routes vs Partial-PATCH). **Priorität:** could. **Spur:** Pre-Launch-Phase B oder Polish-Welle.

**Status-Notiz Tag 26:** Angelegt aus Phase 4.3 Tag-26-Closure (Commit `402a1ae`). Heutiges Coupling funktional, aber UX-suboptimal — Tab-Switch innerhalb Konfiguration ist nicht "kosten-frei".

### 136. Telegram-Config Status-Felder (paired_at + last_message_at)

`TelegramChannelTab` Modus „Configured-Paired" zeigt heute nur Bot-Username + ✓-Hint, kein Datum. Wünschenswerter Status:

- **Verbunden seit:** Pairing-Datum (`paired_at`)
- **Letzte Nachricht:** Datum der jüngsten Inbound-/Outbound-Telegram-Message (`last_message_at`)

Backend-Aufwand:
- `paired_at` braucht Schema-Migration (neue Spalte `paired_at TEXT NULL` in `telegram_configs`, gesetzt in `consumePairingCode`, gecleart in `unpair`)
- `last_message_at` via Query auf `telegram_messages.sent_at DESC LIMIT 1 WHERE twin_id=?`. Kein Schema-Add.
- Beide in `toPublic()` ergänzen, GET /config liefert sie

UI-Aufwand:
- 2 Zeilen im Configured-Paired-Render in `TelegramChannelTab.tsx`
- `formatDate()` + `formatRelative()` Helper (existing patterns oder neu)

Pro-Tipp: konsistent zu künftigen Channel-Adaptern (WhatsApp/Discord) — Field-Set sollte Channel-agnostisch sein, falls Phase 4.2 WhatsApp kommt.

**Größe:** S (~0.5 Bautag — Migration + Repo-Add + UI-Render + Manual-Smoke). **Priorität:** could. **Spur:** Polish-Welle nach Phase 5 Production-Deploy.

**Status-Notiz Tag 26:** Angelegt aus Phase 4.4 Phase-1.1-Diagnose (Commit `97b2ce7`). Pragmatisch weggelassen aus Phase 4.4 wegen Müdigkeitslevel + Schema-Migration-Scope-Drift.

## Pre-Launch-Phase A — Block 4: Self-Hosting-Polish

Items aus dem Strategy-Pivot Tag 18. Block 4 macht das Repo für externe Tech-Affine deploybar. Spec: `docs/PRE-LAUNCH-A-STRATEGY.md`.

## Pre-Launch-Phase A — Block 5: Launch-Vorbereitung

Items aus dem Strategy-Pivot Tag 18. Block 5 bringt das Repo öffentlich und koordiniert den Launch-Push. Spec: `docs/PRE-LAUNCH-A-STRATEGY.md`.

### 112. Landing-Page für Self-Hosting-Launch (minimal)
Minimale Landing-Page als Anlauf-Stelle für Twitter/HN-Traffic. Kein voll-designtes Marketing-Site, eher README-Style mit visuellen Highlights.

**ARCHITEKTUR GESETZT (Tag 35):** eigenes Repo (`nolmi-ai/nolmi-web`) **auf Vercel**, `nolmi.ai`-Apex → Vercel (s. Item „Web-Präsenz-Architektur"). NICHT im Produkt-Monorepo, NICHT der `nolmi-apex`-Container (der wird danach abgelöst).

**PITCH STEHT (Tag 35, Positionierungs-Session):** Hero **„Be present, without being always available"**; **3 persönliche Nutzen** führen; **A2A als nachgeordneter 4. Punkt** (nicht der Aufhänger); Trade-off-Satz; npm-Install (`npm i -g nolmi`); AGPL; pre-launch-Hinweis. Quick-Start → GitHub/DEPLOYMENT.md. Footer Kontakt. Screenshots/Mini-GIFs (#113, Light-Branding).

> Hinweis: Der alte Hero-Entwurf („Memory Depth and Inter-Twin Communication") ist **überholt** — er führte mit dem Infrastruktur-Feature; die Positionierung stellt den **persönlichen Nutzen** voran.

**Größe:** M · **Priorität:** must · **Aus:** Pre-Launch-Phase-A-Strategy (Block 5) · **Spur:** Pre-Launch-Phase A

### 113. Demo-Video oder schriftlicher Walkthrough (5–10 Min)
Tech-Affine entscheiden in den ersten 60 Sekunden, ob ein Tool für sie relevant ist. Demo-Material reduziert „ich-müsste-es-erst-selbst-aufsetzen"-Hürde.

Format-Optionen:
- **Video (5–10 Min):** Screen-Capture mit Voice-Over. Zeigt Erst-Login, Twin-Anlage, erste Konversation, Memory-Sichtbarkeit, A2A-Demo mit zwei Twins, Recherche-Beta-Hook
- **Schriftlicher Walkthrough:** Markdown-Doc mit Screenshots, Schritt-für-Schritt-Story. Weniger Aufwand als Video, aber weniger Wirkung
- **Hybrid:** Schriftlicher Walkthrough plus eine kurze 60-s-GIF oder Embed-Video als Hero

Pragmatisch: schriftlich + 60-s-GIF reicht für Launch.

**Größe:** S · **Priorität:** must · **Aus:** Pre-Launch-Phase-A-Strategy (Block 5) · **Spur:** Pre-Launch-Phase A

### 114. Launch-Post-Drafts (Twitter-Thread + HN-Submission)
Konkrete Drafts vorbereiten, nicht spontan launchen.

- **Twitter-Thread (5–8 Tweets):** Story-Bogen „Why I built this", Differenzierungs-Story, Screenshots, Quick-Start-Link
- **Hacker-News-Submission:** „Show HN: Nolmi — [tagline]". Title-Optimization, Body mit Context, Quick-Start-Link
- **Reddit:** evtl. r/LocalLLaMA, r/SelfHosted, r/MachineLearning. Subreddit-Auswahl strategisch
- **Discord/Slack-Communities:** AI-Engineer-Discord, Anthropic-Discord, etc.

Drafts werden vor Launch reviewed (Florian punktuell). Launch findet als koordiniert kurzer Push statt.

**Größe:** S · **Priorität:** must · **Aus:** Pre-Launch-Phase-A-Strategy (Block 5) · **Spur:** Pre-Launch-Phase A

### 115. Launch-Timing-Plan
Optimal-Timing für Public-Launch:

- **Wochentag:** Dienstag oder Mittwoch (HN-Algorithm-Optimum, Twitter-Engagement-Optimum für Tech-Audience)
- **Uhrzeit:** 9–10 Uhr US-East-Coast (15–16 Uhr Berlin) für HN-Erstposition
- **Vorab-Schritte:** README finalisiert, DEPLOYMENT.md getestet, Demo-Material live, Landing-Page deployed, alle Tweets/Posts draft fertig
- **Tag selbst:** HN-Post zuerst, dann Twitter-Thread mit HN-Link, dann Communities, dann observieren und auf Kommentare reagieren

**Größe:** XS (Doku-Item) · **Priorität:** must · **Aus:** Pre-Launch-Phase-A-Strategy (Block 5) · **Spur:** Pre-Launch-Phase A

## Pre-Launch-Phase B — Vision-Material

Items, die konzeptuell aus Vision Block 2.5/4 fallen aber jenseits des Self-Hosting-Launches liegen. Strategy-Sessions vor dem Bau jeweils Pflicht — die hier festgehaltenen MVP-Skizzen sind keine Bau-Briefings.

### 118. Konversations-Lifecycle-UI (Beenden / Löschen / Reset)

User kann A2A-Konversationen heute weder beenden noch löschen. Die DB kennt `conversations.status: 'active' | 'ended'`, aber UI hat keinen Trigger. Plus: List-Endpoint liefert `status: null` (Schema-Diskrepanz zum Detail-Endpoint).

**Strategy-Fragen vorab:**

- **Reset vs End vs Delete:** Was bedeuten die drei semantisch?
  - **Reset:** Audits bleiben in DB, UI versteckt sie hinter Divider (heutige DirectChat-Logik, `chat/[handle]/page.tsx:171`)
  - **End:** `status = 'ended'` in DB, Konversation taucht in Liste nicht mehr auf, Audits bleiben
  - **Delete:** DB-Row weg, Audits weg, Kontext für Memory weg (?)
- **Sichtbarkeit ended-Konversationen:** Filter-Toggle "auch beendete anzeigen"? Eigene Section?
- **Re-Activation:** Kann beendete Konversation reaktiviert werden durch erneutes Senden? (UNIQUE-Constraint auf (owner, partner, twin)+status='active' erlaubt das technisch)
- **Bridge-Sync:** Was passiert wenn @markus eine Konversation beendet aber @florian noch im aktiven Stand ist?

**Hängt zusammen mit:**
- #106 DirectChat-View-Architektur (Variante B Soft-Hide ist verwandtes Konzept)
- #96 Empty-State-Architektur

**Plus Sub-Bug:** List-Endpoint sollte `status` mitliefern statt `null`. Quick-Fix als Teil dieses Items.

**Aufwand-Range:**
- Quick (nur Backend-Schema-Fix + Beenden-Button): M
- Full (Reset/End/Delete sauber getrennt + Re-Activation + UX): L+

**Größe:** L (mit Strategy-Session) · **Priorität:** should · **Aus:** #105-Bau Tag 19 Vormittag · **Spur:** Pre-Launch-Phase A Block 2 oder später

---

## Lessons gelernt

Sammlung an Erkenntnissen aus Live-Tests und Implementierungs-Bugs. Kurz, abstrakt, sofort anwendbar.

### Lesson (2.5.4): Auth-State-Übergänge brauchen Hard-Navigation

`router.push` / `router.replace` / `router.refresh` lassen Komponenten gemountet — Auth-State im React-`useState` überlebt die Navigation und ist stale. `window.location.href` triggert Full-Mount, neuer Auth-State garantiert konsistent. Phase-2.5-Lösung pragmatisch. Echte Lösungen für später: Context-Provider mit Invalidation, React Query mit Tag-Invalidation, Server-Components mit `cookies()`.

### Lesson (2.5.4): CORS-Wildcard ist mit credentials inkompatibel

Bei credentialed Requests (`fetch credentials:include`, `EventSource withCredentials:true`) muss der Server eine konkrete Origin-Adresse zurückgeben — nicht Wildcard `*`. Plus `Access-Control-Allow-Credentials: true`. Browser lehnen sonst Response ab. Trap besonders bei SSE: `reply.raw.writeHead` umgeht den `@fastify/cors`-Plugin, daher manuell setzen.

### Lesson (2.5.4): Plugin-Major-Matching prüfen

`@fastify/cookie@latest` war zur Zeit der Installation noch Fastify-4-kompatibel (v9). Bei Fastify-5-Setup explizit `^11` angeben. Generell: bei `pnpm add` für `@fastify/*`-Plugins die Compat-Range prüfen, nicht blindlings latest. Die Plugin-Major-Versionierung folgt der Fastify-Major-Versionierung, aber nicht 1:1 in der Versionsnummer.

### Lesson (2.5.4): localhost vs. 127.0.0.1 sind verschiedene Origins

Auch wenn beide auf 127.0.0.1 auflösen, behandelt der Browser sie für Cookies und CORS als verschiedene Origins. Cookies gesetzt unter `localhost:3000` werden bei einem Fetch gegen `127.0.0.1:4000` nicht mitgesendet. Konsistent eine Form durchziehen — bevorzugt `localhost`.

### Wisdom (Markus, 2.5.4): Frontend-Public/Backend-Protected ist eine saubere Trennung

Beispiel: `/onboarding` ist als Frontend-Route public (User soll Account anlegen können), aber `/onboarding/submit` + `/onboarding/validate-api-key` sind Backend-protected (brauchen Login). Die Trennung erlaubt UI-Flow ohne Pre-Login, sichert aber Datenmutation. Pattern lässt sich auf weitere Onboarding/Funnel-Pages übertragen.

### Lesson (2.5.4.1.1): Bridge-Schema braucht Message-Type-Markierung von Anfang an

Wenn Bridge mehrere Message-Typen transportiert (Twin-Antworten, System-Wartemeldungen, ggf. später Acknowledgments), muss der Typ im Schema explizit sein. Sonst behandeln Empfänger jede Message gleich, was zu Loops führt: Wartemeldung → Empfänger sieht neue Anfrage → Wartemeldung zurück → Loop. Migration 002 hat das nachträglich gefixt, aber bei Schema-Design sollte Message-Typ-Feld immer drin sein, auch wenn aktuell nur ein Typ existiert. Konzeptionell: Bridge ist Transport-Schicht, Transport-Schicht muss Payload-Typ kennen.

### Lesson (2.5.4.2): Reply-Detection braucht persistente Sender-Information

Reply-Detection im Twin-Service kann nicht aus dem aktuellen Message-Payload allein entscheiden, ob eine Message eine Reply ist. `inReplyTo` zeigt nur auf eine Message-ID — wer die ursprüngliche Message gesendet hat, weiß nur die Bridge. Heißt: Reply-Detection braucht einen Lookup-Endpoint auf der Bridge (`GET /messages/:id/sender`). Generelle Lehre: Twin-zu-Twin-Logic ist nicht autark — Bridge ist mehr als Transport, sie ist auch Identitäts-Authority für vergangene Messages.

### Lesson (2.5.4.2): User-initiierte erste Send-Message ohne inReplyTo bricht Reply-Detection nicht, aber den Symmetrie-Sinn

Beim ersten Modal-Send von Markus an Florian gibt es kein `inReplyTo`. Florian's Twin sieht das als neue Anfrage, triggert Mandate-Check oder Trusted-Bypass. Das ist konzeptionell richtig (User startet bewusst Konversation), aber bedeutet: erste Send eines neuen Konversations-Threads geht durch Approval-Flow, alle Folgen-Messages sind Replies. Kein Bug, aber Designentscheidung mit Konsequenz. Plus: bei Trust kein Issue, weil Trusted-Twin direkt durchgeht.

### Lesson (2.5.4.3): UI-Reorganisation lohnt sich, wenn konzeptionelle Trennung schief ist

Settings-Page mischte Konfiguration und Aktivität. Reorganisation in zwei Pages (`/settings` für Konfig, `/inbox` für Aktivität) hat den Code nicht nur sauberer gemacht, sondern auch die Mental-Models klarer: Settings ist „was ich konfiguriere", Inbox ist „was ich erledige". Verschieben kostet 1-2 Stunden, aber rettet Wochen an „warum liegt das hier"-Frust später.

### Lesson (Status-Konsistenz): 5-Minuten-Quick-Fixes lohnen sich vor Backlog-Items

Status-Konsistenz-Fix (`approved` → `executed` für drei Bypass-Pfade) hätte ein Backlog-Item werden können. Statt dessen direkt gefixt, plus typecheck plus Frontend-Filter-Audit — 15 Minuten total. Backlog-Items mit „kosmetische Verbesserung" sind Tech-Debt, der nie angegangen wird, weil immer wichtigere Sachen anstehen. Wenn ein Fix in einer Datei mit klarer Reichweite ist und keine Testing-Reichweite hat, ist „direkt fixen" robuster als „Backlog-Item, machen wir später".

### Lesson (Workflow): Pro Sub-Schritt ein eigenes Chat-Fenster

Heute drei Sub-Schritte plus mehrere Bug-Hunts in einem Chat-Fenster. Output: Chat wurde so lang, dass Logs nicht mehr sauber teilbar waren, plus Memory-Drift bei längeren Sessions. Saubere Lehre: ein Sub-Schritt → ein Chat-Fenster, am Ende Commit + Backlog-Update. Beim nächsten Sub-Schritt frischer Chat. Plus pro Bug-Hunt-Session, die länger als 30 Min wird, separates Fenster.

### Lesson (Workflow): Komplexe Multi-Phase-Projekte brauchen ein eigenes Claude-Projekt

Bisherige Chats lebten ohne Projekt-Kontext, mit Memory aus allgemeinem HARWAY-Account. Ergebnis: bei jedem neuen Chat musste ich rekonstruieren, wo wir stehen. Plus Memory-Drift (Production-Bridge-Architektur war nicht aktiv abrufbar heute Vormittag). Lösung: eigenes Claude-Projekt „twin-lab" mit Roadmap, Backlog, Persona-Files, STAND.md hochgeladen. Memory-Trennung, Project Knowledge, sauberer Chat-Cut pro Sub-Schritt. Fünfzehn Minuten Setup, danach jede Session 30+ Minuten gespart.

### Lesson (Test-Skripte): Test-Setups müssen den primären User-Flow simulieren

`test-trust-flow.ts` testet drei Vertrauensstufen, aber simuliert keinen kompletten Reply-Cycle (Send → Approval → Reply mit `inReplyTo`). Reply-Detection wurde dadurch im Skript nicht testbar, obwohl im Live-Test (manuell via Browser) verifiziert. Generelle Lehre: Test-Skripte sollten zuerst den Hauptpfad abdecken, nicht synthetische Edge-Cases. Plus: false-negative im Test-Skript ist schlimmer als kein Test, weil es Vertrauen in Funktionalität untergräbt.

### Lesson (#45): STAND.md-Drift gegen Realität ist real

STAND.md sagte "Production-Bridge live", die Realität war "Container weg, Volume jungfräulich, Setup nicht aufgeräumt". Drei Tage Drift haben gereicht. Vermutlich am 1. Mai testweise gebaut, dann abgeräumt, im STAND-File aber als "live" stehen gelassen — oder umgekehrt: STAND-File geschrieben, dann Container gestoppt und vergessen zu aktualisieren. Lehre: vor jeder Phase einen Sanity-Check gegen die echte Welt machen, nicht nur gegen das, was STAND-Files behaupten. Konkret bei #45: 5 Minuten Pre-Flight-Check (`docker ps`, `curl /health`) hätte uns 30 Minuten Falsch-Annahmen erspart. Pattern für die Zukunft: am Anfang jedes neuen Sub-Schritts ein einseitiger "Reality-Check"-Block, der prüft was die Annahmen aus STAND/Backlog tatsächlich sagen.

### Lesson (#45): Reine Lese-Befehle vor jeder Aktion zahlen sich aus

Der Plan hatte bewusst eine "Pre-Flight Checks (auf VPS, ohne was zu ändern)"-Phase, bevor irgendwas gelöscht oder gebaut wurde. Hat sich gelohnt: ohne diesen Schritt hätten wir versucht, eine "existierende" Bridge zu migrieren, die gar nicht existiert. Generelles Pattern: Ein Sub-Schritt teilt sich immer in (1) Sicht holen, (2) Plan schreiben, (3) Aktion. Nicht (1) und (3) zusammenwerfen, auch wenn der Plan kurz ist.

### Lesson (#45): Volume-Labels verraten Vergangenes

Volume-Label `com.docker.compose.project: docker` plus `bridge_data` zeigte: ehemaliges Setup lag in einem `docker/`-Verzeichnis, nicht in einem app-spezifischen Folder. Das ist bei Docker-Compose der Default, wenn Project-Name nicht explizit gesetzt wird. Lehre: bei neuem Setup immer `name:` top-level im Compose-File setzen, sonst werden Container und Volumes mit dem Verzeichnis-Namen geprefixt — was bei Umzug oder Re-Deploy für Verwirrung sorgt.

### Lesson (#59): Briefings sollten Backlog-Annahmen explizit machen

Briefing für Claude Code formulierte „End-to-End Reply-Detection 
funktioniert" als Akzeptanzkriterium und verwies auf das Trust-Flow-
Skript. Das Skript hat aber laut Backlog-Item #46 false-negative bei 
Step 6 — was Claude Code nicht wissen konnte. Bei Briefings für 
isolierte Code-Sessions: bekannte Test-Skript-Limits explizit 
erwähnen, sonst wird ein false-negative-Skript als Verifikation 
genommen.

### Lesson (#59): Existence-Leak vs. Debug-Freundlichkeit ist eine 
bewusste Entscheidung

`/messages/:id/ack` (Zeile 244-261) gibt 403 bei nicht-für-dich, 
404 bei nicht-existent — klassisches REST, debug-freundlich, leakt 
Existence. `/messages/:id/sender` gibt jetzt 404 für beide Fälle — 
identische Body, kein Existence-Leak. Trade-off bewusst getroffen 
beim sensitiveren Endpoint. Generelle Lehre: Konsistenz innerhalb 
einer App ist nicht immer das richtige Ziel — die Schutz-
Anforderungen entscheiden, nicht das Pattern.

### Lesson (#59 Production): Vorher/Nachher-Curl macht Auth-Deploys 
verifizierbar

Vor dem Deploy: `curl -i $BRIDGE/messages/$ID/sender` ohne Token → 
404 (alter Stand, keine Auth). Nach dem Deploy: identisches Curl → 
401 (neuer Stand, Auth aktiv). Das eine Curl-Paar ist der härteste 
End-to-End-Beweis, dass der neue Code wirklich live ist — härter als 
„Container restart hat geklappt" oder „Logs sehen okay aus". Bei 
jedem Auth-Hardening-Deploy künftig diesen Vorher/Nachher-Snapshot 
machen, dann hat man's schwarz auf weiß.

### Lesson (#63): Settings-UI-Lücken werden plötzlich Pflicht

API-Key-Edit war im Backlog als „später" verbucht (#10 UI-Bearbeitung 
von Persona/Mandates) — bis ein revokter Key das „später" zu „jetzt 
sofort" gemacht hat. Lehre: bei Sub-Schritten, die externe Credentials 
in Klartext oder verschlüsselt persistieren, muss es entweder UI-Edit 
geben oder ein klar dokumentierter CLI-Pfad. Sonst ist man im Notfall 
gezwungen, ein Tool unter Druck zu bauen. Nächstes Mal beim Persistieren 
sensibler Werte: gleich überlegen, wie Rotation aussieht.

### Lesson (Workflow): Ein Sub-Schritt mit zwei Commits ist okay, 
aber getrennt halten

Tag 4 Abend hatte zwei verwandte aber konzeptionell getrennte 
Änderungen — #59 Bridge-Auth und #63 CLI-Tool für Key-Rotation. 
Beide an einem Abend gemacht, zwei separate Commits (`7662dad` für 
#59, `8783d97` für #63). Sauberer als ein gemeinsamer „Tag 4 Abend"-
Commit, weil `git log --grep "#59"` nur den Auth-Code zeigt, nicht 
das CLI-Tool. Pattern für künftige Mehrfach-Sub-Schritte: trotz 
zeitlicher Nähe getrennt committen, wenn sie unterschiedliche 
Backlog-Items betreffen.

### Lesson (#64): Deploy-Key statt User-Key oder PAT als Default 
für VPS-Setups

Bei VPS-zu-GitHub-Auth gibt es drei Wege: Personal Access Token 
(user-wide, läuft ab), User-SSH-Key (voller Repo-Zugang von dieser 
Maschine) oder Repo-spezifischer Deploy-Key (read-only, ein Repo). 
Letzterer ist der sauberste — minimaler Scope, kein Ablaufdatum, 
read-only-Default. Bei VPS-Kompromittierung ist der Schaden 
begrenzt: nur ein Repo lesbar, kein Push möglich, andere Repos 
unberührt. Pattern für alle künftigen VPS-Setups: Deploy-Key, 
nicht Password und nicht User-Key. PAT nur als Notlösung wenn 
SSH-Pfad blockiert ist.

### Lesson (#64): Sub-Schritt-Pattern für nicht-Repo-zugängliche 
Sessions

Heute Vormittag war Repo-Zugang im Chat nicht möglich (privates 
GitHub-Repo, kein MCP-Connector), aber der Sub-Schritt brauchte 
ihn auch nicht: #64 ändert reine VPS-Konfiguration (SSH-Config, 
Remote-URL, Deploy-Key bei GitHub), kein Code im Repo. Heißt: 
Sub-Schritte lassen sich in drei Klassen einteilen, jede mit 
eigener Werkzeug-Anforderung:

- **Code-Sub-Schritte** (Server, Frontend, neue Files): brauchen 
  Repo-Sicht. Heute paste-n betroffener Files reicht für isolierte 
  Sub-Schritte (siehe #59-Pattern).
- **VPS / DevOps / Konfig-Sub-Schritte** (#45, #59-Production-
  Deploy, #60-Production-Deploy, #64): brauchen kein Repo, nur 
  SSH-Zugang. Werden vom User selbst auf VPS ausgeführt, 
  Outputs werden im Chat interpretiert.
- **Strategie / Doku / Konzept** (v2.1 heute morgen): brauchen 
  weder Repo-Zugang noch VPS, sondern Diskussion und 
  Synthese-Arbeit.

Implikation für Sub-Schritt-Planung: erst Klasse bestimmen, dann 
Werkzeug-Setup wählen. Spart das wiederkehrende „kann ich aufs 
Repo zugreifen?"-Hin-und-Her.

### Lesson (2.5.6 A.1): Suspense-Boundary am Verbraucher, nicht in der Komponente

`useSearchParams()` und andere Client-only-Hooks brechen Static-Generation, wenn die Komponente nicht in einem Suspense-Boundary steckt. Zwei Patterns möglich: Suspense in der Komponente selbst (Wrap-internal) oder Suspense beim Verbraucher (z.B. `<Suspense><AppHeader/></Suspense>` im Layout). Pattern b) gewann, weil:
- AppHeader/AppFooter bleiben einfach lesbar (keine eigene Suspense-Logik intern)
- Layout entscheidet einmal über Loading-Verhalten der Nav
- `fallback={null}` reicht — Nav darf für 50ms „weg" sein, kein UX-Problem

Anti-Pattern: `useSearchParams` einfach durch `usePathname` ersetzen, um den Hook zu vermeiden — verliert Funktionalität. Lieber Suspense.

### Lesson (2.5.6 A.2): packages/shared braucht eigenes dist/ für Produktion

Lokale Entwicklung mit `tsx` und Next-dev-Auflösung verzeiht `main: "src/index.ts"`. Production-Container-Node ohne tsx-Loader bricht mit ERR_UNKNOWN_FILE_EXTENSION. Diagnose ist nicht offensichtlich — der Build läuft durch, der Container startet, das Failure passiert erst beim ersten Import.

Pattern: shared baut explizit nach `dist/`, `package.json` zeigt mit `main`/`types`/`exports` darauf, `files: ["dist"]` für pnpm-deploy. predev-Hook in jeder App, damit lokale Entwicklung weiter ohne manuellen Build-Schritt funktioniert. Dockerfiles bauen shared explizit vor App-Build.

Allgemeineres Prinzip: shared-Packages in einem Monorepo brauchen ein klares Production-Artefakt, sonst rächt sich die lokale Bequemlichkeit beim ersten Container-Build.

### Lesson (2.5.6 A.3): Hot-Reload-Pattern für Multi-Tenant-Onboarding

Vorher-Annahme war: Boot-Code läuft einmal, lädt alle Twins aus DB, Server läuft. Wenn neuer Twin angelegt wird → Restart. Das brach, sobald Onboarding möglich war.

Pattern für Multi-Tenant: Server akzeptiert leere DB als gültigen Onboarding-only-Modus, Registry hat `addTwin(id)`-Methode mit Mutex gegen Race-Conditions. Hot-Reload heißt nicht „Code-Reload", sondern „in-Memory-State-Update bei DB-Änderung". 

Wichtige Detail: Mutex über Promise<void>-Map, nicht boolean-Lock. Erst-Caller löst Promise aus, parallele Caller awaiten denselben Promise — niemand startet zweiten Init. Idempotent ist die `addTwin`-Methode auch: zweiter Aufruf für denselben Twin gibt cached Result zurück.

### Lesson (2.5.6 A.4): NEXT_PUBLIC ist nicht Runtime-ENV

Wer das erste Mal Next deployed, läuft in diese Falle: `NEXT_PUBLIC_*` heißt nicht „dynamische Runtime-Variable für den Browser", sondern „Compile-Zeit-Konstante, die ins Client-Bundle inlined wird". Compose-`environment:` setzt sie zur Runtime — zu spät.

Pattern: ARG/ENV im Dockerfile-Builder-Stage, `--build-arg` beim `docker build`. README-Eintrag mit Beispiel-Aufruf. Wer das nicht weiß, debuggt stundenlang gegen ein hartcodiertes `localhost:4000` im Bundle.

Allgemeineres Prinzip: bei statischem Site-Build ist „Browser-zugängliche Variable" = „Build-Zeit-Konstante". Runtime-Konfigurierbarkeit gibt's nur über Server-Komponenten oder API-Calls.

### Lesson (2.5.6 A.5): Cross-Subdomain-Cookies brauchen explizite Domain

Cookie ohne `Domain`-Attribut bleibt auf der setzenden Subdomain. Wenn Frontend (`app.*`) und Backend (`runtime.*`) verschiedene Subdomains sind, schickt der Browser den Cookie nur zur Backend-Subdomain — Frontend hat ihn nicht, Login funktioniert nicht obwohl POST-Login 200 zurückgibt.

Fix-Patterns, von schmutzig zu sauber:
1. **Cookie mit Domain=.parent.tld** (heute gewählt) — Browser schickt Cookie an alle Subdomains. Erfordert ENV-getriebene Konfiguration, weil lokale HTTP-Setups keinen Domain-Cookie wollen.
2. **Same-Origin via Reverse-Proxy** (Backlog #65) — alle Calls gehen über `app.*`, Path-Prefix `/api/*` routet zur Runtime. Cookie bleibt automatisch am Origin.
3. **Token im Body statt Cookie** — JWT in localStorage, kein Cookie-Problem mehr. Aber: XSS-Risiko, Logout schwerer, Auth-Header bei jedem Call.

Heute: Variante 1, weil schnellste Lösung mit kleinstem Patch (zwei ENVs, ein Helper). Variante 2 als Backlog für später.

### Lesson (2.5.6 Hairpin): Container-zu-Container-Hop schlägt Public-URL

Naive Annahme im Multi-Container-Setup auf einem Host: Container A ruft Container B via dessen Public-URL. Realität: viele VPS-Provider blocken Hairpin-NAT, Connect-Timeout. Plus: TLS-Overhead, DNS-Lookup, Bandbreite.

Pattern: Container im selben Docker-Network, Hostname = Container-Name (`http://twin-lab-bridge:5100`). Schneller, zuverlässiger, kein Hairpin nötig. ENV-getriebener Pfad, damit lokal weiter Public-URL gehen kann.

Diagnose-Hilfe: bei Connect-Timeouts in Multi-Container-Setups als allererstes prüfen, ob es Hairpin-NAT ist. Symptom: Container kann Public-URL des Hosts nicht erreichen, Container kann andere Public-URLs erreichen.

### Lesson (2.5.6 Bridge-Cleanup): Pre-existing State ist Production-Reality

Bridge stand seit 3. Mai mit drei Test-Handles (markus/florian/heiko). Web-Stack vom 4. Mai mit eigener leerer DB versucht dieselben Handles neu zu registrieren → Bridge meldet „existiert bereits". Cleanup-Pfad: alte Handles via Volume-Mount in alpine-Container mit sqlite3 löschen.

Pattern für künftige Re-Bootstraps: vor Onboarding immer pre-existing State des Backend-Stores verifizieren, ggf. cleanen. In CI-/Test-Setups sowieso, in Production bei expliziten Migration-Schritten.

Allgemeineres Prinzip: in Multi-Service-Architekturen ist „leerer Anfangszustand" oft Wunschdenken. Service A weiß nichts von Service B's State, Aufstartreihenfolge kann zu phantom-konflikten führen.

### Lesson (2.5.6 Workflow): Sub-Schritt-Disziplin bei langen Sessions

Heute: 11 Stunden Pair-Programming, 8 Code-Commits, 6 Phase-Markierungen (A, A.1-A.5). Disziplin „ein Sub-Schritt, ein Commit, ein Caveat-Check, dann nächster Sub-Schritt" hat verhindert, dass Bugs sich verschachteln. Gegenbeispiel: ohne Disziplin hätten Suspense-Bug, shared-Build-Bug, NEXT_PUBLIC-Bug, Cookie-Bug ein einziges 4-Stunden-Bug-Hunt-Knäuel werden können — keiner identifizierbar isoliert.

Pattern: jeder Sub-Schritt hat (a) klares AK, (b) klaren Diff-Scope, (c) klares „durch wenn"-Kriterium. Briefing dokumentiert die drei Punkte, dann Implementation, dann Verifikation, dann nächster Sub-Schritt — neues Briefing.

Schwellenwert für Sub-Schritt-Aufteilung: wenn ein Bug-Hunt > 30 Minuten dauern würde, dann ist der Bug ein eigener Sub-Schritt mit eigenem Commit, nicht „noch im aktuellen Schritt mitgemacht".

### Lesson (Tag 6 / #43): Reality-Check vor Briefing-Schreibung

#43 stand seit drei Tagen im BACKLOG als „should". Vor dem Briefing-Schreiben kurzer Check des aktuellen Codes (`AppHeader.tsx`) — und siehe da, der Fix war längst drin. Implementiert in 2.5.4 UX-Iteration Briefing #19, ohne als Backlog-Item-Erledigung notiert worden zu sein.

Lesson: Bevor man ein Briefing schreibt, einmal den aktuellen Code lesen. Drei Minuten Reality-Check sparen 30 Minuten Briefing-Schreibung plus Live-Test. Ist konsistent mit dem `git status` / `docker ps` / `curl /health` Pre-Flight-Check aus #45.

Pattern: jeder Sub-Schritt beginnt mit einem 2-3-Zeilen-Reality-Check. Was ist heute der Code-Stand? Existiert der Bug noch? Welche Files sind beteiligt? Erst dann Briefing.

### Lesson (Tag 6 / #71): Capability-Naming-Disziplin

#71 brauchte zwei Commits, weil die erste Implementation nur auf `respond_to_chat` filterte — aber Owner-Bypass-Pfad schreibt `owner-direct`. Beide sind konzeptionell „Direct-Chat-Audits", werden aber mit unterschiedlicher Capability persistiert (Trade-off aus 2.5.4.1 Architektur-Entscheidung).

Subtler Punkt: das Audit-Schema hat ein `originalCapability`-Feld in `input`, das bei `owner-direct` auf `respond_to_chat` zeigt. Hätte das Frontend dieses Feld als Filter-Source genutzt, wäre die Capability-Verzweigung im Frontend transparent gewesen.

Generelle Lehre: bei Bypass-Architekturen entstehen mehrere Capabilities für dasselbe konzeptionelle Ereignis. Frontend-Filter sollte alle Varianten berücksichtigen, oder Backend sollte Bypass-Markierung anders auflösen (z.B. Capability gleich, separates `bypassed: true`-Feld).

Pattern für künftige Multi-Capability-Filter: `Set<string>`-Konstante am File-Anfang, kommentiert warum mehrere Capabilities gleich behandelt werden. Macht es zukunftssicher gegen weitere Bypass-Pfade.

### Lesson (Tag 6 / #71): Spec-Deviations dokumentieren, nicht zurückdrängen

Briefing schrieb `input.messages[0].content` als Render-Source. Claude Code hat im Code geprüft (`twin-service.ts:106,130`) und gesehen, dass `input.messages` kumulativ ist — `[0]` wäre N-mal die Erst-Message. Stattdessen `input.lastMessage` benutzt, mit Code-Referenz als Begründung.

Das ist genau der richtige Move. Briefing-Spec ist Vorgabe, aber nicht heilig. Wenn Claude Code im Code sieht, dass die Spec falsch ist, soll es korrigieren, nicht stumm umsetzen oder rückfragen. Wichtig: die Korrektur klar kennzeichnen („Spec-Deviation: ..."), Begründung mit Code-Referenz, und das Briefing im Nachgang aktualisieren.

Pattern: Briefing ist Hypothese, Code-Realität ist Truth. Bei Konflikt gewinnt Code, mit dokumentierter Begründung.

### Lesson (Tag 6 / Hydration-Phantom): ENV-Var-Änderungen brauchen Hard-Reload

`next dev` Hot-Reload räumt das Bundle bei ENV-Variable-Updates nicht zuverlässig. Symptom: Hydration-Error nach `--build-arg`- oder `process.env`-Änderungen, der nach Hard-Reload (Cmd+Shift+R) komplett verschwindet.

15 Minuten Diagnose verloren, weil ich versucht habe den Bug logisch zu erklären, statt einfach Hard-Reload als ersten Reflex zu nutzen.

Pattern für künftige Frontend-Sessions: bei jedem File-Save in `.env*`, `next.config.mjs`, oder Dockerfiles → einmal Hard-Reload, bevor Bug-Diagnose anfängt. Spart Phantom-Bugs.

### Lesson (Tag 7 / 3.1.B): Pattern aus 2.5.4.1 als Vorlage für neues Subsystem

3.1.B hat 7 Minuten Code-Zeit gebraucht, weil Trust-Layer aus 2.5.4.1 das Pattern vorgegeben hat: DB-Repo + Routes-Funktion + Registry-Dependency-Injection + Test-Skript mit Mock-LLM. Skill-System ist konzeptionell ein anderes Domain, aber strukturell exakt dieselbe Architektur.

Generelles Prinzip: bei neuen Multi-Tenant-Features in twin-lab — Mandate-System, Trust-Layer, Skill-System, später Memory-Schichten — ist das Pattern „Pro-Twin-Tabelle + Repo + DI über Registry + Routes-Funktion + Mock-Test" robust genug, dass Briefings 1:1 auf existierende Code-Stellen referenzieren können statt freihändig zu spezifizieren.

Briefings für künftige Phase-3-Sub-Schritte sollten bewusst auf diese Vorlage zeigen — spart Code-Zeit und macht Architektur konsistent.

### Lesson (Tag 7 / 3.1.D): Briefing-Pfad-Bug bei pnpm-filter-Aufrufen

Im 3.1.D-Briefing standen Verifikations-Befehle wie `pnpm --filter @twin-lab/runtime twin:skill-create @markus apps/runtime/skills-templates/_test-skill`. Lief auf `apps/runtime/apps/runtime/skills-templates/_test-skill` — `apps/runtime/`-Prefix wurde doppelt, weil `pnpm --filter` bereits ins Workspace-Verzeichnis wechselt.

Korrektur: relativ zum Workspace aufrufen (`skills-templates/_test-skill` ohne Prefix), oder absoluten Pfad nutzen. Claude Code hat den Bug nicht erkannt, weil das Briefing eindeutig formuliert war — der Bug war konzeptionell auf User-Ebene (Pfad-Auflösung), nicht im Code.

Pattern für künftige Briefings mit pnpm-filter-Aufrufen: explizit notieren, dass Pfade relativ zum Filter-Target sind. Oder besser: Beispiele mit absoluten Pfaden geben, die garantiert funktionieren.

### Lesson (Tag 7 / Cleanup): tsx-Inline-Eval kann keine relativen Imports auflösen

Cleanup-Skript für 3.1.D-Test sollte als `pnpm exec tsx -e "..."` mit `import { ... } from './src/...js'` laufen. Brach mit `Cannot find module './src/config.js'`, weil `tsx -e` die Source aus `[eval]` ausführt — `[eval]` hat keinen Filesystem-Anker, relative Imports lösen nicht auf.

Zwei pragmatische Workarounds: (a) Wegwerf-Skript als Tempfile schreiben, dann `tsx /tmp/cleanup.ts`, oder (b) SQL direkt nutzen (`sqlite3 data/twin.db "DELETE FROM ..."`). SQL ist schneller, sicherer (kein TS-Build-Pfad), und bei einfachen Cleanup-Operationen die richtige Wahl.

Pattern: für DB-Inspektion oder -Cleanup während Verifikation → erste Wahl ist sqlite3-CLI, nicht tsx-eval. Inline-tsx eignet sich nur für Multi-Step-Logik, die nicht mit SQL ausdrückbar ist.

### Lesson (Tag 7 / 3.1.E): Engine-Test ist verlässlicher als Browser-Test bei Persona-Confound

Browser-Test für 3.1.E (Skill-Toggle aus → Twin verliert Wissen) war kompromittiert, weil `docs/persona.md` denselben Workshop-Inhalt hatte wie der Skill. Twin antwortete trotz `is_active=0` korrekt — aus Persona, nicht aus Skill.

Engine-Test (`test-skill-engine.ts`) hat parallel grün durchlaufen mit isoliertem Mock-LLM und sauberer Schichten-Reihenfolge-Assertion. Damit war klar: Engine ist correctness-mäßig in Ordnung, der Browser-Confound ist ein Daten-Problem (Persona-Skill-Doppelung), kein Code-Bug.

Generelles Prinzip: bei verdächtigen Browser-Symptomen erst Engine-Test laufen lassen, dann debuggen. Engine-Tests sind Mock-LLM-basiert, schnell, deterministisch — Browser-Tests sind LLM-basiert, langsam, nicht-deterministisch. Bei Konflikt zwischen den beiden gewinnt der Engine-Test als Truth-Source.

### Lesson (Tag 7 / 3.1.E): UI-Payload-Filter als Konvention für Listen-Endpoints

Skill-DB-Records enthalten Manifest, SKILL.md, optional Script — alles potentiell groß. Listen-Endpoints sollen nicht alles ausliefern. 3.1.E-Pattern: Backend-Helper `toSkillUiPayload()` schneidet schwere Felder raus, ersetzt durch Char-Counts (`instructionsLength`) und Bool-Flags (`hasScript`).

Pattern für künftige Listen-Endpoints in twin-lab: separates UI-Payload-Schema in `packages/shared`, das die Wire-Form von der DB-Form trennt. Backend liefert UI-Form, Frontend importiert UI-Type. Macht Wire-Format vorhersehbar und erlaubt DB-Schema-Änderungen ohne Frontend-Auswirkung.

Verwandt: `instructionsLength` und `hasScript` als Pattern für „große Felder kompakt repräsentieren". Bei Memory-Schichten in 3.3 vermutlich wieder relevant (Conversation-Summary statt full History).

### Lesson (Tag 7 / Workflow): Vier Sub-Schritte am Vormittag ist Tempo-Ausreißer, nicht Norm

3.1.A bis 3.1.F (Modulo F als Daten-Op) an einem Vormittag — ungewöhnlich schnell. Faktoren, die das ermöglicht haben:

- Architektur war vor 3.1.A klar (Strategie-Session vorab)
- Pattern aus 2.5.4.1 als Vorlage (siehe vorige Lesson)
- Briefings waren detailliert und referenzierten existierende Code-Stellen (Trust-Routes, set-api-key-Tool)
- Verifikations-Schritte klar dokumentiert (Test-Skripte, Curl-Befehle, SQL-Inspect)

Schätzungen für 3.2 (MCP-Client) sollten NICHT auf diesem Tempo basieren. MCP ist ein Protokoll-Standard mit eigenen Edge-Cases (Stdio vs. HTTP-Transport, Tool-Schema-Validation, Server-Capabilities-Discovery), keine Trust-Repo-Variante. Zeitfenster-Annahme aus ROADMAP (1-2 Wochen) ist realistischer als „4 Stunden".

Generelles Prinzip: Tempo-Ausreißer als Datenpunkt nehmen, nicht als Baseline. Schätzungen kalibrieren sich erst nach 3-4 Sub-Schritten in einer neuen Domain.

### Lesson (Tag 7 / Strategie): Pre-Implementation-Strategie-Sessions sind Hebel

Vor 3.1.A gab's eine ~30-Min-Session, in der fünf Architektur-Entscheidungen festgelegt wurden (Hybrid-C, DB-Storage, Capability-Mapping, MCP-als-Source, Strategie-B). Die Entscheidungen waren so klar, dass die folgenden Sub-Schritte ohne weitere Architektur-Diskussion durchliefen.

Vergleich zu 2.5.6 (Production-Web-Deployment, Tag 5): viele kleine Architektur-Entscheidungen wurden ad-hoc während der Implementation getroffen (Container-zu-Container-Hop, Cookie-Domain via ENV, NEXT_PUBLIC als Build-ARG). Funktionierte auch, aber kostete mehr Bug-Hunt-Zeit.

Pattern: bei neuen Phase-Blöcken (3.2 MCP-Client, 3.3 Memory) zuerst eine Strategie-Session mit konkreten Architektur-Festlegungen. Erst dann Sub-Schritt-Briefings schreiben. Spart Implementation-Zeit, weil Claude Code Entscheidungen nicht selbst treffen muss.

### Lesson (Tag 7 / Production-Deploy): Lokaler predev-Hook versteckt Production-Bugs

`pnpm dev` ruft via `predev`-Hook automatisch `pnpm db:init` auf, bevor der Server startet. Lokal heißt das: jede neue Migration läuft beim ersten Dev-Start automatisch durch. In Production startet der Container direkt `node dist/index.js` — ohne Migration-Lauf.

Heute (Tag 7): Migration 008 (Skills-Tabelle) wurde gepullt, Image neu gebaut, Container neu gestartet — und failed bei jedem Skills-Endpoint-Aufruf mit `no such table: skills`. Ad-hoc-Fix war `docker compose exec runtime node /app/apps/runtime/dist/scripts/init-db.js`. Idempotent, hat sauber 008 angewendet.

Generelles Prinzip: **was lokal automatisch passiert (predev, postinstall, etc.) muss in Production explizit sein.** Andernfalls findet man die Diskrepanz erst beim Production-Deploy einer kritischen Migration. Hat heute keinen Schaden angerichtet (Migration ist additiv, System lief weiter), wäre bei `ALTER TABLE` und Code der die neuen Spalten erwartet ein Service-Crash.

Konkreter Pattern für künftige Container-Setups: alle predev/predeploy-Hooks aus `package.json` durchgehen, prüfen ob das Production-Equivalent (Dockerfile-CMD oder Compose-depends_on) sie abdeckt. Ist nicht der Fall — Backlog-Item, idealerweise vor dem nächsten Production-Deploy fixen.

Backlog-Item #77 dokumentiert die Lösungs-Optionen.

### Lesson (Tag 8 / #74): Engine-Test ist Truth-Source bei Persona-File-DB-Diskrepanz

Heute Vormittag verbrachten wir ~30 Min mit der Suche nach „warum nennt der Twin Workshops obwohl Skill aus und Persona-Block raus". Browser-Test zeigte: Twin antwortet wie vor der Persona-Edit. Annahme war: Toggle hat nicht durchgegriffen oder Server-Cache. Reality: Persona wird aus DB-Spalte `twin_profiles.persona_md` gelesen, nicht aus File. File-Edit allein wirkungslos.

Engine-Test (`test-skill-engine.ts`) hätte den Confound nicht aufgedeckt — er testet die Skill-Pipeline mit isolierter Mock-Persona, nicht den Server-Boot mit DB-Persona. **Aber:** der Engine-Test war ein wichtiger Datenpunkt zur Eingrenzung — er zeigte „Skill-System funktioniert in Isolation", was die Diagnose von „Toggle-Bug" auf „Persona-Source-Confound" verschob.

Generelles Prinzip: bei verdächtigen Browser-Symptomen Engine-Test als ersten Schritt laufen lassen. Wenn Engine grün UND Browser red: das Problem ist in der Daten-Pipeline (DB-State, Loading-Pfad, Cache), nicht in der Engine.

Verwandt mit Tag-7-Lesson „Engine-Test verlässlicher als Browser-Test bei Persona-Confound" — heute zweite Bestätigung des Prinzips, plus präzisierte Aussage: **Engine ≠ Pipeline**, beide brauchen separate Tests.

### Lesson (Tag 8 / #74): Architektur-Befunde finden sich beim Verifizieren, nicht beim Implementieren

#74 war als „kleiner Sub-Schritt ~30 Min" eingeschätzt. Tatsächlich: ~90 Min, davon ~30 Min Implementation und ~60 Min Diagnose plus drei neue Backlog-Items (#78, #79, #80) plus #71b-Hochstufung.

Der eigentliche Code-Diff ist trivial (8 Zeilen Persona-File-Edit). Der Wert kommt aus dem Verifikations-Prozess:
- File-Edit landet nicht in DB → #78 (Persona-Sync-Pfad fehlt)
- `persona`-Tabelle ist Phase-1-Altlast → #79 (Tidy-up via Migration)
- History verfälscht Tests → #80 (Reset-Pfad fehlt) + #71b-Hochstufung

Generelles Prinzip: bei Refactor-artigen Sub-Schritten die Verifikation nicht als „letzter Smoke-Test" sehen, sondern als **eigentlichen Erkenntnis-Phase**. Implementation ist mechanisch, Verifikation deckt Architektur-Lücken auf. Plan dafür eingeplant: 50% Implementation, 50% Verifikation plus Backlog-Updates.

### Lesson (Tag 8 / Wegwerf-Skripts): tsx mit absoluten Imports und async-main

Bei #74-Verifikation drei Mal in Wegwerf-Skripts gestolpert:
1. Relative Imports wie `./src/config.js` funktionieren nicht in tsx-Inline-Eval (`tsx -e "..."`) und auch nicht in Tempfiles, weil `[eval]` keinen Filesystem-Anker hat. Lösung: absolute Pfade in den Imports.
2. Top-Level-await funktioniert in tsx mit CJS-Output nicht (esbuild-Constraint). Lösung: alles in `async function main() { ... }; main().catch(...)` wrappen.
3. SQL-Direct-Insert mit Markdown-Inhalt ist Stress (Quoting, Newlines, Sonderzeichen). Wenn TS möglich: TS-Skript ist sicherer.

Pattern für künftige DB-Operations bei Verifikations-Phase:
- Strukturierter Repo-Code (TwinProfilesRepo, SkillRepo) statt Roh-SQL
- Tempfile statt `tsx -e`-Inline
- Async-Wrapper als Standard
- Absolute Pfade in Imports zum Workspace-Root

Drei Patterns sind heute drei Mal aufgetaucht — gehört in eine wiederverwendbare Skript-Vorlage. Vielleicht als `apps/runtime/src/scripts/_template.ts`-File mit Boilerplate, dass man kopieren kann.

### Lesson (Tag 8 / Process): `ps -o lstart=` ist macOS-inkompatibel

Versucht: `ps -p 35734 -o lstart=` um Server-Start-Zeit zu bekommen — zeigt auf macOS `Invalid process id: -o`. Auf Linux funktioniert das, auf BSD-`ps` (macOS-Default) andere Syntax.

Macht-OS-Workaround:
```
ps -p <PID> -o lstart
```
(ohne `=` am Ende) — funktioniert. Oder direkter:
```
ps -p <PID> -o etime
```
zeigt verstrichene Zeit seit Start.

Lesson für Cross-Platform-Briefings: ps-Optionen sind nicht portabel zwischen Linux und macOS. Wenn Briefing auf macOS-Dev und Linux-Server gleichzeitig laufen muss: entweder beide Varianten nennen oder eine Lösung wählen die auf beiden funktioniert (z.B. `stat -c %y /proc/<PID>` auf Linux, oder Process-Start aus Logs).

### Lesson (Tag 8 / #78): Helper-Extraktion bei zweitem Aufruf, nicht beim ersten

#78 hat einen kleinen Architektur-Effekt produziert: die Pfad-Resolution-Logik aus `bootstrap-twin.ts` (Markus = Default-Pfade ohne Suffix, andere = `-<handle>`-Suffix) wurde in `_twin-source-paths.ts` extrahiert, weil das neue `twin-reload`-Skript dieselbe Logik braucht. Plus: `bootstrap-twin.ts` wurde direkt mit umgestellt — keine doppelte Wahrheit, kein Code-Drift-Tech-Debt.

Generelles Prinzip: **DRY beim zweiten Aufruf, nicht beim ersten.** Premature Abstraction kostet mehr als sie spart. Erst wenn klar ist, dass eine Logik mehrfach gebraucht wird (zweiter Aufruf), lohnt sich die Extraktion. Für #78: Pfad-Logic war erstmal in `bootstrap-twin.ts` inline okay (eine Stelle, ein Twin-Setup-Skript). Erst als `twin-reload` dieselbe Logic braucht, wird's ein shared Helper.

Plus eine kleine Konvention: Underscore-Prefix für shared Helpers in `scripts/`-Ordner — `_twin-source-paths.ts` signalisiert „kein ausführbares Script, sondern Hilfsmodul". Pattern für künftige shared Skript-Helpers übernehmen.

### Lesson (Tag 8 / #81): Compose-Symlinks und relative Pfad-Auflösung

`/docker/twin-lab-web/docker-compose.yml` ist auf VPS ein Symlink zu `repo/docker/twin-lab-web/docker-compose.yml`. Erste Lösung war Volume-Mount mit relativem Pfad `../../docs:/app/docs:ro` direkt im Repo-Compose-File — funktionierte lokal (echte Datei), aber nicht auf VPS (Symlink). Docker Compose löst relative Pfade **vom Symlink-Standort, nicht vom Symlink-Ziel auf**. Heißt: `../../docs` von `/docker/twin-lab-web/` aus = `/docs` (Root + zwei mal hoch).

`docker compose config` zeigt die fully-resolved Konfiguration und ist das richtige Diagnose-Tool: `source: /docs` war eindeutig falsch. Plus `docker inspect <container> --format='{{range .Mounts}}{{.Source}} -> {{.Destination}}{{end}}'` zeigt was tatsächlich gemounted wurde.

Lösung: Override-File-Pattern. `/docker/twin-lab-web/docker-compose.override.yml` mit absolutem Pfad. Compose lädt `docker-compose.override.yml` automatisch aus dem gleichen Verzeichnis und merged es. VPS-spezifische Konfiguration bleibt VPS-spezifisch, Repo-Compose-File bleibt portable.

**Generelles Prinzip:** Repo-Code soll lokal und Production identisch sein. VPS-spezifische Anpassungen gehören nicht ins Repo, sondern in Override-Files oder ENV-Variablen. Pattern für künftige VPS-Spezifika übernehmen.

Plus Lesson zum Diagnose-Workflow: bei verdächtigen Mount-Problemen erst `docker compose config` (was Compose ausgehandelt hat) plus `docker inspect` (was Docker tatsächlich macht), dann debuggen. Zeile-für-Zeile-Compose-Lesen ohne diese Tools ist verschwendete Zeit.

### Lesson (Tag 8 / Production-Drift): Lokal vs. Production divergieren leise

Beim Production-`twin:reload @markus --force` kam ein überraschender Diff: `persona_md: 244 → 6991 chars (+6747)`. Production-Markus hatte einen 244-Zeichen-Stub aus dem Onboarding-Wizard, nicht die volle Persona aus `docs/persona.md`. Niemand hat's gemerkt, weil Production-Markus selten direkt getestet wurde.

Verstehen warum: Lokal-Bootstrap nutzt `pnpm twin:bootstrap` mit `docs/persona.md` als Source. Production-Bootstrap (für die ersten User-Twins inklusive Markus' Production-Account) lief via Onboarding-Wizard, der eine Stub-Persona erzeugt. Beide Setups produzieren technisch valide Twins, aber mit semantisch unterschiedlichem Inhalt.

Generelles Prinzip: **Multi-Tenant-State ist nicht automatisch zwischen Environments synchron.** Bei Architektur-Änderungen (wie #74-Persona-Refactor) muss explizit geprüft werden, was lokal vs. Production drin ist. Ein einfacher Smoke-Test wie „stell @markus auf Production eine Frage und schau ob sich's wie der lokale Twin anfühlt" hätte den Drift früher aufgedeckt.

Plus konkret: `twin:reload @<handle> --force` plus DB-Diff-Output ist ein gutes Production-Audit-Tool. Bei jedem Production-Deploy mit Persona-relevanten Änderungen lohnt sich der Lauf — entweder zeigt's `unverändert` (alles gut) oder es deckt einen Drift auf.

### Lesson (Tag 9 / #71b): 5-Sub-Schritt-Aufteilung beim Schema-Refactor zahlt sich aus

Der Test-Hygiene-Block (#71b + #80) hätte als ein 3-4h-Mega-Commit angelegt werden können (Schema + Repo + Service + Loader + UI alles in einem). Stattdessen fünf Sub-Schritte (A/B/C/D/E) plus zwei UX-Polish-Items (#84/#85), jeder einzeln testbar.

Effekt: jede Schicht hatte ein eigenes Test-Skript (`test-conversations-repo.ts`, `test-conversation-flow.ts`, `test-conversation-history.ts`), das genau ihren Layer verifiziert hat. Bugs sind sofort an der Stelle aufgefallen, wo sie reingekommen sind, nicht erst beim End-to-End-Test. Plus: jeder Commit war sauber rückverfolgbar.

Generelles Prinzip: **bei Multi-Layer-Refactors immer pro Layer einen Sub-Schritt + Test, statt alles in einem Commit zu mischen.** Pattern für künftige Schema-Refactors (z.B. 3.3 Conversation-Memory, das ähnlich tief geht) übernehmen.

Plus eine kleine Variante: die UX-Polish-Items (#84 Inline-Confirm, #85 Trenner) sind gemeinsam mit dem funktionalen Block gemerged worden — nicht als „nächste Session". Begründung: Inline-Confirm und Trenner sind direkt aus den Sub-Schritt-D-Smoke-Tests entstanden („`window.confirm()` ist hässlich", „kein Marker im Verlauf"). Wer die Schwachstelle sieht und nicht löst, wird sie nicht mehr sehen, wenn sie länger steht. Zwei zusätzliche Items innerhalb der gleichen Session ist okay.

### Lesson (Tag 9 / #85): Backend-getriebene UI-Marker statt State-Marker

Der Konversations-Trenner hätte als Frontend-State implementiert werden können („User klickt Reset → setze Marker an Position N im messages-Array"). Stattdessen: daten-getrieben aus den geladenen Audits — der Render-Loop vergleicht zwei aufeinanderfolgende Messages und rendert einen Trenner, wenn die `conversation_id` wechselt.

Effekt: Page-Reload, Tab-Switch, Re-Mount — der Trenner steht überall an derselben Stelle, weil aus den persistenten DB-Daten abgeleitet. Plus: Vorbereitung für Phase 3.3 (Multi-Konversations-Sicht) — derselbe Render-Code zeichnet später mehrere historische Konversationen mit Trennern dazwischen, ohne neuen Code.

Plus eine Hybrid-Detail: für Live-Sends, deren `conversation_id` der Server erst nach Reload zurückspielt, gibt's einen kleinen Counter im Parent (`directChatResetSeq`), den der Reset-Button hochzählt. Live-Messages bekommen dann eine synthetische Local-ID, damit der Trenner sofort nach dem nächsten Send erscheint, nicht erst nach Reload. Lokale Hybrid-Logik unter daten-getriebener Render-Logik — beste aus beiden Welten.

Generelles Prinzip: **bei UI-Markern, die aus persistenten Daten ableitbar sind, daten-getrieben rendern statt im State zu führen.** State-Marker driften (Reset-Klick verloren bei Reload), Daten-Marker bleiben.

---

## Notiz für später

Sammle weiter Punkte, die im Sparring auftauchen. Nicht jeder Punkt muss eine Phase werden — manches ist Polishing, manches ist Architektur. Die Aufteilung S/M/L/XL und must/should/nice hilft beim Priorisieren wenn die Liste lang wird.

**Item-Dichte 7. Mai 2026 nachmittag (Tag 8):** Vier Items abgeschlossen — #77 (Production-Container-Bootstrap, Commit `2e96ddb`), #74 (Persona-Skill-Layering, Commit `f045dd8`), #78 (Persona/Mandates-Reload-CLI, Commit `61154c0`), #81 (docs/-Volume-Mount via VPS-Override-File, kein Repo-Commit). Plus Production-komplett aktualisiert auf Tag-7+8-Stand. Plus zwei neue Items entstanden (#81 ✅ via Override-Pattern, #82 Heikos Persona-Source-File fehlt — open). Plus #71b von should auf must hochgestuft (Test-Hygiene als Pflicht-Vorbedingung vor 3.2). Plus 7 neue Lessons (Engine-Test als Truth-Source bei Persona-File-DB-Diskrepanz, Architektur-Befunde finden sich beim Verifizieren, tsx-Wegwerf-Skripts-Patterns, ps-Optionen Cross-Platform, Helper-Extraktion bei zweitem Aufruf, Compose-Symlinks und relative Pfad-Auflösung, Production-Drift-Pattern). Items insgesamt jetzt: 78 (74 + 4 neue Items #78-#82, davon #78 + #81 schon erledigt).

**Item-Dichte 8. Mai 2026 abend (Tag 9):** Test-Hygiene-Block komplett — #71b und #80 ✅, plus #84 (Inline-Confirm) und #85 (Konversations-Trenner) als UX-Polish im selben Block ✅. Sechs Commits über fünf Sub-Schritte (A/B/C/D/E) plus die UX-Polish-Items: `bc1669a` Schema+Repo, `d0b8cc7` Twin-Service, `b694d0d` History-Loader, `8f604fa` UI-Reset-Button, `76e2728` UX-Polish, `e18f58c` Cleanup+Doku. Plus zwei neue Lessons (5-Sub-Schritt-Aufteilung beim Schema-Refactor, Backend-getriebene UI-Marker statt State-Marker). Items insgesamt jetzt: 80 (78 + #84 + #85, alle vier neu erledigten Items aus dem Test-Hygiene-Block ✅).

**Was als Nächstes ansteht:** Test-Hygiene-Block ist abgeschlossen, der Pfad zu 3.2 ist frei:
- **Strategie-Session vor 3.2 (MCP-Client)** — Pre-Implementation-Diskussion mit konkreten Architektur-Festlegungen (Tool-Discovery, Server-Lifecycle, Auth-Modell, Mandate-Integration für MCP-Tools, Failure-Modes)
- **3.2 — MCP-Client als Skill-Provider** — externe Tools als Skills exponieren, Mandate-Gating analog zum existierenden Skill-System
- Optional dazwischen: **#79 Persona-Tabelle droppen** (~XS, nice) — kann beim nächsten Migrations-Anlass mit angehängt werden
- Optional: **#82 Heikos Persona-File anlegen** — nice, wenn Heiko Persona-Updates braucht
- Optional: **#83 UI-Reply-Verkettung** — wartet auf weitere Reproduktion, kein akuter Blocker

**Tag 9 Bilanz:** Sechs Commits über fünf Sub-Schritte plus UX-Polish, plus dieser Cleanup-+-Doku-Commit (`e18f58c`). Test-Hygiene-Block ist Schema-Refactor mit Migration 009 (`conversations`-Tabelle + `audit.conversation_id`), Migration 010 (Bestand-Cleanup), neuem Repo (`ConversationsRepo`), umgestelltem History-Loader (server-seitig per Konversation gefiltert mit 40-Messages-Cap), neuem UI-Reset-Button mit Inline-Confirm und Konversations-Trenner. Hauptpunkt erreicht: Skill-Toggle-Tests sind sauber, kein Memory-Leak nach Reset. Plus eine wichtige Architektur-Erkenntnis: bei Multi-Layer-Refactors zahlt sich die Sub-Schritt-Aufteilung mit eigenen Test-Skripten pro Layer aus — Bugs fallen sofort an der richtigen Stelle auf. Production-Update folgt beim nächsten regulären Pull (Tag-9-Stand ist nicht produktionskritisch).

### Lesson (Tag 10 / 3.2.F): Marker-Pattern statt Throw-Pattern bei AI SDK Tool-Hooks

Beim Sub-Schritt 3.2.F wurde der Approval-Trigger initial als Throw-Pattern designed: `tool-bridge.ts` `execute()` wirft `McpToolApprovalRequiredError`, Twin-Service catcht den auf der `generateText`-Ebene, baut Pending-Audit. Konzeptionell sauber.

Smoke-Test zeigte: AI SDK 6 propagiert Throws aus `execute()` **nicht** nach oben. Stattdessen wird der Error als `tool-result mit output: null` umgewandelt, an den LLM zurückgegeben, LLM-Loop läuft weiter, finishReason: 'tool-calls', leerer Text.

Lösung: Marker-Pattern als Primary. `execute()` returnt strukturiertes Result mit eindeutig identifizierbarem Marker-String im content-Array (`"__MCP_PENDING_APPROVAL__"`). Twin-Service durchläuft `result.toolCalls` nach `generateText`, prüft auf Marker, wirft dann lokal den `McpToolApprovalRequiredError`.

Throw-Pfad bleibt im Code als Defense-in-Depth.

Generelles Prinzip: **bei Third-Party-SDK-Hooks die Verhaltens-Annahmen früh verifizieren, nicht im finalen Smoke-Test feststellen.** Plus: wenn Throw nicht propagiert, ist Marker-Pattern (Strukturiertes Return-Value mit eindeutigem String) der robuste Fallback.

### Lesson (Tag 10 / Diagnose): LLM-Halluzinations-Symptom als Diagnose-Signal

Beim 3.2.F-Smoke-Test zeigte sich ein verwirrendes Symptom: Twin antwortete mit „Das Tool braucht Approval und wartet jetzt in der Queue. Ergebnis wird 12 sein". Klingt wie ein funktionierender Approval-Workflow, aber Audit zeigte `owner-direct|executed`, nicht `mcp-tool-use|pending`. Kein Pending-Eintrag in Inbox.

Diagnose: `finishReason: stop`, `toolCalls: null` — der LLM hatte das Tool **gar nicht erst gerufen**. Stattdessen halluzinierte er eine plausible Approval-Antwort, weil er die Tools im Set sah und auf Approval-Verhalten geschlossen hat.

Generelles Prinzip: **bei verdächtigen LLM-Antworten, die „funktional" klingen, immer den Audit-Output verifizieren bevor Code-Bug diagnostiziert wird.** Claude Opus 4.7 ist sehr gut darin, plausible Erklärungen zu erfinden — was technisch klingt, ist nicht automatisch technisch korrekt. `finishReason` plus `toolCalls`-Array sind Ground-Truth.

### Lesson (Tag 10 / 3.2.G): Persistent-Visualization für Approval-States

Beim Inline-Approval-UI im Chat (3.2.G) gab's zwei Optionen für Post-Approve-Verhalten:
- **A:** Pending-Box verschwindet, neue Twin-Antwort erscheint
- **B:** Pending-Box bleibt mit „approved"-Status-Indicator, finale Twin-Antwort erscheint als zusätzlicher Block darunter

Option B implementiert. Begründung: Audit-Trail-Konsistenz. User sieht historisch nachvollziehbar was passiert ist. Plus: alle drei Status-Varianten (`pending` mit Buttons, `executed` mit ✓ + Result, `rejected` mit ✗ + Begründung) nutzen dieselbe McpToolCallBox-Komponente, nur Status-Indicator wechselt. Code-Komplexität ist niedriger als bei Option A.

Generelles Prinzip: **bei zustandsbehafteten UI-Komponenten (Approve/Reject, Edit/Save, Pending/Resolved) Persistent-Visualization mit Status-Indicator-Wechsel statt Replace-by-New-Block.**

### Lesson (Tag 11 / #92): docker compose config zeigt Override-Mounts manchmal nicht — docker inspect ist Truth-Source

Beim Production-Deploy von Phase 3.2 (#92) gab es eine konfuse Diagnose-Phase. Override-File mit zwei Volume-Mounts (docs/ + neu mcp-servers/) war auf VPS angelegt, syntaktisch korrekt. Aber `docker compose config` zeigte NUR das `twin-lab-web-data`-Volume — keine bind-mounts. War eine Weile auf der falschen Spur (Symlink-Pfad-Probleme, YAML-Indentation-Bug, Override-Auto-Discovery-Bug).

Verifikation: `docker inspect twin-lab-runtime --format='{{json .Mounts}}'` zeigte beide bind-mounts (docs UND mcp-servers), exakt wie das Override es spezifizierte. Der laufende Container hatte alles korrekt — nur `compose config` lügt aus irgendeinem Grund (vermutlich Symlink-Auflösung).

Generelles Prinzip: **bei Container-Diagnose ist der laufende Container die Truth-Source, nicht die Configuration-Datei.** `docker inspect` ist dafür das richtige Tool. `compose config` zeigt Konfiguration auf dem Papier.

### Lesson (Tag 11 / 3.2.H): AI-SDK Multi-Step bei forcedToolChoice braucht Manual-Followup

Beim 3.2.H-Smoke-Test mit `toolChoice: { type: 'tool', toolName: '...' }`: Tool wird gerufen, Result kommt zurück, aber LLM gibt keinen Final-Text aus. `finishReason: 'tool-calls'`, `text: ""`. User sieht im Chat eine leere Twin-Bubble nach Tool-Call.

Ursache: AI SDK 6 mit forciertem `toolChoice` führt nur Single-Step durch. `stopWhen: stepCountIs(5)` greift nicht — der Tool-Choice forciert das Tool im ersten Step, danach hört der LLM auf statt Synthese-Step zu machen.

Lösung: manueller Multi-Step via `response.messages` (offizielles AI-SDK-Pattern). Nach erstem `generateText`: prüfen ob Followup nötig (forcedToolChoice + leerer Text + toolCalls da + finishReason 'tool-calls'). Wenn ja: zweiter `generateText`-Call mit `messages: [...originalMessages, ...result.response.messages]` und `toolChoice: 'auto'` (Default). LLM darf jetzt frei antworten, synthetisiert Final-Text aus Tool-Result.

Wichtig: Approval-Pfad muss VOR Followup-Check laufen (`detectPendingToolCall` läuft als erstes nach `generateText`). Wenn Marker erkannt: Throw, kein Followup. Wenn kein Pending: Followup-Check entscheidet.

Plus Token-Usage-Merge: zwei `generateText`-Calls bedeuten doppelte Input-Tokens. Im Audit-Metadata aufsummieren via `mergeTokenUsage()`-Helper, sonst wirken die Stats irreführend.

Generelles Prinzip: **AI SDK 6 hat verschiedene Verhaltens-Modi für `toolChoice`-Varianten.** `'auto'` und `'required'` mit `stopWhen` greifen Multi-Step-Loop. `{ type: 'tool', toolName: ... }` greift nur Single-Step. Wenn Final-Text gebraucht wird, manueller Followup nötig. Pattern ist wiederverwendbar für künftige UI-getriggerte Tool-Calls.

### Lesson (Tag 11 / Direktive-Polish): LLM-Prompt-Tuning ist Whack-a-Mole

Beim TOOL_USE_DIRECTIVE-Polish (Commit `2e7c1d0`) wurden zwei neue Regeln eingeführt:
- REGEL 4: keine technischen Marker erfinden (`__PENDING__`, `approved`, `queued`)
- REGEL 6: bei expliziter User-Aufforderung MUSS Tool gerufen werden

Smoke-Test-Befund: REGEL 4 hat eine konkrete Halluzinations-Variante (Marker-Strings) unterbunden. Aber LLM hat eine andere gefunden — User-freundliche Approval-Halluzination („Liegt in der Approval-Queue. Markus muss das freigeben"). REGEL 6 wurde komplett ignoriert bei trivial-lösbaren Anfragen.

Plus eine Lehre: User-freundliche Halluzinationen sind **UX-mäßig fast schlimmer** als Internal-Marker-Halluzinationen. Markers sind verdächtig (`__MCP_PENDING_APPROVAL__` riecht nach Bug), User-freundlicher Text klingt plausibel und wird geglaubt.

Generelles Prinzip: **strukturelle Lösungen schlagen Prompt-Tuning.** Item #89 ist das Lehrstück: drei Tage Prompt-Tuning haben graduelle Verbesserungen gebracht, aber nie das Kernproblem gelöst. UI-Picker (3.2.H) hat es in einem Tag strukturell weggenommen — User-Intent wird deterministisch übersetzt, kein LLM-Ermessen mehr.

Heißt nicht „Prompt-Tuning ist nutzlos" — als Defense-in-Depth ist es wertvoll. Aber als primäre Lösung für nicht-deterministisches LLM-Verhalten ist es eine Sackgasse. Strukturelle Fixes sind robuster.

---

**Item-Dichte 9. Mai 2026 mittag (Tag 10):** Phase 3.2 komplett (lokal) — sieben Sub-Schritte A bis G plus Marker-Pattern-Patch in F. Acht Commits insgesamt: `2bf1ee0` Schema+Repo, `daa03b7` Client+Lifecycle, `cd5b295` Tool-Discovery+Skill-Sync, `366ca93` Tool-Execution via AI-SDK, `5f0f80c` BACKLOG-Update für #86-#89, `43258cf` CLI, `b58df94` Approval-Workflow, `bce54fb` Inline-Approval-UI, plus `20aaa36` Doku. Plus drei neue Items: #90, #91, #92. Plus drei neue Lessons (Throw-vs-Marker bei AI SDK 6, LLM-Halluzinations-Symptom als Diagnose-Signal, Persistent-Visualization für Approval-States). Items insgesamt jetzt: 87.

**Tag 10 Bilanz:** Acht Commits, ~3500+ Zeilen Code-Diff. Phase 3.2 in einem Tag durchgezogen — Sub-Schritt-Aufteilung mit eigenem Test pro Layer hat sich erneut bewährt. MCP-Foundation ist end-to-end produktiv: Server-Provisioning via CLI, Tool-Discovery, Tool-Execution mit Multi-Provider-Support, Approval-Workflow mit Pending-State, UI in Inbox UND Chat-Inline.

---

**Item-Dichte 10. Mai 2026 vormittag (Tag 11):** #92 erledigt — Production-Deploy von Phase 3.2 (A-G) in ~60 Min. VPS-Override-File erweitert um `mcp-servers/`-bind-mount (analog #81). Image-Rebuild Runtime + Web, Container-Recreate, Migrations 011/012 sauber eingespielt, Pilot-MCP-Server für Production-@markus angelegt (everything + everything-approval, 26 Tools). Production-Smoke-Test: Item #89 reproduziert sich auch in Production — Twin halluziniert Tool-Outputs inklusive Code-internen Marker-String `__MCP_PENDING_APPROVAL__`. #89 UX-mäßig dringlicher geworden. Plus eine neue Lesson zum Tag-11-Diagnose-Blocker (`docker compose config` zeigt Override-Mounts manchmal nicht).

**Item-Dichte 10. Mai 2026 mittag (Tag 11):** 3.2 Sub-Schritt H — Tool-Picker-UI als strukturelle Lösung für #89-UI-Pfad. Plus-Button im Chat-Input, Modal mit Tool-Liste nach Server gruppiert, Auto-generated Args-Form, Submit mit `forcedToolChoice`. Multi-Step-Followup-Patch nötig (AI SDK 6 macht bei forciertem ToolChoice nur Single-Step, Final-Text fehlt — Lösung via `response.messages` und zweitem `generateText`-Call). Plus UX-Polish (Server-Sections, Approval-Marker prominent, Plus-Button rechts vom Input). Commit `b97ae80` für 3.2.H+Patch+Polish gemeinsam (~821 insertions). Plus TOOL_USE_DIRECTIVE-Polish (Commit `2e7c1d0`) als Defense-in-Depth gegen Marker-Halluzination — REGEL 4 wirkt (kein Marker-Erfinden mehr), REGEL 6 wirkungslos. Plus zwei neue Lessons (AI-SDK Multi-Step bei forcedToolChoice, Prompt-Tuning ist Whack-a-Mole). Item #89 ist strukturell gelöst für UI-Pfad, bleibt offen für Natural-Language-Pfad. Items insgesamt unverändert: 87, davon #92 ✅.

**Was als Nächstes ansteht:** Phase 3.2 ist sowohl lokal als auch in Production komplett (lokal mit 3.2.H, Production mit 3.2.A-G). Tag-11-Mittag-Stand muss noch in Production:
- **Production-Deploy 3.2.H + Direktive-Polish** (must) — Tag-11-Mittag-Stand auf VPS. Sequenz wie Tag-11-Vormittag, aber kein neuer Volume-Mount nötig (mcp-servers/ ist schon da). Geschätzt 30-40 Min.
- **#90 Resume-Prompt-Tuning** (should, M) — Pattern wie Direktive-Polish, vermutlich auch nur partiell wirksam
- **#91 Reject-Reason-UI** (nice, S) — kommt mit #90 zusammen
- **Strategie-Session vor 3.3** (Memory: Conversation + Semantic) — Auto-Summary-Schwelle, KV-Store-Lifecycle, facts.md-Schreibrechte
- **3.3 — Memory: Conversation + Semantic** (L) — erste zwei Memory-Schichten

**Tag 11 Bilanz:** Drei Commits (`f3532e8` Doku Vormittag, `b97ae80` 3.2.H, `2e7c1d0` Direktive). Vormittag: Production-Deploy von Phase 3.2 (~60 Min). Mittag: 3.2.H Tool-Picker-UI als strukturelle Lösung für Item #89 plus Multi-Step-Followup-Patch plus UX-Polish plus Direktive-Polish (~2h). Wichtigste Erkenntnis: strukturelle Lösungen schlagen Prompt-Tuning. Drei Tage Item-#89-Ringen mit Direktiven hat partielle Verbesserungen gebracht, aber UI-Picker hat das Problem in einem Tag strukturell weggenommen. Pattern für künftige LLM-Verhaltens-Probleme: erst nach struktureller Lösung suchen (UI, Forced-Choice, Pre-Validation), Prompt-Tuning nur als Defense-in-Depth.

---

## Tag-12-Items (Recherche-getrieben, beide nice für Phase 3.6+ oder später)

## Tag-14-Items (Recherche-getrieben, MemPalace-Inspirationen)

### #103 Pre-Check in production-äquivalentem Container, nicht lokal (S, should)

**Kontext:** Tag-15-Production-Deploy hat einen substantiellen Pre-Check-Lücke offengelegt. Der Pre-Check für Phase 3.4 vom 12. Mai wurde *lokal auf macOS arm64* gemacht — drei kritische Patterns wurden verifiziert (BigInt-rowid, Buffer-Wrap, CTE-KNN), Stack-Kompatibilität festgestellt. Aber: das `vec0.so`-Binary von sqlite-vec ist glibc-gebaut, Alpine Linux nutzt musl. macOS-Lokal-Verifikation hat das nicht abgedeckt.

**Kosten:** ~1.5h Diagnose-Marathon auf Tag 15 (Inspect-Shell, `ldd`, web search, Hypothesen-Tests). Plus Build-Image-Wechsel von Alpine auf Debian-Slim (+166 MB Image-Size).

**Lösung:** Future Pre-Checks für architektur-sensitive Dependencies (native modules, C-Extensions, OS-spezifische Libraries) sollen im Production-äquivalenten Docker-Container laufen, nicht nur lokal. Pattern:

```bash
# Pre-Check-Container hochfahren
docker run --rm -it --entrypoint sh node:20-slim sh -c "
  apt-get update && apt-get install -y python3 make g++ &&
  cd /workspace && npm install <dep-to-test> &&
  ldd node_modules/.../the-binary.so &&
  node -e 'require(\"<dep>\")'
"
```

Plus: bei Phase-Strategy-Sessions explizit fragen „braucht das einen Container-basierten Pre-Check?" als checkbox.

**Größe:** S — 30-60 Min, einmaliges Pattern-Setup. Plus dokumentierter Pattern in DEPLOYMENT.md (#102) oder im 3.5-STRATEGY-Pre-Check.

**Wann:** Vor nächstem Stack-Validation (z.B. 3.5 Hyperbrowser falls native Deps dabei sind, oder beim ersten Performance-Engpass mit neuen native Deps).

---

### #104 sqlite3-CLI nicht im Container-Image (XS, nice)

**Kontext:** Bei Tag-15-Production-Verifikation wollten wir `sqlite3 /data/twin.db ".tables"` ausführen, um Tabellen-Existenz zu prüfen. `sqlite3`-Binary ist nicht im node:20-slim Image installiert.

**Workaround verwendet:** Verifikation via `node -e "..."` mit `better-sqlite3`. Funktioniert, aber umständlicher als direkter SQL-Call. Plus Migrations-Logs aus init-db zeigten die Tabellen ohnehin.

**Lösung:** In `apps/runtime/Dockerfile` runner-Stage ergänzen:

```dockerfile
RUN apt-get update && apt-get install -y --no-install-recommends sqlite3 && rm -rf /var/lib/apt/lists/*
```

Kosten: ~6 MB Image-Größe. Nutzen: direkter SQL-Zugriff für Smoke-Tests und Debugging im Container.

**Größe:** XS — 5 Min Dockerfile-Edit + Test.

**Wann:** beim nächsten Routine-Dockerfile-Touch.

---

### #101 FTS5-AND-Semantik verhindert Hybrid-Boost bei Pronominal-Queries (M, should)

**Status Tag 38:** ❌ NICHT gebaut — read-only an echten @markus-Daten (Dev-DB, 35 Memories, lokales e5 live) gemessen: **marginal → bleibt Backlog** (Vorbedingung „erst validieren ob signifikant" eingelöst, Befund: nicht signifikant). 🔴 **Ursachen-Korrektur:** Die 0-FTS5-Treffer entstehen NICHT durch Pronomen/Stopwords, sondern durch **Verb-Form-/Paraphrase-Mismatch** (`mache`≠`planen`, `arbeite`≠`arbeitest` — unicode61 ohne Stemming). Pfad (a) Stopword-Filter heilt die verfehlten Queries nachweislich NICHT (gemessen: „mache urlaub" ohne Stopwords weiter 0 Hits) und schwächt den Bayreuth-Halluzinations-Schutz (lockeres Matching → mehr Token-Overlap-ohne-Relevanz über die 0.015-Schwelle; min_vector_sim=0.5-Pre-Filter ist genau dagegen gebaut). **Der Vektor trägt die FTS5-0-Fälle:** richtige Memory per Vektor allein auf Rang 1, klar getrennt (sim 0.72 vs 0.69) — Hybrid funktioniert wie vorgesehen. **Falls je doch:** wirksamer Hebel wäre ein Porter-Stemmer-Tokenizer (heilt Verb-Formen), NICHT Stopword-Filter — und auch nur, wenn dichtere Prod-Daten einen Recall-Verlust zeigen, den der Vektor nicht auffängt (heute fängt er ihn). **Cross-Ref:** das real spürbarere Problem ist #96 (Name-Overlap/Vektor-Trennschärfe — bei „woran arbeite ich gerade" Cluster ~0.68 mit 0.001-Gaps, ideale Memory nur Rang 3); FTS5 adressiert das nicht.

Befund aus 3.4.I Live-E5-Test: FTS5 macht implizit AND-Konjunktion über alle Query-Tokens. Bei deutschen Pronominal-Fragen ("Wer ist Markus' Frau?", "Was hatten wir über X besprochen?") killen die Stopword/Pronomen-Tokens den FTS5-Hit, weil sie im Content nicht vorkommen.

Konkret: Query "Wer ist Markus' Frau?" sanitisiert zu `wer ist markus frau` → AND über 4 Tokens. Content "Anna ist Markus' Frau." enthält "wer" nicht → 0 FTS5-Treffer → kein Hybrid-Boost auf Anna → RRF-Gap top→second nur 0.0003 (Anna 0.7395 via Vector, Florian 0.6901 via Vector — bei Pure-Vector identisch zu 3.4.E-Befund).

Mechanik-Test (Bayreuth-Analogon mit Mock-Daten) funktioniert wie strategisch vorgesehen — Vector-only-Hits ohne Token-Overlap ranken RRF-mäßig knapp über Default-Threshold (0.0164 vs. 0.015). Bayreuth-Halluzinations-Mitigation ist also funktional. **Aber:** Hybrid-Boost-Wirkung bei legitimen Queries ist eingeschränkt.

Drei Mitigations-Pfade:

a) **Stopword-Filter vor FTS5** — `wer`, `ist`, `was`, `wie`, `wo`, `der`/`die`/`das`, `und`/`oder` etc. raus, nur Content-Tokens behalten. Kleine Code-Änderung (~20 Zeilen in `sanitize.ts`), sprach-abhängig (deutsch first). Adressiert auch Bayreuth-Fall (weniger False-Positive-Tokens schwächen Vector-only-Hits).

b) **FTS5 mit OR-Konstruktion** — Tokens via `wer OR ist OR markus OR frau` verbinden statt AND. Sprach-unabhängig, aber Stopwords ranken trotzdem mit (BM25-IDF filtert nur teilweise). Plus Performance-Risiko bei sehr langen Queries.

c) **LLM-Re-Rank (3.4.J)** — umgeht das ganze AND-Problem, weil LLM die Query-Bedeutung versteht. Aber: zusätzlicher LLM-Call pro Send, +1-3s Latenz, eigene Halluzinations-Risiken.

Reihenfolge-Empfehlung: erst Phase-5-Validierung abwarten — wie groß ist das Problem in echten User-Konversationen? Falls signifikant: Pfad a) als 3.4.I.1-Patch (klein, schnell), 3.4.J behält LLM-Re-Rank-Scope. Falls marginal (Vector findet Top-1 zuverlässig auch ohne FTS5-Boost): Backlog.

Aus Tag-14 / 3.4.I Live-E5-Test.

---

### Lesson (Tag 12 / 3.3.B+C): nanoid-IDs sind NICHT lexikografisch sortierbar

Bei 3.3.B (Summary-Engine) wurde der Cursor zwischen Summary-Runs zunächst via `segment_end_audit_id` (nanoid) gesetzt, in der Annahme dass nanoid-Strings lexikografisch sortierbar wären. Falsch — nanoid generiert random URL-safe-Strings, die NICHT zeitlich monoton wachsen. Cursor-Logik via String-Vergleich liefert falsche „neueste" ID.

Lösung in 3.3.B: Cursor via `timestamp`-Wert des Audits (ISO-String, lexikografisch sortierbar weil ISO-8601). 

Plus Bugfix in 3.3.C: `ConversationSummariesRepo.listByConversation` sortierte initial nach `segment_start_audit_id ASC` (nanoid!). Bei Multi-Summary-Konversation kam falsche Reihenfolge raus. Umgestellt auf `created_at ASC`. 3.3.A-Test-Coverage war zu dünn für Multi-Summary-Szenario — wurde erst in 3.3.C-Tests gefangen.

Generelles Prinzip: **sortiere nach `created_at`/`updated_at`/`timestamp`-Spalten, niemals nach nanoid-PK-Spalten.** Plus Test-Coverage-Lesson: Multi-Row-Sortier-Tests sind Pflicht bei Repos die `listByX()`-Methoden haben — eine Row reicht nicht, um Sortierung zu verifizieren.

### Lesson (Tag 12 / 3.3.B+F): Function-Injection für LLM-Calls

Bei Engine-Komponenten die einen LLM-Call machen (SummaryEngine, ExtractionEngine) wurde ein Pattern etabliert: der LLM-Call ist eine **injizierte Funktion**, nicht ein direkter `generateText`/`generateObject`-Aufruf in der Klasse.

```typescript
type SummaryGenerator = (params: { system: string; prompt: string }) => Promise<string>;

class SummaryEngine {
  constructor(deps, private generate: SummaryGenerator) {}
}
```

Production-Wiring: `summarize: async (p) => (await generateText({...p, model})).text`.
Test-Wiring: `summarize: async () => "Mock summary"` oder `async () => { throw new Error("LLM down") }`.

Vorteile:
- Tests brauchen kein Mock-LLM-Framework, kein API-Stub, keinen Real-Provider
- Provider-Agnostik bleibt erhalten (kein Lock-in im Engine-Code)
- Failure-Pfade sind trivial testbar (Mock-Throw)

Pattern in 3.3.B etabliert, in 3.3.F wiederverwendet (ExtractionEngine mit `ExtractionGenerator`). Pattern für künftige LLM-getriebene Komponenten.

### Lesson (Tag 12 / 3.3.E): Facts als Persona-konstitutiv, nicht als Daten-Block

Strategie-Vote vor 3.3.E hatte drei Optionen für Facts-Position im System-Prompt:
- A) direkt nach Persona kombiniert (`personaWithFacts`)
- B) als eigene 7. Schicht ans Ende
- C) als allererste System-Message

Vote A gewählt — Begründung: Facts sind Identitäts-Wissen („Markus' Frau heißt Anna"), kein Conversation-Kontext.

Smoke-Test bestätigt: Twin reichert Facts mit Persona-Stimme an. Frage „Wo arbeitest du?" → „HARWAY Experience. Eigene Bude, zusammen mit Florian gegründet. Sitz in Hamburg, ich selbst sitze in Roding." — nicht nur „Harway Experience" als trockenes Datum. Twin integriert die `company`-Fact mit Persona-Wissen über Florian und die Gründungs-Geschichte plus eigener Wohn-Situation.

Generelles Prinzip: **wo Information im System-Prompt landet, beeinflusst wie sie genutzt wird.** Daten direkt nach Persona werden als „eigenes Wissen" interpretiert und mit Persona-Stimme angereichert. Daten am Ende werden als „externer Kontext" gelesen und distanziert wiedergegeben. Für User-relevante Facts ist Persona-Position richtig.

### Lesson (Tag 12 / 3.3.G): Inline-Components vs eigene Files

3.3.G1, G2, G3 haben unterschiedliche Component-Strategien gewählt:
- G1: FactProposalBody inline in `inbox/page.tsx` (kleiner Capability-Check, kein Refactor)
- G2: FactSection + FactRow + Modals alle inline in `facts/page.tsx` (~600 Zeilen self-contained)
- G3: ModalWrapper aus `facts/page.tsx` extrahiert nach `components/ModalWrapper.tsx`, weil Chat-Page ihn auch braucht

Lesson: **Inline ist okay bis Wiederverwendung anliegt.** Premature Component-Extraktion macht Imports kompliziert ohne Gewinn. Erst wenn 2+ Pages dasselbe brauchen, Component extrahieren.

Plus: Self-contained Pages mit ~600 Zeilen sind okay wenn sie zusammenhängende State-Logic haben (z.B. Facts-Page mit CRUD + Modals + SSE-Subscription). Aufsplittung würde Cross-File-Coupling erhöhen, nicht reduzieren.

### Lesson (Tag 12 / 3.3.G3): Defensive Fallbacks mehrstufig

`loadConversationHistory` aus 3.3.C hat doppelten Try-Catch:
1. Versuch mit Cursor (Summaries-basiert)
2. Bei Exception: zweiter Versuch mit Hard-Cap (fallbackLimit)
3. Bei zweiter Exception: leere History zurückgeben

Plus in 3.3.G3 die „Reflektieren + Beenden"-Sequenz: Extract fail → trotzdem Reset (User-Intention war beenden), Toast informiert über Lücke.

Generelles Prinzip: **bei User-kritischen Aktionen (Send, Reset) lieber mehrstufiger Fallback statt eine Exception killt alles.** Pattern: try → fallback → safe-default. Mit klarem Logging auf jeder Stufe.

### Lesson (Tag 12 / Doku): zsh + eckige Klammern + git

Beim Commit von 3.3.G3 wollte `git add apps/web/app/chat/[handle]/page.tsx` nicht funktionieren — zsh interpretiert `[...]` als Globbing-Pattern und meldet „no matches found" wenn die Klammer nicht zu einem Filesystem-Match wird.

Lösung: Single-Quotes um Pfade mit eckigen Klammern: `git add 'apps/web/app/chat/[handle]/page.tsx'`. Oder Escapen: `apps/web/app/chat/\[handle\]/page.tsx`.

Lesson: **bei Next.js dynamic routes (`[param]`-Verzeichnisnamen) im git-Workflow auf zsh-Quoting achten.** Doku-Hinweis für künftige Sessions.

### Lesson (Tag 17 / #89): „Halluzination" hat zwei mögliche Wurzeln — LLM-Verhalten oder Detection-Bug

Drei Tage stand #89 im Backlog als „LLM-Verhaltens-Problem". Tag 16 Designprinzip-Setzung darauf aufgebaut, Phase-3.5-Deploy geblockt, Vier-Pfade-Strategie-Vorbereitung. Tag 17 Spike: alle drei Hypothesen widerlegt — Wurzel war Step-Walk-Bug, der das Marker-Pattern unerkannt durchließ und die AI-SDK-Synthese plausiblen Tool-Output-Text aus dem Marker-Result generieren ließ.

Pattern: bei Marker-basierten Audit-Pfaden in Multi-Step-LLM-Calls muss man vor jedem „LLM-Verhaltens-Problem"-Verdacht verifizieren, dass der Detection-Code den richtigen Step liest. Top-level `result.toolCalls` in AI SDK 6 zeigt nur den letzten Step. Bei Marker-Pattern (`execute()` returnt Marker, LLM synthetisiert weiter) ist das *nie* der relevante Step.

Verstärkt die existierende Lesson aus Tag 10: „`finishReason` plus `toolCalls`-Array sind Ground-Truth" — gilt nur, wenn man die richtige Array-Quelle liest. Bei Single-Step ist top-level richtig, bei Multi-Step nicht.

Generelles Prinzip: **wenn ein „LLM-Verhaltens-Problem" mehrere Tage Strategie-Aufwand braucht, ist die Diagnose-Verifikation der erste Schritt, nicht der letzte.** Konkret: jeder Marker-basierte Audit-Pfad braucht einen Smoke-Test, der `audit.output.toolCalls` non-empty nach Multi-Step-Tool-Use verifiziert (siehe 3.5.E.D).

Plus Meta-Lesson: das Designprinzip von Tag 16 („Tool-Aufruf nur als Fallback") bleibt richtig, aber wurde aus falscher Diagnose abgeleitet. Wenn die Diagnose falsch ist, kann die abgeleitete Strategie zufällig richtig sein — verlässlich ist sie aber nicht. Sanity-Check für künftige Designprinzip-Setzungen: „Habe ich die Wurzel des Problems verifiziert, bevor ich strukturelle Konsequenzen ziehe?"

### Lesson (Tag 17 / #89-Closure): Production-Deploy braucht Image-Build-Doku in der ersten Iteration, nicht der zweiten

Beim Tag-17-Production-Deploy fiel auf: das Deploy-Briefing nahm `docker compose build` an, aber Twin-Lab-Compose ist image-tag-only — Build muss direkt via `docker build` aus Repo-Root. Diese Info war in `docker/twin-lab-web/README.md` korrekt dokumentiert, plus in DEPLOYMENT.md §6 (Standard-Update) als expliziter Build-Block — aber §3 (First-Time-Setup) verwies nur auf die README statt es zu duplizieren.

Generelles Prinzip: bei Deploy-Doku ist eine kleine Doppelung (Build-Command auch in DEPLOYMENT.md §3, nicht nur Verweis) sinnvoller als ein Verweis — Deploy-Briefings laufen gegen DEPLOYMENT.md, nicht gegen die README. Quick-Win nach dem Stolperstein gemacht: §3 hat jetzt einen kompakten Build-Block plus den Hinweis auf §6 für den vollen Re-Deploy-Flow.

Plus: das war 10 Min Stolperstein, kein Major. Aber für Self-Hosting durch Dritte (DEPLOYMENT.md ist genau dafür) wäre es ärgerlich. Pattern für künftige Skelett-Dokus: bei kritischen Setup-Schritten lieber redundant als „siehe da".

---

**Item-Dichte 11. Mai 2026 abend (Tag 12):** Phase 3.3 komplett — sieben Sub-Schritte (A, B, C, D, E, F, G1, G2, G3) plus eine Strategie-Session am Anfang. Neun Commits insgesamt: `9b4d5c5` Schema+Repos, `9fc1ebb` Summary-Engine, `0eb941e` History-Loader, `49fe0b7` Facts-API+CLI, `1a8a128` Facts-im-Prompt, `f1cfa65` Twin-Extraction, `bf7b6d5` Inbox-Render, `fc3f6b3` Facts-Page, `a3c868b` Manual-Extract+Reset-Modal. Plus zwei neue Items (#93 Cognee, #94 Dream-Pattern, beide nice/L). Plus sechs neue Lessons (nanoid-Sortierung, Function-Injection, Facts-Position, Inline vs Files, Mehrstufiger Fallback, zsh-Quoting). Items insgesamt jetzt: 89, davon Phase 3.3 komplett offen für Production-Deploy.

**Tag 12 Bilanz:** Neun Commits, ~6000+ Zeilen Code-Diff. Phase 3.3 in einer Session durchgezogen — Sub-Schritt-Aufteilung mit Tests pro Layer hat sich bei dreifacher Anwendung (3.1, 3.2, 3.3) komplett bewährt. Memory-Foundation ist end-to-end produktiv: Conversation-Memory mit Auto-Summary (Sliding-Window), Semantic-Memory mit User-CRUD plus Twin-Extraction, beide im System-Prompt aktiv. UI komplett mit Inbox-Render, Facts-Settings-View, Manual-Extract-Button, Reset-Confirm-Modal. End-to-End-Smoke-Test mit echtem Twin: vier qualitativ hochwertige Facts aus Toskana-Konversation extrahiert (Skip-Logic + Trivia-Vermeidung verifiziert), plus zweite Konversation über Parsifal-Karten → `contact_bayreuth`-Fact mit Kontext-Kapselung. Wichtigste Erkenntnis: das Pattern „kleiner Sub-Schritt mit eigenem Test plus klarem Briefing pro Schritt" skaliert auch über neun Schritte in einer Session — Tempo bleibt hoch, Architektur bleibt sauber, Tests bleiben grün.

**Was als Nächstes ansteht:** Production-Deploy Phase 3.3 (must) — Tag-12-Stand auf VPS. Plus ggf. Tag-11-Mittag (3.2.H + Direktive-Polish) nachholen falls noch nicht in Production. Sequenz analog Tag 11 Vormittag: Repo-Pull, Image-Rebuild Runtime + Web, Container-Recreate, Migrations 013-016 anwenden lassen. KEIN neuer Volume-Mount nötig. Geschätzt 60-90 Min.

Danach:
- **Strategie-Session vor 3.4** (Memory: Episodic mit sqlite-vec) — Embedding-Provider-Wahl (OpenAI vs Anthropic vs lokal), Embedding-Granularität (pro Message vs pro Konversation vs pro Audit), Retrieval-Strategie
- **3.4 — Memory: Episodic** (L) — dritte Memory-Schicht mit Vector-Embeddings
- **#90 Resume-Prompt-Tuning** (should, M) — 5-Min-Edit
- **#91 Reject-Reason-UI** (nice, S) — window.prompt durch Modal ersetzen (ModalWrapper aus 3.3.G3 verfügbar)

### Lesson (#62 / Bridge-OOM): Exit-137 einmalig, kein Recurrence — Resource-Limits in Reserve

Der alte Bridge-Container wurde am 1. Mai 2026 mit **Exit-Code 137** (SIGKILL, OOM-Killer oder externes Stop) abgeschossen; Ursache nicht mehr ermittelbar (Container weg). **Keine Wiederholung** seither. Falls eine Bridge unter Last erneut OOMt: Memory-Limit in Compose (`deploy.resources.limits.memory: 256M`) + `docker stats`-Monitoring. better-sqlite3 ist speicherarm, aber der Node-Heap kann unter Last wachsen. (Bau-Item #62 in 2c gestrichen — one-off; dieser Hinweis bleibt als Reserve.)


## Tag-27-Items (#131-getrieben)

## Tag-28-Items (#141+#142-Follow-ups)

### #147 Auto-Tool-Picker-Reliability blockiert Approve-Pfad-Smoke (Cross-Ref #87/#89)

**Kontext (Tag 28 Block 2.2):** Bei #141+#142-Verifikation hat das LLM (Opus 4.7 im Codex-Pfad) in drei Anläufen verweigert, das `mcp:everything-approval:get-sum`-Tool zu rufen — "Tool ist nicht verfügbar"-Antwort statt Tool-Call, obwohl Skill aktiv und im Tool-Set. Vermutlich Auto-Tool-Picker-Problem aus der LLM-Tool-Use-Behavior-Familie (#87 Skills-UI, #89 Tool-Use-Behavior-Tuning).

**Konsequenz für #141+#142:** Resume-Pfad-Verifikation für `mcp-tool-use`-Audits wurde **nur code-analytisch** durchgeführt (via Code-Trace `approveMcpToolUse` → `runModel` → patched Return). Live-Smoke ausstehend, sobald Auto-Tool-Picker zuverlässig approval-Tools rufen kann.

**Status:** Cross-Reference, kein neues Bau-Item. #87/#89 sind die eigentlichen Träger. Hier nur dokumentiert, dass dieses Verhalten **Resume-Pfad-Smokes generell** blockiert, nicht nur #141+#142.

**Priorität:** nice (transitiv aus #87/#89).

### #148 api_key-Pfad-Smoke für #141+#142 nachholen (S, nice)

**Kontext (Tag 28 Block 2.1):** Smoke C (api_key-Pfad) wurde während #141+#142-Verifikation skipped, weil keine api_key-Twins für aktive Smokes verfügbar waren — `@markus` ist seit Phase 5.2 oauth, andere Twins (`@florian`, `@heiko`) sind formal api_key, aber im aktuellen Setup nicht in der Smoke-Loop.

**Soll-Stand:** Beim nächsten Anlass mit aktivem api_key-Twin (z.B. neuer Onboarding-Smoke, oder explizit ein Test-Twin auf api_key gesetzt) den `providerMetadata`-Flat-Merge gegen den Anthropic-Pfad verifizieren. Erwartet: `provider:"anthropic"`, `authMode:"api_key"`, `twinId`, `latencyMs`, `model` aus `result.response.modelId` (Anthropic kann Versions-Suffix mitliefern, z.B. `claude-opus-4-7-20260101` statt Alias).

**Risiko:** sehr niedrig. Fix ist code-strukturell symmetrisch — gleicher `runModel`-Return, gleicher Un-Nest-Mechanismus für beide Provider-Namespaces (`openai-codex` vs `anthropic`). Anthropic-SDK liefert `providerMetadata` vermutlich nach gleichem V3-Pattern.

**Priorität:** nice. Verifikation ist Bestätigungs-Smoke, kein erwarteter Bug.

## Rebrand Twin-Lab → Nolmi ✅ Tag 30+31

**Strategie + Phasen-Plan:** [`docs/REBRAND-NOLMI-STRATEGY.md`](./REBRAND-NOLMI-STRATEGY.md) (Tag 30 Strategy-Session als „Tavryn" gestartet, Tag 31 auf „Nolmi" finalisiert + Doc umbenannt). Vollständige Mapping-Tabelle, Trademark-Status, Produkt-Narrativ, Operative Foundation §9.

- Phase 1 ✅ Light-Mode-Switch (Tag 30 Block 3, Commit 58766de)
- Phase 2 ✅ User-Strings (Tag 31 Block 2, Commit f6ebd61)
- Phase 3a ✅ Env/Package/Cookie (Tag 31 Block 3, Commit e746446)
- Phase 3b ✅ Verzeichnis-Rename + GitHub-Repo (Tag 31 Block 4, dieser Commit)
- Phase 4 ⏳ Nolmi-VPS-Setup (offen, eigener Block-würdig)

**Code-Rebrand abgeschlossen** (Phase 1 Light-Mode + Phase 2 User-Strings + Phase 3a Env/Package/Cookie + Phase 3b Verzeichnis/Repo). **Trademark-Gate ✅ grün** (USPTO + EUIPO 0 Treffer). Phase 4 (Production-Deploy auf Nolmi-VPS) ist der natürliche nächste Schritt.

### Alten Stack srv1046432 abschalten — einzige offene Phase-4-Restaktion

**Status:** **OFFEN** (S) | bewusst offen gehalten nach B6-Cut-Over (Tag 31 Block 17) | siehe [`docs/PHASE-4-VPS-STRATEGY.md`](./PHASE-4-VPS-STRATEGY.md) §6 + S7

**Stand Tag 31 Block 17:** Nolmi ist produktiv auf `187.124.3.235`, Phase 4 (B1–B6) abgeschlossen. Der alte Stack `srv1046432` (`twin.harwayexperience.com`) **bleibt Hot-Standby** und wird **nicht** mit-abgeschaltet — Markus' echte @markus-Daten liegen dort in nicht-reproduzierbarem Zustand, also ist das Standby-Netz gerade jetzt (frisch produktiv) am wertvollsten. Abschaltung ist eine **spätere Einzelentscheidung**, nach stabilem Nolmi-Prod-Fenster.

**Vor der Abschaltung (Voraussetzungen):**
1. Gewohnheit/Bookmarks auf `app.nolmi.ai` umgestellt (versehentliches Weitertesten auf `twin.harwayexperience.com` vermeiden)
2. Optional: alte Domain auf „umgezogen"-Redirect — **ohne** den Standby-Stack zu killen
3. Nolmi-Prod über ein stilles Fenster stabil bestätigt

**Abschalt-Schritte (wenn entschieden):**
1. DB-Backup von srv1046432 als Archiv ziehen
2. VPS srv1046432 herunterfahren
3. Falls Hostinger-Mietkosten: VPS-Vertrag kündigen

### Apache-2.0 → AGPL-3.0 — LICENSE-Altlast vor Going Public ersetzen ✅

**Status:** ✅ **DONE** (Tag 34, 1. Juni 2026, Commit `0d750db`) | **Größe S** | **war: must-vor-Public** | Lizenz-Setzung Tag 33, s. `DISTRIBUTION-STRATEGY.md §5b`

**Erledigt Tag 34 (`0d750db`):** `LICENSE` durch **kanonischen AGPL-3.0-Volltext** (gnu.org, verbatim/unmodifiziert) ersetzt; `license`-Feld auf **`AGPL-3.0-only`** in Root + allen 4 Workspaces (`packages/shared`, `apps/web`, `apps/bridge`, `apps/runtime`); README-Badge + License-Sektion angeglichen; `docs/BLOCK-4-STRATEGY.md` Apache-Kandidat als überholt markiert. Build grün (SPDX-Wert bricht kein Tooling). GitHub erkennt AGPL-3.0 im Repo-Header. Appendix-Platzhalter bewusst **nicht** gefüllt (verbatim-Pflicht + saubere `licensee`-Erkennung). → Teil des Going-Public-Blocks (Tag 34).

**Setzung Tag 33:** Nolmi wird **AGPL-3.0** lizenziert (Network-Use-Copyleft §13 → schließt die SaaS-Lücke, schützt gegen geschlossene Managed-Forks bei vollem offenem Code; 2026-Standard für Open-Source-SaaS: Grafana/Bitwarden/Mattermost/Gitea/Nextcloud/Mastodon/Plausible). Relizenzierungs-Logik: AGPL→MIT jederzeit lockerbar, MIT→AGPL unmöglich → restriktiver Start hält „Weg 3 jetzt, Weg 1 langfristig" offen.

**Altlast (aus #111, Tag 25):** committet liegen eine **Apache-2.0-`LICENSE`** + `package.json: "license": "Apache-2.0"` — widersprechen AGPL. **Vor Public:**
1. `LICENSE` durch **AGPL-3.0**-Volltext ersetzen (Copyright-Notice beibehalten).
2. `package.json: "license": "AGPL-3.0"`.
3. ggf. Source-Header / README-Badge angleichen.

Bewusst **nicht** im Tag-33-Doku-Commit ausgeführt — eigener Schritt im Going-Public-Block.

## Archiv — erledigt (Stand Tag 33)

Items, die im Code/STAND nachweisbar gebaut + verifiziert sind — in Triage Schritt 2a (Tag 33) hierher umsortiert, **kein Informationsverlust, Texte unverändert**. Die frisch mit ✅ + Beleg markierten waren gebaut, aber noch nicht abgehakt.

### 20. Konversations-Memory (Schicht 1 — Conversation) ✅

✅ **Erledigt** (Beleg: Migration 009_conversations + 013_conversation_summaries; Phase 3 gebaut.)
Frühere Chats und Twin-Konversationen als komprimierter Kontext bei jeder neuen Anfrage. Stale-aware (Memories älter als X Wochen werden weggekippt, wenn nicht aktiv referenziert). Implementierung via Sliding-Window mit Auto-Summary.
**Größe:** M · **Priorität:** should · **Aus:** Memory-Diskussion 1.5.

### 21. Episodic Memory (Schicht 2 — Episodic) ✅

✅ **Erledigt** (Beleg: Migration 017_embeddings_and_fts + 018_embedding_status (sqlite-vec); Phase 3.)
Konkrete Ereignisse mit Vector-Embeddings, retrievable via Similarity. sqlite-vec als lokaler Vector-Store. Twin "erinnert" sich an spezifische Events ("Florian hat letzte Woche XY gesagt").
**Größe:** L · **Priorität:** should · **Aus:** Memory-Diskussion 1.5.

### 22. Semantic Memory (Schicht 3 — Semantic) ✅

✅ **Erledigt** (Beleg: `apps/runtime/src/facts/` + Migration 014_facts/016_facts_rejected; Phase 3.)
Persistente Fakten-DB als `facts.md` plus structured KV-Store. "Memory" als eigenes Konzept in der UI, du kannst Memories explizit hinzufügen oder löschen. "Vergiss, dass Florian XY gesagt hat" als Mechanismus.
**Größe:** L · **Priorität:** should · **Aus:** Memory-Diskussion 1.5.

### 24. MCP-Client-Implementierung ✅

✅ **Erledigt** (Beleg: `apps/runtime/src/mcp/` MCP-Client; Phase 3.2.)
Twin als MCP-Client, kann Tools von externen MCP-Servern nutzen. Standard-Compliance, damit Skills aus dem MCP-Ökosystem ohne Custom-Adapter angeschlossen werden können.
**Größe:** L · **Priorität:** must · **Aus:** Skills-Strategie

### 25. Skill-System (4-Layer Capability/Tool/Skill/Mandate) ✅

✅ **Erledigt** (Beleg: `apps/runtime/src/skills/` + Migration 008_skills/021_skills_trigger_mode; Phase 3.)
Skill-Engine mit klarer Hierarchie: Capability (was kann der Twin), Tool (welche API/Lib), Skill (Markdown-File mit definierter Aktion), Mandate (was darf der Twin autonom). Vorbedingung für externe Tools, plus Vorbedingung für #39 (Klassifikator-Vorlauf).
**Größe:** XL · **Priorität:** must · **Aus:** Skills-Diskussion 1.5.

### 107. Recherche-Workflow als Skill-Pattern ✅

✅ **Erledigt** (Beleg: STAND Tag 20 — Recherche-Workflow-Skill deployed.)
Schmaler Computer-Use-Hook für den Self-Hosting-Launch. Twin kann auf Nutzer-Anfrage zu einem Thema recherchieren: `search_with_bing` für 2–5 Top-Results, dann `scrape_webpage` auf die relevantesten, dann Synthese mit Quellen-Referenz.

Pattern wird als Skill-Definition realisiert (keine neuen Backend-Routes nötig — beide Tools sind seit 3.5 Hyperbrowser-Foundation verfügbar). Plus Persona-Pattern-Hinweis im System-Prompt, dass Twin proaktiv recherchieren darf, wenn der Nutzer zu einem aktuellen Thema fragt.

**Beta-deklariert für Launch:** README und Landing-Page weisen explizit darauf hin, dass die Recherche-Capability „Frühphase" ist — Latenz 30–60 s, gelegentliche Quellen-Schwäche möglich, kein Multi-Step-Browser-Handling.

**Größe:** S · **Priorität:** must · **Aus:** Pre-Launch-Phase-A-Strategy (Block 3) · **Spur:** Pre-Launch-Phase A

### 120. Dockerfile kopiert `examples/` nicht ins Container-Image ✅

✅ **Erledigt** (Beleg: Status-Zeile bestaetigt (im selben Block geschlossen) — Dockerfile-COPY ergaenzt.)

**Befund Tag 20 (Production-Deploy):** `examples/skills/` wurde heute Mittag als Production-Template-Pattern angelegt (Commit `ad0063f`), ist aber nicht im Runtime-Container-Image. `apps/runtime/Dockerfile` COPYt nur `apps/runtime/`, `packages/shared/` und Workspace-Configs — `pnpm deploy --filter @twin-lab/runtime --prod /out` materialisiert nur workspace-relevante Files. Folge: Skill-Create-CLI im Container findet `/app/examples/skills/recherche-workflow` nicht.

**Workaround Tag 20:** `docker cp /docker/twin-lab-web/repo/examples twin-lab-runtime:/app/examples` — transient, beim nächsten Container-Recreate weg.

**Fix:** Single `COPY examples /app/examples` im Runner-Stage des Dockerfile. examples/ ist statischer Content ohne Build-Step, braucht keinen Builder-Pfad.

**Größe:** XS · **Priorität:** must (Self-Hosting-Pattern braucht den Pfad) · **Aus:** Tag-20 Production-Deploy
**Status:** offen → wird im selben Block durch Dockerfile-Edit geschlossen

### 122. MCP-Server-Auto-Provisioning im Onboarding ✅

**Abgeschlossen Tag 29 (27. Mai 2026, Mittwoch), Commit `a3c6b3a` auf `origin/main`. Production-Deploy Tag 29 auf `cbc0d4c` (inkl. Sub-Block-A Dockerfile-Fix).** Onboarding-Friction für MCP-abhängige Presets aufgelöst: Wizard sammelt API-Keys pro `requiresMcpServers`-Eintrag direkt im Preset-Step (Inline-Form unterhalb der Card, Password-Input pro Server), Submit-Backend provisioniert MCP-Server + synct Tool-Skills, Recherche-Workflow funktioniert nach Wizard ohne Settings-Detour.

**Phase-A-Setzungen umgesetzt:**
- **Soft-Block-α:** Wenn ein Preset enabled ist und `requiresMcpServers` Keys braucht, ist Submit disabled mit Tooltip + Warn-Hint bis alle Keys gesetzt sind. Backend wird nie mit unvollständigen Preset-Daten gerufen.
- **Skip-Default:** Presets bleiben standardmäßig unselected. User klickt aktiv an, dann erscheint der Key-Input.

**Reuse statt Re-Bau:**
- `McpServersRepo.add` (`apps/runtime/src/mcp/repo.ts:90`) + `McpSkillSync.syncOnAdd` (`apps/runtime/src/mcp/skill-sync.ts:60`) 1:1 wie im Settings-Add-Endpoint (`server.ts:1507-1576`)
- Rollback-Pattern bei Sync-Failure aus `server.ts:1556-1573` (Settings-Add finally-block) gespiegelt
- `McpServerSpecSchema` aus `_mcp-cli-helpers.ts` für Template-Validation (Twin-agnostische Spec)
- Card-Inline-API-Key-Form-Pattern aus `McpServerAddModal.tsx:84-189` (Env-Marker-Extraktion + Password-Inputs) auf Wizard-Card adaptiert

**Schema-Erweiterungen (`packages/shared/src/index.ts`):**
- `PresetSelectionSchema` (presetId + mcpServerKeys-Record)
- `PresetActivationResultSchema.mcpServers[]` mit `added`/`skipped`/`failed`-Status (Settings-Path bekommt `failed: API-Key fehlt`)

**Backend-Erweiterungen:**
- `RuntimeConfig.mcpServersDir` neu (default `WORKSPACE_ROOT/mcp-servers`), in `ServerDeps` durchgereicht
- `activate-presets.ts` Komplett-Refactor: pro Preset Skill-Import + Schleife über `requiresMcpServers` via `provisionMcpServer`-Helper (Idempotenz, Template-Substitution, Sync mit Rollback)
- `OnboardingSubmitSchema`: `presets: string[]` → `presetSelections: PresetSelection[]`
- Settings full-config-PATCH wrappt `body.presets.map(id => ({ presetId: id, mcpServerKeys: {} }))` — bestehendes Settings-Verhalten ohne Auto-Provision

**Frontend-Erweiterungen (`apps/web/app/onboarding/page.tsx`):**
- State `presetsSelected: string[]` → `presetSelections: Record<id,{enabled,mcpServerKeys}>`
- PresetCard refaktoriert vom Button-only zu Card-Frame `<div>` mit Header-Button + Inline-Env-Form als Geschwister (sonst nested-input nicht möglich)
- `useMemo`-`hasMissingKeys` für Soft-Block-α, Submit-Button `disabled` + `title`-Tooltip + Warn-Text

Typecheck 4/4 grün, Husky-Build 4/4 grün (`/onboarding` 6.31 kB → 6.87 kB First Load). **Local-Smoke 4/4 grün:**
1. **Happy-Path Recherche-Preset** — Test-User → Wizard → Recherche-Preset anklicken → Hyperbrowser-API-Key eingeben → Submit grün. DB-Verify: Twin angelegt, `hyperbrowser-approval`-MCP-Server in `mcp_servers`, **11 Tool-Skills** unter `mcp:hyperbrowser-approval:*` + Recherche-Pattern-Skill — Pre-Pass-Tool-Forcing kann direkt greifen.
2. **Soft-Block-α** — Preset enabled ohne Key → Submit disabled + Tooltip „API-Key fehlt für ausgewähltes Preset" + Warn-Hint unterm Button. Wizard kommt aus dem Zustand nicht raus, bevor der Key drin ist.
3. **No-Preset-Path** — Skip-Default unselected → Submit grün, Twin ohne Skills/MCP-Server. Existing-Behavior unverändert.
4. **Error-Edge Dummy-Key** — ungültiger Key (`invalid-key-test`) → Provisioning succeeds (`listTools` validiert den Key nicht beim Spawn), erst der Tool-Call im Chat failt ehrlich beim ersten Recherche-Versuch. Kein #122-Bug — sondern erwartbares Verhalten der Hyperbrowser-MCP-API-Key-Validation.

**Production-Deploy Tag 29 (Block 7 + Sub-Block A):** Pre-Flight-Check vor Deploy hat gefunden: `apps/runtime/Dockerfile` kopiert `mcp-servers/` nicht (nur `examples/`-Pattern aus #120). **Sub-Block A** (`cbc0d4c`, ~10 Min) hat einen `COPY mcp-servers /app/mcp-servers` analog Z. 74 ergänzt — **präventiv via Pre-Flight gefunden statt durch Smoke-Failure** (Lesson Tag 29 #5, direkter Pattern-Match aus #120). VPS `srv1046432` `git pull` zog `a3c6b3a` + Doku-Commits + `cbc0d4c`. Runtime + Web rebuilt mit `--build-arg NEXT_PUBLIC_RUNTIME_URL=https://runtime.twin.harwayexperience.com`, Bridge bewusst nicht rebuilt (kein Bridge-Code-Change, Lesson Tag 29 #1). Boot-Verify clean: 3 Twins aktiv, bridge-stream verbunden, oauth-refresh started. Filesystem-Sanity: `/app/mcp-servers/` enthält die 4 Files (3× JSON + README). **Production-Smoke grün** (Test-User `test-122-prod@harway.local`, Handle `@test122prod`, Recherche-Preset + Dummy-Key): DB-Verify Twin `twin_qHZZCooUhCHMYutw` + MCP-Server `mcp_wIn0_jJ35wdqc4-c` (`is_active=1`) + 11 Skills — **strukturell identisch zum Local-Smoke**. **Cleanup via PRAGMA** (`db.pragma("foreign_keys = ON")` analog Lesson Tag 29 #4): Twin + MCP-Server + Skills + User in einer Operation kaskadiert weg, Post-Cleanup `c: 0`. **FK-Cascade in Production funktional verifiziert** (Lesson Tag 29 #6, #159 teil-verifiziert).

**Größe ursprünglich:** M-L. **Final:** ~4.5h netto inkl. Production-Deploy (Diagnose-First ~30 Min, Backend ~1h, Frontend ~1.5h, Local-Smoke + Doku ~30 Min, Block-6-Lessons-Welle + #159 ~25 Min, Sub-Block-A Pre-Flight + Dockerfile-Fix ~10 Min, Block-7-Production-Deploy + Smoke ~25 Min, Block-8-Production-Closure-Doku ~15 Min). **Spur:** Pre-Launch-Phase A Block 4 (Self-Hosting-Polish).

**Cross-Reference:** `apps/runtime/src/skills/scan-examples-presets.ts:extractMcpServersFromRequiresTools` liefert die MCP-Server-Liste aus dem Preset-Frontmatter. Tag-29-Lesson #2 dokumentiert: `requires_tools` ist Pre-Pass-Hint, nicht Tool-Filter — `syncOnAdd` legt alle Tools des MCP-Servers als Skills an, nicht nur die referenzierten. Future Sub-Schritt bei Bedarf: post-Sync `setActive(false)` für Out-of-Scope-Tools.

### 126. Build-Time-Validation für NEXT_PUBLIC_* Variables ✅

**Abgeschlossen Tag 30 (28. Mai 2026, Donnerstag), Tag 30 Block 2.** Strukturelle Lösung statt Doku-Pflaster nach **dreimaligem Auftreten** des `localhost:4000`-im-Client-Bundle-Bugs (Tag 23 Re-Deploy + Tag 28 Block 13 + Tag 29 Block 7 wäre die Diagnose-Stelle, dort nur per Pre-Flight-Lesson vermieden).

**Lösung Option (a)-verfeinert:** Prebuild-npm-Hook mit Guard-Script (`apps/web/scripts/check-build-env.mjs`). Guard koppelt sich an den existierenden Production-Marker `NEXT_PUBLIC_DEPLOYMENT_LABEL=production`:
- Label = `production` und `NEXT_PUBLIC_RUNTIME_URL` fehlt oder matched `/localhost|127\.0\.0\.1/` → exit 1 mit handlungsleitender Fehlermeldung
- Sonst (dev, leerer Label, lokaler Build, Husky-Pre-Push) → no-op, localhost-Default erlaubt

**Wiring:** `apps/web/package.json` bekommt `"prebuild": "node scripts/check-build-env.mjs"`. pnpm folgt npm-Hook-Konvention (das existierende `predev` belegt das), Trigger empirisch verifiziert mit `NEXT_PUBLIC_DEPLOYMENT_LABEL=production pnpm --filter @twin-lab/web build` → exit 1 stoppt die Chain **vor** `next build`, `.next/` bleibt unangetastet.

**Smoke 5/5 grün** (alle direkt via node):
1. Dev (kein Label) → exit 0
2. Production + missing URL → exit 1
3. Production + localhost:4000 → exit 1
4. Production + 127.0.0.1:4000 → exit 1
5. Production + `https://runtime.example.com` → exit 0

Plus Hook-Trigger-Test via `pnpm --filter @twin-lab/web build` mit production-Label ohne URL → pnpm stoppt bei prebuild mit `ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL`, `next build` startet nie.

**Defense-in-Depth:** Source-`?? "http://localhost:4000"`-Fallbacks in den 9 page.tsx **nicht angefasst** — sie sind für `pnpm dev` korrekt und Defense-in-Depth gegen ENV-Resolution-Drift. Guard greift eine Ebene höher (Build-Zeit), Fallback bleibt für Runtime.

**Dockerfile + DEPLOYMENT.md aktualisiert:** Kommentar im Dockerfile vor `ARG NEXT_PUBLIC_RUNTIME_URL` verweist auf den Guard. DEPLOYMENT.md §3.1.2 ergänzt um „Build-Guard (#126)"-Hinweis-Block in der existing localhost-Warnung.

**Größe ursprünglich:** S. **Final:** ~30 Min (Diagnose + Guard + 5 Smokes + Hook-Trigger-Verifikation + Doku). **Spur:** Pre-Launch-Phase A.

### 127. .env.example säubern — Phase-1-Legacy-Variables entfernen ✅

**Abgeschlossen Tag 30 (28. Mai 2026, Donnerstag), gemeinsam mit #129 in einem Commit (Tag 30 Block 1).**

**Scope-Korrektur (α, User-bestätigt):** Ursprünglicher Plan war Variable-Delete. Diagnose vor Edit zeigte: `apps/runtime/src/scripts/bootstrap-twin.ts:87-95` liest alle drei Vars (`BRIDGE_URL`, `BRIDGE_TWIN_HANDLE`, `BRIDGE_TWIN_TOKEN`) aktiv und wirft mit klarer Diagnose, wenn `BRIDGE_URL` fehlt. **`bootstrap-twin.ts` ist gewollter File-basierter Power-User-Pfad, nicht deprecated.** Delete hätte den Pfad ohne Vorwarnung gebrochen.

**Statt Delete:** Die drei Vars als „Advanced: File-basierter Twin-Bootstrap (`pnpm twin:bootstrap`)" Block im `.env.example` gruppiert mit klarem Header-Kommentar: „Der normale Self-Hosting-Pfad ist der Onboarding-Wizard; der braucht diese Variablen NICHT, sondern nur `TWIN_LAB_DEFAULT_BRIDGE_URL`." Self-Hoster, der den Wizard nutzt, kann die drei Zeilen ignorieren. Power-User, der File-Bootstrap will, setzt sie weiter wie vorher.

`TWIN_LAB_DEFAULT_BRIDGE_URL` ist im neuen Block-Layout zuerst (als „Bridge: Wizard-Default") und damit positiv abgegrenzt vom Power-User-Block darunter.

**Größe ursprünglich:** XS. **Final:** ~10 Min (gemeinsam mit #129 in einem Edit-Pass). **Spur:** Pre-Launch-Phase A.

### 128. Bridge-optional-Mode für Single-Twin-Self-Hosting

**Status (Welle 2 präzisiert):** Etappe-1-Kern ✅ DONE (Solo-Modus: nullable Mig. 026, Boot-Guard, BridgeDisabledError→409). OFFEN: Onboarding-Wizard-Solo-Branch (Wizard verlangt noch Bridge) + UI-Re-Bind-Knopf.

**Befund Tag 24 (#109 §9 Code-Check):** Twin-Creation (Wizard + Bootstrap-CLI) verlangt heute zwingend eine erreichbare Bridge. Self-Hoster ohne Bridge-Zugang können keinen Twin anlegen.

Runtime selbst ist Bridge-resilient (Reconnect-Loop ohne Crash für existing Twins), aber Anlege-Pfade sind hart:

- `apps/runtime/src/server.ts:696` — Onboarding-Submit ruft `registerHandleOnBridge`, bei Fehler 502 (kein Twin in DB)
- `apps/runtime/src/scripts/bootstrap-twin.ts:94,102` — wirft wenn `BRIDGE_URL`/`BRIDGE_<NAME>_TOKEN` leer

**Use-Case:** Single-User-Self-Hosting ohne A2A-Bedarf. User will mit eigenem Twin chatten (Memory, Skills, Settings), aber braucht keine Twin-zu-Twin-Kommunikation.

**Implementation-Ideen:**
- Onboarding-Submit-Branch: wenn `TWIN_LAB_DEFAULT_BRIDGE_URL` leer → Skip Bridge-Register, Twin-Create mit `bridge_url: null`
- A2A-Features (Send-To-Twin, Inbox) UI blendet aus wenn Twin ohne Bridge-Config
- Nachträglich Bridge-Anbindung: Settings-Page bekommt "Bridge einhängen"-Section

**Größe:** M-L · **Priorität:** nice → **must (Distribution D3)** · **Aus:** Tag 24 Cookbook-Walkthrough (#109 §9)
**Status:** 🟢 **Etappe-1-Kern ✅ DONE + lokal am Verhalten verifiziert (Tag 31 Block 20+21).** Der Runtime-/CLI-/Chat-Kern ist gebaut **und 4/4 verhaltens-verifiziert** (Solo-Twin `@solo`: Boot „Solo-Modus"/kein Reconnect-Loop · Direct-Chat end-to-end ohne Bridge → LLM-Antwort/200 · UI blendet A2A aus · A2A-Send → HTTP 409 `bridge_disabled`; Bridge-Twin-Regression intakt):
- ✅ Schema: Migration 026 `bridge_url`/`bridge_token` nullable (FK-Cascade-sicher via Runner-`foreign_keys_off`-Opt-in)
- ✅ Registry-Boot-Guard: Solo-Twin ohne Bridge-Client/Stream, kein Reconnect-Loop, Boot-Log „Solo-Modus"
- ✅ A2A graceful: `BridgeDisabledError` → HTTP 409 `bridge_disabled` statt Crash; conversations-Routen solo-sicher
- ✅ `bootstrap-twin` ohne `BRIDGE_URL` → Solo-Twin (Handle `@<name>`, bridge NULL, keine Registrierung)
- ✅ Chat-UI: A2A-Liste + „Neue Konversation" ausgeblendet bei `profile.bridge.url == null` (Inbox-Tab bleibt — Tool/Mandate-Approvals sind bridge-unabhängig)

**Verbleibend (Distribution Etappe 2 / D3-Re-Bind):**
- ✅ `twin:bootstrap` setzt `owner_user_id` jetzt via `OWNER_EMAIL`-Lookup (Etappe 2.1, eigenes Item unten DONE) — **Release-Blocker behoben**.
- ✅ CLI-Onboarding Weg A / Opt 3 (Etappe 2.2, eigenes Item unten DONE): `pnpm twin:onboard` legt den ersten User an, der Web-Wizard erstellt den Twin (setzt Owner korrekt). **Zwei gleichwertige Türen** erreicht.
- ✅ **Weg B** (durchgehendes Terminal-Onboarding inkl. Persona/Key, Tag 33, eigenes Item unten DONE): `twin:onboard` baut jetzt auch den Twin (geteilter `createTwin`-Service). QuickStart verifiziert; Advanced-Bridge-Pfad als Folge-Check offen.
- ✅ `auth_mode`-Durchsetzung (D2, Etappe 2.4a, eigenes Item unten DONE): OAuth nur bei `auth_mode='oauth'`, zwei-Ebenen-Gate (CLI + UI), Allowlist nur via Admin-CLI `twin:auth-mode`, kein Self-Service.
- Onboarding-**Wizard**-Submit-Branch: Solo-Twin via Web anlegen (heute verlangt der Wizard noch eine Bridge — `server.ts` Onboarding-Submit)
- ✅ Re-Bind Solo→Bound (D3 Stufe 1→2, Etappe 2.4b, eigenes Item unten DONE): CLI `twin:bind-bridge` an die eigene Bridge. Verbleibend: UI-Re-Bind-Knopf (zweite Tür) + Umbinden bereits gebundener Twins + Fremd-Bridge/Föderation (Phase 4).
- ✅ **Production-Deploy der Migration 026** (Distribution Etappe 2 Schritt 5, eigenes Item unten DONE): Sammeldeploy `c88f0eb` auf `srv1712371`, **026 FK-safe auf Production-Echtdaten** (Log „foreign_keys_off-Modus", `foreign_key_check` leer, Kind-Counts vorher=nachher identisch). Backup B4-Klasse offsite vorab.

### twin:bootstrap setzt keinen owner_user_id — Solo-Twin ownerlos + im Switcher unsichtbar ✅

**Status:** **DONE** (Distribution Etappe 2.1, lokal verifiziert) | **Größe S** | **Priorität war: must-vor-Self-Hosting-Release** | Befund Tag 31 Block 21, behoben Tag 31 Block 22

`twin:bootstrap` legt Twins mit `owner_user_id = NULL` an. Bei den Bestands-Bridge-Twins fiel das nie auf (sie bekamen ihren Owner über den Onboarding-Wizard bzw. die User-Migration). Der Distribution-Etappe-1-Smoke mit dem Solo-Twin `@solo` machte die Lücke sichtbar: der frisch ge-bootstrappte Solo-Twin war **im Twin-Switcher unsichtbar** (die `/twins`-Liste ist owner-gescoped), bis ein manuelles `UPDATE twin_profiles SET owner_user_id=… WHERE handle='@solo'` + **Runtime-Neustart** (Owner-Zuordnung wird beim Boot in der Registry gecached) ihn dem eingeloggten User zuwies.

**Kein Solo-Pfad-Bug** — der Solo-Modus selbst (Boot/Chat/UI/A2A-409) funktioniert lückenlos (4/4 verifiziert, #128). Vorbestehende Bootstrap-Lücke, die der Solo-Modus nur exponiert hat.

**Warum Release-Blocker:** Ein frischer Self-Hoster würde nach `twin:bootstrap` (One-Liner-Install-Pfad) **seinen eigenen Twin nicht sehen** → die Installation wirkt kaputt.

**Fix (umgesetzt, Etappe 2.1):** `bootstrap-twin.ts` löst den Owner jetzt aus ENV auf, **bevorzugt E-Mail-basiert**:
- `OWNER_EMAIL=<x@y.z>` → via `UsersRepo.findByEmail()` zur `user_id` aufgelöst, `owner_user_id` gesetzt. Trifft die E-Mail keinen User → **harter Fehler** (kein stiller NULL-Fallback), Hinweis auf `user:create`.
- `OWNER_USER_ID=user_<…>` → direkte ID als Fallback (Skripte/Tests).
- **Kein Owner gesetzt → deutliche `WARN`-Zeile** ("Twin wird im Switcher unsichtbar sein, setze OWNER_EMAIL") statt stillschweigend NULL — die Lücke kann nie wieder lautlos passieren.
- UPDATE-Pfad überschreibt `owner_user_id` nur, wenn explizit ein Owner übergeben wurde (kein Reset einer bestehenden Zuordnung auf NULL).

Keine Schema-Änderung nötig (`owner_user_id` existiert seit Migration 026, nullable).

**Lokal verifiziert (Verhalten, Wegwerf-Twin `@solo2`, danach entfernt):** (1) bootstrap mit `OWNER_EMAIL=markus.baier@harway.de` (ohne `BRIDGE_URL`) → DB-Check `owner_user_id = user_GnAgLosIQsW1ymQu` (≠ NULL); (2) owner-gescopte Switcher-Query (`list({ ownerUserId })`, identisch zur `GET /twins`-Filterung `profile.ownerUserId === user.userId` in `server.ts:250`) liefert `@solo2` → **erscheint im Switcher ohne manuelles UPDATE**; Registry-Boot lädt `@solo2` eager. (3) Gegenprobe ohne `OWNER_EMAIL` → `WARN`-Zeile + Owner NULL. (4) Fehler-Pfad `OWNER_EMAIL` ohne User → harter Fehler mit `user:create`-Hinweis.

**Onboarding-Kopplung (User-Anlage + Owner-Zuweisung im interaktiven Flow)** → erledigt in **Etappe 2.2 (Block 23)** via Weg A / Opt 3, siehe eigenes Item unten.

### CLI-Onboarding Weg A / Opt 3 (twin:onboard legt ersten User, Wizard macht Twin) ✅

**Status:** **DONE** (Distribution Etappe 2.2, Block 23, lokal end-to-end verifiziert) | **Größe S** | zweite Tür neben Web-Wizard (#110)

**Phase-A-Befund (die kritische Frage „kann der Wizard einen vorhandenen Twin aufgreifen?"):** **Nein.** `POST /onboarding/submit` macht immer `INSERT` eines neuen Twins und wirft **409 bei existierendem Handle** (`server.ts:723`), registriert immer auf der Bridge. Und ein Owner, der **schon einen Twin besitzt, landet nie im Wizard** — `/chat` leitet zu `/chat/<handle>`, der Wizard erscheint nur bei 0 owned Twins (`chat/page.tsx:38`). Zusatz: `bootstrap-twin` ist nicht „minimal" — Persona-Files + LLM-Key sind Pflicht, der Twin ist nach Bootstrap schon vollständig. Würde das CLI einen Twin bootstrappen, gäbe es im Wizard ein **409 oder einen Doppel-Twin**.

**Entscheidung (Markus, Opt 3):** Das CLI deckt nur die echte Terminal-/UI-Lücke ab — den **ersten User** anlegen (keine öffentliche Signup-Seite, nur `/login`; ohne Login kein Wizard-Zugang). Den Twin macht der Web-Wizard (Persona+LLM-Key+Presets im UI, Owner korrekt gesetzt — `server.ts:791`, A3 verifiziert). Web-Wizard **unangetastet**.

**Umsetzung:** `pnpm twin:onboard` (`apps/runtime/src/scripts/onboard.ts`) — interaktiv E-Mail (`readLine`) + Passwort+Bestätigung (`readSecret`, kein Echo) + optionaler Anzeigename → `UsersRepo.create` (bcrypt cost 12). Idempotent (existierender User → „logge dich ein", kein Doppel-Anlegen). Übergabe-Meldung an Tür 2. `readSecret`/`readLine` nach `scripts/_prompt-helpers.ts` extrahiert (DRY beim zweiten Aufruf; `set-api-key.ts` nutzt den shared Baustein).

**End-to-End lokal verifiziert** (Wegwerf-User `test-onboard@local.dev` + Twin `@onboardtest`, restlos entfernt): onboard→User (Hash `$2a$12$`); Login→`GET /twins`=`[]` (Wizard-Trigger); `submit`→201; **DB owner_user_id = neuer User, genau 1 Twin (kein Doppel)**; Switcher zeigt ihn; Direct-Chat HTTP 200 mit echter LLM-Antwort. Kein 409, kein manuelles UPDATE. **KEIN Production-Deploy.**

**Weg B (✅ DONE, Tag 33):** durchgehendes Terminal-Onboarding inkl. Persona/LLM-Key im CLI — eigenes Item direkt unten. Lösung war nicht „Stub-Twin im Bootstrap", sondern der **geteilte createTwin-Service** (aus dem Wizard extrahiert), den das CLI mit aufruft.

### Weg B — durchgehendes Terminal-Onboarding (twin:onboard baut den Twin) ✅

**Status:** **DONE** (Distribution Weg B, Phase 1+2, Tag 33, interaktiv verifiziert) | **Größe M** | durchgehende Terminal-Tür für Headless-VPS (kein Browser-Zwang)

**Phase 1 — createTwin-Service-Extract (Commit `759fcbf`):** Die 7-Schritt-Twin-Erstellung aus dem `/onboarding/submit`-Handler in einen geteilten `createTwin(input, deps)` gezogen (`onboarding/create-twin.ts`), den Web-Wizard UND CLI aufrufen — keine Duplikation. Verhaltensneutral, Web-Wizard am Verhalten verifiziert (Owner/Switcher/Chat/Presets). Deps als Parameter (CLI-tauglich), typisierter `CreateTwinError` (HTTP-Status 1:1).

**Phase 2 — CLI-Flow (Commit `2e61007`):** `pnpm twin:onboard` (`scripts/onboard.ts`) durchgehend: DB-Init-Check → User idempotent → **Doppel-Twin-Schutz** (`list({ownerUserId})` → freundlicher Abbruch, kein 409-Crash) → QuickStart/Advanced-Gabel → Persona/Mandate/Bridge/Provider → `readSecret`-Key + `validateApiKey`-Live-Check (3 Versuche) → `createTwin`. **Kein OAuth-Prompt** (D2), `auth_mode`-Default `api_key`. `createTwin` additiv erweitert (Wizard byte-unverändert): **Solo-Pfad** (`bridgeUrl=null`) + optionaler `bridgeRegisterToken`; **Hot-Load-Deps optional** → ohne Live-Registry (CLI-Prozess): Twin in DB, `requiresRestart=true`, keine Presets.

**Verifiziert (interaktiv, Wegwerf-DB):** QuickStart durchgelaufen — `validateApiKey` ok, Twin `@cli-twin` mit `owner_user_id` + generierter Persona + `bridge_url` NULL (Solo) + `auth_mode` api_key; Doppel-Twin-Schutz greift; Restart-Hinweis + Settings-Verweis. Switcher/Chat-nach-Restart über Phase-1-Smoke + identischen Hot-Load-Pfad abgedeckt.

**Bewusste MVP-Grenze:** **keine Presets im CLI** (`activatePresets` braucht die Live-Registry des Server-Prozesses) → Skills/Presets danach im Web unter Settings. Twin geht erst nach **Runtime-Restart** live (Registry lädt beim Boot) — für Headless der Normalfall.

### Weg-B Advanced-Pfad (eigene Bridge, Mandate-Wahl, volle PersonaInput) — ✅ verifiziert

**Status:** **DONE** (Tag 33, lokal am Verhalten verifiziert) | **Größe S** | aus Weg-B Phase 2

Der **Advanced**-Pfad von `twin:onboard` ist am Verhalten verifiziert (lokal, Wegwerf-DB + **echte Bridge**): Advanced-Flow durchgelaufen — volle `PersonaInput` (CTO / `direct` / `du` / `no-emojis`), Mandate-Wahl, Provider/Model; **eigene Bridge** via `registerHandleOnBridge` → `@advancedtest` an der Bridge registriert (`bridge.db`-Check: **JA**); `twin.db` mit `bridge_url=127.0.0.1:5100` + `bridge_token` gesetzt + `owner_user_id`. Test-Handle danach aus `bridge.db` entfernt. Damit sind **beide** Weg-B-Pfade verifiziert (QuickStart/Solo + Advanced/eigene Bridge), beide über denselben `createTwin`-Service.

**TTY-Befund (festhalten):** `readLine`/`readSecret` (`scripts/_prompt-helpers.ts`) teilen **keinen Buffer über aufeinanderfolgende Aufrufe** → gepipter Mehrzeilen-Input wird nach dem ersten Prompt verworfen; nur **interaktiv (TTY)** nutzbar, **nicht piped/CI**. Weg-B ist (wie OpenClaw) interaktiv gedacht (`docker compose exec -it … onboard.js`). Ein **Helper-Refactor** (geteilter Stdin-Buffer) wäre ein **separates Stück**, falls je nicht-interaktive/CI-Tests des Onboarding-Flows gewünscht sind — die Helper tragen auch andere CLIs (`set-api-key` etc.), daher bewusst nicht im Weg-B-Scope.

### auth_mode-Durchsetzung (D2): OAuth nur bei auth_mode='oauth', kein Self-Service ✅

**Status:** **DONE** (Distribution Etappe 2.4a, Block 24, lokal end-to-end verifiziert) | **Größe S** | D2-Setzung

**Phase-A-Befund (war auth_mode tot/gegated/lückenhaft?):** **lückenhaft.** Das Flag war LIVE für die Send-Path-Provider-Wahl (`twin-service.ts:1758`), aber der OAuth-**Start** nicht gegated: Settings-UI bot `api_key`-Twins einen „OAuth aktivieren"-Button (`settings/page.tsx:1374`), und `twin:oauth-login` schaltete jeden Twin selbst auf `oauth` (`cli-oauth-login.ts:378`) statt eine Vorbedingung zu prüfen. **Keine** HTTP-User-Route ändert `auth_mode` (`/full-config`-Schema kennt das Feld nicht; `setAuthMode` nur im CLI) → keine echte HTTP-Self-Service-Lücke, nur UI-Button + ungegateter CLI.

**Fix (zwei Ebenen, weil UI-only umgehbar):**
1. **CLI-Gate** (`cli-oauth-login.ts`): `twin:oauth-login` lehnt hart ab, wenn `auth_mode != 'oauth'` (klare D2-Meldung). Kein Self-Grant mehr — das abschließende `setAuthMode('oauth')` ist nur noch idempotente Bestätigung.
2. **UI-Gate** (`settings/page.tsx`): `api_key`-Zweig zeigt nur Status, keinen Aktivieren-Button. oauth-Zweig (Re-Login) unverändert.
3. **Admin-CLI** `twin:auth-mode <@handle> [oauth|api_key]` (`scripts/set-auth-mode.ts`, Shell-only): die manuelle Allowlist, getrennt vom Login. Anzeige-Modus ohne Mode-Arg.

Keine Migration (Spalte existiert). **End-to-End verifiziert:** api_key (@florian) → Login abgelehnt; oauth (@markus) → Gate passt (Regression, kein Mode-Change); Allowlist→Login→Revoke-Flow auf Wegwerf-`@authtest`; `settings-data` mode spiegelt DB; `PATCH /full-config {authMode:oauth}` → wirkungslos (Feld ignoriert); api_key-Chat grün. **KEIN Production-Deploy.**

**Verbleibend (optional, später):** Managed-Mode-Policy `auth_mode_default` falls nolmi.ai je einen anderen Default als `api_key` bräuchte (heute global `api_key`-Default ausreichend).

### Re-Bind Solo-Twin an eigene Bridge (D3 Stufe 1→2) ✅

**Status:** **DONE** (Distribution Etappe 2.4b, Block 25, lokal end-to-end verifiziert) | **Größe S** | D3-Setzung, CLI-only

**Phase-A-Befund:** `registerHandleOnBridge` (`onboarding/bridge-register.ts`) ist der vorhandene Register-Mechanismus (POST `/twins/register`, `BridgeRegisterError(status)` für 409/401), standalone + wiederverwendbar (nicht bootstrap-wired). **Kein Live-Re-Init:** `addTwin` no-op bei geladenem Twin, kein `setBridgeClient`; `buildEntry` baut den BridgeClient nur bei `bridgeUrl && bridgeToken` beim Boot → Re-Bind greift erst nach **Runtime-Neustart**. `auth_mode` orthogonal (update() patcht nur bridge-Felder).

**Umsetzung:** neuer CLI `twin:bind-bridge <@handle> --bridge-url <url> [--register-token …]` (`scripts/bind-bridge.ts`). `registerHandleOnBridge` um optionalen `registerToken`-Param erweitert (backward-compat, Fallback ENV). Ablauf: solo-Validierung (kein Umbinden) → Register ZUERST → bridge_url/token ERST nach Erfolg (atomar, Fehlerfall lässt Solo) → Neustart-Hinweis. **Scope-Grenze (D3):** nur EIGENE Bridge (Owner kennt Register-Token); Fremd-Bridge/Föderation = Phase 4.

**End-to-End verifiziert** (Wegwerf-@bindtest, restlos entfernt): Solo 409 → Re-Bind (bridge_url/token gesetzt, Bridge-DB registriert) → Neustart `[bridge:stream] verbunden` → A2A-Send **201** statt 409. Fehlerfälle (falsches Token 401, unerreichbare Bridge) → bridge_url bleibt NULL. Already-bound-Guard lehnt ab. @markus-Regression intakt, `auth_mode` unberührt. **KEIN Production-Deploy.**

**Verbleibend (später):** UI-Re-Bind-Knopf in Settings (zweite Tür — heute CLI-only, weil Neustart-Erfordernis UI-Re-Bind ohne Live-Reload entwertet); Umbinden bereits gebundener Twins (eigener Fall); Live-Re-Init ohne Neustart (`setBridgeClient`-Pfad).

### Single-Host One-Liner-Install-Skript (ohne TLS) ✅

**Status:** **DONE** (Distribution Etappe 2.3, Block 26 gebaut + Block 27 **am Verhalten verifiziert** — Frische-Test von Null bestanden) | **Größe M** | One-Liner-Install, Single-Host-Tür

**Phase-A-Befund:** Der vorhandene `docker/nolmi/docker-compose.yml` ist der **Production-Stack** (Traefik `external`-Netz, TLS-certresolver, htpasswd) → nicht Single-Host-tauglich, **separate Traefik-freie Variante** nötig. DB-Init läuft **automatisch** im Container-CMD (idempotent, Runtime + Bridge) → kein manueller `db:init`. Alle Dockerfiles nutzen schon `@nolmi/*`-Filter (B2-Runbook-„@twin-lab"-Hinweis stale). `loadMasterKey` verlangt 32-Byte-base64 → `openssl rand -base64 32` ist format-gleicher Drop-in (Host-node für die Generatoren nicht nötig).

**Umsetzung:**
- `docker/nolmi/docker-compose.single-host.yml` — 3 Services, `build:`-Blöcke (Kontext `../..`), Ports 3000/4000/5100 direkt, internes Netz, **kein** Traefik/TLS/htpasswd. `SESSION_COOKIE_SECURE=false` (Login über http), `TELEGRAM_USE_POLLING=true` (kein Webhook-Crash-Loop), Web-Build-Args `NEXT_PUBLIC_RUNTIME_URL`/`DEPLOYMENT_LABEL=self-host`.
- `install/install.sh` — `set -euo pipefail`, 7 Schritte (OS/Tools → Docker prüfen/+apt-install → Repo klonen-oder-nutzen → `.env` mit `openssl`-Secrets **idempotent, nie geloggt, umask 077** → `up --build -d` → DB-Init-Hinweis → Übergabe an `twin:onboard` via `docker compose exec`). ENV-konfigurierbar (`NOLMI_HOST` für VPS-IP etc.).
- `install/README.md` — lokal vs. VPS, Ports/Sichtbarkeit, TLS=3b.

**§7-Cookbook-Befunde adressiert (Single-Host-relevant):** B2-Befund 2 (Telegram-Polling-Default) + #126 (Web-Build-Arg). Traefik-Befunde (B1-1/2, B2-1/4) explizit auf 3b verschoben.

**Verifiziert (statisch, Block 26):** `bash -n` Syntax grün; `docker compose -f …single-host.yml config` VALID (3 Services).

**Verifiziert (am Verhalten, Block 27 — Frische-Test von Null):** echter Lauf in einem isolierten `docker:dind`-Wegwerf-Container (srv1046432, getrennt vom Standby, danach restlos entfernt). Code **credential-frei** rein via `git archive` + stdin-tar → **Mode 1** („Im Repo ausgeführt", kein Clone/PAT). **7/7 Skript-Schritte grün** (Build aller 3 Images ~115 s, out-of-the-box, keine stale `@twin-lab`-Referenz; `.env`-Secrets via `openssl` nicht geloggt). **3 Container Up** (kein Restart-Loop). Runtime sauber: **alle 26 Migrationen frisch inkl. 026 im `foreign_keys_off`-Modus auf LEERER DB** (Nebenbefund: FK-Cascade-sicherer Runner-Tweak läuft auch auf frischer Wiese), Onboarding-only/0 Twins, :4000, **kein `EADDRINUSE`, kein Telegram-Crash-Loop**. Isolation gehalten (Standby + alle srv1046432-Stacks unberührt). Bewusst nicht im dind getestet: `twin:onboard`+Browser (2.2 schon end-to-end) + externer Port-Zugang. **KEIN Production-Deploy.**

**Verbleibend:** **Schritt 3b** (Production/TLS: Traefik + ACME + Domain + BasicAuth — der bestehende `docker-compose.yml`); Update-Mechanismus (git pull + rebuild / Image-Tag-Bump); optional Docker-Auto-Install auch für non-apt-Linux.

### First-Run: Port-Pre-Check vor `compose up` (3000/4000/5100)

**Status:** OFFEN | **Größe:** S | **Priorität:** nice | **Aus:** First-Run-Hygiene-Diagnose Tag 36

`onboard.ts:121` ruft `compose up` direkt; bei belegtem Port kommt der rohe Docker-Fehler („Bind for 0.0.0.0:3000 failed: port is already allocated") via `runInherit` durch. Legibel, dev-affines Frühpublikum verkraftet's — aber eine freundliche NOLMI-Pre-Check-Diagnose (Ports frei? sonst klarer Hinweis) wäre erstnutzer-freundlicher, konsistent zu den schon sauberen Vorbedingungs-Checks (OS/git/docker/daemon).

### SETUP.md: Provider-Framing auf Anthropic-Default angleichen

**Status:** OFFEN | **Größe:** S | **Priorität:** nice | **Aus:** First-Run-Hygiene-Diagnose Tag 36

`docs/SETUP.md` (~:10/:25) rahmt OpenAI als primär (`OPENAI_API_KEY`, „oder später: Anthropic"), während der ausgelieferte Stack `ACTIVE_PROVIDER=anthropic` defaultet (`env-template.ts:48`). SETUP.md ist Dev-Doc (`pnpm dev`), nicht Tarball-Erstkontakt → gering. Beim nächsten SETUP.md-Anfassen mit angleichen.

### Production-Deploy Etappe 2 (Sammeldeploy c88f0eb) — Migration 026 FK-safe auf Echtdaten ✅

**Status:** **DONE** (Distribution Etappe 2 Schritt 5, am Verhalten auf Production verifiziert) | **Größe M** | **Priorität war: must-vor-Self-Hosting-Release** | srv1712371 (`187.124.3.235`), `/docker/nolmi/repo`

Sammeldeploy `main`→`c88f0eb` auf den Production-VPS: **Etappe 1 + 2.1 + 2.2 + 2.4a + 2.4b + 2.3 + Migration 026** in einem Rutsch. Production stand vorher auf Migration 025.

**Befund vorab (Single-Point-of-Failure):** Die Etappe-2-Commits (`24665a1`, `c5f9012`, `a75adbe`, `aaf207a`, `4ee36ad`, `c88f0eb`) waren **lokal committet, aber nicht gepusht** — `origin/main` stand auf `2ad7d3d`. Erst `git push` (FF `2ad7d3d`→`c88f0eb`, kein Force; Pre-Push-Hook `pnpm -r build` grün), dann VPS-`git pull --ff-only` + Rebuild auf dem **vollständigen** Stand. Die nur-lokale Existenz der Etappe-2-Arbeit ist damit beseitigt.

**Migration 026 (destruktiver 12-Schritt-FK-Rebuild von `twin_profiles`) auf Production-Echtdaten SICHER:**
- Runtime-Log **„026 … angewendet (foreign_keys_off-Modus)"** = der **neue** FK-sichere Runner (aus `6c6032f`) fuhr sie, nicht der alte. Schutz greift, weil das neue Image Runner+026 zusammen bündelt → beim Boot läuft der neue Runner zuerst (`init-db.js && exec index.js`).
- `foreign_key_check` **leer** (kein verwaister FK in den 11 Kind-Tabellen).
- `bridge_url`/`bridge_token` jetzt **`notnull=0`** (vorher 1).
- **Kind-Tabellen-Counts vorher=nachher IDENTISCH** — einzige Differenz `schema_migrations` 25→26 → **kein Cascade-Verlust, Twin-Historie intakt** (der härteste Beweis).

**Pre-Flight B4-Klasse:** `VACUUM INTO`-Konsistenz-Snapshot von `twin.db` **und** `bridge.db`, tar.gz nach `/docker/nolmi`, **offsite auf den Mac** (`nolmi-db-backup-20260531-064823.tar.gz`). Rollback-Image `nolmi-runtime:rollback-025` (+ `web`) getaggt **vor** dem Rebuild, Counts-before festgehalten.

**Live verifiziert (am Verhalten):** Direct-Chat @markus über `app.nolmi.ai` · A2A @markus→@florian Echtzeit (**201**, kein 409, `bridge_url` erhalten) · `auth_mode`-Gate 2.4a live (api_key-Twin **kein** OAuth-Button in Settings). 3 Container Up, **Bridge unangefasst** (kein Bridge-Code-Change — `bridge-register.ts` liegt unter `apps/runtime/`, nicht in der Bridge-App; nur runtime + web rebuilt).

**Aufräum-Reminder (kein Blocker):** Rollback-Images `nolmi-runtime:rollback-025` + `nolmi-web:rollback-025` liegen noch auf dem VPS. **Aufräumen erst nach einer Stabilitäts-Schamfrist** (einige Tage Production-Laufzeit ohne Auffälligkeit), nicht sofort.

**Verbleibend:** Schritt 3b (TLS-Install) bleibt offen; Root-404 separat (Item direkt unten).

### 129. .env.example-Default auf Anthropic switchen ✅

**Abgeschlossen Tag 30 (28. Mai 2026, Donnerstag), gemeinsam mit #127 in einem Commit (Tag 30 Block 1).** `.env.example` Provider-Block umgestellt:
- `ANTHROPIC_API_KEY=sk-ant-replace-me` aktiv (vorher auskommentiert)
- `ANTHROPIC_MODEL=claude-opus-4-7` aktiv (vorher auskommentiert)
- `ACTIVE_PROVIDER=anthropic` (vorher `openai`)
- `OPENAI_API_KEY` + `OPENAI_MODEL` als auskommentierter Alternativ-Block mit Switch-Anleitung („für Switch hier un-kommentieren, unten ACTIVE_PROVIDER=openai setzen")

Quick-Start matched jetzt README + Tech-Stack-Story. Friktionsloser Switch zwischen beiden Providern via 2-Zeilen-Edit.

**Größe ursprünglich:** XS. **Final:** ~5 Min (gemeinsam mit #127). **Spur:** Pre-Launch-Phase A.

### 130. Telegram-Adapter Stufe 1 (Owner-Only-Bridge) ✅

✅ **Erledigt** (Beleg: STAND Tag 26 — Telegram Phase 1–5 production-deployed.)

Wettbewerbs-Pivot aus Tag 25 Strategy-Session (`docs/BLOCK-5-STRATEGY.md`): NanoClaw + Hermes Agent haben Multi-Channel-Messaging als Default. Twin-Lab ohne Messaging-Integration wirkt rückständig im Self-Hosting-Markt, auch wenn Multi-Twin ein anderes Konzept ist. Telegram-Stufe-1 verteidigt minimal-viable.

**Scope Stufe 1 — Owner-Only-Bridge:**

- Owner verbindet eigenen Telegram-Account via `/start`-Command zum eigenen Twin
- Twin antwortet auf Owner-Messages mit voller Memory-Tiefe und Persona
- Bot-Token-Storage encrypted in Settings pro Twin
- Webhook-Pattern (`/webhooks/telegram/:twin-handle`) hinter Traefik
- Single-User pro Twin, kein External-Sender-Auth-Flow (das wäre Stufe 2)

**Implementation-Skizze:**

- Migration für `telegram_chats`-Tabelle + Bot-Token-Storage (encrypted via existing ENCRYPTION_KEY-Pattern)
- `apps/runtime/src/telegram/`-Service mit Bot-API-Client (`node-telegram-bot-api` oder `telegraf`)
- Webhook-Endpoint mit Auth-Token-Verification (Telegram-Webhook-Secret)
- Owner-Pairing-Flow: `/start`-Command matched Telegram-User-ID gegen Owner-Email-Hash, persistiert Mapping
- Settings-UI: pro Twin „Telegram-Bot konfigurieren" mit Bot-Token-Eingabe + Test-Connection-Button + Pairing-Status
- Conversation-Persistence in existing audit-stream (Channel-Marker `telegram` zusätzlich zu `web`)

**Smoke-Tests:**

- Send-Receive-Roundtrip
- Multi-Turn-Konversation mit Memory-Recall über mehrere Sessions
- Memory-Hit-Badge auch sichtbar wenn Konversation via Telegram begann und im Web fortgeführt wird
- Cross-Channel: User schreibt im Web, dann auf Telegram weiter — Conversation-Thread bleibt zusammen

**Größe:** L · **Priorität:** must · **Aus:** Block-5-Strategy Tag 25 (Wettbewerbs-Pivot) · **Spur:** Pre-Launch-Phase A (Block 5)

**Status-Notiz Tag 25:** Wettbewerbs-Pivot aus Block-5-Strategy-Session. Vorgezogen aus ROADMAP Phase 4.1 (Stufe 1 Owner-Only-Bridge). Strategy-Setzungen in `docs/BLOCK-5-STRATEGY.md`.

**Architektur-Detail:** Siehe [`docs/130-TELEGRAM-STRATEGY.md`](./130-TELEGRAM-STRATEGY.md) (Tag-25-Nachmittag-Session, sieben Achsen + 5-Phasen-Sequenz).

**Phase-B-Implikation:** Stufe 2 (External Senders mit Pre-Approval) und Stufe 3 (Voll-Multi-Twin-Router) bleiben Phase B. WhatsApp + Discord + Slack folgen in ROADMAP Phase 4.1-4.5 wie geplant.

### 131. OpenAI Subscription-OAuth — ✅ Phase A DONE (25.–26. Mai 2026)

**Status: ✅ DONE Phase A** (Tag 27–28, 30 Blöcke). Volle Bilanz in
[`docs/131-OAUTH-STRATEGY.md`](./131-OAUTH-STRATEGY.md) §a–§w (27 Sub-
Sections). CLI `pnpm twin:oauth-login @<handle>` (Phase 4) + Web-UI
Auth-Status + Modal (Phase 5) live. Bauzeit ~3 Tage statt initial-
geschätzten 5–7. Phase-B-Polish-Items: #139, #140, #141, #142, #143
(Web-OAuth-Production), #144 (VPS/Linux-Path), #145 (Multi-Account).

---

**Historische Doku (Original-Spec aus Tag 25, vor Bau):**

OpenAI Codex hat OAuth-Flow für Subscription-Auth (ChatGPT Plus/Pro/Team), offiziell für eigene Codex-Produkte. OpenClaw und vergleichbare Tools nutzen den Flow auch für eigene Apps — laut OpenClaw-Doku „explicitly supported", laut OpenAI-Codex-Doku nicht explizit für externe Apps adressiert.

**Status:** Backlog, nicht in Phase A. Bau in Phase B nach Launch + Feedback.

**Implementations-Skizze (für späteren Bau):**

OAuth-Flow analog OpenClaw (PKCE):

1. PKCE-Verifier/Challenge + Random-State generieren
2. Browser auf `https://auth.openai.com/oauth/authorize?...` öffnen
3. Callback auf `http://127.0.0.1:1455/auth/callback` (oder Twin-Lab-eigener Port)
4. Token-Exchange auf `https://auth.openai.com/oauth/token`
5. AccountId aus Access-Token extrahieren
6. `{access, refresh, expires, accountId}` per Twin verschlüsselt speichern (Reuse Existing EncryptionService aus `apps/runtime/src/crypto-utils.ts`)
7. Refresh-Loop mit File-Lock
8. Settings-UI: User wählt Auth-Mode pro Twin (API-Key vs Subscription-OAuth)

**Risiken (im UI explizit machen):**

- OpenAI hat den Pattern nicht prominent für externe Apps dokumentiert
- Pattern kann jederzeit von OpenAI gekappt werden (Präzedenz: Anthropic Claude Pro/Max Anfang April 2026 — initial gekappt, später laut OpenClaw-Doku „wieder erlaubt", Status fluide)
- ChatGPT-ToS lässt programmatische Nutzung in Grauzone
- Twin-Lab-Default bleibt API-Key (BYOK), OAuth ist explizites Opt-in mit ToS-Disclaimer

**Quellen:**

- OpenAI offizielle Codex-Auth-Doku: https://developers.openai.com/codex/auth
- OpenClaw OAuth-Doku (PKCE-Flow-Details): https://docs.openclaw.ai/concepts/oauth

**Größe:** XL (5-7 Bautage — PKCE-Client + Refresh-Service + Provider-Switch + CLI-Login + Settings-UI + SSH-Tunnel-Doku + Smoke). **Priorität:** should. **Spur:** Pre-Launch-Phase A Block 5.

**Status-Notiz Tag 25:** Recherche-Session zu Subscription-Auth-Patterns. OpenClaw nutzt diesen Pattern produktiv, dokumentiert PKCE-Flow präzise. Implementations-Pfad konkret skizziert, aber Pattern hat ToS-Grauzone-Charakter. Bau nicht launch-kritisch, Wartemodus bis Phase B + Nutzer-Demand.

**Status-Notiz Tag 26 (25. Mai 2026):** Vorgezogen von Phase B nach Phase A Block 5. Bau-Reihenfolge `#130 → #131 → #113 → #112 → #114 → #115`. Launch-Window von KW 29-30 auf KW 31-32 angepasst (1-2 Wochen Verschiebung).

**Begründung Vorziehung:**
- Owner-Persona-Validierung: Power-User mit OpenAI + Claude beide via Subscription (Max-Plan, ChatGPT Plus). OAuth ist Kern-UX-Verbesserung, nicht Convenience (1000+ Messages/Monat via API-Key kosten substantiell mehr als Subscription)
- Wettbewerbs-Positionierung: OpenClaw + Hermes haben OAuth, "BYOK-only" wäre HN-Feedback-Schwäche im Launch-Day
- OpenAI dokumentiert + supported 3rd-Party-OAuth offiziell (developers.openai.com/codex/auth), nicht Reverse-Engineering wie befürchtet
- Launch-Toleranz akzeptiert: KW 31-32 ist immer noch innerhalb sinnvollem Launch-Fenster

**Twin-Lab-Default bleibt BYOK** (API-Key). OAuth ist Opt-in mit ToS-Disclaimer: "OpenAI hat das nicht explicit für 3rd-Party-Apps dokumentiert, kann gekappt werden."

**Phase-A-Status:** `should`-Item, neue Spur Pre-Launch-Phase A Block 5.

**Status-Notiz Tag 27 (25. Mai 2026):** Strategy-Session abgeschlossen. Re-Estimate auf XL (5-7 Bautage) nach Recherche-Findings: OpenAI Codex OAuth hat hardcoded localhost:1455-Redirect, headless-OAuth nicht supported (Issue #2798 offen). SSH-Tunnel-Pattern ist Branchen-Standard (Hermes, RooCode, OpenCode).

Strategy-Setzungen:
- CLI-First (`pnpm twin:oauth-login`), Web-UI zeigt nur Status
- Exklusiver Auth-Mode pro Twin (api_key XOR oauth)
- Migration 025: dedizierte `oauth_tokens`-Tabelle
- OpenRouter als dokumentierter Fallback (Hermes-Pattern)
- 5-Phasen-Bau mit Stop-Punkten

Strategy-Doc: [`docs/131-OAUTH-STRATEGY.md`](./131-OAUTH-STRATEGY.md).

**Status-Notiz Tag 27 Nachmittag (25. Mai 2026):** Phase 1 + 2 abgeschlossen (Commits `cfe223c` Backend-Foundation, `638e200` Refresh-Service). Phase 3 Strategy-Iteration mit substantiellen Architektur-Findings.

**Re-Estimate XL → XXL (8-12 Bautage):**

- OAuth-Token funktioniert NICHT mit Standard-OpenAI-API (`api.openai.com/v1/*`)
- Codex-spezifischer Backend-Endpoint `chatgpt.com/backend-api/codex/responses` ist Pflicht
- Pre-Flight 3/3 HTTP 200 verifiziert (curl Mac, VPS-Container, Node v22 native fetch)
- Node native fetch durchgelassen — kein TLS-Bypass / curl-FFI nötig
- Spike-First-Approach: Walking-Skeleton vor inkrementellem Sub-Phasen-Ausbau

**Phase 3 Sub-Phasen-Sequenz:**

| Sub-Phase | Aufwand | Tag |
|---|---|---|
| 3.0 Spike (Direct-fetch + Minimal-Instructions) | 2-4h | 27 |
| 3.1 SSE-Parser-Robustness | 1 Tag | 28 |
| 3.2 Codex-System-Prompt-Engineering | 0.5-1 Tag | 28 |
| 3.3 Tool-Calls + Reasoning-Traces | 1-2 Tage | 29 |
| 3.4 Vercel-Provider-Refactor (optional) | 1 Tag | 29-30 |

**Risiko-Assessment (neu in Strategy-Doc §j):**

- Risiko 1: ToS-Grauzone (Mitigation: Disclaimer + Monitoring + OpenRouter-Fallback)
- Risiko 2: Pattern-Block-Präzedenz (Anthropic April 2026), Mitigation: BYOK bleibt funktional, Closed-Beta-Approach
- Risiko 3: Codex-Endpoint-Format-Changes, Mitigation: CLI-Release-Monitoring, Format-Mapping isoliert in 3.4

**Launch-Window-Impact:** KW 33-34 (statt KW 31-32). Buffer 0-7 Tage (statt 5-15 Tage). Phase-A bleibt machbar aber ohne weiteren Slack.

Strategy-Doc erweitert um §g (Codex-Endpoint-Architektur), §h (Cloudflare-TLS-Pre-Flight), §i (Sub-Phase-Sequenz), §j (Risiko-Assessment), Re-Estimate-Section.

**Status-Notiz Tag 27 Abend (25. Mai 2026):** Phase 3.0 Spike Walking-Skeleton durch. Variante (c) — Branch in `TwinService.chat()` vor `generateText`, eigene `runModelViaCodex`-Helper-Methode bypassed Phase-3.1+-Schichten (Skills, Tools, Pre-Pass, Memory).

Sub-Bau (~5 Schritte):
1. `TwinProfile.authMode` exposen (Interface + Row + Queries + `setAuthMode`) — Phase-1-Audit-Repair, Migration 025 hatte das Feld nie über den Repo-Layer gehoben
2. `OAuthRefreshService` in `RegistryDeps` + `TwinServiceDeps` (optional)
3. `oauth/codex-adapter.ts` mit direct-fetch + SSE-Text-Collector
4. `runModelViaCodex`-Branch in `runModel` (lazy CodexAdapter-Init)
5. Helper-Script `test-oauth-phase3-spike.ts` mit `smoke`/`setup`/`cleanup`-Modes

**Smoke 1 (Adapter-only) — grün:** HTTP 200 in 2.4s, plan-type=pro, cf-ray gesetzt, Response-Text korrekt geliefert. Echter Codex-Token aus `~/.codex/auth.json` → AES-256-GCM-DB-Persist → `ensureFresh` → Codex-Endpoint → SSE-Stream → Text-Collect. End-to-End-Architektur durchgehend bewiesen.

**Smoke 2 (End-to-End via `/twins/@markus/chat`) — skipped:** `pnpm dev` lokal nicht erreichbar (Runtime auf :4000 nicht hochgekommen, vermutlich Telegram-Webhook-ENV-Friction → siehe #138). Server-Layer-Aufruf ist nur noch Wiring durch existing `requireOwner` + `entry.service.chat()` — der OAuth-Branch sitzt in `runModel` und wird von beiden Send-Pfaden erreicht. Phase 3.1 (Tag 28) zieht End-to-End-Smoke zusammen mit SSE-Parser-Robustness nach.

**Lesson Tag 27 #4 (siehe STAND):** Migration ohne Repo-Update ist Anti-Pattern. Migration 025 hatte `auth_mode`-Column angelegt aber nicht durch `TwinProfile`-Read/Write-Pfad gehoben — Phase-3.0-Spike hat den Fehler beim ersten Konsum aufgedeckt. Repair in Schritt 1 mit erfasst.

### 135. Account-Settings UI (Email/Password-Edit-Surface) ✅

**Abgeschlossen Tag 29 (27. Mai 2026, Mittwoch), Commit `f39b14f` auf `origin/main`. Production-Deploy Tag 29 auf `3561122`.** Option B umgesetzt: eigene Route `/account` mit zwei Forms (Email-Change + Password-Change), beide mit Current-Password-Confirm. UsersRepo um `updateEmail` (Email-Uniqueness-Pre-Check, wirft `UserAlreadyExistsError`) + `updatePassword` (bcrypt cost 12) erweitert. Zwei neue Endpoints `PATCH /auth/me/email` und `PATCH /auth/me/password` mit Session-Check (`getCurrentUser`) + `verifyPassword`-Confirm. ProfileMenu-Link „Account" oberhalb Logout. Middleware `PROTECTED_PREFIXES` um `/account` ergänzt.

Phase-A-Setzungen umgesetzt: Email-Change ohne Verify-Link (direkt umstellen für drei dev-fitte Owner), Old-Password als Confirm-Pflicht beim Passwort-Wechsel. Account-Delete bewusst **defer** auf eigenes Item (semantisch heavy: Twin-Kaskadierung, A2A-Konversationen), Email-Verify-Flow defer auf Phase B. Keine neuen BACKLOG-Items aus dem #135-Bau angelegt — die Defers sind im Briefing als „eigenes Item für später" formuliert ohne Anlegen-Anweisung; sie werden konkret, wenn der jeweilige Block sie zieht.

Typecheck 4/4 grün, Husky-Build 4/4 grün (Push-Hook), Local-Smoke 7/7 grün (Login + `/account` via ProfileMenu + Email-Change Happy-Path + Re-Login mit neuer Email + Password-Change Happy-Path + Re-Login mit neuem PW + Edge-Cases: 401-Toast bei falschem Current-PW, 409-Toast bei kollidierender Email, Submit-Disabled bei `<8`-Char und Mismatch).

**Production-Deploy Tag 29 (Block 3):** VPS `srv1046432` `git pull origin main` zog `f39b14f` + `3561122` (Drift ab Tag-28-Block-20 `7453bd9`). Bridge bewusst **nicht** rebuilt — kein Bridge-Code in #135, Schema-Union unverändert (Lesson Tag 29 #1 + Lesson Tag 28 #15). Nur runtime + web rebuilt + recreated, web mit `--build-arg NEXT_PUBLIC_RUNTIME_URL=https://runtime.twin.harwayexperience.com` (Lesson Tag 28 #13). **Production-Smoke 7/7 grün** (gleiche 7-Schritt-Liste wie Local-Smoke). **DB-Verify:** `markus.baier@harway.de` mit `updated_at: 2026-05-27T16:08:18.760Z` (Production-Audit-Trail-fähig, Repository-Pattern korrekt durchgereicht). Nach Smoke Original-Email + Original-Passwort restored — Production-Account in Pre-Smoke-Zustand.

**Größe ursprünglich:** S (~0.5 Bautag — Page + Form + 1-2 Backend-Endpoints für Email-Change + Password-Change). **Final:** ~3h 40 Min netto (Backend ~30 Min, Frontend ~1h, Middleware + ProfileMenu + Doku ~30 Min, Diagnose-First ~15 Min, Closure-Doku ~10 Min, Production-Deploy + Smoke ~20 Min, Production-Closure-Doku ~10 Min). **Spur:** Pre-Launch-Phase A Block 4 (Self-Hosting-Polish).

**Status-Notiz Tag 26:** Angelegt aus Phase 4 Tag-26-Strategy-Session. Out-of-Scope für #130 Phase 4 (Tab-Restructuring war Channel-Adapter-Fokussiert).

### Account-/User-Löschung fehlt komplett (UI + CLI) — #744-Muster eine Ebene höher

**Status:** OFFEN | **Größe:** M–L | **Priorität:** should — **🔴 sobald externe Nutzer onboarden** (heute 🟡: kein Schmerz für den Solo-Owner) | **Aus:** First-Run-Hygiene-Diagnose Tag 36

Anlegen geht (`nolmi onboard` → `onboarding/onboard.ts:258` + `POST /auth/register`, `server.ts:860`), **entfernen gar nicht**: keine UI, kein CLI, kein Endpoint — nur manuelles SQL. `users-repo.ts` hat `create/findBy*/verify/updateEmail/updatePassword`, **kein `delete`**. Exakt das #744-Muster (CREATE ohne Gegenstück), eine Ebene über dem Twin. Wird scharf, sobald fremde Self-Hoster iterieren und ihren Account/Reset wieder loswerden wollen — Launch-relevant, aber nicht Erst-Tag-blockierend.

**Semantisch heavy (daher M–L, nicht S wie #744 am Ende):** User-Delete kaskadiert über `owner_user_id` → alle Twins des Users → je Twin der volle #744-Löschpfad (geordnete Tx, Bridge-Deregister, Registry-Hot-Unload, Telegram-Teardown). **Vorbedingung:** FK-Audit auf `users(user_id)` — welche Tabellen referenzieren den User, mit welcher ON-DELETE-Policy (vgl. #159 FK-Cascade-Check + die Migration-026-Lehre: nicht alles ist CASCADE). Diagnose statt Briefing-aus-dem-Gedächtnis, wie bei #744.

**Bau-Skizze (für später, nicht jetzt):** (1) read-only FK-/Cascade-Diagnose `users(user_id)`; (2) `deleteUserAccount`-Service = pro Owner-Twin `deleteTwinLocal` + Bridge-Deregister, dann User-Row + abhängige Auth-Rows in geordneter Tx; (3) Owner-gegateter Endpoint + Self-Service-UI (Account-Settings, Type-to-confirm wie #744) ODER zunächst nur Admin-CLI `account:delete <email>` als schlanker erster Schritt. Cross-Ref: #135 (Account-Settings, Delete dort bewusst deferred), #159 (FK-Cascade-Check), #744 (Twin-Löschpfad als Baustein).

### 137. Production-Build-Test im Pre-Push-Workflow ✅

✅ **Erledigt** (Beleg: `.husky/pre-push` fährt `pnpm -r build`.)

Aus Tag-26-Phase-5-Deploy-Diagnose. Test-Page (`apps/web/app/test-tabs/page.tsx`) hatte useSearchParams() ohne Suspense-Wrapper — lokal lief durch (pnpm dev), Production-Build brach ab.

CI-Hook oder Pre-Push-Script:

```bash
pnpm --filter @twin-lab/runtime build && pnpm --filter @twin-lab/web build
```

Sollte als Pre-Push-Hook (Husky) oder GitHub-Action laufen. Vermeidet Wiederholung des Phase-5-Deploy-Stops.

**Größe:** S · **Priorität:** should · **Aus:** Tag 26 Phase 5 Build-Bug · **Spur:** Polish nach Phase 5

### 138. Local-Dev pnpm dev braucht dev-friendly Defaults für Telegram-Webhook ✅

**Abgeschlossen Tag 27 Abend (25. Mai 2026).** Hybrid-Branch in `apps/runtime/src/config.ts`: wenn weder `TELEGRAM_USE_POLLING` noch `RUNTIME_PUBLIC_URL` gesetzt sind, fällt die Runtime auf `TELEGRAM_USE_POLLING=true` mit Warning-Log zurück. `pnpm dev` aus pristinem Clone bootet damit out of the box. Production-Pfad (explicit `false` ohne URL) crasht weiter mit klarer Pflicht-Message.

`.env.example` Default umgestellt auf `TELEGRAM_USE_POLLING=true` plus Auto-Detection-Note. SETUP.md (Zeile 91-100) Auto-Detection-Erklärung ergänzt. DEPLOYMENT.md §10 Production-Pattern detaillierter mit Fallback-Klarstellung („nicht für Production").

Smokes 4/4 grün (alle isoliert via `env -i` + tsx-eval gegen `loadRuntimeConfig`):
1. Pristine env → Fallback + Warning
2. Explicit `false` ohne URL → Throw
3. Explicit `true` → kein Warning, polling=true
4. Production-Konfig (`false` + URL) → wie konfiguriert

Begründung Hybrid-Branch statt `parseBoolEnv`-Refactor: zwar ist `parseBoolEnv` heute nur Konsument für `TELEGRAM_USE_POLLING`, aber expliziter Branch am Call-Site ist lesbarer als Default-Magic im Util-Helper.

**Größe ursprünglich:** S — final: ~30 LoC + drei Doku-Files. **Aus:** Tag-27-Nachmittag Smoke-2-Aufsetz-Friction · **Spur:** Pre-Launch-Phase A Polish

### Telegram Re-Connect setzt Webhook nicht automatisch — ✅ DONE (Tag 37)

**Status:** ✅ DONE (Tag 37, `9ef57ba`) — POST /pairing-code löst jetzt registerWebhook automatisch aus (Auto-Heal-Variante a; ein expliziter „Webhook neu setzen"-Knopf wäre additiv möglich, war nicht nötig). Re-Connect ist selbstheilend.

**Status (ursprünglich):** OFFEN (Workaround dokumentiert) | **Größe:** S–M | **Priorität:** hoch (launch-relevant) | **Aus:** Telegram-Debug Tag 36

**Telegram Re-Connect setzt Webhook nicht automatisch** — beim Neu-Verbinden/Re-Pairing eines Telegram-Bots wird `setWebhook` NICHT ausgelöst (`bot-registry.ts:21` setzt ihn beim Eager-Load bewusst nicht; nur die Token-PUT-Route `api-routes.ts:143` triggert ihn). Folge: Pairing meldet Erfolg, aber der Bot empfängt keine Nachrichten, bis manuell „Token ändern" geklickt wird. Workaround dokumentiert (STAND Tag 36). Echter Fix offen: Re-Pairing / „Telegram verbinden" soll `setWebhook` selbst auslösen, ODER ein expliziter „Webhook neu setzen"-Knopf. Launch-relevant — jeder Self-Hoster, der Telegram (neu) verbindet, trifft das. (Der separate UNIQUE-Insert-Bug ist mit `0438c5d` gefixt — hier NICHT mehr offen.)

### #139 OAuth-Token-Refresh-Latenz bei Multi-Step-Tool-Use untersuchen — ✅ Tag 28 DONE

**Status-Notiz Tag 28 (26. Mai 2026):** Tracking-Pfad gebaut. `OAuthRefreshService.recordSuccess` analog `recordFailure` schreibt einen `oauth-refresh-success`-Audit mit `output: { latencyMs, oldExpiresAt, newExpiresAt, triggeredBy }`. `doRefreshIfNeeded` misst Latenz um den `refreshAccessToken`-Roundtrip. `ensureFresh(twinId, triggeredBy)` neu signiert (Default `"lazy"`), `pollAllTokens` markiert seinen Pfad als `"background"`. Plus Block-6-Sicherung: `OAUTH_REFRESH_POLL_DISABLED=true`-env-Guard in `start()` (Default unverändert, Lazy-Refresh bleibt aktiv), eingeführt nach zwei Token-Invalidierungs-Smokes (`refresh_token_reused` + `refresh_token_invalidated`). Phase-A-Diagnose (Block 7): H1 (refresh_token-Rotation nicht atomar) widerlegt, H2 (refreshAccessToken-Parsing-Bug) widerlegt, H3 (Race-Condition) unverifiziert, via Guard pragmatisch entschärft. Live-Smoke `audit_FuawriTsQd1j`: `latencyMs: 446`, `triggeredBy: "lazy"`, atomare Token-Rotation, `newExpiresAt` 10 Tage future. **Codex-Refresh-Token-Lifetime ist 10 Tage** (`expires_in: 863999`), nicht durch Code limitiert — siehe #150 für Doku-Klarstellung. Folge-Items: #149 (Mutex-Hardening), #150 (Token-Lifetime-Doku), #151 (id_token-/scope-Evaluation).

**Symptom (Tag 27 Phase-3.3.1.2-Smoke):** Multi-Step-Tool-Use über Codex-OAuth zeigt substantielle Latenz-Diskrepanz zwischen Initial- und Folge-Smoke desselben Setups:

- **Smoke 1** (audit `audit_huPk4-BddyVD`): 220s Wall-Clock für 2-Iteration-Multi-Step (`mcp:everything:get-sum`). Token war zu dem Zeitpunkt schon mehrere Minuten persistiert (zwischen `pnpm twin:oauth-phase3-spike setup` und Curl-Smoke).
- **Smoke 2** (audit `audit_fKxYZKYZYL5j`): 16.4s Wall-Clock für identischen Flow nach `codex login --force` + Re-Setup. Codex-Latenz 15.1s, codexIterations=2.

Faktor 14× langsamer im Initial-Smoke deutet auf Token-Refresh-Block hin: `OAuthRefreshService.ensureFresh` wird pro Codex-Request konsultiert (siehe `apps/runtime/src/oauth/codex-adapter.ts:78`), und bei nahem Ablauf vermutlich mit dem Refresh-Endpoint synchron blockiert. Mit Retry-Backoff im Codex-Adapter (3 Retries, 1s/2s/4s) summieren sich Refresh-Stalls zusätzlich auf.

**Hypothesen:**

1. Lazy-Refresh-Pfad blockiert Codex-Request länger als erwartet (z.B. >30s) wenn refresh_token expired oder Endpoint rate-limited
2. File-Lock-Mutex aus Phase 2 (`apps/runtime/src/oauth/refresh-service.ts`) hält bei Concurrent-Requests den Adapter unnötig auf — Mutex-Wait + Refresh-Roundtrip kumulieren
3. Withretry-Wrapper retried Refresh-bedingte 401s als „retryable" obwohl Refresh-Failure permanent ist

**Diagnose-Pfad:**

1. `pnpm dev`-Logs während Refresh-Trigger analysieren (`[oauth] refresh ...`-Lines mit Timestamps)
2. `RefreshService.ensureFresh`-Latenz instrumentieren (eigenes `console.time`/`timeEnd`-Paar vor dem Codex-fetch)
3. Smoke mit künstlich auf 10min expires_at gesetztem Token (statt 50min) — Reproducibility-Test für Lazy-Refresh-Block

**Priorität:** Medium. Production-Use mit langlebigem User-Session (Codex-Subscription pro Owner) trifft den Lazy-Refresh-Pfad regelmäßig — 220s Wartezeit bei jedem ersten Send einer Session wäre UX-fatal. Workaround heute: Frontend könnte einen periodischen Keep-Alive-Refresh triggern; saubere Lösung ist Async-Refresh ohne Request-Block.

**Out of Scope für Tag 27:** Phase 3.3.1.2 ist End-to-End-grün dokumentiert (Smoke 2), Phase 3.3.1.3 (Approval-Pipeline) hat Vorrang. #139 wird in Phase B oder als Polish-Item gezogen.

### #140 Re-Pause-Pfad in Codex-Resume Smoke-verifizieren — ✅ Tag 28 DONE

**Status-Notiz Tag 28 (26. Mai 2026, Abend):** End-to-End grün via 2-Tool-Pause-Sequenz. Trigger-Prompt: „Rufe `mcp:everything-approval:get-sum` mit a=17, b=25 auf, danach `mcp:everything-approval:echo` mit dem Ergebnis als message." Pending-Audit 1 `audit_utkmv7E3YmUu` (get-sum, status=pending) → User approved → transitioniert zu `executed` mit `followUpPending=true`. Pending-Audit 2 `audit_Bm2GfH-gUD6R` (echo, status=pending) mit `priorAuditId: audit_utkmv7E3YmUu` → User approved → `executed`. Final-Audit: `Echo: 42`, `providerMetadata.provider="openai-codex"`, `model="gpt-5.5"`, `authMode="oauth"`, `planType="pro"`, `latencyMs=1822`. **Resume-nach-Resume verifiziert** — Codex bleibt zwischen zwei aufeinanderfolgenden Pauses im OAuth-Pfad, kein Token-Drift, kein `refresh_token_reused`. Polish-Item-Quartett #139+#140+#141+#142 damit zu 4/4.



**Kontext (Tag 27 Block 16, Phase 3.3.1.3.2):** Codex-Resume nach Approval funktioniert End-to-End grün (`audit_gSqqVwGGBY6O`, `mcp:everything-approval:get-sum`). Beim Bau wurde der **Re-Pause-Pfad mit-implementiert** für den Fall dass Codex in der Resume-Iteration ein weiteres `requires_approval=true`-Tool aufruft:

- Original-Audit kriegt `output.followUpPending=true` + Status auf `executed`
- Neuer Pending-Audit via `buildPendingMcpAuditFromError`-Helper mit `priorAuditId`-Link zum Original
- HTTP-Response des Approve-Endpoints: `{auditId: <neu>, pending: true, ...}` (durchgereicht via `ApproveResult.pending?: boolean`)

**Status:** Code-komplett, aber **Smoke nicht durchgeführt** — der `get-sum`-Trigger war zu trivial (Codex hat keine Follow-up-Tools gebraucht). Re-Pause-Verhalten ist Architektur-Beweis nur via Code-Review.

**Smoke-Plan:** Trigger der zwei requires_approval-Tools in Sequenz braucht. Kandidaten:
- `"Rufe mcp:everything-approval:get-sum mit a=10,b=20 auf, addiere dann 5 mit demselben Tool."` (gleicher Tool zweimal)
- `"Rufe mcp:everything-approval:get-sum mit a=10,b=20 auf, dann mcp:everything-approval:echo mit dem Ergebnis."` (zwei verschiedene Tools)

**Verify-Erwartung:**
- Approve auf Original-Pending → HTTP 200 mit `pending=true` + neuer auditId
- Original-Audit: status=executed, `output.followUpPending=true`, `output.providerMetadata.toolCalls` enthält den ersten get-sum-Call
- Neuer Audit: status=pending, `input.codexResumeContext` für nächste Resume, `input.priorAuditId` = Original-AuditId

**Priorität:** Nice. Pattern ist symmetrisch zum verifizierten Pause-Pfad — Bugs unwahrscheinlich, aber End-to-End-Verifikation für Phase-3-Closure-Confidence sinnvoll. Wird mit Phase 3.3.3 oder Phase 4 mitgezogen, wenn dort sowieso Smoke-Setups laufen.

### #141 oauth-providerMetadata-Verlust nach Big-Bang-Refactor — ✅ Tag 28 DONE (Commit `0b02482`)

**Status-Notiz Tag 28 (26. Mai 2026):** Gemeinsam mit #142 gefixt via 2-Phasen-Patch in `apps/runtime/src/twin-service.ts:runModel`-Return. Un-Nest des verschachtelten `providerMetadata["openai-codex"]`-Namespace + flat-merge ins Audit-Output. `provider`/`model`-Split, `authMode`+`twinId`-Inject via `this.deps.twinId`, `latencyMs` zentral pre-Branch gemessen, `unknownEventTypes` Array-normalisiert. Mikro-Korrektur in Block 2.3: `model` aus `result.response.modelId` (Provider-deklariert) statt aus `activeModelLabel`-Split. Verifiziert via frischen Audit `audit_kEc7Oap0pQfo` (provider=openai-codex, model=gpt-5.5, authMode=oauth, twinId, planType=pro, cfRay, latencyMs, responseId, codexStatus alle gefüllt).

**Kontext (Tag 27 Block 22, Phase 3.4.3.1):** Nach Big-Bang Approval-Refactor läuft oauth-Pfad jetzt durch Vercel-`generateText` via `codexProvider`. End-to-End-Smoke `audit_0voltaVcvQaD` verifiziert: Tool-Roundtrip + History-Replay-Approve grün, finale Antwort "17 plus 25 ergibt 42.", `provider="openai-codex/gpt-5.5"`.

**Beobachtung:** `audit.output.providerMetadata.planType` + `cfRay` sind `null`/`undefined` nach Refactor. Vor Phase 3.4.3.1 waren die im Codex-direct-fetch-Pfad populated (siehe §o + Phase-3.3.x-Smoke-Audits).

**Hypothese:** `codex-vercel-provider.mapCodexOutputToV3Result` liefert die Felder eigentlich im `providerMetadata["openai-codex"]`-Block (Phase-3.4.1-Smoke-Output bestätigt das). Im TwinService-Audit-Pfad gehen sie irgendwo verloren — vermutlich beim `providerMetadata`-Pass-through im `runModel`-Return oder beim `audit.complete`-Schreiben.

**Diagnose-Pfad:**
1. `runModel`-Return-Statement nach `generateText` — wie wird `providerMetadata` an den Caller-Output gemapped? Eventuell flach kopiert, dabei verschachtelte `openai-codex`-Sub-Object verloren.
2. `audit.complete`-Caller — was schreibt `providerMetadata` wo hin?
3. Plus: gleicher Effekt auch im api_key-Pfad (Anthropic-Metadata)?

**Priorität:** Nice. Information ist nice-to-have für Debugging/Token-Accounting, kein User-Visual-Blocker. Phase B / Phase 5-Polish.

### #142 oauth-providerMetadata authMode + twinId null nach Phase 4.2 Smoke — ✅ Tag 28 DONE (Commit `0b02482`)

**Status-Notiz Tag 28 (26. Mai 2026):** Gemeinsam mit #141 gefixt im gleichen Patch — `authMode` + `twinId` werden jetzt via TwinService-Kontext (`this.deps.twinId`, `isOAuth`-Flag) im `runModel`-Return injected. Siehe #141-Status-Notiz für Details.

**Kontext (Tag 27 Block 25, Phase 4.2 Smoke):** End-to-End-Smoke des Production-CLI grün (`audit_ukzHFjas_woB`, `provider="openai-codex/gpt-5.5"`, reply="Hallo.", capability=owner-direct). CLI-Pfad funktional, OAuth-Token korrekt persistiert + verwendet.

**Beobachtung:** `audit.output.providerMetadata.authMode` + `twinId` sind `null`/`undefined` im Smoke-Audit. Analog zu #141 (`planType` + `cfRay` null) — gleicher Verlust-Pfad vermutet.

**Hypothese:** Identisch zu #141 — `codex-vercel-provider`-Output kommt mit den Feldern im verschachtelten `providerMetadata["openai-codex"]`-Block, im TwinService-Audit-Pfad gehen sie beim flachen Pass-through verloren.

**Empfehlung:** Mit #141 zusammen lösen — wahrscheinlich ein einziger Fix-Point im `runModel`-Return oder `audit.complete`-Caller adressiert beide Symptome. Bei Diagnose alle providerMetadata-Felder gleichzeitig prüfen (planType, cfRay, authMode, twinId, plus latencyMs falls auch betroffen).

**Priorität:** Nice. Wie #141 — Debugging-/Audit-Hilfe, kein User-Visual-Blocker. Phase B / Phase 5-Polish.

### #131 Status nach Tag 27 — ✅ Phase A DONE (30 Blöcke)

**Phase A vollständig zu** mit Tag 27 Block 30 (Phase 5.4 BACKLOG-Cleanup). Volle Architektur + Sub-Phasen-Doku in [`docs/131-OAUTH-STRATEGY.md`](./131-OAUTH-STRATEGY.md) §a–§w. Bauzeit-Bilanz ~3 Tage netto (~22h) gegen Initial-Schätzung XL (5-7 Tage) bzw. nach Strategy-Iteration XXL (8-12 Tage). Substantielle Einsparungen durch Diagnose-Reflex (Pattern-Recognition vor jedem Sub-Bau) + zwei Architektur-Pivots (Big-Bang Approval-Refactor §s ~1260 LOC Net-Removal; Phase-4-Wrapper-Pattern §t statt Loopback-Listener ~4x schneller).

**Phase-B-Polish (BACKLOG-tracked, nice-to-have):** #139 (Refresh-Latenz), #140 (Re-Pause-Smoke), #141+#142 (providerMetadata pass-through, sollten gemeinsam gefixt werden), plus neue Phase-B-Items #143 (Web-OAuth-Production ohne CLI), #144 (VPS/Linux-Path via `--device-auth`), #145 (Multi-Account-Support).

### #146 `extractModel()` Split-Fallback-Cleanup — ✅ Tag 28 DONE (Commit `3dbbc0b`)

**Status-Notiz Tag 28 (26. Mai 2026):** Split-Fallback komplett entfernt, Return-Type von `string | null` auf `string` mit `"unknown"`-Fallback. Pre-Tag-28-Audits zeigen jetzt `"unknown"` statt zerlegtem Model-Wert — akzeptiert als Debug-Surface-Drift (keine User-Facing-Surface). `extractModel`-Konsumenten (`twin-answer.tsx:39`, `a2a-activity.tsx:73`) unverändert; ihr `?? undefined`-Pattern ist jetzt dead code für die rechte Seite, funktional aber äquivalent (`formatTokenCost` fällt für `"unknown"` über Pricing-Lookup-Miss auf `DEFAULT_MODEL` zurück).

**Kontext (Tag 28):** Nach Fix #141+#142 (Commit `0b02482`) produzieren neue Audits `providerMetadata.model` als eigenes flaches Feld (aus `result.response.modelId`, Provider-deklariert). Der Compound-String-Split-Fallback in `apps/web/lib/audit-render/utils.ts:50-64` (`provider.split("/")` mit Take-Last-After-Slash) ist nur noch für Pre-Refactor-Audits relevant.

**Soll-Stand:** `extractModel()` kann den Fallback-Pfad löschen, sobald entweder (a) alle Pre-Refactor-Audits via Pruning weg sind, oder (b) ein Cut-Off-Datum gesetzt wird ab dem die DB nur noch Post-Patch-Audits enthält. Im Code dann nur noch `return output?.providerMetadata?.model ?? null;`.

**Priorität:** nice. Funktionaler Impact null (Fallback funktioniert weiterhin korrekt), Wartungs-Hygiene. Erst sinnvoll wenn Tag-28-Audits in der Mehrheit sind oder DB-Pruning durchläuft.

### #149 Mutex-Hardening in `OAuthRefreshService.ensureFresh` — ✅ Tag 28 DONE (Diagnose, Pattern Null)

**Status-Notiz Tag 28 (26. Mai 2026):** Block-11-Diagnose-Spike hat das Item strukturell aufgelöst. `inFlight`-Mutex in `OAuthRefreshService.ensureFresh` ist korrekt im pure-JS-Single-Process-Modell: `Map.get` und `Map.set` sind synchron im selben Event-Loop-Tick, kein await-Boundary dazwischen, kein Race-Window. Tag-28-Vormittag-Failures (`refresh_token_reused`, `refresh_token_invalidated`) sind nicht durch dieses Mutex-Pattern entstanden — wahrscheinlichste Erklärung: Hot-Reload-Race (`tsx watch` erzeugt parallele `OAuthRefreshService`-Instanzen) oder CLI-Concurrent-Write (`pnpm twin:oauth-login` schreibt DB-State parallel zur Runtime). Adressiert via JSDoc in `refresh-service.ts:ensureFresh` (Cross-Ref auf Block-6-Guard + #152). **Kein Code-Patch in diesem Item nötig** — Pattern Null als Verdikt. Strukturelle Adressierung der Hot-Reload-Race siehe #152.

**File:** `apps/runtime/src/oauth/refresh-service.ts:102-111` (`ensureFresh`).

**Hintergrund (Tag 28 Block 5-7):** Bei Smoke-Verifikation für #139 traten zwei aufeinanderfolgende Token-Invalidierungen auf — erst `refresh_token_reused`, nach Re-Login dann `refresh_token_invalidated`. Plausibelste Erklärung: Race-Condition zwischen Background-Poll-Loop (`pollAllTokens` → `ensureFresh`) und Lazy-Trigger (`CodexAdapter.executeRequest` → `ensureFresh`) im theoretisch atomaren V8-Synchron-Block zwischen `Map.get` und `Map.set` der `inFlight`-Mutex. Phase-A-Diagnose (Block 7) hat das nicht direkt verifiziert, aber via Block-6-Guard (`OAUTH_REFRESH_POLL_DISABLED=true`) empirisch entschärft.

**Action:** `ensureFresh`-Mutex auf hartere Garantien umstellen. Optionen:
- **A:** Atomare Check-and-Set via Promise-Marker (Promise wird ins Map gesetzt **bevor** `doRefreshIfNeeded` startet — heute schon der Fall, aber zwischen den zwei Statements liegt ein synthetisches Race-Window. Re-Read als Patternverifikation reicht eventuell.)
- **B:** DB-Lock auf `oauth_tokens`-Row während Refresh (better-sqlite3 `BEGIN IMMEDIATE`-Transaktion um find-update-Sequenz).
- **C:** Refresh-Pfad serialisieren via Module-Singleton-Promise-Queue für alle Twins (Overkill bei Single-Twin-Self-Hosting).

**Priority:** nice-to-have, empirisch entschärft via Block-6-Guard. **Aufwand:** M (~1 Tag).

**Hinweis:** Wenn implementiert, kann Block-6-Guard optional entfernt oder als permanente Notfall-Sicherung bleiben — Default Off statt On.

### #150 Token-Lifetime-Klarstellung in `131-OAUTH-STRATEGY.md` — ✅ Tag 28 DONE

**Status-Notiz Tag 28 (26. Mai 2026):** Doku-Section §x in `docs/131-OAUTH-STRATEGY.md` neu (6 Sub-Sections §x.1-§x.6). Inhalt: Refresh-Token-Lifetime ist 10 Tage (`expires_in:863999`), Code limitiert nichts, `pnpm twin:oauth-login`-Initial-Token ist CLI-Artefakt (~50 Min, springt nach erstem Refresh auf 10 Tage), Background-Poll-Konsequenz + Cross-Ref #149, Setzungen für zukünftige Sessions, Lesson Beobachtungs-Artefakt vs. System-Constraint.

**Hintergrund (Tag 28 Block 7):** Codex-OAuth-Refresh-Token-Lifetime ist **10 Tage** (`expires_in: 863999` Sekunden), live verifiziert in `audit_FuawriTsQd1j`. Unser Code limitiert das nicht — `new Date(Date.now() + response.expires_in * 1000)` in `refresh-service.ts:165-167` schreibt direkt was Codex liefert.

**Beobachtung:** `pnpm twin:oauth-login` (CLI-Wrapper über `codex login`) schreibt Initial-`expires_at` mit nur ~50-60 Min in die DB. Quelle vermutlich `id_token.exp` oder Codex-CLI-internes Initial-Token-Lifecycle-Step. Sobald der erste Refresh durchgelaufen ist, springt `expires_at` auf 10 Tage.

**Action:** Abschnitt "Token-Lifetime" in `docs/131-OAUTH-STRATEGY.md` ergänzen:
- (a) Refresh-Token-Lifetime laut Codex-API: 10 Tage (`expires_in: 863999`)
- (b) Initial-Token nach `pnpm twin:oauth-login` kann kürzer sein (~50 Min) — CLI-Wrapper-Artefakt, nicht System-Constraint
- (c) Nach erstem Lazy-Refresh durch `CodexAdapter.executeRequest` springt `expires_at` auf 10 Tage
- (d) Code limitiert nichts, `expires_in` aus Refresh-Response wird 1:1 in DB persistiert

**Priority:** nice-to-have, Doku-only, kein Code-Change. **Aufwand:** XS.

### #155 A2A Reply-Architektur-Korrektur (messageType als Single-Source-of-Truth) — ✅ Tag 28 DONE (Commit `903a813`)

**Status-Notiz Tag 28 (26. Mai 2026, Abend):** Refactor von `inReplyTo`-Heuristik auf `messageType` als Single-Source-of-Truth für Empfänger-Verhalten. Bug: Web-UI setzte `inReplyTo` automatisch mit der letzten Thread-Message bei jedem Send (`apps/web/app/chat/[handle]/page.tsx` `lastReceivedBridgeId`-Memo) → jede neue Owner-Frage wurde als „reply" geframed → Empfänger-Twin-Service schrieb `reply-received`-Audit ohne LLM-Call. Wurzel: Tag-14-Implementierung (3. Mai 2026) hat Reply-Detection als generischen Fallschirm gebaut, der den Asymmetrie-Fall (Owner→Twin in aktivem Thread) nicht unterschied von Twin→Twin-Reply.

**Refactor:** Bridge-Schema `MessageType`-Union von 2 auf 5 Werte erweitert (`twin`, `system`, `owner-direct`, `twin-initiated`, `twin-reply`). Runtime-Send-Pfade: `ownerDirectSend → "owner-direct"`, `approveTwinSend → "twin-initiated"`, `approveTwinResponse` + `handleTrustedBridgeMessage → "twin-reply"`. Inbound-Switch in `receiveBridgeMessage`: alter Reply-Detection-Block (~53 LOC mit `lookupSender`-Failsafe) entfernt, ersetzt durch ~30 LOC `messageType`-Switch mit Legacy-Normalisierung `'twin' → 'twin-initiated'`. Web-UI: `lastReceivedBridgeId`-Memo + `inReplyTo` aus Send-Body raus. `inReplyTo` bleibt im Schema reserviert für künftiges Quote-Reply-Feature, `lookupSender` als `@deprecated` markiert. 8 Files, +173/-115.

**Production-Smoke:** 3 Container rebuilt + recreated (Runtime + Web + Bridge — Bridge initial übersehen, siehe Lesson #15). Smoke 1 grün: Owner-Direct an vertrauten Twin → Trusted-Bypass → Reply. Audits `audit_yBNtNszbAbkF` (owner-direct-send), `audit_qx0zMZHtSO21` (trusted-bypass), `audit_QZ0Rl-YFte5P` (reply-received). Latenz ~4 Sek.

### Rebrand-Phase 1 — Light-Mode-Switch ✅ Tag 30 DONE

**Abgeschlossen Tag 30 (28. Mai 2026, Donnerstag), Tag 30 Block 3.** Namens-**unabhängiger** Theme-Switch als visuelle Differenzierung gegen die dark-mode-Konkurrenz (OpenClaw/Hermes/NanoClaw). Hart auf Light, kein Toggle (Strategy-Doc §5 S7).

- `apps/web/tailwind.config.js`: 8 Token-Werte Dark → Nolmi-Light (Mapping-Tabelle in Strategy-Doc §2, Tokens identisch — Codex-Guides für alle Namens-Iterationen waren in Hex-Werten identisch, nur die Wordmark hat sich pro Iteration geändert) + 5 neue additive Status-Tokens (`accent-dark`, `info`, `warning`, `pending`, `success`)
- `apps/web/app/globals.css`: `color-scheme: light`, 8 CSS-Var-Aliases (für sonner-Toaster), 3 hardcoded Stellen (`html,body` + `::selection`) auf Light-Werte
- Strategy-Doc `docs/REBRAND-NOLMI-STRATEGY.md` (Tag 31 umbenannt von `REBRAND-TAVRYN-STRATEGY.md`) — heute Tag 30 mit-committed (war vorher untracked)
- Browser-Smoke 7/7 Haupt-Views grün (Login, Onboarding, Chat, Inbox, Settings, Facts, Stream), Kontrast überall lesbar, User-vs-Twin-Bubble-Unterscheidung erhalten, keine Token-Korrekturen nötig
- Typecheck + Husky-Build 4/4 grün

**KEIN Production-Deploy** — Light lebt erstmal nur im Repo + lokal, Nolmi kommt auf separaten Hostinger-VPS (Phase 4).

**Spur:** Pre-Launch-Phase A · **Aufwand:** ~1h (Bau + Smoke + Doku).

### Rebrand-Phase 2 — Sichtbarer Name-Rebrand ✅ Tag 31 DONE

**Abgeschlossen Tag 31 (29. Mai 2026, Freitag), Tag 31 Block 2.** User-facing Wordmark „Twin-Lab" → „Nolmi" im Code + minimaler Doku-Refresh (kein voller README-Rewrite — der gehört zu Block-5-Marketing-Vorbereitung).

**Edits (7 Files):**
- `apps/web/app/layout.tsx` — HTML `<title>` „twin-lab" → „Nolmi" + `<meta name="description">` auf Nolmi-Leitsatz „Aktive Erinnerung unter Owner-Kontrolle. Vertrauenswürdige digitale Repräsentation, die mich versteht — aber nicht unkontrolliert für mich handelt."
- `apps/web/app/login/page.tsx` — h1 Brand
- `apps/web/components/AppHeader.tsx` — Brand-Link
- `apps/web/components/FooterMeta.tsx` — Fallback `multi-twin` → `Nolmi` (Mini-Justierung nach Smoke-Befund — Architektur-Begriff war außerhalb des initialen Twin-Lab-Scans, las sich inkonsistent zur Header-Marke)
- `README.md` — H1 + What/Why-Sections + 2 Pre-Launch-Tagline-Zeilen. Repo-URLs (`markusbaier/twin-lab.git`, `cd twin-lab`) unverändert per Phase-3-Scope.
- `docs/DEPLOYMENT.md` — H1 + 2 Intro-Zeilen + 2 Display-Stellen in Bridge-Section + glibc-Fix-Hinweis
- `docs/ROADMAP.md` — H1

**Bewusst NICHT angefasst (Phase-3-Territory oder per Setzungen):**
- `apps/web/middleware.ts:19` `SESSION_COOKIE_NAME = "twin-lab-session"` — Cookie-Rename würde laufende User-Sessions invalidieren (Force-Logout); Phase 3 + ggf. Migration-Window
- Alle `from "@twin-lab/shared"`-Imports — Phase 3 Workspace-Package-Rename
- CSS-Klassen `.twin-toast`, `.twin-toast-title`, `.twin-toast-close` etc. — S2, interne Implementierungs-Details
- Code-Kommentare mit „Twin-Lab" in 6 Files (`chat/[handle]/page.tsx:1857`, `globals.css:90`, `EmptyState.tsx:9`, `MemoryHitBadge.tsx:19`, `RejectReasonModal.tsx:132`, `Tabs.tsx:22`, `tool-display.ts:31`) — interne historische Notizen, nicht user-visible
- Strategy-Docs (`REBRAND-NOLMI-STRATEGY.md`, `BLOCK-5-STRATEGY.md`, `130-TELEGRAM-STRATEGY.md`, `131-OAUTH-STRATEGY.md`) — historische Genauigkeit
- Docker-Container-Namen (`twin-lab-web`, `twin-lab-runtime`, `twin-lab-bridge`) + Pfade (`/docker/twin-lab-web/`) — Phase 3 Repo-/Container-Rename
- `apps/web/styles/DESIGN-AUDIT.md` — internes Design-System-Doc
- `docs/STAND.md` + `docs/BACKLOG.md` Pre-Tag-31-Inhalt — historische Genauigkeit

**Verifikation:**
- Typecheck 4/4 grün
- Browser-Smoke 7/7 Haupt-Views grün (Login, Onboarding, Chat/@markus, Inbox, Settings, Facts, Stream)
- Header überall „Nolmi", Browser-Tab-Title „Nolmi", `<meta name="description">` mit Leitsatz via Devtools verifiziert
- Footer dynamisch („1 Twin aktiv · läuft lokal") + Fallback-Refresh nach Mini-Justierung
- **Cmd+F „Twin-Lab"/„twin-lab"/„TwinLab" pro Page = 0 Treffer** (DOM-Sauberkeit verifiziert)
- „Twin"-Konzept-Wort (Twin-Profil, Twin-Reife, Twin-Service, `twin_*`-IDs) unverändert per S1

**KEIN Production-Deploy** — Nolmi-Deploy kommt in Phase 4 auf separatem Hostinger-VPS (Frankfurt, Ubuntu 24.04 LTS, IP `187.124.3.235`). Bestehender Twin-Lab-Production-Stack (`srv1046432`) wird **nicht** in-place rebrandet.

**Spur:** Pre-Launch-Phase A · **Aufwand:** ~1h netto (Diagnose ~15 Min, Edits ~25 Min, Smoke ~15 Min, Mini-Justierung + Re-Smoke ~5 Min).

### Rebrand-Phase 3a — Env/Package/Cookie-Aliasing ✅ Tag 31 DONE

**Abgeschlossen Tag 31 (29. Mai 2026, Freitag), Tag 31 Block 3.** Technische Renames mit Backward-Compat-Aliasing (Env + Cookie) und Hart-Switch (Workspace-Packages, technisch nicht aliasable).

**Nachzügler Tag 31 Block 11:** Die `apps/{runtime,web,bridge}/Dockerfile`-pnpm-Filter (`@twin-lab/*`) wurden in Phase 3a übersehen — von der B2-Prep-Diagnose aufgedeckt, in Block 11 auf `@nolmi/*` nachgezogen (latent, da der Bestand nur dank Image-Cache baute; entblockt den B2-from-scratch-Build).

**Edits:**
- **`packages/shared/src/env.ts` (neu):** `getEnv(newName, oldName)`-Helper mit Read-Both, Write-New (eine Stelle), Warn-Once. Subpath-Export `@nolmi/shared/env`. Unit-Smoke `packages/shared/src/env.test.ts` mit 4 Cases (`pnpm --filter @nolmi/shared test:env` → 4/4 OK), tsx als devDep zu shared.
- **Env-Vars umgestellt** in 21 Files: Production-Read-Pfad (`NOLMI_SESSION_SECRET`, `NOLMI_ENCRYPTION_KEY`, `NOLMI_DEFAULT_BRIDGE_URL`, `NOLMI_MODEL_CACHE_DIR`, `NOLMI_EMBEDDING_{PROVIDER,MODEL,DTYPE,API_KEY}`) via `getEnv` in `apps/runtime/src/auth/session.ts`, `crypto-utils.ts`, `server.ts`, `episodic/providers/factory.ts`, `episodic/providers/local-provider.ts` (manuell, mit Aliasing-Doc-Strings + Error-Message-Hinweisen). Test-Only-Vars (`NOLMI_RUN_LOCAL_RETRIEVAL_TEST`, `NOLMI_SKIP_LOCAL`) + Comments + CLI-Output via stumpfem `sed` in 16 weiteren Files.
- **4 Workspace-Packages atomar umbenannt:** `@twin-lab/{web,runtime,bridge,shared}` → `@nolmi/{web,runtime,bridge,shared}`. 96 Source-Files + Root-`package.json` (11 Script-Refs) via Sed → 124 Import-Statements rewriten. `grep "@twin-lab/" apps/ packages/` = 0 Treffer.
- **Cookie-Aliasing:** `SESSION_COOKIE_NAME = "nolmi-session"` + `LEGACY_SESSION_COOKIE_NAME = "twin-lab-session"`. `getSession()` Read-Both, `setSession()` Write-New, `destroySession()` löscht beide aktiv (Erweiterung gegen Briefing — Logout-Pfad braucht aktives Wipe, sonst überschattet Bestands-Legacy-Cookie das Logout). `apps/web/middleware.ts` Konstanten dupliziert (Cross-App-Import vom Runtime strukturell nicht vorgesehen) + Read-Both im Cookie-Presence-Check.
- **`.env.example`:** Header-Notiz zum 6–12-Monats-Aliasing-Fenster (Hart-Cut ca. Mai 2027) + alle `TWIN_LAB_*`/`@twin-lab/*` auf `NOLMI_*`/`@nolmi/*`.
- **Live-Docs:** `docs/DEPLOYMENT.md` + `docs/131-OAUTH-STRATEGY.md` Package-Refs mit-rewriten. `docs/archive/*` als historisches Archiv unangetastet.

**Verifikation:**
- `pnpm install` clean (455 packages) nach `rm -rf` aller `node_modules` (Workspace-Symlinks brauchen frische Resolution)
- `pnpm typecheck` 4/4 Workspaces grün
- `pnpm -r build` minus `@nolmi/web` grün (web absichtlich nicht gebaut wegen geteilten `.next/`-Caches mit Dev; Husky pre-push deckt das auf Push-Seite ab)
- `pnpm --filter @nolmi/shared test:env` 4/4 Cases OK

**KEIN Production-Deploy** — Nolmi-Stack lebt nur im Repo, Production-Twin-Lab (`srv1046432`) unverändert.

**Spur:** Pre-Launch-Phase A · **Aufwand:** ~2h netto (Diagnose ~20 Min, Helper ~15 Min, Env-Edits ~35 Min, Package-Rename ~25 Min, Cookie + middleware ~15 Min, Verifikation ~10 Min, Doku ~25 Min).

### Rebrand-Phase 3b — Verzeichnis-Rename + GitHub-Repo-Move ✅ Tag 31 DONE

**Abgeschlossen Tag 31 Block 4.** Siehe Strategy-Doc §3 Phase 3b +
STAND Tag 31 Block 4.

Phase-3b-Outcome:
- GitHub: nolmi-ai/nolmi
- Lokal: /Users/mjb/Visual Studio/nolmi/
- Root-package.json auf Nolmi-Stand
- .gitignore um .claude/ ergänzt

**Code-Rebrand vollständig abgeschlossen** (Phase 1 Light-Mode + Phase 2
User-Strings + Phase 3a Env/Package/Cookie + Phase 3b Verzeichnis/Repo).

### docker/twin-lab-web/ → docker/nolmi/ (Teil von Phase 4)

**Status:** ✅ ENTSCHIEDEN Tag 31 (Phase-4-Strategy-Session) | siehe [`docs/PHASE-4-VPS-STRATEGY.md`](./PHASE-4-VPS-STRATEGY.md) §3 (= S2)

**Auflösung:** **ENTFÄLLT als Rename** — Greenfield-VPS `187.124.3.235`, deshalb `/docker/nolmi/` **neu anlegen** statt umbenennen (Container `nolmi-runtime`/`nolmi-web`/`nolmi-bridge`, voller Stack inkl. Bridge). Altes `docker/twin-lab-web/` bleibt unangetastet solange der Bestands-Stack läuft, wird nach Cut-Over + stillem Fenster archiviert/gelöscht (Abschaltungs-Item).

Ursprünglicher Kontext (bleibt zur Historie):

Aktuell: `docker/twin-lab-web/` (mit README + docker-compose.yml +
Container-Namen `twin-lab-runtime`/`twin-lab-web`/`twin-lab-web-data`)
konfiguriert den Production-Stack auf VPS `srv1046432`. Solange dieser
Stack live ist, bleibt die Config unverändert (Code-Live-Sync).

Beim Phase-4-VPS-Setup auf `srv1712371.hstgr.cloud`:
1. Neues Verzeichnis `docker/nolmi/` anlegen mit Nolmi-spezifischer
   Compose-Config (Container `nolmi-runtime`, `nolmi-web`, `nolmi-data`-
   Volume, Bridge auf `srv1712371`)
2. Production-Deploy auf srv1712371 mit neuer Config
3. Smoke verifizieren auf nolmi.ai
4. Nach erfolgreicher Migration: `docker/twin-lab-web/` archivieren
   oder löschen (Production-VPS srv1046432 abschalten ist eigener
   Step)

### SSH-Alias `github.com-twin-lab` in ~/.ssh/config aktualisieren

**Status:** ✅ ENTSCHIEDEN Tag 31 (Phase-4-Strategy-Session) | siehe [`docs/PHASE-4-VPS-STRATEGY.md`](./PHASE-4-VPS-STRATEGY.md) §3 (= S5)

**Auflösung:** **SSH-Alias fällt weg.** Production zieht das Repo via **HTTPS + Fine-grained PAT** (read-only, nur `nolmi-ai/nolmi`, mit Ablaufdatum) — ein Repo, kein Multi-Identity-Bedarf, kein Deploy-Key. (Cross-Ref dupliziertes Item „SSH-Authentifizierungs-Klärung für Phase 4" unten — gleiche Auflösung.)

Ursprünglicher Kontext (bleibt zur Historie):

Im `~/.ssh/config` existiert ein Host-Alias `github.com-twin-lab` mit
spezifischem SSH-Key. Wird heute nur für Production-Deploy genutzt
(`git clone git@github.com-twin-lab:markusbaier/twin-lab.git repo`).
Beim Phase-4-Deploy zu nolmi-ai/nolmi: Alias umbenennen zu
`github.com-nolmi` oder als zweiten Alias parallel anlegen.

### PAT-Rotation + Git-History-Secret-Scan + Repo public schalten (Going Public) — Release-Gate §5a ✅

**Status:** ✅ **DONE — Repo PUBLIC seit 1. Juni 2026 (Tag 34)** | **Größe S** | **war: must-vor-Release** | siehe [`docs/DISTRIBUTION-STRATEGY.md`](./DISTRIBUTION-STRATEGY.md) §5a

**Going Public vollzogen (Tag 34, 1. Juni 2026):** `nolmi-ai/nolmi` ist **PUBLIC** (AGPL-3.0-only, GitHub-Lizenz-Erkennung bestätigt). **Strategie A „still public"** — Code sichtbar, kein Launch/Announcement (0 stars/forks, pre-launch). Der **Hygiene-Re-Scan unmittelbar vor dem Schalten** lief 🟢: gitleaks 8.30.1 über die **volle History/alle Branches → 341 Commits sauber** (Tag 33: 327 → +14), einziger Treffer = derselbe dokumentierte False-Positive (`OAuthActivationModal`), manueller Gegencheck 0 echte Secrets (`BRIDGE_REGISTER_TOKEN` nur Platzhalter, Advanced-Test-Token nie committet). Davor LICENSE-Swap `0d750db`. **Kein `filter-repo` nötig.**

**Erledigt Tag 33 (Vorlauf):** PAT rotiert (alt revoked, neu read-only). Erster Secret-History-Scan 🟢 (gitleaks 8.30.1, 327 Commits; gleicher False-Positive; PAT war nie in einem Commit).

Ein öffentliches Repo veröffentlicht die **komplette Git-History**, nicht nur den HEAD-Stand. Der für den VPS-Repo-Klon ausgestellte **Fine-grained PAT** (read-only, `nolmi-ai/nolmi`, S5) wurde im Chat-Kontext gepostet und liegt **potenziell in History/Commits/Notizen** — in öffentlicher History wäre er sofort kompromittiert. **Vor dem Öffnen des Repos (Distribution Etappe 3):**
1. **PAT rotieren** — alten Token bei GitHub widerrufen, neuen ausstellen (entwertet den alten unabhängig davon, wo er liegt)
2. **History-Secret-Scan** über die **volle** History (`gitleaks`/`trufflehog`) — PATs, Keys, `.env`-Leaks; bei Treffer History-Rewrite (`git filter-repo`) **vor** dem Öffnen
3. Erst dann `Repo public`

Kein Hygiene-Nice-to-have, sondern hartes Release-Gate. Aus Distribution-Session Tag 31 (Block 19).

### Repo-Description EN-angleichen vor Launch (GitHub-Settings, kein Repo-File) ✅

**Status:** ✅ **DONE (Tag 35)** | **Größe XS** | Befund Tag 34

GitHub-Repo-Description auf Englisch gesetzt; **Tag 35 nachgeschärft auf die persönliche Pitch-Linie:** **„Be present, without being always available — your self-hosted personal AI twin."** (zunächst A2A-/Infra-geführt, dann konsistent zur Landing umgestellt — persönlicher Nutzen führt). About-Seitenleiste aufgeräumt — leere Module (Releases/Packages/Deployments) abgewählt. Reine GitHub-Settings, kein Repo-File. *(Releases-Modul wird wieder eingeschaltet, sobald GitHub-Releases eingeführt sind — s. Folge-Item. npm-Description-Angleich folgt beim nächsten CLI-Publish 0.1.1 — s. NPM-Distribution-Item.)*

### GitHub-Releases einführen — Versionshistorie parallel zum npm-Publish

**Status:** OFFEN (Folge-Item, NICHT jetzt) | **Größe S** | **Priorität:** nice | **Trigger:** ab dem nächsten npm-Publish (0.1.1+)

Ab dem nächsten npm-Publish parallel eine **GitHub-Release** anlegen: getaggte Version (`v0.1.1`) + **Release-Notes/Changelog**, damit npm-Nutzer, die ins Repo schauen, eine **Versionshistorie** sehen (heute: keine Releases, das About-Modul war leer → abgewählt). Koppelt sich an den **Publish-Rhythmus** (jeder `npm publish` ⇒ ein Git-Tag + eine GitHub-Release). Beim ersten Release das **Releases-Modul in der About-Seitenleiste wieder einschalten**. Optional später automatisierbar (Tag-Push → Action), aber Phase 1 manuell reicht.

### Pre-Flight Bridge-DB-Inhalt verifizieren (vor Bridge-Re-Registrierung) — ✅ Tag 31 Block 7 DONE

**Status:** ✅ DONE Tag 31 Block 7 | Verdikt + Inventar in [`docs/PHASE-4-VPS-STRATEGY.md`](./PHASE-4-VPS-STRATEGY.md) §4

**Diagnose-Befund (B3, Commit `64f91e1`):** Bridge hat genau 2 Tabellen + 3-Twin-Datensatz. `twins` = Klasse A (Registry). `messages` mit `delivered_at` gesetzt = Klasse B (runtime-seitig in Audits gespiegelt — `receiveBridgeMessage` persistiert Content **vor** dem Ack, das `delivered_at` setzt). `messages` mit `delivered_at IS NULL` = Klasse C (unzugestellte Queue, einzige echt bridge-only Menge). Symmetrische A2A-View ist bridge-verankert.

**Verdikt-Verlauf:**
- **Block 7:** S2 zunächst „im Kern bestätigt" (Re-Registrierung bleibt) mit zwei Auflagen.
- **✅ Block 8 — S2 KORRIGIERT auf volle Bridge-DB-Migration** (`twin.db` + `bridge.db`, gemeinsamer Freeze-Snapshot, **keine** Re-Registrierung). Grund: (1) Bridge trivial klein → Migration kostet nichts; (2) Re-Register erzwingt einen Token-Writeback in die frisch migrierte `twin.db` (fragilster Cut-Over-Schritt). Migration vermeidet den Writeback (Tokens matchen beidseitig), erhält A2A-View + undelivered-Queue, atomarer Snapshot. Die zwei Block-7-Auflagen sind damit **moot** — ersetzt durch eine reine **Token-Match-Lese-Verifikation** in B4. Details + ADR-Notiz in [`docs/PHASE-4-VPS-STRATEGY.md`](./PHASE-4-VPS-STRATEGY.md) §2/S2 + §4.

**Struktur-Notiz (bleibt gültig):** Bridge fehlt im Repo-Compose (nur runtime+web in `docker/twin-lab-web/`), Live-Config/Volume liegen außerhalb des Repos auf srv1046432, DB-Pfad `data/bridge.db` → B4 muss sie mit-tarballen.

### Hygiene-Pass Tag 31 Block 5 ✅ DONE

`.gitignore` um DB-Backup-Pattern erweitert. Lokale DB von 6 Test-Twins
bereinigt (jetzt 3 echte: @markus, @florian, @heiko). Zwei neue BACKLOG-
Items aus Diagnose entstanden (SSH-Auth-Phase-4, PRAGMA-foreign_keys).

### SSH-Authentifizierungs-Klärung für Phase 4

**Status:** ✅ ENTSCHIEDEN Tag 31 (Phase-4-Strategy-Session) | siehe [`docs/PHASE-4-VPS-STRATEGY.md`](./PHASE-4-VPS-STRATEGY.md) §3 (= S5)

**Auflösung:** **HTTPS + Fine-grained PAT (read-only)** für VPS-seitige Git-Operationen. Kein SSH-Alias, kein Deploy-Key. Production zieht nur, ein Repo. (Gleiche Auflösung wie Item „SSH-Alias github.com-twin-lab" oben.)

Ursprünglicher Befund (bleibt zur Historie):

**Befund Tag 31 Block 5:** Lokaler `~/.ssh/config` auf MacBook enthält
nur SSH-Direct-Eintrag für `31.97.78.73` (Production-VPS srv1046432),
keinen `github.com-twin-lab`-Alias. Der Verweis in
`docker/twin-lab-web/README.md:25` (`git clone git@github.com-twin-lab:...`)
ist vermutlich veraltet oder Production-VPS-seitig konfiguriert.

**Beim Phase-4-Setup auf srv1712371:**
- Entscheidung: HTTPS+Token (wie aktuell vom MacBook aus genutzt) oder
  SSH-Alias `github.com-nolmi` für VPS-seitige Git-Operationen?
- Falls SSH-Alias: neuen Eintrag in `~/.ssh/config` des Production-VPS
  hinzufügen mit dediziertem Key

### PRAGMA foreign_keys in Runtime prüfen — ✅ verifiziert, kein Live-Bug

**Status:** Closed (Befund verifiziert) | technische Hygiene

**Ausgangs-Beobachtung Tag 31 Block 5:** `sqlite3 data/twin.db "PRAGMA foreign_keys;"`
gibt `0` zurück. Das ist aber **nur** der per-Connection-Default einer
ad-hoc sqlite3-CLI-Session (SQLite-Default ist OFF), **nicht** der
Runtime-Zustand — das PRAGMA ist per Connection, nicht persistent.

**Verifikation (`grep -rn "foreign_keys" apps/runtime/src`):** Die
authoritative Runtime-Connection setzt es: `apps/runtime/src/repository/sqlite.ts:22`
(`db.pragma("foreign_keys = ON")`, eine DB-Connection pro Runtime mit
WAL + foreign_keys). Ebenso `init-db.ts:37` und alle CLI-/Test-Helper
(`_mcp-cli-helpers.ts:78`, `_diary-cli-helpers.ts:45`, `bootstrap-twin.ts:112`, …).
→ **Im Live-Betrieb werden FK-Constraints durchgesetzt, `ON DELETE CASCADE`
wirkt.** Deckt sich mit Lesson Tag 29 #4 + #6 (Production-Cascade
verifiziert).

**Konsequenz:** Kein Bug, kein Action-Item für die Runtime selbst. Die
einzige Stolperfalle bleibt **manuelle** ad-hoc sqlite3-CLI-Sessions —
dort `PRAGMA foreign_keys = ON;` als ersten Befehl setzen (für Cleanups
etc.). Verbleibender Mini-Scope (= Rest von BACKLOG #159): DB-CLI-Cheat-
Sheet für Smoke-Cleanups.

**Test-Twin-Cleanup Tag 31 Block 5 hat CLI-seitig PRAGMA gesetzt** —
keine offenen Waisen aus dieser Operation.

### #102 Self-Hosting-Doku: DEPLOYMENT.md + docker-compose.override.yml.example (M, should) ✅

✅ **Erledigt** (Beleg: `docker-compose.override.yml.example` + DEPLOYMENT.md deckt glibc/musl/vec0 + Deploy-Sequenz/Troubleshooting + `.env.example` mit EPISODIC/Embedding-Vars — alle 3 Tag-15-Lücken gedeckt; Triage 2c gegengelesen).

**Kontext:** Tag-15-Production-Deploy hat drei Doku-Lücken offengelegt:

1. **`docker-compose.override.yml` lebt nur auf VPS.** Self-Hoster sehen das Pattern gar nicht. Heute hatten wir auf VPS drei Bind-Mounts (docs, mcp-servers, model-cache) plus eine ENV-Variable (TWIN_LAB_MODEL_CACHE_DIR) — alles undokumentiert für externe Nutzer.
2. **`.env.example` ist Self-Hosting-unvollständig.** Phase-3.4-ENVs (EPISODIC_*, TWIN_LAB_EMBEDDING_*) sind nicht drin, weil sie Defaults haben — aber ein Self-Hoster der's konfigurieren möchte hat keinen Anhaltspunkt.
3. **musl/glibc-Inkompatibilität bei sqlite-vec.** Wir haben heute 1h+ Diagnose-Marathon gebraucht um das zu verstehen. Self-Hoster, die ein anderes Base-Image probieren, würden in dieselbe Falle laufen. „Use node:20-slim or any glibc-based Linux distro" sollte explizit dokumentiert sein.

**Lösung:** Zwei Dateien anlegen:

- **`docker-compose.override.yml.example`** im Repo committen — Vorlage mit Platzhaltern für deployment-spezifische Werte (Domains, Volume-Pfade). Header-Kommentar erklärt: „Kopiere zu `docker-compose.override.yml`, passe an, niemals committen."
- **`docs/DEPLOYMENT.md`** mit:
  - Pre-Deploy-Checks (Disk-Speicher, DNS, Bridge-Network)
  - Volume-Konfiguration (model-cache, data-volume, docs/mcp-servers bind-mounts)
  - ENV-Variable-Reference (was muss/kann/sollte gesetzt sein)
  - Base-Image-Anforderung: **glibc, nicht musl** (sqlite-vec liefert nur glibc-Builds)
  - Deploy-Sequenz (Pull, Build, Recreate, Embedding-Initialization)
  - Smoke-Tests post-Deploy
  - Troubleshooting (vec0.so.so-Pattern erklären als Auto-Fallback bei dlopen-Fail)

**Größe:** M — ca. 2-3h, weil Substanz heute schon klar. Tag-15-Lessons direkt verarbeiten.

**Wann:** vor erstem externen Self-Hosting-Use-Case, oder als Polish-Item wenn Roadmap Pause hat. Nicht zeitkritisch, aber Vision-relevant (siehe TWIN-VISION.md / Pitch-Deck).

---


### Rebrand-Phase 4 — Nolmi-VPS Production-Deploy (M-L, must — nach 1-3, VPS bereits provisioniert) ✅

✅ **Erledigt** (Beleg: Production-Deploy Etappe 2 `c88f0eb` Tag 33 auf `srv1712371` + B6-Cut-Over Tag 31 — Nolmi läuft auf seinem VPS; siehe PHASE-4-VPS-STRATEGY §5/§6).

**Status:** Offen, **Setzungen gelockt Tag 31** | gated nach Phase 1-3 | Aufwand: M-L | **VPS bereits provisioniert Tag 30/31**

**Strategy + Bau-Vorlage:** [`docs/PHASE-4-VPS-STRATEGY.md`](./PHASE-4-VPS-STRATEGY.md) — 7 Setzungen (S1 DB-Migration, S2 voller Stack inkl. Bridge unter `/docker/nolmi/` + **Doppel-DB-Migration `twin.db`+`bridge.db`**, S3 Secrets + Encryption-Key-Übernahme, S4 Traefik + BasicAuth, S5 HTTPS-PAT, S6 Parallel-Cut-Over, S7 Hot-Standby-Rollback), zwei Bedingungen (Encryption-Key-Kontinuität + Bridge-Migration), Cut-Over-Sequenz, Rollback-Plan, Bau-Reihenfolge B1–B7. **S2 final Tag 31 Block 8: Bridge-DB-Migration statt Re-Registrierung** (B3-Befund). **B1 ✅ DONE Tag 31 Block 9** (VPS-Prep + Docker 29.5.2 + Traefik v3.6 auf `187.124.3.235`; 3 Cookbook-Bugs §7). **B2 ✅ DONE (Prod) Tag 31 Block 14** (3-Service-Stack up, **Prod-Certs** `Let's Encrypt CN=YR2` über app/runtime/bridge.nolmi.ai, `TLS-verify=0`, Bridge selbstheilend, BasicAuth app→401, runtime/bridge→404; 4 Cookbook-Befunde §7; Repo-Fixes Block 11/12/13: Dockerfile-Filter, Bridge-Auto-init, htpasswd-Mount-Konsistenz; Prod-Cert-Flip griff erst nach Resolver-Store-Reset, §7 B2-4). **B4 ✅ DONE Tag 31 Block 15** (Doppel-DB-Migration auf Backup-Kopie verifiziert, ohne Production-Freeze: Bedingung A kein GCM-Fehler + Secrets entschlüsselt, S2-Token-Match `bridge_token`==`api_token` 3/3 byte-gleich, A2A-Stream ×3 gegen nolmi-bridge; 2 B6-Pflicht-Befunde §5: Stale-`bridge_url`-Sweep + Geist-Twin `@test122prod`). **B5 ✅ DONE Tag 31 Block 16** (Smoke 4/4 auf migriertem Stack: Container/Health, Migration intakt, Bedingung A end-to-end (Chat-Turn beantwortet), S2 end-to-end (A2A-Roundtrip @markus→@florian, kein 401), alle 3 §7-Fallen negativ). **B6 ✅ DONE (reduziert) Tag 31 Block 17** (Cut-Over im Single-User-Test-Kontext — nur Markus nutzt, @florian/@heiko Test-Twins → kein Dritt-Freeze/Re-Sync nötig; Geist-Twin `@test122prod` aus bridge.db gelöscht, Backup davor; Cut-Over-Entscheidung getroffen). **✅ PHASE 4 ABGESCHLOSSEN — Nolmi produktiv auf `187.124.3.235` (B1–B6).** Komplette Rebrand→Deploy-Pipeline (Phase 1+2+3a+3b+4) im Ziel. Einzige Restaktion: alter Stack `srv1046432` abschalten — bewusst offen gehalten (Hot-Standby, S7), siehe Item unten.

Separater Hostinger-VPS Frankfurt, Ubuntu 24.04 LTS, IP `187.124.3.235`. Neu-Aufsetz analog DEPLOYMENT.md §9 Cookbook, mit Nolmi-Branding + Light + neuer Domain:

- ✅ VPS provisioniert, Domain `nolmi.ai` + `getnolmi.com` + 5 DNS-A-Records grün (apex + app + runtime + bridge + docs → `187.124.3.235`) — Setup-Block kann starten
- Traefik + Stack deployen
- Brand-Assets (Wordmark, Favicon, OG-Image) — Light-first
- Screenshots neu aufnehmen (Light-Branding) für #112 Landing / #113 Demo

**Markus' parallele Arbeit (Stand Tag 31):** ✅ Foundation gesichert (Domain + VPS + GitHub-Org `nolmi-ai` + npm `@nolmi` + PyPI + Docker Hub `nolmi` + Mail-Stack + Trademark-Quick-Search). Verbleibend: Social-Handles + Brand-Assets-Produktion. Details siehe Strategy-Doc §9.

### #97 Facts mit Validity-Windows + History-Tracking (L, should) ✅

✅ **Erledigt** (Tag 37, Hygiene Welle 1 hierher umsortiert; Beleg: Migration `028_facts_history` + `apps/runtime/src/facts/facts-history-repo.ts`; deployt mit dem Tag-39-Migrations-Stapel). Rest (getAsOf-Query / Twin-weite Sicht / confidence-History) als offenes **#97b** abgespalten. Original-Text unverändert:

**Status Tag 37:** ✅ gebaut (4 Sub-Schritte: Schema 028 / atomare Capture / owner-gated Route / UI-Verlauf-Aufklappen), lokal end-to-end verifiziert. Umgesetzt als SEPARATE facts_history-Tabelle (nicht valid_from/valid_until-Spalten in facts — risikoärmer, kein Rebuild). Semantik: nur fact_value-Drift + delete, change_type-Spalte hält confidence-History additiv offen. Noch nicht deployt (Deploy folgt, erste Prod-Migration seit 027). getAsOf-Route + Twin-weite Sicht + confidence-History zurückgestellt (additiv nachrüstbar).

Erweiterung des Facts-Systems (`facts`-Tabelle aus 3.3) um temporale Dimension. Heute überschreibt ein neuer Fact den alten — keine History, kein Audit, kein Drift-Tracking möglich.

MemPalace hat das gelöst via Temporal-Knowledge-Graph mit Validity-Windows: Entity-Relationship-Graph mit Zeit-Stempeln pro Fact, alte Einträge werden invalidated (nicht überschrieben), Timeline-Queries möglich (z.B. „Wie war Markus' Beziehungsstatus 2015?").

Übertragung auf twin-lab:

- `facts`-Tabelle bekommt `valid_from`, `valid_until`, `invalidated_by_fact_id` Spalten
- Plus neue `facts_history`-Tabelle für vollständigen Audit-Trail bei Updates
- Repo-Methoden: `factsRepo.invalidate(factId, by)`, `factsRepo.getAsOf(date)`, `factsRepo.getTimeline(key)`
- UI: Facts-Page bekommt Toggle „aktuell" vs „historisch", Timeline-Ansicht pro Fact-Key

Direktes Substrate für Vision-Patterns:
- **Werte-Drift** (TWIN-VISION Pattern 5): Twin kann beobachten wie sich Markus' Werte über Zeit verschieben
- **Zeit-Erleben** (Pattern 2): „Was war 2025 wichtig, was ist heute wichtig?"
- **Lebens-Narrativ** (Pattern 7): primär Lesart (A) Twin-über-sich (Verdichtung der Diary-Selbstreflexionen zu einem Bogen — Source of Truth TWIN-VISION :79/:205); Facts-Validity wäre nur für die sekundäre (B)-Lesart (Markus-Biografie) relevant

Substantiell — eigene Phase, vermutlich nach 3.4 oder mit Pattern-Phase „Zeit-Erleben" gebündelt. MemPalace's Implementation als Referenz nutzen, keine direkte Code-Übernahme (Python → TypeScript).

Aus Tag-14-Recherche.

### Proaktiv-Nudge Anlass 3 (unbeantwortete Twin-Frage) ✅

✅ **Erledigt** (Tag 39; Beleg: `a59b4af` — `proactive-nudge`-Audit mit `input.anlass='offene_frage'`, Detektor `detectOpenQuestion` + Generator-Prompt + anlass-bewusstes Dedup in `apps/runtime/src/focus/proactive-nudge-service.ts`, am Fokus-Loop-Tick verdrahtet; STAND Tag 39 Forts.). Sichere Sorte (a) Twin-Frage-unbeantwortet: das „offen-vs-erledigt"-Signal kam aus der Audit-Turn-Reihenfolge (jüngste Audit-Row pro Konv = letztes Wort; reply endet auf „?" + keine neuere Row = offen), KEINE Migration. Eigenes Autosend-Gate `PROACTIVE_NUDGE_ANLASS3_AUTOSEND_ENABLED` (Default aus). Aus dem früheren Bundle „Anlass 2+3" abgespalten — Anlass 2 (Werte-Widerspruch) bleibt vertagt (siehe Phase-B-Block).

### Twin-Löschfunktion in der Web-UI ✅

✅ **Erledigt** (Tag 36, Hygiene Welle 2 hierher umsortiert; Beleg: `apps/runtime/src/server.ts:306` `DELETE /twins/:handle` → deleteTwinLocal + registry.removeTwin inkl. Telegram-Teardown; UI `apps/web/components/ConfirmDeleteTwinModal.tsx`). **Rest bleibt offen (eigene Items, unberührt):** manueller Browser-Durchklick (app.inject deckt nur HTTP-Contract) + Bridge-Orphan-Cleanup (separates Item im Offen-Block). Original-Text unverändert:

**Status:** ✅ **DONE (Tag 36)** — 3 Schritte: Bridge-Deregister `ef2b832` · Runtime-Löschkern `f5cb42c` · UI `77b9812`. Owner-gegateter `DELETE /twins/:handle`, geordnete Tx (`foreign_keys=ON`, audit+trust manuell, conversation_summaries→audit-Reihenfolge), Registry-Hot-Unload inkl. Telegram-Teardown, Type-to-confirm-UI. **Rest (eigenes, bereits getracktes Item):** Bridge-Orphan-Cleanup bei nicht erreichbarer Bridge → „Bridge-DB-Cleanup als Bootstrap-Schritt". **Offen:** manueller Browser-Durchklick (app.inject deckt HTTP-Contract, nicht DOM).

Beim Weg-B-Onboarding-Smoke (Tag 35) aufgefallen: ein im Wizard angelegter Twin lässt sich über die **UI nicht löschen** — der Test-Twin musste **per DB-Skript** im Container entfernt werden. Wer Twins anlegen kann, muss sie auch löschen können (Erwartung jedes Self-Hosters, besonders relevant sobald externe Nutzer onboarden). **Zu bauen:** Lösch-Flow in der UI (Settings/Twin-Switcher) + Owner-gegateter Endpoint (`DELETE /twins/:handle` o.ä.) mit sauberem Cascade (twin_profiles + zugehörige audit/conversations/facts/oauth_tokens/trust-Zeilen — FK-Verhalten beachten, vgl. Migration 026) + Bridge-Deregistrierung, falls gebunden. Bestätigungs-Dialog (irreversibel). **Größe M** (UI + Endpoint + Cascade + A2A/Bridge-Sauberkeit).

### 12. Anthropic-Persona Umlaut-Bug ✅

✅ **Erledigt** — zentrale LANGUAGE_DIRECTIVE (twin-service.ts:2690, in composeOwnerSystemPrompt für alle Twins/Modelle, test-abgesichert) statt Persona-File-Edit. Anmerkung: Auslöser ist Modell-Verhalten — die Direktive ist die richtige Code-Antwort, garantiert aber nicht 100%; falls je wieder ae/ss im Live-Output auftaucht, ist das ein Modell-Regress (kein Code-Bug) → am Prompt-Ende/Modell nachjustieren. (Item referenzierte claude-opus-4-7; Default heute claude-opus-4-8, meist robuster.) Original-Text unverändert:

Claude (anthropic/claude-opus-4-7) generiert in Markus' Persona Antworten ohne Umlaute ("weiss" statt "weiß", "Gespraechen" statt "Gesprächen", "beschaeftigt" statt "beschäftigt"). Florian-Persona zeigt das Problem nicht durchgängig — Hypothese: Persona-Markdown-Sprache beeinflusst LLM-Output. Fix: Umlaut-Direktive explizit in `docs/persona.md` ergänzen ("Schreibe immer mit korrekten deutschen Umlauten ä/ö/ü/ß").
**Größe:** S · **Priorität:** must · **Aus:** Sub-Schritt 2c/2d/2e/2.5.3 Live-Tests

---




---

## Phase-B / Post-Closed-Beta — bewusst vertagt

Bewusst zurückgestellt nach Closed-Beta-Logik (D4/D5) — erst relevant, wenn externe Nutzer onboarden. **Kein offener Rückstand.**

### 40. CSRF-Token für /auth/*-Endpoints — NEU aus 2.5.4
Heute schützt nur `SameSite=Lax` auf dem Session-Cookie. Bei breiterem Deployment (echte Domain, eingebettete Iframes, Browser-Extensions, etc.) braucht es `@fastify/csrf` für tokenbasierten Schutz, um POST-CSRF-Angriffe zu blocken.
**Größe:** M · **Priorität:** should · **Aus:** 2.5.4 Caveat #5

### 41. Magic-Link Auth (passwordless) — NEU aus 2.5.4
Alternative zu Email/Passwort: User gibt Email ein, kriegt Login-Link via Email zugeschickt. Vorteil: kein Passwort-Management, sicherer (kein Rainbow-Table-Risiko, kein Password-Reuse). Vorbedingung: Email-Versand aus 2.5.5. Markus' Frage vom 02.05: "Magic Link könnten wir für die Zukunft nochmal überlegen."
**Größe:** L · **Priorität:** nice · **Aus:** 2.5.4 Architektur-Diskussion, blockt auf 2.5.5
**Stufe:** 0 → 2 · **Spur:** UX-Reifung

### 42. Rate-Limiting auf /auth/login — NEU aus 2.5.4
Heute kein Rate-Limit. Bei breiterem Deployment Brute-Force-anfällig. `@fastify/rate-limit` mit konservativem Default (z.B. 5 Login-Versuche pro IP pro 15 Minuten), bei Treffer 429 mit Retry-After-Header. Plus per-Email-Tracking gegen distributed Brute-Force.
**Größe:** S · **Priorität:** should · **Aus:** 2.5.4 Caveat #6

### 44. Self-Service-Password-Reset — NEU aus 2.5.4
Florian und Heiko haben heute Platzhalter-Passworte von Markus per CLI bekommen. Es gibt aber keinen Weg für sie, das Passwort selbst zu ändern. CLI-Tool (`pnpm user:create` mit Update-Flag oder ein neues `user:reset-password`) reicht für heute, aber UI-Flow ("Passwort vergessen?" → Email-Link → Set-New-Password) wäre richtig. Vorbedingung: Email-Versand aus 2.5.5.
**Größe:** M · **Priorität:** should · **Aus:** 2.5.4 Migration der drei bestehenden User, blockt auf 2.5.5
**Stufe:** 0 → 2 · **Spur:** UX-Reifung

---

### 65. Reverse-Proxy-Architektur statt Cookie-Domain — NEU 4. Mai
Heute: Cookie-Domain via ENV (`SESSION_COOKIE_DOMAIN=.twin.harwayexperience.com`) als Quick-Fix für Cross-Subdomain-Setup. Funktioniert, ist aber konzeptionell ein Workaround — Same-Origin wäre sauberer.

Saubere Variante: Web-App und Runtime hinter demselben Origin (z.B. `app.twin.harwayexperience.com` mit Path-Prefix `/api/*` zur Runtime). Next-Middleware oder Traefik-Path-Routing übernimmt das. Vorteile: kein Cookie-Domain-Trick, keine CORS-Konfig (Same-Origin), Browser-DevTools zeigen nur eine Origin.

Trade-off: Runtime ist dann nicht mehr direkt von außen aufrufbar (ohne Path-Prefix). Für Power-User-Tooling (Curl, Postman) müsste man den Path-Prefix kennen. Plus: Migration heißt Cookie-Domain entfernen, Runtime-CORS entfernen, Frontend-Calls auf relative Pfade umstellen.

Kein Notfall — heutige Lösung läuft stabil. Sub-Schritt für ruhigeren Tag, wenn Architektur-Konsolidierung dran ist.
**Größe:** L · **Priorität:** should · **Aus:** 2.5.6 Phase A.5 Reflexion

### 67. Production-Monitoring + Alerting — NEU 4. Mai
Drei Container live, kein Monitoring. Wenn Bridge oder Runtime abstürzt, merken wir es erst beim nächsten Login.

Optionen, von einfach nach reich:
- Uptime-Kuma als selbst-gehosteter Healthcheck (ein vierter Container) mit Email/Slack-Notification
- BetterStack / Healthchecks.io als externer Service
- Grafana + Prometheus für Metriken (overkill für drei User)

Vorbedingung: Healthcheck-Endpoints in Bridge und Runtime — Bridge hat noch kein wget/curl im Image (#61).
**Größe:** M · **Priorität:** should · **Aus:** 2.5.6 Production-Reflexion

### 68. Master-Key in Vault statt ENV-Datei — NEU 4. Mai (vorgesehen aber nicht umgesetzt)
2.5.6 Spec erwähnte „Master-Key in produktions-tauglichem Vault (nicht mehr in ENV-Datei)". Heute pragmatisch in `/docker/twin-lab-web/.env` belassen, weil Vault-Setup für drei Power-User Overengineering wäre.

Künftige Optionen wenn relevant:
- HashiCorp Vault als selbst-gehosteter Container
- 1Password Connect (Service-Account-API)
- Bitwarden CLI mit Service-Token
- AWS Secrets Manager / Hetzner-eigene Lösung

Trade-off: Vault macht Container-Recovery komplexer (Container braucht Vault-Token zum Start, Vault-Token muss von woher kommen → Boot-Strapping-Problem).

Heute: ENV-Datei mit `chmod 600`, `/docker/`-Verzeichnis nur für Root les- und schreibbar. Reicht für aktuellen Risikostand.
**Größe:** M · **Priorität:** nice · **Aus:** 2.5.6 Spec, bewusst verschoben

### 69. Onboarding-Polish: User-Email-Verifikation + Self-Service-Reset
Heute (Tag 5): drei User onboarded mit Passwörtern, die Markus selbst getippt hat. Florian und Heiko kennen ihre Passwörter nicht — funktioniert solange Markus es ihnen mitteilt, aber kein Self-Service-Onboarding möglich.

Pflicht-Items, wenn neue User von außen kommen:
- Email-Verifikation beim Onboarding (Token-Link zu `/auth/verify`)
- Password-Reset-Flow via Email-Token (#44 verknüpft, dort als nice eingestuft — heute zu must aufrücken sobald externe User kommen)
- Optional: SSO via Google/GitHub (heute nicht nötig)

Vorbedingung: Email-Versand-Infrastruktur (resend.com Konto vorhanden, in 2.5.5 für Notifications eh geplant).
**Größe:** L · **Priorität:** should · **Aus:** 2.5.6 Production-Live
**Stufe:** 0 → 2 · **Spur:** UX-Reifung

### 29. Multi-Channel-Adapter — Owner-Mode
Twin via Telegram/WhatsApp/Signal/iMessage erreichbar — zuerst nur für Owner selbst (nicht für externe Schreiber). Telegram zuerst (Bot-API einfach, ~2-3 Tage Code), dann WhatsApp (Meta-Business-API, KYC-Bürokratie, ~5-7 Tage), dann Signal/iMessage. Channel-Adapter pro Plattform mit einheitlicher interner API. Auth pro Channel: Sender-ID mappt auf User in Twin-DB.
**Größe:** L · **Priorität:** should · **Aus:** Backlog-Anregung Markus, 1. Mai 2026 Abend

**Inspiration NanoClaw (Tag 21):** Skills-driven Channel-Install-Pattern als Vorbild — `/add-telegram`, `/add-whatsapp` etc. als Claude-Code-getriebene Skills statt monolithischer Adapter-Bau. NanoClaw Trunk shippt nur Registry + Infrastructure, Channel-Adapter sind opt-in und kopieren das benötigte Modul in den Fork. Direkter Bezug zu Twin-Lab's `examples/skills/`-Foundation (Tag 20). Cross-Reference: https://github.com/nanocoai/nanoclaw.

### 30. Multi-Channel-Adapter — Public-Mode
Externe schreiben Twin via Channel an, Twin entscheidet ob er antwortet (Mandate-Layer wird kritisch). Zusätzlicher Sicherheits-Layer ggü. Owner-Mode. DSGVO-Erwägungen (WhatsApp-Geschäftskonto, Datenfluss US-Anbieter).
**Größe:** L · **Priorität:** nice · **Aus:** Backlog-Anregung Markus, 1. Mai 2026 Abend

**Inspiration NanoClaw (Tag 21):** Container-Isolation pro Agent-Gruppe als Pattern für Public-Mode-Sicherheit. NanoClaw runs per-Agent-Group in eigenem Docker-Container mit eigener CLAUDE.md, eigenem Memory, eigenen Mounts. Für Twin-Lab's Public-Mode (externe Sender + Approval-Gates) relevant — verstärkt Isolations-Garantie über DB-Twin-ID-Trennung hinaus. Phase-B-Architektur-Erwägung.

### 31. Föderation — Mehrere Bridges sprechen miteinander
Phase 2 hat zentrale Bridge. Phase 4 = mehrere Bridges können sprechen (Matrix-Modell). Twin auf Bridge-A kann mit Twin auf Bridge-B reden, ohne dass beide auf derselben Bridge registriert sind.
**Größe:** XL · **Priorität:** nice · **Aus:** Architektur-Diskussion

### 32. P2P mit DIDs (Phase 5+)
Voll-P2P, keine Bridge mehr. DIDs (Decentralized Identifiers) für Identität. Optional: Blockchain als Bezahlebene OBEN AUF Messaging — nicht als Messaging-Layer selbst.
**Größe:** XL · **Priorität:** nice · **Aus:** Strategische Vision

**Konkrete Spec-Referenz: Agent Network Protocol (ANP).** `agent-network-protocol.com` bietet einen layered Protocol-Stack genau für dieses Szenario:

- **did:wba** (Web-Based-Agent-DID) für verifiable Agent-Identität und readable Handles
- **Agent Description + Discovery Protocol** für Capability-Publishing
- **Messaging Profiles** (P3 Direct, P4 Group, P5/P6 E2EE, P7 Attachments, P8 Federation/Cross-Domain)
- **AP2-Integration** für Payment-Flows mit ANP-Identity-Chain

ANP wäre die konkrete Implementierung dessen, was #32 abstrakt vorsieht. Alternative Specs (TBD): IETF Agent-Working-Groups, W3C DID-Methods, andere DID-Implementierungen (did:web, did:key). GitHub: `agent-network-protocol/AgentNetworkProtocol`.

### 36. Google A2A-Protokoll-Kompatibilität
Twins als A2A-Server zusätzlich zur internen Bridge erreichbar machen. Implementierung:
- `/.well-known/agent.json` mit Persona-Description und Skills
- A2A-Adapter, der eingehende JSON-RPC-Messages auf interne Pending-Queue mapt
- Mandate-Layer wendet Approval-Gates auf eingehende A2A-Requests an
- Ausgehende A2A-Calls: unsere Twins können andere A2A-Agenten anrufen

Vorteile: Ökosystem-Anbindung (Google ADK, CrewAI, Langgraph alle A2A-fähig), standardisierte Discovery, keine Lock-In auf eigenes Protokoll. Nachteile: Mehr Code-Pfade, Security-Komplexität (jeder im Internet kann anpingen).

Vorbedingungen: Phase 4 (Multi-Channel-Architektur), Mandate-Engine reif für externe Quellen. Aufwand: 2-3 Wochen für saubere Adapter-Schicht. Bestandteil der Föderations-Strategie.
**Größe:** L · **Priorität:** should · **Aus:** Markus' Recherche zu Google A2A Codelab, 2. Mai 2026

**Inspiration NanoClaw (Tag 21):** NanoClaw's „Skills over Features"-Philosophie ist Pattern-Bestätigung für A2A als opt-in Adapter statt eingebauter Capability. Plus Credential-Vault (OneCLI Agent-Vault) als Pattern für API-Key-Isolation bei externen Protokollen — Twin-Lab heute mit AES-256-GCM-Encryption in DB, NanoClaw's Vault-Pattern als nächste Schicht für Phase B.

### 125. AG-UI-Protokoll-Kompatibilität (Agent↔User Interaction)

AG-UI (Agent-User Interaction Protocol, von CopilotKit + Partner-Frameworks) ist der dritte etablierte Agentic-Standard neben MCP (Agent↔Tools, von Anthropic) und A2A (Agent↔Agent, von Google). Open, event-basiert, baut auf HTTP/WebSockets für streaming Agent-Frontend-Kommunikation.

twin-lab heute: Custom SSE-Stream mit eigenen Events (`twin.thinking`, `tool.call.start/complete`, `pending-added`, `pending-resolved`, `reply-received`). Funktional ähnlich zu AG-UI's Building Blocks (Streaming chat, Thinking steps, Tool output streaming, Interrupts, Custom events).

**Vorteile AG-UI-Adapter:**

- Client-Ökosystem (CopilotKit, React Native, Terminal-Clients community)
- Ökosystem-Anbindung wie bei A2A (#36) — externe Frontends können twin-lab-Twins anbinden ohne custom SSE-Schema zu lernen
- Standardisierte Discovery + Capabilities-Exchange

**Nachteile / Trade-offs:**

- twin-lab-spezifische Events (z.B. `reply-received` für A2A-Symmetrie, `pending-added` für Approval-Workflow) müssen als AG-UI Custom-Events gemappt werden
- Adapter-Schicht obendrauf, eigene SSE bleibt für Twin-Lab-spezifische Pfade (Mandate-Layer, Trust-Relationships)

**Pattern:** A2A-Strategie analog — AG-UI wird zusätzlich gebaut, nicht als Ersatz. Eigene SSE bleibt für Approval/Mandate/Trust-Pfade, AG-UI als Standard-Interface obendrauf für externe Clients.

**Vorbedingungen:** Phase 4 Multi-Channel-Foundation (#29/#30) — analog zu A2A, AG-UI ergibt erst Sinn wenn Twin via mehrere Kanäle erreichbar ist und externe Clients ein Standard-Interface brauchen.

**Größe:** L · **Priorität:** should · **Aus:** Markus' Protokoll-Landscape-Review, 21. Mai 2026 Abend (Tag 22). Spec: https://docs.ag-ui.com/introduction
**Status:** offen, Phase 4 oder später

---

### 132. Anthropic Subscription-Auth (Claude-CLI-Reuse-Pattern)

Anthropic hat keine offizielle 3rd-Party-OAuth-Surface für Claude Pro/Max-Subscription-Nutzung in externen Apps. Stattdessen: Claude-CLI-Reuse-Pattern — wenn auf dem Host-System ein gültiger Claude-CLI-Login existiert, kann eine externe App diese Credentials wiederverwenden.

Anthropic-Stance war fluide: Anfang April 2026 wurde Claude Pro/Max via 3rd-Party-Agent-Frameworks gekappt, OpenClaw-Doku sagt Stand Tag 25: „Anthropic staff told us this usage is allowed again". Status nicht offiziell publiziert, basiert auf direkter Kommunikation.

**Status:** Backlog, nicht in Phase A. Bau in Phase B nach Launch + Feedback, abhängig von Anthropic-Stance-Stabilität.

**Implementations-Skizze (für späteren Bau):**

Claude-CLI-Reuse-Pattern (analog OpenClaw):

1. Detect Claude-CLI-Auth auf Host-System (`~/.claude/auth.json` oder OS-Keychain)
2. Twin-Lab liest Credentials, mirrored mit Provenance (nicht eigene Refresh-Rotation, sondern externes CLI bleibt Source-of-Truth)
3. API-Calls gegen Anthropic-API mit Subscription-Auth-Token statt API-Key
4. Settings-UI: pro Twin „Use Claude-CLI Subscription" als Opt-in mit Detection-Status

**Alternativ-Pattern (falls Phase-1.1-Recherche zeigt es ist mit Setup-Token möglich):**

- Anthropic bietet „Setup-Token" für Claude-Code als offizieller Token-Auth-Pfad
- Wenn dieser Token in externer App genutzt werden kann, wäre das offiziellerer Pfad als CLI-Reuse

**Risiken:**

- Anthropic-Stance fluide (initial gekappt, laut OpenClaw-Doku „wieder erlaubt") — Status kann sich jederzeit ändern
- Pattern hängt von lokal verfügbarem Claude-CLI-Login ab — Self-Hoster ohne Claude-CLI können's nicht nutzen
- Wenn Anthropic offiziell wieder kappt, Twin-Lab-Setting muss als „deprecated" gemarkt werden

**Quellen:**

- Anthropic Claude-Code-Plan-Doku: https://support.claude.com/en/articles/11145838-using-claude-code-with-your-pro-or-max-plan
- OpenClaw OAuth-Doku (Anthropic-Sektion): https://docs.openclaw.ai/concepts/oauth#anthropic-legacy-token-compatibility

**Größe:** M (2-3 Bautage — CLI-Detection + Credential-Mirror + Settings-UI + Status-Monitoring). **Priorität:** later. **Spur:** Pre-Launch-Phase B.

**Status-Notiz Tag 25:** Pattern-Symmetrie zu #131. Anthropic-Stance weniger klar als OpenAI-Codex-OAuth-Stance — laut OpenClaw-Doku wieder erlaubt, aber nicht öffentlich publiziert. Bau erst sinnvoll wenn Anthropic offizielle Position publiziert.

**Status-Notiz Tag 26 (25. Mai 2026):** Anthropic-Stance hat sich Tag 25-26 geklärt: kein 3rd-Party-OAuth mehr, nur Token-Kauf-Pattern. CLI-Reuse-Pattern (Claude Code via lokale CLI-Authentifizierung wiederverwenden) ist damit obsolet.

**Konzept-Update-Pflicht vor Bau:** Item bleibt Phase B, aber Implementation-Pfad muss neu konzipiert werden:
- Alt: Claude-CLI-Subscription-Reuse via lokales Auth-File
- Neu: Token-Buying-Surface — Twin-Lab vermittelt API-Token-Käufe direkt über Anthropic-API, Owner zahlt nicht für Subscription separat

**Recherche-Session vor Phase-B-Bau Pflicht:** Anthropic-aktuellen Stance verifizieren (Tag-25-Mai-26-Snapshot kann morgen schon anders sein), Token-Buying-API-Surface dokumentieren, Pricing-Modell verstehen (Markup oder pass-through).

**Bleibt:** Größe M, Priorität `later`, Spur Pre-Launch-Phase B.

### 116. Conversational Skill/MCP-Install

Twin nimmt in der Konversation Anweisung "installiere Skill X" oder "verbinde MCP-Server Y" entgegen und führt die Installation mit Owner-Approval aus. Mobile-relevant: auf Telegram/WhatsApp gibt es keine Settings-UI, Conversational Install ist dort der einzige Weg.

**MVP-Scope-Skizze:**
- Neue Capabilities `install_skill`, `install_mcp_server` mit Approval
- Twin antwortet z.B.: "Ich brauche Skill X für die Aufgabe. Hier ist manifest.yaml + SKILL.md. Bitte freigeben."
- User approved → existing CLI-/Backend-Logic (#86, #87) wird aufgerufen
- Source: manueller Paste in Chat oder Verweis auf Public-Skill-Registry (später)

**Aufwand-Range:**
- Minimal (Tool-Call + Approval mit existing #86/#87-Backend): M-L
- Full Self-Service (Skill-Registry-Integration): XL, eigenes Item

**Begründung:** Vererbungs-Story für Mobile-Use. Anna soll auf WhatsApp ihrem Twin sagen können "installiere den Calendar-Skill" ohne zum Desktop wechseln zu müssen.

**Dependencies:**
- #86 ✅ Skill-Editor-UI (Backend-Routes für Skill-CRUD)
- #87 (in Arbeit) MCP-Configurator-UI (Backend-Routes für MCP-CRUD)
- Mobile-Anbindung (eigenes Phase-B-Item, noch nicht angelegt)

**Größe:** L · **Priorität:** later · **Aus:** Strategy-Session Tag 18 Nachmittag · **Spur:** Pre-Launch-Phase B (SaaS + Mobile)

**Inspiration NanoClaw (Tag 21):** NanoClaw's `/add-<name>`-Pattern (z.B. `/add-telegram`, `/add-codex`) ist die natürliche Evolution von Conversational Install. Claude Code übernimmt das Install-Step direkt, kopiert nur das benötigte Modul in den Fork. Vision-Bestätigung für Anna-Use-Case: „Anna sagt auf WhatsApp ‚installiere Calendar-Skill'" → Twin-Lab erkennt Intent, Claude Code bzw. Twin-Service führt aus mit Owner-Approval.

Plus: NanoClaw's „AI-native, hybrid by design"-Onboarding-Philosophie (scripted Happy-Path + Claude-Code-Fallback bei Step-Failure) als Inspiration für Phase-B-Onboarding-Evolution über das heutige Wizard-Form-Pattern (#110) hinaus.

### 117. Self-Authored Skills (Twin erstellt eigene Skills)

Twin beobachtet eigene Konversationen, erkennt wiederkehrende Patterns ("Owner fragt mich oft nach X mit ähnlicher Struktur"), generiert eigene Skill-Definitionen (Manifest + Instructions), und nutzt sie ab dann. Konzept analog zu autonom-skill-authoring Agent-Patterns.

**Strategy-Session vorab Pflicht.** Offene Fragen:
- **Trigger:** Wie erkennt Twin "wiederkehrendes Pattern"? Background-Pipeline, periodische Reflektion, on-demand?
- **Generation:** Twin generiert Skill-Manifest + Instructions selbst per LLM-Call?
- **Approval:** Self-Approval (Twin nutzt direkt), User-Approval-Flow, oder gestaffelt (erste N Nutzungen mit Approval, dann automatisch)?
- **Versionierung:** Twin verbessert eigene Skills über Zeit — Skill-Versionen, Audit-Trail, Rollback?
- **Vererbungs-Implikation:** Self-Authored Skills sind Teil der Twin-Identity. Bei Vererbung an Anna (Vision Block 4): wie wird Self-Authored-Status kommuniziert? Anna sieht "diesen Skill hat Markus' Twin selbst entwickelt"?

**Verknüpfung zur Twin-Reife (#101):**
- Stufe "Tief" bedeutet aktuell: viel Memory, viele Themen, lange Zeitspanne. Mit Self-Authored Skills bekommt "Tief" eine neue Dimension: Twin hat **eigene Capabilities entwickelt**.
- Möglicher Stufen-Indikator: "Self-Authored Skills: 3" als 5. Dimension in der Maturity-Heuristik.

**Dependencies:**
- #86 ✅ Skill-Editor-UI (Backend für Skill-Persistenz)
- Memory-Reflektion-Pipeline (existiert für Episodic, müsste erweitert werden)
- LLM-Call mit Manifest-Schema-aware Output (Constrained Decoding?)
- Audit/Versionierung-Infrastruktur

**Begründung:** Self-Authored Skills sind die *spürbarste* Vision-Eigenschaft — Twin wird mit der Zeit nicht nur "schlauer" sondern *fähiger*. Differenzierungs-Story-Material für Pre-Launch B / Public-Launch.

**Größe:** XL · **Priorität:** vision-kritisch · **Aus:** Strategy-Session Tag 18 Nachmittag · **Spur:** Pre-Launch-Phase B+ / Phase 3.7

### 23. Procedural Memory (Schicht 4 — Procedural)
Lerngedächtnis. Twin lernt aus Approves/Rejects/Edits. Persona-Iterationen über Zeit, oder feinere Korrekturen. Hermes-style: nach komplexen Tasks (5+ Tool-Calls) schreibt der Twin eine Skill-Markdown selbst.
**Größe:** XL · **Priorität:** nice · **Aus:** Memory-Diskussion 1.5.
*(Triage 2b Tag 33 hierher verschoben: nicht gebaut, überlappt #28/#117 Self-Authored Skills — Phase-B-Vision.)*

**Status Tag 38:** ⏸️ DATEN-BLOCKIERT (read-only an echten Daten gemessen) — bestätigt die Roadmap-Verschiebung (Phase B, Pivot Tag 18) jetzt mit Zahlen. 🔴 Pattern (a) Skill-Generierung: von 45 Dev-Konversationen erreicht 1 die Hermes-Schwelle (5+ Tool-Calls), 0 wiederkehrende Muster → nichts zu generalisieren. Pattern (b) Lernen-aus-Feedback: 16 Rejects über 6 Capability-Typen verstreut + 1 Edit → kein homogenes Owner-Muster. 🔴 Schlimmer als Leere: die Historie ist überwiegend Diagnose-/Smoke-Traffic eines einzelnen Test-Twins (self-reflection benennt es: „mehr systematisches Testen, weniger inhaltliche Nutzung") → ein Seed aus Bestand würde Test-Artefakte als Skills verfestigen. Extern-daten-abhängig, KEIN interner Hebel (wie Schritt 4 / Beziehungs-Modell). 🟢 Infra steht größtenteils: Skill-Schreib-Pfad (skills/repo.ts:131, bräuchte nur SkillSource +'derived') + Trigger-Vorlage (reflection-loop-service.ts ist 1:1 wiederverwendbar) — die Mechanik ist günstig, der Treibstoff fehlt. **Wiederaufnahme-Trigger (Re-Messung):** sobald ≥5 Konversationen die 5+-Tool-Call-Schwelle treffen UND ein Capability-Typ ≥8 gleichartige Rejects hat. Dann #28/#117 (beste Infra-Deckung) als billigster Scaffold-Einstieg.

### #93 Cognee als optionaler MCP-Skill für Knowledge-Recall (L, nice)

Wenn ein Twin größere Doc-Sets braucht (Workshop-Materialien, Notizen, Wissens-Korpus), kann Cognee (cognee.ai, 16.6k Stars, Apache 2.0) als MCP-Server pro Twin angebunden werden. Pattern identisch zu `everything`-Server aus 3.2 — `mcp_cognee_remember`, `mcp_cognee_recall` als Tools, optional `mcp_cognee_forget`. Pro Twin eigenes Cognee-Dataset, Isolation via Dataset-ID. Voraussetzung: 3.3 Conversation+Semantic-Memory steht (✅), plus 3.5 zeigt dass MCP-Pattern für externe Tools robust ist. Erst danach evaluieren ob Cognee echten Mehrwert über unsere Eigen-Implementation hinaus bringt (Knowledge-Graph, Ontology, Auto-Routing zwischen Session/Graph). Aus Tag-12-Recherche.

### #94 Dream-Pattern für Memory-Kuratierung (L, nice)

**✅ ERLEDIGT (Tag 43) — NEU ZUGESCHNITTEN als Facts-Kohärenz-Review.** Der ursprüngliche Dedup-Kern ist obsolet (UNIQUE-Schema verhindert Duplikate strukturell). Stattdessen gebaut: Erkennung semantischer Widersprüche + Veralteter Facts ÜBER fact_keys hinweg, Pending-Vorschläge (update/delete) via apply-on-approve, Markus approved. SS1 a5ed1ab / SS2 8f11764 / SS3 54b0cb3, Strategie e0ffa20. Prod-bewiesen: alle 3 gemessenen Schäden (wife_name-Widerspruch, 2 Tavryn-Altlasten) + 1 unerwarteter (Frühstück) erkannt, nach Approve sauber aufgeräumt (43→40 Facts, History erfasst). Loop-Wiring offen (eigenes Stück).

Periodischer LLM-Job pro Twin der die Facts-Sammlung verdichtet, dedupliziert und mit Konversations-Insights ergänzt. Pattern adaptiert von Anthropic Managed-Agents-Dreams (Research Preview, claude.com/docs/managed-agents/dreams). Eigen-implementiert ohne Vendor-Lock. Architektur:
- Cron-Job oder On-Demand-Trigger pro Twin
- LLM-Call mit Persona + aktueller Facts-Liste + Konversations-Summary-Sample
- Prompt: „Hier ist deine Faktensammlung. Hier sind 50 zufällige Konversations-Auszüge. Welche Fakten sollten aktualisiert, dedupliziert oder ergänzt werden? Schreibe vorgeschlagene neue Facts-Liste."
- Output → Diff-Vorschlag im UI → User approved/rejected pro Fact
- Andockpunkt vermutlich Phase 3.6 (Procedural Memory) oder Phase 4

Vorbedingung: 3.3 komplett ✅, plus Pilot-Phase mit ~50+ Fakten pro Twin gelaufen, damit der Job sinnvolle Eingangsdaten hat. Aktuell @markus mit ~8 Facts — noch zu wenig für Job-Auslastung. Aus Tag-12-Recherche.

**Update Tag 37:** Vor Bau geprüft — Vorbedingung „~50+ Facts" weiter unerfüllt (@markus ~8 Facts, conversation_summaries=0). Gehört in dieselbe daten-blockierte Klasse wie Gewohnheiten/Rituale + Werte-Drift: braucht organische Längs-Historie, erst post-launch baubar. Nicht gebaut.

---

### #95 MemPalace-Patterns als Inspirationsquelle dokumentiert (S, nice)

MemPalace (github.com/mempalace/mempalace, 48.2k Stars, MIT) — open-source AI-Memory-System, Python-basiert mit ChromaDB-Backend. Vier Patterns, die für twin-lab als Inspirationsquelle relevant sind:

1. **Wings/Rooms/Drawers-Hierarchie** (siehe #96)
2. **Temporal-Knowledge-Graph mit Validity-Windows** (siehe #97)
3. **Verbatim-Storage statt Summary-Compression** — sie speichern Konversationen 1:1, suchen über Original-Text. Wir summarizen bei >50 Messages. Trade-off: ihre Detail-Tiefe vs. unsere Speicher-Effizienz. Bei Pattern-Phase „Reverse-Memory-Query" (TWIN-VISION Punkt 8) evaluieren, ob Summary-Compression zu viel Detail verliert.
4. **Auto-Save-Hooks für Claude Code** — periodische Hooks plus Pre-Compression-Hook. Verwandt zu unserem Pattern „Auto-Diary-Generation" (Self-Reflection-Pattern), aber MemPalace ist Claude-Code-spezifisch, wir sind Twin-Plattform.

Architektur-Entscheidung vom 11. Mai (Eigen-Bau statt Cognee/Dreams) bleibt — MemPalace adressiert nur die Memory-Schicht, twin-lab ist Twin-Plattform mit A2A, Persona, Mandates, Trust. Plus: MemPalace ist Python, wir sind TypeScript — Integration via MCP-Server möglich, aber zwei Runtimes parallel ist Compose-Komplexität nicht wert für isoliertes Memory-Layer.

Benchmarks (zur Orientierung, keine direkte Vergleichbarkeit): LongMemEval R@5 96.6% raw / 98.4% hybrid v4, LoCoMo R@10 88.9% hybrid, ConvoMem 92.9% avg recall, MemBench 80.3% R@5.

Aus Tag-14-Recherche.

### #96 Hierarchical Memory-Scoping als Mitigation für Name-Overlap (M, should)

**Status Tag 38:** ❌ NICHT gebaut — read-only an echten @markus-Daten (35 Memories, lokales e5 live, volle retrieve()-Pipeline) gemessen: **marginal → bleibt Backlog** (Lehre aus #101 angewandt). 🔴 **C6 (der Kern):** Prompt-Top-K = EPISODIC_TOP_K=3; in JEDEM gemessenen Fall erreicht die Antwort-Memory den Prompt-Top-3 (Rang 1–3) — der „Rang 3"-Fall aus der #101-Messung ist bei K=3 noch im Prompt, der LLM sieht ihn und filtert. Pipeline trägt es schon. 🔴 **A2 (Ursachen-Korrektur):** Wo Memories eng liegen, ist es **echte Vektor-Nähe + Multi-Topic-Granularität**, NICHT Name/Token-Overlap. Die ursprüngliche These „Toskana Rang 5/5 wegen 4 Markus-Token-Overlaps" stammt aus dem 3.4-Pre-Check (dünnere Daten); an echten Daten liegt die Toskana-Info in einer „Rich-Memory", die Frau+Wohnort+HARWAY+Toskana in EINEM Embedding bündelt (breiter Fußabdruck, matcht viele Queries) — ein Granularitäts-Effekt. **Die große Lösung (Auto-Tagging + Wings/Rooms-Scoping) heilt das NICHT:** ein 4-Themen-Embedding ist nicht auf einen topic_tag reduzierbar, und vage Queries liefern keinen ableitbaren Scope. Falscher Hebel für die gemessene Ursache. **Kleinster wirksamer Hebel — falls je nötig:** EPISODIC_TOP_K 3→5 (eine Konstante) + ggf. MMR/Diversity-Re-Rank gegen Cluster-Enge; Auto-Tagging/Scoping NICHT. **Skala-Vorbehalt:** gemessen an 35 Build-Chatter-Memories — bei Prod-Wachstum auf Hunderte könnte Cluster-Konkurrenz K=3 rang-4+-Antworten verlieren lassen → dann re-messen, Hebel wäre K-Tuning/MMR. **Cross-Ref:** echte Strukturursache (Multi-Topic-Ganz-Konversations-Embedding) wäre ein eigener Memory-Foundation-Umbau (Segment-Embedding), #96-unabhängig.

**Prod-Gegenmessung (Tag 38):** Skala-Vorbehalt geprüft statt angenommen — Prod-@markus (twin_jgqzOIkzdTsTx6vv) hat 12 Embeddings, also WENIGER als Dev (35), nicht mehr (respond_to_chat-Audits=0; Prod ist der jüngere Stack, Owner-Chat lief bisher über Dev). Die Dev-Messung war damit die DICHTERE/strengere Probe — bei 12 Memories ist die Cluster-Konkurrenz geringer, die Antwort landet erst recht im Top-3. Der „bei mehr Prod-Daten könnte K=3 kippen"-Vorbehalt ist damit für den heutigen Stand gegenstandslos (greift erst bei echtem Wachstum auf Hunderte — dann re-messen). #96 bleibt Backlog, jetzt auch gegen die echte Prod-Datenmenge bestätigt.

Direktes Mitigation für Name-Overlap-Problem aus 3.4-Pre-Check (Query „Wo geht Markus in Urlaub?" → Toskana-Passage auf Rank 5/5, weil 4 andere Passages „Markus" als Token enthielten). MemPalace löst das via Wings/Rooms/Drawers-Hierarchie: Memory ist nicht flach, sondern strukturiert. „Wings" = große Cluster (Personen, Projekte), „Rooms" = Topics innerhalb eines Wings, „Drawers" = einzelne Memory-Einträge. Suchen kann auf Wing-Level oder Room-Level gescopet werden — Vector-Search läuft nur innerhalb des relevanten Wings, nicht über alles.

Übertragung auf twin-lab: Datenschicht aus 3.4 hat bereits Felder, die in Richtung gehen — `topic_tags` (JSON-Array, NULL initially) und `narrative_thread_id` (TEXT, NULL initially) auf der `embeddings`-Tabelle. Diese könnten als „Light-Hierarchy" interpretiert werden:

- Auto-Tagging beim Embedden via LLM-Call („Welche Topics/Subjekte beschreibt dieser Text?")
- `narrative_thread_id` als Verkettung verwandter Memories
- Search-API erweitert: `EmbeddingsRepo.search(twinId, query, { topicTagFilter?, narrativeThreadId? })`

Alternative: Hybrid Search via FTS5 (Datenschicht in 3.4 vorbereitet via `memory_fts`-Tabelle) — kombiniert Vector + BM25-Keyword-Search. Eine der beiden Mitigationen reicht vermutlich, je nach welche zuerst nötig wird im Real-Data-Test.

Andockpunkt: Pattern-Phase „Aufmerksamkeit/Fokus" (TWIN-VISION) oder dedicated Mini-Phase falls Name-Overlap in Production-3.4-Tests spürbar wird.

Aus Tag-14-Recherche + Pre-Check-Befund.

### #97b getAsOf-Query / Twin-weite Sicht auf Fact-History (S, nice)

Additiver Rest aus #97 (Hauptteil ✅ gebaut Tag 37 → Archiv). Offen: `factsRepo.getAsOf(date)` (Fact-Stand zu einem Datum) + Twin-weite History-Sicht (statt nur pro Key) + confidence-History (`change_type`-Spalte hält das additiv offen). Nachrüstbar OHNE Migration auf der bestehenden `facts_history`-Tabelle (028).
**Größe:** S · **Priorität:** nice · **Aus:** #97-Rest

### Vision-Pattern „Gewohnheiten/Rituale" — vertagt bis organische Nutzung (Daten-blockiert)

**Status Tag 39:** Blockade-Prämisse (conversation_summaries @markus = 0) wird durch G2 (Telegram-Konversations-Lifecycle, Tag 39) adressiert — Längsschnitt entsteht aus echtem Verkehr. Wiederaufnahme: nach G2-Beweis (Tag-40-Tick) neu vermessen. **(Tag 37, read-only diagnostiziert, nicht gebaut.)** **Grund:** Datenschicht misst heute Build-Aktivität statt Lebensrhythmus (audit-Timestamps = Claude-Code-Sessions; conversation_summaries @markus = 0). Pending-gated (Inferenz über Markus, Vorbild self-reflection-write) → schwache Muster würden Approval-Müll erzeugen. **Wann baubar:** nach Akkumulation echter (Nicht-Build-)Nutzung über mehrere Wochen/Monate — Längsschnitt nötig. **Maschinerie steht bereit (wenn Daten tragen):** Audit-Pending-Klasse, hybrid (deterministische Timestamp-Aggregation + optional LLM für sprachliche Fassung), vermutlich keine Migration (approved Audits/Diary). **Cross-Ref:** dieselbe Daten-Klasse wie Werte-Drift; Schlaf/Träume (#94) wäre datenSCHAFFEND (erzeugt die fehlenden Summaries) und damit der sinnvollere nächste Vision-Bau.

### Vision-Pattern „Lebens-Narrativ" (#7) — vertagt bis Diary-Tiefe (daten-blockiert, aber intern freischaltbar)

**Status Tag 39:** interner Hebel gezogen — Reflexions-Loop scharf (Tag 38), Stufe 1 Reverse-Memory-Query gebaut (a59b4af), Stufe-3-Muster-Nudge strategiert (docs/STUFE-3-MUSTER-NUDGE-STRATEGY.md, e56ab31). Stufe-1-Güte + Stufe-3-Prüfstein reifen mit G2 (verdichtete Episoden, ab Tag-40-Tick). **(Tag 37, read-only diagnostiziert: vertagt.)** **Scope geklärt:** Lesart (A) Twin-über-sich (Vision :79/:205), NICHT Markus-Biografie. **Grund:** Quelle Twin-Diary = real 1 Eintrag → keine „Story, die sich entwickelt" (Bogen braucht mehrere Selbst-Snapshots über Zeit). **Leitplanke:** (A) leitplanken-entspannt, autonom-fähig (Klasse self-reflection subject='self'). **Wann baubar — interner Hebel (Unterschied zu den anderen drei!):** Reflexions-Loop scharf schalten (gebaut, default aus) → Diary wächst autonom über Wochen → dann trägt das Pattern. Selbst-erzeugbar, braucht NICHT Markus' organische Nutzung. **Maschinerie:** Verdichtung N Diary-Entries → Bogen (self-reflection-Generator Vorbild, neuer Modus); Speicher append-only wie focus_snapshots; Migration vermutlich ja.

### Phase 4.3 Schritt 4 — familiarity-Auto-Ableitung (Hybrid-Vorschläge) — vertagt bis organischer A2A-Verkehr (daten-blockiert)

**Status Tag 38:** ⏸️ vertagt (read-only diagnostiziert). Teil der Phase-4.3-Achse (docs/PHASE-4.3-BEZIEHUNGS-MODELL-STRATEGY.md, dort die ausführliche Status-Zeile am Schritt-4-Block). **Foundation fertig** (Schritte 1–3 gebaut: Schema/Ton/manuelle Kontrolle), aber die Auto-Ableitung des familiarity_level aus Kontakt-Häufigkeit/Historie ist **daten-blockiert**: echte A2A-Daten zu dünn (@florian = 1 Konversation, ~7 Interaktionen, ein Tag, keine Zeitspanne) → jede Heuristik wäre Rauschen. Muster wiederverwendbar (Social-Suggestion 1:1; einzige Abweichung: Approve ruft real `setFamiliarity` statt no-op). 🔴 **Kein interner Hebel** (anders als Lebens-Narrativ): braucht echten Twin-zu-Twin-Verkehr über Zeit (Föderations-nah). **Wiederaufnahme-Trigger:** organischer A2A-Verkehr über Wochen/Monate → dann deterministische Variante-A-Heuristik (Frequenz+Recency+Dauer; NICHT LLM), manuelle Route als Trigger (kein Loop). **Nicht vorbauen** (Gerüst + triviale Heuristik = Rausch-Pendings/Approval-Müll). Schritt 5 (Autonomie) ist NICHT daten-blockiert (hängt an manuell gesetzten Levels) → der sinnvollere nächste Schritt der Achse. **Foundation (Schritte 1–3 = Beziehungs-Modell, Migration 029) gebaut + deployt Tag 38; Schritt 4 (Auto-Ableitung) bleibt daten-blockiert.**

### Proaktiv-Nudge Anlass 2 (Werte-Widerspruch) — vertagt (daten- + konzept-blockiert)

> Anlass 3 (offene Frage / unbeantwortete Twin-Frage) ist seit Tag 39 GEBAUT (`a59b4af`) → siehe Archiv. Dieses Item hält nur noch den distinkten Anlass-2-Kern (Werte-Widerspruch).

Dritter/zweiter Proaktivitäts-Anlass (b „von-selbst-kommen"). Anlass 1 (Fokus-Festhängen) ist gebaut + scharf (STAND Tag 38). Anlass 2 = Twin erkennt ein Muster/einen Widerspruch in den Owner-Memories und stößt proaktiv an; würde dieselbe proactive-nudge-Pipeline nutzen (andere Detektion + Generator-Prompt).

**Status Tag 39: Anlass 2 (Muster/Widerspruch) ⏸️ VERTAGT — daten- UND konzept-blockiert (read-only an echten Daten gemessen).** 🔴 Daten: @markus hat 11 Facts, ALLE statische Identitäts-/Beziehungsdaten (Wohnort, Firma, Frau, Partner, Toskana-Plan); 0 vergessene Absichten, 0 Werte-Aussagen, 0 Verhaltens-Zeitreihe; twin_diary 1 Eintrag (über Twin-Verhalten, kein Owner-Lebensmuster), 0 Summaries. Beide Muster-Sorten null reale Beispiele → daten-blockiert wie Schritt 4 / Procedural Memory. 🔴 Konzept (die saubere Zerlegung): die SICHERE Sorte „vergessene Absicht" (faktenbasiert, kein Werturteil) IST in Wahrheit Anlass 3 (offene Frage) — beide brauchen dasselbe fehlende „offen-vs-erledigt"-Signal im Datenmodell (Facts haben kein solches Flag, facts_history trackt nur Wert-Drift). Der DISTINKTE Anlass-2-Kern ist NUR die riskante Sorte: Werte-Widerspruch, bei dem der Twin Owner-Verhalten BEWERTET (übergriffig, darf nicht auf dünner Inferenz gebaut werden). 🟢 Mechanik (proactive-nudge-Pipeline aus Tag 38) wäre 1:1 wiederverwendbar — nur Detektion + Generator-Prompt neu; die Bremse ist Daten + Konzept, nicht Code. **Konsequenz für die Roadmap (Tag 39 nachgeführt):** Anlass 3 (offene Frage/vergessene Absicht) ist seit Tag 39 GEBAUT (`a59b4af`, via Audit-Turn-Reihenfolge — das „offen-vs-erledigt"-Signal kam aus der Turn-Ordnung, NICHT aus einem nachzurüstenden Datenmodell-Flag; siehe Archiv). Werte-Widerspruch (Anlass-2-Kern) bleibt die zuletzt zu bauende, heikelste Klasse — erst wenn echte Werte-+Verhaltens-Historie über Zeit trägt. **Wiederaufnahme:** echte Lebens-Memories (Absichten, Werte, Verhalten) statt statischer Identität — entsteht durch reale Nutzung über Zeit, kein interner Hebel.

### #143 Web-OAuth-Production-Flow ohne CLI-Subprocess (XL, should — Phase B)

**Phase-A-Variante:** OAuth läuft über `pnpm twin:oauth-login` CLI-Wrapper (Phase 4). User braucht Codex Desktop App + Terminal-Zugang zum twin-lab-Repo. Akzeptabel für drei dev-fitte Owner (florian/heiko/markus), aber Mass-User-Onboarding-Friction.

**Phase-B-Ziel:** Browser-only OAuth direkt aus der Settings-Page heraus. Klick "OAuth aktivieren" → eigener PKCE-Server im runtime nimmt Callback entgegen → Token-Persist + Settings-Refresh. Kein Terminal-Wechsel, kein Codex-App-Requirement.

**Implementation-Skizze:**
- Eigener Loopback-Listener (Port 1455 oder dynamisch) im runtime-Workspace
- PKCE-Challenge clientseitig im Web, Auth-URL öffnet sich in neuem Tab
- Callback-Endpoint `/oauth/callback` im runtime nimmt Code entgegen, exchanged gegen Token, persistiert in oauth_tokens
- WebSocket oder SSE-Push an Settings-UI für Status-Update

**Risiken:** OAuth-Redirect-Whitelist bei OpenAI Codex (hardcoded localhost:1455), VPS-Self-Hosting braucht SSH-Tunnel oder Port-Forwarding. Strategy-Doc §a-§b hat das in der Original-XXL-Estimate berücksichtigt.

**Größe:** XL (3-5 Bautage). **Priorität:** should. **Spur:** Phase B.

### #144 VPS/Linux-Path für CLI via `--device-auth` (M, nice — Phase B)

**Phase-A-Setzung (§t.8):** `pnpm twin:oauth-login` baut nur den lokalen macOS-Path mit Codex-Desktop-App-Bundle. VPS/Linux-Self-Hoster können das CLI noch nicht nutzen.

**Phase-B-Ziel:** CLI um `--device-auth`-Flag erweitern. `codex login --device-auth` startet Device-Code-Flow — User loggt sich am Mac-Browser ein, gibt 8-stelligen Code in VPS-Terminal ein. Pattern-Adaption analog Hermes für SSH-only-Self-Hoster.

**Alternative:** CLI um Detect-Logik erweitern (`fs.existsSync('/Applications/Codex.app')` → macOS-Path, sonst → Linux-Binary von `@openai/codex`-npm-Package). Plus `--device-auth`-Flag als manueller Override.

**Größe:** M (1-1.5 Bautage). **Priorität:** nice (erst wenn ein User es konkret fordert). **Spur:** Phase B oder Phase A nach Launch.

### #145 Multi-Account-Support für mehrere ChatGPT-Accounts (M, nice — Phase B)

**Phase-A-Limit:** `~/.codex/auth.json` ist single-tenant. Re-Login mit anderem ChatGPT-Account überschreibt `account_id` im File. User mit mehreren ChatGPT-Accounts (Personal + Work) müssen zwischen Logins manuell wechseln.

**Phase-B-Ziel:** Pro-Twin-`auth.json` (z.B. `~/.codex/auth.json.@markus`, `~/.codex/auth.json.@florian`) — getrennte Files für getrennte Accounts. CLI managed das Switching via Symlink oder per-twin-config.

**Alternative:** Settings-UI-Warnung beim Re-Login: "Vorheriger ChatGPT-Account: X. Neuer Login überschreibt." User akzeptiert bewusst.

**Größe:** M (1-2 Bautage). **Priorität:** nice. **Spur:** Phase B nach Launch + Demand-Signal.

### #151 `id_token` + `scope` aus Refresh-Response evaluieren (S, nice — Phase B)

**Files:** `apps/runtime/src/oauth/openai-pkce.ts` (`OAuthTokenResponse`-Type), `apps/runtime/src/oauth/oauth-tokens-repo.ts`.

**Hintergrund (Tag 28 Block 7 Live-Diag):** Codex-Refresh-Response liefert die Felder `[access_token, expires_in, id_token, refresh_token, scope, token_type]` — siehe `audit_FuawriTsQd1j`-Begleit-Diag-Dump. Heute werden nur `access_token` + `refresh_token` + `expires_in` extrahiert. `id_token` (JWT mit Claims) und `scope` werden ignoriert.

**Mögliche Use-Cases:**
- **`id_token.exp`-Claim** für Initial-Token-Lifetime-Konsistenz (Cross-Ref #150). Würde erklären woher die ~50-Min-Initial-Lifetime nach `codex login` kommt.
- **`id_token.email`** für Account-Verifikation. Owner-User-Mapping könnte gestärkt werden — heute basiert das nur auf `account_id`.
- **`scope`** für Multi-Scope-Support in Phase B (z.B. wenn zusätzliche OpenAI-Capabilities pro Twin geschaltet werden sollen).

**Action:** `OAuthTokenResponse`-Type um optionale Felder erweitern, JWT-Parsing-Helper für `id_token`-Claims, optionaler Spalten-Erweiterung im `oauth_tokens`-Repo (z.B. `id_token_email` indizierbar für Account-Lookup).

**Priority:** nice-to-have, Phase B. **Aufwand:** S (~3-4h für Type + Parser + Repo-Erweiterung, ohne UI-Integration).

### #152 Hot-Reload-Race im `tsx watch`-Dev-Setup adressieren (M-L, nice — Phase B)

**Hintergrund (Tag 28 Block 11-12):** Block-11-Diagnose-Spike für #149 hat identifiziert: `tsx watch` (Dev-Setup für Runtime) kann mehrere `OAuthRefreshService`-Instanzen parallel laufen lassen — bei Code-Change in `refresh-service.ts` oder umgebenden Files startet eine neue Instanz, während die alte noch in-flight ist. Jede Instanz hat ihre eigene `inFlight`-Map, der Mutex greift nicht über Instanzen-Grenze hinweg. Mögliche Folge: zwei parallele `refreshAccessToken`-Calls für denselben Twin, OpenAI invalidiert beide Tokens (`refresh_token_reused`).

Dies ist die plausibelste Erklärung für die Tag-28-Vormittag-Failures, die ursprünglich H3-Race-Verdacht in #149 ausgelöst hatten. #149 ist code-seitig korrekt (Single-Process-Modell), die Wurzelursache liegt im Dev-Tool-Lifecycle.

**Production-Relevanz:** Aktuell **niedrig**, weil Production-Container-Restarts (nicht Hot-Reload) immer sauber booten. Aber: relevant für Container-Cluster-Setups (Phase B+) oder Multi-Instance-Skalierung mit horizontaler Replikation.

**Lösungspfade:**

- **Variante A — `OAuthRefreshService` als Singleton via Module-Scope.** Statt Instance-Field in `TwinService`-Konstruktion eine Module-Level-Variable mit Lazy-Init. Hot-Reload re-importiert das Module, aber der Module-Scope-Cache ist persistent (Node-Module-System). Komplexität: M.
- **Variante B — SQLite-Lock auf `oauth_tokens`-Row für die Refresh-Dauer.** `BEGIN IMMEDIATE` + `UPDATE ... WHERE expires_at = ?` als atomic Check-and-Lock. Cross-Process-Safe, adressiert auch Container-Cluster-Setup. Komplexität: M-L.
- **Variante C — In Dev-Setup `OAUTH_REFRESH_POLL_DISABLED=true` als Default in `.env.local` setzen.** Schnell-Fix via Doku, keine echte strukturelle Lösung. Bereits empirisch greifend ab Tag 28 Block 6.

**Priority:** nice, Phase B. Bis dahin: Block-6-Guard (`OAUTH_REFRESH_POLL_DISABLED=true`) als pragmatische Mitigation, JSDoc in `ensureFresh` als forensische Spur für zukünftige Sessions.

**Aufwand:** M (Variante A) bis L (Variante B). Variante C ist XS-Doku, aber kein "Fix".

### #153 DEPLOYMENT.md §11 OAuth-Production-Workflow dokumentieren (XS, should — Phase B)

**Hintergrund (Tag 28 Block 14-15):** Phase-B-CLI-Erweiterung `--auth-json=<path>` (Commit `76e49fe`) ermöglicht VPS-OAuth-Login ohne Codex-Binary im Container. Production-Workflow ist 4-Schritt-manuell:

1. Mac-lokal: `codex login` → schreibt `~/.codex/auth.json`
2. Mac: `scp ~/.codex/auth.json root@srv1046432:/tmp/auth.json`
3. VPS: `docker cp /tmp/auth.json twin-lab-runtime:/tmp/auth.json`
4. VPS: `docker exec twin-lab-runtime npx tsx /app/apps/runtime/src/scripts/cli-oauth-login.ts <@handle> --auth-json=/tmp/auth.json`
5. Cleanup: `docker exec ... rm /tmp/auth.json` + `rm /tmp/auth.json` auf VPS-Host

**Action:** in `docs/DEPLOYMENT.md` einen neuen `### §11 OAuth-Login für Production-Twins`-Abschnitt mit der Sequenz, Security-Hinweis (auth.json enthält access_token + refresh_token, nicht in Repo committen + nach Use löschen), und Cross-Ref auf #131-OAUTH-STRATEGY §y. Zusätzlich Re-Login-Pfad dokumentieren (gleiche Sequenz, `oauth_tokens.upsert` überschreibt existing Row).

**Priority:** should. Solange #143 (Web-OAuth ohne CLI) Phase-B-Item ist, ist Manual-Workflow das produktive Pattern für `@florian`/`@heiko`-Onboarding und Re-Login. Ohne Doku-Anker wird die Sequenz aus Chat-Transkripten rekonstruiert. **Aufwand:** XS (~15-20 Min).

### #154 DEPLOYMENT.md Deploy-Section: `--build-arg NEXT_PUBLIC_RUNTIME_URL` explizit dokumentieren (XS, should — Phase B)

**Hintergrund (Tag 28 Block 13):** Production-Deploy ist auf einen Build-Arg-Bug gelaufen. `apps/web/Dockerfile` deklariert `ARG NEXT_PUBLIC_RUNTIME_URL=http://localhost:4000` als Default. Beim Production-`docker build` ohne `--build-arg` wurde der Default in das JS-Bundle inlined — NEXT_PUBLIC_*-Vars sind build-time-Konstanten in Next.js, kein Runtime-Lookup. Folge: Web-Container rief `http://localhost:4000/auth/login` statt der Production-Runtime-URL. ~30 Min Diagnose, ~10 Min Re-Build mit korrektem Build-Arg.

**Action:** in `docs/DEPLOYMENT.md` Web-Build-Section explizit ergänzen:

```sh
docker build \
  --build-arg NEXT_PUBLIC_RUNTIME_URL=https://runtime.twin.harwayexperience.com \
  -t twin-lab-web:latest \
  -f apps/web/Dockerfile \
  .
```

Plus Warn-Box: "Ohne `--build-arg` greift der Dockerfile-Default `http://localhost:4000` und der Web-Container ruft localhost an. Always explicit."

**Priority:** should. Einmaliger Doku-Aufwand, vermeidet ~40 Min Diagnose beim nächsten Production-Build. **Aufwand:** XS (~5-10 Min).

### #156 DEPLOYMENT.md Multi-Service-Refactor-Sequenz dokumentieren (XS, should — Phase B)

**Hintergrund (Tag 28 Block 16):** Multi-Service-Refactor (#155 A2A Reply-Architektur) hat Bridge + Runtime + Web geändert. Deploy-Briefing nannte nur Runtime + Web, Bridge wurde übersehen. Production-Smoke schlug fehl mit Bridge-400 `"messageType muss einer von [twin, system] sein"` weil Bridge-Container noch alten Type-Union-Build hatte. Failed-Audit `audit_pk2D6B1bbdMx` ist live als forensische Spur.

**Action:** Neue Section `### Multi-Service-Deploys` in `docs/DEPLOYMENT.md` mit:
- Checklist: bei Schema-Changes die mehrere Container kennen müssen, **alle drei Container (Bridge + Runtime + Web) zusammen rebuilden + recreaten**
- Beispiel-Build-Sequenz (alle drei Images parallel)
- Hinweis auf `docker compose up -d --force-recreate bridge runtime web` als atomare Aktion
- Cross-Ref Lesson #15 Tag 28 + #155

**Priority:** should. Vermeidet ~5-10 Min Diagnose pro Multi-Service-Deploy. **Aufwand:** XS (~10-15 Min).

### #157 Smoke-Scripts-Hygiene-Welle (Phase-by-Phase-Archivierung, M-L, nice — Phase B)

**Status:** Offen | Phase B | Aufwand: M-L (1-1.5 Bautage)
**Cross-Ref:** `docs/INVENTORY-tag28.md` Sektion B2

Aktuell 35 `test-*.ts`-Smoke-Scripts in `apps/runtime/src/scripts/` (22 in `package.json` registriert, 13 unregistriert), alle aus konkreten Bauphasen (Phase 3.1 Skills, 3.2 MCP, 3.3 Memory/Facts, 3.4 OAuth/Codex, #130 Telegram).

**Setzung Schule B (Tag 28 Block 19/20):** Phase-Closure-getriggert Smoke-Scripts nach `apps/runtime/src/scripts/archive/<phase>/` verschieben. `package.json`-Scripts entsprechend dokumentieren oder entfernen. Phase-bezogenes Mapping als `README.md` im jeweiligen Archive-Subfolder.

**Scope-Bauschritte:**
- Pro Bauphase Liste der Smoke-Scripts ermitteln (aus STAND/BACKLOG-Spuren zusammensuchen)
- `archive/`-Subfolder mit `README.md`-Stub anlegen
- Files mit `git mv` verschieben
- `package.json`-Scripts-Section bereinigen
- STRATEGY-Docs-Cross-Refs aktualisieren falls direkt auf Script-Pfad verwiesen wird

**Nicht-Scope:**
- Vitest-Migration (eigene Diskussion, nicht hier)
- Aktive Phase (z.B. Phase 3.5 falls noch nicht closed) bleibt live

**Findings aus Block 19 Inventur:**
- **22 registriert** (B2.2 Inventur): `oauth-phase1/2/3-Spikes`, `codex-vercel-provider`, `codex-sse-parser`, `codex-retry`, `trust-test`, `memory-repos`, `episodic-repos`, `embedding-providers`, `model-cache-dir`, `memory-embedding-service`, `memory-retrieval-service/hybrid`, `twin-diary-cli`, `memory-maintenance`, `summary-engine`, `history-with-summary`, `prompt-builder`, `extraction-engine`
- **13 unregistriert** (B2.3 Inventur): `test-conversation-flow/history`, `test-conversations-repo`, `test-mcp-client-manager`, `test-mcp-servers-repo`, `test-mcp-skill-sync`, `test-mcp-tool-execution`, `test-skill-engine`, `test-skill-repo`, `test-telegram-phase2/3`, `test-telegram-repos`, `setup-telegram-manual-smoke`

### #158 Strategy-Doc-Lifecycle-Konvention etablieren (S, nice — Phase B)

**Status:** Offen | Phase B | Aufwand: S (~30 Min Setup-Block, danach laufende Disziplin)
**Cross-Ref:** `docs/INVENTORY-tag28.md` Beobachtung 9, `docs/archive/README.md`

`131-OAUTH-STRATEGY.md` mit 141 KB und 25 Sub-Sections (§a-§y) zeigt: wenn jedes substantielle Phase-Item ein Live-Tagebuch bekommt, wachsen wir uns mit den Strategy-Docs kaputt. Brauchen Konvention.

**Setzung:** Strategy-Docs leben in `docs/` während ihre Phase aktiv ist. Nach Phase-Closure wandern sie nach `docs/archive/`. Konvention dokumentiert im `docs/archive/README.md` (Block 20).

**Scope-Bauschritte:**
- Bei nächster Phase-Closure (z.B. Phase 3.5 oder #131 OAuth final-closed) Strategy-Doc nach `docs/archive/` verschieben
- Live-STAND-Header weist auf Archive-Pfad hin
- Falls künftige Phase Live-Strategy-Doc braucht: `README.md` im Phase-Folder vermerken, nicht im Repo-Root

**Nicht-Scope:**
- Retroaktive Archivierung von `131-OAUTH-STRATEGY.md` (Phase A closed seit Tag 27, aber Strategy-Doc ist heute Tag 28 Block 14 + 15 um §x + §y erweitert worden — hat noch live-Spuren). Wenn Phase A komplett closed ist und keine `--auth-json`-Folge-Iteration mehr ansteht, dann Move.

### #159 FK-Cascade-Check für alle User/Twin/Owner-Relations (S, nice — Phase B)

**Status:** Offen | Phase B | Aufwand: S (~30-60 Min Audit + ggf. punktuelle Pragma-Fixes + CLI-Cheat-Sheet)
**Cross-Ref:** Lesson Tag 29 #4, `apps/runtime/src/scripts/_mcp-cli-helpers.ts:77-78`, `apps/runtime/src/scripts/init-db.ts`

**Befund Tag 29 (27. Mai 2026):** Bei Block-5-Smoke-Cleanups via `sqlite3`-CLI sind Orphan-Rows entstanden — `DELETE FROM users WHERE email='test@…'` hinterließ `twin_profiles` + `audit_log` + `mcp_servers`-Rows ohne User. Wurzel: `sqlite3`-CLI enforced Foreign-Keys per default **nicht**, das Pragma muss pro Connection gesetzt werden. Application-Code macht das schon konsistent (`db.pragma("foreign_keys = ON")` in jedem DB-Connector, siehe `_mcp-cli-helpers.ts`, `init-db.ts`, `runtime/src/index.ts`), aber ad-hoc Shell-Sessions sind blind.

**Scope:**
1. **Audit aller DB-öffnenden Code-Pfade.** `grep -rn "new Database(" apps/` + `grep -rn "better-sqlite3" apps/` → für jeden Treffer verifizieren, dass `db.pragma("journal_mode = WAL")` und `db.pragma("foreign_keys = ON")` direkt nach dem Open gerufen werden. Fehlende Pragma-Setzungen ergänzen.
2. **Schema-Audit der FK-Beziehungen.** Welche Tabellen referenzieren `users(user_id)`, `twin_profiles(twin_id)`, `owner_user_id`? `ON DELETE CASCADE` vs. `RESTRICT` vs. `SET NULL` — pro Beziehung dokumentieren, ob die Cascade-Policy gewollt ist (z.B. User-Delete → Twin-Delete? Oder Soft-Lock?).
3. **DB-CLI-Cheat-Sheet** in `docs/SETUP.md` (oder neuer `docs/DB-CHEATSHEET.md`): "Vor manuellen DELETEs immer `PRAGMA foreign_keys = ON;` setzen. Empfohlener Header-Block für ad-hoc Cleanup-Sessions."
4. **Optional:** Smoke-Cleanup-Helper-Skript (`pnpm db:cleanup-test-user <email>`) das die Pragma sauber setzt und User + abhängige Rows in einer Transaktion löscht — verhindert künftige Orphan-Drift.

**Nicht-Scope:**
- Account-Delete-UI (eigenes Item, aus #135 defer)
- Datenmigration historischer Orphan-Rows (separater Cleanup-Block falls vorhandene Test-DB-Reste relevant werden)

**Wert:** vermeidet stille DB-Drift bei künftigen Smokes, dokumentiert die FK-Semantik für jeden, der manuell in die DB greift. Niedriges Risiko, hoher Cleanliness-Impact für die Phase-B-Self-Hosting-Phase wenn externe Owner ihre Test-Twins iterativ wegputzen.

- **#160 — Leere Fortsetzungs-/Reset-Konv aufräumen.** „Fortsetzen" (v2) und vermutlich auch „Neu starten" hinterlassen eine leere „(kein Inhalt)"-Konv, wenn keine Nachricht folgt. Sammeln sich im Verlauf an. Optionen: (a) leere Konv beim nächsten Reset/Fortsetzen automatisch hart löschen; (b) Fortsetzung erst materialisieren, wenn die erste Nachricht kommt (berührt start()/Invariante — sorgfältig). Kein Quick-Fix, eigenes kleines Stück mit Diagnose. Workaround heute: per #53-Löschfunktion manuell wegräumen.

### #161 Verdichtungs-Loch: unter-Schwelle beendete Konversationen fallen durch alle Netze (M, wichtig)

**✅ ERLEDIGT (Tag 42, bbfb156 + Backfill):** Fix am Verarbeiter (flushPendingConversationTails: count===0-Skip → Whole-Embed-Zweig, Rezept aus resetConversation, Batch-Limit + MIT-Inhalt-Guard). Backfill via twin:memory-embed-all @markus: conv_5W09 + conv_wRUgwuz5 embedded, ended+pending 2→0, Embeddings 10→12. start()-Invariante bewusst end-only belassen; Verarbeiter ist die richtige Schicht. Wiederkehr im Fokus-Loop autonom geschlossen.

**Befund (Tag 42):** Beendete Konversationen mit Inhalt aber unter der Summary-Schwelle (10-40 Turns) werden weder summarisiert (kein Segment) noch embedded (Whole-Conv-Embed läuft nicht) noch vom Tail-Flush erfasst (skippt bei summaries===0). Sie bleiben embedding_status=pending und sind im Memory-Retrieval unsichtbar. Beleg: conv_5W09i-eXW2d (@markus, 26 owner-direct-Turns, ended 8.6., 0 Summaries, 0 Embeddings, pending).

**Wirkung:** Bei Nutzungsmustern mit vielen mittellangen Gesprächen (Markus: 95% Telegram, selten 50+ Turns) bleibt ein Großteil des gelebten Korpus unverdichtet/unsichtbar → reflection-owner / Dream / Muster-Anläufe wirken daten-blockiert, obwohl Substanz existiert (sie ist nur nicht erschlossen).

**Fix-Richtung (erst Diagnose):** (1) 🔴 Klären, warum der Whole-Conv-Embed bei 0-Segment-ended-Konv nicht läuft (Trigger-Bedingung? status-Übergang?) — die Tag-40-Strategie nahm an, dieser Pfad deckt 0-Segment-Konv ab; conv_5W09 widerlegt das. (2) Dann: entweder den Whole-Embed-Pfad reparieren ODER die Tail-Flush-Selektion erweitern (0-Segment-ended-Konv mit Inhalt auch verdichten, statt count===0 zu skippen) — Abwägung, welcher Pfad sauberer ist, im Fix-Schritt. (3) Backfill für bestehende pending-unter-Schwelle-Konv (conv_5W09 + alle gleicher Klasse). Backup vor jedem Schreibvorgang.

**Nicht verwechseln mit:** L3 (Tag 40, Tail nach existierendem Segment — gelöst). Dies ist die 0-Segment-Klasse, die Tag 40 als „über Whole-Embed abgedeckt" annahm, was nicht stimmt.

### CLA/DCO vor den ersten externen Beiträgen (Vorbedingung für Dual-Licensing)

**Status:** OFFEN (jetzt unkritisch, Alleinautor) | **Größe S–M** | **Gate:** vor „erste externe Beiträge annehmen"

Ein **CLA** (Contributor License Agreement) oder mindestens **DCO** (Developer Certificate of Origin) ist die **Vorbedingung für späteres Dual-Licensing**: ohne Rechte-Bündelung an externen Beiträgen kann der Rechteinhaber das Gesamtwerk nicht kommerziell relizenzieren (ein AGPL-Beitrag eines Dritten „infiziert" sonst die kommerzielle Lizenzierbarkeit). Solange Markus Alleinautor ist, **kein Handlungsbedarf** — aber **vor dem ersten gemergten Fremd-PR** muss das Modell stehen (CLA-Bot o.ä.). Als Gate gemerkt.

### Dual-License-Ausgestaltung bei konkreter Managed-Tür (+ Rechtsberatung)

**Status:** OFFEN (D5-Territorium, bewusst vertagt) | **Größe L** | **Trigger:** wenn die Managed-Tür konkret wird

**Dual-Licensing** (AGPL frei **+** kommerzielle Lizenz) ist der **Monetarisierungs-Pfad** für die spätere Managed-Tür: wer Nolmi proprietär/closed betreiben will, kauft eine kommerzielle Lizenz statt unter AGPL offenzulegen. **Ausgestaltung erst, wenn die Managed-Tür konkret wird** (Preis, Lizenztext, Vertrieb). Bei echtem Geld: **Fachkundige(r) für Lizenzrecht** hinzuziehen. Vorbedingung: CLA/DCO (Item oben). Hängt an D5 (Managed = eigenes Unternehmen).

**Neue Items aus Phase 3a (für später):**
- **`SESSION_COOKIE_NAME`-Konstante konsolidieren:** heute in `apps/runtime/src/auth/session.ts` (Export) **und** `apps/web/middleware.ts` (Local-Const-Duplikat) gepflegt. Cross-App-Import vom Runtime ins Web ist heute strukturell nicht vorgesehen (Runtime exportiert keine Subpaths). Sauberer Pfad: `@nolmi/shared/auth-cookies` mit beiden Konstanten, beide Apps konsumieren von dort. Aufwand S, nice (Phase 5+).

### 16. Backward-Compat-Aliases entfernen

*(Triage 2c: zeit-vertagt — `TWIN_LAB_*`-Aliases noch in ~7 Dateien (crypto-utils, session, env.ts …), Hart-Cut bewusst 6–12 Monate später.)*
~~Sub-Schritt 2d hat alte Pfade (`/chat`, `/twin-profile`, `/audit`, `/audit/pending`, etc.) als Aliases zu `/twins/@markus/...` umgeleitet. Sollte nach komplettem UI-Refresh-Cycle entfernt werden — sonst dauerhafter Tech-Debt.~~ **✅ Routen-Aliases entfernt (Tag 44, 6904217)** — Security-Fix (unauth Legacy-Aliases, Tenant-Isolations-Audit), −130 Zeilen. Offen bleibt: `TWIN_LAB_*`-ENV-Aliases in ~7 Dateien (crypto-utils, session, env.ts …).
**Größe:** S · **Priorität:** should · **Aus:** Sub-Schritt 2d Caveat #5


---

## A2A-Autonomie (Tag 46)

### A2A Glied 1: owner-angestoßenes autonomes Twin-zu-Twin — ✅ VERIFIZIERT (Tag 46, kein Bau)

Code war komplett. Ablauf live bestätigt auf Prod: Owner approved → @markus formuliert autonom → @florian antwortet autonom (familiarity=vertraut) → Owner sieht Antwort im A2AChat. Kein Bau nötig gewesen.

### A2A Glied 2: mehrstufiger Austausch — Etappe 1+2+3 ✅ AUF PROD (Tag 47, `d14816a → a817c2a`)

**Etappe 1 (verifiziert, b357f6c+e44461d):** Thread-ID-Fundament (a2aThreadId-Propagation) + EINE Folgerunde + Hard-Stop. Live-Smoke: Runde 2 lief autonom, Stop nach 1 Folgerunde hielt.

**Etappe 2 (verifiziert, SS1 `2275b3e` + SS2 `c163ede` + FIX `9ed53f0`):** Grenze 1→5 Folgerunden pro Seite, mit Bremse + Zusammenfassung. Reihenfolge im Loop bewusst **Bremse→Limit→Gas**:
- **Abbruch-Mechanik** (SS1): In-Memory `abortedThreadIds`-Set + `POST /twins/:handle/a2a/abort` (requireOwner + IDOR) + A2AChat-Abbruch-Button + Check vor jeder Folgerunde.
- **Loop** (SS2): `A2A_MAX_FOLLOWUP_ROUNDS` (Default 5, ENV, **Modul-Konstante → Restart-Pflicht**); Zählung pro Seite über `a2aThreadId`.
- **LLM-Zusammenfassung** bei Limit ODER Abbruch: `summarizeA2aThreadOnce` → `a2a-summary`-Audit, dedup (`summarizedThreadIds`, ein Eintrag pro Thread).
- **Abbruch-Fix** (9ed53f0): Button zielte via `.find()` auf den ältesten Eröffner (teils pre-SS1 `tid=null`); jetzt jüngster Thread-Anker `inReplyTo ?? bridgeMessageId`, null/System übersprungen. Empirisch gegen echte DBs: ins Set geschriebene ID == Live-Anker.

**Live-Verifikation Tag 47:** (b) manueller Abbruch greift mid-thread ✅ · (e) Limit-Stop deterministisch via `A2A_MAX_FOLLOWUP_ROUNDS=2` ✅ (a2a-summary erzeugt, Loop gestoppt) · (f) Thread-ID konsistent/distinkt ✅.

**Etappe 3 (Zustellung, `96e1b45` + `4a43128` + `949b823` + `a817c2a`):** A2ACloseSweepService (ENV-gated `A2A_CLOSE_SWEEP_ENABLED`, 60s-Poll, Quiescence 5 min) als einzige Zustellstelle — erkennt verstummte Threads → `summarizeA2aThreadOnce("quiescence")`, liefert via `BotRegistry.sendToOwner` (Telegram) **und** proaktive Direct-Chat-Bubble (`a2a-summary-notice`, assistant-only). Persistenter `deliveredAt`-Marker gegen Doppel-Push; einmaliger stiller Backfill (`a2a-sweep-armed`-Audit als armedAt) → kein rückwirkender Push für Alt-Threads.

✅ **AUF PROD (Tag 47):** deployt `d14816a → a817c2a`, runtime+web neu, Bridge unberührt, keine Migration. Prod-Smoke grün (Chat+Streaming OAuth-Pfad, Autocomplete, A2A autonom mehrrundig — echte Terminverhandlung @markus↔@florian, Abbruch-Button). Sweep aktiv (`[a2a-sweep] started`). 🔴 Prod-ENV: `A2A_CLOSE_SWEEP_ENABLED=true` via Whitelist-Durchreichung in `/docker/nolmi/docker-compose.yml` + VPS-`.env`.

**Offene Folge-Bausteine (eigene spätere Bögen):**
- **Beidseitiger Abbruch:** Abbruch ist heute EINSEITIG — nur der abbrechende Twin stoppt, die Gegenseite antwortet bis zu ihrem eigenen 5er-Limit weiter. Beidseitig braucht ein Bridge-Signal an die Gegenseite.
- ~~Aktive Owner-Benachrichtigung~~ ✅ **ERLEDIGT (Etappe 3):** Telegram-Push (`sendToOwner`) + proaktive Direct-Chat-Bubble, beide live auf Prod.

### ✅ Twin behauptet Aktion ohne Tool-Call bei verbloser Mention — DONE (7ee9bc9, Tag 48, auf Prod)

**Status:** ✅ DONE & deployt (`87b3e83 → 7ee9bc9`, runtime-only) · **War:** 🟡 Zuverlässigkeit/Ehrlichkeit

**Behoben (Weg 3 — ehrlicher Hint, kein Re-Routing):** Bei verbloser @-Mention im Owner-Chat (`respond_to_chat` + Target erkannt + KEIN `SEND_TRIGGERS`-Verb) injiziert `runOwnerDirect` einen weichen `extraSystem`-Hint → der Twin behauptet nicht mehr zu senden, sondern weist auf „Schreib @X: …" hin. Self-Mention ausgenommen; weicher Wortlaut hält Referenz-Fragen auf Kurs. `SEND_TRIGGERS` zu Modul-Konstante extrahiert. Verifiziert: verblos → Hint; Referenz-Frage → normal; mit Verb → send_to_twin via Approval. Bonus: alle 16 send_to_twin-Audits tragen ein Verb → 0 verblose Sends (das eine gemeldete „verbloses Send" war ein Reporting-Artefakt — echter Text trug „Schreib @florian:").

### @-Mention soll autonom senden (Weg 2: Modell-Detektor-Pass) — SS1+SS2 ✅ lokal (Schatten); SS3 OFFEN

**Status:** SS1+SS2 lokal fertig & verifiziert (`95233dc`, `a364ee2`, `a09e879`, Tag 49) · **NICHT deployt, Default=Schatten** · **SS3 (Prod-Schatten + Scharfschaltung) offen** · **Größe Rest:** S–M

**Gebaut (SS1+SS2):** `classifyMentionIntent` (SEND/CHAT via `generateObject` auf `deps.classifierModel`, fail-safe→CHAT, 5s) + Verdrahtung in `chat()` im **Schatten** hinter ENV-Gate `MENTION_AUTOSEND_ENABLED`. Gate: respond_to_chat + @-Target + kein Sende-Verb + nicht Self. Ohne ENV: kein Verhaltens-Change (Weg-3-Hint feuert weiter). Verifiziert: 13/13 (haiku), alle deferred→CHAT, kein falsches SEND; Approval-Gate code-seitig als unumgehbar bewiesen (Sicherheits-Audit, STAND Tag 49). 🔴 Befund: Klassifikator nutzt NIE Codex — eigene Tier (anthropic→haiku, openai→**gpt-4o-mini**).

**🔴 SS3 (eigene Session, vorsichtigster Schritt):** (1) SS2 im **Schatten auf Prod** deployen → echte Prod-Klassifikationen beobachten, v.a. die **gpt-4o-mini-Tier** bei @markus (falls prod-openai — der einzige ungetestete Pfad; via `--twin=@markus` auf Prod oder `[mention-intent]`-Logs). (2) **Erst nach** Beobachtung `MENTION_AUTOSEND_ENABLED=true`. ggf. Timeout/Prompt nachschärfen.

### ✅ Repo- vs. Prod-Compose-Drift konsolidieren (Infra-Hygiene) — DONE (717721c, Tag 48)

**Status:** ✅ DONE (`717721c`, Tag 48) — 11 `${VAR:-}`-Durchreichungs-Zeilen (10 Autonome-Feature-Flags + `BRIDGE_ADMIN_TOKEN`) additiv ins `repo/docker/nolmi/docker-compose.yml` gezogen; Werte bleiben in der VPS-`.env`. **Praktisch bewährt:** beim Tag-48-Deploy war `git status` auf der VPS clean — kein Drift, kein Stash-Manöver. Memory `prod-vps-deploy-mechanik` korrigiert. **Verbleibend (optional):** falls ~10.-Juni-Prod-Tweaks außerhalb der 11 Zeilen existieren, beim nächsten VPS-`diff` prüfen.

<details><summary>Ursprünglicher Befund (historisch)</summary>

**War:** OFFEN (notiert, nicht dringend, aber Deploy-Risiko) · **Größe:** S · **Aus:** Tag-47-Deploy-Befund

**Befund:** `/docker/nolmi/docker-compose.yml` auf der Prod-VPS (srv1712371) ist eine **eigenständige Datei** (zuletzt ~10. Juni editiert), **KEIN Symlink** auf `repo/docker/nolmi/docker-compose.yml` (frühere Annahme war falsch). Beide Dateien sind **auseinandergedriftet** — die Loop-Flags (`FOCUS_LOOP_ENABLED`, `REFLECTION_LOOP_ENABLED`) und das neue `A2A_CLOSE_SWEEP_ENABLED` leben nur in der Prod-Datei + VPS-`.env` und sind **nie eingecheckt**. Wer den Repo-Compose liest, hat ein falsches Bild vom Prod-Zustand.

**Risiko:** Deploys/Diagnosen stolpern über veraltete Annahmen (z.B. „Env-Var im Repo-Compose ⇒ landet auf Prod" — stimmt NICHT). Konkret manifestiert sich das schon: das Whitelist-`environment:`-Muster muss pro neuer Var doppelt gepflegt werden (Repo-Compose + Prod-Compose), sonst läuft ein Feature still tot.

**Fix (später):** Repo- und Prod-Compose konsolidieren bzw. das Prod-Delta (Loop-/Sweep-Flags als `${VAR:-}`-Durchreichung) ins eingecheckte `repo/docker/nolmi/docker-compose.yml` ziehen, sodass der Repo-Stand den Prod-Stand abbildet. **Memory `prod-vps-deploy-mechanik` ist bereits korrigiert** (Symlink-Behauptung entfernt, ENV-Whitelist-Muster + Build-ARG/force-recreate-Sequenz dokumentiert). Verifikation der gemergten Config IMMER via `docker compose config` vor `--force-recreate`.

</details>

---

## Nächste Bögen (Tag 47, sortiert)

### ✅ Twin-Zeitgefühl: aktuelles Datum/Wochentag im Kontext — DONE (ec68aac, Tag 47, auf Prod)

**Status:** ✅ DONE & deployt (`870a38a → ec68aac`, runtime-only) · **Größe war:** S

**Befund (behoben):** Twins kannten Datum/Wochentag nicht → verorteten Termine falsch („schönes Wochenende" am Mittwoch). **Fix:** `composeOwnerSystemPrompt` injiziert einen `## Heute`-Block (de-DE, pro Request, owner-lokale TZ via `OWNER_DISPLAY_TZ`/`QUIET_HOURS_TZ` Default `Europe/Berlin`) — erreicht alle Konversations-Pfade + beide Modell-Pfade (Vercel + Codex). Prod-Smoke: korrektes Datum + Wochentag-Verortung. Autonome Engines bewusst außen vor.

### ✅ Ungelesen-Indikator @florian bleibt trotz Lesen — DONE (87b3e83, Tag 48, auf Prod)

**Status:** ✅ DONE & deployt (`717721c → 87b3e83`, runtime-only) · **War:** echter Bug, nicht Test-Artefakt

**Wurzel (DB-bewiesen):** Merge-Slot-Kollision — `reply-received` + `trusted-bypass` teilen `input.bridgeMessageId`; `mergeAuditIntoBridgeMessages` (DESC-first-wins) gab den `receivedIndex`-Slot dem neueren `trusted-bypass` → Message rendert als trusted-bypass → mark-read-Filter (`=== "reply-received"`) übersprang sie → `read_at` blieb NULL → `countUnreadRepliesByPartner` zählte ewig. Vierfelder-Korrelation 14/0/0/9. **Fix:** `reply-received` bekommt Präzedenz im received-Slot, `trusted-bypass` bleibt Fallback (florian-initiierte Nachrichten haben NUR trusted-bypass). Live: unread 14→0 nach Öffnen, Indikator verschwindet.

### Multimodaler Input: Bilder/Dokumente an Twin senden

**Status:** OFFEN · **Größe:** L (eigenes Feature) · **Aus:** Tag 47

Bilder/Dokumente an den Twin senden — Upload-UI + Speicherung + Weitergabe ans LLM (multimodaler Pfad). Eigener größerer Bogen.

### Telegram: Rich Messages + @-Mention im Telegram-Kanal

**Status:** OFFEN, **Design-Klärung** · **Größe:** S–M · **Aus:** Tag 47

- **Rich Messages:** Umfang zu präzisieren — die A2A-Summary ist bereits Markdown-formatiert (`sendToOwner` → Markdown→HTML). Klären, was darüber hinaus gewünscht ist (Buttons? strukturierte Karten?).
- 🔴 **@-Mention im Telegram-Kanal geht NICHT wie im Web:** Telegram-Bots haben kein freies Eingabefeld-Autocomplete. Möglich nur Inline-Mode oder Button-/Custom-Keyboard. **Design-Klärung nötig**, bevor gebaut wird — das Web-`@-Autocomplete`-Muster (`5b4887b`) ist hier nicht übertragbar.

### Bestehende offene Items (Erinnerung)

Beidseitiger A2A-Abbruch (Bridge-Signal), @-Mention soll autonom senden (Weg 2, Modell-Detektor, oben), multimodaler Input, Telegram Rich-Messages/@-Mention, Twin-Löschung verwaister Bridge-Handles, OAuth-Backlog. (Compose-Drift + Mention-ohne-Verb + Ungelesen-Indikator + Zeitgefühl = ✅ erledigt, Tag 47/48.)

---

## Streaming / Approval / OAuth (Tag 45)

### OAuth-Refresh-Loop: api_key-Twins skippen — ✅ DONE (ff4e2dc, Tag 45)

`findTwinIdsExpiringSoon` per JOIN auf `twin_profiles.auth_mode = 'oauth'` gefiltert. Loop berührt nie api_key-Twins, auch wenn Alt-OAuth-Tokens in der DB liegen. Prod-verifiziert, Audit-Log sauber.

### Tool-Call-Streaming: atomar → live deltas (🟢 niedrig, bewusst zurückgestellt)

**Status:** OFFEN · **Priorität:** nice (Gold-Plating) · **Aus:** Tag 45 Streaming-Bogen

Tool-Calls kommen heute atomar am Ende (fullStream, 892a4b8). Live `tool-input-delta`-Streaming wäre Feinschliff — kein Schmerz, kein Sofort-Druck.

### Approval-Steuerung: requiresApproval per Skill konfigurierbar — ✅ DONE (b95eb5c + d14816a, Tag 46)

Dedizierter `/approval`-Endpoint + klickbarer Toggle in Settings-UI. Prod-verifiziert: auto-Tool läuft ohne Pending, zurückgeschaltet wieder pending. Default unverändert (Server-Default = requires approval).

**Optional offen (nice-to-have, kein Druck):** Server-Sammelschalter (alle Tools eines Servers auf einmal). Die zwei Server-Varianten (`-approval`/ohne) sind jetzt technisch redundant — Aufräumen optional.

---

## Security / Tenant-Isolation

### Tenant-Isolations-Audit (Distribution D4/Etappe 0) — ✅ durchgeführt Tag 44

**Status:** ✅ **DONE — Audit Tag 44, kritischer Leak geschlossen (6904217, runtime-only deployt)**

Read-only Audit aller DB-Zugriffspfade auf Owner-Scope. Befund: `/twins/:handle/*`-API lückenlos (`requireOwner` + IDOR-Checks auf `:auditId`/`:trustId`), alle Tenant-Tabellen `twin_id`/`owner_user_id`-gescoped. 🔴 Kritischer Fund: 7 Legacy-Routen ohne Auth (Daten-Leak + IDOR auf approve/reject) → ersatzlos entfernt. Rest-Befunde: #2 + #3 unten.

### #2 — `GET /onboarding/check-handle` Handle-Enumeration ohne Auth (🟡 Existenz-Leak)

**Status:** OFFEN · **Größe:** XS · **Priorität:** should (vor breiterem Zugang) · **Aus:** Tenant-Isolations-Audit Tag 44

`GET /onboarding/check-handle?handle=@x` gibt `{ available: false }` zurück wenn Handle existiert — ohne Login. Alle registrierten Handles enumerierbar (@markus, @florian, @heiko → available: false). Muster identisch zur #59-Klasse (Existenz-Leak vor Auth). **Optionen:** (a) `getCurrentUser → 401` vorschalten (sauberste Lösung), (b) by-design dokumentieren wenn Onboarding-UX-Entscheidung bewusst ist.

### #3 — `GET /health` gibt twins-Zähler zurück (🟢 niedrig)

**Status:** OFFEN · **Größe:** XS · **Priorität:** nice · **Aus:** Tenant-Isolations-Audit Tag 44

`GET /health` gibt `{ twins: N }` zurück (Anzahl aktiver Twins). Kein Auth, kein unmittelbarer Handlungsbedarf. Fix wenn gewünscht: Zähler aus dem Health-Response entfernen oder hinter Auth stellen.

---

## Privat / Markus-spezifisch

Persönliche/instanz-spezifische Items — **nicht Teil der öffentlichen Roadmap** (BACKLOG wird mit Going Public öffentlich lesbar).

### 61. Bridge-Image hat kein wget/curl für Healthcheck — NEU 3. Mai 2026 nachmittags
`docker compose exec bridge wget ...` schlägt fehl, weil `wget` im node:20-alpine-Image nicht da ist (heute mit Node-Fetch umgangen). Für Healthcheck-Direktiven in `docker-compose.yml` (HEALTHCHECK-Stanza) wäre `wget` oder `curl` praktisch. Lösung: entweder `apk add --no-cache wget` im Runner-Stage (~1 MB Image-Größe), oder Healthcheck via `node -e "fetch(...)"` als CMD im Dockerfile. Letzteres ist sauberer (kein zusätzliches Tool im Production-Image).
**Größe:** S · **Priorität:** nice · **Aus:** #45 Verifikation


### 82. Heikos Persona-Source-File `docs/persona-heiko.md` fehlt
Beim Tag-8-Production-Persona-Sync entdeckt: für @heiko gibt's keine `docs/persona-heiko.md` und keine `docs/persona-heiko-meta.yaml`. `twin:reload @heiko --force` failed mit `persona.md fehlt unter /app/docs/persona-heiko.md`.

Ursache: Heikos Twin wurde via Onboarding-Wizard angelegt, nicht via `twin:bootstrap`-Skript. Wizard schreibt direkt in DB, kein File-Backup im `docs/`-Ordner. Heikos Production-Persona ist 344 chars (Stub aus Wizard).

Lösungs-Optionen:
1. **Persona-File aus DB rückwärts erzeugen** — Reverse-Sync DB → File. Wäre eine Funktion im `twin:reload`-Tool oder ein eigenes `twin:export-persona <handle>`. Out-of-scope #78
2. **Onboarding-Wizard erweitern** — schreibt automatisch File-Backup in `docs/persona-<handle>.md` parallel zum DB-Insert. Strukturell sauberer, aber Wizard-Refactor
3. **Manuell ein File anlegen** — pragmatisch, einmalig. Wenn Heiko seine Persona ohnehin überarbeiten will, ist das jetzt der Anlass

Vote: **3 für jetzt, 2 für später.** Heute kein Druck — Heikos Twin auf Production hat einen funktionierenden Stub, der reicht für die Test-Phase. Wenn er Persona-Updates braucht: einmalig manuell `docs/persona-heiko.md` und `docs/persona-heiko-meta.yaml` anlegen, dann läuft `twin:reload`.

Verwandt mit #78 — beide entstehen aus dem File-zu-DB-Sync-Modell. Onboarding-Wizard-Erweiterung als sauberster Pfad gehört strukturell zur 2.5.3-Phase (Onboarding-Wizard) als Backwash-Item.

**Größe:** S (Variante 1, 3) / M (Variante 2) · **Priorität:** nice · **Aus:** Tag-8-Production-Deploy
