// カラーテーマ（ダーク系＋ライト＋カスタム背景画像）。背景の雰囲気を切り替える。
// 各画面のルートは bg-transparent にして、body の背景（ここで設定）を見せる。
export interface ColorTheme {
  id: string;
  label: string;
  css: string; // body に適用する background（グラデーション可）
  swatch: string; // 設定画面のプレビュー色
  light?: boolean; // ライト系（body に theme-light クラスを付け、文字色を暗くする）
}

export const COLOR_THEMES: ColorTheme[] = [
  { id: 'midnight', label: '標準（夜）', css: 'radial-gradient(circle at 50% -10%, #14161f 0%, #0a0a0b 60%)', swatch: '#12141c' },
  { id: 'abyss', label: '深海', css: 'radial-gradient(circle at 50% -10%, #0b2a44 0%, #04101c 60%)', swatch: '#0a2236' },
  { id: 'crimson', label: '深紅', css: 'radial-gradient(circle at 50% -10%, #2d0e13 0%, #120608 60%)', swatch: '#2a0d12' },
  { id: 'violet', label: '紫夜', css: 'radial-gradient(circle at 50% -10%, #1e1136 0%, #0d0718 60%)', swatch: '#1c1030' },
  { id: 'forest', label: '深緑', css: 'radial-gradient(circle at 50% -10%, #0d2a1b 0%, #061009 60%)', swatch: '#0c2418' },
  { id: 'sunset', label: '黄昏', css: 'radial-gradient(circle at 50% -10%, #2e1a0c 0%, #140a05 60%)', swatch: '#2a160a' },
  { id: 'mono', label: '漆黒', css: '#000000', swatch: '#000000' },
  { id: 'light', label: 'ライト', css: 'radial-gradient(circle at 50% -10%, #ffffff 0%, #dfe5ee 70%)', swatch: '#e8edf4', light: true },
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

// body 背景にテーマ（または背景画像）を適用。light 系は theme-light クラスを付与。
export function applyColorTheme(id: string): void {
  if (typeof document === 'undefined') return;
  const body = document.body;
  if (id === IMAGE_THEME_ID) {
    const img = loadBgImage();
    if (img) {
      // 文字が読めるよう上から半透明の暗幕を重ねる。
      body.style.background = `linear-gradient(rgba(8,8,10,0.55), rgba(8,8,10,0.55)), url("${img}") center/cover fixed`;
      body.classList.remove('theme-light');
      return;
    }
    // 画像が無ければ標準へフォールバック。
  }
  const t = getColorTheme(id);
  body.style.background = t.css;
  body.style.backgroundAttachment = 'fixed';
  body.classList.toggle('theme-light', t.light === true);
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
