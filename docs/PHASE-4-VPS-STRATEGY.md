# PHASE 4 — Nolmi-VPS Production-Deploy

**Stand:** Setzungen gelockt Tag 31 (29. Mai 2026, Freitag). **Status:** Bau-Vorlage — noch **nicht** deployed, kein Code-Touch, kein Cut-Over erfolgt.

**Master-Doku:** [`docs/REBRAND-NOLMI-STRATEGY.md`](./REBRAND-NOLMI-STRATEGY.md) (§3 Phase 4 + §9 Operative Foundation), [`docs/DEPLOYMENT.md`](./DEPLOYMENT.md) §9-Cookbook (First-Time-Setup-Sequenz).

Diese Doku ist **Strategie-Setzung + Bau-Vorlage** für den Production-Deploy von Nolmi auf einen eigenen Hostinger-VPS. Sie schließt die Rebrand-Pipeline (Phase 1–3b ✅ live im Repo) ab, indem sie den Stack physisch auf neue Infrastruktur + neue Domain bringt. Konkrete Sub-Block-Briefings entstehen pro Bau-Block (§8).

---

## 0. Kontext

**Greenfield-VPS** `187.124.3.235` (Hostinger, Frankfurt, Ubuntu 24.04 LTS), provisioniert + leer Tag 30/31. Läuft **parallel** zum bestehenden Production-Stack:

| | Bestand (alt) | Nolmi (neu) |
|---|---|---|
| VPS | `srv1046432` / `31.97.78.73` | `187.124.3.235` |
| Domain | `twin.harwayexperience.com` | `nolmi.ai` |
| Stack | runtime + web + bridge (live, 3 Twins) | leer (Phase-4-Setup) |
| Status | Production, Hot | provisioniert, DNS grün |

Phase 4 ist **Neu-Aufsetz** nach dem `DEPLOYMENT.md` §9-Cookbook (First-Time-Setup) **plus** DB-Migration vom alten VPS **plus** Cut-Over auf `nolmi.ai` — **kein** In-Place-Rebrand des laufenden Stacks (ADR aus Rebrand-Strategy §1).

**DNS bereits grün** (Tag 30/31, Strategy-Doc §9): 5 A-Records → `187.124.3.235` — `nolmi.ai`, `app.nolmi.ai`, `runtime.nolmi.ai`, `bridge.nolmi.ai`, `docs.nolmi.ai`. ACME-Challenge ist damit auf der neuen Maschine möglich, ohne dass am alten Stack etwas berührt wird.

---

## 1. Zwei Bedingungen (Constraints, keine Wahl)

Zwei Eigenschaften des Bestands-Setups sind **harte Randbedingungen** für jeden Migrations-Plan — sie sind keine Setzungs-Optionen, sondern Tatsachen, an denen sich die Setzungen in §2 ausrichten.

### Bedingung A — Encryption-Key-Kontinuität

`NOLMI_ENCRYPTION_KEY` (aliased von `TWIN_LAB_ENCRYPTION_KEY`, siehe Rebrand §3a) verschlüsselt mit **AES-256-GCM** zwei Klassen von Secrets in der Runtime-DB (`twin.db`):

1. **Per-Twin-API-Keys** (`apiKeyEncrypted` pro Twin-Provider-Config)
2. **OAuth-Tokens** (u.a. @markus' Codex-Subscription-OAuth-Token aus #131)

→ Bei der DB-Migration **MUSS derselbe Encryption-Key** vom alten VPS auf den neuen übernommen werden. Wird ein neuer Key generiert, sind **alle** verschlüsselten Secrets in der migrierten DB unbrauchbar (GCM-Auth-Tag schlägt fehl) — die Twins hätten keine API-Keys mehr, @markus' OAuth-Token wäre tot.

**Falle:** Das `DEPLOYMENT.md` §9.4-Cookbook generiert beim Setup einen **frischen** Encryption-Key. Das gilt **nur für Fresh-Start** — hier explizit **nicht** befolgen, sondern den Bestands-Key übernehmen (siehe S3).

### Bedingung B — Bridge-Lokation ↔ srv1046432-Abschaltung gekoppelt

Die 3 Twins (`@markus`, `@florian`, `@heiko`) sind an `bridge.twin.harwayexperience.com` registriert — diese Bridge läuft **heute auf `srv1046432`** und hält eigenen SQLite-State (Handle→Token→Routing). Solange die Twins gegen diese Bridge laufen, ist der alte VPS **lebensnotwendig** — er kann nicht abgeschaltet werden, ohne die A2A-Konnektivität zu kappen.

→ Konsequenz: **Die Bridge zieht mit auf den neuen VPS.** Eine Abschaltung von `srv1046432` ist erst möglich, nachdem die Twins gegen eine Nolmi-Bridge (`bridge.nolmi.ai`) laufen. Bedingung B koppelt damit den Bridge-Block (S2) direkt an das Abschaltungs-Item (S7).

---

## 2. Setzungen (7)

### S1 — DB-Migration vs. Fresh-Start → **MIGRATION**

Die 3 echten Twins tragen realen State: Memory (episodisch + semantisch), Facts, Conversations, Audit-Log, OAuth-Tokens, MCP-Server-Configs, Telegram-Pairings. **„Memory-Tiefe" ist die USP** (Differenzierungs-Story, Rebrand §6) — ein Fresh-Start würde genau das Produktversprechen wegwerfen.

**Technik:** voller Volume-Tarball nach `DEPLOYMENT.md` §8.3 (Backup) + Restore §8.5. Zwei DBs theoretisch betroffen (Runtime `twin.db` + Bridge-DB) — die Bridge-DB-Behandlung ist in S2 separat entschieden (Pre-Flight-abhängig, §4).

### S2 — Container-Layout → **VOLLER STACK** (runtime + web + bridge) unter `/docker/nolmi/`

Begründung:
- **Löst Bedingung B** — eigene Bridge auf `bridge.nolmi.ai`, die Twins hängen nicht mehr an einer HARWAY-Subdomain.
- **Souveräne Plattform** — Nolmi hängt an keiner Fremd-Domain mehr; `bridge.nolmi.ai` ist DNS-grün (§0).
- **Greenfield = direkt richtig anlegen** — kein `docker/twin-lab-web/` → `docker/nolmi/`-Rename nötig (siehe §3); das neue Verzeichnis wird sauber als `/docker/nolmi/` angelegt, Container-Namen `nolmi-runtime` / `nolmi-web` / `nolmi-bridge`.

**Bridge-State-Entscheidung:** Runtime-`twin.db` **migrieren** (wertvoll, S1). Die 3 Twins gegen die **frische** Nolmi-Bridge **NEU REGISTRIEREN** (billig, spart Bridge-DB-Migration). A2A-In-Transit-History geht dabei verloren — vermutlich wertlos gegenüber den Runtime-seitigen Audit-/Conversation-Records, die ohnehin migriert werden. **ABHÄNGIG VON PRE-FLIGHT §4** — die Annahme „Bridge-DB hält nichts Unersetzliches außer Routing" wird vor dem Bridge-Block verifiziert, nicht angenommen.

### S3 — Secrets → **`.env`-File auf VPS** (wie Bestand), kein Vault

| Secret | Behandlung |
|---|---|
| `NOLMI_ENCRYPTION_KEY` | **ÜBERNEHMEN** vom alten VPS (Bedingung A) — nicht regenerieren |
| `NOLMI_SESSION_SECRET` | **NEU** — Cookie-Domain wechselt zu `.nolmi.ai`, alte Sessions sind eh tot |
| Bridge-Register-Token | **NEU** (`openssl rand -hex 32`) — frische Bridge |
| API-/OAuth-Keys | kommen **mit der DB** (lesbar nur dank übernommenem Encryption-Key) |

Vault bleibt Overengineering für 3 Power-User (konsistent mit BACKLOG #68). `.env` mit `chmod 600`, `/docker/`-Verzeichnis nur Root.

**KRITISCH:** Der Encryption-Key ist **nicht regenerierbar**. Vor dem Cut-Over muss er ins **Off-Site-Backup** (Passwort-Manager / separater sicherer Ort) — geht der Key verloren, sind alle verschlüsselten Secrets in jedem DB-Backup für immer unlesbar.

### S4 — Reverse-Proxy → **Traefik v3.0** nach §9.3-Pattern 1:1

- `traefik-proxy`-Network, Let's-Encrypt **HTTP-Challenge**, ACME-Mail `hello@nolmi.ai`
- Drei Router: `app.nolmi.ai` → web, `runtime.nolmi.ai` → runtime, `bridge.nolmi.ai` → bridge
- **PFLICHT: BasicAuth-Middleware** (§9.6) **vor** öffentlicher DNS-Bekanntheit — die Signup-Allowlist fehlt weiterhin, also darf die Plattform nicht offen im Netz stehen, bevor sie hinter BasicAuth liegt.
- Traefik-**Dashboard nicht exposen**.

Interne Container-zu-Container-Calls via Container-Name (Hairpin-NAT-Vermeidung, BACKLOG-Architektur-Notiz „Container-zu-Container-Hop statt Public-URL").

### S5 — Docker-Setup + Repo-Auth → **§9.2-Sequenz + HTTPS-PAT**

- `DEPLOYMENT.md` §9.2: `apt`-Update, `get.docker.com`, UFW `22/80/443`, DNS-grün-Check
- **Repo-Klon** des privaten `nolmi-ai/nolmi` via **HTTPS + Fine-grained PAT** (read-only, nur auf das eine Repo, **mit Ablaufdatum**)
- **KEIN SSH-Deploy-Key, KEIN SSH-Alias** — Production zieht nur (`git pull`), ein einziges Repo, kein Multi-Identity-Bedarf. (Löst das hängende SSH-Item, §3.)

### S6 — Cut-Over → **Parallel-Bring-Up + kurzes Freeze-Fenster**, kein Big-Bang

Neuer Stack läuft vollständig hoch und wird verifiziert, **während** der alte weiterläuft. Erst nach grünem Smoke kommt ein kurzes angekündigtes Freeze-Fenster für das finale Delta. Sequenz siehe §5.

### S7 — Rollback → **alter Stack IST der Rollback** (1–2 Wochen Hot-Standby)

`srv1046432` bleibt 1–2 Wochen unter `twin.harwayexperience.com` als Hot-Standby. Rollback = „wieder die alte Domain benutzen", ohne DNS-TTL-Wartezeit. Abschaltung erst nach stillem Verifikations-Fenster (Details §6). Das **terminiert** das hängende Abschaltungs-Item (§3).

---

## 3. Aufgelöste hängende Items

Drei BACKLOG-Items, die seit dem Rebrand (Block 4/5) als „offen/defer" für Phase 4 hingen, sind mit den Setzungen oben **entschieden**:

| Hängendes Item | Auflösung | Setzung |
|---|---|---|
| **SSH-Auth klären** (HTTPS+Token vs. SSH-Alias) | **ENTSCHIEDEN: HTTPS + Fine-grained PAT (read-only).** SSH-Alias fällt weg. | S5 |
| **`docker/twin-lab-web/` → `docker/nolmi/` Migration** | **ENTFÄLLT: Greenfield-VPS** — `/docker/nolmi/` wird neu angelegt statt umbenannt. | S2 |
| **`srv1046432` Abschaltung nach Cut-Over** | **TERMINIERT: nicht am Cut-Over-Tag**, sondern nach 1–2 Wochen stillem Verifikations-Fenster. | S7 |

Das alte `docker/twin-lab-web/` im Repo bleibt unangetastet, solange der Bestands-Stack läuft (Code-Live-Sync), und wird nach der Abschaltung (S7) archiviert/gelöscht.

---

## 4. Offene Pre-Flight-Verifikation (vor Bridge-Block)

**Bevor** S2 (Bridge-Re-Registrierung) gebaut wird: den **Bridge-DB-Inhalt am `apps/bridge`-Source** prüfen (Schema + `messages-repo`).

**Frage:** Was hält die Bridge-DB an Unersetzlichem **außer** Handle → Token → Routing?
- **Wenn nur Routing/Registrierung** → Re-Registrierung der 3 Twins ist korrekt (S2-Annahme bestätigt).
- **Wenn relevante A2A-History** (z.B. Konversations-Records, die nicht runtime-seitig gespiegelt sind) → Setzung S2 **nachjustieren**: Bridge-DB mitmigrieren statt re-registrieren.

Das ist ein **Diagnose-Scan am Source**, kein Rate-aus-dem-Kopf — konsistent mit dem „Sicht holen vor Aktion"-Pattern (BACKLOG-Lessons #45/#64). Eigener Bau-Block B3 (§8), eigenes BACKLOG-Item.

---

## 5. Cut-Over-Sequenz (geordnet)

1. **Neuen Stack hochfahren** auf `187.124.3.235` mit migrierter Runtime-DB (Key übernommen, Bedingung A), hinter BasicAuth (S4). Alter Stack läuft weiter unter `twin.harwayexperience.com`.
2. **Verifikation** — 4-stufiger §6-Smoke + alle 3 Twins: Login, Memory da, **OAuth-Roundtrip** (= praktischer Beweis, dass der Encryption-Key korrekt übernommen wurde), A2A nach Re-Registrierung.
3. **Freeze-Fenster** — angekündigt (abends, keine neuen Messages auf alt) → finaler Tarball → Einspielen → Cut. Bei 3 Usern ist **kein** kontinuierlicher Sync nötig, nur dieses eine Delta-frei-Fenster gegen Split-Brain.
4. **User-Umzug** — die 3 User auf `app.nolmi.ai` umziehen (einmal neu einloggen, neue Domain).

---

## 6. Rollback-Plan

- `srv1046432` bleibt **1–2 Wochen Hot-Standby** unter `twin.harwayexperience.com` → Rollback = „wieder alte Domain nutzen", **ohne** DNS-TTL-Wartezeit.
- **Vor dem Cut** frisches Volume-Backup **beider** Stacks.
- **Trigger-Kriterien** für sofortigen Rollback: z.B. OAuth-Roundtrip failt → das deutet auf ein Encryption-Key-Problem (Bedingung A verletzt) → sofort zurück auf den alten Stack, Diagnose offline.
- **Erst nach dem stillen Fenster:** `srv1046432` abschalten (S7 + Abschaltungs-Item).

---

## 7. Doku-Follow-up (kein Setzungs-Thema)

Das `DEPLOYMENT.md` §9-Cookbook ist im Body noch **durchgehend twin-lab**: Repo-URL `markusbaier/twin-lab`, `/docker/twin-lab-web/`, Image-Namen `twin-lab-runtime`/`-web`, Bridge-URL `twin.harwayexperience.com`. 

**Phase-4-Begleit-Item:** Cookbook auf `nolmi-ai/nolmi` + `nolmi.ai` + `/docker/nolmi/` + `nolmi-*`-Images umschreiben. Sinnvoll **während** B1/B2 (man liest das Cookbook ohnehin Schritt für Schritt durch) oder als B7-Cleanup. Kein Blocker für den Deploy selbst.

---

## 8. Bau-Reihenfolge (Vorschlag, je eigener committeter Block)

| Block | Inhalt | Setzung/§ |
|---|---|---|
| **B1** | VPS-Prep + Docker + Traefik | S4 / S5 |
| **B2** | Stack-Build + `.env` + BasicAuth | S3 / S4 |
| **B3** | Pre-Flight Bridge-DB-Check | §4 |
| **B4** | DB-Migration + Bridge-Re-Registrierung | S1 / S2 |
| **B5** | Smoke + 3-Twin-Verifikation | §5.2 |
| **B6** | Cut-Over | §5.3–4 |
| **B7** | Nach Fenster: `srv1046432`-Abschaltung + Cookbook-Rewrite | S7 / §7 |

Jeder Block ist abgeschlossen verifizierbar; B3 (Pre-Flight) kann das Setzungs-Bild von S2 nachjustieren, bevor B4 baut.

---

## Verweis

Rebrand-Master: [`docs/REBRAND-NOLMI-STRATEGY.md`](./REBRAND-NOLMI-STRATEGY.md) §3 Phase 4 + §9. Deploy-Cookbook: [`docs/DEPLOYMENT.md`](./DEPLOYMENT.md) §8 (Backup/Restore) + §9 (First-Time-Setup). OAuth-Token-Kontext (Bedingung A): [`docs/131-OAUTH-STRATEGY.md`](./131-OAUTH-STRATEGY.md).
