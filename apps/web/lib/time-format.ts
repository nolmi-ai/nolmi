// ─── time-format (#99) ───────────────────────────────────────────────────────
//
// Relative Zeitangaben für UI-Stellen, die "wann war das" als Hauptinfo
// brauchen (Audit-Detail, Konversations-Liste). Ursprünglich lokal in
// chat/[handle]/page.tsx, in #99 extrahiert weil Audit-Render-Templates
// dieselbe Logik brauchen — Duplikat hätte zwei Stellen zur Pflege.
//
// Schwellen: <60 Sek → "gerade eben", <60 Min → "vor N Min", <24 Std →
// "vor N Std", <7 Tage → "vor N Tagen", sonst absolutes Datum
// ("13.05.2026"). Bei > 7 Tagen wäre relative Angabe weniger nützlich
// als das tatsächliche Datum, das man dann mit dem Kalender vergleichen
// kann.

export function formatRelative(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return iso;
  const diff = Date.now() - then;
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return "gerade eben";
  const min = Math.floor(sec / 60);
  if (min < 60) return `vor ${min} Min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `vor ${h} Std`;
  const d = Math.floor(h / 24);
  if (d < 7) return `vor ${d} Tag${d === 1 ? "" : "en"}`;
  return new Date(iso).toLocaleDateString("de-DE");
}
