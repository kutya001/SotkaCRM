import type { Config } from "tailwindcss";
import animate from "tailwindcss-animate";

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
      // Единая шкала слоев: панель массовых действий < модалка < вложенная модалка < поповер < тост
      zIndex: {
        bulk: "900",
        modal: "1000",
        "modal-2": "1100",
        popover: "1200",
        toast: "1300",
      },
      spacing: {
        "4.5": "1.125rem",
        "18": "4.5rem",
      },
      boxShadow: {
        xs: "0 1px 2px 0 rgb(0 0 0 / 0.04)",
      },
    },
  },
  plugins: [animate],
};

export default config;
