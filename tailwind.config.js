/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./hooks/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        primary: "#1A1A1A",
        "brand-accent": "#0047AB",
        "off-white": "#F9FAFB",
        "background-light": "#FAFAFA",
        "background-dark": "#121212",
        "border-light": "#E5E7EB",
        "border-dark": "#333333",
        "text-secondary-light": "#9CA3AF",
        "card-light": "#FFFFFF",
        "card-dark": "#1F2937",
        "accent-blue": "#2563EB",
        "accent-purple": "#A855F7",
        "accent-indigo": "#6366F1",
      },
      fontFamily: {
        sans: ['"Inter"', "sans-serif"],
        serif: ['"Playfair Display"', "serif"],
        display: ['"Playfair Display"', "serif"],
      },
      borderRadius: {
        DEFAULT: "0.5rem",
        xl: "1rem",
        "2xl": "1.5rem",
      },
    },
  },
  plugins: [],
};
