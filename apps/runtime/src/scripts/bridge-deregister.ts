import "dotenv/config";
import { parseArgs } from "node:util";
import { readSecret } from "./_prompt-helpers.js";

// ─── BRIDGE DEREGISTER (CLI) — #744-Rest Orphan-Cleanup ──────────────────────
//
// Entfernt einen VERWAISTEN Handle von der Bridge: ein Twin wurde im Runtime
// gelöscht, aber der damalige Bridge-Deregister schlug fehl (bridgeOrphan) →
// der Handle blockt das Re-Onboarding (POST /twins/register → 409). Da der
// Twin-Token mit dem Runtime-Twin verloren ging, kann die per-twin-Route ihn
// nicht mehr löschen — dieser CLI nutzt den twin-UNABHÄNGIGEN Admin-Pfad
// (DELETE /admin/twins/:handle, X-Admin-Token), gebaut in der Bridge (SS1).
//
// KEINE DB-Berührung im Runtime: der Cleanup ist rein bridge-seitig.
//
// Aufruf:
//   pnpm --filter @nolmi/runtime twin:bridge-deregister <@handle> --bridge-url <url>
//   # Admin-Token via ENV BRIDGE_ADMIN_TOKEN ODER --admin-token <token>
//   # ODER interaktiver readSecret-Prompt (kein Echo). NIE geloggt.

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      "bridge-url": { type: "string" },
      "admin-token": { type: "string" },
    },
    strict: true,
  });

  const rawHandle = positionals[0]?.trim();
  if (!rawHandle) {
    throw new Error(
      "Handle fehlt. Nutzung:\n" +
        "  pnpm --filter @nolmi/runtime twin:bridge-deregister <@handle> --bridge-url <url> [--admin-token <token>]",
    );
  }
  const handle = rawHandle.startsWith("@") ? rawHandle : `@${rawHandle}`;

  const bridgeUrl = values["bridge-url"]?.trim();
  if (!bridgeUrl) {
    throw new Error(
      "--bridge-url fehlt — URL der Bridge angeben (z.B. http://127.0.0.1:5100).",
    );
  }

  // Admin-Token: ENV > Arg > interaktiver Prompt (kein Echo). NIE loggen/ausgeben.
  let adminToken =
    process.env.BRIDGE_ADMIN_TOKEN?.trim() ||
    values["admin-token"]?.trim() ||
    "";
  if (!adminToken) {
    adminToken = (
      await readSecret(`Admin-Token für ${bridgeUrl} (kein Echo): `)
    ).trim();
  }
  if (!adminToken) {
    throw new Error(
      "Kein Admin-Token — der /admin-Endpoint verlangt BRIDGE_ADMIN_TOKEN. Abbruch.",
    );
  }

  const url = `${bridgeUrl.replace(/\/$/, "")}/admin/twins/${encodeURIComponent(
    handle,
  )}`;
  console.log(`[twin:bridge-deregister] DELETE ${handle} an ${bridgeUrl} …`);

  let res: Response;
  try {
    res = await fetch(url, {
      method: "DELETE",
      headers: { "x-admin-token": adminToken },
    });
  } catch (err) {
    // ECONNREFUSED / DNS / Timeout — fetch wirft TypeError mit cause.
    throw new Error(
      `Bridge nicht erreichbar unter ${bridgeUrl}: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }

  if (res.status === 200) {
    let deleted = false;
    try {
      deleted = ((await res.json()) as { deleted?: boolean }).deleted === true;
    } catch {
      // Leerer/ungültiger Body — als „nichts entfernt" werten.
    }
    console.log(
      deleted
        ? `[twin:bridge-deregister] ✓ ${handle} deregistriert (Row entfernt). Re-Onboarding ist wieder frei.`
        : `[twin:bridge-deregister] ✓ ${handle} war bereits weg (kein Eintrag) — nichts zu tun (idempotent).`,
    );
    return;
  }
  if (res.status === 401) {
    throw new Error("Admin-Token falsch oder fehlt (Bridge: 401).");
  }
  if (res.status === 503) {
    throw new Error(
      "Admin-Endpoint auf der Bridge nicht konfiguriert — BRIDGE_ADMIN_TOKEN auf der Bridge setzen (503).",
    );
  }

  // Unerwarteter Status — Detail aus dem Body ziehen, dann ehrlich werfen.
  let detail = "";
  try {
    detail = ((await res.json()) as { error?: string }).error ?? "";
  } catch {
    detail = await res.text().catch(() => "");
  }
  throw new Error(
    `Bridge DELETE /admin/twins/${handle} → HTTP ${res.status}${
      detail ? `: ${detail}` : ""
    }`,
  );
}

main().catch((err) => {
  console.error(
    "[twin:bridge-deregister] Fehler:",
    err instanceof Error ? err.message : err,
  );
  process.exit(1);
});
