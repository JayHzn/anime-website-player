/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        bg: {
          primary: '#07070f',
          secondary: '#0e0e1c',
          card: '#13132a',
          hover: '#1c1c3a',
        },
        accent: {
          primary: '#a855f7',
          glow: '#c084fc',
          secondary: '#7c3aed',
        },
      },
      fontFamily: {
        display: ['"Outfit"', 'sans-serif'],
        body: ['"DM Sans"', 'sans-serif'],
      },
    },
  },
  plugins: [],
}