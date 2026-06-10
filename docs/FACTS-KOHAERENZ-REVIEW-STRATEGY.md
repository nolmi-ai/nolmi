# Facts-Kohärenz-Review (#94 neu zugeschnitten) — Bau-Strategie

**Status:** Strategie, NICHT gebaut. Erstellt Tag 43. Ersetzt das ursprüngliche #94 (Dream-Pattern als Dedup-Job), das durch die Architektur überholt ist.

## Warum #94 neu zugeschnitten
Das ursprüngliche #94 (Tag 12) war ein Facts-Dedup-/Verdichtungs-Job. Diagnose Tag 43: Die Dedup-Hälfte ist obsolet — die facts-Tabelle hat UNIQUE(twin_id, fact_key), Duplikate sind strukturell unmöglich (upsert überschreibt, History via #97 erfasst den Drift). Die Extraktions-Hälfte deckt semantic-fact-write (neue Facts aus Gesprächen) + reflection-owner (Beobachtungen) ab. ABER: Eine echte Lücke mit GEMESSENEM Schaden bleibt — semantische Widersprüche + Veraltetes ÜBER fact_keys hinweg. Belege @markus (Prod, Tag 43): wife_name='Anna' (30d, source user) widerspricht relationship_status='keine Frau, Anna ist nicht seine Frau' (6d); product_concept_tavryn + project_codename (12d, Tavryn verworfen) widersprechen product_name_final='Nolmi' (7d). Das UNIQUE-Schema fängt das NICHT (verschiedene Keys), semantic-fact-write fängt es nicht (extrahiert nur neue Keys), reflection-owner fängt es nicht (schreibt keine Facts). Echte, eigenständige Lücke.

## Was der Kohärenz-Review tut
Periodisch (CLI-first, Loop später): liest den ganzen approved-facts-Store, findet (a) Widersprüche zwischen Facts und (b) veraltete/überholte Facts, schlägt Korrektur (update) oder Löschung (delete) als PENDING in der Inbox vor. Markus approved/rejected. KEIN autonomes Aufräumen.

## Vision-Leitplanke (verbindlich)
TWIN-VISION Z.147: Facts über Markus sind approval-pflichtig. Der Review schlägt VOR (Pending), räumt NICHT autonom auf. Beim Approve wird die Aktion ausgeführt; bei Reject bleibt der Fact unberührt. Der bestehende Fact wird bis zum Approve NICHT angefasst (anders als semantic-fact-write, das pre-writet).

## Der kritische Baustein (Diagnose-Befund): apply-on-approve
🔴 Die bestehende Pending-Fact-Mechanik (semantic-fact-write) hat die FALSCHE Form: sie pre-writet die Fact-Row + flippt beim Approve nur confidence. Sie kann nur NEUE Keys, nicht einen bestehenden Wert ändern (UNIQUE blockt) und nicht löschen (existiert nicht). Der Review braucht eine NEUE Mechanik: der Vorschlag lässt den Fact unberührt, erst der Approve FÜHRT AUS (upsert mit newValue / delete). Diese „apply-on-approve"-Form fehlt heute komplett und ist der Kern dieses Stücks.

## Abgrenzung (Diagnose-bestätigt, sauber)
- vs. semantic-fact-write: das EXTRAHIERT neue Facts (fügt hinzu); der Review RÄUMT bestehende auf (update/delete). Der Review fasst NUR approved-Facts an → keine Kollision mit pending (die der Extraction gehören). Verschiedene Fact-Lebensphasen.
- vs. reflection-owner: das ÄUSSERT (Telegram, kein Write); der Review schlägt einen WRITE vor (Inbox-Pending, Approve schreibt). Verschiedene Kanäle/Wirkung.

## Was schon da ist
✅ facts.upsert (History-Capture value_change) + facts.delete (History-Capture delete) — Schreib-/Lösch-Primitiven, history-sicher. ✅ Pending→Approve/Reject-Audit-Pipeline + Dispatch (twin-service.ts:1532). ✅ reflection-engine-Generator-Muster + reflection-loop-Guard/Cooldown-Muster. ✅ capability = freier String → keine Migration für neue Capability.

## Sub-Step-Sequenz
**SS1 — apply-on-approve-Mechanik (M, der fehlende Kern, KEINE Migration):** neue Capability fact-coherence-fix; Pending-Audit trägt das Proposal {factKey, issueType, proposedAction, newValue?, relatedFactKeys?, reasoning} im Input; neuer Approve-Handler im Dispatch (twin-service.ts:1532) der bei proposedAction='update' facts.upsert({factKey, factValue:newValue, source:'twin', confidence:'approved'}) bzw. 'delete' facts.delete(twinId, factKey) AUSFÜHRT; Reject-Handler (Audit rejected, Fact unberührt). Der bestehende Fact wird vor Approve NICHT angefasst. Lokal-Test: Pending anlegen → Approve update → Wert geändert + History value_change; Approve delete → Fact weg + History delete; Reject → Fact unberührt.
**SS2 — Review-Generator (S–M, Vorbild reflection-engine):** listByTwin(onlyApproved) → optional jüngste Summaries als Aktualitäts-Kontext → Prompt „finde Widersprüche/Veraltetes" → generateObject(ProposalSchema) → pro Proposal ein fact-coherence-fix-Pending (über SS1). generate-only-Variante für Test (kein Pending) wie bei reflection. Lokal-Test: Mock-LLM mit Widerspruch → erzeugt Proposals; leerer/sauberer Store → keine Proposals.
**SS3 — CLI-Trigger + Guards (S, Vorbild reflect-nudge):** twin:facts-review CLI; Dedup-Guard (skip factKey mit offenem fact-coherence-fix-Pending) + Rejected-Gedächtnis (skip factKey, dessen Fix jüngst rejected wurde). Loop-Wiring SPÄTER (eigenes SS, nicht hier). Prod-Test gegen echten @markus-Store: erkennt er den wife_name-Widerspruch + die Tavryn-Altlasten?

## Verify (Prod, nach SS3)
twin:facts-review @markus → erzeugt Pending-Proposals für die gemessenen Widersprüche (wife_name, Tavryn). Approve eines Proposals → Fact wird korrigiert/gelöscht, History erfasst es, Vision-Grenze gewahrt (nichts autonom geschrieben). Damit ist der erste echte Bestand-Schaden (wife_name) sauber behebbar über den Twin-Vorschlag statt manuell.

## NICHT in diesem Stück
Loop-Wiring (autonomer periodischer Review — eigenes SS nach Treffsicherheits-Beobachtung); bewertende Tiefe („du widersprichst dir, weil…" — nur faktische Widersprüche, v1); Cross-Fact-Synthese (neue verdichtete Facts AUS mehreren — separates Pattern); Facts anderer Twins.
