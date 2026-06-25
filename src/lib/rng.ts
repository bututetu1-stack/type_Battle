// 決定論的な擬似乱数生成器（PRNG）。
// 共通シードから全クライアントが同じお題列を生成するための土台（仕様 §4.3）。

export type RNG = () => number;

// mulberry32: 軽量かつ十分な品質を持つ 32bit シード PRNG。
// 同じ seed からは常に同じ [0,1) の数列を返す。
export function mulberry32(seed: number): RNG {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ランダムな 32bit シードを生成（ゲーム開始時に1回だけ使用）。
export function randomSeed(): number {
  return Math.floor(Math.random() * 0xffffffff) >>> 0;
}
