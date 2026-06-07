# Tail-Flush-Verdichtungs-Verarbeiter — Bau-Strategie

**Status:** Strategie, NICHT gebaut. Erstellt Tag 40. Bau danach, sub-step.

## Befund (Diagnose Tag 40)
Substanzielle Konversationen sind un-verdichtet, weil ihr unsummarisierter Tail beim Konv-Ende durch alle Pfade fällt. Beleg: conv_m4J0tWfr4z-Gy5Ur (53 zählende Turns, 15 Tage, ended, embedding_status=pending) hat nur 1 summary_segment (Turns 1–40, via Schwelle 50/Batch 40) + 0 conversation-Embeddings; die Tail-Turns 41–53 (der jüngste Inhalt) sind in keinem Embedding. Ursache (Wurzel = L3): die Annahme „segCount>0 ⇒ Inhalt abgedeckt" ist falsch — Segmente decken den Tail nicht ab. resetConversation überspringt bei summaries>0 den Whole-Conv-Embed (twin-service.ts:514); start()-Invariante beendet ohne Embed (conversations/repo.ts:77–91); MemoryMaintenanceService skippt bei segCount>0 + setzt done (memory-maintenance-service.ts:117–123). L1 (G2 active-only) + L2 (kein auto pending-Verarbeiter) sind Symptome — sie liefern die Konv nur an einen Pfad, der erneut am segCount-Skip scheitert. Ein Whole-Conv-Embed (Option b) ist KEIN Ausweg: multilingual-e5-large trunkiert bei ~512 Tokens und schnitte ausgerechnet den Tail ab.

## Hebel (a, vereint): Tail-Flush in einem pending-Verarbeiter
Beim Aufgreifen einer beendeten pending-Konv: statt segCount-Skip → falls unsummarisierter Tail existiert (countPendingMessages>0), generateSummary auf den Tail-Range (Schwelle für Final-Flush ignorieren) → neues summary_segment → embedSummarySegment → dann status=done. Beide Bausteine existieren (summary-engine.generateSummary, memoryEmbeddingService.embedSummarySegment); neu ist nur der Aufruf-beim-Schließen + der Verarbeiter, der ihn über listPendingByTwin auf beendete Konv anwendet. Vereint L1 (greift beendete Konv) + L2 (auto-Verarbeiter) + L3 (Tail-Flush statt Skip) in einen Hebel.

## Design-Entscheidungen (Tag 40)
- **Gate: ENV-gated, Default AUS.** Grund nicht Gefahr, sondern kontrollierte Beobachtung der ersten Läufe (wie viele Tails, LLM-Kosten, Tail-Summary-Qualität). Nach 1–2 beobachteten Läufen scharfschaltbar. (Anders als G2 Default-AN, weil hier LLM-Calls + Kosten; gleicher Rhythmus wie Reflexions-Loop/Nudges.)
- **Gate-Entscheidung (Tag 40, Sub-Step 4 präzisiert):** EIN context-basiertes Gate (TAIL_FLUSH_AUTONOMOUS_ENABLED, Default AUS) deckt ALLE autonomen Auslöser ab (G2-Reset-Hook + Loop-Verarbeiter); manuelle/owner-getriggerte Pfade (Web-Reset, CLI-Backfill) sind IMMER erlaubt (kein autonomer Kostenfresser). Grund: die kontrollierte Beobachtung der ersten Läufe gilt für jeden autonomen Tail-Flush, nicht nur den Loop.
- **Batch-Limit pro Tick.** Der Verarbeiter greift den Bestand (viele ended pending-Tails) automatisch mit → ohne Limit ein Kosten-/Last-Spike beim ersten Lauf. Max N Konv pro Tick (ENV-justierbar) → Bestand über mehrere Ticks.
- **Backfill = derselbe Verarbeiter, erster Lauf kontrolliert manuell.** Kein separater Backfill-Code. Der erste Beweis-Lauf erfolgt manuell via CLI, eingegrenzt auf @markus (genau conv_m4J0tWfr4z-Gy5Ur), BEVOR der Loop-Schritt scharf geht.
- **Kosten-Gate:** Tail-Flush nur wenn Tail>0 (kein LLM-Call bei leerem Tail).

## Sub-Step-Sequenz (jeder mit Behavior-Verify dazwischen)
1. 🔴 **Idempotenz/Cursor read-only klären (Sub-Smoke-Gate 0, VOR jedem Code):** wie wird der Tail-Range exakt bestimmt (ab welcher audit-id/Cursor), wie wird der Cursor nach dem Flush gesetzt, was passiert bei einem ZWEITEN Lauf (kein Doppel-Segment, kein Doppel-Embedding)? Am Code belegen (summary-engine Cursor-Logik, conversation_summaries segment_end). Erst wenn die Disjunktheit garantiert ist → weiter.
2. **Tail-Flush-Primitive isoliert** (eine Funktion: gegebene Konv → falls Tail>0, summarisiere+embedde Tail, setze Cursor). Lokal gegen synthetische Konv testen: Tail wird disjunkt summarisiert, zweiter Aufruf ist No-op (Idempotenz).
3. **In resetConversation einklinken** (künftige Konv-Enden flushen den Tail statt zu überspringen). Lokal: lange Konv beenden → Tail-Segment entsteht. Regression: kurze Konv (summaries===0) weiter Whole-Embed; Konv ohne Tail kein Extra-Call.
4. **pending-Verarbeiter** (über listPendingByTwin, Batch-Limit, Tail-Flush statt segCount-Skip). Lokal gegen seedete pending-Konv: greift sie auf, flusht Tails, respektiert Batch-Limit.
5. **An Fokus-Loop hängen** (ENV-gated Default AUS, eigenes Flag). Lokal: Loop-Tick ruft den Verarbeiter; Flag-AUS → No-op; bestehende Loop-Schritte (G2 endIdle, Anlass 1/3) unberührt.
6. **Manueller @markus-Backfill-Beweis auf Prod** (CLI, eingegrenzt, conv_m4J0tWfr4z-Gy5Ur): Tail wird verdichtet → neue Embeddings → messen ob Retrieval/„Erinnerungen" besser variieren. ERST danach Loop-Flag scharf erwägen.

## Was es NICHT abdeckt
Konv, die vor dem Schwellwert endeten + gar kein Segment haben (laufen korrekt über summaries===0-Whole-Embed). Reine Live-Window-Konv <40 Turns (Whole-Embed greift). Keine Schema-Migration (nutzt conversation_summaries/embeddings).
