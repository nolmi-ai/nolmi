// ─── RELATIVE-TIME (Zeit-Erleben Stufe 1) ────────────────────────────────────
//
// Reiner Helper: ISO-Timestamp + „jetzt" → grob-menschliche deutsche Relativ-
// Zeit („gestern", „vor 3 Wochen"). Genutzt vom Episodic-Prompt-Builder, damit
// der Twin „lange her / frisch" wahrnimmt. Logik abgeleitet aus dem ISO→Tage-
// Präzedenz in twin-maturity-service.ts (Date.now()-Differenz / MS_PER_DAY).
//
// Bewusst grob (menschlich, nicht sekundengenau) und KALENDER-basiert für
// heute/gestern (ein Stempel von gestern 23:45 ist „gestern", auch wenn nur
// Stunden her). Die Wochen-/Monats-Buckets laufen über die Kalendertags-
// Differenz, damit es keine „gestern vs. vor 1 Tag"-Inkonsistenz gibt.
//
// Defensiv: leerer/ungültiger ISO-String → "" (NIE werfen — der Prompt-Bau
// darf an einer kaputten Zeit nicht scheitern). „now" vor dem Stempel (Zukunft
// / Clock-Skew) → „gerade eben" (kein negativer Wert).

const MS_PER_HOUR = 60 * 60 * 1000;
const MS_PER_DAY = 24 * MS_PER_HOUR;

/** Lokale Mitternacht eines Datums als Timestamp — Basis der Kalendertags-Diff. */
function startOfLocalDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/**
 * Grob-menschliche deutsche Relativ-Zeit. Schwellen:
 *   < 1 h .............. „gerade eben"   (deckt auch Zukunft/Clock-Skew ab)
 *   gleicher Kalendertag „heute"
 *   1 Kalendertag ...... „gestern"
 *   2–6 Kalendertage ... „vor X Tagen"
 *   7–34 Tage .......... „vor einer Woche" / „vor X Wochen"
 *   35–364 Tage ........ „vor einem Monat" / „vor X Monaten"
 *   ≥ 365 Tage ......... „vor über einem Jahr"
 */
export function relativeTime(isoTimestamp: string, now: Date): string {
  if (!isoTimestamp) return "";
  const then = new Date(isoTimestamp);
  if (Number.isNaN(then.getTime())) return "";

  const deltaMs = now.getTime() - then.getTime();
  // Zukunft / Clock-Skew / jünger als eine Stunde → „gerade eben".
  if (deltaMs < MS_PER_HOUR) return "gerade eben";

  const calDayDiff = Math.round(
    (startOfLocalDay(now) - startOfLocalDay(then)) / MS_PER_DAY,
  );
  if (calDayDiff <= 0) return "heute"; // gleicher Kalendertag, aber > 1 h her
  if (calDayDiff === 1) return "gestern";
  if (calDayDiff < 7) return `vor ${calDayDiff} Tagen`;

  if (calDayDiff < 35) {
    const weeks = Math.round(calDayDiff / 7);
    return weeks <= 1 ? "vor einer Woche" : `vor ${weeks} Wochen`;
  }
  if (calDayDiff < 365) {
    const months = Math.max(1, Math.round(calDayDiff / 30));
    return months === 1 ? "vor einem Monat" : `vor ${months} Monaten`;
  }
  return "vor über einem Jahr";
}
