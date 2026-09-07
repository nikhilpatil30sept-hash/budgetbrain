/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: [
          "'Nunito Variable'",
          "ui-rounded",
          "system-ui",
          "-apple-system",
          "'Segoe UI'",
          "sans-serif",
        ],
      },
      colors: {
        // Warm, energetic brand — coral core with a cream world around it.
        // 500/600/700 darkened from the original FF6B35/F04E0F/C63E0A --
        // those failed WCAG AA contrast (2.83:1 and 3.5:1) against the
        // white button/nav-pill text and near-white link backgrounds that
        // use them (caught by the axe-core accessibility smoke test).
        // Same hue, deeper so text/icons on top of them hit >=4.5:1.
        brand: {
          50: "#FFF3EE",
          100: "#FFE4D9",
          200: "#FFC7B0",
          300: "#FFA382",
          400: "#FF8557",
          500: "#C64207",
          600: "#A63709",
          700: "#812B07",
        },
        cream: {
          50: "#FDFAF5",
          100: "#FAF4EA",
          200: "#F3E9D9",
        },
        // 400 darkened from #9C8F86 (3.14:1 vs white) -- too light at the
        // small bold sizes it's used at (muted labels, percentages, dates)
        // across ~14 files; caught by the axe-core accessibility smoke test.
        ink: {
          900: "#3B2F2A",
          600: "#6B5D55",
          400: "#766960",
        },
        // AI / magic accent
        // 500 darkened from #7C5CFF (4.34:1 vs white text -- just under
        // the 4.5:1 floor, on the "Auto-label" button).
        spark: {
          100: "#EDE7FF",
          500: "#704DFF",
          600: "#6647E8",
        },
        // Friendly heads-up (flags) — warm honey, not alarm-red
        // 700 darkened from #B87400 (3.58:1 on its own honey-50 background)
        // -- used for anomaly-flag text/amounts/buttons.
        honey: {
          50: "#FFF8E6",
          200: "#FFE9AD",
          500: "#F5A623",
          700: "#996000",
        },
        grow: {
          50: "#EAF9EF",
          500: "#2FA84F",
          600: "#238B3F",
          700: "#1B7233",
        },
      },
      borderRadius: {
        blob: "1.75rem",
      },
      boxShadow: {
        soft: "0 2px 12px rgba(59,47,42,0.06), 0 1px 3px rgba(59,47,42,0.05)",
        lift: "0 10px 28px rgba(59,47,42,0.12), 0 3px 8px rgba(59,47,42,0.06)",
        press: "inset 0 2px 4px rgba(59,47,42,0.08)",
      },
      keyframes: {
        float: {
          "0%, 100%": { transform: "translateY(0)" },
          "50%": { transform: "translateY(-6px)" },
        },
        wiggle: {
          "0%, 100%": { transform: "rotate(-4deg)" },
          "50%": { transform: "rotate(4deg)" },
        },
        "pop-in": {
          "0%": { transform: "scale(0.6)", opacity: "0" },
          "70%": { transform: "scale(1.08)" },
          "100%": { transform: "scale(1)", opacity: "1" },
        },
        shimmer: {
          "0%": { backgroundPosition: "-200% 0" },
          "100%": { backgroundPosition: "200% 0" },
        },
      },
      animation: {
        float: "float 3.5s ease-in-out infinite",
        wiggle: "wiggle 0.5s ease-in-out",
        "pop-in": "pop-in 0.35s cubic-bezier(0.34,1.56,0.64,1) both",
        shimmer: "shimmer 1.8s linear infinite",
      },
    },
  },
  plugins: [],
};
