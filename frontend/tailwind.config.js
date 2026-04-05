/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          50:  '#f0f4ff',
          100: '#dde6ff',
          500: '#3b5bdb',
          600: '#2f4ac4',
          700: '#2541a8',
          900: '#1a2d6e',
        },
      },
    },
  },
  plugins: [],
}

