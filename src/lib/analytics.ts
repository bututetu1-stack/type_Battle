// リザルト用の打鍵分析（純粋関数）。苦手キー・速度推移・ランク判定。
// 他のタイピングサイトの定番機能を参考にしている:
//   苦手キー／キーボードのヒートマップ … タイプウェル・Keybr
//   速度の推移グラフ                 … Monkeytype
//   称号つきのランク判定             … e-typing・寿司打
import type { Word } from './types';

// ミスした瞬間に「次に打つべきだった1文字」。画面のローマ字ガイドと同じ規則
// （入力中の綴りに前方一致する最初の候補）で決めるので、表示と体感がずれない。
export function expectedNextChar(word: Word, tokenIndex: number, typing: string): string | null {
  const t = word.tokens[tokenIndex];
  if (!t) return null;
  // 促音「っ」の頭では、次の音の子音を重ねるのが一般的な打ち方。
  if (typing === '' && t.kana === 'っ') {
    const c = word.tokens[tokenIndex + 1]?.romaji[0]?.[0];
    if (c && !'aiueon'.includes(c)) return c;
  }
  const cand = t.romaji.find((r) => r.startsWith(typing) && r.length > typing.length);
  return cand ? cand[typing.length] : null;
}

export type Tally = Record<string, number>;

export const bump = (t: Tally, k: string | null | undefined) => {
  if (k) t[k] = (t[k] ?? 0) + 1;
};

// 多い順に上位 n 件（同数は文字順で安定させる）。
export function topOf(t: Tally, n: number): { key: string; count: number }[] {
  return Object.entries(t)
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key))
    .slice(0, n);
}

// 正しく打った時刻の列から、1秒ごとの打鍵数（=KPS）を作る。
// 生の値はギザギザなので、前後を含めた移動平均（窓 smooth 秒）でならす。
export function kpsSeries(times: number[], start: number, end: number, smooth = 3): number[] {
  const dur = Math.max(0, (end - start) / 1000);
  // 最後の区間が1秒に満たない時、そのまま数えると終盤が不当に遅く見える。
  // 0.5秒未満なら捨て、それ以上なら実際の長さで割り戻して KPS に揃える。
  const tail = dur - Math.floor(dur);
  const secs = Math.max(1, tail > 0 && tail < 0.5 ? Math.floor(dur) : Math.ceil(dur));
  const raw = new Array<number>(secs).fill(0);
  for (const t of times) {
    const i = Math.floor((t - start) / 1000);
    if (i >= 0 && i < secs) raw[i]++;
  }
  if (tail >= 0.5 && secs === Math.ceil(dur)) raw[secs - 1] /= tail;
  if (smooth <= 1) return raw;
  const h = Math.floor(smooth / 2);
  return raw.map((_, i) => {
    let sum = 0;
    let n = 0;
    for (let j = i - h; j <= i + h; j++) if (j >= 0 && j < secs) { sum += raw[j]; n++; }
    return sum / n;
  });
}

// ランク（KPS が基準、正確率が低いと段階を下げる）。
export interface Rank { id: string; title: string; minKps: number }
export const RANKS: Rank[] = [
  { id: 'D', title: '見習い', minKps: 0 },
  { id: 'C', title: '初級', minKps: 2 },
  { id: 'B', title: '中級', minKps: 3 },
  { id: 'B+', title: '上級', minKps: 4 },
  { id: 'A', title: '達人', minKps: 5 },
  { id: 'A+', title: '名人', minKps: 6 },
  { id: 'S', title: '超人', minKps: 7 },
  { id: 'S+', title: '神速', minKps: 8 },
];

export interface RankResult {
  rank: Rank;
  penalty: number; // 正確率で下がった段数
  next: Rank | null; // 1つ上のランク
  kpsToNext: number | null; // 次のランクに必要な KPS の差（正確率の減点が無い前提）
  accToNext: number | null; // 速さは足りていて、正確率さえ上げれば届く時の目標（0.9 など）
}

export function rankOf(kps: number, acc: number): RankResult {
  let idx = 0;
  for (let i = 0; i < RANKS.length; i++) if (kps >= RANKS[i].minKps) idx = i;
  const penalty = acc < 0.8 ? 2 : acc < 0.9 ? 1 : 0;
  const final = Math.max(0, idx - penalty);
  const next = RANKS[final + 1] ?? null;
  const kpsToNext = next ? Math.max(0, Math.round((next.minKps - kps) * 10) / 10) : null;
  // 速さは次のランクに届いているのに正確率で下げられている → 必要な正確率を示す。
  // allowed = 次のランクに届くために許される減点の段数（1段まで許されるなら80%、0段なら90%）。
  const allowed = idx - (final + 1);
  const accToNext = next && kpsToNext === 0 && penalty > allowed ? (allowed >= 1 ? 0.8 : 0.9) : null;
  return { rank: RANKS[final], penalty, next, kpsToNext, accToNext };
}
