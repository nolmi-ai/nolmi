-- Migration 032: Theme-Embeddings auf focus_snapshots (Theme-Similarity SS1).
--
-- Speichert die Embedding-Vektoren der ≤5 Fokus-Themen, EINMAL bei der
-- Snapshot-Erzeugung (deriveFocus) berechnet (1 batched local-Call), als EIN
-- konkateniertes Float32-BLOB (themes.length × dim × 4 Bytes, Reihenfolge =
-- themes-Reihenfolge). detectStuck (SS2) liest nur die gespeicherten Vektoren
-- → reine JS-Cosine-Rechnung, 0 neue Token zur Detektionszeit.
--
-- BEWUSST getrennt von embeddings/embeddings_vec: das ist Memory-Retrieval-KNN
-- (vec0), Theme-Fragmente würden die Reverse-Suche verschmutzen. Hier reicht
-- eine BLOB-Spalte auf focus_snapshots (paarweise Cosine, kein Korpus-KNN);
-- lifecycle-gekoppelt — mit dem Snapshot gelöscht.
--
-- Additiv: nullable ADD COLUMN, kein Table-Rebuild. Alt-Snapshots bekommen NULL
-- (bis Backfill SS3); der detectStuck-Fallback (SS2) fängt NULL-BLOBs ab. Plain
-- ALTER → kein foreign_keys_off-Marker nötig (wie 031).

ALTER TABLE focus_snapshots ADD COLUMN theme_embeddings_blob BLOB;
