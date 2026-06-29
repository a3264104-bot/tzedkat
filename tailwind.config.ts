import type { Config } from "tailwindcss";
const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          yellow: "#FFE000",
          cream: "#FFF8E1",
          rust: "#C0461E",
          rustdark: "#9A3412",
          slate: "#3F3F46",
          slatedark: "#27272A",
        },
      },
      fontFamily: {
        heebo: ["Heebo", "system-ui", "sans-serif"],
      },
    },
  },
  plugins: [],
};
export default config;
