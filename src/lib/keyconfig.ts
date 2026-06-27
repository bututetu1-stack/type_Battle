// キーコンフィグ＆入力方式（プレイヤー個人設定。ソロ/オンライン共通）。
import type { ItemCat } from './items';

// cycle=スロット切替(Space)＋発動(Enter) / direct=各スロットに割当てたキーで即発動
export type InputMode = 'cycle' | 'direct';

export interface KeyConfig {
  inputMode: InputMode;
  cycle: string; // スロット切替キー（cycle方式）
  fire: string; // 発動キー（cycle方式）
  slots: Record<ItemCat, string>; // 各スロット直接発動キー（direct方式）
  target: string; // ターゲット切替キー
}

const KEY = 'typeRoyale.keys';

export function defaultKeyConfig(): KeyConfig {
  return {
    inputMode: 'cycle',
    cycle: ' ',
    fire: 'Enter',
    slots: { attack: '1', defense: '2', disrupt: '3' },
    target: 'Tab',
  };
}

const str = (v: unknown, d: string): string => (typeof v === 'string' && v.length > 0 ? v : d);

export function loadKeyConfig(): KeyConfig {
  const def = defaultKeyConfig();
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const o = JSON.parse(raw);
      return {
        inputMode: o.inputMode === 'direct' ? 'direct' : 'cycle',
        cycle: str(o.cycle, def.cycle),
        fire: str(o.fire, def.fire),
        slots: o.slots && typeof o.slots === 'object'
          ? { attack: str(o.slots.attack, def.slots.attack), defense: str(o.slots.defense, def.slots.defense), disrupt: str(o.slots.disrupt, def.slots.disrupt) }
          : def.slots,
        target: str(o.target, def.target),
      };
    }
  } catch { /* 既定値 */ }
  return def;
}

export function saveKeyConfig(c: KeyConfig): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(c));
  } catch { /* 保存不可環境は無視 */ }
}

// キーの表示名（' '→Space など）。
export function keyLabel(k: string): string {
  if (k === ' ') return 'Space';
  if (k === 'ArrowUp') return '↑';
  if (k === 'ArrowDown') return '↓';
  if (k === 'ArrowLeft') return '←';
  if (k === 'ArrowRight') return '→';
  if (k === 'Escape') return 'Esc';
  return k.length === 1 ? k.toUpperCase() : k;
}
