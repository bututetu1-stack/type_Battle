// カラーテーマ（ダーク系の複数テーマ）。背景の雰囲気を切り替える。
// 各画面のルートは bg-transparent にして、body の背景（ここで設定）を見せる。
export interface ColorTheme {
  id: string;
  label: string;
  css: string; // body に適用する background（グラデーション可）
  swatch: string; // 設定画面のプレビュー色
}

export const COLOR_THEMES: ColorTheme[] = [
  { id: 'midnight', label: '標準（夜）', css: 'radial-gradient(circle at 50% -10%, #14161f 0%, #0a0a0b 60%)', swatch: '#12141c' },
  { id: 'abyss', label: '深海', css: 'radial-gradient(circle at 50% -10%, #0b2a44 0%, #04101c 60%)', swatch: '#0a2236' },
  { id: 'crimson', label: '深紅', css: 'radial-gradient(circle at 50% -10%, #2d0e13 0%, #120608 60%)', swatch: '#2a0d12' },
  { id: 'violet', label: '紫夜', css: 'radial-gradient(circle at 50% -10%, #1e1136 0%, #0d0718 60%)', swatch: '#1c1030' },
  { id: 'forest', label: '深緑', css: 'radial-gradient(circle at 50% -10%, #0d2a1b 0%, #061009 60%)', swatch: '#0c2418' },
  { id: 'sunset', label: '黄昏', css: 'radial-gradient(circle at 50% -10%, #2e1a0c 0%, #140a05 60%)', swatch: '#2a160a' },
  { id: 'mono', label: '漆黒', css: '#000000', swatch: '#000000' },
];

const KEY = 'typeRoyale.theme';

export function getColorTheme(id: string): ColorTheme {
  return COLOR_THEMES.find((t) => t.id === id) ?? COLOR_THEMES[0];
}

export function loadThemeId(): string {
  try {
    const v = localStorage.getItem(KEY);
    if (v && COLOR_THEMES.some((t) => t.id === v)) return v;
  } catch { /* 既定 */ }
  return COLOR_THEMES[0].id;
}

export function saveThemeId(id: string): void {
  try { localStorage.setItem(KEY, id); } catch { /* 保存不可は無視 */ }
}

// body 背景にテーマを適用（全画面共通の背景になる）。
export function applyColorTheme(id: string): void {
  const t = getColorTheme(id);
  if (typeof document === 'undefined') return;
  document.body.style.background = t.css;
  document.body.style.backgroundAttachment = 'fixed';
}
