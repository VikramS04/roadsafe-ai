/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        command: {
          bg: '#0B1120',
          card: '#151F32',
          border: '#1E293B',
          accent: '#2563EB',
          hover: '#1D4ED8',
        },
        risk: {
          green: '#10B981',
          yellow: '#F59E0B',
          red: '#EF4444',
          grey: '#64748B',
        }
      }
    },
  },
  plugins: [],
}

