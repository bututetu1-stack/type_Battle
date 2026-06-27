// キーコンフィグ＆入力方式（プレイヤー個人設定。ソロ/オンライン共通）。
// キーは KeyboardEvent.code で保持・比較する（左右Shiftなどを区別できる）。
import type { ItemCat } from './items';

// cycle=スロット切替＋発動 / direct=各スロットに割当てたキーで即発動
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
    cycle: 'Space',
    fire: 'Enter',
    slots: { attack: 'Digit1', defense: 'Digit2', timed: 'Digit3' },
    target: 'Tab',
  };
}

// 旧データ(e.key保存)を code へ移行する。すでに code 形式ならそのまま。
function toCode(v: unknown, d: string): string {
  if (typeof v !== 'string' || v.length === 0) return d;
  if (v === ' ') return 'Space';
  if (/^[0-9]$/.test(v)) return `Digit${v}`;
  if (/^[a-zA-Z]$/.test(v)) return `Key${v.toUpperCase()}`;
  return v; // Enter / Tab / Escape / Space / ShiftLeft などはそのまま
}

export function loadKeyConfig(): KeyConfig {
  const def = defaultKeyConfig();
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const o = JSON.parse(raw);
      const s = o.slots && typeof o.slots === 'object' ? o.slots : {};
      return {
        inputMode: o.inputMode === 'direct' ? 'direct' : 'cycle',
        cycle: toCode(o.cycle, def.cycle),
        fire: toCode(o.fire, def.fire),
        slots: {
          attack: toCode(s.attack, def.slots.attack),
          defense: toCode(s.defense, def.slots.defense),
          timed: toCode(s.timed ?? s.disrupt, def.slots.timed),
        },
        target: toCode(o.target, def.target),
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

// code の表示名（Space, 1, A, L-Shift など）。
export function keyLabel(code: string): string {
  if (code === 'Space') return 'Space';
  if (code === 'Enter') return 'Enter';
  if (code === 'Tab') return 'Tab';
  if (code === 'Escape') return 'Esc';
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return `Num${code.slice(6)}`;
  if (code.startsWith('Key')) return code.slice(3);
  if (code === 'ShiftLeft') return 'L-Shift';
  if (code === 'ShiftRight') return 'R-Shift';
  if (code === 'ControlLeft') return 'L-Ctrl';
  if (code === 'ControlRight') return 'R-Ctrl';
  if (code === 'AltLeft') return 'L-Alt';
  if (code === 'AltRight') return 'R-Alt';
  if (code === 'ArrowUp') return '↑';
  if (code === 'ArrowDown') return '↓';
  if (code === 'ArrowLeft') return '←';
  if (code === 'ArrowRight') return '→';
  return code;
}
