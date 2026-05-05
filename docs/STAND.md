# twin-lab — Stand

**Letztes Update:** 5. Mai 2026, ~20:00

## Aktuell in Arbeit
Nichts. Polish-Sprint Tag 6 abgeschlossen — drei kleine Items aus
2.5.6-Backwash gemacht (#15, #43, #71). Phase 2.5 inhaltlich komplett
durch, Production-Stack stabil seit gestern.

## Heute (Tag 6) abgeschlossen

### #15 — Footer-Text via ENV (vormittags, ~20 Min)
- `apps/web/components/AppFooter.tsx`: hartcodiertes „phase 2.5"
  entfernt, „läuft lokal" durch ENV-getriebene Konstante
  `DEPLOYMENT_LABEL` ersetzt (Pattern analog zu `RUNTIME_URL` in
  `FooterMeta.tsx`)
- Neue ENV-Variable `NEXT_PUBLIC_DEPLOYMENT_LABEL` mit Default
  „läuft lokal", Production-Wert „production"
- `apps/web/Dockerfile`: ARG/ENV-Block erweitert (analog zu
  NEXT_PUBLIC_RUNTIME_URL aus 2.5.6.A.4)
- `docker/twin-lab-web/.env.example` + `README.md`: Build-Aufruf um
  zweiten `--build-arg` ergänzt
- `.env.example` (Workspace-Root): auskommentierter Hinweis
- Lokal verifiziert: Footer zeigt „X Twins aktiv · läuft lokal"
- Commit `5ed4365`

### #43 — Top-Nav auf /login + /onboarding versteckt (Reality-Check, 0 Min Code)
- Backlog-Item beim Reality-Check als bereits erledigt erkannt:
  `apps/web/components/AppHeader.tsx` returnt seit Briefing #19
  (Tag 4 UX-Iteration, Commit `445d1a3`) `null` für Routes mit
  `/login`- oder `/onboarding`-Prefix via `PUBLIC_PREFIXES`-Array
  und `usePathname`-Check
- Footer rendert weiterhin auf Public-Routes — Twin-Count fällt
  graceful auf „multi-twin"-Fallback zurück bei 401
- Verifizierung im Browser: `/login` zeigt nur Brand + Login-Form +
  Footer, keine Tabs, kein TwinSwitcher, kein ProfileMenu
- Lesson: Reality-Check vor Briefing-Schreibung lohnt sich. Drei
  Tage zwischen Item-Entstehung und heutigem Tag, in der Zwischen-
  zeit war's nebenbei gefixt — als ✅ markieren reicht

### #71 — Direct-Chat-History persistent über Tab-Switches (~90 Min, zwei Commits)
- **`9a6cff9`**: erste Implementation
  - `apps/web/app/chat/[handle]/page.tsx`, `DirectChat`-Komponente
    erweitert um `useEffect([handle])` der `/twins/:handle/audit?limit=50`
    fetcht, filtert auf `capability === "respond_to_chat" && status === "executed"`,
    chronologisch (DESC → ASC) sortiert und auf User+Assistant-
    Pärchen via `input.lastMessage` + `output.reply` mappt
  - Spec-Deviation gegenüber Briefing: `input.lastMessage` statt
    `input.messages[0].content`. Begründung von Claude Code:
    `input.messages` ist kumulativ, `[0]` wäre N-mal die Erst-
    Message. `lastMessage` liefert pro Turn die richtige User-
    Message. Saubere Korrektur, im Briefing übernommen.
  - cancelled-Flag-Pattern für Race-Conditions, silent fail bei 401
- **`f80558f`**: Filter-Fix nach Live-Test
  - Erste Test-Sends im Browser zeigten: History laden funktioniert,
    aber Owner-Direct-Audits (Capability `owner-direct`, geschrieben
    durch Owner-Bypass-Pfad in 2.5.4.1) waren unsichtbar
  - Verifiziert via DB-Query: 4 Owner-Direct-Audits seit 4. Mai,
    ungesehen in der UI
  - Schema identisch zu `respond_to_chat` (`input.lastMessage` +
    `output.reply`), plus zusätzlich `input.originalCapability`
    als Markierung
  - Filter erweitert auf `Set` mit beiden Capabilities:
    `DIRECT_CHAT_CAPABILITIES = new Set(["respond_to_chat", "owner-direct"])`
- Lokal verifiziert: alle Pärchen sichtbar, Tab-Switch behält History,
  neue Sends erscheinen sofort und nach Mount-Reload via Audit
- Backlog-Item ✅, plus neue Items #71b (kumulative History in Audits
  als Speicher-Problem) und #71c (Hydration-Error-Phantom) entstanden

### Hydration-Error war Stale-Bundle-Phantom
- Während #71-Test sichtbarer Hydration-Error auf Footer-Element
- Diagnose-Sequenz: git log auf AppFooter.tsx, Vor-#15-Stand
  ausgecheckt, Browser-Test → Fehler weg, #15-Stand zurück, Hard-
  Reload → Fehler auch weg
- Diagnose-Schluss: `next dev` Hot-Reload hat bei ENV-Variable-
  Update das Bundle nicht sauber neu generiert. Nach Hard-Reload
  Konsole sauber, Footer rendert korrekt
- Kein echter Bug, aber 15-Min-Diagnose-Zeit kostete uns. Lesson:
  bei ENV-Var-Änderungen lokal immer Hard-Reload, nicht auf Hot-
  Reload vertrauen

## Phase 2.5 Status (unverändert seit gestern)
- 2.5.1 ✅ AI SDK Migration
- 2.5.2a-d ✅ Schema, Multi-Twin Runtime, Florian-Twin
- 2.5.2e ✅ Per-Twin LLM-Config
- 2.5.3 ✅ Onboarding-Wizard
- 2.5.4 ✅ User-Auth + Trust + A2A-UI + UX-Polish
- #45 ✅ Bridge-Production-Sync
- #60 ✅ Bridge-Register-Endpoint abgesichert
- #59 ✅ Bridge-Sender-Endpoint abgesichert
- #63 ✅ CLI-Tool für API-Key-Rotation
- #64 ✅ VPS-Git-Auth via Deploy-Key
- 2.5.6 ✅ Production-Web-Deployment
- 2.5.5 offen (Notifications) — verschoben, kein akuter Schmerz

Plus heute aus Polish-Sprint:
- #15 ✅ Footer-Text via ENV
- #43 ✅ Top-Nav auf /login + /onboarding versteckt (war bereits erledigt)
- #71 ✅ Direct-Chat-History persistent

## Was als nächstes ansteht
1. **Pause oder weiteres Polish.** Heute drei Items in zwei Stunden,
   Production läuft stabil, kein Druck.
2. **#71b (kumulative Audit-Messages)** als Backlog-Item dokumentiert,
   Backend-Change im Twin-Service nötig — eigener Sub-Schritt mit
   DB-Migration-Frage. Nicht akut.
3. **#65 Reverse-Proxy-Architektur** für saubereren Cross-Subdomain-
   Setup. L-Größe, ruhiger Tag.
4. **Phase 3 starten** — Memory + Skills + MCP-Client. Großer
   strategischer Block, braucht eigene Planungs-Session vor dem
   ersten Sub-Schritt.

## Production-Stack — live (unverändert)
- **`https://app.twin.harwayexperience.com`** — Web (Next.js Standalone)
- **`https://runtime.twin.harwayexperience.com`** — Runtime (Fastify,
  drei Twins hot-geladen)
- **`https://bridge.twin.harwayexperience.com`** — Bridge (vom 3. Mai,
  drei Twins registriert)

Alle drei mit `restart: unless-stopped`, HTTPS via Let's Encrypt,
Traefik-Routing.

Hinweis: heutige Footer-Änderung (#15) noch nicht in Production
deployed. Nach Pull + Rebuild mit beiden `--build-args` würde
Production „X Twins aktiv · production" zeigen statt aktuell „läuft
lokal". Kein Druck — Pull machen wir beim nächsten regulären
Production-Deploy mit.

## Lokal
`/Users/mjb/Visual Studio/twin-lab` — drei Twins (markus, florian,
heiko), lokale Bridge auf 5100. Lokale Twin-Profile zeigen weiterhin
auf `localhost:5100`. API-Keys aller drei Twins auf neuen
Anthropic-Key gerollt (Tag 4). Production-Twins haben eigene Profile,
eigene Tokens, eigene API-Keys — komplett getrennt von Lokal.

## Drei User auf Production
- Owner: @markus (markus.baier@harway.de)
- Owner: @florian (florian.ristig@harway.de)
- Owner: @heiko (heiko.gregor@harway.de)

Alle drei mit anthropic/claude-opus-4-7, Production-Bridge.

## Repo
github.com/markusbaier/twin-lab — origin/main aktuell auf `f80558f`
(stand von heute Mittag, drei Polish-Commits).
