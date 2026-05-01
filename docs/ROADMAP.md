# twin-lab Roadmap

Stand: 1. Mai 2026, nach Sub-Schritt 2.5.2d (Multi-Twin Runtime + Florian-Twin)

---

## Wo wir stehen

**Phase 1 — Closed Twin** ✅
Markus-Twin antwortet im Persona-Stil, Mandates aktiv, Audit-Log, Pending-Workflow.

**Phase 2 — A2A Bridge** ✅
Bridge-Service eigenständig, Twin-zu-Twin-Kommunikation läuft, Konversations-Threading, VPS-Deployment unter `bridge.twin.harwayexperience.com` mit HTTPS.

**Phase 2.5 — Multi-Tenant-Vorbereitung** (in Arbeit)
- 2.5.1 Vercel AI SDK Migration ✅
- 2.5.2b Schema (twin_profiles) ✅
- 2.5.2c Twin-Runtime DB-Backed ✅
- 2.5.2γ Profil-Anzeige in Settings ✅
- 2.5.2d Multi-Twin Runtime + Florian-Twin ✅ (heute Abend)
- 2.5.2e Per-Twin LLM-Config — als nächstes
- 2.5.3 Onboarding-Wizard
- 2.5.4 User-Auth
- 2.5.5 Notifications
- 2.5.6 Production-Deployment Web

**Was live ist:** Bridge auf VPS, Multi-Twin-Runtime lokal, A2A-Loop verifiziert mit zwei eigenständigen Personas.

---

## Phase 2.5 — Restliche Sub-Schritte

### 2.5.2e — Per-Twin LLM-Config aus DB
**Größe:** S · **Zeitfenster:** 1 Session (~1-2h)

Beide Twins erben aktuell `TWIN_LLM_*`-ENV. Sollten pro Twin separat konfigurierbar sein. Bootstrap-Script liest pro Twin individuelle ENV (`MARKUS_LLM_PROVIDER`, `FLORIAN_LLM_MODEL`, etc.), Default-Fallback auf gemeinsame `TWIN_LLM_*`. Schreibt LLM-Config in `twin_profiles.llm_config`-JSON, von wo Runtime liest.

**Warum jetzt:** Aufwärm-Übung nach Multi-Twin. Macht den Boden für 2.5.3 (Onboarding-Wizard) bereit, wo User pro Twin eigene LLM-Provider auswählen.

### 2.5.3 — Onboarding-Flow Web-UI Wizard
**Größe:** L · **Zeitfenster:** 2-3 Sessions (~6-10h)

Neuer User soll Twin selbst bootstrappen — ohne Terminal. Web-UI-Wizard mit:
- Persona-Markdown-Editor (mit Live-Preview)
- Mandate-Picker mit Templates (Starter-Set für typische Use-Cases)
- LLM-Provider/Modell-Auswahl
- API-Key-Eingabe (verschlüsselt in DB)
- Bridge wird automatisch zugewiesen (zentrale Bridge gibt Token aus)

**Warum jetzt:** Erste echte Nicht-Markus-Erfahrung. Bevor wir Auth bauen, müssen wir wissen, wie Onboarding aussieht — die User-Experience-Frage zuerst.

### 2.5.4 — User-Auth (Email/Passwort)
**Größe:** L · **Zeitfenster:** 2-3 Sessions (~6-10h)

Heute: kein Auth-Layer. Phase 2.5.4:
- `users`-Tabelle mit `email`, `password_hash`, `created_at`
- Login-Form, Session-Cookie
- `owner_user_id` in `twin_profiles` wird belegt
- Twin-UI nur für Owner sichtbar (oder für explicit-shared Users)
- Owner-Recognition im System-Prompt (Backlog #14 wird hier gefixt)

**Warum jetzt:** Vorbedingung für Public-Deployment. Sub-Schritt 2.5.6 braucht Auth, sonst sieht jeder mit der URL alle Twins.

**Optional in 2.5.4 oder später:** SSO (Google, GitHub) — entscheiden wenn wir an dem Punkt sind.

### 2.5.5 — Notification-System für Pending
**Größe:** M · **Zeitfenster:** 1-2 Sessions (~4-6h)

Heute: Pending nur sichtbar wenn Settings-Page offen.
- Browser-Notifications (Web Push API)
- Email-Notifications via resend.com (Konto schon vorhanden)
- Konfigurierbar pro Twin: welche Events triggern Notifications
- Optional: SMS/Telegram (gehört aber eher zu Phase 4 Multi-Channel)

**Warum jetzt:** UX-Lücke wird mit jedem Tag schmerzhafter, je mehr Twins laufen. Plus: ohne Notifications hat keiner Anreiz, das Tool aktiv zu nutzen.

### 2.5.6 — Production-Deployment Web auf VPS
**Größe:** L · **Zeitfenster:** 1-2 Sessions (~4-6h)

Web-UI deploy unter `app.twin.harwayexperience.com`:
- Next.js Production-Build
- Docker-Container, analog zur Bridge
- Traefik routet `app.*` auf den Container
- HTTPS via existierendem Let's Encrypt-Setup
- DB-Persistenz via Volume-Mount
- ENV-Variablen für API-URLs (Bridge, etc.)

**Warum als Letztes in 2.5:** Erst wenn Onboarding + Auth + Notifications stehen, macht ein Public-Deployment Sinn. Vorher ist's nur ein Twin-Lab für Markus, das niemand sonst sieht.

---

## Phase 2.5 Total

**Zeitfenster:** ~7-15 Stunden Arbeit auf 6-10 Sessions verteilt.
**Realistisch:** 2-3 Wochen, je nach verfügbarer Zeit.
**Definition of Done für Phase 2.5:** Externer User kann sich registrieren, eigenen Twin onboarden, mit dem Twin chatten, Pending approven, Twin verleihen. Multi-Tenant-SaaS funktional.

---

## Phase 3 — Memory + Skills + Tools

Macht Twins inhaltlich tiefer. Vor Phase 4 (Multi-Channel).

### 3.1 — MCP-Client-Implementierung
Twin als MCP-Client, kann Tools von externen MCP-Servern nutzen. Standard-Compliance.
**Größe:** L · **Zeitfenster:** 1-2 Wochen

### 3.2 — Skill-System (4-Layer)
Capability → Tool → Skill → Mandate. Skill-Engine mit Markdown-basierten Skills, agentskills.io-Format-kompatibel.
**Größe:** XL · **Zeitfenster:** 2-3 Wochen

### 3.3 — Memory-Schichten
- Conversation Memory (komprimierter Sliding-Window-Kontext)
- Episodic Memory (sqlite-vec für Embeddings)
- Semantic Memory (`facts.md` + KV-Store)
- Procedural Memory (Lerngedächtnis aus Approves/Rejects/Edits)

**Größe:** XL · **Zeitfenster:** 3-4 Wochen

### 3.4 — Hyperbrowser als Web-Browser-Skill
Cloud-Browser-Infrastruktur. Twins navigieren autonom im Web. Vorbedingung: 3.2 (Skill-System).
**Größe:** L · **Zeitfenster:** 1 Woche

---

## Phase 3 Total

**Zeitfenster:** ~7-10 Wochen, je nach Tiefe.
**Realistisch:** 2-3 Monate.
**Definition of Done für Phase 3:** Twin merkt sich Konversationen, kennt Fakten, lernt aus Feedback, kann externe Tools nutzen, navigiert das Web mit Approval-Gates.

---

## Phase 4 — Multi-Channel + Föderation

Twins werden überall erreichbar.

### 4.1 — Telegram-Adapter (Owner-Mode)
Markus chattet mit Markus-Twin via Telegram. Bot-API, einfachste Channel-Integration.
**Zeitfenster:** ~1 Woche

### 4.2 — WhatsApp-Adapter (Owner-Mode)
WhatsApp-Business-API. Meta-KYC-Bürokratie kostet Wochen.
**Zeitfenster:** 2-3 Wochen inkl. Wartezeit

### 4.3 — Public-Mode (Externe schreiben Twins an)
Mandate-Layer für eingehende Nachrichten von Externen. DSGVO-Erwägungen.
**Zeitfenster:** 2-3 Wochen

### 4.4 — Föderation (mehrere Bridges)
Matrix-Modell. Twin auf Bridge-A spricht mit Twin auf Bridge-B.
**Zeitfenster:** 1-2 Monate

---

## Phase 4 Total

**Zeitfenster:** ~3-4 Monate, je nach Bürokratie und Tiefe.

---

## Phase 5+ — Vision

P2P mit DIDs, optional Blockchain als Bezahlebene. Nicht jetzt planen — wenn die ersten 4 Phasen stehen, schauen wir.

---

## Zusammenfassende Timeline

Bei realistischem Tempo (2-3 Sessions pro Woche, je 2-4h):

| Phase | Zeitfenster | Kalenderzeit |
|-------|-------------|--------------|
| 2.5 (Rest) | 7-15h | 2-3 Wochen |
| 3 (Memory + Skills + Tools) | 7-10 Wochen | 2-3 Monate |
| 4 (Multi-Channel) | 3-4 Monate | 4-5 Monate |

**Bis Ende August 2026:** Phase 2.5 + Phase 3 abgeschlossen.
**Bis Ende 2026:** Phase 4 weitgehend fertig.

---

## Was als Nächstes konkret kommt

**Nächste Session:**
1. Sub-Schritt 2.5.2e starten (Per-Twin LLM-Config)
2. Strategie-Diskussion: Onboarding-Flow visuell skizzieren (vor Implementierung 2.5.3)

**Vor der nächsten Session:**
- Markus überlegt: wie viel Zeit pro Woche realistisch für twin-lab?
- Markus überlegt: welche User soll der Onboarding-Flow als erstes ansprechen? (Florian? Ronja? Workshop-Teilnehmer 7. Mai?)

**Was als Hintergrund läuft:**
- Backlog-Items in der Reihenfolge their Priorität abarbeiten
- Architektur-Entscheidungen aus 1.5. weiter verfeinern, wenn relevant

---

## Stop-Punkt-Definition

Phase 2.5 ist abgeschlossen, wenn:
- [x] Multi-Twin-Runtime live (heute)
- [ ] Per-Twin LLM-Config (2.5.2e)
- [ ] Onboarding-Wizard funktional (2.5.3)
- [ ] User-Auth eingebaut (2.5.4)
- [ ] Notification-System läuft (2.5.5)
- [ ] Web-UI auf `app.twin.harwayexperience.com` deployed (2.5.6)
- [ ] Florian kann sich selbst registrieren und seinen eigenen Twin bauen (Live-Test)

Wenn alle Häkchen sitzen: Phase 2.5 done. Pause für Reflexion. Dann Phase 3 starten.
