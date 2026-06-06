# Stufe 3 — Proaktiver Muster-Nudge (Lebens-Narrativ, vierter Anlass)

**Status:** Strategie, NICHT gebaut. Bau frühestens nach G2-Beweis (verdichtete Episoden aus echtem Telegram-Verkehr). Erstellt Tag 39.

**Einordnung:** Lebens-Narrativ-Reifungspfad (TWIN-VISION Pattern 7). Stufe 0 = Memory rückblickend abfragbar (G2). Stufe 1 = reaktive Reverse-Memory-Query (gebaut, `a59b4af`). Stufe 3 = proaktive Muster-Einsicht: der Twin erkennt von selbst längerfristige Bögen und stößt an. Reaktive Stufe 1 ist das de-riskende Sprungbrett: ihre Synthese-Schicht (`synthesizeRetrospective`, public) wird hier proaktiv am Loop ausgelöst.

## Die vier Konzeptfragen

**1. Was ist ein „Muster" — Abgrenzung zu Anlass 1 (kritischste Frage).** Anlass 1 (Fokus-Nudge) liest focus_snapshots = aktivitätsbasiert („woran arbeitest du gerade", kurzfristig). Stufe 3 muss etwas erkennen, das Anlass 1 strukturell NICHT sieht: Muster QUER zu Tagesthemen über Wochen — wiederkehrende Bezüge/Spannungen/Entwicklungen, die dem Owner selbst nicht bewusst sind. Setzung: Anlass 1 = „woran du arbeitest" (kurzfristig, Aktivität, Snapshots); Stufe 3 = „was sich in deinem Denken über Wochen abzeichnet" (langfristig, Reflexion, verdichtete Episoden). Beispiel-Kontrast: Anlass 1 = „du hängst seit 3 Tagen am Beziehungs-Modell"; Stufe 3 = „über zwei Wochen kommst du in verschiedenen Kontexten immer wieder auf Autonomie-vs-Kontrolle zurück". 🔴 PRÜFSTEIN beim Bau: Lassen die verdichteten Episoden überhaupt ein solches Quer-Muster erkennen, das Anlass 1 nicht schon sieht? Wenn nein → Stufe 3 ist nicht von Anlass 1 unterscheidbar, NICHT bauen, auf mehr Episoden-Tiefe warten.

**2. Inferenz-Tiefe: faktisch, nicht bewertend.** Sicher (v1): „du kommst wiederholt auf X zurück" — beobachtbare Wiederkehr, kein Urteil. Heikel (NICHT v1): „du vermeidest Y" / „dir ist Z wichtiger geworden" / „du kreist um X, weil…" — Deutungen des Verhaltens/Innenlebens. Setzung: v1 STRIKT faktisch (beobachtbare Wiederkehr). Bewertende Tiefe ist spätere, separate Stufe — evtl. eine, die der Twin NIE ungefragt pusht, sondern nur auf Nachfrage anbietet (Lehre aus Anlass 2 Werte-Widerspruch).

**3. Approval-Pflicht vs. autonomer Push (Vision-Grenze).** TWIN-VISION Z.147: Inferenzen über den Owner sind approval-pflichtig, Twin darf nicht autonom „eigene Meinungen über Markus" speichern. Auflösung: (a) Muster-Nudge ist IMMER zuerst Pending (Inbox), eigenes Gate Default aus — Treffsicherheit erst sehen, bevor autonom gepusht wird. (b) Autonomer Push erst nach bewährter Treffsicherheit (Reflexions-Loop-Rhythmus). (c) 🔴 KERN-UNTERSCHEIDUNG: der Nudge SPEICHERT keine Inferenz als Fact — er ÄUSSERT eine Beobachtung (flüchtig). Bestätigt der Owner sie, KÖNNTE sie als approved Fact gespeichert werden (separater Schritt). So bleibt die Vision-Grenze (kein autonom gespeichertes Twin-Urteil) gewahrt.

**4. Wiederverwendung — fast alles steht.** synthesizeRetrospective (Stufe 1, public) = Treffer→Synthese, hier proaktiv am Loop statt reaktiv. Nudge-Pipeline (Anlass 1/3): Pending/Push/Fallback, anlass-bewusstes Dedup, Episode-Cooldown, Gate-Muster — 1:1 erbbar, neuer anlass:'muster'. NEU nur: (i) Detektor (Muster über verdichtete Episoden — braucht G2-Substanz, daher nach G2-Beweis), (ii) Generator-Prompt auf der faktischen Linie (Frage 2).

## Bau-Voraussetzung & erster Schritt

Bau startet NICHT vor dem G2-Beweis (Embeddings wachsen aus echtem Telegram-Verkehr). Erster Schritt dann = read-only Diagnose des Prüfsteins (Frage 1): erkennen die verdichteten Episoden ein Quer-Muster, das Anlass 1 nicht sieht? Nur bei Ja → bauen.
