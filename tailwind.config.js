// アクセント色の濃淡（theme.ts が --ac-50〜950 を RGB 三つ組で流し込む）。
// cyan-* はこのアクセントの別名にしてあるので、既存の cyan クラスもテーマ色に追従する。
const SHADES = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950];
const accent = Object.fromEntries(SHADES.map((n) => [n, `rgb(var(--ac-${n}) / <alpha-value>)`]));
// 中間色（グレー）。gray-* / neutral-* はテーマの色味を帯びたこの濃淡の別名。
const neutral = Object.fromEntries(SHADES.map((n) => [n, `rgb(var(--n-${n}) / <alpha-value>)`]));

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
        accent,
        cyan: accent,
        neutral,
        gray: neutral,
      },
      fontFamily: {
        // 本文は和文の IBM Plex Sans JP。見出し・数字は Chakra Petch（和文はPlexで補う）。
        sans: ['"IBM Plex Sans JP"', 'system-ui', 'sans-serif'],
        tech: ['"Chakra Petch"', '"IBM Plex Sans JP"', 'sans-serif'],
        mono2: ['"JetBrains Mono"', '"IBM Plex Sans JP"', 'monospace'],
      },
      boxShadow: {
        glow: '0 0 12px var(--glow)',
        glowlg: '0 0 30px var(--glow)',
      },
    },
  },
  plugins: [require('tailwindcss-animate')],
};
