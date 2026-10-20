// オンライン画面の見た目確認: ホストと参加者の2人（＋任意で CPU）で実際に部屋を作り、
// ロビー → 待機室（ホスト／参加者）→ 対戦 → 観戦 → 結果 を撮る。最後に退室して部屋を片付ける。
// 本物の Firebase に部屋ができる（数分で消える）。
//
// 準備（一度だけ）:
//   npm i --no-save playwright-core          # Windows の Chrome / Edge を使う（無ければ playwright ＋ chromium）
//   .env.online.local に Firebase の Web 用設定を書く（CLAUDE.md「ハマりどころ」参照）
// 使い方:
//   npm run dev -- --mode online --port 5174   # 別のターミナルで起動しておく
//   node scripts/online-shots.mjs [出力先=shots] [テーマ=violet] [幅x高さ=1366x768]
// 環境変数:
//   APP_URL … 既定 http://localhost:5174/ ／ CPU=1 … CPU を1体入れて3人戦（観戦画面も撮れる）／
//   CHROMIUM_PATH … 使うブラウザのパス
import { existsSync, mkdirSync } from 'node:fs';
const { chromium } = await import('playwright').catch(() => import('playwright-core'));

const [out = 'shots', theme = 'violet', vp = '1366x768'] = process.argv.slice(2);
const [W, H] = vp.split('x').map(Number);
const URL = process.env.APP_URL ?? 'http://localhost:5174/';
const localBrowser = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
].find((p) => existsSync(p));
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || localBrowser || undefined });
const errors = [];
// 1人ずつ別のブラウザ環境（＝別の匿名ユーザー）で開く。
async function open(who) {
  const ctx = await browser.newContext({ viewport: { width: W, height: H } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`${who}: ${e.message}`));
  await page.goto(URL);
  await page.evaluate((t) => { localStorage.clear(); localStorage.setItem('typeRoyale.theme', t); }, theme);
  await page.reload();
  await page.waitForTimeout(1500);
  await page.getByText('オンライン対戦').first().click();
  await page.waitForTimeout(1000);
  return page;
}
const shot = (page, name) => page.screenshot({ path: `${out}/online-${theme}-${vp}-${name}.png` });
const nextChar = (p) => p.evaluate(() => document.querySelector('.font-mono2 .text-primary.font-bold')?.textContent ?? null);
const text = (p) => p.evaluate(() => document.body.innerText);

// ロビー → ホストが部屋を作る → 参加者がコードで入る
const host = await open('host');
await shot(host, '1-lobby');
await host.locator('input').first().fill('ホスト太郎');
await host.getByRole('button', { name: /ルームを作成/ }).click();
await host.waitForTimeout(2500);
const code = await host.locator('[data-room-code]').getAttribute('data-room-code');
const guest = await open('guest');
await guest.locator('input').first().fill('ゲスト花子');
await guest.locator('input').nth(1).fill(code);
await guest.getByRole('button', { name: /参加/ }).click();
await guest.waitForTimeout(2500);
if (process.env.CPU === '1') {
  await host.getByRole('button', { name: 'CPU を追加' }).first().click(); // 折りたたみを開く
  await host.getByRole('button', { name: /CPU を追加$/ }).last().click();
  await host.waitForTimeout(1500);
}
await shot(host, '2-room-host');
await shot(guest, '3-room-guest');

// 対戦: 最初は2人とも打ち、途中から参加者は手を止める（→ 脱落して観戦）
await host.getByRole('button', { name: /ゲーム開始/ }).click();
await host.waitForTimeout(8000); // 5秒のカウントダウン＋α
for (let i = 0; i < 60; i++) {
  for (const p of [host, guest]) { const c = await nextChar(p); if (c) await p.keyboard.press(c); }
  await host.waitForTimeout(120);
}
await shot(host, '4-playing-host');
let spectated = false;
for (let i = 0; i < 600; i++) {
  const c = await nextChar(host); if (c) await host.keyboard.press(c);
  await host.waitForTimeout(150);
  if (i % 10 !== 0) continue;
  if (!spectated && (await text(guest)).includes('TOP OUT')) { await guest.waitForTimeout(1200); await shot(guest, '5-spectate-guest'); spectated = true; }
  if (/あなたの順位/.test(await text(host)) && /あなたの順位/.test(await text(guest))) break;
}
await host.waitForTimeout(1500);
await shot(host, '6-result-host');
await shot(guest, '6-result-guest');

// 片付け: 参加者 → ホストの順に退室（ホストが抜けると CPU も消える）
for (const p of [guest, host]) {
  const b = p.getByRole('button', { name: /ロビーに戻る|退室/ }).first();
  if (await b.count()) await b.click().catch(() => {});
  await p.waitForTimeout(1500);
}
console.log(`保存先: ${out}/  ルーム ${code}  ページのエラー: ${errors.length ? errors.join(' / ') : 'なし'}`);
await browser.close();
