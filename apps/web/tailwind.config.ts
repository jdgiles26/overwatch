import type { Config } from "tailwindcss";

export default {
  content: ["./src/**/*.{ts,tsx,js,jsx,md,mdx}"],
  darkMode: "class",
  theme: {
    extend: {
      fontFamily: {
        mono: ["JetBrains Mono", "ui-monospace", "Menlo", "monospace"],
        display: ["Geist", "Inter", "system-ui", "sans-serif"],
      },
      colors: {
        ink: {
          950: "#05070a",
          900: "#0a0e14",
          800: "#0f141b",
          700: "#151c26",
          600: "#1c2530",
        },
        accent: {
          500: "#38e0b2",
          400: "#5cf0c9",
        },
        threat: {
          nominal: "#00c48c",
          guarded: "#5cf0c9",
          elevated: "#ffb020",
          high: "#ff6a3d",
          critical: "#ff3860",
        },
        nightvision: {
          DEFAULT: "#27ff7f",
          dim: "#0b3e21",
        },
      },
      boxShadow: {
        panel: "0 0 0 1px rgba(255,255,255,0.05), 0 20px 60px -30px rgba(0,0,0,0.6)",
      },
    },
  },
  plugins: [],
} satisfies Config;
