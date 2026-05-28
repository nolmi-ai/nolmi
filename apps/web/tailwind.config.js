/** @type {import('tailwindcss').Config} */
//
// ─── Tavryn-Light Theme-Tokens (Rebrand-Phase 1, Tag 30) ────────────────────
// Light-first als visuelle Differenzierung gegen die dark-mode-Konkurrenz.
// Hart auf Light, kein Toggle. Spiegel in `apps/web/app/globals.css` als
// CSS-Variablen-Aliases (für sonner-Toaster und andere 3rd-Party-Konsumenten).
// Vollständiger Phasen-Plan + Mapping-Begründung: `docs/REBRAND-TAVRYN-STRATEGY.md`.
export default {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: "#F4F1EA",
        surface: "#FFFCF6",
        // Im Light invertiert die Hover-Lift-Logik gegenüber Dark: Hover ist
        // *dunkler* als der Grund, nicht heller. `#ECE8E0` (Guide Neutral-BG)
        // liegt leicht unter `bg #F4F1EA` und passt als Hover-Lift.
        "surface-hover": "#ECE8E0",
        border: "#D8D3CA",
        muted: "#6F6A60",
        text: "#111111",
        accent: "#1E9B5A",
        warn: "#C8332A",
        // Additive Status-Tokens (Branding-Guide). `success` ist semantisch
        // eigenständig (auch wenn Wert = accent), damit Call-Sites zwischen
        // "Akzent" und "Erfolgs-Semantik" trennen können.
        "accent-dark": "#178C4D",
        info: "#2F6FDB",
        warning: "#B86E00",
        pending: "#7A5CC8",
        success: "#1E9B5A",
      },
      fontFamily: {
        mono: ["IBM Plex Mono", "Courier New", "monospace"],
      },
    },
  },
  plugins: [],
};
