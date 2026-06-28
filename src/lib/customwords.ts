// 端末に保存するカスタム追加語句（ソロや自分の出題に反映）。
import { isTypeableReading } from './words';

export interface CustomWord { display: string; reading: string }

const KEY = 'typeRoyale.customWords';

export function loadCustomWords(): CustomWord[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr
      .filter((w) => w && typeof w.display === 'string' && typeof w.reading === 'string')
      .map((w) => ({ display: w.display, reading: w.reading }));
  } catch { return []; }
}

export function saveCustomWords(list: CustomWord[]): void {
  try { localStorage.setItem(KEY, JSON.stringify(list)); } catch { /* 保存不可は無視 */ }
}

// 入力された読みが最後までローマ字入力できるか（追加可否の判定）。
export function validReading(reading: string): boolean {
  return isTypeableReading(reading);
}
