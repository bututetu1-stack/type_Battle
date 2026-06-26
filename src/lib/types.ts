// アプリ全体で共有する型定義。

export type GameStatus = 'start' | 'playing' | 'gameover' | 'win';

export type WordType = 'normal' | 'ojama' | 'treasure';

// 判定単位（かな1文字 or 拗音などの2文字）と、その許容ローマ字。
export interface Token {
  kana: string;
  romaji: string[];
}

export interface Word {
  id: string;
  display: string; // 表示テキスト（漢字交じり）
  reading: string; // 読み（かな）。判定・トークン化の元
  type: WordType;
  tokens: Token[];
}

// ダミープレイヤー（ソロ＝CPU）の盤面。
export interface Dummy {
  id: number;
  height: number;
  isKO: boolean;
  name?: string;
  combo?: number; // 表示用の連鎖（演出のみ）
  lastItem?: ItemType; // 直近に使ったアイテム（演出用）
  itemAt?: number; // 直近にアイテムを使った時刻
  atk?: number; // プレイヤーを攻撃した回数（strongターゲット用）
}

// お宝単語クリアで獲得できるアイテム種別。
export type ItemType = 'shield' | 'clear' | 'brake' | 'longbomb' | 'rapid' | 'keep';

// 攻撃ターゲティング（仕様 §3.4）。
export type TargetMode = 'random' | 'finish' | 'counter' | 'strong';
