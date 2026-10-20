import { describe, it, expect } from 'vitest';
import { processKey, type PlayerState } from './engine';
import { tokenizeWord, isTypeableReading } from './words';
import type { Word } from './types';

const word = (reading: string): Word => ({
  id: 't', display: reading, reading, type: 'normal', tokens: tokenizeWord(reading),
});

const start = (reading: string): PlayerState => ({
  backlog: [word(reading)], tokenIndex: 0, currentTyping: '', combo: 0, gameState: 'playing',
});

// keys を1打ずつ流し、ミス数とクリアしたかを返す。
function type(reading: string, keys: string) {
  let s = start(reading);
  let misses = 0;
  let cleared = false;
  for (const k of keys) {
    const r = processKey(k, s);
    if (r.miss) misses++;
    if (r.wordCleared) cleared = true;
    if (r.nextState) s = r.nextState;
  }
  return { misses, cleared, state: s };
}

describe('processKey: 基本', () => {
  it('ひらがなを打ち切るとクリアし連鎖+1', () => {
    const r = type('すし', 'susi');
    expect(r).toMatchObject({ misses: 0, cleared: true });
    expect(r.state.combo).toBe(1);
    expect(r.state.backlog).toHaveLength(0);
  });

  it('複数の綴りを受け付ける（し = si / shi / ci）', () => {
    for (const k of ['susi', 'sushi', 'suci']) expect(type('すし', k)).toMatchObject({ misses: 0, cleared: true });
  });

  it('拗音の全綴り（じゃ = ja / jya / zya）', () => {
    for (const k of ['ja', 'jya', 'zya']) expect(type('じゃ', k)).toMatchObject({ misses: 0, cleared: true });
  });

  it('違うキーはミスになり連鎖が0に戻る', () => {
    const s = { ...start('すし'), combo: 7 };
    const r = processKey('x', s);
    expect(r.miss).toBe(true);
    expect(r.nextState?.combo).toBe(0);
  });

  it('ミスしても入力位置は進まない（打ち直せる）', () => {
    const r = type('すし', 'sxusi');
    expect(r).toMatchObject({ misses: 1, cleared: true });
  });

  it('長音（ー）は - で打つ', () => {
    expect(type('こーひー', 'ko-hi-')).toMatchObject({ misses: 0, cleared: true });
  });
});

describe('processKey: 促音「っ」', () => {
  it('次の子音を重ねて打つ（きって = kitte）', () => {
    expect(type('きって', 'kitte')).toMatchObject({ misses: 0, cleared: true });
  });

  it('単独入力（xtu / ltsu）でも打てる', () => {
    for (const k of ['kixtute', 'kiltsute']) expect(type('きって', k)).toMatchObject({ misses: 0, cleared: true });
  });

  it('次が「ち」の時は c でも t でも重ねられる', () => {
    for (const k of ['macchi', 'matti']) expect(type('まっち', k)).toMatchObject({ misses: 0, cleared: true });
  });
});

describe('processKey: 撥音「ん」', () => {
  it('子音の前は n 1打で確定（たいぴんぐ = taipingu）', () => {
    expect(type('たいぴんぐ', 'taipingu')).toMatchObject({ misses: 0, cleared: true });
  });

  it('nn でも打てる', () => {
    expect(type('たいぴんぐ', 'taipinngu')).toMatchObject({ misses: 0, cleared: true });
  });

  it('語末の「ん」は nn が必要', () => {
    expect(type('みかん', 'mikann')).toMatchObject({ misses: 0, cleared: true });
    expect(type('みかん', 'mikan').cleared).toBe(false);
  });

  it('な行・母音の前では n 1打で確定しない（こんにちは = konnnitiha）', () => {
    expect(type('こんにちは', 'konnnitiha')).toMatchObject({ misses: 0, cleared: true });
  });

  it('ショートカットで確定した n は表示用の綴りにも残る', () => {
    const s = { ...start('たいぴんぐ'), tokenIndex: 3, currentTyping: 'n' };
    const r = processKey('g', s);
    expect(r.typed?.[0]).toEqual({ index: 3, romaji: 'n' });
  });
});

describe('isTypeableReading', () => {
  it('ひらがなだけの読みは打てる', () => {
    expect(isTypeableReading('がっこう')).toBe(true);
    expect(isTypeableReading('じゃんけん')).toBe(true);
  });

  it('漢字・カタカナ・空文字は弾く', () => {
    expect(isTypeableReading('学校')).toBe(false);
    expect(isTypeableReading('カタカナ')).toBe(false);
    expect(isTypeableReading('')).toBe(false);
  });
});
