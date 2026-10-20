// アイテムの分類と「使い方」設定（ソロ/オンライン共通）。
import type { ItemType } from './types';

// アイテムの大分類（攻撃/防御/持続効果）。使い方設定・効果欄・スロットの分類に使う。
// timed = 一定時間効果が続くタイプ（連射/連鎖キープ/受け流し/フリーズ など）。
export type ItemCat = 'attack' | 'defense' | 'timed';
// 使い方: hold=保持(手動) / instant=即時(拾った瞬間) / auto=オート(良い時に自動) /
//          usenew=新着即時(スロットが埋まっている時、新しく来た方を自動発動して既存は保持)
export type UseMode = 'hold' | 'instant' | 'auto' | 'usenew';

// スロットの巡回順（切替キーでこの順に切り替える）。
export const CAT_ORDER: ItemCat[] = ['attack', 'defense', 'timed'];

// 使い方モードの表示ラベル。
export const USE_MODES: { key: UseMode; label: string; desc: string }[] = [
  { key: 'hold', label: '新着', desc: '[Enter]で手動発動（被ったら古い方を自動発動し新着を保持）' },
  { key: 'instant', label: '即時', desc: '拾った瞬間に自動発動' },
  { key: 'auto', label: 'オート', desc: '有利/不利を見て良い時に自動発動' },
  { key: 'usenew', label: '保持', desc: '1つ保持し、被ったら新しく来た方を自動発動（既存を保持）' },
];

export const ITEM_CAT: Record<ItemType, ItemCat> = {
  // 攻撃（相手におじゃまを送る系）
  snipe: 'attack', burst: 'attack', heavy: 'attack', flood: 'attack', drain: 'attack',
  mirror: 'attack', meteor: 'attack', quake: 'attack', rally: 'attack', focus: 'attack',
  thunder: 'attack', jammer: 'attack',
  // 防御（即時に自分を守る/利する系）
  shield: 'defense', clear: 'defense', purge: 'defense', guard: 'defense', barrier: 'defense', shrink: 'defense',
  regen: 'defense',
  // 効果（一定時間続く系＋永続で効果が続く系＋お宝化）
  rapid: 'timed', keep: 'timed', parry: 'timed', freeze: 'timed',
  goldify: 'timed',
  reflect: 'timed', overcharge: 'timed', siphon: 'timed', dazzle: 'timed',
};

// アイテムの傾向。def=防御/逆転（不利なほど出やすくする）, atk=攻撃（有利なほど出やすくする）, util=その他。
// 有利不利・順位によるドロップ補正に使う（ソロ/オンライン共通）。
export const ITEM_KIND: Record<ItemType, 'def' | 'atk' | 'util'> = {
  shield: 'def', clear: 'def', keep: 'util', shrink: 'def', parry: 'def',
  barrier: 'def', freeze: 'def', purge: 'def', guard: 'def',
  regen: 'def', mirror: 'def', goldify: 'def',
  reflect: 'def', overcharge: 'util', siphon: 'def',
  rapid: 'atk', meteor: 'atk', quake: 'atk', rally: 'atk', focus: 'atk',
  snipe: 'atk', burst: 'atk', heavy: 'atk', flood: 'atk', drain: 'atk',
  thunder: 'atk', jammer: 'atk', dazzle: 'atk',
};

// アイテムのレアリティ係数（ドロップ重みの乗数。1.0=標準、低いほど出にくい）。
// 強力すぎて出すぎると感じるものを抑える。未指定は 1.0。
export const ITEM_RARITY: Partial<Record<ItemType, number>> = {
  purge: 0.4, // 大掃除（盤面ほぼリセット）→ レアに
  freeze: 0.6,
  guard: 0.7,
  barrier: 0.75,
  goldify: 0.8,
  meteor: 0.6,
  quake: 0.5,
  regen: 0.7,
  reflect: 0.7,
  overcharge: 0.8,
  siphon: 0.7,
  thunder: 0.7,
  jammer: 0.3, // ジャマー（全員へ長文）→ 強力すぎるためレアに
  dazzle: 0.6, // 視認性低下（相手画面をゲーミング化）
};

export const CAT_META: { key: ItemCat; label: string; color: string }[] = [
  { key: 'attack', label: '攻撃', color: 'text-orange-300' },
  { key: 'defense', label: '防御', color: 'text-cyan-300' },
  { key: 'timed', label: '効果', color: 'text-fuchsia-300' },
];

// 「使い方」設定（プレイヤー個人の設定）。autoFull=完全オート。
export interface ItemPrefs {
  autoFull: boolean;
  use: Record<ItemCat, UseMode>;
}

// 設定はカスタム設定と同じ localStorage キーに同居させる（ソロ/オンライン共通）。
const PREFS_KEY = 'typeRoyale.custom';
const validMode = (v: unknown): UseMode =>
  v === 'instant' || v === 'auto' || v === 'usenew' ? v : 'hold';

export function defaultItemPrefs(): ItemPrefs {
  return { autoFull: false, use: { attack: 'hold', defense: 'hold', timed: 'hold' } };
}

export function loadItemPrefs(): ItemPrefs {
  const def = defaultItemPrefs();
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (raw) {
      const o = JSON.parse(raw);
      return {
        autoFull: typeof o.autoFull === 'boolean' ? o.autoFull : def.autoFull,
        use: o.use && typeof o.use === 'object'
          ? { attack: validMode(o.use.attack), defense: validMode(o.use.defense), timed: validMode(o.use.timed ?? o.use.disrupt) }
          : def.use,
      };
    }
  } catch { /* localStorage 不可環境は既定値 */ }
  return def;
}

// 既存のカスタム設定を壊さないよう autoFull/use のみマージ保存する。
export function saveItemPrefs(p: ItemPrefs): void {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    const o = raw ? JSON.parse(raw) : {};
    localStorage.setItem(PREFS_KEY, JSON.stringify({ ...o, autoFull: p.autoFull, use: p.use }));
  } catch { /* 保存不可環境は無視 */ }
}

// ===== アイテムの表示定義（ソロ/オンライン共通の単一の正） =====
// 以前は SoloGame / OnlineGame に同じ表が二重にあり、追加・削除のたび両方を直す必要があった。

// 時間制限つきアイテムの効果時間（ms）。両モードで同じ値を使う。
export const RAPID_DURATION = 8000; // 連射
export const KEEP_DURATION = 10000; // 連鎖キープ（ミスで連鎖が切れない）
export const PARRY_DURATION = 8000; // 受け流し（被攻撃を他の相手へ逸らす）
export const FREEZE_DURATION = 5000; // フリーズ（着弾予告と自動供給を停止）
export const DAZZLE_DURATION = 8000; // 視認性低下（お題パネルをゲーミング化）
export const REFLECT_DURATION = 8000; // リフレクト（被攻撃を送り主へ跳ね返す）
export const OVERCHARGE_DURATION = 8000; // オーバーチャージ（ゲージ倍速）
export const SIPHON_DURATION = 8000; // サイフォン（攻撃命中で自分のHP回復）

// 残り時間カウントダウンを出すアイテム。
export const ITEM_DURATION: Partial<Record<ItemType, number>> = {
  rapid: RAPID_DURATION,
  keep: KEEP_DURATION,
  parry: PARRY_DURATION,
  freeze: FREEZE_DURATION,
  reflect: REFLECT_DURATION,
  overcharge: OVERCHARGE_DURATION,
  siphon: SIPHON_DURATION,
};

// ストックされている単語を変化させる系アイテム（発動を分かりやすく強調する）。
export const BOARD_CHANGE_ITEMS = new Set<ItemType>(['purge', 'shrink', 'goldify', 'clear', 'drain']);

// onlineDesc: オンラインで挙動が違うものだけ説明を上書きする。
export interface ItemMeta { name: string; icon: string; desc: string; onlineDesc?: string }

export const ITEM_META: Record<ItemType, ItemMeta> = {
  shield: { name: 'シールド', icon: '🛡', desc: '次の自動供給を1回無効化' },
  clear: { name: 'おじゃま一掃', icon: '🌀', desc: 'バックログのおじゃまを消す' },
  rapid: { name: '連射', icon: '⚡', desc: '8秒間 1クリアごとにおじゃま+1' },
  keep: { name: '連鎖キープ', icon: '🔒', desc: '10秒間ミスしても連鎖が切れない' },
  shrink: { name: '短縮', icon: '✂', desc: '溜まったワードを全て短い単語に変換' },
  parry: { name: '受け流し', icon: '🪃', desc: '8秒間 被攻撃を他の相手へ逸らす' },
  // ボスモード専用
  meteor: { name: 'メテオ', icon: '🌠', desc: 'ボス: 全挑戦者へ一斉攻撃' },
  quake: { name: '地割れ', icon: '🌋', desc: 'ボス: 最も危険な挑戦者へトドメ' },
  regen: { name: '再生', icon: '💚', desc: 'ボス: 自分のHPを回復' },
  rally: { name: '総攻撃', icon: '⚔', desc: '挑戦者: ボスへ即時の大攻撃' },
  focus: { name: '会心', icon: '🎯', desc: '挑戦者: 次のボスへの攻撃を倍化' },
  // 防御
  barrier: { name: 'バリア', icon: '🛡️', desc: '次の被弾を1回まるごと防ぐ' },
  freeze: { name: 'フリーズ', icon: '🧊', desc: '5秒間 被攻撃を無効化＋自動供給を停止' },
  purge: { name: '大掃除', icon: '🧹', desc: 'バックログを全消去（逆転のチャンス）' },
  guard: { name: '超シールド', icon: '🧱', desc: 'シールドの上位互換。自動供給を2回ぶん防ぐ' },
  // 攻撃（送る数字は全ておじゃまの数）
  snipe: { name: '狙撃', icon: '🎯', desc: '最も危険な相手にトドメの一撃（おじゃま+4）' },
  burst: { name: 'バースト', icon: '💥', desc: '全ての相手へおじゃま+2' },
  heavy: { name: '強撃', icon: '🔨', desc: '連鎖に応じたおじゃまを即送信' },
  flood: {
    name: 'フラッド', icon: '🌊', desc: '狙った相手へ濁流の大量おじゃま+7',
    onlineDesc: '狙った相手へ濁流の波状おじゃま（相殺しにくい）',
  },
  drain: { name: 'ドレイン', icon: '🩸', desc: '自分を2減らし相手へおじゃま+2' },
  mirror: { name: 'ミラー', icon: '🪞', desc: '不利なほど強いおじゃまを送る' },
  // お宝
  goldify: { name: 'ゴールド化', icon: '✨', desc: '溜まっているワードを全てお宝に変える' },
  // オンライン専用
  reflect: { name: 'リフレクト', icon: '🪞', desc: '8秒間 受けた攻撃を送り主へ跳ね返す' },
  overcharge: { name: 'オーバーチャージ', icon: '🔋', desc: '8秒間 アタックゲージが倍速で溜まる' },
  thunder: { name: 'サンダーボルト', icon: '⚡', desc: '首位（最多連鎖）の相手へ落雷+5' },
  jammer: { name: 'ジャマー', icon: '📡', desc: '全相手へ長文おじゃまを送りつける' },
  siphon: { name: 'サイフォン', icon: '🧛', desc: '8秒間 攻撃が当たるたび自分のHPが回復' },
  dazzle: { name: '視認性低下', icon: '🌈', desc: '8秒間 狙った相手の画面をゲーミング(虹色)に光らせる' },
};

const mapMeta = <T>(f: (m: ItemMeta) => T) =>
  Object.fromEntries(Object.entries(ITEM_META).map(([k, m]) => [k, f(m)])) as Record<ItemType, T>;

export const ITEM_EMOJI: Record<ItemType, string> = mapMeta((m) => m.icon);
// オンライン用（説明だけモード別の上書きを反映）。
export const ONLINE_ITEM_META: Record<ItemType, ItemMeta> = mapMeta((m) => ({ ...m, desc: m.onlineDesc ?? m.desc }));
