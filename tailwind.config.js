/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/renderer/index.html', './src/renderer/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // OpenClaw-inspired dark palette
        ink: '#0b0e14',
        panel: '#121620',
        panel2: '#1a1f2e',
        edge: '#252b3b',
        claw: '#ff7a45',
        clawDim: '#c75a2e',
        accent: '#5b9dff',
        good: '#3fd07f',
        warn: '#ffce4f',
        bad: '#ff5d6c',
        muted: '#8b94a7'
      },
      fontFamily: {
        sans: ['Inter', 'Segoe UI', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'Consolas', 'monospace']
      }
    }
  },
  plugins: []
}
