# twin-lab — Stand

**Letztes Update:** 3. Mai 2026, ~18:40

## Aktuell in Arbeit
Nichts. Tag 4 sauber abgeschlossen. Bereit für 2.5.6 (Production-Web-Deployment) 
oder Strategie-Diskussion 2.5.5 (Notifications).

## Heute abgeschlossen (Tag 4)

### Sub-Schritte
- 2.5.4.1 — Owner-Modus + Trusted-Twins + Wartemeldung
- 2.5.4.1.1 — Bridge-Schema-Hotfix für Loop-Bug
- 2.5.4.2 — Reply-Detection + A2A-Konversations-UI
- 2.5.4.3 — Inbox-Page + Settings-Reorganisation + 
  Conversation-Symmetrie + UI-Bug-Fixes

### UX-Iteration
- Briefing #19 — Login-Top-Nav versteckt + Auto-Scroll + 
  Profil-Dropdown
- Briefing #20 — Layout-Refactor: Top-Nav neben Logo, 
  max-w-1200px Container, Switcher-Styling, gelerntes 
  Chat-Pattern (Slack-Style)
- Layout-Fix: ChatLayout fixe Höhe, Sidebar mit 3 Slots, 
  Conversation mit 3 Slots, Messages max-w-3xl

### Plus
- Status-Konsistenz-Fix (owner-direct, owner-direct-send, 
  trusted-bypass von "approved" auf "executed")
- Backlog-Update Items #45-#52
- Backlog-Datei-Rename: BACKLOG-PHASE-2.5.md → BACKLOG.md

### Tag-4-Abend zusätzlich

#### #45 — Bridge-Production-Sync
- Production-Bridge `bridge.twin.harwayexperience.com` neu deployed
- `/docker/twin-lab-bridge/` als Compose-Setup
- Volume `twin-lab-bridge-data` frisch, Schema 001+002
- Drei Twins (Markus, Florian, Heiko) registriert mit neuen API-Tokens
- Tokens in Passwort-Manager

#### #60 — Bridge-Register-Endpoint mit Allowlist-Token
- `BRIDGE_REGISTER_TOKEN`-ENV, fail-closed
- Constant-time-Compare via `timingSafeEqual`
- Production deployed (Commit `b92d774`)

#### #59 — Bridge `/messages/:id/sender` mit Auth + Owner-Scope
- `requireTwinAuth`-preHandler, Format-Check, Owner-Scope, kein Existence-Leak
- `BridgeClient.lookupSender` schickt Token bereits mit, kein Client-Change nötig
- Lokal verifiziert (sechs Curl-Cases plus E2E Reply-Detection)
- Production deployed (Commit `7662dad`), sechs Cases gegen 
  `bridge.twin.harwayexperience.com` grün

#### #63 — CLI-Tool `twin:set-api-key` für API-Key-Rotation
- Auslöser: Anthropic-API-Key rotiert, Settings-UI hat kein Edit-Feld
- Master-Key-Check vor Prompt, masked Stdin, Provider-Validation, 
  AES-256-GCM-Verschlüsselung, DB-Update via TwinProfilesRepo
- Drei lokale Twins erfolgreich auf neuen Key umgestellt (Commit `8783d97`)

### Commits Tag 4
- f67a7a0 — Trust + Reply-Detection + Inbox
- 023906b — Backlog-Update
- c9a9c61 — Datei-Rename
- 445d1a3 — UX-Iteration
- b92d774 — #60 Register-Token
- 7662dad — #59 Sender-Endpoint Auth
- 8783d97 — #63 set-api-key CLI

## Phase 2.5 Status
- 2.5.1 ✅ AI SDK Migration
- 2.5.2a-d ✅ Schema, Multi-Twin Runtime, Florian-Twin
- 2.5.2e ✅ Per-Twin LLM-Config
- 2.5.3 ✅ Onboarding-Wizard
- 2.5.4 ✅ User-Auth + Trust + A2A-UI + UX-Polish
- #45 ✅ Bridge-Production-Sync (Vorbedingung 2.5.6)
- #60 ✅ Bridge-Register-Endpoint abgesichert
- #59 ✅ Bridge-Sender-Endpoint abgesichert (letzte Vorbedingung 2.5.6)
- #63 ✅ CLI-Tool für API-Key-Rotation
- 2.5.5 offen (Notifications) — verschoben nach 2.5.6
- 2.5.6 offen (Production Web Deployment) — als nächstes

## Was als nächstes ansteht
1. 2.5.6 — Production-Web-Deployment auf `app.twin.harwayexperience.com`
   (eigenes Chat-Fenster, Sub-Schritt-Lesson aus 2.5.4.x)
2. Vor 2.5.6 lösen: #64 VPS-Git-Auth via Deploy-Key oder PAT statt Password
3. Closed-Beta-Ansatz: kein öffentliches Marketing, Onboarding-URL 
   selektiv teilen
4. 2.5.5 (Notifications) erst, wenn Schmerzen sichtbar werden — 
   Inbox-Badge plus drei Power-User vorm Browser reicht heute

## Lokal
/Users/mjb/Visual Studio/twin-lab — drei Twins (markus, 
florian, heiko), lokale Bridge auf 5100, lokale Twin-Profile 
zeigen weiterhin auf `localhost:5100` (kein Switch in #45)

API-Keys aller drei Twins heute auf neuen Anthropic-Key gerollt.

## Production-Bridge
- Live unter `https://bridge.twin.harwayexperience.com`
- `/docker/twin-lab-bridge/` auf VPS srv1046432
- Schema: 001 + 002 (message_type drin)
- Drei Twins registriert mit neuen Tokens (Mai 3)
- Container `twin-lab-bridge` mit `restart: unless-stopped`
- Volume `twin-lab-bridge-data`
- Register-Endpoint geschützt via `BRIDGE_REGISTER_TOKEN` (#60)
- Sender-Endpoint geschützt via `requireTwinAuth` + Owner-Scope (#59)

## Drei User
- Owner: @markus (Owner-Modus aktiv)
- Owner: @florian (Owner-Modus aktiv)
- Owner: @heiko (Owner-Modus aktiv)

Alle drei mit anthropic/claude-opus-4-7, lokale Bridge.

## Repo
github.com/markusbaier/twin-lab
