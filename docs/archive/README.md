# Archive

Ausgelagerte Doku-Stände. Aktive Doku unter `docs/` ohne `archive/`-Prefix.

## STAND-Auslagerungen

- `STAND-history-pre-tag25.md` — Phase 2.5 bis Tag 24 (23. Mai 2026).
  Ausgelagert Tag 28 Block 18 (26. Mai 2026) für Lesbarkeit des Live-STAND.

## BACKLOG-Auslagerungen

- `BACKLOG-closed-pre-tag26.md` — Closed-Items mit Closure-Datum vor Tag 26
  (24. Mai 2026). Ausgelagert Tag 28 Block 18 für Lesbarkeit des
  Live-BACKLOG.

## Phase-Strategy-Docs (closed)

- `3.4-STRATEGY.md` — Phase 3.4 Episodic-Memory + Embeddings (deployed Tag 15)
- `3.4.I-STRATEGY.md` — Sub-Strategy 3.4 (Embedding-Pipeline)
- `3.4-SMOKE.md` — Phase 3.4 Smoke-Plan
- `3.5-STRATEGY.md` — Phase 3.5 Hyperbrowser-Foundation (deployed Tag 17)
- `3.5-SPIKE-89-FINDINGS.md` — Spike-Findings zu #89 (Multi-Step-Tool-
  Hallucinations, Step-Walk-Patch als Wurzel-Fix)

## Konvention

Strategy-Docs leben in `docs/` während ihre Phase aktiv ist und wandern nach
Phase-Closure hierher. Live-STAND und Live-BACKLOG werden bei substantieller
Größe partiell hierher ausgelagert (Schnitt-Datum oben im Auslagerungs-File
dokumentiert). Lessons werden in den Live-Files (`docs/STAND.md`,
`docs/BACKLOG.md`) konsolidiert; Archive-Files bleiben für historische
Nachvollziehbarkeit und Architektur-Entscheidungs-Audit-Trail.

Cross-Ref: BACKLOG #158 (Strategy-Doc-Lifecycle-Konvention).
