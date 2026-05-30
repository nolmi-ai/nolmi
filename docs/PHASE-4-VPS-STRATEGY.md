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

**Namens-Konsistenz:** `srv1712371.hstgr.cloud` = `187.124.3.235` (Hostinger-Hostname / IP, **dieselbe Maschine** — der neue Nolmi-VPS). Frühere BACKLOG-/Doc-Stellen referenzieren beide Schreibweisen.

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

**Bridge-State-Entscheidung (final, korrigiert Tag 31 Block 8 nach B3-Pre-Flight):** **BEIDE** DBs migrieren — Runtime-`twin.db` **UND** Bridge-`bridge.db` — aus **demselben Freeze-Moment**, beide mit Key-Kontinuität (Bedingung A für `twin.db`). **KEINE Re-Registrierung, KEIN Token-Writeback:** die per-Twin-Bridge-`api_token`s matchen auf beiden Seiten, weil nichts regeneriert wird.

**Begründung (B3-Befund, Commit `64f91e1`):** Das Pre-Flight hat zwei Dinge aufgedeckt, die die ursprüngliche S2-Lock-Entscheidung noch nicht kannte:
1. **Bridge ist trivial klein** — genau 2 Tabellen (`twins` + `messages`) mit 3-Twin-Datensatz. Eine volle Migration ist damit billiger als gedacht, nicht teurer.
2. **Re-Registrierung erzwingt neue `api_token`s** → pro Twin einen **Token-Writeback** in die frisch migrierte `twin.db` (der runtime-seitig gespeicherte Bridge-Token muss überschrieben werden, sonst 401). Das ist ein mutierender Schritt auf der gerade erst eingespielten DB — der **fragilste** Teil des Cut-Overs.

Damit kippt die Kosten-Nutzen-Rechnung: **Bridge-DB mitmigrieren** vermeidet den Writeback komplett (Tokens matchen beidseitig, da nichts regeneriert wird), liefert einen **atomaren Zwei-DB-Snapshot** aus demselben Freeze-Moment (konsistent statt migrate-one-reconstruct-other), **erhält die symmetrische A2A-View** (bridge-verankerte Messages kommen mit) und **nimmt die undelivered-Queue gratis mit** (wird auf der neuen Bridge zugestellt, sobald der Empfänger reconnected).

> **ADR-Notiz — verworfener Pfad (Re-Registrierung):** Bis Tag 31 Block 6 war S2 auf „Runtime-`twin.db` migrieren, 3 Twins gegen frische Bridge re-registrieren, Bridge-DB **nicht** migrieren" gelockt — Annahme: Re-Register spart die Bridge-DB-Migration und ist die simplere Operation. **Tag 31 Block 7 verworfen nach Pre-Flight**, weil sein einziger vermeintlicher Vorteil (weniger Komplexität) durch den erzwungenen Token-Writeback ins Gegenteil kippte: der Re-Register-Pfad mutiert die frisch eingespielte DB, der Migrations-Pfad ist ein reiner Restore + Lese-Verifikation. Bei nur 2 Bridge-Tabellen wog die „gesparte" Migration ohnehin nichts.

### S3 — Secrets → **`.env`-File auf VPS** (wie Bestand), kein Vault

| Secret | Behandlung |
|---|---|
| `NOLMI_ENCRYPTION_KEY` | **ÜBERNEHMEN** vom alten VPS (Bedingung A) — nicht regenerieren |
| `NOLMI_SESSION_SECRET` | **NEU** — Cookie-Domain wechselt zu `.nolmi.ai`, alte Sessions sind eh tot |
| Bridge-Register-Token | **NEU** (`openssl rand -hex 32`) — gilt nur für **künftige** Registrierungen |
| API-/OAuth-Keys | kommen **mit der DB** (lesbar nur dank übernommenem Encryption-Key) |

**Klarstellung Bridge-Register-Token (orthogonal zur Migration):** Der `BRIDGE_REGISTER_TOKEN` steuert ausschließlich **zukünftige** Twin-Registrierungen (`POST /twins/register`). Die 3 Bestands-Twins re-registrieren mit der korrigierten S2 **nicht** — ihre per-Twin-`api_token`s kommen mit der migrierten `bridge.db`. Der Register-Token wird beim Cut-Over also **gar nicht benutzt**; er muss nur zwischen neuer Bridge-Config und Runtime-`.env` (`BRIDGE_REGISTER_TOKEN`) matchen, damit später angelegte Twins funktionieren.

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

## 4. Pre-Flight-Verifikation — ✅ verifiziert Tag 31 Block 7 (Commit `64f91e1`) · S2 final Block 8: **Migration statt Re-Register**

**Frage:** Hält die Bridge-DB irgendetwas Unersetzliches **außer** Handle → Token → Routing?

**Methode:** Diagnose-Scan am `apps/bridge`-Source (Schema `migrations/001_init.sql` + `002_message_type.sql`, `messages-repo.ts`, `twins-repo.ts`, `server.ts`) + Gegenprobe am Runtime-Source (`twin-service.ts#receiveBridgeMessage`, `audit/conversation-merge.ts`). Kein Rate-aus-dem-Kopf (Pattern „Sicht holen vor Aktion", BACKLOG-Lessons #45/#64).

### Tabellen-Inventar (vollständig — die Bridge hat genau 2 Tabellen)

| Tabelle | Klasse | Was sie hält | Begründung |
|---|---|---|---|
| `twins` | **A** | `handle`, `display_name`, `api_token`, `registered_at`, `last_seen_at` — reine Registry/Routing | Durch Re-Registrierung neu erzeugbar. Einzige Folge: neue `api_token`s (Re-Reg-Detail in S2). |
| `messages` mit `delivered_at` **gesetzt** | **B** | zugestellte A2A-Messages (Content + Typ + `in_reply_to`) | **Runtime-seitig gespiegelt:** `receiveBridgeMessage` schreibt für **jede** empfangene Message ein Audit mit vollem `content` (`twin-service.ts:847–946`), und der `safeAck` an die Bridge (→ setzt `delivered_at`) läuft **nach** dem Audit-Write. ⇒ Ein gesetztes `delivered_at` **garantiert**, dass die Message in den lokalen Audits beider Seiten liegt. Bridge-Kopie redundant. |
| `messages` mit `delivered_at IS NULL` | **C** | **unzugestellte Queue** (Offline-Empfänger, noch nicht ge-ackt) | Bridge-**only**: noch nicht empfangen ⇒ noch **kein** Runtime-Audit. Nicht aus Re-Registrierung wiederherstellbar. **Einzige echte Klasse-(C)-Menge.** |

**Quer dazu — die symmetrische Conversation-VIEW:** `GET /messages/conversation` (`server.ts:236`) liest `messages.listConversation` direkt aus der Bridge-DB; `conversation-merge.ts` deklariert die Bridge-Messages explizit als „Source-of-Truth für den symmetrischen Conversation-Verlauf" und reichert sie nur mit lokalen Audit-Feldern an. ⇒ Verwirft man die `messages`-Tabelle, zeigt die A2A-Conversation-**View** für Alt-Konversationen leer. Der **Content** bleibt in den lokalen Audits (Klasse B, rekonstruierbar), nur die bridge-verankerte Display-Sequenz geht verloren.

### Verdikt — **S2 KORRIGIERT (Tag 31 Block 8): volle Bridge-DB-Migration statt Re-Register**

Der Scan findet als regulären Bestand nur Klasse (A) + (B) plus eine schmale Klasse-(C)-Menge (undelivered-Queue). Damit war die ursprüngliche Annahme „Re-Register spart Arbeit" **technisch haltbar, aber nicht mehr optimal** — der Befund kippt die Kosten-Nutzen-Rechnung zugunsten der Migration:

- **Bridge ist nur 2 Tabellen mit 3-Twin-Datensatz** → die „gesparte" Migration kostet faktisch nichts.
- **Re-Register erzwingt einen Token-Writeback** in die frisch eingespielte `twin.db` (neue `api_token`s, sonst 401) — ein mutierender Schritt auf der gerade restaurierten DB, der **fragilste** Teil des Cut-Overs. Die Migration ersetzt ihn durch reinen Restore + Lese-Verifikation.

⇒ **Beide DBs migrieren** (`twin.db` + `bridge.db`, gemeinsamer Freeze-Snapshot, siehe S2). Damit sind die zwei in Block 7 formulierten Auflagen **MOOT**:

1. ~~(Hart) undelivered-Queue `delivered_at IS NULL` = 0 erzwingen~~ → **ENTFÄLLT.** Die Queue migriert mit der `bridge.db` mit und wird auf der neuen Bridge zugestellt, sobald der Empfänger-Twin reconnected. Kein Drain-Zwang im Freeze.
2. ~~(Akzeptanz) View-Historie-Verlust~~ → **ENTFÄLLT.** Die symmetrische A2A-View bleibt erhalten, weil die bridge-verankerten `messages` mitmigrieren.

**NEU statt der Auflagen — B4-Token-Match-Verifikation** (ersetzt den weggefallenen Writeback durch eine reine Lese-Prüfung): Nach der Doppel-Migration für **jeden** der 3 Twins prüfen, dass der in `twin.db` gespeicherte Bridge-Token **byte-gleich** dem in `bridge.db` registrierten `api_token` ist. Beide stammen aus demselben Snapshot, also matchen sie per Konstruktion — der Check ist Bestätigung, nicht Reparatur, und garantiert „kein 401 beim ersten A2A-Hop".

### Notizen für B4 (Bridge-Block)

- **Bridge-DB-Pfad:** `data/bridge.db`, override via env `BRIDGE_DATABASE_PATH` (`apps/bridge/src/index.ts:25`). better-sqlite3, eine Instanz pro Prozess. **B4 muss sie in den gemeinsamen Freeze-Tarball aufnehmen.**
- **⚠ Bridge ist NICHT im Repo-Compose:** `docker/twin-lab-web/docker-compose.yml` definiert nur `runtime` + `web` (Volume `twin-lab-web-data`). Die **Live-Bridge auf `srv1046432` hat eigene Deploy-Config + Volume außerhalb des Repos** — B4 muss sie dort lokalisieren (Volume-Name + DB-File) und mit-tarballen. Der neue `/docker/nolmi/`-Stack nimmt die Bridge als Service mit auf (heute fehlt sie im Compose).
- **Konsequenz für B2 (Stack-Build):** Der `nolmi-bridge`-Service mountet ein **restored** Volume (Migrations-Pfad), **nicht** ein leeres Volume + Post-Up-Register-Schritt. Compose-Autorenschaft einmal richtig schneiden (Bridge-Volume als Restore-Ziel), nicht später umbauen.
- **Kein Token-Writeback mehr** — Tokens matchen beidseitig aus dem gemeinsamen Snapshot; nur Lese-Verifikation (oben).

---

## 5. Cut-Over-Sequenz (geordnet)

1. **Neuen Stack hochfahren** auf `187.124.3.235` mit migrierter Runtime-DB (Key übernommen, Bedingung A), hinter BasicAuth (S4). **Vor dem Runtime-Start die zwei Post-Restore-Pflicht-Sweeps fahren** (B6-Befund 1+2 unten — `bridge_url`-Rewrite + Geist-Twin-Delete). Alter Stack läuft weiter unter `twin.harwayexperience.com`. (Sowohl `nolmi-runtime` als auch `nolmi-bridge` führen ihr `init-db` per CMD beim Boot aus — idempotent, also auf dem restored Volume ein No-op-Bestätigungslauf; **kein** manueller Init-Schritt nötig, Tag 31 Block 12.)
2. **Verifikation** — 4-stufiger §6-Smoke + alle 3 Twins: Login, Memory da, **OAuth-Roundtrip** (= praktischer Beweis, dass der Encryption-Key korrekt übernommen wurde), **A2A ohne Re-Registrierung: erster A2A-Hop pro Twin ohne 401** (= Token-Match aus migrierter `bridge.db` praktisch bewiesen, vgl. §4-B4-Verifikation).
3. **Freeze-Fenster** — angekündigt (abends, keine neuen Messages auf alt) → finaler **Doppel-Tarball beider DBs** (`twin.db` + `bridge.db`) aus demselben Moment → Einspielen → Cut. Bei 3 Usern ist **kein** kontinuierlicher Sync nötig, nur dieses eine Delta-frei-Fenster gegen Split-Brain. (Die in Block 7 erwogene undelivered-Queue-Leer-Prüfung entfällt — die Queue migriert mit der `bridge.db` mit, §4.)
4. **User-Umzug** — die 3 User auf `app.nolmi.ai` umziehen (einmal neu einloggen, neue Domain).

### B4 ✅ verifiziert auf Backup-Kopie (Tag 31 Block 15) — Mechanik-Beweis ohne Freeze

Die Doppel-DB-Migration wurde **ohne** Production-Freeze auf einer §8.3-Backup-Kopie (twin.db + bridge.db aus demselben Moment, Off-Site auf Mac) durchgespielt — der Stack-Mechanik-Beweis, Production lief unterdessen weiter. **Verifiziert am Verhalten:** Bedingung A (kein GCM-Fehler, Secrets entschlüsselt, `sk-a…jAAA`, oauth-refresh läuft → `NOLMI_ENCRYPTION_KEY` byte-genau vom alten `TWIN_LAB_ENCRYPTION_KEY`); S2-Token-Match `bridge_token`==`api_token` byte-gleich für @markus/@florian/@heiko (kein 401, kein Writeback — S2-Korrektur Block 8 bestätigt); A2A-Stream `[bridge:stream] verbunden` ×3 gegen `nolmi-bridge:5100` (nach `bridge_url`-Fix, B6-Befund 1); Bridge-Auto-init idempotent gegen restored Volume (0 neu, 2 skipped).

**Der echte Cut-Over (B6) fährt denselben Ablauf MIT Freeze + delta-frei + den zwei Post-Restore-Pflicht-Sweeps unten.**

### Post-Restore-Pflicht-Schritte für B6 (nach Volume-Restore, VOR Runtime-Start, je mit DB-Backup davor)

**B6-Befund 1 (PFLICHT) — Stale-Infra-Reference-Sweep nach Doppel-DB-Migration:** Die migrierte `twin.db` trägt `srv1046432`-Ära-Werte. **Bestätigt betroffen:** `twin_profiles.bridge_url` (3 Twins → `http://twin-lab-bridge:5100`, muss `http://nolmi-bridge:5100`). Der per-Twin-DB-Wert ist **autoritativ** und sticht `NOLMI_DEFAULT_BRIDGE_URL` — die Env greift nur bei Onboarding-**Neuanlagen** (`pickBridgeUrlForOnboarding`, `server.ts:847`), **nicht** für Bestands-Twins. **FIX (gegen migrierte twin.db, Backup davor):**
```sql
UPDATE twin_profiles SET bridge_url='http://nolmi-bridge:5100' WHERE bridge_url LIKE '%twin-lab-bridge%';
```
Sweep-Kandidaten in B4 gegengeprüft und **sauber/leer**: `mcp_servers.url`, `telegram_configs`. In B6 **erneut** read-only sweepen, bevor das `UPDATE` läuft, falls bis dahin neue Werte dazukamen.

**B6-Befund 2 (PFLICHT) — verwaister Bridge-Twin `@test122prod`:** Die `bridge.db` hält **4** registrierte Twins, die `twin.db` nur **3** Profile (@markus/@florian/@heiko). Der vierte, `@test122prod`, ist ein Test-Twin **nur** in der Bridge-DB ohne Runtime-Profil — aus dem Tag-29-Production-Smoke (#122), von der Tag-31-Hygiene (nur lokale DB) **nie** aus der Production-Bridge entfernt. Routet ins Leere (harmlos), aber gehört beim Cut-Over aus der migrierten `bridge.db` bereinigt, sonst lebt er dauerhaft im Nolmi-Stack. **FIX (gegen migrierte bridge.db, Backup davor):**
```sql
DELETE FROM twins WHERE handle='@test122prod';
```
**Generalisierung:** vor dem Löschen `SELECT handle FROM twins` gegen die 3 echten Twins abgleichen — die Production-Bridge-DB auf **weitere** Test-/Geist-Twins prüfen, nicht nur diesen einen.

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

### Cookbook-Bug-Fixes aus B1 (Tag 31 Block 9, am echten VPS gefunden)

B1 (VPS-Prep + Docker + Traefik auf `187.124.3.235`) hat drei Stellen aufgedeckt, an denen das §9.x-Cookbook gegen **aktuelle Docker-Versionen** bricht. Das sind keine Nolmi-Rename-Kosmetik, sondern harte technische Fixes, die **jeden** Self-Hoster mit aktuellem Docker treffen — gehören in den Cookbook-Rewrite mit aufgenommen.

**Befund 1 (HART) — Traefik v3.0 bricht mit Docker 29+:** Das §9.3-Cookbook pinnt `traefik:v3.0`. Docker 29 hob die minimale API-Version an (min 1.44); Traefik <v3.6 pinnt clientseitig API 1.24 → `"client version 1.24 is too old"`, der Docker-Provider lädt nie, keine Router, keine Certs. Der Container läuft trotzdem als `Up` (**stiller Fehler**, nur im Log sichtbar). **FIX:** Image-Tag auf `traefik:v3.6` (v3.6 brachte Docker-API-Auto-Negotiation). Quelle: `traefik/traefik#12253`, offiziell adressiert. Cookbook-§9.3 muss **v3.6+** pinnen.

**Befund 2 (MITTEL) — geteiltes Netz als `external`, nicht compose-managed:** §9.3 legt `traefik-proxy` via `docker network create` an **und** deklariert es in der Traefik-Compose ohne `external: true`. Compose v5 verweigert dann (`"network ... found but has incorrect label com.docker.compose.network"`). **FIX:** Netz einmal manuell anlegen, **alle** Stacks (Traefik + in B2 der Nolmi-Stack) referenzieren es als `networks: traefik-proxy: external: true`. Das ist ohnehin das kanonische Multi-Stack-Pattern.

**Befund 3 (PROZESS-LESSON) — Verify-Outputs einzeln, nicht als Sammel-Paste:** Ein als Block gepasteter `reboot` + nachfolgende Verify-Befehle laufen noch auf der **sterbenden** Session durch → liefern Pre-Reboot-Zustand (alter Kernel, alte Logs), der wertlos ist. **Lesson:** zustandsändernde Befehle (`reboot`, `recreate`) einzeln, Verify **nach** bestätigtem Reconnect. Gehört als Runbook-Hinweis in den §9.2-Reboot-Schritt.

> **Meta-Lesson — „Up" ist kein Funktionsbeweis.** Traefik lief in B1 als `Up`, während es nacheinander (a) gar nicht gestartet war (`docker ps` leer), (b) den Provider nicht erreichte (1.24-Fehler), (c) potenziell crash-loopte. Verifikation muss am **Verhalten** hängen — `curl → 301`, `restarts=0`, Provider-Log — nicht am Container-`Status`. Status-Grün hätte den Fehler erst in B2 als „Certs kommen nicht" hochkommen lassen: viel teurer zu diagnostizieren. (Cross-Ref STAND Lesson Tag 31 #3.)

### Cookbook-Bug-Fixes aus B2 (Tag 31 Block 13–14, am echten VPS gefunden)

B2 (3-Service-Stack-Bring-up auf Staging + Prod-Cert-Flip) hat sechs Stellen aufgedeckt — zwei bereits per eigenem Commit im Repo gelöst, vier neue für den Cookbook-Rewrite (Befund 1–3 beim Staging-Bring-up, Befund 4 beim Prod-Flip):

**B2-Befund 1 (HART) — htpasswd am falschen Service:** Das §9.6-Cookbook mountet die htpasswd-Datei an den **web**-Service. BasicAuth wird aber von **Traefik** ausgewertet, nicht vom web-Container → die Datei muss im **Traefik**-Container liegen. Bei einem getrennten Traefik-Stack (eigenes `/docker/traefik/`, wie hier) bricht der web-Mount: Traefik meldet `"open /htpasswd: no such file"`, der Router mit der kaputten Middleware aktiviert nicht sauber, die App liefert **404 statt 401**. **FIX (VPS verifiziert: app→401 + `www-authenticate`-Header):** htpasswd in den Traefik-Stack mounten (`./htpasswd:/htpasswd:ro` in der Traefik-Compose, Datei unter `/docker/traefik/htpasswd`); die Middleware-**Labels** bleiben am web-Service. Im Repo nachgezogen (Tag 31 Block 13): der irreführende htpasswd-Mount wurde aus `docker/nolmi/docker-compose.yml` (`nolmi-web`) entfernt, Labels + Klarstellungs-Kommentar bleiben. Cookbook-§9.6 muss das für getrennte Traefik-Setups klarstellen.

**B2-Befund 2 (MITTEL) — `RUNTIME_PUBLIC_URL` ist Pflicht bei `TELEGRAM_USE_POLLING=false`:** Die Runtime **crash-loopt** beim Boot ohne `RUNTIME_PUBLIC_URL`, wenn Polling aus ist (= Production-Default, Webhook-Modus braucht eine öffentliche URL für die Telegram-Webhook-Registrierung). **FIX:** `.env` setzt `RUNTIME_PUBLIC_URL=https://runtime.<domain>` (echter Wert, **kein** Wegwerf — bleibt in B4). `.env.example` muss `RUNTIME_PUBLIC_URL` als **Pflicht-bei-Webhook** markieren (heute steht es als optional/leer da).

**B2-Befund 3 (META-LESSON) — alte Logs als aktuell fehlgelesen:** `tail`/`grep` über Container-Logs zeigt die letzten **passenden** Zeilen, nicht die **neuesten** Ereignisse. Die Diagnose hat mehrfach auf veralteten `ERR`-Zeilen aufgesetzt, die längst von einem Recreate überholt waren. **Lesson:** bei Log-Diagnose **immer** `--since <zeit>` nutzen + Zeitstempel gegen „jetzt" prüfen, nie nacktes `tail`/`grep` nach einem Recreate. (Verwandt mit dem B1-Reboot-Befund + STAND Lesson Tag 31 #4.)

**B2-Befund 4 (MITTEL/HART) — Resolver-Wechsel zieht keine neuen Certs, solange die Domain im alten Resolver-Store liegt:** Beim Staging→Prod-Flip (`ACME_RESOLVER` `le-staging` → `le`) lieferte Traefik **weiter die Staging-Certs**, obwohl das `tls.certresolver`-Label korrekt auf `le` stand und der Prod-`acme.json` leer war. Traefik matcht vorhandene Certs primär nach **Domain**, nicht nach Resolver — fand `app/runtime/bridge.nolmi.ai` im `acme-staging.json` und sah keinen Bezugsbedarf. **Symptom:** `TLS-verify=20` (untrusted), HTTP `000`, ACME-Log leer (kein `le`-Bezugsversuch). **FIX (VPS verifiziert):** `acme-staging.json` leeren (`> file` + `chmod 600`) + Traefik-Restart + einen Request pro Host als Bezugs-Trigger → Prod-Certs in ~30–90 s gezogen. **Final-Verify:** Issuer `Let's Encrypt CN=YR2` (kein STAGING) über alle drei Hosts, `TLS-verify=0`. **Cookbook-Konsequenz:** Wer eine Staging-zuerst-Strategie fährt (empfohlen, schützt die Prod-Rate-Limits), muss beim Flip den **Staging-Store leeren** — sonst bleibt Staging „kleben". Alternativ: Staging nur mit separatem Hostnamen testen. §9.3/§9.5-Cookbook sollte den Flip-Schritt **inkl. Store-Reset** dokumentieren.

**Bereits per eigenem Commit gelöst (in B2-Prep/-Diagnose entdeckt):** (a) Dockerfile-pnpm-Filter `@twin-lab/*` → `@nolmi/*` (Tag 31 Block 11, entblockt `docker build`); (b) Bridge-Auto-init-db in der CMD (Tag 31 Block 12, Runtime-Symmetrie, kein manueller Init mehr).

---

## 8. Bau-Reihenfolge (Vorschlag, je eigener committeter Block)

| Block | Inhalt | Setzung/§ |
|---|---|---|
| **B1** | VPS-Prep + Docker + Traefik | S4 / S5 — **✅ DONE Tag 31 Block 9** (Docker 29.5.2 + Compose v5.1.4, Traefik **v3.6**, UFW 22/80/443, HTTP→HTTPS-301 verifiziert; 3 Cookbook-Bugs §7) |
| **B2** | Stack-Build + `.env` + BasicAuth — Compose in [`docker/nolmi/`](../docker/nolmi/) (3 Services inkl. Bridge) | S3 / S4 — **✅ DONE (Prod) Tag 31 Block 14** (3-Service-Stack up, **Prod-Certs** `Let's Encrypt CN=YR2` über app/runtime/bridge.nolmi.ai, `TLS-verify=0`, app→401/BasicAuth, runtime/bridge→404; 4 Cookbook-Befunde §7) |
| **B3** | Pre-Flight Bridge-DB-Check | §4 — **✅ DONE Tag 31 Block 7** (führte zur S2-Korrektur Block 8) |
| **B4** | **Doppel-DB-Migration** (`twin.db` + `bridge.db`, gemeinsamer Snapshot) + Token-Match-Verify | S1 / S2 — **✅ DONE Tag 31 Block 15** (auf Backup-Kopie ohne Freeze: Bedingung A kein GCM-Fehler, S2-Token-Match 3/3 byte-gleich, A2A-Stream ×3 gegen nolmi-bridge; 2 B6-Pflicht-Sweeps §5) |
| **B5** ← **nächster Block** | Smoke + 3-Twin-Verifikation | §5.2 |
| **B6** | Cut-Over (Freeze: Doppel-Tarball beider DBs §5.3 + Post-Restore-Sweeps §5) | §5.3–4 |
| **B7** | Nach Fenster: `srv1046432`-Abschaltung + Cookbook-Rewrite | S7 / §7 |

**B4-Notiz:** `bridge.db` liegt auf `srv1046432` unter `data/bridge.db` in einem eigenen Volume **außerhalb** des Repo-Compose (B3-Strukturbefund) — B4 muss sie dort lokalisieren und mit-tarballen.

**B4-Vormerkung (Volumes + Certs):** Vor B4 wird der Stack gestoppt und die **Wegwerf-Volumes** (`nolmi-runtime-data`, `nolmi-bridge-data`) durch die migrierten DBs ersetzt (Restore-Ziel). Die **ACME-Certs** (`acme.json`) bleiben dabei **unberührt** — kein erneuter Cert-Bezug nötig, da die Domains (`app/runtime/bridge.nolmi.ai`) gleich bleiben. Auch der Encryption-Key wird hier von Wegwerf auf den **echten Key vom alten VPS** umgestellt (Bedingung A).

**B2-Runbook-TODOs (auf dem VPS, NICHT im Repo — die Compose ist nur die Code-Hälfte von B2):**
- ~~Dockerfile-pnpm-Filter auf `@nolmi/*` ziehen~~ → **✅ erledigt im Repo Tag 31 Block 11** (Phase-3a-Nachzügler). `docker build` entblockt.
- ~~Bridge-init-db auf leerem Volume einmalig~~ → **✅ erledigt Tag 31 Block 12** (Bridge-CMD Auto-init, idempotent, leeres B2- wie restored B4-Volume).
- ~~`htpasswd`-Datei + Mount~~ → **✅ erledigt Tag 31 Block 13** (gehört in den **Traefik**-Stack `/docker/traefik/htpasswd:/htpasswd:ro`, nicht an web — B2-Befund 1 §7; Repo-Mount aus `nolmi-web` entfernt). Datei auf dem VPS via `htpasswd -nbB <user> <pass>` erzeugen.
- ~~Wegwerf-Secrets~~ → **✅ erledigt B2** (`openssl rand -hex 32` für Encryption-Key + Register-Token; in B4 ersetzt durch echten Key vom alten VPS, Bedingung A).
- **Drei Images bauen** aus Repo-Root (Tags `nolmi-runtime/-bridge/-web:latest`); Web mit `--build-arg NEXT_PUBLIC_RUNTIME_URL=https://runtime.nolmi.ai --build-arg NEXT_PUBLIC_DEPLOYMENT_LABEL=production` (sonst localhost im Bundle, #126). — ✅ in B2 gebaut.

**B2 vollständig abgeschlossen (Tag 31 Block 14, Prod-Certs):** 3-Service-Stack up, **Prod-Zertifikate** (`Let's Encrypt CN=YR2`, kein STAGING) über `app/runtime/bridge.nolmi.ai`, `TLS-verify=0`, Bridge selbstheilend (init-db), Runtime initialisiert, BasicAuth aktiv (app→401 + `www-authenticate`; runtime/bridge→404, kein `/`-Router = korrekt). Der Flip `le-staging`→`le` griff erst nach dem Resolver-Store-Reset (§7 B2-Befund 4). Der Stack läuft damit end-to-end auf echter Infra mit vertrauten Certs — auf **Wegwerf-Secrets + leeren Volumes**, Production (`srv1046432`) unberührt. **B4** (Doppel-DB-Migration) ist seit Block 15 auf einer Backup-Kopie verifiziert (§5); nächster Block: **B5/B6** (Smoke + Cut-Over mit Freeze).

Jeder Block ist abgeschlossen verifizierbar; B3 (Pre-Flight) hat die gelockte S2 begründet **gekippt** (Re-Register → Bridge-DB-Migration), bevor B4 baut — genau der Zweck eines Pre-Flights.

---

## Verweis

Rebrand-Master: [`docs/REBRAND-NOLMI-STRATEGY.md`](./REBRAND-NOLMI-STRATEGY.md) §3 Phase 4 + §9. Deploy-Cookbook: [`docs/DEPLOYMENT.md`](./DEPLOYMENT.md) §8 (Backup/Restore) + §9 (First-Time-Setup). OAuth-Token-Kontext (Bedingung A): [`docs/131-OAUTH-STRATEGY.md`](./131-OAUTH-STRATEGY.md).
