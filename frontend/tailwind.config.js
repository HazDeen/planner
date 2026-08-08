/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: 'class', // Включаем поддержку темной темы через класс 'dark'
  theme: {
    extend: {
      colors: {
        bgMain: 'var(--bg-main)',
        surface: 'var(--surface)',
        surfaceHover: 'var(--surface-hover)',
        primary: '#FF9A8B',
        primaryHover: '#FF8573',
        secondary: 'var(--secondary)',
        textMain: 'var(--text-main)',
        textMuted: 'var(--text-muted)',
        iosGray: 'var(--ios-gray)',
        borderMain: 'var(--border-main)',
        statusIcon: 'var(--status-icon)',
      },
      fontFamily: {
        nunito: ['Nunito', 'sans-serif'],
      },
    },
  },
  plugins: [],
}