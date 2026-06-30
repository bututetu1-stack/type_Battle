// 総合スコア計算＋端末ローカルのハイスコア記録（ソロ/タイムアタック）。
// タイピング数・正確率・KPS を合成した独自スコアでランキングを作る。

export interface ScoreInput {
  keys: number; // 正タイプ数（総打鍵）
  miss: number; // ミスタイプ数
  seconds: number; // 経過秒
  words?: number; // クリア語数
  maxCombo?: number; // 最大連鎖
}

// 正確率（0..1）。打鍵が無いときは 1 とみなす。
export function accuracyOf(keys: number, miss: number): number {
  const total = keys + miss;
  return total > 0 ? keys / total : 1;
}

// 秒間打鍵数（KPS）。経過が極端に短い場合の発散を防ぐ。
export function kpsOf(keys: number, seconds: number): number {
  return keys / Math.max(0.1, seconds);
}

// 総合スコア: 総打鍵 × 正確率² × KPS ＋ 連鎖ボーナス。
// 正確率を二乗で強めに反映する。係数は後から調整可能。
export function computeScore(inp: ScoreInput): number {
  const acc = accuracyOf(inp.keys, inp.miss);
  const kps = kpsOf(inp.keys, inp.seconds);
  const base = inp.keys * acc * acc * kps;
  const comboBonus = (inp.maxCombo ?? 0) * 5;
  return Math.max(0, Math.round(base + comboBonus));
}

export type ScoreMode = 'royale' | 'timeattack';

export interface ScoreRecord {
  name: string;
  mode: ScoreMode;
  theme: string;
  taSeconds?: number; // タイムアタックの制限秒（あれば）
  keys: number;
  kps: number;
  acc: number; // 0..1
  words: number;
  maxCombo: number;
  score: number;
  ts: number;
}

const SCORES_KEY = 'typeRoyale.scores';
const NAME_KEY = 'typeRoyale.playerName';
const MAX_PER_MODE = 20;

export function loadScores(): ScoreRecord[] {
  try {
    const raw = localStorage.getItem(SCORES_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr.filter((r) => r && typeof r.score === 'number');
  } catch {
    return [];
  }
}

function saveAll(list: ScoreRecord[]): void {
  try {
    localStorage.setItem(SCORES_KEY, JSON.stringify(list));
  } catch {
    /* 容量超過などは黙って無視 */
  }
}

// 記録を追加し、そのモード内での順位（1始まり）を返す。圏外なら null。
export function addScore(rec: ScoreRecord): number | null {
  const all = loadScores();
  const others = all.filter((r) => r.mode !== rec.mode);
  const same = all.filter((r) => r.mode === rec.mode);
  same.push(rec);
  same.sort((a, b) => b.score - a.score || b.ts - a.ts);
  const kept = same.slice(0, MAX_PER_MODE);
  saveAll([...others, ...kept]);
  const idx = kept.indexOf(rec);
  return idx >= 0 ? idx + 1 : null;
}

// モード別の記録（スコア降順）。
export function topScores(mode: ScoreMode): ScoreRecord[] {
  return loadScores()
    .filter((r) => r.mode === mode)
    .sort((a, b) => b.score - a.score || b.ts - a.ts);
}

export function loadPlayerName(): string {
  try {
    return localStorage.getItem(NAME_KEY) || 'プレイヤー';
  } catch {
    return 'プレイヤー';
  }
}

export function savePlayerName(name: string): void {
  try {
    localStorage.setItem(NAME_KEY, name.trim().slice(0, 16) || 'プレイヤー');
  } catch {
    /* 失敗は無視 */
  }
}
