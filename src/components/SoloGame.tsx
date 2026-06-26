import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Swords, Zap, Trophy, Shield, AlertTriangle, Sparkles, Wind, Pause, ArrowLeft,
  Volume2, VolumeX, Bomb, Crown, Target, Lock, Scissors, ArrowDownToLine,
} from 'lucide-react';
import { mulberry32, randomSeed, type RNG } from '../lib/rng';
import { generateWord, makeOjamaWord, makeOjamaWordFrom, makeShortWord, randomLongWord, THEMES } from '../lib/words';
import { processKey, type PlayerState } from '../lib/engine';
import { sfx, resumeAudio, setSfxEnabled } from '../lib/sfx';
import type { Dummy, GameStatus, ItemType, TargetMode, Word } from '../lib/types';
import MiniBoard from './MiniBoard';
import CurrentWord from './CurrentWord';
import AttackGauge from './AttackGauge';

// --- 定数 ---
const MAX_BACKLOG = 12;
const INITIAL_SPAWN_INTERVAL = 4000;
const MIN_SPAWN_INTERVAL = 1000;
const DEFAULT_ACCEL = 0.98; // 1供給ごとの間隔倍率
const DUMMY_COUNT = 20;
const BRAKE_DURATION = 5000;
const ATTACK_CAP = 5; // 1回の攻撃量の上限（即死コンボ防止）
const RAPID_DURATION = 8000; // 連射アイテムの効果時間
const KEEP_DURATION = 10000; // 連鎖キープ（ミスで連鎖が切れない）の効果時間
const PARRY_DURATION = 8000; // 受け流し（被攻撃を逸らす）の効果時間
const TOTEM_DURATION = 12000; // 不死のトーテム（上限超過無効）の効果時間
const ATTACK_THRESHOLD = 5; // 何クリアごとに攻撃を発射するか（初期値）
const TELEGRAPH_DELAY = 1500; // CPU攻撃の着弾予告→確定までの猶予
const CFG_KEY = 'typeRoyale.custom'; // カスタム設定の保存キー

// 時間制限つきアイテムの効果時間（カウントダウンゲージ用）。
const ITEM_DURATION: Partial<Record<ItemType, number>> = {
  brake: BRAKE_DURATION,
  rapid: RAPID_DURATION,
  keep: KEEP_DURATION,
  parry: PARRY_DURATION,
  totem: TOTEM_DURATION,
};

const ITEM_META: Record<ItemType, { name: string; icon: string; desc: string }> = {
  shield: { name: 'シールド', icon: '🛡', desc: '次の自動供給を1回無効化' },
  clear: { name: 'おじゃま一掃', icon: '🌀', desc: 'バックログのおじゃまを消す' },
  brake: { name: 'ブレーキ', icon: '⏸', desc: '自動供給を5秒間ストップ' },
  longbomb: { name: 'ロング送信', icon: '📨', desc: '敵に長文(相殺不可)を送る' },
  rapid: { name: '連射', icon: '⚡', desc: '8秒間 1クリアごとに1攻撃' },
  keep: { name: '連鎖キープ', icon: '🔒', desc: '10秒間ミスしても連鎖が切れない' },
  shrink: { name: '短縮', icon: '✂', desc: '溜まったワードを全て短い単語に変換' },
  parry: { name: '受け流し', icon: '🪃', desc: '8秒間 被攻撃を他の相手へ逸らす' },
  gaugedown: { name: 'ゲージ短縮', icon: '⏬', desc: '攻撃が4クリアごとに発射(恒久・一個まで)' },
  totem: { name: '不死のトーテム', icon: '🗿', desc: '12秒間 上限超過しても脱落しない(自動発動)' },
};
const ITEM_EMOJI: Record<ItemType, string> = {
  shield: '🛡', clear: '🌀', brake: '⏸', longbomb: '📨', rapid: '⚡', keep: '🔒',
  shrink: '✂', parry: '🪃', gaugedown: '⏬', totem: '🗿',
};
const ALL_ITEMS: ItemType[] = [
  'shield', 'clear', 'brake', 'longbomb', 'rapid', 'keep', 'shrink', 'parry', 'gaugedown', 'totem',
];

// カスタム設定の永続化（タイトルに戻ってもリセットされない）。
interface CustomCfg { initial: number; min: number; accel: number; theme: string; }
function loadCfg(): CustomCfg {
  try {
    const raw = localStorage.getItem(CFG_KEY);
    if (raw) {
      const o = JSON.parse(raw);
      return {
        initial: typeof o.initial === 'number' ? o.initial : INITIAL_SPAWN_INTERVAL,
        min: typeof o.min === 'number' ? o.min : MIN_SPAWN_INTERVAL,
        accel: typeof o.accel === 'number' ? o.accel : DEFAULT_ACCEL,
        theme: typeof o.theme === 'string' ? o.theme : 'all',
      };
    }
  } catch { /* localStorage 不可環境は既定値 */ }
  return { initial: INITIAL_SPAWN_INTERVAL, min: MIN_SPAWN_INTERVAL, accel: DEFAULT_ACCEL, theme: 'all' };
}

const TARGET_MODES: { mode: TargetMode; label: string }[] = [
  { mode: 'random', label: 'ランダム' },
  { mode: 'counter', label: '反撃' },
  { mode: 'finish', label: 'とどめ' },
  { mode: 'strong', label: '強敵' },
];

interface Telegraph { id: number; amount: number; confirmAt: number; word?: { display: string; reading: string }; }

const CPU_NAMES = [
  'タイピー', 'カナ丸', 'ローマ', 'ことだま', 'はやて', 'シフト', 'エンター', 'スペース',
  'バックスペース', 'キャップス', 'コンボ', 'チェイン', 'おじゃま', 'おたから', 'シールド',
  'ブレーキ', 'ラピッド', 'ボム', 'ターゲット', 'ロイヤル',
];

export default function SoloGame({ onExit }: { onExit: () => void }) {
  const initialCfg = loadCfg();
  const [gameState, setGameState] = useState<GameStatus>('start');

  const [backlog, setBacklog] = useState<PlayerState['backlog']>([]);
  const [tokenIndex, setTokenIndex] = useState(0);
  const [currentTyping, setCurrentTyping] = useState('');
  const [combo, setCombo] = useState(0);
  const [maxCombo, setMaxCombo] = useState(0);
  const [score, setScore] = useState(0);
  const [keysTyped, setKeysTyped] = useState(0);
  const [startTime, setStartTime] = useState<number | null>(null);
  const [spawnInterval, setSpawnInterval] = useState(INITIAL_SPAWN_INTERVAL);
  const [seed, setSeed] = useState(0);

  const [playerKOs, setPlayerKOs] = useState(0);
  const [heldItem, setHeldItem] = useState<ItemType | null>(null);

  const [missFlash, setMissFlash] = useState(false);
  const [itemFlash, setItemFlash] = useState(false);
  const [attackFlash, setAttackFlash] = useState<{ amount: number; name: string } | null>(null);
  const [hitDummy, setHitDummy] = useState<number | null>(null);
  const [incomingDummy, setIncomingDummy] = useState<number | null>(null);
  const [muted, setMuted] = useState(false);
  const [theme, setTheme] = useState(initialCfg.theme);
  const [attackThreshold, setAttackThreshold] = useState(ATTACK_THRESHOLD); // ゲージ短縮で 5→4
  const [nowTick, setNowTick] = useState(0); // カウントダウン描画用の時刻（効果の発動中判定にも使う）
  const [attackProgress, setAttackProgress] = useState(0); // 次の攻撃までのゲージ（ミスで減らない）
  const [targetMode, setTargetMode] = useState<TargetMode>('random');
  // 受信予告（CPUからの攻撃）
  const [pending, setPending] = useState<Telegraph[]>([]);
  const [toasts, setToasts] = useState<{ id: number; text: string; kind: 'ko' | 'in' | 'item' }[]>([]);
  const [damageFlash, setDamageFlash] = useState(false);
  // エフェクト用
  const [beams, setBeams] = useState<{ id: number; x1: number; y1: number; x2: number; y2: number; color: string }[]>([]);
  const [shake, setShake] = useState(false);
  const [useFlash, setUseFlash] = useState<ItemType | null>(null);
  const centerRef = useRef<HTMLDivElement>(null);
  const dummyRefs = useRef<Record<number, HTMLDivElement | null>>({});
  const beamIdRef = useRef(0);
  const toastIdRef = useRef(0);
  const telegraphIdRef = useRef(0);

  const addBeam = useCallback((x1: number, y1: number, x2: number, y2: number, color: string) => {
    const id = beamIdRef.current++;
    setBeams((b) => [...b, { id, x1, y1, x2, y2, color }]);
    setTimeout(() => setBeams((b) => b.filter((x) => x.id !== id)), 700);
  }, []);

  const pushToast = useCallback((text: string, kind: 'ko' | 'in' | 'item') => {
    const id = toastIdRef.current++;
    setToasts((t) => [...t, { id, text, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 1700);
  }, []);

  // カスタムモードの設定（永続化された値で初期化）
  const [cfgInitial, setCfgInitial] = useState(initialCfg.initial);
  const [cfgMin, setCfgMin] = useState(initialCfg.min);
  const [cfgAccel, setCfgAccel] = useState(initialCfg.accel);
  // 設定が変わるたび localStorage に保存（タイトルに戻ってもリセットされない）。
  useEffect(() => {
    try {
      localStorage.setItem(CFG_KEY, JSON.stringify({ initial: cfgInitial, min: cfgMin, accel: cfgAccel, theme }));
    } catch { /* 保存不可環境は無視 */ }
  }, [cfgInitial, cfgMin, cfgAccel, theme]);
  const accelRef = useRef(DEFAULT_ACCEL);
  const minRef = useRef(MIN_SPAWN_INTERVAL);
  const rapidUntilRef = useRef(0);
  const keepUntilRef = useRef(0);
  const parryUntilRef = useRef(0);
  const totemUntilRef = useRef(0);
  const attackThresholdRef = useRef(ATTACK_THRESHOLD);
  const gaugeDownObtainedRef = useRef(false); // ゲージ短縮は一人一個まで
  const attackProgressRef = useRef(0);
  const recentRef = useRef<string[]>([]); // 直近に出した単語（連続/近接重複の回避）
  const themeRef = useRef(theme);
  useEffect(() => { themeRef.current = theme; }, [theme]);
  const targetModeRef = useRef(targetMode);
  useEffect(() => { targetModeRef.current = targetMode; }, [targetMode]);
  const lastAttackerRef = useRef<number | null>(null);

  // 直近の単語履歴に追加（末尾8件まで保持）。
  const pushRecent = useCallback((display: string) => {
    recentRef.current = [...recentRef.current, display].slice(-8);
  }, []);
  // 重複を避けつつ次の単語を生成して履歴に積む。
  const nextWord = useCallback((): Word => {
    const rng = wordRngRef.current!;
    const w = generateWord(rng, themeRef.current, recentRef.current);
    pushRecent(w.display);
    return w;
  }, [pushRecent]);
  const pendingRef = useRef<Telegraph[]>([]);
  const updatePending = useCallback((next: Telegraph[]) => {
    pendingRef.current = next;
    setPending(next);
  }, []);

  const [dummies, setDummies] = useState<Dummy[]>(
    Array.from({ length: DUMMY_COUNT }).map((_, i) => ({ id: i, height: 0, isKO: false, name: CPU_NAMES[i], combo: 0, atk: 0 })),
  );

  const stateRef = useRef<PlayerState>({ backlog, tokenIndex, currentTyping, combo, gameState });
  useEffect(() => {
    stateRef.current = { backlog, tokenIndex, currentTyping, combo, gameState };
  }, [backlog, tokenIndex, currentTyping, combo, gameState]);

  const dummiesRef = useRef(dummies);
  useEffect(() => { dummiesRef.current = dummies; }, [dummies]);

  const heldItemRef = useRef(heldItem);
  useEffect(() => { heldItemRef.current = heldItem; }, [heldItem]);

  const wordRngRef = useRef<RNG | null>(null);
  const itemRngRef = useRef<RNG | null>(null);
  const shieldRef = useRef(false);
  const brakeUntilRef = useRef(0);

  // CPUに攻撃を受けた演出（赤ビーム＋画面赤フラッシュ＋シェイク）。
  const fireIncoming = useCallback((fromId: number) => {
    setIncomingDummy(fromId);
    setTimeout(() => setIncomingDummy((cur) => (cur === fromId ? null : cur)), 650);
    setDamageFlash(true);
    setTimeout(() => setDamageFlash(false), 220);
    const from = dummyRefs.current[fromId]?.getBoundingClientRect();
    const to = centerRef.current?.getBoundingClientRect();
    if (from && to) {
      addBeam(from.left + from.width / 2, from.top + from.height / 2, to.left + to.width / 2, to.top + to.height * 0.35, '#ef4444');
    }
  }, [addBeam]);

  // ターゲット選択（4モード）。
  const pickTarget = useCallback((): Dummy | null => {
    const alive = dummiesRef.current.filter((d) => !d.isKO);
    if (alive.length === 0) return null;
    const mode = targetModeRef.current;
    if (mode === 'counter') {
      const found = alive.find((d) => d.id === lastAttackerRef.current);
      if (found) return found;
    } else if (mode === 'finish') {
      return alive.reduce((best, cur) => (cur.height > best.height ? cur : best));
    } else if (mode === 'strong') {
      return alive.reduce((best, cur) => ((cur.atk ?? 0) > (best.atk ?? 0) ? cur : best));
    }
    return alive[Math.floor(Math.random() * alive.length)];
  }, []);

  // 指定量を攻撃: まず受信予告と相殺 → 余剰をターゲットへ。
  const fireAttack = useCallback((amount: number) => {
    if (amount <= 0) return;
    // 相殺（ただし長文＝ロング送信は相殺対象外で必ず着弾する）。
    let remaining = amount;
    const sorted = [...pendingRef.current].sort((a, b) => a.confirmAt - b.confirmAt);
    for (const e of sorted) {
      if (remaining <= 0) break;
      if (e.word) continue; // 長文は打ち消せない
      const cut = Math.min(remaining, e.amount);
      e.amount -= cut;
      remaining -= cut;
    }
    updatePending(sorted.filter((e) => e.amount > 0 || e.word));
    sfx.attack();
    if (remaining <= 0) {
      setAttackFlash({ amount: 0, name: '相殺！' });
      setTimeout(() => setAttackFlash(null), 600);
      return;
    }
    const target = pickTarget();
    if (!target) return;
    const willKO = target.height + remaining > MAX_BACKLOG;
    setDummies((prev) =>
      prev.map((d) =>
        d.id === target.id ? (willKO ? { ...d, height: 0, isKO: true } : { ...d, height: d.height + remaining }) : d,
      ),
    );
    if (willKO) {
      setPlayerKOs((k) => k + 1);
      pushToast(`${target.name} を撃破！`, 'ko');
      sfx.ko();
    }
    setAttackFlash({ amount: remaining, name: target.name ?? '' });
    setHitDummy(target.id);
    const from = centerRef.current?.getBoundingClientRect();
    const to = dummyRefs.current[target.id]?.getBoundingClientRect();
    if (from && to) {
      addBeam(from.left + from.width / 2, from.top + from.height * 0.35, to.left + to.width / 2, to.top + to.height / 2, '#fb923c');
    }
    setTimeout(() => setAttackFlash(null), 600);
    setTimeout(() => setHitDummy((cur) => (cur === target.id ? null : cur)), 600);
  }, [addBeam, pickTarget, pushToast, updatePending]);

  // アイテムの効果を適用（所持状態のクリアは行わない）。
  const applyItem = useCallback(
    (item: ItemType) => {
      setUseFlash(item);
      setTimeout(() => setUseFlash(null), 900);
      if (item === 'shield') shieldRef.current = true;
      else if (item === 'brake') brakeUntilRef.current = Date.now() + BRAKE_DURATION;
      else if (item === 'clear')
        setBacklog((prev) => (prev.length <= 1 ? prev : [prev[0], ...prev.slice(1).filter((w) => w.type !== 'ojama')]));
      else if (item === 'longbomb') fireAttack(6); // 敵CPUへの大ダメージ攻撃
      else if (item === 'rapid') {
        rapidUntilRef.current = Date.now() + RAPID_DURATION;
      } else if (item === 'keep') {
        keepUntilRef.current = Date.now() + KEEP_DURATION;
      } else if (item === 'shrink') {
        // 溜まっているワード（処理待ちの山）を全て短い単語に変換して打ちやすくする。
        // いま打っている先頭(index 0)はそのまま残す。
        setBacklog((prev) => prev.map((w, i) => (i === 0 ? w : makeShortWord(w.type))));
      } else if (item === 'parry') {
        parryUntilRef.current = Date.now() + PARRY_DURATION;
      } else if (item === 'gaugedown') {
        attackThresholdRef.current = Math.max(4, attackThresholdRef.current - 1);
        setAttackThreshold(attackThresholdRef.current);
      } else if (item === 'totem') {
        totemUntilRef.current = Date.now() + TOTEM_DURATION;
      }
    },
    [fireAttack],
  );

  // 受け流し: 確定したおじゃまをプレイヤーに入れず、ランダムな敵CPUへ逸らす。
  const deflectToCpu = useCallback(
    (amount: number) => {
      if (amount <= 0) return;
      const alive = dummiesRef.current.filter((d) => !d.isKO);
      if (alive.length === 0) return;
      const target = alive[Math.floor(Math.random() * alive.length)];
      const willKO = target.height + amount > MAX_BACKLOG;
      setDummies((prev) =>
        prev.map((d) =>
          d.id === target.id ? (willKO ? { ...d, height: 0, isKO: true } : { ...d, height: d.height + amount }) : d,
        ),
      );
      if (willKO) {
        setPlayerKOs((k) => k + 1);
        pushToast(`${target.name} を撃破！`, 'ko');
        sfx.ko();
      }
      setHitDummy(target.id);
      setTimeout(() => setHitDummy((cur) => (cur === target.id ? null : cur)), 600);
      const from = centerRef.current?.getBoundingClientRect();
      const to = dummyRefs.current[target.id]?.getBoundingClientRect();
      if (from && to) {
        addBeam(from.left + from.width / 2, from.top + from.height * 0.35, to.left + to.width / 2, to.top + to.height / 2, '#a78bfa');
      }
    },
    [addBeam, pushToast],
  );

  // 上限超過時の保護。トーテム発動中なら無効化、所持中なら自動発動、無ければ脱落。
  const overflowProtect = useCallback((): 'protected' | 'gameover' => {
    if (Date.now() < totemUntilRef.current) return 'protected';
    if (heldItemRef.current === 'totem') {
      totemUntilRef.current = Date.now() + TOTEM_DURATION;
      setHeldItem(null);
      setUseFlash('totem');
      setTimeout(() => setUseFlash(null), 900);
      sfx.use();
      pushToast('不死のトーテム発動！', 'item');
      return 'protected';
    }
    return 'gameover';
  }, [pushToast]);

  const grantItem = useCallback(() => {
    if (heldItemRef.current) applyItem(heldItemRef.current); // 既存を自動発動してスタック
    const rng = itemRngRef.current;
    const r = rng ? rng() : Math.random();
    // 不利度（バックログが多いほど高い）。短縮・ゲージ短縮は不利な人ほど出やすくする。
    const ratio = Math.min(1, stateRef.current.backlog.length / MAX_BACKLOG);
    const weighted: { item: ItemType; w: number }[] = [];
    for (const it of ALL_ITEMS) {
      if (it === 'gaugedown') {
        if (gaugeDownObtainedRef.current) continue; // 一人一個まで
        weighted.push({ item: it, w: 0.25 + ratio * 1.0 }); // 低確率・不利ほど出やすい
      } else if (it === 'shrink') {
        weighted.push({ item: it, w: 0.5 + ratio * 1.8 }); // 不利ほど出やすい
      } else if (it === 'totem') {
        weighted.push({ item: it, w: 0.7 });
      } else {
        weighted.push({ item: it, w: 1 });
      }
    }
    const total = weighted.reduce((s, x) => s + x.w, 0);
    let acc = r * total;
    let pick: ItemType = weighted[0].item;
    for (const x of weighted) {
      acc -= x.w;
      if (acc <= 0) { pick = x.item; break; }
    }
    if (pick === 'gaugedown') gaugeDownObtainedRef.current = true; // 以降は出さない
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

  const startGame = useCallback(() => {
    const newSeed = randomSeed();
    const wordRng = mulberry32(newSeed);
    const itemRng = mulberry32((newSeed ^ 0x9e3779b9) >>> 0);
    wordRngRef.current = wordRng;
    itemRngRef.current = itemRng;
    shieldRef.current = false;
    brakeUntilRef.current = 0;
    lastAttackerRef.current = null;
    updatePending([]);
    setSeed(newSeed);
    recentRef.current = [];
    setBacklog([nextWord(), nextWord(), nextWord()]);
    setTokenIndex(0);
    setCurrentTyping('');
    setCombo(0);
    setMaxCombo(0);
    setScore(0);
    setKeysTyped(0);
    setPlayerKOs(0);
    setHeldItem(null);
    setStartTime(Date.now());
    accelRef.current = cfgAccel;
    minRef.current = cfgMin;
    rapidUntilRef.current = 0;
    keepUntilRef.current = 0;
    parryUntilRef.current = 0;
    totemUntilRef.current = 0;
    attackThresholdRef.current = ATTACK_THRESHOLD;
    setAttackThreshold(ATTACK_THRESHOLD);
    gaugeDownObtainedRef.current = false;
    attackProgressRef.current = 0;
    setAttackProgress(0);
    setSpawnInterval(cfgInitial);
    setGameState('playing');
    setDummies((prev) =>
      prev.map((d) => ({ ...d, height: Math.floor(Math.random() * 5), isKO: false, combo: 0, atk: 0, lastItem: undefined, itemAt: undefined })),
    );
    sfx.start();
  }, [cfgInitial, cfgMin, cfgAccel, updatePending, nextWord]);

  const gameOver = useCallback(() => {
    setGameState('gameover');
    sfx.gameover();
    setShake(true);
    setTimeout(() => setShake(false), 450);
  }, []);

  // --- 入力処理 ---
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const { gameState } = stateRef.current;
      resumeAudio();
      if ((gameState === 'start' || gameState === 'gameover' || gameState === 'win') && e.key === ' ') {
        e.preventDefault();
        startGame();
        return;
      }
      if (gameState === 'playing' && e.key === 'Enter') { e.preventDefault(); useItem(); return; }
      if (gameState === 'playing' && e.key === 'Tab') { e.preventDefault(); cycleTargetMode(); return; }
      if (gameState !== 'playing' || e.key.length !== 1 || e.ctrlKey || e.metaKey || e.altKey) return;
      e.preventDefault();
      const key = e.key.toLowerCase();
      const result = processKey(key, stateRef.current);

      if (result.miss) {
        // 連鎖キープ中はミスしても連鎖（＝アタック数）を維持する。
        if (Date.now() >= keepUntilRef.current) setCombo(0);
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
        setKeysTyped((prev) => prev + 1);
        setScore((s) => s + 100 + newCombo * 10);
        sfx.clear();
        // ゲージはクリア数で進む（ミスでは減らない）。threshold クリアごとに発射し、
        // 攻撃量は現在の連鎖に応じて決まる（連鎖が低くても最低1は撃てる）。
        attackProgressRef.current += 1;
        if (attackProgressRef.current >= attackThresholdRef.current) {
          attackProgressRef.current -= attackThresholdRef.current;
          fireAttack(Math.min(Math.max(1, Math.floor(newCombo / 5)), ATTACK_CAP));
        }
        setAttackProgress(attackProgressRef.current);
        if (Date.now() < rapidUntilRef.current) fireAttack(1); // 連射: 1クリアごとに1攻撃
        if (result.clearedType === 'treasure') grantItem();
      } else if (result.nextState) {
        setTokenIndex(result.nextState.tokenIndex);
        setCurrentTyping(result.nextState.currentTyping);
        setKeysTyped((prev) => prev + 1);
        sfx.type();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [startGame, useItem, fireAttack, grantItem, cycleTargetMode]);

  // --- CPUの挙動: 自滅ランダムウォーク + プレイヤーへの攻撃 + アイテム使用 ---
  useEffect(() => {
    if (gameState !== 'playing') return;
    const interval = setInterval(() => {
      // 盤面の上下動（最終的に倒せる余地を作るためやや上昇寄り）
      setDummies((prev) =>
        prev.map((d) => {
          if (d.isKO) return d;
          let newHeight = d.height + (Math.random() > 0.45 ? 1 : -1);
          if (newHeight < 0) newHeight = 0;
          let combo = d.combo ?? 0;
          combo = Math.random() > 0.5 ? combo + 1 : 0; // 演出用のそれっぽい連鎖
          if (newHeight > MAX_BACKLOG) {
            sfx.eliminate();
            return { ...d, height: 0, isKO: true, combo: 0 };
          }
          return { ...d, height: newHeight, combo };
        }),
      );

      const alive = dummiesRef.current.filter((d) => !d.isKO);
      if (alive.length === 0) return;

      // 一部のCPUがプレイヤーを攻撃（着弾予告ゲージに追加）。
      // 攻撃が集中しすぎないよう、控えめな頻度・少量に抑える。
      // さらに、すでに予告がたまっている時は追撃を控える（理不尽な飽和を防ぐ）。
      const incomingNow = pendingRef.current.reduce((s, e) => s + e.amount, 0);
      if (incomingNow < 4 && Math.random() < 0.2) {
        const attacker = alive[Math.floor(Math.random() * alive.length)];
        const amount = Math.random() < 0.8 ? 1 : 2; // ほぼ1、たまに2
        lastAttackerRef.current = attacker.id;
        setDummies((prev) => prev.map((d) => (d.id === attacker.id ? { ...d, atk: (d.atk ?? 0) + 1 } : d)));
        updatePending([
          ...pendingRef.current,
          { id: telegraphIdRef.current++, amount, confirmAt: Date.now() + TELEGRAPH_DELAY },
        ]);
        fireIncoming(attacker.id);
        pushToast(`${attacker.name} から攻撃 +${amount}`, 'in');
      }

      // 一部のCPUがアイテムを使用。多くは演出のみ（ミニボードに絵文字）だが、
      // ロング送信を引いた時は実際にプレイヤーへ長文（ことわざ）を送りつける。
      if (Math.random() < 0.15) {
        const user = alive[Math.floor(Math.random() * alive.length)];
        const item = ALL_ITEMS[Math.floor(Math.random() * ALL_ITEMS.length)];
        setDummies((prev) => prev.map((d) => (d.id === user.id ? { ...d, lastItem: item, itemAt: Date.now() } : d)));
        const incomingNew = pendingRef.current.reduce((s, e) => s + e.amount, 0);
        if (item === 'longbomb' && incomingNew < 6) {
          const lw = randomLongWord();
          lastAttackerRef.current = user.id;
          setDummies((prev) => prev.map((d) => (d.id === user.id ? { ...d, atk: (d.atk ?? 0) + 1 } : d)));
          updatePending([
            ...pendingRef.current,
            { id: telegraphIdRef.current++, amount: 1, confirmAt: Date.now() + TELEGRAPH_DELAY, word: lw },
          ]);
          fireIncoming(user.id);
          pushToast(`${user.name} から長文 📨`, 'in');
        } else {
          pushToast(`${user.name} が ${ITEM_META[item].name} 使用`, 'item');
        }
      }

      // テトリス99のように、CPU同士も撃ち合う（自分以外の攻防を可視化）。
      if (alive.length >= 2 && Math.random() < 0.6) {
        const a = alive[Math.floor(Math.random() * alive.length)];
        let b = alive[Math.floor(Math.random() * alive.length)];
        if (b.id === a.id) b = alive[(alive.indexOf(a) + 1) % alive.length];
        if (b.id !== a.id) {
          const willKO = b.height + 1 > MAX_BACKLOG;
          setDummies((prev) =>
            prev.map((d) =>
              d.id === b.id ? (willKO ? { ...d, height: 0, isKO: true, combo: 0 } : { ...d, height: d.height + 1 }) : d,
            ),
          );
          if (willKO) sfx.eliminate();
          const from = dummyRefs.current[a.id]?.getBoundingClientRect();
          const to = dummyRefs.current[b.id]?.getBoundingClientRect();
          if (from && to) {
            addBeam(
              from.left + from.width / 2, from.top + from.height / 2,
              to.left + to.width / 2, to.top + to.height / 2,
              '#94a3b8', // CPU同士は中立的なグレーで自分の攻撃(オレンジ)と区別
            );
          }
        }
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [gameState, fireIncoming, pushToast, updatePending, addBeam]);

  // --- 受信予告の確定処理（時間が来たらおじゃまをバックログへ） ---
  useEffect(() => {
    if (gameState !== 'playing') return;
    const id = setInterval(() => {
      if (pendingRef.current.length === 0) return;
      const now = Date.now();
      const due = pendingRef.current.filter((e) => e.confirmAt <= now);
      if (due.length === 0) return;
      updatePending(pendingRef.current.filter((e) => e.confirmAt > now));
      // 受け流し中は、確定したおじゃまを自分に入れずランダムな敵CPUへ逸らす。
      if (now < parryUntilRef.current) {
        let deflect = 0;
        for (const e of due) deflect += e.word ? 2 : e.amount;
        if (deflect > 0) {
          deflectToCpu(deflect);
          pushToast(`受け流し！ +${deflect}`, 'item');
        }
        return;
      }
      const words: Word[] = [];
      for (const e of due) {
        if (e.word) words.push(makeOjamaWordFrom(e.word.display, e.word.reading));
        else for (let i = 0; i < e.amount; i++) words.push(makeOjamaWord());
      }
      if (words.length === 0) return;
      setBacklog((prev) => {
        const next = [...prev, ...words];
        if (next.length >= MAX_BACKLOG) {
          if (overflowProtect() === 'protected') return next.slice(0, MAX_BACKLOG - 1);
          gameOver();
          return next.slice(0, MAX_BACKLOG);
        }
        return next;
      });
    }, 100);
    return () => clearInterval(id);
  }, [gameState, gameOver, updatePending, deflectToCpu, pushToast, overflowProtect]);

  // 全CPUを倒したら勝利（ソロの勝利条件）。
  useEffect(() => {
    if (gameState !== 'playing') return;
    if (dummies.length > 0 && dummies.every((d) => d.isKO)) {
      setGameState('win');
      sfx.start();
    }
  }, [dummies, gameState]);

  // --- ベース供給＆加速ループ ---
  useEffect(() => {
    if (gameState !== 'playing') return;
    let timerId: ReturnType<typeof setTimeout>;
    const loop = () => {
      const now = Date.now();
      if (now < brakeUntilRef.current) {
        // ブレーキ中
      } else if (shieldRef.current) {
        shieldRef.current = false;
      } else {
        setBacklog((prev) => {
          if (prev.length >= MAX_BACKLOG) {
            if (overflowProtect() === 'protected') return prev.slice(0, MAX_BACKLOG - 1);
            gameOver();
            return prev;
          }
          return wordRngRef.current ? [...prev, nextWord()] : prev;
        });
      }
      setSpawnInterval((prev) => Math.max(minRef.current, prev * accelRef.current));
      timerId = setTimeout(loop, spawnInterval);
    };
    timerId = setTimeout(loop, spawnInterval);
    return () => clearTimeout(timerId);
  }, [gameState, spawnInterval, gameOver, overflowProtect, nextWord]);

  // --- カウントダウン描画用の時刻ティック ---
  useEffect(() => {
    if (gameState !== 'playing') return;
    const id = setInterval(() => setNowTick(Date.now()), 150);
    return () => clearInterval(id);
  }, [gameState]);

  const calculateKPM = () => {
    if (!startTime || keysTyped === 0) return 0;
    return Math.floor(keysTyped / ((Date.now() - startTime) / 60000));
  };

  const renderCurrentWord = () => {
    if (backlog.length === 0) return null;
    const word = backlog[0];
    const isOjama = word.type === 'ojama';
    const isTreasure = word.type === 'treasure';
    return (
      <div
        className={`p-6 rounded-xl border-2 shadow-2xl mb-4 transition-all duration-200 ${
          isOjama
            ? 'border-red-500/50 bg-red-950/30'
            : isTreasure
              ? 'border-yellow-400/50 bg-yellow-900/30 shadow-yellow-500/20'
              : 'border-blue-500/30 bg-gray-800/80'
        }`}
      >
        <CurrentWord
          word={word}
          tokenIndex={tokenIndex}
          currentTyping={currentTyping}
          accent={isOjama ? 'text-red-400' : isTreasure ? 'text-yellow-400' : 'text-cyan-400'}
        />
      </div>
    );
  };

  const isDanger = backlog.length >= MAX_BACKLOG - 3;
  const eliminatedCount = dummies.filter((d) => d.isKO).length;
  const survivors = DUMMY_COUNT + 1 - eliminatedCount;
  const totalIncoming = pending.reduce((s, e) => s + e.amount, 0);

  // 発動中の時間制限アイテム（残り時間カウントダウン表示用）。
  const activeEffects: { type: ItemType; until: number; color: string }[] = (
    [
      { type: 'brake', until: brakeUntilRef.current, color: 'bg-green-500' },
      { type: 'rapid', until: rapidUntilRef.current, color: 'bg-yellow-400' },
      { type: 'keep', until: keepUntilRef.current, color: 'bg-fuchsia-500' },
      { type: 'parry', until: parryUntilRef.current, color: 'bg-violet-500' },
      { type: 'totem', until: totemUntilRef.current, color: 'bg-amber-400' },
    ] as { type: ItemType; until: number; color: string }[]
  ).filter((e) => nowTick > 0 && e.until > nowTick);

  return (
    <div className={`min-h-screen bg-neutral-950 text-white font-sans overflow-hidden flex flex-col selection:bg-cyan-900 ${shake ? 'screen-shake' : ''}`}>
      <div className={`fixed inset-0 pointer-events-none z-50 transition-colors duration-100 ${missFlash ? 'bg-red-500/20' : 'bg-transparent'}`} />
      {/* 被弾時の赤フラッシュ */}
      <div
        className={`fixed inset-0 pointer-events-none z-40 transition-opacity duration-150 ${damageFlash ? 'opacity-100' : 'opacity-0'}`}
        style={{ boxShadow: 'inset 0 0 140px 40px rgba(239,68,68,0.55)' }}
      />

      {/* 不死のトーテム発動中エフェクト（金色のオーラ＋舞い上がる粒子） */}
      {gameState === 'playing' && nowTick < totemUntilRef.current && (
        <div className="fixed inset-0 pointer-events-none z-40 overflow-hidden totem-aura">
          <div className="absolute inset-0" style={{ boxShadow: 'inset 0 0 160px 50px rgba(250,204,21,0.45)' }} />
          {Array.from({ length: 14 }).map((_, i) => (
            <span
              key={i}
              className="totem-particle absolute text-yellow-300/90"
              style={{ left: `${(i * 7 + 5) % 100}%`, animationDelay: `${(i % 7) * 0.22}s`, fontSize: `${10 + (i % 4) * 4}px` }}
            >
              ✦
            </span>
          ))}
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-7xl opacity-80 totem-emblem">🗿</div>
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

      {/* 通知トースト（被弾・撃破・アイテム） */}
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

      {/* アイテム発動演出 */}
      {useFlash && (
        <div className="fixed top-[8rem] left-1/2 -translate-x-1/2 z-50 pointer-events-none animate-in fade-in zoom-in duration-200">
          <div className="bg-yellow-500/95 text-black font-black px-4 py-1.5 rounded-full flex items-center gap-2 shadow-lg">
            <span className="text-lg">{ITEM_META[useFlash].icon}</span> {ITEM_META[useFlash].name} 発動！
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

      <header className="h-16 border-b border-white/10 flex items-center justify-between px-8 bg-neutral-900/50 backdrop-blur-sm z-10">
        <div className="flex items-center gap-3">
          <button onClick={onExit} className="text-gray-500 hover:text-gray-300">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <Swords className="text-cyan-400" />
          <h1 className="text-xl font-bold tracking-widest text-gray-200">
            TYPE ROYALE<span className="text-xs ml-2 text-gray-500">SOLO</span>
          </h1>
        </div>
        <div className="flex gap-6 md:gap-8">
          <Hud label="SCORE" value={score} className="text-cyan-300" />
          <Hud label="KPM" value={calculateKPM()} />
          <Hud label="K.O." value={playerKOs} icon={<Trophy className="w-4 h-4 text-yellow-500" />} />
          <Hud label="BADGE" value={Math.min(playerKOs, 4)} icon={<Shield className="w-4 h-4 text-blue-400" />} />
          <button
            onClick={() => {
              const next = !muted;
              setMuted(next);
              setSfxEnabled(!next);
            }}
            className="text-gray-500 hover:text-gray-300 self-center"
            title={muted ? '効果音オン' : '効果音オフ'}
          >
            {muted ? <VolumeX className="w-5 h-5" /> : <Volume2 className="w-5 h-5" />}
          </button>
        </div>
      </header>

      <main className="flex-1 flex w-full max-w-7xl mx-auto p-4 gap-4 h-[calc(100vh-4rem)]">
        <div className="w-1/4 grid grid-cols-2 gap-2 content-start">
          {dummies.slice(0, 10).map((d) => (
            <div key={d.id} ref={(el) => { dummyRefs.current[d.id] = el; }}>
              <MiniBoard
                height={d.height}
                max={MAX_BACKLOG}
                isKO={d.isKO}
                name={d.name}
                combo={d.combo}
                hit={hitDummy === d.id}
                incoming={incomingDummy === d.id}
                itemEmoji={d.itemAt && Date.now() - d.itemAt < 1500 ? ITEM_EMOJI[d.lastItem as ItemType] : undefined}
              />
            </div>
          ))}
        </div>

        <div ref={centerRef} className="w-2/4 flex flex-col h-full relative">
          {isDanger && gameState === 'playing' && (
            <div className="absolute inset-0 border-4 border-red-500/50 rounded-2xl pointer-events-none animate-pulse z-0" />
          )}

          <div className="flex-1 flex flex-col items-center justify-end pb-8 relative z-10">
            {/* 発動中アイテムの残り時間カウントダウン */}
            {activeEffects.length > 0 && (
              <div className="absolute top-2 left-1/2 -translate-x-1/2 z-20 flex flex-col items-center gap-1">
                {activeEffects.map((e) => {
                  const dur = ITEM_DURATION[e.type] ?? 1;
                  const remain = Math.max(0, e.until - nowTick);
                  const frac = Math.max(0, Math.min(1, remain / dur));
                  return (
                    <div key={e.type} className="bg-neutral-900/90 border border-white/10 rounded-full pl-2 pr-3 py-0.5 flex items-center gap-1.5 shadow-lg">
                      <span className="text-sm">{ITEM_EMOJI[e.type]}</span>
                      <span className="text-[10px] font-bold text-gray-200 whitespace-nowrap">{ITEM_META[e.type].name}</span>
                      <div className="w-12 h-1.5 rounded-full bg-neutral-700 overflow-hidden">
                        <div className={`h-full ${e.color} transition-[width] duration-150`} style={{ width: `${frac * 100}%` }} />
                      </div>
                      <span className="text-[9px] font-mono text-gray-400 w-6 text-right">{(remain / 1000).toFixed(1)}</span>
                    </div>
                  );
                })}
              </div>
            )}
            {gameState === 'playing' && (
              <div className="absolute top-2 right-0 text-right">
                <div className="text-xs text-gray-500">ALIVE</div>
                <div className="font-mono text-2xl font-bold text-gray-300">
                  {survivors}
                  <span className="text-sm text-gray-600"> / {DUMMY_COUNT + 1}</span>
                </div>
              </div>
            )}

            {/* ターゲットモード切替（[Tab]でも切替） */}
            {gameState === 'playing' && (
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

            {/* 着弾予告ゲージ（CPUからの攻撃） */}
            {totalIncoming > 0 && gameState === 'playing' && (
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
                <div className="animate-in slide-in-from-bottom-4 text-3xl font-black italic text-cyan-400 drop-shadow-[0_0_10px_rgba(34,211,238,0.6)] flex items-center gap-2">
                  <Zap className="w-8 h-8 fill-cyan-400" /> {combo} COMBO!
                </div>
              )}
            </div>

            <div className="w-full max-w-lg flex flex-col justify-end h-96 relative">
              <div className="flex flex-col-reverse gap-2 mb-4 overflow-hidden mask-image-top">
                {backlog
                  .slice(1)
                  .map((word) => (
                    <div
                      key={word.id}
                      className={`px-4 py-2 rounded-lg text-sm font-bold opacity-70 flex justify-between items-center transition-all ${
                        word.type === 'ojama'
                          ? 'bg-red-950/50 text-red-300 border border-red-900/50'
                          : word.type === 'treasure'
                            ? 'bg-yellow-900/30 text-yellow-300 border border-yellow-700/50'
                            : 'bg-neutral-800 text-gray-400'
                      }`}
                    >
                      <span>{word.display}</span>
                      {word.type === 'ojama' && <AlertTriangle className="w-4 h-4" />}
                      {word.type === 'treasure' && <Sparkles className="w-4 h-4" />}
                    </div>
                  ))}
              </div>
              {renderCurrentWord()}
              {/* 保持アイテム（次の単語を隠さないよう単語の下に表示） */}
              {gameState === 'playing' && heldItem && (
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

            {/* 自分のバックログ（処理待ち）。満タンでトップアウト＝敗北。 */}
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
              <AttackGauge progress={attackProgress} combo={combo} pinch={isDanger} badges={Math.min(playerKOs, 4)} threshold={attackThreshold} />
            </div>
          </div>

          {gameState === 'start' && (
            <div className="absolute inset-0 bg-neutral-950/80 backdrop-blur-sm z-20 rounded-2xl overflow-y-auto">
              {/* min-h-full + justify-center で、収まる時は中央・はみ出す時は上から
                  スクロールできる（上部が見切れる問題の対策）。 */}
              <div className="min-h-full flex flex-col items-center justify-center w-full py-8 px-2">
              <Swords className="w-20 h-20 text-cyan-500 mb-6" />
              <h2 className="text-4xl font-black tracking-widest mb-2 text-white">TYPE ROYALE</h2>
              <p className="text-gray-400 mb-6 font-mono">Press [SPACE] to Start</p>

              {/* カスタム設定（ソロは常に設定変更可能） */}
              <div className="mb-6 w-full max-w-sm bg-neutral-900/60 border border-amber-700/40 rounded-xl p-4">
                  <div className="text-xs text-amber-300 font-bold mb-3 flex items-center gap-1">
                    <Zap className="w-3.5 h-3.5" /> カスタム設定
                  </div>
                  <div className="block text-[11px] text-gray-400 mb-3">
                    初期供給間隔: <span className="text-cyan-300 font-mono">{(cfgInitial / 1000).toFixed(1)}秒</span>
                    <div className="flex items-center gap-2">
                      <StepBtn onClick={() => setCfgInitial((v) => Math.max(500, v - 100))}>−0.1</StepBtn>
                      <input
                        type="range"
                        min={500}
                        max={6000}
                        step={100}
                        value={cfgInitial}
                        onChange={(e) => setCfgInitial(Number(e.target.value))}
                        className="flex-1 accent-cyan-500"
                      />
                      <StepBtn onClick={() => setCfgInitial((v) => Math.min(6000, v + 100))}>＋0.1</StepBtn>
                    </div>
                  </div>
                  <div className="block text-[11px] text-gray-400 mb-3">
                    最短間隔: <span className="text-cyan-300 font-mono">{(cfgMin / 1000).toFixed(1)}秒</span>
                    <div className="flex items-center gap-2">
                      <StepBtn onClick={() => setCfgMin((v) => Math.max(300, v - 100))}>−0.1</StepBtn>
                      <input
                        type="range"
                        min={300}
                        max={3000}
                        step={100}
                        value={cfgMin}
                        onChange={(e) => setCfgMin(Number(e.target.value))}
                        className="flex-1 accent-cyan-500"
                      />
                      <StepBtn onClick={() => setCfgMin((v) => Math.min(3000, v + 100))}>＋0.1</StepBtn>
                    </div>
                  </div>
                  <label className="block text-[11px] text-gray-400">
                    加速の強さ: <span className="text-cyan-300 font-mono">×{cfgAccel.toFixed(2)}</span>
                    <span className="text-gray-600"> （小さいほど速く加速 / 1.00で加速なし）</span>
                    <input
                      type="range"
                      min={0.9}
                      max={1.0}
                      step={0.01}
                      value={cfgAccel}
                      onChange={(e) => setCfgAccel(Number(e.target.value))}
                      className="w-full accent-cyan-500"
                    />
                  </label>
                </div>

              {/* 出題テーマ選択 */}
              <div className="mb-6 w-full max-w-sm">
                <div className="text-xs text-gray-500 mb-1.5 text-center">出題テーマ</div>
                <div className="flex flex-wrap gap-1.5 justify-center">
                  {THEMES.map((t) => (
                    <button
                      key={t.id}
                      onClick={() => setTheme(t.id)}
                      className={`px-2.5 py-1 rounded-full text-xs font-bold transition-colors ${
                        theme === t.id ? 'bg-cyan-600 text-white' : 'bg-neutral-800 text-gray-400 hover:bg-neutral-700'
                      }`}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex gap-4 text-sm text-gray-500 bg-neutral-900/50 p-4 rounded-xl">
                <div>🟦 通常単語</div>
                <div>🟥 おじゃま単語</div>
                <div>🟨 お宝単語</div>
              </div>
              <p className="text-xs text-gray-600 mt-4 max-w-sm text-center">
                ノーミスで打ち切ると連鎖UP。5連鎖ごとに敵CPUへおじゃまを送って撃墜！ CPUも反撃してくるので [Tab] で狙いを切り替えよう。お宝(🟨)を打つとアイテム獲得 → [Enter] で使用。
              </p>
              <div className="mt-4 text-xs bg-neutral-900/50 p-3 rounded-xl max-w-sm w-full">
                <div className="text-gray-400 font-bold mb-1.5 flex items-center gap-1">
                  <Sparkles className="w-3 h-3 text-yellow-400" /> アイテム効果（お宝🟨で入手 → [Enter]で使用）
                </div>
                <div className="flex flex-col gap-1 text-left text-gray-400">
                  {ALL_ITEMS.map((t) => (
                    <div key={t}>
                      <span className="mr-1">{ITEM_META[t].icon}</span>
                      <span className="text-gray-300 font-bold">{ITEM_META[t].name}</span>
                      <span className="text-gray-500"> … {ITEM_META[t].desc}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* ゲージの説明 */}
              <div className="mt-3 mb-2 text-xs bg-neutral-900/50 p-3 rounded-xl max-w-sm w-full">
                <div className="text-gray-400 font-bold mb-1.5">ゲージの見方</div>
                <div className="flex flex-col gap-1 text-left text-gray-500">
                  <div>
                    <span className="text-red-400 font-bold">左の赤ゲージ（着弾予告）</span> … CPUから送られてくるおじゃまの予告。時間が来るとバックログに加算される。
                  </div>
                  <div>
                    <span className="text-cyan-400 font-bold">下の青ゲージ（バックログ）</span> … 自分の処理待ちの山。満タンでトップアウト＝敗北。
                  </div>
                  <div>
                    <span className="text-orange-300 font-bold">攻撃チャージ</span> … 一定クリアごとに発射（ゲージ短縮で短くなる）。表示の「+N」がその時送る攻撃量。
                  </div>
                  <div>
                    <span className="text-cyan-300 font-bold">連鎖(COMBO)</span> … ノーミスで打ち切った連続数。長いほど攻撃が増える。
                  </div>
                </div>
              </div>
              </div>
            </div>
          )}

          {gameState === 'gameover' && (
            <div className="absolute inset-0 bg-red-950/90 backdrop-blur-md flex flex-col items-center justify-center z-20 rounded-2xl">
              <h2 className="text-5xl font-black text-white mb-2 tracking-widest drop-shadow-[0_0_15px_rgba(220,38,38,0.8)]">TOP OUT</h2>
              <p className="text-red-300 mb-8">おじゃまブロックがあふれました</p>
              <div className="bg-black/40 p-6 rounded-xl grid grid-cols-3 gap-x-8 gap-y-4 mb-8 border border-red-500/30">
                <Stat label="SCORE" value={score} />
                <Stat label="MAX COMBO" value={maxCombo} />
                <Stat label="K.O." value={playerKOs} />
                <Stat label="KPM" value={calculateKPM()} />
                <Stat label="KEYS" value={keysTyped} />
                <Stat label="SEED" value={seed} small />
              </div>
              <p className="text-gray-400 font-mono animate-pulse">Press [SPACE] to Retry</p>
            </div>
          )}

          {gameState === 'win' && (
            <div className="absolute inset-0 bg-emerald-950/90 backdrop-blur-md flex flex-col items-center justify-center z-20 rounded-2xl">
              <Crown className="w-16 h-16 text-yellow-400 mb-3" />
              <h2 className="text-5xl font-black text-white mb-2 tracking-widest drop-shadow-[0_0_15px_rgba(16,185,129,0.8)]">YOU WIN!</h2>
              <p className="text-emerald-300 mb-8">全ての敵を倒した！</p>
              <div className="bg-black/40 p-6 rounded-xl grid grid-cols-3 gap-x-8 gap-y-4 mb-8 border border-emerald-500/30">
                <Stat label="SCORE" value={score} />
                <Stat label="MAX COMBO" value={maxCombo} />
                <Stat label="K.O." value={playerKOs} />
                <Stat label="KPM" value={calculateKPM()} />
                <Stat label="KEYS" value={keysTyped} />
                <Stat label="SEED" value={seed} small />
              </div>
              <p className="text-gray-400 font-mono animate-pulse">Press [SPACE] to Retry</p>
            </div>
          )}
        </div>

        <div className="w-1/4 grid grid-cols-2 gap-2 content-start">
          {dummies.slice(10, 20).map((d) => (
            <div key={d.id} ref={(el) => { dummyRefs.current[d.id] = el; }}>
              <MiniBoard
                height={d.height}
                max={MAX_BACKLOG}
                isKO={d.isKO}
                name={d.name}
                combo={d.combo}
                hit={hitDummy === d.id}
                incoming={incomingDummy === d.id}
                itemEmoji={d.itemAt && Date.now() - d.itemAt < 1500 ? ITEM_EMOJI[d.lastItem as ItemType] : undefined}
              />
            </div>
          ))}
        </div>
      </main>

      <style
        dangerouslySetInnerHTML={{
          __html: `
        .mask-image-top{mask-image:linear-gradient(to bottom,transparent 0%,black 20%);-webkit-mask-image:linear-gradient(to bottom,transparent 0%,black 20%);}
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
        @keyframes totemAura { 0%,100% { opacity: 0.55; } 50% { opacity: 1; } }
        .totem-aura { animation: totemAura 1.4s ease-in-out infinite; }
        @keyframes totemRise {
          0% { transform: translateY(20vh) scale(0.6); opacity: 0; }
          15% { opacity: 1; }
          100% { transform: translateY(-110vh) scale(1.1); opacity: 0; }
        }
        .totem-particle { bottom: -3vh; animation: totemRise 2.2s linear infinite; }
        @keyframes totemPulse { 0%,100% { transform: translate(-50%,-50%) scale(1); opacity: 0.7; } 50% { transform: translate(-50%,-50%) scale(1.15); opacity: 1; } }
        .totem-emblem { animation: totemPulse 1.2s ease-in-out infinite; filter: drop-shadow(0 0 18px rgba(250,204,21,0.8)); }
      `,
        }}
      />
    </div>
  );
}

const Hud = ({ label, value, icon, className }: { label: string; value: number; icon?: React.ReactNode; className?: string }) => (
  <div className="flex flex-col items-center">
    <span className="text-xs text-gray-500">{label}</span>
    <span className={`font-mono text-xl font-bold flex items-center gap-1 ${className ?? ''}`}>
      {icon} {value}
    </span>
  </div>
);

const Stat = ({ label, value, small }: { label: string; value: number; small?: boolean }) => (
  <div className="text-center">
    <div className="text-xs text-red-400/80">{label}</div>
    <div className={`font-mono ${small ? 'text-lg' : 'text-3xl'}`}>{value}</div>
  </div>
);

const ItemIcon = ({ type }: { type: ItemType }) => {
  if (type === 'shield') return <Shield className="w-5 h-5 text-blue-300" />;
  if (type === 'clear') return <Wind className="w-5 h-5 text-cyan-300" />;
  if (type === 'brake') return <Pause className="w-5 h-5 text-green-300" />;
  if (type === 'longbomb') return <Bomb className="w-5 h-5 text-red-300" />;
  if (type === 'keep') return <Lock className="w-5 h-5 text-fuchsia-300" />;
  if (type === 'shrink') return <Scissors className="w-5 h-5 text-emerald-300" />;
  if (type === 'parry') return <Shield className="w-5 h-5 text-violet-300" />;
  if (type === 'gaugedown') return <ArrowDownToLine className="w-5 h-5 text-orange-300" />;
  if (type === 'totem') return <span className="text-base leading-none">🗿</span>;
  return <Zap className="w-5 h-5 text-yellow-300" />;
};

// カスタム設定の ±0.1秒 ステップボタン。
const StepBtn = ({ onClick, children }: { onClick: () => void; children: React.ReactNode }) => (
  <button
    type="button"
    onClick={onClick}
    className="px-2 py-0.5 rounded bg-neutral-800 hover:bg-neutral-700 text-cyan-300 text-xs font-mono font-bold shrink-0"
  >
    {children}
  </button>
);
