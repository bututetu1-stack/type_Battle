import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Swords, Zap, AlertTriangle, Crown, Shield, Wind, Pause, Sparkles,
  Target, RotateCcw, LogOut, Volume2, VolumeX, Bomb,
} from 'lucide-react';
import { mulberry32, type RNG } from '../lib/rng';
import { generateWord, makeOjamaWord, makeOjamaWordFrom, randomLongWord } from '../lib/words';
import { processKey, type PlayerState } from '../lib/engine';
import {
  serverNow, writePlayerSummary, finishGame, resetRoom, sendAttack, subscribeAttacks,
  type RoomPlayer, type RoomStatus,
} from '../lib/room';
import { sfx, resumeAudio, setSfxEnabled } from '../lib/sfx';
import type { ItemType, TargetMode, Word } from '../lib/types';
import MiniBoard from './MiniBoard';
import CurrentWord from './CurrentWord';
import AttackGauge from './AttackGauge';

const MAX_BACKLOG = 12;
const INITIAL_SPAWN_INTERVAL = 4000;
const MIN_SPAWN_INTERVAL = 1000;
const WRITE_INTERVAL = 400;
const TELEGRAPH_DELAY = 1500;
const PINCH_RATIO = 0.7;
const PINCH_MULT = 1.5;
const BRAKE_DURATION = 5000;
const ATTACK_CAP = 5; // 1回の攻撃で送れるおじゃまの上限（即死コンボ防止）

const ITEM_META: Record<ItemType, { name: string; desc: string }> = {
  shield: { name: 'シールド', desc: '次の自動供給を1回無効化' },
  clear: { name: 'おじゃま一掃', desc: 'バックログのおじゃまを消す' },
  brake: { name: 'ブレーキ', desc: '自動供給を5秒間ストップ' },
  longbomb: { name: 'ロング送信', desc: '相手に長い単語を送りつける' },
  rapid: { name: '連射', desc: '8秒間 1連鎖ごとに1攻撃' },
};
const ITEM_EMOJI: Record<ItemType, string> = {
  shield: '🛡',
  clear: '🌀',
  brake: '⏸',
  longbomb: '📨',
  rapid: '⚡',
};
const RAPID_DURATION = 8000;

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
  players: Record<string, RoomPlayer>;
  onExit: () => void;
}

export default function OnlineGame({ roomId, uid, seed, startAt, status, hostUid, category, players, onExit }: OnlineGameProps) {
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
  const [spawnInterval, setSpawnInterval] = useState(INITIAL_SPAWN_INTERVAL);
  const [missFlash, setMissFlash] = useState(false);
  const [pending, setPending] = useState<Telegraph[]>([]);
  const [attackFlash, setAttackFlash] = useState<{ amount: number; name: string } | null>(null);
  const [heldItem, setHeldItem] = useState<ItemType | null>(null);
  const [itemFlash, setItemFlash] = useState(false);
  const [targetMode, setTargetMode] = useState<TargetMode>('random');
  const [muted, setMuted] = useState(false);
  const [rapidActive, setRapidActive] = useState(false);
  // エフェクト用
  const [beams, setBeams] = useState<{ id: number; x1: number; y1: number; x2: number; y2: number; color: string }[]>([]);
  const [hitId, setHitId] = useState<string | null>(null); // 自分が攻撃した相手
  const [incomingId, setIncomingId] = useState<string | null>(null); // 自分を攻撃してきた相手
  const [toasts, setToasts] = useState<{ id: number; text: string; kind: 'ko' | 'in' | 'item' }[]>([]);
  const [shake, setShake] = useState(false);
  const [damageFlash, setDamageFlash] = useState(false); // 被弾時の赤フラッシュ
  const [useFlash, setUseFlash] = useState<ItemType | null>(null); // 自分のアイテム発動演出

  const centerRef = useRef<HTMLDivElement>(null);
  const boardRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const beamIdRef = useRef(0);
  const toastIdRef = useRef(0);
  const prevPlayersRef = useRef(players);

  const startTimeRef = useRef(0);
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
  const categoryRef = useRef(category);
  useEffect(() => {
    categoryRef.current = category;
  }, [category]);
  const pendingRef = useRef<Telegraph[]>([]);
  const updatePending = useCallback((next: Telegraph[]) => {
    pendingRef.current = next;
    setPending(next);
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
    return Math.floor(keysTyped / ((Date.now() - startTimeRef.current) / 60000));
  }, [keysTyped]);

  // 自分が稼いだバッジ数（自分にトドメ＝koBy===uid のプレイヤー数）。
  const myBadges = Object.values(players).filter((p) => p.koBy === uid).length;

  // シードから RNG と初期バックログを生成（全員同一）。アイテム抽選用は別系列。
  useEffect(() => {
    const rng = mulberry32(seed >>> 0);
    wordRngRef.current = rng;
    itemRngRef.current = mulberry32((seed ^ 0x9e3779b9) >>> 0);
    const th = categoryRef.current;
    setBacklog([generateWord(rng, th), generateWord(rng, th), generateWord(rng, th)]);
    // 新しいゲーム開始時に自分の状態をリセット（再戦対応）。
    writePlayerSummary(roomId, uid, { alive: true, rank: 0, backlog: 3, combo: 0, koBy: '' });
  }, [seed, roomId, uid]);

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

  // 自分が脱落。順位と KO クレジット（koBy）を確定。
  const topOut = useCallback(() => {
    if (!selfAliveRef.current) return;
    selfAliveRef.current = false;
    const aliveCount = Object.values(playersRef.current).filter(isLive).length;
    const myRank = Math.max(1, aliveCount);
    setRank(myRank);
    setSelfAlive(false);
    sfx.gameover();
    setShake(true);
    setTimeout(() => setShake(false), 500);
    writePlayerSummary(roomId, uid, { alive: false, rank: myRank, backlog: MAX_BACKLOG, koBy: lastAttackerRef.current });
  }, [roomId, uid]);

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
  }, [uid]);

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
      let amount = Math.floor(comboVal / 5);
      if (amount <= 0) return;
      if (stateRef.current.backlog.length / MAX_BACKLOG >= PINCH_RATIO) amount = Math.round(amount * PINCH_MULT);
      const badges = Object.values(playersRef.current).filter((p) => p.koBy === uid).length;
      amount = Math.round(amount * (1 + 0.25 * Math.min(badges, 4)));
      amount = Math.min(amount, ATTACK_CAP);
      sendAmount(amount);
    },
    [uid, sendAmount],
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
        setRapidActive(true);
        setTimeout(() => setRapidActive(false), RAPID_DURATION);
      }
    },
    [pickTarget, fireBeam, roomId, uid],
  );

  const grantItem = useCallback(() => {
    if (heldItemRef.current) applyItem(heldItemRef.current); // 既存を自動発動してスタック
    const rng = itemRngRef.current;
    const items: ItemType[] = ['shield', 'clear', 'brake', 'longbomb', 'rapid'];
    const pick = rng ? items[Math.floor(rng() * items.length)] : items[0];
    setHeldItem(pick);
    sfx.item();
    setItemFlash(true);
    setTimeout(() => setItemFlash(false), 1000);
  }, [applyItem]);

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
    if (!started) return;
    const id = setInterval(() => {
      if (!selfAliveRef.current || pendingRef.current.length === 0) return;
      const now = Date.now();
      const due = pendingRef.current.filter((e) => e.confirmAt <= now);
      if (due.length === 0) return;
      const words: Word[] = [];
      for (const e of due) {
        if (e.word) words.push(makeOjamaWordFrom(e.word.display, e.word.reading));
        else for (let i = 0; i < e.amount; i++) words.push(makeOjamaWord());
      }
      updatePending(pendingRef.current.filter((e) => e.confirmAt > now));
      if (words.length > 0) {
        setBacklog((prev) => {
          const next = [...prev, ...words];
          if (next.length > MAX_BACKLOG) {
            topOut();
            return next.slice(0, MAX_BACKLOG);
          }
          return next;
        });
      }
    }, 100);
    return () => clearInterval(id);
  }, [started, updatePending, topOut]);

  // 入力処理
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      resumeAudio();
      if (!started || !selfAliveRef.current) return;
      if (e.key === 'Enter') { e.preventDefault(); useItem(); return; }
      if (e.key === 'Tab') { e.preventDefault(); cycleTargetMode(); return; }
      if (e.key.length !== 1 || e.ctrlKey || e.metaKey || e.altKey) return;
      e.preventDefault();
      const result = processKey(e.key.toLowerCase(), stateRef.current);
      if (result.miss) {
        setCombo(0);
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
        if (newCombo >= 5 && newCombo % 5 === 0) launchAttack(newCombo);
        if (Date.now() < rapidUntilRef.current) sendAmount(1); // 連射: 1連鎖ごとに1攻撃
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
  }, [started, launchAttack, sendAmount, useItem, grantItem, cycleTargetMode]);

  // ベース供給＆加速ループ（シールド/ブレーキ対応）。
  useEffect(() => {
    if (!started || !selfAlive) return;
    let timerId: ReturnType<typeof setTimeout>;
    const loop = () => {
      const now = Date.now();
      if (now < brakeUntilRef.current) {
        /* ブレーキ中 */
      } else if (shieldRef.current) {
        shieldRef.current = false;
      } else {
        setBacklog((prev) => {
          if (prev.length >= MAX_BACKLOG) {
            topOut();
            return prev;
          }
          const rng = wordRngRef.current;
          return rng ? [...prev, generateWord(rng, categoryRef.current)] : prev;
        });
      }
      setSpawnInterval((prev) => Math.max(MIN_SPAWN_INTERVAL, prev * 0.98));
      timerId = setTimeout(loop, spawnInterval);
    };
    timerId = setTimeout(loop, spawnInterval);
    return () => clearTimeout(timerId);
  }, [started, selfAlive, spawnInterval, topOut]);

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
    const total = Object.keys(players).length;
    const aliveCount = Object.values(players).filter(isLive).length;
    // 全滅(=1人プレイのトップアウト)か、2人以上で残り1人になったら決着。
    if (aliveCount === 0 || (total >= 2 && aliveCount <= 1)) finishGame(roomId);
  }, [players, status, uid, hostUid, roomId, started]);

  // テトリス99のように、他プレイヤー同士の攻防も可視化（自分以外の撃ち合い）。
  // 実データの全攻撃は購読していないため、生存中の他プレイヤー間にそれっぽい
  // ビームを散らすアンビエント表現（自分を狙うビームは出さない）。
  useEffect(() => {
    if (!started || status !== 'playing') return;
    const id = setInterval(() => {
      const aliveOthers = Object.entries(playersRef.current).filter(([oid, p]) => oid !== uid && isLive(p));
      if (aliveOthers.length < 2 || Math.random() > 0.6) return;
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
  }, [started, status, uid, addBeam]);

  const others = Object.entries(players).filter(([id]) => id !== uid);
  const aliveCount = Object.values(players).filter(isLive).length;
  const totalCount = Object.keys(players).length;
  const isDanger = backlog.length >= MAX_BACKLOG - 3;
  const totalIncoming = pending.reduce((s, e) => s + e.amount, 0);
  const isHost = uid === hostUid;

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
    return (
      <div className="min-h-screen bg-neutral-950 text-white flex flex-col items-center justify-center p-6">
        <Crown className="w-16 h-16 text-yellow-400 mb-4" />
        <h2 className="text-3xl font-black tracking-widest mb-1">RESULT</h2>
        <p className="text-yellow-300 mb-6 text-lg">勝者: {winner?.name ?? '—'}</p>
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
        <p className="text-gray-400 mb-4 font-mono">あなたの順位: {myRank} 位 / 最高連鎖 {maxCombo}</p>
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

      {rapidActive && (
        <div className="fixed top-[7.5rem] left-1/2 -translate-x-1/2 z-40 bg-yellow-500/90 text-black text-xs font-black px-3 py-1 rounded-full flex items-center gap-1 animate-pulse pointer-events-none">
          <Zap className="w-4 h-4" /> 連射中！
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
                max={MAX_BACKLOG}
                isKO={!isLive(p)}
                name={p.name}
                combo={p.combo}
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
            {/* ターゲットモード切替（[Tab]でも切替）。ソロと配置を統一（左上）。 */}
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
                    <span className="text-[10px] text-cyan-300 font-bold">[Enter]</span>
                  </div>
                </div>
              )}
            </div>

            <div className="w-full max-w-lg mt-2">
              <div className="text-[10px] text-gray-500 mb-0.5">自分のバックログ（満タンで脱落）</div>
              <div className="flex gap-1">
                {Array.from({ length: MAX_BACKLOG }).map((_, i) => (
                  <div
                    key={i}
                    className={`h-2 flex-1 rounded-sm ${
                      i < backlog.length ? (i >= MAX_BACKLOG - 3 ? 'bg-red-500' : 'bg-cyan-500') : 'bg-neutral-800'
                    }`}
                  />
                ))}
              </div>
            </div>

            <div className="mt-3">
              <AttackGauge combo={combo} pinch={isDanger} badges={myBadges} />
            </div>
          </div>
        </div>

        <div className="w-1/4 grid grid-cols-2 gap-2 content-start">
          {others.slice(Math.ceil(others.length / 2)).map(([id, p]) => (
            <div key={id} ref={(el) => { boardRefs.current[id] = el; }}>
              <MiniBoard
                height={p.backlog}
                max={MAX_BACKLOG}
                isKO={!isLive(p)}
                name={p.name}
                combo={p.combo}
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
  return <Zap className="w-5 h-5 text-yellow-300" />;
};
