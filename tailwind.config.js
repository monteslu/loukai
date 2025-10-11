/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './src/renderer/**/*.{js,jsx,ts,tsx}',
    './src/shared/**/*.{js,jsx,ts,tsx}',
    './src/web/**/*.{js,jsx,ts,tsx}',
  ],
  safelist: [
    '-ml-80', // For sidebar collapse animation
  ],
  darkMode: 'class', // Enable dark mode with class strategy
  theme: {
    extend: {
      animation: {
        'slide-in': 'slideIn 0.3s ease',
      },
      keyframes: {
        slideIn: {
          'from': {
            transform: 'translateX(100%)',
            opacity: '0',
          },
          'to': {
            transform: 'translateX(0)',
            opacity: '1',
          },
        },
      },
    },
  },
  plugins: [],
}
