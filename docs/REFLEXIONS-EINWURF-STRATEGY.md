# Proaktiver Reflexions-Einwurf — der Twin äußert eine Beobachtung über Markus (Wow-Strang 2) — Bau-Strategie

**Status:** Strategie, NICHT gebaut. Erstellt Tag 42. Der eigentliche Wow-Kern: der Twin meldet sich von sich aus mit einer nicht-offensichtlichen Beobachtung über Markus (Vision-Kriterium 3 „überrascht" + 5 „proaktiv").

## Warum dieser Anlass (Tag-42-Erkenntnis)
Vier Wow-Anlässe wurden diagnostiziert + verworfen: detectStuck (Markus ist nicht stuck), Anlass-3-offene-Frage (rhetorisch/Smalltalk), Theme-Muster (oberflächlich), #94-Facts-Dream (datenblockiert + doppelt). Durchgehender Constraint: Korpus-Tiefe, nicht Code. Nach #161 (Verdichtungs-Loch geschlossen, gelebtes Korpus erschlossen) wurde reflect('owner') auf Prod getestet → erzeugte eine ECHTE Einsicht ("Markus verbindet Strategie und Umsetzung, prüft Konzepte sofort an realer Substanz" — abgeleitet aus Verhalten über Turns, nicht aus einem Fact). 🎯 Erkenntnis: Die inhaltlich beste Einsichts-Maschine (reflection-owner) ist längst gebaut — sie lief nur (a) manuell und (b) auf zu dünnem Korpus. Beide Bedingungen sind jetzt gelöst. Der Wow ist erreichbar, ohne die Einsichts-Erzeugung neu zu bauen.

## Die Vision-Leitplanke (verbindlich)
TWIN-VISION Z.147: Inferenzen ÜBER Markus sind approval-pflichtig — der Twin speichert nicht autonom „eigene Meinungen über Markus". reflection-owner ist die „sensibelste Klasse". 🔴 AUFLÖSUNG (STUFE-3 Z.13, durch Diagnose bestätigt): Der Code trennt ÄUSSERN (reflect('owner') → Text) und SPEICHERN (approveSelfReflectionWrite → Diary) bereits VOLLSTÄNDIG. Der Einwurf ÄUSSERT die Beobachtung flüchtig an Markus (status=sent), ruft NIE approveSelfReflectionWrite → speichert KEINE Inferenz. Bestätigt Markus die Beobachtung → KÖNNTE sie gespeichert werden (separater, manueller Opt-in-Schritt). So bleibt die Grenze strukturell gewahrt.

## Design-Entscheidung: generate-only (C6-i)
Der Nudge-Pfad nutzt einen schlanken generate-only-Pfad (nur Reflexions-Text, KEIN self-reflection-write-Pending in der Inbox). Der Push erzeugt allein die reflection-nudge-Spur (status=sent). Speichern bleibt strikt opt-in (Markus bestätigt → separater Approve). Kein Inbox-Doppel-Artefakt.

## Was schon da ist (Diagnose-Befund)
✅ reflect('owner')-Generator: Text ohne Store (reflection-engine.ts, äußern/speichern entkoppelt). ✅ emitNudge-Push ~90% generisch (sendToOwner/bot-registry, Autosend-Gate-Muster, status=sent, Pending-Fallback). ✅ Kadenz-/Substanz-Gates im Reflexions-Loop (Guard A hasOpenPending, Guard B hasNewSubstanceSince), 24h-Intervall, opt-in, per-Twin-isoliert. 🔴 Neu (alles klein): worthNudging-Qualitäts-Gate, reflection-nudge-Capability + Emit-Pfad, owner-Push im Reflexions-Loop (heute self-only), eigenes Gate REFLECTION_NUDGE_AUTOSEND_ENABLED (Default aus).

## Setzungen (verbindlich)
1. **Äußern ≠ Speichern.** Der Nudge-Pfad ruft NIE approveSelfReflectionWrite. Push = status=sent (flüchtige Äußerung). Speichern bleibt manueller Opt-in.
2. **generate-only.** Kein Inbox-Pending durch den Nudge-Pfad.
3. **worthNudging-Gate.** hasEnoughSubstance ("ist wahr") reicht NICHT — ein zweites Kriterium "ist diese Beobachtung es wert, Markus zu unterbrechen" (analog shouldNudge beim Fokus-Nudge), gegen banale/zu-nahe Reflexionen.
4. **Default-AUS-Gate (REFLECTION_NUDGE_AUTOSEND_ENABLED).** Sensibelste Klasse → erst Pending erproben, autonomer Push erst nach bewährter Treffsicherheit (Stufe-3-Approval-Disziplin). Notbremse.
5. **Kadenz: im Reflexions-Loop (24h + Substanz-Gate), NICHT im Fokus-Loop (4h).** Der teure Opus-Call läuft nur bei neuem Korpus seit der letzten Reflexion.
6. **A-Kontext only.** Nur an Markus' Telegram. Nichts nach außen.

## Sub-Step-Sequenz
**SS1 — worthNudging-Gate + generate-only-Pfad (S):** Reflexions-Schema um worthNudging erweitern (1 Call, billig) ODER zweiter Gate-Call; ein generate-only-Pfad (reflect-Text ohne Pending). Lokal: reflect erzeugt Text + worthNudging-Urteil, kein Diary-Write, kein Inbox-Pending.
**SS2 — reflection-nudge-Capability + Emit-Pfad (S):** emitNudge um capability-Arg parametrisieren (oder dünn spiegeln als emitReflectionNudge); Capability reflection-nudge (eigener Inbox-Filter/Dedup). Lokal: ein worthNudging-Text → emit → status=sent (Push-Pfad), Fallback-Pending bei Push-Fehler.
**SS3 — owner-Push im Reflexions-Loop + Gate (S):** den owner-Subject-Push in reflectForTwin (heute self-only) ergänzen, hinter REFLECTION_NUDGE_AUTOSEND_ENABLED (Default aus); Guard A/B + Episode-Cooldown (nicht dieselbe Beobachtung wiederholt). Lokal: Loop-Tick mit neuem Korpus → reflect owner → worthNudging → bei Flag-an Push, bei Flag-aus Pending; kein neuer Korpus → kein Call (Guard B).

## Verify (Prod)
Reflexions-Loop-Tick (oder CLI) mit neuem Korpus → reflect('owner') → worthNudging ja → Telegram-Einwurf an @markus (status=sent, KEIN Diary-Write, KEIN Inbox-Pending). Notbremse (Flag aus) → Pending statt Push. approveSelfReflectionWrite wird im Nudge-Pfad NIE gerufen (Vision-Grenze verifizierbar: kein Diary-Eintrag durch den Einwurf).

## NICHT in diesem Stück
Autonomes Speichern bestätigter Beobachtungen als Fact (separater Opt-in, später); reflection-self-Push (bleibt wie es ist); A2A/außen; Stufe-3-Quer-Wochen-Muster (eigene Strategie, datenblockiert).
