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
        mono: ['"JetBrains Mono"', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'Monaco', 'Consolas', '"Liberation Mono"', '"Courier New"', 'monospace'],
      },
      keyframes: {
        'fade-in': {
          '0%': { opacity: '0', transform: 'translateY(4px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
      },
      animation: {
        // `forwards` so a delayed/staggered fade-in holds its end state instead of
        // reverting to the pre-animation (opacity-0) class once the animation ends.
        'fade-in': 'fade-in 0.5s ease-out forwards',
      },
      // @tailwindcss/typography ships hardcoded slate/gray hex colors for `prose` content
      // that don't respond to our `--surface-*`/`--brand-*` CSS variables, so markdown-
      // rendered previewers (PRD, Architecture, knowledge docs) looked theme-broken next to
      // the hand-styled structured views (QATestsView, BacklogView). Re-point every prose
      // color variable at our own ramp so `.prose`/`.prose-invert` follow the active theme
      // and match the rest of the app, in one place.
      typography: {
        DEFAULT: {
          css: {
            '--tw-prose-body': 'rgb(var(--surface-700))',
            '--tw-prose-headings': 'rgb(var(--surface-900))',
            '--tw-prose-lead': 'rgb(var(--surface-600))',
            '--tw-prose-links': 'rgb(var(--brand-600))',
            '--tw-prose-bold': 'rgb(var(--surface-900))',
            '--tw-prose-counters': 'rgb(var(--surface-500))',
            '--tw-prose-bullets': 'rgb(var(--surface-300))',
            '--tw-prose-hr': 'rgb(var(--surface-200))',
            '--tw-prose-quotes': 'rgb(var(--surface-900))',
            '--tw-prose-quote-borders': 'rgb(var(--surface-200))',
            '--tw-prose-captions': 'rgb(var(--surface-500))',
            '--tw-prose-kbd': 'rgb(var(--surface-900))',
            '--tw-prose-kbd-shadows': 'rgb(var(--surface-900) / 10%)',
            '--tw-prose-code': 'rgb(var(--surface-700))',
            '--tw-prose-pre-code': 'rgb(var(--surface-200))',
            '--tw-prose-pre-bg': 'rgb(var(--surface-800))',
            '--tw-prose-th-borders': 'rgb(var(--surface-300))',
            '--tw-prose-td-borders': 'rgb(var(--surface-200))',
            '--tw-prose-invert-body': 'rgb(var(--surface-300))',
            '--tw-prose-invert-headings': 'rgb(var(--surface-100))',
            '--tw-prose-invert-lead': 'rgb(var(--surface-400))',
            '--tw-prose-invert-links': 'rgb(var(--brand-400))',
            '--tw-prose-invert-bold': 'rgb(var(--surface-100))',
            '--tw-prose-invert-counters': 'rgb(var(--surface-400))',
            '--tw-prose-invert-bullets': 'rgb(var(--surface-600))',
            '--tw-prose-invert-hr': 'rgb(var(--surface-700))',
            '--tw-prose-invert-quotes': 'rgb(var(--surface-100))',
            '--tw-prose-invert-quote-borders': 'rgb(var(--surface-700))',
            '--tw-prose-invert-captions': 'rgb(var(--surface-400))',
            '--tw-prose-invert-kbd': 'rgb(var(--surface-100))',
            '--tw-prose-invert-kbd-shadows': 'rgb(var(--surface-100) / 10%)',
            '--tw-prose-invert-code': 'rgb(var(--surface-300))',
            '--tw-prose-invert-pre-code': 'rgb(var(--surface-300))',
            '--tw-prose-invert-pre-bg': 'rgb(var(--surface-900) / 50%)',
            '--tw-prose-invert-th-borders': 'rgb(var(--surface-600))',
            '--tw-prose-invert-td-borders': 'rgb(var(--surface-700))',
          },
        },
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
