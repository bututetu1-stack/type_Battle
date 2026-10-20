// カラーテーマ（ダーク系＋ライト＋カスタム背景画像）。背景の雰囲気を切り替える。
// 各画面のルートは bg-transparent にして、body の背景（ここで設定）を見せる。
// 計器HUDデザインのカラートークン（body に CSS変数として適用）。
export type ThemeTokens = Record<
  'bg' | 'bg2' | 'surface' | 'surface2' | 'line' | 'text' | 'muted' | 'primary' | 'glow',
  string
>;

// アクセントの濃淡パレット（Tailwind 公式の 50〜950）。テーマごとに1つ選ぶ。
// 画面の cyan-300 などのクラスは tailwind.config で「アクセント」に読み替えているので、
// ここを変えるとゲージ・お題の発光・ボタンまで全画面がテーマ色に揃う。
export const ACCENT_SHADES = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950] as const;
const PALETTES = {
  cyan: ['#ecfeff', '#cffafe', '#a5f3fc', '#67e8f9', '#22d3ee', '#06b6d4', '#0891b2', '#0e7490', '#155e75', '#164e63', '#083344'],
  teal: ['#f0fdfa', '#ccfbf1', '#99f6e4', '#5eead4', '#2dd4bf', '#14b8a6', '#0d9488', '#0f766e', '#115e59', '#134e4a', '#042f2e'],
  pink: ['#fdf2f8', '#fce7f3', '#fbcfe8', '#f9a8d4', '#f472b6', '#ec4899', '#db2777', '#be185d', '#9d174d', '#831843', '#500724'],
  violet: ['#f5f3ff', '#ede9fe', '#ddd6fe', '#c4b5fd', '#a78bfa', '#8b5cf6', '#7c3aed', '#6d28d9', '#5b21b6', '#4c1d95', '#2e1065'],
  lime: ['#f7fee7', '#ecfccb', '#d9f99d', '#bef264', '#a3e635', '#84cc16', '#65a30d', '#4d7c0f', '#3f6212', '#365314', '#1a2e05'],
  orange: ['#fff7ed', '#ffedd5', '#fed7aa', '#fdba74', '#fb923c', '#f97316', '#ea580c', '#c2410c', '#9a3412', '#7c2d12', '#431407'],
} as const;
export type AccentName = keyof typeof PALETTES;
const rgbTriplet = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(' ');
// 中間色（グレー）の濃淡。Tailwind の gray-* / neutral-* はこれの別名にしてあり、
// 直書きのグレーもテーマの背景色の色味を少し帯びて馴染む（純粋なグレーは浮いて安っぽく見える）。
// 明るさは Tailwind の neutral に合わせ、暗い側の色味だけをテーマから取る。
const NEUTRAL_TARGET = [250, 245, 229, 212, 163, 115, 82, 64, 38, 23, 10];
const TAILWIND_NEUTRAL = ['#fafafa', '#f5f5f5', '#e5e5e5', '#d4d4d4', '#a3a3a3', '#737373', '#525252', '#404040', '#262626', '#171717', '#0a0a0a'];
const hexRgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
function neutralRamp(t: ColorTheme): string[] {
  // ライトテーマは明暗を反転する（950＝背景用が白寄り、50＝文字用が黒寄り）。
  // 画面は「暗い中間色を背景・明るい中間色を文字」に使っているので、反転すれば明るい地でもそのまま読める。
  if (t.light) return [...TAILWIND_NEUTRAL].reverse().map(rgbTriplet);
  // 背景の2番目の色に、アクセントの最も暗い色を少し混ぜた「色味つきの黒」を起点にする。
  const a = hexRgb(t.tokens.bg2);
  const b = hexRgb(PALETTES[t.accent][10]);
  const dark = a.map((c, i) => c + (b[i] - c) * 0.35);
  const d = (dark[0] + dark[1] + dark[2]) / 3;
  return NEUTRAL_TARGET.map((target) =>
    dark
      .map((c) => Math.round(target >= d ? c + (255 - c) * ((target - d) / (255 - d)) : c * (target / d)))
      .join(' '),
  );
}

// テーマ選択ボタンで背景と並べて見せるアクセント色（400 番）。
export const accentHex = (a: AccentName): string => PALETTES[a][4];

export interface ColorTheme {
  id: string;
  label: string;
  css: string; // body に適用する background（グラデーション可）
  swatch: string; // 設定画面のプレビュー色
  light?: boolean; // ライト系（body に theme-light クラスを付け、文字色を暗くする）
  tokens: ThemeTokens; // カラートークン一式
  accent: AccentName; // アクセント色の濃淡パレット（Tailwind の cyan-* クラスもこれに追従する）
}

export const COLOR_THEMES: ColorTheme[] = [
  { id: 'midnight', label: '標準（夜）', css: 'radial-gradient(circle at 50% -10%, #14161f 0%, #0a0a0b 60%)', swatch: '#12141c',
    tokens: { bg: '#0a0a0b', bg2: '#14161f', surface: 'rgba(120,190,255,.04)', surface2: 'rgba(120,190,255,.08)', line: 'rgba(120,200,255,.15)', text: '#e8f4ff', muted: '#6b7c90', primary: '#22d3ee', glow: 'rgba(34,211,238,.5)' }, accent: 'cyan' },
  { id: 'abyss', label: '深海', css: 'radial-gradient(circle at 50% -10%, #0b2a44 0%, #04101c 60%)', swatch: '#0a2236',
    tokens: { bg: '#04101c', bg2: '#0b2a44', surface: 'rgba(120,190,255,.05)', surface2: 'rgba(120,190,255,.09)', line: 'rgba(120,200,255,.15)', text: '#e8f4ff', muted: '#6b7c90', primary: '#2dd4bf', glow: 'rgba(45,212,191,.5)' }, accent: 'teal' },
  { id: 'crimson', label: '深紅', css: 'radial-gradient(circle at 50% -10%, #2d0e13 0%, #120608 60%)', swatch: '#2a0d12',
    tokens: { bg: '#120608', bg2: '#2d0e13', surface: 'rgba(255,150,190,.045)', surface2: 'rgba(255,150,190,.085)', line: 'rgba(255,170,200,.16)', text: '#f4eaec', muted: '#8f7378', primary: '#f472b6', glow: 'rgba(244,114,182,.5)' }, accent: 'pink' },
  { id: 'violet', label: '紫夜', css: 'radial-gradient(circle at 50% -10%, #1e1136 0%, #0d0718 60%)', swatch: '#1c1030',
    tokens: { bg: '#0d0718', bg2: '#1e1136', surface: 'rgba(160,150,255,.05)', surface2: 'rgba(160,150,255,.09)', line: 'rgba(170,160,255,.16)', text: '#f0ecff', muted: '#7a6f9a', primary: '#a78bfa', glow: 'rgba(167,139,250,.5)' }, accent: 'violet' },
  { id: 'forest', label: '深緑', css: 'radial-gradient(circle at 50% -10%, #0d2a1b 0%, #061009 60%)', swatch: '#0c2418',
    tokens: { bg: '#061009', bg2: '#0d2a1b', surface: 'rgba(120,220,180,.05)', surface2: 'rgba(120,220,180,.09)', line: 'rgba(120,220,180,.15)', text: '#e6fff2', muted: '#5f8672', primary: '#a3e635', glow: 'rgba(163,230,53,.45)' }, accent: 'lime' },
  { id: 'sunset', label: '黄昏', css: 'radial-gradient(circle at 50% -10%, #2e1a0c 0%, #140a05 60%)', swatch: '#2a160a',
    tokens: { bg: '#140a05', bg2: '#2e1a0c', surface: 'rgba(255,200,140,.05)', surface2: 'rgba(255,200,140,.09)', line: 'rgba(255,200,150,.15)', text: '#fff0dc', muted: '#93795a', primary: '#fb923c', glow: 'rgba(251,146,60,.5)' }, accent: 'orange' },
  { id: 'mono', label: '漆黒', css: '#000000', swatch: '#000000',
    tokens: { bg: '#000000', bg2: '#070707', surface: 'rgba(255,255,255,.04)', surface2: 'rgba(255,255,255,.07)', line: 'rgba(255,255,255,.13)', text: '#f4f8ff', muted: '#6a6a6a', primary: '#22d3ee', glow: 'rgba(34,211,238,.5)' }, accent: 'cyan' },
  { id: 'light', label: 'ライト', css: 'radial-gradient(circle at 50% -10%, #ffffff 0%, #dfe5ee 70%)', swatch: '#e8edf4', light: true,
    tokens: { bg: '#eef2f6', bg2: '#e4eaf0', surface: 'rgba(2,20,40,.04)', surface2: 'rgba(2,20,40,.07)', line: 'rgba(2,40,70,.16)', text: '#0c1a26', muted: '#5a6b7a', primary: '#0891b2', glow: 'rgba(8,145,178,.26)' }, accent: 'cyan' },
];

const KEY = 'typeRoyale.theme';
const IMG_KEY = 'typeRoyale.bgImage';      // 背景画像（フル・dataURL）
const IMG_MINI_KEY = 'typeRoyale.bgImageMini'; // 背景から作ったミニ（盤面共有のフォールバック）
const BOARD_KEY = 'typeRoyale.boardImage'; // 盤面(ミニボード)専用画像（任意・dataURL）
export const IMAGE_THEME_ID = 'image';

export function getColorTheme(id: string): ColorTheme {
  return COLOR_THEMES.find((t) => t.id === id) ?? COLOR_THEMES[0];
}

export function loadThemeId(): string {
  try {
    const v = localStorage.getItem(KEY);
    if (v === IMAGE_THEME_ID && loadBgImage()) return v;
    if (v && COLOR_THEMES.some((t) => t.id === v)) return v;
  } catch { /* 既定 */ }
  return COLOR_THEMES[0].id;
}

export function saveThemeId(id: string): void {
  try { localStorage.setItem(KEY, id); } catch { /* 保存不可は無視 */ }
}

// --- 背景画像（自分の端末から） ---
export function loadBgImage(): string | null {
  try { return localStorage.getItem(IMG_KEY); } catch { return null; }
}
export function saveBgImage(full: string, mini: string): void {
  try { localStorage.setItem(IMG_KEY, full); localStorage.setItem(IMG_MINI_KEY, mini); } catch { /* 容量超過などは無視 */ }
}
export function clearBgImage(): void {
  try { localStorage.removeItem(IMG_KEY); localStorage.removeItem(IMG_MINI_KEY); } catch { /* 無視 */ }
}

// --- 盤面(ミニボード)専用画像（任意） ---
export function loadBoardImage(): string | null {
  try { return localStorage.getItem(BOARD_KEY); } catch { return null; }
}
export function saveBoardImage(mini: string): void {
  try { localStorage.setItem(BOARD_KEY, mini); } catch { /* 容量超過などは無視 */ }
}
export function clearBoardImage(): void {
  try { localStorage.removeItem(BOARD_KEY); } catch { /* 無視 */ }
}

// オンラインで他プレイヤーへ共有する盤面背景。盤面専用画像を優先し、無ければ背景から作ったミニを使う。
export function loadBgImageMini(): string | null {
  try { return localStorage.getItem(BOARD_KEY) || localStorage.getItem(IMG_MINI_KEY); } catch { return null; }
}

// カラートークン一式を body の CSS変数へ反映（計器HUDデザインの各画面が参照）。
function applyTokens(t: ColorTheme): void {
  const body = document.body;
  for (const [k, v] of Object.entries(t.tokens)) {
    body.style.setProperty(`--${k}`, v);
  }
  // アクセントもライトテーマでは明暗を反転する（文字用の 300 番が濃い色、塗り用の 400 番が 600 番相当になる）。
  const palette = t.light ? [...PALETTES[t.accent]].reverse() : [...PALETTES[t.accent]];
  palette.forEach((hex, i) => body.style.setProperty(`--ac-${ACCENT_SHADES[i]}`, rgbTriplet(hex)));
  neutralRamp(t).forEach((rgb, i) => body.style.setProperty(`--n-${ACCENT_SHADES[i]}`, rgb));
}

// body 背景にテーマ（または背景画像）を適用。light 系は theme-light クラスを付与。
export function applyColorTheme(id: string): void {
  if (typeof document === 'undefined') return;
  const body = document.body;
  if (id === IMAGE_THEME_ID) {
    const img = loadBgImage();
    if (img) {
      // 文字が読めるよう上から半透明の暗幕を重ねる。トークンは標準（夜）を土台に適用。
      body.style.background = `linear-gradient(rgba(8,8,10,0.55), rgba(8,8,10,0.55)), url("${img}") center/cover fixed`;
      body.classList.remove('theme-light');
      applyTokens(getColorTheme('midnight'));
      return;
    }
    // 画像が無ければ標準へフォールバック。
  }
  const t = getColorTheme(id);
  body.style.background = t.css;
  body.style.backgroundAttachment = 'fixed';
  body.classList.toggle('theme-light', t.light === true);
  applyTokens(t);
}

// ファイルを dataURL に読み込む。
export function fileToDataUrl(file: File): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const im = new Image();
    im.onload = () => resolve(im);
    im.onerror = reject;
    im.src = src;
  });
}

// 画像ファイルを読み込み、フル用とミニボード共有用に縮小した dataURL を返す（全体使用）。
export async function processBgImageFile(file: File): Promise<{ full: string; mini: string }> {
  const src = await fileToDataUrl(file);
  const img = await loadImage(src);
  return cropImage(img, { x: 0, y: 0, w: img.width, h: img.height });
}

// 元画像の dataURL と切り取り範囲（元画像ピクセル座標）から、フル/ミニの dataURL を作る。
export async function cropToBgImages(src: string, crop: { x: number; y: number; w: number; h: number }): Promise<{ full: string; mini: string }> {
  const img = await loadImage(src);
  return cropImage(img, crop);
}

// 盤面(ミニボード)専用画像を、切り取り範囲から小さな dataURL で作る（共有のため軽量）。
export async function cropToMiniImage(src: string, crop: { x: number; y: number; w: number; h: number }): Promise<string> {
  const img = await loadImage(src);
  const cw = Math.max(1, Math.round(crop.w));
  const ch = Math.max(1, Math.round(crop.h));
  const ratio = Math.min(1, 150 / cw);
  const w = Math.max(1, Math.round(cw * ratio));
  const h = Math.max(1, Math.round(ch * ratio));
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  if (ctx) ctx.drawImage(img, crop.x, crop.y, cw, ch, 0, 0, w, h);
  return c.toDataURL('image/jpeg', 0.62);
}

function cropImage(img: HTMLImageElement, crop: { x: number; y: number; w: number; h: number }): { full: string; mini: string } {
  const cw = Math.max(1, Math.round(crop.w));
  const ch = Math.max(1, Math.round(crop.h));
  const render = (maxW: number, quality: number): string => {
    const ratio = Math.min(1, maxW / cw);
    const w = Math.max(1, Math.round(cw * ratio));
    const h = Math.max(1, Math.round(ch * ratio));
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d');
    if (ctx) ctx.drawImage(img, crop.x, crop.y, cw, ch, 0, 0, w, h);
    return c.toDataURL('image/jpeg', quality);
  };
  // フルは画面背景用にそこそこ、ミニは共有のため極小（通信量を抑える）。
  return { full: render(1280, 0.78), mini: render(120, 0.6) };
}
