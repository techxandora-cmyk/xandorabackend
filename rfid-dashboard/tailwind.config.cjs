/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./index.html", "./src/**/*.{js,jsx,ts,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        // driven by CSS variables set by the theme class
        accent: "rgb(var(--accent) / <alpha-value>)",
        accent2: "rgb(var(--accent-2) / <alpha-value>)",
        surface: {
          light: "rgba(255,255,255,0.7)",
          dark: "rgba(255,255,255,0.06)",
        },
      },
      boxShadow: {
        card: "0 6px 30px -12px rgba(0,0,0,0.25)",
        glow: "0 0 18px rgba(168, 85, 247, 0.45), 0 0 38px rgba(99, 102, 241, 0.35)",
        "glow-soft": "0 0 14px rgba(168, 85, 247, 0.28)",
      },
      backgroundImage: {
        "glow-radial":
          "radial-gradient(1200px 600px at 20% -10%, rgba(168,85,247,0.20), transparent 50%), radial-gradient(900px 500px at 120% 20%, rgba(99,102,241,0.18), transparent 55%)",
        "glow-linear":
          "linear-gradient(180deg, rgba(17,17,17,0) 0%, rgba(17,17,17,0.25) 70%, rgba(17,17,17,0.6) 100%)",
      },
      ringColor: {
        accent: "rgb(var(--accent) / 0.5)",
      },
    },
  },
  plugins: [],
};
