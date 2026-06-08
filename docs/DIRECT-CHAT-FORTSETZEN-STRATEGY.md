# Direct-Chat-Konversation fortsetzen (v2) — Bau-Strategie

**Status:** Strategie, NICHT gebaut. Erstellt Tag 41. Baut auf Direct-Chat-Historie v1 (Tag 40, read-only ReadView) auf.

## Warum „Fortsetzen", nicht „Reaktivieren"
Diagnose Tag 41: Echtes Reaktivieren (alte Konv wird wieder die aktive) passt NICHT zum Datenmodell. Die „höchstens eine aktive Konv pro Tripel"-Invariante lebt nur prozedural in start() (repo.ts:101-118), KEIN DB-Constraint. Ein naives UPDATE status='active' erzeugt zwei aktive Rows → findActive (LIMIT 1) mehrdeutig → stille Korruption beim Send. Echtes Reaktivieren erzwingt Umbau von vier Stellen (start-Invariante, findActive, per-conversation LLM-Loader, twin-weiter-50+lastResetAt-Stream) = M+, Büchse. Stattdessen: Fortsetzen via NEUER Konv mit der Summary der alten als Seed-Kontext — modellkonform, S–M, gleicher Nutzen.

## Was v2 ist
Im read-only ReadView (v1) einer beendeten Konv ein „Fortsetzen"-Knopf: startet eine NEUE Direct-Chat-Konv (sauber über start() → beendet die aktuelle aktive ordentlich) und gibt dem Twin die Summary der alten Konv als Kontext mit. Die alte Konv bleibt ended (archivierbar/löschbar). Der Nutzer macht „dort weiter", der Twin erinnert den Strang.

## Design-Entscheidungen (Tag 41, verbindlich)
1. **Seed unsichtbar (System-Kontext, kein Fake-Turn):** Die alte Summary wird der neuen Konv als System-Prompt-Kontextblock mitgegeben, NICHT als sichtbarer Audit-Turn. Begründung: Audit-Sauberkeit (kein Turn, der nie gesendet wurde) — dieselbe Disziplin wie bei #53. Der Twin „kennt" den Strang, der Stream bleibt sauber.
2. **Summary-Snapshot (Kopie, nicht Referenz):** Der Seed-Kontext wird als Text-Kopie der Summary zum Fortsetzungs-Zeitpunkt in der neuen Konv gespeichert. Begründung: Robust gegen späteres Löschen/Archivieren der Ur-Konv — die Fortsetzung lebt eigenständig (passt zu „Löschen=Vergessen": die alte Konv darf weg, die Fortsetzung bleibt).
3. **Sichtbarer „fortgesetzt aus…"-Marker:** Die neue Konv trägt ein Metadatum (woraus fortgesetzt: alte conv-id + Datum/Thema) + zeigt im Stream-Kopf dezent „fortgesetzt aus: [Thema], [Datum]". Begründung: Transparenz, die der unsichtbare Seed (1) allein nicht gibt — der Nutzer sieht, dass + woraus fortgesetzt wurde.

## Mechanik
- „Fortsetzen" → start() (beendet aktuelle aktive sauber, legt neue an) + die neue Konv bekommt: (a) Seed-Kontext (Summary-Snapshot der alten) für den LLM, (b) das „fortgesetzt-aus"-Metadatum.
- Der LLM-Loader (history-loader.ts) muss den Seed-Kontext der neuen Konv als zusätzlichen Kontextblock einbeziehen (zu den normalen per-conversation Summaries/Audits — die neue Konv hat anfangs keine eigenen).
- Wächst die neue Konv, verdichtet sie normal (eigene Summaries/Tail-Flush) — der Seed-Kontext bleibt als Anker.

## NICHT in v2 (Abgrenzung)
Echtes Reaktivieren (alte Row wird aktiv); Zusammenführen mehrerer alter Konv; Seed aus A2A-Konv; rückwirkende Änderung der alten Konv.

## Sub-Step-Sequenz
**SS1 — Backend (S–M):** Schema für Seed-Kontext + „fortgesetzt-aus"-Metadatum auf der neuen Konv (Migration falls nötig — additive Spalten, z.B. continued_from_conversation_id + seed_context TEXT). Fortsetzen-Route: start() + Seed setzen. LLM-Loader bezieht seed_context ein. Lokal: neue Konv entsteht, aktuelle sauber beendet, Seed im LLM-Kontext.
**SS2 — Frontend (S):** „Fortsetzen"-Knopf im ReadView (v1) + „fortgesetzt aus…"-Marker im Stream-Kopf der neuen Konv. Lokal: Klick startet Fortsetzung, Marker sichtbar, alte Konv bleibt im Verlauf.

## Verify (Prod)
Eine beendete Konv (z.B. 53-Turn Agent-Readiness) fortsetzen → neue aktive Konv, Twin antwortet mit Bezug auf den alten Strang (Seed greift), „fortgesetzt aus"-Marker sichtbar, alte Konv unverändert im Verlauf.
