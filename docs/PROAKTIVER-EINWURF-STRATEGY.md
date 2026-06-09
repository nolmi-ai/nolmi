# Proaktiver Einwurf — Fokus-Nudge autonom (Wow-Strang 1) — Bau-Strategie

**Status:** Strategie, NICHT gebaut. Erstellt Tag 42. Erster von drei Wow-Strängen (Fokus-Einwürfe → Dream-Einsichten → eigene Stimme). Ziel: Vision-Kriterium 3+5 (überrascht / ist proaktiv).

## Das Problem (zwei Diagnosen, Tag 42)
Der Proaktivitäts-Apparat (Focus-Loop, detectStuck, emitNudge) ist gebaut, aber zahnlos: 0 proactive-nudge-Audits in der ganzen Historie. Zwei Tore fast geschlossen:
- **(a) Anlässe feuern nie:** detectStuck verlangt 3 themen-gleiche Fokus-Snapshots in Folge (STUCK_MIN_SNAPSHOTS=3); der 24h/Deploy-Reset-Loop akkumuliert die kaum.
- **(b) Selbst ein Nudge wäre nur ein passives Inbox-Pending** (Autosend aus → kein Push, nicht im Chat-Stream).

## Setzungen (Tag 42, verbindlich)
1. **Autonom, KEIN Approval.** Der proaktive Einwurf geht direkt raus (status='sent'), nicht als Pending. Begründung: ein Einwurf, den man erst approven muss, ist nicht proaktiv. Gilt NUR im A-Kontext (Markus' eigener Chat + sein Telegram).
2. **A-Kontext only, NICHT nach außen.** Autonomes Einbringen NUR zu Markus. A2A / Dritte bleiben approval-/mandate-gesteuert (Vision-Leitplanke: nach außen kein autonomes Handeln). Der Einwurf ist eine Aussage AN Markus, keine gespeicherte Inferenz ÜBER Markus (Approval-Pflicht für Inferenzen bleibt unberührt).
3. **Audit-Trail bleibt.** Jeder Einwurf wird als Audit (capability=proactive-nudge, status=sent) protokolliert — nachvollziehbar ("warum hast du das gesagt"), nur ohne Approve-Schritt.
4. **Notbremse:** PROACTIVE_NUDGE_AUTOSEND_ENABLED bleibt der globale An/Aus-Schalter (für Markus an, jederzeit abschaltbar).
5. **LLM-shouldNudge-Filter ist die Qualitätssicherung.** Die mechanische Schwelle (detectStuck) wird gelockert, aber der LLM-Gate (shouldNudge) entscheidet weiterhin inhaltlich, OB ein erkannter Zustand einen Einwurf wert ist → schützt vor Spam trotz gelockerter Schwelle.

## Was schon da ist (Diagnose-Befund)
✅ Autosend-Pfad + status='sent' (kein Approval). ✅ sendToOwner-Telegram-Pipeline (vollständig, bot-registry.ts). ✅ Live-Loop-botRegistry-Wiring (index.ts:227). ✅ LLM-shouldNudge-Spam-Filter (:256). 🔴 Fehlt/zu eng: detectStuck-Schwelle, Chat-Aufnahme (Nudge hat KEINE conversation_id), Tick-Frequenz (24h + Deploy-Reset), CLI-Push (twin:focus-tick reicht keine botRegistry durch).

## Sub-Step-Sequenz

**SS1 — Telegram-Einwurf autonom (S, fast fertig).** Der erste echte Wow: Twin meldet sich von sich aus per Telegram.
- detectStuck-Schwelle STUCK_MIN_SNAPSHOTS 3→2 (proactive-nudge-service.ts:41), konsekutiv beibehalten (kleinste Stellschraube, LLM-Filter sichert ab).
- PROACTIVE_NUDGE_AUTOSEND_ENABLED=true (VPS .env, Loop-Steuerungs-Prinzip — nicht committed).
- twin:focus-tick um botRegistry erweitern → der manuelle Tick pusht auch an Telegram (Sofort-Test ohne 24h-Warten).
- Tick-Intervall FOCUS_LOOP_INTERVAL_HOURS 24→4–6 (VPS .env) für lebendigen Live-Betrieb.
- Pairing-Check: @markus' telegram_configs.paired_owner_telegram_user_id gesetzt? (Voraussetzung für Push; falls nicht → einrichten.)
- Verify: twin:focus-tick (mit botRegistry) → bei ≥2 themen-gleichen Snapshots + LLM-OK → Telegram-Push an @markus, Audit status=sent, kein Pending.

**SS2 — Chat-Einwurf autonom (M, danach).** Der Einwurf erscheint auch im Direct-Chat-Stream.
- emitNudge setzt conversationId = aktive Direct-Chat-Konv (sonst erscheint der Nudge nicht im aktiven Stream-Fenster; der Stream filtert per lastResetAt + gruppiert per conversationId).
- 'proactive-nudge' in DIRECT_CHAT_CAPABILITIES (page.tsx:46).
- Neuer Render-Branch in buildChatBlocksFromAudits (page.tsx:1613): Nudge hat input.message (nicht lastMessage) + kein output.reply → eigener Block-Typ "twin-initiierter Einwurf", dezenter Bubble-Stil.
- Verify: nach Tick erscheint der Einwurf als Twin-Bubble im Direct-Chat (beim Öffnen), nicht nur in Telegram.

## NICHT in Strang 1 (Abgrenzung)
Dream-Einsichten (Strang 2, eigenes Stück); eigene Stimme (Strang 3); autonome Einwürfe nach außen (A2A); Anlass 3 / detectOpenQuestion-Lockerung (separat, falls nötig); Push für andere User (nur @markus-A-Kontext).

## Verify-Gesamt (Prod)
twin:focus-tick (mit botRegistry, ggf. zweimal für 2 Snapshots) → wenn der Twin ein stabiles Thema erkennt + der LLM zustimmt → autonomer Einwurf landet in @markus' Telegram (SS1) + im Direct-Chat-Stream (SS2), als Audit status=sent, ohne Approval. Notbremse (Flag aus) stoppt alles.

## Stand Tag 42 — Infra komplett, Anlass-Frage offen

SS1 (Telegram-Einwurf-Infra) + die Theme-Similarity-Kette (SS1-3, docs/THEME-SIMILARITY-STRATEGY.md) sind gebaut, deployt, Prod-verifiziert. detectStuck feuert jetzt semantisch. Der autonome Push-Pfad (Autosend, botRegistry, status=sent, Notbremse-Flag) ist fertig.

🔴 Offene Kern-Erkenntnis: Der Anlass "stuck/Festhängen" passt nicht zu Markus (produktives Arbeiten ≠ Blockade → LLM declined zu Recht). SS2 (Chat-Einwurf) ist daher zurückgestellt — es gibt noch keinen feuernden Anlass, der den Chat-Einwurf sichtbar machen würde. Bevor SS2 oder ein neuer Anlass gebaut wird, muss die Anlass-Frage geklärt sein:
- "Muster/Verbindung" via Theme-Embeddings → zu oberflächlich (nur offensichtliche Nachbarschaften).
- Stufe 3 (verdichtete Episoden, STUFE-3-MUSTER-NUDGE-STRATEGY.md) → der richtige Muster-Anlass, aber datenblockiert (G2-Episoden-Tiefe).
- Offen als nächste Linsen: Anlass 3 (offene Frage, detectOpenQuestion — erreichbarer, zustandsabhängig) schärfen? Oder Strang 2 (Dream-Einsichten) als eigener Wow, der die Theme-Infra nutzt?

Die Infra wartet auf das richtige Signal — nicht auf mehr Code.
