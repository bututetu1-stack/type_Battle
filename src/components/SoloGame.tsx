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
const TELEGRAPH_DELAY = 2500; // CPU攻撃の着弾予告→確定までの猶予（相殺の反応時間を確保）
const CFG_KEY = 'typeRoyale.custom'; // カスタム設定の保存キー

const FREEZE_DURATION = 5000; // フリーズ（着弾予告と自動供給を停止）の効果時間

// 時間制限つきアイテムの効果時間（カウントダウンゲージ用）。
const ITEM_DURATION: Partial<Record<ItemType, number>> = {
  brake: BRAKE_DURATION,
  rapid: RAPID_DURATION,
  keep: KEEP_DURATION,
  parry: PARRY_DURATION,
  totem: TOTEM_DURATION,
  freeze: FREEZE_DURATION,
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
  // ボスモード専用（ソロでは出現しない）。
  meteor: { name: 'メテオ', icon: '🌠', desc: 'ボス: 全挑戦者へ一斉攻撃' },
  quake: { name: '地割れ', icon: '🌋', desc: 'ボス: 最も危険な挑戦者へトドメ' },
  regen: { name: '再生', icon: '💚', desc: 'ボス: 自分のHPを回復' },
  rally: { name: '総攻撃', icon: '⚔', desc: '挑戦者: ボスへ即時の大攻撃' },
  focus: { name: '会心', icon: '🎯', desc: '挑戦者: 次のボスへの攻撃を倍化' },
  // 防御
  barrier: { name: 'バリア', icon: '🛡️', desc: '次の被弾を1回まるごと防ぐ' },
  freeze: { name: 'フリーズ', icon: '🧊', desc: '5秒間 着弾予告と自動供給を停止' },
  purge: { name: '大掃除', icon: '🧹', desc: 'バックログを全消去（逆転のチャンス）' },
  guard: { name: 'ガード', icon: '🧱', desc: '次の自動供給を2回ぶん防ぐ' },
  // 攻撃
  snipe: { name: '狙撃', icon: '🎯', desc: '狙った相手へ即+3' },
  burst: { name: 'バースト', icon: '💥', desc: '全ての相手へ一斉に+2' },
  heavy: { name: '強撃', icon: '🔨', desc: '連鎖に応じた大攻撃を即送信' },
  // 妨害
  flood: { name: 'フラッド', icon: '🌊', desc: '相手へ大量(+4)のおじゃま' },
  drain: { name: 'ドレイン', icon: '🩸', desc: '自分を2減らし相手へ+2' },
  mirror: { name: 'ミラー', icon: '🪞', desc: '不利なほど強い反撃を送る' },
};
const ITEM_EMOJI: Record<ItemType, string> = {
  shield: '🛡', clear: '🌀', brake: '⏸', longbomb: '📨', rapid: '⚡', keep: '🔒',
  shrink: '✂', parry: '🪃', gaugedown: '⏬', totem: '🗿',
  meteor: '🌠', quake: '🌋', regen: '💚', rally: '⚔', focus: '🎯',
  barrier: '🛡️', freeze: '🧊', purge: '🧹', guard: '🧱',
  snipe: '🎯', burst: '💥', heavy: '🔨', flood: '🌊', drain: '🩸', mirror: '🪞',
};
const ALL_ITEMS: ItemType[] = [
  'shield', 'clear', 'brake', 'longbomb', 'rapid', 'keep', 'shrink', 'parry', 'gaugedown', 'totem',
  // 追加アイテム（防御/攻撃/妨害）
  'barrier', 'freeze', 'purge', 'guard', 'snipe', 'burst', 'heavy', 'flood', 'drain', 'mirror',
];

// アイテムの大分類（攻撃/防御/妨害）。使い方設定・効果欄の分類に使う。
type ItemCat = 'attack' | 'defense' | 'disrupt';
const ITEM_CAT: Record<ItemType, ItemCat> = {
  // 攻撃
  longbomb: 'attack', rapid: 'attack', snipe: 'attack', burst: 'attack', heavy: 'attack', gaugedown: 'attack',
  meteor: 'attack', quake: 'attack', rally: 'attack', focus: 'attack',
  // 防御
  shield: 'defense', clear: 'defense', brake: 'defense', keep: 'defense', barrier: 'defense', freeze: 'defense',
  purge: 'defense', guard: 'defense', totem: 'defense', shrink: 'defense', regen: 'defense',
  // 妨害
  parry: 'disrupt', flood: 'disrupt', drain: 'disrupt', mirror: 'disrupt',
};
const CAT_META: { key: ItemCat; label: string; color: string }[] = [
  { key: 'attack', label: '攻撃', color: 'text-orange-300' },
  { key: 'defense', label: '防御', color: 'text-cyan-300' },
  { key: 'disrupt', label: '妨害', color: 'text-fuchsia-300' },
];
type UseMode = 'hold' | 'instant';

const MAX_DUMMIES = 30; // 敵数の上限（名前プールの都合）
const HP_MIN = 6;
const HP_MAX = 24;

// カスタム設定の永続化（タイトルに戻ってもリセットされない）。
interface CustomCfg {
  initial: number; min: number; accel: number; theme: string; hp: number; enemies: number;
  autoFull: boolean; // 完全オート（有利不利を見て自動で使用）
  use: Record<ItemCat, UseMode>; // カテゴリ別の使い方（保持/即時）
}
const validMode = (v: unknown): UseMode => (v === 'instant' ? 'instant' : 'hold');
function loadCfg(): CustomCfg {
  const def: CustomCfg = {
    initial: INITIAL_SPAWN_INTERVAL, min: MIN_SPAWN_INTERVAL, accel: DEFAULT_ACCEL,
    theme: 'all', hp: MAX_BACKLOG, enemies: DUMMY_COUNT,
    autoFull: false, use: { attack: 'hold', defense: 'hold', disrupt: 'hold' },
  };
  try {
    const raw = localStorage.getItem(CFG_KEY);
    if (raw) {
      const o = JSON.parse(raw);
      return {
        initial: typeof o.initial === 'number' ? o.initial : def.initial,
        min: typeof o.min === 'number' ? o.min : def.min,
        accel: typeof o.accel === 'number' ? o.accel : def.accel,
        theme: typeof o.theme === 'string' ? o.theme : def.theme,
        hp: typeof o.hp === 'number' ? Math.min(HP_MAX, Math.max(HP_MIN, o.hp)) : def.hp,
        enemies: typeof o.enemies === 'number' ? Math.min(MAX_DUMMIES, Math.max(1, o.enemies)) : def.enemies,
        autoFull: typeof o.autoFull === 'boolean' ? o.autoFull : def.autoFull,
        use: o.use && typeof o.use === 'object'
          ? { attack: validMode(o.use.attack), defense: validMode(o.use.defense), disrupt: validMode(o.use.disrupt) }
          : def.use,
      };
    }
  } catch { /* localStorage 不可環境は既定値 */ }
  return def;
}

// CPU名（足りない分は連番で補う）。
const cpuName = (i: number): string => CPU_NAMES[i] ?? `CPU${i + 1}`;

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
  const [missCount, setMissCount] = useState(0); // ミスタイプ数（リザルト用）
  const [startTime, setStartTime] = useState<number | null>(null);
  const [endTime, setEndTime] = useState<number | null>(null); // ゲーム終了時刻（KPM固定用）
  const [spawnInterval, setSpawnInterval] = useState(INITIAL_SPAWN_INTERVAL);
  const [seed, setSeed] = useState(0);
  // カスタム: HP（積載限界）と敵数。
  const [maxBacklog, setMaxBacklog] = useState(initialCfg.hp);
  const [dummyCount, setDummyCount] = useState(initialCfg.enemies);
  const maxBacklogRef = useRef(initialCfg.hp);

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
  const [parryFx, setParryFx] = useState(false); // 受け流し成功エフェクト
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
  const [cfgHp, setCfgHp] = useState(initialCfg.hp);
  const [cfgEnemies, setCfgEnemies] = useState(initialCfg.enemies);
  const [cfgAutoFull, setCfgAutoFull] = useState(initialCfg.autoFull);
  const [cfgUse, setCfgUse] = useState<Record<ItemCat, UseMode>>(initialCfg.use);
  // 設定が変わるたび localStorage に保存（タイトルに戻ってもリセットされない）。
  useEffect(() => {
    try {
      localStorage.setItem(CFG_KEY, JSON.stringify({
        initial: cfgInitial, min: cfgMin, accel: cfgAccel, theme, hp: cfgHp, enemies: cfgEnemies,
        autoFull: cfgAutoFull, use: cfgUse,
      }));
    } catch { /* 保存不可環境は無視 */ }
  }, [cfgInitial, cfgMin, cfgAccel, theme, cfgHp, cfgEnemies, cfgAutoFull, cfgUse]);
  // ゲーム中に参照するための ref（設定はスタート画面で変える想定）。
  const autoFullRef = useRef(cfgAutoFull);
  const useModeRef = useRef(cfgUse);
  useEffect(() => { autoFullRef.current = cfgAutoFull; }, [cfgAutoFull]);
  useEffect(() => { useModeRef.current = cfgUse; }, [cfgUse]);
  const accelRef = useRef(DEFAULT_ACCEL);
  const minRef = useRef(MIN_SPAWN_INTERVAL);
  const rapidUntilRef = useRef(0);
  const keepUntilRef = useRef(0);
  const parryUntilRef = useRef(0);
  const totemUntilRef = useRef(0);
  const freezeUntilRef = useRef(0); // フリーズ（着弾予告/供給停止）
  const barrierRef = useRef(false); // バリア（次の被弾を1回防ぐ）
  const guardCountRef = useRef(0); // ガード（自動供給を複数回防ぐ）
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
    recentRef.current = [...recentRef.current, display].slice(-20);
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
    Array.from({ length: initialCfg.enemies }).map((_, i) => ({ id: i, height: 0, isKO: false, name: cpuName(i), combo: 0, atk: 0 })),
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
    const willKO = target.height + remaining > maxBacklogRef.current;
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
      else if (item === 'snipe') fireAttack(3);
      else if (item === 'heavy') fireAttack(Math.min(Math.max(2, Math.floor(stateRef.current.combo / 3)), 6));
      else if (item === 'burst') {
        // 全ての敵CPUへ一斉に +2。
        const inc = 2;
        const targets = dummiesRef.current.filter((d) => !d.isKO);
        const cap = maxBacklogRef.current;
        const koIds = targets.filter((d) => d.height + inc > cap).map((d) => d.id);
        setDummies((prev) =>
          prev.map((d) => (!d.isKO ? (d.height + inc > cap ? { ...d, height: 0, isKO: true } : { ...d, height: d.height + inc }) : d)),
        );
        if (koIds.length) {
          setPlayerKOs((k) => k + koIds.length);
          sfx.ko();
        }
        const from = centerRef.current?.getBoundingClientRect();
        for (const d of targets.slice(0, 8)) {
          const to = dummyRefs.current[d.id]?.getBoundingClientRect();
          if (from && to) addBeam(from.left + from.width / 2, from.top + from.height * 0.35, to.left + to.width / 2, to.top + to.height / 2, '#fb923c');
        }
        sfx.attack();
        pushToast('バースト！ 全体+2', 'item');
      }
      // --- 妨害 ---
      else if (item === 'flood') fireAttack(4);
      else if (item === 'mirror') fireAttack(Math.min(Math.max(1, Math.floor(stateRef.current.backlog.length / 3)), 6));
      else if (item === 'drain') {
        setBacklog((prev) => (prev.length <= 1 ? prev : [prev[0], ...prev.slice(1, Math.max(1, prev.length - 2))]));
        fireAttack(2);
      }
    },
    [fireAttack, addBeam, pushToast],
  );

  // 受け流し: 確定したおじゃまをプレイヤーに入れず、ランダムな敵CPUへ逸らす。
  const deflectToCpu = useCallback(
    (amount: number) => {
      if (amount <= 0) return;
      const alive = dummiesRef.current.filter((d) => !d.isKO);
      if (alive.length === 0) return;
      const target = alive[Math.floor(Math.random() * alive.length)];
      const willKO = target.height + amount > maxBacklogRef.current;
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
    const ratio = Math.min(1, stateRef.current.backlog.length / maxBacklogRef.current);
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
  }, [applyItem]);

  // 完全オート: 保持中のアイテムを、有利/不利に応じて良いタイミングで自動発動する。
  useEffect(() => {
    if (gameState !== 'playing') return;
    const id = setInterval(() => {
      if (!autoFullRef.current) return;
      const item = heldItemRef.current;
      if (!item) return;
      const frac = stateRef.current.backlog.length / maxBacklogRef.current; // 不利度
      const incoming = pendingRef.current.reduce((s, e) => s + e.amount, 0);
      const cat = ITEM_CAT[item];
      let use = false;
      if (cat === 'defense') use = frac >= 0.55 || incoming >= 3; // ピンチで防御
      else if (cat === 'attack') use = frac <= 0.5 && stateRef.current.combo >= 2; // 余裕＋連鎖で攻撃
      else use = frac >= 0.45 || incoming >= 2; // 妨害は不利寄りで
      if (frac >= 0.8) use = true; // 死にそうなら何でも発動
      if (use) {
        sfx.use();
        applyItem(item);
        setHeldItem(null);
      }
    }, 700);
    return () => clearInterval(id);
  }, [gameState, applyItem]);

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
    setMissCount(0);
    setPlayerKOs(0);
    setHeldItem(null);
    setStartTime(Date.now());
    setEndTime(null);
    // カスタム設定を反映（HP＝積載限界、敵数）。
    maxBacklogRef.current = cfgHp;
    setMaxBacklog(cfgHp);
    setDummyCount(cfgEnemies);
    accelRef.current = cfgAccel;
    minRef.current = cfgMin;
    rapidUntilRef.current = 0;
    keepUntilRef.current = 0;
    parryUntilRef.current = 0;
    totemUntilRef.current = 0;
    freezeUntilRef.current = 0;
    barrierRef.current = false;
    guardCountRef.current = 0;
    attackThresholdRef.current = ATTACK_THRESHOLD;
    setAttackThreshold(ATTACK_THRESHOLD);
    gaugeDownObtainedRef.current = false;
    attackProgressRef.current = 0;
    setAttackProgress(0);
    setSpawnInterval(cfgInitial);
    setGameState('playing');
    // 敵数ぶんのダミーを作り直す（カスタムで数が変わるため）。
    setDummies(
      Array.from({ length: cfgEnemies }).map((_, i) => ({
        id: i, height: Math.floor(Math.random() * 5), isKO: false, name: cpuName(i), combo: 0, atk: 0,
      })),
    );
    sfx.start();
  }, [cfgInitial, cfgMin, cfgAccel, cfgHp, cfgEnemies, updatePending, nextWord]);

  const gameOver = useCallback(() => {
    setGameState('gameover');
    setEndTime(Date.now()); // KPM をこの時点で固定
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
      // プレイ中はスペース（またはEnter）でアイテム発動。スペースはお題に使わないので安全。
      if (gameState === 'playing' && (e.key === ' ' || e.key === 'Enter')) { e.preventDefault(); useItem(); return; }
      if (gameState === 'playing' && e.key === 'Tab') { e.preventDefault(); cycleTargetMode(); return; }
      if (gameState !== 'playing' || e.key.length !== 1 || e.ctrlKey || e.metaKey || e.altKey) return;
      e.preventDefault();
      const key = e.key.toLowerCase();
      const result = processKey(key, stateRef.current);

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
        setKeysTyped((prev) => prev + 1);
        setScore((s) => s + 100 + newCombo * 10);
        sfx.clear();
        // 1単語クリアごとに、来ている着弾予告を1つ相殺（タイピング＝防御）。
        offsetIncoming(1);
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
  }, [startGame, useItem, fireAttack, grantItem, cycleTargetMode, offsetIncoming]);

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
          if (newHeight > maxBacklogRef.current) {
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
          const willKO = b.height + 1 > maxBacklogRef.current;
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
      if (now < freezeUntilRef.current) return; // フリーズ中は確定を保留
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
      if (words.length === 0) return;
      setBacklog((prev) => {
        const next = [...prev, ...words];
        if (next.length >= maxBacklogRef.current) {
          if (overflowProtect() === 'protected') return next.slice(0, maxBacklogRef.current - 1);
          gameOver();
          return next.slice(0, maxBacklogRef.current);
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
      setEndTime(Date.now()); // KPM をこの時点で固定
      sfx.start();
    }
  }, [dummies, gameState]);

  // --- ベース供給＆加速ループ ---
  useEffect(() => {
    if (gameState !== 'playing') return;
    let timerId: ReturnType<typeof setTimeout>;
    const loop = () => {
      const now = Date.now();
      if (now < brakeUntilRef.current || now < freezeUntilRef.current) {
        // ブレーキ / フリーズ中は供給停止
      } else if (guardCountRef.current > 0) {
        guardCountRef.current -= 1; // ガード: 複数回ぶん供給を無効化
      } else if (shieldRef.current) {
        shieldRef.current = false;
      } else {
        setBacklog((prev) => {
          if (prev.length >= maxBacklogRef.current) {
            if (overflowProtect() === 'protected') return prev.slice(0, maxBacklogRef.current - 1);
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
    // ゲーム終了後は終了時刻で固定（裏で時間が進んで KPM が下がるのを防ぐ）。
    const end = endTime ?? Date.now();
    const minutes = Math.max(1 / 600, (end - startTime) / 60000); // 0除算回避
    return Math.floor(keysTyped / minutes);
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

  // 加速度（表示用）: 大きいほど速く加速。内部の供給間隔倍率(cfgAccel)は
  // 1.00=加速なし、0.90=最速。speed = (1 - 倍率) * 100 で 0〜10 にマップ。
  const accelSpeed = Math.round((1 - cfgAccel) * 1000) / 10;
  const setAccelFromSpeed = (s: number) => {
    const clamped = Math.min(10, Math.max(0, s));
    setCfgAccel(Math.round((1 - clamped / 100) * 1000) / 1000);
  };

  const isDanger = backlog.length >= maxBacklog - 3;
  const eliminatedCount = dummies.filter((d) => d.isKO).length;
  const survivors = dummyCount + 1 - eliminatedCount;
  const totalIncoming = pending.reduce((s, e) => s + e.amount, 0);

  // 発動中の時間制限アイテム（残り時間カウントダウン表示用）。
  const activeEffects: { type: ItemType; until: number; color: string }[] = (
    [
      { type: 'brake', until: brakeUntilRef.current, color: 'bg-green-500' },
      { type: 'rapid', until: rapidUntilRef.current, color: 'bg-yellow-400' },
      { type: 'keep', until: keepUntilRef.current, color: 'bg-fuchsia-500' },
      { type: 'parry', until: parryUntilRef.current, color: 'bg-violet-500' },
      { type: 'totem', until: totemUntilRef.current, color: 'bg-amber-400' },
      { type: 'freeze', until: freezeUntilRef.current, color: 'bg-sky-400' },
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

      {/* 受け流し成功エフェクト（シアンの衝撃波リング＋PARRY!） */}
      {parryFx && (
        <div className="fixed inset-0 pointer-events-none z-50 flex items-center justify-center">
          <div className="parry-ring rounded-full border-4 border-cyan-300" />
          <div className="absolute parry-label text-4xl font-black italic text-cyan-200 drop-shadow-[0_0_18px_rgba(34,211,238,0.9)]">
            PARRY!
          </div>
        </div>
      )}

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
          {dummies.slice(0, Math.ceil(dummies.length / 2)).map((d) => (
            <div key={d.id} ref={(el) => { dummyRefs.current[d.id] = el; }}>
              <MiniBoard
                height={d.height}
                max={maxBacklog}
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
            {gameState === 'playing' && (
              <div className="absolute top-2 right-0 text-right">
                <div className="text-xs text-gray-500">ALIVE</div>
                <div className="font-mono text-2xl font-bold text-gray-300">
                  {survivors}
                  <span className="text-sm text-gray-600"> / {dummyCount + 1}</span>
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
                  {Array.from({ length: Math.min(totalIncoming, maxBacklog) }).map((_, i) => (
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

            {/* 自分のバックログ（処理待ち）。満タンでトップアウト＝敗北。 */}
            <div className="w-full max-w-lg mt-4">
              <div className="text-[10px] text-gray-500 mb-0.5">自分のバックログ（満タンで脱落）</div>
              <div className="flex gap-1">
                {Array.from({ length: maxBacklog }).map((_, i) => (
                  <div
                    key={i}
                    className={`h-2 flex-1 rounded-sm ${
                      i < backlog.length ? (i >= maxBacklog - 3 ? 'bg-red-500' : 'bg-cyan-500') : 'bg-neutral-800'
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
            // ヘッダー(h-16)の下を画面いっぱいに使う固定オーバーレイ。
            // 画面サイズに合わせてスクロール領域が広がる（収まる時は中央／はみ出す時は上からスクロール）。
            <div className="fixed left-0 right-0 top-16 bottom-0 bg-neutral-950/90 backdrop-blur-sm z-30 overflow-y-auto">
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
                  <div className="block text-[11px] text-gray-400">
                    加速度: <span className="text-cyan-300 font-mono">{accelSpeed.toFixed(1)}</span>
                    <span className="text-gray-600"> （大きいほど速く加速 / 0で加速なし）</span>
                    <div className="flex items-center gap-2 mt-1">
                      <StepBtn onClick={() => setAccelFromSpeed(accelSpeed - 0.5)}>−</StepBtn>
                      <input
                        type="range"
                        min={0}
                        max={10}
                        step={0.5}
                        value={accelSpeed}
                        onChange={(e) => setAccelFromSpeed(Number(e.target.value))}
                        className="flex-1 accent-cyan-500"
                      />
                      <StepBtn onClick={() => setAccelFromSpeed(accelSpeed + 0.5)}>＋</StepBtn>
                    </div>
                  </div>
                  <div className="block text-[11px] text-gray-400 mt-3">
                    自分のHP（積載限界）: <span className="text-cyan-300 font-mono">{cfgHp}</span>
                    <div className="flex items-center gap-2 mt-1">
                      <StepBtn onClick={() => setCfgHp((v) => Math.max(HP_MIN, v - 1))}>−</StepBtn>
                      <input
                        type="range"
                        min={HP_MIN}
                        max={HP_MAX}
                        step={1}
                        value={cfgHp}
                        onChange={(e) => setCfgHp(Number(e.target.value))}
                        className="flex-1 accent-cyan-500"
                      />
                      <StepBtn onClick={() => setCfgHp((v) => Math.min(HP_MAX, v + 1))}>＋</StepBtn>
                    </div>
                  </div>
                  <div className="block text-[11px] text-gray-400 mt-3">
                    敵の数: <span className="text-cyan-300 font-mono">{cfgEnemies}</span>
                    <div className="flex items-center gap-2 mt-1">
                      <StepBtn onClick={() => setCfgEnemies((v) => Math.max(1, v - 1))}>−</StepBtn>
                      <input
                        type="range"
                        min={1}
                        max={MAX_DUMMIES}
                        step={1}
                        value={cfgEnemies}
                        onChange={(e) => setCfgEnemies(Number(e.target.value))}
                        className="flex-1 accent-cyan-500"
                      />
                      <StepBtn onClick={() => setCfgEnemies((v) => Math.min(MAX_DUMMIES, v + 1))}>＋</StepBtn>
                    </div>
                  </div>

                  {/* アイテムの使い方 */}
                  <div className="mt-4 border-t border-white/10 pt-3">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-[11px] text-amber-200 font-bold">アイテムの使い方</span>
                      <button
                        onClick={() => setCfgAutoFull((v) => !v)}
                        className={`px-2 py-0.5 rounded text-[10px] font-bold transition-colors ${
                          cfgAutoFull ? 'bg-emerald-600 text-white' : 'bg-neutral-800 text-gray-400 hover:bg-neutral-700'
                        }`}
                      >
                        完全オート {cfgAutoFull ? 'ON' : 'OFF'}
                      </button>
                    </div>
                    {cfgAutoFull ? (
                      <p className="text-[10px] text-emerald-300/80">
                        有利/不利を見て、いい感じのタイミングで自動発動します（手動 [Space] も可）。
                      </p>
                    ) : (
                      <div className="flex flex-col gap-1.5">
                        {CAT_META.map((c) => (
                          <div key={c.key} className="flex items-center justify-between">
                            <span className={`text-[11px] font-bold ${c.color}`}>{c.label}</span>
                            <div className="flex gap-1">
                              {(['hold', 'instant'] as UseMode[]).map((m) => (
                                <button
                                  key={m}
                                  onClick={() => setCfgUse((u) => ({ ...u, [c.key]: m }))}
                                  className={`px-2 py-0.5 rounded text-[10px] font-bold transition-colors ${
                                    cfgUse[c.key] === m ? 'bg-cyan-600 text-white' : 'bg-neutral-800 text-gray-400 hover:bg-neutral-700'
                                  }`}
                                >
                                  {m === 'hold' ? '保持' : '即時'}
                                </button>
                              ))}
                            </div>
                          </div>
                        ))}
                        <p className="text-[10px] text-gray-600">即時＝拾った瞬間に自動発動 / 保持＝[Space]で手動発動</p>
                      </div>
                    )}
                  </div>
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
                ノーミスで打ち切ると連鎖UP。5連鎖ごとに敵CPUへおじゃまを送って撃墜！ CPUも反撃してくるので [Tab] で狙いを切り替えよう。お宝(🟨)を打つとアイテム獲得 → [Space] で使用。
              </p>
              <div className="mt-4 text-xs bg-neutral-900/50 p-3 rounded-xl max-w-sm w-full">
                <div className="text-gray-400 font-bold mb-1.5 flex items-center gap-1">
                  <Sparkles className="w-3 h-3 text-yellow-400" /> アイテム効果（お宝🟨で入手 → [Space]で使用）
                </div>
                <div className="flex flex-col gap-2 text-left text-gray-400">
                  {CAT_META.map((c) => (
                    <div key={c.key}>
                      <div className={`text-[11px] font-black mb-0.5 ${c.color}`}>{c.label}</div>
                      <div className="flex flex-col gap-1">
                        {ALL_ITEMS.filter((t) => ITEM_CAT[t] === c.key).map((t) => (
                          <div key={t}>
                            <span className="mr-1">{ITEM_META[t].icon}</span>
                            <span className="text-gray-300 font-bold">{ITEM_META[t].name}</span>
                            <span className="text-gray-500"> … {ITEM_META[t].desc}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* ゲージの説明 */}
              <div className="mt-3 mb-2 text-xs bg-neutral-900/50 p-3 rounded-xl max-w-sm w-full">
                <div className="text-gray-400 font-bold mb-1.5">ゲージの見方</div>
                <div className="flex flex-col gap-1 text-left text-gray-500">
                  <div>
                    <span className="text-red-400 font-bold">左の赤ゲージ（着弾予告）</span> … CPUから送られてくるおじゃまの予告。<span className="text-cyan-300">単語を1つ打ち切るごとに1つ相殺（防御）</span>でき、相殺しきれず時間切れになるとバックログに加算される。
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
                <Stat label="正タイプ" value={keysTyped} />
                <Stat label="ミス" value={missCount} />
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
                <Stat label="正タイプ" value={keysTyped} />
                <Stat label="ミス" value={missCount} />
                <Stat label="SEED" value={seed} small />
              </div>
              <p className="text-gray-400 font-mono animate-pulse">Press [SPACE] to Retry</p>
            </div>
          )}
        </div>

        <div className="w-1/4 grid grid-cols-2 gap-2 content-start">
          {dummies.slice(Math.ceil(dummies.length / 2)).map((d) => (
            <div key={d.id} ref={(el) => { dummyRefs.current[d.id] = el; }}>
              <MiniBoard
                height={d.height}
                max={maxBacklog}
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
  if (type === 'rapid') return <Zap className="w-5 h-5 text-yellow-300" />;
  return <span className="text-base leading-none">{ITEM_EMOJI[type]}</span>;
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
