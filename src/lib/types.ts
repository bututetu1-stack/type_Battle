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
  str?: number; // CPUの強さ（0..1）。個体ごとに独立した思考・挙動の元
}

// お宝単語クリアで獲得できるアイテム種別。
export type ItemType =
  | 'shield'
  | 'clear'
  | 'brake'
  | 'longbomb'
  | 'rapid'
  | 'keep'
  | 'shrink' // 溜まったワードを全て短い単語に変換
  | 'parry' // 一定時間、被攻撃を他の相手に受け流す
  | 'gaugedown' // 攻撃ゲージの発射間隔を1減らす（一人一個・恒久）
  | 'totem' // 一定時間ワード上限超過を無効化（不死のトーテム）
  // --- ボスモード専用アイテム ---
  | 'meteor' // ボス: 全挑戦者に隕石（一斉攻撃）
  | 'quake' // ボス: 最も溜まっている挑戦者にトドメの大攻撃
  | 'regen' // ボス: 自分のバックログ（HP）を回復
  | 'rally' // 挑戦者: ボスへ即時の総攻撃
  | 'focus' // 挑戦者: 次のボスへの攻撃を倍化
  // --- 追加アイテム（防御） ---
  | 'barrier' // 次の被弾を1回まるごと防ぐ
  | 'freeze' // 一定時間 着弾予告の確定と自動供給を停止
  | 'purge' // バックログのおじゃまを全消去
  | 'guard' // 次の自動供給を複数回ぶん防ぐ
  // --- 追加アイテム（攻撃） ---
  | 'snipe' // 狙った相手へ即時の大攻撃
  | 'burst' // 全ての相手へ一斉攻撃
  | 'heavy' // 連鎖に応じた大攻撃を即送信
  // --- 追加アイテム（妨害） ---
  | 'flood' // 相手へ大量のおじゃまを送る
  | 'drain' // 自分のバックログを減らしつつ相手へ送る
  | 'mirror'; // 自分が不利なほど強い反撃を送る

// アイテムの大分類（演出/説明用）。
export type ItemCategory = 'defense' | 'attack' | 'disrupt' | 'boss';

// ゲームモード。royale=バトルロワイヤル（全員対全員）, boss=多対一（挑戦者 対 ボス）。
export type GameMode = 'royale' | 'boss';

// 攻撃ターゲティング（仕様 §3.4）。
export type TargetMode = 'random' | 'finish' | 'counter' | 'strong';
