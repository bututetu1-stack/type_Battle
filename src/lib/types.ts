// アプリ全体で共有する型定義。

export type GameStatus = 'start' | 'playing' | 'gameover';

export type WordType = 'normal' | 'ojama' | 'treasure';

// 判定単位（かな1文字 or 拗音などの2文字）と、その許容ローマ字。
export interface Token {
  kana: string;
  romaji: string[];
}

export interface Word {
  id: string;
  text: string;
  type: WordType;
  tokens: Token[];
}

// 周囲のダミープレイヤー（ミニボード）。
export interface Dummy {
  id: number;
  height: number;
  isKO: boolean;
}

// お宝単語クリアで獲得できるアイテム種別。
export type ItemType = 'shield' | 'clear' | 'brake';
