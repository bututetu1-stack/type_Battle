// グローバル・オンラインランキング（ソロ タイムアタックの総合スコア）。
// Firebase Realtime Database の leaderboard/timeattack/{bucket}/{uid} に
// 各プレイヤーの自己ベストを保存し、制限時間ごとに全プレイヤーで競う。
import { ref, get, set, update, query, orderByChild, limitToLast } from 'firebase/database';
import { db, ensureSignedIn } from './firebase';

// 集計バケット = タイムアタックの制限時間（秒）。SoloGame の制限時間プリセットと一致させる。
export const LEADERBOARD_BUCKETS = [30, 60, 90, 120] as const;
export type LeaderboardBucket = (typeof LEADERBOARD_BUCKETS)[number];

// 任意の秒数を最も近いプリセットバケットへ丸める（不正値や将来のプリセット変更に頑健に）。
export function nearestBucket(taSeconds: number): LeaderboardBucket {
  return LEADERBOARD_BUCKETS.reduce((best, b) =>
    Math.abs(b - taSeconds) < Math.abs(best - taSeconds) ? b : best,
  );
}

function bucketKey(taSeconds: number): string {
  return `${nearestBucket(taSeconds)}s`;
}

// ランキング1件。uid を含めて返す（自分の行のハイライト用）。
export interface GlobalEntry {
  uid: string;
  name: string;
  score: number;
  keys: number;
  kps: number;
  acc: number; // 0..1
  words: number;
  maxCombo: number;
  theme: string;
  ts: number;
}

// 送信用ペイロード（uid は内部のサインインで補う）。
export interface GlobalSubmitInput {
  name: string;
  score: number;
  keys: number;
  kps: number;
  acc: number;
  words: number;
  maxCombo: number;
  theme: string;
  taSeconds: number;
}

// 自己ベストをグローバルランキングへ送信する（既存スコアを上回る時だけ上書き）。
// 失敗（ルール未デプロイ・オフライン等）は呼び出し側で握れるよう throw する。
export async function submitGlobalScore(
  inp: GlobalSubmitInput,
): Promise<{ updated: boolean; rank: number | null }> {
  const uid = await ensureSignedIn();
  const path = `leaderboard/timeattack/${bucketKey(inp.taSeconds)}/${uid}`;
  const entryRef = ref(db, path);

  // 既存の自己ベストを確認し、上回る時だけ書き込む。
  const prevSnap = await get(entryRef);
  const prev = prevSnap.exists() ? (prevSnap.val() as { score?: number }) : null;
  const updated = !prev || typeof prev.score !== 'number' || inp.score > prev.score;
  if (updated) {
    await set(entryRef, {
      name: inp.name.slice(0, 16),
      score: inp.score,
      keys: inp.keys,
      kps: inp.kps,
      acc: inp.acc,
      words: inp.words,
      maxCombo: inp.maxCombo,
      theme: inp.theme,
      ts: Date.now(),
    });
  } else if (prev) {
    // スコアは自己ベストを維持しつつ、表示名だけは最新に更新する（自動保存後の改名対応）。
    await update(entryRef, { name: inp.name.slice(0, 16) });
  }

  // 送信後の順位（このバケット内・スコア降順）を計算して返す。
  const best = updated ? inp.score : (prev?.score ?? inp.score);
  const top = await fetchGlobalTop(inp.taSeconds, 200);
  const idx = top.findIndex((e) => e.uid === uid);
  const rank = idx >= 0 ? idx + 1 : best > 0 ? top.length + 1 : null;
  return { updated, rank };
}

// バケット内の上位を取得（スコア降順）。
export async function fetchGlobalTop(taSeconds: number, limit = 50): Promise<GlobalEntry[]> {
  const q = query(
    ref(db, `leaderboard/timeattack/${bucketKey(taSeconds)}`),
    orderByChild('score'),
    limitToLast(limit),
  );
  const snap = await get(q);
  if (!snap.exists()) return [];
  const out: GlobalEntry[] = [];
  snap.forEach((child) => {
    const v = child.val() as Omit<GlobalEntry, 'uid'>;
    out.push({ uid: child.key as string, ...v });
  });
  out.sort((a, b) => b.score - a.score || a.ts - b.ts);
  return out;
}

// 現在の匿名 uid（自分の行ハイライト用）。失敗時は null。
export async function currentUid(): Promise<string | null> {
  try {
    return await ensureSignedIn();
  } catch {
    return null;
  }
}
