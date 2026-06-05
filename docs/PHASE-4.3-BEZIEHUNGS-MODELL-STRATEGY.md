# Phase 4.3 — Beziehungs-Modell (graded Vertrautheits-Level)

**Strategie gelockt:** Tag 38 (5. Juni 2026). **Quelle:** ROADMAP Phase 4.3 + TWIN-VISION Block 1.3 („Substanz konstant, Verpackung passt sich an") + Architektur-Thema #2 („Beziehungs-Modell pro A2A-Partner — Erweiterung des Trust-Layers"). **Status:** Strategie steht, Bau Schritt 1 als Nächstes.

## Kontext / Ausgangslage

Der heutige Trust-Layer (Phase 2.5.4.1) ist BINÄR: `trust_relationships`-Tabelle + Repo + Settings-UI, ein Partner ist trusted oder nicht. Trust WIRKT heute im Mandate-Dispatch über drei Stufen: Owner-Direct (kein Check), Trusted-Twin (kein Check, Audit `trusted-bypass`), External (voller Mandate-Check → Pending). Die Social-Suggestion Stufe 1 (Tag 36) hat die Grenze zum graded Modell bewusst ausgespart („binäres Trust + Recency, KEIN graded Level — das wäre Phase 4.3"). Wir füllen diese bewusst gelassene Lücke.

## Setzungen (Tag 38)

| # | Setzung | Begründung |
|---|---|---|
| S1 | **Vier Stufen:** fremd / bekannt / vertraut / eng | Bildet menschliche Beziehungstiefe feiner ab als binär; Vision „Verpackung passt sich an" |
| S2 | **Wirkung: BEIDES** — Verpackung (Prompt-Ton) + Autonomie-Abstufung (Dispatch) | Voller Vision-Scope; aber die zwei Hälften sind ungleich sensibel → getrennte Schritte |
| S3 | **Setzung HYBRID:** Twin leitet Level ab + schlägt als PENDING vor, Owner bestätigt | Volle Vision-Intelligenz (Twin erkennt Beziehungstiefe) OHNE Kontrollverlust. Autonomes Setzen + Autonomie-Wirkung wäre eine selbstverstärkende Schleife ohne Owner — bewusst vermieden (wie alle anderen Inferenz-Pattern: pending-gated). Vision: Autonomie-Übergänge sind Vertrauens-Trigger, nicht Startpunkt. |
| S4 | **Startwert aus binärem Trust migriert:** trusted→vertraut, untrusted→fremd | System fängt nicht bei null an; Twin schlägt nur Verfeinerungen vor |
| S5 | **Leitplanken-Prinzip (wie Fokus-Pattern Tag 37):** das Sichere/Milde VOR dem Sensiblen | Daten → Verpackung → Sichtbarkeit/Kontrolle (Leitplanke) → Hybrid-Vorschläge → Autonomie zuletzt |
| S6 | **Die „untrusted = immer pending"-Sicherheitslinie wird NICHT ohne explizite Owner-Freigabe aufgeweicht** | Backlog markiert das als bewusst offene Sicherheitsfrage; Schritt 5 entscheidet sie separat |

## Sub-Schritt-Plan (jeder Schritt eigener Deploy, Verifikation pro Schritt — Muster #97/Fokus)

**Schritt 1 — Datenschicht + Migration.** `trust_relationships` um `familiarity_level` (Enum: fremd/bekannt/vertraut/eng) erweitern; Migration setzt Startwerte aus binärem Trust (S4); Repo get/set. Keine Wirkung — nur Feld existiert + initialisiert. „Mit-Migration"-Klasse (Schema-Änderung an zentraler Trust-Tabelle → DB-Backup-Disziplin wie #97/028). Risikoarm, additiv.

**Schritt 2 — Verpackungs-Wirkung (mild).** Level fließt in den A2A-Prompt: vier Ton-Abstufungen (fremd→Klärungsfragen/formell · bekannt→freundlich-zurückhaltend · vertraut→direkt, darf urteilen · eng→sehr direkt, darf kritisieren). Wirkt NUR auf Stil, NICHT auf Autonomie. Dockt am Prompt-Composer an (Vorbild focusBlock/buildFocusBlock). Sofort erlebbar.

**Schritt 3 — Sichtbarkeit + manuelle Kontrolle (die Leitplanke, VOR Autonomie).** Settings-UI: pro Partner Level sehen + manuell setzen/überschreiben. Voraussetzung für alles Autonome danach (analog Fokus-Tab vor Fokus-Loop). Owner hat volle Kontrolle, bevor der Twin etwas vorschlägt.

**Schritt 4 — Hybrid-Vorschläge (Twin leitet ab + schlägt pending vor).** Twin analysiert Kontakt-Häufigkeit/Historie, schlägt Level-Änderungen als Pending vor (Social-Suggestion-Muster: `social-suggestion`-Capability als Vorbild, neue Capability z.B. `familiarity-suggestion`). Owner bestätigt → Level ändert sich. Pending-gated = die Vision-Intelligenz unter Kontrolle.

**Schritt 5 — Autonomie-Abstufung (sensibel, ZULETZT, mit expliziter Freigabe).** Level beeinflusst, ob A2A-Nachricht autonom beantwortet wird oder Pending — feinere Abstufung zwischen heutigem `trusted-bypass` und `external-pending`. 🔴 Die Sicherheitsentscheidung (welche Stufen dürfen autonom antworten?) wird ERST bei Erreichen von Schritt 5 getroffen, mit dem dann gebauten System vor Augen. Bewusst optional/aufschiebbar: nach Schritt 4 ist das Modell vollständig nützlich (kennt Vertrautheit, passt Ton an, schlägt Verfeinerungen vor) OHNE Anfassen der Sicherheitslinie. Schritt 5 ist die Kür, freigebbar als späterer Vertrauens-Trigger (wie Reflexions-Loop Tag 38).

## Offene Entscheidung (für Schritt 5)
Welche der vier Stufen dürfen autonom (ohne Pending) auf eingehende A2A-Nachrichten antworten? Heute: nur „trusted". Optionen reichen von „nur eng" (konservativ) bis „vertraut+eng" (näher an heute). NICHT jetzt entscheiden — bei Schritt 5, datengestützt.
