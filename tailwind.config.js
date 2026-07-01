/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      // 計器HUDデザインのカラートークン（CSS変数）。テーマ切替は theme.ts が変数を差し替える。
      colors: {
        bg: 'var(--bg)',
        bg2: 'var(--bg2)',
        surface: 'var(--surface)',
        surface2: 'var(--surface2)',
        line: 'var(--line)',
        text: 'var(--text)',
        muted: 'var(--muted)',
        primary: 'var(--primary)',
        incoming: 'var(--incoming)',
        backload: 'var(--backload)',
        charge: 'var(--charge)',
        success: 'var(--success)',
        warning: 'var(--warning)',
      },
      fontFamily: {
        tech: ['"Chakra Petch"', 'sans-serif'],
        mono2: ['"JetBrains Mono"', 'monospace'],
      },
      boxShadow: {
        glow: '0 0 12px var(--glow)',
        glowlg: '0 0 30px var(--glow)',
      },
    },
  },
  plugins: [require('tailwindcss-animate')],
};
