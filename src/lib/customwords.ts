// 端末に保存するカスタム追加語句（ソロや自分の出題に反映）。
import { isTypeableReading } from './words';

// group … ユーザーが自由に作れる「自作テーマ」名。未設定＝未分類。
export interface CustomWord { display: string; reading: string; group?: string }

const KEY = 'typeRoyale.customWords';
const GROUP_KEY = 'typeRoyale.customGroups';

export function loadCustomWords(): CustomWord[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr
      .filter((w) => w && typeof w.display === 'string' && typeof w.reading === 'string')
      .map((w) => ({
        display: w.display,
        reading: w.reading,
        ...(typeof w.group === 'string' && w.group ? { group: w.group } : {}),
      }));
  } catch { return []; }
}

export function saveCustomWords(list: CustomWord[]): void {
  try {
    const clean = list.map((w) => ({
      display: w.display,
      reading: w.reading,
      ...(w.group ? { group: w.group } : {}),
    }));
    localStorage.setItem(KEY, JSON.stringify(clean));
  } catch { /* 保存不可は無視 */ }
}

// --- 自作テーマ（グループ）名の一覧 ---
// 空のテーマも作れるよう、語句とは別に名前一覧を保存する。
export function loadCustomGroups(): string[] {
  try {
    const raw = localStorage.getItem(GROUP_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr.filter((g) => typeof g === 'string' && g.trim()).map((g) => g.trim());
  } catch { return []; }
}

export function saveCustomGroups(list: string[]): void {
  try {
    const uniq = Array.from(new Set(list.map((g) => g.trim()).filter(Boolean)));
    localStorage.setItem(GROUP_KEY, JSON.stringify(uniq));
  } catch { /* 保存不可は無視 */ }
}

// テーマ名として使える形に整える（区切り文字に使う「,」「:」は不可）。
export function sanitizeGroupName(name: string): string {
  return name.replace(/[,:]/g, '').trim().slice(0, 20);
}

// 入力された読みが最後までローマ字入力できるか（追加可否の判定）。
export function validReading(reading: string): boolean {
  return isTypeableReading(reading);
}
