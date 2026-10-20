import { describe, it, expect } from 'vitest';
import { previousBest, type ScoreRecord } from './scores';

const rec = (p: Partial<ScoreRecord>): ScoreRecord => ({
  name: 'p', mode: 'royale', theme: 'all', keys: 0, kps: 0, acc: 1, words: 0, maxCombo: 0, score: 0, ts: 0, ...p,
});

describe('previousBest', () => {
  const list = [
    rec({ ts: 1, score: 500, kps: 4.0 }),
    rec({ ts: 2, score: 300, kps: 5.1 }),
    rec({ ts: 3, score: 900, kps: 3.0, mode: 'timeattack', taSeconds: 60 }),
    rec({ ts: 4, score: 999, kps: 6.0, mode: 'timeattack', taSeconds: 30 }),
    rec({ ts: 9, score: 2000, kps: 9.9 }), // 今回の記録
  ];
  it('今回の記録を除いて、スコアとKPSそれぞれの最大を返す', () => {
    expect(previousBest('royale', undefined, 9, list)).toEqual({ score: 500, kps: 5.1 });
  });
  it('タイムアタックは同じ秒数どうしで比べる', () => {
    expect(previousBest('timeattack', 60, null, list)).toEqual({ score: 900, kps: 3.0 });
  });
  it('記録が無ければ null（初記録）', () => {
    expect(previousBest('timeattack', 120, null, list)).toBeNull();
  });
});
