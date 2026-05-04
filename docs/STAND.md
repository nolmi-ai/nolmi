# twin-lab — Stand

**Letztes Update:** 4. Mai 2026, ~14:00

## Aktuell in Arbeit
Nichts. #64 (Deploy-Key-Setup auf VPS) abgeschlossen. Bereit für 2.5.6 
(Production-Web-Deployment) — alle Vorbedingungen erfüllt.

## Heute (Tag 5) abgeschlossen

### #64 — VPS-Git-Auth via Deploy-Key
- ED25519-Deploy-Key auf VPS srv1046432 generiert (`~/.ssh/twin-lab-deploy`)
- Public-Key bei GitHub als Repo-Deploy-Key hinterlegt (read-only, 
  `Allow write access` nicht angekreuzt)
- SSH-Config-Section mit `Host github.com-twin-lab`-Alias plus 
  `IdentitiesOnly yes`
- Bridge-Repo `/docker/twin-lab-bridge/repo/` umgestellt auf 
  `git@github.com-twin-lab:markusbaier/twin-lab.git`
- Verifikation: `git fetch` und `git pull` ohne Password-Prompt durch
- Deploy-Key wird auch für Web-App-Repo in 2.5.6 wiederverwendet 
  (Monorepo, ein Key reicht)

## Phase 2.5 Status
- 2.5.1 ✅ AI SDK Migration
- 2.5.2a-d ✅ Schema, Multi-Twin Runtime, Florian-Twin
- 2.5.2e ✅ Per-Twin LLM-Config
- 2.5.3 ✅ Onboarding-Wizard
- 2.5.4 ✅ User-Auth + Trust + A2A-UI + UX-Polish
- #45 ✅ Bridge-Production-Sync
- #60 ✅ Bridge-Register-Endpoint abgesichert
- #59 ✅ Bridge-Sender-Endpoint abgesichert
- #63 ✅ CLI-Tool für API-Key-Rotation
- #64 ✅ VPS-Git-Auth via Deploy-Key (Tag 5)
- 2.5.5 offen (Notifications) — verschoben nach 2.5.6
- 2.5.6 offen (Production Web Deployment) — als nächstes

## Was als nächstes ansteht
1. **2.5.6 — Production-Web-Deployment** auf `app.twin.harwayexperience.com`
   - eigenes Chat-Fenster (Sub-Schritt-Lesson aus 2.5.4.x)
   - alle Vorbedingungen erfüllt
   - Web-App-Repo-Klon nutzt Deploy-Key aus #64
2. v2.1 Sparring mit Florian — wenn Termin sich findet
3. 2.5.5 (Notifications) bleibt verschoben, bis Schmerzen sichtbar werden — 
   Inbox-Badge plus drei Power-User vorm Browser reicht heute

## Gestern abgeschlossen (Tag 4)

### Sub-Schritte
- 2.5.4.1 — Owner-Modus + Trusted-Twins + Wartemeldung
- 2.5.4.1.1 — Bridge-Schema-Hotfix für Loop-Bug
- 2.5.4.2 — Reply-Detection + A2A-Konversations-UI
- 2.5.4.3 — Inbox-Page + Settings-Reorganisation + 
  Conversation-Symmetrie + UI-Bug-Fixes

### UX-Iteration
- Briefing #19 — Login-Top-Nav versteckt + Auto-Scroll + Profil-Dropdown
- Briefing #20 — Layout-Refactor: Top-Nav neben Logo, max-w-1200px 
  Container, Switcher-Styling, Slack-Style-Chat-Pattern

### Tag-4-Abend
- #45 Bridge-Production-Sync (Bridge live unter 
  `bridge.twin.harwayexperience.com`, drei Twins, neue Tokens)
- #60 Bridge-Register-Endpoint mit Allowlist-Token (Commit `b92d774`)
- #59 Bridge-Sender-Endpoint Auth + Owner-Scope (Commit `7662dad`, 
  Production verifiziert)
- #63 CLI-Tool `twin:set-api-key` für API-Key-Rotation 
  (Commit `8783d97`, drei Twins auf neuen Key gerollt)

### Plus
- v2.1-Diskussionspapier (HARWAY-Twin-v2.1-Diskussionspapier.pdf)
- Doku-Commit `8db175b` (STAND + BACKLOG nach Tag 4 abend)

## Lokal
`/Users/mjb/Visual Studio/twin-lab` — drei Twins (markus, florian, heiko), 
lokale Bridge auf 5100, lokale Twin-Profile zeigen weiterhin auf 
`localhost:5100`. API-Keys aller drei Twins auf neuen Anthropic-Key 
gerollt (Tag 4).

## Production-Bridge
- Live unter `https://bridge.twin.harwayexperience.com`
- `/docker/twin-lab-bridge/` auf VPS srv1046432
- Schema: 001 + 002 (message_type drin)
- Drei Twins registriert mit neuen Tokens (Mai 3)
- Container `twin-lab-bridge` mit `restart: unless-stopped`
- Volume `twin-lab-bridge-data`
- Register-Endpoint geschützt via `BRIDGE_REGISTER_TOKEN` (#60)
- Sender-Endpoint geschützt via `requireTwinAuth` + Owner-Scope (#59)
- VPS-Git-Pull via Deploy-Key (#64), kein Password mehr nötig

## Drei User
- Owner: @markus (Owner-Modus aktiv)
- Owner: @florian (Owner-Modus aktiv)
- Owner: @heiko (Owner-Modus aktiv)

Alle drei mit anthropic/claude-opus-4-7, lokale Bridge.

## Repo
github.com/markusbaier/twin-lab
