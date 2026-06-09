import "dotenv/config";
import { loadRuntimeConfig } from "../config.js";
import { createSqliteRepository } from "../repository/index.js";
import { FocusSnapshotsRepo } from "../focus/focus-snapshots-repo.js";
import { embedThemesToBlob } from "../focus/focus-engine.js";
import { getEmbeddingProvider } from "../episodic/providers/index.js";

// ─── twin:backfill-theme-embeddings (CLI) ───────────────────────────────────
//
// Theme-Similarity SS3 (vorgezogen vor SS2). Embeddet die Fokus-Themen
// BESTEHENDER focus_snapshots nach, die vor SS1 (embed-on-create) erzeugt
// wurden und darum theme_embeddings_blob IS NULL tragen. Ohne Backfill müsste
// detectStuck (SS2) erst auf zwei FRISCHE Snapshots warten — und der Live-Tick
// erzeugt ohne neue Substanz keinen. Darum füllen wir die History einmalig auf.
//
// ── BOOTSTRAP bewusst minimal ──
// Anders als focus-loop-tick.ts braucht das Backfill WEDER masterKey/Registry
// NOCH Telegram: es liest themes_json (Klartext) aus focus_snapshots und
// embeddet mit dem LOKALEN Provider (in-process, kein Secret). Kein Push, kein
// LLM-Call, kein Decrypt. Nur: DB öffnen → Kandidaten lesen → embedden →
// BLOB-Spalte UPDATEn.
//
// ── Pack IDENTISCH zu SS1 ──
// Es wird EXAKT derselbe Helper benutzt wie embed-on-create (deriveFocus):
// `embedThemesToBlob` aus focus-engine.ts. Kein Duplikat — sonst läse SS2
// inkonsistente BLOBs (load-bearing, STOPP-Klausel SS3).
//
// ── Idempotent ──
// Verarbeitet NUR Snapshots mit BLOB IS NULL (listMissingThemeEmbeddings).
// Schon-embeddete werden gar nicht erst geladen → mehrfacher Lauf ist sicher
// (zweiter Lauf: 0 backfilled, alles skipped). Defensiv: embed-Fehler bei einem
// Snapshot wird geloggt + übersprungen, der Lauf bricht NICHT ab.
//
//   pnpm --filter @nolmi/runtime twin:backfill-theme-embeddings
//   pnpm --filter @nolmi/runtime twin:backfill-theme-embeddings -- --dry-run

async function main() {
  const dryRun = process.argv.includes("--dry-run");

  const config = loadRuntimeConfig();
  // createSqliteRepository setzt PRAGMAs + lädt sqlite-vec (harmlos hier,
  // kanonischer Opener). Wir nutzen nur die db-Connection.
  const bundle = createSqliteRepository(config.dbPath);
  const db = bundle.db;
  const focusRepo = new FocusSnapshotsRepo(db);
  const provider = getEmbeddingProvider();

  const candidates = focusRepo.listMissingThemeEmbeddings();
  console.log(
    `[backfill-theme-embeddings]${dryRun ? " [DRY-RUN]" : ""} ${candidates.length} Snapshot(s) ohne Theme-BLOB (mit Themen) gefunden. Provider: ${provider.modelName}.\n`,
  );

  let backfilled = 0;
  let skipped = 0;
  let errored = 0;

  for (const snap of candidates) {
    const themes = snap.themes;
    // Defensiv: themes_json war zwar gesetzt, könnte aber leer/defekt zu []
    // geparst sein → nichts zu embedden, sauber überspringen (kein Crash).
    if (themes.length === 0) {
      console.log(`  ⏭️  ${snap.id}: keine Themen → übersprungen`);
      skipped += 1;
      continue;
    }

    try {
      const blob = await embedThemesToBlob(provider, themes);
      if (!blob) {
        // null = Anzahl-Mismatch (Theme↔Vektor). Lieber kein BLOB als ein
        // verschobenes — übers­pringen, damit SS2 nichts Falsches liest.
        console.log(
          `  ⏭️  ${snap.id}: kein BLOB erzeugt (Anzahl-Mismatch, ${themes.length} Themen) → übersprungen`,
        );
        skipped += 1;
        continue;
      }

      if (dryRun) {
        console.log(
          `  🔎 ${snap.id}: ${themes.length} Themen → BLOB ${blob.byteLength} Bytes (DRY-RUN, nicht geschrieben)`,
        );
        backfilled += 1;
        continue;
      }

      const ok = focusRepo.setThemeEmbeddingsBlob(snap.id, blob);
      if (!ok) {
        console.warn(`  ⚠️  ${snap.id}: UPDATE traf 0 Rows (Snapshot weg?) → übersprungen`);
        skipped += 1;
        continue;
      }
      console.log(
        `  ✅ ${snap.id}: ${themes.length} Themen → BLOB ${blob.byteLength} Bytes geschrieben`,
      );
      backfilled += 1;
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      console.error(`  ❌ ${snap.id}: embed-Fehler (${reason}) → übersprungen`);
      errored += 1;
    }
  }

  console.log(
    `\n[backfill-theme-embeddings]${dryRun ? " [DRY-RUN]" : ""} fertig: ${backfilled} backfilled, ${skipped} skipped, ${errored} Fehler.`,
  );

  db.close();
  process.exit(errored > 0 ? 2 : 0);
}

main().catch((err) => {
  console.error(
    "[backfill-theme-embeddings] Fehler:",
    err instanceof Error ? err.message : err,
  );
  process.exit(1);
});
