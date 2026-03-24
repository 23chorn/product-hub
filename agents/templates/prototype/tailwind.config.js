/*
 * Tailwind Config — mapped to Figma "App Redesign" design tokens
 * Source: https://www.figma.com/design/kQQGHTOPk2C7P3PkrL9VQX/App-Redesign
 *
 * Note: With Tailwind v4 + @tailwindcss/vite, this file is optional.
 * Tailwind v4 auto-detects content and supports @theme in CSS.
 * This config is provided as a reference for token-to-utility mapping.
 */

/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      /* ---- Colors ---- */
      colors: {
        brand: {
          primary: '#3C70FF',
          'primary-2': '#10BAFF',
          'primary-3': '#8103FF',
        },
        interactive: {
          DEFAULT: '#5231F7',
        },
        text: {
          '01': '#18171A',
          '02': '#616068',
          '03': '#7C7A82',
          '04': '#AFAEB5',
          '05': '#FFFFFF',
          dark: '#000103',
          light: '#60728B',
          error: '#FF1A40',
        },
        cta: {
          '01': '#FFFFFF',
          '01-alt': '#5231F7',
        },
        ui: {
          '01': '#FFFFFF',
          '02': '#F5F5F7',
          '03': '#E4E3E8',
          '04': '#CCCBD1',
          background: '#FFFFFF',
          'info-01': '#F2F3FF',
          'error-01': '#FFF2F4',
        },
        overlay: {
          '01': '#18171A',
          '02': '#18171A',
        },
        icon: {
          '01': '#5231F7',
          '02': '#18171A',
          '04': '#FFFFFF',
        },
        divider: {
          '01': '#F5F5F7',
        },
        status: {
          error: '#FF1A40',
          success: '#21D9BA',
        },
        disabled: {
          '02': '#E4E3E8',
          '03': '#CCCBD1',
        },
        inactive: {
          '01': '#939199',
        },
        placeholder: '#8C8C8C',
        neutral: {
          0: '#FFFFFF',
          900: '#18171A',
        },

        /* Semantic colors */
        green: {
          DEFAULT: '#51CB20',
          bright: '#5ED92A',
          light: '#DFF6D9',
          dark: '#24650A',
        },
        red: {
          DEFAULT: '#DF2935',
          bright: '#FF4A4F',
          light: '#FFD9D6',
          dark: '#C2222D',
        },
        yellow: {
          dark: '#C18F40',
          light: '#FAECC4',
        },

        /* Blue scale */
        blue: {
          DEFAULT: '#3C70FF',
          light: '#6190FF',
          'light-2': '#87AEFF',
          'light-3': '#AEC9FF',
          'light-4': '#D6E4FF',
          'light-5': '#EAF2FF',
          dark: '#3360DE',
          'dark-2': '#2A51BE',
          'dark-3': '#21439E',
          'dark-4': '#193580',
          'dark-6': '#0A1A48',
        },

        /* Grey scale */
        grey: {
          'light-1': '#E9EAEB',
          'light-2': '#FAFAFA',
          dark: '#B3BBC6',
        },

        /* White variants */
        white: {
          DEFAULT: '#FFFFFF',
          raised: '#FFFFFF',
          'anti-flash': '#F7F8FB',
          'anti-flash-2': '#F4F8FB',
          'anti-flash-3': '#F2F5F7',
        },
      },

      /* ---- Typography ---- */
      fontFamily: {
        primary: ["'Poppins'", 'system-ui', 'sans-serif'],
        display: ["'SF Pro Display'", 'system-ui', 'sans-serif'],
        body: ["'SF Pro Text'", 'system-ui', 'sans-serif'],
      },
      fontSize: {
        h1: ['32px', { lineHeight: '41px', fontWeight: '600', letterSpacing: '0.38px' }],
        'body-bold': ['17px', { lineHeight: '22px', fontWeight: '600', letterSpacing: '-0.41px' }],
        p: ['16px', { lineHeight: '24px', fontWeight: '600' }],
        label: ['14px', { lineHeight: '22px', fontWeight: '500' }],
        'label-semibold': ['14px', { lineHeight: '22px', fontWeight: '600' }],
        tiny: ['12px', { lineHeight: '20px', fontWeight: '400' }],
      },

      /* ---- Spacing ---- */
      spacing: {
        '1': '4px',
        '2': '8px',
        '3': '12px',
        '4': '16px',
        '5': '20px',
        '6': '24px',
        '8': '32px',
        '10': '40px',
        '12': '48px',
      },

      /* ---- Border Radius ---- */
      borderRadius: {
        sm: '8px',
        md: '12px',
        lg: '16px',
        full: '9999px',
      },

      /* ---- Shadows ---- */
      boxShadow: {
        card: '0 1px 3px rgba(51, 51, 51, 0.1)',
      },

      /* ---- Backdrop Blur ---- */
      backdropBlur: {
        default: '12px',
      },
    },
  },
  plugins: [],
};
