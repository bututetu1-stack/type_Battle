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
  category: string; // 出題テーマ（タグ）。'all' で全語彙
  maxPlayers: number;
  hostUid: string;
  createdAt: number;
  mode?: 'royale' | 'boss'; // ゲームモード（未設定は royale）
  bossUid?: string; // boss モードでのボス（既定はホスト）
  itemRate?: number; // お宝(アイテム)出現率 0〜100（未設定は既定値）
  hp?: number; // 各プレイヤーの積載上限（HP）。未設定は既定値
  spawnMs?: number; // 自動供給の初期間隔(ms)。小さいほど速い。未設定は既定値
  attackGauge?: number; // 何クリアで攻撃を発射するか（既定5）
  attackCap?: number; // 1回の攻撃量の上限（既定5）
  comboStep?: number; // 何連鎖ごとに攻撃量+1（既定5）
  badgeCap?: number; // バッジ補正の上限枚数（既定4）
  badgeRate?: number; // バッジ1枚あたりの攻撃上昇率%（既定25）
  gaugeMode?: 'word' | 'char'; // ゲージ加算方式（既定 word）
  gaugeChars?: number; // 文字数方式のときの発射しきい値（既定16）
}

export interface RoomPlayer {
  name: string;
  alive: boolean;
  backlog: number; // mini-board 表示用の現在バックログ数
  combo: number;
  kpm: number;
  badges: number;
  rank: number; // 脱落時に確定（0=未確定）
  koBy: string; // 自分にトドメを刺した相手の uid（KOクレジット用）
  lastItem: string; // 直近に使用したアイテム種別（演出用）
  itemAt: number; // 直近にアイテムを使用した時刻
  connected: boolean;
  lastSeen: number;
  joinedAt: number;
  isCpu?: boolean; // CPU（ホストがシミュレートする擬似プレイヤー）
  str?: number; // CPUの強さ（0..1）。isCpu のときのみ意味を持つ
  // 観戦用（プレイ中の現在ワードと入力進捗。脱落者が他プレイヤーの入力画面を覗ける）。
  curDisplay?: string; // 現在打っているワード（表示テキスト）
  curReading?: string; // 現在打っているワードの読み（かな）
  curIdx?: number; // 確定済みトークン数（おおよその進捗）
  curTyping?: string; // 入力途中のローマ字
  curRomaji?: string; // 現在ワードの全ローマ字（観戦表示用）
  curRomajiDone?: number; // 確定済みローマ字の文字数（観戦表示用）
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
    koBy: '',
    lastItem: '',
    itemAt: 0,
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
    category: 'all',
    maxPlayers: DEFAULT_MAX_PLAYERS,
    hostUid: uid,
    createdAt: Date.now(),
    mode: 'royale',
    bossUid: '',
    itemRate: 30,
    hp: 12,
    spawnMs: 4000,
    attackGauge: 5,
    attackCap: 5,
    comboStep: 5,
    badgeCap: 4,
    badgeRate: 25,
    gaugeMode: 'word',
    gaugeChars: 16,
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
  summary: Partial<
    Pick<RoomPlayer, 'backlog' | 'combo' | 'kpm' | 'badges' | 'alive' | 'rank' | 'koBy' | 'lastItem' | 'itemAt'
      | 'curDisplay' | 'curReading' | 'curIdx' | 'curTyping' | 'curRomaji' | 'curRomajiDone'>
  >,
): void {
  update(ref(db, `rooms/${roomId}/players/${uid}`), { ...summary, lastSeen: Date.now() }).catch(() => {});
}

// ホスト操作: 出題テーマを変更（待機中）。
export async function setRoomCategory(roomId: string, category: string): Promise<void> {
  await update(ref(db, `rooms/${roomId}/meta`), { category });
}

// ホスト操作: ゲームモードを変更（待機中）。boss の場合はホストをボスにする。
export async function setRoomMode(roomId: string, mode: 'royale' | 'boss', hostUid: string): Promise<void> {
  await update(ref(db, `rooms/${roomId}/meta`), { mode, bossUid: mode === 'boss' ? hostUid : '' });
}

// ホスト操作: お宝(アイテム)出現率を変更（待機中、0〜100）。
export async function setRoomItemRate(roomId: string, itemRate: number): Promise<void> {
  await update(ref(db, `rooms/${roomId}/meta`), { itemRate: Math.min(100, Math.max(0, Math.round(itemRate))) });
}

// ホスト操作: 各プレイヤーのHP（積載上限）を変更（待機中、6〜24）。
export async function setRoomHp(roomId: string, hp: number): Promise<void> {
  await update(ref(db, `rooms/${roomId}/meta`), { hp: Math.min(24, Math.max(6, Math.round(hp))) });
}

// ホスト操作: 自動供給の初期間隔(ms)を変更（待機中、1500〜8000。小さいほど速い）。
export async function setRoomSpawnMs(roomId: string, spawnMs: number): Promise<void> {
  await update(ref(db, `rooms/${roomId}/meta`), { spawnMs: Math.min(8000, Math.max(1500, Math.round(spawnMs))) });
}

// ホスト操作: 攻撃まわりの設定を変更（待機中）。
export async function setRoomAttackGauge(roomId: string, v: number): Promise<void> {
  await update(ref(db, `rooms/${roomId}/meta`), { attackGauge: Math.min(10, Math.max(2, Math.round(v))) });
}
export async function setRoomAttackCap(roomId: string, v: number): Promise<void> {
  await update(ref(db, `rooms/${roomId}/meta`), { attackCap: Math.min(12, Math.max(2, Math.round(v))) });
}
export async function setRoomComboStep(roomId: string, v: number): Promise<void> {
  await update(ref(db, `rooms/${roomId}/meta`), { comboStep: Math.min(15, Math.max(2, Math.round(v))) });
}
export async function setRoomBadgeCap(roomId: string, v: number): Promise<void> {
  await update(ref(db, `rooms/${roomId}/meta`), { badgeCap: Math.min(10, Math.max(0, Math.round(v))) });
}
export async function setRoomBadgeRate(roomId: string, v: number): Promise<void> {
  await update(ref(db, `rooms/${roomId}/meta`), { badgeRate: Math.min(100, Math.max(0, Math.round(v))) });
}
export async function setRoomGaugeMode(roomId: string, v: 'word' | 'char'): Promise<void> {
  await update(ref(db, `rooms/${roomId}/meta`), { gaugeMode: v === 'char' ? 'char' : 'word' });
}
export async function setRoomGaugeChars(roomId: string, v: number): Promise<void> {
  await update(ref(db, `rooms/${roomId}/meta`), { gaugeChars: Math.min(40, Math.max(6, Math.round(v))) });
}

// --- CPU（ホストがシミュレートする擬似プレイヤー）---

const CPU_NAMES = ['タイピー', 'カナ丸', 'ロボ太', 'ことだま', 'はやて', 'ナイト', 'クローバー', 'ボルト', 'しぐれ', 'コメット'];

// ホスト操作: CPUプレイヤーを1体追加（待機中）。str は強さ 0..1。
export async function addCpuPlayer(roomId: string, str: number): Promise<void> {
  const metaSnap = await get(ref(db, `rooms/${roomId}/meta`));
  if (!metaSnap.exists()) throw new Error('ルームが見つかりません');
  const meta = metaSnap.val() as RoomMeta;
  const playersSnap = await get(ref(db, `rooms/${roomId}/players`));
  const count = playersSnap.exists() ? Object.keys(playersSnap.val()).length : 0;
  if (count >= meta.maxPlayers) throw new Error('ルームが満員です');
  const id = `cpu_${Math.random().toString(36).slice(2, 8)}`;
  const name = `🤖 ${CPU_NAMES[Math.floor(Math.random() * CPU_NAMES.length)]}`;
  const p: RoomPlayer = { ...newPlayer(name, false), isCpu: true, str: Math.min(1, Math.max(0, str)) };
  await set(ref(db, `rooms/${roomId}/players/${id}`), p);
}

// ホスト操作: 指定CPUを削除。
export async function removeCpuPlayer(roomId: string, cpuId: string): Promise<void> {
  await remove(ref(db, `rooms/${roomId}/players/${cpuId}`)).catch(() => {});
}

// ホスト操作: すべてのCPUを削除（退室時などに部屋を残さないため）。
export async function removeAllCpus(roomId: string): Promise<void> {
  const playersSnap = await get(ref(db, `rooms/${roomId}/players`));
  if (!playersSnap.exists()) return;
  const players = playersSnap.val() as Record<string, RoomPlayer>;
  await Promise.all(
    Object.entries(players)
      .filter(([, p]) => p.isCpu)
      .map(([id]) => remove(ref(db, `rooms/${roomId}/players/${id}`)).catch(() => {})),
  );
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

// 再戦: ホストが部屋を解散せず待機状態へ戻す（新しいシードで仕切り直し）。
// 各プレイヤーの alive/rank などは次のゲーム開始時に各自リセットする。
export async function resetRoom(roomId: string): Promise<void> {
  await update(ref(db, `rooms/${roomId}/meta`), {
    status: 'waiting',
    startAt: 0,
    seed: randomSeed(),
  });
  // 古い攻撃キューを掃除。
  await remove(ref(db, `rooms/${roomId}/attacks`)).catch(() => {});
}

// --- 攻撃（おじゃま送受信 / Phase 2）---

export interface AttackEvent {
  id: string;
  from: string;
  amount: number;
  word?: { display: string; reading: string }; // ロング送信の単語（任意）
}

// 対象プレイヤーへおじゃまを送信（/attacks/{targetUid} に push）。
// word を渡すと「ロング送信」（指定の長い単語を1個挿入させる）になる。
export function sendAttack(
  roomId: string,
  targetUid: string,
  fromUid: string,
  amount: number,
  word?: { display: string; reading: string },
): void {
  if (amount <= 0) return;
  const payload: Record<string, unknown> = { from: fromUid, amount, at: serverTimestamp() };
  if (word) payload.word = word;
  push(ref(db, `rooms/${roomId}/attacks/${targetUid}`), payload).catch(() => {});
}

// 自分宛ての攻撃を購読。受信したらコールバックし、即座にノードを削除（consume）。
export function subscribeAttacks(roomId: string, uid: string, cb: (ev: AttackEvent) => void): () => void {
  const aRef = ref(db, `rooms/${roomId}/attacks/${uid}`);
  const unsub = onChildAdded(aRef, (snap) => {
    const val = snap.val();
    if (val && typeof val.amount === 'number') {
      cb({ id: snap.key || '', from: val.from || '', amount: val.amount, word: val.word });
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
