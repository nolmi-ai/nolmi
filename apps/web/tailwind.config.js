/** @type {import('tailwindcss').Config} */
export default {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: "#0a0a0a",
        surface: "#141414",
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
