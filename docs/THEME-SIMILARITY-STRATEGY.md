# Semantische Theme-Überlappung für detectStuck — Bau-Strategie

**Status:** Strategie, NICHT gebaut. Erstellt Tag 42. Teil von Wow-Strang 1 (proaktiver Einwurf). Grundbaustein, auch für Strang 2 (Dream-Einsichten) wiederverwendbar.

## Problem
detectStuck (proactive-nudge-service.ts:83) vergleicht Fokus-Themen exakt (norm = trim+lowercase, :61). Reale Themen aus deriveFocus sind variabel formuliert ("Agent Readiness Framework" vs "Agent Readiness als HARWAY-Produktfeld") → exakte Schnittmenge fast immer leer → detectStuck feuert nie (0 proaktive Einwürfe je). Beweis Tag 42: 8.6.- und 9.6.-Snapshot teilen inhaltlich 4 Themen, aber kein String ist identisch → not-stuck.

## Lösung: semantische Überlappung via Theme-Embeddings
Zwei Themen "gleich", wenn ihre Embeddings Cosine ≥ Schwelle (~0.85-0.90). 🔴 Embeddings NICHT zur Detektionszeit erzeugen (bricht das "0-Token-Detektion"-Prinzip + provider-abhängig), sondern EINMAL bei der Snapshot-Erzeugung (deriveFocus, wo eh ein LLM-Call läuft) berechnen + speichern. detectStuck liest nur die gespeicherten Vektoren → reine JS-Cosine-Rechnung, 0 neue Token.

## Diagnose-Befunde (verbindlich)
- Themen werden heute NICHT embedded (EmbeddingTargetType kennt kein 'theme'/'focus_snapshot') → Neubau.
- embed-Provider default lokal (Xenova/multilingual-e5-large, transformers.js, in-process) → gratis + batched (≤5 Themen = 1 Call), normalisiert (Cosine = Dot-Product).
- focus-engine (FocusEngineDeps) hat noch keinen Embedding-Provider → injizieren wie memory-embedding-service (lazy getEmbeddingProvider).
- 🔴 Speichern als BLOB-Spalte auf focus_snapshots (NICHT in embeddings/vec0 — das ist für Memory-Retrieval-KNN, Theme-Fragmente würden die Reverse-Suche verschmutzen). Pack/Unpack via vorhandene f32ToBuffer/bufferToF32 (embeddings-repo.ts:156/161). Lifecycle-gekoppelt (mit Snapshot gelöscht).
- Cosine = JS-Dot-Product normalisierter Float32Arrays (kein vec0 — das ist Korpus-KNN, nicht paarweise). ≤25 Dot-Products pro Schritt → vernachlässigbar.

## Setzungen (Tag 42, verbindlich)
1. **Embed bei Erzeugung, nicht bei Detektion.** deriveFocus embedded die ≤5 Themen (1 batched local-Call) + speichert die Vektoren. detectStuck rechnet nur.
2. **BLOB-Spalte auf focus_snapshots** (theme_embeddings_blob, ≤5×1024 Float32 konkateniert). Additive Migration. Getrennt von embeddings/vec0.
3. **Cosine-Schwelle ~0.85 Start**, empirisch an echten Theme-Paaren kalibrieren (8.6.↔9.6. sollte matchen).
4. **Backfill für bestehende Snapshots** — sonst feuert detectStuck erst nach 2 neuen Snapshots. Ein CLI berechnet die Theme-Embeddings für vorhandene focus_snapshots nach → sofort testbar an 8.6./9.6.
5. **Wiederverwendbar für Strang 2:** dieselbe Theme-Ähnlichkeit dient später der Dream-Einsicht (wiederkehrende Themen über Zeit erkennen).

## Sub-Step-Sequenz
**SS1 — Embed-on-create + Speicher (M, Migration):** Migration theme_embeddings_blob auf focus_snapshots. focus-engine bekommt injizierte Embedding-Provider-Dep; deriveFocus embedded die Themen (1 batched Call) + speichert den BLOB via f32ToBuffer. focusRepo.insert/Row um die Spalte (additiv). Lokal: neuer Snapshot hat Theme-Vektoren gespeichert; bestehende Logik unberührt.
**SS2 — detectStuck Cosine-Rewrite (S):** die Set-Schnittmenge (:181-184) → Cosine-Verengung (zwei Themen gleich wenn Dot-Product ≥ Schwelle), gleiche Chain-Struktur. norm()-Pfad als Fallback wenn ein Vektor fehlt (defensiv). Lokal: zwei themen-ähnliche Snapshots (verschiedene Strings) → stuck; themen-verschiedene → not-stuck.
**SS3 — Backfill-CLI (S):** Skript, das für bestehende focus_snapshots ohne Theme-BLOB die Embeddings nachberechnet + speichert. Lokal: bestehende Snapshots bekommen Vektoren.

## Verify (Prod)
Backfill laufen lassen → die 8.6.+9.6.-Snapshots haben Theme-Vektoren → twin:focus-tick → detectStuck erkennt die semantische Überlappung (Nolmi/Agent-Readiness ziehen sich durch) → stuck → LLM-shouldNudge → autonomer Telegram-Einwurf.

## NICHT in diesem Stück
Dream-Einsichten (Strang 2, nutzt die Theme-Ähnlichkeit später); Embedding-Provider-Wechsel; Schwellen-Auto-Tuning.
