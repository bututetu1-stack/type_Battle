// アイテムの分類と「使い方」設定（ソロ/オンライン共通）。
import type { ItemType } from './types';

// アイテムの大分類（攻撃/防御/持続効果）。使い方設定・効果欄・スロットの分類に使う。
// timed = 一定時間効果が続くタイプ（ブレーキ/連射/連鎖キープ/受け流し/フリーズ/トーテム）。
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
  longbomb: 'attack', snipe: 'attack', burst: 'attack', heavy: 'attack', flood: 'attack', drain: 'attack',
  mirror: 'attack', meteor: 'attack', quake: 'attack', rally: 'attack', focus: 'attack',
  thunder: 'attack', jammer: 'attack',
  // 防御（即時に自分を守る/利する系）
  shield: 'defense', clear: 'defense', purge: 'defense', guard: 'defense', barrier: 'defense', shrink: 'defense',
  regen: 'defense',
  // 効果（一定時間続く系＋永続で効果が続く系＋お宝化）
  brake: 'timed', rapid: 'timed', keep: 'timed', parry: 'timed', totem: 'timed', freeze: 'timed',
  gaugedown: 'timed', luck: 'timed', maxhp: 'timed', goldify: 'timed',
  reflect: 'timed', overcharge: 'timed', siphon: 'timed',
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
