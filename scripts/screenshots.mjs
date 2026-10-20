// 見た目の確認用: 主要画面をブラウザで自動操作してスクリーンショットを撮る。
// ソロはボットが実際にプレイする（ローマ字ガイドの「次の1文字」を読んで打ち、時々わざとミスする）。
//
// 準備（一度だけ。package.json は変えない）:
//   npm i --no-save playwright && npx playwright install chromium
// 使い方:
//   npm run build && npm run preview        # 別のターミナルで起動しておく
//   node scripts/screenshots.mjs [出力先=shots] [テーマ=violet] [幅x高さ=1920x1080]
//   例: node scripts/screenshots.mjs shots light 1366x768
// 環境変数:
//   APP_URL       … 既定 http://localhost:4173/type_Battle/（npm run dev なら http://localhost:5173/）
//   CHROMIUM_PATH … 既存の Chromium を使う場合のパス（未指定なら playwright 付属のもの）
//
// テーマ: midnight / abyss / crimson / violet / forest / sunset / mono / light
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const [out = 'shots', theme = 'violet', vp = '1920x1080'] = process.argv.slice(2);
const [W, H] = vp.split('x').map(Number);
const URL = process.env.APP_URL ?? 'http://localhost:4173/type_Battle/';
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const page = await browser.newPage({ viewport: { width: W, height: H } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const shot = (name) => page.screenshot({ path: `${out}/${theme}-${vp}-${name}.png` });

// 端末内の保存（localStorage）を消してから、テーマとソロの設定を入れて開き直す。
async function fresh(custom) {
  await page.goto(URL);
  await page.evaluate(([t, c]) => {
    localStorage.clear();
    localStorage.setItem('typeRoyale.theme', t);
    if (c) localStorage.setItem('typeRoyale.custom', JSON.stringify(c));
  }, [theme, custom]);
  await page.reload();
  await page.waitForTimeout(700);
}
const nextChar = () => page.evaluate(() => document.querySelector('.font-mono2 .text-primary.font-bold')?.textContent ?? null);
let typed = 0; // 呼び出しをまたいで数える（何打ごとにミスするかを通しで決めるため）
async function type(n, { missEvery = 0, delay = 140 } = {}) {
  for (let i = 0; i < n; i++) {
    const c = await nextChar();
    if (!c) { await page.waitForTimeout(60); continue; }
    if (missEvery && ++typed % missEvery === 0) await page.keyboard.press(c === 'q' ? 'z' : 'q');
    await page.keyboard.press(c);
    await page.waitForTimeout(delay + Math.random() * delay);
  }
}
const openSolo = async () => { await page.getByText('ソロ', { exact: true }).first().click(); await page.waitForTimeout(600); };
const start = async () => { await page.keyboard.press('Space'); await page.waitForTimeout(2300); }; // 3・2・1・GO を待つ

// 1 ホーム
await fresh();
await shot('1-home');
// 2 ソロ開始・設定画面
await openSolo();
await shot('2-solo-start');
// 3 プレイ中（バトル）
await start();
await type(60, { missEvery: 11 });
await shot('3-playing');
// 4 結果（タイムアタック 10秒）
await fresh({ soloMode: 'timeattack', taSeconds: 10 });
await openSolo();
await start();
for (let t = 0; t < 400 && !(await page.getByText('TIME UP').count()); t++) await type(3, { missEvery: 7, delay: 50 });
await page.waitForTimeout(800);
await shot('4-result');

console.log(`保存先: ${out}/  ページのエラー: ${errors.length ? errors.join(' / ') : 'なし'}`);
await browser.close();
