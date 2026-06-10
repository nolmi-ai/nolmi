import "dotenv/config";
import Database from "better-sqlite3";
import { parseArgs } from "node:util";
import { loadRuntimeConfig } from "../config.js";
import { TwinProfilesRepo } from "../twin-profiles-repo.js";
import { readSecret } from "./_prompt-helpers.js";

// ─── BRIDGE RECONCILE (CLI) — #744-Folge Orphan-Sweep ────────────────────────
//
// Findet verwaiste Bridge-Handles (auf der Bridge registriert, aber KEIN
// lebender Runtime-Twin mehr) und deregistriert sie über den Admin-Pfad. Diff:
//   Bridge-Handles (GET /admin/twins) MINUS lebende Runtime-Handles = Waisen.
//
// 🔴 DREI NICHT-VERHANDELBARE GUARDS:
//  1. Dry-run-Default: ohne --apply wird NICHTS gelöscht (nur Liste ausgeben).
//  2. Sanity-Floor: ist das Live-Set LEER (DB-Read-Fehler / frische Runtime),
//     HART ABBRECHEN — sonst sähe der Diff ALLE Bridge-Handles als Waisen und
//     würde alles löschen.
//  3. Konservative Quelle fest verdrahtet: das Live-Set ist `profilesRepo.list({})`
//     UNFILTERED (ALLE twin_profiles-Rows, NICHT activeOnly, NICHT registry.list()).
//     Nur ein per #744 HART gelöschter Twin hat gar keine Row → echte Waise.
//     Ein deaktivierter oder nicht-geladener (aber existierender) Twin bleibt
//     im Live-Set → wird NIE deregistriert. Zusätzlich pro Handle eine Doppel-
//     Prüfung vor dem DELETE.
//
// Admin-Token: ENV BRIDGE_ADMIN_TOKEN > --admin-token > readSecret-Prompt (NIE
// geloggt). Runtime-DB wird NUR gelesen (readonly).
//
//   pnpm --filter @nolmi/runtime twin:bridge-reconcile --bridge-url <url>           # Dry-run
//   pnpm --filter @nolmi/runtime twin:bridge-reconcile --bridge-url <url> --apply   # tatsächlich entfernen

interface AdminTwinList {
  twins?: Array<{ handle?: string }>;
}

function normHandle(h: string): string {
  const t = h.trim();
  return t.startsWith("@") ? t : `@${t}`;
}

async function resolveAdminToken(
  argToken: string | undefined,
  bridgeUrl: string,
): Promise<string> {
  let token =
    process.env.BRIDGE_ADMIN_TOKEN?.trim() || argToken?.trim() || "";
  if (!token) {
    token = (
      await readSecret(`Admin-Token für ${bridgeUrl} (kein Echo): `)
    ).trim();
  }
  if (!token) {
    throw new Error(
      "Kein Admin-Token — der /admin-Endpoint verlangt BRIDGE_ADMIN_TOKEN. Abbruch.",
    );
  }
  return token;
}

async function main() {
  const { values } = parseArgs({
    allowPositionals: true,
    options: {
      "bridge-url": { type: "string" },
      "admin-token": { type: "string" },
      apply: { type: "boolean", default: false },
    },
    strict: true,
  });

  const bridgeUrl = values["bridge-url"]?.trim();
  if (!bridgeUrl) {
    throw new Error(
      "--bridge-url fehlt. Nutzung:\n" +
        "  pnpm --filter @nolmi/runtime twin:bridge-reconcile --bridge-url <url> [--apply] [--admin-token <token>]",
    );
  }
  const apply = values.apply === true;

  // ── Schritt 1: Live-Set = ALLE twin_profiles-Handles (konservativ, readonly) ──
  const config = loadRuntimeConfig();
  const db = new Database(config.dbPath, { readonly: true });
  let liveSet: Set<string>;
  try {
    const profiles = new TwinProfilesRepo(db).list({}); // UNFILTERED — Guard #3
    liveSet = new Set(profiles.map((p) => normHandle(p.handle)));
  } finally {
    db.close();
  }

  // 🔴 Guard #2 — Sanity-Floor: leeres Live-Set → kein Sweep (sonst Massenlöschung).
  if (liveSet.size === 0) {
    throw new Error(
      "Live-Set leer (0 twin_profiles) — verdächtig (DB-Read-Fehler oder frische Runtime?). " +
        "Reconcile abgebrochen, KEIN Sweep. Manuell prüfen.",
    );
  }
  console.log(
    `[twin:bridge-reconcile] Live-Set: ${liveSet.size} Runtime-Handle(s) — ${[...liveSet].join(", ")}`,
  );

  // ── Schritt 2: Bridge-Handles holen (Admin-Liste) ──
  const adminToken = await resolveAdminToken(values["admin-token"], bridgeUrl);
  const base = bridgeUrl.replace(/\/$/, "");

  let bridgeHandles: string[];
  try {
    const res = await fetch(`${base}/admin/twins`, {
      method: "GET",
      headers: { "x-admin-token": adminToken },
    });
    if (res.status === 401) throw new Error("Admin-Token falsch oder fehlt (Bridge: 401).");
    if (res.status === 503)
      throw new Error(
        "Admin-Endpoint auf der Bridge nicht konfiguriert — BRIDGE_ADMIN_TOKEN auf der Bridge setzen (503).",
      );
    if (res.status !== 200) {
      const body = await res.text().catch(() => "");
      throw new Error(`GET /admin/twins → HTTP ${res.status}${body ? `: ${body}` : ""}`);
    }
    const json = (await res.json()) as AdminTwinList;
    bridgeHandles = (json.twins ?? [])
      .map((t) => t.handle)
      .filter((h): h is string => typeof h === "string" && h.length > 0)
      .map(normHandle);
  } catch (err) {
    // Bridge nicht erreichbar / Parsing → Abbruch, KEIN Löschen.
    throw new Error(
      `Bridge-Liste konnte nicht geholt werden (kein Sweep): ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }

  // ── Schritt 3: Diff = Bridge MINUS Live = Waisen ──
  const orphans = bridgeHandles.filter((h) => !liveSet.has(h));
  console.log(
    `[twin:bridge-reconcile] Bridge: ${bridgeHandles.length} Handle(s); davon ${orphans.length} Waise(n).`,
  );

  if (orphans.length === 0) {
    console.log("[twin:bridge-reconcile] Nichts zu tun — Bridge und Runtime sind deckungsgleich.");
    return;
  }

  if (!apply) {
    console.log("\n── DRY-RUN (nichts gelöscht) — würde deregistrieren: ──");
    for (const h of orphans) console.log(`  - ${h}`);
    console.log("\n  → mit --apply tatsächlich entfernen.");
    return;
  }

  // ── --apply: je Waise DELETE /admin/twins/:handle ──
  console.log("\n── APPLY — deregistriere Waisen: ──");
  let removed = 0;
  let failed = 0;
  for (const h of orphans) {
    // 🔴 Doppel-Prüfung (Guard #3 defensiv): NIE löschen, was im Live-Set ist.
    if (liveSet.has(h)) {
      console.warn(`  ⚠️  ${h}: im Live-Set — übersprungen (sollte nie passieren).`);
      continue;
    }
    try {
      const res = await fetch(`${base}/admin/twins/${encodeURIComponent(h)}`, {
        method: "DELETE",
        headers: { "x-admin-token": adminToken },
      });
      if (res.status !== 200) {
        const body = await res.text().catch(() => "");
        console.error(`  ❌ ${h}: HTTP ${res.status}${body ? `: ${body}` : ""}`);
        failed += 1;
        continue;
      }
      const deleted = ((await res.json()) as { deleted?: boolean }).deleted === true;
      console.log(`  ✅ ${h}: deleted=${deleted}`);
      if (deleted) removed += 1;
    } catch (err) {
      console.error(`  ❌ ${h}: ${err instanceof Error ? err.message : String(err)}`);
      failed += 1;
    }
  }
  console.log(
    `\n[twin:bridge-reconcile] fertig: ${removed} deregistriert, ${failed} Fehler, ${liveSet.size} lebende unberührt.`,
  );
  if (failed > 0) process.exit(2);
}

main().catch((err) => {
  console.error(
    "[twin:bridge-reconcile] Fehler:",
    err instanceof Error ? err.message : err,
  );
  process.exit(1);
});
