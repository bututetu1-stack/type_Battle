import { describe, it, expect } from 'vitest';
import { expectedNextChar, bump, topOf, kpsSeries, rankOf, type Tally } from './analytics';
import { tokenizeWord } from './words';
import type { Word } from './types';

const w = (reading: string): Word => ({ id: 't', display: reading, reading, type: 'normal', tokens: tokenizeWord(reading) });

describe('expectedNextChar（ミスの帰属）', () => {
  it('入力前は先頭の候補の1文字目', () => {
    expect(expectedNextChar(w('すし'), 0, '')).toBe('s');
  });
  it('入力途中は打ちかけの綴りに合う候補の続き', () => {
    // しゃ の候補は表の先頭が sha。s まで打った時点ではガイド通り h を期待する。
    expect(expectedNextChar(w('しゃ'), 0, 's')).toBe('h');
    expect(expectedNextChar(w('しゃ'), 0, 'sh')).toBe('a');
    expect(expectedNextChar(w('しゃ'), 0, 'sy')).toBe('a'); // sya と打ちかけていればその続き
  });
  it('促音「っ」の頭では次の子音を重ねる', () => {
    expect(expectedNextChar(w('きって'), 1, '')).toBe('t');
  });
  it('「ん」は n の次も n', () => {
    expect(expectedNextChar(w('みかん'), 2, 'n')).toBe('n');
  });
  it('範囲外は null', () => {
    expect(expectedNextChar(w('す'), 5, '')).toBeNull();
  });
});

describe('集計', () => {
  it('bump と topOf で多い順に並ぶ', () => {
    const t: Tally = {};
    for (const k of ['g', 'y', 'g', 'a', 'g', 'y']) bump(t, k);
    bump(t, null);
    expect(topOf(t, 2)).toEqual([{ key: 'g', count: 3 }, { key: 'y', count: 2 }]);
  });
});

describe('kpsSeries（速度推移）', () => {
  it('1秒ごとの打鍵数を数える', () => {
    const t0 = 10_000;
    const times = [t0 + 100, t0 + 200, t0 + 900, t0 + 1500, t0 + 2100, t0 + 2200, t0 + 2300];
    expect(kpsSeries(times, t0, t0 + 3000, 1)).toEqual([3, 1, 3]);
  });
  it('移動平均でならす（端は窓を縮める）', () => {
    const t0 = 0;
    expect(kpsSeries([100, 200, 300, 2500], t0, 3000, 3)).toEqual([1.5, 4 / 3, 0.5]);
  });
  it('最後の半端な区間は長さで割り戻し、0.5秒未満なら捨てる', () => {
    expect(kpsSeries([100, 1100, 1200], 0, 1500, 1)).toEqual([1, 4]); // 0.5秒で2打 → 4 KPS
    expect(kpsSeries([100, 1100], 0, 1200, 1)).toEqual([1]); // 0.2秒は捨てる
  });
  it('0秒でも1区間は返す', () => {
    expect(kpsSeries([], 0, 0)).toHaveLength(1);
  });
});

describe('rankOf（ランク判定）', () => {
  it('KPS の帯でランクが決まる', () => {
    expect(rankOf(1.2, 1).rank.id).toBe('D');
    expect(rankOf(4.5, 0.97).rank.id).toBe('B+');
    expect(rankOf(8.4, 0.99).rank.id).toBe('S+');
  });
  it('正確率が低いと段階が下がる', () => {
    expect(rankOf(5.2, 0.85)).toMatchObject({ penalty: 1 });
    expect(rankOf(5.2, 0.85).rank.id).toBe('B+');
    expect(rankOf(5.2, 0.7).rank.id).toBe('B');
  });
  it('速さは足りていて正確率で落ちている時は、必要な正確率を示す', () => {
    // 7.4 KPS は本来 S。正確率86%で −1段 → A+。KPS ではなく正確率90%が条件。
    expect(rankOf(7.4, 0.86)).toMatchObject({ kpsToNext: 0, accToNext: 0.9 });
    expect(rankOf(7.4, 0.86).next?.id).toBe('S');
    // 正確率70%（−2段）なら、1段上へは80%で足りる
    expect(rankOf(7.4, 0.7)).toMatchObject({ accToNext: 0.8 });
    expect(rankOf(7.4, 0.7).next?.id).toBe('A+');
    // 正確率は十分なら accToNext は無い
    expect(rankOf(4.5, 0.95).accToNext).toBeNull();
  });
  it('次のランクまでの KPS 差を出す（最上位は null）', () => {
    expect(rankOf(4.5, 1)).toMatchObject({ kpsToNext: 0.5 });
    expect(rankOf(4.5, 1).next?.id).toBe('A');
    expect(rankOf(9, 1)).toMatchObject({ next: null, kpsToNext: null });
  });
});
