/** @type {import('tailwindcss').Config} */
export default {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: "#0a0a0a",
        surface: "#141414",
        // UX.1.A.2.B: subtiler Lift gegenüber `surface` für Hover-States
        // (z.B. Ghost-Button-Hover). Vorher fehlte das Token, ein
        // `hover:bg-surface-hover` im RejectReasonModal war Tailwind-no-op.
        "surface-hover": "#1f1f1f",
        border: "#2a2a2a",
        muted: "#666666",
        text: "#e8e8e8",
        accent: "#4a9e6a",
        warn: "#cc4444",
      },
      fontFamily: {
        mono: ["IBM Plex Mono", "Courier New", "monospace"],
      },
    },
  },
  plugins: [],
};
