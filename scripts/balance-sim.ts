// ソロ（バトル）の難易度バランスを測る模擬対戦。`npm run balancesim` で実行。
// 打鍵の速さ（KPS）ごとに何百試合も自動で回し、勝率・試合時間・負けた時の順位を表にする。
// ゲームのルール（供給・攻撃・相殺・アイテム）は SoloGame.tsx を写したもの。
// プリセットと CPU の動きは SoloGame と同じモジュール（lib/difficulty.ts / lib/cpu.ts）を使う。
// SoloGame の攻撃・相殺・アイテムの数値を変えたら、ここも合わせること。
//
// 環境変数（例: GAMES=100 ONLY=normal npm run balancesim）:
//   GAMES（1条件あたりの試合数、既定300）/ TARGET=finish（狙いを「とどめ」に。既定はランダム）/
//   MISS（1打のミス率、既定0.05）/ OVERHEAD（お題を読む時間ms、既定300）/ ITEMS=0（アイテムなし）/
//   KPS（例 "3,5"）/ ONLY（例 "normal"）/ PRESET（JSON でプリセットを上書き。調整用）
// 実ゲームとの照合（2026-10-21）: ふつう・4.7KPS・ノーミス・アイテムなしで、旧CPUの実プレイが 55〜90秒で
// 7〜10位、模擬が中央 77秒・9位。
import { DIFFICULTY_PRESETS, DIFFICULTY_KEYS, accelFromSpeed, type DifficultyPreset } from '../src/lib/difficulty';
import { makeCpu, stepCpu } from '../src/lib/cpu';
import { generateWord, newWordBag } from '../src/lib/words';
import { mulberry32 } from '../src/lib/rng';
import type { Dummy, Word } from '../src/lib/types';

const GAMES = Number(process.env.GAMES ?? process.argv[2] ?? 300);
const TARGET: 'random' | 'finish' = (process.env.TARGET ?? process.argv[3]) === 'finish' ? 'finish' : 'random';
const KPS_LEVELS = (process.env.KPS ?? '2,3,4,5,6,8').split(',').map(Number);
const MISS_RATE = Number(process.env.MISS ?? 0.05); // 1打あたりのミス率
const WORD_OVERHEAD = Number(process.env.OVERHEAD ?? 300); // お題を読んで打ち始めるまで（ms）
const ITEMS_ON = process.env.ITEMS !== '0';
const MAX_TIME = 10 * 60 * 1000; // 10分で打ち切り
const SPREAD = process.env.SPREAD ? Number(process.env.SPREAD) : undefined; // CPUの強さのばらつき（調整用）

// SoloGame と同じ値
const TELEGRAPH_DELAY = 2500;
const ATTACK_GAUGE = 5;
const ATTACK_CAP = 5;
const COMBO_STEP = 5;
const BADGE_CAP = 4;
const BADGE_RATE = 25;
const TREASURE = ITEMS_ON ? 0.2 : 0;
const MAX_INCOMING = 4; // 予告がこれ以上たまっている間はCPUから撃たれない

// 単語ごとの打鍵数（ガイドに出る綴り＝各音の第1候補）。
const keysOf = (w: Word) => w.tokens.reduce((s, t) => s + (t.kana === 'っ' ? 1 : t.romaji[0].length), 0);

type Item = 'snipe' | 'burst' | 'barrier' | 'freeze' | 'shrink' | 'rapid' | 'keep' | 'goldify';
const ITEMS: { item: Item; w: number }[] = [
  { item: 'snipe', w: 1 }, { item: 'burst', w: 1 }, { item: 'barrier', w: 0.75 }, { item: 'freeze', w: 0.6 },
  { item: 'shrink', w: 1 }, { item: 'rapid', w: 1 }, { item: 'keep', w: 1 }, { item: 'goldify', w: 0.8 },
];

interface Result { win: boolean; ms: number; rank: number; kos: number }

function play(p: DifficultyPreset, kps: number, seed: number): Result {
  const R = mulberry32(seed);
  const wordRng = mulberry32(seed ^ 0x5bd1e995);
  const bag = newWordBag();
  const hp = p.hp;
  const accel = accelFromSpeed(p.accelSpeed);
  const nextWord = (): Word => generateWord(wordRng, 'all', bag, false, TREASURE, 0);
  const shortWord = (): Word => { let w = nextWord(); for (let i = 0; i < 20 && w.reading.length > 4; i++) w = nextWord(); return { ...w, type: 'normal' }; };

  let cpus: Dummy[] = Array.from({ length: p.enemies }, (_, i) => makeCpu(i, `CPU${i}`, p.cpuStr / 10, R, SPREAD));
  let backlog: Word[] = [nextWord(), nextWord(), nextWord()];
  let pending: { amount: number; at: number }[] = [];
  let interval = p.initial;
  let nextSpawn = p.initial;
  let nextCpuTick = 1000;
  let combo = 0;
  let gauge = 0;
  let kos = 0;
  let freezeUntil = 0, rapidUntil = 0, keepUntil = 0;
  let barrier = false;
  let typingEnd = -1;
  let typingMiss = false;

  const alive = () => cpus.filter((c) => !c.isKO);
  const pickTarget = (): Dummy | null => {
    const a = alive();
    if (!a.length) return null;
    if (TARGET === 'finish') return a.reduce((b, c) => (c.height > b.height ? c : b));
    return a[Math.floor(R() * a.length)];
  };
  // CPU への着弾（自分の攻撃なら撃破数に数える）
  const hit = (c: Dummy, n: number, byPlayer: boolean) => {
    if (c.height + n > hp) { c.isKO = true; c.height = 0; if (byPlayer) kos++; } else c.height += n;
  };
  const fireAttack = (amount: number, forced?: Dummy | null) => {
    let rem = amount;
    for (const e of pending) { const cut = Math.min(rem, e.amount); e.amount -= cut; rem -= cut; if (rem <= 0) break; }
    pending = pending.filter((e) => e.amount > 0);
    if (rem <= 0) return;
    const t = forced && !forced.isKO ? forced : pickTarget();
    if (t) hit(t, rem, true);
  };
  const applyItem = (it: Item, now: number) => {
    if (it === 'snipe') { const a = alive(); fireAttack(4, a.length ? a.reduce((b, c) => (c.height > b.height ? c : b)) : null); }
    else if (it === 'burst') for (const c of alive()) hit(c, 2, true);
    else if (it === 'barrier') barrier = true;
    else if (it === 'freeze') freezeUntil = now + 5000;
    else if (it === 'shrink') backlog = backlog.map((w, i) => (i === 0 ? w : { ...shortWord(), type: w.type }));
    else if (it === 'rapid') rapidUntil = now + 8000;
    else if (it === 'keep') keepUntil = now + 10000;
    else if (it === 'goldify') backlog = backlog.map((w) => (w.type === 'ojama' ? w : { ...w, type: 'treasure' }));
  };
  const grantItem = (now: number) => {
    const total = ITEMS.reduce((s, x) => s + x.w, 0);
    let acc = R() * total;
    for (const x of ITEMS) { acc -= x.w; if (acc <= 0) { applyItem(x.item, now); return; } }
  };
  const lose = (now: number): Result => ({ win: false, ms: now, rank: alive().length + 1, kos });

  for (let now = 0; now <= MAX_TIME; now += 50) {
    // 打鍵: 山の先頭を打ち始め、時間が来たらクリア
    if (typingEnd < 0 && backlog.length > 0) {
      const n = keysOf(backlog[0]);
      let ms = WORD_OVERHEAD;
      typingMiss = false;
      for (let i = 0; i < n; i++) {
        ms += (1000 / kps) * (0.6 + 0.8 * R());
        if (R() < MISS_RATE) { typingMiss = true; ms += 1000 / kps; }
      }
      typingEnd = now + ms;
    }
    if (typingEnd >= 0 && now >= typingEnd && backlog.length > 0) {
      const cleared = backlog[0];
      backlog = backlog.slice(1);
      typingEnd = -1;
      combo = typingMiss && now >= keepUntil ? 1 : combo + 1;
      for (const e of pending) if (e.amount > 0) { e.amount -= 1; break; } // 1クリアで予告を1つ相殺
      pending = pending.filter((e) => e.amount > 0);
      gauge += 1;
      while (gauge >= ATTACK_GAUGE) {
        gauge -= ATTACK_GAUGE;
        let amt = 1 + Math.floor(combo / COMBO_STEP);
        amt = Math.round(amt * (1 + (BADGE_RATE / 100) * Math.min(kos, BADGE_CAP)));
        fireAttack(Math.min(amt, ATTACK_CAP));
      }
      if (now < rapidUntil) fireAttack(1);
      if (cleared.type === 'treasure') grantItem(now);
      if (alive().length === 0) return { win: true, ms: now, rank: 1, kos };
    }
    if (backlog.length === 0 && pending.length > 0) backlog = [shortWord()]; // 迎撃

    // 自動供給
    if (now >= nextSpawn) {
      if (now >= freezeUntil) {
        if (backlog.length >= hp) return lose(now);
        backlog.push(nextWord());
      }
      interval = Math.max(p.min, interval * accel);
      nextSpawn = now + interval;
    }

    // 予告の確定（100ms ごと）
    if (now % 100 === 0 && pending.length && now >= freezeUntil) {
      const due = pending.filter((e) => e.at <= now);
      if (due.length) {
        pending = pending.filter((e) => e.at > now);
        if (barrier) barrier = false;
        else {
          const n = due.reduce((s, e) => s + e.amount, 0);
          for (let i = 0; i < n; i++) backlog.push({ ...nextWord(), type: 'ojama' });
          if (backlog.length >= hp) return lose(now);
        }
      }
    }

    // CPU（1秒ごと）: SoloGame と同じ stepCpu。攻撃の行き先は自分を含む生存者からランダム。
    if (now >= nextCpuTick) {
      nextCpuTick += 1000;
      const supply = 1000 / interval;
      const shots: { from: Dummy; amount: number }[] = [];
      cpus = cpus.map((c) => {
        const s = stepCpu(c, supply, hp, R);
        for (const a of s.attacks) shots.push({ from: s.next, amount: a });
        return s.next;
      });
      for (const { from, amount } of shots) {
        if (from.isKO) continue;
        const others = alive().filter((c) => c.id !== from.id);
        const incomingNow = pending.reduce((s, e) => s + e.amount, 0);
        const canHitMe = now >= freezeUntil && incomingNow < MAX_INCOMING;
        const pick = Math.floor(R() * (others.length + 1));
        if (pick === others.length) {
          if (canHitMe) pending.push({ amount, at: now + TELEGRAPH_DELAY });
        } else hit(others[pick], amount, false);
      }
      if (alive().length === 0) return { win: true, ms: now, rank: 1, kos };
    }
  }
  return { win: false, ms: MAX_TIME, rank: alive().length + 1, kos };
}

const pct = (x: number) => `${Math.round(x * 100)}%`.padStart(4);
const mmss = (ms: number) => { const s = Math.round(ms / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)] ?? 0; };

console.log(`模擬対戦 ${GAMES}試合ずつ / 狙い=${TARGET} / ミス率${MISS_RATE * 100}% / 読む時間${WORD_OVERHEAD}ms / ${ITEMS_ON ? 'アイテムは拾ったら即使用' : 'アイテムなし'}`);
const override = process.env.PRESET ? JSON.parse(process.env.PRESET) : null;
for (const key of DIFFICULTY_KEYS) {
  if (process.env.ONLY && process.env.ONLY !== key) continue;
  const p: DifficultyPreset = { ...DIFFICULTY_PRESETS[key], ...(override ?? {}) };
  console.log(`\n■ ${p.label}  初速${p.initial / 1000}s 最短${p.min / 1000}s 加速${p.accelSpeed} HP${p.hp} 敵${p.enemies} CPU${p.cpuStr}`);
  console.log('  KPS  勝率  試合時間(中央)  負けた時の順位(中央)  撃破(平均)');
  for (const kps of KPS_LEVELS) {
    const rs = Array.from({ length: GAMES }, (_, i) => play(p, kps, 1000 + i * 7919));
    const wins = rs.filter((r) => r.win);
    const losses = rs.filter((r) => !r.win);
    const lossRank = losses.length ? `${median(losses.map((r) => r.rank))}位/${p.enemies + 1}人` : '-';
    console.log(`  ${String(kps).padStart(3)}  ${pct(wins.length / GAMES)}  ${mmss(median(rs.map((r) => r.ms))).padStart(8)}        ${lossRank.padEnd(12)}  ${(rs.reduce((s, r) => s + r.kos, 0) / GAMES).toFixed(1)}`);
  }
}
