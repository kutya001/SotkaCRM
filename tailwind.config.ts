import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: "class",
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        background: "var(--background)",
        foreground: "var(--foreground)",
        island: {
          light: "rgba(255, 255, 255, 0.75)",
          dark: "rgba(24, 24, 27, 0.75)",
        },
      },
      backdropBlur: {
        island: "20px",
      },
      borderRadius: {
        "2.5xl": "20px",
        "3xl": "24px",
      },
    },
  },
  plugins: [],
};

export default config;
