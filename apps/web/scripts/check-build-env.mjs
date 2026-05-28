#!/usr/bin/env node
//
// ─── BUILD-GUARD: NEXT_PUBLIC_RUNTIME_URL (#126) ────────────────────────────
//
// Strukturelle Lösung für den localhost:4000-im-Client-Bundle-Bug, der
// auf Tag 23, 28 und 29 dreimal zugeschlagen hat: Production-Build ohne
// `--build-arg NEXT_PUBLIC_RUNTIME_URL=https://...` → localhost landet
// ins Client-Bundle → Login + alle /twins-Calls scheitern mit
// "Failed to fetch".
//
// Guard koppelt sich an den existierenden Production-Marker
// `NEXT_PUBLIC_DEPLOYMENT_LABEL=production`:
//   - Label gesetzt auf "production" + RUNTIME_URL fehlt oder ist
//     localhost/127.0.0.1 → exit 1 mit handlungsleitender Meldung.
//   - Sonst (dev, leerer Label, lokaler Build) → no-op, localhost-
//     Default ist hier korrekt.
//
// Wird als `prebuild`-npm-Hook getriggert (siehe package.json). pnpm
// folgt der npm-Hook-Konvention, das predev-Pattern in dieser package.json
// belegt das. Husky-Pre-Push macht `pnpm -r build` ohne DEPLOYMENT_LABEL —
// Guard bleibt dort no-op, der Push-Hook bricht nicht.

const label = process.env.NEXT_PUBLIC_DEPLOYMENT_LABEL?.trim();
const url = process.env.NEXT_PUBLIC_RUNTIME_URL?.trim();

if (label !== "production") {
  // Dev/local/leerer Label: alles erlaubt.
  process.exit(0);
}

const isMissing = !url || url.length === 0;
const isLocalhost = url && /localhost|127\.0\.0\.1/.test(url);

if (!isMissing && !isLocalhost) {
  process.exit(0);
}

const reason = isMissing
  ? "ist nicht gesetzt"
  : `zeigt auf localhost ('${url}')`;

console.error(
  "\n[build-guard #126] FEHLER: NEXT_PUBLIC_DEPLOYMENT_LABEL=production, " +
    `aber NEXT_PUBLIC_RUNTIME_URL ${reason}.\n\n` +
    "Production-Builds brauchen eine echte Runtime-URL — sonst landet\n" +
    "der localhost-Default im Client-Bundle und alle Browser-Calls\n" +
    "schlagen mit 'Failed to fetch' fehl (Tag 23/28/29-Regression).\n\n" +
    "Fix:\n" +
    "  docker build \\\n" +
    "    --build-arg NEXT_PUBLIC_RUNTIME_URL=https://runtime.<deine-domain> \\\n" +
    "    --build-arg NEXT_PUBLIC_DEPLOYMENT_LABEL=production \\\n" +
    "    -t twin-lab-web:latest \\\n" +
    "    -f apps/web/Dockerfile .\n\n" +
    "Wenn du lokal einen Production-Build testen willst:\n" +
    "  unset NEXT_PUBLIC_DEPLOYMENT_LABEL  # oder NEXT_PUBLIC_DEPLOYMENT_LABEL=\n",
);
process.exit(1);
