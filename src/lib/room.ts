// ルーム層: Realtime Database 上のロビー/ルームの作成・参加・購読・presence。
// データ構造は仕様 §6.2 に準拠。
import {
  ref,
  set,
  update,
  get,
  remove,
  push,
  onValue,
  onChildAdded,
  onDisconnect,
  serverTimestamp,
} from 'firebase/database';
import { db } from './firebase';
import { randomSeed } from './rng';

export type RoomStatus = 'waiting' | 'countdown' | 'playing' | 'finished';

export interface RoomMeta {
  status: RoomStatus;
  startAt: number; // 同期開始時刻(ms, サーバ基準)。未開始は 0。
  seed: number; // 共通お題シード
  maxPlayers: number;
  hostUid: string;
  createdAt: number;
}

export interface RoomPlayer {
  name: string;
  alive: boolean;
  backlog: number; // mini-board 表示用の現在バックログ数
  combo: number;
  kpm: number;
  badges: number;
  rank: number; // 脱落時に確定（0=未確定）
  connected: boolean;
  lastSeen: number;
  joinedAt: number;
}

export interface RoomSnapshot {
  meta: RoomMeta | null;
  players: Record<string, RoomPlayer>;
}

export const DEFAULT_MAX_PLAYERS = 16;
export const COUNTDOWN_MS = 5000; // 開始カウントダウン

// --- サーバ時刻オフセット（同期スタートの基準） ---
let serverTimeOffset = 0;
onValue(ref(db, '.info/serverTimeOffset'), (snap) => {
  serverTimeOffset = snap.val() || 0;
});

// サーバ基準の現在時刻(ms)。startAt との比較に使う。
export function serverNow(): number {
  return Date.now() + serverTimeOffset;
}

// 4文字のルームコードを生成（紛らわしい文字を除外）。
function generateRoomId(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let id = '';
  for (let i = 0; i < 4; i++) id += chars[Math.floor(Math.random() * chars.length)];
  return id;
}

function newPlayer(name: string, host: boolean): RoomPlayer {
  return {
    name: name || (host ? 'Host' : 'Player'),
    alive: true,
    backlog: 0,
    combo: 0,
    kpm: 0,
    badges: 0,
    rank: 0,
    connected: true,
    lastSeen: Date.now(),
    joinedAt: Date.now(),
  };
}

// ルームを作成し、自分をホストとして入室。roomId を返す。
export async function createRoom(uid: string, name: string): Promise<string> {
  let roomId = generateRoomId();
  // 軽い衝突回避（数回試行）
  for (let i = 0; i < 5; i++) {
    const exists = await get(ref(db, `rooms/${roomId}/meta`));
    if (!exists.exists()) break;
    roomId = generateRoomId();
  }
  const meta: RoomMeta = {
    status: 'waiting',
    startAt: 0,
    seed: randomSeed(),
    maxPlayers: DEFAULT_MAX_PLAYERS,
    hostUid: uid,
    createdAt: Date.now(),
  };
  await set(ref(db, `rooms/${roomId}/meta`), meta);
  await set(ref(db, `rooms/${roomId}/players/${uid}`), newPlayer(name, true));
  return roomId;
}

// 既存ルームに参加。満員/開始済み/不在なら例外。
export async function joinRoom(roomId: string, uid: string, name: string): Promise<void> {
  const metaSnap = await get(ref(db, `rooms/${roomId}/meta`));
  if (!metaSnap.exists()) throw new Error('ルームが見つかりません');
  const meta = metaSnap.val() as RoomMeta;
  if (meta.status !== 'waiting') throw new Error('このルームは既に開始しています');

  const playersSnap = await get(ref(db, `rooms/${roomId}/players`));
  const count = playersSnap.exists() ? Object.keys(playersSnap.val()).length : 0;
  const alreadyIn = playersSnap.exists() && playersSnap.val()[uid];
  if (!alreadyIn && count >= meta.maxPlayers) throw new Error('ルームが満員です');

  await set(ref(db, `rooms/${roomId}/players/${uid}`), newPlayer(name, false));
}

// presence 設定: 切断時に connected=false / lastSeen を更新（onDisconnect）。
export async function setupPresence(roomId: string, uid: string): Promise<void> {
  const pRef = ref(db, `rooms/${roomId}/players/${uid}`);
  await onDisconnect(pRef).update({ connected: false, lastSeen: serverTimestamp() });
}

// ルーム全体（meta + players）を購読。
export function subscribeRoom(roomId: string, cb: (snap: RoomSnapshot) => void): () => void {
  const roomRef = ref(db, `rooms/${roomId}`);
  return onValue(roomRef, (snap) => {
    const val = snap.val() || {};
    cb({ meta: val.meta || null, players: val.players || {} });
  });
}

// 自分の表示用サマリを書込（呼び出し側で 300〜500ms スロットリング）。
export function writePlayerSummary(
  roomId: string,
  uid: string,
  summary: Partial<Pick<RoomPlayer, 'backlog' | 'combo' | 'kpm' | 'badges' | 'alive' | 'rank'>>,
): void {
  update(ref(db, `rooms/${roomId}/players/${uid}`), { ...summary, lastSeen: Date.now() }).catch(() => {});
}

// ホスト操作: カウントダウン付きで開始。startAt をサーバ基準の未来時刻に設定。
export async function startGame(roomId: string): Promise<void> {
  await update(ref(db, `rooms/${roomId}/meta`), {
    status: 'playing',
    startAt: serverNow() + COUNTDOWN_MS,
  });
}

// 決着: ホストが finished へ遷移。
export async function finishGame(roomId: string): Promise<void> {
  await update(ref(db, `rooms/${roomId}/meta`), { status: 'finished' });
}

// --- 攻撃（おじゃま送受信 / Phase 2）---

export interface AttackEvent {
  id: string;
  from: string;
  amount: number;
}

// 対象プレイヤーへおじゃまを送信（/attacks/{targetUid} に push）。
export function sendAttack(roomId: string, targetUid: string, fromUid: string, amount: number): void {
  if (amount <= 0) return;
  push(ref(db, `rooms/${roomId}/attacks/${targetUid}`), {
    from: fromUid,
    amount,
    at: serverTimestamp(),
  }).catch(() => {});
}

// 自分宛ての攻撃を購読。受信したらコールバックし、即座にノードを削除（consume）。
export function subscribeAttacks(roomId: string, uid: string, cb: (ev: AttackEvent) => void): () => void {
  const aRef = ref(db, `rooms/${roomId}/attacks/${uid}`);
  const unsub = onChildAdded(aRef, (snap) => {
    const val = snap.val();
    if (val && typeof val.amount === 'number') {
      cb({ id: snap.key || '', from: val.from || '', amount: val.amount });
    }
    remove(snap.ref).catch(() => {});
  });
  return unsub;
}

// 退室: 自分のノードを削除。空になればルームごと削除。
export async function leaveRoom(roomId: string, uid: string): Promise<void> {
  const pRef = ref(db, `rooms/${roomId}/players/${uid}`);
  await onDisconnect(pRef).cancel();
  await remove(pRef);
  const playersSnap = await get(ref(db, `rooms/${roomId}/players`));
  if (!playersSnap.exists()) {
    await remove(ref(db, `rooms/${roomId}`));
  }
}
