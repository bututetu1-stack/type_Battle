// ソロ出題の「近接重複」を測るテスト。`npm run wordtest` で実行。
// 袋方式のみ(before) と 直近ガード付き(after) を比較し、同じ語が近い間隔で
// 再出する回数を数える。テーマを絞るほど差が出る。
import { poolForThemes, generateWord, newWordBag } from '../src/lib/words';
import { mulberry32 } from '../src/lib/rng';

const AVOID_RECENT = 10; // SoloGame の定数と合わせる
const NEAR = 5;          // 「近い間隔」の閾値（この語数以内の再出を数える）
const N = 300;           // 出題語数

type Stat = { minGap: number; minWord: string; near: number };

function run(theme: string, useGuard: boolean): Stat {
  const rng = mulberry32(20260718);
  const bag = newWordBag();
  const recent: string[] = [];
  const draw = () => generateWord(rng, theme, bag, false, 0, 0).display;
  const seq: string[] = [];
  for (let i = 0; i < N; i++) {
    let w = draw();
    if (useGuard) {
      for (let t = 0; t < 8 && recent.includes(w); t++) w = draw();
      recent.push(w);
      if (recent.length > AVOID_RECENT) recent.shift();
    }
    seq.push(w);
  }
  const last: Record<string, number> = {};
  let minGap = Infinity, minWord = '', near = 0;
  for (let i = 0; i < seq.length; i++) {
    const w = seq[i];
    if (last[w] !== undefined) {
      const gap = i - last[w];
      if (gap < minGap) { minGap = gap; minWord = w; }
      if (gap <= NEAR) near++;
    }
    last[w] = i;
  }
  return { minGap: minGap === Infinity ? -1 : minGap, minWord, near };
}

function report(theme: string) {
  const pool = poolForThemes(theme).length;
  const before = run(theme, false);
  const after = run(theme, true);
  console.log(`\nテーマ「${theme}」  プール=${pool}語  （${N}語出題／間隔${NEAR}以内を近接とみなす）`);
  console.log(`  before(袋のみ)     : 近接再出=${before.near}回  最小間隔=${before.minGap}${before.minWord ? `(${before.minWord})` : ''}`);
  console.log(`  after (直近ガード) : 近接再出=${after.near}回  最小間隔=${after.minGap}${after.minWord ? `(${after.minWord})` : ''}`);
}

console.log('=== ソロ出題 近接重複テスト ===');
['all', 'food', 'it'].forEach(report);
console.log('\n(after で近接再出が 0 になっていれば改良が効いています)');
