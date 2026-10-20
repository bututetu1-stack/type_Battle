// ソロ（バトル）の難易度プリセット。SoloGame と scripts/balance-sim.ts（調整用の模擬対戦）が同じ値を使う。
// 数値を変えたら `npm run balancesim` で、打鍵の速さ別の勝率・試合時間を確かめること。
//
// 狙い（2026-10-21 の模擬対戦。ミス率5%・読む時間0.3秒・アイテムは拾ったら使用・狙いはランダム）:
//   かんたん   … 2打/秒の初心者でも半分くらい勝てる。3打/秒ならほぼ勝つ。1試合 約2分半
//   ふつう     … 4打/秒で勝率 約7割、5打/秒でほぼ勝つ。1試合 約3分
//   むずかしい … 6打/秒で勝率 約6割、8打/秒でほぼ勝つ。1試合 約2分
// CPU は自分を少し優先して狙う（lib/cpu.ts の CPU_PLAYER_WEIGHT）。被弾は1分あたり およそ 3 / 9 / 17 語。

export interface DifficultyPreset {
  label: string;
  initial: number; // 最初の出題間隔（ms）
  min: number; // 最短の出題間隔（ms）
  accelSpeed: number; // 加速の速さ（0〜10。1供給ごとの間隔倍率 = 1 - accelSpeed/100）
  hp: number; // 自分のHP（積める量）
  enemies: number; // 敵CPUの数
  cpuStr: number; // CPUの平均的な強さ（0〜10。lib/cpu.ts で打鍵の速さに換算）
}

export const DIFFICULTY_PRESETS = {
  easy: { label: 'かんたん', initial: 5000, min: 1600, accelSpeed: 1, hp: 14, enemies: 6, cpuStr: 0 },
  normal: { label: 'ふつう', initial: 3600, min: 1100, accelSpeed: 1, hp: 14, enemies: 10, cpuStr: 3 },
  hard: { label: 'むずかしい', initial: 2800, min: 900, accelSpeed: 1, hp: 10, enemies: 14, cpuStr: 6 },
} as const satisfies Record<string, DifficultyPreset>;

export type DifficultyKey = keyof typeof DIFFICULTY_PRESETS;
export const DIFFICULTY_KEYS = Object.keys(DIFFICULTY_PRESETS) as DifficultyKey[];

// 加速の速さ（表示用 0〜10）⇔ 1供給ごとの間隔倍率（1.00=加速なし、0.90=最速）。
export const accelFromSpeed = (s: number): number => Math.round((1 - Math.min(10, Math.max(0, s)) / 100) * 1000) / 1000;
export const speedFromAccel = (a: number): number => Math.round((1 - a) * 1000) / 10;

// 以前のプリセットと、以前の「初めて遊ぶ人の設定」（どのプリセットとも一致せず「カスタム」に見えていた）。
// 保存済みの設定がこれと完全に一致する人は自分で数値をいじっていないので、新しいプリセットへ移す。
type SpeedEnemyCfg = { initial: number; min: number; accel: number; hp: number; enemies: number; cpuStr: number };
const LEGACY: { cfg: SpeedEnemyCfg; to: DifficultyKey }[] = [
  { cfg: { initial: 3800, min: 1800, accel: 0.99, hp: 14, enemies: 5, cpuStr: 3 }, to: 'easy' },
  { cfg: { initial: 2800, min: 1100, accel: 0.98, hp: 12, enemies: 10, cpuStr: 5 }, to: 'normal' },
  { cfg: { initial: 2000, min: 750, accel: 0.95, hp: 9, enemies: 14, cpuStr: 7 }, to: 'hard' },
  { cfg: { initial: 3500, min: 1600, accel: 0.99, hp: 12, enemies: 5, cpuStr: 3 }, to: 'easy' },
  { cfg: { initial: 2500, min: 1000, accel: 0.97, hp: 10, enemies: 8, cpuStr: 5 }, to: 'normal' },
  { cfg: { initial: 1600, min: 600, accel: 0.94, hp: 8, enemies: 12, cpuStr: 8 }, to: 'hard' },
  { cfg: { initial: 4000, min: 1000, accel: 0.98, hp: 12, enemies: 20, cpuStr: 5 }, to: 'normal' },
];

// 保存済みのソロ設定（typeRoyale.custom の中身）を受け取り、必要なら新しいプリセットの値に置き換えて返す。
export function migrateDifficulty<T>(saved: T): T {
  if (!saved || typeof saved !== 'object') return saved;
  const o = saved as Record<string, unknown>;
  const same = (c: SpeedEnemyCfg) =>
    (Object.keys(c) as (keyof SpeedEnemyCfg)[]).every((k) => typeof o[k] === 'number' && Math.abs((o[k] as number) - c[k]) < 1e-6);
  const hit = LEGACY.find((l) => same(l.cfg));
  if (!hit) return saved;
  const p = DIFFICULTY_PRESETS[hit.to];
  return { ...o, initial: p.initial, min: p.min, accel: accelFromSpeed(p.accelSpeed), hp: p.hp, enemies: p.enemies, cpuStr: p.cpuStr } as T;
}
