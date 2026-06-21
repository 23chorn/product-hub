/** @type {import('tailwindcss').Config} */

// Color ramp backed by CSS variables (see src/styles/themes.css). Stored as RGB
// channels so opacity modifiers (e.g. bg-brand-500/30) keep working.
const SHADES = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950];
const ramp = (name) =>
  Object.fromEntries(
    SHADES.map((shade) => [shade, `rgb(var(--${name}-${shade}) / <alpha-value>)`]),
  );

export default {
  darkMode: 'class',
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        brand: ramp('brand'),
        surface: ramp('surface'),
      },
      fontFamily: {
        sans: ['"Space Grotesk"', 'system-ui', '-apple-system', 'sans-serif'],
      },
      boxShadow: {
        'glow-brand': '0 0 15px -3px rgb(var(--brand-500) / 0.3)',
        'glow-brand-sm': '0 0 8px -2px rgb(var(--brand-500) / 0.25)',
      },
      backgroundImage: {
        'gradient-radial': 'radial-gradient(var(--tw-gradient-stops))',
      },
    },
  },
  plugins: [
    require('@tailwindcss/typography'),
  ],
}
