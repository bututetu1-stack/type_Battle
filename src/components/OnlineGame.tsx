import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Swords, Zap, AlertTriangle, Crown, Shield, Wind, Pause, Sparkles,
  Target, RotateCcw, LogOut, Volume2, VolumeX, Bomb, Lock,
} from 'lucide-react';
import { mulberry32, type RNG } from '../lib/rng';
import { generateWord, makeOjamaWord, makeOjamaWordFrom, makeShortWord, randomLongWord } from '../lib/words';
import { processKey, type PlayerState } from '../lib/engine';
import {
  serverNow, writePlayerSummary, finishGame, resetRoom, sendAttack, subscribeAttacks,
  type RoomPlayer, type RoomStatus,
} from '../lib/room';
import { sfx, resumeAudio, setSfxEnabled } from '../lib/sfx';
import { ITEM_CAT, type ItemPrefs } from '../lib/items';
import type { GameMode, ItemType, TargetMode, Word } from '../lib/types';
import MiniBoard from './MiniBoard';
import CurrentWord from './CurrentWord';
import AttackGauge from './AttackGauge';

const MAX_BACKLOG = 12;
const INITIAL_SPAWN_INTERVAL = 4000;
const MIN_SPAWN_INTERVAL = 1000;
const WRITE_INTERVAL = 400;
const TELEGRAPH_DELAY = 2500; // 着弾予告→確定までの猶予（相殺の反応時間を確保）
const PINCH_RATIO = 0.7;
const PINCH_MULT = 1.5;
const BRAKE_DURATION = 5000;
const ATTACK_CAP = 5; // 1回の攻撃で送れるおじゃまの上限（即死コンボ防止）
const BOSS_MAX_BACKLOG = 26; // ボスのバックログ上限（＝ボスのHP。多対一なので高め）

const ITEM_META: Record<ItemType, { name: string; desc: string }> = {
  shield: { name: 'シールド', desc: '次の自動供給を1回無効化' },
  clear: { name: 'おじゃま一掃', desc: 'バックログのおじゃまを消す' },
  brake: { name: 'ブレーキ', desc: '自動供給を5秒間ストップ' },
  longbomb: { name: 'ロング送信', desc: '相手に長文(相殺不可)を送りつける' },
  rapid: { name: '連射', desc: '8秒間 1クリアごとに1攻撃' },
  keep: { name: '連鎖キープ', desc: '10秒間ミスしても連鎖が切れない' },
  shrink: { name: '短縮', desc: '溜まったワードを全て短い単語に変換' },
  parry: { name: '受け流し', desc: '一定時間 被攻撃を他の相手に逸らす' },
  gaugedown: { name: 'ゲージ短縮', desc: '攻撃の発射間隔を1減らす(恒久)' },
  totem: { name: '不死のトーテム', desc: '一定時間 上限超過しても脱落しない' },
  meteor: { name: 'メテオ', desc: 'ボス: 全挑戦者へ一斉攻撃' },
  quake: { name: '地割れ', desc: 'ボス: 最も危険な挑戦者へトドメ' },
  regen: { name: '再生', desc: 'ボス: 自分のHPを回復' },
  rally: { name: '総攻撃', desc: '挑戦者: ボスへ即時の大攻撃' },
  focus: { name: '会心', desc: '挑戦者: 次のボスへの攻撃を倍化' },
  barrier: { name: 'バリア', desc: '次の被弾を1回まるごと防ぐ' },
  freeze: { name: 'フリーズ', desc: '5秒間 着弾予告と自動供給を停止' },
  purge: { name: '大掃除', desc: 'バックログを全消去（逆転のチャンス）' },
  guard: { name: 'ガード', desc: '次の自動供給を2回ぶん防ぐ' },
  snipe: { name: '狙撃', desc: '狙った相手へ即+3' },
  burst: { name: 'バースト', desc: '全ての相手へ一斉に+2' },
  heavy: { name: '強撃', desc: '連鎖に応じた大攻撃を即送信' },
  flood: { name: 'フラッド', desc: '相手へ大量(+4)のおじゃま' },
  drain: { name: 'ドレイン', desc: '自分を2減らし相手へ+2' },
  mirror: { name: 'ミラー', desc: '不利なほど強い反撃を送る' },
};
const ITEM_EMOJI: Record<ItemType, string> = {
  shield: '🛡',
  clear: '🌀',
  brake: '⏸',
  longbomb: '📨',
  rapid: '⚡',
  keep: '🔒',
  shrink: '✂',
  parry: '🪃',
  gaugedown: '⏬',
  totem: '🗿',
  meteor: '🌠',
  quake: '🌋',
  regen: '💚',
  rally: '⚔',
  focus: '🎯',
  barrier: '🛡️',
  freeze: '🧊',
  purge: '🧹',
  guard: '🧱',
  snipe: '🎯',
  burst: '💥',
  heavy: '🔨',
  flood: '🌊',
  drain: '🩸',
  mirror: '🪞',
};
// アイテムの大分類。def=防御/逆転（不利なほど出やすい）, atk=攻撃（有利なほど出やすい）, util=その他。
const ITEM_KIND: Record<ItemType, 'def' | 'atk' | 'util'> = {
  shield: 'def', clear: 'def', brake: 'def', keep: 'util', shrink: 'def', parry: 'def',
  gaugedown: 'def', totem: 'def', barrier: 'def', freeze: 'def', purge: 'def', guard: 'def',
  regen: 'def', mirror: 'def',
  longbomb: 'atk', rapid: 'atk', meteor: 'atk', quake: 'atk', rally: 'atk', focus: 'atk',
  snipe: 'atk', burst: 'atk', heavy: 'atk', flood: 'atk', drain: 'atk',
};

const RAPID_DURATION = 8000;
const KEEP_DURATION = 10000;
const PARRY_DURATION = 8000; // 受け流し（被攻撃を他プレイヤーへ逸らす）の効果時間
const FREEZE_DURATION = 5000; // フリーズ（着弾予告と自動供給を停止）の効果時間

// 時間制限つきアイテムの効果時間（カウントダウンゲージ用）。
const ITEM_DURATION: Partial<Record<ItemType, number>> = {
  brake: BRAKE_DURATION,
  rapid: RAPID_DURATION,
  keep: KEEP_DURATION,
  parry: PARRY_DURATION,
  freeze: FREEZE_DURATION,
};

const TARGET_MODES: { mode: TargetMode; label: string }[] = [
  { mode: 'random', label: 'ランダム' },
  { mode: 'counter', label: '反撃' },
  { mode: 'finish', label: 'とどめ' },
  { mode: 'strong', label: '強敵' },
];

interface Telegraph {
  id: string;
  amount: number;
  confirmAt: number;
  word?: { display: string; reading: string }; // ロング送信の単語
}

// 生存判定: 脱落していない かつ 接続中（切断したプレイヤーは脱落扱い / Phase 4）。
const isLive = (p: RoomPlayer) => p.alive && p.connected !== false;

interface OnlineGameProps {
  roomId: string;
  uid: string;
  seed: number;
  startAt: number;
  status: RoomStatus;
  hostUid: string;
  category: string;
  mode: GameMode;
  bossUid: string;
  itemRate: number;
  itemPrefs: ItemPrefs;
  players: Record<string, RoomPlayer>;
  onExit: () => void;
}

export default function OnlineGame({ roomId, uid, seed, startAt, status, hostUid, category, mode, bossUid, itemRate, itemPrefs, players, onExit }: OnlineGameProps) {
  // ボスモード関連の派生フラグ。
  const bossMode = mode === 'boss';
  const isBoss = bossMode && uid === bossUid;
  const selfMax = isBoss ? BOSS_MAX_BACKLOG : MAX_BACKLOG; // 自分の上限（ボスはHPが多い）
  const [started, setStarted] = useState(false);
  const [countdown, setCountdown] = useState(99);
  const [selfAlive, setSelfAlive] = useState(true);
  const [rank, setRank] = useState(0);

  const [backlog, setBacklog] = useState<PlayerState['backlog']>([]);
  const [tokenIndex, setTokenIndex] = useState(0);
  const [currentTyping, setCurrentTyping] = useState('');
  const [combo, setCombo] = useState(0);
  const [maxCombo, setMaxCombo] = useState(0);
  const [keysTyped, setKeysTyped] = useState(0);
  const [missCount, setMissCount] = useState(0); // ミスタイプ数（リザルト用）
  const [spawnInterval, setSpawnInterval] = useState(INITIAL_SPAWN_INTERVAL);
  const [missFlash, setMissFlash] = useState(false);
  const [pending, setPending] = useState<Telegraph[]>([]);
  const [attackFlash, setAttackFlash] = useState<{ amount: number; name: string } | null>(null);
  const [heldItem, setHeldItem] = useState<ItemType | null>(null);
  const [itemFlash, setItemFlash] = useState(false);
  const [targetMode, setTargetMode] = useState<TargetMode>('random');
  const [muted, setMuted] = useState(false);
  const [attackProgress, setAttackProgress] = useState(0); // 次の攻撃までのゲージ（ミスで減らない）
  const [nowTick, setNowTick] = useState(0); // カウントダウン描画用の時刻
  // エフェクト用
  const [beams, setBeams] = useState<{ id: number; x1: number; y1: number; x2: number; y2: number; color: string }[]>([]);
  const [hitId, setHitId] = useState<string | null>(null); // 自分が攻撃した相手
  const [incomingId, setIncomingId] = useState<string | null>(null); // 自分を攻撃してきた相手
  const [toasts, setToasts] = useState<{ id: number; text: string; kind: 'ko' | 'in' | 'item' }[]>([]);
  const [shake, setShake] = useState(false);
  const [damageFlash, setDamageFlash] = useState(false); // 被弾時の赤フラッシュ
  const [useFlash, setUseFlash] = useState<ItemType | null>(null); // 自分のアイテム発動演出
  const [parryFx, setParryFx] = useState(false); // 受け流し成功エフェクト

  const centerRef = useRef<HTMLDivElement>(null);
  const boardRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const beamIdRef = useRef(0);
  const toastIdRef = useRef(0);
  const prevPlayersRef = useRef(players);

  const startTimeRef = useRef(0);
  const endTimeRef = useRef(0); // ゲーム終了時刻（KPM固定用）
  const wordRngRef = useRef<RNG | null>(null);
  const itemRngRef = useRef<RNG | null>(null);
  const stateRef = useRef<PlayerState>({ backlog, tokenIndex, currentTyping, combo, gameState: 'playing' });
  const selfAliveRef = useRef(true);
  const playersRef = useRef(players);
  const heldItemRef = useRef(heldItem);
  const targetModeRef = useRef(targetMode);
  const lastAttackerRef = useRef('');
  const shieldRef = useRef(false);
  const brakeUntilRef = useRef(0);
  const rapidUntilRef = useRef(0);
  const keepUntilRef = useRef(0);
  const parryUntilRef = useRef(0);
  const freezeUntilRef = useRef(0); // フリーズ（着弾予告/供給停止）
  const barrierRef = useRef(false); // バリア（次の被弾を1回防ぐ）
  const guardCountRef = useRef(0); // ガード（自動供給を複数回防ぐ）
  const focusNextRef = useRef(false); // 会心: 次のボスへの攻撃を倍化
  const recentRef = useRef<string[]>([]); // 直近に出した単語（近接重複の回避・全員同一）
  const attackProgressRef = useRef(0);
  const categoryRef = useRef(category);
  useEffect(() => {
    categoryRef.current = category;
  }, [category]);
  const itemRateRef = useRef(itemRate);
  useEffect(() => {
    itemRateRef.current = itemRate;
  }, [itemRate]);
  // アイテムの使い方設定（自分用）。ゲーム中に参照するため ref で保持。
  const autoFullRef = useRef(itemPrefs.autoFull);
  const useModeRef = useRef(itemPrefs.use);
  useEffect(() => {
    autoFullRef.current = itemPrefs.autoFull;
    useModeRef.current = itemPrefs.use;
  }, [itemPrefs]);
  const pendingRef = useRef<Telegraph[]>([]);
  const updatePending = useCallback((next: Telegraph[]) => {
    pendingRef.current = next;
    setPending(next);
  }, []);

  // 単語生成（近接重複を避ける）。エントリ列はシード共有なので recent も全員同一になり、
  // 引き直しの rng 消費数も一致＝同期は崩れない。種別はローカル乱数（localType）。
  const genWord = useCallback((): Word => {
    const rng = wordRngRef.current!;
    const w = generateWord(rng, categoryRef.current, recentRef.current, true, itemRateRef.current / 100);
    recentRef.current = [...recentRef.current, w.display].slice(-20);
    return w;
  }, []);

  const pushToast = useCallback((text: string, kind: 'ko' | 'in' | 'item') => {
    const id = toastIdRef.current++;
    setToasts((t) => [...t, { id, text, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 1700);
  }, []);

  const addBeam = useCallback((x1: number, y1: number, x2: number, y2: number, color: string) => {
    const id = beamIdRef.current++;
    setBeams((b) => [...b, { id, x1, y1, x2, y2, color }]);
    setTimeout(() => setBeams((b) => b.filter((x) => x.id !== id)), 700);
  }, []);

  // 自分のボード → 対象ミニボードへ攻撃ビーム（オレンジ）。
  const fireBeam = useCallback(
    (targetId: string) => {
      const from = centerRef.current?.getBoundingClientRect();
      const to = boardRefs.current[targetId]?.getBoundingClientRect();
      setHitId(targetId);
      setTimeout(() => setHitId((cur) => (cur === targetId ? null : cur)), 650);
      if (!from || !to) return;
      addBeam(from.left + from.width / 2, from.top + from.height * 0.35, to.left + to.width / 2, to.top + to.height / 2, '#fb923c');
    },
    [addBeam],
  );

  // 攻撃してきた相手 → 自分のボードへ被弾ビーム（赤）＋画面赤フラッシュ＋シェイク。
  const fireIncoming = useCallback(
    (fromId: string) => {
      setIncomingId(fromId);
      setTimeout(() => setIncomingId((cur) => (cur === fromId ? null : cur)), 650);
      setDamageFlash(true);
      setTimeout(() => setDamageFlash(false), 220);
      setShake(true);
      setTimeout(() => setShake(false), 350);
      const from = boardRefs.current[fromId]?.getBoundingClientRect();
      const to = centerRef.current?.getBoundingClientRect();
      if (!from || !to) return;
      addBeam(from.left + from.width / 2, from.top + from.height / 2, to.left + to.width / 2, to.top + to.height * 0.35, '#ef4444');
    },
    [addBeam],
  );

  useEffect(() => {
    stateRef.current = { backlog, tokenIndex, currentTyping, combo, gameState: 'playing' };
  }, [backlog, tokenIndex, currentTyping, combo]);
  useEffect(() => { selfAliveRef.current = selfAlive; }, [selfAlive]);
  useEffect(() => { playersRef.current = players; }, [players]);
  useEffect(() => { heldItemRef.current = heldItem; }, [heldItem]);
  useEffect(() => { targetModeRef.current = targetMode; }, [targetMode]);

  const calculateKPM = useCallback(() => {
    if (!startTimeRef.current || keysTyped === 0) return 0;
    // 終了後は終了時刻で固定（裏で時間が進んで KPM が下がるのを防ぐ）。
    const end = endTimeRef.current || Date.now();
    const minutes = Math.max(1 / 600, (end - startTimeRef.current) / 60000);
    return Math.floor(keysTyped / minutes);
  }, [keysTyped]);

  // 自分が稼いだバッジ数（自分にトドメ＝koBy===uid のプレイヤー数）。
  const myBadges = Object.values(players).filter((p) => p.koBy === uid).length;

  // シードから RNG と初期バックログを生成（全員同一）。アイテム抽選用は別系列。
  useEffect(() => {
    const rng = mulberry32(seed >>> 0);
    wordRngRef.current = rng;
    itemRngRef.current = mulberry32((seed ^ 0x9e3779b9) >>> 0);
    // 種別はローカル乱数で（お宝＝アイテムが各プレイヤーに確実に出るように）。出現率はホスト設定。
    recentRef.current = [];
    setBacklog([genWord(), genWord(), genWord()]);
    attackProgressRef.current = 0;
    setAttackProgress(0);
    keepUntilRef.current = 0;
    rapidUntilRef.current = 0;
    parryUntilRef.current = 0;
    freezeUntilRef.current = 0;
    barrierRef.current = false;
    guardCountRef.current = 0;
    endTimeRef.current = 0;
    setKeysTyped(0);
    setMissCount(0);
    // 新しいゲーム開始時に自分の状態をリセット（再戦対応）。
    writePlayerSummary(roomId, uid, { alive: true, rank: 0, backlog: 3, combo: 0, koBy: '' });
  }, [seed, roomId, uid, genWord]);

  // startAt に達したらゲーム開始。それまではカウントダウン（秒ごとにビープ）。
  const lastBeepRef = useRef(99);
  useEffect(() => {
    if (started) return;
    resumeAudio();
    const tick = () => {
      const remain = startAt - serverNow();
      if (remain <= 0) {
        setStarted(true);
        startTimeRef.current = Date.now();
        sfx.start();
      } else {
        const sec = Math.ceil(remain / 1000);
        setCountdown(sec);
        if (sec !== lastBeepRef.current && sec <= 3) {
          lastBeepRef.current = sec;
          sfx.countdown();
        }
      }
    };
    tick();
    const id = setInterval(tick, 200);
    return () => clearInterval(id);
  }, [startAt, started]);

  // 決着時、まだ脱落していない（勝者）なら KPM をこの時点で固定する。
  useEffect(() => {
    if (status === 'finished' && endTimeRef.current === 0) endTimeRef.current = Date.now();
  }, [status]);

  // 自分が脱落。順位と KO クレジット（koBy）を確定。
  const topOut = useCallback(() => {
    if (!selfAliveRef.current) return;
    // ボスは挑戦者が全滅していれば勝利確定。決着の伝播待ちに過積載で自滅しないようにする。
    if (bossMode && isBoss) {
      const aliveChallengers = Object.entries(playersRef.current).filter(([id, p]) => id !== bossUid && isLive(p)).length;
      if (aliveChallengers === 0) return;
    }
    selfAliveRef.current = false;
    endTimeRef.current = Date.now(); // KPM をこの時点で固定
    const aliveCount = Object.values(playersRef.current).filter(isLive).length;
    const myRank = Math.max(1, aliveCount);
    setRank(myRank);
    setSelfAlive(false);
    sfx.gameover();
    setShake(true);
    setTimeout(() => setShake(false), 500);
    writePlayerSummary(roomId, uid, { alive: false, rank: myRank, backlog: selfMax, koBy: lastAttackerRef.current });
  }, [roomId, uid, selfMax, bossMode, isBoss, bossUid]);

  // 他プレイヤーの脱落を検知してトースト表示（自分の撃破なら強調）。
  useEffect(() => {
    const prev = prevPlayersRef.current;
    for (const [id, p] of Object.entries(players)) {
      if (id === uid) continue;
      const prevP = prev[id];
      const wasLive = prevP && prevP.alive && prevP.connected !== false;
      if (wasLive && !isLive(p)) {
        if (p.koBy === uid) {
          pushToast(`${p.name} を撃破！`, 'ko');
          sfx.ko();
        } else {
          pushToast(`${p.name} 脱落`, 'in');
          sfx.eliminate();
        }
      }
      // 他プレイヤーのアイテム使用を検知
      if (p.itemAt && prevP && p.itemAt !== prevP.itemAt && p.lastItem) {
        const meta = ITEM_META[p.lastItem as ItemType];
        pushToast(`${p.name} が ${meta ? meta.name : 'アイテム'} 使用`, 'item');
      }
    }
    prevPlayersRef.current = players;
  }, [players, uid, pushToast]);

  // ターゲット選択（4モード / 仕様 §3.4）。
  const pickTarget = useCallback(() => {
    // ボスモード: 挑戦者は常にボスを狙い、ボスは挑戦者の中から狙う。
    if (bossMode) {
      if (isBoss) {
        const challengers = Object.entries(playersRef.current).filter(([id, p]) => id !== bossUid && isLive(p));
        if (challengers.length === 0) return null;
        const m = targetModeRef.current;
        if (m === 'finish' || m === 'strong')
          return challengers.reduce((best, cur) => (cur[1].backlog > best[1].backlog ? cur : best))[0];
        return challengers[Math.floor(Math.random() * challengers.length)][0];
      }
      // 挑戦者: ボスが生きていればボスを狙う。
      return isLive(playersRef.current[bossUid]) ? bossUid : null;
    }
    const alive = Object.entries(playersRef.current).filter(([id, p]) => id !== uid && isLive(p));
    if (alive.length === 0) return null;
    const mode = targetModeRef.current;
    if (mode === 'counter') {
      const la = lastAttackerRef.current;
      const found = alive.find(([id]) => id === la);
      if (found) return found[0];
    } else if (mode === 'finish') {
      return alive.reduce((best, cur) => (cur[1].backlog > best[1].backlog ? cur : best))[0];
    } else if (mode === 'strong') {
      return alive.reduce((best, cur) => (cur[1].badges > best[1].badges ? cur : best))[0];
    }
    return alive[Math.floor(Math.random() * alive.length)][0];
  }, [uid, bossMode, isBoss, bossUid]);

  // 防御の相殺: 来ている着弾予告を n だけ打ち消す（長文は対象外）。
  // 「1クリアごとに1相殺」でタイピングそのものを防御にする。
  const offsetIncoming = useCallback((n: number) => {
    if (n <= 0 || pendingRef.current.length === 0) return;
    let remaining = n;
    const sorted = [...pendingRef.current].sort((a, b) => a.confirmAt - b.confirmAt);
    let changed = false;
    for (const e of sorted) {
      if (remaining <= 0) break;
      if (e.word) continue; // 長文は相殺不可
      const cut = Math.min(remaining, e.amount);
      if (cut > 0) { e.amount -= cut; remaining -= cut; changed = true; }
    }
    if (changed) updatePending(sorted.filter((e) => e.amount > 0 || e.word));
  }, [updatePending]);

  // 指定量を送る共通処理: 受信予告と相殺 → 余剰を相手へ。
  const sendAmount = useCallback(
    (amount: number) => {
      if (amount <= 0) return;
      let remaining = amount;
      const sorted = [...pendingRef.current].sort((a, b) => a.confirmAt - b.confirmAt);
      for (const e of sorted) {
        if (remaining <= 0) break;
        if (e.word) continue; // 長文（ロング送信）は相殺対象外で必ず着弾する
        const cut = Math.min(remaining, e.amount);
        e.amount -= cut;
        remaining -= cut;
      }
      updatePending(sorted.filter((e) => e.amount > 0 || e.word));
      sfx.attack();
      if (remaining > 0) {
        const targetId = pickTarget();
        if (targetId) {
          const targetName = playersRef.current[targetId]?.name || '相手';
          sendAttack(roomId, targetId, uid, remaining);
          fireBeam(targetId);
          setAttackFlash({ amount: remaining, name: targetName });
        } else {
          setAttackFlash({ amount: remaining, name: '' });
        }
      } else {
        setAttackFlash({ amount: 0, name: '相殺！' });
      }
      setTimeout(() => setAttackFlash(null), 700);
    },
    [roomId, uid, updatePending, pickTarget, fireBeam],
  );

  // 連鎖マイルストーン攻撃: 倍率・上限を適用して送信。
  const launchAttack = useCallback(
    (comboVal: number) => {
      // 5クリアごとに発射。攻撃量は連鎖に応じる（連鎖が低くても最低1は撃てる）。
      let amount = Math.max(1, Math.floor(comboVal / 5));
      if (stateRef.current.backlog.length / selfMax >= PINCH_RATIO) amount = Math.round(amount * PINCH_MULT);
      const badges = Object.values(playersRef.current).filter((p) => p.koBy === uid).length;
      amount = Math.round(amount * (1 + 0.25 * Math.min(badges, 4)));
      amount = Math.min(amount, ATTACK_CAP);
      // 会心: 次のボスへの攻撃を倍化（上限を少し緩める）。
      if (focusNextRef.current) {
        focusNextRef.current = false;
        amount = Math.min(amount * 2, ATTACK_CAP * 2);
      }
      sendAmount(amount);
    },
    [uid, sendAmount, selfMax],
  );

  // アイテム効果適用（所持状態のクリアは行わない）。
  const applyItem = useCallback(
    (item: ItemType) => {
      // 自分の発動演出＋他プレイヤーへ「誰が何を使ったか」を共有
      setUseFlash(item);
      setTimeout(() => setUseFlash(null), 900);
      writePlayerSummary(roomId, uid, { lastItem: item, itemAt: Date.now() });
      if (item === 'shield') shieldRef.current = true;
      else if (item === 'brake') brakeUntilRef.current = Date.now() + BRAKE_DURATION;
      else if (item === 'clear')
        setBacklog((prev) => (prev.length <= 1 ? prev : [prev[0], ...prev.slice(1).filter((w) => w.type !== 'ojama')]));
      else if (item === 'longbomb') {
        // ロング送信: ターゲットに長い単語を1個送りつける。
        const targetId = pickTarget();
        if (targetId) {
          const lw = randomLongWord();
          sendAttack(roomId, targetId, uid, 1, lw);
          fireBeam(targetId);
          const name = playersRef.current[targetId]?.name || '相手';
          setAttackFlash({ amount: 1, name: `${name} に長文 📨` });
          setTimeout(() => setAttackFlash(null), 800);
          sfx.attack();
        }
      } else if (item === 'rapid') {
        rapidUntilRef.current = Date.now() + RAPID_DURATION;
      } else if (item === 'keep') {
        keepUntilRef.current = Date.now() + KEEP_DURATION;
      } else if (item === 'parry') {
        parryUntilRef.current = Date.now() + PARRY_DURATION;
      } else if (item === 'meteor') {
        // ボス: 全挑戦者へ一斉攻撃。
        const challengers = Object.entries(playersRef.current).filter(([id, p]) => id !== bossUid && isLive(p));
        for (const [id] of challengers) {
          sendAttack(roomId, id, uid, 2);
          fireBeam(id);
        }
        setAttackFlash({ amount: 2, name: `全挑戦者へメテオ 🌠` });
        setTimeout(() => setAttackFlash(null), 800);
        sfx.attack();
      } else if (item === 'quake') {
        // ボス: 最もバックログが多い挑戦者へトドメ。
        const challengers = Object.entries(playersRef.current).filter(([id, p]) => id !== bossUid && isLive(p));
        if (challengers.length > 0) {
          const t = challengers.reduce((best, cur) => (cur[1].backlog > best[1].backlog ? cur : best));
          sendAttack(roomId, t[0], uid, 5);
          fireBeam(t[0]);
          setAttackFlash({ amount: 5, name: `${t[1].name} へ地割れ 🌋` });
          setTimeout(() => setAttackFlash(null), 800);
          sfx.attack();
        }
      } else if (item === 'regen') {
        // ボス: 自分のバックログ（HP）を回復。先頭は残す。
        setBacklog((prev) => (prev.length <= 1 ? prev : [prev[0], ...prev.slice(1, Math.max(1, prev.length - 6))]));
        sfx.item();
      } else if (item === 'rally') {
        // 挑戦者: ボスへ即時の大攻撃。
        if (isLive(playersRef.current[bossUid])) {
          sendAttack(roomId, bossUid, uid, 3);
          fireBeam(bossUid);
          setAttackFlash({ amount: 3, name: `ボスへ総攻撃 ⚔` });
          setTimeout(() => setAttackFlash(null), 800);
          sfx.attack();
        }
      } else if (item === 'focus') {
        // 挑戦者: 次のボスへの攻撃を倍化。
        focusNextRef.current = true;
      }
      // --- 防御 ---
      else if (item === 'barrier') barrierRef.current = true;
      else if (item === 'freeze') freezeUntilRef.current = Date.now() + FREEZE_DURATION;
      else if (item === 'guard') guardCountRef.current = 2;
      else if (item === 'purge') {
        // 大掃除: バックログを丸ごと空にし、簡単な単語を1つだけ残す（逆転のチャンス）。
        setBacklog([makeShortWord('normal')]);
        setTokenIndex(0);
        setCurrentTyping('');
      }
      // --- 攻撃 ---
      else if (item === 'snipe') {
        const t = pickTarget();
        if (t) {
          sendAttack(roomId, t, uid, 3);
          fireBeam(t);
          setAttackFlash({ amount: 3, name: `${playersRef.current[t]?.name || '相手'} を狙撃` });
          setTimeout(() => setAttackFlash(null), 800);
          sfx.attack();
        }
      } else if (item === 'heavy') {
        sendAmount(Math.min(Math.max(2, Math.floor(stateRef.current.combo / 3)), 6));
      } else if (item === 'burst') {
        // 全ての相手へ一斉に +2。
        const opponents = bossMode
          ? isBoss
            ? Object.keys(playersRef.current).filter((id) => id !== bossUid && isLive(playersRef.current[id]))
            : isLive(playersRef.current[bossUid])
              ? [bossUid]
              : []
          : Object.entries(playersRef.current)
              .filter(([id, p]) => id !== uid && isLive(p))
              .map(([id]) => id);
        for (const id of opponents) {
          sendAttack(roomId, id, uid, 2);
          fireBeam(id);
        }
        setAttackFlash({ amount: 2, name: 'バースト！ 全体+2' });
        setTimeout(() => setAttackFlash(null), 800);
        sfx.attack();
      }
      // --- 妨害 ---
      else if (item === 'flood') {
        const t = pickTarget();
        if (t) {
          sendAttack(roomId, t, uid, 4);
          fireBeam(t);
          setAttackFlash({ amount: 4, name: `${playersRef.current[t]?.name || '相手'} へフラッド` });
          setTimeout(() => setAttackFlash(null), 800);
          sfx.attack();
        }
      } else if (item === 'drain') {
        setBacklog((prev) => (prev.length <= 1 ? prev : [prev[0], ...prev.slice(1, Math.max(1, prev.length - 2))]));
        const t = pickTarget();
        if (t) {
          sendAttack(roomId, t, uid, 2);
          fireBeam(t);
          sfx.attack();
        }
      } else if (item === 'mirror') {
        sendAmount(Math.min(Math.max(1, Math.floor(stateRef.current.backlog.length / 3)), 6));
      }
    },
    [pickTarget, fireBeam, roomId, uid, bossUid, bossMode, isBoss, sendAmount],
  );

  const grantItem = useCallback(() => {
    if (heldItemRef.current) applyItem(heldItemRef.current); // 既存を自動発動してスタック
    const rng = itemRngRef.current;
    let items: ItemType[];
    if (bossMode && isBoss) {
      // ボス専用＋自衛系＋全体攻撃。
      items = ['meteor', 'quake', 'regen', 'brake', 'keep', 'clear', 'barrier', 'freeze', 'guard', 'snipe', 'burst', 'heavy', 'flood', 'mirror'];
    } else if (bossMode) {
      // 挑戦者: 攻撃協力系を多めに＋追加アイテム。
      items = ['shield', 'clear', 'brake', 'rapid', 'keep', 'parry', 'rally', 'focus', 'longbomb', 'barrier', 'freeze', 'purge', 'guard', 'snipe', 'burst', 'heavy', 'flood', 'drain', 'mirror'];
    } else {
      items = ['shield', 'clear', 'brake', 'longbomb', 'rapid', 'keep', 'parry', 'barrier', 'freeze', 'purge', 'guard', 'snipe', 'burst', 'heavy', 'flood', 'drain', 'mirror'];
    }
    // 有利/不利でドロップ内容を変える: 不利（バックログが多い）なら防御/逆転、
    // 有利（少ない）なら攻撃が出やすくなるよう重み付け抽選する。
    const disadv = Math.min(1, stateRef.current.backlog.length / selfMax); // 0..1
    const weighted = items.map((it) => {
      const kind = ITEM_KIND[it];
      let w = 1;
      if (kind === 'def') w = 1 + disadv * 2.5;
      else if (kind === 'atk') w = 1 + (1 - disadv) * 2.5;
      return { it, w };
    });
    const total = weighted.reduce((s, x) => s + x.w, 0);
    let acc = (rng ? rng() : Math.random()) * total;
    let pick: ItemType = items[0];
    for (const x of weighted) {
      acc -= x.w;
      if (acc <= 0) { pick = x.it; break; }
    }
    sfx.item();
    setItemFlash(true);
    setTimeout(() => setItemFlash(false), 1000);
    // 使い方設定: カテゴリが「即時」なら拾った瞬間に発動。完全オートは保持して自動ループに任せる。
    if (!autoFullRef.current && useModeRef.current[ITEM_CAT[pick]] === 'instant') {
      sfx.use();
      applyItem(pick);
      setHeldItem(null);
    } else {
      setHeldItem(pick);
    }
  }, [applyItem, bossMode, isBoss, selfMax]);

  // 完全オート: 保持中のアイテムを、有利/不利に応じて良いタイミングで自動発動する。
  useEffect(() => {
    if (!started || status !== 'playing') return;
    const id = setInterval(() => {
      if (!autoFullRef.current || !selfAliveRef.current) return;
      const item = heldItemRef.current;
      if (!item) return;
      const frac = stateRef.current.backlog.length / selfMax; // 不利度
      const incoming = pendingRef.current.reduce((s, e) => s + e.amount, 0);
      const cat = ITEM_CAT[item];
      let use = false;
      if (cat === 'defense') use = frac >= 0.55 || incoming >= 3;
      else if (cat === 'attack') use = frac <= 0.5 && stateRef.current.combo >= 2;
      else use = frac >= 0.45 || incoming >= 2;
      if (frac >= 0.8) use = true; // 危険なら何でも発動
      if (use) {
        sfx.use();
        applyItem(item);
        setHeldItem(null);
      }
    }, 700);
    return () => clearInterval(id);
  }, [started, status, applyItem, selfMax]);

  const useItem = useCallback(() => {
    const item = heldItemRef.current;
    if (!item) return;
    sfx.use();
    applyItem(item);
    setHeldItem(null);
  }, [applyItem]);

  const cycleTargetMode = useCallback(() => {
    setTargetMode((m) => {
      const idx = TARGET_MODES.findIndex((t) => t.mode === m);
      return TARGET_MODES[(idx + 1) % TARGET_MODES.length].mode;
    });
  }, []);

  // 受信した攻撃を予告ゲージへ。直近の攻撃者を記録（反撃ターゲット用）。
  useEffect(() => {
    if (!started) return;
    const unsub = subscribeAttacks(roomId, uid, (ev) => {
      if (ev.from) {
        lastAttackerRef.current = ev.from;
        fireIncoming(ev.from);
      }
      const fromName = playersRef.current[ev.from]?.name || '相手';
      pushToast(ev.word ? `${fromName} から長文 📨` : `${fromName} から攻撃 +${ev.amount}`, 'in');
      updatePending([
        ...pendingRef.current,
        { id: ev.id, amount: ev.amount, confirmAt: Date.now() + TELEGRAPH_DELAY, word: ev.word },
      ]);
    });
    return () => unsub();
  }, [started, roomId, uid, updatePending, pushToast, fireIncoming]);

  // 予告ゲージの確定処理。
  useEffect(() => {
    if (!started || status !== 'playing') return; // 決着後は着弾処理を止める
    const id = setInterval(() => {
      if (!selfAliveRef.current || pendingRef.current.length === 0) return;
      const now = Date.now();
      if (now < freezeUntilRef.current) return; // フリーズ中は確定を保留
      const due = pendingRef.current.filter((e) => e.confirmAt <= now);
      if (due.length === 0) return;
      updatePending(pendingRef.current.filter((e) => e.confirmAt > now));
      // 受け流し中は、確定したおじゃまを自分に入れず、別の“プレイヤー”へ逸らす。
      if (now < parryUntilRef.current) {
        let deflect = 0;
        for (const e of due) deflect += e.word ? 2 : e.amount;
        if (deflect > 0) {
          const targetId = pickTarget();
          if (targetId) {
            sendAttack(roomId, targetId, uid, deflect);
            fireBeam(targetId);
            const name = playersRef.current[targetId]?.name || '相手';
            pushToast(`受け流し！ ${name} へ +${deflect}`, 'item');
          } else {
            pushToast(`受け流し！ +${deflect}`, 'item');
          }
          sfx.parry();
          setParryFx(true);
          setTimeout(() => setParryFx(false), 500);
        }
        return;
      }
      // バリア中は、今回の被弾をまるごと1回防ぐ。
      if (barrierRef.current) {
        barrierRef.current = false;
        pushToast('バリアで防御！', 'item');
        sfx.use();
        return;
      }
      const words: Word[] = [];
      for (const e of due) {
        if (e.word) words.push(makeOjamaWordFrom(e.word.display, e.word.reading));
        else for (let i = 0; i < e.amount; i++) words.push(makeOjamaWord());
      }
      if (words.length > 0) {
        setBacklog((prev) => {
          const next = [...prev, ...words];
          if (next.length > selfMax) {
            topOut();
            return next.slice(0, selfMax);
          }
          return next;
        });
      }
    }, 100);
    return () => clearInterval(id);
  }, [started, status, updatePending, topOut, pickTarget, roomId, uid, fireBeam, pushToast, selfMax]);

  // カウントダウン描画用の時刻ティック。
  useEffect(() => {
    if (!started) return;
    const id = setInterval(() => setNowTick(Date.now()), 150);
    return () => clearInterval(id);
  }, [started]);

  // 入力処理
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      resumeAudio();
      if (!started || !selfAliveRef.current) return;
      // スペース（またはEnter）でアイテム発動。スペースはお題に使わないので安全。
      if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); useItem(); return; }
      if (e.key === 'Tab') { e.preventDefault(); cycleTargetMode(); return; }
      if (e.key.length !== 1 || e.ctrlKey || e.metaKey || e.altKey) return;
      e.preventDefault();
      const result = processKey(e.key.toLowerCase(), stateRef.current);
      if (result.miss) {
        // 連鎖キープ中はミスしても連鎖（＝アタック数）を維持する。
        if (Date.now() >= keepUntilRef.current) setCombo(0);
        setMissCount((m) => m + 1);
        setMissFlash(true);
        sfx.miss();
        setTimeout(() => setMissFlash(false), 150);
      } else if (result.wordCleared && result.nextState) {
        const newCombo = result.nextState.combo;
        setBacklog(result.nextState.backlog);
        setTokenIndex(0);
        setCurrentTyping('');
        setCombo(newCombo);
        setMaxCombo((m) => Math.max(m, newCombo));
        setKeysTyped((k) => k + 1);
        sfx.clear();
        // 1単語クリアごとに、来ている着弾予告を1つ相殺（タイピング＝防御）。
        offsetIncoming(1);
        // ゲージはクリア数で進む（ミスでは減らない）。5クリアごとに発射。
        attackProgressRef.current += 1;
        if (attackProgressRef.current >= 5) {
          attackProgressRef.current -= 5;
          launchAttack(newCombo);
        }
        setAttackProgress(attackProgressRef.current);
        if (Date.now() < rapidUntilRef.current) sendAmount(1); // 連射: 1クリアごとに1攻撃
        if (result.clearedType === 'treasure') grantItem();
      } else if (result.nextState) {
        setTokenIndex(result.nextState.tokenIndex);
        setCurrentTyping(result.nextState.currentTyping);
        setKeysTyped((k) => k + 1);
        sfx.type();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [started, launchAttack, sendAmount, useItem, grantItem, cycleTargetMode, offsetIncoming]);

  // ベース供給＆加速ループ（シールド/ブレーキ対応）。
  useEffect(() => {
    if (!started || !selfAlive || status !== 'playing') return; // 決着後は供給を止める
    let timerId: ReturnType<typeof setTimeout>;
    const loop = () => {
      const now = Date.now();
      if (now < brakeUntilRef.current || now < freezeUntilRef.current) {
        /* ブレーキ / フリーズ中は供給停止 */
      } else if (guardCountRef.current > 0) {
        guardCountRef.current -= 1; // ガード: 複数回ぶん供給を無効化
      } else if (shieldRef.current) {
        shieldRef.current = false;
      } else {
        setBacklog((prev) => {
          if (prev.length >= selfMax) {
            topOut();
            return prev;
          }
          return wordRngRef.current ? [...prev, genWord()] : prev;
        });
      }
      setSpawnInterval((prev) => Math.max(MIN_SPAWN_INTERVAL, prev * 0.98));
      timerId = setTimeout(loop, spawnInterval);
    };
    timerId = setTimeout(loop, spawnInterval);
    return () => clearTimeout(timerId);
  }, [started, selfAlive, spawnInterval, topOut, selfMax, status, genWord]);

  // サマリのスロットリング書込（バッジも反映）。
  const summaryRef = useRef({ backlog: 0, combo: 0, kpm: 0, badges: 0 });
  summaryRef.current = { backlog: backlog.length, combo, kpm: calculateKPM(), badges: myBadges };
  useEffect(() => {
    if (!started) return;
    const id = setInterval(() => {
      if (!selfAliveRef.current) return;
      writePlayerSummary(roomId, uid, summaryRef.current);
    }, WRITE_INTERVAL);
    return () => clearInterval(id);
  }, [started, roomId, uid]);

  // ホスト: 生存者が1人以下になったら決着へ。
  // started（カウントダウン後）になってから判定する。開始直後は各自の alive 再設定が
  // 伝播しておらず、判定すると即終了→再戦できない不具合になるため。
  useEffect(() => {
    if (uid !== hostUid || status !== 'playing' || !started) return;
    if (bossMode) {
      // ボス討伐 or 挑戦者全滅で決着。
      const boss = players[bossUid];
      const bossDead = !boss || !isLive(boss);
      const aliveChallengers = Object.entries(players).filter(([id, p]) => id !== bossUid && isLive(p)).length;
      const challengerTotal = Object.keys(players).filter((id) => id !== bossUid).length;
      if (bossDead || (challengerTotal >= 1 && aliveChallengers === 0)) finishGame(roomId);
      return;
    }
    const total = Object.keys(players).length;
    const aliveCount = Object.values(players).filter(isLive).length;
    // 全滅(=1人プレイのトップアウト)か、2人以上で残り1人になったら決着。
    if (aliveCount === 0 || (total >= 2 && aliveCount <= 1)) finishGame(roomId);
  }, [players, status, uid, hostUid, roomId, started, bossMode, bossUid]);

  // テトリス99のように、自分以外の攻防もアンビエントなビームで可視化する。
  // 実データの全攻撃は購読していないため、それっぽいビームを散らす表現。
  // ボス戦では挑戦者同士は撃ち合わない（全員ボスを攻撃する）ので、
  // 挑戦者 → ボス へ集まるビームを描く。
  useEffect(() => {
    if (!started || status !== 'playing') return;
    const id = setInterval(() => {
      if (Math.random() > 0.6) return;
      if (bossMode) {
        const boss = playersRef.current[bossUid];
        if (!boss || !isLive(boss)) return;
        // 挑戦者（自分とボス以外）から1人選び、ボスへビームを飛ばす。
        const challengers = Object.entries(playersRef.current).filter(([oid, p]) => oid !== bossUid && oid !== uid && isLive(p));
        if (challengers.length === 0) return;
        const a = challengers[Math.floor(Math.random() * challengers.length)];
        const from = boardRefs.current[a[0]]?.getBoundingClientRect();
        // ボスの盤面: 自分がボスなら中央、そうでなければボスのミニボード。
        const toRect = bossUid === uid ? centerRef.current?.getBoundingClientRect() : boardRefs.current[bossUid]?.getBoundingClientRect();
        if (from && toRect) {
          addBeam(from.left + from.width / 2, from.top + from.height / 2, toRect.left + toRect.width / 2, toRect.top + toRect.height / 2, '#94a3b8');
        }
        return;
      }
      const aliveOthers = Object.entries(playersRef.current).filter(([oid, p]) => oid !== uid && isLive(p));
      if (aliveOthers.length < 2) return;
      const a = aliveOthers[Math.floor(Math.random() * aliveOthers.length)];
      let b = aliveOthers[Math.floor(Math.random() * aliveOthers.length)];
      if (b[0] === a[0]) b = aliveOthers[(aliveOthers.indexOf(a) + 1) % aliveOthers.length];
      if (b[0] === a[0]) return;
      const from = boardRefs.current[a[0]]?.getBoundingClientRect();
      const to = boardRefs.current[b[0]]?.getBoundingClientRect();
      if (from && to) {
        addBeam(from.left + from.width / 2, from.top + from.height / 2, to.left + to.width / 2, to.top + to.height / 2, '#94a3b8');
      }
    }, 1300);
    return () => clearInterval(id);
  }, [started, status, uid, addBeam, bossMode, bossUid]);

  const others = Object.entries(players).filter(([id]) => id !== uid);
  const aliveCount = Object.values(players).filter(isLive).length;
  const totalCount = Object.keys(players).length;
  const isDanger = backlog.length >= selfMax - 3;
  const totalIncoming = pending.reduce((s, e) => s + e.amount, 0);
  const isHost = uid === hostUid;
  // ボスモード: ボスのHP（バックログ）情報。
  const bossPlayer = bossMode ? players[bossUid] : undefined;
  const bossAlive = bossMode ? !!bossPlayer && isLive(bossPlayer) : false;
  const bossHp = bossPlayer ? Math.max(0, BOSS_MAX_BACKLOG - (bossPlayer.backlog || 0)) : 0;

  // 発動中の時間制限アイテム（残り時間カウントダウン表示用）。
  const activeEffects: { type: ItemType; until: number; color: string }[] = (
    [
      { type: 'brake', until: brakeUntilRef.current, color: 'bg-green-500' },
      { type: 'rapid', until: rapidUntilRef.current, color: 'bg-yellow-400' },
      { type: 'keep', until: keepUntilRef.current, color: 'bg-fuchsia-500' },
      { type: 'parry', until: parryUntilRef.current, color: 'bg-violet-500' },
      { type: 'freeze', until: freezeUntilRef.current, color: 'bg-sky-400' },
    ] as { type: ItemType; until: number; color: string }[]
  ).filter((e) => nowTick > 0 && e.until > nowTick);

  const toggleMute = () => {
    const next = !muted;
    setMuted(next);
    setSfxEnabled(!next);
  };

  // 決着画面
  if (status === 'finished') {
    const ranked = Object.values(players).slice().sort((a, b) => {
      const ra = isLive(a) ? 0 : a.rank || 999;
      const rb = isLive(b) ? 0 : b.rank || 999;
      return ra - rb;
    });
    const winner = ranked.find(isLive) || ranked[0];
    const myRank = selfAlive ? 1 : rank;
    // ボスモードの勝敗判定。
    const bossWon = bossMode && bossAlive; // ボス生存＝ボスの勝ち
    const bossTitle = bossMode ? (bossWon ? 'BOSS WIN' : 'BOSS DEFEATED') : 'RESULT';
    const bossLine = bossMode
      ? bossWon
        ? `👑 ボス ${bossPlayer?.name ?? ''} の勝利！ 挑戦者は全滅`
        : `⚔ 討伐成功！ 挑戦者チームの勝利（ボス: ${bossPlayer?.name ?? ''}）`
      : `勝者: ${winner?.name ?? '—'}`;
    return (
      <div className="min-h-screen bg-neutral-950 text-white flex flex-col items-center justify-center p-6">
        <Crown className={`w-16 h-16 mb-4 ${bossMode && !bossWon ? 'text-emerald-400' : 'text-yellow-400'}`} />
        <h2 className="text-3xl font-black tracking-widest mb-1">{bossTitle}</h2>
        <p className="text-yellow-300 mb-6 text-lg text-center">{bossLine}</p>
        <div className="bg-neutral-900/70 rounded-xl border border-white/10 w-full max-w-md mb-6 divide-y divide-white/5">
          {ranked.map((p, i) => (
            <div key={p.name + i} className="flex items-center justify-between px-4 py-2">
              <span className="flex items-center gap-3">
                <span className="font-mono text-gray-500 w-6">#{i + 1}</span>
                <span className={p.alive ? 'text-yellow-300 font-bold' : 'text-gray-300'}>{p.name}</span>
              </span>
              <span className="text-xs text-gray-500 font-mono">
                {p.kpm} kpm · {p.badges} KO
              </span>
            </div>
          ))}
        </div>
        <p className="text-gray-400 mb-4 font-mono">
          あなたの順位: {myRank} 位 / 最高連鎖 {maxCombo} / KPM {calculateKPM()}
        </p>
        <p className="text-gray-500 mb-4 font-mono text-sm">
          正タイプ {keysTyped} · ミス {missCount}
        </p>
        <div className="flex gap-3">
          <button onClick={onExit} className="bg-neutral-800 hover:bg-neutral-700 rounded-lg px-5 py-2 font-bold flex items-center gap-2">
            <LogOut className="w-4 h-4" /> ロビーに戻る
          </button>
          {isHost ? (
            <button
              onClick={() => resetRoom(roomId)}
              className="bg-cyan-600 hover:bg-cyan-500 rounded-lg px-5 py-2 font-bold flex items-center gap-2"
            >
              <RotateCcw className="w-4 h-4" /> もう一度（部屋へ）
            </button>
          ) : (
            <div className="flex items-center text-sm text-gray-500 px-3">ホストの再戦を待っています…</div>
          )}
        </div>
      </div>
    );
  }

  const word = backlog[0];

  return (
    <div className={`min-h-screen bg-neutral-950 text-white font-sans overflow-hidden flex flex-col ${shake ? 'screen-shake' : ''}`}>
      <div className={`fixed inset-0 pointer-events-none z-50 transition-colors duration-100 ${missFlash ? 'bg-red-500/20' : 'bg-transparent'}`} />
      {/* 被弾時の赤フラッシュ（画面端を強く） */}
      <div
        className={`fixed inset-0 pointer-events-none z-40 transition-opacity duration-150 ${damageFlash ? 'opacity-100' : 'opacity-0'}`}
        style={{ boxShadow: 'inset 0 0 140px 40px rgba(239,68,68,0.55)' }}
      />

      {/* 受け流し成功エフェクト（シアンの衝撃波リング＋PARRY!） */}
      {parryFx && (
        <div className="fixed inset-0 pointer-events-none z-50 flex items-center justify-center">
          <div className="parry-ring rounded-full border-4 border-cyan-300" />
          <div className="absolute parry-label text-4xl font-black italic text-cyan-200 drop-shadow-[0_0_18px_rgba(34,211,238,0.9)]">
            PARRY!
          </div>
        </div>
      )}

      {/* 攻撃/被弾ビーム */}
      {beams.length > 0 && (
        <svg className="fixed inset-0 w-full h-full pointer-events-none z-40">
          {beams.map((b) => (
            <g key={b.id} className="attack-beam">
              <line x1={b.x1} y1={b.y1} x2={b.x2} y2={b.y2} stroke={b.color} strokeWidth={4} strokeLinecap="round" />
              <circle cx={b.x2} cy={b.y2} r={14} fill="none" stroke={b.color} strokeWidth={3} />
              <circle cx={b.x1} cy={b.y1} r={5} fill={b.color} />
            </g>
          ))}
        </svg>
      )}

      {/* 通知トースト（被弾・撃破・脱落・アイテム） */}
      <div className="fixed top-20 right-4 z-50 flex flex-col gap-1 items-end pointer-events-none">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`px-3 py-1.5 rounded-lg text-sm font-bold shadow-lg animate-in slide-in-from-right-4 fade-in duration-200 ${
              t.kind === 'ko'
                ? 'bg-orange-600/90 text-white'
                : t.kind === 'item'
                  ? 'bg-yellow-600/90 text-black'
                  : 'bg-red-950/90 text-red-200 border border-red-500/40'
            }`}
          >
            {t.kind === 'ko' ? '🏆 ' : t.kind === 'item' ? '✨ ' : '⚠ '}
            {t.text}
          </div>
        ))}
      </div>

      {/* 自分のアイテム発動演出 */}
      {useFlash && (
        <div className="fixed top-[8.5rem] left-1/2 -translate-x-1/2 z-50 pointer-events-none animate-in fade-in zoom-in duration-200">
          <div className="bg-yellow-500/95 text-black font-black px-4 py-1.5 rounded-full flex items-center gap-2 shadow-lg">
            <span className="text-lg">{ITEM_EMOJI[useFlash]}</span> {ITEM_META[useFlash].name} 発動！
          </div>
        </div>
      )}

      {/* 演出は上部に出して、打つべき単語に被らないようにする */}
      {attackFlash && (
        <div className="fixed top-[4.5rem] left-1/2 -translate-x-1/2 z-50 pointer-events-none animate-in fade-in slide-in-from-top-2 duration-200">
          <div className="text-3xl font-black italic text-orange-400 drop-shadow-[0_0_15px_rgba(251,146,60,0.8)] flex items-center gap-2">
            {attackFlash.amount > 0 ? (
              <>
                <Swords className="w-7 h-7" /> ATTACK ×{attackFlash.amount}!
                {attackFlash.name && <span className="text-base text-orange-200 not-italic">→ {attackFlash.name}</span>}
              </>
            ) : (
              <span className="text-cyan-300">相殺！</span>
            )}
          </div>
        </div>
      )}

      {itemFlash && (
        <div className="fixed top-[4.5rem] left-1/2 -translate-x-1/2 z-50 pointer-events-none animate-in fade-in slide-in-from-top-2 duration-300">
          <div className="text-3xl font-black text-yellow-300 drop-shadow-[0_0_20px_rgba(250,204,21,0.8)] flex items-center gap-3">
            <Sparkles className="w-8 h-8" /> ITEM GET! <Sparkles className="w-8 h-8" />
          </div>
        </div>
      )}

      {!started && (
        <div className="fixed inset-0 bg-neutral-950/90 flex flex-col items-center justify-center z-50">
          <p className="text-gray-400 mb-2 tracking-widest">GET READY</p>
          <div className="text-8xl font-black text-cyan-400 animate-pulse">{countdown > 0 ? countdown : 'GO!'}</div>
        </div>
      )}


      {!selfAlive && status === 'playing' && (
        <div className="fixed top-20 left-1/2 -translate-x-1/2 z-40 bg-red-950/80 border border-red-500/40 rounded-lg px-6 py-2 text-center">
          <div className="text-red-300 font-bold">TOP OUT — {rank} 位</div>
          <div className="text-xs text-gray-400">観戦中…</div>
        </div>
      )}

      <header className="h-16 border-b border-white/10 flex items-center justify-between px-8 bg-neutral-900/50 z-10">
        <div className="flex items-center gap-3">
          <Swords className="text-cyan-400" />
          <h1 className="text-xl font-bold tracking-widest text-gray-200">
            TYPE ROYALE<span className="text-xs ml-2 text-gray-500">ROOM {roomId}</span>
          </h1>
        </div>
        <div className="flex gap-6 items-center">
          <div className="flex flex-col items-center">
            <span className="text-xs text-gray-500">KPM</span>
            <span className="font-mono text-xl font-bold">{calculateKPM()}</span>
          </div>
          <div className="flex flex-col items-center">
            <span className="text-xs text-gray-500">BADGE</span>
            <span className="font-mono text-xl font-bold flex items-center gap-1">
              <Shield className="w-4 h-4 text-blue-400" /> {myBadges}
            </span>
          </div>
          <button onClick={toggleMute} className="text-gray-500 hover:text-gray-300" title={muted ? '効果音オン' : '効果音オフ'}>
            {muted ? <VolumeX className="w-5 h-5" /> : <Volume2 className="w-5 h-5" />}
          </button>
        </div>
      </header>

      <main className="flex-1 flex w-full max-w-7xl mx-auto p-4 gap-4 h-[calc(100vh-4rem)]">
        <div className="w-1/4 grid grid-cols-2 gap-2 content-start">
          {others.slice(0, Math.ceil(others.length / 2)).map(([id, p]) => (
            <div key={id} ref={(el) => { boardRefs.current[id] = el; }}>
              <MiniBoard
                height={p.backlog}
                max={bossMode && id === bossUid ? BOSS_MAX_BACKLOG : MAX_BACKLOG}
                isKO={!isLive(p)}
                name={bossMode && id === bossUid ? `👑 ${p.name}` : p.name}
                combo={p.combo}
                highlight={bossMode && id === bossUid}
                hit={hitId === id}
                incoming={incomingId === id}
                itemEmoji={p.itemAt && Date.now() - p.itemAt < 1500 ? ITEM_EMOJI[p.lastItem as ItemType] : undefined}
              />
            </div>
          ))}
        </div>

        <div ref={centerRef} className="w-2/4 flex flex-col h-full relative">
          {isDanger && selfAlive && started && (
            <div className="absolute inset-0 border-4 border-red-500/50 rounded-2xl pointer-events-none animate-pulse z-0" />
          )}
          <div className="flex-1 flex flex-col items-center justify-end pb-8 relative z-10">
            {/* ボスモードの状況表示（挑戦者にはボスHP、ボスには自分のHP）。 */}
            {bossMode && started && (
              isBoss ? (
                <div className="absolute top-1 left-1/2 -translate-x-1/2 z-20 bg-red-900/80 border border-red-500/50 rounded-full px-4 py-1 text-sm font-black text-red-100 flex items-center gap-2 shadow-lg">
                  <Crown className="w-4 h-4 text-yellow-300" /> あなたはBOSS · HP {Math.max(0, selfMax - backlog.length)}/{selfMax}
                </div>
              ) : (
                <div className="absolute top-1 left-1/2 -translate-x-1/2 z-20 w-56">
                  <div className="flex items-center justify-between text-[11px] mb-0.5">
                    <span className="font-bold text-red-300 flex items-center gap-1">
                      <Crown className="w-3.5 h-3.5 text-yellow-400" /> BOSS {bossPlayer?.name ?? ''}
                    </span>
                    <span className="font-mono text-red-200">{bossHp}/{BOSS_MAX_BACKLOG}</span>
                  </div>
                  <div className="w-full h-3 rounded-full bg-neutral-800 border border-red-900/60 overflow-hidden">
                    <div
                      className="h-full bg-gradient-to-r from-red-600 to-red-400 transition-[width] duration-200"
                      style={{ width: `${(bossHp / BOSS_MAX_BACKLOG) * 100}%` }}
                    />
                  </div>
                </div>
              )
            )}

            {/* ターゲットモード切替（[Tab]でも切替）。ボスモードの挑戦者は常にボスを狙うため非表示。 */}
            {!(bossMode && !isBoss) && (
              <div className="absolute top-1 left-0 flex flex-col items-start gap-1">
                <div className="flex items-center gap-1 text-[10px] text-gray-500"><Target className="w-3 h-3" /> 狙い [Tab]</div>
                <div className="flex gap-1">
                  {TARGET_MODES.map((t) => (
                    <button
                      key={t.mode}
                      onClick={() => setTargetMode(t.mode)}
                      className={`px-1.5 py-0.5 rounded text-[10px] font-bold transition-colors ${
                        targetMode === t.mode ? 'bg-cyan-600 text-white' : 'bg-neutral-800 text-gray-400 hover:bg-neutral-700'
                      }`}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* ALIVE 表示（ソロと配置を統一：右上） */}
            <div className="absolute top-2 right-0 text-right">
              <div className="text-xs text-gray-500">ALIVE</div>
              <div className="font-mono text-2xl font-bold text-gray-300">
                {aliveCount}
                <span className="text-sm text-gray-600"> / {totalCount}</span>
              </div>
            </div>

            {/* 予告ゲージ（受信おじゃま） */}
            {totalIncoming > 0 && (
              <div className="absolute left-0 bottom-8 top-1/3 flex flex-col items-center justify-end gap-1">
                <div className="text-xs font-bold text-red-400 mb-1 animate-pulse">⚠ {totalIncoming}</div>
                <div className="w-3 flex-1 bg-neutral-900 rounded-full overflow-hidden border border-red-900/50 flex flex-col-reverse">
                  {Array.from({ length: Math.min(totalIncoming, MAX_BACKLOG) }).map((_, i) => (
                    <div key={i} className="w-full flex-1 bg-red-500 border-t border-neutral-950/60" />
                  ))}
                </div>
                <div className="text-[9px] text-gray-500 text-center leading-tight">おじゃま<br />着弾予告</div>
              </div>
            )}

            <div className="mb-8 text-center h-16 flex items-end justify-center">
              {combo > 2 && (
                <div className="text-3xl font-black italic text-cyan-400 drop-shadow-[0_0_10px_rgba(34,211,238,0.6)] flex items-center gap-2">
                  <Zap className="w-8 h-8 fill-cyan-400" /> {combo} COMBO!
                </div>
              )}
            </div>

            <div className="w-full max-w-lg flex flex-col justify-end h-96 relative">
              <div className="flex flex-col-reverse gap-2 mb-4 overflow-hidden">
                {backlog
                  .slice(1)
                  .map((w) => (
                    <div
                      key={w.id}
                      className={`px-4 py-2 rounded-lg text-sm font-bold opacity-70 flex justify-between items-center ${
                        w.type === 'ojama'
                          ? 'bg-red-950/50 text-red-300 border border-red-900/50'
                          : w.type === 'treasure'
                            ? 'bg-yellow-900/30 text-yellow-300 border border-yellow-700/50'
                            : 'bg-neutral-800 text-gray-400'
                      }`}
                    >
                      <span>{w.display}</span>
                      {w.type === 'ojama' && <AlertTriangle className="w-4 h-4" />}
                      {w.type === 'treasure' && <Sparkles className="w-4 h-4" />}
                    </div>
                  ))}
              </div>

              {word && (
                <div
                  className={`p-6 rounded-xl border-2 shadow-2xl mb-4 ${
                    word.type === 'ojama'
                      ? 'border-red-500/50 bg-red-950/30'
                      : word.type === 'treasure'
                        ? 'border-yellow-400/50 bg-yellow-900/30'
                        : 'border-blue-500/30 bg-gray-800/80'
                  }`}
                >
                  <CurrentWord
                    word={word}
                    tokenIndex={tokenIndex}
                    currentTyping={currentTyping}
                    accent={word.type === 'ojama' ? 'text-red-400' : word.type === 'treasure' ? 'text-yellow-400' : 'text-cyan-400'}
                  />
                </div>
              )}
              {/* 保持アイテム（次の単語を隠さないよう単語の下に表示） */}
              {heldItem && (
                <div className="flex justify-center">
                  <div className="flex items-center gap-2 bg-neutral-900/90 border border-yellow-600/50 rounded-full px-3 py-1 shadow-lg shadow-yellow-900/30">
                    <ItemIcon type={heldItem} />
                    <span className="text-xs font-bold text-yellow-200">{ITEM_META[heldItem].name}</span>
                    <span className="text-[10px] text-gray-400 hidden sm:inline">{ITEM_META[heldItem].desc}</span>
                    <span className="text-[10px] text-cyan-300 font-bold">[Space]</span>
                  </div>
                </div>
              )}
            </div>

            {/* 発動中アイテムの残り時間カウントダウン（保持アイテムの下に表示） */}
            {activeEffects.length > 0 && (
              <div className="w-full max-w-lg mt-3 flex flex-col gap-1">
                {activeEffects.map((e) => {
                  const dur = ITEM_DURATION[e.type] ?? 1;
                  const remain = Math.max(0, e.until - nowTick);
                  const frac = Math.max(0, Math.min(1, remain / dur));
                  return (
                    <div key={e.type} className="bg-neutral-900/90 border border-white/15 rounded-lg px-3 py-1 flex items-center gap-2">
                      <span className="text-lg leading-none">{ITEM_EMOJI[e.type]}</span>
                      <span className="text-[11px] font-bold text-gray-100 whitespace-nowrap w-20 shrink-0">{ITEM_META[e.type].name}</span>
                      <div className="flex-1 h-2.5 rounded-full bg-neutral-700 overflow-hidden">
                        <div className={`h-full ${e.color} transition-[width] duration-150`} style={{ width: `${frac * 100}%` }} />
                      </div>
                      <span className="text-xs font-mono font-black text-white tabular-nums w-10 text-right">
                        {(remain / 1000).toFixed(1)}<span className="text-[9px] text-gray-400">s</span>
                      </span>
                    </div>
                  );
                })}
              </div>
            )}

            <div className="w-full max-w-lg mt-4">
              <div className="text-[10px] text-gray-500 mb-0.5">
                {isBoss ? 'あなたのHP（満タンで討伐される）' : '自分のバックログ（満タンで脱落）'}
              </div>
              <div className="flex gap-0.5">
                {Array.from({ length: selfMax }).map((_, i) => (
                  <div
                    key={i}
                    className={`h-2 flex-1 rounded-sm ${
                      i < backlog.length
                        ? i >= selfMax - 3
                          ? 'bg-red-500'
                          : isBoss
                            ? 'bg-amber-500'
                            : 'bg-cyan-500'
                        : 'bg-neutral-800'
                    }`}
                  />
                ))}
              </div>
            </div>

            <div className="mt-3">
              <AttackGauge progress={attackProgress} combo={combo} pinch={isDanger} badges={myBadges} />
            </div>
          </div>
        </div>

        <div className="w-1/4 grid grid-cols-2 gap-2 content-start">
          {others.slice(Math.ceil(others.length / 2)).map(([id, p]) => (
            <div key={id} ref={(el) => { boardRefs.current[id] = el; }}>
              <MiniBoard
                height={p.backlog}
                max={bossMode && id === bossUid ? BOSS_MAX_BACKLOG : MAX_BACKLOG}
                isKO={!isLive(p)}
                name={bossMode && id === bossUid ? `👑 ${p.name}` : p.name}
                combo={p.combo}
                highlight={bossMode && id === bossUid}
                hit={hitId === id}
                incoming={incomingId === id}
                itemEmoji={p.itemAt && Date.now() - p.itemAt < 1500 ? ITEM_EMOJI[p.lastItem as ItemType] : undefined}
              />
            </div>
          ))}
        </div>
      </main>

      <style
        dangerouslySetInnerHTML={{
          __html: `
        @keyframes beamFade { 0% { opacity: 0; } 12% { opacity: 1; } 100% { opacity: 0; } }
        .attack-beam { animation: beamFade 0.7s ease-out forwards; }
        @keyframes screenShake {
          0%, 100% { transform: translate(0, 0); }
          20% { transform: translate(-5px, 3px); }
          40% { transform: translate(5px, -3px); }
          60% { transform: translate(-4px, -2px); }
          80% { transform: translate(4px, 2px); }
        }
        .screen-shake { animation: screenShake 0.45s ease-in-out; }
        @keyframes parryRing { 0% { width: 40px; height: 40px; opacity: 0.9; } 100% { width: 360px; height: 360px; opacity: 0; } }
        .parry-ring { width: 40px; height: 40px; animation: parryRing 0.5s ease-out forwards; box-shadow: 0 0 24px rgba(34,211,238,0.8); }
        @keyframes parryLabel { 0% { transform: scale(0.6); opacity: 0; } 30% { transform: scale(1.1); opacity: 1; } 100% { transform: scale(1); opacity: 0; } }
        .parry-label { animation: parryLabel 0.5s ease-out forwards; }
      `,
        }}
      />
    </div>
  );
}

const ItemIcon = ({ type }: { type: ItemType }) => {
  if (type === 'shield') return <Shield className="w-5 h-5 text-blue-300" />;
  if (type === 'clear') return <Wind className="w-5 h-5 text-cyan-300" />;
  if (type === 'brake') return <Pause className="w-5 h-5 text-green-300" />;
  if (type === 'longbomb') return <Bomb className="w-5 h-5 text-red-300" />;
  if (type === 'keep') return <Lock className="w-5 h-5 text-fuchsia-300" />;
  if (type === 'rapid') return <Zap className="w-5 h-5 text-yellow-300" />;
  return <span className="text-base leading-none">{ITEM_EMOJI[type]}</span>;
};
